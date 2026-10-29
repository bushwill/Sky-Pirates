import { HOST_FRAME_PROTOCOL_VERSION } from './HostFrameProtocol.js';

const isPrivateGadgetEffect = (effect) =>
  effect?.type === 'mine' || effect?.triggerOnEnemyProximity === true ||
  effect?.type === 'sonar-projectile';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createActorState(player) {
  const state = clone(player);
  const selectedWeaponId = state.selectedWeaponId;
  state.weaponStats = selectedWeaponId && state.weaponStats?.[selectedWeaponId]
    ? { [selectedWeaponId]: state.weaponStats[selectedWeaponId] }
    : {};
  delete state.botBrain;
  delete state.botDecision;
  delete state.pendingBotDecision;
  delete state.botInputSequence;
  delete state.nextProjectileAt;
  return state;
}

const LOADOUT_FIELDS = [
  'selectedWeaponId', 'selectedGadgetId', 'gadgetCount', 'gadgetCounts', 'inventory',
  'inventoryWeaponIds', 'weaponShopOfferIds', 'itemShopOfferIds', 'gadgetShopOfferIds',
  'uniqueGadgetShopOfferIds', 'uniqueGadgetShopCount', 'shopPicksRemaining',
  'weaponShopResolved', 'itemShopResolved', 'loadoutRevision', 'armor', 'maxArmor', 'weaponStats',
];

export function preserveLiveHostPlayers(snapshotPlayers, livePlayers) {
  const liveById = new Map(livePlayers.map((player) => [player.id, player]));
  return snapshotPlayers.map((snapshotPlayer) => {
    const livePlayer = liveById.get(snapshotPlayer.id);
    if (!livePlayer) return snapshotPlayer;
    const newerLoadout = (snapshotPlayer.loadoutRevision ?? 0) > (livePlayer.loadoutRevision ?? 0);
    const controlChanged = (snapshotPlayer.controlledById ?? null) !== (livePlayer.controlledById ?? null) ||
      (snapshotPlayer.controlRevision ?? 0) !== (livePlayer.controlRevision ?? 0);
    const player = {
      ...snapshotPlayer,
      ...livePlayer,
      id: snapshotPlayer.id,
      name: snapshotPlayer.name ?? livePlayer.name,
      team: snapshotPlayer.team ?? livePlayer.team,
      isBot: snapshotPlayer.isBot ?? livePlayer.isBot,
      controlledById: snapshotPlayer.controlledById ?? null,
      controlRevision: snapshotPlayer.controlRevision ?? 0,
    };
    if (controlChanged) {
      player.input = snapshotPlayer.input;
      player.lastInputSequence = snapshotPlayer.lastInputSequence ?? 0;
    }
    if (newerLoadout) {
      for (const field of LOADOUT_FIELDS) {
        if (snapshotPlayer[field] !== undefined) player[field] = clone(snapshotPlayer[field]);
      }
    }
    return player;
  });
}

export function preserveLiveHostGadgetState(snapshot, liveMatch) {
  return {
    ...snapshot,
    smokes: liveMatch.smokes ?? snapshot.smokes ?? [],
    gadgetEffects: liveMatch.gadgetEffects ?? snapshot.gadgetEffects ?? [],
    pendingGadgetEffects: liveMatch.pendingGadgetEffects ?? snapshot.pendingGadgetEffects ?? [],
  };
}

/** Create the host's bounded, team-safe gameplay snapshot envelope. */
export function createHostFrame({ match, authorityEpoch, revision, tick = revision, simulationTimeMs, events = [], includeMap = true }) {
  if (!match || !Array.isArray(match.players)) return null;
  const flag = clone(match.flag);
  return {
    protocolVersion: HOST_FRAME_PROTOCOL_VERSION,
    matchId: match.startedAt,
    authorityEpoch,
    revision,
    tick,
    simulationTimeMs,
    actors: match.players.map((player) => ({ id: player.id, state: createActorState(player) })),
    objectives: flag ? [{ id: 'flag', state: flag }] : [],
    events: clone(events.filter((event) => {
      const isPrivateMine = event.type === 'gadget' &&
        isPrivateGadgetEffect(event.data?.smoke);
      return !isPrivateMine || ['red', 'blue'].includes(event.audienceTeam);
    })),
    acknowledgements: match.players.map((player) => ({
      id: player.id,
      inputSequence: Math.max(0, player.lastInputSequence ?? 0),
      actionSequence: Math.max(0, player.lastWeaponActionSequence ?? 0),
    })),
    snapshot: {
      startedAt: match.startedAt,
      gameplayStartsAt: match.gameplayStartsAt,
      endsAt: match.endsAt,
      updatedAt: match.updatedAt,
      smokes: clone(match.smokes ?? []),
      pendingGadgetEffects: clone((match.pendingGadgetEffects ?? []).filter((pending) =>
        !isPrivateGadgetEffect(pending.effect))),
      // Mine discovery is team-private and is deliberately retained from each
      // recipient's own team snapshot rather than broadcast in a host frame.
      gadgetEffects: clone((match.gadgetEffects ?? []).filter((effect) => !isPrivateGadgetEffect(effect))),
      victory: clone(match.victory ?? null),
      postGame: clone(match.postGame ?? null),
      quickPlayState: clone(match.quickPlayState ?? null),
      ...(includeMap && match.map ? { map: clone({
        ...match.map,
        objects: (match.map.objects ?? []).map((object) => object.role === 'destructible-prop'
          ? {
            ...object,
            health: object.health <= 0 ? 0 : object.maxHealth ?? 300,
            blocksMovement: object.health > 0,
            blocksProjectiles: object.health > 0,
            blocksVision: object.health > 0,
          }
          : object),
      }) } : {}),
      // Partial damage intel is team-private; destruction is shared because
      // it changes collision geometry for every player.
      destructibleObjects: clone((match.destructibleObjects ?? []).filter((object) => object.health <= 0)),
    },
  };
}

/** Merge a host snapshot while preserving map and recipient-specific intel. */
export function applyHostFrame(frame, currentMatch) {
  if (!frame?.snapshot || !currentMatch || frame.matchId !== currentMatch.startedAt ||
      frame.snapshot.startedAt !== currentMatch.startedAt || !Array.isArray(frame.actors)) return null;

  const currentPlayers = new Map((currentMatch.players ?? []).map((player) => [player.id, player]));
  const players = frame.actors.map(({ id, state }) => {
    const previous = currentPlayers.get(id) ?? {};
    return {
      ...previous,
      ...clone(state),
      id,
      weaponStats: { ...(previous.weaponStats ?? {}), ...(state.weaponStats ?? {}) },
    };
  });
  const flag = frame.objectives.find((objective) => objective.id === 'flag')?.state;
  const privateMines = (currentMatch.gadgetEffects ?? []).filter(isPrivateGadgetEffect);
  const destructibleById = new Map((currentMatch.destructibleObjects ?? []).map((object) => [object.id, object]));
  for (const object of frame.snapshot.destructibleObjects ?? []) {
    destructibleById.set(object.id, clone(object));
  }
  return {
    ...currentMatch,
    ...clone(frame.snapshot),
    players,
    flag: clone(flag ?? currentMatch.flag),
    gadgetEffects: [...clone(frame.snapshot.gadgetEffects ?? []), ...clone(privateMines)],
    pendingGadgetEffects: clone(frame.snapshot.pendingGadgetEffects ?? currentMatch.pendingGadgetEffects ?? []),
    map: currentMatch.map ?? clone(frame.snapshot.map),
    destructibleObjects: [...destructibleById.values()],
    botNoises: currentMatch.botNoises,
  };
}