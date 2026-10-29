import { applyAccuracyRecoil, getEffectiveAccuracy, getGaussianSpreadRadians, getMaximumRotationRadiansPerSecond, recoverAccuracy, rotateAngleTowards } from '../../../shared/WeaponAccuracy.js';
import { getEffectiveMagazineSize } from '../../../shared/InventoryModel.js';
import { clearManualAction, clearWeaponReload, finishReloadRound, queueManualAction, resumePausedReload, resumeQueuedManualAction, startManualAction } from '../../../shared/WeaponActionState.js';

export function selectOwnerWeaponStats(previousStats, snapshotStats, ownershipChanged = false) {
  if (ownershipChanged || !previousStats) return snapshotStats ?? previousStats ?? {};
  return { ...(snapshotStats ?? {}), ...previousStats };
}

export function hasPendingSemiAutoShot(definition, firePressSequence, lastSemiAutoFirePress) {
  return definition?.semiAuto === true && firePressSequence > lastSemiAutoFirePress;
}

export function createInitialWeaponState(definition, now, inventory = null) {
  const accuracy = getStartingAccuracy(definition);
  return {
    accuracy,
    effectiveAccuracy: accuracy,
    ammo: getEffectiveMagazineSize(definition.magazineSize, inventory) ?? null,
    aimAngle: 0,
    aimUpdatedAt: now,
    reloading: false,
    reloadPaused: false,
    reloadIsMandatory: false,
    reloadStartedAt: null,
    reloadEndsAt: null,
    reloadRoundsInserted: null,
    shotsFired: 0,
    burstShotsRemaining: 0,
    cooldownEndsAt: 0,
    manualActionStartedAt: null,
    manualActionEndsAt: null,
    manualActionQueuedDurationMs: null,
    predictionUpdatedAt: now,
  };
}

export function ensureWeaponState(source, definition, now, inventory = null) {
  const initial = createInitialWeaponState(definition, now, inventory);
  if (!source) return initial;
  if (definition.magazineSize && !Number.isFinite(source.ammo)) {
    return { ...initial, ...source, ammo: initial.ammo };
  }
  return source;
}

export function reconcileWeaponState(authoritative, actions, definition, now, speed = 0) {
  let state = { ...authoritative };
  const pending = actions.filter((action) => action.sequence > (authoritative.lastActionSequence ?? 0))
    .sort((left, right) => left.sequence - right.sequence);
  for (const action of pending) {
    advanceWeaponState(state, definition, action.at, speed);
    state = applyWeaponAction(state, definition, action, speed).state;
  }
  advanceWeaponState(state, definition, now, speed);
  state.lastActionSequence = authoritative.lastActionSequence ?? 0;
  return { state, pending };
}

export function reconcileWeaponStats(authoritativeStats, actions, definitions, acknowledgedSequence, now, speed = 0) {
  const stats = Object.fromEntries(Object.entries(authoritativeStats ?? {}).map(([id, state]) => [id, { ...state }]));
  const pending = actions.filter((action) => action.sequence > acknowledgedSequence)
    .sort((left, right) => left.sequence - right.sequence);
  for (const [id, definition] of Object.entries(definitions)) {
    stats[id] = ensureWeaponState(stats[id], definition, now);
    stats[id] = advanceWeaponState(stats[id], definition, now, speed);
  }
  for (const action of pending) {
    const definition = Object.values(definitions).find((entry) => entry.id === action.weaponId);
    if (!definition) continue;
    const key = Object.keys(definitions).find((id) => definitions[id] === definition);
    const result = applyWeaponAction(stats[key], definition, action, speed);
    if (result.accepted) stats[key] = result.state;
  }
  return { stats, pending };
}

