import { PLAYER_RADIUS } from './MovementModel.js';
import { validateAccuracySettings } from './WeaponAccuracy.js';
import { forEachMapObjectAlongSegment } from './MapSpatialIndex.js';

export const DEFAULT_PROJECTILE_DEFINITIONS = Object.freeze({
  assaultRifle: Object.freeze({
    id: 'assault-rifle',
    name: 'Assault Rifle',
    weaponClass: 'rifle',
    shopValue: 4,
    botAppeal: 3,
    description: 'Reliable at all ranges · high accuracy',
    movementScale: 0.9,
    weight: 3.2,
    rotationTimeMs: 320,
    damage: 50,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 800,
    damageFalloffEndRange: 2000,
    cooldownMs: 100,
    magazineSize: 30,
    reloadDurationMs: 3000,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 22,
      recoilPerShot: 0.09,
      recoveryPerSecond: 0.55,
      movementPenaltyAtMaxSpeed: 0.5,
    }),
  }),
  battleRifle: Object.freeze({
    id: 'battle-rifle',
    name: 'Battle Rifle',
    weaponClass: 'rifle',
    shopValue: 4,
    botAppeal: 3,
    description: 'Semi-automatic · hard-hitting · accurate',
    movementScale: 0.9,
    weight: 3.6,
    rotationTimeMs: 360,
    damage: 70,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 1000,
    damageFalloffEndRange: 2000,
    cooldownMs: 50,
    botFireIntervalMs: 250,
    magazineSize: 15,
    reloadDurationMs: 3000,
    semiAuto: true,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 20,
      maxAccuracy: 1,
      startingAccuracy: 1,
      recoilPerShot: 0.13,
      recoveryPerSecond: 0.40,
      movementPenaltyAtMaxSpeed: 0.55,
    }),
  }),
  smg: Object.freeze({
    id: 'smg',
    name: 'SMG',
    shopValue: 3,
    botAppeal: 2,
    description: 'Close range · high fire rate · run and gun',
    movementScale: 0.95,
    weight: 2.2,
    rotationTimeMs: 240,
    damage: 35,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 600,
    damageFalloffEndRange: 1000,
    cooldownMs: 80,
    magazineSize: 40,
    reloadDurationMs: 2500,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 24,
      maxAccuracy: 0.88,
      startingAccuracy: 0.78,
      recoilPerShot: 0.06,
      recoveryPerSecond: 0.6,
      movementPenaltyAtMaxSpeed: 0.20,
    }),
  }),
  suppressedSmg: Object.freeze({
    id: 'suppressed-smg',
    name: 'Suppressed SMG',
    weaponClass: 'submachine-gun',
    shopValue: 4,
    botAppeal: 3,
    description: 'Suppressed · extreme fire rate · low recoil',
    suppressed: true,
    movementScale: 0.95,
    weight: 2.3,
    rotationTimeMs: 250,
    damage: 25,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 400,
    damageFalloffEndRange: 700,
    cooldownMs: 50,
    magazineSize: 50,
    reloadDurationMs: 3000,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 24,
      maxAccuracy: 0.78,
      startingAccuracy: 0.78,
      recoilPerShot: 0.045,
      recoveryPerSecond: 0.6,
      movementPenaltyAtMaxSpeed: 0.20,
    }),
  }),
  machineGun: Object.freeze({
    id: 'machine-gun',
    name: 'Machine Gun',
    weaponClass: 'machine-gun',
    shopValue: 5,
    botAppeal: 3,
    description: 'High-capacity · slow and steady · suppressive fire',
    movementScale: 0.8,
    weight: 5,
    rotationTimeMs: 560,
    damage: 40,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 800,
    damageFalloffEndRange: 1400,
    cooldownMs: 80,
    magazineSize: 100,
    reloadDurationMs: 6000,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 18,
      maxAccuracy: 0.94,
      startingAccuracy: 0.94,
      recoilPerShot: 0.045,
      recoveryPerSecond: 0.25,
      movementPenaltyAtMaxSpeed: 0.6,
    }),
  }),
  sniper: Object.freeze({
    id: 'sniper',
    name: 'Sniper',
    weaponClass: 'sniper',
    shopValue: 3,
    botAppeal: 3,
    description: 'Bolt action · long range · high damage',
    movementScale: 0.85,
    weight: 6,
    rotationTimeMs: 650,
    damage: 130,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 30000,
    radius: 0.1,
    range: 2000,
    cooldownMs: 800,
    magazineSize: 5,
    reloadDurationMs: 3500,
    manualActionDurationMs: 800,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 20,
      maxAccuracy: 1,
      startingAccuracy: 1,
      recoilPerShot: 0.16,
      recoveryPerSecond: 0.2,
      movementPenaltyAtMaxSpeed: 1,
    }),
  }),
  marksmanRifle: Object.freeze({
    id: 'marksman-rifle',
    name: 'Marksman Rifle',
    weaponClass: 'sniper',
    shopValue: 2,
    botAppeal: 2,
    description: 'Lever action · versatile · round reload',
    movementScale: 0.85,
    weight: 4.4,
    rotationTimeMs: 440,
    damage: 100,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 30000,
    radius: 0.1,
    range: 2000,
    cooldownMs: 500,
    magazineSize: 8,
    manualActionDurationMs: 500,
    reloadPerRound: true,
    reloadIntervalMs: Object.freeze([1000, 900, 800]),
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 18,
      maxAccuracy: 1,
      startingAccuracy: 1,
      recoilPerShot: 0.18,
      recoveryPerSecond: 0.32,
      movementPenaltyAtMaxSpeed: 0.75,
    }),
  }),
  heavySniper: Object.freeze({
    id: 'heavy-sniper',
    name: 'Heavy Sniper',
    weaponClass: 'sniper',
    shopValue: 5,
    botAppeal: 2,
    description: 'Heavy bolt action · massive damage · slow',
    movementScale: 0.85,
    weight: 7,
    rotationTimeMs: 800,
    damage: 150,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 40000,
    radius: 0.1,
    range: 2200,
    cooldownMs: 1200,
    magazineSize: 5,
    reloadDurationMs: 5000,
    manualActionDurationMs: 1200,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 40,
      maxAccuracy: 1,
      startingAccuracy: 1,
      recoilPerShot: 0.3,
      recoveryPerSecond: 0.16,
      movementPenaltyAtMaxSpeed: 1,
    }),
  }),
  shotgun: Object.freeze({
    id: 'shotgun',
    name: 'Shotgun',
    shopValue: 3,
    botAppeal: 2,
    description: 'Pump action · high close damage · round reload',
    movementScale: 0.9,
    weight: 3.2,
    rotationTimeMs: 320,
    damage: 12,
    pelletCount: 14,
    pelletSpreadDegrees: 2,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 300,
    damageFalloffEndRange: 600,
    cooldownMs: 650,
    magazineSize: 5,
    manualActionDurationMs: 650,
    reloadPerRound: true,
    reloadIntervalMs: Object.freeze([1000, 900, 800]),
    botFireIntervalMs: 650,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 26,
      recoilPerShot: 0.24,
      recoveryPerSecond: 0.45,
      movementPenaltyAtMaxSpeed: 0.5,
    }),
  }),
  classicPistol: Object.freeze({
    id: 'classic-pistol',
    name: 'Classic',
    weaponClass: 'pistol',
    shopValue: 0,
    botAppeal: 0,
    description: 'Semi-auto pistol · reliable sidearm · cheap',
    movementScale: 1,
    weight: 1.4,
    rotationTimeMs: 180,
    damage: 35,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 15000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 400,
    damageFalloffEndRange: 800,
    cooldownMs: 50,
    botFireIntervalMs: 250,
    magazineSize: 12,
    reloadDurationMs: 2000,
    semiAuto: true,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 22,
      maxAccuracy: 0.92,
      startingAccuracy: 0.92,
      recoilPerShot: 0.06,
      recoveryPerSecond: 0.8,
      movementPenaltyAtMaxSpeed: 0.35,
    }),
  }),
  battlePistol: Object.freeze({
    id: 'battle-pistol',
    name: 'Battle Pistol',
    weaponClass: 'pistol',
    shopValue: 1,
    botAppeal: 1,
    description: 'Three-round burst · accurate · fast',
    movementScale: 1,
    weight: 1.6,
    rotationTimeMs: 180,
    damage: 30,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 15000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 400,
    damageFalloffEndRange: 800,
    cooldownMs: 90,
    burstCount: 3,
    burstShotIntervalMs: 70,
    burstDelayMs: 200,
    magazineSize: 15,
    reloadDurationMs: 2500,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 30,
      maxAccuracy: 0.92,
      startingAccuracy: 0.92,
      recoilPerShot: 0.06,
      recoveryPerSecond: 0.8,
      movementPenaltyAtMaxSpeed: 0.4,
    }),
  }),
  machinePistol: Object.freeze({
    id: 'machine-pistol',
    name: 'Machine Pistol',
    weaponClass: 'pistol',
    shopValue: 1,
    botAppeal: 1,
    description: 'Gangster · blazing fire rate · very wide spread',
    movementScale: 1,
    weight: 1.6,
    rotationTimeMs: 180,
    damage: 30,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 15000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 300,
    damageFalloffEndRange: 600,
    cooldownMs: 50,
    magazineSize: 25,
    reloadDurationMs: 2000,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 30,
      maxAccuracy: 0.76,
      startingAccuracy: 0.76,
      recoilPerShot: 0.08,
      recoveryPerSecond: 0.8,
      movementPenaltyAtMaxSpeed: 0.2,
    }),
  }),
  pocketShotgun: Object.freeze({
    id: 'pocket-shotgun',
    name: 'Pocket Shotgun',
    weaponClass: 'pistol',
    shopValue: 1,
    botAppeal: 1,
    description: 'Double barrel · wide arc · close and personal',
    movementScale: 1,
    weight: 1.8,
    rotationTimeMs: 200,
    damage: 15,
    pelletCount: 14,
    pelletSpreadDegrees: 8,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 15000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 200,
    damageFalloffEndRange: 500,
    cooldownMs: 50,
    botFireIntervalMs: 250,
    magazineSize: 2,
    reloadDurationMs: 2000,
    semiAuto: true,
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 38,
      maxAccuracy: 0.85,
      startingAccuracy: 0.85,
      recoilPerShot: 0.18,
      recoveryPerSecond: 0.6,
      movementPenaltyAtMaxSpeed: 0.5,
    }),
  }),
  revolver: Object.freeze({
    id: 'revolver',
    name: 'Revolver',
    weaponClass: 'pistol',
    shopValue: 1,
    botAppeal: 1,
    description: 'Heavy sidearm · accurate · manual hammer and round reload',
    movementScale: 1,
    weight: 1.8,
    rotationTimeMs: 180,
    damage: 70,
    centerDamageMultiplier: 1,
    edgeDamageMultiplier: 0.01,
    minimumDamageMultiplier: 0.5,
    speed: 20000,
    radius: 0.1,
    range: 2000,
    damageFalloffStartRange: 800,
    damageFalloffEndRange: 2000,
    cooldownMs: 350,
    botFireIntervalMs: 350,
    magazineSize: 6,
    manualActionDurationMs: 500,
    reloadPerRound: true,
    reloadIntervalMs: Object.freeze([1000, 800, 700]),
    friendlyFire: false,
    accuracy: Object.freeze({
      maxSpreadDegrees: 26,
      maxAccuracy: 1,
      startingAccuracy: 1,
      recoilPerShot: 0.28,
      recoveryPerSecond: 0.60,
      movementPenaltyAtMaxSpeed: 0.5,
    }),
  }),
});

