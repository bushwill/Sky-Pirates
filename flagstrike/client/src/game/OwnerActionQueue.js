export const WEAPON_ACTION_RETRY_INTERVAL_MS = 250;
export const MAX_PENDING_WEAPON_ACTIONS = 128;

export function acknowledgeWeaponActions(pendingActions, acknowledgedSequence) {
  for (const sequence of pendingActions.keys()) {
    if (sequence <= acknowledgedSequence) pendingActions.delete(sequence);
  }
}

export function retryWeaponActions(pendingActions, now, send, {
  retryIntervalMs = WEAPON_ACTION_RETRY_INTERVAL_MS,
} = {}) {
  for (const [sequence, pending] of pendingActions) {
    if (now - pending.sentAt < retryIntervalMs) continue;
    const sent = send(pending.messageType, pending.payload);
    pending.sentAt = now;
    if (sent) pending.attempts += 1;
  }
}
