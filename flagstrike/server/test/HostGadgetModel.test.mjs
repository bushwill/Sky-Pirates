import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GADGET_DEFINITIONS,
  calculateGadgetTrajectory,
  BIO_FIELD_ID,
  getGadgetProjectileSpeed,
  FLASH_GRENADE_ID,
  JAMMER_GRENADE_DURATION_MS,
  JAMMER_GRENADE_ID,
  JAMMER_GRENADE_RADIUS,
  JAMMER_GRENADE_VISUAL_DURATION_MS,
  KATANA_DASH_VISUAL_DURATION_MS,
  MOLOTOV_ID,
  ORBITAL_STRIKE_EXPLOSION_DAMAGE,
  ORBITAL_STRIKE_ID,
  ORBITAL_STRIKE_FIRE_DURATION_MS,
  PROXIMITY_MINE_ARMING_DURATION_MS,
  PROXIMITY_MINE_ID,
  SONAR_ID,
  VINE_TRAP_ARMING_DURATION_MS,
  VINE_TRAP_ID,
  SMOKE_GRENADE_ID,
  SPY_CAMERA_DURATION_MS,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_ID,
  CRYO_GRENADE_ID,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_COMMAND_EFFECT_ID,
  TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED,
  TROPHY_SYSTEM_COMMAND_RADIUS,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_THROW_COLLISION_RADIUS,
} from '../../shared/GadgetModel.js';
import {
  createHostGadgetEffect,
  createHostKatanaDashEffect,
  createHostOrbitalStrikeImpact,
  createHostOrbitalStrikeWarning,
  createHostSpyCamera,
  createHostTrophyCommandProjectile,
  applyHostJammerDetonation,
  findTrophyCommandClearedEffects,
} from '../../shared/HostGadgetModel.js';

const player = { id: 'player-1', team: 'red' };
const trajectory = {
  points: [{ x: 0, y: 0 }, { x: 900, y: 0 }],
  endpoint: { x: 900, y: 0 },
};

