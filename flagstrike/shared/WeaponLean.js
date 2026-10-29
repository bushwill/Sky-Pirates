export const WEAPON_LEAN_TAP_THRESHOLD_MS = 180;

export function updateWeaponLeanState(previous, { qDown, eDown }, now, tapThresholdMs = WEAPON_LEAN_TAP_THRESHOLD_MS) {
  let toggleLean = previous.toggleLean ?? 0;
  let qPressedAt = previous.qPressedAt ?? null;
  let ePressedAt = previous.ePressedAt ?? null;

  if (qDown && !previous.qDown) qPressedAt = now;
  if (eDown && !previous.eDown) ePressedAt = now;

  if (!qDown && previous.qDown && qPressedAt !== null && now - qPressedAt < tapThresholdMs) {
    toggleLean = toggleLean === -1 ? 0 : -1;
  }
  if (!eDown && previous.eDown && ePressedAt !== null && now - ePressedAt < tapThresholdMs) {
    toggleLean = toggleLean === 1 ? 0 : 1;
  }

  if (!qDown) qPressedAt = null;
  if (!eDown) ePressedAt = null;

  let currentLean = toggleLean;
  if (qDown && eDown) {
    currentLean = qPressedAt >= ePressedAt ? -1 : 1;
  } else if (qDown) {
    currentLean = -1;
  } else if (eDown) {
    currentLean = 1;
  }

  return { toggleLean, currentLean, qDown, eDown, qPressedAt, ePressedAt };
}
