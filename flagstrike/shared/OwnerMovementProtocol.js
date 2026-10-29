import { MAX_PLAYER_SPEED, PLAYER_RADIUS } from './MovementModel.js';

export function validateOwnerMovementUpdate(update, { playerId, mapWidth, mapHeight }) {
  if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.sequence) || update.sequence < 1 ||
      typeof playerId !== 'string' || !Number.isFinite(mapWidth) || !Number.isFinite(mapHeight)) {
    return { valid: false, reason: 'Owner movement metadata is invalid.' };
  }
  const input = update.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      ['up', 'down', 'left', 'right', 'drop'].some((key) => typeof input[key] !== 'boolean') ||
      !Number.isFinite(input.weaponLean) || Math.abs(input.weaponLean) > 1 ||
      !Number.isFinite(input.speedScale) || input.speedScale <= 0 || input.speedScale > 1 ||
      !Number.isFinite(input.visionAngle) || !Number.isFinite(input.aimAngle)) {
    return { valid: false, reason: 'Owner movement input is invalid.' };
  }
  const pose = update.playerPose;
  if (!pose || pose.id !== playerId ||
      ![pose.x, pose.y, pose.vx, pose.vy].every(Number.isFinite) ||
      pose.x < PLAYER_RADIUS || pose.y < PLAYER_RADIUS ||
      pose.x > mapWidth - PLAYER_RADIUS || pose.y > mapHeight - PLAYER_RADIUS ||
      Math.hypot(pose.vx, pose.vy) > MAX_PLAYER_SPEED * 1.15) {
    return { valid: false, reason: 'Owner player pose is invalid.' };
  }
  return { valid: true };
}