export function validateProjectileDefinition(definition) {
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || !definition.id) {
    throw new TypeError('Projectile definitions require a string id.');
  }
  for (const field of ['damage', 'speed', 'range']) {
    if (!Number.isFinite(definition[field]) || definition[field] <= 0) {
      throw new RangeError(`Projectile ${definition.id} requires a positive ${field}.`);
    }
  }
  for (const field of ['radius', 'cooldownMs']) {
    if (!Number.isFinite(definition[field]) || definition[field] < 0) {
      throw new RangeError(`Projectile ${definition.id} requires a non-negative ${field}.`);
    }
  }
  if (definition.botFireIntervalMs !== undefined &&
      (!Number.isFinite(definition.botFireIntervalMs) || definition.botFireIntervalMs <= 0)) {
    throw new RangeError(`Projectile ${definition.id} botFireIntervalMs must be positive.`);
  }
  const weight = definition.weight ?? 1;
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RangeError(`Projectile ${definition.id} weight must be positive.`);
  }
  if (definition.shopValue !== undefined && (!Number.isFinite(definition.shopValue) || definition.shopValue < 0)) {
    throw new RangeError(`Projectile ${definition.id} shopValue must be non-negative.`);
  }
  const botAppeal = definition.botAppeal ?? 1;
  if (!Number.isFinite(botAppeal) || botAppeal < 0) {
    throw new RangeError(`Projectile ${definition.id} botAppeal must be a non-negative number.`);
  }
  const rotationTimeMs = definition.rotationTimeMs ?? weight * 100;
  if (!Number.isFinite(rotationTimeMs) || rotationTimeMs <= 0) {
    throw new RangeError(`Projectile ${definition.id} rotationTimeMs must be positive.`);
  }
  if (definition.magazineSize !== undefined &&
      (!Number.isSafeInteger(definition.magazineSize) || definition.magazineSize <= 0)) {
    throw new RangeError(`Projectile ${definition.id} magazineSize must be a positive integer.`);
  }
  if (definition.pelletCount !== undefined &&
      (!Number.isSafeInteger(definition.pelletCount) || definition.pelletCount < 2 || definition.pelletCount > 32)) {
    throw new RangeError(`Projectile ${definition.id} pelletCount must be an integer from 2 to 32.`);
  }
  if (definition.pelletSpreadDegrees !== undefined &&
      (!Number.isFinite(definition.pelletSpreadDegrees) || definition.pelletSpreadDegrees < 0 || definition.pelletSpreadDegrees > 45)) {
    throw new RangeError(`Projectile ${definition.id} pelletSpreadDegrees must be from 0 to 45.`);
  }
  if (definition.burstCount !== undefined &&
      (!Number.isSafeInteger(definition.burstCount) || definition.burstCount < 2 || definition.burstCount > 8)) {
    throw new RangeError(`Projectile ${definition.id} burstCount must be an integer from 2 to 8.`);
  }
  if (definition.burstCount !== undefined &&
      (!Number.isFinite(definition.burstShotIntervalMs) || definition.burstShotIntervalMs <= 0 ||
        !Number.isFinite(definition.burstDelayMs) || definition.burstDelayMs <= 0)) {
    throw new RangeError(`Projectile ${definition.id} burst weapons require positive burst timing.`);
  }
  if (definition.semiAuto !== undefined && typeof definition.semiAuto !== 'boolean') {
    throw new TypeError(`Projectile ${definition.id} semiAuto must be a boolean.`);
  }
  if (definition.reloadPerRound && (!Array.isArray(definition.reloadIntervalMs) || !definition.reloadIntervalMs.length ||
      definition.reloadIntervalMs.some((duration) => !Number.isFinite(duration) || duration <= 0))) {
    throw new RangeError(`Projectile ${definition.id} requires positive reloadIntervalMs for per-round reload.`);
  }
  if (definition.reloadDurationMs !== undefined &&
      (!Number.isFinite(definition.reloadDurationMs) || definition.reloadDurationMs <= 0)) {
    throw new RangeError(`Projectile ${definition.id} reloadDurationMs must be positive.`);
  }
  if (definition.manualActionDurationMs !== undefined &&
      (!Number.isFinite(definition.manualActionDurationMs) || definition.manualActionDurationMs <= 0)) {
    throw new RangeError(`Projectile ${definition.id} manualActionDurationMs must be positive.`);
  }
  const edgeDamageMultiplier = definition.edgeDamageMultiplier ?? 0.01;
  if (!Number.isFinite(edgeDamageMultiplier) || edgeDamageMultiplier < 0 || edgeDamageMultiplier > 1) {
    throw new RangeError(`Projectile ${definition.id} edgeDamageMultiplier must be between 0 and 1.`);
  }
  const centerDamageMultiplier = definition.centerDamageMultiplier ?? 1;
  if (!Number.isFinite(centerDamageMultiplier) || centerDamageMultiplier < 0 || centerDamageMultiplier > 1) {
    throw new RangeError(`Projectile ${definition.id} centerDamageMultiplier must be between 0 and 1.`);
  }
  const minimumDamageMultiplier = definition.minimumDamageMultiplier ?? 0.5;
  if (!Number.isFinite(minimumDamageMultiplier) || minimumDamageMultiplier < 0 || minimumDamageMultiplier > 1) {
    throw new RangeError(`Projectile ${definition.id} minimumDamageMultiplier must be between 0 and 1.`);
  }
  const movementScale = definition.movementScale ?? 0.9;
  if (!Number.isFinite(movementScale) || movementScale <= 0 || movementScale > 1) {
    throw new RangeError(`Projectile ${definition.id} movementScale must be between 0 and 1.`);
  }
  const damageFalloffStartRange = definition.damageFalloffStartRange;
  const damageFalloffEndRange = definition.damageFalloffEndRange;
  if ((damageFalloffStartRange !== undefined || damageFalloffEndRange !== undefined) &&
      (!Number.isFinite(damageFalloffStartRange) || damageFalloffStartRange < 0 ||
        !Number.isFinite(damageFalloffEndRange) || damageFalloffEndRange <= damageFalloffStartRange)) {
    throw new RangeError(`Projectile ${definition.id} damage falloff requires increasing non-negative range limits.`);
  }
  return Object.freeze({
    ...definition,
    botAppeal,
    weight,
    rotationTimeMs,
    centerDamageMultiplier,
    edgeDamageMultiplier,
    minimumDamageMultiplier,
    movementScale,
    friendlyFire: definition.friendlyFire === true,
    accuracy: validateAccuracySettings(definition.accuracy),
  });
}

