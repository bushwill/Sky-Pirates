export function getNextBotActionSequence(lastClientSequence, lastAcknowledgedSequence) {
  const clientSequence = Number.isSafeInteger(lastClientSequence) && lastClientSequence >= 0
    ? lastClientSequence : 0;
  const acknowledgedSequence = Number.isSafeInteger(lastAcknowledgedSequence) && lastAcknowledgedSequence >= 0
    ? lastAcknowledgedSequence : 0;
  return Math.max(clientSequence, acknowledgedSequence) + 1;
}
