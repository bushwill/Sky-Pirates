export const HOST_FRAME_INTERVAL_MS = 1_000 / 20;

const ADAPTIVE_UPDATE_PROFILES = Object.freeze({
  LOW: Object.freeze({
    frameOverlayIntervalMs: 1000 / 60,
    inventoryIntervalMs: 50,
    matchHudIntervalMs: 50,
    controlledVisionIntervalMs: 1000 / 60,
    teammateVisionBaseMs: 50,
    teammateVisionRankStepMs: 25,
    maxTeammateVisionUpdatesPerFrame: 1,
    smokeVisibilityIntervalMs: 1000 / 60,
    visiblePropIntervalMs: 100,
  }),
  MEDIUM: Object.freeze({
    frameOverlayIntervalMs: 1000 / 40,
    inventoryIntervalMs: 50,
    matchHudIntervalMs: 100,
    controlledVisionIntervalMs: 25,
    teammateVisionBaseMs: 100,
    teammateVisionRankStepMs: 75,
    maxTeammateVisionUpdatesPerFrame: 1,
    smokeVisibilityIntervalMs: 1000 / 30,
    visiblePropIntervalMs: 150,
  }),
  HIGH: Object.freeze({
    frameOverlayIntervalMs: 1000 / 30,
    inventoryIntervalMs: 100,
    matchHudIntervalMs: 200,
    controlledVisionIntervalMs: 1000 / 30,
    teammateVisionBaseMs: 200,
    teammateVisionRankStepMs: 200,
    maxTeammateVisionUpdatesPerFrame: 1,
    smokeVisibilityIntervalMs: 50,
    visiblePropIntervalMs: 250,
  }),
});

export function smoothComputationTime(previousMs, currentMs, smoothing = 0.12) {
  if (!Number.isFinite(currentMs) || currentMs < 0) return previousMs ?? 0;
  if (!Number.isFinite(previousMs)) return currentMs;
  const weight = Math.max(0, Math.min(1, smoothing));
  return previousMs + (currentMs - previousMs) * weight;
}

export function getComputationLevel(milliseconds) {
  if (milliseconds < 4) return 'LOW';
  if (milliseconds < 10) return 'MEDIUM';
  return 'HIGH';
}

export function getAdaptiveUpdateProfile(level) {
  if (!Object.prototype.hasOwnProperty.call(ADAPTIVE_UPDATE_PROFILES, level)) {
    throw new RangeError(`Unknown client computation level: ${level}`);
  }
  return ADAPTIVE_UPDATE_PROFILES[level];
}

export function getTeammateVisionInterval(level, distanceRank) {
  if (!Number.isInteger(distanceRank) || distanceRank < 0) {
    throw new RangeError('Teammate vision distance rank must be a non-negative integer.');
  }
  const profile = getAdaptiveUpdateProfile(level);
  return Math.min(1_000, profile.teammateVisionBaseMs +
    profile.teammateVisionRankStepMs * distanceRank);
}
