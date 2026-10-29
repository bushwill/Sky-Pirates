import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BOT_PERSONALITIES, chooseBotLoadoutGadgetId, chooseBotLoadoutWeaponId, createBotBrain, decideBotAction, DEFAULT_BOT_PARAMETERS, normalizeBotParameters } from '../../shared/BotAI.js';
import { generateMap } from '../../shared/MapGenerator.js';
import {
  CRYO_GRENADE_ID,
  BIO_FIELD_ID,
  FLASH_GRENADE_ID,
  GADGET_DEFINITIONS,
  JAMMER_GRENADE_ID,
  JAMMER_GRENADE_RADIUS,
  KATANA_ID,
  MOLOTOV_ID,
  ORBITAL_STRIKE_ID,
  PROXIMITY_MINE_ID,
  SONAR_ID,
  SMOKE_GRENADE_ID,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_HEALTH,
  VINE_TRAP_ID,
} from '../../shared/GadgetModel.js';
import { movePosition } from '../../shared/MovementModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS, segmentCircleEntryTCoordinates, segmentMapObjectEntryT } from '../../shared/ProjectileModel.js';
import { circleOverlapsMapObjects } from '../../shared/MapGeometry.js';
import { isPointVisible } from '../../shared/VisionModel.js';

function createMatch() {
  return {
    map: {
      width: 1_000,
      height: 700,
      objects: [],
      rooms: [],
      corridors: [],
      graph: { nodes: [], edges: [] },
      spawnZones: {
        red: { x: 820, y: 270, width: 140, height: 140 },
        blue: { x: 40, y: 270, width: 140, height: 140 },
      },
    },
    flag: { x: 120, y: 340, heldBy: null, dropped: false },
    players: [],
    botNoises: [],
  };
}

function createPlayer(id, team, x, y, health = 100) {
  return {
    id,
    team,
    x,
    y,
    health,
    alive: true,
    selectedWeaponId: 'assault-rifle',
    visionAngle: 0,
    weaponStats: { 'assault-rifle': { aimAngle: 0 } },
  };
}

