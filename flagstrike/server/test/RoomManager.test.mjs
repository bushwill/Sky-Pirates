import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  MATCH_DURATION_MS,
  MATCH_COUNTDOWN_MS,
  QUICK_PLAY_ROLE_SWAP_EVERY,
  LONG_PLAY_ROLE_SWAP_EVERY,
  LONG_PLAY_WINS_TO_WIN,
  LONG_SERIES_WINS_TO_WIN,
  QUICK_PLAY_COUNTDOWN_MS,
  QUICK_PLAY_FINAL_REPORT_MS,
  QUICK_PLAY_RESULT_MS,
  MAX_ROOM_CAPACITY,
  MAX_PLAYER_SPEED,
  RoomManager as BaseRoomManager,
  TEAM_CAPACITY,
} from '../RoomManager.mjs';
import { COMPETITIVE_MAP_RULES, DEFAULT_MAX_ROOMS, DEFAULT_MIN_ROOMS, generateMap, isCompetitiveMap, MAX_MAP_SEED } from '../../shared/MapGenerator.js';
import { DEFAULT_PROJECTILE_DEFINITIONS, getProjectileDamage } from '../../shared/ProjectileModel.js';
import { getWeaponMuzzlePosition } from '../../shared/WeaponGeometry.js';
import { HOST_FRAME_PROTOCOL_VERSION } from '../../shared/HostFrameProtocol.js';
import { createHostFrame } from '../../shared/HostFrameSnapshot.js';
import { getEffectiveMagazineSize, getInventoryEffects } from '../../shared/InventoryModel.js';
import {
  CRYO_GRENADE_ID,
  FLASH_GRENADE_ID,
  FLASH_GRENADE_DETONATION_DELAY_MS,
  FLASH_GRENADE_RADIUS,
  GADGET_DEFINITIONS,
  GADGET_SWITCH_DURATION_MS,
  TROPHY_SYSTEM_COMMAND_EFFECT_ID,
  TROPHY_SYSTEM_COMMAND_COOLDOWN_MS,
  TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_ID,
  getFlashBlindDurationMs,
  getGadgetProjectileSpeed,
  getGadgetThrowOrigin,
  KATANA_ID,
  MOLOTOV_ID,
  PROXIMITY_MINE_HIT_RADIUS,
  PROXIMITY_MINE_ID,
  SMOKE_GRENADE_ID,
  SONAR_ID,
  SPY_CAMERA_ID,
  VINE_TRAP_ID,
  VINE_TRAP_LATCH_DURATION_MS,
  VINE_TRAP_RECHARGE_DURATION_MS,
} from '../../shared/GadgetModel.js';
import { constrainPositionToRadius, PLAYER_ACCELERATION } from '../../shared/MovementModel.js';

class RoomManager extends BaseRoomManager {
  constructor(options = {}) {
    super({ randomTeam: () => 0, simulationMode: 'server-authoritative', ...options });
    this.createCompetitiveMapData = async () => createQuickPlayMapFixture();
    this.createQuickPlayMapData = async () => createQuickPlayMapFixture();
  }
}

let quickPlayFixtureId = 0;
let quickPlayFixtureTemplate;

function createQuickPlayMapFixture() {
  quickPlayFixtureTemplate ??= generateMap(9_001, MAP_WIDTH, MAP_HEIGHT, { minRooms: 1, maxRooms: 1 });
  const id = ++quickPlayFixtureId;
  const seed = 9_001 + id;
  const map = structuredClone(quickPlayFixtureTemplate);
  map.seed = seed;
  map.mapOptions = { minRooms: COMPETITIVE_MAP_RULES.minRooms, maxRooms: COMPETITIVE_MAP_RULES.minRooms };
  map.metrics.siteDoorways = Object.fromEntries(['red', 'blue'].map((team) => [team, {
    ...map.metrics.siteDoorways[team], doorwayCount: COMPETITIVE_MAP_RULES.minDoorwaysPerSite,
    graphEdgeCount: COMPETITIVE_MAP_RULES.minDoorwaysPerSite,
  }]));
  map.metrics.roomCount = COMPETITIVE_MAP_RULES.minRooms;
  map.metrics.topology.maxSymmetryPercent = COMPETITIVE_MAP_RULES.minSymmetryPercent;
  map.metrics.roomUtilization.ratio = COMPETITIVE_MAP_RULES.minRoomUtilization;
  map.metrics.siteSightline = {
    ...map.metrics.siteSightline,
    mutuallyOccluded: true,
    nearSiteSampleCount: 1,
    longNearSiteSightlineCount: 0,
  };
  return {
    seed,
    mapOptions: map.mapOptions,
    map,
    fingerprint: `quick-play-test-map-${id}`,
    attempts: 1,
  };
}

let nextClientId = 1;
function createClient() {
  return { id: `test-client-${nextClientId++}`, room: null };
}

function startGameplay(manager, client) {
  if (client.room?.simulationMode === 'host-authoritative' && !client.room.preparedMap) {
    manager.acceptHostMap(client, {
      map: createQuickPlayMapFixture().map,
      generationRevision: client.room.mapGenerationRevision,
    });
  }
  const state = manager.startMatch(client);
  const gameplayStartsAt = manager.now();
  const match = client.room.match;
  match.gameplayStartsAt = gameplayStartsAt;
  match.endsAt = gameplayStartsAt + MATCH_DURATION_MS;
  state.match.gameplayStartsAt = gameplayStartsAt;
  state.match.endsAt = match.endsAt;
  return state;
}

function setBotLoadoutBeforeMatch(room, botId, weaponId) {
  const bot = [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])]
    .find((entry) => entry.id === botId);
  if (!bot) throw new Error(`Bot ${botId} is not configured in the room roster.`);
  bot.selectedWeaponId = weaponId;
}

async function readyAndStartQuickPlay(manager, room) {
  if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
  let result;
  for (const client of room.clients) result = manager.setQuickPlayReady(client, { ready: true });
  assert.equal(result?.started, true, 'all players ready starts Practice when its map is ready');
  return { room, match: room.match ? structuredClone(room.match) : null, roomState: result.state };
}

async function readyAndStartLongPlay(manager, room) {
  if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
  let result;
  for (const client of room.clients) result = manager.setQuickPlayReady(client, { ready: true });
  assert.equal(result?.started, true, 'all players ready starts the series when its map is ready');
  return { room, match: room.match ? structuredClone(room.match) : null, roomState: result.state };
}

function assertCompetitiveMap(map) {
  const metrics = map.metrics;
  for (const team of ['red', 'blue']) {
    assert.ok(metrics.siteDoorways[team].doorwayCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
    assert.ok(metrics.siteDoorways[team].graphEdgeCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
  }
  assert.ok(metrics.topology.maxSymmetryPercent >= COMPETITIVE_MAP_RULES.minSymmetryPercent);
  assert.ok(metrics.roomUtilization.ratio >= COMPETITIVE_MAP_RULES.minRoomUtilization);
  assert.equal(metrics.siteSightline.mutuallyOccluded, true);
  assert.ok(metrics.siteSightline.nearSiteSampleCount > 0);
  assert.equal(metrics.siteSightline.longNearSiteSightlineCount, 0);
  assert.equal(isCompetitiveMap(map), true);
}

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('generation aborted')), { once: true });
  });
}

function createCatalogFallback() {
  return { ...createQuickPlayMapFixture(), attempts: 0, fromCatalog: true };
}

function getLeftSiteTeam(map) {
  return map.rooms.filter((room) => room.isSpawn).sort((left, right) => left.x - right.x)[0].team;
}

function assertTeamsOccupyTheirSites(match) {
  const redSite = match.map.spawnZones.red;
  const blueSite = match.map.spawnZones.blue;
  const redPlayer = match.players.find((player) => player.team === 'red');
  const bluePlayer = match.players.find((player) => player.team === 'blue');
  assert.equal(redPlayer.x, redSite.x + redSite.width / 2);
  assert.equal(redPlayer.y, redSite.y + redSite.height / 2 - 60);
  assert.equal(bluePlayer.x, blueSite.x + blueSite.width / 2);
  assert.equal(bluePlayer.y, blueSite.y + blueSite.height / 2 - 60);
  assert.equal(match.flag.x, blueSite.x + blueSite.width / 2, 'the flag remains centered in the Flag Site');
  assert.equal(match.flag.y, blueSite.y + blueSite.height / 2);
  assert.ok(match.players.every((player) => Math.hypot(match.flag.x - player.x, match.flag.y - player.y) > 35),
    'no player begins on or close to the flag at spawn');
}

