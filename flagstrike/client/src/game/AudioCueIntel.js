import { PLAYER_RADIUS } from './MovementModel.js';

/** Audio uncertainty is redundant once a teammate visually identifies an enemy inside it. */
export function isAudioCueSupersededByVisibleEnemy(cue, team, players, isPlayerVisible) {
  if (!cue || !team || !Array.isArray(players) || typeof isPlayerVisible !== 'function') return false;
  const cueReach = cue.radius + PLAYER_RADIUS;
  return players.some((player) => player.alive && player.health > 0 && player.team !== team &&
    isPlayerVisible(player) && Math.hypot(player.x - cue.x, player.y - cue.y) <= cueReach);
}