export function advanceWeaponState(source, definition, now, speed = 0) {
  const state = { ...source };
  const elapsed = Math.max(0, (now - (state.predictionUpdatedAt ?? now)) / 1000);
  const maximumAccuracy = getMaximumAccuracy(definition);
  const accuracy = Number.isFinite(state.accuracy) ? state.accuracy : getStartingAccuracy(definition);
  state.accuracy = recoverAccuracy(
    accuracy,
    elapsed,
    definition.accuracy.recoveryPerSecond,
    maximumAccuracy,
  );
  state.predictionUpdatedAt = now;
  if (state.reloading && Number.isFinite(state.reloadEndsAt)) {
    if (!definition.reloadPerRound && now >= state.reloadEndsAt) {
      const reloadCompletedAt = state.reloadEndsAt;
      state.ammo = definition.magazineSize;
      clearWeaponReload(state);
      resumeQueuedManualAction(state, reloadCompletedAt);
    } else if (definition.reloadPerRound) {
      while (state.reloading && now >= state.reloadEndsAt) {
        state.ammo = Math.min(definition.magazineSize, (state.ammo ?? 0) + 1);
        const inserted = (state.reloadRoundsInserted ?? 0) + 1;
        state.reloadRoundsInserted = inserted;
        if (finishReloadRound(state, state.ammo >= definition.magazineSize, state.reloadEndsAt)) break;
        if (state.ammo >= definition.magazineSize) {
          const reloadCompletedAt = state.reloadEndsAt;
          clearWeaponReload(state);
          resumeQueuedManualAction(state, reloadCompletedAt);
        } else {
          const interval = definition.reloadIntervalMs[Math.min(inserted, definition.reloadIntervalMs.length - 1)];
          state.reloadStartedAt = state.reloadEndsAt;
          state.reloadEndsAt += interval;
        }
      }
    }
  }
  if (state.manualActionEndsAt && now >= state.manualActionEndsAt) {
    const manualActionCompletedAt = state.manualActionEndsAt;
    clearManualAction(state);
    const interval = definition.reloadIntervalMs?.[
      Math.min(state.reloadRoundsInserted ?? 0, (definition.reloadIntervalMs?.length ?? 1) - 1)
    ];
    resumePausedReload(state, manualActionCompletedAt, interval);
  }
  state.effectiveAccuracy = getEffectiveAccuracy(
    state.accuracy,
    speed,
    100,
    definition.accuracy.movementPenaltyAtMaxSpeed,
  );
  return state;
}

