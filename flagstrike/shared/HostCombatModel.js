import { segmentCircleEntryT, traceMapRay } from './ProjectileModel.js';
import { PLAYER_RADIUS } from './MovementModel.js';
import {
  KATANA_DASH_HIT_RADIUS,
  PROXIMITY_MINE_HIT_RADIUS,
  SPY_CAMERA_BODY_RADIUS,
  SPY_CAMERA_HEALTH,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_ID,
  VINE_TRAP_ID,
} from './GadgetModel.js';

const PLACED_GADGET_TYPES = new Set([SPY_CAMERA_ID, TROPHY_SYSTEM_ID, 'mine', VINE_TRAP_ID]);

export function getHostAimAngle(direction, fallbackAngle = 0) {
  if (!Number.isFinite(direction?.x) || !Number.isFinite(direction?.y) ||
      Math.hypot(direction.x, direction.y) <= 1e-9) return fallbackAngle;
  return Math.atan2(direction.y, direction.x);
}

export function getHostShotAngle(direction, reportedAngle, maximumSpreadRadians, fallbackAngle) {
  const aimAngle = getHostAimAngle(direction, fallbackAngle);
  if (!Number.isFinite(reportedAngle) || !Number.isFinite(maximumSpreadRadians) || maximumSpreadRadians < 0) {
    return fallbackAngle;
  }
  const spread = Math.atan2(Math.sin(reportedAngle - aimAngle), Math.cos(reportedAngle - aimAngle));
  return Math.abs(spread) <= maximumSpreadRadians + 1e-9 ? reportedAngle : fallbackAngle;
}

export function findFirstKatanaDashTarget({
  start,
  end,
  players = [],
  ownerId,
  ownerTeam,
  hitRadius = KATANA_DASH_HIT_RADIUS,
}) {
  if (![start?.x, start?.y, end?.x, end?.y, hitRadius].every(Number.isFinite) || hitRadius <= 0) return null;
  let firstHit = null;
  for (const player of players) {
    if (!player.alive || player.health <= 0 || player.id === ownerId ||
        (ownerTeam && player.team === ownerTeam)) continue;
    const entryT = segmentCircleEntryT(start, end, player, hitRadius);
    if (entryT === null || (firstHit && entryT >= firstHit.entryT)) continue;
    firstHit = { player, entryT };
  }
  return firstHit;
}

export function applyHostPropDamage(object, damage) {
  if (!object || object.role !== 'destructible-prop' || !Number.isFinite(object.health) ||
      !Number.isFinite(damage) || damage <= 0) return { applied: false, health: object?.health ?? null, destroyed: false };
  object.health = Math.max(0, object.health - damage);
  const destroyed = object.health === 0;
  if (destroyed) {
    object.blocksMovement = false;
    object.blocksProjectiles = false;
    object.blocksVision = false;
  }
  return { applied: true, health: object.health, destroyed };
}

export function applyTrophySystemDamage(effect, damage) {
  if (effect?.type !== TROPHY_SYSTEM_ID || !Number.isFinite(damage) || damage <= 0) {
    return { applied: false, health: effect?.health ?? null, destroyed: false };
  }
  const currentHealth = Number.isFinite(effect.health) ? effect.health : TROPHY_SYSTEM_HEALTH;
  effect.health = Math.max(0, currentHealth - damage);
  return { applied: true, health: effect.health, destroyed: effect.health === 0 };
}

function getPlacedGadgetBodyRadius(effect) {
  if (effect.type === SPY_CAMERA_ID) return effect.radius ?? SPY_CAMERA_BODY_RADIUS;
  if (effect.type === TROPHY_SYSTEM_ID) return effect.radius ?? TROPHY_SYSTEM_BODY_RADIUS;
  return effect.hitRadius ?? PROXIMITY_MINE_HIT_RADIUS;
}

