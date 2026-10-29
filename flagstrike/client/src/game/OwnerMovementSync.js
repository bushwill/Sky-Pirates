import { getRenderCorrection } from './RenderCorrection.js';
import { validateOwnerMovementUpdate } from '../../../shared/OwnerMovementProtocol.js';

export function applyOwnerMovementUpdate(player, update, bounds, { preservePose = false } = {}) {
  if (!player?.alive || !validateOwnerMovementUpdate(update, {
    playerId: player.id,
    mapWidth: bounds.width,
    mapHeight: bounds.height,
  }).valid || update.sequence <= (player.lastInputSequence ?? 0)) return false;

  const pose = update.playerPose;
  let poseUpdate = {};
  if (!preservePose) {
    const renderOffset = getRenderCorrection(player, pose);
    poseUpdate = {
      x: pose.x,
      y: pose.y,
      renderOffsetX: renderOffset.x,
      renderOffsetY: renderOffset.y,
      vx: pose.vx,
      vy: pose.vy,
    };
  }
  Object.assign(player, {
    ...poseUpdate,
    weaponLean: update.input.weaponLean,
    visionAngle: update.input.visionAngle,
    weaponStats: {
      ...(player.weaponStats ?? {}),
      [player.selectedWeaponId ?? 'assault-rifle']: {
        ...(player.weaponStats?.[player.selectedWeaponId ?? 'assault-rifle'] ?? {}),
        aimAngle: update.input.aimAngle,
        aimUpdatedAt: Date.now(),
      },
    },
    input: update.input,
    inputSequence: update.sequence,
    lastInputSequence: update.sequence,
  });
  return true;
}