export function getProjectileDamage(definition, distanceFromCenter, playerRadius = PLAYER_RADIUS, distanceTravelled = 0) {
  const impactRadius = playerRadius + definition.radius;
  if (!Number.isFinite(distanceFromCenter) || distanceFromCenter > impactRadius) return 0;
  // Use the target's body radius for damage falloff; projectile radius only
  // expands collision detection and must not make grazing hits deal more damage.
  const distanceRatio = Math.max(0, Math.min(distanceFromCenter / playerRadius, 1));
  const damageFalloffMultiplier = getDamageFalloffMultiplier(definition, distanceTravelled);
  if (distanceRatio === 0) return definition.damage * definition.centerDamageMultiplier * damageFalloffMultiplier;
  if (distanceRatio === 1) return definition.damage * definition.edgeDamageMultiplier * damageFalloffMultiplier;
  const multiplier = definition.centerDamageMultiplier -
    ((definition.centerDamageMultiplier - definition.edgeDamageMultiplier) * distanceRatio);
  return definition.damage * multiplier * damageFalloffMultiplier;
}

export function getProjectileDamageAlongSegment(definition, start, end, target, playerRadius = PLAYER_RADIUS) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(
    ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared,
    1,
  ));
  const impactX = start.x + dx * t;
  const impactY = start.y + dy * t;
  const distanceFromCenter = Math.hypot(target.x - impactX, target.y - impactY);
  return getProjectileDamage(definition, distanceFromCenter, playerRadius, Math.sqrt(lengthSquared) * t);
}

