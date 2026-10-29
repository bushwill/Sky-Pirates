export function selectOwnerControlledPose(previous, authoritativePlayer, controlChanged = false) {
  if (previous && !controlChanged && Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
    return {
      x: previous.x,
      y: previous.y,
      vx: previous.vx ?? 0,
      vy: previous.vy ?? 0,
    };
  }
  return {
    x: authoritativePlayer.x,
    y: authoritativePlayer.y,
    vx: authoritativePlayer.vx ?? 0,
    vy: authoritativePlayer.vy ?? 0,
  };
}