describe('host gadget simulation data', () => {
  it('places Trophy outside wall collision bounds so commands can launch away from the wall', () => {
    const definition = GADGET_DEFINITIONS[TROPHY_SYSTEM_ID];
    const wall = {
      id: 'wall',
      shape: 'rect',
      x: 600,
      y: 350,
      width: 20,
      height: 200,
      blocksProjectiles: true,
    };
    const owner = { id: 'owner', team: 'red' };
    const placementTrajectory = calculateGadgetTrajectory(
      { x: 500, y: 350 },
      { x: 700, y: 350 },
      [wall],
      {
        maximumRange: definition.throwRange,
        collisionRadius: definition.throwCollisionRadius,
        maximumBounces: definition.maxBounces,
      },
    );
    assert.ok(placementTrajectory);
    const placement = createHostGadgetEffect({
      id: 'wall-trophy',
      definition,
      player: owner,
      trajectory: placementTrajectory,
      now: 10_000,
      matchEndsAt: 100_000,
    });
    const trophy = placement.effect;
    assert.equal(trophy.x, wall.x - wall.width / 2 - TROPHY_SYSTEM_THROW_COLLISION_RADIUS);
    assert.ok(wall.x - wall.width / 2 - trophy.x > TROPHY_SYSTEM_BODY_RADIUS);

    const commandOptions = {
      player: owner,
      trophy,
      mapObjects: [wall],
      visionObjects: [wall],
      now: placement.landedAt + 1,
      matchEndsAt: 100_000,
      mapWidth: 1_000,
      mapHeight: 700,
    };
    assert.ok(createHostTrophyCommandProjectile({
      ...commandOptions,
      id: 'away-pulse',
      target: { x: 500, y: 350 },
    }), 'a pulse can be launched away from the wall');
    const stoppedAtWall = createHostTrophyCommandProjectile({
      ...commandOptions,
      id: 'through-wall-pulse',
      target: { x: 700, y: 350 },
    });
    assert.ok(stoppedAtWall, 'the command may launch toward a physical wall');
    assert.ok(
      stoppedAtWall.trajectoryPreview.endpoint.x < wall.x - wall.width / 2,
      'projectile collision still stops the pulse before the physical wall',
    );
  });

  it('creates a short-lived Katana dash effect with its endpoints and owner attribution', () => {
    const dash = {
      start: { x: 100, y: 200 },
      end: { x: 180, y: 200 },
      angle: 0,
      distance: 80,
    };
    const effect = createHostKatanaDashEffect({
      id: 'katana-dash-1',
      player: { ...player, x: 100, y: 200 },
      dash,
      now: 1_000,
    });

    assert.equal(effect.type, 'katana-dash');
    assert.equal(effect.ownerId, player.id);
    assert.equal(effect.team, player.team);
    assert.equal(effect.angle, 0);
    assert.deepEqual([effect.startX, effect.startY, effect.endX, effect.endY], [100, 200, 180, 200]);
    assert.equal(effect.expiresAt, 1_000 + KATANA_DASH_VISUAL_DURATION_MS);
    assert.equal(createHostKatanaDashEffect({
      id: 'bad-dash',
      player,
      dash: { ...dash, distance: 0 },
      now: 1_000,
    }), null);
  });

  it('places a one-use Spy Camera at the player with a directional vision cone and one-minute lifetime', () => {
    const definition = GADGET_DEFINITIONS[SPY_CAMERA_ID];
    const camera = createHostSpyCamera({
      id: 'camera-1',
      definition,
      player: { ...player, x: 140, y: 250 },
      angle: Math.PI / 4,
      now: 2_000,
    });

    assert.equal(camera.type, SPY_CAMERA_ID);
    assert.equal(camera.ownerId, player.id);
    assert.equal(camera.team, player.team);
    assert.deepEqual({ x: camera.x, y: camera.y }, { x: 140, y: 250 });
    assert.equal(camera.angle, Math.PI / 4);
    assert.equal(camera.visionRange, 300);
    assert.equal(camera.visionHalfAngle, definition.visionHalfAngle);
    assert.equal(camera.expiresAt, 2_000 + SPY_CAMERA_DURATION_MS);
    assert.equal(camera.blocksProjectiles, false);
  });

  it('creates a map-wide Orbital Strike warning and delayed impact with a six-second fire pool', () => {
    const definition = GADGET_DEFINITIONS[ORBITAL_STRIKE_ID];
    const warning = createHostOrbitalStrikeWarning({
      id: 'orbital-1',
      definition,
      player,
      target: { x: 1_400, y: 900 },
      now: 2_000,
    });

    assert.equal(warning.type, 'orbital-strike-warning');
    assert.equal(warning.x, 1_400);
    assert.equal(warning.y, 900);
    assert.equal(warning.radius, definition.effectRadius);
    assert.equal(warning.explosionDamage, ORBITAL_STRIKE_EXPLOSION_DAMAGE);
    assert.equal(warning.strikeAt, 2_000 + definition.warningDurationMs);
    const impact = createHostOrbitalStrikeImpact(warning, warning.strikeAt);
    assert.equal(impact.explosion.type, 'orbital-strike-explosion');
    assert.equal(impact.fire.type, 'molotov');
    assert.equal(impact.fire.gadgetId, ORBITAL_STRIKE_ID);
    assert.equal(impact.fire.expiresAt, warning.strikeAt + ORBITAL_STRIKE_FIRE_DURATION_MS);
    assert.equal(impact.fire.damagePerSecond, definition.damagePerSecond);
  });

  it('starts smoke duration when the throw lands, not when it is released', () => {
    const created = createHostGadgetEffect({ id: 'smoke-1', definition: GADGET_DEFINITIONS[SMOKE_GRENADE_ID],
      player, trajectory, now: 1_000, matchEndsAt: 200_000 });
    assert.ok(created.detonatesAt > 1_000);
    assert.equal(created.effect.startedAt, created.detonatesAt);
    assert.equal(created.effect.expiresAt, created.detonatesAt + GADGET_DEFINITIONS[SMOKE_GRENADE_ID].effectDurationMs);
    assert.equal(created.effect.type, 'smoke');
  });

  it('keeps mines private-state-ready and persistent for the match duration', () => {
    const created = createHostGadgetEffect({ id: 'mine-1', definition: GADGET_DEFINITIONS[PROXIMITY_MINE_ID],
      player, trajectory, now: 1_000, matchEndsAt: 180_000 });
    assert.equal(created.effect.type, 'mine');
    assert.equal(created.effect.armed, false);
    assert.equal(created.effect.armedAt, 1_000 + PROXIMITY_MINE_ARMING_DURATION_MS);
    assert.equal(created.effect.triggerRadius, GADGET_DEFINITIONS[PROXIMITY_MINE_ID].triggerRadius);
    assert.equal(created.effect.hitRadius, GADGET_DEFINITIONS[PROXIMITY_MINE_ID].hitRadius);
    assert.equal(created.effect.expiresAt, 180_000);
  });

  it('keeps a placed Trophy at 200 health until the match ends', () => {
    const created = createHostGadgetEffect({
      id: 'trophy-1',
      definition: GADGET_DEFINITIONS[TROPHY_SYSTEM_ID],
      player,
      trajectory,
      now: 1_000,
      matchEndsAt: 180_000,
    });

    assert.equal(created.effect.type, TROPHY_SYSTEM_ID);
    assert.equal(created.effect.health, TROPHY_SYSTEM_HEALTH);
    assert.equal(created.effect.maxHealth, TROPHY_SYSTEM_HEALTH);
    assert.equal(created.effect.expiresAt, 180_000);
  });

  it('fires a non-bouncing Trophy command projectile through vision blockers', () => {
    const trophy = {
      id: 'trophy-1', type: TROPHY_SYSTEM_ID, ownerId: player.id, team: player.team,
      x: 100, y: 100, startedAt: 0, expiresAt: 180_000, health: TROPHY_SYSTEM_HEALTH,
    };
    const smoke = {
      id: 'command-smoke',
      gadgetId: SMOKE_GRENADE_ID,
      type: 'smoke',
      role: 'vision-smoke',
      shape: 'circle',
      x: 200,
      y: 100,
      radius: 40,
      blocksVision: true,
    };
    const visionWall = {
      id: 'command-wall',
      shape: 'segment',
      x1: 250,
      y1: 50,
      x2: 250,
      y2: 150,
      blocksVision: true,
      blocksProjectiles: true,
    };
    const created = createHostTrophyCommandProjectile({
      id: 'trophy-pulse-1',
      player,
      trophy,
      target: { x: 300, y: 100 },
      mapObjects: [visionWall],
      visionObjects: [smoke, visionWall],
      now: 1_000,
      matchEndsAt: 180_000,
      mapWidth: 1_000,
      mapHeight: 700,
    });
    assert.equal(created.effect.type, TROPHY_SYSTEM_COMMAND_EFFECT_ID);
    assert.equal(created.effect.gadgetId, TROPHY_SYSTEM_ID);
    assert.equal(created.effect.radius, TROPHY_SYSTEM_COMMAND_RADIUS);
    assert.equal(created.projectileSpeed, TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED);
    assert.deepEqual(created.trajectory[0], { x: trophy.x, y: trophy.y });
    assert.deepEqual(created.trajectoryPreview.endpoint, { x: 300, y: 100 });
    assert.equal(created.trajectoryPreview.endpoint.x, 300,
      'the command passes through smoke and vision-blocking projectile geometry');
    assert.equal(created.effect.expiresAt, 180_000, 'the projectile survives until impact');
    assert.equal(createHostTrophyCommandProjectile({
      id: 'jammed-player-pulse',
      player: { ...player, jammedUntil: 2_000 },
      trophy,
      target: { x: 300, y: 100 },
      mapObjects: [],
      visionObjects: [],
      now: 1_000,
      matchEndsAt: 180_000,
      mapWidth: 1_000,
      mapHeight: 700,
    }), null, 'a jammed owner cannot command the Trophy');
    assert.equal(createHostTrophyCommandProjectile({
      id: 'jammed-trophy-pulse',
      player,
      trophy: { ...trophy, jammedUntil: 2_000 },
      target: { x: 300, y: 100 },
      mapObjects: [],
      visionObjects: [],
      now: 1_000,
      matchEndsAt: 180_000,
      mapWidth: 1_000,
      mapHeight: 700,
    }), null, 'a jammed Trophy cannot fire its command');
  });

  it('clears enemy gadgets and fields only within command range and line of sight', () => {
    const pulse = {
      id: 'pulse', type: TROPHY_SYSTEM_COMMAND_EFFECT_ID, gadgetId: TROPHY_SYSTEM_ID,
      team: 'red', x: 0, y: 0, radius: TROPHY_SYSTEM_COMMAND_RADIUS,
    };
    const gadgetEffects = [
      { id: 'mine', gadgetId: PROXIMITY_MINE_ID, type: 'mine', team: 'blue', x: 30, y: 0, expiresAt: 30_000 },
      { id: 'cryo', gadgetId: CRYO_GRENADE_ID, type: 'cryo', team: 'blue', x: 100, y: 0, expiresAt: 30_000 },
      { id: 'fire', gadgetId: MOLOTOV_ID, type: 'molotov', team: 'blue', x: 140, y: 0, expiresAt: 30_000 },
      { id: 'bio', gadgetId: BIO_FIELD_ID, type: BIO_FIELD_ID, team: 'blue', x: 160, y: 0, expiresAt: 30_000 },
      { id: 'friendly', gadgetId: PROXIMITY_MINE_ID, type: 'mine', team: 'red', x: 40, y: 0, expiresAt: 30_000 },
      { id: 'far', gadgetId: PROXIMITY_MINE_ID, type: 'mine', team: 'blue', x: 201, y: 0, expiresAt: 30_000 },
    ];
    const smokes = [
      { id: 'enemy-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', team: 'blue', x: 80, y: 0,
        blocksVision: true, expiresAt: 30_000 },
      { id: 'friendly-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', team: 'red', x: 80, y: 0, expiresAt: 30_000 },
    ];
    const visible = findTrophyCommandClearedEffects({
      pulse, gadgetEffects, smokes, visionObjects: [], now: 10_000,
    });
    assert.deepEqual([...visible.gadgetEffectIds].sort(), ['bio', 'cryo', 'fire', 'mine']);
    assert.deepEqual([...visible.smokeIds], ['enemy-smoke']);

    const throughWall = findTrophyCommandClearedEffects({
      pulse,
      gadgetEffects,
      smokes,
      visionObjects: [{ shape: 'segment', x1: 60, y1: -20, x2: 60, y2: 20, blocksVision: true }],
      now: 10_000,
    });
    assert.deepEqual([...throughWall.gadgetEffectIds], ['mine']);
    assert.deepEqual([...throughWall.smokeIds], []);
  });

  it('clears fields when any in-range part is visible, but not when the whole field is occluded', () => {
    const pulse = {
      id: 'pulse-surface-los', type: TROPHY_SYSTEM_COMMAND_EFFECT_ID, gadgetId: TROPHY_SYSTEM_ID,
      team: 'red', x: 0, y: 0, radius: TROPHY_SYSTEM_COMMAND_RADIUS,
    };
    const effects = [
      {
        id: 'molotov-zone', gadgetId: MOLOTOV_ID, type: 'molotov', team: 'blue',
        x: 100, y: 0, radius: 60, expiresAt: 30_000,
      },
      {
        id: 'smoke-hidden-mine', gadgetId: PROXIMITY_MINE_ID, type: 'mine', team: 'blue',
        x: 120, y: 100, radius: 12, expiresAt: 30_000,
      },
      {
        id: 'wall-hidden-mine', gadgetId: PROXIMITY_MINE_ID, type: 'mine', team: 'blue',
        x: 100, y: -100, radius: 12, expiresAt: 30_000,
      },
    ];
    const smoke = {
      id: 'pulse-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', role: 'vision-smoke',
      team: 'blue', x: 60, y: 100, radius: 30, blocksVision: true, expiresAt: 30_000,
    };
    const wall = {
      id: 'pulse-wall', shape: 'segment',
      x1: 50, y1: -60, x2: 50, y2: 20, blocksVision: true,
    };

    const cleared = findTrophyCommandClearedEffects({
      pulse,
      gadgetEffects: effects,
      smokes: [smoke],
      visionObjects: [wall, smoke],
      now: 10_000,
    });

    assert.deepEqual([...cleared.gadgetEffectIds].sort(), ['molotov-zone', 'smoke-hidden-mine']);
    assert.deepEqual([...cleared.smokeIds], ['pulse-smoke']);

    const rangeAndSight = findTrophyCommandClearedEffects({
      pulse: { ...pulse, x: 0, y: 0, radius: 100 },
      gadgetEffects: [
        { id: 'edge-in-range', gadgetId: MOLOTOV_ID, team: 'blue', x: 80, y: 0,
          radius: 40, expiresAt: 30_000 },
        { id: 'edge-out-of-range', gadgetId: MOLOTOV_ID, team: 'blue', x: 160, y: 0,
          radius: 30, expiresAt: 30_000 },
        { id: 'fully-occluded', gadgetId: MOLOTOV_ID, team: 'blue', x: 80, y: 200,
          radius: 10, expiresAt: 30_000 },
        { id: 'center-in-range', gadgetId: MOLOTOV_ID, team: 'blue', x: 80, y: 40,
          expiresAt: 30_000 },
      ],
      visionObjects: [
        { shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20, blocksVision: true },
        { id: 'full-wall', shape: 'segment', x1: 50, y1: 100, x2: 50, y2: 300, blocksVision: true },
      ],
      now: 10_000,
    });
    assert.deepEqual([...rangeAndSight.gadgetEffectIds].sort(), ['center-in-range', 'edge-in-range']);
  });

  it('creates a Vine Trap with its configured arm, latch, and recharge durations', () => {
    const definition = GADGET_DEFINITIONS[VINE_TRAP_ID];
    const created = createHostGadgetEffect({ id: 'vine-1', definition, player, trajectory,
      now: 1_000, matchEndsAt: 180_000 });
    assert.equal(created.effect.type, VINE_TRAP_ID);
    assert.equal(created.effect.armedAt, 1_000 + VINE_TRAP_ARMING_DURATION_MS);
    assert.equal(created.effect.triggerRadius, GADGET_DEFINITIONS[PROXIMITY_MINE_ID].triggerRadius);
    assert.equal(created.effect.latchDurationMs, definition.latchDurationMs);
    assert.equal(created.effect.rechargeDurationMs, definition.rechargeDurationMs);
    assert.equal(created.effect.expiresAt, 180_000);
  });

  it('retains Molotov damage rate and duration in the host effect model', () => {
    const created = createHostGadgetEffect({ id: 'molotov-1', definition: GADGET_DEFINITIONS[MOLOTOV_ID],
      player, trajectory, now: 1_000, matchEndsAt: 180_000 });
    assert.equal(created.effect.type, 'molotov');
    assert.equal(created.effect.damagePerSecond, GADGET_DEFINITIONS[MOLOTOV_ID].damagePerSecond);
    assert.equal(created.effect.expiresAt, created.detonatesAt + GADGET_DEFINITIONS[MOLOTOV_ID].effectDurationMs);
  });

  it('delays Flash detonation until one second after the grenade reaches its endpoint', () => {
    const created = createHostGadgetEffect({ id: 'flash-1', definition: GADGET_DEFINITIONS[FLASH_GRENADE_ID],
      player, trajectory, now: 1_000, matchEndsAt: 180_000 });
    const flightTime = Math.max(16, 900 / getGadgetProjectileSpeed(GADGET_DEFINITIONS[FLASH_GRENADE_ID]) * 1_000);
    assert.equal(created.landedAt, 1_000 + flightTime);
    assert.equal(created.detonatesAt, 1_000 + flightTime + GADGET_DEFINITIONS[FLASH_GRENADE_ID].detonationDelayMs);
    assert.equal(created.effect.startedAt, created.detonatesAt);
    assert.equal(created.effect.expiresAt, created.detonatesAt + GADGET_DEFINITIONS[FLASH_GRENADE_ID].effectDurationMs);
    assert.equal(created.effect.minBlindDurationMs, GADGET_DEFINITIONS[FLASH_GRENADE_ID].minBlindDurationMs);
    assert.equal(created.effect.maxBlindDurationMs, GADGET_DEFINITIONS[FLASH_GRENADE_ID].maxBlindDurationMs);
  });

  it('creates a one-minute-cooldown Jammer with a one-second impact fuse and 200-unit radius', () => {
    const definition = GADGET_DEFINITIONS[JAMMER_GRENADE_ID];
    const created = createHostGadgetEffect({
      id: 'jammer-1', definition, player, trajectory, now: 1_000, matchEndsAt: 180_000,
    });
    assert.equal(definition.rarity, 'unique');
    assert.equal(definition.charges, 1);
    assert.equal(definition.cooldownMs, 60_000);
    assert.equal(definition.effectRadius, JAMMER_GRENADE_RADIUS);
    assert.equal(created.effect.type, 'jammer');
    assert.equal(created.effect.detonatesAt, created.landedAt + 1_000);
    assert.equal(created.effect.startedAt, created.detonatesAt);
    assert.equal(created.effect.expiresAt, created.detonatesAt + JAMMER_GRENADE_VISUAL_DURATION_MS);
  });

  it('jams only enemy players and deployed gadgets caught in the blast, with no line-of-sight check', () => {
    const enemy = { id: 'enemy', team: 'blue', alive: true, health: 100, x: 199, y: 0 };
    const friendly = { id: 'friendly', team: 'red', alive: true, health: 100, x: 0, y: 0 };
    const camera = { id: 'camera', type: 'spy-camera', team: 'blue', x: 0, y: 199, expiresAt: 30_000 };
    const mine = { id: 'mine', type: 'mine', team: 'blue', x: 100, y: 0, expiresAt: 30_000 };
    const trap = { id: 'trap', type: VINE_TRAP_ID, team: 'blue', x: -100, y: 0, expiresAt: 30_000 };
    const trophy = { id: 'trophy', type: TROPHY_SYSTEM_ID, team: 'blue', x: 0, y: -100, expiresAt: 30_000 };
    const sonar = { id: 'sonar', type: 'sonar-projectile', gadgetId: SONAR_ID,
      team: 'blue', x: 0, y: 0, expiresAt: 30_000 };
    const friendlyCamera = { id: 'friendly-camera', type: 'spy-camera', team: 'red',
      x: 0, y: 0, expiresAt: 30_000 };
    const result = applyHostJammerDetonation({
      jammer: { id: 'jammer', gadgetId: JAMMER_GRENADE_ID, team: 'red', x: 0, y: 0 },
      players: [enemy, friendly],
      gadgetEffects: [camera, mine, trap, trophy, sonar, friendlyCamera],
      now: 10_000,
    });
    assert.deepEqual(result, {
      playerIds: ['enemy'],
      gadgetIds: ['camera', 'mine', 'trap', 'trophy', 'sonar'],
    });
    assert.equal(enemy.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(friendly.jammedUntil, undefined);
    assert.equal(camera.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(camera.disabledUntil, camera.jammedUntil);
    assert.equal(camera.expiresAt, 30_000, 'the disabled camera continues consuming its battery');
    assert.equal(mine.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(trap.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(trophy.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(sonar.jammedUntil, 10_000 + JAMMER_GRENADE_DURATION_MS);
    assert.equal(friendlyCamera.jammedUntil, undefined);
  });
});
