import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyHostPropDamage,
  applyGadgetAreaDamage,
  applyMolotovWorldEffects,
  applyTrophySystemDamage,
  findFirstKatanaDashTarget,
  getHostAimAngle,
  getHostShotAngle,
  preserveDestructiblePropState,
  resolveHostShotCollision,
} from '../../shared/HostCombatModel.js';
import {
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_ID,
  VINE_TRAP_ID,
} from '../../shared/GadgetModel.js';

const start = { x: 0, y: 0 };
const wall = { id: 'wall', shape: 'segment', x1: 60, y1: -20, x2: 60, y2: 20, blocksProjectiles: true };
const prop = { id: 'crate', shape: 'rect', x: 80, y: 0, width: 20, height: 20,
  role: 'destructible-prop', health: 300, maxHealth: 300, blocksProjectiles: true };

describe('host combat model', () => {
  it('selects the first living enemy intersected by a Katana dash, excluding teammates', () => {
    const laterEnemy = { id: 'enemy-later', team: 'blue', x: 185, y: 0, alive: true, health: 100 };
    const teammate = { id: 'teammate', team: 'red', x: 120, y: 0, alive: true, health: 100 };
    const firstEnemy = { id: 'enemy-first', team: 'blue', x: 155, y: 0, alive: true, health: 100 };
    const deadEnemy = { id: 'enemy-dead', team: 'blue', x: 125, y: 0, alive: false, health: 0 };
    const hit = findFirstKatanaDashTarget({
      start: { x: 100, y: 0 },
      end: { x: 200, y: 0 },
      players: [laterEnemy, teammate, deadEnemy, firstEnemy],
      ownerId: 'owner',
      ownerTeam: 'red',
    });

    assert.equal(hit.player, firstEnemy);
    assert.ok(hit.entryT < 0.5);
    assert.equal(findFirstKatanaDashTarget({
      start: { x: 100, y: 0 },
      end: { x: 200, y: 0 },
      players: [teammate],
      ownerId: 'owner',
      ownerTeam: 'red',
    }), null);
  });

  it('uses the already-limited owner aim direction for shots instead of turning it twice', () => {
    assert.equal(getHostAimAngle({ x: -1, y: -0.1 }), Math.atan2(-0.1, -1));
    assert.equal(getHostAimAngle({ x: 0, y: 0 }, 1.25), 1.25);
  });

  it('uses the owner-predicted shot angle within the weapon spread and rejects out-of-spread angles', () => {
    const predictedAngle = -Math.PI + 0.05;
    const aimDirection = { x: -1, y: 0 };
    assert.equal(getHostShotAngle(aimDirection, predictedAngle, 0.1, 0), predictedAngle);
    assert.equal(getHostShotAngle(aimDirection, 1, 0.1, 0), 0);
  });

  it('returns a miss endpoint when no actor, gadget, or map object blocks the shot', () => {
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, null);
    assert.equal(hit.target, null);
    assert.deepEqual(hit.end, { x: 200, y: 0 });
  });

  it('damages a prop when it is the first hit and reports its impact point', () => {
    const testProp = { ...prop };
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, mapObjects: [testProp], ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, 'object');
    assert.equal(hit.target.id, 'crate');
    assert.ok(hit.end.x <= 80);
    const firstHit = applyHostPropDamage(hit.target, 75);
    assert.equal(firstHit.applied, true);
    assert.equal(firstHit.health, 225);
    const destroyed = applyHostPropDamage(hit.target, 300);
    assert.equal(destroyed.health, 0);
    assert.equal(destroyed.destroyed, true);
    assert.equal(hit.target.blocksMovement, false);
    assert.equal(hit.target.blocksProjectiles, false);
    assert.equal(hit.target.blocksVision, false);
  });

  it('shares Molotov prop, mine, and Cryo interactions across simulation modes', () => {
    const molotov = {
      id: 'fire', type: 'molotov', x: 50, y: 0, radius: 60, damagePerSecond: 50,
      startedAt: 1_000, expiresAt: 9_000,
    };
    const mine = {
      id: 'mine', type: 'mine', triggerOnEnemyProximity: true, x: 115, y: 0,
      hitRadius: 5, armedAt: 5_000,
    };
    const crate = { ...prop, x: 100, y: 0, width: 20, height: 20, health: 100, maxHealth: 100 };
    const results = applyMolotovWorldEffects([molotov, mine], [crate], 1_000, 1_100);

    assert.equal(results.burns[0].damage, 5);
    assert.equal(crate.health, 95);
    assert.equal(results.damagedProps[0].health, 95);
    assert.equal(results.removedEffectIds.has(mine.id), true,
      'Molotovs destroy mines before their arming deadline');

    const cryo = { id: 'cryo', type: 'cryo', x: 60, y: 0, radius: 60, startedAt: 1_000, expiresAt: 20_000 };
    const extinguished = applyMolotovWorldEffects(
      [{ ...molotov, startedAt: 500 }, cryo], [crate], 1_000, 1_100,
    );
    assert.deepEqual(extinguished.burns, []);
    assert.equal(extinguished.removedEffectIds.has(molotov.id), true);
    assert.equal(crate.health, 95, 'an overlapping Cryo prevents further prop damage');
  });

  it('preserves prop damage and destruction when the same map is refreshed', () => {
    const baselineProp = { ...prop, health: 300, maxHealth: 300 };
    const damagedProp = { ...baselineProp, health: 225 };
    const refreshedProps = [{ ...baselineProp }];
    assert.equal(preserveDestructiblePropState([damagedProp], refreshedProps), true);
    assert.equal(refreshedProps[0].health, 225);

    const destroyedProp = { ...baselineProp, health: 0, blocksMovement: false };
    const refreshedDestroyedProps = [{ ...baselineProp }];
    assert.equal(preserveDestructiblePropState([destroyedProp], refreshedDestroyedProps), true);
    assert.equal(refreshedDestroyedProps[0].health, 0);
    assert.equal(refreshedDestroyedProps[0].blocksProjectiles, false);
    assert.equal(refreshedDestroyedProps[0].blocksVision, false);
  });

  it('stops at a player before a prop and never also damages the prop', () => {
    const victim = { id: 'p2', team: 'blue', x: 40, y: 0, radius: 9, alive: true, health: 100 };
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, mapObjects: [prop], players: [victim],
      ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, 'player');
    assert.equal(hit.target, victim);
    assert.ok(hit.end.x < victim.x);
  });

  it('uses the shared default player radius when actor snapshots omit radius', () => {
    const victim = { id: 'p2', team: 'blue', x: 40, y: 0, alive: true, health: 100 };
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, players: [victim],
      ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, 'player');
    assert.equal(hit.target, victim);
  });

  it('stops at a blocking wall before a player and prop', () => {
    const victim = { id: 'p2', team: 'blue', x: 100, y: 0, radius: 9, alive: true, health: 100 };
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, mapObjects: [wall, prop], players: [victim],
      ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, 'object');
    assert.equal(hit.target.id, 'wall');
    assert.ok(hit.end.x <= 60);
  });

  it('allows an opposing bullet to destroy a mine before farther collisions', () => {
    const mine = { id: 'mine', type: 'mine', triggerOnEnemyProximity: true, armed: true,
      team: 'blue', x: 35, y: 0, hitRadius: 6 };
    const hit = resolveHostShotCollision({ start, angle: 0, range: 200, mapObjects: [prop], gadgetEffects: [mine],
      ownerId: 'p1', ownerTeam: 'red' });
    assert.equal(hit.kind, 'gadget');
    assert.equal(hit.target.id, 'mine');
  });

  it('lets enemy bullets hit Spy Cameras but ignores friendly fire against them', () => {
    const camera = {
      id: 'camera', type: SPY_CAMERA_ID, team: 'blue', shape: 'circle',
      x: 35, y: 0, radius: 7,
    };
    const options = {
      start, angle: 0, range: 200, gadgetEffects: [camera],
      ownerId: 'p1', ownerTeam: 'red',
    };

    const hit = resolveHostShotCollision(options);
    assert.equal(hit.kind, 'gadget');
    assert.equal(hit.target, camera);
    assert.notEqual(resolveHostShotCollision({ ...options, ownerTeam: 'blue' }).kind, 'gadget');
  });

  it('lets enemy bullets destroy Trophy Systems but ignores friendly fire', () => {
    const trophy = {
      id: 'trophy', type: TROPHY_SYSTEM_ID, team: 'blue', shape: 'circle',
      x: 35, y: 0, radius: 8,
    };
    const options = {
      start, angle: 0, range: 200, gadgetEffects: [trophy],
      ownerId: 'p1', ownerTeam: 'red',
    };
    assert.equal(resolveHostShotCollision(options).target, trophy);
    assert.notEqual(resolveHostShotCollision({ ...options, ownerTeam: 'blue' }).kind, 'gadget');
  });

  it('damages Trophy Systems with gunfire until their health is depleted', () => {
    const trophy = { type: TROPHY_SYSTEM_ID, health: TROPHY_SYSTEM_HEALTH };
    assert.deepEqual(applyTrophySystemDamage(trophy, 30), {
      applied: true,
      health: TROPHY_SYSTEM_HEALTH - 30,
      destroyed: false,
    });
    assert.deepEqual(applyTrophySystemDamage(trophy, 30), {
      applied: true,
      health: TROPHY_SYSTEM_HEALTH - 60,
      destroyed: false,
    });
    for (let shot = 0; shot < 4; shot += 1) applyTrophySystemDamage(trophy, 30);
    assert.deepEqual(applyTrophySystemDamage(trophy, 30), {
      applied: true,
      health: 0,
      destroyed: true,
    });
  });

  it('destroys Spy Cameras and damages persistent Trophy Systems with Molotov fire', () => {
    const camera = {
      id: 'camera', type: SPY_CAMERA_ID, shape: 'circle', x: 50, y: 0, radius: 7, health: 50,
    };
    const trophy = {
      id: 'trophy', type: TROPHY_SYSTEM_ID, gadgetId: TROPHY_SYSTEM_ID,
      shape: 'circle', x: 50, y: 0, radius: 8, health: TROPHY_SYSTEM_HEALTH,
    };
    const molotov = {
      id: 'fire', type: 'molotov', x: 50, y: 0, radius: 60, damagePerSecond: 50,
      startedAt: 1_000, expiresAt: 9_000,
    };
    const result = applyMolotovWorldEffects([molotov, camera, trophy], [], 1_000, 2_000);

    assert.equal(camera.health, 0);
    assert.equal(trophy.health, TROPHY_SYSTEM_HEALTH - 50);
    assert.deepEqual(result.damagedGadgets.map(({ effect, destroyed }) => ({
      id: effect.id, destroyed,
    })), [
      { id: camera.id, destroyed: true },
      { id: trophy.id, destroyed: false },
    ]);
    assert.equal(result.removedEffectIds.has(camera.id), true);
    assert.equal(result.removedEffectIds.has(trophy.id), false);
    const laterFire = applyMolotovWorldEffects([molotov, trophy], [], 2_000, 5_000);
    assert.equal(trophy.health, 0);
    assert.equal(laterFire.removedEffectIds.has(trophy.id), true);
  });

  it('applies area damage to destructible props and every placed device type', () => {
    const props = [
      { id: 'crate', role: 'destructible-prop', shape: 'rect', x: 20, y: 0, width: 10, height: 10,
        health: 100, blocksMovement: true, blocksProjectiles: true, blocksVision: true },
    ];
    const effects = [
      { id: 'camera', type: SPY_CAMERA_ID, gadgetId: SPY_CAMERA_ID, x: 0, y: 0, radius: 7, health: 40 },
      { id: 'trophy', type: TROPHY_SYSTEM_ID, gadgetId: TROPHY_SYSTEM_ID,
        x: 10, y: 0, radius: 8, health: TROPHY_SYSTEM_HEALTH },
      { id: 'mine', type: 'mine', gadgetId: 'proximity-mine', x: 15, y: 0, hitRadius: 4 },
      { id: 'vine', type: VINE_TRAP_ID, gadgetId: VINE_TRAP_ID, x: 20, y: 0, hitRadius: 4 },
      { id: 'source', type: 'mine', gadgetId: 'proximity-mine', x: 0, y: 0, hitRadius: 4 },
    ];

    const result = applyGadgetAreaDamage(effects, props, { x: 0, y: 0 }, 20, 60, 'source');

    assert.equal(props[0].health, 40);
    assert.equal(effects[0].health, 0);
    assert.equal(effects[1].health, TROPHY_SYSTEM_HEALTH - 60);
    assert.deepEqual([...result.removedEffectIds].sort(), ['camera', 'mine', 'vine']);
    assert.equal(result.damagedProps[0].destroyed, false);
    assert.equal(effects.find((effect) => effect.id === 'source').health, undefined);
  });

  it('allows opposing shots during and after mine arming but ignores friendly shots', () => {
    const mine = { id: 'mine', type: 'mine', triggerOnEnemyProximity: true, armed: false,
      armedAt: 2_500, team: 'blue', x: 35, y: 0, hitRadius: 6 };
    const options = { start, angle: 0, range: 200, gadgetEffects: [mine], ownerId: 'p1', ownerTeam: 'red' };
    assert.equal(resolveHostShotCollision({ ...options, now: 2_499 }).kind, 'gadget');
    assert.equal(resolveHostShotCollision({ ...options, now: 2_500 }).kind, 'gadget');
    assert.notEqual(resolveHostShotCollision({ ...options, now: 2_499, ownerTeam: 'blue' }).kind, 'gadget');
    assert.notEqual(resolveHostShotCollision({
      ...options, now: 3_000, gadgetEffects: [{ ...mine, expiresAt: 3_000 }],
    }).kind, 'gadget');
  });

  it('allows enemy fire and Molotovs to destroy Vine Trap before it activates', () => {
    const trap = {
      id: 'vine-trap', type: VINE_TRAP_ID, triggerOnEnemyProximity: true,
      armedAt: 5_000, team: 'blue', x: 35, y: 0, hitRadius: 4, expiresAt: Number.MAX_SAFE_INTEGER,
    };
    const options = {
      start, angle: 0, range: 200, gadgetEffects: [trap],
      ownerId: 'p1', ownerTeam: 'red', now: 4_999,
    };
    assert.equal(resolveHostShotCollision(options).kind, 'gadget',
      'the trap can be destroyed during its arming window');
    assert.notEqual(resolveHostShotCollision({ ...options, ownerTeam: 'blue' }).kind, 'gadget',
      'friendly bullets do not destroy it');
    assert.notEqual(resolveHostShotCollision({
      ...options, gadgetEffects: [{ ...trap, latchedEnemyId: 'victim' }],
    }).kind, 'gadget', 'the activated trap is no longer shootable');

    const molotov = {
      id: 'fire', type: 'molotov', x: 35, y: 0, radius: 60, damagePerSecond: 50,
      startedAt: 1_000, expiresAt: 9_000,
    };
    const result = applyMolotovWorldEffects([molotov, trap], [], 1_000, 1_100);
    assert.equal(result.removedEffectIds.has(trap.id), true);
  });
});
