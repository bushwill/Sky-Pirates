export function getSmokeVisibleSamples(smoke, visions, sampleCount, isPointVisible, forceVisible = false) {
  if (!smoke || !Array.isArray(visions) || !Number.isSafeInteger(sampleCount) || sampleCount < 1 ||
      typeof isPointVisible !== 'function') return [];
  const observerInsideSmoke = visions.some((vision) => vision?.origin &&
    Math.hypot(vision.origin.x - smoke.x, vision.origin.y - smoke.y) <= smoke.radius);
  if (forceVisible || observerInsideSmoke) return Array(sampleCount).fill(true);

  return Array.from({ length: sampleCount }, (_, index) => {
    const angle = (index / sampleCount) * Math.PI * 2;
    const point = {
      x: smoke.x + Math.cos(angle) * smoke.radius,
      y: smoke.y + Math.sin(angle) * smoke.radius,
    };
    return visions.some((vision) => isPointVisible(point, vision));
  });
}