export function applyWeaponAction(source, definition, action, speed = 0) {
  let state = advanceWeaponState(source, definition, action.at, speed);
  if (action.kind === 'aim') {
    const targetAngle = action.direction && Math.hypot(action.direction.x, action.direction.y) > 1e-9
      ? Math.atan2(action.direction.y, action.direction.x) : state.aimAngle ?? 0;
    const elapsed = Math.max(0, (action.at - (state.aimUpdatedAt ?? action.at)) / 1000);
    state.aimAngle = rotateAngleTowards(state.aimAngle ?? 0, targetAngle,
      getMaximumRotationRadiansPerSecond(definition.rotationTimeMs) * elapsed);
    state.aimUpdatedAt = action.at;
    return { state, accepted: true };
  }
  if (action.kind === 'reload') {
    if (!definition.magazineSize || (!definition.reloadDurationMs && !definition.reloadPerRound) ||
        state.reloading || (state.ammo ?? 0) >= definition.magazineSize) return { state, accepted: false };
    if (state.reloadPaused) {
      if (state.manualActionEndsAt && action.at < state.manualActionEndsAt) {
        queueManualAction(state, definition.manualActionDurationMs);
      }
      state.reloadIsMandatory = false;
      resumePausedReload(state, action.at,
        definition.reloadIntervalMs[Math.min(state.reloadRoundsInserted ?? 0, definition.reloadIntervalMs.length - 1)]);
      state.burstShotsRemaining = 0;
      return { state, accepted: true };
    }
    if (state.manualActionEndsAt && action.at < state.manualActionEndsAt) {
      queueManualAction(state, definition.manualActionDurationMs);
    }
    state.reloading = true;
    state.reloadPaused = false;
    state.reloadIsMandatory = false;
    state.reloadStartedAt = action.at;
    state.reloadRoundsInserted = definition.reloadPerRound ? 0 : null;
    state.reloadEndsAt = action.at + (definition.reloadPerRound ? definition.reloadIntervalMs[0] : definition.reloadDurationMs);
    state.burstShotsRemaining = 0;
    return { state, accepted: true };
  }
  if (action.kind !== 'fire') return { state, accepted: false };
  const canInterruptReload = Boolean(definition.reloadPerRound && state.reloading && (state.ammo ?? 0) > 0);
  if ((state.reloading && !canInterruptReload) || (definition.magazineSize && (state.ammo ?? 0) <= 0) ||
      (state.manualActionEndsAt && action.at < state.manualActionEndsAt) ||
      action.at < (state.cooldownEndsAt ?? 0)) return { state, accepted: false };
  if (canInterruptReload) {
    clearWeaponReload(state);
    state.manualActionQueuedDurationMs = null;
  }
  if (definition.magazineSize) {
    state.ammo -= 1;
    if (state.ammo === 0) {
      state.reloading = true;
      state.reloadPaused = false;
      state.reloadIsMandatory = true;
      state.reloadStartedAt = action.at;
      state.reloadRoundsInserted = definition.reloadPerRound ? 0 : null;
      state.reloadEndsAt = action.at + (definition.reloadPerRound ? definition.reloadIntervalMs[0] : definition.reloadDurationMs);
    }
  }
  startManualAction(state, definition.manualActionDurationMs, action.at);
  if (Number.isFinite(action.direction?.x) && Number.isFinite(action.direction?.y) &&
      Math.hypot(action.direction.x, action.direction.y) > 1e-9) {
    state.aimAngle = Math.atan2(action.direction.y, action.direction.x);
    state.aimUpdatedAt = action.at;
  }
  const spread = getGaussianSpreadRadians(state.effectiveAccuracy ?? state.accuracy ?? 1,
    definition.accuracy.maxSpreadDegrees, seededRandom(action.sequence));
  state.predictedShotAngle = (state.aimAngle ?? 0) + spread;
  state.accuracy = applyAccuracyRecoil(state.accuracy ?? definition.accuracy.startingAccuracy,
    definition.accuracy.recoilPerShot);
  state.effectiveAccuracy = getEffectiveAccuracy(state.accuracy, speed, 100,
    definition.accuracy.movementPenaltyAtMaxSpeed);
  state.shotsFired = (state.shotsFired ?? 0) + 1;
  if (definition.burstCount) {
    state.burstShotsRemaining = state.burstShotsRemaining > 0
      ? state.burstShotsRemaining - 1
      : definition.burstCount - 1;
    state.cooldownEndsAt = action.at + (state.burstShotsRemaining > 0
      ? definition.burstShotIntervalMs : definition.burstDelayMs);
  } else {
    state.burstShotsRemaining = 0;
    state.cooldownEndsAt = action.at + definition.cooldownMs;
  }
  if (definition.magazineSize && state.ammo === 0) state.burstShotsRemaining = 0;
  return { state, accepted: true };
}

export function getPredictedPelletAngles(baseAngle, definition, sequence) {
  const count = definition.pelletCount ?? 1;
  if (count <= 1) return [baseAngle];
  const halfSpread = (definition.pelletSpreadDegrees ?? 0) * Math.PI / 180;
  const random = seededRandom(sequence ^ 0xa511e9b3);
  return Array.from({ length: count }, (_, index) => {
    const offset = -halfSpread + (index / (count - 1)) * halfSpread * 2 +
      (random() - 0.5) * (halfSpread / count);
    return baseAngle + offset;
  });
}

function seededRandom(seed) {
  let value = (Math.imul((seed >>> 0) + 1, 0x9e3779b1) >>> 0) || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function getMaximumAccuracy(definition) {
  return Number.isFinite(definition.accuracy.maxAccuracy)
    ? definition.accuracy.maxAccuracy
    : 1;
}

function getStartingAccuracy(definition) {
  const maximumAccuracy = getMaximumAccuracy(definition);
  return Number.isFinite(definition.accuracy.startingAccuracy)
    ? Math.min(definition.accuracy.startingAccuracy, maximumAccuracy)
    : maximumAccuracy;
}
