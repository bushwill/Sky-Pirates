import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_BOT_PARAMETERS } from '../../../shared/BotAI.js';
import { SPY_CAMERA_ID } from '../../../shared/GadgetModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { BotController, resolveBotFireCommand } from './BotController.js';

function createRoomState(hostId = 'host') {
  const bot = {
    id: 'bot-1',
    name: 'Bot 1',
    team: 'red',
    x: 300,
    y: 350,
    vx: 0,
    vy: 0,
    health: 100,
    alive: true,
    isBot: true,
    controlRevision: 3,
    selectedWeaponId: 'assault-rifle',
    weaponStats: { 'assault-rifle': { aimAngle: 0 } },
    lastInputSequence: 0,
  };
  return {
    hostId,
    quickPlay: false,
    bots: {
      parameters: { ...DEFAULT_BOT_PARAMETERS },
      roster: [{ id: 'bot-1', name: 'Bot 1', team: 'red', parameters: { ...DEFAULT_BOT_PARAMETERS } }],
    },
    match: {
      startedAt: 1,
      gameplayStartsAt: Date.now() - 1_000,
      victory: null,
      map: {
        width: 1_000,
        height: 700,
        objects: [],
        rooms: [],
        corridors: [],
        graph: { nodes: [], edges: [] },
        spawnZones: {
          red: { x: 200, y: 300, width: 180, height: 100 },
          blue: { x: 800, y: 300, width: 180, height: 100 },
        },
      },
      flag: { x: 850, y: 350, heldBy: null, dropped: false },
      players: [bot],
      botNoises: [],
    },
  };
}