describe('RoomManager', () => {
  it('advances playlist room lifecycle without custom-game rules', async () => {
    let now = 1_000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    manager.quickPlay(host);
    const room = host.room;

    assert.equal(room.customGameRules, undefined);
    assert.doesNotThrow(() => manager.advanceLobbyLifecycle(now));
    await room.quickPlayMapPromise;
    now += 1_000;
    assert.doesNotThrow(() => manager.advanceLobbyLifecycle(now));
  });

  it('initializes default gadget inventory for host-authoritative player and bot manifests', async () => {
    const manager = new BaseRoomManager({ simulationMode: 'host-authoritative', randomTeam: () => 0 });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Host Loadout' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'blue' });

    const { match } = startGameplay(manager, host);
    const human = match.players.find((player) => !player.isBot);
    assert.equal(human.selectedGadgetId, SMOKE_GRENADE_ID);
    assert.equal(human.gadgetCounts[SMOKE_GRENADE_ID], 1);
    assert.equal(human.gadgetCount, 1);
    const bot = match.players.find((player) => player.isBot);
    assert.ok(Object.hasOwn(GADGET_DEFINITIONS, bot.selectedGadgetId),
      'bots receive one of the equally weighted gadgets instead of all defaulting to smoke');
    const expectedCharges = GADGET_DEFINITIONS[bot.selectedGadgetId].charges ?? 1;
    assert.equal(bot.gadgetCounts[bot.selectedGadgetId], expectedCharges);
    assert.equal(bot.gadgetCount, expectedCharges);
    assert.equal(getInventoryEffects(bot.inventory).armor, 25,
      'host-authoritative bot manifests include default Practice armor');
  });

  it('ignores competitive maps submitted by an earlier generation request', async () => {
    const manager = new BaseRoomManager({ simulationMode: 'host-authoritative', randomTeam: () => 0 });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Map Generation Revision' });
    manager.setMapSeed(host, { seed: 1234, roomCount: 4 });
    const staleRevision = host.room.mapGenerationRevision;
    manager.setMapSeed(host, { seed: 5678, roomCount: 5 });
    const activeRevision = host.room.mapGenerationRevision;
    const map = createQuickPlayMapFixture().map;

    assert.ok(activeRevision > staleRevision);
    assert.throws(() => manager.startMatch(host), /finish generating and submitting/);
    assert.throws(() => manager.acceptHostMap(host, { map, generationRevision: staleRevision }), /invalid or unauthorized/);
    assert.equal(manager.updateHostMapGenerationProgress(host, {
      generationRevision: staleRevision, mapsGenerated: 12,
    }), false, 'progress from an earlier search cannot update the current counter');
    assert.equal(manager.updateHostMapGenerationProgress(host, {
      generationRevision: activeRevision, mapsGenerated: 3,
    }), true);
    assert.equal(manager.updateHostMapGenerationProgress(host, {
      generationRevision: activeRevision, mapsGenerated: 2,
    }), false, 'the generated-map counter cannot move backwards');
    assert.equal(manager.toRoomState(host.room).mapGenerationPending, true,
      'a stale result cannot make the current search look complete');
    assert.equal(manager.toRoomState(host.room).mapGenerationCount, 3);
    manager.acceptHostMap(host, { map, generationRevision: activeRevision });
    const state = manager.toRoomState(host.room);
    assert.equal(state.mapReady, true);
    assert.equal(state.mapGenerationPending, false);
  });

  it('switches to the smoke gadget, deploys a vision-only smoke cloud, and expires it after its configured duration', async () => {
    let now = 10_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Smoke Gadget' });
    const started = manager.startMatch(host);
    const definition = GADGET_DEFINITIONS[SMOKE_GRENADE_ID];
    manager.selectGadget(host, { gadgetId: definition.id });
    host.room.match.gameplayStartsAt = now;
    host.room.match.endsAt = now + MATCH_DURATION_MS;
    started.match.gameplayStartsAt = now;
    started.match.endsAt = now + MATCH_DURATION_MS;
    const player = host.room.match.players.find((entry) => entry.id === host.id);

    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, true);
    assert.equal(player.equippedSlot, 'weapon', 'the slot does not switch before the manual action ends');
    assert.equal(manager.applyGadgetAction(host, { action: 'use', target: { x: player.x + 80, y: player.y } }).accepted, false,
      'gadget use is blocked during the one-second switch');

    now += GADGET_SWITCH_DURATION_MS;
    manager.advanceGames(0.05);
    assert.equal(player.equippedSlot, 'gadget');
    const target = { x: player.x + 80, y: player.y };
    const result = manager.applyGadgetAction(host, { action: 'use', target });
    assert.equal(result.accepted, true);
    assert.equal(result.smoke.type, definition.effectType);
    assert.equal(result.smoke.role, definition.effectRole);
    assert.equal(result.smoke.blocksVision, definition.blocksVision);
    assert.equal(result.smoke.blocksMovement, false);
    assert.equal(result.smoke.blocksProjectiles, false);
    assert.ok(Math.abs(result.smoke.expiresAt - result.smoke.startedAt - definition.effectDurationMs) < 1e-6);
    assert.ok(result.smoke.detonatesAt > now, 'the gadget remains in flight until it reaches the path endpoint');
    assert.equal(player.gadgetCount, 0);
    assert.equal(player.equippedSlot, 'weapon', 'using the final gadget auto-equips the weapon');
    assert.equal(manager.getMatchSnapshotForClient(host).smokes.length, 0, 'no status circle exists while the gadget is in flight');

    assert.equal(manager.applyGadgetAction(host, { action: 'use', target }).accepted, false,
      'the grenade is consumed after deployment');
    now = result.smoke.detonatesAt + 1;
    manager.advanceGames(0.05);
    assert.equal(manager.getMatchSnapshotForClient(host).smokes.length, 1);
    now = result.smoke.expiresAt + 1;
    manager.advanceGames(0.05);
    assert.equal(host.room.match.smokes.length, 0);
  });

  it('offers and deploys a Flash Grenade with its one-second impact delay', async () => {
    let now = 12_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    const opponent = createClient();
    await manager.createAndJoin(host, { name: 'Flash Gadget' });
    await manager.join(opponent, { name: 'Flash Gadget' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(opponent, { team: 'blue' });
    const started = manager.startMatch(host);
    const definition = GADGET_DEFINITIONS[FLASH_GRENADE_ID];
    manager.selectGadget(host, { gadgetId: FLASH_GRENADE_ID });
    host.room.match.gameplayStartsAt = now;
    host.room.match.endsAt = now + MATCH_DURATION_MS;
    started.match.gameplayStartsAt = now;
    started.match.endsAt = now + MATCH_DURATION_MS;
    const player = host.room.match.players.find((entry) => entry.id === host.id);
    const opponentPlayer = host.room.match.players.find((entry) => entry.id === opponent.id);
    host.room.match.map.objects = [];
    const camera = {
      id: 'flash-camera',
      type: SPY_CAMERA_ID,
      team: 'blue',
      ownerId: opponent.id,
      x: player.x + 100,
      y: player.y + 10,
      expiresAt: host.room.match.endsAt,
    };
    host.room.match.gadgetEffects.push(camera);

    assert.equal(player.gadgetCounts[FLASH_GRENADE_ID], 1);
    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, true);
    now += GADGET_SWITCH_DURATION_MS;
    manager.advanceGames(0.05);
    const result = manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: player.x + 80, y: player.y },
    });

    assert.equal(result.accepted, true);
    assert.equal(result.smoke.type, 'flash');
    assert.equal(result.smoke.radius, definition.effectRadius);
    assert.equal(result.smoke.minBlindDurationMs, definition.minBlindDurationMs);
    assert.equal(result.smoke.maxBlindDurationMs, definition.maxBlindDurationMs);
    assert.ok(Math.abs(result.smoke.detonatesAt - result.smoke.thrownAt -
      Math.max(16, result.trajectory.distance / getGadgetProjectileSpeed(definition) * 1_000) -
      FLASH_GRENADE_DETONATION_DELAY_MS) < 1e-6);
    assert.equal(result.smoke.landedAt, result.smoke.detonatesAt - FLASH_GRENADE_DETONATION_DELAY_MS);
    assert.equal(host.room.match.gadgetEffects.some((effect) => effect.type === 'flash'), false,
      'the flash is not active before its delayed detonation');
    const pending = manager.getMatchSnapshotForClient(host).pendingGadgetEffects[0];
    assert.equal(pending.effect.id, result.smoke.id);
    assert.equal(pending.landedAt, result.smoke.landedAt);

    Object.assign(opponentPlayer, { x: result.smoke.x + 100, y: result.smoke.y });
    now = result.smoke.landedAt + 1;
    manager.advanceGames(0.05);
    assert.equal(manager.getMatchSnapshotForClient(host).pendingGadgetEffects.length, 1,
      'the landed grenade remains visible during its detonation delay');
    now = result.smoke.detonatesAt - 1;
    manager.advanceGames(0.05);
    assert.equal(host.room.match.gadgetEffects.some((effect) => effect.type === 'flash'), false);
    now = result.smoke.detonatesAt + 1;
    manager.advanceGames(0.05);
    assert.equal(host.room.match.gadgetEffects.some((effect) =>
      effect.type === 'flash' && effect.startedAt === result.smoke.detonatesAt), true);
    assert.equal(opponentPlayer.flashUntil,
      result.smoke.detonatesAt + getFlashBlindDurationMs(result.smoke, opponentPlayer));
    assert.equal(camera.disabledUntil,
      result.smoke.detonatesAt + getFlashBlindDurationMs(result.smoke, camera));
    Object.assign(opponentPlayer, { x: result.smoke.x + FLASH_GRENADE_RADIUS + 100 });
    now += 1_000;
    manager.advanceGames(0.05);
    assert.equal(opponentPlayer.flashUntil,
      result.smoke.detonatesAt + getFlashBlindDurationMs(result.smoke, {
        x: result.smoke.x + 100,
        y: result.smoke.y,
      }), 'moving outside the grenade radius does not shorten blindness');
  });

  it('detonates Molotovs at their trajectory endpoint and applies the configured burn rate', async () => {
    let now = 20_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    const teammate = createClient();
    const opponent = createClient();
    const survivor = createClient();
    await manager.createAndJoin(host, { name: 'Molotov Effect' });
    await manager.join(teammate, { name: 'Molotov Effect' });
    await manager.join(opponent, { name: 'Molotov Effect' });
    await manager.join(survivor, { name: 'Molotov Effect' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(teammate, { team: 'red' });
    manager.setPlayerTeam(opponent, { team: 'blue' });
    manager.setPlayerTeam(survivor, { team: 'blue' });
    startGameplay(manager, host);
    const [owner, ally] = host.room.match.players.filter((player) => [host.id, teammate.id].includes(player.id));
    const victim = host.room.match.players.find((player) => player.id === opponent.id);
    host.room.match.map.objects = [];
    const definition = GADGET_DEFINITIONS[MOLOTOV_ID];
    const initialArmor = definition.damagePerSecond / 2;
    const ownerInitialHealth = owner.health;
    const allyInitialHealth = ally.health;
    Object.assign(owner, { x: 500, y: 350, vx: 0, vy: 0, weaponLean: -1, armor: initialArmor, maxArmor: initialArmor });
    Object.assign(ally, { x: 520, y: 350, vx: 0, vy: 0, armor: initialArmor, maxArmor: initialArmor });
    Object.assign(victim, { x: 510, y: 350, health: 1, armor: 0 });
    host.room.match.damageContributions ??= {};
    host.room.match.damageContributions[victim.id] = { [ally.id]: 1 };
    Object.assign(owner, {
      selectedGadgetId: definition.id,
      gadgetCount: 1,
      gadgetCounts: { 'smoke-grenade': 0, molotov: 1, 'cryo-grenade': 0, 'proximity-mine': 0, 'flash-grenade': 0 },
      equippedSlot: 'gadget',
    });
    const result = manager.applyGadgetAction(host, { action: 'use', target: { x: 510, y: 350 } });

    assert.equal(result.accepted, true);
    assert.equal(result.smoke.type, definition.effectType);
    assert.equal(result.smoke.x, result.trajectory.endpoint.x);
    assert.equal(result.smoke.y, result.trajectory.endpoint.y);
    assert.deepEqual(result.trajectory.points[0], getGadgetThrowOrigin(owner, { x: 510, y: 350 }, host.room.match.map.objects));
    assert.equal(result.smoke.blocksVision, definition.blocksVision);
    assert.equal(result.smoke.expiresAt - result.smoke.startedAt, definition.effectDurationMs);
    assert.equal(result.smoke.radius, definition.effectRadius);

    for (let tick = 0; tick < 20; tick += 1) {
      now += 50;
      manager.advanceGames(0.05);
    }
    assert.equal(host.room.match.victory, null, 'the living opponent keeps the test round active');
    assert.equal(owner.armor, 0);
    assert.equal(ally.armor, 0);
    const expectedDamage = result.smoke.damagePerSecond * (now - result.smoke.startedAt) / 1000;
    const expectedHealth = ownerInitialHealth - Math.max(0, expectedDamage - initialArmor);
    assert.ok(Math.abs(owner.health - expectedHealth) < 0.5,
      'the configured burn rate damages its owner after armor is depleted');
    const expectedAllyHealth = allyInitialHealth - Math.max(0, expectedDamage - initialArmor);
    assert.ok(Math.abs(ally.health - expectedAllyHealth) < 0.5,
      'the configured burn rate includes nearby teammates');
    assert.ok(Math.abs(host.room.match.damageContributions[owner.id][owner.id] - expectedDamage) < 0.5);
    assert.deepEqual(victim.deathAttribution, { killerId: owner.id, assisterIds: [ally.id] });
    assert.equal(owner.stats.kills, 1);
    assert.equal(ally.stats.assists, 1);
  });

  it('lets Cryo extinguish overlapping Molotovs and burns props and proximity mines', () => {
    const manager = new RoomManager({ now: () => 1_100 });
    const victim = { id: 'fire-victim', team: 'blue', x: 500, y: 350, health: 100, armor: 0, alive: true };
    const prop = {
      id: 'fire-prop', role: 'destructible-prop', shape: 'circle', x: 550, y: 350, radius: 10,
      health: 100, maxHealth: 100, blocksMovement: true, blocksProjectiles: true, blocksVision: true,
    };
    const fire = {
      id: 'fire', type: 'molotov', x: 500, y: 350, radius: 60, damagePerSecond: 50,
      ownerId: 'fire-owner', startedAt: 1_000, expiresAt: 9_000,
    };
    const mine = {
      id: 'mine-in-fire', type: 'mine', triggerOnEnemyProximity: true, x: 540, y: 350,
      hitRadius: 4, armedAt: 5_000, team: 'red', expiresAt: 9_000,
    };
    const match = {
      players: [victim],
      map: { objects: [prop] },
      smokes: [],
      gadgetEffects: [fire, mine],
      damageContributions: {},
    };

    manager.applyGadgetEffectDamage(match, 1_000, 1_100);

    assert.equal(victim.health, 95, 'Molotov damage applies to players in the effect radius');
    assert.equal(prop.health, 95, 'Molotov damage applies to destructible props in the effect radius');
    assert.equal(match.gadgetEffects.some((effect) => effect.id === mine.id), false,
      'fire destroys proximity mines, including mines that have not armed yet');

    const protectedVictim = { id: 'cryo-victim', team: 'blue', x: 500, y: 350, health: 100, armor: 0, alive: true };
    const extinguishedMatch = {
      players: [protectedVictim],
      map: { objects: [] },
      smokes: [],
      gadgetEffects: [
        { ...fire, id: 'overlapped-fire', startedAt: 500 },
        { id: 'cryo', type: 'cryo', x: 520, y: 350, radius: 60, startedAt: 1_000, expiresAt: 20_000 },
      ],
      damageContributions: {},
    };

    manager.applyGadgetEffectDamage(extinguishedMatch, 1_000, 1_100);

    assert.equal(protectedVictim.health, 100, 'overlapping Cryo stops the fire before it can deal further damage');
    assert.equal(extinguishedMatch.gadgetEffects.some((effect) => effect.type === 'molotov'), false);
    assert.equal(extinguishedMatch.gadgetEffects.some((effect) => effect.type === 'cryo'), true);
  });

  it('lets proximity-mine blasts damage props and destroy deployed gadgets', () => {
    const manager = new RoomManager({ now: () => 5_000 });
    const mine = {
      id: 'blast-mine', type: 'mine', gadgetId: PROXIMITY_MINE_ID,
      triggerOnEnemyProximity: true, team: 'red', ownerId: 'red-owner',
      x: 500, y: 350, radius: 50, triggerRadius: 50, hitRadius: 4,
      explosionDamage: 150, armedAt: 0, expiresAt: 60_000,
    };
    const enemy = { id: 'blue-enemy', team: 'blue', alive: true, health: 300, armor: 0, x: 520, y: 350 };
    const prop = {
      id: 'blast-prop', role: 'destructible-prop', shape: 'circle',
      x: 550, y: 350, radius: 5, health: 300, maxHealth: 300,
      blocksMovement: true, blocksProjectiles: true, blocksVision: true,
    };
    const trophy = {
      id: 'blast-trophy', type: 'trophy-system', gadgetId: 'trophy-system',
      x: 530, y: 350, radius: 8, health: TROPHY_SYSTEM_HEALTH, team: 'blue', expiresAt: 60_000,
    };
    const match = {
      players: [enemy], map: { objects: [prop] }, smokes: [],
      gadgetEffects: [mine, trophy], damageContributions: {},
    };

    manager.applyGadgetEffectDamage(match, 5_000, 5_000);

    assert.equal(enemy.health, 150);
    assert.equal(prop.health, 150);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === trophy.id), true);
    assert.equal(trophy.health, 50, 'a 150-damage blast leaves a 200-health Trophy standing');
    assert.ok(match.gadgetEffects.some((effect) => effect.type === 'mine-explosion'));
  });

  it('resolves Orbital Strikes against players, props, and deployed gadgets', () => {
    const manager = new RoomManager({ now: () => 5_000 });
    const owner = { id: 'orbital-owner', team: 'red' };
    const warning = {
      id: 'warning', type: 'orbital-strike-warning', gadgetId: 'orbital-strike',
      ownerId: owner.id, x: 500, y: 350, radius: 42, explosionDamage: 150,
      warningDurationMs: 1_000, fireDurationMs: 6_000, damagePerSecond: 50,
      strikeAt: 5_000, expiresAt: 5_000,
    };
    const victim = { id: 'orbital-victim', team: 'blue', alive: true, health: 300, armor: 0, x: 500, y: 350 };
    const trophy = {
      id: 'orbital-trophy', type: 'trophy-system', gadgetId: 'trophy-system',
      x: 520, y: 350, radius: 8, health: TROPHY_SYSTEM_HEALTH, team: 'blue', expiresAt: 60_000,
    };
    const prop = {
      id: 'orbital-prop', role: 'destructible-prop', shape: 'circle',
      x: 530, y: 350, radius: 5, health: 300, maxHealth: 300,
      blocksMovement: true, blocksProjectiles: true, blocksVision: true,
    };
    const match = {
      players: [victim], map: { objects: [prop] }, gadgetEffects: [trophy],
      damageContributions: {},
    };

    manager.resolveOrbitalStrike(match, warning, 5_000);

    assert.equal(victim.health, 150);
    assert.equal(prop.health, 150);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === trophy.id), true);
    assert.equal(trophy.health, 50, 'the strike leaves a 200-health Trophy with 50 health');
    assert.ok(match.gadgetEffects.some((effect) => effect.type === 'orbital-strike-explosion'));
    assert.ok(match.gadgetEffects.some((effect) => effect.type === 'molotov'));

    manager.applyGadgetEffectDamage(match, 5_000, 5_100);
    assert.equal(prop.health, 145, 'the Orbital Strike fire continues damaging objects');
    assert.equal(trophy.health, 45, 'persistent fire continues damaging Trophy Systems');
  });

  it('arms a proximity mine 2.5 seconds after it is thrown and applies its configured blast', async () => {
    let now = 25_000;
    const manager = new RoomManager({ now: () => now });
    const ownerClient = createClient();
    const teammateClient = createClient();
    const enemyClient = createClient();
    const distantEnemyClient = createClient();
    await manager.createAndJoin(ownerClient, { name: 'Proximity Mine' });
    await manager.join(teammateClient, { name: 'Proximity Mine' });
    await manager.join(enemyClient, { name: 'Proximity Mine' });
    await manager.join(distantEnemyClient, { name: 'Proximity Mine' });
    manager.setPlayerTeam(ownerClient, { team: 'red' });
    manager.setPlayerTeam(teammateClient, { team: 'red' });
    manager.setPlayerTeam(enemyClient, { team: 'blue' });
    manager.setPlayerTeam(distantEnemyClient, { team: 'blue' });
    startGameplay(manager, ownerClient);
    const match = ownerClient.room.match;
    const definition = GADGET_DEFINITIONS[PROXIMITY_MINE_ID];
    const [owner, teammate, enemy, distantEnemy] = [ownerClient, teammateClient, enemyClient, distantEnemyClient]
      .map((client) => match.players.find((player) => player.id === client.id));
    match.map.objects = [];
    const ownerInitialHealth = owner.health;
    const ownerInitialArmor = definition.explosionDamage / 2;
    const teammateInitialHealth = teammate.health;
    const enemyInitialHealth = enemy.health;
    const distantEnemyInitialHealth = distantEnemy.health;
    Object.assign(owner, {
      x: 500, y: 350, armor: ownerInitialArmor, selectedGadgetId: PROXIMITY_MINE_ID,
      gadgetCount: 1,
      gadgetCounts: { 'smoke-grenade': 0, molotov: 0, 'cryo-grenade': 0, [PROXIMITY_MINE_ID]: 1 },
      equippedSlot: 'gadget',
    });
    Object.assign(teammate, { x: 520, y: 350, armor: 0 });
    Object.assign(enemy, { x: 1_200, y: 350, armor: 0 });
    Object.assign(distantEnemy, { x: 1_350, y: 350, armor: 0 });
    match.damageContributions ??= {};
    match.damageContributions[enemy.id] = { [teammate.id]: 1 };

    const result = manager.applyGadgetAction(ownerClient, { action: 'use', target: { x: 600, y: 350 } });
    const mine = result.smoke;
    assert.equal(result.accepted, true);
    assert.equal(mine.type, definition.effectType);
    assert.equal(mine.role, definition.effectRole);
    assert.equal(mine.radius, definition.triggerRadius);
    assert.equal(mine.armed, false);
    assert.equal(mine.armedAt, mine.thrownAt + 2_500);
    assert.equal(mine.expiresAt, match.endsAt, 'a deployed mine persists for the match');
    assert.ok(result.trajectory.distance <= definition.throwRange);
    const standardTravelTimeMs = result.trajectory.distance /
      getGadgetProjectileSpeed(GADGET_DEFINITIONS[SMOKE_GRENADE_ID]) * 1000;
    assert.ok(mine.detonatesAt - now < standardTravelTimeMs, 'the mine travels faster than standard gadgets');
    assert.equal(owner.gadgetCount, 0);
    assert.equal(match.gadgetEffects.length, 0, 'the mine does not exist before it lands');

    Object.assign(owner, { x: mine.x, y: mine.y });
    Object.assign(teammate, { x: mine.x, y: mine.y });
    now = mine.detonatesAt + 1;
    manager.advanceGames(0.05);
    assert.ok(match.gadgetEffects.some((effect) => effect.id === mine.id && effect.type === definition.effectType),
      'the mine exists after landing');
    assert.equal(mine.armed, false, 'the mine remains inactive before its arming deadline');
    assert.equal(teammate.health, teammateInitialHealth, 'a teammate alone does not trigger the mine');

    enemy.x = mine.x + mine.triggerRadius - 1;
    now = mine.armedAt - 1;
    manager.advanceGames(0.05);
    assert.ok(match.gadgetEffects.some((effect) => effect.id === mine.id),
      'an enemy in range cannot trigger the mine before it arms');
    assert.equal(enemy.health, enemyInitialHealth, 'an unarmed mine deals no damage');

    enemy.x = mine.x + mine.triggerRadius + 1;
    now = mine.armedAt;
    manager.advanceGames(0.05);
    assert.ok(match.gadgetEffects.some((effect) => effect.id === mine.id),
      'enemies outside the radius do not trigger the armed mine');

    enemy.x = mine.x + mine.triggerRadius - 1;
    now += 50;
    manager.advanceGames(0.05);
    assert.ok(!match.gadgetEffects.some((effect) => effect.id === mine.id), 'the mine is consumed on detonation');
    assert.ok(match.gadgetEffects.some((effect) => effect.type === `${definition.effectType}-explosion`),
      'the blast has a short visual effect');
    const expectedOwnerDamage = Math.min(definition.explosionDamage, ownerInitialHealth + ownerInitialArmor);
    const expectedOwnerHealth = Math.max(0,
      ownerInitialHealth - Math.max(0, definition.explosionDamage - ownerInitialArmor));
    assert.equal(owner.health, expectedOwnerHealth, 'the blast damages its owner after armor is depleted');
    assert.equal(teammate.health, Math.max(0, teammateInitialHealth - definition.explosionDamage),
      'the blast damages teammates in range');
    assert.equal(enemy.health, Math.max(0, enemyInitialHealth - definition.explosionDamage),
      'the triggering enemy is hit by the blast');
    assert.equal(distantEnemy.health, distantEnemyInitialHealth, 'players outside the radius are unaffected');
    if (enemy.health === 0) {
      assert.deepEqual(enemy.deathAttribution, { killerId: owner.id, assisterIds: [teammate.id] });
      assert.equal(owner.stats.kills, 1);
      assert.equal(teammate.stats.assists, 1);
    }
    assert.equal(match.damageContributions[owner.id][owner.id], expectedOwnerDamage);

    now += 50;
    manager.advanceGames(0.05);
    assert.equal(owner.health, expectedOwnerHealth, 'a mine only deals damage once');
  });

  it('lets only the opposite team shoot an arming mine and removes it before it can trigger', () => {
    const manager = new RoomManager({ now: () => 1_000 });
    const mine = {
      id: 'test-mine', type: 'mine', gadgetId: PROXIMITY_MINE_ID,
      triggerOnEnemyProximity: true, team: 'blue', x: 500, y: 350,
      hitRadius: PROXIMITY_MINE_HIT_RADIUS, triggerRadius: 50, explosionDamage: 150,
      ownerId: 'blue-owner', armedAt: 2_500, expiresAt: 10_000,
    };
    const match = { map: { objects: [] }, players: [], gadgetEffects: [mine] };
    const start = { x: 300, y: 350 };
    const end = { x: 700, y: 350 };
    const friendlyProjectile = {
      id: 'friendly-shot', type: 'assault-rifle', ownerId: 'blue-shooter', ownerTeam: 'blue',
      damage: 30, radius: 0, friendlyFire: false,
    };

    const friendlyShot = manager.traceProjectile(match, friendlyProjectile, start, end).event;
    assert.equal(friendlyShot.hitType, null, 'teammate bullets pass through their own mine');
    assert.equal(match.gadgetEffects.length, 1);

    const enemyShot = manager.traceProjectile(match, {
      ...friendlyProjectile, id: 'enemy-shot', ownerId: 'red-shooter', ownerTeam: 'red',
    }, start, end).event;
    assert.equal(enemyShot.hitType, 'gadget');
    assert.equal(enemyShot.gadgetEffectId, mine.id);
    assert.equal(match.gadgetEffects.length, 0, 'an enemy shot destroys the mine');

    const enemy = { id: 'red-player', team: 'red', alive: true, health: 100, armor: 0, x: mine.x, y: mine.y };
    match.players.push(enemy);
    manager.applyGadgetEffectDamage(match, 0, 50);
    assert.equal(enemy.health, 100, 'a destroyed mine cannot later trigger or deal blast damage');
  });

  it('lets enemy gunfire damage Trophy Systems before destroying them', () => {
    const manager = new BaseRoomManager({ now: () => 1_000, simulationMode: 'server-authoritative' });
    const trophy = {
      id: 'test-trophy', type: 'trophy-system', gadgetId: 'trophy-system',
      team: 'blue', x: 500, y: 350, radius: 8, health: TROPHY_SYSTEM_HEALTH, expiresAt: 60_000,
    };
    const match = { map: { objects: [] }, players: [], gadgetEffects: [trophy] };
    const start = { x: 300, y: 350 };
    const end = { x: 700, y: 350 };
    const projectile = {
      id: 'rifle-shot', type: 'assault-rifle', ownerId: 'red-shooter', ownerTeam: 'red',
      damage: 30, radius: 0, friendlyFire: false,
    };

    const firstShot = manager.traceProjectile(match, projectile, start, end).event;
    assert.equal(firstShot.gadgetHealth, 170);
    assert.equal(firstShot.gadgetDestroyed, false);
    assert.equal(match.gadgetEffects.length, 1);

    const secondShot = manager.traceProjectile(match, { ...projectile, id: 'rifle-shot-2' }, start, end).event;
    assert.equal(secondShot.gadgetHealth, 140);
    assert.equal(secondShot.gadgetDestroyed, false);
    let finalShot;
    for (let shot = 3; shot <= 7; shot += 1) {
      finalShot = manager.traceProjectile(match, { ...projectile, id: `rifle-shot-${shot}` }, start, end).event;
    }
    assert.equal(finalShot.gadgetHealth, 0);
    assert.equal(finalShot.gadgetDestroyed, true);
    assert.equal(match.gadgetEffects.length, 0);
  });

  it('short-throws Trophy Systems as damageable devices', async () => {
    let now = 20_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Trophy Throw' });
    startGameplay(manager, host);
    const player = host.room.match.players.find((entry) => entry.id === host.id);
    host.room.match.map.objects = [];
    const trophyDefinition = GADGET_DEFINITIONS['trophy-system'];
    Object.assign(player, {
      x: 500, y: 350, selectedGadgetId: trophyDefinition.id, gadgetCount: 1,
      gadgetCounts: { [trophyDefinition.id]: 1 }, equippedSlot: 'gadget',
      jammedUntil: now + 10_000,
    });

    const result = manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 600, y: 350 },
    });

    assert.equal(result.accepted, true);
    assert.equal(result.smoke.type, trophyDefinition.id);
    assert.equal(result.smoke.health, trophyDefinition.health);
    assert.equal(result.smoke.maxHealth, trophyDefinition.health);
    assert.ok(result.trajectory.endpoint.x > player.x);
    assert.ok(Math.hypot(
      result.trajectory.endpoint.x - result.trajectory.points[0].x,
      result.trajectory.endpoint.y - result.trajectory.points[0].y,
    ) <= trophyDefinition.throwRange);
    assert.equal(result.smoke.detonatesAt > now, true);
    assert.equal(result.smoke.expiresAt, host.room.match.endsAt,
      'the placed Trophy remains active until the match ends');
    assert.equal(player.gadgetCount, 0);
    assert.equal(player.equippedSlot, 'weapon',
      'placing the Trophy while jammed still returns the owner to their weapon');
  });

  it('lets an owner command a persistent Trophy through vision blockers and clears enemy fields', async () => {
    let now = 25_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Trophy Command' });
    const started = manager.startMatch(host);
    const match = host.room.match;
    const player = match.players.find((entry) => entry.id === host.id);
    match.gameplayStartsAt = now;
    match.endsAt = now + MATCH_DURATION_MS;
    started.match.gameplayStartsAt = now;
    started.match.endsAt = now + MATCH_DURATION_MS;
    const wall = {
      shape: 'segment', x1: 780, y1: 300, x2: 780, y2: 400,
      blocksVision: true, blocksProjectiles: true,
    };
    match.map.objects = [wall];
    Object.assign(player, {
      x: 500,
      y: 350,
      selectedGadgetId: TROPHY_SYSTEM_ID,
      gadgetCount: 0,
      gadgetCounts: { [TROPHY_SYSTEM_ID]: 0 },
      equippedSlot: 'weapon',
    });
    const trophy = {
      id: 'placed-trophy',
      type: TROPHY_SYSTEM_ID,
      gadgetId: TROPHY_SYSTEM_ID,
      ownerId: player.id,
      team: player.team,
      x: 500,
      y: 350,
      radius: 8,
      health: TROPHY_SYSTEM_HEALTH,
      maxHealth: TROPHY_SYSTEM_HEALTH,
      startedAt: now,
      expiresAt: match.endsAt,
    };
    const cryo = {
      id: 'enemy-cryo', type: 'cryo', gadgetId: CRYO_GRENADE_ID,
      ownerId: 'enemy', team: 'blue', x: 730, y: 350, radius: 60,
      startedAt: now, expiresAt: match.endsAt,
    };
    const blockedMolotov = {
      id: 'blocked-molotov', type: 'molotov', gadgetId: MOLOTOV_ID,
      ownerId: 'enemy', team: 'blue', x: 825, y: 350, radius: 20,
      startedAt: now, expiresAt: match.endsAt,
    };
    match.gadgetEffects.push(trophy, cryo, blockedMolotov);
    match.smokes.push(
      { id: 'enemy-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', team: 'blue',
        x: 730, y: 350, radius: 60, expiresAt: match.endsAt },
      { id: 'blocked-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', team: 'blue',
        x: 810, y: 350, radius: 60, expiresAt: match.endsAt },
      { id: 'friendly-smoke', gadgetId: SMOKE_GRENADE_ID, type: 'smoke', team: player.team,
        x: 720, y: 350, radius: 60, expiresAt: match.endsAt },
    );
    const ownerHealth = player.health;

    player.jammedUntil = now + 1_000;
    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, false,
      'a jammed owner cannot switch to the Trophy command');
    delete player.jammedUntil;
    trophy.jammedUntil = now + 1_000;
    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, false,
      'an owner cannot switch to a jammed Trophy command');
    delete trophy.jammedUntil;
    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, true,
      'the owner can re-equip the Trophy command after using its placement charge');
    now += GADGET_SWITCH_DURATION_MS;
    manager.advanceGames(0.05);
    assert.equal(player.equippedSlot, 'gadget');
    player.jammedUntil = now + 1_000;
    assert.equal(manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 700, y: 350 },
    }).accepted, false, 'a jammed owner cannot command the Trophy');
    delete player.jammedUntil;
    trophy.jammedUntil = now + 1_000;
    assert.equal(manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 700, y: 350 },
    }).accepted, false, 'a jammed Trophy cannot be commanded');
    delete trophy.jammedUntil;
    const result = manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 850, y: 350 },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.commandProjectile.type, TROPHY_SYSTEM_COMMAND_EFFECT_ID);
    assert.equal(player.trophyCommandReadyAt, now + TROPHY_SYSTEM_COMMAND_COOLDOWN_MS);
    assert.equal(player.gadgetCount, 0, 'commands do not consume another placement charge');
    assert.equal(player.equippedSlot, 'weapon', 'using the command automatically re-equips the weapon');
    assert.equal(player.gadgetSwitchEndsAt, null);

    now = result.commandProjectile.detonatesAt + 1;
    manager.advanceGames(0.05);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === cryo.id), false);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === blockedMolotov.id), false,
      'a commanded pulse clears effects through vision blockers');
    assert.equal(match.gadgetEffects.some((effect) => effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID), true);
    const pulse = match.gadgetEffects.find((effect) => effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID);
    assert.equal(pulse.expiresAt, pulse.startedAt + TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS);
    assert.deepEqual(match.smokes.map((smoke) => smoke.id).sort(), ['friendly-smoke']);
    assert.equal(player.health, ownerHealth, 'the command pulse does not damage players');

    assert.equal(manager.applyGadgetAction(host, { action: 'switch' }).accepted, true,
      'the owner can switch back to the placed Trophy while its command recharges');
    now += GADGET_SWITCH_DURATION_MS;
    manager.advanceGames(0.05);
    assert.equal(player.equippedSlot, 'gadget');
    assert.equal(manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 850, y: 350 },
    }).accepted, false, 'the command cannot be fired again during its cooldown');

    now = player.trophyCommandReadyAt;
    const rechargedCommand = manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 850, y: 350 },
    });
    assert.equal(rechargedCommand.accepted, true, 'the command recharges after 30 seconds');
    assert.equal(player.equippedSlot, 'weapon');
    match.gadgetEffects.push({
      id: 'enemy-trophy',
      type: TROPHY_SYSTEM_ID,
      gadgetId: TROPHY_SYSTEM_ID,
      ownerId: 'enemy',
      team: 'blue',
      x: 650,
      y: 350,
      radius: 8,
      health: TROPHY_SYSTEM_HEALTH,
      startedAt: now,
      expiresAt: match.endsAt,
    });
    manager.advanceGames(0.05);
    assert.equal(match.pendingGadgetEffects.length, 0,
      'an opposing Trophy intercepts the owner command projectile');
    assert.equal(match.gadgetEffects.some((effect) =>
      effect.id === rechargedCommand.commandProjectile.id), false);
  });

  it('allows unlimited Trophy pulses and replacement placements in custom infinite-gadget matches', async () => {
    let now = 25_000;
    const manager = new BaseRoomManager({
      now: () => now,
      randomTeam: () => 0,
      simulationMode: 'server-authoritative',
    });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Infinite Trophy Gadgets' });
    manager.setCustomGameRules(host, { infiniteGadgetUse: true });
    manager.startMatch(host);

    const match = host.room.match;
    match.gameplayStartsAt = now;
    match.endsAt = now + MATCH_DURATION_MS;
    match.map.objects = [];
    const player = match.players.find((entry) => entry.id === host.id);
    Object.assign(player, {
      x: 500,
      y: 350,
      selectedGadgetId: TROPHY_SYSTEM_ID,
      gadgetCount: 1,
      gadgetCounts: { [TROPHY_SYSTEM_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const trophy = {
      id: 'infinite-trophy',
      type: TROPHY_SYSTEM_ID,
      gadgetId: TROPHY_SYSTEM_ID,
      ownerId: player.id,
      team: player.team,
      x: 500,
      y: 350,
      health: TROPHY_SYSTEM_HEALTH,
      startedAt: now,
      expiresAt: match.endsAt,
    };
    match.gadgetEffects.push(trophy);

    const firePulse = () => manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 700, y: 350 },
    });
    assert.equal(match.infiniteGadgetUse, true);
    assert.equal(firePulse().accepted, true);
    assert.equal(player.trophyCommandReadyAt, now);
    player.equippedSlot = 'gadget';
    assert.equal(firePulse().accepted, true, 'Trophy pulses have no cooldown');

    match.gadgetEffects = match.gadgetEffects.filter((effect) => effect.id !== trophy.id);
    player.gadgetCount = 0;
    player.gadgetCounts[TROPHY_SYSTEM_ID] = 0;
    player.equippedSlot = 'gadget';
    const replacement = manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 600, y: 350 },
    });
    assert.equal(replacement.accepted, true, 'a destroyed Trophy can be replaced without a charge');
    assert.equal(player.gadgetCounts[TROPHY_SYSTEM_ID], 1);

    player.selectedGadgetId = SPY_CAMERA_ID;
    player.gadgetCount = 0;
    player.gadgetCounts[SPY_CAMERA_ID] = 0;
    player.equippedSlot = 'gadget';
    const placeCamera = () => manager.applyGadgetAction(host, {
      action: 'use',
      target: { x: 600, y: 350 },
    });
    assert.equal(placeCamera().accepted, true);
    assert.equal(placeCamera().accepted, true, 'Spy Cameras have unlimited placements');
    assert.equal(player.gadgetCounts[SPY_CAMERA_ID], 1);
  });

  it('lets enemy projectiles destroy an unarmed Vine Trap without granting a recharge', () => {
    const manager = new RoomManager({ now: () => 5_000 });
    const trap = {
      id: 'unarmed-vine', type: VINE_TRAP_ID, gadgetId: VINE_TRAP_ID,
      triggerOnEnemyProximity: true, team: 'blue', ownerId: 'blue-owner',
      x: 500, y: 350, hitRadius: 4, triggerRadius: 50,
      armedAt: 6_000, expiresAt: Number.MAX_SAFE_INTEGER,
    };
    const owner = {
      id: 'blue-owner', team: 'blue', alive: true, health: 100,
      gadgetCounts: { [VINE_TRAP_ID]: 0 },
    };
    const enemy = { id: 'red-enemy', team: 'red', alive: true, health: 100, x: 500, y: 350 };
    const match = { map: { objects: [] }, players: [owner, enemy], gadgetEffects: [trap] };
    const shot = manager.traceProjectile(match, {
      id: 'red-shot', type: 'assault-rifle', ownerId: enemy.id, ownerTeam: enemy.team,
      damage: 30, radius: 0, friendlyFire: false,
    }, { x: 300, y: 350 }, { x: 700, y: 350 }).event;

    assert.equal(shot.hitType, 'gadget');
    assert.equal(shot.gadgetEffectId, trap.id);
    assert.equal(match.gadgetEffects.length, 0);
    manager.applyGadgetEffectDamage(match, 5_000, 5_000);
    assert.equal(owner.vineTrapRechargeAt, undefined);
    assert.equal(owner.gadgetCounts[VINE_TRAP_ID], 0);
  });

  it('requires line of sight as well as radius for mine detection and blast damage', () => {
    const manager = new RoomManager();
    const mine = {
      id: 'los-mine', type: 'mine', gadgetId: PROXIMITY_MINE_ID,
      triggerOnEnemyProximity: true, team: 'blue', x: 500, y: 350,
      radius: 50, triggerRadius: 50, explosionDamage: 150, ownerId: 'blue-owner',
      expiresAt: 10_000,
    };
    const enemy = { id: 'red-enemy', team: 'red', alive: true, health: 300, armor: 0, x: 530, y: 350 };
    const occludedTeammate = { id: 'blue-teammate', team: 'blue', alive: true, health: 300, armor: 0, x: 530, y: 350 };
    const match = {
      map: { objects: [{
        id: 'cover', shape: 'segment', x1: 515, y1: 330, x2: 515, y2: 360,
        blocksVision: true,
      }] },
      smokes: [],
      players: [enemy, occludedTeammate],
      gadgetEffects: [mine],
    };

    manager.applyGadgetEffectDamage(match, 0, 50);
    assert.ok(match.gadgetEffects.some((effect) => effect.id === mine.id),
      'an enemy inside the trigger radius cannot set off a mine through cover');
    assert.equal(enemy.health, 300);

    enemy.y = 380;
    manager.applyGadgetEffectDamage(match, 50, 100);
    assert.ok(!match.gadgetEffects.some((effect) => effect.id === mine.id),
      'an enemy in range and in line of sight triggers the mine');
    assert.equal(enemy.health, 150, 'the visible triggering enemy is damaged by the blast');
    assert.equal(occludedTeammate.health, 300, 'cover shields nearby players from blast damage');
  });

  it('latches one enemy inside Vine Trap, confines movement, then starts the owner recharge', () => {
    const manager = new RoomManager();
    const owner = {
      id: 'vine-owner', team: 'red', alive: true, health: 100, selectedGadgetId: VINE_TRAP_ID,
      gadgetCount: 0, gadgetCounts: { [VINE_TRAP_ID]: 0 },
    };
    const firstEnemy = { id: 'first-enemy', team: 'blue', alive: true, health: 100, x: 520, y: 350 };
    const secondEnemy = { id: 'second-enemy', team: 'blue', alive: true, health: 100, x: 530, y: 350 };
    const trap = {
      id: 'vine-trap', type: VINE_TRAP_ID, gadgetId: VINE_TRAP_ID,
      triggerOnEnemyProximity: true, team: 'red', ownerId: owner.id,
      x: 500, y: 350, radius: 50, triggerRadius: 50, hitRadius: 4,
      armedAt: 1_000, expiresAt: 30_000,
      latchDurationMs: VINE_TRAP_LATCH_DURATION_MS,
      rechargeDurationMs: VINE_TRAP_RECHARGE_DURATION_MS,
    };
    const match = { map: { objects: [] }, smokes: [], players: [owner, firstEnemy, secondEnemy],
      gadgetEffects: [trap] };

    manager.applyGadgetEffectDamage(match, 2_000, 2_000);
    assert.equal(trap.latchedEnemyId, firstEnemy.id, 'only one enemy is latched');
    assert.equal(trap.activeUntil, 2_000 + VINE_TRAP_LATCH_DURATION_MS);
    assert.equal(firstEnemy.health, 100, 'Vine Trap restrains instead of dealing mine damage');
    assert.equal(secondEnemy.health, 100);
    const constrained = constrainPositionToRadius(
      { x: 600, y: 350, vx: 80, vy: 0 }, trap, trap.triggerRadius,
    );
    assert.equal(constrained.x, trap.x + trap.triggerRadius);
    assert.equal(constrained.y, trap.y);
    assert.equal(constrained.vx, 0, 'outward velocity is removed at the boundary');

    manager.applyGadgetEffectDamage(match, trap.activeUntil - 1, trap.activeUntil - 1);
    assert.ok(match.gadgetEffects.some((effect) => effect.id === trap.id));
    manager.applyGadgetEffectDamage(match, trap.activeUntil, trap.activeUntil);
    assert.ok(!match.gadgetEffects.some((effect) => effect.id === trap.id));
    assert.equal(owner.vineTrapRechargeAt, trap.activeUntil + VINE_TRAP_RECHARGE_DURATION_MS);
    manager.applyGadgetEffectDamage(match, owner.vineTrapRechargeAt, owner.vineTrapRechargeAt);
    assert.equal(owner.gadgetCounts[VINE_TRAP_ID], 1);
    assert.equal(owner.gadgetCount, 1);
  });

  it('creates Vine Trap through the normal selected-gadget action', async () => {
    const manager = new RoomManager({ now: () => 42_000 });
    const client = createClient();
    await manager.createAndJoin(client, { name: 'Vine Trap Gadget' });
    manager.setPlayerTeam(client, { team: 'red' });
    startGameplay(manager, client);
    const match = client.room.match;
    const player = match.players.find((entry) => entry.id === client.id);
    match.map.objects = [];
    Object.assign(player, {
      selectedGadgetId: VINE_TRAP_ID,
      gadgetCount: 1,
      gadgetCounts: { ...player.gadgetCounts, [VINE_TRAP_ID]: 1 },
      equippedSlot: 'gadget',
    });
    const result = manager.applyGadgetAction(client, {
      action: 'use',
      target: { x: player.x + 100, y: player.y },
    });
    assert.equal(result.accepted, true);
    assert.equal(result.smoke.type, VINE_TRAP_ID);
    assert.equal(result.smoke.armedAt, 42_000 + GADGET_DEFINITIONS[VINE_TRAP_ID].armingDurationMs);
    assert.equal(player.gadgetCounts[VINE_TRAP_ID], 0);
  });

  it('starts Vine Trap recharge immediately when the latched enemy dies', () => {
    const manager = new RoomManager();
    const owner = {
      id: 'vine-owner', team: 'red', alive: true, health: 100,
      gadgetCounts: { [VINE_TRAP_ID]: 0 },
    };
    const target = { id: 'latched-enemy', team: 'blue', alive: false, health: 0 };
    const trap = {
      id: 'active-vine', type: VINE_TRAP_ID, triggerOnEnemyProximity: true,
      ownerId: owner.id, latchedEnemyId: target.id,
      activeUntil: 7_000, expiresAt: 7_000, rechargeDurationMs: VINE_TRAP_RECHARGE_DURATION_MS,
    };
    const match = { map: { objects: [] }, players: [owner, target], gadgetEffects: [trap] };

    manager.applyGadgetEffectDamage(match, 3_000, 3_000);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === trap.id), false);
    assert.equal(owner.vineTrapRechargeAt, 3_000 + VINE_TRAP_RECHARGE_DURATION_MS);
  });

  it('does not recharge Vine Trap when its owner is dead as the restraint ends', () => {
    const manager = new RoomManager();
    const owner = { id: 'vine-owner', alive: false, health: 0, gadgetCounts: { [VINE_TRAP_ID]: 0 } };
    const trap = {
      id: 'expired-vine', type: VINE_TRAP_ID, triggerOnEnemyProximity: true, ownerId: owner.id,
      x: 100, y: 100, triggerRadius: 50, latchedEnemyId: 'enemy',
      activeUntil: 5_000, expiresAt: 5_000,
    };
    const match = { map: { objects: [] }, players: [owner], gadgetEffects: [trap] };
    manager.applyGadgetEffectDamage(match, 5_000, 5_000);
    assert.equal(match.gadgetEffects.some((effect) => effect.id === trap.id), false);
    assert.equal(owner.vineTrapRechargeAt, undefined);
    assert.equal(owner.gadgetCounts[VINE_TRAP_ID], 0);
  });

  it('shares spotted mines through team intel without exposing unseen enemy mines', async () => {
    let now = 32_000;
    const manager = new RoomManager({ now: () => now });
    const redClient = createClient();
    const blueClient = createClient();
    const redTeammateClient = createClient();
    await manager.createAndJoin(redClient, { name: 'Mine Intel' });
    await manager.join(blueClient, { name: 'Mine Intel' });
    await manager.join(redTeammateClient, { name: 'Mine Intel' });
    manager.setPlayerTeam(redClient, { team: 'red' });
    manager.setPlayerTeam(blueClient, { team: 'blue' });
    manager.setPlayerTeam(redTeammateClient, { team: 'red' });
    startGameplay(manager, redClient);
    const match = redClient.room.match;
    match.map.objects = [];
    const red = match.players.find((player) => player.id === redClient.id);
    const blue = match.players.find((player) => player.id === blueClient.id);
    const redTeammate = match.players.find((player) => player.id === redTeammateClient.id);
    Object.assign(red, { x: 100, y: 100, visionAngle: Math.PI, selectedWeaponId: 'assault-rifle' });
    Object.assign(blue, { x: 2_000, y: 900, visionAngle: Math.PI, selectedWeaponId: 'assault-rifle' });
    Object.assign(redTeammate, { x: 600, y: 100, visionAngle: 0, selectedWeaponId: 'assault-rifle' });
    const mine = {
      id: 'intel-mine', type: 'mine', gadgetId: PROXIMITY_MINE_ID,
      triggerOnEnemyProximity: true, team: 'blue', x: 500, y: 100,
      hitRadius: PROXIMITY_MINE_HIT_RADIUS, radius: 50, ownerId: blue.id,
      expiresAt: match.endsAt,
    };
    match.gadgetEffects.push(mine);

    manager.updateMineIntel(match);
    assert.equal(manager.getMatchSnapshotForClient(redClient).gadgetEffects.some((effect) => effect.id === mine.id), false,
      'the red team snapshot omits an unseen blue mine');
    assert.equal(manager.getMatchSnapshotForClient(blueClient).gadgetEffects.some((effect) => effect.id === mine.id), true,
      'the placing team knows its mine');

    redTeammate.visionAngle = Math.PI;
    manager.updateMineIntel(match);
    assert.equal(manager.getMatchSnapshotForClient(redClient).gadgetEffects.some((effect) => effect.id === mine.id), true,
      'a teammate currently seeing the mine shares its visibility with the team');

    redTeammate.visionAngle = 0;
    manager.updateMineIntel(match);
    assert.equal(manager.getMatchSnapshotForClient(redClient).gadgetEffects.some((effect) => effect.id === mine.id), false,
      'the team loses visibility after no teammate has direct sight of the mine');

    red.visionAngle = 0;
    manager.updateMineIntel(match);
    assert.equal(manager.getMatchSnapshotForClient(redClient).gadgetEffects.some((effect) => effect.id === mine.id), true,
      'a player can directly see the enemy mine');

    red.visionAngle = Math.PI;
    manager.updateMineIntel(match);
    assert.equal(manager.getMatchSnapshotForClient(redClient).gadgetEffects.some((effect) => effect.id === mine.id), false,
      'the enemy mine disappears again when direct sight is lost');
    assert.equal(manager.getMatchSnapshotForClient(blueClient).gadgetEffects.some((effect) => effect.id === mine.id), true,
      'the placing team always sees its mine');

    mine.jammedUntil = Date.now() + 10_000;
    redTeammate.visionAngle = Math.PI;
    manager.updateMineIntel(match, Date.now());
    assert.equal(manager.getMatchSnapshotForClient(blueClient).gadgetEffects.some((effect) => effect.id === mine.id), false,
      'the placing team stops receiving the jammed mine through Global Intel');
    assert.equal(manager.getMatchSnapshotForClient(redTeammateClient).gadgetEffects.some((effect) => effect.id === mine.id), true,
      'an unjammed enemy teammate can still share a directly visible mine');
  });

  it('shares an active Vine Trap with the latched player team even when its vision turns away', () => {
    const manager = new RoomManager();
    const owner = { id: 'vine-owner', team: 'red', alive: true, health: 100, x: 1_000, y: 900 };
    const trappedPlayer = { id: 'trapped-player', team: 'blue', alive: true, health: 100,
      x: 100, y: 100, visionAngle: Math.PI };
    const trap = {
      id: 'active-vine', type: VINE_TRAP_ID, triggerOnEnemyProximity: true,
      ownerId: owner.id, team: owner.team, x: 500, y: 500,
      latchedEnemyId: trappedPlayer.id, activeUntil: 5_000, expiresAt: 5_000,
    };
    const match = {
      startedAt: 1,
      map: { objects: [] },
      smokes: [],
      players: [owner, trappedPlayer],
      gadgetEffects: [trap],
      mineIntel: { red: new Set(), blue: new Set() },
    };
    manager.updateMineIntel(match, 1_000);
    const blueSnapshot = manager.getMatchSnapshotForClient({ room: { match }, team: 'blue' });
    assert.ok(blueSnapshot.gadgetEffects.some((effect) => effect.id === trap.id),
      'the trapped player team retains the active tether effect');
  });

  it('blocks team vision updates for jammed players while retaining their personal audio cues', async () => {
    let now = 60_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    await readyAndStartQuickPlay(manager, room);

    const jammedPlayer = room.match.players.find((player) => player.id === red.id);
    const redTeammate = room.match.players.find((player) => player.team === red.team && player.id !== red.id);
    jammedPlayer.jammedUntil = now + 10_000;
    assert.deepEqual(manager.revealTeamIntel(red, { spans: [0, 1] }), [],
      'jammed players cannot publish vision into team intel');

    room.match.botNoises = [
      { id: 'team-audio', team: red.team, x: 10, y: 10, radius: 5, expiresAt: now + 1_000 },
      {
        id: 'personal-audio', team: red.team, heardById: red.id, audiencePlayerId: red.id,
        x: 20, y: 20, radius: 5, expiresAt: now + 1_000,
      },
    ];
    const personalSnapshot = manager.getMatchSnapshotForClient(red);
    assert.deepEqual(personalSnapshot.botNoises.map((cue) => cue.id), ['personal-audio']);
    const teammateSnapshot = manager.getMatchSnapshotForClient({
      id: redTeammate.id,
      team: red.team,
      room,
    });
    assert.deepEqual(teammateSnapshot.botNoises.map((cue) => cue.id), ['team-audio'],
      'private audio cues are not shared with unjammed teammates');
  });

  it('applies Cryo’s configured movement multiplier and vision behavior on the server', async () => {
    let now = 30_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0, simulationMode: 'server-authoritative' });
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Cryo Effect' });
    startGameplay(manager, host);
    const player = host.room.match.players.find((entry) => entry.id === host.id);
    const definition = GADGET_DEFINITIONS[CRYO_GRENADE_ID];
    host.room.match.map.objects = [];
    Object.assign(player, {
      x: 500, y: 350, vx: 0, vy: 0,
      selectedGadgetId: CRYO_GRENADE_ID,
      gadgetCount: 1,
      gadgetCounts: { 'smoke-grenade': 0, molotov: 0, 'cryo-grenade': 1, 'proximity-mine': 0, 'flash-grenade': 0 },
      equippedSlot: 'gadget',
    });
    const result = manager.applyGadgetAction(host, { action: 'use', target: { x: 510, y: 350 } });
    assert.equal(result.smoke.type, definition.effectType);
    assert.equal(result.smoke.blocksVision, definition.blocksVision);
    assert.equal(result.smoke.movementScale, definition.movementSpeedMultiplier);
    assert.equal(result.smoke.expiresAt - result.smoke.startedAt, definition.effectDurationMs);

    manager.updateGameInput(host, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    const simulationStepSeconds = 0.05;
    now += simulationStepSeconds * 1000;
    manager.advanceGames(simulationStepSeconds);
    const weaponMovementScale = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale;
    const expectedVelocity = PLAYER_ACCELERATION * weaponMovementScale * definition.movementSpeedMultiplier * simulationStepSeconds;
    assert.ok(Math.abs(player.vx - expectedVelocity) < 1e-6,
      `Cryo scales assault-rifle acceleration by its configured multiplier (${player.vx} velocity)`);
  });

  it('stores complete host frames, ignores duplicate or out-of-order revisions, and hands state to a replacement host', async () => {
    let now = 39_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0 });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Host Frame Handoff' });
    await manager.join(guest, { name: 'Host Frame Handoff' });
    startGameplay(manager, host);
    const room = host.room;
    room.simulationMode = 'host-authoritative';
    room.match.flag = { ...room.match.flag, x: 420, y: 350, heldBy: host.id };
    const createFrame = ({ epoch = room.authorityEpoch, revision, tick = revision } = {}) => ({
      protocolVersion: HOST_FRAME_PROTOCOL_VERSION,
      matchId: room.match.startedAt,
      authorityEpoch: epoch,
      revision,
      tick,
      simulationTimeMs: revision * 50,
      actors: room.match.players.map((player) => ({
        id: player.id,
        state: { x: player.x, y: player.y, health: player.health, alive: player.alive },
      })),
      objectives: [{ id: 'flag', state: structuredClone(room.match.flag) }],
      events: [{
        id: 'private-hit',
        type: 'hit-marker',
        audiencePlayerId: guest.id,
        data: { id: 'private-hit', durationMs: 250 },
      }, {
        id: 'private-prop',
        type: 'prop-damage',
        audiencePlayerId: guest.id,
        data: { id: 'private-prop', objectId: 'crate', health: 250 },
      }],
      acknowledgements: room.match.players.map((player) => ({
        id: player.id,
        inputSequence: player.lastInputSequence ?? 0,
        actionSequence: player.lastWeaponActionSequence ?? 0,
      })),
    });

    const missingHost = createFrame({ revision: 1 });
    missingHost.actors = missingHost.actors.filter((actor) => actor.id !== host.id);
    assert.throws(() => manager.acceptHostFrame(host, missingHost), /include every match player, including the host/);

    const first = createFrame({ revision: 1 });
    assert.equal(manager.acceptHostFrame(host, first).accepted, true);
    assert.deepEqual(room.latestHostFrame.events, [],
      'player-private hit feedback and partial prop damage are not retained in shared room state');
    assert.equal(manager.acceptHostFrame(host, first).accepted, false, 'duplicate revisions are ignored');
    assert.equal(manager.acceptHostFrame(host, createFrame({ revision: 2, tick: 1 })).accepted, false,
      'stale or out-of-order revisions are ignored');
    assert.throws(() => manager.acceptHostFrame(guest, createFrame({ revision: 2 })), /stale or unauthorized/);
    assert.equal(manager.toRoomState(room).authorityFrame.revision, 1);

    const departure = manager.leave(host);
    assert.equal(departure.hostChanged, true);
    assert.equal(departure.state.simulation.epoch, 2);
    assert.equal(departure.state.match.flag.heldBy, null,
      'a departing flag carrier drops the flag in the replacement host state');
    assert.equal(room.latestHostFrame.actors.some((actor) => actor.id === host.id), false,
      'the retained frame no longer restores the departed player');
    assert.equal(room.latestHostFrame.acknowledgements.some((acknowledgement) => acknowledgement.id === host.id), false,
      'the departed player acknowledgement is removed with its actor');
    assert.equal(room.latestHostFrame.objectives.find((objective) => objective.id === 'flag').state.heldBy, null,
      'the retained objective reflects the dropped flag');
    assert.equal(departure.state.authorityFrame.revision, 1,
      'the replacement host receives the latest full state from the prior authority epoch');
    assert.throws(() => manager.acceptHostFrame(guest, createFrame({ epoch: 1, revision: 2 })), /stale or unauthorized/,
      'old-epoch frames are rejected');
    assert.equal(manager.acceptHostFrame(guest, createFrame({ epoch: 2, revision: 2 })).accepted, true,
      'the replacement host resumes with a higher revision in the new epoch');
    assert.equal(manager.toRoomState(room).authorityFrame.authorityEpoch, 2);
    now += 20;
  });

  it('reports custom-match terminal transitions so every room client receives the postgame state', async () => {
    const manager = new BaseRoomManager({ now: () => 42_000, randomTeam: () => 0,
      simulationMode: 'host-authoritative' });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Custom Match Lifecycle' });
    await manager.join(guest, { name: 'Custom Match Lifecycle' });
    startGameplay(manager, host);
    const room = host.room;
    const blueSpawn = room.match.map.spawnZones.blue;
    assert.deepEqual(room.match.flag, {
      x: blueSpawn.x + blueSpawn.width / 2,
      y: blueSpawn.y + blueSpawn.height / 2,
      heldBy: null,
      dropped: false,
      lastDroppedBy: null,
    }, 'host-authoritative matches start with a valid flag objective');
    const victory = { winner: 'red', reason: 'elimination', at: 42_100 };
    const terminalMatch = {
      ...room.match,
      players: room.match.players.map((player, index) => ({
        ...player, x: 120 + index * 30, y: 140, vx: 0, vy: 0,
      })),
      victory,
      postGame: {
      endsAt: 57_100,
      choices: { [host.id]: 'waiting', [guest.id]: 'waiting' },
      },
    };
    const firstFrame = createHostFrame({
      match: terminalMatch,
      authorityEpoch: room.authorityEpoch,
      revision: 1,
      simulationTimeMs: 100,
    });
    const firstResult = manager.acceptHostFrame(host, firstFrame);
    assert.equal(firstResult.matchLifecycleChanged, true);
    assert.equal(room.postGame.endsAt, 57_100);

    const secondFrame = createHostFrame({
      match: terminalMatch,
      authorityEpoch: room.authorityEpoch,
      revision: 2,
      simulationTimeMs: 150,
    });
    assert.equal(manager.acceptHostFrame(host, secondFrame).matchLifecycleChanged, false);
  });

  it('records host-authoritative Quick Play results by squad and rotates roles once', async () => {
    const manager = new BaseRoomManager({
      now: () => 52_000,
      randomTeam: () => 0,
      simulationMode: 'host-authoritative',
    });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Quick Play Host Result' });
    await manager.join(guest, { name: 'Quick Play Host Result' });
    startGameplay(manager, host);
    const room = host.room;
    assert.ok(room.match.flag, 'host-authoritative Quick Play starts with a flag objective');
    room.quickPlay = true;
    room.gameMode = 'quickplay';
    host.squadId = 'A';
    guest.squadId = 'B';
    room.quickPlayRoleBySquad = { A: 'red', B: 'blue' };
    room.quickPlayScoreBySquad = { A: 0, B: 0 };
    room.quickPlayState = {
      gameMode: 'quickplay',
      winsToWin: null,
      roleSwapEvery: 1,
      phase: 'countdown',
      round: 1,
      score: { red: 0, blue: 0 },
      squadScore: { A: 0, B: 0 },
      rolesBySquad: { A: 'red', B: 'blue' },
      sidesSwapped: false,
      mapGenerationRevision: room.mapGenerationRevision,
      lastResult: null,
      winner: null,
      winnerSquadId: null,
    };
    room.match.quickPlayState = structuredClone(room.quickPlayState);
    const resultAt = 52_100;
    const terminalMatch = {
      ...room.match,
      players: room.match.players.map((player, index) => ({
        ...player, x: 120 + index * 30, y: 140, vx: 0, vy: 0,
      })),
      victory: { winner: 'red', reason: 'elimination', at: resultAt },
      quickPlayState: {
        ...room.quickPlayState,
        phase: 'round-result',
        phaseEndsAt: resultAt + QUICK_PLAY_RESULT_MS,
        score: { red: 1, blue: 0 },
        nextRoundScore: { red: 0, blue: 1 },
        squadScore: { A: 1, B: 0 },
        rolesBySquad: { A: 'blue', B: 'red' },
        sidesSwapped: true,
        mapGenerationRevision: room.mapGenerationRevision + 1,
        winner: null,
        winnerSquadId: null,
        lastResult: {
          winner: 'red',
          reason: 'elimination',
          round: 1,
          at: resultAt,
          score: { red: 1, blue: 0 },
          squadId: 'A',
          winnerSquadId: 'A',
          rolesBySquad: { A: 'red', B: 'blue' },
        },
      },
    };
    const firstFrame = createHostFrame({
      match: terminalMatch,
      authorityEpoch: room.authorityEpoch,
      revision: 1,
      simulationTimeMs: 100,
    });

    const firstResult = manager.acceptHostFrame(host, firstFrame);

    assert.equal(firstResult.quickPlayResultChanged, true);
    assert.deepEqual(room.quickPlayScoreBySquad, { A: 1, B: 0 });
    assert.deepEqual(room.quickPlayState.score, { red: 1, blue: 0 });
    assert.deepEqual(room.quickPlayRoleBySquad, { A: 'blue', B: 'red' });
    assert.equal(room.quickPlayState.phaseEndsAt, resultAt + QUICK_PLAY_RESULT_MS,
      'the server stores the host-authored result deadline');
    assert.deepEqual(room.quickPlayState.lastResult, terminalMatch.quickPlayState.lastResult,
      'the server stores the host-authored result without recalculating it');
    assert.equal(host.team, 'blue');

    const duplicateFrame = createHostFrame({
      match: terminalMatch,
      authorityEpoch: room.authorityEpoch,
      revision: 2,
      simulationTimeMs: 150,
    });
    assert.equal(manager.acceptHostFrame(host, duplicateFrame).quickPlayResultChanged, false);
    assert.deepEqual(room.quickPlayScoreBySquad, { A: 1, B: 0 });

    room.match.victory = null;
    room.quickPlayState.phase = 'playing';
    room.quickPlayState.phaseEndsAt = null;
    room.quickPlayState.lastResult = null;
    room.quickPlayState.winner = null;
    room.quickPlayState.winnerSquadId = null;
    delete room.quickPlayState.nextRoundScore;
    room.match.quickPlayState = structuredClone(room.quickPlayState);
    manager.setMatchVictory(room, { winner: 'red', reason: 'time', at: resultAt + 100 });

    assert.equal(room.quickPlayState.phase, 'round-result');
    assert.deepEqual(room.quickPlayState.nextRoundScore, { red: 1, blue: 1 });
    const fallbackResultFrame = createHostFrame({
      match: room.match,
      authorityEpoch: room.authorityEpoch,
      revision: 3,
      simulationTimeMs: 200,
    });
    assert.equal(manager.acceptHostFrame(host, fallbackResultFrame).accepted, true,
      'a server-generated timeout result stays valid in later host frames');
  });

  it('rejects armor and perk purchases outside Quick Play and Long Play', async () => {
    const manager = new BaseRoomManager({ randomTeam: () => 0 });
    const customPlayer = createClient();
    await manager.createAndJoin(customPlayer, { name: 'Custom Shop Restrictions' });
    assert.throws(() => manager.selectShopItem(customPlayer, {
      itemId: 'armor', level: 1, kind: 'armor',
    }), /only available in Quick Play or Long Play/);

    const quickPlayer = createClient();
    manager.quickPlay(quickPlayer);
    assert.throws(() => manager.selectShopItem(quickPlayer, {
      itemId: 'armor', level: 1, kind: 'armor',
    }), /only available in Quick Play or Long Play/);
  });

  it('accepts host-aggregated positions without acknowledging inputs before a host frame', async () => {
    let now = 40_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0 });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Host Simulation' });
    await manager.join(guest, { name: 'Host Simulation' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    const started = startGameplay(manager, host);
    const room = host.room;
    room.simulationMode = 'host-authoritative';
    started.simulation.mode = 'host-authoritative';
    const red = room.match.players.find((player) => player.id === host.id);
    const blue = room.match.players.find((player) => player.id === guest.id);
    const startingPositions = new Map(room.match.players.map((player) => [player.id, { x: player.x, y: player.y }]));

    assert.equal(started.simulation.mode, 'host-authoritative');
    manager.updateGameInput(host, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    manager.updateGameInput(guest, {
      sequence: 1,
      input: { up: false, down: false, left: true, right: false },
    });
    manager.advanceGames(0.05);
    assert.deepEqual([red.x, red.y], [startingPositions.get(red.id).x, startingPositions.get(red.id).y],
      'the server does not run movement integration for host-authoritative rooms');
    assert.equal(blue.lastInputSequence, 0,
      'receiving a guest input does not acknowledge movement before the host simulates it');

    const frame = room.match.players.map((player) => ({
      id: player.id,
      x: player.x + (player.id === host.id ? 12 : -12),
      y: player.y,
      vx: player.id === host.id ? 80 : -80,
      vy: 0,
      lastInputSequence: 1,
    }));
    const { epoch } = manager.toRoomState(room).simulation;
    assert.throws(() => manager.applyHostMotion(guest, {
      matchId: room.match.startedAt, epoch, frame: 1, players: frame,
    }), /stale or unauthorized/);
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt, epoch, frame: 1, players: frame,
    }).accepted, true);
    assert.equal(red.x, startingPositions.get(red.id).x + 12);
    assert.equal(blue.x, startingPositions.get(blue.id).x - 12);
    assert.equal(blue.lastInputSequence, 1);

    const earlyAckFrame = room.match.players.map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      lastInputSequence: player.id === guest.id ? 2 : 1,
    }));
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt, epoch, frame: 2, players: earlyAckFrame,
    }).accepted, true, 'a pose is not discarded just because its input relay is still in flight');
    assert.equal(blue.lastInputSequence, 1,
      'the server does not expose an acknowledgement before receiving that input');

    manager.updateGameInput(guest, {
      sequence: 2,
      input: { up: false, down: false, left: true, right: false },
    });
    manager.advanceGames(0.05);
    const newerFrame = room.match.players.map((player) => ({
      id: player.id,
      x: player.x + (player.id === guest.id ? -4 : 4),
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      lastInputSequence: 1,
    }));
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt, epoch, frame: 3, players: newerFrame,
    }).accepted, true, 'a fresh pose is accepted even if its input ack lags a relayed guest input');
    assert.equal(blue.x, startingPositions.get(blue.id).x - 16);
    assert.equal(blue.lastInputSequence, 1, 'the host frame retains its actual processed-input acknowledgement');

    assert.throws(() => manager.applyHostMotion(host, {
      matchId: room.match.startedAt, epoch: epoch - 1, frame: 3, players: frame,
    }), /stale or unauthorized/);
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt, epoch, frame: 2, players: frame,
    }).accepted, false, 'duplicate or out-of-order host motion is discarded quietly');
  });

  it('relays only a player’s own sequenced motion for host aggregation', async () => {
    let now = 42_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0 });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Owner Motion' });
    await manager.join(guest, { name: 'Owner Motion' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    startGameplay(manager, host);
    const room = host.room;
    room.simulationMode = 'host-authoritative';
    const guestPlayer = room.match.players.find((player) => player.id === guest.id);
    const startX = guestPlayer.x;
    manager.updateGameInput(guest, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    const motion = {
      matchId: room.match.startedAt,
      frame: 1,
      player: {
        id: guest.id,
        x: startX + 8,
        y: guestPlayer.y,
        vx: 100,
        vy: 0,
        lastInputSequence: 1,
      },
    };

    assert.equal(manager.validatePlayerMotion(host, motion).accepted, false,
      'a different player cannot submit the guest’s movement');
    const validated = manager.validatePlayerMotion(guest, motion);
    assert.equal(validated.accepted, true);
    assert.equal(guestPlayer.x, startX, 'owner motion is relayed for host aggregation, not applied by the server');
    assert.equal(manager.validatePlayerMotion(guest, motion).accepted, false,
      'duplicate motion frames are rejected');
    assert.equal(manager.validatePlayerMotion(guest, { ...motion, matchId: room.match.startedAt - 1 }).accepted, false,
      'motion delayed from a previous match is ignored');
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt - 1,
      epoch: room.authorityEpoch,
      frame: 1,
      players: room.match.players,
    }).accepted, false, 'a stale host frame is ignored after match transitions');
    assert.equal(manager.applyHostMotion(host, {
      matchId: room.match.startedAt,
      epoch: room.authorityEpoch,
      frame: 1,
      players: room.match.players.map((player) => ({
        id: player.id,
        x: player.id === guest.id ? motion.player.x : player.x,
        y: player.id === guest.id ? motion.player.y : player.y,
        vx: player.id === guest.id ? motion.player.vx : player.vx,
        vy: player.id === guest.id ? motion.player.vy : player.vy,
        lastInputSequence: player.id === guest.id ? motion.player.lastInputSequence : player.lastInputSequence ?? 0,
      })),
    }).accepted, true);
    assert.equal(guestPlayer.x, startX + 8);
    assert.equal(guestPlayer.lastInputSequence, 1);
    now += 20;
  });

  it('balances Practice arrivals, keeps the competitive map private in the lobby, then reveals it for pre-game', async () => {
    let now = 1_000;
    const manager = new RoomManager({ now: () => now });
    const players = Array.from({ length: 10 }, () => createClient());
    const first = manager.quickPlay(players[0]);
    const room = players[0].room;

    assert.equal(first.room.quickPlay, true);
    assert.equal(first.room.name, 'Practice 1');
    assert.equal(first.room.gameMode, 'quickplay');
    assert.equal(first.state.gameModeLabel, 'Practice');
    assert.equal(first.state.quickPlayState.winsToWin, null, 'Practice has no series win target');
    assert.equal(players[0].team, 'red');
    assert.equal(first.state.quickPlayAutoStartAt, null, 'Practice has no lobby force-start deadline');
    assert.throws(() => manager.setPlayerTeam(players[0], { team: 'none' }), /Choose Strike Team or Flag Team/);
    for (const player of players.slice(1)) {
      const joined = manager.quickPlay(player);
      assert.equal(joined.room.name, room.name);
    }

    assert.deepEqual(manager.getTeamCounts(room), { red: 5, blue: 5 });
    const overflow = manager.quickPlay(createClient());
    assert.notEqual(overflow.room.name, room.name, 'full pending matches are skipped in favor of a new lobby');
    assert.equal(first.state.seed, null, 'Quick Play map seeds are not exposed in lobby state');
    assert.equal(first.state.mapOptions, null);
    await Promise.all([...manager.rooms.values()].map((pendingRoom) => pendingRoom.quickPlayMapPromise));
    assertCompetitiveMap(room.quickPlayMap.map);

    const started = await readyAndStartQuickPlay(manager, room);
    assert.equal(started.room, room);
    assert.equal(started.match.players.length, 10);
    assert.equal(started.roomState.quickPlayState.phase, 'countdown');
    assert.equal(started.match.gameplayStartsAt, now + QUICK_PLAY_COUNTDOWN_MS);
    assert.equal(started.match.endsAt, now + QUICK_PLAY_COUNTDOWN_MS + MATCH_DURATION_MS);
    assert.ok(started.roomState.match.map, 'the competitive map is revealed at the start of pre-game');
    assertCompetitiveMap(started.roomState.match.map);
    assertCompetitiveMap(room.match.map);
    assert.equal(getLeftSiteTeam(room.match.map), 'red', 'the first round uses the generated orientation');
    assertTeamsOccupyTheirSites(room.match);
    const redSpawn = room.match.map.rooms.find((mapRoom) => mapRoom.isSpawn && mapRoom.team === 'red');
    const firstRedPlayer = room.match.players.find((player) => player.team === 'red');
    assert.equal(firstRedPlayer.x, redSpawn.x);
    assert.equal(firstRedPlayer.y, redSpawn.y - 60, 'players are placed on the new map before its countdown ends');
    const initialUpdates = manager.advanceGames(0);
    assert.ok(initialUpdates.some((update) => update.room === room && update.match?.quickPlayState?.phase === 'countdown'),
      'starting Quick Play publishes its initial pre-phase snapshot');
    now += QUICK_PLAY_COUNTDOWN_MS;
    const [playing] = manager.advanceGames(0);
    assert.equal(playing.roomState.quickPlayState.phase, 'playing');
    assert.ok(playing.roomState.match.map, 'the map remains available when gameplay starts');
  });

  it('locks Quick Play bot weapons after the pre-game countdown', async () => {
    let now = 2_000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    manager.quickPlay(host);
    manager.quickPlay(guest);
    const room = host.room;
    await readyAndStartQuickPlay(manager, room);

    const bot = room.match.players.find((player) => player.isBot);
    assert.ok(bot, 'Quick Play fills open team slots with bots');
    const availableWeapons = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
    assert.ok(availableWeapons.some((weapon) => weapon.id === bot.selectedWeaponId),
      'each bot starts with a valid weapon');
    const alternateWeaponId = availableWeapons.find((weapon) => weapon.id !== bot.selectedWeaponId).id;

    const command = (sequence, weaponId) => ({
      botId: bot.id,
      sequence,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
      weaponId,
    });
    now = room.match.gameplayStartsAt;
    assert.throws(() => manager.applyBotCommands(host, { commands: [command(1, alternateWeaponId)] }),
      /invalid or stale/, 'weapon switching is rejected after gameplay starts');
    const startWeaponId = bot.selectedWeaponId;
    assert.doesNotThrow(() => manager.applyBotCommands(host, { commands: [command(1, startWeaponId)] }),
      'the bot can continue using its selected weapon');
    assert.equal(bot.selectedWeaponId, startWeaponId);
  });

  it('lets Quick Play players switch roles in the lobby and locks their squad roles once a round begins', async () => {
    let now = 8_000;
    const manager = new RoomManager({ now: () => now, randomTeam: () => 0 });
    const first = createClient();
    const second = createClient();
    manager.quickPlay(first);
    manager.quickPlay(second);
    const room = first.room;
    await room.quickPlayMapPromise;

    assert.equal(first.team, 'red');
    assert.equal(first.squadId, 'A');
    assert.equal(manager.setQuickPlayReady(first, { ready: true }).started, false);
    const changed = manager.setPlayerTeam(first, { team: 'blue' });
    assert.equal(first.team, 'blue');
    assert.equal(first.squadId, 'B');
    assert.equal(changed.quickPlayState.ready[first.id], false, 'switching teams cancels lobby readiness');
    assert.deepEqual(manager.getTeamCounts(room), { red: 0, blue: 2 });

    manager.setQuickPlayReady(first, { ready: true });
    assert.equal(manager.setQuickPlayReady(second, { ready: true }).started, true);
    assert.throws(() => manager.setPlayerTeam(first, { team: 'red' }), /only be changed in the lobby/i);
  });

  it('starts Quick Play immediately when every current lobby player is ready', async () => {
    let now = 12_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;

    assert.equal(manager.toRoomState(room).quickPlayState.ready[red.id], false);
    const readyRed = manager.setQuickPlayReady(red, { ready: true });
    assert.equal(readyRed.started, false);
    assert.equal(manager.setQuickPlayReady(red, { ready: false }).started, false, 'players can cancel ready');
    manager.setQuickPlayReady(red, { ready: true });

    const lateLobbyPlayer = createClient();
    manager.quickPlay(lateLobbyPlayer);
    assert.equal(manager.toRoomState(room).quickPlayState.ready[lateLobbyPlayer.id], false);
    assert.equal(manager.setQuickPlayReady(blue, { ready: true }).started, false,
      'a newly joined player prevents the lobby from starting until ready');

    const started = manager.setQuickPlayReady(lateLobbyPlayer, { ready: true });
    assert.equal(started.started, false, 'the lobby waits for the competitive map while keeping everyone ready');
    await room.quickPlayMapPromise;
    const [readyStart] = manager.advanceGames(0);
    assert.equal(readyStart.room, room);
    assert.equal(readyStart.roomState.quickPlayState.phase, 'countdown');
    assert.equal(readyStart.match.gameplayStartsAt, now + QUICK_PLAY_COUNTDOWN_MS);
    assert.equal(readyStart.roomState.quickPlayAutoStartAt, null);
  });

  it('publishes Quick Play map-generation status and clears it when the lobby map is ready', async () => {
    const manager = new RoomManager();
    const player = createClient();
    const joined = manager.quickPlay(player);
    const room = player.room;

    assert.equal(joined.state.quickPlayMapGenerationPending, true);
    await room.quickPlayMapPromise;
    const [mapReady] = manager.advanceGames(0);

    assert.equal(mapReady.roomState.quickPlayMapGenerationPending, false);
    assert.equal(mapReady.match, null, 'map readiness alone does not start a lobby before its human is ready');
  });

  it('starts Quick Play with one ready human and fills both teams with bots', async () => {
    let now = 15_000;
    const manager = new RoomManager({ now: () => now, randomTeam: () => 0.9 });
    const onlyPlayer = createClient();
    manager.quickPlay(onlyPlayer);
    const room = onlyPlayer.room;
    await room.quickPlayMapPromise;

    assert.equal(onlyPlayer.team, 'red', 'a lone Quick Play player can randomly start on either side');
    assert.equal(onlyPlayer.squadId, 'B', 'the first player is randomly assigned to Team A or Team B');
    assert.deepEqual(manager.setQuickPlayReady(onlyPlayer, { ready: true }).started, true,
      'one human is enough when every human in the lobby is ready');
    assert.equal(room.match.players.length, TEAM_CAPACITY * 2);
    assert.deepEqual(room.match.teamRoster, { red: TEAM_CAPACITY, blue: TEAM_CAPACITY });
    assert.equal(room.match.players.filter((player) => player.isBot && player.team === 'blue').length, TEAM_CAPACITY);
  });

  it('randomizes the initial custom-match side and balanced Quick Play tie-breaks', async () => {
    const customBlueManager = new BaseRoomManager({ randomTeam: () => 0.9 });
    const customPlayer = createClient();
    await customBlueManager.createAndJoin(customPlayer, { name: 'Random Custom Side' });
    assert.equal(customBlueManager.startMatch(customPlayer).match.players[0].team, 'blue');

    const quickPlayManager = new RoomManager({ randomTeam: () => 0.9 });
    const quickPlayers = [createClient(), createClient(), createClient()];
    const quickRoomResult = quickPlayManager.quickPlay(quickPlayers[0]);
    assert.equal(quickRoomResult.room.quickPlaySquadCounts.A, 0);
    assert.equal(quickRoomResult.room.quickPlaySquadCounts.B, 1);
    assert.equal(quickRoomResult.state.quickPlaySquadRoles.A, 'blue',
      'Team A starts as either Strike or Flag according to a 50/50 roll');
    quickPlayManager.quickPlay(quickPlayers[1]);
    quickPlayManager.quickPlay(quickPlayers[2]);
    assert.deepEqual(quickPlayers.map((player) => player.team), ['red', 'blue', 'blue'],
      'new rooms randomize the first side and a balanced tie is broken randomly');
    assert.deepEqual(quickPlayers.map((player) => player.squadId), ['B', 'A', 'A']);
  });

  it('randomly seats the first Long Play player on either squad when both are empty', () => {
    const teamAFirst = new RoomManager({ randomTeam: () => 0.1 });
    const playerA = createClient();
    teamAFirst.longPlay(playerA);
    assert.equal(playerA.squadId, 'A');

    const teamBFirst = new RoomManager({ randomTeam: () => 0.9 });
    const playerB = createClient();
    teamBFirst.longPlay(playerB);
    assert.equal(playerB.squadId, 'B');
  });

  it('fills Quick Play vacancies with randomized bots, allows a late spectator takeover, then seats that human next round', async () => {
    let now = 18_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    manager.quickPlay(red);
    const room = red.room;
    await room.quickPlayMapPromise;

    const started = await readyAndStartQuickPlay(manager, room);
    const initialBots = started.match.players.filter((player) => player.isBot);
    assert.equal(initialBots.length, 9, 'every open team place is filled even when only one person joins');
    assert.deepEqual(started.match.teamRoster, { red: 5, blue: 5 });
    assert.equal(new Set(initialBots.map((bot) => bot.id)).size, 9, 'each bot uses a distinct personality identity');
    assert.equal(started.roomState.bots.roster.length, 9);

    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    const lateSpectator = createClient();
    manager.quickPlay(lateSpectator);
    assert.equal(lateSpectator.team, 'blue', 'late spectators are assigned to the less-populated team');
    assert.equal(room.match.players.some((player) => player.id === lateSpectator.id), false,
      'late joiners spectate the current round rather than spawning mid-match');
    const blueBot = room.match.players.find((player) => player.isBot && player.team === 'blue');
    const takeover = manager.setBotController(lateSpectator, { botId: blueBot.id });
    assert.equal(takeover.match.players.find((player) => player.id === blueBot.id).controlledById, lateSpectator.id);
    const command = {
      botId: blueBot.id,
      sequence: 1,
      controlRevision: blueBot.controlRevision,
      input: { up: false, down: false, left: false, right: true, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
    };
    assert.deepEqual(manager.applyBotCommands(lateSpectator, { commands: [command] }).projectiles, [],
      'a Quick Play spectator can send controls for the bot they took over');

    manager.setMatchVictory(room, { winner: 'red', reason: 'time', at: now });
    assert.equal(room.match.players.find((player) => player.id === blueBot.id).controlledById, lateSpectator.id,
      'round completion preserves the controller through the result phase');
    const resultPhaseCommand = {
      ...command,
      sequence: 2,
      controlRevision: blueBot.controlRevision,
      playerPose: { x: blueBot.x + 3, y: blueBot.y, vx: 80, vy: 0 },
    };
    assert.deepEqual(manager.applyBotCommands(lateSpectator, { commands: [resultPhaseCommand] }).projectiles, [],
      'the player can continue controlling their bot during postphase');
    await room.quickPlayMapPromise;
    now = room.quickPlayState.phaseEndsAt;
    manager.advanceGames(0);

    assert.ok(room.match.players.some((player) => player.id === lateSpectator.id),
      'the spectator is seated as a human player in the next round');
    assert.ok(room.match.players.filter((player) => player.isBot).every((player) => player.controlledById == null),
      'starting the next round clears previous bot control as players spawn as humans');
    assert.equal(room.match.players.filter((player) => player.isBot && player.team === 'blue').length, 4,
      'the newly seated Blue player replaces one of the previous round’s bots');
    assert.deepEqual(room.match.teamRoster, { red: 5, blue: 5 });
  });

  it('allows Quick Play aiming and vision updates during pre-game but blocks movement and firing', async () => {
    let now = 25_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    assert.throws(() => manager.selectWeapon(red, { weaponId: 'shotgun' }), /only be selected during the pre-game countdown/,
      'the weapon shop is unavailable in the Quick Play lobby');

    await readyAndStartQuickPlay(manager, room);
    const player = room.match.players.find((entry) => entry.id === red.id);
    const spawn = { x: player.x, y: player.y };
    manager.selectWeapon(red, { weaponId: 'shotgun' });
    assert.equal(player.selectedWeaponId, 'shotgun', 'the shop is available during the Quick Play countdown');
    assert.equal(manager.selectGadget(red, { gadgetId: 'cryo-grenade' }).players
      .find((entry) => entry.id === red.id).gadgetCount, 1,
    'Quick Play countdown offers a one-use gadget choice');
    manager.selectGadget(red, { gadgetId: 'molotov' });
    assert.equal(player.selectedGadgetId, 'molotov', 'choosing another gadget replaces the existing gadget');
    assert.deepEqual(player.gadgetCounts, {
      'smoke-grenade': 0, molotov: 1, 'cryo-grenade': 0, 'proximity-mine': 0, 'flash-grenade': 0,
      'orbital-strike': 0, 'spy-camera': 0, 'trophy-system': 0, 'vine-trap': 0,
      sonar: 0, [KATANA_ID]: 0, 'jammer-grenade': 0, 'bio-field': 0,
    });
    now += 1_000;

    assert.deepEqual(manager.updateGameAim(red, {
      type: 'assault-rifle', direction: { x: 1, y: 0 },
    }), { accepted: false }, 'a stale aim update for the previous weapon is ignored after switching');
    const aim = manager.updateGameAim(red, { direction: { x: 0, y: 1 }, visionAngle: -1.25 });
    assert.ok(aim.aimAngle > 0, 'aim rotation advances during the pre-game countdown');
    assert.equal(player.visionAngle, -1.25, 'the vision cone follows its independent angle immediately');
    assert.notEqual(player.visionAngle, aim.aimAngle, 'the vision cone is not tied to weapon slew');
    assert.throws(() => manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    }), /countdown is still in progress/);
    assert.throws(() => manager.fireProjectile(red, { direction: { x: 0, y: 1 } }), /countdown is still in progress/);

    const [snapshot] = manager.advanceGames(0.05);
    assert.equal(snapshot.match.players.find((entry) => entry.id === red.id).visionAngle, -1.25);
    assert.deepEqual({ x: player.x, y: player.y }, spawn, 'players remain at their spawn positions');

    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    assert.throws(() => manager.selectWeapon(red, { weaponId: 'sniper' }), /only be selected during the pre-game countdown/,
      'weapon selection closes when gameplay begins');
  });

  it('offers random existing unique gadgets in Quick Play when the chance hits', async () => {
    const manager = new RoomManager({ random: () => 0 });
    const player = { uniqueGadgetShopCount: 0 };

    const firstOffer = manager.prepareUniqueGadgetShopOffers(player);
    assert.equal(firstOffer, 'orbital-strike');
    assert.deepEqual(player.uniqueGadgetShopOfferIds, ['orbital-strike']);

    const randomDraws = [0, 0.99];
    const secondManager = new RoomManager({ random: () => randomDraws.shift() ?? 0 });
    const secondPlayer = { uniqueGadgetShopCount: 0 };
    assert.equal(secondManager.prepareUniqueGadgetShopOffers(secondPlayer), KATANA_ID);
    assert.deepEqual(secondPlayer.uniqueGadgetShopOfferIds, [KATANA_ID]);

    const client = createClient();
    manager.quickPlay(client);
    await readyAndStartQuickPlay(manager, client.room);
    const matchPlayer = client.room.match.players.find((entry) => entry.id === client.id);
    manager.selectGadget(client, { gadgetId: 'orbital-strike' });
    assert.equal(matchPlayer.selectedGadgetId, 'orbital-strike');
    assert.equal(matchPlayer.gadgetCount, 1);
    manager.selectGadget(client, { gadgetId: SPY_CAMERA_ID });
    assert.equal(matchPlayer.selectedGadgetId, SPY_CAMERA_ID);
    assert.equal(matchPlayer.gadgetCount, 1);
    manager.selectGadget(client, { gadgetId: SONAR_ID });
    assert.equal(matchPlayer.selectedGadgetId, SONAR_ID);
    assert.equal(matchPlayer.gadgetCount, 2);
    assert.deepEqual(client.uniqueGadgetShopOfferIds, ['orbital-strike'],
      'the unique chance offers a random unique without restricting standard loadout selection');
  });

  it('allows living players and spectators to create team pings and validates map coordinates', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Team Pings' });
    await manager.join(blue, { name: 'Team Pings' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const ping = manager.createTeamPing(red, { x: 125, y: 250 });

    assert.equal(ping.team, 'red');
    assert.deepEqual({ x: ping.x, y: ping.y }, { x: 125, y: 250 });
    assert.ok(ping.expiresAt > Date.now());
    assert.equal(Object.hasOwn(ping, 'playerId'), false, 'ping markers do not identify their source player');
    assert.throws(() => manager.createTeamPing(red, { x: -1, y: 250 }), /inside the map/);
    assert.throws(() => manager.createTeamPing(blue, { x: NaN, y: 250 }), /inside the map/);

    const bluePlayer = blue.room.match.players.find((player) => player.id === blue.id);
    bluePlayer.alive = false;
    assert.equal(manager.createTeamPing(blue, { x: 300, y: 350 }).team, 'blue',
      'eliminated players retain team ping access while spectating');
    blue.room.match.players = blue.room.match.players.filter((player) => player.id !== blue.id);
    assert.equal(manager.createTeamPing(blue, { x: 400, y: 450 }).team, 'blue',
      'late spectators outside the round player array can still ping for their assigned team');
    blue.room.match.gameplayStartsAt = Date.now() + 15_000;
    assert.equal(manager.createTeamPing(red, { x: 125, y: 250 }).team, 'red',
      'pings work during prephase');
    blue.room.match.victory = { winner: 'red', at: Date.now() };
    blue.room.match.endsAt = Date.now() - 1;
    assert.equal(manager.createTeamPing(blue, { x: 400, y: 450 }).team, 'blue',
      'pings work during postphase after victory or timeout');
  });

  it('keeps living players in the shared free-roam mode through a custom-match postgame', async () => {
    let now = 30_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Custom Postgame Roam' });
    await manager.join(blue, { name: 'Custom Postgame Roam' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const room = red.room;
    const player = room.match.players.find((entry) => entry.id === red.id);
    const startingX = player.x;
    room.match.map.objects = [];

    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    assert.equal(manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true, drop: true, weaponLean: -1 },
    }).accepted, true);
    room.match.flag.heldBy = red.id;
    room.match.flag.x = player.x;
    room.match.flag.y = player.y;
    assert.equal(manager.updateGameAim(red, { direction: { x: 1, y: 0 } }).aimAngle, 0);
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, true);
    assert.equal(manager.beginWeaponReload(red).accepted, true);

    const [update] = manager.advanceGames(0.05);
    assert.ok(player.x > startingX, 'living players continue moving after a custom match ends');
    assert.equal(player.weaponLean, -1, 'weapon lean remains active after a custom match ends');
    assert.equal(player.input.drop, false, 'postgame input cannot drop the flag');
    assert.equal(room.match.flag.heldBy, red.id, 'postgame movement cannot interact with the held flag');
    assert.equal(room.match.flag.x, startingX, 'the held flag remains frozen during free roam');
    assert.ok(player.weaponStats['assault-rifle'].reloading, 'reloads can start in a custom-match postgame');
    assert.ok(update.match.players.find((entry) => entry.id === red.id).x > startingX,
      'postgame movement is published in snapshots');

    now = room.postGame.endsAt;
    assert.throws(() => manager.updateGameInput(red, {
      sequence: 2,
      input: { up: false, down: false, left: false, right: true },
    }), /There is no active match/);
  });

  it('keeps living Quick Play players in the shared free-roam mode during the final series report', async () => {
    let now = 35_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.longPlay(red);
    manager.longPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;

    await readyAndStartLongPlay(manager, room);
    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    room.quickPlayScoreBySquad.A = 3;
    const player = room.match.players.find((entry) => entry.id === red.id);
    const startingX = player.x;
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    assert.equal(room.quickPlayState.phase, 'series-report');
    assert.equal(manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    }).accepted, true);
    assert.equal(manager.updateGameAim(red, { direction: { x: 1, y: 0 } }).aimAngle, 0);
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, true,
      'living players can still shoot during the final series report');
    assert.equal(manager.beginWeaponReload(red).accepted, true,
      'living players can still reload during the final series report');

    const [update] = manager.advanceGames(0.05);
    assert.ok(player.x > startingX, 'living players can move through the final series report');
    assert.ok(update.match.players.find((entry) => entry.id === red.id).x > startingX,
      'final-report movement is published in snapshots');

    now = room.quickPlayState.phaseEndsAt;
    assert.throws(() => manager.updateGameInput(red, {
      sequence: 2,
      input: { up: false, down: false, left: false, right: true },
    }), /There is no active match/);
  });

  it('returns an immediate compact result snapshot when a Quick Play shot eliminates a team', async () => {
    let now = 40_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;

    await readyAndStartQuickPlay(manager, room);
    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    room.match.map.objects = [];
    const shooter = room.match.players.find((player) => player.id === red.id);
    const target = room.match.players.find((player) => player.id === blue.id);
    for (const bot of room.match.players) {
      if (bot.isBot && bot.team === 'blue') {
        bot.alive = false;
        bot.health = 0;
      }
    }
    Object.assign(shooter, { x: 200, y: 200 });
    Object.assign(target, { x: 250, y: 200, health: 1 });

    const result = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
    assert.equal(result.accepted, true);
    assert.equal(result.matchEnded, true);
    assert.equal(result.match.victory.winner, 'red');
    assert.equal(result.match.quickPlayState.phase, 'round-result');
    assert.equal('map' in result.match, false, 'the urgent terminal snapshot stays compact');
    assert.equal(room.match.players.find((player) => player.id === blue.id).alive, false);
  });

  it('localizes enemy shots for the closest unflashed listener with a displaced circle containing the source', () => {
    const manager = new RoomManager({ now: () => 5000, random: () => 0 });
    const shooter = { id: 'red-shooter', team: 'red' };
    const closest = { id: 'blue-near', team: 'blue', alive: true, health: 100, x: 100, y: 0, flashUntil: 6_000 };
    const farther = { id: 'blue-far', team: 'blue', alive: true, health: 100, x: 500, y: 0 };
    const deadClosest = { id: 'blue-dead', team: 'blue', alive: false, health: 0, x: 1, y: 0 };
    const sameTeam = { id: 'red-near', team: 'red', alive: true, health: 100, x: 2, y: 0 };
    const map = { width: 1000, height: 1000, objects: [] };
    const match = { map, players: [shooter, closest, farther, deadClosest, sameTeam] };
    const [cue] = manager.createShotAudioCues(match, shooter, { x: 0, y: 0 });

    assert.equal(cue.team, 'blue', 'only the closest enemy team receives the cue');
    assert.equal(cue.radius, 150, 'a flashed closest listener cannot provide audio intel');
    assert.ok(cue.x > 0, 'the estimated center is deliberately displaced');
    assert.ok(Math.hypot(cue.x, cue.y) <= cue.radius, 'the true sound source remains inside the uncertainty circle');
    assert.equal(cue.expiresAt, 7_400);
    assert.deepEqual(manager.createShotAudioCues(match, shooter, { x: 1, y: 0 }), [],
      'rapid repeat shots do not stack overlapping cues');
    assert.deepEqual(manager.createShotAudioCues({ map, players: [shooter] }, shooter, { x: 0, y: 0 }), []);

    const sourceVisibleManager = new RoomManager({ now: () => 5000, random: () => 0 });
    const visibleListener = {
      id: 'blue-looking-at-source', team: 'blue', alive: true, health: 100,
      x: 100, y: 0, visionAngle: Math.PI, weaponLean: 0,
    };
    assert.deepEqual(sourceVisibleManager.createShotAudioCues({
      map: { width: 1000, height: 1000, objects: [] }, players: [shooter, visibleListener],
    }, shooter, { x: 0, y: 0 }), [], 'team-visible shots do not create redundant sound cues');
  });

  it('attaches an audio cue to an enemy shot when the opposing team cannot see its source', async () => {
    const manager = new RoomManager({ random: () => 0 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Unseen Gunshot' });
    await manager.join(blue, { name: 'Unseen Gunshot' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const listener = match.players.find((player) => player.id === blue.id);
    Object.assign(shooter, { x: 200, y: 200 });
    Object.assign(listener, { x: 600, y: 600, visionAngle: 0 });

    const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });

    assert.ok(shot.audioCue);
    assert.equal(shot.audioCue.kind, 'gunshot');
    assert.equal(shot.audioCue.team, 'blue');
    assert.ok(Math.hypot(shot.audioCue.x - shot.projectile.start.x,
      shot.audioCue.y - shot.projectile.start.y) <= shot.audioCue.radius);
  });

  it('lets teammates hear unseen jammed gunfire while preserving team and personal cue scopes', async () => {
    let now = 5_000;
    const manager = new RoomManager({ now: () => now, random: () => 0 });
    const shooterClient = createClient();
    const teammateClient = createClient();
    const enemyClient = createClient();
    await manager.createAndJoin(shooterClient, { name: 'Jammed Teammate Gunfire' });
    await manager.join(teammateClient, { name: 'Jammed Teammate Gunfire' });
    await manager.join(enemyClient, { name: 'Jammed Teammate Gunfire' });
    manager.setPlayerTeam(shooterClient, { team: 'red' });
    manager.setPlayerTeam(teammateClient, { team: 'red' });
    manager.setPlayerTeam(enemyClient, { team: 'blue' });
    startGameplay(manager, shooterClient);
    const match = shooterClient.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === shooterClient.id);
    const teammate = match.players.find((player) => player.id === teammateClient.id);
    const enemy = match.players.find((player) => player.id === enemyClient.id);
    Object.assign(shooter, { x: 200, y: 200, jammedUntil: now + 1_000 });
    Object.assign(teammate, { x: 600, y: 600, visionAngle: 0 });
    Object.assign(enemy, { x: 700, y: 600, visionAngle: 0 });

    const shot = manager.fireProjectile(shooterClient, { direction: { x: 1, y: 0 } });

    assert.deepEqual(shot.audioCues.map((cue) => cue.team), ['blue', 'red']);
    const allyCue = shot.audioCues.find((cue) => cue.team === 'red');
    assert.equal(allyCue.kind, 'gunshot');
    assert.equal(allyCue.heardById, teammate.id);
    assert.equal(allyCue.audiencePlayerId, undefined);
    assert.equal(allyCue.sourceId, undefined);
    assert.ok(Math.hypot(allyCue.x - shot.projectile.start.x,
      allyCue.y - shot.projectile.start.y) <= allyCue.radius);

    teammate.jammedUntil = now + 1_000;
    delete enemy.jammedUntil;
    now += 700;
    const secondShot = manager.fireProjectile(shooterClient, { direction: { x: 1, y: 0 } });
    assert.ok(secondShot.accepted);
    const personalCue = match.botNoises.find((cue) =>
      cue.kind === 'gunshot' && cue.team === 'red' && cue.audiencePlayerId === teammateClient.id);
    assert.ok(personalCue, 'jammed listeners retain a personal cue for nearby teammate gunfire');
  });

  it('stores discovered cells as shared team intel and returns only newly revealed spans', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Shared Team Intel' });
    await manager.join(blue, { name: 'Shared Team Intel' });
    manager.startMatch(red);

    assert.deepEqual(manager.revealTeamIntel(red, { spans: [0, 5, 10, 15] }), [0, 5, 10, 15]);
    assert.deepEqual(manager.revealTeamIntel(red, { spans: [0, 5, 10, 15] }), [], 'repeated intel deltas are deduplicated');
    assert.deepEqual(manager.getTeamIntelSpans(red), [0, 5, 10, 15]);
    assert.deepEqual(manager.getTeamIntelSpans(blue), []);
    assert.throws(() => manager.revealTeamIntel(red, { spans: [0, 999_999] }), /invalid cell range/);
  });

  it('persists discovered enemy corpses as team intel and rejects living or friendly players', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const redTeammate = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Shared Corpse Intel' });
    await manager.join(redTeammate, { name: 'Shared Corpse Intel' });
    await manager.join(blue, { name: 'Shared Corpse Intel' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(redTeammate, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    manager.startMatch(red);

    const match = red.room.match;
    const deadEnemy = match.players.find((player) => player.id === blue.id);
    deadEnemy.health = 0;
    deadEnemy.alive = false;

    assert.equal(manager.discoverTeamCorpse(red, { playerId: deadEnemy.id }), true);
    assert.equal(manager.discoverTeamCorpse(red, { playerId: deadEnemy.id }), false,
      'already known corpses do not generate duplicate discoveries');
    assert.deepEqual(manager.getTeamCorpseIds(red), [deadEnemy.id]);
    assert.deepEqual(manager.getTeamCorpseIds(redTeammate), [deadEnemy.id],
      'teammates receive the same persistent corpse intel');
    assert.deepEqual(manager.getTeamCorpseIds(blue), [], 'corpse intel is not shared with the opposing team');
    assert.equal(manager.discoverTeamCorpse(red, { playerId: redTeammate.id }), false,
      'friendly players are not enemy corpses');
    assert.equal(manager.discoverTeamCorpse(red, { playerId: 'unknown-player' }), false);
  });

  it('runs Practice indefinitely, seats late joiners next round, and preserves the same lobby', async () => {
    let now = 50_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    const firstJoin = manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;

    let update = await readyAndStartQuickPlay(manager, room);
    assert.equal(update.room, room);
    assert.equal(update.roomState.quickPlayState.phase, 'countdown');
    assert.equal(update.match.gameplayStartsAt, now + QUICK_PLAY_COUNTDOWN_MS);
    assert.equal(update.match.players.length, 10, 'Quick Play fills unoccupied team places with bots');
    assert.ok(update.roomState.match.map, 'players can inspect the map during pre-game');
    const firstMapSeed = room.match.map.seed;
    assertCompetitiveMap(room.match.map);
    const redPlayerFirstRound = room.match.players.find((player) => player.id === red.id);
    const bluePlayerFirstRound = room.match.players.find((player) => player.id === blue.id);
    assert.equal(redPlayerFirstRound.team, 'red');
    assert.equal(bluePlayerFirstRound.team, 'blue');
    assert.equal(redPlayerFirstRound.squadId, 'A');
    assert.equal(bluePlayerFirstRound.squadId, 'B');
    assert.ok(redPlayerFirstRound.x < room.match.map.width / 2);
    assert.ok(bluePlayerFirstRound.x > room.match.map.width / 2);
    manager.selectGadget(red, { gadgetId: CRYO_GRENADE_ID });
    red.gadgetCount = 0;
    red.gadgetCounts[CRYO_GRENADE_ID] = 0;
    redPlayerFirstRound.gadgetCount = 0;
    redPlayerFirstRound.gadgetCounts[CRYO_GRENADE_ID] = 0;

    const lateJoiner = createClient();
    manager.quickPlay(lateJoiner);
    assert.ok(['red', 'blue'].includes(lateJoiner.team));
    assert.equal(room.match.players.some((player) => player.id === lateJoiner.id), false);
    const roomListJoiner = createClient();
    await manager.join(roomListJoiner, { name: room.name });
    assert.ok(['red', 'blue'].includes(roomListJoiner.team));
    assert.equal(room.match.players.some((player) => player.id === roomListJoiner.id), false);

    const winRound = async (winner) => {
      now = room.match.gameplayStartsAt;
      manager.advanceGames(0);
      manager.setMatchVictory(room, { winner, reason: 'capture', at: now });
      if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
      return manager.toRoomState(room).quickPlayState;
    };

    let series = await winRound('red');
    assert.equal(series.phase, 'round-result');
    assert.deepEqual(series.score, { red: 1, blue: 0 }, 'the result retains the roles and score from the completed round');
    assert.deepEqual(series.nextRoundScore, { blue: 1, red: 0 },
      'the next round score is projected onto the rotated team roles');
    assert.equal(series.mapGenerationRevision, room.mapGenerationRevision,
      'the result state carries the revision used to generate the next map');
    assert.deepEqual(series.lastResult.score, { red: 1, blue: 0 });
    assert.equal(series.lastResult.winner, 'red', 'the round winner is labeled by the role it played when the round ended');
    assert.equal(series.lastResult.winnerSquadId, 'A');
    assert.equal(series.lastResult.score.red, 1);
    assert.equal(series.lastResult.score.blue, 0);
    assert.equal(red.team, 'blue', 'the Strike Team switches to Flag Team for the next round');
    assert.equal(blue.team, 'red', 'the Flag Team switches to Strike Team for the next round');
    const redPlayer = room.match.players.find((player) => player.id === red.id);
    const postGameStartX = redPlayer.x;
    const postGameStartY = redPlayer.y;
    const moveResult = manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    assert.equal(moveResult.accepted, true, 'players can still move during the result phase');
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, true,
      'players can still fire during the result phase');
    now += 50;
    [update] = manager.advanceGames(0.05);
    assert.ok(redPlayer.x > postGameStartX || redPlayer.y !== postGameStartY,
      'postgame movement is simulated and included in snapshots');
    assert.equal(update.match.victory.reason, 'capture', 'the completed round result remains fixed');
    now = series.phaseEndsAt;
    [update] = manager.advanceGames(0);
    assert.equal(update.roomState.quickPlayState.round, 2);
    assert.equal(update.roomState.quickPlayState.phase, 'countdown');
    assert.equal(update.match.players.length, 10, 'late joiners are included in the next round alongside fewer bots');
    assert.notEqual(room.match.map.seed, firstMapSeed, 'each match uses a different generated map');
    assertCompetitiveMap(room.match.map);
    assert.equal(getLeftSiteTeam(room.match.map), 'blue', 'the teams exchange left/right sides after round one');
    assertTeamsOccupyTheirSites(room.match);
    const redPlayerSecondRound = room.match.players.find((player) => player.id === red.id);
    const bluePlayerSecondRound = room.match.players.find((player) => player.id === blue.id);
    assert.equal(redPlayerSecondRound.selectedGadgetId, CRYO_GRENADE_ID,
      'Quick Play carries forward the player’s last gadget choice');
    assert.equal(redPlayerSecondRound.gadgetCount, 1,
      'the carried-forward gadget is replenished for the new round');
    assert.equal(redPlayerSecondRound.gadgetCounts[CRYO_GRENADE_ID], 1);
    assert.equal(redPlayerSecondRound.team, 'blue');
    assert.equal(bluePlayerSecondRound.team, 'red');
    assert.equal(redPlayerSecondRound.squadId, 'A');
    assert.equal(bluePlayerSecondRound.squadId, 'B');
    assert.deepEqual(update.roomState.quickPlayState.score, { red: 0, blue: 1 },
      'the live score is projected onto the roles for the newly started round');
    assert.ok(redPlayerSecondRound.x < room.match.map.width / 2, 'the original Strike squad stays on the left while playing Flag Team');
    assert.ok(bluePlayerSecondRound.x > room.match.map.width / 2, 'the original Flag squad stays on the right while playing Strike Team');

    series = await winRound('red');
    assert.equal(series.phase, 'round-result');
    assert.deepEqual(series.score, { red: 1, blue: 1 });
    assert.equal(series.lastResult.winner, 'red', 'result roles are not prematurely flipped');
    assert.deepEqual(series.lastResult.score, { red: 1, blue: 1 });
    now += QUICK_PLAY_RESULT_MS;
    [update] = manager.advanceGames(0);
    assert.equal(update.roomState.quickPlayState.round, 3);
    assert.equal(update.match.players.length, 10);
    assert.equal(getLeftSiteTeam(room.match.map), 'red', 'the teams switch back after round two');
    assertTeamsOccupyTheirSites(room.match);
    const redPlayerThirdRound = room.match.players.find((player) => player.id === red.id);
    const bluePlayerThirdRound = room.match.players.find((player) => player.id === blue.id);
    assert.equal(redPlayerThirdRound.team, 'red');
    assert.equal(bluePlayerThirdRound.team, 'blue');
    assert.ok(redPlayerThirdRound.x < room.match.map.width / 2, 'the original Strike squad remains on the left');
    assert.ok(bluePlayerThirdRound.x > room.match.map.width / 2, 'the original Flag squad remains on the right');

    series = await winRound('red');
    assert.equal(series.phase, 'round-result', 'reaching two wins does not end endless Practice');
    assert.equal(series.winner, null);
    assert.equal(series.winnerSquadId, null);
    assert.deepEqual(series.score, { red: 2, blue: 1 }, 'the round score keeps accumulating without ending Practice');
    assert.equal(series.lastResult.winner, 'red', 'the result still names the winner by the role used in round three');
    assert.deepEqual(room.quickPlayScoreBySquad, { A: 2, B: 1 }, 'the cumulative score belongs to stable squads');
    assert.equal(room.match.quickPlayState.phase, 'round-result');
    assert.ok(manager.toRoomState(room).match.map, 'the map remains available during the round result');
    assert.equal(room.quickPlayUsedMapFingerprints.size, 3);
    now = series.phaseEndsAt;
    [update] = manager.advanceGames(0);
    assert.equal(update.room, room, 'the same Practice room continues');
    assert.equal(update.roomState.quickPlayState.round, 4);
    assert.equal(update.roomState.quickPlayState.phase, 'countdown');
    assert.deepEqual(update.roomState.quickPlayState.squadScore, { A: 2, B: 1 });
    assert.equal(room.clients.size, 4, 'players remain in the same endless Practice lobby');
    assert.equal(firstJoin.room.name, room.name);
    if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
    assert.equal(room.quickPlayUsedMapFingerprints.size, 4, 'map history persists across rounds');
    assert.ok(room.match.map, 'the next round is already using its generated map');
    assertTeamsOccupyTheirSites(room.match);
  });

  it('rerolls every Practice bot weapon and gadget loadout for each succeeding match', async () => {
    let now = 55_000;
    let randomValue = 0;
    let randomCalls = 0;
    const manager = new RoomManager({
      now: () => now,
      random: () => {
        randomCalls += 1;
        return randomValue;
      },
    });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;

    await readyAndStartQuickPlay(manager, room);
    const getBotLoadouts = () => new Map(room.match.players
      .filter((player) => player.isBot)
      .map((bot) => [bot.id, { weapon: bot.selectedWeaponId, gadget: bot.selectedGadgetId }]));
    const firstLoadouts = getBotLoadouts();
    assert.ok(firstLoadouts.size > 0);

    const finishRoundAndStartNext = async () => {
      now = room.match.gameplayStartsAt;
      manager.advanceGames(0);
      manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
      if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
      now = room.quickPlayState.phaseEndsAt;
      manager.advanceGames(0);
    };

    randomCalls = 0;
    randomValue = 0.999999;
    await finishRoundAndStartNext();
    const secondLoadouts = getBotLoadouts();
    assert.ok(randomCalls >= firstLoadouts.size * 2,
      'every existing bot draws a fresh weapon and gadget for round two');
    for (const [botId, loadout] of firstLoadouts) {
      assert.notEqual(secondLoadouts.get(botId).weapon, loadout.weapon,
        `bot ${botId} should reroll its weapon for round two`);
      assert.notEqual(secondLoadouts.get(botId).gadget, loadout.gadget,
        `bot ${botId} should reroll its gadget for round two`);
    }

    randomCalls = 0;
    randomValue = 0;
    await finishRoundAndStartNext();
    const thirdLoadouts = getBotLoadouts();
    assert.ok(randomCalls >= firstLoadouts.size * 2,
      'every existing bot draws a fresh weapon and gadget for round three');
    for (const [botId, loadout] of secondLoadouts) {
      assert.notEqual(thirdLoadouts.get(botId).weapon, loadout.weapon,
        `bot ${botId} should reroll its weapon for round three`);
      assert.notEqual(thirdLoadouts.get(botId).gadget, loadout.gadget,
        `bot ${botId} should reroll its gadget for round three`);
    }
  });

  it('runs Quick Play to four wins and swaps roles only after every two matches', async () => {
    let now = 125_000;
    const manager = new RoomManager({ now: () => now });
    const longRed = createClient();
    const longBlue = createClient();
    const longEntry = manager.longPlay(longRed);
    manager.longPlay(longBlue);
    const room = longRed.room;
    assert.equal(longEntry.room.name, 'Quick Play 1');
    assert.equal(longEntry.room.gameMode, 'longplay');
    assert.equal(longEntry.state.gameModeLabel, 'Quick Play');

    const quickClient = createClient();
    manager.quickPlay(quickClient);
    assert.equal(quickClient.room.name, 'Practice 1');
    assert.notEqual(quickClient.room, room, 'Practice and Quick Play never share matchmaking rooms');
    assert.equal(room.gameMode, 'longplay');
    assert.equal(longEntry.state.gameMode, 'longplay');
    assert.equal(longEntry.state.quickPlayState.winsToWin, 4);
    assert.equal(longEntry.state.quickPlayState.roleSwapEvery, 2);

    await room.quickPlayMapPromise;
    let update = await readyAndStartLongPlay(manager, room);
    assert.equal(update.match.players.length, 10, 'Long Play fills vacant squad places with bots');
    assert.equal(update.roomState.quickPlayState.phase, 'countdown');
    assert.equal(update.roomState.quickPlayState.gameMode, 'longplay');
    const originalRole = room.quickPlayRoleBySquad.A;
    assert.equal(getLeftSiteTeam(room.match.map), originalRole);

    for (let round = 1; round <= 4; round += 1) {
      now = room.match.gameplayStartsAt;
      manager.advanceGames(0);
      const winningTeam = room.quickPlayRoleBySquad.A;
      manager.setMatchVictory(room, { winner: winningTeam, reason: 'capture', at: now });
      if (room.quickPlayMapPromise) await room.quickPlayMapPromise;
      const series = room.quickPlayState;
      assert.equal(series.lastResult.round, round);
      assert.equal(series.lastResult.winnerSquadId, 'A');
      assert.equal(room.quickPlayScoreBySquad.A, round);
      const rolesShouldBeSwapped = Math.floor(round / 2) % 2 === 1;
      const expectedRole = rolesShouldBeSwapped
        ? (originalRole === 'red' ? 'blue' : 'red') : originalRole;
      assert.equal(room.quickPlayRoleBySquad.A, expectedRole,
        `squad roles should change only at each two-match boundary (after round ${round})`);

      if (round < 4) {
        assert.equal(series.phase, 'round-result');
        now = series.phaseEndsAt;
        [update] = manager.advanceGames(0);
        assert.equal(update.roomState.quickPlayState.round, round + 1);
        assert.equal(getLeftSiteTeam(room.match.map), expectedRole,
          `the map sides and squad roles should agree at the start of round ${round + 1}`);
      } else {
        assert.equal(series.phase, 'series-report');
        assert.equal(series.winnerSquadId, 'A');
        assert.equal(series.winsToWin, 4);
        assert.deepEqual(room.quickPlayScoreBySquad, { A: 4, B: 0 });
      }
    }
  });

  it('creates Long Play with the Quick Play shop and a ten-win, five-round side-swap series', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    const entry = manager.longSeries(red);
    manager.longSeries(blue);
    const room = red.room;

    assert.equal(entry.room.name, 'Long Play 1');
    assert.equal(entry.room.gameMode, 'longseries');
    assert.equal(entry.state.gameModeLabel, 'Long Play');
    assert.equal(entry.state.quickPlayState.winsToWin, 10);
    assert.equal(entry.state.quickPlayState.roleSwapEvery, 5);

    await room.quickPlayMapPromise;
    await readyAndStartLongPlay(manager, room);
    const player = room.match.players.find((matchPlayer) => matchPlayer.id === red.id);
    assert.deepEqual(player.inventoryWeaponIds, ['classic-pistol']);
    assert.equal(
      player.weaponShopOfferIds.length + player.itemShopOfferIds.length + player.gadgetShopOfferIds.length,
      6,
      'Long Play opens with the same six-choice shop as Quick Play',
    );
    assert.equal(player.shopPicksRemaining, 2);
  });

  it('keeps Team A on the left when its randomized starting role is Flag Team', async () => {
    const manager = new RoomManager({ randomTeam: () => 0.99 });
    const player = createClient();
    manager.longPlay(player);
    const room = player.room;
    await room.quickPlayMapPromise;
    assert.equal(room.quickPlayRoleBySquad.A, 'blue');
    const started = await readyAndStartLongPlay(manager, room);
    assert.equal(getLeftSiteTeam(started.match.map), 'blue',
      'the map mirrors as needed so Team A always holds the left spawn');
    assert.deepEqual(started.roomState.quickPlaySquadScore, { A: 0, B: 0 });
  });

  it('gives Long Play players persistent inventories and one private shop choice each round', async () => {
    let now = 135_000;
    const manager = new RoomManager({ now: () => now, random: () => 0 });
    const botPurchases = new Map();
    const purchaseLongPlayBotShopOffer = manager.purchaseLongPlayBotShopOffer.bind(manager);
    manager.purchaseLongPlayBotShopOffer = (bot, offer) => {
      const purchased = purchaseLongPlayBotShopOffer(bot, offer);
      if (purchased) botPurchases.set(bot.id, (botPurchases.get(bot.id) ?? 0) + 1);
      return purchased;
    };
    const red = createClient();
    const blue = createClient();
    manager.longPlay(red);
    manager.longPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;

    assert.equal(red.selectedWeaponId, 'classic-pistol');
    assert.deepEqual(red.inventoryWeaponIds, ['classic-pistol']);
    assert.equal(red.selectedGadgetId, null);
    assert.equal(red.gadgetCount, 0);
    const update = await readyAndStartLongPlay(manager, room);
    assert.equal(update.roomState.quickPlayState.phase, 'countdown',
      'bot shop purchases happen when the Long Play prephase opens');

    const redPlayer = room.match.players.find((player) => player.id === red.id);
    const bluePlayer = room.match.players.find((player) => player.id === blue.id);
    assert.equal(redPlayer.weaponShopOfferIds.length + redPlayer.itemShopOfferIds.length + redPlayer.gadgetShopOfferIds.length, 6,
      'the opening shop offers six choices');
    assert.equal(redPlayer.gadgetShopOfferIds.length, 1, 'each Long Play phase guarantees one gadget offer');
    assert.equal(red.uniqueGadgetShopCount, 1, 'the first player shop opens at the one-percent unique-offer tier');
    assert.deepEqual(red.uniqueGadgetShopOfferIds, ['orbital-strike'],
      'the unique-offer chance can draw Orbital Strike in the Quick Play shop');
    assert.ok(redPlayer.gadgetShopOfferIds.includes(red.uniqueGadgetShopOfferIds[0]),
      'Long Play places a drawn unique gadget into the actual shop offer list');
    assert.ok(redPlayer.gadgetShopOfferIds.every((id) => Object.hasOwn(GADGET_DEFINITIONS, id)));
    assert.equal(new Set(redPlayer.weaponShopOfferIds).size, redPlayer.weaponShopOfferIds.length);
    assert.ok(redPlayer.weaponShopOfferIds.every((weaponId) =>
      ['battle-pistol', 'revolver', 'machine-pistol', 'pocket-shotgun'].includes(weaponId)),
      'the opening shop only includes non-classic pistols');
    assert.equal(redPlayer.itemShopOfferIds.filter((offer) => offer.kind === 'armor').length, 1,
      'the opening shop reserves an offer for level-one armor');
    assert.ok(redPlayer.itemShopOfferIds.filter((offer) => offer.kind === 'perk')
      .every((offer) => offer.level === 1), 'the opening shop only includes level-one perks');
    assert.equal(redPlayer.weaponShopOfferIds.length, 1, 'one opening slot is allocated to weapons in this draw');
    assert.equal(bluePlayer.weaponShopOfferIds.length + bluePlayer.itemShopOfferIds.length + bluePlayer.gadgetShopOfferIds.length, 6);
    assert.equal(redPlayer.shopPicksRemaining, 2);
    assert.deepEqual(redPlayer.inventoryWeaponIds, ['classic-pistol']);
    assert.deepEqual(redPlayer.inventory, { armor: null, perks: [] });
    assert.equal(redPlayer.armor, 0, 'Long Play starts without armor');
    assert.deepEqual(update.roomState.players.find((player) => player.id === red.id).inventory,
      { armor: null, perks: [] }, 'public player data includes empty item inventory slots');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => bot.inventoryWeaponIds.length === 1 && bot.inventoryWeaponIds[0] === bot.selectedWeaponId),
    'each bot equips exactly one weapon after its shop choice');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => bot.weaponShopResolved && bot.shopPicksRemaining === 0 &&
        bot.weaponShopOfferIds.length === 0 && bot.itemShopOfferIds.length === 0 && bot.gadgetShopOfferIds.length === 0),
    'bots spend their shop picks and close their shops during prephase');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => botPurchases.get(bot.id) === 2),
    'every bot completes both opening-round purchases');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .some((bot) => bot.inventory.perks.length > 0),
    'weighted shop choices can select available perks');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => Object.values(bot.gadgetCounts ?? {}).every((count) => count <= 1)),
    'bots carry at most one use of their single selected gadget');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => bot.uniqueGadgetShopOfferIds.length === 0),
    'bots are never offered unique gadgets');

    const chosenWeaponId = redPlayer.weaponShopOfferIds[0];
    const purchaseState = manager.selectWeapon(red, { weaponId: chosenWeaponId });
    assert.deepEqual(red.inventoryWeaponIds, [chosenWeaponId], 'a purchase replaces the previous weapon');
    assert.equal(redPlayer.selectedWeaponId, chosenWeaponId);
    assert.equal(redPlayer.shopPicksRemaining, 1, 'the first pick leaves one opening-round choice');
    assert.equal(redPlayer.weaponShopOfferIds.length + redPlayer.itemShopOfferIds.length + redPlayer.gadgetShopOfferIds.length, 5,
      'the chosen offer is removed while other options remain available');
    const chosenItem = redPlayer.itemShopOfferIds[0];
    manager.selectShopItem(red, { itemId: chosenItem.id, level: chosenItem.level, kind: chosenItem.kind });
    assert.equal(redPlayer.shopPicksRemaining, 0, 'the second opening-round choice closes the shop');
    assert.equal(redPlayer.weaponShopOfferIds.length + redPlayer.itemShopOfferIds.length + redPlayer.gadgetShopOfferIds.length, 0);
    assert.deepEqual(redPlayer.inventory, red.inventory, 'purchased perks are carried into match player state');
    assert.deepEqual(purchaseState.players.find((player) => player.id === red.id).inventory,
      { armor: null, perks: [] }, 'public room state contains the inventory before the second pick');
    assert.throws(() => manager.selectWeapon(red, { weaponId: 'smg' }), /not in your shop/,
      'selection is rejected after using both picks');
    manager.skipWeaponShop(blue);
    assert.deepEqual(blue.inventoryWeaponIds, ['classic-pistol'], 'skipping does not add an offer');
    assert.equal(blue.weaponShopResolved, true);
    assert.equal(blue.shopPicksRemaining, 2, 'skipping banks both unused picks');
    assert.equal(bluePlayer.shopPicksRemaining, 2, 'the match snapshot retains the banked picks');

    botPurchases.clear();
    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    manager.setMatchVictory(room, { winner: room.quickPlayRoleBySquad.A, reason: 'capture', at: now });
    await room.quickPlayMapPromise;
    now = room.quickPlayState.phaseEndsAt;
    manager.advanceGames(0);

    const nextRed = room.match.players.find((player) => player.id === red.id);
    const nextBlue = room.match.players.find((player) => player.id === blue.id);
    assert.equal(room.quickPlayState.round, 2);
    assert.deepEqual(nextRed.inventoryWeaponIds, [chosenWeaponId]);
    assert.deepEqual(nextRed.inventory, red.inventory, 'armor and perks persist into the next match');
    assert.equal(nextRed.weaponShopOfferIds.length + nextRed.itemShopOfferIds.length + nextRed.gadgetShopOfferIds.length, 5);
    assert.equal(nextRed.gadgetShopOfferIds.length, 1, 'the next Long Play phase also guarantees a gadget offer');
    assert.equal(nextRed.shopPicksRemaining, 1);
    assert.equal(nextBlue.shopPicksRemaining, 3, 'unused picks are added to the next round allowance');
    assert.ok(!nextRed.weaponShopOfferIds.includes('classic-pistol'));
    assert.ok(nextRed.weaponShopOfferIds.every((weaponId) => !nextRed.inventoryWeaponIds.includes(weaponId)),
      'later offers never repeat an owned weapon');
    assert.equal(nextBlue.weaponShopOfferIds.length + nextBlue.itemShopOfferIds.length + nextBlue.gadgetShopOfferIds.length, 5);
    assert.ok(nextBlue.weaponShopOfferIds.every((weaponId) => !nextBlue.inventoryWeaponIds.includes(weaponId)));
    assert.equal(nextRed.selectedWeaponId, chosenWeaponId, 'the equipped weapon persists when the shop is skipped');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => bot.weaponShopResolved && bot.shopPicksRemaining === 0),
    'bots make their next round purchases in the new prephase before gameplay resumes');
    assert.ok(room.match.players.filter((player) => player.isBot)
      .every((bot) => botPurchases.get(bot.id) === 1),
    'every bot completes its one purchase in later rounds');
  });

  it('publishes Long Play bot shop purchases in host-authoritative matches', async () => {
    const manager = new RoomManager({ simulationMode: 'host-authoritative', random: () => 0 });
    const host = createClient();
    manager.longPlay(host);
    const room = host.room;
    manager.acceptHostMap(host, {
      map: createQuickPlayMapFixture().map,
      quickPlay: true,
      generationRevision: room.mapGenerationRevision,
    });
    await readyAndStartLongPlay(manager, room);

    const bots = room.match.players.filter((player) => player.isBot);
    assert.ok(bots.length > 0);
    assert.equal(room.quickPlayBotRoster.length, bots.length,
      'the purchased bot roster is retained for room state and later rounds');
    assert.ok(bots.every((bot) => bot.weaponShopResolved && bot.shopPicksRemaining === 0),
      'all Long Play bot shop picks are completed before the countdown');
    for (const bot of bots) {
      const rosterBot = room.quickPlayBotRoster.find((entry) => entry.id === bot.id);
      assert.ok(rosterBot, 'each match bot has a retained roster entry');
      assert.equal(bot.selectedWeaponId, rosterBot.selectedWeaponId);
      assert.deepEqual(bot.inventory, rosterBot.inventory);
      assert.deepEqual(bot.inventoryWeaponIds, rosterBot.inventoryWeaponIds);
      assert.equal(bot.shopPicksRemaining, 0);
    }
    assert.ok(manager.toRoomState(room).bots.roster.every((bot) => bot.weaponShopResolved),
      'public room state exposes bots after their purchases');
  });

  it('replaces a Long Play bot pistol when a non-pistol weapon is offered', () => {
    const manager = new RoomManager({ random: () => 0 });
    const bot = {
      selectedWeaponId: 'revolver',
      inventoryWeaponIds: ['revolver'],
      weaponShopOfferIds: ['heavy-sniper', 'machine-pistol'],
      itemShopOfferIds: [],
      shopPicksRemaining: 1,
    };

    manager.chooseLongPlayBotShopOffers(bot);

    assert.equal(bot.selectedWeaponId, 'heavy-sniper');
    assert.deepEqual(bot.inventoryWeaponIds, ['heavy-sniper']);
  });

  it('weights preferred Long Play gadget upgrades while keeping choices semi-random', () => {
    const createBot = (selectedGadgetId, gadgetPreferenceOrder = []) => ({
      selectedWeaponId: 'classic-pistol',
      inventoryWeaponIds: ['classic-pistol'],
      selectedGadgetId,
      gadgetPreferenceOrder,
      gadgetCount: selectedGadgetId ? 1 : 0,
      inventory: { armor: null, perks: [] },
      itemShopOfferIds: [{ kind: 'perk', id: 'extended-mag', level: 1 }],
      weaponShopOfferIds: ['heavy-sniper'],
      gadgetShopOfferIds: [FLASH_GRENADE_ID],
      shopPicksRemaining: 1,
    });
    const equippedBot = createBot('cryo-grenade', ['flash-grenade', 'cryo-grenade']);
    const keepsPreferredGadgetBot = createBot('flash-grenade', ['flash-grenade', 'cryo-grenade']);
    const perkBot = createBot(null);
    const gadgetBot = createBot(null);

    new RoomManager({ random: () => 0.99 }).chooseLongPlayBotShopOffers(equippedBot);
    new RoomManager({ random: () => 0.99 }).chooseLongPlayBotShopOffers(keepsPreferredGadgetBot);
    new RoomManager({ random: () => 0 }).chooseLongPlayBotShopOffers(perkBot);
    new RoomManager({ random: () => 0.99 }).chooseLongPlayBotShopOffers(gadgetBot);

    assert.equal(equippedBot.selectedGadgetId, FLASH_GRENADE_ID,
      'a better-ranked gadget can replace the existing one');
    assert.equal(equippedBot.gadgetCount, 1);
    assert.equal(equippedBot.gadgetCounts[FLASH_GRENADE_ID], 1);
    assert.equal(keepsPreferredGadgetBot.selectedGadgetId, 'flash-grenade',
      "a lower-ranked offer cannot replace the bot's preferred gadget");
    assert.equal(perkBot.selectedGadgetId, null,
      'an empty gadget slot does not force a gadget purchase');
    assert.equal(perkBot.inventory.perks.length, 1,
      'a weighted roll can choose a useful perk instead');
    assert.equal(gadgetBot.selectedGadgetId, FLASH_GRENADE_ID,
      'another weighted roll can choose the offered gadget');
    assert.equal(gadgetBot.gadgetCount, 1);
    assert.equal(gadgetBot.gadgetCounts[FLASH_GRENADE_ID], 1);
  });

  it('lets Long Play bots buy items and spend both opening picks, while favoring missing perks', () => {
    const manager = new RoomManager({ random: () => 0 });
    const successfulPurchases = [];
    const purchaseLongPlayBotShopOffer = manager.purchaseLongPlayBotShopOffer.bind(manager);
    manager.purchaseLongPlayBotShopOffer = (bot, offer) => {
      const purchased = purchaseLongPlayBotShopOffer(bot, offer);
      if (purchased) successfulPurchases.push(offer);
      return purchased;
    };
    const bot = {
      selectedWeaponId: 'assault-rifle',
      inventoryWeaponIds: ['assault-rifle'],
      inventory: { armor: { id: 'armor', name: 'Armor', level: 1 }, perks: [] },
      weaponShopOfferIds: ['sniper', 'smg'],
      itemShopOfferIds: [
        { kind: 'perk', id: 'extended-mag', level: 2 },
        { kind: 'perk', id: 'extended-mag', level: 1 },
        { kind: 'armor', id: 'armor', level: 2 },
      ],
      shopPicksRemaining: 2,
    };

    manager.chooseLongPlayBotShopOffers(bot);

    assert.deepEqual(bot.inventory.perks, [
      { id: 'extended-mag', name: 'Extended Mag', level: 1 },
    ]);
    assert.deepEqual(bot.inventory.armor, { id: 'armor', name: 'Armor', level: 2 });
    assert.equal(successfulPurchases.length, 2,
      'an invalid stale offer is skipped without consuming a shop pick');
    assert.equal(bot.selectedWeaponId, 'assault-rifle', 'an item purchase does not replace a good equipped weapon');
    assert.equal(bot.shopPicksRemaining, 0);
    assert.equal(bot.weaponShopResolved, true);
    assert.deepEqual(bot.weaponShopOfferIds, []);
    assert.deepEqual(bot.itemShopOfferIds, []);

    let perkBuys = 0;
    let otherBuys = 0;
    for (let sample = 0; sample < 40; sample += 1) {
      const randomManager = new RoomManager({ random: () => (sample + 0.5) / 40 });
      const sampledBot = {
        selectedWeaponId: 'assault-rifle',
        inventoryWeaponIds: ['assault-rifle'],
        inventory: { armor: { id: 'armor', name: 'Armor', level: 1 }, perks: [] },
        weaponShopOfferIds: ['sniper', 'smg'],
        itemShopOfferIds: [
          { kind: 'perk', id: 'extended-mag', level: 1 },
          { kind: 'armor', id: 'armor', level: 2 },
        ],
        shopPicksRemaining: 1,
      };
      randomManager.chooseLongPlayBotShopOffers(sampledBot);
      if (sampledBot.inventory.perks.length) perkBuys += 1;
      else otherBuys += 1;
    }
    assert.ok(perkBuys > otherBuys, 'missing perks are favored without making every choice deterministic');
    assert.ok(otherBuys > 0, 'bots sometimes choose armor instead');
  });

  it('weights Long Play weapon preferences while retaining random offer choices', () => {
    let preferredBuys = 0;
    let lowerPriorityBuys = 0;
    for (let sample = 0; sample < 100; sample += 1) {
      const manager = new RoomManager({ random: () => (sample + 0.5) / 100 });
      const bot = {
        selectedWeaponId: 'assault-rifle',
        inventoryWeaponIds: ['assault-rifle'],
        inventory: { armor: null, perks: [] },
        weaponShopOfferIds: ['smg', 'shotgun', 'sniper'],
        itemShopOfferIds: [],
        shopPicksRemaining: 1,
      };

      manager.chooseLongPlayBotShopOffers(bot);

      if (['smg', 'shotgun'].includes(bot.selectedWeaponId)) preferredBuys += 1;
      else lowerPriorityBuys += 1;
    }

    assert.ok(preferredBuys > lowerPriorityBuys,
      'equally preferred weapons are favored over a lower-priority weapon');
    assert.ok(lowerPriorityBuys > 0, 'lower-priority weapons can still be chosen');
  });

  it('allocates shop slots by category and always offers eligible armor', () => {
    const createShopPlayer = () => ({
      inventory: { armor: null, perks: [] },
      inventoryWeaponIds: ['classic-pistol'],
      selectedWeaponId: 'classic-pistol',
    });
    const occasionalShop = new RoomManager({ random: () => 0.999 });
    const secondMatchPlayer = createShopPlayer();
    occasionalShop.prepareLongPlayShop(secondMatchPlayer, 2);
    assert.ok(secondMatchPlayer.weaponShopOfferIds.some((id) => ['battle-pistol', 'revolver'].includes(id)),
      'low-value pistols can occasionally appear in the second match');
    assert.equal(secondMatchPlayer.weaponShopOfferIds.length, 2);
    assert.equal(secondMatchPlayer.weaponShopOfferIds.length + secondMatchPlayer.itemShopOfferIds.length + secondMatchPlayer.gadgetShopOfferIds.length, 5);
    assert.ok(secondMatchPlayer.weaponShopOfferIds.every((id) =>
      Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === id).shopValue <= 2),
    'the second match only includes the first two weapon tiers');
    assert.equal(secondMatchPlayer.itemShopOfferIds.filter((offer) => offer.kind === 'armor').length, 1,
      'each shop includes an armor upgrade while the player is below the armor cap');
    assert.equal(secondMatchPlayer.itemShopOfferIds.filter((offer) => offer.kind === 'perk').length, 1,
      'a shop with two weapon slots still offers one perk alongside its guaranteed armor and gadget');

    const oneWeaponShop = new RoomManager({ random: () => 0.3 });
    const oneWeaponPlayer = createShopPlayer();
    oneWeaponShop.prepareLongPlayShop(oneWeaponPlayer, 2);
    assert.equal(oneWeaponPlayer.weaponShopOfferIds.length, 1,
      'shop allocation can randomly reserve one weapon slot');
    assert.equal(oneWeaponPlayer.itemShopOfferIds.filter((offer) => offer.kind === 'perk').length, 2,
      'one weapon slot leaves room for armor, the guaranteed gadget, and two perks');

    const armorUpgradePlayer = createShopPlayer();
    armorUpgradePlayer.inventory.armor = { id: 'armor', name: 'Armor', level: 1 };
    const armorUpgradeShop = new RoomManager({ random: () => 0.3 });
    armorUpgradeShop.prepareLongPlayShop(armorUpgradePlayer, 3);
    assert.ok(armorUpgradePlayer.itemShopOfferIds.some((offer) => offer.kind === 'armor' && offer.level === 2),
      'later shops offer the next armor level, not a duplicate level-one option');

    const highValueBiasedShop = new RoomManager({ random: () => 0.3 });
    const thirdMatchPlayer = createShopPlayer();
    highValueBiasedShop.prepareLongPlayShop(thirdMatchPlayer, 3);
    assert.ok(!thirdMatchPlayer.weaponShopOfferIds.some((id) => ['battle-pistol', 'revolver'].includes(id)),
      'pistols are excluded from match three onward');
    assert.ok(thirdMatchPlayer.weaponShopOfferIds.every((id) =>
      Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === id).shopValue <= 3),
    'match three adds only the third weapon tier');

    function getEligibleWeapons(round) {
      const manager = new RoomManager({ random: () => 0.5 });
      const drawWeightedOffers = manager.drawWeightedLongPlayOffers.bind(manager);
      let eligible = [];
      manager.drawWeightedLongPlayOffers = (offers, shopRound) => {
        if (offers.length && offers.every((offer) => offer.kind === 'weapon')) {
          eligible = offers.map((offer) => offer.id);
        }
        return drawWeightedOffers(offers, shopRound);
      };
      manager.prepareLongPlayShop(createShopPlayer(), round);
      return eligible;
    }
    const fourthMatchWeapons = getEligibleWeapons(4);
    assert.ok(fourthMatchWeapons.every((id) =>
      Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === id).shopValue <= 4),
    'the fourth match unlocks value-four weapons but keeps the heavy sniper locked');
    assert.ok(getEligibleWeapons(5).includes('heavy-sniper'),
      'the heavy sniper first becomes eligible in match five');

    const noArmorShop = new RoomManager({ random: () => 0 });
    const anotherSecondMatchPlayer = createShopPlayer();
    noArmorShop.prepareLongPlayShop(anotherSecondMatchPlayer, 2);
    assert.ok(anotherSecondMatchPlayer.itemShopOfferIds.some((offer) => offer.id === 'armor'),
      'armor no longer loses its slot to weighted perk draws');
  });

  it('does not offer the gadget already equipped in Long Play', () => {
    const manager = new RoomManager({ random: () => 0 });
    const player = {
      inventory: { armor: null, perks: [] },
      inventoryWeaponIds: ['classic-pistol'],
      selectedWeaponId: 'classic-pistol',
      selectedGadgetId: 'smoke-grenade',
      gadgetCount: 0,
      gadgetCounts: { 'smoke-grenade': 0, molotov: 0, 'cryo-grenade': 0, 'proximity-mine': 0, 'flash-grenade': 0 },
    };

    manager.prepareLongPlayShop(player, 2);

    assert.equal(player.gadgetCount, 1, 'the equipped gadget is replenished for the next round');
    assert.ok(!player.gadgetShopOfferIds.includes('smoke-grenade'));
    assert.equal(player.gadgetShopOfferIds.length, 1, 'another gadget remains available in the shop');
    assert.equal(player.uniqueGadgetShopCount, 1);

    manager.prepareLongPlayShop(player, 3);

    assert.equal(player.uniqueGadgetShopCount, 2, 'the unique offer tier advances once for each shop');
  });

  it('resets a player inventory when leaving Long Play and joining a new game', async () => {
    const manager = new RoomManager();
    const player = createClient();
    manager.longPlay(player);
    const previousRoom = player.room;
    player.selectedWeaponId = 'sniper';
    player.inventoryWeaponIds = ['sniper'];
    player.inventory = {
      armor: { id: 'armor', name: 'Armor', level: 3 },
      perks: [{ id: 'foregrip', name: 'Foregrip', level: 2 }],
    };

    manager.leave(player);
    assert.equal(player.room, null);
    assert.deepEqual(player.inventory, { armor: null, perks: [] });

    const nextGame = manager.longPlay(player);
    await player.room.quickPlayMapPromise;
    assert.notEqual(player.room, previousRoom);
    assert.equal(player.selectedWeaponId, 'classic-pistol');
    assert.deepEqual(player.inventoryWeaponIds, ['classic-pistol']);
    assert.deepEqual(nextGame.state.players.find((entry) => entry.id === player.id).inventory,
      { armor: null, perks: [] });
    assert.equal(nextGame.state.players.find((entry) => entry.id === player.id).selectedWeaponId, 'classic-pistol');
  });

  it('lets Long Play players buy armor upgrades and replaces the previous armor level', async () => {
    let now = 145_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.999 });
    const red = createClient();
    const blue = createClient();
    manager.longPlay(red);
    manager.longPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    await readyAndStartLongPlay(manager, room);

    const redPlayer = room.match.players.find((player) => player.id === red.id);
    const armorLevelOne = { kind: 'armor', id: 'armor', level: 1 };
    red.itemShopOfferIds = [armorLevelOne];
    red.shopPicksRemaining = 1;
    red.weaponShopResolved = false;
    redPlayer.itemShopOfferIds = [armorLevelOne];
    redPlayer.shopPicksRemaining = 1;
    redPlayer.weaponShopResolved = false;
    manager.selectShopItem(red, { itemId: armorLevelOne.id, level: armorLevelOne.level, kind: armorLevelOne.kind });
    assert.deepEqual(red.inventory.armor, { id: 'armor', name: 'Armor', level: 1 });
    assert.equal(redPlayer.armor, 25);
    assert.equal(redPlayer.maxArmor, 25);
    assert.equal(red.weaponShopResolved, true);

    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    manager.setMatchVictory(room, { winner: room.quickPlayRoleBySquad.A, reason: 'capture', at: now });
    await room.quickPlayMapPromise;
    now = room.quickPlayState.phaseEndsAt;
    manager.advanceGames(0);
    const nextRedPlayer = room.match.players.find((player) => player.id === red.id);
    const nextLevel = { kind: 'armor', id: 'armor', level: 2 };
    red.itemShopOfferIds = [nextLevel];
    red.shopPicksRemaining = 1;
    red.weaponShopResolved = false;
    nextRedPlayer.itemShopOfferIds = [nextLevel];
    nextRedPlayer.shopPicksRemaining = 1;
    nextRedPlayer.weaponShopResolved = false;
    manager.selectShopItem(red, { itemId: nextLevel.id, level: nextLevel.level, kind: nextLevel.kind });
    assert.deepEqual(red.inventory.armor, { id: 'armor', name: 'Armor', level: 2 });
    assert.equal(red.inventory.armor.level, 2, 'higher armor replaces rather than duplicates lower armor');
    assert.equal(nextRedPlayer.armor, 40);
    assert.deepEqual(red.inventory.perks, []);
  });

  it('grants level-one armor by default in Quick Play, custom matches, and to their bots', async () => {
    const expectedArmor = { id: 'armor', name: 'Armor', level: 1 };
    const customManager = new RoomManager();
    const customRed = createClient();
    await customManager.createAndJoin(customRed, { name: 'Default Match Armor' });
    assert.deepEqual(customRed.inventory.armor, expectedArmor);
    const customMatch = customManager.startMatch(customRed).match;
    assert.ok(customMatch.players.every((player) => player.armor === 25 && player.inventory.armor.level === 1));
    assert.ok(customMatch.players.every((player) => player.selectedGadgetId === SMOKE_GRENADE_ID &&
      player.gadgetCount === 1 && player.gadgetCounts[SMOKE_GRENADE_ID] === 1),
    'all custom-match humans and bots start with one Smoke Grenade');

    const quickManager = new RoomManager({ random: () => 0.99 });
    const quickRed = createClient();
    quickManager.quickPlay(quickRed);
    const quickRoom = quickRed.room;
    await quickRoom.quickPlayMapPromise;
    const quick = await readyAndStartQuickPlay(quickManager, quickRoom);
    assert.ok(quick.match.players.every((player) => player.armor === 25 && player.inventory.armor.level === 1),
      'all Quick Play humans and bots start with 25 armor');
    assert.ok(quick.match.players.every((player) =>
      getInventoryEffects(player.inventory).armorRegeneration === 5 &&
      getInventoryEffects(player.inventory).regenerationDelayMs === 5_000),
    'all Practice armor regenerates after five seconds');
    assert.ok(quick.match.players.filter((player) => !player.isBot)
      .every((player) => player.selectedGadgetId === SMOKE_GRENADE_ID &&
        player.gadgetCount === 1 && player.gadgetCounts[SMOKE_GRENADE_ID] === 1),
    'Quick Play humans keep their selected Smoke Grenade');
    const quickBots = quick.match.players.filter((player) => player.isBot);
    assert.ok(quickBots.length > 0);
    assert.ok(quickBots.every((bot) => GADGET_DEFINITIONS[bot.selectedGadgetId]?.rarity === 'unique' &&
      bot.gadgetCount === GADGET_DEFINITIONS[bot.selectedGadgetId].charges &&
      bot.gadgetCounts[bot.selectedGadgetId] === GADGET_DEFINITIONS[bot.selectedGadgetId].charges),
    'Quick Play bots can receive unique gadgets with their configured starting charges');
  });

  it('absorbs damage with armor and regenerates armor only after the level-three delay', async () => {
    let now = 15_000;
    const manager = new RoomManager({
      now: () => now,
      projectileDefinitions: {
        test: { id: 'test', damage: 40, centerDamageMultiplier: 1, edgeDamageMultiplier: 1,
          speed: 2_000, radius: 2, range: 500, cooldownMs: 0 },
      },
    });
    const red = createClient();
    const blue = createClient();
    blue.inventory = { armor: { id: 'armor', name: 'Armor', level: 3 }, perks: [] };
    await manager.createAndJoin(red, { name: 'Armor Effects' });
    await manager.join(blue, { name: 'Armor Effects' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    target.inventory = { armor: { id: 'armor', name: 'Armor', level: 3 }, perks: [] };
    target.armor = 50;
    target.maxArmor = 50;
    target.lastDamagedAt = now;
    shooter.x = target.x - 100;
    shooter.y = target.y;
    assert.equal(target.armor, 50);

    manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } });
    assert.equal(target.armor, 10);
    assert.equal(target.health, 100, 'armor absorbs damage before health');
    manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } });
    assert.equal(target.armor, 0);
    assert.equal(target.health, 70, 'damage beyond remaining armor reduces health');
    target.health = 50;
    target.armor = 0;
    const damagedAt = target.lastDamagedAt;
    now = damagedAt + 4_999;
    manager.advanceGames(0.05);
    assert.equal(target.health, 50, 'health does not regenerate until five full seconds without damage');
    assert.equal(target.armor, 0, 'armor also waits through the regeneration delay');
    now += 1;
    manager.advanceGames(0.05);
    assert.equal(target.health, 50, 'level-three armor does not regenerate health');
    assert.equal(target.armor, 0.5, 'level-three armor regenerates 10 armor per second');
  });

  it('applies extended magazines and reload training to magazine and shell reloads', async () => {
    let now = 16_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    red.inventory = { armor: null, perks: [
      { id: 'extended-mag', name: 'Extended Mag', level: 1 },
      { id: 'reload-training', name: 'Reload Training', level: 1 },
    ] };
    await manager.createAndJoin(red, { name: 'Perk Effects' });
    await manager.join(blue, { name: 'Perk Effects' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    red.selectedWeaponId = 'shotgun';
    startGameplay(manager, red);
    const player = red.room.match.players.find((entry) => entry.id === red.id);
    player.inventory = { armor: null, perks: [
      { id: 'extended-mag', name: 'Extended Mag', level: 1 },
      { id: 'reload-training', name: 'Reload Training', level: 1 },
    ] };
    player.weaponStats.shotgun.ammo = getEffectiveMagazineSize(
      DEFAULT_PROJECTILE_DEFINITIONS.shotgun.magazineSize, player.inventory);
    const shotgun = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;
    assert.equal(player.weaponStats.shotgun.ammo,
      getEffectiveMagazineSize(shotgun.magazineSize, player.inventory),
      'the extended magazine uses the configured weapon capacity');

    player.weaponStats.shotgun.ammo = 0;
    const reload = manager.beginWeaponReload(red);
    const expectedInterval = Math.ceil(shotgun.reloadIntervalMs[0] / 1.15);
    assert.equal(reload.reloadEndsAt, now + expectedInterval,
      'reload training speeds up the first per-shell reload interval');
    now += expectedInterval;
    manager.advanceGames(0.05);
    assert.equal(player.weaponStats.shotgun.ammo, 1, 'one upgraded shell is inserted when its faster interval elapses');
  });

  it('stays in the Quick Play result phase until a delayed next map is ready', async () => {
    let now = 75_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    await readyAndStartQuickPlay(manager, room);

    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    const completedMap = room.match.map;
    let resolveNextMap;
    manager.createQuickPlayMapData = () => new Promise((resolve) => { resolveNextMap = resolve; });
    manager.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
    const resultDeadline = room.quickPlayState.phaseEndsAt;

    // Let the scheduled map-preparation callback run, but keep its result pending.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof resolveNextMap, 'function');
    const redPlayer = room.match.players.find((player) => player.id === red.id);
    const postResultStartX = redPlayer.x;
    now = resultDeadline;
    assert.equal(manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    }).accepted, true);
    manager.advanceGames(0);
    now = resultDeadline + 50;
    const [postResultUpdate] = manager.advanceGames(0.05);

    assert.equal(room.quickPlayState.phase, 'round-result');
    assert.ok(redPlayer.x > postResultStartX,
      'postgame movement continues after the five-second result timer while the map is pending');
    assert.ok(postResultUpdate.match, 'the continuing postgame movement is published');
    assert.equal(room.quickPlayState.phaseEndsAt, resultDeadline,
      'map generation must not move the result deadline forward');
    assert.equal(manager.toRoomState(room).quickPlayMapGenerationPending, true);
    assert.equal(room.match.quickPlayState.phaseEndsAt, resultDeadline,
      'the match snapshot must keep the same deadline');

    resolveNextMap({
      seed: completedMap.seed + 1,
      mapOptions: completedMap.mapOptions,
      map: completedMap,
      fingerprint: 'delayed-next-map',
    });
    await room.quickPlayMapPromise;
    now = resultDeadline + 2_000;
    const [update] = manager.advanceGames(0);

    assert.equal(update.roomState.quickPlayState.round, 2);
    assert.equal(update.roomState.quickPlayState.phase, 'countdown');
    assert.ok(update.match, 'the next match starts as soon as its map is available');
  });

  it('keeps the result phase visible after the next map is ready until the result timer ends', async () => {
    let now = 85_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    await readyAndStartQuickPlay(manager, room);

    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);
    const completedMap = room.match.map;
    let resolveNextMap;
    manager.createQuickPlayMapData = () => new Promise((resolve) => { resolveNextMap = resolve; });
    manager.setMatchVictory(room, { winner: 'red', reason: 'elimination', at: now });
    const resultDeadline = room.quickPlayState.phaseEndsAt;
    await new Promise((resolve) => setImmediate(resolve));
    resolveNextMap({
      seed: completedMap.seed + 1,
      mapOptions: completedMap.mapOptions,
      map: completedMap,
      fingerprint: 'ready-before-result-deadline',
    });
    await room.quickPlayMapPromise;

    const [mapReadyUpdate] = manager.advanceGames(0);
    assert.equal(mapReadyUpdate.roomState.quickPlayState.phase, 'round-result');
    assert.equal(mapReadyUpdate.roomState.quickPlayMapGenerationPending, false);
    assert.equal(room.match.quickPlayState.phaseEndsAt, resultDeadline);

    now = resultDeadline;
    const [nextMatchUpdate] = manager.advanceGames(0);
    assert.equal(nextMatchUpdate.roomState.quickPlayState.phase, 'countdown');
    assert.ok(nextMatchUpdate.match, 'the next pre-phase starts once both the map and result timer are ready');
  });

  it('generates Quick Play maps using the nonblocking worker path', async () => {
    const manager = new BaseRoomManager();
    const prepared = await manager.createQuickPlayMapData({ maxAttempts: 1_000 });

    assert.ok(prepared.attempts > 0);
    assertCompetitiveMap(prepared.map);
  });

  it('spawns players during a 15-second countdown and gates gameplay until it ends', async () => {
    let now = 10_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Countdown Gate' });
    await manager.join(blue, { name: 'Countdown Gate' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });

    const state = manager.startMatch(red);
    const player = red.room.match.players.find((entry) => entry.id === red.id);
    const spawn = { x: player.x, y: player.y };

    assert.equal(state.match.gameplayStartsAt, now + MATCH_COUNTDOWN_MS);
    assert.equal(state.match.endsAt, state.match.gameplayStartsAt + MATCH_DURATION_MS);
    now += 1_000;
    const aim = manager.updateGameAim(red, { direction: { x: 0, y: 1 }, visionAngle: -0.75 });
    assert.ok(aim.aimAngle > 0, 'custom matches allow aim and vision updates during the shared countdown');
    assert.equal(player.visionAngle, -0.75, 'the independent vision angle is applied without waiting for the weapon');
    assert.throws(() => manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    }), /countdown is still in progress/);
    assert.throws(() => manager.fireProjectile(red, { direction: { x: 1, y: 0 } }), /countdown is still in progress/);
    assert.throws(() => manager.beginWeaponReload(red), /countdown is still in progress/);

    const [countdownSnapshot] = manager.advanceGames(0.05);
    assert.ok(countdownSnapshot.match, 'custom matches publish updates during the pre-game countdown');
    assert.equal(countdownSnapshot.match.players.find((entry) => entry.id === red.id).visionAngle, -0.75);
    assert.deepEqual({ x: player.x, y: player.y }, spawn);
    now = state.match.gameplayStartsAt;
    manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    manager.advanceGames(0.05);
    assert.ok(player.x > spawn.x, 'movement starts when the countdown ends');
  });

  it('lets players choose a weapon before gameplay and enforces its stats during the match', async () => {
    let now = 15_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Pre-match Weapon Selection' });
    await manager.join(blue, { name: 'Pre-match Weapon Selection' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });

    assert.throws(() => manager.selectWeapon(red, { weaponId: 'sniper' }), /only be selected during the pre-game countdown/,
      'weapon shop is unavailable while the custom-game lobby is idle');
    const started = manager.startMatch(red);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.sniper;
    const selectedState = manager.selectWeapon(red, { weaponId: weapon.id });
    assert.equal(selectedState.match.players.find((player) => player.id === red.id).selectedWeaponId, weapon.id);
    const player = red.room.match.players.find((entry) => entry.id === red.id);
    assert.equal(player.selectedWeaponId, weapon.id);
    assert.equal(player.weaponStats[weapon.id].ammo, weapon.magazineSize);
    assert.equal(player.weaponStats[weapon.id].accuracy,
      weapon.accuracy.startingAccuracy ?? weapon.accuracy.maxAccuracy ?? 1);

    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);
    red.room.match.map.objects = [];
    const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
    assert.equal(shot.projectile.baseDamage, weapon.damage);
    assert.equal(player.weaponStats[weapon.id].ammo, weapon.magazineSize - 1);
    const boltStartedAt = now;
    assert.equal(player.weaponStats[weapon.id].manualActionStartedAt, boltStartedAt);
    assert.equal(player.weaponStats[weapon.id].manualActionEndsAt, boltStartedAt + weapon.manualActionDurationMs);
    red.nextProjectileAt = now;
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, false,
      'the server blocks another shot until the bolt action finishes');
    assert.throws(() => manager.fireProjectile(red, { type: DEFAULT_PROJECTILE_DEFINITIONS.smg.id, direction: { x: 1, y: 0 } }), /Select that weapon/);
    assert.throws(() => manager.selectWeapon(red, { weaponId: DEFAULT_PROJECTILE_DEFINITIONS.smg.id }), /only be selected during the pre-game countdown/);

    now = boltStartedAt + weapon.manualActionDurationMs - 1;
    manager.advanceGames(0.05);
    assert.equal(player.weaponStats[weapon.id].manualActionEndsAt,
      boltStartedAt + weapon.manualActionDurationMs);
    now += 1;
    manager.advanceGames(0.05);
    assert.equal(player.weaponStats[weapon.id].manualActionEndsAt, null, 'the bolt action clears at completion');
    assert.deepEqual(manager.beginWeaponReload(red), {
      accepted: true,
      reloadEndsAt: now + weapon.reloadDurationMs,
    });
    assert.equal(player.weaponStats[weapon.id].reloading, true);
  });

  it('lets custom-match players pick one gadget during buy phase and replaces it with the next choice', async () => {
    let now = 50_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Custom Gadget Buy Phase' });
    await manager.join(blue, { name: 'Custom Gadget Buy Phase' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = manager.startMatch(red);
    const player = red.room.match.players.find((entry) => entry.id === red.id);

    assert.equal(player.selectedGadgetId, SMOKE_GRENADE_ID, 'custom matches start with Smoke Grenade selected');
    assert.equal(player.gadgetCount, 1, 'custom matches grant one Smoke Grenade');
    assert.deepEqual(player.gadgetCounts, {
      'smoke-grenade': 1, molotov: 0, 'cryo-grenade': 0, 'proximity-mine': 0, 'flash-grenade': 0,
      'orbital-strike': 0, 'spy-camera': 0, 'trophy-system': 0, 'vine-trap': 0,
      sonar: 0, [KATANA_ID]: 0, 'jammer-grenade': 0, 'bio-field': 0,
    });
    manager.selectGadget(red, { gadgetId: 'smoke-grenade' });
    assert.equal(player.gadgetCount, 1);
    assert.deepEqual(player.gadgetCounts, {
      'smoke-grenade': 1, molotov: 0, 'cryo-grenade': 0, 'proximity-mine': 0, 'flash-grenade': 0,
      'orbital-strike': 0, 'spy-camera': 0, 'trophy-system': 0, 'vine-trap': 0,
      sonar: 0, [KATANA_ID]: 0, 'jammer-grenade': 0, 'bio-field': 0,
    });
    manager.selectGadget(red, { gadgetId: 'cryo-grenade' });
    assert.equal(player.selectedGadgetId, 'cryo-grenade');
    assert.deepEqual(player.gadgetCounts, {
      'smoke-grenade': 0, molotov: 0, 'cryo-grenade': 1, 'proximity-mine': 0, 'flash-grenade': 0,
      'orbital-strike': 0, 'spy-camera': 0, 'trophy-system': 0, 'vine-trap': 0,
      sonar: 0, [KATANA_ID]: 0, 'jammer-grenade': 0, 'bio-field': 0,
    });
    assert.deepEqual(red.uniqueGadgetShopOfferIds, [],
      'Orbital Strike is not needed as a random offer to be available in the custom shop');
    manager.selectGadget(red, { gadgetId: 'orbital-strike' });
    assert.equal(player.selectedGadgetId, 'orbital-strike');
    manager.selectGadget(red, { gadgetId: SPY_CAMERA_ID });
    assert.equal(player.selectedGadgetId, SPY_CAMERA_ID);
    assert.equal(player.gadgetCounts[SPY_CAMERA_ID], 1);
    manager.selectGadget(red, { gadgetId: 'cryo-grenade' });

    red.room.match = null;
    const rematch = manager.startMatch(red).match;
    const rematchPlayer = rematch.players.find((entry) => entry.id === red.id);
    assert.equal(rematchPlayer.selectedGadgetId, CRYO_GRENADE_ID,
      'custom matches retain the player’s last gadget choice');
    assert.equal(rematchPlayer.gadgetCount, 1, 'the retained gadget is replenished for a new custom match');

    now = rematch.gameplayStartsAt;
    assert.throws(() => manager.selectGadget(red, { gadgetId: 'molotov' }), /only be selected during the pre-game countdown/);
  });

  it('guarantees a Long Play gadget offer and purchases it as a one-use replacement', async () => {
    let now = 60_000;
    const manager = new RoomManager({ now: () => now, random: () => 0 });
    const red = createClient();
    const blue = createClient();
    manager.longPlay(red);
    manager.longPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    const started = await readyAndStartLongPlay(manager, room);
    const player = room.match.players.find((entry) => entry.id === red.id);
    assert.equal(player.selectedGadgetId, null, 'Long Play begins with no gadget equipped');
    assert.equal(player.gadgetCount, 0);
    const publicPlayer = started.match.players.find((entry) => entry.id === red.id);
    assert.equal(publicPlayer.selectedGadgetId, null, 'the public snapshot keeps the gadget slot empty');
    assert.equal(publicPlayer.gadgetCount, 0);
    assert.equal(player.gadgetShopOfferIds.length, 1, 'the Long Play shop always has one gadget offer');

    const offeredGadgetId = player.gadgetShopOfferIds[0];
    const previousGadgetId = Object.keys(GADGET_DEFINITIONS).find((id) => id !== offeredGadgetId);
    red.selectedGadgetId = previousGadgetId;
    red.gadgetCount = 1;
    red.gadgetCounts = Object.fromEntries(Object.keys(GADGET_DEFINITIONS).map((id) => [id, Number(id === previousGadgetId)]));
    player.selectedGadgetId = previousGadgetId;
    player.gadgetCount = 1;
    player.gadgetCounts = structuredClone(red.gadgetCounts);
    manager.selectGadget(red, { gadgetId: offeredGadgetId });

    assert.equal(player.selectedGadgetId, offeredGadgetId);
    assert.equal(player.gadgetCount, 1);
    assert.deepEqual(player.gadgetCounts,
      Object.fromEntries(Object.keys(GADGET_DEFINITIONS).map((id) => [id, Number(id === offeredGadgetId)])));
    assert.equal(player.shopPicksRemaining, 1);
    assert.equal(player.gadgetShopOfferIds.length, 0, 'the purchased gadget is removed from offers');
  });

  it('replenishes a purchased Long Play gadget at the start of the next match', async () => {
    let now = 65_000;
    const manager = new RoomManager({ now: () => now, random: () => 0 });
    const red = createClient();
    const blue = createClient();
    manager.longPlay(red);
    manager.longPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    const started = await readyAndStartLongPlay(manager, room);
    const player = room.match.players.find((entry) => entry.id === red.id);
    const gadgetId = player.gadgetShopOfferIds[0];

    manager.selectGadget(red, { gadgetId });
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);
    room.match.map.objects = [];
    Object.assign(player, { x: 500, y: 350, equippedSlot: 'gadget' });
    assert.equal(manager.applyGadgetAction(red, { action: 'use', target: { x: 510, y: 350 } }).accepted, true);
    assert.equal(player.gadgetCount, 0, 'using the gadget consumes this round’s use');
    assert.equal(red.selectedGadgetId, gadgetId, 'the selected gadget remains part of the Long Play loadout');

    manager.setMatchVictory(room, { winner: room.quickPlayRoleBySquad.A, reason: 'capture', at: now });
    await room.quickPlayMapPromise;
    now = room.quickPlayState.phaseEndsAt;
    manager.advanceGames(0);

    const nextPlayer = room.match.players.find((entry) => entry.id === red.id);
    assert.equal(room.quickPlayState.round, 2);
    assert.equal(nextPlayer.selectedGadgetId, gadgetId);
    assert.equal(nextPlayer.gadgetCount, 1);
    assert.deepEqual(nextPlayer.gadgetCounts,
      Object.fromEntries(Object.keys(GADGET_DEFINITIONS).map((id) => [id, Number(id === gadgetId)])));
    assert.equal(red.gadgetCount, 1, 'the client loadout is also replenished for the next match');
  });

  it('creates a room and joins its creator without exposing its password', async () => {
    const manager = new RoomManager();
    const creator = createClient();

    const result = await manager.createAndJoin(creator, { name: 'Friday Match', password: 'secret' });

    assert.equal(result.room.name, 'Friday Match');
    assert.equal(result.room.locked, true);
    assert.equal(result.room.clients, 1);
    assert.equal(creator.room.name, 'Friday Match');
    assert.equal(creator.team, 'red');
    assert.deepEqual(result.room.teamCounts, { red: 1, blue: 0 });
    assert.equal(result.state.hostId, creator.id);
    assert.equal(JSON.stringify(manager.listRooms()).includes('secret'), false);
    assert.ok(result.state.seed >= 1 && result.state.seed <= MAX_MAP_SEED);
    assert.equal(result.state.mapGenerationPending, true);
    assert.equal(result.state.mapOptions.minRooms, DEFAULT_MIN_ROOMS);
    assert.equal(result.state.mapOptions.maxRooms, DEFAULT_MAX_ROOMS);

    const preparedMap = await manager.rooms.get('friday match').customMapPromise;
    const completedState = manager.toRoomState(creator.room);
    assert.equal(completedState.mapGenerationPending, false);
    assert.ok(completedState.mapOptions.minRooms >= COMPETITIVE_MAP_RULES.minRooms);
    assert.ok(completedState.mapOptions.maxRooms <= COMPETITIVE_MAP_RULES.maxRooms);
    assert.equal(completedState.mapOptions.minRooms, completedState.mapOptions.maxRooms);
    assertCompetitiveMap(preparedMap.map);
  });

  it('lets only the host set or regenerate the lobby seed before a match', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Seeded Room' });
    await manager.join(guest, { name: 'Seeded Room' });

    assert.equal(manager.setMapSeed(host, { seed: 987654321 }).seed, 987654321);
    assert.throws(() => manager.setMapSeed(guest, { seed: 12 }), /Only the room host/);
    assert.throws(() => manager.setMapSeed(host, { seed: 0 }), /whole numbers/);
    assert.throws(() => manager.setMapSeed(host, { seed: MAX_MAP_SEED + 1 }), /whole numbers/);

    const randomized = manager.setMapSeed(host, { random: true });
    assert.ok(randomized.seed >= 1 && randomized.seed <= MAX_MAP_SEED);
    assert.notEqual(randomized.seed, undefined);
    assert.equal(randomized.mapGenerationPending, true, 'a newly requested seed immediately exposes background generation state');
    const selected = manager.setMapSeed(host, { seed: 12, minRooms: 7, maxRooms: 9 });
    assert.deepEqual(selected.mapOptions, { minRooms: 7, maxRooms: 9 });
    assert.throws(() => manager.setMapSeed(host, { seed: 13, minRooms: 10, maxRooms: 9 }), /Room count range/);
    assert.equal(manager.toRoomState(host.room).seed, 12);
    const exactCount = manager.setMapSeed(host, { seed: 13, roomCount: 6 });
    assert.deepEqual(exactCount.mapOptions, { minRooms: 6, maxRooms: 6 });
    const randomMap = manager.setMapSeed(host, { random: true, randomRoomCount: true });
    assert.ok(randomMap.mapOptions.minRooms >= 1 && randomMap.mapOptions.minRooms <= 13);
    assert.equal(randomMap.mapOptions.minRooms, randomMap.mapOptions.maxRooms);
    await host.room.customMapPromise;
    assert.equal(manager.toRoomState(host.room).mapGenerationPending, false);
  });

  it('resumes a disconnected session without replacing the match player or authority', async () => {
    let now = 1000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    const created = await manager.createAndJoin(host, { name: 'Resume Room' });
    await manager.join(guest, { name: 'Resume Room' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    startGameplay(manager, host);
    manager.updateGameInput(host, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    manager.advanceGames(0.05);
    const before = host.room.match.players.find((player) => player.id === host.id);
    manager.markDisconnected(host);

    const replacement = { socket: {} };
    const resumed = manager.resumeSession(replacement, created.sessionToken);

    assert.ok(resumed);
    assert.equal(resumed.playerId, host.id);
    assert.equal(resumed.state.hostId, host.id);
    assert.equal(resumed.state.match.players.length, 2);
    assert.equal(replacement.room, guest.room);
    assert.equal(replacement.connected, true);
    assert.equal(replacement.socket instanceof Object, true);
    assert.equal(replacement.roomInputSequence, 1);
    assert.deepEqual(
      resumed.state.match.players.find((player) => player.id === host.id),
      before,
    );
  });

  it('atomically replaces an old live socket when reconnect races its close event', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const created = await manager.createAndJoin(host, { name: 'Socket Handoff' });
    const oldSocket = { readyState: 1, closeCode: null, close(code) { this.closeCode = code; } };
    host.socket = oldSocket;
    manager.setPlayerTeam(host, { team: 'red' });
    startGameplay(manager, host);
    const replacementSocket = { readyState: 1 };

    const resumed = manager.resumeSession({ socket: replacementSocket }, created.sessionToken);

    assert.ok(resumed);
    assert.equal(resumed.playerId, host.id);
    assert.equal(host.room.clients.size, 1);
    assert.equal(oldSocket.closeCode, 4001);
    assert.equal(resumed.replacedClient.socket, oldSocket);
    assert.equal(resumed.state.match.players.length, 1);
  });

  it('expires disconnected sessions after their grace period', async () => {
    let now = 1000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    const created = await manager.createAndJoin(host, { name: 'Expired Session' });
    await manager.join(guest, { name: 'Expired Session' });
    manager.markDisconnected(host);
    now += 15_001;

    assert.equal(manager.resumeSession({ socket: {} }, created.sessionToken), null);
    const departure = manager.expireDisconnected(host);
    assert.equal(departure.hostChanged, true);
    assert.equal(departure.state.hostId, guest.id);
  });

  it('hands pending custom-map generation to a connected player when its host disconnects', async () => {
    const manager = new RoomManager({ simulationMode: 'host-authoritative' });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Map Host Recovery' });
    await manager.join(guest, { name: 'Map Host Recovery' });
    const room = host.room;
    const previousRevision = room.mapGenerationRevision;

    manager.markDisconnected(host);

    const state = manager.toRoomState(room);
    assert.equal(state.hostId, guest.id);
    assert.equal(state.mapGenerationPending, true);
    assert.equal(state.mapGenerationRevision, previousRevision + 1);
    assert.equal(state.players.find((player) => player.id === host.id).connected, false);
    assert.equal(state.players.find((player) => player.id === guest.id).connected, true);
  });

  it('starts a match with exactly one generated room when selected by the host', async () => {
    const manager = new RoomManager();
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Single Room' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setMapSeed(host, { seed: 42, minRooms: 1, maxRooms: 1 });

    const state = manager.startMatch(host);

    assert.equal(state.match.map.metrics.roomCount, 1);
    assert.equal(state.match.map.rooms.filter((room) => !room.isSpawn).length, 1);
    assert.ok(state.match.map.rooms.some((room) => room.isSpawn && room.team === 'red'));
    assert.equal(state.match.players[0].team, 'red');
  });

  it('searches for competitive maps meeting doorway, symmetry, sightline, and utilization rules', async () => {
    const recordedMaps = [];
    const manager = new BaseRoomManager({
      randomTeam: () => 0,
      competitiveMapStore: { record: async (map) => recordedMaps.push(map) },
    });
    manager.prepareCustomRoomMap = () => null;
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Competitive Map Search' });
    const candidates = [
      generateMap(31, MAP_WIDTH, MAP_HEIGHT, { minRooms: 1, maxRooms: 1 }),
      generateMap(32, MAP_WIDTH, MAP_HEIGHT, { minRooms: 1, maxRooms: 1 }),
    ];
    candidates[0].metrics.topology.maxSymmetryPercent = 0;
    candidates[1].metrics.siteDoorways = Object.fromEntries(['red', 'blue'].map((team) => [team, {
      ...candidates[1].metrics.siteDoorways[team],
      doorwayCount: COMPETITIVE_MAP_RULES.minDoorwaysPerSite,
      graphEdgeCount: COMPETITIVE_MAP_RULES.minDoorwaysPerSite,
    }]));
    candidates[1].metrics.topology.maxSymmetryPercent = COMPETITIVE_MAP_RULES.minSymmetryPercent;
    candidates[1].metrics.roomUtilization.ratio = COMPETITIVE_MAP_RULES.minRoomUtilization;
    candidates[1].metrics.siteSightline = {
      ...candidates[1].metrics.siteSightline,
      mutuallyOccluded: true,
      nearSiteSampleCount: 1,
      longNearSiteSightlineCount: 0,
    };
    candidates[1].metrics.roomCount = COMPETITIVE_MAP_RULES.minRooms;
    let candidateIndex = 0;
    manager.generateCompetitiveMapCandidate = (seed, options) => {
      const map = structuredClone(candidates[candidateIndex++]);
      map.seed = seed;
      map.mapOptions = options;
      return map;
    };

    const state = await manager.generateCompetitiveMap(host, { maxAttempts: 2 });
    const map = candidates[1];

    assert.equal(state.mapsGenerated, 2,
      'the host response includes how many candidate maps were generated');
    assert.ok(map.metrics.roomCount >= COMPETITIVE_MAP_RULES.minRooms && map.metrics.roomCount <= COMPETITIVE_MAP_RULES.maxRooms);
    assert.ok(map.metrics.siteDoorways.red.doorwayCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
    assert.ok(map.metrics.siteDoorways.blue.doorwayCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
    assert.ok(map.metrics.siteDoorways.red.graphEdgeCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
    assert.ok(map.metrics.siteDoorways.blue.graphEdgeCount >= COMPETITIVE_MAP_RULES.minDoorwaysPerSite);
    assert.ok(map.metrics.topology.maxSymmetryPercent >= COMPETITIVE_MAP_RULES.minSymmetryPercent);
    assert.ok(map.metrics.siteSightline.mutuallyOccluded);
    assert.ok(map.metrics.siteSightline.nearSiteSampleCount > 0);
    assert.equal(map.metrics.siteSightline.longNearSiteSightlineCount, 0);
    assert.ok(map.metrics.roomUtilization.ratio >= COMPETITIVE_MAP_RULES.minRoomUtilization);
    assert.deepEqual(recordedMaps, [{ seed: state.seed, roomCount: state.mapOptions.minRooms }]);
  });

  it('uses a catalog map when the host starts before custom competitive search finishes', async () => {
    const fallback = createCatalogFallback();
    const manager = new BaseRoomManager({
      randomTeam: () => 0,
      competitiveMapStore: { list: async () => [], record: async () => {} },
    });
    manager.prepareCustomRoomMap = () => null;
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Catalog Fallback' });
    manager.createCompetitiveMapData = ({ signal }) => waitForAbort(signal);
    manager.createCatalogCompetitiveMapData = async () => fallback;

    const generation = manager.beginCompetitiveMapGeneration(host);
    manager.requestCustomMapFallback(host.room);
    const result = await generation.promise;

    assert.equal(result.state.seed, fallback.seed);
    assert.deepEqual(result.state.mapOptions, fallback.mapOptions);
    assert.equal(result.mapsGenerated, 0);
  });

  it('automatically falls back to a cached competitive map after the search timeout', async () => {
    const fallback = createCatalogFallback();
    const manager = new BaseRoomManager({
      randomTeam: () => 0,
      competitiveMapStore: { list: async () => [], record: async () => {} },
    });
    manager.createCompetitiveMapData = ({ signal }) => waitForAbort(signal);
    manager.createCatalogCompetitiveMapData = async () => fallback;

    const prepared = await manager.createCompetitiveMapWithFallback(
      (signal) => manager.createCompetitiveMapData({ signal }),
      { fallbackAfterMs: 1 },
    );

    assert.equal(prepared.seed, fallback.seed);
    assert.equal(prepared.fromCatalog, true);
  });

  it('uses a catalog map when all Quick Play players ready before search finishes', async () => {
    const fallback = createCatalogFallback();
    const manager = new BaseRoomManager({
      competitiveMapStore: { list: async () => [], record: async () => {} },
    });
    manager.createQuickPlayMapData = ({ signal }) => waitForAbort(signal);
    manager.createCatalogCompetitiveMapData = async () => fallback;
    const player = createClient();

    manager.quickPlay(player);
    manager.setQuickPlayReady(player, { ready: true });
    await player.room.quickPlayMapPromise;

    assert.equal(player.room.mapSeed, fallback.seed);
    assert.deepEqual(player.room.mapOptions, fallback.mapOptions);
    assert.equal(player.room.quickPlayMap.fromCatalog, true);
  });

  it('creates password-protected mode rooms without exposing them to public matchmaking', async () => {
    const manager = new BaseRoomManager({ simulationMode: 'host-authoritative' });
    const modes = [
      ['quickplay', 'Private Practice', null, 1],
      ['longplay', 'Private Quick', LONG_PLAY_WINS_TO_WIN, QUICK_PLAY_ROLE_SWAP_EVERY],
      ['longseries', 'Private Long', LONG_SERIES_WINS_TO_WIN, LONG_PLAY_ROLE_SWAP_EVERY],
    ];

    for (const [gameMode, name, winsToWin, roleSwapEvery] of modes) {
      const created = await manager.createPrivateSeries(createClient(), {
        gameMode,
        name,
        password: 'invite-only',
      });
      assert.equal(created.room.quickPlay, true);
      assert.equal(created.room.gameMode, gameMode);
      assert.equal(created.room.locked, true);
      assert.equal(created.state.quickPlayState.gameMode, gameMode);
      assert.equal(created.state.quickPlayState.winsToWin, winsToWin);
      assert.equal(created.state.quickPlayState.roleSwapEvery, roleSwapEvery);
      assert.equal(JSON.stringify(created.room).includes('invite-only'), false);

      const publicMatch = manager.joinCompetitiveSeries(createClient(), gameMode);
      assert.notEqual(publicMatch.room.name, name);
      assert.equal(publicMatch.room.locked, false);
      assert.equal(publicMatch.room.gameMode, gameMode);
    }

    await assert.rejects(manager.join(createClient(), { name: 'Private Practice' }), /requires a password/);
    const guest = await manager.join(createClient(), {
      name: 'Private Practice',
      password: 'invite-only',
    });
    assert.equal(guest.room.gameMode, 'quickplay');
    assert.equal(guest.room.clients, 2);

    await assert.rejects(manager.createPrivateSeries(createClient(), {
      name: 'Missing Password',
      gameMode: 'quickplay',
    }), /require a password/);
  });

  it('allows joining case-insensitively and verifies optional room passwords', async () => {
    const manager = new RoomManager();
    const creator = createClient();
    const guest = createClient();
    await manager.createAndJoin(creator, { name: 'Open Field' });

    const result = await manager.join(guest, { name: 'open field' });

    assert.equal(result.room.name, 'Open Field');
    assert.equal(result.room.clients, 2);
  });

  it('rejects missing or incorrect passwords for locked rooms', async () => {
    const manager = new RoomManager();
    const creator = createClient();
    await manager.createAndJoin(creator, { name: 'Private Match', password: 'secret' });

    await assert.rejects(manager.join(createClient(), { name: 'Private Match' }), /requires a password/);
    await assert.rejects(manager.join(createClient(), { name: 'Private Match', password: 'wrong' }), /incorrect/);
  });

  it('rejects duplicate names regardless of case', async () => {
    const manager = new RoomManager();
    await manager.createAndJoin(createClient(), { name: 'Tournament' });

    await assert.rejects(manager.createAndJoin(createClient(), { name: 'tournament' }), /already exists/);
  });

  it('removes rooms after their final client leaves', async () => {
    const manager = new RoomManager();
    const first = createClient();
    const second = createClient();
    await manager.createAndJoin(first, { name: 'Temporary Room' });
    await manager.join(second, { name: 'Temporary Room' });

    manager.leave(first);
    assert.equal(manager.listRooms()[0].clients, 1);
    assert.equal(manager.leave(second).roomName, 'Temporary Room');
    assert.deepEqual(manager.listRooms(), []);
    assert.equal(second.room, null);
  });

  it('enforces active room and per-room client limits', async () => {
    const manager = new RoomManager({ maxRooms: 1, maxClientsPerRoom: 1 });
    await manager.createAndJoin(createClient(), { name: 'At Capacity' });

    await assert.rejects(manager.createAndJoin(createClient(), { name: 'Another Room' }), /room limit/);
    await assert.rejects(manager.join(createClient(), { name: 'At Capacity' }), /full/);
  });

  it('automatically assigns both teams before starting and enforces self-service group limits', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const player = createClient();
    await manager.createAndJoin(host, { name: 'Team Room', team: 'red' });
    await manager.join(player, { name: 'Team Room', team: 'blue' });

    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 1, blue: 1 });
    assert.equal(host.team, 'red');
    assert.equal(player.team, 'blue');
    assert.throws(() => manager.setPlayerTeam(host, { team: 'green' }), /Choose Strike Team or Flag Team/);

    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(player, { team: 'blue' });
    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 1, blue: 1 });
    assert.throws(() => manager.setPlayerTeam(player, { playerId: host.id, team: 'blue' }), /only change your own team/);

    const match = startGameplay(manager, host).match;
    const redSpawns = match.players.filter((entry) => entry.team === 'red');
    const blueSpawns = match.players.filter((entry) => entry.team === 'blue');
    assert.equal(redSpawns.length, 1);
    assert.equal(blueSpawns.length, 1);
    for (const player of match.players) {
      const site = match.map.spawnZones[player.team];
      assert.ok(site.width >= 220 && site.height >= 220);
      assert.ok(player.x >= site.x && player.x <= site.x + site.width);
      assert.ok(player.y >= site.y && player.y <= site.y + site.height);
      assert.ok(player.team === 'red'
        ? site.x + site.width <= MAP_WIDTH / 2
        : site.x >= MAP_WIDTH / 2);
    }
  });

  it('auto-assigns room joiners to the other team when one side is full', async () => {
    const manager = new RoomManager();
    const members = [createClient()];
    await manager.createAndJoin(members[0], { name: 'Open Team Slot' });
    for (let index = 1; index < TEAM_CAPACITY; index += 1) {
      members.push(createClient());
      await manager.join(members[index], { name: 'Open Team Slot' });
    }
    for (const member of members) manager.setPlayerTeam(member, { team: 'red' });

    const newPlayer = createClient();
    const joined = await manager.join(newPlayer, { name: 'Open Team Slot' });

    assert.equal(joined.room.full, false);
    assert.equal(newPlayer.team, 'blue');
    assert.deepEqual(joined.room.teamCounts, { red: TEAM_CAPACITY, blue: 1 });
  });

  it('lets the host move players and swap them when a destination team is full', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const members = [host];
    await manager.createAndJoin(host, { name: 'Full Teams' });
    for (let index = 1; index < MAX_ROOM_CAPACITY; index += 1) {
      const member = createClient();
      members.push(member);
      await manager.join(member, { name: 'Full Teams' });
    }
    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: TEAM_CAPACITY, blue: TEAM_CAPACITY });

    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 5, blue: 5 });
    assert.throws(() => manager.setPlayerTeam(members[2], { team: 'blue' }), /flag team group is full/i);
    assert.throws(() => manager.setPlayerTeam(members[2], {
      playerId: members[4].id,
      team: 'blue',
      swapWithPlayerId: members[1].id,
    }), /Only the room host|only change your own team/);

    manager.setPlayerTeam(host, {
      playerId: members[2].id,
      team: 'blue',
      swapWithPlayerId: members[1].id,
    });
    assert.equal(members[2].team, 'blue');
    assert.equal(members[1].team, 'red');
    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 5, blue: 5 });
    assert.throws(() => manager.setPlayerTeam(host, { playerId: members[6].id, team: 'none' }), /Choose Strike Team or Flag Team/);
  });

  it('auto-assigns late arrivals into an active custom match and prevents mid-match team changes', async () => {
    const manager = new RoomManager();
    const host = createClient();
    await manager.createAndJoin(host, { name: 'Late Join' });
    manager.setPlayerTeam(host, { team: 'red' });
    const started = startGameplay(manager, host);
    const latePlayer = createClient();

    const joined = await manager.join(latePlayer, { name: 'Late Join' });
    assert.equal(joined.state.players.find((player) => player.id === latePlayer.id).team, 'blue');
    assert.equal(joined.state.match.players.some((player) => player.id === latePlayer.id), true);

    assert.throws(() => manager.setPlayerTeam(latePlayer, { team: 'red' }), /during an active match/);
    assert.throws(() => manager.setPlayerTeam(host, { playerId: latePlayer.id, team: 'red' }), /during an active match/);
    const updated = manager.toRoomState(host.room);
    assert.equal(updated.players.find((player) => player.id === latePlayer.id).team, 'blue');
    assert.equal(updated.match.players.some((player) => player.id === latePlayer.id), true);
    assert.equal(started.match.players.length, 1, 'the original start snapshot remains immutable');
  });

  it('validates room names and password length', async () => {
    const manager = new RoomManager();

    await assert.rejects(manager.createAndJoin(createClient(), { name: '   ' }), /Room names/);
    await assert.rejects(manager.createAndJoin(createClient(), { name: 'a'.repeat(33) }), /Room names/);
    await assert.rejects(manager.createAndJoin(createClient(), { name: 'Valid', password: 'x'.repeat(129) }), /128 characters/);
  });

  it('validates and assigns player display names on create, join, and Quick Play', async () => {
    const manager = new RoomManager();
    const creator = createClient();
    await manager.createAndJoin(creator, {
      name: 'Named Players', displayName: '  Ada   Lovelace  ',
    });
    assert.equal(creator.playerName, 'Ada Lovelace');

    const guest = createClient();
    await manager.join(guest, { name: 'Named Players', displayName: 'Grace\nHopper' });
    assert.equal(guest.playerName, 'Grace Hopper');
    assert.equal(manager.toRoomState(creator.room).players.find((player) => player.id === guest.id).name, 'Grace Hopper');

    const quick = createClient();
    manager.quickPlay(quick, { displayName: 'Katherine Johnson' });
    assert.equal(quick.playerName, 'Katherine Johnson');
    assert.equal(manager.toRoomState(quick.room).players[0].name, 'Katherine Johnson');

    const legacy = createClient();
    await manager.createAndJoin(legacy, {
      name: 'Legacy Name', playerColor: '#a05ee1', avatarDataUrl: 'data:image/jpeg;base64,AA==',
    });
    assert.match(legacy.playerName, /^Player \d+$/);
    assert.equal(legacy.playerColor, undefined);
    assert.equal(legacy.avatarDataUrl, undefined);
    const legacyProfile = manager.toRoomState(legacy.room).players.find((player) => player.id === legacy.id);
    assert.equal('playerColor' in legacyProfile, false);
    assert.equal('avatarDataUrl' in legacyProfile, false);
  });

  it('rejects empty, oversized, or unsafe display names', async () => {
    const manager = new RoomManager();
    let roomNumber = 0;
    for (const displayName of ['', '   ', 'x'.repeat(25), 'name<script>']) {
      await assert.rejects(
        manager.createAndJoin(createClient(), { name: `Display ${++roomNumber}`, displayName }),
        /Display names must be/,
      );
    }
  });

  it('does not create a room for a client that has disconnected while hashing', async () => {
    const manager = new RoomManager();
    const client = createClient();
    const creatingRoom = manager.createAndJoin(client, { name: 'Disconnected', password: 'secret' });
    client.connected = false;

    await assert.rejects(creatingRoom, /connection was lost/);
    assert.deepEqual(manager.listRooms(), []);
  });

  it('starts a three-minute host-owned match after the shared countdown and auto-assigns late arrivals', async () => {
    let now = 1000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Match Room' });
    await manager.join(guest, { name: 'Match Room' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });

    assert.throws(() => manager.startMatch(guest), /Only the current room host/);
    const initialState = manager.startMatch(host);
    assert.equal(initialState.hostId, host.id);
    assert.equal(initialState.match.gameplayStartsAt - initialState.match.startedAt, MATCH_COUNTDOWN_MS);
    assert.equal(initialState.match.endsAt - initialState.match.gameplayStartsAt, MATCH_DURATION_MS);
    assert.equal(initialState.match.map.width, MAP_WIDTH);
    assert.equal(initialState.match.map.height, MAP_HEIGHT);
    assert.ok(initialState.match.map.rooms.some((room) => room.isSpawn && room.team === 'red'));
    assert.equal(initialState.match.players.length, 2);
    assert.deepEqual(
      initialState.match.players.map((player) => player.team).sort(),
      ['blue', 'red'],
    );
    for (const player of initialState.match.players) {
      const spawnRoom = initialState.match.map.rooms.find((room) => room.isSpawn && room.team === player.team);
      assert.ok(player.x >= spawnRoom.x - spawnRoom.width / 2 && player.x <= spawnRoom.x + spawnRoom.width / 2);
      assert.ok(player.y >= spawnRoom.y - spawnRoom.height / 2 && player.y <= spawnRoom.y + spawnRoom.height / 2);
    }

    const latePlayer = createClient();
    const joined = await manager.join(latePlayer, { name: 'Match Room' });
    assert.equal(joined.state.match.players.length, 3);
    assert.equal(joined.state.match.players.some((player) => player.id === latePlayer.id), true);
    assert.equal(joined.state.players.find((player) => player.id === latePlayer.id).team, 'red');
    assert.throws(() => manager.setPlayerTeam(latePlayer, { team: 'blue' }), /during an active match/);
    assert.equal(manager.toRoomState(host.room).match.players.length, 3);
  });

  it('preserves the match and elects the longest-present player when the host leaves', async () => {
    let now = 5000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const earliestGuest = createClient();
    const laterGuest = createClient();
    await manager.createAndJoin(host, { name: 'Migration Room' });
    now += 1;
    await manager.join(earliestGuest, { name: 'Migration Room' });
    now += 1;
    await manager.join(laterGuest, { name: 'Migration Room' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(earliestGuest, { team: 'blue' });
    manager.setPlayerTeam(laterGuest, { team: 'red' });
    const originalState = startGameplay(manager, host);

    const departure = manager.leave(host);

    assert.equal(departure.hostChanged, true);
    assert.equal(departure.state.hostId, earliestGuest.id);
    assert.equal(departure.state.match.startedAt, originalState.match.startedAt);
    assert.equal(departure.state.match.players.some((player) => player.id === host.id), false);
    const originalX = departure.state.match.players.find((player) => player.id === earliestGuest.id).x;
    manager.updateGameInput(earliestGuest, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    });
    manager.advanceGames(0.05);
    assert.ok(earliestGuest.room.match.players.find((player) => player.id === earliestGuest.id).x > originalX);
  });

  it('does not elect a disconnected member when the host leaves', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const disconnectedGuest = createClient();
    const connectedGuest = createClient();
    await manager.createAndJoin(host, { name: 'Connected Host Election' });
    await manager.join(disconnectedGuest, { name: 'Connected Host Election' });
    await manager.join(connectedGuest, { name: 'Connected Host Election' });
    manager.markDisconnected(disconnectedGuest);

    const departure = manager.leave(host);

    assert.equal(departure.state.hostId, connectedGuest.id);
    assert.equal(departure.state.simulation.authorityId, connectedGuest.id);
  });

  it('assigns a host when the first remaining member resumes after host departure', async () => {
    const manager = new RoomManager();
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Resume Host Election' });
    const joined = await manager.join(guest, { name: 'Resume Host Election' });
    manager.markDisconnected(guest);

    const departure = manager.leave(host);
    assert.equal(departure.state.hostId, null);
    assert.equal(departure.state.simulation.epoch, 2);

    const resumed = manager.resumeSession({ socket: {} }, joined.sessionToken);

    assert.ok(resumed);
    assert.equal(resumed.state.hostId, guest.id);
    assert.equal(resumed.state.simulation.epoch, 3);
  });

  it('simulates validated player input on the server and ends matches at three minutes', async () => {
    let now = 9000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Controls Room' });
    await manager.join(guest, { name: 'Controls Room' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    const initialState = startGameplay(manager, host);
    const guestSpawn = initialState.match.players.find((player) => player.id === guest.id);

    const accepted = manager.updateGameInput(guest, {
      sequence: 1,
      input: { up: true, down: false, left: false, right: false, visionAngle: Math.PI / 3 },
    });
    assert.deepEqual(accepted, { sequence: 1, accepted: true });
    assert.deepEqual(manager.updateGameInput(guest, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: true },
    }), { sequence: 1, accepted: false });
    assert.throws(() => manager.updateGameInput(guest, {
      sequence: 1_000_000,
      input: { up: false, down: false, left: false, right: false },
    }), /directions and a valid sequence/);
    assert.throws(() => manager.updateGameInput(guest, {
      sequence: 2,
      input: { up: 1, down: false, left: false, right: false },
    }), /directions and a valid sequence/);
    assert.throws(() => manager.updateGameInput(guest, {
      sequence: 2,
      input: { up: false, down: false, left: false, right: false, weaponLean: 2 },
    }), /directions and a valid sequence/);
    assert.throws(() => manager.updateGameInput(guest, {
      sequence: 2,
      input: { up: false, down: false, left: false, right: false, visionAngle: Math.PI * 2 },
    }), /directions and a valid sequence/);
    manager.advanceGames(0.05);
    let guestState = manager.toRoomState(host.room).match.players.find((player) => player.id === guest.id);
    assert.ok(guestState.y < guestSpawn.y);
    assert.equal(guestState.visionAngle, Math.PI / 3);
    assert.equal(guestState.lastInputSequence, 1);

    const movingY = guestState.y;
    now += 1000;
    for (let step = 0; step < 20; step += 1) manager.advanceGames(0.05);
    guestState = manager.toRoomState(host.room).match.players.find((player) => player.id === guest.id);
    assert.ok(guestState.y <= movingY, 'stale input should not resume or reverse a player');
    assert.ok(Math.hypot(guestState.vx, guestState.vy) < 1e-6, 'stale input should brake the player to a stop');
    assert.equal(guestState.visionAngle, Math.PI / 3, 'stale movement input should retain the last known vision direction');
    assert.equal(guestState.input.up, false);
    assert.throws(() => manager.finishMatch(guest), /timer has not expired/);

    now += MATCH_DURATION_MS;
    manager.advanceGames(0);
    assert.equal(manager.finishMatch(guest).match, null);
    assert.equal(startGameplay(manager, host).match.startedAt, now);
  });

  it('starts with 100 health and places the flag at the Flag Site center, clear of player spawns', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Objective Setup' });
    await manager.join(blue, { name: 'Objective Setup' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });

    startGameplay(manager, red);
    const match = red.room.match;
    const blueSite = match.map.spawnZones.blue;
    assert.equal(match.flag.x, blueSite.x + blueSite.width / 2);
    assert.equal(match.flag.y, blueSite.y + blueSite.height / 2);
    assert.equal(match.flag.heldBy, null);
    assert.equal(match.flag.dropped, false);
    assert.equal(match.flag.lastDroppedBy, null);
    assert.ok(match.players.every((player) => Math.hypot(match.flag.x - player.x, match.flag.y - player.y) > 35));
    assert.deepEqual(match.players.map((player) => [player.health, player.alive]), [[100, true], [100, true]]);
  });

  it('allows only the Strike Team to pick up the flag and requires the dropper to leave before reclaiming', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Flag Pickup' });
    await manager.join(blue, { name: 'Flag Pickup' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = startGameplay(manager, red);
    const match = red.room.match;
    const bluePlayer = match.players.find((player) => player.id === blue.id);
    const redPlayer = match.players.find((player) => player.id === red.id);

    bluePlayer.x = match.flag.x;
    bluePlayer.y = match.flag.y;
    redPlayer.x = match.map.spawnZones.red.x + match.map.spawnZones.red.width / 2;
    redPlayer.y = match.map.spawnZones.red.y + match.map.spawnZones.red.height / 2;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, null, 'Blue cannot pick up the flag');

    redPlayer.x = red.room.match.flag.x;
    redPlayer.y = red.room.match.flag.y;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, red.id);

    manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: false, drop: true },
    });
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, null);
    assert.equal(red.room.match.flag.dropped, true);
    assert.equal(red.room.match.flag.lastDroppedBy, red.id);
    assert.equal(red.room.match.flag.x, redPlayer.x);
    assert.equal(red.room.match.flag.y, redPlayer.y);

    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, null,
      'the dropper cannot immediately pick the flag back up');
    assert.equal(red.room.match.flag.lastDroppedBy, red.id);

    redPlayer.x = red.room.match.flag.x + 27;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, null,
      'leaving the pickup radius does not pick the flag up');
    assert.equal(red.room.match.flag.lastDroppedBy, null,
      'the dropper becomes eligible after leaving the pickup radius');

    redPlayer.x = red.room.match.flag.x;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, red.id,
      'the dropper can reclaim the flag after re-entering the pickup radius');
  });

  it('uses configured assault-rifle movement and slows flag carriers to 70%', async () => {
    let now = 5000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Carrier Speed' });
    await manager.join(blue, { name: 'Carrier Speed' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    for (const player of match.players) {
      player.x = 750;
      player.y = 500;
    }
    match.flag.heldBy = red.id;
    for (const player of match.players) {
      manager.updateGameInput(player.id === red.id ? red : blue, {
        sequence: 1,
        input: { up: false, down: false, left: false, right: true },
      });
    }

    manager.advanceGames(0.05);
    let redPlayer = match.players.find((player) => player.id === red.id);
    let bluePlayer = match.players.find((player) => player.id === blue.id);
    assert.equal(redPlayer.vx, 8.75);
    assert.equal(bluePlayer.vx, 250 * DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale * 0.05);

    for (let frame = 1; frame < 20; frame += 1) manager.advanceGames(0.05);
    redPlayer = match.players.find((player) => player.id === red.id);
    bluePlayer = match.players.find((player) => player.id === blue.id);
    assert.ok(Math.abs(Math.hypot(redPlayer.vx, redPlayer.vy) - MAX_PLAYER_SPEED * 0.7) < 1e-9);
    assert.ok(Math.abs(Math.hypot(bluePlayer.vx, bluePlayer.vy) -
      MAX_PLAYER_SPEED * DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale) < 1e-9);
  });

  it('applies slow-walk after weapon movement scaling on the server', async () => {
    let now = 6_000;
    const manager = new RoomManager({ now: () => now });
    const player = createClient();
    const opponent = createClient();
    await manager.createAndJoin(player, { name: 'Slow Walk Movement' });
    await manager.join(opponent, { name: 'Slow Walk Movement' });
    startGameplay(manager, player);
    const room = player.room;
    room.match.map.objects = [];
    const matchPlayer = room.match.players.find((entry) => entry.id === player.id);
    Object.assign(matchPlayer, { x: 500, y: 500, vx: 0, vy: 0 });

    for (let sequence = 1; sequence <= 40; sequence += 1) {
      now += 50;
      manager.updateGameInput(player, {
        sequence,
        input: { up: false, down: false, left: false, right: true, speedScale: 0.6 },
      });
      manager.advanceGames(0.05);
    }

    assert.ok(Math.abs(matchPlayer.vx - MAX_PLAYER_SPEED *
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale * 0.6) < 1e-9);
  });

  it('emits enemy footsteps for unflashed listeners within 300 units above 80% normal speed', async () => {
    let now = 7_000;
    const manager = new RoomManager({ now: () => now });
    const strike = createClient();
    const closeFlag = createClient();
    const edgeFlag = createClient();
    const distantFlag = createClient();
    await manager.createAndJoin(strike, { name: 'Footstep Range' });
    await manager.join(closeFlag, { name: 'Footstep Range' });
    await manager.join(edgeFlag, { name: 'Footstep Range' });
    await manager.join(distantFlag, { name: 'Footstep Range' });
    manager.setPlayerTeam(strike, { team: 'red' });
    manager.setPlayerTeam(closeFlag, { team: 'blue' });
    manager.setPlayerTeam(edgeFlag, { team: 'blue' });
    manager.setPlayerTeam(distantFlag, { team: 'blue' });
    startGameplay(manager, strike);

    const room = strike.room;
    const source = room.match.players.find((player) => player.id === strike.id);
    const nearby = room.match.players.find((player) => player.id === closeFlag.id);
    const edge = room.match.players.find((player) => player.id === edgeFlag.id);
    const distant = room.match.players.find((player) => player.id === distantFlag.id);
    Object.assign(source, { x: 300, y: 300, vx: 60, vy: 0 });
    Object.assign(nearby, { x: 390, y: 300, flashUntil: now + 1_000 });
    Object.assign(edge, { x: 600, y: 300 });
    Object.assign(distant, { x: 601, y: 300 });

    const firstCues = manager.collectFootstepAudioCues(room, now);
    assert.deepEqual(firstCues.map((cue) => cue.heardById), [edgeFlag.id],
      'a flashed nearest teammate cannot provide audio intel');
    assert.ok(firstCues.every((cue) => cue.team === 'blue' && cue.kind === 'footstep'));
    assert.ok(firstCues.every((cue) => Math.hypot(source.x - cue.x, source.y - cue.y) <= cue.radius),
      'the footstep uncertainty area contains the moving source');

    now += 100;
    assert.deepEqual(manager.collectFootstepAudioCues(room, now), [], 'footsteps are rate-limited per source and team');

    now += 400;
    source.vx = MAX_PLAYER_SPEED * DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale * 0.6;
    assert.deepEqual(manager.collectFootstepAudioCues(room, now), [], 'slow walking stays below the footstep threshold');
  });

  it('records bot-heard footsteps as team audio intel for every teammate', async () => {
    let now = 7_500;
    const manager = new RoomManager({ now: () => now });
    const runner = createClient();
    await manager.createAndJoin(runner, { name: 'Bot Footstep Hearing' });
    manager.setBotTeam(runner, { botId: 'bot-1', team: 'red' });
    manager.setPlayerTeam(runner, { team: 'blue' });
    startGameplay(manager, runner);

    const room = runner.room;
    const source = room.match.players.find((player) => player.id === runner.id);
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    Object.assign(source, { x: 300, y: 300, vx: 60, vy: 0 });
    Object.assign(bot, { x: 390, y: 300 });

    const [relayedCue] = manager.collectFootstepAudioCues(room, now);
    assert.ok(relayedCue, 'the team cue is returned for server broadcast');
    assert.equal(relayedCue.team, bot.team);
    assert.equal(relayedCue.heardById, bot.id);
    const [cue] = room.match.botNoises.filter((noise) => noise.kind === 'footstep');
    assert.ok(cue);
    assert.equal(cue.heardById, bot.id);
    assert.equal('botId' in cue, false, 'the sound is shared team intel, not bot-private intel');
    assert.equal(cue.team, bot.team);
    assert.ok(Math.hypot(source.x - cue.x, source.y - cue.y) <= cue.radius,
      'the approximate cue area contains the moving source');

    Object.assign(bot, { x: 601, y: 300 });
    now += 500;
    manager.collectFootstepAudioCues(room, now);
    assert.equal(room.match.botNoises.filter((noise) => noise.kind === 'footstep').length, 1,
      'a source outside the 300-unit hearing radius of every teammate produces no additional cue');
  });

  it('does not emit a footstep cue when any teammate can already see its source', async () => {
    let now = 8_000;
    const manager = new RoomManager({ now: () => now });
    const runner = createClient();
    const listener = createClient();
    await manager.createAndJoin(runner, { name: 'Visible Footsteps' });
    await manager.join(listener, { name: 'Visible Footsteps' });
    manager.setPlayerTeam(runner, { team: 'red' });
    manager.setPlayerTeam(listener, { team: 'blue' });
    startGameplay(manager, runner);

    const room = runner.room;
    room.match.map.objects = [];
    const source = room.match.players.find((player) => player.id === runner.id);
    const observer = room.match.players.find((player) => player.id === listener.id);
    Object.assign(source, { x: 300, y: 300, vx: 60, vy: 0 });
    Object.assign(observer, { x: 390, y: 300, visionAngle: Math.PI });

    assert.deepEqual(manager.collectFootstepAudioCues(room, now), []);
    assert.equal(room.match.botNoises.filter((cue) => cue.kind === 'footstep').length, 0,
      'known visible positions are not redundantly represented as audio uncertainty');
  });

  it('creates authoritative bullets only for valid live-player shots', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Projectile Firing' });
    await manager.join(blue, { name: 'Projectile Firing' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);

    const { projectile } = manager.fireProjectile(red, { direction: { x: 3, y: 4 } });
    const shooter = red.room.match.players.find((player) => player.id === red.id);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    assert.equal(projectile.ownerId, red.id);
    assert.deepEqual(projectile.start, getWeaponMuzzlePosition(shooter, projectile.aimAngle, 0));
    assert.equal(projectile.baseDamage, weapon.damage);
    assert.equal('projectiles' in red.room.match, false, 'rounds are resolved immediately rather than retained on the server');
    assert.equal(projectile.speed, weapon.speed);
    assert.equal(shooter.weaponStats[weapon.id].cooldownEndsAt, red.nextProjectileAt);
    assert.equal(projectile.accuracy,
      weapon.accuracy.startingAccuracy ?? weapon.accuracy.maxAccuracy ?? 1,
      'stationary first shot retains configured starting accuracy');
    assert.ok(Math.hypot(projectile.end.x - projectile.start.x, projectile.end.y - projectile.start.y) <= weapon.range);
    assert.deepEqual(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }), { projectile: null, accepted: false });
    const redState = red.room.match.players.find((player) => player.id === red.id).weaponStats[weapon.id];
    assert.equal(redState.shotsFired, 1);
    assert.equal(redState.ammo, weapon.magazineSize - 1);
    assert.throws(() => manager.fireProjectile(blue, { type: 'laser', direction: { x: 1, y: 0 } }), /not available/);
    assert.equal(manager.fireProjectile(blue, { direction: { x: 0, y: 0 } }).accepted, true, 'zero aim falls back to the last valid facing');
  });

  it('resolves owner-computed shots without letting stale server weapon state block them', async () => {
    let now = 50_000;
    const manager = new BaseRoomManager({ now: () => now, randomTeam: () => 0 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Owner Weapon State' });
    await manager.join(blue, { name: 'Owner Weapon State' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const shooter = red.room.match.players.find((player) => player.id === red.id);
    const state = shooter.weaponStats['assault-rifle'];
    state.ammo = 0;
    state.reloading = true;
    state.manualActionEndsAt = now + 5_000;
    red.nextProjectileAt = now + 5_000;
    const aimAngle = 0.35;
    const lean = 1;
    const playerPose = { x: shooter.x + 7, y: shooter.y + 5, vx: 80, vy: -12 };
    const result = manager.fireProjectile(red, {
      type: 'assault-rifle',
      direction: { x: Math.cos(aimAngle), y: Math.sin(aimAngle) },
      shotAngle: aimAngle,
      shotAngles: [aimAngle],
      actionSequence: 12,
      weaponLean: lean,
      playerPose,
      localAuthority: true,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.projectile.ownerActionSequence, 12);
    assert.ok(Math.abs(result.projectile.aimAngle - aimAngle) < 1e-12);
    assert.deepEqual(result.projectile.start,
      getWeaponMuzzlePosition({ ...shooter, ...playerPose }, aimAngle, lean, red.room.match.map.objects));
    assert.equal(shooter.weaponLean, lean);
    assert.equal(state.ammo, 0, 'the server mirror does not override the owner’s ammunition state');
  });

  it('lets default weapons pass through teammates without friendly damage', async () => {
    const manager = new RoomManager();
    const shooterClient = createClient();
    const teammateClient = createClient();
    const opponentClient = createClient();
    await manager.createAndJoin(shooterClient, { name: 'Friendly Fire' });
    await manager.join(teammateClient, { name: 'Friendly Fire' });
    await manager.join(opponentClient, { name: 'Friendly Fire' });
    manager.setPlayerTeam(shooterClient, { team: 'red' });
    manager.setPlayerTeam(teammateClient, { team: 'red' });
    manager.setPlayerTeam(opponentClient, { team: 'blue' });
    startGameplay(manager, shooterClient);

    const { match } = shooterClient.room;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === shooterClient.id);
    const teammate = match.players.find((player) => player.id === teammateClient.id);
    const opponent = match.players.find((player) => player.id === opponentClient.id);
    teammate.armor = 0;
    teammate.maxArmor = 0;
    opponent.armor = 0;
    opponent.maxArmor = 0;
    Object.assign(shooter, { x: 200, y: 200 });
    Object.assign(teammate, { x: 300, y: 200 });
    Object.assign(opponent, { x: 400, y: 200 });

    const { projectile } = manager.fireProjectile(shooterClient, { direction: { x: 1, y: 0 } });

    assert.equal(projectile.hitPlayerId, opponentClient.id,
      'the projectile ignores the teammate and continues to the opponent behind them');
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    assert.equal(projectile.damage, getProjectileDamage(
      weapon,
      0,
      undefined,
      Math.hypot(opponent.x - projectile.start.x, opponent.y - projectile.start.y),
    ));
    assert.equal(teammate.health, 100, 'the teammate takes no damage');
    assert.equal(opponent.health, 100 - projectile.damage, 'the opponent behind the teammate takes the shot');
  });

  it('fires clustered shotgun pellets and reloads one shell at a time, interrupting when fired', async () => {
    let now = 22_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const red = createClient();
    const blue = createClient();
    const blueReserve = createClient();
    await manager.createAndJoin(red, { name: 'Shotgun Shell Reload' });
    await manager.join(blue, { name: 'Shotgun Shell Reload' });
    await manager.join(blueReserve, { name: 'Shotgun Shell Reload' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    manager.setPlayerTeam(blueReserve, { team: 'blue' });
    const started = manager.startMatch(red);
    manager.selectWeapon(red, { weaponId: 'shotgun' });
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);

    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    const reserve = match.players.find((player) => player.id === blueReserve.id);
    Object.assign(shooter, { x: 200, y: 300 });
    Object.assign(target, { x: 260, y: 300 });
    Object.assign(reserve, { x: 900, y: 800 });
    const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;
    assert.equal(shot.projectiles.length, weapon.pelletCount);
    assert.equal(new Set(shot.projectiles.map((pellet) => pellet.id)).size, weapon.pelletCount);
    assert.ok(shot.projectiles.every((pellet) => pellet.aimAngle === shooter.weaponStats.shotgun.aimAngle),
      'shot metadata keeps the server weapon facing separate from per-pellet spread');
    assert.ok(shot.projectiles.some((pellet) => pellet.hitPlayerId === blue.id));
    assert.ok(target.health < 100, 'multiple pellets can damage the target');
    assert.equal(shooter.weaponStats[weapon.id].ammo, weapon.magazineSize - 1, 'one shell is consumed per trigger pull');
    assert.equal(shooter.weaponStats[weapon.id].manualActionEndsAt, now + weapon.manualActionDurationMs,
      'the pump cycle starts after firing');
    red.nextProjectileAt = now;
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, false,
      'the pump-action timer blocks firing another shell');

    now += weapon.manualActionDurationMs;
    manager.advanceGames(0);
    const reloadStartAmmo = Math.max(0, weapon.magazineSize - 2);
    Object.assign(shooter.weaponStats[weapon.id], {
      ammo: reloadStartAmmo,
      reloading: false,
      reloadStartedAt: null,
      reloadEndsAt: null,
      reloadRoundsInserted: null,
    });
    assert.deepEqual(manager.beginWeaponReload(red), {
      accepted: true,
      reloadEndsAt: now + weapon.reloadIntervalMs[0],
    }, 'the per-round reload begins with the configured first interval');
    const roundsToFull = weapon.magazineSize - reloadStartAmmo;
    for (let round = 0; round < roundsToFull; round += 1) {
      const interval = weapon.reloadIntervalMs[Math.min(round, weapon.reloadIntervalMs.length - 1)];
      now += interval - 1;
      manager.advanceGames(0.05);
      assert.equal(shooter.weaponStats[weapon.id].ammo, reloadStartAmmo + round,
        'a shell is not inserted before its configured interval');
      now += 1;
      manager.advanceGames(0.05);
      assert.equal(shooter.weaponStats[weapon.id].ammo, reloadStartAmmo + round + 1,
        'one shell is inserted at each configured interval');
      if (round + 1 < roundsToFull) {
        const nextInterval = weapon.reloadIntervalMs[Math.min(round + 1, weapon.reloadIntervalMs.length - 1)];
        assert.equal(shooter.weaponStats[weapon.id].reloadEndsAt, now + nextInterval);
      }
    }
    assert.equal(shooter.weaponStats[weapon.id].reloading, false, 'reload completes at configured magazine capacity');

    if (weapon.magazineSize > 1) {
      const partialReloadAmmo = weapon.magazineSize - 2;
      shooter.weaponStats[weapon.id].ammo = partialReloadAmmo;
      assert.deepEqual(manager.beginWeaponReload(red), {
        accepted: true,
        reloadEndsAt: now + weapon.reloadIntervalMs[0],
      });
      now += weapon.reloadIntervalMs[0];
      manager.advanceGames(0.05);
      assert.equal(shooter.weaponStats[weapon.id].ammo, partialReloadAmmo + 1);
      red.nextProjectileAt = now;
      const interruptedShot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
      assert.equal(interruptedShot.accepted, true, 'a loaded shell can fire during reload');
      assert.equal(shooter.weaponStats[weapon.id].reloading, false);
      assert.equal(shooter.weaponStats[weapon.id].ammo, partialReloadAmmo);
    }
  });

  it('performs the pending pump action after the first mandatory reload shell, then continues reloading', async () => {
    let now = 22_500;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Mandatory Shotgun Reload' });
    await manager.join(blue, { name: 'Mandatory Shotgun Reload' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = manager.startMatch(red);
    manager.selectWeapon(red, { weaponId: 'shotgun' });
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);

    const player = red.room.match.players.find((entry) => entry.id === red.id);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;
    player.weaponStats[weapon.id].ammo = 1;
    const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
    assert.equal(shot.accepted, true);
    let state = player.weaponStats[weapon.id];
    assert.equal(state.reloading, true);
    assert.equal(state.manualActionQueuedDurationMs, weapon.manualActionDurationMs);

    now = state.reloadEndsAt;
    manager.advanceGames(0.05);
    state = player.weaponStats[weapon.id];
    assert.equal(state.ammo, 1);
    assert.equal(state.reloading, false);
    assert.equal(state.reloadPaused, true);
    assert.equal(state.manualActionStartedAt, now);

    now = state.manualActionEndsAt;
    manager.advanceGames(0.05);
    state = player.weaponStats[weapon.id];
    assert.equal(state.reloading, true);
    assert.equal(state.reloadPaused, false);
    assert.equal(state.reloadEndsAt, now + weapon.reloadIntervalMs[1]);
  });

  it('fires and reloads the new pistol-class machine pistol and pocket shotgun', async () => {
    let now = 28_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Pocket Sidearms' });
    await manager.join(blue, { name: 'Pocket Sidearms' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = manager.startMatch(red);
    manager.selectWeapon(red, { weaponId: 'machine-pistol' });
    manager.selectWeapon(blue, { weaponId: 'pocket-shotgun' });
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);

    const match = red.room.match;
    match.map.objects = [];
    const machinePistol = DEFAULT_PROJECTILE_DEFINITIONS.machinePistol;
    const pocketShotgun = DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun;
    const machineUser = match.players.find((player) => player.id === red.id);
    const shotgunUser = match.players.find((player) => player.id === blue.id);
    Object.assign(machineUser, { x: 250, y: 300 });
    Object.assign(shotgunUser, { x: 750, y: 300 });

    const machineShot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
    assert.equal(machineShot.projectile.type, 'machine-pistol');
    assert.equal(machineShot.projectile.baseDamage, machinePistol.damage);
    assert.equal(machineUser.weaponStats[machinePistol.id].ammo, machinePistol.magazineSize - 1);

    const pocketShot = manager.fireProjectile(blue, { direction: { x: -1, y: 0 } });
    assert.equal(pocketShot.projectiles.length, pocketShotgun.pelletCount);
    assert.ok(pocketShot.projectiles.every((pellet) => pellet.baseDamage === pocketShotgun.damage));
    assert.equal(shotgunUser.weaponStats[pocketShotgun.id].ammo, pocketShotgun.magazineSize - 1);
    assert.deepEqual(manager.beginWeaponReload(blue), {
      accepted: true,
      reloadEndsAt: now + pocketShotgun.reloadDurationMs,
    });
  });

  it('fires and reloads the new long-gun classes using their configured stats', async () => {
    let now = 31_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const clients = Array.from({ length: 4 }, () => createClient());
    await manager.createAndJoin(clients[0], { name: 'New Long Guns' });
    for (const client of clients.slice(1)) await manager.join(client, { name: 'New Long Guns' });
    for (const [index, client] of clients.entries()) {
      manager.setPlayerTeam(client, { team: index % 2 === 0 ? 'red' : 'blue' });
    }

    const weapons = [
      DEFAULT_PROJECTILE_DEFINITIONS.marksmanRifle,
      DEFAULT_PROJECTILE_DEFINITIONS.heavySniper,
      DEFAULT_PROJECTILE_DEFINITIONS.battleRifle,
      DEFAULT_PROJECTILE_DEFINITIONS.machineGun,
    ];
    const started = manager.startMatch(clients[0]);
    for (const [index, client] of clients.entries()) {
      manager.selectWeapon(client, { weaponId: weapons[index].id });
    }
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);

    const match = clients[0].room.match;
    match.map.objects = [];
    const players = weapons.map((weapon, index) => {
      const player = match.players.find((candidate) => candidate.id === clients[index].id);
      Object.assign(player, { x: 200 + index * 180, y: 300 + index * 100 });
      const shot = manager.fireProjectile(clients[index], { direction: { x: 1, y: 0 } });
      assert.equal(shot.projectile.baseDamage, weapon.damage, `${weapon.id} uses configured damage`);
      assert.equal(player.weaponStats[weapon.id].ammo, weapon.magazineSize - 1,
        `${weapon.id} consumes one configured magazine round`);
      if (weapon.manualActionDurationMs) {
        assert.equal(player.weaponStats[weapon.id].manualActionEndsAt,
          now + weapon.manualActionDurationMs, `${weapon.id} starts its configured action cycle`);
        assert.equal(manager.fireProjectile(clients[index], { direction: { x: 1, y: 0 } }).accepted, false,
          `${weapon.id} blocks another shot during its action cycle`);
      }
      if (weapon.weaponClass === 'machine-gun') {
        const shotTime = now;
        now += weapon.cooldownMs - 1;
        assert.equal(manager.fireProjectile(clients[index], { direction: { x: 1, y: 0 } }).accepted, false,
          'the machine gun enforces its configured fire interval');
        now += 1;
        assert.equal(manager.fireProjectile(clients[index], { direction: { x: 1, y: 0 } }).accepted, true,
          'the machine gun fires again when its configured interval elapses');
        assert.equal(player.weaponStats[weapon.id].ammo, weapon.magazineSize - 2);
        now = shotTime;
      }
      const reloadDuration = weapon.reloadPerRound
        ? weapon.reloadIntervalMs[0]
        : weapon.reloadDurationMs;
      assert.deepEqual(manager.beginWeaponReload(clients[index]), {
        accepted: true,
        reloadEndsAt: now + reloadDuration,
      }, `${weapon.id} starts its configured reload`);
      return player;
    });

    const reloadStart = now;
    const marksman = weapons[0];
    now = reloadStart + marksman.reloadIntervalMs[0];
    manager.advanceGames(0.05);
    assert.equal(players[0].weaponStats[marksman.id].ammo, marksman.magazineSize,
      'the lever-action rifle reloads one round at a time');
    assert.equal(players[0].weaponStats[marksman.id].reloading, false);

    const longestMagazineReload = Math.max(...weapons
      .filter((weapon) => !weapon.reloadPerRound)
      .map((weapon) => weapon.reloadDurationMs));
    now = reloadStart + longestMagazineReload;
    manager.advanceGames(0.05);
    for (const [index, weapon] of weapons.entries()) {
      assert.equal(players[index].weaponStats[weapon.id].ammo, weapon.magazineSize,
        `${weapon.id} reloads to its configured capacity`);
      assert.equal(players[index].weaponStats[weapon.id].reloading, false,
        `${weapon.id} finishes reloading`);
    }
  });

  it('enforces the battle-pistol burst cadence and delay between bursts', async () => {
    let now = 30_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Battle Pistol Burst' });
    await manager.join(blue, { name: 'Battle Pistol Burst' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = manager.startMatch(red);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.battlePistol;
    manager.selectWeapon(red, { weaponId: weapon.id });
    now = started.match.gameplayStartsAt;
    manager.advanceGames(0);
    const shooter = red.room.match.players.find((player) => player.id === red.id);

    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).projectile.baseDamage, weapon.damage);
    for (let shotIndex = 1; shotIndex < weapon.burstCount; shotIndex += 1) {
      assert.equal(shooter.weaponStats[weapon.id].burstShotsRemaining, weapon.burstCount - shotIndex);
      now += weapon.burstShotIntervalMs;
      assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, true);
    }
    assert.equal(shooter.weaponStats[weapon.id].burstShotsRemaining, 0);
    assert.equal(shooter.weaponStats[weapon.id].ammo, weapon.magazineSize - weapon.burstCount);
    assert.equal(shooter.weaponStats[weapon.id].cooldownEndsAt, now + weapon.burstDelayMs);
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, false);
    now += weapon.burstDelayMs - 1;
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, false);
    now += 1;
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, true);
  });

  it('spawns shots from the selected leaned gun muzzle and snapshots the lean state', async () => {
    let now = 12_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Leaning' });
    await manager.join(blue, { name: 'Leaning' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const state = startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    Object.assign(shooter, { x: 300, y: 300 });

    manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: false, right: false, weaponLean: -1 },
    });
    const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).projectile;

    assert.equal(shooter.weaponLean, -1);
    assert.deepEqual(shot.start, getWeaponMuzzlePosition(shooter, shot.aimAngle, -1));
    assert.equal(manager.toRoomState(red.room).match.players.find((player) => player.id === red.id).weaponLean, -1);
    assert.equal(state.match.players.find((player) => player.id === red.id).weaponLean, 0);

    now += 300;
    manager.advanceGames(0.05);
    assert.equal(shooter.weaponLean, 0, 'stale input releases a momentary weapon lean');
  });

  it('keeps lean at full speed while held and recenters when lean input is released', async () => {
    let now = 20_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Sprint Lean Reset' });
    await manager.join(blue, { name: 'Sprint Lean Reset' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const player = match.players.find((entry) => entry.id === red.id);
    Object.assign(player, { x: 300, y: 300, vx: 90, vy: 0, weaponLean: 0 });

    for (let frame = 1; frame <= 20; frame += 1) {
      now += 50;
      manager.updateGameInput(red, {
        sequence: frame,
        input: { up: false, down: false, left: false, right: true, weaponLean: -1 },
      });
      manager.advanceGames(0.05);
    }
    assert.ok(Math.abs(player.vx - MAX_PLAYER_SPEED * DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale) < 1e-9);
    assert.equal(player.weaponLean, -1, 'lean remains active through sustained full-speed movement');

    now += 50;
    manager.updateGameInput(red, {
      sequence: 21,
      input: { up: false, down: false, left: false, right: true, weaponLean: 0 },
    });
    manager.advanceGames(0.05);

    assert.equal(player.weaponLean, 0);
    assert.equal(red.roomInput.weaponLean, 0);
  });

  it('uses the Assault Rifle magazine and enforces its configured reload duration', async () => {
    let now = 5000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Assault Rifle Reload' });
    await manager.join(blue, { name: 'Assault Rifle Reload' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    Object.assign(shooter, { x: 200, y: 200 });
    Object.assign(target, { x: 200, y: 800 });
    assert.equal(shooter.weaponStats[weapon.id].ammo, weapon.magazineSize);

    for (let shotIndex = 0; shotIndex < weapon.magazineSize; shotIndex += 1) {
      const shot = manager.fireProjectile(red, { direction: { x: 1, y: 0 } });
      assert.equal(shot.accepted, true);
      now += weapon.cooldownMs;
    }
    const remainingReloadMs = weapon.reloadDurationMs - weapon.cooldownMs;
    assert.equal(shooter.weaponStats[weapon.id].ammo, 0);
    assert.equal(shooter.weaponStats[weapon.id].reloading, true, 'an empty magazine starts reloading automatically');
    assert.equal(shooter.weaponStats[weapon.id].reloadEndsAt, now + remainingReloadMs);
    assert.deepEqual(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }), { projectile: null, accepted: false });

    const reload = manager.beginWeaponReload(red);
    assert.deepEqual(reload, { accepted: false }, 'manual reload does not restart an automatic reload');
    assert.equal(shooter.weaponStats[weapon.id].reloading, true);
    assert.equal(manager.fireProjectile(red, { direction: { x: 1, y: 0 } }).accepted, false);
    now += remainingReloadMs - 1;
    manager.advanceGames(0.05);
    assert.equal(shooter.weaponStats[weapon.id].ammo, 0);
    assert.equal(shooter.weaponStats[weapon.id].reloading, true);
    now += 1;
    manager.advanceGames(0.05);
    assert.equal(shooter.weaponStats[weapon.id].ammo, weapon.magazineSize);
    assert.equal(shooter.weaponStats[weapon.id].reloading, false);
  });

  it('does not regenerate player health during match updates', async () => {
    let now = 20_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'No Health Regen' });
    await manager.join(blue, { name: 'No Health Regen' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const player = red.room.match.players.find((entry) => entry.id === red.id);
    player.health = 63;

    now += 60_000;
    manager.advanceGames(60);

    assert.equal(player.health, 63, 'health remains unchanged without taking damage');
  });

  it('limits authoritative aim rotation according to each weapon weight', async () => {
    let now = 10_000;
    const manager = new RoomManager({
      now: () => now,
      projectileDefinitions: {
        heavy: {
          id: 'heavy',
          damage: 10,
          speed: 100,
          radius: 1,
          range: 500,
          cooldownMs: 0,
          weight: 4,
          accuracy: { maxSpreadDegrees: 0, recoilPerShot: 0, recoveryPerSecond: 0, movementPenaltyAtMaxSpeed: 0 },
        },
      },
    });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Weapon Turning' });
    await manager.join(blue, { name: 'Weapon Turning' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const shooter = red.room.match.players.find((player) => player.id === red.id);

    now += 100;
    manager.updateGameAim(red, { type: 'heavy', direction: { x: 0, y: 1 } });
    assert.ok(Math.abs(shooter.weaponStats.heavy.aimAngle - Math.PI / 4) < 1e-9);
    now += 100;
    manager.updateGameAim(red, { type: 'heavy', direction: { x: 0, y: 1 } });
    assert.ok(Math.abs(shooter.weaponStats.heavy.aimAngle - Math.PI / 2) < 1e-9);

    assert.deepEqual(manager.updateGameAim(red, { type: 'heavy', direction: { x: null, y: null } }), {
      accepted: false,
      aimAngle: shooter.weaponStats.heavy.aimAngle,
    });
    const shot = manager.fireProjectile(red, { type: 'heavy', direction: { x: null, y: null } }).projectile;
    assert.equal(shot.aimAngle, shooter.weaponStats.heavy.aimAngle);
    assert.ok(shot.end.y > shot.start.y, 'shot follows the authoritative weapon facing, not a faster client-provided direction');
    assert.ok(Math.abs((shot.end.y - shot.start.y) / (shot.end.x - shot.start.x)) > 1000);

    now += 50;
    const nextPredictedAngle = Math.PI / 2 + Math.PI * 50 / 400;
    const acceptedAim = manager.updateGameAim(red, {
      type: 'heavy',
      direction: { x: Math.cos(nextPredictedAngle), y: Math.sin(nextPredictedAngle) },
    });
    assert.ok(Math.abs(acceptedAim.aimAngle - nextPredictedAngle) < 1e-9);
    const alignedShot = manager.fireProjectile(red, {
      type: 'heavy',
      direction: { x: Math.cos(nextPredictedAngle), y: Math.sin(nextPredictedAngle) },
    }).projectile;
    assert.ok(Math.abs(alignedShot.aimAngle - nextPredictedAngle) < 1e-9);

    shooter.alive = false;
    shooter.health = 0;
    assert.deepEqual(manager.updateGameAim(red, {
      type: 'heavy',
      direction: { x: 1, y: 0 },
    }), { accepted: false }, 'late aim updates from a dead player are ignored without an error');
    assert.ok(Math.abs(shooter.weaponStats.heavy.aimAngle - nextPredictedAngle) < 1e-9,
      'a stale aim update does not change the final authoritative aim');
  });

  it('applies movement penalties and recovers accuracy for each weapon independently', async () => {
    let now = 1000;
    const manager = new RoomManager({
      now: () => now,
      projectileDefinitions: {
        rifle: { id: 'rifle', damage: 10, speed: 100, radius: 1, range: 1000, cooldownMs: 0, accuracy: { recoilPerShot: 0.2, recoveryPerSecond: 0.5, movementPenaltyAtMaxSpeed: 0.4 } },
        sidearm: { id: 'sidearm', damage: 5, speed: 100, radius: 1, range: 1000, cooldownMs: 0, accuracy: { recoilPerShot: 0.05, recoveryPerSecond: 0.1, movementPenaltyAtMaxSpeed: 0.2 } },
      },
    });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Weapon Accuracy' });
    await manager.join(blue, { name: 'Weapon Accuracy' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    shooter.x = 200;
    shooter.y = 200;
    shooter.vx = 100;

    const shot = manager.fireProjectile(red, { type: 'rifle', direction: { x: 1, y: 0 } });
    assert.ok(Math.abs(shot.projectile.accuracy - 0.6) < 1e-9, 'maximum movement applies the configured accuracy penalty');
    assert.equal(shooter.weaponStats.rifle.accuracy, 0.8);
    assert.equal(shooter.weaponStats.sidearm.accuracy, 1, 'recoil on one weapon does not affect another weapon');

    now += 1000;
    for (let frame = 0; frame < 20; frame += 1) manager.advanceGames(0.05);
    assert.equal(shooter.weaponStats.rifle.accuracy, 1);
    assert.equal(shooter.weaponStats.sidearm.accuracy, 1);
  });

  it('damages enemies with center-to-edge projectile falloff without health regeneration', async () => {
    let now = 1000;
    const manager = new RoomManager({
      now: () => now,
      projectileDefinitions: {
        test: { id: 'test', damage: 40, centerDamageMultiplier: 1, edgeDamageMultiplier: 0.01, speed: 2000, radius: 2, range: 500, cooldownMs: 0 },
      },
    });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Projectile Damage' });
    await manager.join(blue, { name: 'Projectile Damage' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    target.armor = 0;
    target.maxArmor = 0;
    shooter.x = target.x - 100;
    shooter.y = target.y;
    target.health = 60;
    const centerResult = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } });
    const centerShot = centerResult.projectile;
    assert.equal(centerShot.hitPlayerId, blue.id);
    assert.equal(centerShot.damage, 40);
    assert.equal(target.health, 20, 'server applies damage as part of authoritative shot resolution');
    assert.equal(centerResult.damageCues.length, 1);
    assert.equal(centerResult.damageCues[0].victimId, blue.id);
    assert.equal(centerResult.damageCues[0].team, 'blue');
    assert.ok(Math.abs(Math.abs(centerResult.damageCues[0].bearing) - Math.PI) < 0.02,
      'the cue points back toward the incoming shot');
    assert.equal(centerResult.damageCues[0].expiresAt, now + 1_300);
    assert.equal(Object.hasOwn(centerResult.damageCues[0], 'ownerId'), false);
    assert.equal(Object.hasOwn(centerResult.damageCues[0], 'x'), false);
    assert.equal(Object.hasOwn(centerResult.damageCues[0], 'y'), false);

    manager.advanceGames(0.05);
    assert.equal(target.health, 20, 'damaged health remains unchanged over subsequent game ticks');
    assert.equal('projectiles' in match, false);

    target.health = 60;
    const edgeOffset = 9;
    shooter.x = target.x - 100;
    shooter.y = target.y + edgeOffset;
    match.players.find((player) => player.id === red.id).weaponStats.test.accuracy = 1;
    const edgeResult = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } });
    const edgeShot = edgeResult.projectile;
    assert.equal(edgeShot.hitPlayerId, blue.id);
    assert.equal(edgeShot.damage, 0.4);
    assert.equal(edgeResult.damageCues.length, 1, 'even small confirmed damage produces a directional cue');
    manager.advanceGames(0.05);
    assert.equal(target.health, 59.6, 'a physical-edge hit deals only 1% damage with no regeneration');

    target.health = 40;
    now += 1000;
    const noMovement = { up: false, down: false, left: false, right: false };
    manager.updateGameInput(blue, { sequence: 1, input: noMovement });
    for (let frame = 0; frame < 20; frame += 1) manager.advanceGames(0.05);
    assert.equal(target.health, 40, 'health does not regenerate during the match');
    target.health = 99.75;
    manager.advanceGames(0.05);
    assert.equal(target.health, 99.75, 'health remains capped at its current value without regeneration');
  });

  it('tracks kills, assists for any prior damage, and deaths in public match snapshots', async () => {
    let now = 100_000;
    const manager = new RoomManager({
      now: () => now,
      random: () => 0.5,
      projectileDefinitions: {
        assist: { id: 'assist', damage: 35, centerDamageMultiplier: 1, edgeDamageMultiplier: 1, speed: 2000, radius: 2, range: 500, cooldownMs: 0 },
        finisher: { id: 'finisher', damage: 100, centerDamageMultiplier: 1, edgeDamageMultiplier: 1, speed: 2000, radius: 2, range: 500, cooldownMs: 0 },
      },
    });
    const killerClient = createClient();
    const assisterClient = createClient();
    const victimClient = createClient();
    await manager.createAndJoin(killerClient, { name: 'Scoreboard Stats' });
    await manager.join(assisterClient, { name: 'Scoreboard Stats' });
    await manager.join(victimClient, { name: 'Scoreboard Stats' });
    manager.setPlayerTeam(killerClient, { team: 'red' });
    manager.setPlayerTeam(assisterClient, { team: 'red' });
    manager.setPlayerTeam(victimClient, { team: 'blue' });
    manager.startMatch(killerClient);
    manager.selectWeapon(assisterClient, { weaponId: 'assist' });
    manager.selectWeapon(killerClient, { weaponId: 'finisher' });
    const match = killerClient.room.match;
    now = match.gameplayStartsAt;
    match.map.objects = [];
    const killer = match.players.find((player) => player.id === killerClient.id);
    const assister = match.players.find((player) => player.id === assisterClient.id);
    const victim = match.players.find((player) => player.id === victimClient.id);
    Object.assign(killer, { x: 100, y: 300 });
    Object.assign(assister, { x: 100, y: 300 });
    Object.assign(victim, { x: 200, y: 300 });

    assert.equal(manager.fireProjectile(assisterClient, { type: 'assist', direction: { x: 1, y: 0 } }).projectile.hitPlayerId, victim.id);
    assert.equal(manager.fireProjectile(killerClient, { type: 'finisher', direction: { x: 1, y: 0 } }).projectile.hitPlayerId, victim.id);

    assert.deepEqual(killer.stats, { kills: 1, assists: 0, deaths: 0 });
    assert.deepEqual(assister.stats, { kills: 0, assists: 1, deaths: 0 });
    assert.deepEqual(victim.stats, { kills: 0, assists: 0, deaths: 1 });
    const snapshot = manager.toRoomState(killerClient.room).match;
    assert.deepEqual(snapshot.players.find((player) => player.id === assister.id).stats, assister.stats,
      'the scoreboard metrics are included in public game snapshots');
    assert.deepEqual(snapshot.players.find((player) => player.id === victim.id).deathAttribution, {
      killerId: killer.id,
      assisterIds: [assister.id],
    }, 'public death snapshots identify the killer and credited assists');
    assert.equal(Object.hasOwn(snapshot, 'damageContributions'), false,
      'internal assist bookkeeping is not exposed to clients');
  });

  it('stops each bullet at the first player or blocking surface on its path', async () => {
    const manager = new RoomManager({
      projectileDefinitions: {
        test: { id: 'test', damage: 60, centerDamageMultiplier: 1, edgeDamageMultiplier: 0.01, speed: 20_000, radius: 2, range: 500, cooldownMs: 0 },
      },
    });
    const red = createClient();
    const firstBlue = createClient();
    const secondBlue = createClient();
    await manager.createAndJoin(red, { name: 'Projectile Occlusion' });
    await manager.join(firstBlue, { name: 'Projectile Occlusion' });
    await manager.join(secondBlue, { name: 'Projectile Occlusion' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(firstBlue, { team: 'blue' });
    manager.setPlayerTeam(secondBlue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const blueOne = match.players.find((player) => player.id === firstBlue.id);
    const blueTwo = match.players.find((player) => player.id === secondBlue.id);
    blueOne.armor = 0;
    blueOne.maxArmor = 0;
    blueTwo.armor = 0;
    blueTwo.maxArmor = 0;
    Object.assign(shooter, { x: 300, y: 400 });
    Object.assign(blueOne, { x: 430, y: 400 });
    Object.assign(blueTwo, { x: 600, y: 400 });

    const playerImpact = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } }).projectile;
    assert.equal(playerImpact.hitType, 'player');
    assert.equal(playerImpact.hitPlayerId, firstBlue.id);
    assert.ok(playerImpact.end.x < blueTwo.x);
    assert.equal(blueOne.health, 40);
    assert.equal(blueTwo.health, 100);

    Object.assign(blueOne, { x: 550, y: 400, health: 100 });
    match.map.objects = [{ id: 'cover-wall', shape: 'segment', x1: 500, y1: 350, x2: 500, y2: 450, blocksProjectiles: true }];
    const surfaceImpact = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } }).projectile;
    assert.equal(surfaceImpact.hitType, 'surface');
    assert.equal(surfaceImpact.hitPlayerId, null);
    assert.ok(surfaceImpact.end.x < 500);
    assert.equal(blueOne.health, 100);
  });

  it('damages destructible props until their 300 health pool is depleted', async () => {
    const manager = new RoomManager({
      projectileDefinitions: {
        test: { id: 'test', damage: 100, centerDamageMultiplier: 1, edgeDamageMultiplier: 0.01,
          speed: 20_000, radius: 2, range: 500, cooldownMs: 0 },
      },
    });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Destructible Props' });
    await manager.join(blue, { name: 'Destructible Props' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    Object.assign(shooter, { x: 300, y: 400, visionAngle: 0 });
    Object.assign(target, { x: 700, y: 400 });
    match.map.objects = [{
      id: 'test-box', shape: 'rect', role: 'destructible-prop', propType: 'box',
      x: 450, y: 400, width: 24, height: 24, health: 300, maxHealth: 300,
      blocksMovement: true, blocksProjectiles: true, blocksVision: true,
    }];
    const prop = match.map.objects[0];

    for (const health of [200, 100]) {
      const impact = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } }).projectile;
      assert.equal(impact.hitType, 'surface');
      assert.equal(impact.objectId, prop.id);
      assert.equal(impact.objectHealth, health);
      assert.equal(impact.objectDestroyed, false);
      assert.ok(prop.blocksProjectiles);
      assert.ok(impact.end.x < prop.x);
    }

    const destruction = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } }).projectile;
    assert.equal(destruction.objectHealth, 0);
    assert.equal(destruction.objectDestroyed, true);
    assert.equal(prop.blocksMovement, false);
    assert.equal(prop.blocksProjectiles, false);
    assert.equal(prop.blocksVision, false);
    assert.deepEqual(manager.advanceGames(0)[0].matchByTeam.red.destructibleObjects, [{ id: prop.id, health: 0 }]);

    const throughShot = manager.fireProjectile(red, { type: 'test', direction: { x: 1, y: 0 } }).projectile;
    assert.notEqual(throughShot.objectId, prop.id);
    assert.ok(throughShot.end.x > prop.x + prop.width / 2,
      'subsequent shots pass through the destroyed prop');
  });

  it('shares prop health only after a teammate gets eyes on the object', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Prop Health Intel' });
    await manager.join(blue, { name: 'Prop Health Intel' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [{
      id: 'intel-box', shape: 'rect', role: 'destructible-prop', propType: 'box',
      x: 450, y: 400, width: 28, height: 28, health: 200, maxHealth: 300,
      blocksMovement: true, blocksProjectiles: true, blocksVision: true,
    }];
    const redPlayer = match.players.find((player) => player.id === red.id);
    const bluePlayer = match.players.find((player) => player.id === blue.id);
    Object.assign(redPlayer, { x: 300, y: 400, visionAngle: 0 });
    Object.assign(bluePlayer, { x: 300, y: 800, visionAngle: 0 });

    const redTeamPlayers = match.players.filter((player) => player.team === 'red');
    for (const player of redTeamPlayers) player.jammedUntil = Number.MAX_SAFE_INTEGER;
    const jammedSnapshot = manager.advanceGames(0)[0].matchByTeam;
    assert.deepEqual(jammedSnapshot.red.destructibleObjects, [],
      'a jammed teammate cannot publish destructible-object intel');
    for (const player of redTeamPlayers) delete player.jammedUntil;

    const firstSnapshot = manager.advanceGames(0)[0].matchByTeam;
    assert.deepEqual(firstSnapshot.red.destructibleObjects, [{ id: 'intel-box', health: 200 }]);
    assert.deepEqual(firstSnapshot.blue.destructibleObjects, [], 'the unseen opposing team receives no prop health');
    const publicSnapshot = manager.toRoomState(red.room).match;
    assert.equal(Object.hasOwn(publicSnapshot, 'destructibleObjectIntel'), false,
      'private team intel is not included in room-state snapshots');
    assert.equal(publicSnapshot.map.objects[0].health, 300,
      'the shared map geometry does not leak live server health');

    Object.assign(bluePlayer, { x: 600, y: 400, visionAngle: Math.PI });
    const spottedSnapshot = manager.advanceGames(0)[0].matchByTeam;
    assert.deepEqual(spottedSnapshot.blue.destructibleObjects, [{ id: 'intel-box', health: 200 }],
      'a teammate seeing the prop reveals its current health to the team');
  });

  it('marks lethal projectile hits as dead spectators and does not regenerate their health', async () => {
    let now = 1000;
    const manager = new RoomManager({
      now: () => now,
      projectileDefinitions: {
        lethal: { id: 'lethal', damage: 100, centerDamageMultiplier: 1, edgeDamageMultiplier: 0.01, speed: 1000, radius: 1, range: 500, cooldownMs: 0 },
      },
    });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Spectator Death' });
    await manager.join(blue, { name: 'Spectator Death' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    const match = red.room.match;
    match.map.objects = [];
    const shooter = match.players.find((player) => player.id === red.id);
    const target = match.players.find((player) => player.id === blue.id);
    shooter.x = target.x - 50;
    shooter.y = target.y;
    target.health = 50;
    const lethalShot = manager.fireProjectile(red, { type: 'lethal', direction: { x: 1, y: 0 } });
    assert.equal(lethalShot.matchEnded, true, 'elimination is decided in the same operation as the lethal shot');
    assert.equal(match.victory.reason, 'elimination');
    assert.equal(manager.updateGameInput(red, {
      sequence: 1,
      input: { up: false, down: false, left: true, right: false },
    }).accepted, true, 'surviving players can still move during the postgame phase');

    manager.advanceGames(0.05);

    assert.equal(target.health, 0);
    assert.equal(target.alive, false);
    assert.equal(target.isSpectator, true);
    const xAfterDeath = target.x;
    const yAfterDeath = target.y;
    now += 1000;
    for (let frame = 0; frame < 20; frame += 1) manager.advanceGames(0.05);
    assert.equal(target.health, 0);
    assert.equal(target.x, xAfterDeath);
    assert.equal(target.y, yAfterDeath);
    assert.ok(match.players.some((player) => player.id === blue.id), 'dead player remains in match state as spectator');
  });

  it('drops a carried flag on zero-health death and awards team elimination', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Death Drop' });
    await manager.join(blue, { name: 'Death Drop' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = startGameplay(manager, red);
    const redPlayer = red.room.match.players.find((player) => player.id === red.id);
    redPlayer.x = red.room.match.flag.x;
    redPlayer.y = red.room.match.flag.y;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, red.id);

    redPlayer.health = 0;
    manager.advanceGames(0);
    const state = manager.toRoomState(red.room).match;
    const deadRed = state.players.find((player) => player.id === red.id);
    assert.equal(deadRed.health, 0);
    assert.equal(deadRed.alive, false);
    assert.equal(state.flag.heldBy, null);
    assert.equal(state.flag.dropped, true);
    assert.equal(state.flag.x, deadRed.x);
    assert.equal(state.flag.y, deadRed.y);
    assert.equal(state.victory.winner, 'blue');
    assert.equal(state.victory.reason, 'elimination');
    assert.ok(Number.isFinite(state.victory.at));
  });

  it('awards the Strike Team a win when a flag carrier returns to the Strike Site', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Flag Capture' });
    await manager.join(blue, { name: 'Flag Capture' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = startGameplay(manager, red);
    const redPlayer = red.room.match.players.find((player) => player.id === red.id);
    redPlayer.x = red.room.match.flag.x;
    redPlayer.y = red.room.match.flag.y;
    manager.advanceGames(0);
    assert.equal(red.room.match.flag.heldBy, red.id);

    const redSite = red.room.match.map.spawnZones.red;
    redPlayer.x = redSite.x + redSite.width / 2;
    redPlayer.y = redSite.y + redSite.height / 2;
    const [update] = manager.advanceGames(0);

    assert.equal(update.match.victory.winner, 'red');
    assert.equal(update.match.victory.reason, 'capture');
    assert.ok(Number.isFinite(update.match.victory.at));
    assert.equal(update.match.flag.heldBy, null);
  });

  it('awards the Strike Team a win when the Flag Team is eliminated', async () => {
    const manager = new RoomManager();
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Elimination Win' });
    await manager.join(blue, { name: 'Elimination Win' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    startGameplay(manager, red);
    blue.room.match.players.find((player) => player.id === blue.id).health = 0;

    const [update] = manager.advanceGames(0);
    assert.equal(update.match.victory.winner, 'red');
    assert.equal(update.match.victory.reason, 'elimination');
    assert.ok(Number.isFinite(update.match.victory.at));
  });

  it('awards the Flag Team a win when time expires and lets any room member return everyone to the lobby', async () => {
    let now = 12000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Time Win' });
    await manager.join(blue, { name: 'Time Win' });
    manager.setPlayerTeam(red, { team: 'red' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    const started = startGameplay(manager, red);

    now = started.match.endsAt;
    const [update] = manager.advanceGames(0);
    assert.deepEqual(update.match.victory, { winner: 'blue', reason: 'time', at: now });
    assert.equal(manager.advanceGames(0).length, 0);
    assert.equal(manager.finishMatch(blue).match, null);
    assert.equal(manager.toRoomState(red.room).match, null);
  });

  it('tracks each postgame lobby decision separately until all current players respond', async () => {
    let now = 2000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Individual Stay' });
    await manager.join(guest, { name: 'Individual Stay' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    const started = startGameplay(manager, host);

    now = started.match.endsAt;
    manager.advanceGames(0);
    const postGameState = manager.choosePostGame(guest);

    assert.ok(postGameState.match, 'a single stay choice does not reset the shared match');
    assert.equal(postGameState.postGame.choices[guest.id], 'stay');
    assert.equal(postGameState.postGame.choices[host.id], 'waiting');
    assert.equal(postGameState.postGame.endsAt, now + 15_000);
    assert.equal(manager.choosePostGame(host).match, null, 'the room returns to the lobby after all remaining players stay');
  });

  it('returns custom-match nonresponders to the lobby after 15 seconds by default', async () => {
    let now = 4000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Postgame Timeout' });
    await manager.join(guest, { name: 'Postgame Timeout' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(guest, { team: 'blue' });
    const started = startGameplay(manager, host);

    now = started.match.endsAt;
    manager.advanceGames(0);
    manager.choosePostGame(guest);
    now += 15_000;
    const [update] = manager.advanceGames(0);

    assert.equal(host.room, guest.room, 'nonresponders remain in the same room by default');
    assert.equal(update.roomState.hostId, host.id, 'the room host does not change');
    assert.deepEqual(update.postGameDepartures, []);
    assert.equal(update.roomState.match, null, 'the completed match is cleared for every player');
    assert.equal(update.roomState.postGame, null);
    assert.equal(update.roomState.players.length, 2);
    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 1, blue: 1 });
  });

  it('configures custom-match bots and locks their weapon choice when gameplay starts', async () => {
    let now = 50_000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Bot Match' });
    await manager.join(guest, { name: 'Bot Match' });

    assert.throws(() => manager.setBotTeam(guest, { botId: 'bot-1', team: 'red' }), /Only the room host/);
    assert.throws(() => manager.setBotTeam(host, { botId: 'bot-1', team: 'green' }), /Choose Strike Team, Flag Team, or Remove/);
    let configured = manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    configured = manager.setBotTeam(host, { botId: 'bot-2', team: 'blue' });
    manager.setBotTeam(host, { botId: 'bot-3', team: 'red' });
    manager.setBotTeam(host, { botId: 'bot-4', team: 'red' });
    manager.setBotTeam(host, { botId: 'bot-5', team: 'red' });
    assert.throws(() => manager.setBotTeam(host, { botId: 'bot-6', team: 'red' }), /team is full/);
    manager.setBotTeam(host, { botId: 'bot-3', team: 'none' });
    manager.setBotTeam(host, { botId: 'bot-4', team: 'none' });
    manager.setBotTeam(host, { botId: 'bot-5', team: 'none' });
    configured = manager.toRoomState(host.room);
    assert.deepEqual(configured.bots.counts, { red: 1, blue: 1 });
    assert.deepEqual(manager.listRooms()[0].teamCounts, { red: 2, blue: 2 });
    const removed = manager.setBotTeam(host, { botId: 'bot-1', team: 'none' });
    assert.deepEqual(removed.bots.counts, { red: 0, blue: 1 }, 'the host can remove a bot from a custom-match roster');
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    setBotLoadoutBeforeMatch(host.room, 'bot-1', 'smg');
    setBotLoadoutBeforeMatch(host.room, 'bot-2', 'smg');

    const state = startGameplay(manager, host);
    const bots = host.room.match.players.filter((player) => player.isBot);
    assert.equal(bots.length, 2);
    const matchStartWeapons = new Map(bots.map((bot) => [bot.id, bot.selectedWeaponId]));
    assert.ok(bots.every((bot) => Object.values(DEFAULT_PROJECTILE_DEFINITIONS)
      .some((weapon) => weapon.id === bot.selectedWeaponId)));
    assert.deepEqual(host.room.match.teamRoster, { red: 2, blue: 2 });
    assert.equal(state.match.players.filter((player) => player.isBot).length, 2);
    assert.equal(Object.hasOwn(state.match.players.find((player) => player.isBot), 'botBrain'), false);

    manager.advanceGames(0.05);
    assert.ok(bots.every((bot) => bot.lastInputSequence === 0), 'the server does not autonomously calculate bot decisions');
    const beforeX = new Map(bots.map((bot) => [bot.id, bot.x]));
    const commands = bots.map((bot) => ({
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: true, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
      weaponId: matchStartWeapons.get(bot.id),
    }));
    assert.throws(() => manager.applyBotCommands(host, {
      commands: [{ ...commands[0], weaponId: 'laser-cannon' }],
    }), /invalid or stale/);
    assert.throws(() => manager.applyBotCommands(guest, { commands }), /invalid or stale/);
    const attemptedSwitch = bots.map((bot, index) => ({
      ...commands[index],
      sequence: 2,
      weaponId: 'assault-rifle',
    }));
    assert.throws(() => manager.applyBotCommands(host, { commands: attemptedSwitch }), /invalid or stale/,
      'the host cannot change a bot loadout after the match begins');
    const commandResult = manager.applyBotCommands(host, { commands });
    assert.deepEqual(commandResult.projectiles, []);
    assert.ok(bots.every((bot) => bot.selectedWeaponId === matchStartWeapons.get(bot.id)),
      'the bot keeps its match-start weapon');
    manager.advanceGames(0.05);
    assert.ok(bots.every((bot) => bot.lastInputSequence === 1), 'the host supplies bot decisions and the server applies the resulting inputs');
    assert.ok(bots.every((bot) => bot.x > beforeX.get(bot.id)), 'the server simulates host-directed bot movement');
  });

  it('chooses custom-match bot loadouts by botAppeal independently of shopValue', async () => {
    const manager = new RoomManager({
      random: () => 0.99,
      projectileDefinitions: {
        common: {
          id: 'common', damage: 10, speed: 100, radius: 1, range: 500, cooldownMs: 0,
          shopValue: 99, botAppeal: 1,
        },
        appealing: {
          id: 'appealing', damage: 10, speed: 100, radius: 1, range: 500, cooldownMs: 0,
          shopValue: 0, botAppeal: 3,
        },
      },
    });
    const host = createClient();
    const guest = createClient();
    await manager.createAndJoin(host, { name: 'Bot Appeal Loadout' });
    await manager.join(guest, { name: 'Bot Appeal Loadout' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });

    startGameplay(manager, host);

    const bot = host.room.match.players.find((player) => player.id === 'bot-1');
    assert.equal(bot.selectedWeaponId, 'appealing',
      'weighted selection follows botAppeal even though the other weapon has higher shopValue');
  });

  it('lets an eliminated player control and release a living bot on their own team', async () => {
    let now = 90_000;
    const manager = new RoomManager({ now: () => now });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Spectator Bot Takeover' });
    await manager.join(blue, { name: 'Spectator Bot Takeover' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    manager.setBotTeam(red, { botId: 'bot-1', team: 'red' });
    manager.setBotTeam(red, { botId: 'bot-2', team: 'blue' });
    startGameplay(manager, red);
    const room = red.room;
    const human = room.match.players.find((player) => player.id === red.id);
    const bot = room.match.players.find((player) => player.id === 'bot-1');

    assert.throws(() => manager.setBotController(red, { botId: bot.id }), /Living players cannot take over/);
    human.isSpectator = true;
    const spectatorTakeover = manager.setBotController(red, { botId: bot.id });
    assert.equal(spectatorTakeover.match.players.find((player) => player.id === bot.id).controlledById, red.id,
      'the authoritative spectator flag takes precedence over stale alive state');
    manager.setBotController(red, { botId: bot.id, takeControl: false });
    human.isSpectator = false;
    human.alive = false;
    human.health = 0;
    human.isSpectator = true;
    const blueHuman = room.match.players.find((player) => player.id === blue.id);
    blueHuman.alive = false;
    blueHuman.health = 0;
    blueHuman.isSpectator = true;
    assert.throws(() => manager.setBotController(blue, { botId: bot.id }), /living bot on your team/);

    const takenOver = manager.setBotController(red, { botId: bot.id });
    assert.equal(takenOver.match.players.find((player) => player.id === bot.id).controlledById, red.id);
    const command = {
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
    };
    assert.throws(() => manager.applyBotCommands(blue, { commands: [command] }), /invalid or stale/);
    assert.equal(manager.applyBotCommands(red, { commands: [command] }).projectiles.length, 0);
    const released = manager.setBotController(red, { botId: bot.id, takeControl: false });
    assert.equal(released.match.players.find((player) => player.id === bot.id).controlledById, null);
    assert.ok(released.match.players.find((player) => player.id === bot.id).controlRevision > command.controlRevision);

    manager.setMatchVictory(room, { winner: 'blue', reason: 'time', at: now });
    assert.equal(manager.isPostGameFreeRoam(room, now), true);
    const postGameTakeover = manager.setBotController(red, { botId: bot.id });
    assert.equal(postGameTakeover.match.players.find((player) => player.id === bot.id).controlledById, red.id,
      'eliminated players may take over a living teammate bot during postgame free-roam');
    const postGamePose = { x: bot.x + 4, y: bot.y, vx: 80, vy: 0 };
    const postGameStartX = bot.x;
    const postGameCommand = {
      ...command,
      sequence: 2,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: true, drop: false, weaponLean: 0 },
      playerPose: postGamePose,
    };
    assert.deepEqual(manager.applyBotCommands(red, { commands: [postGameCommand] }).projectiles, []);
    now += 50;
    manager.advanceGames(0.05);
    assert.ok(bot.x > postGameStartX, 'the controlled bot continues moving during server-authoritative postgame');
    const postGameRelease = manager.setBotController(red, { botId: bot.id, takeControl: false });
    assert.equal(postGameRelease.match.players.find((player) => player.id === bot.id).controlledById, null);
  });

  it('publishes bot takeover and release even when the latest host frame predates the change', async () => {
    const manager = new BaseRoomManager({
      now: () => 95_000,
      randomTeam: () => 0,
      simulationMode: 'host-authoritative',
    });
    const owner = createClient();
    const opponent = createClient();
    await manager.createAndJoin(owner, { name: 'Host Frame Bot Takeover' });
    await manager.join(opponent, { name: 'Host Frame Bot Takeover' });
    manager.setPlayerTeam(owner, { team: 'red' });
    manager.setBotTeam(owner, { botId: 'bot-1', team: 'red' });
    startGameplay(manager, owner);

    const room = owner.room;
    room.match.players.forEach((player, index) => {
      Object.assign(player, {
        x: 200 + index * 30, y: 250, vx: 0, vy: 0,
        health: 100, alive: true, isSpectator: false,
      });
    });
    room.match.flag ??= {
      x: 500, y: 350, heldBy: null, dropped: false, lastDroppedBy: null,
    };
    const human = room.match.players.find((player) => player.id === owner.id);
    human.alive = false;
    human.health = 0;
    const frame = createHostFrame({
      match: room.match,
      authorityEpoch: room.authorityEpoch,
      revision: 1,
      tick: 1,
      simulationTimeMs: 50,
    });
    assert.equal(manager.acceptHostFrame(owner, frame).accepted, true);

    const botBeforeTakeover = room.match.players.find((player) => player.id === 'bot-1');
    const controlRevision = botBeforeTakeover.controlRevision;
    const takenOver = manager.setBotController(owner, { botId: botBeforeTakeover.id });
    const takeoverState = takenOver.match.players.find((player) => player.id === botBeforeTakeover.id);
    assert.equal(takeoverState.controlledById, owner.id);
    assert.equal(takeoverState.controlRevision, controlRevision + 1);

    const released = manager.setBotController(owner, { botId: botBeforeTakeover.id, takeControl: false });
    const releasedState = released.match.players.find((player) => player.id === botBeforeTakeover.id);
    assert.equal(releasedState.controlledById, null);
    assert.ok(releasedState.controlRevision > takeoverState.controlRevision);
  });

  it('releases a controlled bot and clears its input when its controller dies', async () => {
    const manager = new RoomManager({ now: () => 96_000 });
    const owner = createClient();
    const opponent = createClient();
    await manager.createAndJoin(owner, { name: 'Bot Controller Death' });
    await manager.join(opponent, { name: 'Bot Controller Death' });
    manager.setPlayerTeam(owner, { team: 'red' });
    manager.setBotTeam(owner, { botId: 'bot-1', team: 'red' });
    startGameplay(manager, owner);

    const room = owner.room;
    const human = room.match.players.find((player) => player.id === owner.id);
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    human.alive = false;
    human.health = 0;
    manager.setBotController(owner, { botId: bot.id });
    human.alive = true;
    human.health = 100;
    human.isSpectator = false;

    const actor = room.botActors.get(bot.id);
    actor.roomInputSequence = 4;
    actor.roomInput = { up: true, down: false, left: false, right: false, drop: false, weaponLean: 0 };
    const controlRevision = bot.controlRevision;
    manager.markPlayerDead(room.match, human);

    assert.equal(bot.controlledById, null);
    assert.equal(bot.controlRevision, controlRevision + 1);
    assert.equal(bot.lastInputSequence, actor.roomInputSequence);
    assert.deepEqual(actor.roomInput, {
      up: false, down: false, left: false, right: false, drop: false, weaponLean: 0, visionAngle: null,
    });
  });

  it('simulates controlled bot movement during server-authoritative postgame free-roam', async () => {
    let now = 92_000;
    const manager = new RoomManager({ now: () => now, simulationMode: 'server-authoritative' });
    const red = createClient();
    const blue = createClient();
    await manager.createAndJoin(red, { name: 'Server Bot Postgame Control' });
    await manager.join(blue, { name: 'Server Bot Postgame Control' });
    manager.setPlayerTeam(blue, { team: 'blue' });
    manager.setBotTeam(red, { botId: 'bot-1', team: 'red' });
    startGameplay(manager, red);
    const room = red.room;
    room.match.map.objects = [];
    const human = room.match.players.find((player) => player.id === red.id);
    human.alive = false;
    human.health = 0;
    human.isSpectator = true;
    manager.setMatchVictory(room, { winner: 'blue', reason: 'time', at: now });
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    manager.setBotController(red, { botId: bot.id });
    const startingX = bot.x;
    assert.deepEqual(manager.applyBotCommands(red, { commands: [{
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: true, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
      playerPose: { x: bot.x, y: bot.y, vx: bot.vx, vy: bot.vy },
    }] }).projectiles, []);
    now += 50;
    manager.advanceGames(0.05);
    assert.ok(bot.x > startingX, 'the controlled bot uses its owner input during postgame simulation');
  });

  it('allows Quick Play bot takeover and control after roles rotate at round end', async () => {
    let now = 94_000;
    const manager = new RoomManager({ now: () => now, randomTeam: () => 0 });
    const red = createClient();
    const blue = createClient();
    manager.quickPlay(red);
    manager.quickPlay(blue);
    const room = red.room;
    await room.quickPlayMapPromise;
    await readyAndStartQuickPlay(manager, room);
    now = room.match.gameplayStartsAt;
    manager.advanceGames(0);

    const redHuman = room.match.players.find((player) => player.id === red.id);
    redHuman.alive = false;
    redHuman.health = 0;
    redHuman.isSpectator = true;
    manager.setMatchVictory(room, { winner: 'blue', reason: 'time', at: now });
    assert.equal(red.team, 'blue', 'the room roster shows the next-round role');
    assert.equal(redHuman.team, 'red', 'the match retains the role from the completed round');
    const redBot = room.match.players.find((player) => player.isBot && player.team === 'red' && player.alive);
    const takeover = manager.setBotController(red, { botId: redBot.id });
    assert.equal(takeover.match.players.find((player) => player.id === redBot.id).controlledById, red.id);

    const startingX = redBot.x;
    manager.applyBotCommands(red, { commands: [{
      botId: redBot.id,
      sequence: 1,
      controlRevision: redBot.controlRevision,
      input: { up: false, down: false, left: false, right: true, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: false,
      reload: false,
      playerPose: { x: redBot.x + 5, y: redBot.y, vx: 70, vy: 0 },
    }] });
    now += 50;
    manager.advanceGames(0.05);
    assert.ok(redBot.x > startingX, 'the controlled bot continues receiving movement commands in the result phase');
  });

  it('does not suppress bot fire commands on the server', async () => {
    let now = 100_000;
    const manager = new RoomManager({ now: () => now });
    const host = createClient();
    const opponent = createClient();
    await manager.createAndJoin(host, { name: 'Bot Shot Safety' });
    await manager.join(opponent, { name: 'Bot Shot Safety' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    setBotLoadoutBeforeMatch(host.room, 'bot-1', 'assault-rifle');
    startGameplay(manager, host);
    const match = host.room.match;
    match.map.objects = [];
    const bot = match.players.find((player) => player.id === 'bot-1');
    const teammate = match.players.find((player) => player.id === host.id);
    const enemy = match.players.find((player) => player.id === opponent.id);
    Object.assign(bot, { x: 100, y: 300, vx: 0, vy: 0 });
    Object.assign(teammate, { x: 170, y: 300, vx: 0, vy: 0 });
    Object.assign(enemy, { x: 340, y: 300, vx: 0, vy: 0 });
    enemy.armor = 0;
    enemy.maxArmor = 0;
    bot.weaponStats['assault-rifle'].aimAngle = 0;
    bot.weaponStats['assault-rifle'].aimUpdatedAt = manager.now();
    const command = {
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: true,
      reload: false,
    };

    const shotThroughTeammate = manager.applyBotCommands(host, { commands: [command] });
    assert.equal(shotThroughTeammate.projectiles.length, 1,
      'the server processes a fire command instead of making the bot behavior decision');
    assert.equal(shotThroughTeammate.projectiles[0].hitPlayerId, enemy.id,
      'the authoritative shot passes through a teammate even if a bot sends it');
    assert.equal(teammate.health, 100, 'the teammate takes no damage');
    Object.assign(teammate, { x: 170, y: 450 });
    now += DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.cooldownMs;
    const clearShot = manager.applyBotCommands(host, { commands: [{ ...command, sequence: 2 }] });
    assert.equal(clearShot.projectiles.length, 1, 'the bot can fire when no teammate is in its line of fire');
    assert.equal(clearShot.projectiles[0].hitPlayerId, enemy.id, 'the clear shot is traced onto the enemy');
    assert.ok(enemy.health < 100, 'the bot hit changes authoritative enemy health');
  });

  it('advances weapon reloads for AI bots in host-authoritative rooms', async () => {
    let now = 105_000;
    const manager = new BaseRoomManager({ now: () => now, simulationMode: 'server-authoritative' });
    const host = createClient();
    const opponent = createClient();
    await manager.createAndJoin(host, { name: 'Bot Reload Tick' });
    await manager.join(opponent, { name: 'Bot Reload Tick' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    startGameplay(manager, host);
    const bot = host.room.match.players.find((player) => player.id === 'bot-1');
    const weapon = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    Object.assign(bot.weaponStats[weapon.id], {
      ammo: 0,
      reloading: true,
      reloadStartedAt: now,
      reloadEndsAt: now + weapon.reloadDurationMs,
    });

    now += weapon.reloadDurationMs;
    manager.advanceGames(0.05);

    assert.equal(bot.weaponStats[weapon.id].ammo, weapon.magazineSize);
    assert.equal(bot.weaponStats[weapon.id].reloading, false);
  });

  it('registers AI bot hits in host-authoritative rooms', async () => {
    let now = 108_000;
    const manager = new BaseRoomManager({ now: () => now, simulationMode: 'server-authoritative' });
    const host = createClient();
    const opponent = createClient();
    await manager.createAndJoin(host, { name: 'Host Bot Hit' });
    await manager.join(opponent, { name: 'Host Bot Hit' });
    manager.setPlayerTeam(host, { team: 'red' });
    manager.setPlayerTeam(opponent, { team: 'blue' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    setBotLoadoutBeforeMatch(host.room, 'bot-1', 'assault-rifle');
    startGameplay(manager, host);

    const room = host.room;
    room.match.map.objects = [];
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    const hostPlayer = room.match.players.find((player) => player.id === host.id);
    const enemy = room.match.players.find((player) => player.id === opponent.id);
    Object.assign(bot, { x: 100, y: 300, vx: 0, vy: 0 });
    Object.assign(hostPlayer, { x: 900, y: 650, vx: 0, vy: 0 });
    Object.assign(enemy, { x: 340, y: 300, vx: 0, vy: 0, armor: 0, maxArmor: 0 });
    bot.weaponStats['assault-rifle'].aimAngle = 0;
    bot.weaponStats['assault-rifle'].aimUpdatedAt = now;

    const result = manager.applyBotCommands(host, { commands: [{
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: true,
      reload: false,
    }] });

    assert.equal(result.projectiles.length, 1);
    assert.equal(result.projectiles[0].hitPlayerId, enemy.id);
    assert.ok(enemy.health < 100, 'server-side collision applies damage in host-authoritative mode too');
  });

  it('accepts and traces a controlled bot shotgun shot using its prephase selection', async () => {
    const manager = new RoomManager();
    const owner = createClient();
    const opponent = createClient();
    await manager.createAndJoin(owner, { name: 'Takeover Shotgun Hit' });
    await manager.join(opponent, { name: 'Takeover Shotgun Hit' });
    manager.setBotTeam(owner, { botId: 'bot-1', team: 'red' });
    setBotLoadoutBeforeMatch(owner.room, 'bot-1', 'shotgun');
    startGameplay(manager, owner);

    const room = owner.room;
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    const target = room.match.players.find((player) => player.id === opponent.id);
    const ownerPlayer = room.match.players.find((player) => player.id === owner.id);
    target.armor = 0;
    target.maxArmor = 0;
    room.match.map.objects = [];
    Object.assign(bot, { x: 120, y: 300, vx: 0, vy: 0, team: owner.team });
    Object.assign(target, { x: 250, y: 300, vx: 0, vy: 0, health: 1_000, alive: true });
    ownerPlayer.alive = false;
    ownerPlayer.health = 0;
    const takeover = manager.setBotController(owner, { botId: bot.id });
    const shotgun = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;
    const command = {
      botId: bot.id,
      sequence: 1,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: true,
      reload: false,
      weaponId: shotgun.id,
      playerPose: { x: bot.x, y: bot.y, vx: 0, vy: 0 },
      shotAngle: 0,
      shotAngles: Array(shotgun.pelletCount).fill(0),
    };

    const result = manager.applyBotCommands(owner, { commands: [command] });

    assert.equal(takeover.match.players.find((player) => player.id === bot.id).controlledById, owner.id);
    assert.equal(bot.selectedWeaponId, shotgun.id, 'weapon selection and its first takeover shot are both applied');
    assert.equal(result.projectiles.length, shotgun.pelletCount);
    assert.ok(result.projectiles.every((pellet) => pellet.hitPlayerId === target.id),
      `the server traces every submitted pellet against the target: ${result.projectiles.map((pellet) =>
        `${pellet.hitType ?? 'miss'}@${pellet.end.x.toFixed(1)},${pellet.end.y.toFixed(1)}`).join(' ')}`);
    assert.ok(result.projectiles.every((pellet) => pellet.damage === shotgun.damage),
      'each centered pellet applies the current reduced base damage');
    assert.equal(target.health, 1_000 - shotgun.damage * shotgun.pelletCount,
      'all pellets apply the reduced damage to the authoritative target');
  });

  it('continues Battle Pistol bursts while the bot fire command remains held', async () => {
    let now = 115_000;
    const manager = new RoomManager({ now: () => now, random: () => 0.5 });
    const host = createClient();
    const opponent = createClient();
    await manager.createAndJoin(host, { name: 'Battle Pistol Bot Burst' });
    await manager.join(opponent, { name: 'Battle Pistol Bot Burst' });
    manager.setBotTeam(host, { botId: 'bot-1', team: 'red' });
    setBotLoadoutBeforeMatch(host.room, 'bot-1', 'battle-pistol');
    startGameplay(manager, host);

    const room = host.room;
    room.match.map.objects = [];
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    const target = room.match.players.find((player) => player.id === opponent.id);
    Object.assign(bot, { x: 120, y: 300, team: 'red' });
    Object.assign(target, { x: 400, y: 300, team: 'blue', health: 1_000, alive: true, armor: 0, maxArmor: 0 });
    const actor = room.botActors.get(bot.id);
    actor.selectedWeaponId = 'battle-pistol';
    const battlePistol = DEFAULT_PROJECTILE_DEFINITIONS.battlePistol;
    let sequence = 0;
    let projectileCount = 0;
    for (const offset of [0, 45, 90, 135, 180, 225, 270, 315, 360, 380]) {
      now = room.match.gameplayStartsAt + offset;
      const result = manager.applyBotCommands(host, { commands: [{
        botId: bot.id,
        sequence: ++sequence,
        controlRevision: bot.controlRevision,
        input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
        direction: { x: 1, y: 0 },
        fire: true,
        reload: false,
        weaponId: battlePistol.id,
      }] });
      projectileCount += result.projectiles.length;
    }

    assert.equal(projectileCount, 4,
      'held fire completes the three-shot burst and starts another after burstDelayMs');
    assert.equal(bot.weaponStats[battlePistol.id].ammo, battlePistol.magazineSize - 4);
  });

  it('traces controlled bot sniper shots from the owner pose and ignores friendly hits', async () => {
    let now = 120_000;
    const manager = new RoomManager({ now: () => now });
    const owner = createClient();
    const opponent = createClient();
    await manager.createAndJoin(owner, { name: 'Takeover Sniper Hit' });
    await manager.join(opponent, { name: 'Takeover Sniper Hit' });
    manager.setBotTeam(owner, { botId: 'bot-1', team: 'red' });
    manager.setBotTeam(owner, { botId: 'bot-2', team: 'red' });
    setBotLoadoutBeforeMatch(owner.room, 'bot-1', 'sniper');
    startGameplay(manager, owner);

    const room = owner.room;
    room.match.map.objects = [];
    const bot = room.match.players.find((player) => player.id === 'bot-1');
    const friendly = room.match.players.find((player) => player.id === 'bot-2');
    const enemy = room.match.players.find((player) => player.id === opponent.id);
    const ownerPlayer = room.match.players.find((player) => player.id === owner.id);
    Object.assign(bot, { x: 120, y: 300, vx: 0, vy: 0, team: 'red' });
    Object.assign(friendly, { x: 700, y: 500, vx: 0, vy: 0, team: 'red' });
    Object.assign(enemy, { x: 620, y: 360, vx: 0, vy: 0, health: 1_000, alive: true });
    ownerPlayer.alive = false;
    ownerPlayer.health = 0;
    manager.setBotController(owner, { botId: bot.id });

    const sniper = DEFAULT_PROJECTILE_DEFINITIONS.sniper;
    const createCommand = (sequence) => ({
      botId: bot.id,
      sequence,
      controlRevision: bot.controlRevision,
      input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      direction: { x: 1, y: 0 },
      fire: true,
      reload: false,
      weaponId: sniper.id,
      // The controlled player's prediction has advanced the bot from the last
      // server pose; the server must trace from this submitted takeover pose.
      playerPose: { x: 120, y: 360, vx: 0, vy: 0 },
      shotAngle: 0,
      shotAngles: [0],
    });

    const enemyShot = manager.applyBotCommands(owner, { commands: [createCommand(1)] });
    assert.equal(enemyShot.projectiles[0].start.x, 120);
    assert.equal(enemyShot.projectiles[0].start.y, 360);
    assert.equal(enemyShot.projectiles[0].hitPlayerId, enemy.id,
      'the sniper trace uses the controlled bot’s submitted pose and shot angle');

    const ammoAfterFirstShot = bot.weaponStats.sniper.ammo;
    now += 5;
    const tooSoon = manager.applyBotCommands(owner, { commands: [createCommand(2)] });
    assert.deepEqual(tooSoon.projectiles, [], 'controlled-bot firing still respects the authoritative cooldown');
    assert.equal(bot.weaponStats.sniper.ammo, ammoAfterFirstShot,
      'a cooldown-rejected command does not consume ammunition');

    Object.assign(enemy, { x: 620, y: 500 });
    Object.assign(friendly, { x: 620, y: 360 });
    now += sniper.cooldownMs - 5;
    const friendlyShot = manager.applyBotCommands(owner, { commands: [createCommand(3)] });
    assert.equal(friendlyShot.projectiles[0].hitPlayerId, null,
      'the controlled bot sniper passes through its teammate without a friendly hit');
    assert.equal(friendly.health, 100, 'the teammate remains unharmed');
  });

});
