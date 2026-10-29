import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculateGadgetTrajectory,
  calculateSmokeTrajectory,
  BIO_FIELD_CHARGES,
  BIO_FIELD_COOLDOWN_MS,
  BIO_FIELD_EFFECT_DURATION_MS,
  BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER,
  BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER,
  BIO_FIELD_ID,
  CRYO_EFFECT_DURATION_MS,
  CRYO_GRENADE_ID,
  CRYO_MOVEMENT_SPEED_MULTIPLIER,
  DEFAULT_GADGET_THROW_COLLISION_RADIUS,
  DEFAULT_GADGET_THROW_RANGE,
  DEFAULT_GADGET_EFFECT_RADIUS,
  DEFAULT_GADGET_THROW_SPEED,
  FLASH_GRENADE_DETONATION_DELAY_MS,
  FLASH_GRENADE_ID,
  FLASH_GRENADE_MAX_BLIND_DURATION_MS,
  FLASH_GRENADE_MIN_BLIND_DURATION_MS,
  FLASH_GRENADE_RADIUS,
  GADGET_DEFINITIONS,
  getGadgetProjectileSpeed,
  applyFlashBlindness,
  getFlashBlindDurationMs,
  getGadgetMovementScale,
  getGadgetWeaponTurnScale,
  getGadgetThrowOrigin,
  KATANA_COOLDOWN_MS,
  KATANA_DASH_HIT_RADIUS,
  KATANA_DASH_MAX_DISTANCE,
  KATANA_ID,
  advanceKatanaChargeRecharge,
  advancePerChargeGadgetRecharges,
  calculateKatanaDash,
  refundKatanaCharge,
  queueKatanaChargeRecharge,
  queuePerChargeGadgetRecharge,
  isFlashAffectingPlayer,
  isPlayerFlashBlinded,
  MOLOTOV_DAMAGE_PER_SECOND,
  MOLOTOV_EFFECT_DURATION_MS,
  MOLOTOV_ID,
  SPY_CAMERA_ID,
  ORBITAL_STRIKE_COOLDOWN_MS,
  ORBITAL_STRIKE_ID,
  ORBITAL_STRIKE_RADIUS,
  ORBITAL_STRIKE_WARNING_DURATION_MS,
  advanceOrbitalStrikeCooldown,
  queueOrbitalStrikeRecharge,
  PROXIMITY_MINE_EXPLOSION_DAMAGE,
  PROXIMITY_MINE_HIT_RADIUS,
  PROXIMITY_MINE_BODY_RADIUS,
  PROXIMITY_MINE_ID,
  PROXIMITY_MINE_THROW_COLLISION_RADIUS,
  PROXIMITY_MINE_TRIGGER_RADIUS,
  PROXIMITY_MINE_THROW_RANGE,
  PROXIMITY_MINE_THROW_SPEED,
  SMOKE_GRENADE_ID,
  SMOKE_GRENADE_EFFECT_DURATION_MS,
  SONAR_ID,
  SONAR_PROJECTILE_RADIUS,
  TROPHY_SYSTEM_COMMAND_COOLDOWN_MS,
  TROPHY_SYSTEM_COMMAND_RADIUS,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_THROW_COLLISION_RADIUS,
  VINE_TRAP_ARMING_DURATION_MS,
  VINE_TRAP_ID,
  VINE_TRAP_LATCH_DURATION_MS,
  VINE_TRAP_RECHARGE_DURATION_MS,
  advanceVineTrapRecharge,
  startVineTrapRecharge,
} from '../../shared/GadgetModel.js';
import { circleOverlapsMapObjects } from '../../shared/MapGeometry.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../shared/ProjectileModel.js';
import { createVision, isPointVisible } from '../../shared/VisionModel.js';

