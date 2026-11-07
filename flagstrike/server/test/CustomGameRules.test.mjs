import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CUSTOM_GAME_RULES, normalizeCustomGameRules } from '../../shared/CustomGameRules.js';
import { MAP_HEIGHT, MAP_WIDTH, generateMap } from '../../shared/MapGenerator.js';
import { RoomManager } from '../RoomManager.mjs';

let nextClientId = 1;

function createClient() {
  return { id: `custom-rules-client-${nextClientId++}`, room: null };
}

class TestRoomManager extends RoomManager {
  constructor(options = {}) {
    super(options);
    this.createCompetitiveMapData = async ({ rules }) => {
      const roomCount = rules.minRooms;
      const seed = 12_345;
      const mapOptions = {
        minRooms: roomCount,
        maxRooms: roomCount,
        maxSiteApproachSightline: rules.maxSiteApproachSightline,
      };
      return {
        seed,
        mapOptions,
        map: generateMap(seed, MAP_WIDTH, MAP_HEIGHT, mapOptions),
        fingerprint: `custom-rules-test-${seed}`,
      };
    };
  }
}

describe('custom game rules', () => {
  it('normalizes configurable custom match settings and rejects invalid combinations', () => {
    const rules = normalizeCustomGameRules({
      buyPhase: 'progression',
      winsToWin: null,
      autoFillBots: true,
      infiniteGadgetUse: true,
      mapMode: 'varied',
      mapCriteria: { minRooms: 3, maxRooms: 8, minRoomUtilizationPercent: 60 },
    });

    assert.equal(rules.buyPhase, 'progression');
    assert.equal(rules.winsToWin, null);
    assert.equal(rules.autoFillBots, true);
    assert.equal(rules.infiniteGadgetUse, true);
    assert.equal(DEFAULT_CUSTOM_GAME_RULES.infiniteGadgetUse, false);
    assert.equal(rules.carryOverShopPicks, true);
    assert.equal(normalizeCustomGameRules({ carryOverShopPicks: false }).carryOverShopPicks, false);
    assert.throws(() => normalizeCustomGameRules({ carryOverShopPicks: 'yes' }), /carryover/);
    assert.deepEqual(rules.mapCriteria, {
      ...DEFAULT_CUSTOM_GAME_RULES.mapCriteria,
      minRooms: 3,
      maxRooms: 8,
      minRoomUtilizationPercent: 60,
    });
    assert.throws(() => normalizeCustomGameRules({
      firstShopOffers: 2,
      firstShopPicks: 3,
    }), /Shop picks cannot exceed/);
    assert.throws(() => normalizeCustomGameRules({ autoFillBots: 'yes' }), /Automatic bot filling/);
    assert.throws(() => normalizeCustomGameRules({ infiniteGadgetUse: 'yes' }), /Infinite gadget use/);
    assert.throws(() => normalizeCustomGameRules({ mapMode: 'unknown' }), /Map mode/);
  });

  it('lets hosts update private room details during matches, but not public rooms', async () => {
    let now = 15_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, {
      name: 'Private Custom',
      password: 'old-password',
    });
    manager.setCustomGameRules(host, { mapMode: 'host' });
    manager.setMapSeed(host, { seed: 1_234, roomCount: 4 });
    await host.room.customMapPromise;
    manager.startMatch(host);

    const state = await manager.setRoomDetails(host, {
      name: 'Renamed Private Custom',
      password: 'new-password',
    });
    assert.equal(state.name, 'Renamed Private Custom');
    assert.equal(state.locked, true);
    assert.equal(host.room.match !== null, true, 'the room remains in its active match');

    const guest = createClient();
    await assert.rejects(
      manager.join(guest, { name: 'Renamed Private Custom', password: 'old-password' }),
      /incorrect/,
    );
    await manager.join(guest, { name: 'Renamed Private Custom', password: 'new-password' });
    await assert.rejects(
      manager.setRoomDetails(guest, { name: 'Unauthorized Rename', password: 'new-password' }),
      /Only the room host/,
    );

    const publicHost = createClient();
    const { room: publicRoom } = manager.quickPlay(publicHost);
    await assert.rejects(
      manager.setRoomDetails(publicHost, { name: publicRoom.name, password: 'secret' }),
      /private room/,
    );

    const privatePlaylistHost = createClient();
    const { room: privatePlaylistRoom } = await manager.createPrivateSeries(privatePlaylistHost, {
      name: 'Private Playlist',
      password: 'playlist-password',
      gameMode: 'quickplay',
    });
    const playlistState = await manager.setRoomDetails(privatePlaylistHost, {
      name: 'Renamed Private Playlist',
      password: 'updated-playlist-password',
    });
    assert.equal(privatePlaylistRoom.quickPlay, true);
    assert.equal(playlistState.name, 'Renamed Private Playlist');
    assert.equal(playlistState.locked, true);

    const publicCustomHost = createClient();
    const { state: publicCustomState } = await manager.createAndJoin(publicCustomHost, {
      name: 'Public Custom',
    });
    await assert.rejects(
      manager.setRoomDetails(publicCustomHost, { name: publicCustomState.name, password: 'secret' }),
      /private room/,
    );
  });

  it('fills open custom slots with bots, replaces them with players, and refills departures', async () => {
    const manager = new TestRoomManager({
      random: () => 0,
      randomTeam: () => 0,
      simulationMode: 'host-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Automatic Bot Fill' });
    const room = host.room;
    manager.setCustomGameRules(host, { mapMode: 'host', autoFillBots: true });
    assert.equal(manager.toRoomState(room).bots.roster.length, 9);
    assert.equal(manager.listRooms()[0].full, false,
      'bot-filled vacancies remain available to real players');

    const guest = createClient();
    await manager.join(guest, { name: 'Automatic Bot Fill' });
    assert.equal(manager.toRoomState(room).bots.roster.length, 8);
    assert.equal(manager.getTeamCounts(room).red + manager.getTeamCounts(room).blue, 10);

    manager.setMapSeed(host, { seed: 2_345, roomCount: 4 });
    const map = generateMap(2_345, MAP_WIDTH, MAP_HEIGHT, { minRooms: 4, maxRooms: 4 });
    manager.acceptHostMap(host, { map, generationRevision: room.mapGenerationRevision });
    manager.startMatch(host);
    const guestTeam = guest.team;
    room.latestHostFrame = {
      matchId: room.match.startedAt,
      snapshot: {},
      actors: room.match.players.filter((player) => player.id !== guest.id)
        .map((player) => ({ id: player.id, state: structuredClone(player) })),
      acknowledgements: [],
      objectives: [],
    };
    manager.leave(guest);

    assert.equal(room.match.players.some((player) => player.id === guest.id), false);
    assert.equal(room.match.teamRoster[guestTeam], 5);
    assert.equal(room.match.players.filter((player) => player.team === guestTeam).length, 5);
    assert.equal(manager.toRoomState(room).bots.roster.length, 9);
    assert.equal(manager.toRoomState(room).match.players.length, 10,
      'the next host frame includes bots added after the most recent accepted frame');
  });

  it('requires a host-selected map, applies configured phase lengths, swaps roles, and gates host shuffles', async () => {
    let now = 20_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Custom Rules Flow' });
    const room = host.room;

    manager.setCustomGameRules(host, {
      mapMode: 'host',
      buyPhase: 'loadout',
      prePhaseSeconds: 5,
      gamePhaseSeconds: 30,
      postPhaseSeconds: 2,
      winsToWin: null,
      roleSwapEveryMatches: 1,
      teamShuffleEveryMatches: 1,
      teamShuffleMode: 'host',
    });
    assert.equal(manager.toRoomState(room).mapReady, false);
    assert.throws(() => manager.startMatch(host), /Choose and prepare a map/);

    manager.setMapSeed(host, { seed: 8123, roomCount: 4 });
    await room.customMapPromise;
    const firstMatch = manager.startMatch(host).match;
    assert.equal(firstMatch.gameplayStartsAt, now + 5_000);
    assert.equal(firstMatch.endsAt, now + 35_000);

    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    assert.equal(manager.toRoomState(room).customSeriesState.score.A, 1);
    assert.equal(manager.toRoomState(room).postGame.endsAt, now + 2_000);
    const postGame = manager.choosePostGame(host);
    assert.ok(postGame.match, 'all stay choices do not skip a continuing custom series post-phase');
    assert.equal(postGame.customSeriesState.phase, 'postgame');
    now += 2_000;
    manager.advanceLobbyLifecycle(now);
    const intermission = manager.toRoomState(room);
    assert.equal(intermission.match, null);
    assert.equal(intermission.customSeriesState.phase, 'intermission');
    assert.equal(intermission.customSeriesState.roleSwapPending, false);
    assert.equal(intermission.customSeriesState.teamShufflePending, true);
    assert.equal(host.team, 'blue', 'role swaps apply after the postgame, before the next match');
    assert.throws(() => manager.startMatch(host), /approve the team shuffle/);

    const approved = manager.approveCustomTeamShuffle(host);
    assert.equal(approved.customSeriesState.teamShufflePending, false);
    assert.equal(approved.customSeriesState.teamShuffleApproved, true);
    assert.throws(() => manager.startMatch(host), /Choose and prepare a map/);
    manager.setMapSeed(host, { seed: 8124, roomCount: 4 });
    await room.customMapPromise;
    const secondMatch = manager.startMatch(host).match;
    assert.equal(secondMatch.gameplayStartsAt, now + 5_000);
    assert.equal(room.customSeriesState.matchNumber, 2);
    assert.equal(room.customSeriesState.score.A, 1);
    manager.setMatchVictory(room, { winner: 'blue', reason: 'capture', at: now });
    assert.equal(room.customSeriesState.score.A, 2, 'series score follows the same team across role swaps');
  });

  it('does not skip a continuing custom-series post-phase when a player leaves', async () => {
    let now = 30_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Post-phase Departure' });
    await manager.join(guest, { name: 'Post-phase Departure' });
    const room = host.room;
    manager.setCustomGameRules(host, {
      mapMode: 'host',
      winsToWin: null,
      postPhaseSeconds: 2,
    });
    manager.setMapSeed(host, { seed: 8_123, roomCount: 4 });
    await room.customMapPromise;
    manager.startMatch(host);
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    manager.choosePostGame(host);

    manager.leave(guest);

    assert.ok(room.match?.victory, 'the current match remains visible until the configured post-phase ends');
    assert.equal(room.postGame.endsAt, now + 2_000);
    now += 2_000;
    manager.advanceLobbyLifecycle(now);
    assert.equal(room.match, null);
    assert.equal(room.customSeriesState.phase, 'intermission');
  });

  it('continues custom matches until the configured win target and pauses for host map choice', async () => {
    let now = 90_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Multi-match Custom Series' });
    const room = host.room;

    manager.setCustomGameRules(host, {
      mapMode: 'host',
      winsToWin: 2,
      roleSwapEveryMatches: 0,
      postPhaseSeconds: 1,
    });
    assert.equal(manager.toRoomState(room).customGameRules.winsToWin, 2);
    manager.setMapSeed(host, { seed: 9_123, roomCount: 4 });
    await room.customMapPromise;
    manager.startMatch(host);

    room.match.players[0].stats = { kills: 2, assists: 1, deaths: 1 };
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    assert.equal(room.customSeriesState.score.A, 1);
    assert.equal(room.customSeriesState.phase, 'postgame');
    assert.equal(room.customSeriesState.lastMatchScoreboard.length, 1);
    assert.deepEqual(room.customSeriesState.seriesScoreboard[0].stats,
      { kills: 2, assists: 1, deaths: 1 });
    assert.equal(room.customSeriesState.seriesScoreboard[0].squadId, 'A');

    now += 1_000;
    manager.advanceLobbyLifecycle(now);
    assert.equal(room.match, null);
    assert.equal(room.customSeriesState.phase, 'intermission');
    assert.equal(room.mapGenerationMode, 'host-choice');

    manager.setMapSeed(host, { seed: 9_124, roomCount: 4 });
    await room.customMapPromise;
    manager.advanceLobbyLifecycle(now);
    assert.ok(room.match, 'the next match starts after the host prepares its map');
    assert.equal(room.customSeriesState.matchNumber, 2);
    assert.equal(room.customSeriesState.score.A, 1);

    room.match.players[0].stats = { kills: 1, assists: 0, deaths: 2 };
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    assert.equal(room.customSeriesState.score.A, 2);
    assert.deepEqual(room.customSeriesState.seriesScoreboard[0].stats,
      { kills: 3, assists: 1, deaths: 3 });
    assert.equal(room.customSeriesState.phase, 'complete');
    now += 1_000;
    manager.advanceLobbyLifecycle(now);
    assert.equal(room.match, null);
    assert.equal(room.customSeriesState.phase, 'complete');
  });

  it('searches for the next map during postgame and waits for timer, map, and host approval', async () => {
    let now = 110_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Background Custom Map' });
    const room = host.room;
    manager.setCustomGameRules(host, {
      mapMode: 'host',
      winsToWin: 3,
      roleSwapEveryMatches: 0,
      teamShuffleEveryMatches: 1,
      teamShuffleMode: 'host',
      postPhaseSeconds: 2,
      prePhaseSeconds: 4,
    });
    manager.setMapSeed(host, { seed: 8_100, roomCount: 4 });
    await room.customMapPromise;
    manager.setCustomGameRules(host, { mapMode: 'competitive' });
    await room.customMapPromise;
    manager.startMatch(host);

    let resolveMap;
    let signalGenerationStarted;
    const generationStarted = new Promise((resolve) => {
      signalGenerationStarted = resolve;
    });
    manager.createCompetitiveMapData = async ({ rules }) => {
      signalGenerationStarted();
      return new Promise((resolve) => {
        resolveMap = resolve;
      });
    };
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    const nextMapPromise = room.customMapPromise;
    await generationStarted;
    assert.equal(room.mapGenerationPending, true, 'the next-map search begins while postgame is active');

    now += 2_000;
    manager.advanceLobbyLifecycle(now);
    assert.deepEqual(manager.advanceGames(0), [], 'expired postgame remains waiting while the map search is pending');
    assert.ok(room.match?.victory, 'the post phase remains active until the map is ready');
    assert.equal(room.customSeriesState.phase, 'postgame');

    const seed = 8_101;
    const mapOptions = {
      minRooms: 4,
      maxRooms: 4,
      maxSiteApproachSightline: room.customGameRules.mapCriteria.maxSiteApproachSightline,
    };
    resolveMap({
      seed,
      mapOptions,
      map: generateMap(seed, MAP_WIDTH, MAP_HEIGHT, mapOptions),
      fingerprint: `custom-rules-test-${seed}`,
    });
    await nextMapPromise;
    manager.advanceLobbyLifecycle(now);

    assert.equal(room.match, null, 'host approval is the remaining transition gate');
    assert.equal(room.customSeriesState.phase, 'intermission');
    assert.equal(room.customSeriesState.teamShufflePending, true);
    assert.equal(room.mapSeed, seed);

    manager.approveCustomTeamShuffle(host);
    manager.advanceLobbyLifecycle(now);
    assert.equal(room.customSeriesState.phase, 'playing');
    assert.equal(room.match.startedAt, now, 'the next match begins immediately once all gates are satisfied');
    assert.equal(room.match.gameplayStartsAt, now + 4_000);
  });

  it('provides custom progression offers and prevents selections when the buy phase is disabled', async () => {
    const now = 80_000;
    const manager = new TestRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Custom Shop Rules' });
    const room = host.room;
    manager.setCustomGameRules(host, {
      mapMode: 'host',
      buyPhase: 'progression',
      firstShopOffers: 3,
      firstShopPicks: 1,
      uniqueGadgetInitialChancePercent: 0,
      uniqueGadgetChanceIncrementPercent: 0,
      uniqueGadgetMaxChancePercent: 0,
    });
    manager.setMapSeed(host, { seed: 9123, roomCount: 4 });
    await room.customMapPromise;
    const match = manager.startMatch(host).match;
    assert.equal(host.shopPicksRemaining, 1);
    assert.equal(host.selectedWeaponId, 'classic-pistol');
    assert.ok(host.weaponShopOfferIds.length + host.gadgetShopOfferIds.length +
      host.itemShopOfferIds.length >= 1);
    assert.equal(match.gameplayStartsAt, now + 15_000);

    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: manager.now() });
    manager.finishMatch(host);
    manager.setCustomGameRules(host, { buyPhase: 'none' });
    assert.throws(() => manager.selectWeapon(host, { weaponId: 'smg' }), /disabled/);
    assert.throws(() => manager.selectGadget(host, { gadgetId: 'smoke-grenade' }), /disabled/);
  });
});
