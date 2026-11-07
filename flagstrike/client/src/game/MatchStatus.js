import { getTeamGroup } from '../../../shared/GameRules.js';

export function getPostGameCountdownLabel(roomState) {
  const customSeriesContinuing = !roomState?.quickPlay &&
    roomState?.customSeriesState &&
    roomState.customSeriesState.phase !== 'complete';
  return customSeriesContinuing ? 'Next match' : 'Returning to lobby';
}

export function formatVictoryText(victory, quickPlay) {
  if (!victory) return '';
  const seriesLabel = quickPlay?.gameMode === 'longseries' ? 'LONG PLAY'
    : quickPlay?.gameMode === 'longplay' ? 'QUICK PLAY' : 'PRACTICE';

  const winnerTeam = quickPlay?.phase === 'round-result'
    ? quickPlay.lastResult?.winner ?? victory.winner
    : victory.winner;
  const winner = getTeamGroup(winnerTeam)?.label.toUpperCase() ?? 'UNKNOWN';
  const reason = victory.reason === 'capture' ? 'flag captured'
    : victory.reason === 'elimination' ? 'team eliminated' : 'time expired';
  if (quickPlay?.phase === 'series-report') {
    const seriesWinner = getTeamGroup(quickPlay.lastResult?.winner ?? quickPlay.winner)?.label.toUpperCase() ?? winner;
    const finalScore = quickPlay.lastResult?.score ?? quickPlay.score;
    return `${seriesLabel} WINNER\n${seriesWinner} · ${formatQuickPlaySeriesScore(finalScore)}`;
  }
  if (quickPlay) {
    const resultScore = quickPlay.lastResult?.score ?? quickPlay.score;
    const scoreLabel = quickPlay.gameMode === 'quickplay' ? 'PRACTICE SCORE' : 'SERIES';
    return `ROUND ${quickPlay.lastResult?.round ?? quickPlay.round} · ${winner} WINS\n${reason.toUpperCase()}\n${scoreLabel} ${formatQuickPlaySeriesScore(resultScore)}`;
  }
  return `${winner} WINS\n${reason.toUpperCase()}`;
}

export function getAliveTeamCounts(players = []) {
  const counts = { red: 0, blue: 0 };
  for (const player of players) {
    if (!['red', 'blue'].includes(player.team) || player.alive === false || (player.health ?? 100) <= 0) continue;
    counts[player.team] += 1;
  }
  return counts;
}

export function formatAliveTeamCounts(counts) {
  return `STRIKE ${counts.red}  —  ${counts.blue} FLAG`;
}

export function formatQuickPlayScore(score) {
  return {
    red: `STRIKE ${score?.red ?? 0}`,
    blue: `${score?.blue ?? 0} FLAG`,
  };
}

export function formatQuickPlaySeriesScore(score) {
  return `STRIKE ${score?.red ?? 0}–${score?.blue ?? 0} FLAG`;
}
