export function getSpyCameraBatteryStatus(camera, now = Date.now()) {
  if (!camera || !Number.isFinite(camera.startedAt) || camera.startedAt > now ||
      !Number.isFinite(camera.expiresAt) || camera.expiresAt <= now ||
      (Number.isFinite(camera.health) && camera.health <= 0)) return null;
  return `Battery · ${Math.ceil((camera.expiresAt - now) / 1000)}s remaining`;
}

export function getGadgetCardStatus({
  hasGadget,
  gadgetCount = 0,
  maxCharges = 1,
  equippedSlot = 'weapon',
  switching = false,
  switchRemainingMs = 0,
  cooldownRemainingMs = 0,
} = {}) {
  if (switching) return `Switching · ${(Math.max(0, switchRemainingMs) / 1000).toFixed(1)}s`;
  if (!hasGadget) return 'Choose a gadget during the buy phase';
  const rechargeStatus = cooldownRemainingMs > 0
    ? `Recharging · ${(Math.max(0, cooldownRemainingMs) / 1000).toFixed(1)}s`
    : null;
  if (gadgetCount <= 0 && rechargeStatus) {
    return rechargeStatus;
  }
  if (gadgetCount <= 0) return 'No uses remaining';
  const equippedStatus = equippedSlot === 'gadget'
    ? 'Equipped · Right-click to use' : 'Right-click to equip';
  if (maxCharges > 1 && rechargeStatus) return `${equippedStatus} · ${rechargeStatus}`;
  return equippedStatus;
}