export function clearWeaponReload(state) {
  state.reloading = false;
  state.reloadPaused = false;
  state.reloadIsMandatory = false;
  state.reloadStartedAt = null;
  state.reloadEndsAt = null;
  state.reloadRoundsInserted = null;
}

export function finishReloadRound(state, magazineFull, at) {
  if (!state.reloadIsMandatory || !Number.isFinite(state.manualActionQueuedDurationMs) ||
      state.manualActionQueuedDurationMs <= 0) return false;
  if (magazineFull) {
    clearWeaponReload(state);
  } else {
    state.reloading = false;
    state.reloadPaused = true;
    state.reloadStartedAt = null;
    state.reloadEndsAt = null;
  }
  resumeQueuedManualAction(state, at);
  return true;
}

export function resumePausedReload(state, at, intervalMs) {
  if (!state?.reloadPaused || !Number.isFinite(intervalMs) || intervalMs <= 0) return;
  state.reloadPaused = false;
  state.reloading = true;
  state.reloadStartedAt = at;
  state.reloadEndsAt = at + intervalMs;
}

export function clearManualAction(state) {
  state.manualActionStartedAt = null;
  state.manualActionEndsAt = null;
}

export function queueManualAction(state, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  state.manualActionQueuedDurationMs = durationMs;
  clearManualAction(state);
}

export function startManualAction(state, durationMs, at) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  if (state.reloading) {
    queueManualAction(state, durationMs);
    return;
  }
  state.manualActionQueuedDurationMs = null;
  state.manualActionStartedAt = at;
  state.manualActionEndsAt = at + durationMs;
}

export function resumeQueuedManualAction(state, at) {
  if (state?.reloading || !Number.isFinite(state?.manualActionQueuedDurationMs) ||
      state.manualActionQueuedDurationMs <= 0) return;
  const durationMs = state.manualActionQueuedDurationMs;
  state.manualActionQueuedDurationMs = null;
  startManualAction(state, durationMs, at);
}

export function suspendWeaponActionsForSwitch(player, targetSlot, now) {
  const state = player?.weaponStats?.[player.selectedWeaponId];
  if (targetSlot === 'gadget' && state) {
    if (state.reloading) clearWeaponReload(state);
    if (Number.isFinite(state.manualActionEndsAt) && state.manualActionEndsAt > now) {
      queueManualAction(state, state.manualActionEndsAt - now);
    }
  }
}