describe('smoke gadget model', () => {
  it('uses bullet-sized collision for thrown projectiles without changing their visual sizes', () => {
    const bulletRadius = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.radius;
    assert.equal(DEFAULT_GADGET_THROW_COLLISION_RADIUS, bulletRadius);
    for (const gadget of Object.values(GADGET_DEFINITIONS)) {
      if (!Number.isFinite(gadget.throwRange)) continue;
      const expectedRadius = gadget.id === TROPHY_SYSTEM_ID
        ? TROPHY_SYSTEM_THROW_COLLISION_RADIUS : bulletRadius;
      assert.equal(gadget.throwCollisionRadius ?? DEFAULT_GADGET_THROW_COLLISION_RADIUS,
        expectedRadius, `${gadget.name} uses its expected collision radius`);
    }
    assert.equal(GADGET_DEFINITIONS[SONAR_ID].effectRadius, SONAR_PROJECTILE_RADIUS);
    assert.ok(TROPHY_SYSTEM_THROW_COLLISION_RADIUS > TROPHY_SYSTEM_BODY_RADIUS);
  });

  it('defines Trophy as a one-use, match-long 200-health device with a rechargeable command', () => {
    const trophy = GADGET_DEFINITIONS[TROPHY_SYSTEM_ID];
    assert.equal(trophy.rarity, 'unique');
    assert.equal(trophy.alwaysAvailableInLoadoutShop, true);
    assert.equal(trophy.charges, 1);
    assert.equal(trophy.persistsUntilMatchEnd, true);
    assert.equal(trophy.effectDurationMs, undefined);
    assert.equal(trophy.health, TROPHY_SYSTEM_HEALTH);
    assert.equal(TROPHY_SYSTEM_HEALTH, 200);
    assert.equal(TROPHY_SYSTEM_COMMAND_RADIUS, 200);
    assert.equal(TROPHY_SYSTEM_COMMAND_COOLDOWN_MS, 30_000);
    assert.equal(trophy.throwRange, PROXIMITY_MINE_THROW_RANGE);
    assert.equal(trophy.throwSpeed, PROXIMITY_MINE_THROW_SPEED);
    assert.equal(trophy.throwCollisionRadius, TROPHY_SYSTEM_THROW_COLLISION_RADIUS);
    assert.equal(trophy.maxBounces, 0);
  });

  it('halves every gadget throw speed except Sonar', () => {
    for (const gadget of Object.values(GADGET_DEFINITIONS)) {
      if (!Number.isFinite(gadget.throwSpeed)) continue;
      const expected = gadget.id === SONAR_ID ? gadget.throwSpeed : gadget.throwSpeed / 2;
      assert.equal(getGadgetProjectileSpeed(gadget), expected, gadget.id);
    }
  });

  it('defines Katana as a one-charge unique gadget with a 60-second cooldown and bounded dash', () => {
    const katana = GADGET_DEFINITIONS[KATANA_ID];
    assert.equal(katana.rarity, 'unique');
    assert.equal(katana.alwaysAvailableInLoadoutShop, true);
    assert.equal(katana.charges, 1);
    assert.equal(katana.cooldownMs, KATANA_COOLDOWN_MS);
    assert.equal(katana.dashDistance, KATANA_DASH_MAX_DISTANCE);
    assert.equal(katana.hitRadius, KATANA_DASH_HIT_RADIUS);
  });

  it('clamps Katana dashes to 100 units and stops before movement-blocking walls', () => {
    const dash = calculateKatanaDash({ x: 100, y: 100 }, { x: 500, y: 100 }, [], 1_000, 700);
    assert.equal(dash.distance, KATANA_DASH_MAX_DISTANCE);
    assert.deepEqual(dash.end, { x: 200, y: 100 });

    const wall = { shape: 'segment', x1: 150, y1: 0, x2: 150, y2: 200, blocksMovement: true };
    const wallLimitedDash = calculateKatanaDash({ x: 100, y: 100 }, { x: 500, y: 100 },
      [wall], 1_000, 700);
    assert.ok(wallLimitedDash.end.x < 141);
    assert.ok(wallLimitedDash.distance < 41);
  });

  it('recharges Katana after 60 seconds alive and refunds its charge immediately on a kill', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: KATANA_ID,
      gadgetCount: 0,
      gadgetCounts: { [KATANA_ID]: 0 },
    };
    assert.equal(queueKatanaChargeRecharge(player), true);
    assert.equal(advanceKatanaChargeRecharge(player, KATANA_COOLDOWN_MS - 1), 0);
    player.alive = false;
    assert.equal(advanceKatanaChargeRecharge(player, 1), 0);
    player.alive = true;
    assert.equal(refundKatanaCharge(player), true);
    assert.equal(player.gadgetCount, 1);
    assert.deepEqual(player.gadgetChargeRechargeRemainingMs[KATANA_ID], []);
    assert.equal(advanceKatanaChargeRecharge(player, KATANA_COOLDOWN_MS), 0,
      'a refunded charge must not retain the spent-charge timer');

    player.gadgetCounts[KATANA_ID] = 0;
    player.gadgetCount = 0;
    assert.equal(queueKatanaChargeRecharge(player), true);
    assert.equal(advanceKatanaChargeRecharge(player, KATANA_COOLDOWN_MS - 1), 0);
    assert.equal(player.gadgetCount, 0);
    assert.equal(advanceKatanaChargeRecharge(player, 1), 1);
    assert.equal(player.gadgetCount, 1);
  });

  it('defines Orbital Strike as a smaller-radius unique gadget', () => {
    const strike = GADGET_DEFINITIONS[ORBITAL_STRIKE_ID];
    assert.equal(strike.rarity, 'unique');
    assert.equal(strike.alwaysAvailableInLoadoutShop, true);
    assert.equal(strike.charges, 1);
    assert.equal(strike.effectRadius, ORBITAL_STRIKE_RADIUS);
    assert.ok(strike.effectRadius < DEFAULT_GADGET_EFFECT_RADIUS);
    assert.equal(strike.warningDurationMs, ORBITAL_STRIKE_WARNING_DURATION_MS);
    assert.equal(strike.cooldownMs, ORBITAL_STRIKE_COOLDOWN_MS);
  });

  it('recharges Orbital Strike after sixty seconds alive and pauses the timer while dead', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: ORBITAL_STRIKE_ID,
      gadgetCount: 0,
      gadgetCounts: { [ORBITAL_STRIKE_ID]: 0 },
      orbitalStrikeCooldownRemainingMs: ORBITAL_STRIKE_COOLDOWN_MS,
    };

    assert.equal(advanceOrbitalStrikeCooldown(player, 30_000), false);
    assert.equal(player.orbitalStrikeCooldownRemainingMs, 30_000);
    player.alive = false;
    assert.equal(advanceOrbitalStrikeCooldown(player, 30_000), false);
    assert.equal(player.orbitalStrikeCooldownRemainingMs, 30_000);
    player.alive = true;
    assert.equal(advanceOrbitalStrikeCooldown(player, 29_999), false);
    assert.equal(advanceOrbitalStrikeCooldown(player, 1), true);
    assert.equal(player.orbitalStrikeCooldownRemainingMs, 0);
    assert.equal(player.gadgetCounts[ORBITAL_STRIKE_ID], 1);
    assert.equal(player.gadgetCount, 1);
  });

  it('publishes the Orbital Strike cooldown as soon as its recharge is queued', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: ORBITAL_STRIKE_ID,
      gadgetCount: 0,
      gadgetCounts: { [ORBITAL_STRIKE_ID]: 0 },
    };
    assert.equal(queueOrbitalStrikeRecharge(player), true);
    assert.equal(player.orbitalStrikeCooldownRemainingMs, ORBITAL_STRIKE_COOLDOWN_MS);
    assert.equal(queueOrbitalStrikeRecharge(null), false);
  });

  it('defines Vine Trap with the mine radius, a one-second arm, and a ten-second recharge', () => {
    const trap = GADGET_DEFINITIONS[VINE_TRAP_ID];
    assert.equal(trap.rarity, 'unique');
    assert.equal(trap.alwaysAvailableInLoadoutShop, true);
    assert.equal(trap.charges, 1);
    assert.equal(trap.triggerOnEnemyProximity, true);
    assert.equal(trap.triggerRadius, PROXIMITY_MINE_TRIGGER_RADIUS);
    assert.equal(trap.armingDurationMs, VINE_TRAP_ARMING_DURATION_MS);
    assert.equal(trap.latchDurationMs, VINE_TRAP_LATCH_DURATION_MS);
    assert.equal(trap.rechargeDurationMs, VINE_TRAP_RECHARGE_DURATION_MS);
    assert.equal(trap.throwRange, GADGET_DEFINITIONS[PROXIMITY_MINE_ID].throwRange);
    assert.equal(trap.maxBounces, 0);
  });

  it('starts Vine Trap recharge only for a living owner and restores its spent charge at the deadline', () => {
    const owner = {
      alive: true,
      health: 100,
      selectedGadgetId: VINE_TRAP_ID,
      gadgetCount: 0,
      gadgetCounts: { [VINE_TRAP_ID]: 0 },
    };
    assert.equal(startVineTrapRecharge(owner, 1_000), true);
    assert.equal(owner.vineTrapRechargeAt, 1_000 + VINE_TRAP_RECHARGE_DURATION_MS);
    assert.equal(advanceVineTrapRecharge(owner, owner.vineTrapRechargeAt - 1), false);
    assert.equal(advanceVineTrapRecharge(owner, owner.vineTrapRechargeAt), true);
    assert.equal(owner.gadgetCounts[VINE_TRAP_ID], 1);
    assert.equal(owner.gadgetCount, 1);

    owner.alive = false;
    assert.equal(startVineTrapRecharge(owner, 20_000), false);
    assert.equal(owner.vineTrapRechargeAt, null);
  });

  it('throws directly toward the reticle and clamps to its configured range', () => {
    const origin = { x: 10, y: 20 };
    const maximumRange = DEFAULT_GADGET_THROW_RANGE / 2;
    const trajectory = calculateSmokeTrajectory(origin,
      { x: origin.x + maximumRange * 2, y: origin.y }, [], { maximumRange });
    assert.equal(trajectory.bounces, 0);
    assert.deepEqual(trajectory.points, [origin, { x: origin.x + maximumRange, y: origin.y }]);
    assert.equal(GADGET_DEFINITIONS[SMOKE_GRENADE_ID].effectDurationMs, SMOKE_GRENADE_EFFECT_DURATION_MS);
    assert.ok(DEFAULT_GADGET_EFFECT_RADIUS > 0);
  });

  it('reflects its remaining travel from a wall', () => {
    const wall = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksProjectiles: true };
    const trajectory = calculateSmokeTrajectory({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall], {
      maximumRange: 100,
      collisionRadius: 0,
    });
    assert.equal(trajectory.bounces, 1);
    assert.equal(trajectory.points.length, 3);
    assert.ok(Math.abs(trajectory.points[1].x - 50) < 1e-6);
    assert.ok(Math.abs(trajectory.endpoint.x) < 0.1);
  });

  it('ignores geometry that does not block projectiles', () => {
    const nonBlocking = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksProjectiles: false };
    const trajectory = calculateSmokeTrajectory({ x: 0, y: 0 }, { x: 100, y: 0 }, [nonBlocking], {
      maximumRange: 100,
      collisionRadius: 0,
    });
    assert.equal(trajectory.bounces, 0);
    assert.deepEqual(trajectory.endpoint, { x: 100, y: 0 });
  });

  it('uses a smoke circle as a vision blocker', () => {
    const smoke = {
      id: 'smoke-test',
      shape: 'circle',
      role: 'vision-smoke',
      x: 50,
      y: 0,
      radius: 10,
      blocksMovement: false,
      blocksProjectiles: false,
      blocksVision: true,
    };
    const vision = createVision({ x: 0, y: 0 }, 0, [smoke], 120, 100, Math.PI / 4, 100);
    assert.equal(isPointVisible({ x: 30, y: 0 }, vision, [smoke]), true);
    assert.equal(isPointVisible({ x: 80, y: 0 }, vision, [smoke]), false);
  });

  it('configures Molotov and Cryo as same-radius, non-vision-blocking status circles', () => {
    const molotov = GADGET_DEFINITIONS[MOLOTOV_ID];
    const cryo = GADGET_DEFINITIONS[CRYO_GRENADE_ID];
    assert.equal(molotov.effectRadius, DEFAULT_GADGET_EFFECT_RADIUS);
    assert.equal(molotov.effectDurationMs, MOLOTOV_EFFECT_DURATION_MS);
    assert.equal(molotov.damagePerSecond, MOLOTOV_DAMAGE_PER_SECOND);
    assert.equal(molotov.blocksVision, false);
    assert.equal(cryo.effectRadius, DEFAULT_GADGET_EFFECT_RADIUS);
    assert.equal(cryo.effectDurationMs, CRYO_EFFECT_DURATION_MS);
    assert.equal(cryo.movementSpeedMultiplier, CRYO_MOVEMENT_SPEED_MULTIPLIER);
    assert.equal(cryo.blocksVision, false);

    const objects = [molotov, cryo].map((gadget, index) => ({
      shape: 'circle', x: 40 + index * 40, y: 0, radius: gadget.effectRadius,
      blocksVision: gadget.blocksVision,
    }));
    const vision = createVision({ x: 0, y: 0 }, 0, objects, 300, 100, Math.PI / 4, 300);
    assert.equal(isPointVisible({ x: 180, y: 0 }, vision, objects), true);
  });

  it('defines Bio Field as a two-charge, non-bouncing unique status gadget', () => {
    const bioField = GADGET_DEFINITIONS[BIO_FIELD_ID];
    assert.equal(bioField.rarity, 'unique');
    assert.equal(bioField.alwaysAvailableInLoadoutShop, true);
    assert.equal(bioField.charges, BIO_FIELD_CHARGES);
    assert.equal(bioField.cooldownMs, BIO_FIELD_COOLDOWN_MS);
    assert.equal(bioField.effectDurationMs, BIO_FIELD_EFFECT_DURATION_MS);
    assert.equal(bioField.effectRadius, DEFAULT_GADGET_EFFECT_RADIUS);
    assert.equal(bioField.throwRange, DEFAULT_GADGET_THROW_RANGE);
    assert.equal(bioField.maxBounces, 0);
    assert.equal(bioField.blocksVision, false);
    assert.match(bioField.description, /allies move 30% faster, enemies 30% slower/);
  });

  it('recharges Bio Field charges one at a time every 60 seconds', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: BIO_FIELD_ID,
      gadgetCounts: { [BIO_FIELD_ID]: 0 },
      gadgetChargeRechargeRemainingMs: {},
    };
    assert.equal(queuePerChargeGadgetRecharge(
      player, BIO_FIELD_ID, BIO_FIELD_COOLDOWN_MS, BIO_FIELD_CHARGES,
    ), true);
    assert.equal(advancePerChargeGadgetRecharges(player, BIO_FIELD_ID, BIO_FIELD_COOLDOWN_MS, {
      cooldownMs: BIO_FIELD_COOLDOWN_MS,
      maximumCharges: BIO_FIELD_CHARGES,
    }), 1);
    assert.equal(player.gadgetCounts[BIO_FIELD_ID], 1);
    assert.equal(player.gadgetChargeRechargeRemainingMs[BIO_FIELD_ID][0], BIO_FIELD_COOLDOWN_MS);
    assert.equal(advancePerChargeGadgetRecharges(player, BIO_FIELD_ID, BIO_FIELD_COOLDOWN_MS, {
      cooldownMs: BIO_FIELD_COOLDOWN_MS,
      maximumCharges: BIO_FIELD_CHARGES,
    }), 1);
    assert.equal(player.gadgetCounts[BIO_FIELD_ID], BIO_FIELD_CHARGES);
  });

  it('configures a smaller proximity mine with a short throw and unchanged detection radius', () => {
    const mine = GADGET_DEFINITIONS[PROXIMITY_MINE_ID];
    assert.equal(mine.triggerRadius, PROXIMITY_MINE_TRIGGER_RADIUS);
    assert.equal(mine.throwRange, PROXIMITY_MINE_THROW_RANGE);
    assert.equal(mine.throwSpeed, PROXIMITY_MINE_THROW_SPEED);
    assert.equal(mine.maxBounces, 0);
    assert.equal(mine.explosionDamage, PROXIMITY_MINE_EXPLOSION_DAMAGE);
    assert.equal(mine.hitRadius, PROXIMITY_MINE_HIT_RADIUS);
    assert.equal(mine.hitRadius, 4, 'the physical mine hitbox is half its previous radius');
    assert.equal(mine.throwCollisionRadius, PROXIMITY_MINE_THROW_COLLISION_RADIUS);
    assert.equal(mine.throwCollisionRadius, DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.radius,
      'the thrown mine uses the bullet collision radius');
    assert.equal(PROXIMITY_MINE_BODY_RADIUS, 4, 'the rendered body uses the reduced physical radius');
    assert.equal(mine.triggerOnEnemyProximity, true);
    assert.equal(mine.persistsUntilTriggered, true);
    assert.ok(mine.throwRange < DEFAULT_GADGET_THROW_RANGE);
    assert.ok(mine.throwSpeed > DEFAULT_GADGET_THROW_SPEED);
    assert.ok(mine.triggerRadius > 0);

    const trajectory = calculateGadgetTrajectory({ x: 10, y: 20 }, { x: 1_000, y: 20 }, [], {
      maximumRange: mine.throwRange,
      collisionRadius: mine.throwCollisionRadius,
      maximumBounces: mine.maxBounces,
    });
    assert.equal(trajectory.distance, mine.throwRange);
    assert.equal(trajectory.endpoint.x, 10 + mine.throwRange);
    assert.equal(mine.triggerRadius, PROXIMITY_MINE_TRIGGER_RADIUS,
      'the configured radius is the same value shown by the trajectory guide');
  });

  it('configures a long-range flash grenade with distance-scaled blindness', () => {
    const flash = GADGET_DEFINITIONS[FLASH_GRENADE_ID];
    assert.equal(flash.effectType, 'flash');
    assert.equal(flash.effectRadius, FLASH_GRENADE_RADIUS);
    assert.equal(flash.detonationDelayMs, FLASH_GRENADE_DETONATION_DELAY_MS);
    assert.equal(flash.minBlindDurationMs, FLASH_GRENADE_MIN_BLIND_DURATION_MS);
    assert.equal(flash.maxBlindDurationMs, FLASH_GRENADE_MAX_BLIND_DURATION_MS);
    assert.equal(flash.blocksVision, false);
    const effect = { ...flash, type: 'flash', x: 100, y: 100, radius: FLASH_GRENADE_RADIUS };
    assert.equal(getFlashBlindDurationMs(effect, { x: 100, y: 100 }), FLASH_GRENADE_MAX_BLIND_DURATION_MS);
    assert.equal(getFlashBlindDurationMs(effect, { x: 250, y: 100 }), 3_750);
    assert.equal(getFlashBlindDurationMs(effect, { x: 400, y: 100 }), FLASH_GRENADE_MIN_BLIND_DURATION_MS);
    assert.equal(getFlashBlindDurationMs(effect, { x: 401, y: 100 }), 0);
  });

  it('checks flash coverage at detonation through the full flash radius', () => {
    const effect = {
      type: 'flash',
      x: 0,
      y: 0,
      radius: FLASH_GRENADE_RADIUS,
      startedAt: 1_000,
      expiresAt: 7_000,
    };
    const player = { x: 100, y: 0 };
    assert.equal(isFlashAffectingPlayer(effect, player, [], 1_000), true);
    assert.equal(isFlashAffectingPlayer(effect, player, [], 5_166), true);
    assert.equal(isFlashAffectingPlayer(effect, player, [], 5_167), false);
    assert.equal(isFlashAffectingPlayer(effect, player, [], 999), false);
    assert.equal(isFlashAffectingPlayer(effect, player, [], 7_000), false);

    const wall = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksVision: true };
    const prop = { shape: 'circle', x: 50, y: 0, radius: 10, blocksVision: true };
    const smoke = { shape: 'circle', role: 'vision-smoke', x: 50, y: 0, radius: 10, blocksVision: true };
    assert.equal(isFlashAffectingPlayer(effect, player, [wall], 1_000), false);
    assert.equal(isFlashAffectingPlayer(effect, player, [prop], 1_000), false);
    assert.equal(isFlashAffectingPlayer(effect, player, [smoke], 1_000), false);
    assert.equal(isFlashAffectingPlayer(effect, player, [{ ...wall, blocksVision: false }], 1_000), true);
  });

  it('keeps a player blinded for the full duration after leaving the flash area', () => {
    const effect = {
      type: 'flash',
      x: 0,
      y: 0,
      radius: FLASH_GRENADE_RADIUS,
      startedAt: 1_000,
      expiresAt: 6_000,
    };
    const closePlayer = { id: 'near', x: 0, y: 0, alive: true, health: 100 };
    const edgePlayer = { id: 'edge', x: FLASH_GRENADE_RADIUS, y: 0, alive: true, health: 100 };
    const blockedPlayer = { id: 'blocked', x: 100, y: 0, alive: true, health: 100 };
    const wall = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksVision: true };

    assert.deepEqual(applyFlashBlindness(effect, [closePlayer, edgePlayer], []), ['near', 'edge']);
    assert.deepEqual(applyFlashBlindness(effect, [blockedPlayer], [wall]), []);
    assert.equal(closePlayer.flashUntil, 6_000);
    assert.equal(edgePlayer.flashUntil, 3_500);
    closePlayer.x = 500;
    assert.equal(isPlayerFlashBlinded(closePlayer, 5_999), true);
    assert.equal(isPlayerFlashBlinded(closePlayer, 6_000), false);
    assert.equal(isPlayerFlashBlinded(edgePlayer, 3_499), true);
    assert.equal(isPlayerFlashBlinded(edgePlayer, 3_500), false);
    assert.equal(blockedPlayer.flashUntil, undefined);
  });

  it('disables spy cameras in flash radius only when they have line of sight', () => {
    const effect = {
      type: 'flash',
      x: 0,
      y: 0,
      radius: FLASH_GRENADE_RADIUS,
      startedAt: 1_000,
      expiresAt: 6_000,
    };
    const visibleCamera = {
      id: 'visible-camera',
      type: SPY_CAMERA_ID,
      x: 100,
      y: 0,
      expiresAt: 30_000,
    };
    const blockedCamera = { ...visibleCamera, id: 'blocked-camera' };
    const wall = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksVision: true };

    applyFlashBlindness(effect, [], [], [visibleCamera]);
    applyFlashBlindness(effect, [], [wall], [blockedCamera]);

    assert.equal(visibleCamera.disabledUntil,
      effect.startedAt + getFlashBlindDurationMs(effect, visibleCamera));
    assert.equal(blockedCamera.disabledUntil, undefined);
  });

  it('places a proximity mine at its first wall impact without bouncing', () => {
    const mine = GADGET_DEFINITIONS[PROXIMITY_MINE_ID];
    const wall = { shape: 'segment', x1: 50, y1: -100, x2: 50, y2: 100, blocksProjectiles: true };
    const trajectory = calculateGadgetTrajectory({ x: 0, y: 0 }, { x: 200, y: 0 }, [wall], {
      maximumRange: mine.throwRange,
      collisionRadius: mine.throwCollisionRadius,
      maximumBounces: mine.maxBounces,
    });

    assert.equal(trajectory.bounces, 0);
    assert.equal(trajectory.points.length, 2);
    assert.ok(Math.abs(trajectory.endpoint.x - (50 - mine.throwCollisionRadius)) < 1e-6);
    assert.equal(trajectory.endpoint.y, 0);
  });

  it('uses Cryo slow while inside its area and restores normal movement outside', () => {
    const definition = GADGET_DEFINITIONS[CRYO_GRENADE_ID];
    const now = 1_000;
    const cryo = {
      type: definition.effectType,
      x: 50,
      y: 50,
      radius: definition.effectRadius,
      movementScale: definition.movementSpeedMultiplier,
      expiresAt: now + definition.effectDurationMs,
    };
    assert.equal(getGadgetMovementScale({ x: 50 + definition.effectRadius / 2, y: 50 }, [cryo], now),
      definition.movementSpeedMultiplier);
    assert.equal(getGadgetMovementScale({ x: 50 + definition.effectRadius * 2, y: 50 }, [cryo], now), 1);
    assert.equal(getGadgetMovementScale({ x: 50, y: 50 }, [cryo], cryo.expiresAt), 1);
  });

  it('caps overlapping Bio Field effects and cancels opposite movement modifiers', () => {
    const now = 1_000;
    const bioField = {
      type: BIO_FIELD_ID, team: 'red', x: 50, y: 50, radius: 60, expiresAt: 9_000,
    };
    const secondFriendlyBioField = { ...bioField, id: 'second-friendly-bio-field' };
    const hostileBioField = { ...bioField, id: 'hostile-bio-field', team: 'blue' };
    const secondHostileBioField = { ...hostileBioField, id: 'second-hostile-bio-field' };
    const cryo = {
      type: 'cryo', x: 50, y: 50, radius: 60, movementScale: CRYO_MOVEMENT_SPEED_MULTIPLIER,
      expiresAt: 9_000,
    };
    const friendlyInField = { team: 'red', x: 50, y: 50 };
    const enemyInField = { team: 'blue', x: 50, y: 50 };
    assert.equal(getGadgetMovementScale(friendlyInField, [bioField], now),
      BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER);
    assert.equal(getGadgetMovementScale(enemyInField, [bioField], now),
      BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER);
    assert.equal(getGadgetMovementScale(enemyInField, [bioField, cryo], now),
      CRYO_MOVEMENT_SPEED_MULTIPLIER, 'Cryo takes precedence for an enemy in overlapping fields');
    assert.equal(getGadgetMovementScale(friendlyInField, [bioField, cryo], now), 1,
      'friendly Bio Field cancels Cryo without granting the Bio speed boost');
    assert.equal(getGadgetMovementScale(friendlyInField, [bioField, secondFriendlyBioField], now),
      BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER, 'friendly fields do not stack their speed boost');
    assert.equal(getGadgetMovementScale(friendlyInField, [hostileBioField, secondHostileBioField], now),
      BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER, 'hostile fields do not stack their slow');
    assert.equal(getGadgetMovementScale(friendlyInField, [bioField, hostileBioField], now), 1,
      'opposite Bio Fields cancel each other out');
    assert.equal(getGadgetMovementScale(enemyInField, [hostileBioField, bioField], now), 1,
      'opposite Bio Fields cancel each other out for either team');
    assert.equal(getGadgetWeaponTurnScale(enemyInField, [bioField], now),
      BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER);
    assert.equal(getGadgetWeaponTurnScale(enemyInField, [bioField, cryo], now),
      CRYO_MOVEMENT_SPEED_MULTIPLIER);
    assert.equal(getGadgetWeaponTurnScale(friendlyInField, [bioField, cryo], now), 1);
    assert.equal(getGadgetWeaponTurnScale(friendlyInField, [bioField, secondFriendlyBioField], now),
      BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER);
    assert.equal(getGadgetWeaponTurnScale(friendlyInField, [bioField, hostileBioField], now), 1);
  });

  it('uses the same bounded ricochet trajectory calculation for every gadget', () => {
    const target = { x: 200, y: 30 };
    const origin = { x: 10, y: 20 };
    assert.deepEqual(calculateGadgetTrajectory(origin, target, []), calculateSmokeTrajectory(origin, target, []));
  });

  it('launches from the leaned side and can clear a nearby edge that blocks an unleaned throw', () => {
    const player = { x: 100, y: 100, weaponLean: -1 };
    const target = { x: 200, y: 93 };
    const coverEdge = [{
      shape: 'rect', x: 105, y: 100, width: 1, height: 1,
      blocksProjectiles: true, blocksMovement: true,
    }];
    const origin = getGadgetThrowOrigin(player, target, coverEdge);
    const leanedPath = calculateGadgetTrajectory(origin, target, coverEdge);
    const unleanedPath = calculateGadgetTrajectory({ x: player.x, y: player.y }, target, coverEdge);

    assert.ok(origin.y < player.y, 'left lean displaces the throw origin to the left-hand side');
    assert.equal(leanedPath.bounces, 0, 'the leaned path clears the edge');
    assert.ok(unleanedPath.bounces > 0, 'the center-origin path collides with the edge');
  });

  it('keeps a leaned gadget origin outside projectile-blocking walls', () => {
    const player = { x: 100, y: 100, weaponLean: -1 };
    const target = { x: 200, y: 100 };
    const wall = [{
      shape: 'rect',
      x: 100,
      y: 92,
      width: 60,
      height: 2,
      blocksMovement: false,
      blocksProjectiles: true,
    }];
    const origin = getGadgetThrowOrigin(player, target, wall);
    const trajectory = calculateGadgetTrajectory(origin, target, wall, {
      collisionRadius: GADGET_DEFINITIONS[SMOKE_GRENADE_ID].throwCollisionRadius,
    });

    const clearance = GADGET_DEFINITIONS[SMOKE_GRENADE_ID].throwCollisionRadius;
    assert.equal(circleOverlapsMapObjects(origin, wall, clearance), false,
      'the launch center retains the bullet-sized throw collision clearance');
    assert.equal(trajectory.bounces, 0, 'the thrown gadget does not begin inside the wall');
  });
});