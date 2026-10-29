export function getRenderCorrection(previous, position, snap = false, maximumCorrection = 120) {
  if (!previous || snap) return { x: 0, y: 0 };
  const offset = {
    x: previous.x + (previous.renderOffsetX ?? 0) - position.x,
    y: previous.y + (previous.renderOffsetY ?? 0) - position.y,
  };
  if (Math.hypot(offset.x, offset.y) > maximumCorrection) return { x: 0, y: 0 };
  return offset;
}

export function decayRenderCorrection(offset, deltaMs, smoothingMs = 110) {
  const factor = Math.exp(-Math.max(0, deltaMs) / smoothingMs);
  const next = { x: offset.x * factor, y: offset.y * factor };
  if (Math.hypot(next.x, next.y) < 0.1) return { x: 0, y: 0 };
  return next;
}

export function getRenderedPosition(player) {
  return {
    x: player.x + (player.renderOffsetX ?? 0),
    y: player.y + (player.renderOffsetY ?? 0),
  };
}