describe('host-side BotController', () => {
  it('pulses every semi-automatic weapon using its configured bot interval', () => {
    const weapons = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).filter((weapon) => weapon.semiAuto);
    assert.ok(weapons.length > 0);
    for (const [index, weapon] of weapons.entries()) {
      const brain = {};
      const decision = { weaponId: weapon.id, fire: true };
      const startAt = 1_000 + index * 1_000;
      const delay = Math.max(weapon.botFireIntervalMs ?? weapon.cooldownMs,
        weapon.cooldownMs, weapon.manualActionDurationMs ?? 0);
      const readyAt = startAt + Math.max(1, delay);

      assert.equal(resolveBotFireCommand(brain, decision, startAt), true,
        `${weapon.id} fires on its first trigger pull`);
      assert.equal(resolveBotFireCommand(brain, decision, startAt + 1), false,
        `${weapon.id} releases the trigger between shots`);
      if (delay > 1) {
        assert.equal(resolveBotFireCommand(brain, decision, readyAt - 1), false,
          `${weapon.id} respects its configured bot interval`);
      }
      assert.equal(resolveBotFireCommand(brain, decision, readyAt), true,
        `${weapon.id} fires when its configured interval expires`);
    }
  });

  it('releases a semi-automatic trigger when the tactical decision stops firing', () => {
    const brain = {};
    assert.equal(resolveBotFireCommand(brain, { weaponId: 'revolver', fire: true }, 1_000), true);
    assert.equal(resolveBotFireCommand(brain, { weaponId: 'revolver', fire: false }, 1_010), false);
    assert.equal(brain.semiAutoNeedsRelease, false);
  });

  it('holds a Battle Pistol trigger through its full burst and respects the inter-burst delay', () => {
    const brain = {};
    const fire = { weaponId: 'battle-pistol', fire: true };
    const stop = { weaponId: 'battle-pistol', fire: false };
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.battlePistol;
    const startAt = 1_000;
    const burstDuration = weapon.burstShotIntervalMs * (weapon.burstCount - 1);
    const holdDuration = burstDuration + 45;
    const nextBurstAt = burstDuration + weapon.burstDelayMs;
    const readyAt = startAt + Math.max(holdDuration, nextBurstAt);

    assert.equal(resolveBotFireCommand(brain, fire, startAt), true, 'an aligned shot starts a burst');
    for (let shot = 1; shot < weapon.burstCount; shot += 1) {
      assert.equal(resolveBotFireCommand(brain, stop, startAt + shot * weapon.burstShotIntervalMs), true,
        `the trigger remains held for burst shot ${shot + 1}`);
    }
    assert.equal(resolveBotFireCommand(brain, stop, startAt + holdDuration), false,
      'the bot releases once the configured burst is complete');
    assert.equal(resolveBotFireCommand(brain, fire, readyAt - 1), false,
      'the next burst waits for the configured delay and command cadence');
    assert.equal(resolveBotFireCommand(brain, fire, readyAt), true,
      'the next burst starts when its configured timing expires');
  });

  it('sends decisions only from the host browser as a batched bot command', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const profile = controller.update(state, 'host');

    assert.equal(sent.length, 1);
    assert.equal(profile.decisionCount, 1);
    assert.ok(Number.isFinite(profile.totalDecisionMs));
    assert.equal(profile.slowestDecisions[0].botId, 'bot-1');
    assert.ok(Number.isFinite(profile.slowestDecisions[0].durationMs));
    assert.equal(sent[0][0], 'game:bots');
    assert.equal(sent[0][1].commands.length, 1);
    assert.equal(sent[0][1].commands[0].botId, 'bot-1');
    assert.equal(sent[0][1].commands[0].sequence, 1);
    assert.equal(sent[0][1].commands[0].controlRevision, 3);
    assert.equal(typeof sent[0][1].commands[0].reload, 'boolean');
    assert.equal(typeof sent[0][1].commands[0].weaponId, 'string');
  });

  it('resynchronizes the weapon decision after a human takeover changes the bot loadout', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    state.bots.roster[0].parameters.reflexMs = 0;
    state.bots.roster[0].parameters.accuracy = 1;
    state.match.players.push({
      id: 'enemy-1',
      team: 'blue',
      x: 420,
      y: 350,
      health: 100,
      alive: true,
    });
    controller.update(state, 'host');

    bot.controlledById = 'host';
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');
    bot.selectedWeaponId = 'battle-rifle';
    bot.controlledById = null;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');

    const command = sent.at(-1)[1].commands[0];
    assert.equal(command.weaponId, 'battle-rifle',
      'a released bot must not send a stale weapon ID that the server rejects');
    assert.equal(command.fire, true, 'the bot resumes firing with the newly selected weapon');
  });

  it('submits a fire command for a visible, aligned enemy through the host bot-command path', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    state.bots.roster[0].parameters.reflexMs = 0;
    state.bots.roster[0].parameters.accuracy = 1;
    bot.inputSequence = 12;
    state.match.players.push({
      id: 'enemy-1',
      team: 'blue',
      x: 420,
      y: 350,
      health: 100,
      alive: true,
    });

    controller.update(state, 'host');

    const command = sent[0][1].commands[0];
    assert.equal(command.sequence, 13, 'the next command continues from the host-simulated input sequence');
    assert.equal(command.fire, true, 'an aligned visible opponent produces an accepted fire intent');
  });

  it('sends the bot tactical gadget action through the host command path', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    Object.assign(bot, {
      selectedGadgetId: 'molotov',
      gadgetCount: 1,
      gadgetCounts: { molotov: 1 },
      equippedSlot: 'gadget',
    });
    state.match.players.push(
      { id: 'enemy-1', team: 'blue', x: 430, y: 350, health: 100, alive: true },
      { id: 'enemy-2', team: 'blue', x: 450, y: 350, health: 100, alive: true },
    );

    controller.update(state, 'host');

    const command = sent[0][1].commands[0];
    assert.equal(command.gadgetAction.action, 'use');
    assert.equal(command.gadgetAction.actionSequence, 1);
    assert.ok(Number.isFinite(command.gadgetAction.target.x));
    assert.equal(command.fire, false);
  });

  it('does not resend a gadget switch while the host acknowledgement is pending', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    Object.assign(bot, {
      selectedGadgetId: 'molotov',
      gadgetCount: 1,
      gadgetCounts: { molotov: 1 },
      equippedSlot: 'weapon',
    });
    state.match.players.push(
      { id: 'enemy-1', team: 'blue', x: 430, y: 350, health: 100, alive: true },
      { id: 'enemy-2', team: 'blue', x: 450, y: 350, health: 100, alive: true },
    );
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      state.match.gameplayStartsAt = now - 1_000;
      controller.update(state, 'host');
      controller.scheduleBotReplans(now + 1, 'red', bot.id);
      now += 45;
      controller.update(state, 'host');
    } finally {
      Date.now = originalNow;
    }

    assert.equal(sent.length, 2);
    assert.equal(sent[0][1].commands[0].gadgetAction.action, 'switch');
    assert.equal(sent[0][1].commands[0].gadgetAction.actionSequence, 1);
    assert.equal(sent[1][1].commands[0].gadgetAction, undefined);
    assert.equal(sent[1][1].commands[0].fire, false);
  });

  it('waits through the gadget switch and sequences the eventual use after acknowledgement', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    Object.assign(bot, {
      selectedGadgetId: 'molotov',
      gadgetCount: 1,
      gadgetCounts: { molotov: 1 },
      equippedSlot: 'weapon',
    });
    state.match.players.push(
      { id: 'enemy-1', team: 'blue', x: 430, y: 350, health: 100, alive: true },
      { id: 'enemy-2', team: 'blue', x: 450, y: 350, health: 100, alive: true },
    );
    let now = 10_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      state.match.gameplayStartsAt = now - 1_000;
      controller.update(state, 'host');
      bot.lastWeaponActionSequence = 1;
      bot.gadgetSwitchEndsAt = now + 1_000;
      bot.gadgetSwitchTargetSlot = 'gadget';
      now += 45;
      controller.update(state, 'host');
      bot.gadgetSwitchEndsAt = 11_000;
      now = 11_050;
      controller.update(state, 'host');
    } finally {
      Date.now = originalNow;
    }

    assert.equal(sent[1][1].commands[0].gadgetAction, undefined,
      'the bot waits while the one-second slot change is active');
    assert.equal(sent[2][1].commands[0].gadgetAction.action, 'use');
    assert.equal(sent[2][1].commands[0].gadgetAction.actionSequence, 2);
  });

  it('builds the live match snapshot only when the throttled bot update runs', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    let now = 10_000;
    let reads = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      state.match.gameplayStartsAt = now - 1_000;
      const getState = () => {
        reads += 1;
        return state;
      };

      controller.update(getState, 'host');
      now += 10;
      controller.update(getState, 'host');
      assert.equal(reads, 1, 'sub-interval host simulation steps do not materialize another snapshot');

      now += 40;
      controller.update(getState, 'host');
      assert.equal(reads, 2, 'the next bot command interval refreshes the live state');
    } finally {
      Date.now = originalNow;
    }
  });

  it('replans visible combat targets promptly so bots track moving enemies', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    const enemy = {
      id: 'enemy-1',
      team: 'blue',
      x: 420,
      y: 350,
      health: 100,
      alive: true,
      selectedWeaponId: 'assault-rifle',
      visionAngle: Math.PI,
      weaponStats: { 'assault-rifle': { aimAngle: Math.PI } },
    };
    state.match.players.push(enemy);
    let now = 20_000;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      state.match.gameplayStartsAt = now - 1_000;
      controller.update(state, 'host');
      const brain = controller.brains.get('bot-1');
      assert.equal(brain.decision.enemyId, enemy.id);
      assert.ok(brain.nextThinkAt - now <= 80, 'combat decisions are capped and staggered below 80ms');
      const initialAngle = Math.atan2(brain.decision.direction.y, brain.decision.direction.x);

      now += 100;
      enemy.y += 35;
      controller.update(state, 'host');
      const updatedAngle = Math.atan2(brain.decision.direction.y, brain.decision.direction.x);
      assert.ok(Math.abs(updatedAngle - initialAngle) > 0.02, 'the aim direction follows the enemy movement');
    } finally {
      Date.now = originalNow;
    }
  });

  it('does not run bot decisions on a non-host client', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const roomState = createRoomState('another-host');
    controller.update(roomState, 'guest');
    assert.equal(sent.length, 0);
    assert.equal(controller.brains.size, 0);
  });

  it('keeps player-targeted audio cues out of shared bot intel', () => {
    const controller = new BotController(null);
    const match = {
      players: [
        { id: 'jammed-listener', team: 'red', x: 100, y: 100, alive: true, health: 100, jammedUntil: 2_000 },
        { id: 'clear-listener', team: 'red', x: 120, y: 100, alive: true, health: 100 },
        { id: 'enemy', team: 'blue', x: 500, y: 500, alive: true, health: 100 },
      ],
      map: { width: 1_000, height: 700, objects: [] },
      botNoises: [
        { id: 'team-cue', team: 'red', heardById: 'clear-listener', x: 300, y: 300, expiresAt: 2_000 },
        {
          id: 'private-cue', team: 'red', heardById: 'jammed-listener',
          audiencePlayerId: 'jammed-listener', x: 300, y: 300, expiresAt: 2_000,
        },
      ],
    };

    const intel = controller.getTeamIntel('red', match, 1_000);
    assert.deepEqual(intel.audioCues.map((cue) => cue.id), ['team-cue']);
  });

  it('replans same-team bots when host-computed audio and damage cues arrive', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const roomState = createRoomState();
    controller.update(roomState, 'host');
    const brain = controller.brains.get('bot-1');
    assert.ok(brain);
    brain.nextThinkAt = Date.now() + 60_000;

    controller.acceptAudioCue({ id: 'noise-1', team: 'red', x: 500, y: 350, expiresAt: Date.now() + 2_000 });
    assert.ok(brain.nextThinkAt <= Date.now() + 120);
    brain.nextThinkAt = Date.now() + 60_000;
    controller.acceptDamageCue({ id: 'damage-1', victimId: 'bot-1', team: 'red', bearing: 0, expiresAt: Date.now() + 1_000 });
    assert.equal(brain.nextThinkAt, Date.now());
    assert.equal(controller.damageCues.has('bot-1'), true);
  });

  it('does not turn a personal jammed-listener cue into pooled bot intel', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    const ally = structuredClone(state.match.players[0]);
    Object.assign(ally, { id: 'bot-2' });
    state.match.players.push(ally);
    state.bots.roster.push({ ...state.bots.roster[0], id: ally.id, name: ally.name });
    controller.update(state, 'host');
    const otherBotBrain = controller.brains.get(ally.id);
    const nextThinkAt = Date.now() + 60_000;
    otherBotBrain.nextThinkAt = nextThinkAt;

    controller.acceptAudioCue({
      id: 'private-noise', team: 'red', heardById: 'host', audiencePlayerId: 'host',
      x: 500, y: 350, expiresAt: Date.now() + 2_000,
    });
    controller.acceptDamageCue({
      id: 'private-damage', team: 'red', victimId: 'host', audiencePlayerId: 'host',
      bearing: 0, expiresAt: Date.now() + 1_000,
    });

    assert.equal(controller.teamIncidents.size, 0);
    assert.equal(otherBotBrain.nextThinkAt, nextThinkAt);
  });

  it('does not submit bot commands at the countdown boundary', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    state.match.gameplayStartsAt = Date.now() + 100;

    controller.update(state, 'host');

    assert.deepEqual(sent, []);
  });

  it('retries failed sends on the next command interval without spinning every frame', () => {
    let attempts = 0;
    const controller = new BotController({ send: () => { attempts += 1; return false; } });
    const state = createRoomState();

    controller.update(state, 'host');
    controller.update(state, 'host');
    assert.equal(attempts, 1, 'a failed network send is still throttled for one command interval');
    assert.equal(controller.lastSentAt, -Infinity, 'a failed send is not treated as delivered');

    controller.lastAttemptAt = Date.now() - 50;
    controller.update(state, 'host');
    assert.equal(attempts, 2, 'the next command interval retries the latest bot state');
  });

  it('leaves a human-controlled bot to its takeover player', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    state.match.players[0].controlledById = 'another-player';
    controller.update(state, 'host');
    assert.deepEqual(sent, []);
  });

  it('does not decide or send commands for a non-host, but runs bots in Quick Play', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    controller.update(createRoomState('another-player'), 'host');
    const quickPlay = createRoomState();
    quickPlay.quickPlay = true;
    controller.update(quickPlay, 'host');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'game:bots');
  });

  it('uses the full personality catalog when a later Quick Play round has a new bot roster', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    state.quickPlay = true;
    state.bots.catalog = [{ id: 'bot-2', name: 'Bot 2', parameters: { ...DEFAULT_BOT_PARAMETERS } }];
    const nextRoundBot = { ...state.match.players[0], id: 'bot-2', name: 'Bot 2', lastInputSequence: 0 };
    state.match.startedAt += 1;
    state.match.players = [nextRoundBot];

    controller.update(state, 'host');

    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].commands[0].botId, 'bot-2',
      'newly shuffled round bots are planned even when their roster was absent from earlier room updates');
  });

  it('stagger-replans after teammate deaths without clearing active movement decisions', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const secondBot = structuredClone(state.match.players[0]);
    secondBot.id = 'bot-2';
    secondBot.name = 'Bot 2';
    state.match.players.push(secondBot);
    state.bots.roster.push({ ...state.bots.roster[0], id: secondBot.id, name: secondBot.name });

    controller.update(state, 'host');
    const firstDecision = controller.brains.get('bot-1').decision;
    controller.brains.get('bot-1').nextThinkAt = Date.now() + 10_000;
    secondBot.alive = false;
    secondBot.health = 0;
    controller.lastSentAt = -Infinity;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');

    assert.equal(controller.brains.get('bot-1').decision, firstDecision,
      'the survivor keeps issuing its current movement command during the short replan stagger');
    assert.ok(controller.brains.get('bot-1').nextThinkAt > Date.now());
    assert.ok(controller.brains.get('bot-1').nextThinkAt <= Date.now() + 121);
    assert.deepEqual(sent.at(-1)[1].commands[0].input, firstDecision.input,
      'the host continues sending the cached movement input while replanning is staggered');

    controller.brains.get('bot-1').nextThinkAt = 0;
    controller.lastSentAt = -Infinity;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');
    assert.notEqual(controller.brains.get('bot-1').decision, firstDecision,
      'the survivor gets its fresh tactical decision once its stagger expires');
  });

  it('continues bot input sequences from the newer local or authoritative sequence', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    state.match.players[0].lastInputSequence = 7;
    state.match.players[0].inputSequence = 14;
    controller.update(state, 'host');
    assert.equal(sent[0][1].commands[0].sequence, 15);
  });

  it('builds shared team intel only when bots need new decisions and only once per team', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const secondBot = structuredClone(state.match.players[0]);
    secondBot.id = 'bot-2';
    state.match.players.push(secondBot);
    state.bots.roster.push({ ...state.bots.roster[0], id: secondBot.id });

    let builds = 0;
    const getTeamIntel = controller.getTeamIntel.bind(controller);
    controller.getTeamIntel = (...args) => {
      builds += 1;
      return getTeamIntel(...args);
    };

    controller.update(state, 'host');
    assert.equal(builds, 1, 'both red bots share their team intel snapshot');
    controller.update(state, 'host');
    assert.equal(builds, 1, 'cached bot decisions do not rebuild team intel');

    for (const brain of controller.brains.values()) brain.nextThinkAt = 0;
    controller.lastSentAt = -Infinity;
    controller.lastAttemptAt = -Infinity;
    controller.lastVisibilityAt = -Infinity;
    controller.update(state, 'host');
    assert.equal(builds, 2, 'a later replan rebuilds one fresh team intel snapshot');
  });

  it('throttles expensive team-wide visibility scans separately from bot commands', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    controller.lastVisibilityAt = 10_000;

    controller.updateTeamIntel(state.match, 10_100);
    assert.equal(controller.lastVisibilityAt, 10_000, 'a scan is skipped before the refresh interval');

    controller.updateTeamIntel(state.match, 10_120);
    assert.equal(controller.lastVisibilityAt, 10_120, 'the scan refreshes once the interval elapses');
  });

  it('does not publish teammate sightings through active smoke and resumes after it expires', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    const enemy = {
      ...structuredClone(state.match.players[0]),
      id: 'enemy',
      team: 'blue',
      x: 500,
      y: 350,
      isBot: false,
    };
    state.match.players.push(enemy);
    const now = Date.now();
    state.match.smokes = [{
      id: 'sighting-smoke', shape: 'circle', role: 'vision-smoke', x: 400, y: 350, radius: 30,
      blocksVision: true, blocksMovement: false, blocksProjectiles: false, expiresAt: now + 500,
    }];

    controller.updateTeamIntel(state.match, now);
    assert.equal(controller.teamSightings.size, 0);

    state.match.smokes[0].expiresAt = now + 121;
    controller.updateTeamIntel(state.match, now + 121);
    assert.equal(controller.teamSightings.has('red:enemy'), true);
  });

  it('immediately replans the team when pooled vision finds an enemy near an ally', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    const bot = state.match.players[0];
    controller.brains.set(bot.id, {
      id: bot.id,
      botTeam: bot.team,
      decision: { action: 'capture' },
      nextThinkAt: Date.now() + 5_000,
    });
    state.match.players.push({
      ...structuredClone(bot),
      id: 'enemy',
      team: 'blue',
      x: bot.x + 100,
      isBot: false,
    });
    const now = Date.now();

    controller.updateTeamIntel(state.match, now);

    assert.equal(controller.brains.get(bot.id).decision, null);
    assert.equal(controller.brains.get(bot.id).nextThinkAt, now);
  });

  it('shares active Spy Camera sightings through walls and omits disabled-camera intel', () => {
    const state = createRoomState();
    const bot = state.match.players[0];
    bot.visionAngle = Math.PI;
    bot.weaponStats['assault-rifle'].aimAngle = Math.PI;
    const enemy = {
      ...structuredClone(bot),
      id: 'camera-enemy',
      team: 'blue',
      x: 500,
      isBot: false,
    };
    const now = Date.now();
    state.match.players.push(enemy);
    state.match.map.objects = [{
      shape: 'segment',
      x1: 400,
      y1: 250,
      x2: 400,
      y2: 450,
      blocksVision: true,
    }];
    const camera = {
      id: 'team-camera',
      type: SPY_CAMERA_ID,
      team: 'red',
      x: bot.x,
      y: bot.y,
      angle: 0,
      visionRange: 300,
      visionHalfAngle: Math.PI / 4,
      health: 50,
      startedAt: now - 1_000,
      expiresAt: now + 5_000,
    };
    state.match.gadgetEffects = [camera];

    const controller = new BotController({ send: () => true });
    controller.updateTeamIntel(state.match, now);
    const intel = controller.getTeamIntel('red', state.match, now);

    assert.equal(intel.sightings[0]?.sourceType, 'spy-camera');
    assert.equal(intel.sightings[0]?.enemyId, enemy.id);
    assert.ok(intel.visionSources.some((source) => source.cameraId === camera.id && source.xray));

    const disabledState = structuredClone(state.match);
    disabledState.gadgetEffects[0].disabledUntil = now + 1_000;
    const disabledController = new BotController({ send: () => true });
    disabledController.updateTeamIntel(disabledState, now);
    assert.equal(disabledController.teamSightings.size, 0,
      'a disabled camera cannot report new sightings');
  });

  it('immediately replans a bot when jamming removes access to shared intel', () => {
    const controller = new BotController({ send: () => true });
    const state = createRoomState();
    controller.update(state, 'host');
    const bot = state.match.players[0];
    const brain = controller.brains.get(bot.id);
    const staleSharedIntelDecision = { action: 'investigate-team-sighting' };
    brain.decision = staleSharedIntelDecision;
    brain.nextThinkAt = Date.now() + 5_000;
    bot.jammedUntil = Date.now() + 5_000;
    controller.lastAttemptAt = -Infinity;

    controller.update(state, 'host');

    assert.notEqual(brain.decision, staleSharedIntelDecision,
      'a newly jammed bot does not keep acting on its previous shared-intel decision');
  });

  it('does not add smoke as a projectile blocker to an already-authorized shot', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    Object.assign(bot, { x: 300, y: 350, visionAngle: 0 });
    const enemy = { ...structuredClone(bot), id: 'enemy', team: 'blue', x: 500, y: 350, isBot: false };
    state.match.players.push(enemy);
    const now = Date.now();

    controller.update(state, 'host');
    const brain = controller.brains.get(bot.id);
    brain.decision = { ...brain.decision, enemyId: enemy.id, weaponId: 'assault-rifle', fire: true };
    brain.nextThinkAt = now + 5_000;
    state.match.smokes = [{
      id: 'cached-shot-smoke', shape: 'circle', role: 'vision-smoke', x: 400, y: 350, radius: 30,
      blocksVision: true, blocksMovement: false, blocksProjectiles: false, expiresAt: now + 5_000,
    }];
    controller.teamStateSignature = JSON.stringify({
      livingPlayers: state.match.players.filter((player) => player.alive && player.health > 0)
        .map((player) => player.id).sort(),
      flagHolder: state.match.flag?.heldBy ?? null,
      flagDropped: state.match.flag?.dropped === true,
      visionSmokes: [['cached-shot-smoke', 400, 350, 30]],
    });
    controller.lastVisibilityAt = now;
    controller.lastAttemptAt = -Infinity;

    controller.update(state, 'host');

    assert.equal(brain.decision.fire, true);
    assert.equal(sent.at(-1)[1].commands[0].fire, true,
      'smoke filters visibility intel, not whether an already-authorized shot can travel through it');
  });

  it('routes a team damage cue only to its named bot and immediately replans', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    Object.assign(state.match.players[0], { x: 500, y: 350 });
    const now = Date.now();
    controller.acceptDamageCue({ victimId: 'bot-1', team: 'red', bearing: Math.PI / 2, expiresAt: now + 1_000 });
    controller.acceptDamageCue({ victimId: 'not-this-bot', team: 'red', bearing: 0, expiresAt: now + 1_000 });

    controller.update(state, 'host');

    assert.equal(controller.brains.get('bot-1').incomingDamageCue.bearing, Math.PI / 2);
    assert.equal(controller.brains.get('bot-1').decision.action, 'investigate-damage');
    assert.equal(controller.brains.has('not-this-bot'), false);
    assert.ok(sent.length > 0, 'the host sends the replanned bot command');
  });

  it('sends an unseen teammate to an ally-threatened enemy while the observer fights', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const bot = state.match.players[0];
    Object.assign(bot, { x: 450, y: 350, visionAngle: 0 });
    const observer = structuredClone(bot);
    Object.assign(observer, {
      id: 'bot-2',
      x: 600,
      y: 560,
      visionAngle: Math.PI,
      weaponStats: { 'assault-rifle': { aimAngle: Math.PI } },
    });
    const enemy = { ...structuredClone(bot), id: 'enemy', team: 'blue', x: 450, y: 560, isBot: false };
    state.match.players.push(observer, enemy);
    state.bots.roster.push({ ...state.bots.roster[0], id: observer.id, name: observer.name });

    controller.update(state, 'host');

    const decision = controller.brains.get(bot.id).decision;
    const supportingDecision = controller.brains.get(observer.id).decision;
    assert.equal(decision.action, 'respond-team-threat');
    assert.equal(supportingDecision.action, 'fight',
      'the observer immediately fights the enemy it can see while its teammate responds');
    assert.ok(Math.hypot(decision.target.x - enemy.x, decision.target.y - enemy.y) <= 120);
    assert.equal(decision.enemyId, null, 'a teammate report does not make the unseen enemy personally targetable');
    assert.equal(decision.fire, false, 'the bot never fires based only on shared sighting intel');
    assert.equal(supportingDecision.enemyId, enemy.id,
      'the observer may target the enemy because it personally sees it');
  });

  it('sends other nearby bots to assist a teammate who was damaged', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    Object.assign(state.match.players[0], { x: 500, y: 350 });
    const ally = structuredClone(state.match.players[0]);
    Object.assign(ally, { id: 'bot-2', x: 420, y: 350 });
    state.match.players.push(ally);
    state.bots.roster.push({ ...state.bots.roster[0], id: ally.id, name: ally.name });
    controller.acceptDamageCue({ id: 'damage-ally', victimId: ally.id, team: 'red', bearing: 0, expiresAt: Date.now() + 1_000 });

    controller.update(state, 'host');

    const decision = controller.brains.get('bot-1').decision;
    assert.equal(decision.action, 'assist-damaged-teammate');
    assert.deepEqual(decision.target, { x: ally.x, y: ally.y });
    assert.equal(decision.enemyId, null, 'the victim-relative damage bearing does not identify an attacker');
  });

  it('passes team gunshot audio cues to nearby bots as approximate investigation leads', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    Object.assign(state.match.players[0], { x: 450, y: 350 });
    state.match.botNoises.push({
      id: 'gunshot-cue',
      team: 'red',
      x: 550,
      y: 350,
      radius: 180,
      expiresAt: Date.now() + 2_000,
    });

    controller.update(state, 'host');

    const decision = controller.brains.get('bot-1').decision;
    assert.equal(decision.action, 'investigate-audio');
    assert.deepEqual(decision.target, { x: 550, y: 350 });
    assert.equal(decision.enemyId, null, 'gunshot audio does not identify a visible enemy');
    assert.equal(decision.fire, false, 'the bot cannot fire based only on an audio lead');
  });

  it('broadcasts footstep intel to the bot team and immediately replans the closest hearer', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    const firstBot = state.match.players[0];
    const secondBot = structuredClone(firstBot);
    Object.assign(secondBot, { id: 'bot-2', x: 430, y: 350 });
    state.match.players.push(secondBot);
    state.bots.roster.push({ id: 'bot-2', name: 'Bot 2', team: 'red', parameters: { ...DEFAULT_BOT_PARAMETERS } });

    controller.update(state, 'host');
    assert.notEqual(controller.brains.get(firstBot.id).decision.action, 'investigate-audio');
    assert.notEqual(controller.brains.get(secondBot.id).decision.action, 'investigate-audio');

    state.match.botNoises.push({
      id: 'footstep-for-bot-1',
      kind: 'footstep',
      heardById: firstBot.id,
      team: 'red',
      x: 400,
      y: 350,
      radius: 20,
      expiresAt: Date.now() + 650,
    });
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');

    assert.ok(controller.seenBotAudioCueIds.has('footstep-for-bot-1'));
    assert.equal(controller.getTeamIntel('red', state.match, Date.now()).audioCues.length, 1);
    assert.equal(controller.brains.get(firstBot.id).decision.action, 'investigate-audio');
    assert.deepEqual(controller.brains.get(firstBot.id).decision.target, { x: 400, y: 350 });
    assert.equal(controller.brains.get(firstBot.id).decision.fire, false,
      'the bot investigates sound but does not shoot based on it');

    controller.brains.get(secondBot.id).nextThinkAt = 0;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');
    assert.equal(controller.brains.get(secondBot.id).decision.action, 'investigate-audio',
      'other teammates can also investigate the shared cue');
  });

  it('shares a teammate death location and replans surviving bots to respond', () => {
    const sent = [];
    const controller = new BotController({ send: (...args) => { sent.push(args); return true; } });
    const state = createRoomState();
    Object.assign(state.match.players[0], { x: 500, y: 350 });
    const ally = structuredClone(state.match.players[0]);
    Object.assign(ally, { id: 'bot-2', x: 420, y: 350 });
    state.match.players.push(ally);
    state.bots.roster.push({ ...state.bots.roster[0], id: ally.id, name: ally.name });

    controller.update(state, 'host');
    ally.alive = false;
    ally.health = 0;
    controller.lastSentAt = -Infinity;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');
    controller.brains.get('bot-1').nextThinkAt = 0;
    controller.lastSentAt = -Infinity;
    controller.lastAttemptAt = -Infinity;
    controller.update(state, 'host');

    const decision = controller.brains.get('bot-1').decision;
    assert.equal(decision.action, 'respond-teammate-death');
    assert.deepEqual(decision.target, { x: ally.x, y: ally.y });
    assert.ok(sent.length >= 2, 'a newly observed death causes a fresh survivor command');
  });
});
