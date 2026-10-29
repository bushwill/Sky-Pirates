import { resolveCircleMovement } from './MapGeometry.js';

export const PLAYER_RADIUS = 9;
export const MAX_PLAYER_SPEED = 80;
export const SLOW_WALK_SPEED_SCALE = 0.6;
export const PLAYER_ACCELERATION = 250;
export const PLAYER_TURN_ACCELERATION = 500;
export const PLAYER_BRAKING = 3500;
export const ASSAULT_RIFLE_MOVEMENT_SCALE = 0.9;
export const FLAG_CARRIER_MOVEMENT_SCALE = 0.7;

export function shouldHostSimulateActor(player, activePlayerId) {
  return Boolean(player?.alive && (player.health == null || player.health > 0) &&
    player.id !== activePlayerId && player.isBot === true && player.controlledById == null);
}

export function getPlayerMovementScale(isFlagCarrier = false, weaponMovementScale = ASSAULT_RIFLE_MOVEMENT_SCALE, movementBonus = 0) {
  return isFlagCarrier ? FLAG_CARRIER_MOVEMENT_SCALE : weaponMovementScale + Math.max(0, movementBonus);
}

export function getDesiredVelocity(input, maximumSpeed = MAX_PLAYER_SPEED) {
  const horizontal = Number(input.right) - Number(input.left);
  const vertical = Number(input.down) - Number(input.up);
  const directionLength = Math.hypot(horizontal, vertical);
  if (directionLength === 0) return { x: 0, y: 0 };

  return {
    x: (horizontal / directionLength) * maximumSpeed,
    y: (vertical / directionLength) * maximumSpeed,
  };
}

export function movePosition(
  player, input, seconds, mapWidth, mapHeight = mapWidth, mapObjects = [], movementScale = 1, maximumSpeedScale = 1.15,
) {
  const delta = Math.max(0, Math.min(seconds, 0.05));
  const behaviorSpeedScale = Number.isFinite(input?.speedScale) ? input.speedScale : 1;
  const speedScale = Math.max(0, Math.min(movementScale * behaviorSpeedScale, maximumSpeedScale));
  const maximumSpeed = MAX_PLAYER_SPEED * speedScale;
  const previousVx = player.vx ?? 0;
  const previousVy = player.vy ?? 0;
  let vx = previousVx;
  let vy = previousVy;

  const desiredVelocity = getDesiredVelocity(input, maximumSpeed);
  if (desiredVelocity.x !== 0 || desiredVelocity.y !== 0) {
    const currentSpeed = Math.hypot(vx, vy);
    const desiredSpeed = Math.hypot(desiredVelocity.x, desiredVelocity.y);
    const directionAlignment = currentSpeed > 1e-9 && desiredSpeed > 0
      ? (vx * desiredVelocity.x + vy * desiredVelocity.y) / (currentSpeed * desiredSpeed)
      : 1;
    const acceleration = directionAlignment < 0.75 ? PLAYER_TURN_ACCELERATION : PLAYER_ACCELERATION;
    ({ x: vx, y: vy } = moveVectorTowards(
      vx,
      vy,
      desiredVelocity.x,
      desiredVelocity.y,
      acceleration * speedScale * delta,
    ));
  } else {
    ({ x: vx, y: vy } = moveVectorTowards(vx, vy, 0, 0, PLAYER_BRAKING * delta));
  }

  const speed = Math.hypot(vx, vy);
  if (speed > maximumSpeed) {
    const scale = maximumSpeed / speed;
    vx *= scale;
    vy *= scale;
  }

  let x = player.x + ((previousVx + vx) / 2) * delta;
  let y = player.y + ((previousVy + vy) / 2) * delta;
  const resolved = resolveCircleMovement(
    player,
    { x: x - player.x, y: y - player.y },
    mapObjects,
    PLAYER_RADIUS,
  );
  x = resolved.x;
  y = resolved.y;
  for (const normal of resolved.collisionNormals) {
    const velocityIntoWall = vx * normal.x + vy * normal.y;
    if (velocityIntoWall < 0) {
      vx -= velocityIntoWall * normal.x;
      vy -= velocityIntoWall * normal.y;
    }
  }
  if (x < PLAYER_RADIUS || x > mapWidth - PLAYER_RADIUS) vx = 0;
  if (y < PLAYER_RADIUS || y > mapHeight - PLAYER_RADIUS) vy = 0;
  x = clamp(x, PLAYER_RADIUS, mapWidth - PLAYER_RADIUS);
  y = clamp(y, PLAYER_RADIUS, mapHeight - PLAYER_RADIUS);

  return { x, y, vx, vy };
}

export function movePositionWithCatchUp(
  player, input, seconds, mapWidth, mapHeight = mapWidth, mapObjects = [], movementScale = 1, maximumSpeedScale = 1.15,
) {
  let remaining = Math.min(Math.max(seconds, 0), 0.1);
  let result = player;
  while (remaining > 0) {
    const step = Math.min(remaining, 0.05);
    result = movePosition(result, input, step, mapWidth, mapHeight, mapObjects, movementScale, maximumSpeedScale);
    remaining -= step;
  }
  return result;
}

export function constrainPositionToRadius(position, center, radius) {
  if (![position?.x, position?.y, center?.x, center?.y, radius].every(Number.isFinite) || radius < 0) {
    return position;
  }
  const dx = position.x - center.x;
  const dy = position.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance <= 1e-9) return position;
  const normalX = dx / distance;
  const normalY = dy / distance;
  const outwardVelocity = (position.vx ?? 0) * normalX + (position.vy ?? 0) * normalY;
  return {
    ...position,
    x: center.x + normalX * radius,
    y: center.y + normalY * radius,
    vx: outwardVelocity > 0 ? (position.vx ?? 0) - outwardVelocity * normalX : position.vx,
    vy: outwardVelocity > 0 ? (position.vy ?? 0) - outwardVelocity * normalY : position.vy,
  };
}

function moveVectorTowards(x, y, targetX, targetY, maximumChange) {
  const deltaX = targetX - x;
  const deltaY = targetY - y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= maximumChange || distance === 0) return { x: targetX, y: targetY };
  const scale = maximumChange / distance;
  return { x: x + deltaX * scale, y: y + deltaY * scale };
}

export function interpolatePosition(current, target, delta, smoothingMs = 65) {
  const smoothing = 1 - Math.exp(-Math.min(delta, 100) / smoothingMs);
  return {
    x: current.x + (target.x - current.x) * smoothing,
    y: current.y + (target.y - current.y) * smoothing,
  };
}

export function selectSnapshotPosition(previous, authoritative, preserveCurrentPosition) {
  if (previous && preserveCurrentPosition &&
      Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
    return { x: previous.x, y: previous.y };
  }
  return { x: authoritative.x, y: authoritative.y };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