export function applyGadgetAreaDamage(
  effects, mapObjects, center, radius, damage, sourceId = null, now = Date.now(),
) {
  if (![center?.x, center?.y, radius, damage].every(Number.isFinite) || radius < 0 || damage <= 0) {
    return { removedEffectIds: new Set(), damagedGadgets: [], damagedProps: [] };
  }
  const removedEffectIds = new Set();
  const damagedGadgets = [];
  const damagedProps = [];
  for (const effect of effects ?? []) {
    if ((sourceId !== null && effect.id === sourceId) || !PLACED_GADGET_TYPES.has(effect.type) ||
        !Number.isFinite(effect.x) || !Number.isFinite(effect.y) ||
        (Number.isFinite(effect.expiresAt) && effect.expiresAt <= now) ||
        Math.hypot(effect.x - center.x, effect.y - center.y) >
          radius + Math.max(0, getPlacedGadgetBodyRadius(effect))) continue;
    if (effect.type === SPY_CAMERA_ID || effect.type === TROPHY_SYSTEM_ID) {
      const health = effect.type === TROPHY_SYSTEM_ID
        ? applyTrophySystemDamage(effect, damage)
        : (() => {
          const currentHealth = Number.isFinite(effect.health) ? effect.health : SPY_CAMERA_HEALTH;
          effect.health = Math.max(0, currentHealth - damage);
          return { applied: true, health: effect.health, destroyed: effect.health === 0 };
        })();
      if (!health.applied) continue;
      damagedGadgets.push({ effect, health: health.health, destroyed: health.destroyed });
      if (health.destroyed) removedEffectIds.add(effect.id);
    } else {
      removedEffectIds.add(effect.id);
      damagedGadgets.push({ effect, health: 0, destroyed: true });
    }
  }

  for (const object of mapObjects ?? []) {
    if (object.role !== 'destructible-prop' || object.health <= 0 ||
        distanceToMapObject(center, object) > radius) continue;
    const result = applyHostPropDamage(object, damage);
    if (result.applied) damagedProps.push({
      sourceId,
      object,
      health: result.health,
      destroyed: result.destroyed,
    });
  }
  return { removedEffectIds, damagedGadgets, damagedProps };
}

function distanceToMapObject(point, object) {
  if (object.shape === 'circle') {
    return Math.max(0, Math.hypot(point.x - object.x, point.y - object.y) - object.radius);
  }
  if (object.shape === 'rect') {
    const dx = Math.max(0, Math.abs(point.x - object.x) - object.width / 2);
    const dy = Math.max(0, Math.abs(point.y - object.y) - object.height / 2);
    return Math.hypot(dx, dy);
  }
  if (object.shape === 'segment') {
    const dx = object.x2 - object.x1;
    const dy = object.y2 - object.y1;
    const lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(1,
      ((point.x - object.x1) * dx + (point.y - object.y1) * dy) / lengthSquared));
    return Math.hypot(point.x - (object.x1 + dx * along), point.y - (object.y1 + dy * along));
  }
  return Infinity;
}

export function applyMolotovWorldEffects(effects, mapObjects, tickStartedAt, now) {
  const activeCryos = (effects ?? []).filter((effect) =>
    effect.type === 'cryo' && effect.startedAt <= now && effect.expiresAt > now);
  const removedEffectIds = new Set();
  const burns = [];
  const damagedProps = [];
  const damagedGadgets = [];

  for (const molotov of effects ?? []) {
    if (molotov.type !== 'molotov') continue;
    const extinguishedAt = activeCryos
      .filter((cryo) => Math.hypot(cryo.x - molotov.x, cryo.y - molotov.y) <=
        (cryo.radius ?? 0) + (molotov.radius ?? 0))
      .reduce((earliest, cryo) => Math.min(earliest, cryo.startedAt), Infinity);
    if (extinguishedAt <= now) removedEffectIds.add(molotov.id);
    const activeMs = Math.max(0,
      Math.min(now, molotov.expiresAt, extinguishedAt) - Math.max(tickStartedAt, molotov.startedAt));
    if (activeMs <= 0) continue;
    const damage = (molotov.damagePerSecond ?? 30) * activeMs / 1000;
    burns.push({ molotov, damage });

    const areaDamage = applyGadgetAreaDamage(
      effects, mapObjects, molotov, molotov.radius ?? 0, damage, molotov.id, now,
    );
    for (const id of areaDamage.removedEffectIds) removedEffectIds.add(id);
    damagedProps.push(...areaDamage.damagedProps.map((result) => ({ ...result, molotovId: molotov.id })));
    damagedGadgets.push(...areaDamage.damagedGadgets.map((result) => ({
      ...result, molotovId: molotov.id,
    })));
  }

  return { removedEffectIds, burns, damagedProps, damagedGadgets };
}

