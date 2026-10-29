export function accumulateQuickPlayRound(seriesStats, accumulatedMatches, match) {
  if (!match?.startedAt) return false;
  const previousByPlayer = accumulatedMatches.get(match.startedAt) ?? new Map();
  let changed = !accumulatedMatches.has(match.startedAt);
  for (const player of match.players ?? []) {
    const previous = seriesStats.get(player.id) ?? {
      id: player.id,
      name: player.name,
      team: player.team,
      isBot: player.isBot === true,
      kills: 0,
      assists: 0,
      deaths: 0,
    };
    const previousRoundStats = previousByPlayer.get(player.id) ?? { kills: 0, assists: 0, deaths: 0 };
    const currentRoundStats = {
      kills: player.stats?.kills ?? 0,
      assists: player.stats?.assists ?? 0,
      deaths: player.stats?.deaths ?? 0,
    };
    const delta = {
      kills: currentRoundStats.kills - previousRoundStats.kills,
      assists: currentRoundStats.assists - previousRoundStats.assists,
      deaths: currentRoundStats.deaths - previousRoundStats.deaths,
    };
    if (delta.kills || delta.assists || delta.deaths) changed = true;
    seriesStats.set(player.id, {
      ...previous,
      name: player.name,
      team: player.team,
      isBot: player.isBot === true,
      kills: previous.kills + delta.kills,
      assists: previous.assists + delta.assists,
      deaths: previous.deaths + delta.deaths,
    });
    previousByPlayer.set(player.id, currentRoundStats);
  }
  accumulatedMatches.set(match.startedAt, previousByPlayer);
  return changed;
}

export function getQuickPlayScoreboardPlayers(match, seriesStats, accumulatedMatches) {
  const alreadyAccumulated = accumulatedMatches.has(match?.startedAt);
  const players = [];
  for (const current of match?.players ?? []) {
    const accumulated = seriesStats.get(current.id);
    const roundStats = alreadyAccumulated ? {} : current.stats ?? {};
    players.push({
      ...current,
      stats: {
        kills: (accumulated?.kills ?? 0) + (roundStats.kills ?? 0),
        assists: (accumulated?.assists ?? 0) + (roundStats.assists ?? 0),
        deaths: (accumulated?.deaths ?? 0) + (roundStats.deaths ?? 0),
      },
    });
  }
  return players;
}

export function applyQuickPlayRoundResultToSquadScore(squadScore, match, isNewVictory) {
  const winnerSquadId = match?.quickPlayState?.lastResult?.winnerSquadId;
  if (!isNewVictory || !winnerSquadId) return squadScore ?? {};
  return {
    ...squadScore,
    [winnerSquadId]: (squadScore?.[winnerSquadId] ?? 0) + 1,
  };
}

export function advanceQuickPlaySeriesResult({
  series,
  rolesBySquad,
  squadScore,
  sidesSwapped,
  mapGenerationRevision,
}, winner, reason, now) {
  const hasWinTarget = Number.isSafeInteger(series?.winsToWin) && series.winsToWin >= 1;
  const endlessPractice = series?.gameMode === 'quickplay' && series.winsToWin === null;
  if (!series || !['A', 'B'].every((squadId) =>
    ['red', 'blue'].includes(rolesBySquad?.[squadId]) &&
    Number.isSafeInteger(squadScore?.[squadId]) && squadScore[squadId] >= 0) ||
      rolesBySquad.A === rolesBySquad.B || !Number.isSafeInteger(series.round) ||
      (!hasWinTarget && !endlessPractice) ||
      !Number.isSafeInteger(series.roleSwapEvery) || series.roleSwapEvery < 1 ||
      typeof sidesSwapped !== 'boolean' || !Number.isSafeInteger(mapGenerationRevision) ||
      !Number.isFinite(now) || !['red', 'blue'].includes(winner)) return null;

  const winnerSquadId = Object.keys(rolesBySquad).find((squadId) => rolesBySquad[squadId] === winner);
  if (!winnerSquadId) return null;
  const scoreBySquad = {
    A: squadScore.A + Number(winnerSquadId === 'A'),
    B: squadScore.B + Number(winnerSquadId === 'B'),
  };
  const score = Object.fromEntries(['A', 'B'].map((squadId) => [
    rolesBySquad[squadId], scoreBySquad[squadId],
  ]));
  const seriesWon = hasWinTarget && scoreBySquad[winnerSquadId] >= series.winsToWin;
  const shouldSwapRoles = series.round % series.roleSwapEvery === 0;
  const nextRoles = shouldSwapRoles
    ? { A: rolesBySquad.B, B: rolesBySquad.A }
    : { ...rolesBySquad };
  const nextSidesSwapped = shouldSwapRoles ? !sidesSwapped : sidesSwapped;
  const nextMapGenerationRevision = mapGenerationRevision + Number(!seriesWon);
  const nextRoundScore = Object.fromEntries(['A', 'B'].map((squadId) => [
    nextRoles[squadId], scoreBySquad[squadId],
  ]));
  const lastResult = {
    winner,
    reason,
    squadId: winnerSquadId,
    winnerSquadId,
    round: series.round,
    at: now,
    score,
    rolesBySquad: { ...rolesBySquad },
  };
  return {
    rolesBySquad: nextRoles,
    squadScore: scoreBySquad,
    sidesSwapped: nextSidesSwapped,
    mapGenerationRevision: nextMapGenerationRevision,
    state: {
      ...series,
      score,
      squadScore: scoreBySquad,
      rolesBySquad: nextRoles,
      nextRoundScore,
      sidesSwapped: nextSidesSwapped,
      mapGenerationRevision: nextMapGenerationRevision,
      phase: seriesWon ? 'series-report' : 'round-result',
      phaseEndsAt: now + (seriesWon ? 8_000 : 5_000),
      winner: seriesWon ? winner : null,
      winnerSquadId: seriesWon ? winnerSquadId : null,
      lastResult,
    },
  };
}
