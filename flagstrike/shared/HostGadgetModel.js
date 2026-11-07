import {
  ORBITAL_STRIKE_COOLDOWN_MS,
  ORBITAL_STRIKE_EXPLOSION_DAMAGE,
  ORBITAL_STRIKE_FIRE_DURATION_MS,
  ORBITAL_STRIKE_WARNING_DURATION_MS,
  ORBITAL_STRIKE_RADIUS,
  DEFAULT_GADGET_THROW_COLLISION_RADIUS,
  GADGET_DEFINITIONS,
  KATANA_DASH_HIT_RADIUS,
  KATANA_DASH_VISUAL_DURATION_MS,
  KATANA_ID,
  JAMMER_GRENADE_DURATION_MS,
  JAMMER_GRENADE_ID,
  JAMMER_GRENADE_RADIUS,
  PROXIMITY_MINE_ARMING_DURATION_MS,
  SPY_CAMERA_BODY_RADIUS,
  SPY_CAMERA_DURATION_MS,
  SPY_CAMERA_HEALTH,
  SPY_CAMERA_ID,
  SPY_CAMERA_RANGE,
  SMOKE_GRENADE_ID,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_COMMAND_EFFECT_ID,
  TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED,
  TROPHY_SYSTEM_COMMAND_RADIUS,
  SONAR_ID,
  VINE_TRAP_ID,
  calculateGadgetTrajectory,
  getGadgetProjectileSpeed,
  isGadgetJammed,
  isPlayerJammed,
} from './GadgetModel.js';
import { createVision, isCircleVisible } from './VisionModel.js';

const JAMMABLE_GADGET_TYPES = new Set([
  SPY_CAMERA_ID, TROPHY_SYSTEM_ID, 'mine', VINE_TRAP_ID, 'sonar-projectile',
]);

export function createHostKatanaDashEffect({ id, player, dash, now }) {
  if (!id || !player?.id || !dash?.start || !dash?.end ||
      ![dash.start.x, dash.start.y, dash.end.x, dash.end.y, dash.distance, dash.angle, now]
        .every(Number.isFinite) ||
      dash.distance <= 0) return null;
  return {
    id,
    type: 'katana-dash',
    gadgetId: KATANA_ID,
    effectRole: 'melee-dash',
    ownerId: player.id,
    team: player.team,
    startX: dash.start.x,
    startY: dash.start.y,
    angle: dash.angle,
    endX: dash.end.x,
    endY: dash.end.y,
    x: (dash.start.x + dash.end.x) / 2,
    y: (dash.start.y + dash.end.y) / 2,
    radius: dash.distance / 2 + KATANA_DASH_HIT_RADIUS,
    startedAt: now,
    expiresAt: now + KATANA_DASH_VISUAL_DURATION_MS,
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: false,
  };
}

export function createHostSpyCamera({ id, definition, player, angle, now }) {
  if (!id || !definition || !player ||
      ![player.x, player.y, angle, now].every(Number.isFinite)) return null;
  return {
    id,
    shape: 'circle',
    type: SPY_CAMERA_ID,
    gadgetId: definition.id,
    role: definition.effectRole,
    ownerId: player.id,
    team: player.team,
    x: player.x,
    y: player.y,
    angle,
    radius: definition.effectRadius ?? SPY_CAMERA_BODY_RADIUS,
    visionRange: definition.visionRange ?? SPY_CAMERA_RANGE,
    visionHalfAngle: definition.visionHalfAngle,
    health: definition.health ?? SPY_CAMERA_HEALTH,
    maxHealth: definition.health ?? SPY_CAMERA_HEALTH,
    startedAt: now,
    expiresAt: now + (definition.effectDurationMs ?? SPY_CAMERA_DURATION_MS),
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: false,
  };
}

export function createHostOrbitalStrikeWarning({ id, definition, player, target, now }) {
  if (!id || !definition || !player || !target ||
      ![target.x, target.y, now].every(Number.isFinite)) return null;
  const strikeAt = now + (definition.warningDurationMs ?? ORBITAL_STRIKE_WARNING_DURATION_MS);
  return {
    id,
    type: 'orbital-strike-warning',
    gadgetId: definition.id,
    ownerId: player.id,
    team: player.team,
    x: target.x,
    y: target.y,
    radius: definition.effectRadius ?? ORBITAL_STRIKE_RADIUS,
    explosionDamage: definition.explosionDamage ?? ORBITAL_STRIKE_EXPLOSION_DAMAGE,
    damagePerSecond: definition.damagePerSecond,
    fireDurationMs: definition.effectDurationMs ?? ORBITAL_STRIKE_FIRE_DURATION_MS,
    cooldownMs: definition.cooldownMs ?? ORBITAL_STRIKE_COOLDOWN_MS,
    startedAt: now,
    strikeAt,
    expiresAt: strikeAt,
  };
}

