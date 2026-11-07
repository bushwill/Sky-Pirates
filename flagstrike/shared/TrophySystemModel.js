import {
  CRYO_GRENADE_ID,
  FLASH_GRENADE_ID,
  BIO_FIELD_ID,
  JAMMER_GRENADE_ID,
  MOLOTOV_ID,
  PROXIMITY_MINE_ID,
  SMOKE_GRENADE_ID,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_ID,
  VINE_TRAP_ID,
} from './GadgetModel.js';
import { isPointVisible } from './VisionModel.js';

const INTERCEPTABLE_PROJECTILE_IDS = new Set([
  SMOKE_GRENADE_ID,
  FLASH_GRENADE_ID,
  CRYO_GRENADE_ID,
  MOLOTOV_ID,
  PROXIMITY_MINE_ID,
  VINE_TRAP_ID,
  JAMMER_GRENADE_ID,
  BIO_FIELD_ID,
  TROPHY_SYSTEM_ID,
]);
const INTERCEPTABLE_PLACED_TYPES = new Set([
  SPY_CAMERA_ID,
  'mine',
  VINE_TRAP_ID,
  TROPHY_SYSTEM_ID,
]);
const PROJECTILE_SAMPLE_SPACING = 8;

export function hasTrophyLineOfSight(trophy, point, visionObjects = []) {
  if (![trophy?.x, trophy?.y, point?.x, point?.y].every(Number.isFinite)) return false;
  if (Math.hypot(point.x - trophy.x, point.y - trophy.y) <= 1e-9) return true;
  return isPointVisible(point, {
    origin: { x: trophy.x, y: trophy.y },
    angle: Math.atan2(point.y - trophy.y, point.x - trophy.x),
    halfAngle: Math.PI,
  }, visionObjects);
}

export function getOwnedActiveTrophySystem(trophyEffects, ownerId, now = Date.now()) {
  if (typeof ownerId !== 'string' || !Number.isFinite(now)) return null;
  return (trophyEffects ?? []).find((effect) =>
    effect?.ownerId === ownerId && isActiveTrophy(effect, now, now)) ?? null;
}

function getPointAlongPath(points, distanceAlong) {
  let remaining = distanceAlong;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= length || index === points.length - 1) {
      const fraction = length > 0 ? Math.min(1, remaining / length) : 1;
      return {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      };
    }
    remaining -= length;
  }
  return points.at(-1);
}

function getPathLength(points) {
  return points.slice(1).reduce((sum, point, index) =>
    sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
}

function isActiveTrophy(effect, fromAt, now) {
  return effect?.type === TROPHY_SYSTEM_ID && ['red', 'blue'].includes(effect.team) &&
    effect.startedAt <= now && effect.expiresAt > fromAt && (effect.health ?? 1) > 0;
}

export function findTrophyProjectileInterceptions(
  pendingEffects,
  trophyEffects,
  visionObjects,
  fromAt,
  now,
) {
  if (![fromAt, now].every(Number.isFinite) || now < fromAt) return [];
  const trophies = (trophyEffects ?? []).filter((effect) => isActiveTrophy(effect, fromAt, now));
  if (!trophies.length) return [];
  const interceptions = [];

  for (const pending of pendingEffects ?? []) {
    const effect = pending?.effect;
    if (!INTERCEPTABLE_PROJECTILE_IDS.has(effect?.gadgetId) ||
        !['red', 'blue'].includes(effect.team) ||
        !Array.isArray(pending.trajectory) || pending.trajectory.length < 2 ||
        ![effect.thrownAt, pending.landedAt, pending.projectileSpeed].every(Number.isFinite) ||
        pending.projectileSpeed <= 0 || effect.thrownAt > now) continue;
    const pathLength = getPathLength(pending.trajectory);
    if (pathLength <= 0) continue;
    const flightEndAt = Math.min(now, pending.landedAt);
    const flightStartAt = Math.max(fromAt, effect.thrownAt);
    const flightDurationMs = pending.landedAt - effect.thrownAt;
    if (flightEndAt < flightStartAt || flightDurationMs <= 0) continue;
    const startDistance = pathLength * Math.max(0, Math.min(1,
      (flightStartAt - effect.thrownAt) / flightDurationMs));
    const endDistance = pathLength * Math.max(0, Math.min(1,
      (flightEndAt - effect.thrownAt) / flightDurationMs));
    const travelledDistance = Math.max(0, endDistance - startDistance);
    const sampleCount = Math.max(1, Math.ceil(travelledDistance / PROJECTILE_SAMPLE_SPACING));

    for (const trophy of trophies) {
      if (trophy.team === effect.team) continue;
      for (let sample = 0; sample <= sampleCount; sample += 1) {
        const progress = sample / sampleCount;
        const position = getPointAlongPath(
          pending.trajectory,
          startDistance + travelledDistance * progress,
        );
        if (!hasTrophyLineOfSight(trophy, position, visionObjects)) continue;
        interceptions.push({
          effectId: effect.id,
          gadgetId: effect.gadgetId,
          trophyId: trophy.id,
          trophyPosition: { x: trophy.x, y: trophy.y },
          team: trophy.team,
          position,
        });
        break;
      }
      if (interceptions.at(-1)?.effectId === effect.id) break;
    }
  }
  return interceptions;
}

export function findTrophyPlacedGadgetInterceptions(effects, trophyEffects, visionObjects, now) {
  if (!Number.isFinite(now)) return new Set();
  const trophies = (trophyEffects ?? []).filter((effect) => isActiveTrophy(effect, now, now));
  const removedIds = new Set();
  for (const target of effects ?? []) {
    if (!INTERCEPTABLE_PLACED_TYPES.has(target?.type) ||
        !['red', 'blue'].includes(target.team) ||
        !Number.isFinite(target.expiresAt) || target.expiresAt <= now ||
        (Number.isFinite(target.health) && target.health <= 0)) continue;
    if (trophies.some((trophy) => trophy.team !== target.team &&
        hasTrophyLineOfSight(trophy, target, visionObjects))) {
      removedIds.add(target.id);
    }
  }
  return removedIds;
}
