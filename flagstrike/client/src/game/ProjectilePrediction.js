export function consumePredictedShotPellet(pendingPellets, projectile) {
  if (!projectile || !Number.isSafeInteger(projectile.ownerActionSequence)) return false;
  const key = `${projectile.ownerId}:${projectile.ownerActionSequence}`;
  const remaining = pendingPellets.get(key) ?? 0;
  if (remaining <= 0) return false;
  if (remaining === 1) pendingPellets.delete(key);
  else pendingPellets.set(key, remaining - 1);
  return true;
}

export function shouldRenderConfirmedProjectile(matchedPrediction, predictedVisualActive) {
  return !matchedPrediction || predictedVisualActive;
}