export function createHostOrbitalStrikeImpact(warning, now) {
  if (warning?.type !== 'orbital-strike-warning' ||
      ![warning.x, warning.y, warning.radius, now].every(Number.isFinite)) return null;
  const shared = {
    shape: 'circle',
    gadgetId: warning.gadgetId,
    ownerId: warning.ownerId,
    team: warning.team,
    x: warning.x,
    y: warning.y,
    radius: warning.radius,
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: false,
  };
  return {
    explosion: {
      ...shared,
      id: `${warning.id}:impact`.slice(0, 96),
      type: 'orbital-strike-explosion',
      startedAt: now,
      expiresAt: now + 600,
    },
    fire: {
      ...shared,
      id: `${warning.id}:fire`.slice(0, 96),
      type: 'molotov',
      damagePerSecond: warning.damagePerSecond ?? 50,
      startedAt: now,
      expiresAt: now + (warning.fireDurationMs ?? ORBITAL_STRIKE_FIRE_DURATION_MS),
    },
  };
}

export function createHostGadgetEffect({ id, definition, player, trajectory, now, matchEndsAt }) {
  if (!id || !definition || !player || !trajectory || !Array.isArray(trajectory.points) ||
      trajectory.points.length < 2 || !Number.isFinite(now) || !Number.isFinite(matchEndsAt)) return null;
  const pathLength = trajectory.points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - trajectory.points[index].x, point.y - trajectory.points[index].y), 0);
  const projectileSpeed = getGadgetProjectileSpeed(definition);
  const flightEndsAt = now + Math.max(16, pathLength / projectileSpeed * 1_000);
  const detonatesAt = flightEndsAt + (definition.detonationDelayMs ?? 0);
  const persistent = definition.persistsUntilTriggered === true ||
    definition.persistsUntilMatchEnd === true;
  const effect = {
    id,
    shape: 'circle',
    type: definition.effectType,
    role: definition.effectRole,
    gadgetId: definition.id,
    team: player.team,
    x: trajectory.endpoint.x,
    y: trajectory.endpoint.y,
    radius: definition.triggerRadius ?? definition.effectRadius ?? 100,
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: definition.blocksVision === true,
    ownerId: player.id,
    thrownAt: now,
    landedAt: flightEndsAt,
    detonatesAt,
    startedAt: detonatesAt,
    expiresAt: persistent ? matchEndsAt : detonatesAt + (definition.effectDurationMs ?? 12_000),
    ...(Number.isFinite(definition.health)
      ? { health: definition.health, maxHealth: definition.health } : {}),
    ...(definition.damagePerSecond ? { damagePerSecond: definition.damagePerSecond } : {}),
    ...(definition.minBlindDurationMs ? { minBlindDurationMs: definition.minBlindDurationMs } : {}),
    ...(definition.maxBlindDurationMs ? { maxBlindDurationMs: definition.maxBlindDurationMs } : {}),
    ...(definition.triggerOnEnemyProximity ? {
      triggerOnEnemyProximity: true,
      triggerRadius: definition.triggerRadius,
      hitRadius: definition.hitRadius,
      explosionDamage: definition.explosionDamage,
      armed: false,
      armedAt: now + (definition.armingDurationMs ?? PROXIMITY_MINE_ARMING_DURATION_MS),
      ...(definition.latchDurationMs ? { latchDurationMs: definition.latchDurationMs } : {}),
      ...(definition.rechargeDurationMs ? { rechargeDurationMs: definition.rechargeDurationMs } : {}),
    } : {}),
    ...(definition.movementSpeedMultiplier ? { movementScale: definition.movementSpeedMultiplier } : {}),
  };
  return {
    effect,
    landedAt: flightEndsAt,
    detonatesAt,
    trajectory: trajectory.points.map((point) => ({ x: point.x, y: point.y })),
    projectileSpeed,
  };
}