export function getDamageFalloffMultiplier(definition, distanceTravelled = 0) {
  if (!Number.isFinite(definition.damageFalloffStartRange) ||
      !Number.isFinite(definition.damageFalloffEndRange) || distanceTravelled <= definition.damageFalloffStartRange) return 1;
  const progress = Math.max(0, Math.min(1,
    (distanceTravelled - definition.damageFalloffStartRange) /
      (definition.damageFalloffEndRange - definition.damageFalloffStartRange)));
  return 1 - progress * (1 - definition.minimumDamageMultiplier);
}

export function segmentCircleEntryT(start, end, center, radius) {
  return segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, center.x, center.y, radius);
}

export function segmentCircleEntryTCoordinates(startX, startY, endX, endY, centerX, centerY, radius) {
  const dx = endX - startX;
  const dy = endY - startY;
  const fx = startX - centerX;
  const fy = startY - centerY;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return 0;
  if (a <= 1e-12) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export function segmentMapObjectEntryT(start, end, object, projectileRadius = 0, blockingField = 'blocksProjectiles') {
  if (blockingField && object[blockingField] === false) return null;
  if (object.shape === 'circle') {
    return segmentCircleEntryT(start, end, object, object.radius + projectileRadius);
  }
  if (object.shape === 'rect') {
    return segmentRectEntryT(start, end, object, projectileRadius);
  }
  if (object.shape === 'segment') {
    return segmentWallEntryT(start, end, object, projectileRadius);
  }
  return null;
}

export function segmentMapObjectBoundsOverlap(start, end, object, padding = 0) {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  if (object.shape === 'circle') {
    const radius = object.radius + padding;
    return object.x + radius >= minX && object.x - radius <= maxX &&
      object.y + radius >= minY && object.y - radius <= maxY;
  }
  if (object.shape === 'rect') {
    return object.x + object.width / 2 + padding >= minX && object.x - object.width / 2 - padding <= maxX &&
      object.y + object.height / 2 + padding >= minY && object.y - object.height / 2 - padding <= maxY;
  }
  if (object.shape === 'segment') {
    return Math.max(object.x1, object.x2) + padding >= minX && Math.min(object.x1, object.x2) - padding <= maxX &&
      Math.max(object.y1, object.y2) + padding >= minY && Math.min(object.y1, object.y2) - padding <= maxY;
  }
  return true;
}

export function traceMapRay(
  origin,
  angle,
  range,
  mapObjects,
  projectileRadius = 0,
  blockingField = 'blocksProjectiles',
  useSpatialIndex = true,
) {
  const end = { x: origin.x + Math.cos(angle) * range, y: origin.y + Math.sin(angle) * range };
  let firstHitT = 1;
  let firstObject = null;
  const visit = (object) => {
    if (blockingField && object[blockingField] === false) return;
    if (!segmentMapObjectBoundsOverlap(origin, end, object, projectileRadius)) return;
    const entryT = segmentMapObjectEntryT(origin, end, object, projectileRadius, blockingField);
    if (entryT !== null && entryT < firstHitT) {
      firstHitT = entryT;
      firstObject = object;
    }
  };
  if (useSpatialIndex) forEachMapObjectAlongSegment(mapObjects, origin, end, projectileRadius, visit);
  else for (const object of mapObjects ?? []) visit(object);
  return {
    end: {
      x: origin.x + (end.x - origin.x) * firstHitT,
      y: origin.y + (end.y - origin.y) * firstHitT,
    },
    firstObject,
  };
}

export function getMapRayEnd(origin, angle, range, mapObjects, projectileRadius = 0) {
  return traceMapRay(origin, angle, range, mapObjects, projectileRadius).end;
}

export function getClosestPointOnSegment(start, end, point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 1e-12
    ? 0
    : Math.max(0, Math.min(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 1));
  return { x: start.x + t * dx, y: start.y + t * dy, t };
}

function segmentRectEntryT(start, end, rect, padding) {
  const left = rect.x - rect.width / 2 - padding;
  const right = rect.x + rect.width / 2 + padding;
  const top = rect.y - rect.height / 2 - padding;
  const bottom = rect.y + rect.height / 2 + padding;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minimum = 0;
  let maximum = 1;
  let p = -dx;
  let q = start.x - left;
  for (let side = 0; side < 4; side += 1) {
    if (Math.abs(p) <= 1e-12) {
      if (q < 0) return null;
    } else {
      const ratio = q / p;
      if (p < 0) minimum = Math.max(minimum, ratio);
      else maximum = Math.min(maximum, ratio);
      if (minimum > maximum) return null;
    }
    if (side === 0) { p = dx; q = right - start.x; }
    else if (side === 1) { p = -dy; q = start.y - top; }
    else if (side === 2) { p = dy; q = bottom - start.y; }
  }
  return minimum;
}

function segmentWallEntryT(start, end, wall, radius) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const wx = wall.x2 - wall.x1;
  const wy = wall.y2 - wall.y1;
  const wallLength = Math.hypot(wx, wy);
  if (wallLength <= 1e-12) {
    return segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, wall.x1, wall.y1, radius);
  }

  let earliest = null;
  const startCap = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, wall.x1, wall.y1, radius);
  if (startCap !== null) earliest = startCap;
  const endCap = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, wall.x2, wall.y2, radius);
  if (endCap !== null && (earliest === null || endCap < earliest)) earliest = endCap;
  const denominator = cross(dx, dy, wx, wy);
  if (Math.abs(denominator) > 1e-12) {
    const offsetX = wall.x1 - start.x;
    const offsetY = wall.y1 - start.y;
    const t = cross(offsetX, offsetY, wx, wy) / denominator;
    const u = cross(offsetX, offsetY, dx, dy) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (earliest === null || t < earliest)) earliest = t;

    if (radius > 0) {
      const normalX = -wy / wallLength;
      const normalY = wx / wallLength;
      const signedStart = (start.x - wall.x1) * normalX + (start.y - wall.y1) * normalY;
      const signedDelta = dx * normalX + dy * normalY;
      if (Math.abs(signedDelta) > 1e-12) {
        for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
          const side = sideIndex === 0 ? -radius : radius;
          const sideT = (side - signedStart) / signedDelta;
          if (sideT < 0 || sideT > 1 || (earliest !== null && sideT >= earliest)) continue;
          const hitX = start.x + dx * sideT;
          const hitY = start.y + dy * sideT;
          const alongWall = (hitX - wall.x1) * (wx / wallLength) + (hitY - wall.y1) * (wy / wallLength);
          if (alongWall >= 0 && alongWall <= wallLength) earliest = sideT;
        }
      }
    }
  }
  return earliest;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}