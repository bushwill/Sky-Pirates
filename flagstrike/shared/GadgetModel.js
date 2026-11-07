import {
  DEFAULT_PROJECTILE_DEFINITIONS,
  segmentMapObjectBoundsOverlap,
  segmentMapObjectEntryT,
  traceMapRay,
} from './ProjectileModel.js';
import { PLAYER_RADIUS } from './MovementModel.js';
import { resolveCircleMovement } from './MapGeometry.js';
import { isPointVisible, VISION_HALF_ANGLE } from './VisionModel.js';
import { getWeaponAimAngle, getWeaponMuzzlePosition } from './WeaponGeometry.js';

export const SMOKE_GRENADE_ID = 'smoke-grenade';
export const SMOKE_GRENADE_NAME = 'Smoke Grenade';
export const SMOKE_GRENADE_EFFECT_DURATION_MS = 15_000;
export const DEFAULT_GADGET_EFFECT_RADIUS = 60;
export const DEFAULT_GADGET_THROW_COLLISION_RADIUS = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.radius;
export const DEFAULT_GADGET_THROW_RANGE = 700;
export const DEFAULT_GADGET_MAX_BOUNCES = 4;
export const GADGET_SWITCH_DURATION_MS = 1_000;
export const DEFAULT_GADGET_THROW_SPEED = 1_800;
export const MOLOTOV_ID = 'molotov';
export const CRYO_GRENADE_ID = 'cryo-grenade';
export const PROXIMITY_MINE_ID = 'proximity-mine';
export const FLASH_GRENADE_ID = 'flash-grenade';
export const ORBITAL_STRIKE_ID = 'orbital-strike';
export const ORBITAL_STRIKE_RADIUS = 42;
export const ORBITAL_STRIKE_WARNING_DURATION_MS = 1_200;
export const ORBITAL_STRIKE_EXPLOSION_DAMAGE = 150;
export const ORBITAL_STRIKE_FIRE_DURATION_MS = 5_000;
export const ORBITAL_STRIKE_COOLDOWN_MS = 60_000;
export const SPY_CAMERA_ID = 'spy-camera';
export const SPY_CAMERA_RANGE = 300;
export const SPY_CAMERA_DURATION_MS = 60_000;
export const SPY_CAMERA_BODY_RADIUS = 7;
export const SPY_CAMERA_HEALTH = 50;
export const TROPHY_SYSTEM_ID = 'trophy-system';
export const TROPHY_SYSTEM_BODY_RADIUS = 8;
export const TROPHY_SYSTEM_THROW_COLLISION_RADIUS = TROPHY_SYSTEM_BODY_RADIUS + 1;
export const TROPHY_SYSTEM_HEALTH = 200;
export const GADGET_PROJECTILE_SPEED_MULTIPLIER = 0.5;
export const TROPHY_SYSTEM_COMMAND_EFFECT_ID = 'trophy-command-pulse';
export const TROPHY_SYSTEM_COMMAND_COOLDOWN_MS = 30_000;
export const TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED = 1_500;
export const TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS = 700;
export const TROPHY_INTERCEPT_VISUAL_DURATION_MS = 420;
export const VINE_TRAP_ID = 'vine-trap';
export const VINE_TRAP_ARMING_DURATION_MS = 1_000;
export const VINE_TRAP_LATCH_DURATION_MS = 5_000;
export const VINE_TRAP_RECHARGE_DURATION_MS = 10_000;
export const SONAR_ID = 'sonar';
export const SONAR_CHARGES = 2;
export const SONAR_CHARGE_COOLDOWN_MS = 30_000;
export const SONAR_PROJECTILE_RANGE = 800;
export const SONAR_PROJECTILE_SPEED = 250;
export const SONAR_PROJECTILE_RADIUS = 3;
export const SONAR_LISTENING_RADIUS = 300;
export const KATANA_ID = 'katana';
export const KATANA_DASH_MAX_DISTANCE = 100;
export const KATANA_DASH_HIT_RADIUS = 40;
export const KATANA_COOLDOWN_MS = 60_000;
export const KATANA_DASH_VISUAL_DURATION_MS = 260;
export const PROXIMITY_MINE_TRIGGER_RADIUS = 50;
export const PROXIMITY_MINE_BODY_RADIUS = 4;
export const PROXIMITY_MINE_HIT_RADIUS = PROXIMITY_MINE_BODY_RADIUS;
export const PROXIMITY_MINE_THROW_COLLISION_RADIUS = DEFAULT_GADGET_THROW_COLLISION_RADIUS;
export const PROXIMITY_MINE_ARMING_DURATION_MS = 2_500;
export const PROXIMITY_MINE_THROW_RANGE = 200;
export const PROXIMITY_MINE_THROW_SPEED = 3_000;
export const MOLOTOV_EFFECT_DURATION_MS = 8_000;
export const MOLOTOV_DAMAGE_PER_SECOND = 50;
export const CRYO_EFFECT_DURATION_MS = 20_000;
export const CRYO_MOVEMENT_SPEED_MULTIPLIER = 0.5;
export const PROXIMITY_MINE_EXPLOSION_DAMAGE = 150;
export const FLASH_GRENADE_RADIUS = 300;
export const FLASH_GRENADE_DETONATION_DELAY_MS = 1_000;
export const FLASH_GRENADE_MIN_BLIND_DURATION_MS = 2_500;
export const FLASH_GRENADE_MAX_BLIND_DURATION_MS = 5_000;
export const FLASH_GRENADE_VISUAL_DURATION_MS = 600;
export const JAMMER_GRENADE_ID = 'jammer-grenade';
export const JAMMER_GRENADE_RADIUS = 200;
export const JAMMER_GRENADE_DURATION_MS = 10_000;
export const JAMMER_GRENADE_VISUAL_DURATION_MS = 1_000;
export const JAMMER_GRENADE_COOLDOWN_MS = 60_000;
export const JAMMER_GRENADE_DETONATION_DELAY_MS = 1_000;
export const TROPHY_SYSTEM_COMMAND_RADIUS = JAMMER_GRENADE_RADIUS;
export const BIO_FIELD_ID = 'bio-field';
export const BIO_FIELD_CHARGES = 2;
export const BIO_FIELD_COOLDOWN_MS = 30_000;
export const BIO_FIELD_EFFECT_DURATION_MS = 8_000;
export const BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER = 1.3;
export const BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER = 0.7;
export const GADGET_DEFINITIONS = Object.freeze({
  [SMOKE_GRENADE_ID]: Object.freeze({
    id: SMOKE_GRENADE_ID,
    name: SMOKE_GRENADE_NAME,
    description: `Blocks vision · lasts ${SMOKE_GRENADE_EFFECT_DURATION_MS / 1000} seconds`,
    effectType: 'smoke',
    effectRole: 'vision-smoke',
    effectDurationMs: SMOKE_GRENADE_EFFECT_DURATION_MS,
    effectRadius: DEFAULT_GADGET_EFFECT_RADIUS,
    botAppeal: 1,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    blocksVision: true,
    colorHex: 0x85898d,
  }),
  [MOLOTOV_ID]: Object.freeze({
    id: MOLOTOV_ID,
    name: 'Molotov',
    description: `${MOLOTOV_DAMAGE_PER_SECOND} damage/s · lasts ${MOLOTOV_EFFECT_DURATION_MS / 1000} seconds`,
    effectType: 'molotov',
    effectRole: 'status-effect',
    effectDurationMs: MOLOTOV_EFFECT_DURATION_MS,
    effectRadius: DEFAULT_GADGET_EFFECT_RADIUS,
    botAppeal: 1,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    damagePerSecond: MOLOTOV_DAMAGE_PER_SECOND,
    blocksVision: false,
    colorHex: 0xf08a2b,
  }),
  [CRYO_GRENADE_ID]: Object.freeze({
    id: CRYO_GRENADE_ID,
    name: 'Cryo Grenade',
    description: `Slows movement by ${(1 - CRYO_MOVEMENT_SPEED_MULTIPLIER) * 100}% · lasts ${CRYO_EFFECT_DURATION_MS / 1000} seconds`,
    effectType: 'cryo',
    effectRole: 'status-effect',
    effectDurationMs: CRYO_EFFECT_DURATION_MS,
    effectRadius: DEFAULT_GADGET_EFFECT_RADIUS,
    botAppeal: 1,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    movementSpeedMultiplier: CRYO_MOVEMENT_SPEED_MULTIPLIER,
    blocksVision: false,
    colorHex: 0x4cacf5,
  }),
  [PROXIMITY_MINE_ID]: Object.freeze({
    id: PROXIMITY_MINE_ID,
    name: 'Proximity Mine',
    description: `Short throw · arms in ${PROXIMITY_MINE_ARMING_DURATION_MS / 1000} seconds · detonates for ${PROXIMITY_MINE_EXPLOSION_DAMAGE} damage when an enemy gets close`,
    effectType: 'mine',
    effectRole: 'proximity-mine',
    triggerOnEnemyProximity: true,
    persistsUntilTriggered: true,
    botAppeal: 1,
    triggerRadius: PROXIMITY_MINE_TRIGGER_RADIUS,
    hitRadius: PROXIMITY_MINE_HIT_RADIUS,
    explosionDamage: PROXIMITY_MINE_EXPLOSION_DAMAGE,
    throwRange: PROXIMITY_MINE_THROW_RANGE,
    throwSpeed: PROXIMITY_MINE_THROW_SPEED,
    throwCollisionRadius: PROXIMITY_MINE_THROW_COLLISION_RADIUS,
    maxBounces: 0,
    blocksVision: false,
    colorHex: 0xf04b42,
  }),
  [FLASH_GRENADE_ID]: Object.freeze({
    id: FLASH_GRENADE_ID,
    name: 'Flash Grenade',
    description: `Blinds players and spy cameras in line of sight for ${FLASH_GRENADE_MIN_BLIND_DURATION_MS / 1000}–${FLASH_GRENADE_MAX_BLIND_DURATION_MS / 1000} seconds · detonates ${FLASH_GRENADE_DETONATION_DELAY_MS / 1000} second after impact`,
    effectType: 'flash',
    effectRole: 'status-effect',
    effectDurationMs: FLASH_GRENADE_MAX_BLIND_DURATION_MS,
    detonationDelayMs: FLASH_GRENADE_DETONATION_DELAY_MS,
    effectRadius: FLASH_GRENADE_RADIUS,
    minBlindDurationMs: FLASH_GRENADE_MIN_BLIND_DURATION_MS,
    maxBlindDurationMs: FLASH_GRENADE_MAX_BLIND_DURATION_MS,
    botAppeal: 1,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    blocksVision: false,
    colorHex: 0xf4f7ff,
  }),
  [ORBITAL_STRIKE_ID]: Object.freeze({
    id: ORBITAL_STRIKE_ID,
    name: 'Orbital Strike',
    description: `${ORBITAL_STRIKE_EXPLOSION_DAMAGE} damage, leaves behind fire for ${ORBITAL_STRIKE_FIRE_DURATION_MS / 1000}s · strikes after a ${ORBITAL_STRIKE_WARNING_DURATION_MS / 1000}s warning · recharges after ${ORBITAL_STRIKE_COOLDOWN_MS / 1000}s`,
    effectType: 'orbital-strike',
    effectRole: 'unique-gadget',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    effectRadius: ORBITAL_STRIKE_RADIUS,
    warningDurationMs: ORBITAL_STRIKE_WARNING_DURATION_MS,
    explosionDamage: ORBITAL_STRIKE_EXPLOSION_DAMAGE,
    effectDurationMs: ORBITAL_STRIKE_FIRE_DURATION_MS,
    damagePerSecond: MOLOTOV_DAMAGE_PER_SECOND,
    cooldownMs: ORBITAL_STRIKE_COOLDOWN_MS,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0xff684d,
  }),
  [SPY_CAMERA_ID]: Object.freeze({
    id: SPY_CAMERA_ID,
    name: 'Spy Camera',
    description: `X-ray vision through walls · lasts ${SPY_CAMERA_DURATION_MS / 1000}s · can be destroyed`,
    effectType: SPY_CAMERA_ID,
    effectRole: 'vision-device',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    effectDurationMs: SPY_CAMERA_DURATION_MS,
    effectRadius: SPY_CAMERA_BODY_RADIUS,
    visionRange: SPY_CAMERA_RANGE,
    visionHalfAngle: VISION_HALF_ANGLE,
    health: SPY_CAMERA_HEALTH,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0x55c9ff,
  }),
  [TROPHY_SYSTEM_ID]: Object.freeze({
    id: TROPHY_SYSTEM_ID,
    name: 'Trophy System',
    description: `Place once · intercepts enemy gadgets in line of sight · right-click again to command a recharging gadget-nullifying pulse · can be destroyed`,
    effectType: TROPHY_SYSTEM_ID,
    effectRole: 'defense-device',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    persistsUntilMatchEnd: true,
    throwRange: PROXIMITY_MINE_THROW_RANGE,
    throwSpeed: PROXIMITY_MINE_THROW_SPEED,
    throwCollisionRadius: TROPHY_SYSTEM_THROW_COLLISION_RADIUS,
    maxBounces: 0,
    effectRadius: TROPHY_SYSTEM_BODY_RADIUS,
    health: TROPHY_SYSTEM_HEALTH,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0xe7b851,
  }),
  [VINE_TRAP_ID]: Object.freeze({
    id: VINE_TRAP_ID,
    name: 'Vine Trap',
    description: `Short throw · arms in ${VINE_TRAP_ARMING_DURATION_MS / 1000}s · traps one enemy for ${VINE_TRAP_LATCH_DURATION_MS / 1000}s · recharges after ${VINE_TRAP_RECHARGE_DURATION_MS / 1000}s`,
    effectType: VINE_TRAP_ID,
    effectRole: 'proximity-trap',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    triggerOnEnemyProximity: true,
    persistsUntilTriggered: true,
    triggerRadius: PROXIMITY_MINE_TRIGGER_RADIUS,
    hitRadius: PROXIMITY_MINE_HIT_RADIUS,
    armingDurationMs: VINE_TRAP_ARMING_DURATION_MS,
    latchDurationMs: VINE_TRAP_LATCH_DURATION_MS,
    rechargeDurationMs: VINE_TRAP_RECHARGE_DURATION_MS,
    throwRange: PROXIMITY_MINE_THROW_RANGE,
    throwSpeed: PROXIMITY_MINE_THROW_SPEED,
    throwCollisionRadius: PROXIMITY_MINE_THROW_COLLISION_RADIUS,
    maxBounces: 0,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0x63b84b,
  }),
  [SONAR_ID]: Object.freeze({
    id: SONAR_ID,
    name: 'Sonar',
    description: `2 charges · reveals map · hears footsteps and gunfire · recharges each charge after ${SONAR_CHARGE_COOLDOWN_MS / 1000}s`,
    effectType: 'sonar-projectile',
    effectRole: 'team-intel-projectile',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: SONAR_CHARGES,
    cooldownMs: SONAR_CHARGE_COOLDOWN_MS,
    projectileRange: SONAR_PROJECTILE_RANGE,
    projectileSpeed: SONAR_PROJECTILE_SPEED,
    effectRadius: SONAR_PROJECTILE_RADIUS,
    listeningRadius: SONAR_LISTENING_RADIUS,
    throwRange: SONAR_PROJECTILE_RANGE,
    throwSpeed: SONAR_PROJECTILE_SPEED,
    throwCollisionRadius: DEFAULT_GADGET_THROW_COLLISION_RADIUS,
    maxBounces: Infinity,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0x58e5ee,
  }),
  [JAMMER_GRENADE_ID]: Object.freeze({
    id: JAMMER_GRENADE_ID,
    name: 'Jammer Grenade',
    description: `Jams enemy intel and gadgets for ${JAMMER_GRENADE_DURATION_MS / 1000}s - cuts off jammed players from their team`,
    effectType: 'jammer',
    effectRole: 'status-effect',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    cooldownMs: JAMMER_GRENADE_COOLDOWN_MS,
    detonationDelayMs: JAMMER_GRENADE_DETONATION_DELAY_MS,
    effectDurationMs: JAMMER_GRENADE_VISUAL_DURATION_MS,
    effectRadius: JAMMER_GRENADE_RADIUS,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0xb178ff,
  }),
  [BIO_FIELD_ID]: Object.freeze({
    id: BIO_FIELD_ID,
    name: 'Bio Field',
    description: `Creates a bio field for ${BIO_FIELD_EFFECT_DURATION_MS / 1000}s · allies move ${Math.round((BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER - 1) * 100)}% faster, enemies ${Math.round((1 - BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER) * 100)}% slower · 2 charges, recharges each after ${BIO_FIELD_COOLDOWN_MS / 1000}s`,
    effectType: BIO_FIELD_ID,
    effectRole: 'status-effect',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    botAppeal: 1,
    charges: BIO_FIELD_CHARGES,
    cooldownMs: BIO_FIELD_COOLDOWN_MS,
    effectDurationMs: BIO_FIELD_EFFECT_DURATION_MS,
    effectRadius: DEFAULT_GADGET_EFFECT_RADIUS,
    throwRange: DEFAULT_GADGET_THROW_RANGE,
    throwSpeed: DEFAULT_GADGET_THROW_SPEED,
    throwCollisionRadius: DEFAULT_GADGET_THROW_COLLISION_RADIUS,
    maxBounces: 0,
    friendlyMovementMultiplier: BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER,
    enemyMovementMultiplier: BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER,
    blocksVision: false,
    colorHex: 0x70d878,
  }),
  [KATANA_ID]: Object.freeze({
    id: KATANA_ID,
    name: 'Katana',
    description: `Lethal sword dash · recharges after ${KATANA_COOLDOWN_MS / 1000}s · sword kill restores the charge`,
    effectType: 'katana-dash',
    effectRole: 'melee-dash',
    rarity: 'unique',
    alwaysAvailableInLoadoutShop: true,
    charges: 1,
    cooldownMs: KATANA_COOLDOWN_MS,
    dashDistance: KATANA_DASH_MAX_DISTANCE,
    hitRadius: KATANA_DASH_HIT_RADIUS,
    botAppeal: 1,
    blocksVision: false,
    colorHex: 0xe9d28a,
  }),
});