export function createHostTrophyCommandProjectile({
  id,
  player,
  trophy,
  target,
  mapObjects,
  now,
  matchEndsAt,
  mapWidth,
  mapHeight,
}) {
  if (!id || !player?.id || !trophy || trophy.ownerId !== player.id ||
      trophy.type !== TROPHY_SYSTEM_ID || trophy.team !== player.team ||
      isPlayerJammed(player, now) || isGadgetJammed(trophy, now) ||
      !Number.isFinite(trophy.startedAt) || trophy.startedAt > now ||
      !Number.isFinite(trophy.expiresAt) || trophy.expiresAt <= now ||
      (trophy.health ?? TROPHY_SYSTEM_HEALTH) <= 0 || !target ||
      ![trophy.x, trophy.y, target.x, target.y, now, matchEndsAt, mapWidth, mapHeight]
        .every(Number.isFinite) ||
      target.x < 0 || target.y < 0 || target.x > mapWidth || target.y > mapHeight ||
      matchEndsAt <= now || Math.hypot(target.x - trophy.x, target.y - trophy.y) <= 1e-6) return null;
  const trajectory = calculateGadgetTrajectory(
    { x: trophy.x, y: trophy.y },
    target,
    mapObjects.filter((object) => object?.blocksVision !== true),
    {
      maximumRange: Math.hypot(mapWidth, mapHeight),
      collisionRadius: DEFAULT_GADGET_THROW_COLLISION_RADIUS,
      maximumBounces: 0,
    },
  );
  if (!trajectory) return null;
  const pathLength = trajectory.points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - trajectory.points[index].x, point.y - trajectory.points[index].y), 0);
  if (!Number.isFinite(pathLength) || pathLength <= 0) return null;
  const landedAt = now + Math.max(16, pathLength / TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED * 1_000);
  const effect = {
    id,
    shape: 'circle',
    type: TROPHY_SYSTEM_COMMAND_EFFECT_ID,
    gadgetId: TROPHY_SYSTEM_ID,
    effectRole: 'trophy-command-projectile',
    ownerId: player.id,
    team: player.team,
    x: trajectory.endpoint.x,
    y: trajectory.endpoint.y,
    radius: TROPHY_SYSTEM_COMMAND_RADIUS,
    thrownAt: now,
    landedAt,
    detonatesAt: landedAt,
    startedAt: landedAt,
    expiresAt: matchEndsAt,
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: false,
  };
  return {
    effect,
    landedAt,
    detonatesAt: landedAt,
    trajectory: trajectory.points.map((point) => ({ x: point.x, y: point.y })),
    trajectoryPreview: trajectory,
    projectileSpeed: TROPHY_SYSTEM_COMMAND_PROJECTILE_SPEED,
  };
}

const TROPHY_CLEARABLE_GADGET_IDS = new Set(Object.keys(GADGET_DEFINITIONS));

export function isTrophyCommandEffectInRangeAndSight(
  pulse,
  effect,
  visionObjects = [],
  radius = TROPHY_SYSTEM_COMMAND_RADIUS,
) {
  if (![pulse?.x, pulse?.y, effect?.x, effect?.y, radius].every(Number.isFinite) || radius < 0 ||
      (Number.isFinite(effect.radius) && effect.radius < 0)) return false;
  const fieldRadius = Number.isFinite(effect.radius) ? effect.radius : 0;
  const occluders = (Array.isArray(visionObjects) ? visionObjects : [])
    .filter((object) => object?.id !== effect.id);
  const vision = createVision(
    { x: pulse.x, y: pulse.y },
    0,
    occluders,
    Math.max(1, radius * 2),
    Math.max(1, radius * 2),
    Math.PI,
    radius,
  );
  return isCircleVisible({ x: effect.x, y: effect.y }, fieldRadius, vision, occluders);
}

export function findTrophyCommandClearedEffects({
  pulse,
  gadgetEffects = [],
  smokes = [],
  visionObjects = [],
  now,
  radius = pulse?.radius ?? TROPHY_SYSTEM_COMMAND_RADIUS,
}) {
  if (pulse?.type !== TROPHY_SYSTEM_COMMAND_EFFECT_ID ||
      !['red', 'blue'].includes(pulse.team) ||
      ![pulse.x, pulse.y, now, radius].every(Number.isFinite) || radius <= 0) {
    return { gadgetEffectIds: new Set(), smokeIds: new Set() };
  }
  const removedIds = new Set();
  for (const effect of [...gadgetEffects, ...smokes]) {
    if (effect?.id === pulse.id || !TROPHY_CLEARABLE_GADGET_IDS.has(effect?.gadgetId) ||
        effect.team === pulse.team || !['red', 'blue'].includes(effect.team) ||
        !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now ||
        !isTrophyCommandEffectInRangeAndSight(pulse, effect, visionObjects, radius)) continue;
    removedIds.add(effect.id);
  }
  return {
    gadgetEffectIds: new Set(gadgetEffects.filter((effect) => removedIds.has(effect.id)).map((effect) => effect.id)),
    smokeIds: new Set(smokes.filter((effect) => removedIds.has(effect.id)).map((effect) => effect.id)),
  };
}

