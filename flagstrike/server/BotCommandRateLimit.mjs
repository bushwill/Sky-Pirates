export const BOT_MOVEMENT_RATE_LIMIT_MS = 20;

/**
 * Movement/aim updates may be coalesced, but edge-triggered weapon actions must
 * reach RoomManager even when they arrive inside that input interval.
 */
export function shouldThrottleBotCommand(commands, receivedAt, lastCommandAt = 0) {
  const hasWeaponAction = Array.isArray(commands) &&
    commands.some((command) => command?.fire === true || command?.reload === true);
  return !hasWeaponAction && receivedAt - lastCommandAt < BOT_MOVEMENT_RATE_LIMIT_MS;
}
