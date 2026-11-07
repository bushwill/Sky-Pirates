import {
  consumeGadgetCharge,
  GADGET_SWITCH_DURATION_MS,
  KATANA_ID,
  refillGadgetCharges,
} from '../../../shared/GadgetModel.js';
import { resumeQueuedManualAction, suspendWeaponActionsForSwitch } from '../../../shared/WeaponActionState.js';

export function getEquippedSlot(player, now = Date.now()) {
  if (Number.isFinite(player?.gadgetSwitchEndsAt) && now >= player.gadgetSwitchEndsAt) {
    player.equippedSlot = player.gadgetSwitchTargetSlot ?? player.equippedSlot ?? 'weapon';
    player.gadgetSwitchStartedAt = null;
    player.gadgetSwitchEndsAt = null;
    player.gadgetSwitchTargetSlot = null;
    if (player.equippedSlot === 'weapon') {
      resumeQueuedManualAction(player.weaponStats?.[player.selectedWeaponId], now);
    }
  }
  const switchingAwayFromWeapon = Number.isFinite(player?.gadgetSwitchEndsAt) &&
    now < player.gadgetSwitchEndsAt && player.gadgetSwitchTargetSlot === 'gadget';
  if ((player?.equippedSlot ?? 'weapon') === 'weapon' && !switchingAwayFromWeapon) {
    resumeQueuedManualAction(player.weaponStats?.[player.selectedWeaponId], now);
  }
  return player?.equippedSlot ?? 'weapon';
}

export function beginGadgetSwitch(player, now = Date.now(), durationMs = GADGET_SWITCH_DURATION_MS) {
  const equippedSlot = getEquippedSlot(player, now);
  player.gadgetSwitchStartedAt = now;
  player.gadgetSwitchEndsAt = now + durationMs;
  player.gadgetSwitchTargetSlot = equippedSlot === 'weapon' ? 'gadget' : 'weapon';
  suspendWeaponActionsForSwitch(player, player.gadgetSwitchTargetSlot, now);
  return player.gadgetSwitchTargetSlot;
}

export function preservePendingGadgetSwitch(previous, incoming, pendingSequence, acknowledgedSequence, now = Date.now()) {
  if (!previous || !incoming || !Number.isSafeInteger(pendingSequence) ||
      pendingSequence <= acknowledgedSequence) return incoming;
  const switchInProgress = Number.isFinite(previous.gadgetSwitchEndsAt) &&
    previous.gadgetSwitchEndsAt > now;
  const equippedSlot = switchInProgress
    ? previous.equippedSlot ?? incoming.equippedSlot ?? 'weapon'
    : previous.gadgetSwitchTargetSlot ?? previous.equippedSlot ?? incoming.equippedSlot ?? 'weapon';
  return {
    ...incoming,
    equippedSlot,
    gadgetSwitchStartedAt: switchInProgress ? previous.gadgetSwitchStartedAt : null,
    gadgetSwitchEndsAt: switchInProgress ? previous.gadgetSwitchEndsAt : null,
    gadgetSwitchTargetSlot: switchInProgress ? previous.gadgetSwitchTargetSlot : null,
  };
}

export function preservePendingGadgetState(previous, incoming, pendingSequence, acknowledgedSequence, now = Date.now()) {
  if (!previous || !incoming || !Number.isSafeInteger(pendingSequence) ||
      pendingSequence <= acknowledgedSequence) return incoming;
  const switchState = preservePendingGadgetSwitch(
    previous, incoming, pendingSequence, acknowledgedSequence, now,
  );
  return {
    ...switchState,
    selectedGadgetId: previous.selectedGadgetId ?? switchState.selectedGadgetId,
    gadgetCounts: previous.gadgetCounts ?? switchState.gadgetCounts,
    gadgetCount: previous.gadgetCount ?? switchState.gadgetCount,
    trophyCommandReadyAt: previous.trophyCommandReadyAt ?? switchState.trophyCommandReadyAt,
    vineTrapRechargeAt: previous.vineTrapRechargeAt !== undefined
      ? previous.vineTrapRechargeAt : switchState.vineTrapRechargeAt,
    gadgetChargeRechargeRemainingMs: previous.gadgetChargeRechargeRemainingMs ??
      switchState.gadgetChargeRechargeRemainingMs,
    orbitalStrikeCooldownRemainingMs: previous.orbitalStrikeCooldownRemainingMs ??
      switchState.orbitalStrikeCooldownRemainingMs,
  };
}

export function consumeSelectedGadget(player, {
  keepEquippedWhenEmpty = false,
  infiniteUse = false,
} = {}) {
  const gadgetId = player?.selectedGadgetId;
  if (!gadgetId) return 0;
  const remaining = infiniteUse
    ? refillGadgetCharges(player, gadgetId)
    : consumeGadgetCharge(player, gadgetId);
  if (remaining === 0 && !(keepEquippedWhenEmpty && gadgetId === KATANA_ID)) {
    player.equippedSlot = 'weapon';
    player.gadgetSwitchStartedAt = null;
    player.gadgetSwitchEndsAt = null;
    player.gadgetSwitchTargetSlot = null;
    resumeQueuedManualAction(player.weaponStats?.[player.selectedWeaponId], Date.now());
  }
  return remaining;
}