export function refillGadgetCharges(player, gadgetId) {
  const definition = GADGET_DEFINITIONS[gadgetId];
  if (!player || !definition) return 0;
  const charges = definition.charges ?? 1;
  player.gadgetCounts ??= {};
  player.gadgetCounts[gadgetId] = charges;
  player.gadgetChargeRechargeRemainingMs ??= {};
  player.gadgetChargeRechargeRemainingMs[gadgetId] = [];
  if (gadgetId === ORBITAL_STRIKE_ID) player.orbitalStrikeCooldownRemainingMs = 0;
  if (gadgetId === TROPHY_SYSTEM_ID) player.trophyCommandReadyAt = 0;
  if (gadgetId === VINE_TRAP_ID) player.vineTrapRechargeAt = null;
  if (player.selectedGadgetId === gadgetId) player.gadgetCount = charges;
  return charges;
}

export function consumeGadgetCharge(player, gadgetId) {
  if (!player || !GADGET_DEFINITIONS[gadgetId]) return 0;
  player.gadgetCounts ??= {};
  const remaining = Math.max(0,
    (player.gadgetCounts[gadgetId] ?? player.gadgetCount ?? 0) - 1);
  player.gadgetCounts[gadgetId] = remaining;
  if (gadgetId === VINE_TRAP_ID) player.vineTrapRechargeAt = null;
  if (player.selectedGadgetId === gadgetId) player.gadgetCount = remaining;
  return remaining;
}