function angleDifference(left, right) {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

describe('bot AI', () => {
  it('selects bot loadouts by botAppeal rather than weapon shop value', () => {
    const weapons = [
      { id: 'common', botAppeal: 3, shopValue: 0 },
      { id: 'rare', botAppeal: 1, shopValue: 99 },
      { id: 'never', botAppeal: 0, shopValue: 1 },
    ];

    assert.equal(chooseBotLoadoutWeaponId(weapons, () => 0), 'common');
    assert.equal(chooseBotLoadoutWeaponId(weapons, () => 0.74), 'common');
    assert.equal(chooseBotLoadoutWeaponId(weapons, () => 0.75), 'rare');
    assert.equal(chooseBotLoadoutWeaponId(weapons, () => 0.999), 'rare');
  });

  it('selects bot gadgets by botAppeal', () => {
    const gadgets = [
      { id: 'common', botAppeal: 3 },
      { id: 'rare', botAppeal: 1 },
      { id: 'unwanted', botAppeal: 0 },
    ];

    assert.equal(chooseBotLoadoutGadgetId(gadgets, () => 0), 'common');
    assert.equal(chooseBotLoadoutGadgetId(gadgets, () => 0.74), 'common');
    assert.equal(chooseBotLoadoutGadgetId(gadgets, () => 0.75), 'rare');
    assert.equal(chooseBotLoadoutGadgetId(gadgets, () => 0.999), 'rare');
  });

  it('keeps the selection chance equal across bot gadgets', () => {
    const gadgets = Object.values(GADGET_DEFINITIONS).filter((gadget) => gadget.rarity !== 'unique');
    assert.equal(new Set(gadgets.map(({ botAppeal }) => botAppeal)).size, 1);
    assert.equal(chooseBotLoadoutGadgetId(gadgets, () => 0.9), FLASH_GRENADE_ID);
  });

  it('includes every unique gadget in the bot loadout selection pool', () => {
    const gadgets = Object.values(GADGET_DEFINITIONS);
    for (const [index, gadget] of gadgets.entries()) {
      assert.equal(chooseBotLoadoutGadgetId(gadgets, () => (index + 0.5) / gadgets.length), gadget.id);
    }
  });

  it('uses Katana against a nearby visible enemy within the dash path radius', () => {
    const match = createMatch();
    const bot = createPlayer('katana-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: KATANA_ID,
      gadgetCount: 1,
      gadgetCounts: { [KATANA_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('katana-target', 'blue', 160, 340);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(decision.gadgetAction?.action, 'use');
    assert.equal(decision.gadgetAction.target.x, enemy.x);
    assert.equal(decision.gadgetAction.target.y, enemy.y);
  });

  it('uses Orbital Strike on visible enemies while avoiding nearby teammates', () => {
    const match = createMatch();
    const bot = createPlayer('orbital-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: ORBITAL_STRIKE_ID,
      gadgetCount: 1,
      gadgetCounts: { [ORBITAL_STRIKE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('orbital-target', 'blue', 500, 340);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(decision.gadgetAction.target.x > 400);
    assert.equal(decision.fire, false);

    match.players.push(createPlayer('orbital-teammate', 'red', 490, 340));
    assert.notEqual(decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_050).gadgetAction?.action, 'use');
  });

  it('places Spy Cameras facing a visible enemy', () => {
    const match = createMatch();
    const bot = createPlayer('camera-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SPY_CAMERA_ID,
      gadgetCount: 1,
      gadgetCounts: { [SPY_CAMERA_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('camera-target', 'blue', 500, 400);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(decision.gadgetAction.target.x > enemy.x - 10);
    assert.ok(decision.gadgetAction.target.y > enemy.y - 10);
  });

  it('saves a Strike Team Spy Camera at its own site and uses it after reaching midfield', () => {
    const match = createMatch();
    const bot = createPlayer('strike-camera-bot', 'red', 890, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SPY_CAMERA_ID,
      gadgetCount: 1,
      gadgetCounts: { [SPY_CAMERA_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('camera-threat', 'blue', 950, 340);
    match.players = [bot, enemy];

    const siteDecision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notEqual(siteDecision.gadgetAction?.action, 'use',
      'the red Strike Team bot keeps its one-use camera while still at the Strike Site');

    const midBot = createPlayer('mid-camera-bot', 'red', 500, 340);
    Object.assign(midBot, {
      botBrain: createBotBrain(midBot.id, 0),
      selectedGadgetId: SPY_CAMERA_ID,
      gadgetCount: 1,
      gadgetCounts: { [SPY_CAMERA_ID]: 1 },
      equippedSlot: 'gadget',
    });
    match.players = [midBot, enemy];
    const midDecision = decideBotAction(midBot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(midDecision.gadgetAction?.action, 'use',
      'the bot can deploy the camera after advancing into midfield');
  });

  it('uses Sonar toward suspected enemy audio and avoids overlapping its active projectile', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'segment', x1: 300, y1: 280, x2: 300, y2: 400 }];
    const bot = createPlayer('sonar-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SONAR_ID,
      gadgetCount: 2,
      gadgetCounts: { [SONAR_ID]: 2 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('sonar-suspect', 'blue', 650, 340);
    match.players = [bot, enemy];
    const teamIntel = {
      sightings: [],
      incidents: [],
      audioCues: [{ team: 'red', x: enemy.x, y: enemy.y, expiresAt: 5_000 }],
    };

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, { teamIntel });
    assert.equal(decision.gadgetAction?.action, 'use');
    assert.equal(decision.gadgetAction.target.x, enemy.x);
    assert.equal(decision.gadgetAction.target.y, enemy.y);

    match.gadgetEffects = [{
      type: 'sonar-projectile',
      ownerId: bot.id,
      expiresAt: 2_000,
    }];
    assert.notEqual(decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_100, { teamIntel })
      .gadgetAction?.action, 'use');
  });

  it('places Vine Traps on useful routes using the shorter arming window', () => {
    const match = createMatch();
    match.map.corridors = [{
      id: 'vine-route',
      a: 'room-a',
      b: 'room-b',
      width: 80,
      points: [{ x: 300, y: 340 }, { x: 500, y: 340 }, { x: 700, y: 340 }],
    }];
    const bot = createPlayer('vine-bot', 'blue', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: VINE_TRAP_ID,
      gadgetCount: 1,
      gadgetCounts: { [VINE_TRAP_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(decision.gadgetAction?.action, 'use');
    assert.equal(GADGET_DEFINITIONS[VINE_TRAP_ID].armingDurationMs, 1_000);
  });

  it('uses Molotovs more readily on groups and Cryo more readily on an approaching threat', () => {
    for (const [gadgetId, expectedTargetX] of [[MOLOTOV_ID, 620], [CRYO_GRENADE_ID, 400]]) {
      const match = createMatch();
      const bot = createPlayer(`bot-${gadgetId}`, 'red', 300, 340);
      Object.assign(bot, {
        botBrain: createBotBrain(bot.id, 0),
        selectedGadgetId: gadgetId,
        gadgetCount: 1,
        gadgetCounts: { [gadgetId]: 1 },
        equippedSlot: 'gadget',
      });
      const approachingEnemy = createPlayer('approaching-enemy', 'blue', 400, 340);
      approachingEnemy.vx = -100;
      const group = [
        createPlayer('group-enemy-1', 'blue', 610, 340),
        createPlayer('group-enemy-2', 'blue', 630, 340),
      ];
      match.players = [bot, approachingEnemy, ...group];

      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

      assert.equal(decision.gadgetAction?.action, 'use');
      assert.ok(Math.abs(decision.gadgetAction.target.x - expectedTargetX) <= 10,
        `${gadgetId} should favor its weighted tactical target`);
      assert.equal(decision.fire, false, 'a gadget use cannot share a command with weapon fire');
    }
  });

  it('throws Flash Grenades at visible enemy groups without blinding the bot', () => {
    const match = createMatch();
    const bot = createPlayer('flash-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: FLASH_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [FLASH_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });

    it('throws Jammer Grenades at visible enemy groups, favoring clusters of players and gadgets', () => {
      const match = createMatch();
      const bot = createPlayer('jammer-bot', 'red', 100, 340);
      Object.assign(bot, {
        botBrain: createBotBrain(bot.id, 0),
        selectedGadgetId: JAMMER_GRENADE_ID,
        gadgetCount: 1,
        gadgetCounts: { [JAMMER_GRENADE_ID]: 1 },
        equippedSlot: 'gadget',
      });
      const enemies = [
        createPlayer('jammer-enemy-1', 'blue', 500, 340),
        createPlayer('jammer-enemy-2', 'blue', 520, 340),
        createPlayer('jammer-enemy-3', 'blue', 700, 340),
      ];
      match.players = [bot, ...enemies];
      match.gadgetEffects = [{
        id: 'jammer-camera',
        type: SPY_CAMERA_ID,
        team: 'blue',
        x: 530,
        y: 340,
        expiresAt: 20_000,
      }];

      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

      assert.equal(decision.gadgetAction?.action, 'use');
      assert.ok(Math.hypot(decision.gadgetAction.target.x - 500, decision.gadgetAction.target.y - 340) <=
        JAMMER_GRENADE_RADIUS);
      assert.equal(decision.fire, false, 'a gadget use cannot share a command with weapon fire');
    });
    const enemies = [
      createPlayer('flash-enemy-1', 'blue', 500, 340),
      createPlayer('flash-enemy-2', 'blue', 520, 340),
    ];
    match.players = [bot, ...enemies];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(Math.hypot(decision.gadgetAction.target.x - bot.x, decision.gadgetAction.target.y - bot.y) >
      GADGET_DEFINITIONS[FLASH_GRENADE_ID].effectRadius,
    'the bot stays outside the flash radius');
    assert.equal(decision.fire, false, 'a gadget use cannot share a command with weapon fire');
  });

  it('uses a Flash Grenade against a single unflashed enemy in line of sight', () => {
    const match = createMatch();
    const bot = createPlayer('flash-solo-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: FLASH_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [FLASH_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    match.players = [bot, createPlayer('flash-solo-enemy', 'blue', 500, 340)];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
  });

  it('does not throw a Flash Grenade when its blast would affect a teammate', () => {
    const match = createMatch();
    const bot = createPlayer('flash-safety-bot', 'red', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: FLASH_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [FLASH_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const teammate = createPlayer('flash-teammate', 'red', 560, 340);
    const enemies = [
      createPlayer('flash-safety-enemy-1', 'blue', 600, 340),
      createPlayer('flash-safety-enemy-2', 'blue', 620, 340),
    ];
    match.players = [bot, teammate, ...enemies];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.notEqual(decision.gadgetAction?.action, 'use');
  });

  it('places proximity mines on hidden enemy routes when there is time for them to arm', () => {
    const match = createMatch();
    match.map.corridors = [{
      id: 'approach',
      a: 'room-a',
      b: 'room-b',
      width: 80,
      points: [{ x: 300, y: 340 }, { x: 500, y: 340 }, { x: 700, y: 340 }],
    }];
    const bot = createPlayer('mine-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('approaching-enemy', 'blue', 600, 340);
    enemy.vx = -25;
    enemy.visionAngle = 0;
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(decision.gadgetAction.target.x < enemy.x - 72,
      'the mine is ahead on the route but has enough time to arm');
  });

  it('proactively traps a quiet narrow corridor without waiting for a visible enemy', () => {
    const match = createMatch();
    match.map.corridors = [{
      id: 'quiet-choke',
      a: 'room-a',
      b: 'room-b',
      width: 80,
      points: [{ x: 300, y: 340 }, { x: 500, y: 340 }, { x: 700, y: 340 }],
    }];
    const bot = createPlayer('flag-mine-bot', 'blue', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    match.players = [bot];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(decision.gadgetAction.target.x >= 300 && decision.gadgetAction.target.x <= 500,
      'the mine should cover a nearby chokepoint during a quiet opportunity');
  });

  it('saves Strike Team mines near home and uses quiet-route traps on the Flag Team half', () => {
    function decideAt(position, corridorPoints) {
      const match = createMatch();
      match.map.corridors = [{
        id: 'offensive-route',
        a: 'room-a',
        b: 'room-b',
        width: 80,
        points: corridorPoints,
      }];
      const bot = createPlayer(`strike-mine-${position.x}`, 'red', position.x, position.y);
      Object.assign(bot, {
        botBrain: createBotBrain(bot.id, 0),
        selectedGadgetId: PROXIMITY_MINE_ID,
        gadgetCount: 1,
        gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
        equippedSlot: 'gadget',
      });
      match.players = [bot];
      return decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    }

    const nearHome = decideAt({ x: 700, y: 340 }, [
      { x: 700, y: 340 }, { x: 800, y: 340 },
    ]);
    assert.notEqual(nearHome.gadgetAction?.action, 'use',
      'quiet traps near the Strike Team site should usually be saved');

    const nearFlag = decideAt({ x: 200, y: 340 }, [
      { x: 200, y: 340 }, { x: 400, y: 340 },
    ]);
    assert.equal(nearFlag.gadgetAction?.action, 'use');
  });

  it('reserves Flag Team entrance mines for late, low-player-count situations', () => {
    const match = createMatch();
    match.gameplayStartsAt = 0;
    match.endsAt = 100_000;
    match.map.corridors = [{
      id: 'blue-entrance',
      a: 'blue-spawn',
      b: 'approach',
      width: 70,
      points: [{ x: 180, y: 340 }, { x: 380, y: 340 }],
    }];
    const bot = createPlayer('flag-mine-bot', 'blue', 100, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('enemy', 'red', 900, 650);
    match.players = [bot, enemy];

    const early = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 20_000);
    assert.notEqual(early.gadgetAction?.action, 'use');

    const late = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 80_000);
    assert.equal(late.gadgetAction?.action, 'use');
    assert.ok(late.gadgetAction.target.x > 180 && late.gadgetAction.target.x < 280,
      'late Flag Team mines cover the entrance rather than the site interior');
  });

  it('does not place proximity mines on a nearby teammate route', () => {
    const match = createMatch();
    match.map.corridors = [{
      id: 'team-route',
      a: 'room-a',
      b: 'room-b',
      width: 80,
      points: [{ x: 300, y: 340 }, { x: 500, y: 340 }, { x: 700, y: 340 }],
    }];
    const bot = createPlayer('mine-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const teammate = createPlayer('teammate', 'red', 400, 340);
    match.players = [bot, teammate];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.notEqual(decision.gadgetAction?.action, 'use');
  });

  it('avoids mines that would trigger before arming or duplicate existing coverage', () => {
    const match = createMatch();
    match.map.corridors = [{
      id: 'approach',
      a: 'room-a',
      b: 'room-b',
      width: 80,
      points: [{ x: 300, y: 340 }, { x: 500, y: 340 }, { x: 700, y: 340 }],
    }];
    const bot = createPlayer('mine-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('approaching-enemy', 'blue', 500, 340);
    enemy.vx = -100;
    enemy.visionAngle = 0;
    match.players = [bot, enemy];

    const imminent = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notEqual(imminent.gadgetAction?.action, 'use',
      'a visible enemy can reach the planned location before its arming delay ends');

    enemy.alive = false;
    match.gadgetEffects = [{
      type: 'mine',
      team: 'red',
      x: 400,
      y: 340,
      startedAt: 0,
      expiresAt: 10_000,
    }];
    const covered = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notEqual(covered.gadgetAction?.action, 'use',
      'an already-covered route should not receive a redundant mine');
  });

  it('uses a gadget against a nearby solo threat instead of waiting for a cluster', () => {
    const match = createMatch();
    const bot = createPlayer('bot-near-threat', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: CRYO_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [CRYO_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    match.players = [bot, createPlayer('enemy', 'blue', 600, 340)];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
    assert.equal(decision.gadgetAction.target.x, 600);
  });

  it('throws smoke between itself and an approaching enemy that can see it', () => {
    const match = createMatch();
    const bot = createPlayer('smoke-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SMOKE_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [SMOKE_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemy = createPlayer('approaching-enemy', 'blue', 500, 340);
    enemy.visionAngle = Math.PI;
    enemy.vx = -100;
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.gadgetAction?.action, 'use');
    assert.ok(decision.gadgetAction.target.x > bot.x + 60);
    assert.ok(decision.gadgetAction.target.x < enemy.x);
    assert.equal(decision.gadgetAction.target.y, bot.y);
  });

  it('does not throw smoke at a group that is not threatening it', () => {
    const match = createMatch();
    const bot = createPlayer('smoke-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SMOKE_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [SMOKE_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const enemies = [
      createPlayer('enemy-1', 'blue', 650, 340),
      createPlayer('enemy-2', 'blue', 670, 340),
    ];
    match.players = [bot, ...enemies];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.notEqual(decision.gadgetAction?.action, 'use');
  });

  it("does not place smoke across a teammate's visible shot lane", () => {
    const match = createMatch();
    const bot = createPlayer('smoke-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: SMOKE_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { [SMOKE_GRENADE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const teammate = createPlayer('ally', 'red', 250, 340);
    const enemy = createPlayer('approaching-enemy', 'blue', 500, 340);
    enemy.visionAngle = Math.PI;
    enemy.vx = -100;
    match.players = [bot, teammate, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.notEqual(decision.gadgetAction?.action, 'use');
  });

  it('waits for gadget slot switching to finish before using the selected gadget', () => {
    const match = createMatch();
    const bot = createPlayer('bot-switching', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: MOLOTOV_ID,
      gadgetCount: 1,
      gadgetCounts: { [MOLOTOV_ID]: 1 },
      equippedSlot: 'weapon',
      gadgetSwitchEndsAt: 1_500,
      gadgetSwitchTargetSlot: 'gadget',
    });
    match.players = [
      bot,
      createPlayer('enemy-1', 'blue', 430, 340),
      createPlayer('enemy-2', 'blue', 450, 340),
    ];

    const switching = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(switching.gadgetAction, undefined);
    assert.equal(switching.fire, false, 'the weapon cannot fire during gadget switching');

    const equipped = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_600);
    assert.equal(equipped.gadgetAction?.action, 'use');
  });

  it('keeps Molotov and Cryo impact zones clear of teammates, with a larger Molotov safety margin', () => {
    function decideWithTeammate(gadgetId, teammateY) {
      const match = createMatch();
      const bot = createPlayer(`bot-${gadgetId}`, 'red', 300, 340);
      Object.assign(bot, {
        botBrain: createBotBrain(bot.id, 0),
        selectedGadgetId: gadgetId,
        gadgetCount: 1,
        gadgetCounts: { [gadgetId]: 1 },
        equippedSlot: 'gadget',
      });
      const teammate = createPlayer('ally', 'red', 520, teammateY);
      const enemies = [
        createPlayer('enemy-1', 'blue', 510, 340),
        createPlayer('enemy-2', 'blue', 530, 340),
      ];
      match.players = [bot, teammate, ...enemies];
      return decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    }

    assert.notEqual(decideWithTeammate(MOLOTOV_ID, 340).gadgetAction?.action, 'use',
      'neither gadget is thrown when a teammate is in its effect zone');
    assert.notEqual(decideWithTeammate(CRYO_GRENADE_ID, 340).gadgetAction?.action, 'use',
      'Cryo also rejects direct teammate hits');
    assert.notEqual(decideWithTeammate(MOLOTOV_ID, 450).gadgetAction?.action, 'use',
      'Molotov keeps the larger teammate exclusion margin');
    assert.equal(decideWithTeammate(CRYO_GRENADE_ID, 450).gadgetAction?.action, 'use',
      'Cryo remains usable when the teammate is outside its smaller exclusion zone');
  });

  it('validates bounded, independently tunable bot parameters', () => {
    assert.deepEqual(normalizeBotParameters({}), DEFAULT_BOT_PARAMETERS);
    assert.equal(normalizeBotParameters({ thinkingComplexity: 4.6 }).thinkingComplexity, 5);
    assert.throws(() => normalizeBotParameters({ reflexMs: -1 }), /reflexMs must be between/);
    assert.throws(() => normalizeBotParameters({ aggressiveness: 1.1 }), /aggressiveness must be between/);
  });

  it('defines ten stable bot identities with distinct, realistic human reaction-time profiles', () => {
    assert.equal(BOT_PERSONALITIES.length, 10);
    assert.deepEqual(BOT_PERSONALITIES.map((bot) => bot.id), Array.from({ length: 10 }, (_, index) => `bot-${index + 1}`));
    const profiles = BOT_PERSONALITIES.map((bot) => JSON.stringify(bot.parameters));
    assert.equal(new Set(profiles).size, 10);
    assert.ok(BOT_PERSONALITIES.every((bot) => bot.parameters.reflexMs >= 170 && bot.parameters.reflexMs <= 350));
    assert.ok(BOT_PERSONALITIES.every((bot) => bot.parameters.accuracy >= 0.5 && bot.parameters.accuracy <= 0.9));
    assert.ok(BOT_PERSONALITIES.every((bot) => bot.parameters.thinkingTimeMs >= 50 && bot.parameters.thinkingTimeMs <= 200));
  });

  it('selects visible combat, observes reaction time, then fires when aim is aligned', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340);
    const enemy = createPlayer('enemy', 'blue', 220, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];
    const parameters = { ...DEFAULT_BOT_PARAMETERS, reflexMs: 250, aggressiveness: 0.95, accuracy: 1 };

    const first = decideBotAction(bot, match, parameters, 0);
    assert.equal(first.action, 'fight');
    assert.equal(first.enemyId, enemy.id);
    assert.equal(first.fire, false, 'the bot waits for its reflex delay');

    bot.selectedWeaponId = first.weaponId;
    bot.weaponStats[first.weaponId] ??= { aimAngle: 0 };
    const ready = decideBotAction(bot, match, parameters, 300);
    assert.equal(ready.fire, true, 'the aligned bot fires after the reflex interval');
  });

  it('shoots an armed enemy mine only when it is visible and has a clear shot lane', () => {
    const match = createMatch();
    const bot = createPlayer('mine-shooter', 'red', 100, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    bot.weaponStats['assault-rifle'].aimAngle = 0;
    match.players = [bot];
    const mine = {
      id: 'enemy-mine',
      type: 'mine',
      team: 'blue',
      x: 220,
      y: 340,
      radius: 50,
      hitRadius: 4,
      armedAt: 0,
      expiresAt: 10_000,
    };
    match.gadgetEffects = [mine];

    const visible = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      accuracy: 1,
      reflexMs: 1_500,
    }, 1_000);
    assert.equal(visible.fire, true, 'mine shots do not wait for the player-combat reflex delay');
    assert.ok(visible.direction.x > 0, 'the bot aims at the visible mine');

    match.gadgetEffects = [{ ...mine, team: 'red' }];
    assert.equal(decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_000).fire,
      false, "the bot does not shoot its own team's mine");

    match.gadgetEffects = [{ ...mine, armedAt: 2_000 }];
    assert.equal(decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_000).fire,
      false, 'unarmed mines cannot be damaged by bullets');

    match.map.objects = [{ shape: 'segment', x1: 160, y1: 300, x2: 160, y2: 380 }];
    match.gadgetEffects = [mine];
    assert.equal(decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_000).fire,
      false, 'the bot does not shoot at mines hidden behind a wall');
  });

  it('shoots visible enemy Spy Cameras, but gives armed proximity mines higher priority', () => {
    const match = createMatch();
    const bot = createPlayer('camera-hunter', 'red', 100, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    bot.weaponStats['assault-rifle'].aimAngle = 0;
    match.players = [bot];
    const camera = {
      id: 'enemy-camera', type: SPY_CAMERA_ID, team: 'blue',
      x: 220, y: 380, radius: 7, health: 50, expiresAt: 10_000,
    };
    bot.weaponStats['assault-rifle'].aimAngle = Math.atan2(camera.y - bot.y, camera.x - bot.x);
    match.gadgetEffects = [camera];
    const cameraDecision = decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_000);

    assert.equal(cameraDecision.fire, true);
    assert.ok(cameraDecision.direction.y > 0, 'the bot aims at the visible enemy camera');

    const mine = {
      id: 'enemy-mine', type: 'mine', team: 'blue', x: 220, y: 300,
      hitRadius: 4, armedAt: 0, expiresAt: 10_000,
    };
    match.gadgetEffects = [camera, mine];
    bot.weaponStats['assault-rifle'].aimAngle = Math.atan2(mine.y - bot.y, mine.x - bot.x);
    const mineDecision = decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_050);
    assert.equal(mineDecision.fire, true);
    assert.ok(mineDecision.direction.y < 0, 'an armed mine remains higher priority than a Spy Camera');

    match.map.objects = [{ shape: 'segment', x1: 160, y1: 300, x2: 160, y2: 400 }];
    match.gadgetEffects = [camera];
    bot.weaponStats['assault-rifle'].aimAngle = Math.atan2(camera.y - bot.y, camera.x - bot.x);
    assert.equal(decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, accuracy: 1 }, 1_100).fire,
      false, 'the bot does not shoot a Spy Camera hidden behind a wall');
  });

  it('shoots visible enemy Trophy Systems and places its own when defending a site', () => {
    const match = createMatch();
    const bot = createPlayer('trophy-hunter', 'red', 100, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    bot.weaponStats['assault-rifle'].aimAngle = 0;
    match.players = [bot];
    const trophy = {
      id: 'enemy-trophy', type: TROPHY_SYSTEM_ID, team: 'blue',
      x: 220, y: 340, radius: 8, health: TROPHY_SYSTEM_HEALTH, expiresAt: 10_000,
    };
    match.gadgetEffects = [trophy];
    const shootingDecision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      accuracy: 1,
    }, 1_000);
    assert.equal(shootingDecision.fire, true);
    assert.ok(shootingDecision.direction.x > 0, 'the bot aims at the enemy Trophy System');

    const defender = createPlayer('trophy-defender', 'blue', 100, 340);
    defender.botBrain = createBotBrain(defender.id, 0);
    defender.selectedGadgetId = TROPHY_SYSTEM_ID;
    defender.gadgetCount = 1;
    defender.gadgetCounts = { [TROPHY_SYSTEM_ID]: 1 };
    defender.equippedSlot = 'gadget';
    match.players = [defender];
    match.gadgetEffects = [];
    const placementDecision = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(placementDecision.gadgetAction?.action, 'use');
    assert.deepEqual(placementDecision.gadgetAction?.target, { x: defender.x, y: defender.y });

    const ownedTrophy = {
      id: 'defender-trophy',
      type: TROPHY_SYSTEM_ID,
      gadgetId: TROPHY_SYSTEM_ID,
      ownerId: defender.id,
      team: defender.team,
      x: defender.x,
      y: defender.y,
      health: TROPHY_SYSTEM_HEALTH,
      startedAt: 900,
      expiresAt: 10_000,
    };
    match.gadgetEffects = [
      ownedTrophy,
      { id: 'enemy-cryo', type: CRYO_GRENADE_ID, gadgetId: CRYO_GRENADE_ID,
        team: 'red', x: 320, y: 340, radius: 60, expiresAt: 10_000 },
      { id: 'enemy-molotov', type: MOLOTOV_ID, gadgetId: MOLOTOV_ID,
        team: 'red', x: 330, y: 340, radius: 60, expiresAt: 10_000 },
    ];
    defender.gadgetCount = 0;
    defender.gadgetCounts[TROPHY_SYSTEM_ID] = 0;
    defender.equippedSlot = 'weapon';
    const switchDecision = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_200);
    assert.equal(switchDecision.gadgetAction?.action, 'switch',
      'the bot switches to its placed Trophy when the command has a useful target');
    defender.equippedSlot = 'gadget';
    const commandDecision = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_300);
    assert.equal(commandDecision.gadgetAction?.action, 'use');
    assert.deepEqual(commandDecision.gadgetAction?.target, { x: 320, y: 340 },
      'the pulse aims to clear multiple visible enemy fields');

    match.gadgetEffects = [ownedTrophy];
    assert.equal(decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_400)
      .gadgetAction?.action, 'switch', 'the bot does not waste the command when no enemy gadget is visible');
  });

  it('weights Molotov and Cryo hazards when selecting a waypoint, while treating smoke as harmless', () => {
    for (const type of ['molotov', 'cryo', BIO_FIELD_ID]) {
      const match = createMatch();
      const bot = createPlayer(`hazard-${type}`, 'red', 700, 340);
      bot.botBrain = createBotBrain(bot.id, 0);
      bot.botBrain.spawnExited = true;
      match.players = [bot];
      match.gadgetEffects = [{
        id: `${type}-zone`,
        type,
        team: type === BIO_FIELD_ID ? 'blue' : undefined,
        x: 400,
        y: 340,
        radius: 70,
        startedAt: 0,
        expiresAt: 10_000,
        damagePerSecond: 50,
      }];

      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
      assert.equal(segmentCircleEntryTCoordinates(bot.x, bot.y, decision.waypoint.x, decision.waypoint.y,
        400, 340, 70 + 10), null, `${type} path is avoided when a short detour is available`);
    }

    const match = createMatch();
    const bot = createPlayer('smoke-ignoring-bot', 'red', 700, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    bot.botBrain.spawnExited = true;
    match.players = [bot];
    match.gadgetEffects = [{
      id: 'smoke-zone',
      type: 'smoke',
      x: 400,
      y: 340,
      radius: 70,
      startedAt: 0,
      expiresAt: 10_000,
    }];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(decision.waypoint.y, 340, 'smoke does not make bots take a movement detour');
  });

  it('uses Bio Field to support allies and routes through a friendly field', () => {
    const match = createMatch();
    const bot = createPlayer('bio-field-bot', 'red', 300, 340);
    Object.assign(bot, {
      botBrain: createBotBrain(bot.id, 0),
      selectedGadgetId: BIO_FIELD_ID,
      gadgetCount: 1,
      gadgetCounts: { [BIO_FIELD_ID]: 1 },
      equippedSlot: 'gadget',
    });

    const ally = createPlayer('bio-field-ally', 'red', 390, 340);
    match.players = [bot, ally];
    const gadgetDecision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(gadgetDecision.gadgetAction?.action, 'use');
    assert.ok(Math.hypot(gadgetDecision.gadgetAction.target.x - ally.x,
      gadgetDecision.gadgetAction.target.y - ally.y) <= GADGET_DEFINITIONS[BIO_FIELD_ID].throwRange);

    const runner = createPlayer('friendly-field-runner', 'red', 700, 340);
    runner.botBrain = createBotBrain(runner.id, 0);
    runner.botBrain.spawnExited = true;
    match.players = [runner];
    match.gadgetEffects = [{
      id: 'friendly-bio-field',
      type: BIO_FIELD_ID,
      team: 'red',
      x: 400,
      y: 340,
      radius: 70,
      startedAt: 0,
      expiresAt: 10_000,
    }];
    const routeDecision = decideBotAction(runner, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notEqual(segmentCircleEntryTCoordinates(
      runner.x, runner.y, routeDecision.waypoint.x, routeDecision.waypoint.y, 400, 340, 70 + 10,
    ), null, 'bots do not route around a friendly Bio Field');
  });

  it('routes around active Molotov zones even when the predicted damage is survivable', () => {
    const decideForHealth = (health) => {
      const match = createMatch();
      const bot = createPlayer(`fire-route-${health}`, 'red', 700, 340, health);
      bot.botBrain = createBotBrain(bot.id, 0);
      bot.botBrain.spawnExited = true;
      match.players = [bot];
      match.gadgetEffects = [{
        id: 'large-molotov',
        type: 'molotov',
        x: 400,
        y: 340,
        radius: 70,
        startedAt: 0,
        expiresAt: 1_200,
        damagePerSecond: 50,
      }];
      return { bot, decision: decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000) };
    };
    const healthy = decideForHealth(20);
    const vulnerable = decideForHealth(5);

    assert.equal(segmentCircleEntryTCoordinates(healthy.bot.x, healthy.bot.y, healthy.decision.waypoint.x,
      healthy.decision.waypoint.y, 400, 340, 70 + 10), null,
    'a healthy bot still avoids an active fire zone when a detour is available');
    assert.equal(segmentCircleEntryTCoordinates(vulnerable.bot.x, vulnerable.bot.y, vulnerable.decision.waypoint.x,
      vulnerable.decision.waypoint.y, 400, 340, 70 + 10), null,
    'a bot facing lethal fire damage prefers a safer detour');
  });

  it('immediately escapes a Molotov effect instead of continuing its objective route', () => {
    const match = createMatch();
    const bot = createPlayer('burning-bot', 'red', 400, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];
    match.gadgetEffects = [{
      id: 'direct-molotov',
      type: 'molotov',
      x: 400,
      y: 340,
      radius: 70,
      startedAt: 0,
      expiresAt: 8_000,
      damagePerSecond: 50,
    }];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.ok(Math.hypot(decision.waypoint.x - 400, decision.waypoint.y - 340) > 70 + 9);
    assert.equal(decision.thinkingTimeMs, 50, 'urgent fire avoidance is replanned immediately');

    Object.assign(bot, { x: decision.waypoint.x, y: decision.waypoint.y });
    const followup = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_050);
    assert.equal(segmentCircleEntryTCoordinates(bot.x, bot.y, followup.waypoint.x,
      followup.waypoint.y, 400, 340, 70 + 10), null,
    'after escaping, the bot does not immediately route back through the active fire');
  });

  it('reacts to an Orbital Strike warning after its configured reflex delay, then leaves the radius', () => {
    const match = createMatch();
    const bot = createPlayer('orbital-dodger', 'red', 400, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];
    match.pendingGadgetEffects = [{
      effect: {
        id: 'strike-warning', type: 'orbital-strike-warning',
        x: 400, y: 340, radius: 42, startedAt: 1_000, strikeAt: 2_000,
      },
      detonatesAt: 2_000,
    }];
    const parameters = { ...DEFAULT_BOT_PARAMETERS, reflexMs: 250 };

    const beforeReaction = decideBotAction(bot, match, parameters, 1_000);
    const duringReaction = decideBotAction(bot, match, parameters, 1_249);
    const afterReaction = decideBotAction(bot, match, parameters, 1_250);

    assert.ok(beforeReaction.thinkingTimeMs > 50);
    assert.ok(duringReaction.thinkingTimeMs > 50, 'the bot waits through its personal reaction delay');
    assert.equal(afterReaction.thinkingTimeMs, 50, 'the reacted warning triggers urgent replanning');
    assert.ok(Math.hypot(afterReaction.waypoint.x - 400, afterReaction.waypoint.y - 340) > 42 + 10 + 9,
      'the bot selects a waypoint outside the strike radius and its body clearance');
  });

  it('tracks a recently seen enemy after losing sight without firing at remembered positions', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340);
    const enemy = createPlayer('enemy', 'blue', 220, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const first = decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, reflexMs: 0 }, 0);
    bot.visionAngle = Math.PI;
    const lostSight = decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, reflexMs: 0 }, 100);

    assert.equal(first.enemyId, enemy.id);
    assert.equal(lostSight.enemyId, enemy.id);
    assert.equal(lostSight.fire, false, 'remembered locations never authorize a shot');
    assert.ok(lostSight.direction.x > 0, 'the bot keeps aiming toward the last known position');

    const expired = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_300);
    assert.equal(expired.enemyId, null, 'the short combat memory expires');
  });

  it('keeps Strike Team support lanes fixed relative to the route to the flag', () => {
    const match = createMatch();
    const bot = createPlayer('strike-support', 'red', 700, 340);
    const runner = createPlayer('human-runner', 'red', 130, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, runner];

    const first = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 0, { roleIndex: 1, roleCount: 2 });
    bot.x += 60;
    bot.y += 25;
    const second = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 50, { roleIndex: 1, roleCount: 2 });

    assert.equal(first.action, 'support');
    assert.equal(second.action, 'support');
    assert.deepEqual(second.target, first.target, 'the lane target must not orbit as the bot advances');
  });

  it('cannot acquire or fire at an enemy through active smoke and regains sight after it expires', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340);
    const enemy = createPlayer('enemy', 'blue', 220, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];
    match.smokes = [{
      id: 'smoke-wall', shape: 'circle', role: 'vision-smoke', x: 160, y: 340, radius: 30,
      blocksVision: true, blocksMovement: false, blocksProjectiles: false, expiresAt: 2_000,
    }];
    const parameters = { ...DEFAULT_BOT_PARAMETERS, reflexMs: 200, aggressiveness: 0.95, accuracy: 1 };

    const obscured = decideBotAction(bot, match, parameters, 1_000);
    assert.equal(obscured.enemyId, null);
    assert.equal(obscured.fire, false);

    const reacquired = decideBotAction(bot, match, parameters, 2_100);
    assert.equal(reacquired.enemyId, enemy.id);
    assert.equal(reacquired.fire, false, 'the bot still observes its configured reflex delay');
    const ready = decideBotAction(bot, match, parameters, 2_400);
    assert.equal(ready.fire, true, 'the bot may fire after the expired smoke reveals the target again');
  });

  it('keeps advancing the objective while engaging enemies that are not an immediate threat', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 300, 340);
    const enemy = createPlayer('enemy', 'blue', 650, 340);
    bot.selectedWeaponId = 'smg';
    bot.weaponStats.smg = { aimAngle: 0 };
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000);

    assert.equal(decision.action, 'capture');
    assert.equal(decision.enemyId, enemy.id);
    assert.ok(decision.target.x < bot.x, 'the bot continues toward the flag instead of chasing a distant target');
    assert.equal(decision.fire, true, 'objective movement does not prevent a safe ranged shot');
  });

  it('snaps vision to its aim target while advancing toward an objective', () => {
    const match = createMatch();
    const bot = createPlayer('route-facing-bot', 'red', 300, 340);
    const enemy = createPlayer('enemy-behind-route', 'blue', 650, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000);
    const routeX = decision.waypoint.x - bot.x;
    const routeY = decision.waypoint.y - bot.y;
    const facingAlongRoute = Math.cos(decision.input.visionAngle) * routeX +
      Math.sin(decision.input.visionAngle) * routeY;

    assert.equal(decision.action, 'capture');
    assert.ok(decision.direction.x > 0, 'weapon aim can still track the threat behind the route');
    const weaponTargetAngle = Math.atan2(decision.direction.y, decision.direction.x);
    assert.ok(Math.abs(angleDifference(decision.input.visionAngle, weaponTargetAngle)) < 1e-9,
      'the vision direction snaps to the same target as the weapon');
    assert.ok(facingAlongRoute < 0, 'vision follows the weapon target even when it is behind the route');
  });

  it('identifies and fires at visible targets throughout the selected weapon range', () => {
    const match = createMatch();
    match.map.width = 3_000;
    const bot = createPlayer('long-range-bot', 'blue', 100, 340);
    const enemy = createPlayer('distant-enemy', 'red', 1_850, 340);
    bot.selectedWeaponId = 'sniper';
    bot.inventoryWeaponIds = ['sniper'];
    bot.weaponStats.sniper = { aimAngle: 0, ammo: DEFAULT_PROJECTILE_DEFINITIONS.sniper.magazineSize };
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000);

    assert.equal(decision.enemyId, enemy.id,
      'enemy identification uses the sniper’s full configured sight range, not the former 1,600-unit cap');
    assert.equal(decision.fire, true, 'the bot returns fire at a visible, safe target at long range');
  });

  it('detects distant targets without firing beyond the selected weapon range', () => {
    const match = createMatch();
    match.map.width = 4_000;
    const bot = createPlayer('range-limited-bot', 'blue', 100, 340);
    const enemy = createPlayer('out-of-range-enemy', 'red', 2_600, 340);
    bot.selectedWeaponId = 'sniper';
    bot.inventoryWeaponIds = ['sniper'];
    bot.weaponStats.sniper = { aimAngle: 0, ammo: DEFAULT_PROJECTILE_DEFINITIONS.sniper.magazineSize };
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000);

    assert.equal(decision.enemyId, enemy.id, 'the target remains visible beyond weapon range');
    assert.equal(decision.fire, false, 'the bot does not shoot an unreachable target');
  });

  it('moves a shotgun bot to cover under distant fire while continuing to shoot', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'segment', x1: 160, y1: 270, x2: 160, y2: 320 }];
    const bot = createPlayer('shotgun-bot', 'red', 100, 340);
    const enemy = createPlayer('ranged-threat', 'blue', 650, 340);
    bot.selectedWeaponId = 'shotgun';
    bot.weaponStats.shotgun = {
      aimAngle: 0,
      ammo: DEFAULT_PROJECTILE_DEFINITIONS.shotgun.magazineSize,
      reloading: false,
    };
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000, { damageCue: { bearing: 0, expiresAt: 2_000 } });

    assert.equal(decision.action, 'damage-cover');
    assert.ok(Math.hypot(decision.target.x - bot.x, decision.target.y - bot.y) > 20,
      'the shotgun bot leaves its exposed position for nearby cover');
    assert.equal(isPointVisible(decision.target, {
      origin: enemy,
      angle: Math.atan2(decision.target.y - enemy.y, decision.target.x - enemy.x),
      halfAngle: Math.PI,
      maximumRange: 2_000,
    }, match.map.objects), false, 'the selected destination is occluded from the distant shooter');
    assert.equal(decision.enemyId, enemy.id, 'the bot keeps identifying the visible shooter while moving');
    assert.equal(decision.fire, true, 'seeking cover does not suppress a safe shot at the visible enemy');
  });

  it('restarts the reaction delay after losing and reacquiring an enemy', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340);
    const enemy = createPlayer('enemy', 'blue', 220, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];
    decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, reflexMs: 250, accuracy: 1 }, 0);

    match.players = [bot];
    decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    match.players = [bot, enemy];
    const reacquired = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 250,
      accuracy: 1,
    }, 1_200);

    assert.equal(reacquired.fire, false, 'a reacquired enemy gets a fresh reaction window');
  });

  it('retreats from nearby threats when critically hurt', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340, 18);
    const enemy = createPlayer('enemy', 'blue', 220, 340);
    const backup = [
      createPlayer('red-ally-a', 'red', 700, 100),
      createPlayer('red-ally-b', 'red', 700, 300),
      createPlayer('red-ally-c', 'red', 700, 600),
    ];
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, ...backup, enemy];
    const action = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      retreatHealth: 40,
      aggressiveness: 0.6,
    }, 1_000);
    assert.equal(action.action, 'retreat');
    assert.ok(action.target.x < bot.x, 'the bot creates distance from its attacker');
  });

  it('keeps small Strike Teams pushing the objective when low-health and outnumbered', () => {
    for (const survivorCount of [1, 2, 3]) {
      const match = createMatch();
      const bot = createPlayer(`red-survivor-${survivorCount}`, 'red', 300, 340, 18);
      bot.botBrain = createBotBrain(bot.id, 0);
      const teammates = [bot];
      for (let index = 1; index < survivorCount; index += 1) {
        teammates.push(createPlayer(`red-ally-${survivorCount}-${index}`, 'red', 650 + index * 40, 600));
      }
      const enemies = [
        createPlayer(`blue-threat-a-${survivorCount}`, 'blue', 400, 340),
        createPlayer(`blue-threat-b-${survivorCount}`, 'blue', 430, 360),
      ];
      match.players = [...teammates, ...enemies];

      const decision = decideBotAction(bot, match, {
        ...DEFAULT_BOT_PARAMETERS,
        aggressiveness: 0.4,
        retreatHealth: 40,
        reflexMs: 0,
      }, 1_000);

      assert.equal(decision.action, 'fight', `${survivorCount} Strike Team survivors should fight without abandoning the push`);
      assert.deepEqual(decision.target, { x: match.flag.x, y: match.flag.y },
        `${survivorCount} Strike Team survivors should retain the flag as their movement target`);
      assert.equal(decision.input.left, true, 'the Strike Team bot keeps moving toward the objective');
    }
  });

  it('plays asymmetric objectives and uses shot sounds as uncertain tactical leads', () => {
    const match = createMatch();
    const attacker = createPlayer('bot-red', 'red', 300, 340);
    attacker.botBrain = createBotBrain(attacker.id, 0);
    match.players = [attacker];
    assert.equal(decideBotAction(attacker, match, DEFAULT_BOT_PARAMETERS, 1_000).action, 'capture');

    const defender = createPlayer('bot-blue', 'blue', 250, 340);
    defender.botBrain = createBotBrain(defender.id, 0);
    match.players = [defender];
    match.botNoises.push({ team: 'blue', x: 280, y: 340, radius: 80, expiresAt: 5_000 });
    const response = decideBotAction(defender, match, {
      ...DEFAULT_BOT_PARAMETERS,
      aggressiveness: 1,
      defenseFocus: 0.2,
      thinkingComplexity: 5,
    }, 1_000);
    assert.equal(response.action, 'investigate-audio');
    assert.equal(response.target.x, 280);
  });

  it('prioritizes an audible footstep even for a low-complexity bot without identifying a shooter', () => {
    const match = createMatch();
    const bot = createPlayer('footstep-listener', 'blue', 250, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];
    match.botNoises.push({
      id: 'footstep-cue',
      kind: 'footstep',
      team: 'blue',
      x: 700,
      y: 340,
      radius: 80,
      expiresAt: 5_000,
    });

    const response = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      thinkingComplexity: 1,
    }, 1_000);

    assert.equal(response.action, 'investigate-audio');
    assert.equal(response.enemyId, null, 'a footstep gives a location lead, not an enemy identity');
    assert.equal(response.fire, false, 'the bot does not shoot at an audio cue');
    assert.ok(response.target.x > bot.x && response.target.x < 700,
      'the bot moves toward the sound while respecting its defensive boundary');
  });

  it('uses only visible enemies and tolerates map layouts without navigation data', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340);
    const hiddenEnemy = createPlayer('hidden-enemy', 'blue', 200, 600);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, hiddenEnemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notEqual(decision.enemyId, hiddenEnemy.id);
    assert.equal(bot.botBrain.rememberedEnemies[hiddenEnemy.id], undefined);
  });

  it('uses the current vision for perception but snaps vision output to its weapon target', () => {
    const match = createMatch();
    const bot = createPlayer('fast-vision-bot', 'red', 100, 340);
    const enemy = createPlayer('east-enemy', 'blue', 220, 340);
    bot.visionAngle = 0;
    bot.weaponStats['assault-rifle'].aimAngle = Math.PI / 2;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.enemyId, enemy.id, 'perception follows the cone, not the slower weapon aim');
    const weaponTargetAngle = Math.atan2(decision.direction.y, decision.direction.x);
    assert.ok(Math.abs(angleDifference(decision.input.visionAngle, weaponTargetAngle)) < 1e-9,
      'vision snaps to the target direction while the weapon is still turning');
    assert.equal(bot.weaponStats['assault-rifle'].aimAngle, Math.PI / 2,
      'the vision update does not instantly rotate the weapon');
  });

  it('sweeps its vision around the full area while moving between objectives', () => {
    const match = createMatch();
    const bot = createPlayer('scanning-bot', 'red', 300, 350);
    const enemy = createPlayer('enemy-behind-objective', 'blue', 300, 180);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.flag = { x: 900, y: 350, heldBy: null, dropped: false };
    match.players = [bot, enemy];

    let acquired = false;
    for (let now = 0; now <= 10_000; now += 50) {
      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, now);
      const weaponTargetAngle = Math.atan2(decision.direction.y, decision.direction.x);
      assert.ok(Math.abs(angleDifference(decision.input.visionAngle, weaponTargetAngle)) < 1e-9,
        'vision scans with the weapon target direction');
      bot.visionAngle = decision.input.visionAngle;
      if (decision.enemyId === enemy.id) {
        acquired = true;
        break;
      }
    }

    assert.equal(acquired, true, 'an enemy outside the route-facing cone is found by the scan sweep');
  });

  it('keeps bot scan headings inside the server-accepted vision-angle range', () => {
    const match = createMatch();
    const bot = createPlayer('left-looking-bot', 'red', 300, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    for (let now = 0; now <= 60_000; now += 50) {
      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, now);
      assert.ok(Number.isFinite(decision.input.visionAngle));
      assert.ok(decision.input.visionAngle >= -Math.PI && decision.input.visionAngle <= Math.PI,
        `vision angle ${decision.input.visionAngle} at ${now} ms must pass server input validation`);
    }
  });

  it('reacts to a damage bearing without revealing or targeting an unseen attacker', () => {
    const match = createMatch();
    const bot = createPlayer('damaged-bot', 'red', 100, 340);
    const unseenEnemy = createPlayer('unseen-attacker', 'blue', 100, 520);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, unseenEnemy];
    const cue = { bearing: Math.PI / 2, expiresAt: 2_000 };

    const response = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, { damageCue: cue });

    assert.equal(response.action, 'investigate-damage');
    assert.equal(response.enemyId, null, 'the cue does not identify an unseen shooter');
    assert.equal(bot.botBrain.rememberedEnemies[unseenEnemy.id], undefined);
    assert.ok(response.direction.y > 0.9, 'the bot faces the direction the shot came from');
    assert.ok(response.target.y < bot.y, 'the bot dodges away while keeping its aim on the incoming bearing');

    const expired = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 2_100, { damageCue: cue });
    assert.notEqual(expired.action, 'investigate-damage');
  });

  it('repositions under ranged fire instead of standing still outside its normal engagement range', () => {
    const match = createMatch();
    const bot = createPlayer('damaged-bot', 'red', 100, 340);
    const distantShooter = createPlayer('distant-shooter', 'blue', 650, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, distantShooter];

    const response = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, {
      damageCue: { bearing: 0, expiresAt: 2_000 },
    });

    assert.equal(response.action, 'investigate-damage');
    assert.equal(response.enemyId, distantShooter.id, 'the bot still targets the visible shooter');
    assert.ok(response.direction.x > 0.9, 'the bot keeps aiming at the visible shooter');
    assert.ok(response.target.x < bot.x, 'the bot moves away from the shooter when no cover is available');
  });

  it('sends two bots to defend an ally threatened by a shared enemy sighting', () => {
    const match = createMatch();
    const firstBot = createPlayer('red-responder-1', 'red', 100, 340);
    const secondBot = createPlayer('red-responder-2', 'red', 190, 340);
    const enemy = createPlayer('shared-threat', 'blue', 300, 340);
    for (const bot of [firstBot, secondBot]) {
      bot.isBot = true;
      bot.visionAngle = Math.PI;
      bot.weaponStats['assault-rifle'].aimAngle = Math.PI;
      bot.botBrain = createBotBrain(bot.id, 0);
    }
    match.players = [firstBot, secondBot, enemy];
    const teamIntel = { sightings: [{
      team: 'red',
      enemyId: enemy.id,
      x: enemy.x,
      y: enemy.y,
      observedAt: 1_000,
      expiresAt: 7_000,
    }] };
    const role = { teamIntel, roleCount: 2 };

    const firstResponse = decideBotAction(firstBot, match, DEFAULT_BOT_PARAMETERS, 1_000,
      { ...role, roleIndex: 0 });
    const secondResponse = decideBotAction(secondBot, match, DEFAULT_BOT_PARAMETERS, 1_000,
      { ...role, roleIndex: 1 });

    assert.equal(firstResponse.action, 'respond-team-threat');
    assert.equal(secondResponse.action, 'respond-team-threat');
    assert.equal(firstResponse.enemyId, null, 'shared intel does not expose an unseen enemy as a direct target');
    assert.equal(firstResponse.fire, false, 'bots do not fire based only on a teammate report');
    assert.equal(secondResponse.fire, false);
    assert.ok(Math.hypot(firstResponse.target.x - enemy.x, firstResponse.target.y - enemy.y) <= 120);
  });

  it('chases a distant fresh team sighting without firing at the unseen enemy', () => {
    const match = createMatch();
    const bot = createPlayer('intel-chaser', 'red', 100, 340);
    const enemy = createPlayer('distant-reported-enemy', 'blue', 900, 340);
    bot.visionAngle = Math.PI;
    bot.weaponStats['assault-rifle'].aimAngle = Math.PI;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, {
      teamIntel: { sightings: [{
        team: 'red',
        enemyId: enemy.id,
        x: enemy.x,
        y: enemy.y,
        observedAt: 1_000,
        expiresAt: 7_000,
      }] },
    });

    assert.equal(decision.action, 'investigate-team-sighting');
    assert.deepEqual(decision.target, { x: enemy.x, y: enemy.y });
    assert.equal(decision.enemyId, null);
    assert.equal(decision.fire, false);
    assert.ok(decision.input.visionAngle < 0.1 || decision.input.visionAngle > Math.PI * 2 - 0.1,
      'the bot keeps looking toward the last known enemy position');
  });

  it('returns Red to the flag objective after a brief intel investigation', () => {
    const match = createMatch();
    const bot = createPlayer('red-investigator', 'red', 300, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];
    const parameters = { ...DEFAULT_BOT_PARAMETERS, thinkingComplexity: 3 };
    const teamContext = { teamIntel: { audioCues: [
      { team: 'red', x: 350, y: 340, radius: 100, expiresAt: 10_000 },
    ] } };

    const investigation = decideBotAction(bot, match, parameters, 1_000, teamContext);
    const recovered = decideBotAction(bot, match, parameters, 2_500, teamContext);
    const staysFocused = decideBotAction(bot, match, parameters, 3_000, teamContext);

    assert.equal(investigation.action, 'investigate-audio');
    assert.equal(recovered.action, 'capture', 'the detour is time-limited');
    assert.deepEqual(recovered.target, { x: match.flag.x, y: match.flag.y });
    assert.equal(staysFocused.action, 'capture', 'persistent intel cannot immediately pull Red away again');
  });

  it('scouts an unexplored sector instead of duplicating active teammate or camera coverage', () => {
    const buildSearchPlan = (teamIntel = undefined) => {
      const match = createMatch();
      match.flag = { x: 400, y: 350, heldBy: 'hidden-carrier', dropped: false };
      const bot = createPlayer('sector-scout', 'red', 300, 340);
      bot.visionAngle = Math.PI;
      bot.weaponStats['assault-rifle'].aimAngle = Math.PI;
      bot.botBrain = createBotBrain(bot.id, 0);
      match.players = [bot, createPlayer('hidden-carrier', 'blue', 900, 600)];
      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, {
        teamIntel,
        roleIndex: 0,
        roleCount: 1,
      });
      return { bot, decision };
    };
    const baseline = buildSearchPlan();
    const baselineTarget = baseline.decision.target;
    const source = {
      origin: { x: 400, y: 350 },
      angle: Math.atan2(baselineTarget.y - 350, baselineTarget.x - 400),
      halfAngle: 0.025,
      maximumRange: Infinity,
      xray: true,
    };
    const covered = buildSearchPlan({ visionSources: [source] });

    assert.equal(baseline.decision.action, 'search-flag');
    assert.equal(covered.decision.action, 'search-flag');
    assert.notDeepEqual(covered.decision.target, baselineTarget);
    assert.equal(isPointVisible(covered.decision.target, source, []), false,
      'the scouting target leaves the sector currently covered by pooled vision');
  });

  it('moves to a nearby corridor entrance and watches a pooled audio lead', () => {
    const match = createMatch();
    const bot = createPlayer('entrance-watcher', 'red', 300, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];
    match.map.corridors = [{
      id: 'reported-entrance',
      points: [{ x: 500, y: 340 }, { x: 560, y: 340 }],
    }];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, {
      teamIntel: { audioCues: [{
        team: 'red',
        x: 600,
        y: 340,
        radius: 100,
        expiresAt: 5_000,
      }] },
    });

    assert.equal(decision.action, 'watch-entrance');
    assert.deepEqual(decision.target, { x: 500, y: 340 });
    assert.equal(decision.enemyId, null);
    assert.equal(decision.fire, false);
    assert.ok(decision.input.visionAngle < 0.1 || decision.input.visionAngle > Math.PI * 2 - 0.1,
      'the bot watches the reported sound source from the entrance');
  });

  it('assigns the closest Red teammate to the flag and spreads supporting teammates apart', () => {
    const match = createMatch();
    const runner = createPlayer('bot-runner', 'red', 230, 340);
    const support = createPlayer('bot-support', 'red', 250, 340);
    runner.isBot = true;
    support.isBot = true;
    runner.botBrain = createBotBrain(runner.id, 0);
    support.botBrain = createBotBrain(support.id, 0);
    match.players = [runner, support];

    const runnerPlan = decideBotAction(runner, match, DEFAULT_BOT_PARAMETERS, 1_000);
    const supportPlan = decideBotAction(support, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 1, roleCount: 2 });
    assert.equal(runnerPlan.action, 'capture');
    assert.equal(supportPlan.action, 'support');
    assert.ok(supportPlan.target.x < support.x, 'support joins the push toward the enemy capture site instead of circling around the flag');
    assert.ok(Math.hypot(runnerPlan.target.x - supportPlan.target.x, runnerPlan.target.y - supportPlan.target.y) > 30);

    Object.assign(runner, { x: 600, y: 340 });
    Object.assign(support, { x: 200, y: 340 });
    assert.equal(decideBotAction(runner, match, DEFAULT_BOT_PARAMETERS, 1_050).action, 'capture',
      'the selected runner does not lose its objective role when a teammate briefly becomes closer');
    assert.equal(decideBotAction(support, match, DEFAULT_BOT_PARAMETERS, 1_050,
      { roleIndex: 1, roleCount: 2 }).action, 'support',
    'support does not oscillate between escorting and capturing as players move');
  });

  it("varies Strike Team support lanes with each bot's tactical parameters", () => {
    const match = createMatch();
    const runner = createPlayer('red-runner', 'red', 210, 340);
    const support = createPlayer('red-support', 'red', 300, 340);
    runner.isBot = true;
    support.isBot = true;
    runner.botBrain = createBotBrain(runner.id, 0);
    support.botBrain = createBotBrain(support.id, 0);
    match.players = [runner, support];
    const role = { roleIndex: 2, roleCount: 3 };

    const direct = decideBotAction(support, match, {
    ...DEFAULT_BOT_PARAMETERS,
    aggressiveness: 1,
    objectiveFocus: 1,
    }, 1_000, role);
    const flanking = decideBotAction(support, match, {
    ...DEFAULT_BOT_PARAMETERS,
    aggressiveness: 0,
    objectiveFocus: 0,
    }, 1_000, role);

    assert.equal(direct.action, 'support');
    assert.equal(flanking.action, 'support');
    assert.ok(Math.abs(flanking.target.y - match.flag.y) > Math.abs(direct.target.y - match.flag.y),
    'less objective-focused bots take a wider flank');
    assert.ok(direct.target.x < flanking.target.x,
    'more aggressive bots stage closer to the flag site');
  });

  it('does not let a remembered enemy distract Red support from the flag push', () => {
    const match = createMatch();
    const runner = createPlayer('red-runner', 'red', 230, 340);
    const support = createPlayer('red-support', 'red', 250, 340);
    runner.botBrain = createBotBrain(runner.id, 0);
    support.botBrain = createBotBrain(support.id, 0);
    support.botBrain.rememberedEnemies['remembered-blue'] = { x: 270, y: 340, seenAt: 900, firstSeenAt: 900 };
    match.players = [runner, support];

    const decision = decideBotAction(support, match, {
      ...DEFAULT_BOT_PARAMETERS,
      aggressiveness: 0.8,
      thinkingComplexity: 4,
    }, 1_000, { roleIndex: 1, roleCount: 2 });

    assert.equal(decision.action, 'support');
    assert.ok(decision.target.x < support.x, 'support continues forward with the runner instead of hunting stale contact');
  });

  it('sends Red directly toward the Blue flag from its spawn', () => {
    const match = createMatch();
    match.map.spawnZones.red = { x: 40, y: 270, width: 140, height: 140 };
    match.flag = { x: 890, y: 340, heldBy: null, dropped: false };
    match.flag = { x: 890, y: 340, heldBy: null, dropped: false };
    match.map.rooms = [
      { id: 'red-spawn', isSpawn: true, team: 'red', x: 110, y: 340, width: 140, height: 140 },
      { id: 'room-1', isSpawn: false, x: 390, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [{
      id: 'red-door', a: 'red-spawn', b: 'room-1',
      points: [{ x: 180, y: 340 }, { x: 223, y: 340 }, { x: 320, y: 340 }],
    }];
    const runner = createPlayer('red-runner', 'red', 110, 340);
    runner.isBot = true;
    runner.botBrain = createBotBrain(runner.id, 0);
    match.players = [runner];

    const opening = decideBotAction(runner, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(opening.action, 'leave-spawn');
    assert.ok(opening.target.x > runner.x && opening.target.x < match.flag.x,
      'Red takes the outward doorway waypoint toward its Blue-site objective');
    assert.ok(opening.waypoint.x > runner.x, 'navigation starts through the doorway toward the objective');

    Object.assign(runner, { x: 245, y: 340 });
    const push = decideBotAction(runner, match, DEFAULT_BOT_PARAMETERS, 2_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(push.action, 'capture');
    assert.ok(push.target.x > runner.x, 'after exiting, the runner continues toward the Blue flag');
  });

  it('keeps Strike Team spawn movement committed to the exit while reacting to damage', () => {
    const match = createMatch();
    match.map.spawnZones.red = { x: 40, y: 270, width: 140, height: 140 };
    match.map.rooms = [
      { id: 'red-spawn', isSpawn: true, team: 'red', x: 110, y: 340, width: 140, height: 140 },
    ];
    const bot = createPlayer('red-under-fire', 'red', 110, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    const response = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, {
      damageCue: { bearing: Math.PI / 2, expiresAt: 2_000 },
      teamIntel: { audioCues: [{ team: 'red', x: 130, y: 350, radius: 90, expiresAt: 2_000 }] },
    });

    assert.equal(response.action, 'leave-spawn');
    assert.ok(response.target.x > bot.x, 'damage response cannot turn the bot back into spawn');
    assert.ok(response.direction.y > 0.9, 'the bot still turns toward the incoming damage');
  });

  it('navigates a generated multi-room route out of spawn and to the objective', () => {
    const map = generateMap(42);
    const red = map.spawnZones.red;
    const blue = map.spawnZones.blue;
    const bot = createPlayer('route-runner', 'red', red.x + red.width / 2, red.y + red.height / 2);
    bot.vx = 0;
    bot.vy = 0;
    bot.isBot = true;
    bot.botBrain = createBotBrain(bot.id, 0);
    const flag = { x: blue.x + blue.width / 2, y: blue.y + blue.height / 2, heldBy: null, dropped: false };
    const match = { map, flag, players: [bot], botNoises: [], gameplayStartsAt: 0, endsAt: 180_000 };
    const initialDistance = Math.hypot(bot.x - flag.x, bot.y - flag.y);

    for (let tick = 1; tick <= 1_400; tick += 1) {
      const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, tick * 50, { roleIndex: 0, roleCount: 1 });
      Object.assign(bot, movePosition(bot, decision.input, 0.05, map.width, map.height, map.objects, 0.9));
    }

    assert.equal(bot.botBrain.spawnExited, true);
    assert.ok(Math.hypot(bot.x - flag.x, bot.y - flag.y) < 50,
      `bot should reach the flag after leaving spawn (started ${Math.round(initialDistance)} units away)`);
  });

  it('drops a reached local route waypoint before following the next graph waypoint', () => {
    const match = createMatch();
    match.map.rooms = [
      { id: 'red-spawn', isSpawn: true, team: 'red', x: 110, y: 340, width: 140, height: 140 },
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 890, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [{
      id: 'main-route',
      a: 'red-spawn',
      b: 'blue-spawn',
      points: [{ x: 180, y: 340 }, { x: 820, y: 340 }],
    }];
    match.flag = { x: 900, y: 340, heldBy: null, dropped: false };
    const bot = createPlayer('route-handoff', 'red', 500, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    bot.botBrain.graphGoalRoom = 'blue-spawn';
    bot.botBrain.graphRoute = [{ x: 820, y: 340 }, { x: 900, y: 340 }];
    bot.botBrain.graphRouteIndex = 0;
    bot.botBrain.routeWaypoint = { x: 480, y: 340 };
    bot.botBrain.routeGoal = { ...match.flag };
    match.players = [bot];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.deepEqual(decision.waypoint, { x: 820, y: 340 });
    assert.equal(bot.botBrain.routeWaypoint, null);
    assert.equal(bot.botBrain.routeGoal, null);
  });

  it('replans a cached local route when its leg becomes blocked by unchanged map geometry', () => {
    const match = createMatch();
    const wall = { shape: 'rect', x: 450, y: 340, width: 50, height: 300 };
    match.map.objects = [wall];
    match.flag = { x: 900, y: 340, heldBy: null, dropped: false };
    const bot = createPlayer('route-replanner', 'red', 300, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    const initial = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.ok(bot.botBrain.routeWaypoint, 'the initial plan caches a local bypass');

    Object.assign(bot, { x: 420, y: 270 });
    const replanned = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_100);

    assert.notDeepEqual(replanned.waypoint, initial.waypoint,
      'the cached leg is discarded when the bot moves to a position where the same wall blocks it');
  });

  it('gets a full Strike Team out of spawn and moving toward the flag', () => {
    const spawnOffsets = [
      { x: 0, y: -60 }, { x: 55, y: -30 }, { x: 0, y: 0 }, { x: 55, y: 30 }, { x: 0, y: 60 },
    ];
    for (const seed of [1, 42, 9876]) {
      const map = generateMap(seed);
      const redRoom = map.rooms.find((room) => room.isSpawn && room.team === 'red');
      const redZone = map.spawnZones.red;
      const blueZone = map.spawnZones.blue;
      const flag = { x: blueZone.x + blueZone.width / 2, y: blueZone.y + blueZone.height / 2,
        heldBy: null, dropped: false };
      const bots = spawnOffsets.map((offset, index) => {
        const bot = createPlayer(`strike-${seed}-${index}`, 'red',
          redRoom.x + offset.x, redRoom.y + offset.y);
        bot.isBot = true;
        bot.botBrain = createBotBrain(bot.id, 0);
        return bot;
      });
      const match = { map, flag, players: bots, botNoises: [], gameplayStartsAt: 0, endsAt: 180_000 };
      const startingDistances = new Map(bots.map((bot) => [bot.id, Math.hypot(bot.x - flag.x, bot.y - flag.y)]));

      for (let tick = 1; tick <= 400; tick += 1) {
        for (let index = 0; index < bots.length; index += 1) {
          const bot = bots[index];
          const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, tick * 50,
            { roleIndex: index, roleCount: bots.length });
          Object.assign(bot, movePosition(bot, decision.input, 0.05, map.width, map.height, map.objects, 0.9));
        }
      }

      for (const bot of bots) {
        assert.equal(bot.botBrain.spawnExited, true,
          `${bot.id} should leave the Strike Team spawn on generated map ${seed}`);
        assert.ok(bot.x > redZone.x + redZone.width || bot.x < redZone.x ||
          bot.y > redZone.y + redZone.height || bot.y < redZone.y,
          `${bot.id} should be outside the spawn zone on map ${seed}`);
        assert.ok(Math.hypot(bot.x - flag.x, bot.y - flag.y) < startingDistances.get(bot.id) - 30,
          `${bot.id} should continue toward the flag after clearing spawn on map ${seed}`);
      }
    }
  });

  it('keeps a full Strike Team progressing through a generated route', () => {
    const map = generateMap(42);
    const redRoom = map.rooms.find((room) => room.isSpawn && room.team === 'red');
    const blueZone = map.spawnZones.blue;
    const flag = { x: blueZone.x + blueZone.width / 2, y: blueZone.y + blueZone.height / 2,
      heldBy: null, dropped: false };
    const spawnOffsets = [
      { x: 0, y: -60 }, { x: 55, y: -30 }, { x: 0, y: 0 }, { x: 55, y: 30 }, { x: 0, y: 60 },
    ];
    const bots = spawnOffsets.map((offset, index) => {
      const bot = createPlayer(`route-strike-${index}`, 'red',
        redRoom.x + offset.x, redRoom.y + offset.y);
      bot.isBot = true;
      bot.botBrain = createBotBrain(bot.id, 0);
      return bot;
    });
    const match = { map, flag, players: bots, botNoises: [], gameplayStartsAt: 0, endsAt: 180_000 };
    const startingDistances = new Map(bots.map((bot) => [bot.id, Math.hypot(bot.x - flag.x, bot.y - flag.y)]));

    for (let tick = 1; tick <= 1_200; tick += 1) {
      for (let index = 0; index < bots.length; index += 1) {
        const bot = bots[index];
        const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, tick * 50,
          { roleIndex: index, roleCount: bots.length });
        Object.assign(bot, movePosition(bot, decision.input, 0.05, map.width, map.height, map.objects, 0.9));
      }
    }

    for (const bot of bots) {
      const distanceToFlag = Math.hypot(bot.x - flag.x, bot.y - flag.y);
      assert.ok(distanceToFlag < startingDistances.get(bot.id) - 400,
        `${bot.id} should make sustained progress toward the flag`);
      assert.ok(bot.botBrain.stuckCount < 10,
        `${bot.id} should not repeatedly cycle between local and graph waypoints`);
    }
  });

  it('lets Blue engage a threat at range and fall back into site only when pressed close', () => {
    const match = createMatch();
    match.map.spawnZones.blue = { x: 820, y: 270, width: 140, height: 140 };
    match.map.rooms = [
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 890, y: 340, width: 140, height: 140 },
      { id: 'room-1', isSpawn: false, team: null, x: 600, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [{
      id: 'blue-door', a: 'room-1', b: 'blue-spawn',
      points: [{ x: 670, y: 340 }, { x: 820, y: 340 }, { x: 842, y: 340 }],
    }];
    const defender = createPlayer('blue-defender', 'blue', 870, 340);
    const visibleRed = createPlayer('visible-red', 'red', 650, 340);
    defender.botBrain = createBotBrain(defender.id, 0);
    visibleRed.botBrain = createBotBrain(visibleRed.id, 0);
    defender.visionAngle = Math.PI;
    defender.weaponStats['assault-rifle'].aimAngle = Math.PI;
    match.players = [defender, visibleRed];

    const distant = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(distant.action, 'fight', 'Blue engages an enemy approaching the site');

    visibleRed.x = 850;
    defender.visionAngle = Math.PI;
    defender.weaponStats['assault-rifle'].aimAngle = Math.PI;
    defender.x = 890;
    const pressed = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 2_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(pressed.action, 'fall-back');
    assert.ok(pressed.target.x > defender.x, 'Blue retreats inward, away from the enemy approaching from the west');
  });

  it('keeps Blue defenders from chasing a distant firefight away from their flag site', () => {
    const match = createMatch();
    match.map.spawnZones.blue = { x: 820, y: 270, width: 140, height: 140 };
    const defender = createPlayer('blue-site-guard', 'blue', 790, 340);
    const redThreat = createPlayer('red-firefight', 'red', 500, 340);
    defender.botBrain = createBotBrain(defender.id, 0);
    defender.visionAngle = Math.PI;
    defender.weaponStats['assault-rifle'].aimAngle = Math.PI;
    match.players = [defender, redThreat];

    const decision = decideBotAction(defender, match, {
      ...DEFAULT_BOT_PARAMETERS,
      defenseFocus: 1,
    }, 1_000, { roleIndex: 0, roleCount: 1 });

    const site = { x: 890, y: 340 };
    assert.equal(decision.action, 'fight');
    assert.ok(Math.hypot(decision.target.x - site.x, decision.target.y - site.y) <= 250,
      'combat movement remains inside the site leash even when the defender engages');
  });

  it('sends Blue after its stolen flag carrier beyond the site-defense leash', () => {
    const match = createMatch();
    const defender = createPlayer('blue-defender', 'blue', 110, 340);
    const carrier = createPlayer('red-carrier', 'red', 460, 340);
    defender.botBrain = createBotBrain(defender.id, 0, () => 0);
    carrier.botBrain = createBotBrain(carrier.id, 0);
    match.flag.heldBy = carrier.id;
    defender.visionAngle = 0;
    defender.weaponStats['assault-rifle'].aimAngle = 0;
    match.players = [defender, carrier];

    const pursuit = decideBotAction(defender, match, {
      ...DEFAULT_BOT_PARAMETERS,
      defenseFocus: 1,
    }, 1_000);

    assert.equal(pursuit.action, 'fight');
    assert.equal(pursuit.enemyId, carrier.id, 'the stolen-flag carrier takes combat priority');
    assert.ok(pursuit.target.x > 410,
      'the defender pursues the carrier instead of stopping at the 300-unit site leash');
    assert.ok(pursuit.input.right, 'the defender moves out from the site toward the carrier');
  });

  it('sends Blue after a stolen flag carrier known through shared intel', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'segment', x1: 400, y1: 270, x2: 400, y2: 410 }];
    const defender = createPlayer('blue-defender', 'blue', 110, 340);
    const carrier = createPlayer('red-carrier', 'red', 800, 340);
    defender.botBrain = createBotBrain(defender.id, 0, () => 0);
    match.flag.heldBy = carrier.id;
    match.players = [defender, carrier];

    const pursuit = decideBotAction(defender, match, {
      ...DEFAULT_BOT_PARAMETERS,
      defenseFocus: 1,
    }, 1_000, {
      teamIntel: {
        sightings: [{
          team: 'blue',
          enemyId: carrier.id,
          x: carrier.x,
          y: carrier.y,
          observedAt: 900,
          expiresAt: 6_000,
        }],
      },
    });

    assert.equal(pursuit.action, 'hunt-carrier');
    assert.equal(pursuit.enemyId, null, 'shared intel guides pursuit but does not enable firing through walls');
    assert.ok(pursuit.target.x > 410,
      'the defender follows the shared carrier sighting beyond the site-defense leash');
  });

  it('keeps Blue at its strike site when the stolen flag carrier is completely unknown', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'segment', x1: 400, y1: 270, x2: 400, y2: 410 }];
    const defender = createPlayer('blue-defender', 'blue', 110, 340);
    const carrier = createPlayer('red-carrier', 'red', 800, 340);
    defender.botBrain = createBotBrain(defender.id, 0, () => 0);
    match.flag.heldBy = carrier.id;
    match.players = [defender, carrier];

    const defense = decideBotAction(defender, match, {
      ...DEFAULT_BOT_PARAMETERS,
      defenseFocus: 1,
    }, 1_000, { teamIntel: { sightings: [] } });

    assert.equal(defense.action, 'hold-site');
    assert.ok(Math.hypot(defense.target.x - 110, defense.target.y - 340) <= 300,
      'the defender guards the strike site instead of moving toward an unknown carrier');
  });

  it('moves behind nearby cover while reloading under a visible threat', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'segment', x1: 120, y1: 280, x2: 180, y2: 280 }];
    const bot = createPlayer('reloading-bot', 'red', 100, 340);
    const enemy = createPlayer('reload-threat', 'blue', 220, 340);
    bot.weaponStats['assault-rifle'].ammo = 0;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, { ...DEFAULT_BOT_PARAMETERS, reflexMs: 0 }, 1_000);

    assert.equal(decision.reload, true);
    assert.equal(decision.action, 'reload-cover');
    assert.ok(Math.hypot(decision.target.x - bot.x, decision.target.y - bot.y) > 20,
      'the bot moves toward the reachable side of the wall while reloading');
    assert.equal(isPointVisible(decision.target, {
      origin: enemy,
      angle: Math.atan2(decision.target.y - enemy.y, decision.target.x - enemy.x),
      halfAngle: Math.PI,
      maximumRange: 2_000,
    }, match.map.objects), false, 'the selected refuge is genuinely occluded from the threat');
  });

  it('moves Blue defenders onto their assigned ingress route and watches outward', () => {
    const match = createMatch();
    match.map.spawnZones.blue = { x: 820, y: 270, width: 140, height: 140 };
    match.map.rooms = [
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 890, y: 340, width: 140, height: 140 },
      { id: 'room-1', isSpawn: false, x: 600, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [{
      id: 'blue-door', a: 'room-1', b: 'blue-spawn',
      points: [{ x: 670, y: 340 }, { x: 777, y: 340 }, { x: 820, y: 340 }],
    }];
    const defender = createPlayer('blue-post', 'blue', 500, 340);
    defender.botBrain = createBotBrain(defender.id, 0);
    match.players = [defender];

    const decision = decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 1 });

    assert.equal(decision.action, 'hold-site');
    assert.ok(decision.target.x < 820,
      'the defender leaves the site to cover the corridor leading into it');
    assert.ok(defender.botBrain.defenseWatchTarget.x < 820,
      'the defender watches outward into the incoming corridor');
  });

  it('spreads Blue guards along a shared ingress instead of stacking them together', () => {
    const match = createMatch();
    match.map.spawnZones.blue = { x: 820, y: 270, width: 140, height: 140 };
    match.map.rooms = [
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 890, y: 340, width: 140, height: 140 },
      { id: 'room-1', isSpawn: false, team: null, x: 450, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [{
      id: 'blue-door', a: 'blue-spawn', b: 'room-1',
      points: [{ x: 820, y: 340 }, { x: 700, y: 340 }, { x: 550, y: 340 }, { x: 400, y: 340 }],
    }];
    const defenders = Array.from({ length: 5 }, (_, index) => {
      const defender = createPlayer(`blue-guard-${index}`, 'blue', 870, 300 + index * 15);
      defender.botBrain = createBotBrain(defender.id, 0);
      return defender;
    });
    match.players = defenders;

    const plans = defenders.map((defender, roleIndex) =>
      decideBotAction(defender, match, DEFAULT_BOT_PARAMETERS, 1_000, {
        roleIndex,
        roleCount: defenders.length,
      }));

    assert.ok(plans.every((plan) => plan.action === 'hold-site'));
    for (let index = 1; index < plans.length; index += 1) {
      assert.ok(Math.hypot(
        plans[index].target.x - plans[index - 1].target.x,
        plans[index].target.y - plans[index - 1].target.y,
      ) >= 34, 'each guard receives a distinct position along the same ingress route');
    }
  });

  it('weights a bot baseline loadout and keeps that weapon for the whole match', () => {
    const match = createMatch();
    const counts = {};
    let randomDraw = 0;
    for (let index = 0; index < 130; index += 1) {
      const bot = createPlayer(`loadout-${index}`, 'red', 300, 340);
      bot.botBrain = createBotBrain(bot.id, 0, () => ((randomDraw++ % 130) + 0.5) / 130);
      bot.selectedWeaponId = bot.botBrain.loadoutWeaponId;
      match.players = [bot];
      const weaponId = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000).weaponId;
      counts[weaponId] = (counts[weaponId] ?? 0) + 1;
    }
    assert.equal(Object.values(counts).reduce((total, count) => total + count, 0), 130);
    for (const weaponId of ['battle-rifle', 'machine-gun', 'marksman-rifle', 'heavy-sniper']) {
      assert.ok(counts[weaponId] > 0, `bots can select ${weaponId} for their baseline loadout`);
    }
    assert.equal(counts['classic-pistol'] ?? 0, 0, 'bots never choose the classic pistol');

    const closeBot = createPlayer('close-specialist', 'red', 100, 340);
    const closeEnemy = createPlayer('close-enemy', 'blue', 220, 340);
    closeBot.botBrain = createBotBrain(closeBot.id, 0, () => 0);
    match.players = [closeBot, closeEnemy];
    assert.equal(decideBotAction(closeBot, match, DEFAULT_BOT_PARAMETERS, 1_000).weaponId, 'assault-rifle');
    closeBot.botBrain.loadoutWeaponId = 'sniper';
    assert.equal(decideBotAction(closeBot, match, DEFAULT_BOT_PARAMETERS, 1_050).weaponId, 'assault-rifle',
      'a tactical preference change cannot replace the weapon selected at match start');

    const sniper = createPlayer('long-range-specialist', 'red', 100, 340);
    const carrier = createPlayer('distant-carrier', 'blue', 700, 340);
    sniper.botBrain = createBotBrain(sniper.id, 0, () => 0);
    match.flag.heldBy = carrier.id;
    match.players = [sniper, carrier];
    const overwatch = decideBotAction(sniper, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(overwatch.weaponId, 'assault-rifle', 'even a distant carrier does not cause a weapon switch');
  });

  it('limits Quick Play bot weapon choices to their owned inventory', () => {
    const match = createMatch();
    const bot = createPlayer('inventory-bot', 'red', 100, 340);
    const enemy = createPlayer('inventory-enemy', 'blue', 220, 340);
    bot.selectedWeaponId = 'sniper';
    bot.inventoryWeaponIds = ['sniper'];
    bot.botBrain = createBotBrain(bot.id, 0, () => 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);

    assert.equal(decision.weaponId, 'sniper', 'a close target cannot make a bot equip an unowned shotgun');
  });

  it('lets a marksman bot interrupt a per-round reload when a round is loaded', () => {
    const match = createMatch();
    const bot = createPlayer('marksman-bot', 'red', 100, 340);
    const enemy = createPlayer('marksman-target', 'blue', 220, 340);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.marksmanRifle;
    bot.selectedWeaponId = weapon.id;
    bot.inventoryWeaponIds = [weapon.id];
    bot.weaponStats = {
      [weapon.id]: {
        aimAngle: 0,
        ammo: weapon.magazineSize - 2,
        reloading: true,
        reloadEndsAt: 2_000,
      },
    };
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, enemy];

    const decision = decideBotAction(bot, match, {
      ...DEFAULT_BOT_PARAMETERS,
      reflexMs: 0,
      accuracy: 1,
    }, 1_000);

    assert.equal(decision.weaponId, weapon.id);
    assert.equal(decision.fire, true, 'a loaded round can interrupt the shell-by-shell reload');
  });

  it('aims and fires with pistol definitions whose IDs do not match catalog keys', () => {
    for (const weaponId of ['classic-pistol', 'battle-pistol', 'revolver', 'machine-pistol', 'pocket-shotgun']) {
      const match = createMatch();
      const bot = createPlayer(`pistol-bot-${weaponId}`, 'red', 100, 340);
      const enemy = createPlayer(`pistol-target-${weaponId}`, 'blue', 220, 340);
      const weapon = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((definition) => definition.id === weaponId);
      bot.selectedWeaponId = weaponId;
      bot.inventoryWeaponIds = [weaponId];
      bot.weaponStats = { [weaponId]: { aimAngle: 0, ammo: weapon.magazineSize, reloading: false } };
      bot.botBrain = createBotBrain(bot.id, 0, () => 0);
      match.players = [bot, enemy];

      const decision = decideBotAction(bot, match, {
        ...DEFAULT_BOT_PARAMETERS,
        reflexMs: 0,
        accuracy: 1,
      }, 1_000);

      assert.equal(decision.weaponId, weaponId, `${weaponId} remains equipped`);
      assert.equal(decision.fire, true, `${weaponId} produces a fire decision for an aligned, safe shot`);
    }
  });

  it('keeps Red moving toward the objective and sends Blue to cover its approach route', () => {
    const match = createMatch();
    match.map.spawnZones.red = { x: 40, y: 270, width: 140, height: 140 };
    match.map.spawnZones.blue = { x: 820, y: 270, width: 140, height: 140 };
    match.flag = { x: 890, y: 340, heldBy: null, dropped: false };
    match.map.rooms = [
      { id: 'red-spawn', isSpawn: true, team: 'red', x: 110, y: 340, width: 140, height: 140 },
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 890, y: 340, width: 140, height: 140 },
      { id: 'room-1', isSpawn: false, x: 500, y: 340, width: 140, height: 140 },
    ];
    match.map.corridors = [
      { id: 'red-door', a: 'red-spawn', b: 'room-1', points: [{ x: 180, y: 340 }, { x: 223, y: 340 }, { x: 430, y: 340 }] },
      { id: 'blue-door', a: 'room-1', b: 'blue-spawn', points: [{ x: 570, y: 340 }, { x: 777, y: 340 }, { x: 820, y: 340 }] },
    ];
    const red = createPlayer('red-door-runner', 'red', 110, 340);
    red.botBrain = createBotBrain(red.id, 0);
    match.players = [red];
    const redPlan = decideBotAction(red, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(redPlan.action, 'leave-spawn');
    assert.ok(redPlan.target.x > red.x && redPlan.target.x < match.flag.x,
      'Red starts through the outward doorway toward the Blue flag');
    assert.ok(redPlan.waypoint.x > red.x, 'Red starts moving through its spawn doorway');

    const blue = createPlayer('blue-door-guard', 'blue', 890, 340);
    const redThreat = createPlayer('red-threat', 'red', 865, 340);
    blue.visionAngle = Math.PI;
    blue.weaponStats['assault-rifle'].aimAngle = Math.PI;
    blue.botBrain = createBotBrain(blue.id, 0);
    match.players = [blue, redThreat];
    const bluePlan = decideBotAction(blue, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 2 });
    assert.equal(bluePlan.action, 'fall-back');
    assert.ok(bluePlan.target.x > 820, 'Blue retreats inward through the doorway toward its site');
  });

  it('raises Red objective urgency and movement pace as the three-minute deadline approaches', () => {
    const match = createMatch();
    match.gameplayStartsAt = 0;
    match.endsAt = 180_000;
    const bot = createPlayer('bot-red', 'red', 300, 340);
    bot.isBot = true;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    const early = decideBotAction(bot, match, BOT_PERSONALITIES[0].parameters, 1_000, { roleIndex: 0, roleCount: 1 });
    const late = decideBotAction(bot, match, BOT_PERSONALITIES[0].parameters, 170_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(late.action, 'capture');
    assert.ok(late.objectiveScore > early.objectiveScore);
    assert.ok(late.input.speedScale > early.input.speedScale);
    assert.ok(late.thinkingTimeMs < early.thinkingTimeMs);
  });

  it('plans a local detour around a blocking obstacle on the capture approach', () => {
    const match = createMatch();
    match.map.objects = [{ shape: 'rect', x: 210, y: 340, width: 48, height: 180 }];
    const bot = createPlayer('bot-red', 'red', 300, 340);
    bot.isBot = true;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    const plan = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000, { roleIndex: 0, roleCount: 1 });
    assert.equal(plan.action, 'capture');
    assert.ok(bot.botBrain.routeWaypoint, 'the route selects a local bypass waypoint');
    assert.notDeepEqual(plan.waypoint, match.flag, 'the bot follows the obstacle bypass before resuming the flag route');
  });

  it('detects long wall segments and never reuses a route that becomes blocked', () => {
    const match = createMatch();
    const longWall = { shape: 'segment', x1: 200, y1: 100, x2: 200, y2: 600 };
    match.map.objects = [longWall];
    const bot = createPlayer('long-wall-bot', 'red', 300, 340);
    bot.isBot = true;
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot];

    const firstPlan = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.notDeepEqual(firstPlan.waypoint, match.flag);
    assert.equal(segmentMapObjectEntryT(bot, firstPlan.waypoint, longWall, 20), null,
      'the waypoint leg clears the wall even though its midpoint is far from the bot');

    const blocker = {
      shape: 'rect',
      x: (bot.x + firstPlan.waypoint.x) / 2,
      y: (bot.y + firstPlan.waypoint.y) / 2,
      width: 48,
      height: 48,
    };
    match.map.objects.push(blocker);
    const nextPlan = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_100);
    assert.notDeepEqual(nextPlan.waypoint, firstPlan.waypoint,
      'a newly blocked cached route is discarded and replanned');
  });

  it('changes its local waypoint after making no movement progress', () => {
    const match = createMatch();
    match.flag = { x: 900, y: 340, heldBy: null, dropped: false };
    const blockingProp = { shape: 'circle', x: 100, y: 505, radius: 50 };
    match.map.objects = [blockingProp];
    const bot = createPlayer('bot-stuck', 'red', 100, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    Object.assign(bot.botBrain, {
      progressPosition: { x: bot.x, y: bot.y },
      progressGoal: { x: match.flag.x, y: match.flag.y },
      progressAction: 'capture',
      progressGoalDistance: 400,
      lastProgressAt: 0,
      lastWasMoving: true,
    });
    match.players = [bot];

    const decision = decideBotAction(bot, match, DEFAULT_BOT_PARAMETERS, 1_000);
    assert.equal(bot.botBrain.stuckCount, 1);
    assert.ok(Math.hypot(decision.waypoint.x - bot.x, decision.waypoint.y - bot.y) > 100);
    assert.notEqual(decision.waypoint.x, match.flag.x, 'stuck recovery temporarily replans rather than repeatedly pushing the same goal');
    assert.equal(circleOverlapsMapObjects(decision.waypoint, match.map.objects, 9), false,
      'stuck recovery never chooses a detour inside a prop');
    assert.equal(segmentMapObjectEntryT(bot, decision.waypoint, blockingProp, 9), null,
      'the escape leg remains clear of the blocking prop');
  });

  it('withholds shots that could hit a teammate and reloads a low magazine outside combat', () => {
    const match = createMatch();
    const bot = createPlayer('bot-red', 'red', 100, 340, 18);
    const ally = createPlayer('ally', 'red', 170, 340);
    const enemy = createPlayer('enemy', 'blue', 260, 340);
    bot.botBrain = createBotBrain(bot.id, 0);
    match.players = [bot, ally, enemy];
    const parameters = { ...DEFAULT_BOT_PARAMETERS, reflexMs: 0, accuracy: 1, aggressiveness: 0.2, retreatHealth: 32 };

    const blockedShot = decideBotAction(bot, match, parameters, 1_000);
    assert.equal(blockedShot.enemyId, enemy.id);
    assert.equal(blockedShot.fire, false, 'the teammate is inside the rifle spread corridor');

    Object.assign(ally, { y: 420 });
    match.players = [bot, ally, enemy];
    bot.botBrain.rememberedEnemies = {};
    bot.selectedWeaponId = blockedShot.weaponId;
    bot.weaponStats[blockedShot.weaponId] = { aimAngle: 0 };
    const clearShot = decideBotAction(bot, match, parameters, 2_000);
    assert.equal(clearShot.fire, true, 'the bot fires when the nearby teammate is outside its shot corridor');

    match.players = [bot];
    bot.selectedWeaponId = 'assault-rifle';
    bot.weaponStats['assault-rifle'].ammo = 5;
    const reloadPlan = decideBotAction(bot, match, parameters, 3_000);
    assert.equal(reloadPlan.reload, true);
    assert.equal(reloadPlan.fire, false);
  });
});
