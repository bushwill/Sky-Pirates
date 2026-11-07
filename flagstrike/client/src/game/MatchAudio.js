const TEAMS = new Set(['red', 'blue']);

export function getUrgentTimerCue(match, now) {
  if (!match || match.victory || !Number.isFinite(now)) return null;

  const prephaseSeconds = Math.max(0, Math.ceil(((match.gameplayStartsAt ?? 0) - now) / 1000));
  if (prephaseSeconds > 0) {
    return prephaseSeconds <= 5 ? { phase: 'prephase', seconds: prephaseSeconds } : null;
  }

  if (!Number.isFinite(match.endsAt)) return null;
  const gameSeconds = Math.max(0, Math.ceil((match.endsAt - now) / 1000));
  return gameSeconds > 0 && gameSeconds <= 15
    ? { phase: 'game', seconds: gameSeconds }
    : null;
}

export function getUrgentCustomPostGameCue(match, roomState, now) {
  if (!match?.victory || roomState?.quickPlay === true || !Number.isFinite(now)) return null;
  const endsAt = match.postGame?.endsAt ?? roomState?.postGame?.endsAt;
  if (!Number.isFinite(endsAt)) return null;
  const seconds = Math.ceil((endsAt - now) / 1000);
  return seconds > 0 && seconds <= 5 ? { phase: 'postgame', seconds } : null;
}

export function getFlagTransitionSound(previousHolderId, flag) {
  if (previousHolderId === undefined) return null;
  const nextHolderId = flag?.heldBy ?? null;
  if (nextHolderId && nextHolderId !== previousHolderId) return 'flag-pickup';
  if (previousHolderId && !nextHolderId && flag?.dropped === true) return 'flag-drop';
  return null;
}

export function getOutcomeSoundNames(victory, quickPlayState, localTeam) {
  if (!TEAMS.has(victory?.winner) || !TEAMS.has(localTeam)) return null;
  const won = victory.winner === localTeam;
  return {
    match: won ? 'match-win' : 'match-loss',
    game: quickPlayState?.phase === 'series-report'
      ? won ? 'game-win' : 'game-loss'
      : null,
  };
}