export function isPlayerJammed(player, now = Date.now()) {
  return Number.isFinite(player?.jammedUntil) && player.jammedUntil > now;
}

export function isGadgetJammed(gadget, now = Date.now()) {
  return Number.isFinite(gadget?.jammedUntil) && gadget.jammedUntil > now;
}

const SURFACE_EPSILON = 0.05;

export function getGadgetProjectileSpeed(definitionOrId) {
  const definition = typeof definitionOrId === 'string'
    ? GADGET_DEFINITIONS[definitionOrId]
    : definitionOrId;
  const speed = definition?.throwSpeed ?? DEFAULT_GADGET_THROW_SPEED;
  return definition?.id === SONAR_ID ? speed : speed * GADGET_PROJECTILE_SPEED_MULTIPLIER;
}

export function advanceOrbitalStrikeCooldown(player, elapsedMs) {
  if (!player || !Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  const timers = getPerChargeRechargeTimers(player, ORBITAL_STRIKE_ID);
  if (timers.length === 0 && Number.isFinite(player.orbitalStrikeCooldownRemainingMs) &&
      player.orbitalStrikeCooldownRemainingMs > 0) {
    player.gadgetChargeRechargeRemainingMs ??= {};
    player.gadgetChargeRechargeRemainingMs[ORBITAL_STRIKE_ID] = [
      player.orbitalStrikeCooldownRemainingMs,
    ];
  }
  const recharged = advancePerChargeGadgetRecharges(
    player, ORBITAL_STRIKE_ID, elapsedMs, {
      cooldownMs: ORBITAL_STRIKE_COOLDOWN_MS,
      maximumCharges: GADGET_DEFINITIONS[ORBITAL_STRIKE_ID].charges,
    },
  );
  player.orbitalStrikeCooldownRemainingMs =
    getPerChargeGadgetRechargeRemainingMs(player, ORBITAL_STRIKE_ID);
  return recharged > 0;
}

export function activateVineTrap(effect, target, now) {
  if (effect?.type !== VINE_TRAP_ID || !target?.id || !Number.isFinite(now) ||
      effect.latchedEnemyId || !isProximityMineArmed(effect, now)) return false;
  effect.armed = true;
  effect.latchedEnemyId = target.id;
  effect.activatedAt = now;
  effect.activeUntil = now + (effect.latchDurationMs ?? VINE_TRAP_LATCH_DURATION_MS);
  effect.expiresAt = effect.activeUntil;
  return true;
}

export function isVineTrapTargetDead(effect, players) {
  if (effect?.type !== VINE_TRAP_ID || !effect.latchedEnemyId) return false;
  const target = Array.isArray(players)
    ? players.find((player) => player.id === effect.latchedEnemyId)
    : players?.get?.(effect.latchedEnemyId);
  return !target || target.alive === false || (target.health ?? 100) <= 0;
}

export function startVineTrapRecharge(player, now, durationMs = VINE_TRAP_RECHARGE_DURATION_MS) {
  if (!player?.alive || (player.health ?? 100) <= 0 ||
      !Number.isFinite(now) || !Number.isFinite(durationMs) || durationMs < 0) return false;
  player.vineTrapRechargeAt = now + durationMs;
  return true;
}

export function advanceVineTrapRecharge(player, now) {
  if (!player || !Number.isFinite(now) || !Number.isFinite(player.vineTrapRechargeAt) ||
      now < player.vineTrapRechargeAt) return false;
  player.vineTrapRechargeAt = null;
  player.gadgetCounts ??= {};
  player.gadgetCounts[VINE_TRAP_ID] = Math.max(1, player.gadgetCounts[VINE_TRAP_ID] ?? 0);
  if (player.selectedGadgetId === VINE_TRAP_ID) {
    player.gadgetCount = player.gadgetCounts[VINE_TRAP_ID];
  }
  return true;
}

function getPerChargeRechargeTimers(player, gadgetId) {
  const timers = player?.gadgetChargeRechargeRemainingMs?.[gadgetId];
  return Array.isArray(timers) ? timers : [];
}

export function queuePerChargeGadgetRecharge(player, gadgetId, cooldownMs, maximumCharges) {
  if (!player || typeof gadgetId !== 'string' || !Number.isFinite(cooldownMs) || cooldownMs < 0 ||
      !Number.isSafeInteger(maximumCharges) || maximumCharges <= 0) return false;
  const currentCount = player.gadgetCounts?.[gadgetId] ?? 0;
  if (currentCount >= maximumCharges) return false;
  player.gadgetChargeRechargeRemainingMs ??= {};
  const timers = [...getPerChargeRechargeTimers(player, gadgetId)];
  if (timers.length > 0) return false;
  timers.push(cooldownMs);
  player.gadgetChargeRechargeRemainingMs[gadgetId] = timers;
  return true;
}

export function advancePerChargeGadgetRecharges(
  player, gadgetId, elapsedMs, { cooldownMs, maximumCharges } = {},
) {
  if (!player || !Number.isFinite(elapsedMs) || elapsedMs < 0 ||
      player.alive === false || (player.health ?? 100) <= 0 ||
      !Number.isFinite(cooldownMs) || cooldownMs < 0 ||
      !Number.isSafeInteger(maximumCharges) || maximumCharges <= 0) return 0;
  player.gadgetCounts ??= {};
  const currentCount = Math.min(maximumCharges, player.gadgetCounts[gadgetId] ?? 0);
  const existingTimers = getPerChargeRechargeTimers(player, gadgetId);
  if (currentCount === 0 && player.selectedGadgetId !== gadgetId && existingTimers.length === 0) {
    return 0;
  }
  const deficit = maximumCharges - currentCount;
  player.gadgetChargeRechargeRemainingMs ??= {};
  let remaining = deficit > 0
    ? Math.max(0, existingTimers[0] ?? cooldownMs)
    : 0;
  let elapsedRemaining = elapsedMs;
  let recharged = 0;
  while (recharged < deficit && elapsedRemaining >= remaining) {
    elapsedRemaining -= remaining;
    recharged += 1;
    remaining = cooldownMs;
  }
  player.gadgetCounts[gadgetId] = currentCount + recharged;
  player.gadgetChargeRechargeRemainingMs[gadgetId] =
    recharged < deficit ? [Math.max(0, remaining - elapsedRemaining)] : [];
  if (player.selectedGadgetId === gadgetId) player.gadgetCount = player.gadgetCounts[gadgetId];
  return recharged;
}

export function getPerChargeGadgetRechargeRemainingMs(player, gadgetId) {
  const timers = getPerChargeRechargeTimers(player, gadgetId);
  return timers.length > 0 ? Math.min(...timers) : 0;
}

export function queueSonarChargeRecharge(player, cooldownMs = SONAR_CHARGE_COOLDOWN_MS) {
  return queuePerChargeGadgetRecharge(player, SONAR_ID, cooldownMs, SONAR_CHARGES);
}

export function queueOrbitalStrikeRecharge(player, cooldownMs = ORBITAL_STRIKE_COOLDOWN_MS) {
  if (!player) return false;
  const queued = queuePerChargeGadgetRecharge(
    player, ORBITAL_STRIKE_ID, cooldownMs, GADGET_DEFINITIONS[ORBITAL_STRIKE_ID].charges,
  );
  player.orbitalStrikeCooldownRemainingMs =
    getPerChargeGadgetRechargeRemainingMs(player, ORBITAL_STRIKE_ID);
  return queued;
}

export function advanceSonarChargeRecharges(player, elapsedMs) {
  return advancePerChargeGadgetRecharges(player, SONAR_ID, elapsedMs, {
    cooldownMs: SONAR_CHARGE_COOLDOWN_MS,
    maximumCharges: SONAR_CHARGES,
  });
}

export function getSonarRechargeRemainingMs(player) {
  return getPerChargeGadgetRechargeRemainingMs(player, SONAR_ID);
}

export function queueKatanaChargeRecharge(player, cooldownMs = KATANA_COOLDOWN_MS) {
  return queuePerChargeGadgetRecharge(player, KATANA_ID, cooldownMs, 1);
}

export function advanceKatanaChargeRecharge(player, elapsedMs) {
  return advancePerChargeGadgetRecharges(player, KATANA_ID, elapsedMs, {
    cooldownMs: KATANA_COOLDOWN_MS,
    maximumCharges: 1,
  });
}

export function getKatanaRechargeRemainingMs(player) {
  return getPerChargeGadgetRechargeRemainingMs(player, KATANA_ID);
}

export function refundKatanaCharge(player) {
  if (!player) return false;
  player.gadgetCounts ??= {};
  const wasSpent = (player.gadgetCounts[KATANA_ID] ?? 0) < 1;
  player.gadgetCounts[KATANA_ID] = 1;
  player.gadgetChargeRechargeRemainingMs ??= {};
  player.gadgetChargeRechargeRemainingMs[KATANA_ID] = [];
  if (player.selectedGadgetId === KATANA_ID) player.gadgetCount = 1;
  return wasSpent;
}

function isFlashInSpyCameraCone(effect, target) {
  return target?.type === SPY_CAMERA_ID && isPointVisible(effect, {
    origin: { x: target.x, y: target.y },
    angle: Number.isFinite(target.angle) ? target.angle : 0,
    halfAngle: target.visionHalfAngle ?? VISION_HALF_ANGLE,
    maximumRange: target.visionRange ?? SPY_CAMERA_RANGE,
  }, []);
}

export function getFlashBlindDurationMs(effect, player) {
  if (effect?.type !== 'flash' || !player ||
      ![effect.x, effect.y, effect.radius, player.x, player.y].every(Number.isFinite) ||
      effect.radius <= 0) return 0;
  const distance = Math.hypot(player.x - effect.x, player.y - effect.y);
  const maximum = effect.maxBlindDurationMs ?? FLASH_GRENADE_MAX_BLIND_DURATION_MS;
  if (isFlashInSpyCameraCone(effect, player)) return maximum;
  if (distance > effect.radius) return 0;
  const minimum = effect.minBlindDurationMs ?? FLASH_GRENADE_MIN_BLIND_DURATION_MS;
  return minimum + (maximum - minimum) * (1 - distance / effect.radius);
}

export function isFlashAffectingPlayer(effect, player, visionObjects, now = Date.now()) {
  return isFlashAffectingTarget(effect, player, visionObjects, now);
}

export function isFlashAffectingTarget(effect, target, visionObjects, now = Date.now()) {
  const duration = getFlashBlindDurationMs(effect, target);
  if (duration <= 0 || !Number.isFinite(effect?.startedAt) || effect.startedAt > now ||
      now >= effect.startedAt + duration || effect.expiresAt <= now) return false;
  if (isFlashInSpyCameraCone(effect, target)) return true;
  return isPointVisible({ x: target.x, y: target.y }, {
    origin: { x: effect.x, y: effect.y },
    angle: 0,
    halfAngle: Math.PI,
    maximumRange: effect.radius,
  }, visionObjects);
}

export function applyFlashBlindness(effect, players, visionObjects, gadgetEffects = []) {
  if (effect?.type !== 'flash' || !Number.isFinite(effect.startedAt) || !Array.isArray(players)) return [];
  const blindedPlayerIds = [];
  for (const player of players) {
    if (!player || player.alive === false || (player.health ?? 100) <= 0 ||
        !isFlashAffectingPlayer(effect, player, visionObjects, effect.startedAt)) continue;
    const flashUntil = effect.startedAt + getFlashBlindDurationMs(effect, player);
    const existingFlashUntil = Number.isFinite(player.flashUntil) ? player.flashUntil : 0;
    player.flashUntil = Math.max(existingFlashUntil, flashUntil);
    blindedPlayerIds.push(player.id);
  }
  for (const gadget of gadgetEffects ?? []) {
    if (gadget?.type !== SPY_CAMERA_ID ||
        gadget.startedAt > effect.startedAt ||
        !Number.isFinite(gadget.expiresAt) || gadget.expiresAt <= effect.startedAt ||
        (Number.isFinite(gadget.health) && gadget.health <= 0) ||
        !isFlashAffectingTarget(effect, gadget, visionObjects, effect.startedAt)) continue;
    const disabledUntil = effect.startedAt + getFlashBlindDurationMs(effect, gadget);
    const existingDisabledUntil = Number.isFinite(gadget.disabledUntil) ? gadget.disabledUntil : 0;
    gadget.disabledUntil = Math.max(existingDisabledUntil, disabledUntil);
  }
  return blindedPlayerIds;
}

export function isPlayerFlashBlinded(player, now = Date.now()) {
  return Number.isFinite(player?.flashUntil) && player.flashUntil > now;
}

export function isProximityMineArmed(mine, now = Date.now()) {
  if (Number.isFinite(mine?.armedAt)) return now >= mine.armedAt;
  return mine?.armed !== false;
}

export function calculateGadgetTrajectory(origin, target, mapObjects, options = {}) {
  if (![origin?.x, origin?.y, target?.x, target?.y].every(Number.isFinite)) return null;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const targetDistance = Math.hypot(dx, dy);
  if (targetDistance <= 1e-6) return null;

  const maximumRange = options.maximumRange ?? DEFAULT_GADGET_THROW_RANGE;
  const totalDistance = Math.min(targetDistance, maximumRange);
  let direction = { x: dx / targetDistance, y: dy / targetDistance };
  let current = { x: origin.x, y: origin.y };
  let remaining = totalDistance;
  let bounces = 0;
  const points = [{ ...current }];
  const collisionRadius = options.collisionRadius ?? DEFAULT_GADGET_THROW_COLLISION_RADIUS;
  const maximumBounces = options.maximumBounces ?? DEFAULT_GADGET_MAX_BOUNCES;

  while (remaining > 1e-6) {
    const end = {
      x: current.x + direction.x * remaining,
      y: current.y + direction.y * remaining,
    };
    const collision = findFirstCollision(current, end, mapObjects, collisionRadius);
    if (!collision) {
      points.push(end);
      current = end;
      remaining = 0;
      break;
    }

    const travelled = remaining * collision.t;
    const impact = {
      x: current.x + (end.x - current.x) * collision.t,
      y: current.y + (end.y - current.y) * collision.t,
    };
    points.push(impact);
    remaining = Math.max(0, remaining - travelled);
    if (bounces >= maximumBounces || remaining <= 1e-6) {
      current = impact;
      break;
    }

    const projection = direction.x * collision.normal.x + direction.y * collision.normal.y;
    direction = {
      x: direction.x - 2 * projection * collision.normal.x,
      y: direction.y - 2 * projection * collision.normal.y,
    };
    current = {
      x: impact.x + collision.normal.x * SURFACE_EPSILON,
      y: impact.y + collision.normal.y * SURFACE_EPSILON,
    };
    if (options.includeBounceEpsilon) points.push(current);
    remaining = Math.max(0, remaining - SURFACE_EPSILON);
    bounces += 1;
  }

  return { points, endpoint: { ...current }, distance: totalDistance, bounces };
}

export const calculateSmokeTrajectory = calculateGadgetTrajectory;

export function getGadgetThrowOrigin(player, target, mapObjects) {
  if (![player?.x, player?.y, target?.x, target?.y].every(Number.isFinite)) return null;
  const lean = player.weaponLean ?? 0;
  const aimAngle = getWeaponAimAngle(player, target, lean, mapObjects);
  const muzzle = getWeaponMuzzlePosition(player, aimAngle, lean, mapObjects);
  const projectileBlockers = (mapObjects ?? [])
    .filter((object) => object.blocksProjectiles !== false)
    .map((object) => object.blocksMovement === false ? { ...object, blocksMovement: true } : object);
  const origin = resolveCircleMovement(
    player,
    { x: muzzle.x - player.x, y: muzzle.y - player.y },
    projectileBlockers,
    DEFAULT_GADGET_THROW_COLLISION_RADIUS + SURFACE_EPSILON,
  );
  return { x: origin.x, y: origin.y };
}

export function calculateKatanaDash(start, target, mapObjects, mapWidth, mapHeight) {
  if (![start?.x, start?.y, target?.x, target?.y, mapWidth, mapHeight]
    .every(Number.isFinite)) return null;
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const targetDistance = Math.hypot(dx, dy);
  if (targetDistance <= 1e-6) return null;
  const angle = Math.atan2(dy, dx);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const maxDistance = Math.min(
    targetDistance,
    GADGET_DEFINITIONS[KATANA_ID].dashDistance,
    direction.x > 0 ? (mapWidth - PLAYER_RADIUS - start.x) / direction.x
      : direction.x < 0 ? (PLAYER_RADIUS - start.x) / direction.x : Infinity,
    direction.y > 0 ? (mapHeight - PLAYER_RADIUS - start.y) / direction.y
      : direction.y < 0 ? (PLAYER_RADIUS - start.y) / direction.y : Infinity,
  );
  if (!Number.isFinite(maxDistance) || maxDistance <= 1e-6) return null;
  const trace = traceMapRay(start, angle, maxDistance, mapObjects, PLAYER_RADIUS, 'blocksMovement');
  const tracedDistance = Math.hypot(trace.end.x - start.x, trace.end.y - start.y);
  const dashDistance = Math.max(0, tracedDistance - (trace.firstObject ? SURFACE_EPSILON : 0));
  if (dashDistance <= 1e-6) return null;
  return {
    start: { x: start.x, y: start.y },
    end: {
      x: start.x + direction.x * dashDistance,
      y: start.y + direction.y * dashDistance,
    },
    angle,
    distance: dashDistance,
  };
}

export function getGadgetMovementScale(position, effects, now = Date.now()) {
  return getGadgetStatusEffectScale(position, effects, now);
}

export function getGadgetWeaponTurnScale(position, effects, now = Date.now()) {
  return getGadgetStatusEffectScale(position, effects, now);
}

function getGadgetStatusEffectScale(position, effects, now) {
  const movementEffects = getActiveMovementEffects(position, effects, now);
  const hasFriendlyBioField = movementEffects.bioFields.some((effect) => effect.team === position.team);
  const hasHostileBioField = movementEffects.bioFields.some((effect) =>
    ['red', 'blue'].includes(position.team) && effect.team !== position.team);
  const hasSlowEffect = hasHostileBioField || movementEffects.cryo;
  if (hasFriendlyBioField && hasSlowEffect) return 1;
  if (hasHostileBioField) {
    return movementEffects.cryo
      ? CRYO_MOVEMENT_SPEED_MULTIPLIER : BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER;
  }
  if (movementEffects.cryo) return CRYO_MOVEMENT_SPEED_MULTIPLIER;
  return hasFriendlyBioField ? BIO_FIELD_FRIENDLY_MOVEMENT_MULTIPLIER : 1;
}

function getActiveMovementEffects(position, effects, now) {
  const bioFields = [];
  let cryo = false;
  for (const effect of effects ?? []) {
    if (effect.expiresAt <= now ||
        Math.hypot(position.x - effect.x, position.y - effect.y) > (effect.radius ?? DEFAULT_GADGET_EFFECT_RADIUS)) continue;
    if (effect.type === 'cryo') cryo = true;
    else if (effect.type === BIO_FIELD_ID && ['red', 'blue'].includes(effect.team)) bioFields.push(effect);
  }
  return { bioFields, cryo };
}

function findFirstCollision(start, end, mapObjects, radius) {
  let first = null;
  for (const object of mapObjects ?? []) {
    if (object.blocksProjectiles === false || !segmentMapObjectBoundsOverlap(start, end, object, radius)) continue;
    const t = segmentMapObjectEntryT(start, end, object, radius);
    if (t === null || (first && t >= first.t)) continue;
    const x = start.x + (end.x - start.x) * t;
    const y = start.y + (end.y - start.y) * t;
    first = { t, normal: getSurfaceNormal(object, x, y, end.x - start.x, end.y - start.y) };
  }
  return first;
}

function getSurfaceNormal(object, x, y, travelX, travelY) {
  let normal;
  if (object.shape === 'circle') {
    const dx = x - object.x;
    const dy = y - object.y;
    const length = Math.hypot(dx, dy) || 1;
    normal = { x: dx / length, y: dy / length };
  } else if (object.shape === 'rect') {
    const left = object.x - object.width / 2;
    const right = object.x + object.width / 2;
    const top = object.y - object.height / 2;
    const bottom = object.y + object.height / 2;
    const sides = [
      { distance: Math.abs(x - left), normal: { x: -1, y: 0 } },
      { distance: Math.abs(x - right), normal: { x: 1, y: 0 } },
      { distance: Math.abs(y - top), normal: { x: 0, y: -1 } },
      { distance: Math.abs(y - bottom), normal: { x: 0, y: 1 } },
    ];
    normal = sides.sort((a, b) => a.distance - b.distance)[0].normal;
  } else {
    const segmentX = object.x2 - object.x1;
    const segmentY = object.y2 - object.y1;
    const length = Math.hypot(segmentX, segmentY) || 1;
    const closestT = Math.max(0, Math.min(1,
      ((x - object.x1) * segmentX + (y - object.y1) * segmentY) / (length * length)));
    const closestX = object.x1 + segmentX * closestT;
    const closestY = object.y1 + segmentY * closestT;
    const deltaX = x - closestX;
    const deltaY = y - closestY;
    const deltaLength = Math.hypot(deltaX, deltaY);
    normal = deltaLength > 1e-9
      ? { x: deltaX / deltaLength, y: deltaY / deltaLength }
      : { x: segmentY / length, y: -segmentX / length };
  }
  if (normal.x * travelX + normal.y * travelY > 0) {
    return { x: -normal.x, y: -normal.y };
  }
  return normal;
}