export function applyHostJammerDetonation({
  jammer,
  players,
  gadgetEffects,
  now,
  durationMs = JAMMER_GRENADE_DURATION_MS,
  radius = JAMMER_GRENADE_RADIUS,
}) {
  if (jammer?.gadgetId !== JAMMER_GRENADE_ID || !['red', 'blue'].includes(jammer.team) ||
      ![jammer.x, jammer.y, now, durationMs, radius].every(Number.isFinite) ||
      durationMs <= 0 || radius <= 0) {
    return { playerIds: [], gadgetIds: [] };
  }
  const jammedUntil = now + durationMs;
  const playerIds = [];
  const gadgetIds = [];
  for (const player of players ?? []) {
    if (player.team === jammer.team || player.alive === false || (player.health ?? 100) <= 0 ||
        ![player.x, player.y].every(Number.isFinite) ||
        Math.hypot(player.x - jammer.x, player.y - jammer.y) > radius) continue;
    player.jammedUntil = Math.max(player.jammedUntil ?? 0, jammedUntil);
    playerIds.push(player.id);
  }
  for (const gadget of gadgetEffects ?? []) {
    if (!JAMMABLE_GADGET_TYPES.has(gadget.type) || gadget.team === jammer.team ||
        !['red', 'blue'].includes(gadget.team) || gadget.expiresAt <= now ||
        ![gadget.x, gadget.y].every(Number.isFinite) ||
        Math.hypot(gadget.x - jammer.x, gadget.y - jammer.y) > radius) continue;
    gadget.jammedUntil = Math.max(gadget.jammedUntil ?? 0, jammedUntil);
    if (gadget.type === SPY_CAMERA_ID) {
      gadget.disabledUntil = Math.max(gadget.disabledUntil ?? 0, jammedUntil);
    }
    gadgetIds.push(gadget.id);
  }
  return { playerIds, gadgetIds };
}

export function createHostSonarProjectile({ id, definition, player, trajectory, now }) {
  if (!id || definition?.id !== SONAR_ID || !player?.id ||
      !Array.isArray(trajectory?.points) || trajectory.points.length < 2 ||
      ![now, definition.projectileSpeed, definition.projectileRange].every(Number.isFinite) ||
      definition.projectileSpeed <= 0 || definition.projectileRange <= 0) return null;
  const path = trajectory.points.map((point) => ({ x: point.x, y: point.y }));
  const pathLength = path.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - path[index].x, point.y - path[index].y), 0);
  if (!Number.isFinite(pathLength) || pathLength <= 0) return null;
  return {
    id,
    shape: 'circle',
    type: 'sonar-projectile',
    gadgetId: SONAR_ID,
    role: definition.effectRole,
    ownerId: player.id,
    team: player.team,
    x: path[0].x,
    y: path[0].y,
    path,
    pathLength: Math.min(pathLength, definition.projectileRange),
    travelledDistance: 0,
    speed: definition.projectileSpeed,
    listeningRadius: definition.listeningRadius,
    radius: definition.effectRadius,
    startedAt: now,
    expiresAt: now + Math.min(pathLength, definition.projectileRange) / definition.projectileSpeed * 1000,
    blocksMovement: false,
    blocksProjectiles: false,
    blocksVision: false,
  };
}

export function advanceHostSonarProjectiles(effects, players, elapsedMs, now) {
  const playerById = players instanceof Map
    ? players
    : new Map((players ?? []).map((player) => [player.id, player]));
  const removedEffectIds = new Set();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(now)) {
    return removedEffectIds;
  }
  for (const effect of effects ?? []) {
    if (effect.type !== 'sonar-projectile') continue;
    const owner = playerById.get(effect.ownerId);
    if (!owner || owner.alive === false || (owner.health ?? 100) <= 0 ||
        effect.expiresAt <= now || !Array.isArray(effect.path)) {
      removedEffectIds.add(effect.id);
      continue;
    }
    effect.travelledDistance = Math.min(effect.pathLength,
      (effect.travelledDistance ?? 0) + effect.speed * elapsedMs / 1000);
    let remainingDistance = effect.travelledDistance;
    for (let index = 1; index < effect.path.length; index += 1) {
      const start = effect.path[index - 1];
      const end = effect.path[index];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (remainingDistance <= segmentLength || index === effect.path.length - 1) {
        const fraction = segmentLength > 0 ? Math.min(1, remainingDistance / segmentLength) : 1;
        effect.x = start.x + (end.x - start.x) * fraction;
        effect.y = start.y + (end.y - start.y) * fraction;
        break;
      }
      remainingDistance -= segmentLength;
    }
    if (effect.travelledDistance >= effect.pathLength) removedEffectIds.add(effect.id);
  }
  return removedEffectIds;
}
