import { resolveCircleMovement } from './MapGeometry.js';

export const WEAPON_LEAN_SIDE_OFFSET = 7;
export const WEAPON_COLLISION_RADIUS = 2;

export function getWeaponMuzzlePosition(position, aimAngle, lean = 0, mapObjects = []) {
  if (lean !== -1 && lean !== 1) return { x: position.x, y: position.y };
  const forwardX = Math.cos(aimAngle);
  const forwardY = Math.sin(aimAngle);
  const sideOffset = lean * WEAPON_LEAN_SIDE_OFFSET;
  const displacement = {
    x: -forwardY * sideOffset,
    y: forwardX * sideOffset,
  };
  const resolved = resolveCircleMovement(position, displacement, mapObjects, WEAPON_COLLISION_RADIUS);
  return { x: resolved.x, y: resolved.y };
}

export function getWeaponAimAngle(position, target, lean = 0, mapObjects = []) {
  let angle = Math.atan2(target.y - position.y, target.x - position.x);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const muzzle = getWeaponMuzzlePosition(position, angle, lean, mapObjects);
    const deltaX = target.x - muzzle.x;
    const deltaY = target.y - muzzle.y;
    if (Math.hypot(deltaX, deltaY) <= 1e-9) break;
    angle = Math.atan2(deltaY, deltaX);
  }
  return angle;
}