export function awardKillAndAssists(players, victim, lethalAttackerId, contributions) {
  const playersById = new Map([...players].map((player) => [player.id, player]));
  const killer = playersById.get(lethalAttackerId);
  if (!killer || killer.team === victim.team) {
    return { killerId: null, assisterIds: [] };
  }

  killer.stats ??= { kills: 0, assists: 0, deaths: 0 };
  killer.stats.kills = (killer.stats.kills ?? 0) + 1;
  const assisterIds = [];
  for (const [attackerId, damage] of Object.entries(contributions ?? {})) {
    if (attackerId === killer.id || !Number.isFinite(damage) || damage <= 0) continue;
    const assister = playersById.get(attackerId);
    if (!assister || assister.team !== killer.team) continue;
    assister.stats ??= { kills: 0, assists: 0, deaths: 0 };
    assister.stats.assists = (assister.stats.assists ?? 0) + 1;
    assisterIds.push(assister.id);
  }

  return { killerId: killer.id, assisterIds };
}