export function preserveDestructiblePropState(previousObjects, nextObjects) {
  const previousProps = new Map((previousObjects ?? [])
    .filter((object) => object.role === 'destructible-prop')
    .map((object) => [object.id, object]));
  let changed = false;
  for (const object of nextObjects ?? []) {
    if (object.role !== 'destructible-prop') continue;
    const previous = previousProps.get(object.id);
    if (!previous || !Number.isFinite(previous.health)) continue;
    const nextHealth = Number.isFinite(object.health) ? object.health : object.maxHealth ?? 300;
    if (previous.health >= nextHealth) continue;
    object.health = Math.max(0, previous.health);
    const blocks = object.health > 0;
    object.blocksMovement = blocks;
    object.blocksProjectiles = blocks;
    object.blocksVision = blocks;
    changed = true;
  }
  return changed;
}

/** Resolve the first collision on a host-simulated hitscan/projectile path. */
export function resolveHostShotCollision({
  start,
  angle,
  range,
  mapObjects = [],
  players = [],
  gadgetEffects = [],
  ownerId,
  ownerTeam,
  friendlyFire = false,
  radius = 0,
  now = Date.now(),
}) {
  const trace = traceMapRay(start, angle, range, mapObjects, radius);
  const dx = trace.end.x - start.x;
  const dy = trace.end.y - start.y;
  const length = Math.hypot(dx, dy);
  let nearest = trace.firstObject
    ? { kind: 'object', target: trace.firstObject, distance: length, end: trace.end }
    : { kind: null, target: null, distance: Infinity, end: trace.end };

  const consider = (kind, target, entryT) => {
    if (entryT === null) return;
    const distance = entryT * length;
    if (distance >= nearest.distance) return;
    nearest = {
      kind,
      target,
      distance,
      end: { x: start.x + dx * entryT, y: start.y + dy * entryT },
    };
  };

  for (const player of players) {
    if (!player.alive || player.health <= 0 || player.id === ownerId ||
        (!friendlyFire && player.team === ownerTeam)) continue;
    consider('player', player, segmentCircleEntryT(start, trace.end, player, (player.radius ?? PLAYER_RADIUS) + radius));
  }

  for (const effect of gadgetEffects) {
    if ((effect.type === SPY_CAMERA_ID || effect.type === TROPHY_SYSTEM_ID) &&
        ownerTeam && ownerTeam !== effect.team) {
      consider('gadget', effect, segmentCircleEntryT(
        start, trace.end, effect, Math.max(0, effect.radius ??
          (effect.type === TROPHY_SYSTEM_ID ? TROPHY_SYSTEM_BODY_RADIUS : SPY_CAMERA_BODY_RADIUS)) + radius,
      ));
      continue;
    }
    const isVineTrapBeforeActivation = effect.type === VINE_TRAP_ID &&
      effect.triggerOnEnemyProximity && !effect.latchedEnemyId && effect.expiresAt > now;
    const isMine = effect.type === 'mine' && effect.triggerOnEnemyProximity &&
      (!Number.isFinite(effect.expiresAt) || effect.expiresAt > now);
    if ((!isVineTrapBeforeActivation && !isMine) ||
        !ownerTeam || ownerTeam === effect.team) continue;
    const hitRadius = Math.max(0, effect.hitRadius ?? 8) + radius;
    consider('gadget', effect, segmentCircleEntryT(start, trace.end, effect, hitRadius));
  }

  return { ...nearest, mapTrace: trace };
}
