import { isCircleVisible } from '../../../shared/VisionModel.js';

export function isPlayerVisibleToViewer({
  player,
  viewerTeam,
  activePlayerId,
  viewerJammed = false,
  jammedTeammate,
  visions,
  visionObjects,
  playerRadius,
  postGameFreeRoam = false,
}) {
  if (postGameFreeRoam || !viewerTeam) return true;
  if (player.team === viewerTeam &&
      (player.id === activePlayerId || (!viewerJammed && !jammedTeammate))) return true;
  return visions.some((vision) =>
    isCircleVisible(player, playerRadius, vision, visionObjects));
}
