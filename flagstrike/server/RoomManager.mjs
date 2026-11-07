import { createHash, randomBytes, randomInt, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { promisify } from 'node:util';
import { getTeamGroup, getTeamGroupId, MAX_ROOM_CAPACITY, TEAM_CAPACITY, TEAM_GROUPS, TEAM_SPAWN_OFFSETS } from '../shared/GameRules.js';
import { COMPETITIVE_MAP_RULES, DEFAULT_MAX_ROOMS, DEFAULT_MIN_ROOMS, generateMap, isCompetitiveMap, MAP_HEIGHT, MAP_WIDTH, MAX_MAP_SEED, MAX_ROOMS, MIN_MAP_SEED, MIN_ROOMS } from '../shared/MapGenerator.js';
import { constrainPositionToRadius, getPlayerMovementScale, MAX_PLAYER_SPEED as MOVEMENT_MAX_PLAYER_SPEED, movePosition, PLAYER_RADIUS as MOVEMENT_PLAYER_RADIUS } from '../shared/MovementModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS, getProjectileDamage, segmentCircleEntryTCoordinates, segmentMapObjectBoundsOverlap, segmentMapObjectEntryT, validateProjectileDefinition } from '../shared/ProjectileModel.js';
import { collectFootstepAudioCues as buildFootstepAudioCues, findSonarListener, FOOTSTEP_HEARING_RADIUS, isAudioSourceVisibleToPlayer, isAudioSourceVisibleToTeam } from '../shared/AudioCueModel.js';
import { getWeaponMuzzlePosition } from '../shared/WeaponGeometry.js';
import { clearManualAction, clearWeaponReload, finishReloadRound, queueManualAction, resumePausedReload, resumeQueuedManualAction, startManualAction, suspendWeaponActionsForSwitch } from '../shared/WeaponActionState.js';
import { awardKillAndAssists } from '../shared/CombatAttribution.js';
import { applyGadgetAreaDamage, applyHostPropDamage, applyMolotovWorldEffects, applyTrophySystemDamage } from '../shared/HostCombatModel.js';
import { advanceHostSonarProjectiles, applyHostJammerDetonation, createHostGadgetEffect, createHostOrbitalStrikeImpact, createHostOrbitalStrikeWarning, createHostSonarProjectile, createHostTrophyCommandProjectile, findTrophyCommandClearedEffects } from '../shared/HostGadgetModel.js';
import { findTrophyPlacedGadgetInterceptions, findTrophyProjectileInterceptions, getOwnedActiveTrophySystem } from '../shared/TrophySystemModel.js';
import { applyAccuracyRecoil, getEffectiveAccuracy, getGaussianSpreadRadians, getMaximumRotationRadiansPerSecond, recoverAccuracy, rotateAngleTowards } from '../shared/WeaponAccuracy.js';
import { getPlayerVisionOrigin, isPointVisible, VISION_HALF_ANGLE, VISION_MEMORY_CELL_SIZE } from '../shared/VisionModel.js';
import { BOT_PERSONALITIES, chooseBotLoadoutGadgetId, chooseBotLoadoutWeaponId } from '../shared/BotAI.js';
import { validateHostFrame } from '../shared/HostFrameProtocol.js';
import {
  chooseUniqueGadgetOffer,
  getMinimumWeaponShopMatch,
  getWeaponShopOfferWeight,
  isUniqueGadgetDefinition,
} from '../shared/WeaponShopModel.js';
import {
  DEFAULT_CUSTOM_GAME_RULES,
  getCustomMapCriteria,
  normalizeCustomGameRules,
} from '../shared/CustomGameRules.js';
import {
  calculateGadgetTrajectory,
  activateVineTrap,
  advanceOrbitalStrikeCooldown,
  advancePerChargeGadgetRecharges,
  advanceSonarChargeRecharges,
  advanceVineTrapRecharge,
  consumeGadgetCharge,
  BIO_FIELD_COOLDOWN_MS,
  BIO_FIELD_ID,
  GADGET_DEFINITIONS,
  applyFlashBlindness,
  isPlayerFlashBlinded,
  isGadgetJammed,
  isPlayerJammed,
  JAMMER_GRENADE_COOLDOWN_MS,
  JAMMER_GRENADE_ID,
  getGadgetMovementScale,
  getGadgetWeaponTurnScale,
  GADGET_SWITCH_DURATION_MS,
  getGadgetThrowOrigin,
  isVineTrapTargetDead,
  isProximityMineArmed,
  ORBITAL_STRIKE_ID,
  PROXIMITY_MINE_HIT_RADIUS,
  SMOKE_GRENADE_ID,
  SPY_CAMERA_BODY_RADIUS,
  SPY_CAMERA_ID,
  SONAR_ID,
  queueOrbitalStrikeRecharge,
  queuePerChargeGadgetRecharge,
  refillGadgetCharges,
  queueSonarChargeRecharge,
  startVineTrapRecharge,
  VINE_TRAP_ID,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_COMMAND_COOLDOWN_MS,
  TROPHY_SYSTEM_COMMAND_EFFECT_ID,
  TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS,
  TROPHY_INTERCEPT_VISUAL_DURATION_MS,
} from '../shared/GadgetModel.js';
import {
  createDefaultMatchItemInventory,
  createEmptyItemInventory,
  getItemLevelDefinition,
  getEffectiveAccuracySettings,
  getEffectiveMagazineSize,
  getEffectiveReloadDuration,
  getInventoryEffects,
  getNextItemShopOffers,
  normalizeItemInventory,
  regeneratePlayerArmor,
} from '../shared/InventoryModel.js';

const scrypt = promisify(nodeScrypt);
const PASSWORD_HASH_BYTES = 32;
const ROOM_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u;
export const MATCH_DURATION_MS = 3 * 60 * 1000;
export const MATCH_COUNTDOWN_MS = 15_000;
export const QUICK_PLAY_COUNTDOWN_MS = 15_000;
export const QUICK_PLAY_RESULT_MS = 5_000;
export const QUICK_PLAY_FINAL_REPORT_MS = 8_000;
export const QUICK_PLAY_ROLE_SWAP_EVERY = 2;
export const LONG_PLAY_WINS_TO_WIN = 4;
export const LONG_PLAY_ROLE_SWAP_EVERY = 5;
export const LONG_SERIES_WINS_TO_WIN = 10;
export { MAP_HEIGHT, MAP_WIDTH };
export { MAX_ROOM_CAPACITY, TEAM_CAPACITY };
export const MAX_PLAYER_SPEED = MOVEMENT_MAX_PLAYER_SPEED;
export const PLAYER_RADIUS = MOVEMENT_PLAYER_RADIUS;
const INPUT_STALE_MS = 250;
const MAX_INPUT_SEQUENCE_GAP = 128;
export const PLAYER_MAX_HEALTH = 100;
export const FLAG_PICKUP_RADIUS = 26;
export const POST_GAME_RESPONSE_WINDOW_MS = 15_000;
export { FOOTSTEP_HEARING_RADIUS };
const SERIES_MODE_RULES = Object.freeze({
  quickplay: Object.freeze({ label: 'Practice', winsToWin: null, roleSwapEvery: 1 }),
  longplay: Object.freeze({ label: 'Quick Play', winsToWin: LONG_PLAY_WINS_TO_WIN, roleSwapEvery: QUICK_PLAY_ROLE_SWAP_EVERY }),
  longseries: Object.freeze({
    label: 'Long Play',
    winsToWin: LONG_SERIES_WINS_TO_WIN,
    roleSwapEvery: LONG_PLAY_ROLE_SWAP_EVERY,
  }),
});
const LONG_PLAY_SHOP_MODES = new Set(['longplay', 'longseries']);
const LONG_PLAY_STARTER_WEAPON_ID = 'classic-pistol';
const GADGET_IDS = Object.freeze(Object.keys(GADGET_DEFINITIONS));

function isProgressionShop(room) {
  return LONG_PLAY_SHOP_MODES.has(room?.gameMode) ||
    (!room?.quickPlay && room?.customGameRules?.buyPhase === 'progression');
}

function isInfiniteGadgetUseEnabled(room) {
  return room?.quickPlay !== true && room?.customGameRules?.infiniteGadgetUse === true;
}

function getPrePhaseDurationMs(room) {
  return room.quickPlay
    ? QUICK_PLAY_COUNTDOWN_MS
    : (room.customGameRules?.prePhaseSeconds ?? MATCH_COUNTDOWN_MS / 1000) * 1_000;
}

function getGamePhaseDurationMs(room) {
  return room.quickPlay
    ? MATCH_DURATION_MS
    : (room.customGameRules?.gamePhaseSeconds ?? MATCH_DURATION_MS / 1_000) * 1_000;
}

function getPostPhaseDurationMs(room) {
  return room.quickPlay
    ? POST_GAME_RESPONSE_WINDOW_MS
    : (room.customGameRules?.postPhaseSeconds ?? POST_GAME_RESPONSE_WINDOW_MS / 1_000) * 1_000;
}

function getRoomMapCriteria(room) {
  return room?.customGameRules?.mapMode === 'varied'
    ? getCustomMapCriteria(room.customGameRules)
    : COMPETITIVE_MAP_RULES;
}

function getRoomMapOptions(room, { minRooms, maxRooms } = room.mapOptions) {
  const criteria = getRoomMapCriteria(room);
  return {
    minRooms,
    maxRooms,
    maxSiteApproachSightline: criteria.maxSiteApproachSightline,
  };
}
const STANDARD_GADGET_IDS = Object.freeze(GADGET_IDS.filter((id) =>
  !isUniqueGadgetDefinition(GADGET_DEFINITIONS[id])));
const BOT_GADGETS = Object.values(GADGET_DEFINITIONS);
const LONG_PLAY_SHOP_WEAPON_IDS = Object.freeze(Object.values(DEFAULT_PROJECTILE_DEFINITIONS)
  .map((definition) => definition.id).filter((id) => id !== LONG_PLAY_STARTER_WEAPON_ID));
const LONG_PLAY_FIRST_SHOP_OFFER_COUNT = 6;
const LONG_PLAY_LATER_SHOP_OFFER_COUNT = 5;
const LONG_PLAY_FIRST_SHOP_PICK_COUNT = 2;
const LONG_PLAY_LATER_SHOP_PICK_COUNT = 1;
const CUSTOM_MAP_CATALOG_FALLBACK_MS = 10_000;
const LONG_PLAY_FIRST_ROUND_WEAPON_IDS = new Set([
  'battle-pistol', 'revolver', 'machine-pistol', 'pocket-shotgun',
]);
const BOT_WEAPON_PREFERENCES = Object.freeze([
  'assault-rifle', 'assault-rifle', 'assault-rifle', 'battle-rifle', 'battle-rifle',
  'smg', 'smg', 'smg', 'machine-gun', 'machine-pistol',
  'shotgun', 'shotgun', 'shotgun', 'pocket-shotgun', 'sniper', 'sniper',
  'marksman-rifle', 'heavy-sniper', 'revolver', 'battle-pistol',
]);
const EMPTY_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, drop: false, weaponLean: 0, visionAngle: null });
const BOT_ACTOR = Symbol('flagstrike internal bot actor');

function createGadgetCounts(selectedGadgetId = null, count = 0) {
  return Object.fromEntries(GADGET_IDS.map((id) => [id, id === selectedGadgetId ? count : 0]));
}

function getGadgetStartingChargeCount(gadgetId) {
  return GADGET_DEFINITIONS[gadgetId]?.charges ?? 1;
}

function getBotStartingGadgetId(bot, random) {
  if (GADGET_DEFINITIONS[bot.selectedGadgetId]) return bot.selectedGadgetId;
  return chooseBotLoadoutGadgetId(BOT_GADGETS, random) ?? SMOKE_GRENADE_ID;
}

function isUniqueGadgetAvailableInLoadoutShop(definition, room) {
  if (isProgressionShop(room)) return false;
  if (definition.customMatchShopAvailable === true) return room.quickPlay !== true;
  return definition.alwaysAvailableInLoadoutShop === true;
}

function getTeamSpawn(map, team, index) {
  const offset = TEAM_SPAWN_OFFSETS[index % TEAM_CAPACITY];
  const spawnRoom = map.rooms.find((room) => room.isSpawn && room.team === team);
  if (!spawnRoom) throw new RoomManagerError(`The generated map is missing the ${team} spawn room.`);
  const direction = spawnRoom.x < map.width / 2 ? 1 : -1;
  return {
    x: spawnRoom.x + offset.x * direction,
    y: spawnRoom.y + offset.y,
  };
}

function getInitialFlagPosition(map) {
  const blueSpawn = map.spawnZones.blue;
  return { x: blueSpawn.x + blueSpawn.width / 2, y: blueSpawn.y + blueSpawn.height / 2 };
}

function mirrorMapHorizontally(map) {
  const mirrored = structuredClone(map);
  const reflectPoint = (point) => ({ ...point, x: map.width - point.x });

  for (const zone of Object.values(mirrored.spawnZones)) {
    zone.x = map.width - zone.x - zone.width;
  }
  for (const room of mirrored.rooms) {
    room.x = map.width - room.x;
    room.vertices = room.vertices.map(reflectPoint);
  }
  for (const corridor of mirrored.corridors) {
    corridor.points = corridor.points.map(reflectPoint);
    corridor.polygons = corridor.polygons.map((polygon) => polygon.map(reflectPoint));
  }
  for (const object of mirrored.objects) {
    if (object.shape === 'segment') {
      object.x1 = map.width - object.x1;
      object.x2 = map.width - object.x2;
    } else {
      object.x = map.width - object.x;
    }
  }
  return mirrored;
}

function getOppositeTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

function getQuickPlaySquadForTeam(room, team) {
  return Object.entries(room.quickPlayRoleBySquad ?? {}).find(([, role]) => role === team)?.[0] ?? null;
}

function getQuickPlayScoreByRole(room) {
  return Object.fromEntries(['A', 'B'].map((squadId) => [
    room.quickPlayRoleBySquad[squadId], room.quickPlayScoreBySquad[squadId] ?? 0,
  ]));
}

const PRE_GAME_LOADOUT_FIELDS = Object.freeze([
  'selectedWeaponId', 'selectedGadgetId', 'gadgetCount', 'gadgetCounts', 'inventory',
  'inventoryWeaponIds', 'weaponShopOfferIds', 'itemShopOfferIds', 'gadgetShopOfferIds',
  'uniqueGadgetShopOfferIds', 'uniqueGadgetShopCount', 'shopPicksRemaining',
  'weaponShopResolved', 'itemShopResolved', 'loadoutRevision', 'armor', 'maxArmor', 'weaponStats',
]);

function preservePreGameLoadout(actorState, serverPlayer) {
  const merged = { ...actorState };
  for (const field of PRE_GAME_LOADOUT_FIELDS) {
    if (serverPlayer[field] !== undefined) merged[field] = structuredClone(serverPlayer[field]);
  }
  return merged;
}

function rotateQuickPlayRoles(room) {
  room.quickPlayRoleBySquad = Object.fromEntries(Object.entries(room.quickPlayRoleBySquad)
    .map(([squadId, role]) => [squadId, getOppositeTeam(role)]));
  for (const client of room.clients) {
    client.team = room.quickPlayRoleBySquad[client.squadId];
  }
  for (const bot of room.quickPlayBotRoster ?? []) {
    bot.team = room.quickPlayRoleBySquad[bot.squadId];
  }
}

function isInsideZone(position, zone) {
  return position.x >= zone.x && position.x <= zone.x + zone.width &&
    position.y >= zone.y && position.y <= zone.y + zone.height;
}

function isWithinRadiusAndLineOfSight(origin, target, radius, visionObjects) {
  if (Math.hypot(target.x - origin.x, target.y - origin.y) > radius) return false;
  return isPointVisible(target, {
    origin,
    angle: 0,
    halfAngle: Math.PI,
    maximumRange: radius,
  }, visionObjects);
}

function updateDestructibleObjectIntel(match, now = Date.now()) {
  match.destructibleObjectIntel ??= { red: new Map(), blue: new Map() };
  const viewersByTeam = { red: [], blue: [] };
  const visionObjects = [...match.map.objects, ...(match.smokes ?? [])];
  for (const player of match.players) {
    if (!player.alive || player.health <= 0 || isPlayerJammed(player, now) ||
        isPlayerFlashBlinded(player, now) || !viewersByTeam[player.team]) continue;
    const angle = player.visionAngle ?? player.weaponStats?.['assault-rifle']?.aimAngle ?? 0;
    const origin = getPlayerVisionOrigin(player, match.map?.objects ?? []);
    viewersByTeam[player.team].push({
      origin,
      angle,
      halfAngle: VISION_HALF_ANGLE,
    });
  }
  for (const object of match.map?.objects ?? []) {
    if (object.role !== 'destructible-prop') continue;
    for (const team of ['red', 'blue']) {
      const intel = match.destructibleObjectIntel[team];
      if (intel.get(object.id) === object.health) continue;
      const visible = viewersByTeam[team].some((vision) => {
        const dx = vision.origin.x - object.x;
        const dy = vision.origin.y - object.y;
        const distance = Math.hypot(dx, dy) || 1;
        const unitX = dx / distance;
        const unitY = dy / distance;
        const surfaceDistance = object.shape === 'circle'
          ? object.radius
          : Math.min(
            object.width / 2 / Math.max(Math.abs(unitX), 1e-9),
            object.height / 2 / Math.max(Math.abs(unitY), 1e-9),
          );
        return isPointVisible({
          x: object.x + unitX * (surfaceDistance + 0.5),
          y: object.y + unitY * (surfaceDistance + 0.5),
        }, vision, visionObjects);
      });
      if (visible) intel.set(object.id, object.health);
    }
  }
}

function getMatchSnapshot(match, team = null) {
  const now = match.updatedAt ?? Date.now();
  return {
    startedAt: match.startedAt,
    gameplayStartsAt: match.gameplayStartsAt,
    endsAt: match.endsAt,
    updatedAt: match.updatedAt,
    infiniteGadgetUse: match.infiniteGadgetUse === true,
    players: match.players.map(({ botBrain, botDecision, pendingBotDecision, botInputSequence, nextProjectileAt, ...player }) => structuredClone(player)),
    smokes: structuredClone(match.smokes ?? []),
    gadgetEffects: structuredClone((match.gadgetEffects ?? []).filter((effect) => {
      if (effect.type === 'sonar-projectile') {
        return Boolean(team && effect.team === team && !isGadgetJammed(effect, now));
      }
      if (team && effect.team === team && isGadgetJammed(effect, now)) return false;
      return effect.triggerOnEnemyProximity !== true || Boolean(team && match.mineIntel?.[team]?.has(effect.id));
    })),
    pendingGadgetEffects: structuredClone((match.pendingGadgetEffects ?? []).filter((pending) =>
      pending.effect?.type === 'flash')),
    botNoises: structuredClone((match.botNoises ?? []).filter((cue) =>
      !cue.audiencePlayerId && (!cue.sonarId || Boolean(team && cue.team === team)))),
    flag: structuredClone(match.flag),
    victory: match.victory ? { ...match.victory } : null,
    postGame: match.postGame ? structuredClone(match.postGame) : null,
    quickPlayState: match.quickPlayState ? structuredClone(match.quickPlayState) : null,
    destructibleObjects: team
      ? [...(match.destructibleObjectIntel?.[team] ?? new Map())].map(([id, health]) => ({ id, health }))
      : [],
  };
}

function getMatchSnapshotsByTeam(match) {
  return { red: getMatchSnapshot(match, 'red'), blue: getMatchSnapshot(match, 'blue') };
}

function clonePublicMatch(match) {
  const { teamRoster, teamIntel, destructibleObjectIntel, audioCueLastAt, damageContributions,
    pendingGadgetEffects, mineIntel, ...publicMatch } = match;
  const snapshot = structuredClone(publicMatch);
  snapshot.gadgetEffects = (snapshot.gadgetEffects ?? []).filter((effect) =>
    effect.triggerOnEnemyProximity !== true && effect.type !== 'sonar-projectile');
  snapshot.botNoises = (snapshot.botNoises ?? []).filter((cue) => !cue.sonarId);
  snapshot.pendingGadgetEffects = structuredClone((pendingGadgetEffects ?? []).filter((pending) =>
    pending.effect?.type === 'flash'));
  for (const object of snapshot.map?.objects ?? []) {
    if (object.role !== 'destructible-prop') continue;
    object.health = object.maxHealth ?? 300;
    object.blocksMovement = true;
    object.blocksProjectiles = true;
    object.blocksVision = true;
  }
  for (const player of snapshot.players) {
    delete player.botBrain;
    delete player.botDecision;
    delete player.pendingBotDecision;
    delete player.botInputSequence;
    delete player.nextProjectileAt;
  }
  delete snapshot.botNoises;
  return snapshot;
}

function fingerprintMap(map) {
  const geometry = JSON.stringify({ rooms: map.rooms, corridors: map.corridors, objects: map.objects });
  return createHash('sha256').update(geometry).digest('hex');
}

function createWeaponAccuracyStates(definitions, now = 0, inventory = null) {
  return Object.fromEntries([...definitions.values()].map((definition) => [definition.id, {
    accuracy: definition.accuracy.startingAccuracy,
    shotsFired: 0,
    ammo: getEffectiveMagazineSize(definition.magazineSize, inventory) ?? null,
    reloading: false,
    reloadPaused: false,
    reloadIsMandatory: false,
    reloadStartedAt: null,
    reloadEndsAt: null,
    reloadRoundsInserted: null,
    manualActionStartedAt: null,
    manualActionEndsAt: null,
    manualActionQueuedDurationMs: null,
    aimAngle: 0,
    aimUpdatedAt: now,
    cooldownEndsAt: 0,
    burstShotsRemaining: 0,
  }]));
}

function getReloadInterval(definition, reloadRoundsInserted, inventory = null) {
  if (definition.reloadPerRound) {
    return getEffectiveReloadDuration(
      definition.reloadIntervalMs[Math.min(reloadRoundsInserted, definition.reloadIntervalMs.length - 1)], inventory);
  }
  return getEffectiveReloadDuration(definition.reloadDurationMs, inventory);
}

function startWeaponReload(player, definition, now, mandatory = false) {
  const magazineSize = getEffectiveMagazineSize(definition.magazineSize, player.inventory);
  if (!magazineSize || (!definition.reloadDurationMs && !definition.reloadPerRound)) return false;
  const stats = player.weaponStats?.[definition.id];
  if (!stats || stats.reloading || stats.ammo >= magazineSize) return false;
  if (stats.reloadPaused) {
    if (stats.manualActionEndsAt && now < stats.manualActionEndsAt) {
      queueManualAction(stats, definition.manualActionDurationMs);
    }
    stats.reloadIsMandatory = false;
    resumePausedReload(stats, now,
      getReloadInterval(definition, stats.reloadRoundsInserted ?? 0, player.inventory));
    stats.burstShotsRemaining = 0;
    return true;
  }
  if (stats.manualActionEndsAt && now < stats.manualActionEndsAt) {
    queueManualAction(stats, definition.manualActionDurationMs);
  }
  stats.reloading = true;
  stats.reloadPaused = false;
  stats.reloadIsMandatory = mandatory;
  stats.reloadStartedAt = now;
  stats.reloadRoundsInserted = definition.reloadPerRound ? 0 : null;
  stats.reloadEndsAt = now + getReloadInterval(definition, stats.reloadRoundsInserted ?? 0, player.inventory);
  stats.burstShotsRemaining = 0;
  return true;
}

export class RoomManagerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoomManagerError';
  }
}

export class RoomManager {
  constructor({ maxRooms = 256, maxClientsPerRoom = MAX_ROOM_CAPACITY, now = Date.now, random = Math.random, randomTeam = Math.random, projectileDefinitions = DEFAULT_PROJECTILE_DEFINITIONS, simulationMode = 'server-authoritative', competitiveMapStore = null } = {}) {
    if (!Number.isInteger(maxRooms) || maxRooms < 1) {
      throw new RangeError('maxRooms must be a positive integer.');
    }
    if (!Number.isInteger(maxClientsPerRoom) || maxClientsPerRoom < 1) {
      throw new RangeError('maxClientsPerRoom must be a positive integer.');
    }
    if (!['host-authoritative', 'server-authoritative'].includes(simulationMode)) {
      throw new RangeError('simulationMode must be host-authoritative or server-authoritative.');
    }
    this.maxRooms = maxRooms;
    this.maxClientsPerRoom = Math.min(maxClientsPerRoom, MAX_ROOM_CAPACITY);
    this.now = now;
    this.random = random;
    this.randomTeam = randomTeam;
    this.simulationMode = simulationMode;
    this.competitiveMapStore = competitiveMapStore;
    this.projectileDefinitions = new Map(Object.entries(projectileDefinitions).map(([key, definition]) => {
      const validated = validateProjectileDefinition({ ...definition, id: definition.id ?? key });
      return [validated.id, validated];
    }));
    this.defaultProjectileType = this.projectileDefinitions.has('assault-rifle')
      ? 'assault-rifle' : this.projectileDefinitions.keys().next().value;
    this.nextJoinOrder = 1;
    this.nextQuickPlayNumber = 1;
    this.nextLongPlayNumber = 1;
    this.nextLongSeriesNumber = 1;
    this.rooms = new Map();
    this.sessions = new Map();
  }

  listRooms() {
    return [...this.rooms.values()]
      .map((room) => {
        const teamCounts = this.getTeamCounts(room);
        const quickPlaySquadCounts = room.quickPlay
          ? Object.fromEntries(['A', 'B'].map((squadId) => [squadId,
            [...room.clients].filter((client) => client.squadId === squadId).length +
            (room.quickPlayBotRoster ?? []).filter((bot) => bot.squadId === squadId).length,
          ]))
          : null;
        return {
        name: room.name,
        clients: room.clients.size,
        capacity: this.maxClientsPerRoom,
        full: room.clients.size >= this.maxClientsPerRoom ||
          (teamCounts.red >= TEAM_CAPACITY && teamCounts.blue >= TEAM_CAPACITY &&
            !(room.customGameRules?.autoFillBots &&
              [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])].length > 0)),
        teamCounts,
        quickPlaySquadCounts,
        teamCapacity: TEAM_CAPACITY,
        locked: room.passwordHash !== null,
        hostName: this.getHost(room)?.playerName ?? 'Unknown player',
        inProgress: room.match !== null,
        quickPlay: room.quickPlay === true,
        gameMode: room.gameMode ?? (room.quickPlay ? 'quickplay' : 'custom'),
        quickPlayPhase: room.quickPlayState?.phase ?? null,
        quickPlayRound: room.quickPlayState?.round ?? 0,
        quickPlayAutoStartAt: room.quickPlayAutoStartAt ?? null,
      };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async createAndJoin(client, { name, password = '', displayName } = {}) {
    this.assertClientConnected(client);
    this.ensureClientId(client);
    const details = this.validateRoomDetails(name, password);
    const playerName = this.validateDisplayName(displayName);
    const key = details.name.toLowerCase();

    this.assertRoomCanBeCreated(key);

    let passwordSalt = null;
    let passwordHash = null;
    if (details.password) {
      passwordSalt = randomBytes(16);
      passwordHash = await scrypt(details.password, passwordSalt, PASSWORD_HASH_BYTES);
    }

    // Password hashing is asynchronous, so recheck before committing the room.
    this.assertClientConnected(client);
    this.assertRoomCanBeCreated(key);

    const room = {
      key,
      name: details.name,
      passwordSalt,
      passwordHash,
      clients: new Set(),
      hostId: client.id,
      authorityEpoch: 1,
      simulationMode: this.simulationMode,
      mapSeed: this.createMapSeed(),
      mapOptions: { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS },
      mapGenerationMode: 'competitive',
      match: null,
      postGame: null,
      nextPlayerNumber: 1,
      quickPlay: false,
      botRoster: { red: [], blue: [] },
      botActors: new Map(),
      mapGenerationPending: true,
      mapGenerationError: null,
      mapGenerationRevision: 0,
      mapGenerationCount: 0,
      customMapPromise: null,
      mapFallbackRequested: false,
      requestMapFallback: null,
      quickPlayStartedAt: null,
      quickPlayAutoStartAt: null,
      quickPlayState: null,
      customGameRules: structuredClone(DEFAULT_CUSTOM_GAME_RULES),
      customSeriesState: null,
      customSeriesMap: null,
    };
    client.sessionToken ??= randomUUID();
    this.rooms.set(key, room);
    const departure = this.leave(client);
    this.addClient(room, client, this.getRandomTeam(), playerName);
    this.sessions.set(client.sessionToken, client);
    this.prepareCustomRoomMap(room);

    return { room: this.toPublicRoom(room), state: this.toRoomState(room), departure, playerId: client.id, sessionToken: client.sessionToken };
  }

  async createPrivateSeries(client, { name, password = '', displayName, gameMode } = {}) {
    if (!SERIES_MODE_RULES[gameMode]) throw new RoomManagerError('Choose a supported game mode.');
    this.assertClientConnected(client);
    this.ensureClientId(client);
    const details = this.validateRoomDetails(name, password);
    if (!details.password) throw new RoomManagerError('Private mode rooms require a password.');
    const playerName = this.validateDisplayName(displayName);
    const key = details.name.toLowerCase();
    this.assertRoomCanBeCreated(key);

    const passwordSalt = randomBytes(16);
    const passwordHash = await scrypt(details.password, passwordSalt, PASSWORD_HASH_BYTES);

    this.assertClientConnected(client);
    this.assertRoomCanBeCreated(key);
    const departure = this.leave(client);
    return this.createCompetitiveRoom(client, gameMode, {
      key,
      name: details.name,
      passwordSalt,
      passwordHash,
      playerName,
      departure,
    });
  }

  async join(client, { name, password = '', displayName } = {}) {
    this.assertClientConnected(client);
    this.ensureClientId(client);
    const details = this.validateRoomDetails(name, password);
    const playerName = this.validateDisplayName(displayName);
    const room = this.rooms.get(details.name.toLowerCase());
    if (!room) {
      throw new RoomManagerError('That room does not exist. Refresh the room list and try again.');
    }

    if (room.passwordHash !== null) {
      if (!details.password) {
        throw new RoomManagerError('This room requires a password.');
      }

      const attemptedHash = await scrypt(details.password, room.passwordSalt, PASSWORD_HASH_BYTES);
      if (!timingSafeEqual(room.passwordHash, attemptedHash)) {
        throw new RoomManagerError('That password is incorrect.');
      }
      this.assertClientConnected(client);
    }

    if (this.rooms.get(room.key) !== room) {
      throw new RoomManagerError('That room is no longer available. Refresh the room list and try again.');
    }

    if (client.room === room) {
      return {
        room: this.toPublicRoom(room),
        state: this.toRoomState(room),
        departure: null,
        playerId: client.id,
        sessionToken: client.sessionToken,
      };
    }

    if (room.clients.size >= this.maxClientsPerRoom) {
      throw new RoomManagerError('That room is full.');
    }

    if (room.customGameRules?.autoFillBots && !room.quickPlay) {
      this.makeRoomForHumanJoin(room);
    }
    const team = room.quickPlay ? this.getBalancedQuickPlayTeam(room) : this.getBalancedTeam(room);
    const squadId = room.quickPlay ? getQuickPlaySquadForTeam(room, team) : null;
    const departure = this.leave(client);
    this.addClient(room, client, team, playerName, squadId);
    client.sessionToken ??= randomUUID();
    this.sessions.set(client.sessionToken, client);

    return {
      room: this.toPublicRoom(room),
      state: this.toRoomState(room),
      departure,
      playerId: client.id,
      sessionToken: client.sessionToken,
    };
  }

  async setRoomDetails(client, { name, password = '' } = {}) {
    const room = this.requireClientRoom(client);
    if (room.hostId !== client.id) throw new RoomManagerError('Only the room host can change room details.');
    if (room.passwordHash === null) {
      throw new RoomManagerError('Room details can only be changed for a private room.');
    }
    const details = this.validateRoomDetails(name, password);
    if (!details.password) throw new RoomManagerError('Private rooms must keep a password.');
    const nextKey = details.name.toLowerCase();
    const conflictingRoom = this.rooms.get(nextKey);
    if (conflictingRoom && conflictingRoom !== room) {
      throw new RoomManagerError('A room with that name already exists.');
    }

    const passwordSalt = randomBytes(16);
    const passwordHash = await scrypt(details.password, passwordSalt, PASSWORD_HASH_BYTES);
    this.assertClientConnected(client);
    if (client.room !== room || room.hostId !== client.id || this.rooms.get(room.key) !== room) {
      throw new RoomManagerError('The room changed while its details were being updated.');
    }
    const finalConflict = this.rooms.get(nextKey);
    if (finalConflict && finalConflict !== room) {
      throw new RoomManagerError('A room with that name already exists.');
    }

    if (room.key !== nextKey) {
      this.rooms.delete(room.key);
      room.key = nextKey;
      this.rooms.set(nextKey, room);
    }
    room.name = details.name;
    room.passwordSalt = passwordSalt;
    room.passwordHash = passwordHash;
    return this.toRoomState(room);
  }

  quickPlay(client, { displayName } = {}) {
    return this.joinCompetitiveSeries(client, 'quickplay', { displayName });
  }

  longPlay(client, { displayName } = {}) {
    return this.joinCompetitiveSeries(client, 'longplay', { displayName });
  }

  longSeries(client, { displayName } = {}) {
    return this.joinCompetitiveSeries(client, 'longseries', { displayName });
  }

  joinCompetitiveSeries(client, gameMode, { displayName } = {}) {
    const modeRules = SERIES_MODE_RULES[gameMode];
    if (!modeRules) throw new RoomManagerError('Choose a supported game mode.');
    this.assertClientConnected(client);
    this.ensureClientId(client);
    const playerName = this.validateDisplayName(displayName);
    if (client.room?.gameMode === gameMode && client.room.clients.has(client)) {
      return this.getJoinResult(client, null);
    }

    const candidates = [...this.rooms.values()]
      .filter((room) => room.quickPlay && room.gameMode === gameMode && room.passwordHash === null &&
        room.clients.size < this.maxClientsPerRoom &&
        (this.getTeamCounts(room).red < TEAM_CAPACITY || this.getTeamCounts(room).blue < TEAM_CAPACITY))
      .sort((left, right) => left.quickPlayStartedAt - right.quickPlayStartedAt);
    let room = candidates[0];
    if (room) {
      const team = this.getBalancedQuickPlayTeam(room);
      const squadId = getQuickPlaySquadForTeam(room, team);
      const departure = this.leave(client);
      this.addClient(room, client, team, playerName, squadId);
      client.sessionToken ??= randomUUID();
      this.sessions.set(client.sessionToken, client);
      return this.getJoinResult(client, departure);
    }

    if (this.rooms.size >= this.maxRooms) {
      throw new RoomManagerError('The server has reached its active room limit.');
    }
    const departure = this.leave(client);
    let name;
    let key;
    let nextNumber;
    do {
      nextNumber = gameMode === 'longplay' ? this.nextLongPlayNumber++
        : gameMode === 'longseries' ? this.nextLongSeriesNumber++ : this.nextQuickPlayNumber++;
      name = `${modeRules.label} ${nextNumber}`;
      key = name.toLowerCase();
    } while (this.rooms.has(key));

    return this.createCompetitiveRoom(client, gameMode, {
      key,
      name,
      playerName,
      departure,
    });
  }

  createCompetitiveRoom(client, gameMode, {
    key,
    name,
    passwordSalt = null,
    passwordHash = null,
    playerName,
    departure,
  }) {
    const modeRules = SERIES_MODE_RULES[gameMode];
    const now = this.now();
    const firstTeam = this.getRandomTeam();
    const firstSquadId = this.getRandomTeam() === 'red' ? 'A' : 'B';
    const room = {
      key,
      name,
      passwordSalt,
      passwordHash,
      clients: new Set(),
      hostId: client.id,
      authorityEpoch: 1,
      simulationMode: this.simulationMode,
      mapSeed: this.createMapSeed(),
      mapOptions: { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS },
      mapGenerationMode: 'competitive',
      match: null,
      postGame: null,
      nextPlayerNumber: 1,
      quickPlay: true,
      gameMode,
      mapGenerationRevision: 1,
      quickPlayStartedAt: now,
      quickPlayAutoStartAt: null,
      quickPlayState: {
        gameMode,
        winsToWin: modeRules.winsToWin,
        roleSwapEvery: modeRules.roleSwapEvery,
        phase: 'lobby',
        round: 0,
        score: { red: 0, blue: 0 },
        squadScore: { A: 0, B: 0 },
        rolesBySquad: { A: firstTeam, B: getOppositeTeam(firstTeam) },
        sidesSwapped: false,
        mapGenerationRevision: 1,
        ready: {},
        phaseEndsAt: null,
        lastResult: null,
        winner: null,
        winnerSquadId: null,
      },
      quickPlayMap: null,
      quickPlayMapPromise: null,
      quickPlayMapFallbackRequested: false,
      requestQuickPlayMapFallback: null,
      quickPlayUsedMapFingerprints: new Set(),
      quickPlaySidesSwapped: false,
      quickPlayRoleBySquad: { A: firstTeam, B: getOppositeTeam(firstTeam) },
      quickPlayScoreBySquad: { A: 0, B: 0 },
    };
    client.sessionToken ??= randomUUID();
    this.rooms.set(key, room);
    this.addClient(room, client, room.quickPlayRoleBySquad[firstSquadId], playerName, firstSquadId);
    this.sessions.set(client.sessionToken, client);
    this.prepareQuickPlayMap(room);
    return this.getJoinResult(client, departure);
  }

  getJoinResult(client, departure) {
    return {
      room: this.toPublicRoom(client.room),
      state: this.toRoomState(client.room),
      departure,
      playerId: client.id,
      sessionToken: client.sessionToken,
    };
  }

  setQuickPlayReady(client, { ready } = {}) {
    const room = this.requireClientRoom(client);
    if (!room.quickPlay || room.quickPlayState?.phase !== 'lobby' || room.match) {
      throw new RoomManagerError(`Ready status is only available during the ${SERIES_MODE_RULES[room.gameMode]?.label ?? 'series'} lobby.`);
    }
    if (typeof ready !== 'boolean') throw new RoomManagerError('Ready status must be true or false.');
    room.quickPlayState.ready[client.id] = ready;
    const everyoneReady = this.areQuickPlayPlayersReady(room);
    if (everyoneReady) {
      const now = this.now();
      if (room.quickPlayMap) {
        return { state: this.startMatchForRoom(room, now), started: true };
      }
      this.requestQuickPlayMapFallback(room);
    }
    return { state: this.toRoomState(room), started: false };
  }

  areQuickPlayPlayersReady(room) {
    return room.clients.size > 0 && [...room.clients].every((member) => room.quickPlayState?.ready?.[member.id] === true);
  }

  resumeSession(client, token) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
    const previous = this.sessions.get(token);
    if (!previous || !previous.room || !previous.room.clients.has(previous) ||
      (previous.connected === false && !Number.isFinite(previous.disconnectedAt))) return null;
    if (previous.connected === false && this.now() - previous.disconnectedAt > 15_000) return null;

    const socket = client.socket;
    const previousSocket = previous.socket;
    const room = previous.room;
    room.clients.delete(previous);
    Object.assign(client, previous);
    client.socket = socket;
    client.connected = true;
    client.disconnectedAt = null;
    room.clients.add(client);
    this.sessions.set(token, client);
    if (room.hostId === null || room.hostId === undefined) this.electHost(room);
    if (previousSocket && previousSocket !== socket && previousSocket.readyState === 1) {
      previousSocket.close(4001, 'Session resumed on a new connection');
    }
    return { state: this.toRoomState(room), playerId: client.id, sessionToken: token, replacedClient: previous };
  }

  markDisconnected(client) {
    if (!client.room || !client.room.clients.has(client)) return;
    client.connected = false;
    client.disconnectedAt = this.now();
    const room = client.room;
    if (room.hostId === client.id && !room.quickPlay && !room.match &&
        room.simulationMode === 'host-authoritative' && room.mapGenerationPending &&
        this.electHost(room)) {
      // Map generation runs in the host's browser. Invalidate work from a
      // disconnected host so the replacement host can submit a fresh map.
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
      room.preparedMap = null;
      room.mapGenerationError = null;
      room.mapGenerationCount = 0;
    }
  }

  expireDisconnected(client) {
    if (client.connected !== false || !client.room || !client.room.clients.has(client)) return null;
    if (client.sessionToken) this.sessions.delete(client.sessionToken);
    return this.leave(client);
  }

  leave(client) {
    const room = client.room;
    if (!room) return null;
    const departingTeam = client.team;

    room.clients.delete(client);
    client.room = null;
    client.team = null;
    client.squadId = null;
    client.customSquadId = null;
    client.inventory = createEmptyItemInventory();
    client.inventoryWeaponIds = undefined;
    client.selectedWeaponId = undefined;
    client.selectedGadgetId = null;
    client.gadgetCounts = createGadgetCounts();
    client.gadgetCount = 0;
    client.weaponShopOfferIds = [];
    client.itemShopOfferIds = [];
    client.gadgetShopOfferIds = [];
    client.uniqueGadgetShopOfferIds = [];
    client.uniqueGadgetShopCount = 0;
    client.shopPicksRemaining = 0;
    client.weaponShopResolved = false;
    client.nextProjectileAt = 0;
    if (client.sessionToken) this.sessions.delete(client.sessionToken);
    const hostChanged = room.hostId === client.id;
    if (room.quickPlayState?.ready) delete room.quickPlayState.ready[client.id];
    if (room.postGame?.choices[client.id] === 'waiting') room.postGame.choices[client.id] = 'leave';
    if (room.match) {
      const matchPlayer = room.match.players.find((player) => player.id === client.id);
      if (matchPlayer && room.match.flag.heldBy === client.id) {
        room.match.flag.heldBy = null;
        room.match.flag.x = matchPlayer.x;
        room.match.flag.y = matchPlayer.y;
        room.match.flag.dropped = true;
        room.match.flag.lastDroppedBy = null;
      }
      room.match.players = room.match.players.filter((player) => player.id !== client.id);
      if (matchPlayer && room.match.teamRoster?.[matchPlayer.team] !== undefined) {
        room.match.teamRoster[matchPlayer.team] = Math.max(0, room.match.teamRoster[matchPlayer.team] - 1);
      }
      room.match.updatedAt = this.now();
      if (room.latestHostFrame?.matchId === room.match.startedAt) {
        room.latestHostFrame.actors = room.latestHostFrame.actors.filter((actor) => actor.id !== client.id);
        room.latestHostFrame.acknowledgements =
          room.latestHostFrame.acknowledgements.filter((acknowledgement) => acknowledgement.id !== client.id);
        const flag = room.latestHostFrame.objectives.find((objective) => objective.id === 'flag');
        if (flag) flag.state = structuredClone(room.match.flag);
      }
    }
    if (room.customSeriesState?.teamShufflePending) {
      room.customSeriesState.teamShuffleTargetSizes = this.getCustomTeamSizes(room);
    }

    if (room.clients.size === 0) {
      this.rooms.delete(room.key);
      return { roomName: room.name, room: null, roomDeleted: true, hostChanged, departedClient: client };
    }

    if (hostChanged) {
      this.electHost(room);
    }

    if (!room.quickPlay && room.postGame && room.customSeriesState?.phase !== 'postgame' &&
        [...room.clients].every((member) => room.postGame.choices[member.id] === 'stay')) {
      this.prepareCustomIntermission(room);
    }
    if (departingTeam && room.customGameRules?.autoFillBots) {
      this.reconcileAutoFillBots(room);
    }

    return {
      roomName: room.name,
      room,
      roomDeleted: false,
      hostChanged,
      departedClient: client,
      state: this.toRoomState(room),
    };
  }

  setPlayerTeam(client, { playerId = client.id, team, swapWithPlayerId = null } = {}) {
    const room = this.requireClientRoom(client);
    const quickPlayResultPhase = room.quickPlay && room.quickPlayState?.phase === 'round-result';
    if (room.match && (room.match.victory || this.now() >= room.match.endsAt) && !quickPlayResultPhase) {
      throw new RoomManagerError('The match has ended. Wait for the host to return to the lobby.');
    }

    const player = [...room.clients].find((member) => member.id === playerId);
    if (!player) throw new RoomManagerError('That player is no longer in this room.');
    const isHost = room.hostId === client.id;
    if (!isHost && player !== client) {
      throw new RoomManagerError('You can only change your own team.');
    }
    if (room.match && !quickPlayResultPhase && !room.match.players.some((entry) => entry.id === player.id)) {
      throw new RoomManagerError('Players who join after a match starts can only spectate.');
    }

    const selectedTeam = this.validateTeam(team);
    const currentTeam = player.team;
    const quickPlayLobby = room.quickPlay && room.quickPlayState?.phase === 'lobby';
    if (room.quickPlay && selectedTeam !== currentTeam && !quickPlayLobby) {
      const modeLabel = SERIES_MODE_RULES[room.gameMode]?.label ?? 'Series';
      throw new RoomManagerError(`${modeLabel} team roles can only be changed in the lobby.`);
    }
    if (selectedTeam === currentTeam && !swapWithPlayerId) return this.toRoomState(room);
    if (room.match?.players.some((entry) => entry.id === player.id) && !quickPlayResultPhase) {
      throw new RoomManagerError('Players cannot change teams during an active match.');
    }

    const destination = selectedTeam;
    const destinationGroup = getTeamGroup(destination);
    const counts = this.getTeamCounts(room);
    let swappedPlayer = null;

    if (selectedTeam !== currentTeam && counts[destination] >= destinationGroup.capacity) {
      if (!isHost || typeof swapWithPlayerId !== 'string') {
        throw new RoomManagerError(`The ${destinationGroup.label.toLowerCase()} group is full.`);
      }
      swappedPlayer = [...room.clients].find((member) => member.id === swapWithPlayerId);
      if (!swappedPlayer || swappedPlayer === player || swappedPlayer.team !== selectedTeam) {
        throw new RoomManagerError('Choose a player from the full destination group to swap with.');
      }
    } else if (swapWithPlayerId !== null) {
      throw new RoomManagerError('A swap is only needed when the destination group is full.');
    }

    player.team = selectedTeam;
    if (room.quickPlay) player.squadId = getQuickPlaySquadForTeam(room, selectedTeam);
    else if (room.customSeriesState?.rolesBySquad) {
      player.customSquadId = Object.entries(room.customSeriesState.rolesBySquad)
        .find(([, role]) => role === selectedTeam)?.[0] ?? null;
    }
    if (swappedPlayer) {
      swappedPlayer.team = currentTeam;
      if (room.quickPlay) swappedPlayer.squadId = getQuickPlaySquadForTeam(room, currentTeam);
      else if (room.customSeriesState?.rolesBySquad) {
        swappedPlayer.customSquadId = Object.entries(room.customSeriesState.rolesBySquad)
          .find(([, role]) => role === currentTeam)?.[0] ?? null;
      }
    }
    if (room.quickPlay && room.quickPlayState?.phase === 'lobby') {
      room.quickPlayState.ready[player.id] = false;
      if (swappedPlayer) room.quickPlayState.ready[swappedPlayer.id] = false;
    }
    this.syncMatchPlayerTeam(room, player);
    if (swappedPlayer) this.syncMatchPlayerTeam(room, swappedPlayer);
    if (room.match) room.match.updatedAt = this.now();
    return this.toRoomState(room);
  }

  setMapSeed(client, { seed, random = false, randomRoomCount = false, roomCount, minRooms, maxRooms } = {}) {
    const room = this.requireClientRoom(client);
    if (room.hostId !== client.id) {
      throw new RoomManagerError('Only the room host can change the map seed.');
    }
    if (room.match) {
      throw new RoomManagerError('The map seed can only be changed before the match starts.');
    }

    let nextSeed = room.mapSeed;
    if (random === true) nextSeed = this.createMapSeed();
    else if (seed !== undefined) {
      if (!Number.isSafeInteger(seed) || seed < MIN_MAP_SEED || seed > MAX_MAP_SEED) {
        throw new RoomManagerError(`Map seeds must be whole numbers from ${MIN_MAP_SEED} to ${MAX_MAP_SEED}.`);
      }
      nextSeed = seed;
    }
    const selectedRoomCount = roomCount ?? (randomRoomCount ? randomInt(MIN_ROOMS, MAX_ROOMS + 1) : undefined);
    const nextMin = selectedRoomCount ?? minRooms ?? room.mapOptions.minRooms;
    const nextMax = selectedRoomCount ?? maxRooms ?? room.mapOptions.maxRooms;
    if (!Number.isSafeInteger(nextMin) || !Number.isSafeInteger(nextMax) ||
        nextMin < MIN_ROOMS || nextMax > MAX_ROOMS || nextMin > nextMax) {
      throw new RoomManagerError(`Room count range must be from ${MIN_ROOMS} to ${MAX_ROOMS}, with minimum no greater than maximum.`);
    }
    room.mapSeed = nextSeed;
    room.mapOptions = { minRooms: nextMin, maxRooms: nextMax };
    room.mapGenerationMode = 'seed';
    room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
    room.mapGenerationError = null;
    room.mapGenerationCount = 0;
    room.mapGenerationPending = true;
    room.preparedMap = null;
    if (room.simulationMode === 'host-authoritative') {
      room.customMapPromise = null;
    } else {
      this.startCustomMapGeneration(room, () => generateMap(nextSeed, MAP_WIDTH, MAP_HEIGHT, room.mapOptions));
    }
    return this.toRoomState(room);
  }

  setCustomGameRules(client, rules) {
    const room = this.requireClientRoom(client);
    if (room.quickPlay) throw new RoomManagerError('Playlist rules cannot be changed in a custom room.');
    if (room.hostId !== client.id) throw new RoomManagerError('Only the room host can change custom game rules.');
    if (room.match) throw new RoomManagerError('Custom game rules can only be changed between matches.');
    let nextRules;
    try {
      nextRules = normalizeCustomGameRules(rules, room.customGameRules ?? DEFAULT_CUSTOM_GAME_RULES);
    } catch (error) {
      if (error instanceof TypeError) throw new RoomManagerError(error.message);
      throw error;
    }

    const previousRules = room.customGameRules ?? DEFAULT_CUSTOM_GAME_RULES;
    const mapRulesChanged = previousRules.mapMode !== nextRules.mapMode ||
      JSON.stringify(previousRules.mapCriteria) !== JSON.stringify(nextRules.mapCriteria);
    room.customGameRules = nextRules;
    if (mapRulesChanged) {
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
      room.mapGenerationError = null;
      room.mapGenerationCount = 0;
      room.preparedMap = null;
      room.customMapPromise = null;
      if (nextRules.mapMode === 'host') {
        room.mapGenerationPending = false;
        room.mapGenerationMode = 'host-choice';
      } else {
        room.mapGenerationPending = true;
        room.mapGenerationMode = 'competitive';
        this.prepareCustomRoomMap(room);
      }
    }
    this.reconcileAutoFillBots(room);
    return this.toRoomState(room);
  }

  setBotTeam(client, { botId, team } = {}) {
    const room = this.requireClientRoom(client);
    if (room.quickPlay) throw new RoomManagerError('Bots can only be configured in custom matches.');
    if (room.hostId !== client.id) throw new RoomManagerError('Only the room host can configure bots.');
    if (room.match) throw new RoomManagerError('Bots can only be configured before a match starts.');
    const personality = BOT_PERSONALITIES.find((bot) => bot.id === botId);
    if (!personality) throw new RoomManagerError('That bot is not in the available roster.');
    if (team !== 'red' && team !== 'blue' && team !== 'none') {
      throw new RoomManagerError('Choose Strike Team, Flag Team, or Remove for this bot.');
    }
    const assignedBot = [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])]
      .find((bot) => bot.id === botId);
    const selectedBots = [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])]
      .filter((bot) => bot.id !== botId);
    if (team !== 'none') {
      const humanCounts = this.getHumanTeamCounts(room);
      const otherBotCount = selectedBots.filter((bot) => bot.team === team).length;
      if (humanCounts[team] + otherBotCount >= TEAM_CAPACITY) {
        throw new RoomManagerError(`The ${team} team is full (${TEAM_CAPACITY} players, including bots).`);
      }
      selectedBots.push({ ...personality, team });
    }
    room.botRoster = {
      red: selectedBots.filter((bot) => bot.team === 'red'),
      blue: selectedBots.filter((bot) => bot.team === 'blue'),
    };
    if (room.customSeriesState?.rolesBySquad) {
      for (const bot of selectedBots) {
        bot.customSquadId = Object.entries(room.customSeriesState.rolesBySquad)
          .find(([, role]) => role === bot.team)?.[0] ?? null;
      }
    }
    if (room.customSeriesState?.teamShufflePending && (!assignedBot || team === 'none')) {
      room.customSeriesState.teamShuffleTargetSizes = this.getCustomTeamSizes(room);
    }
    this.reconcileAutoFillBots(room);
    return this.toRoomState(room);
  }

  reconcileAutoFillBots(room) {
    if (room.quickPlay || room.customGameRules?.autoFillBots !== true) return;
    const assignedIds = new Set([
      ...(room.botRoster?.red ?? []),
      ...(room.botRoster?.blue ?? []),
    ].map((bot) => bot.id));
    const available = BOT_PERSONALITIES.filter((bot) => !assignedIds.has(bot.id));
    for (const team of ['red', 'blue']) {
      while (this.getTeamCounts(room)[team] < TEAM_CAPACITY && available.length > 0) {
        this.addRoomBot(room, available.shift(), team);
      }
    }
    if (room.customSeriesState?.teamShufflePending) {
      room.customSeriesState.teamShuffleTargetSizes = this.getCustomTeamSizes(room);
    }
  }

  addRoomBot(room, personality, team) {
    const bot = { ...personality, team };
    if (room.customSeriesState?.rolesBySquad) {
      bot.customSquadId = Object.entries(room.customSeriesState.rolesBySquad)
        .find(([, role]) => role === team)?.[0] ?? null;
    }
    room.botRoster[team].push(bot);
    if (room.match) this.addMatchBot(room, bot);
  }

  makeRoomForHumanJoin(room) {
    const counts = this.getTeamCounts(room);
    if (counts.red < TEAM_CAPACITY || counts.blue < TEAM_CAPACITY) return;
    const removableBots = ['red', 'blue'].flatMap((team) =>
      (room.botRoster?.[team] ?? []).map((bot) => ({ bot, team })));
    if (removableBots.length === 0) return;
    const selected = removableBots[Math.floor(this.random() * removableBots.length)];
    this.removeRoomBot(room, selected.bot, selected.team);
  }

  removeRoomBot(room, bot, team) {
    room.botRoster[team] = (room.botRoster[team] ?? []).filter((entry) => entry.id !== bot.id);
    if (room.match) {
      const matchBot = room.match.players.find((player) => player.id === bot.id);
      if (matchBot && room.match.flag.heldBy === bot.id) {
        room.match.flag.heldBy = null;
        room.match.flag.x = matchBot.x;
        room.match.flag.y = matchBot.y;
        room.match.flag.dropped = true;
        room.match.flag.lastDroppedBy = null;
      }
      room.match.players = room.match.players.filter((player) => player.id !== bot.id);
      room.match.teamRoster[team] = Math.max(0, room.match.teamRoster[team] - Number(Boolean(matchBot)));
      room.match.updatedAt = this.now();
      room.botActors?.delete(bot.id);
      if (room.latestHostFrame?.matchId === room.match.startedAt) {
        room.latestHostFrame.actors = room.latestHostFrame.actors.filter((actor) => actor.id !== bot.id);
      }
    }
  }

  addMatchBot(room, bot) {
    const match = room.match;
    const now = this.now();
    const teamIndex = match.players.filter((player) => player.team === bot.team).length;
    const teammate = match.players.find((player) => player.team === bot.team);
    const buyPhaseDisabled = room.customGameRules?.buyPhase === 'none';
    const selectedWeaponId = buyPhaseDisabled
      ? bot.selectedWeaponId ?? this.defaultProjectileType
      : teammate?.selectedWeaponId ??
        chooseBotLoadoutWeaponId([...this.projectileDefinitions.values()], this.random) ??
        this.defaultProjectileType;
    const selectedGadgetId = buyPhaseDisabled
      ? null
      : teammate?.selectedGadgetId ?? chooseBotLoadoutGadgetId(BOT_GADGETS, this.random);
    const inventory = normalizeItemInventory(teammate?.inventory ?? createDefaultMatchItemInventory());
    const gadgetCount = selectedGadgetId ? getGadgetStartingChargeCount(selectedGadgetId) : 0;
    bot.selectedWeaponId = selectedWeaponId;
    bot.selectedGadgetId = selectedGadgetId;
    bot.gadgetCount = gadgetCount;
    bot.gadgetCounts = createGadgetCounts(selectedGadgetId, gadgetCount);
    bot.inventory = inventory;
    bot.inventoryWeaponIds = isProgressionShop(room) ? [selectedWeaponId] : undefined;
    bot.weaponShopOfferIds = [];
    bot.itemShopOfferIds = [];
    bot.gadgetShopOfferIds = [];
    bot.shopPicksRemaining = 0;
    bot.weaponShopResolved = true;
    match.players.push({
      id: bot.id,
      name: bot.name,
      team: bot.team,
      isBot: true,
      ...getTeamSpawn(match.map, bot.team, teamIndex),
      vx: 0,
      vy: 0,
      health: PLAYER_MAX_HEALTH,
      armor: getInventoryEffects(inventory).armor,
      maxArmor: getInventoryEffects(inventory).armor,
      lastDamagedAt: now,
      stats: { kills: 0, assists: 0, deaths: 0 },
      alive: true,
      isSpectator: false,
      weaponLean: 0,
      visionAngle: 0,
      selectedWeaponId,
      selectedGadgetId,
      gadgetCounts: structuredClone(bot.gadgetCounts),
      gadgetCount,
      uniqueGadgetShopOfferIds: [],
      equippedSlot: 'weapon',
      gadgetSwitchStartedAt: null,
      gadgetSwitchEndsAt: null,
      gadgetSwitchTargetSlot: null,
      inventory,
      ...(isProgressionShop(room) ? {
        inventoryWeaponIds: [...bot.inventoryWeaponIds],
        weaponShopOfferIds: [],
        itemShopOfferIds: [],
        gadgetShopOfferIds: [],
        shopPicksRemaining: 0,
        weaponShopResolved: true,
      } : {}),
      weaponStats: createWeaponAccuracyStates(this.projectileDefinitions, now, inventory),
      lastInputSequence: 0,
      lastWeaponActionSequence: 0,
      input: { ...EMPTY_INPUT },
      controlledById: null,
      controlRevision: 0,
    });
    match.teamRoster[bot.team] += 1;
    match.updatedAt = now;
    room.botActors ??= new Map();
    room.botActors.set(bot.id, {
      [BOT_ACTOR]: true,
      id: bot.id,
      playerName: bot.name,
      team: bot.team,
      room,
      connected: true,
      roomInput: { ...EMPTY_INPUT },
      roomInputSequence: 0,
      roomInputAt: now,
      nextProjectileAt: 0,
      selectedWeaponId,
    });
  }

  setBotController(client, { botId, takeControl = true } = {}) {
    const room = this.requireClientRoom(client);
    if (typeof takeControl !== 'boolean') throw new RoomManagerError('Bot control must be true or false.');
    const match = room.match;
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!match || ((match.victory || now >= match.endsAt) && !postGameFreeRoam)) {
      throw new RoomManagerError('Bot takeover is only available during an active match or postgame free-roam.');
    }
    if (!postGameFreeRoam) this.assertGameplayStarted(match);
    const human = match.players.find((player) => player.id === client.id);
    if (human && human.isSpectator !== true && human.alive !== false &&
        (human.health ?? PLAYER_MAX_HEALTH) > 0) {
      throw new RoomManagerError('Living players cannot take over bots.');
    }
    const bot = match.players.find((player) => player.id === botId && player.isBot);
    const actor = room.botActors?.get(botId);
    const controllingTeam = human?.team ?? client.team;
    if (!bot || !actor || bot.isSpectator === true || bot.alive === false ||
        (bot.health ?? 0) <= 0 || bot.team !== controllingTeam) {
      throw new RoomManagerError('Choose a living bot on your team.');
    }

    if (!takeControl) {
      if (bot.controlledById !== client.id) throw new RoomManagerError('You do not control that bot.');
      bot.controlledById = null;
      bot.controlRevision = (bot.controlRevision ?? 0) + 1;
      bot.lastInputSequence = actor.roomInputSequence;
      actor.roomInput = { ...EMPTY_INPUT };
      actor.roomInputAt = this.now();
      return this.toRoomState(room);
    }

    if (bot.controlledById && bot.controlledById !== client.id) {
      throw new RoomManagerError('That bot is already controlled by a teammate.');
    }
    const alreadyControlled = match.players.find((player) => player.isBot && player.controlledById === client.id && player.id !== botId);
    if (alreadyControlled) throw new RoomManagerError('Release your current bot before taking over another.');
    if (bot.controlledById !== client.id) bot.controlRevision = (bot.controlRevision ?? 0) + 1;
    bot.controlledById = client.id;
    bot.lastInputSequence = actor.roomInputSequence;
    actor.roomInput = { ...EMPTY_INPUT };
    actor.roomInputAt = this.now();
    return this.toRoomState(room);
  }

  beginCompetitiveMapGeneration(client, { maxAttempts = Infinity } = {}) {
    const room = this.requireClientRoom(client);
    if (room.hostId !== client.id) throw new RoomManagerError('Only the room host can generate a competitive map.');
    if (room.match) throw new RoomManagerError('A competitive map can only be generated before the match starts.');
    if (room.simulationMode === 'host-authoritative') {
      room.mapGenerationPending = true;
      room.mapGenerationError = null;
      room.mapGenerationCount = 0;
      room.preparedMap = null;
      room.mapGenerationMode = 'competitive';
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
      const promise = Promise.resolve({ state: this.toRoomState(room), mapsGenerated: 0 });
      room.customMapPromise = promise;
      return { state: this.toRoomState(room), promise };
    }
    const rules = getRoomMapCriteria(room);
    const generation = this.startCustomMapGeneration(room, () =>
      this.createCompetitiveMapWithFallback((signal) => this.createCompetitiveMapData({ maxAttempts, signal, rules }), {
        fallbackAfterMs: CUSTOM_MAP_CATALOG_FALLBACK_MS,
        rules,
        onFallbackAvailable: (requestFallback) => {
          room.requestMapFallback = requestFallback;
          if (room.mapFallbackRequested) requestFallback();
        },
      }));
    const revision = room.mapGenerationRevision;
    const promise = generation.then((prepared) => {
      if (!prepared) throw new RoomManagerError(room.mapGenerationError ?? 'Could not generate a competitive map.');
      if (room.mapGenerationRevision !== revision || this.rooms.get(room.key) !== room || room.match) {
        return { state: this.toRoomState(room), mapsGenerated: prepared.attempts };
      }
      room.mapSeed = prepared.seed;
      room.mapOptions = prepared.mapOptions;
      return { state: this.toRoomState(room), mapsGenerated: prepared.attempts };
    }).finally(() => {
      if (room.customMapPromise === promise) room.customMapPromise = null;
    });
    room.customMapPromise = promise;
    return { state: this.toRoomState(room), promise };
  }

  async generateCompetitiveMap(client, options = {}) {
    const generation = this.beginCompetitiveMapGeneration(client, options);
    const completed = await generation.promise;
    return { ...completed.state, mapsGenerated: completed.mapsGenerated };
  }

  startCustomMapGeneration(room, buildMap) {
    const revision = (room.mapGenerationRevision ?? 0) + 1;
    room.mapGenerationRevision = revision;
    room.mapGenerationPending = true;
    room.mapGenerationError = null;
    room.mapGenerationCount = 0;
    room.mapFallbackRequested = false;
    room.requestMapFallback = null;
    const preparation = new Promise((resolve) => setImmediate(resolve))
      .then(buildMap)
      .catch((error) => {
        if (this.rooms.get(room.key) === room && room.mapGenerationRevision === revision) {
          room.mapGenerationError = error instanceof Error ? error.message : 'Could not generate the map.';
        }
        return null;
      })
      .finally(() => {
        if (this.rooms.get(room.key) !== room || room.mapGenerationRevision !== revision) return;
        room.mapGenerationPending = false;
        room.requestMapFallback = null;
        if (room.customMapPromise === preparation) room.customMapPromise = null;
      });
    room.customMapPromise = preparation;
    return preparation;
  }

  async createCompetitiveMapWithFallback(buildFreshMap, {
    excludedFingerprints = new Set(),
    rules = COMPETITIVE_MAP_RULES,
    fallbackAfterMs = null,
    onFallbackAvailable,
  } = {}) {
    const controller = new AbortController();
    const freshMapPromise = Promise.resolve().then(() => buildFreshMap(controller.signal));
    let requestFallback;
    const fallbackRequested = new Promise((resolve) => { requestFallback = resolve; });
    onFallbackAvailable?.(requestFallback);
    const fallbackTimer = Number.isFinite(fallbackAfterMs) && fallbackAfterMs > 0
      ? setTimeout(requestFallback, fallbackAfterMs)
      : null;

    let outcome;
    try {
      outcome = await Promise.race([
        freshMapPromise.then((prepared) => ({ type: 'fresh', prepared })),
        fallbackRequested.then(() => ({ type: 'fallback' })),
      ]);
    } finally {
      if (fallbackTimer) clearTimeout(fallbackTimer);
    }
    if (outcome.type === 'fresh') return outcome.prepared;

    const catalogMap = this.competitiveMapStore?.list
      ? await this.createCatalogCompetitiveMapData({ excludedFingerprints, rules })
      : null;
    if (catalogMap) {
      controller.abort();
      return catalogMap;
    }
    return freshMapPromise;
  }

  async createCatalogCompetitiveMapData({
    excludedFingerprints = new Set(),
    rules = COMPETITIVE_MAP_RULES,
  } = {}) {
    const catalog = await this.competitiveMapStore?.list?.();
    if (!catalog?.length) return null;
    const excluded = excludedFingerprints instanceof Set
      ? excludedFingerprints : new Set(excludedFingerprints);
    const firstIndex = randomInt(0, catalog.length);

    for (let offset = 0; offset < catalog.length; offset += 1) {
      const entry = catalog[(firstIndex + offset) % catalog.length];
      if (entry.roomCount < rules.minRooms || entry.roomCount > rules.maxRooms) continue;
      const mapOptions = {
        minRooms: entry.roomCount,
        maxRooms: entry.roomCount,
        maxSiteApproachSightline: rules.maxSiteApproachSightline,
      };
      const map = this.generateCompetitiveMapCandidate(entry.seed, mapOptions);
      if (!isCompetitiveMap(map, rules)) continue;
      const fingerprint = fingerprintMap(map);
      if (excluded.has(fingerprint)) continue;
      return { seed: entry.seed, mapOptions, map, fingerprint, attempts: 0, fromCatalog: true };
    }

    return null;
  }

  async createCompetitiveMapData({
    maxAttempts = Infinity,
    excludedFingerprints = new Set(),
    signal,
    rules = COMPETITIVE_MAP_RULES,
  } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (signal?.aborted) throw new RoomManagerError('Competitive map search was cancelled.');
      const roomCount = randomInt(rules.minRooms, rules.maxRooms + 1);
      const seed = this.createMapSeed();
      const mapOptions = {
        minRooms: roomCount,
        maxRooms: roomCount,
        maxSiteApproachSightline: rules.maxSiteApproachSightline,
      };
      const map = this.generateCompetitiveMapCandidate(seed, mapOptions);
      if (!isCompetitiveMap(map, rules)) {
        if (attempt % 4 === 3) await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      const fingerprint = fingerprintMap(map);
      if (excludedFingerprints.has(fingerprint)) continue;
      const prepared = { seed, mapOptions, map, fingerprint, attempts: attempt + 1 };
      if (rules === COMPETITIVE_MAP_RULES) await this.recordCompetitiveMap(prepared);
      return prepared;
    }
    throw new RoomManagerError(`Could not find a competitive map after ${maxAttempts} attempts. Try again.`);
  }

  generateCompetitiveMapCandidate(seed, mapOptions) {
    return generateMap(seed, MAP_WIDTH, MAP_HEIGHT, mapOptions);
  }

  recordCompetitiveMap(prepared) {
    if (!this.competitiveMapStore) return Promise.resolve();
    return this.competitiveMapStore.record({
      seed: prepared.seed,
      roomCount: prepared.mapOptions.minRooms,
    });
  }

  prepareCustomRoomMap(room) {
    if (room.simulationMode === 'host-authoritative') {
      room.mapGenerationPending = true;
      return null;
    }
    if (room.quickPlay || (room.match && !room.match.victory) ||
        !room.mapGenerationPending || room.customMapPromise) return room.customMapPromise;
    const rules = getRoomMapCriteria(room);
    const generation = this.startCustomMapGeneration(room, () =>
      this.createCompetitiveMapWithFallback((signal) => this.createCompetitiveMapData({ signal, rules }), {
        rules,
        onFallbackAvailable: (requestFallback) => {
          room.requestMapFallback = requestFallback;
          if (room.mapFallbackRequested) requestFallback();
        },
      }));
    const preparation = generation
      .then((prepared) => {
        if (!prepared || this.rooms.get(room.key) !== room || (room.match && !room.match.victory) ||
            room.mapGenerationRevision !== preparation.revision) return null;
        room.mapSeed = prepared.seed;
        room.mapOptions = prepared.mapOptions;
        return prepared;
      })
      .finally(() => {
        if (room.customMapPromise === preparation) room.customMapPromise = null;
      });
    preparation.revision = room.mapGenerationRevision;
    room.customMapPromise = preparation;
    return preparation;
  }

  requestCustomMapFallback(room) {
    if (!room?.mapGenerationPending) return false;
    room.mapFallbackRequested = true;
    room.requestMapFallback?.();
    return true;
  }

  requestQuickPlayMapFallback(room) {
    if (!room?.quickPlay || room.quickPlayMap) return false;
    room.quickPlayMapFallbackRequested = true;
    room.requestQuickPlayMapFallback?.();
    return true;
  }

  prepareQuickPlayMap(room) {
    if (room.simulationMode === 'host-authoritative') return null;
    if (!room.quickPlay || room.quickPlayMap || room.quickPlayMapPromise) return room.quickPlayMapPromise;
    if (this.now() < (room.quickPlayMapRetryAt ?? 0)) return null;
    room.quickPlayMapReadyNotified = false;
    const preparation = new Promise((resolve) => setImmediate(resolve))
      .then(() => this.createCompetitiveMapWithFallback((signal) => this.createQuickPlayMapData({
        excludedFingerprints: room.quickPlayUsedMapFingerprints,
        signal,
      }), {
        excludedFingerprints: room.quickPlayUsedMapFingerprints,
        onFallbackAvailable: (requestFallback) => {
          room.requestQuickPlayMapFallback = requestFallback;
          if (room.quickPlayMapFallbackRequested) requestFallback();
        },
      })).then(async (prepared) => {
      if (this.rooms.get(room.key) !== room) return null;
      await this.recordCompetitiveMap(prepared);
      room.quickPlayMap = prepared;
      room.mapSeed = prepared.seed;
      room.mapOptions = prepared.mapOptions;
      if ((room.quickPlayState?.round ?? 0) === 0) {
        const leftSiteTeam = Object.entries(prepared.map.spawnZones)
          .sort((left, right) => left[1].x - right[1].x)[0]?.[0];
        room.quickPlaySidesSwapped = room.quickPlayRoleBySquad.A !== leftSiteTeam;
      }
      room.quickPlayMapRetryAt = 0;
      return prepared;
    }).catch(() => {
      room.quickPlayMapRetryAt = this.now() + 1_000;
      return null;
    }).finally(() => {
      room.requestQuickPlayMapFallback = null;
      if (room.quickPlayMapPromise === preparation) room.quickPlayMapPromise = null;
    });
    room.quickPlayMapPromise = preparation;
    return preparation;
  }

  createQuickPlayMapData(options) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./QuickPlayMapWorker.mjs', import.meta.url), {
        workerData: {
          maxAttempts: options?.maxAttempts ?? Infinity,
          excludedFingerprints: [...(options?.excludedFingerprints ?? [])],
        },
      });
      let settled = false;
      const signal = options?.signal;
      const cleanUpAbortListener = () => signal?.removeEventListener('abort', abortWorker);
      const abortWorker = () => {
        if (settled) return;
        settled = true;
        cleanUpAbortListener();
        void worker.terminate();
        reject(new RoomManagerError('Competitive map search was cancelled.'));
      };
      worker.once('message', (message) => {
        if (settled) return;
        settled = true;
        cleanUpAbortListener();
        if (message.error) reject(new RoomManagerError(message.error));
        else resolve(message.prepared);
      });
      worker.once('error', (error) => {
        if (settled) return;
        settled = true;
        cleanUpAbortListener();
        reject(error);
      });
      worker.once('exit', (code) => {
        if (settled) return;
        settled = true;
        cleanUpAbortListener();
        reject(new Error(`Competitive map worker exited without a result (code ${code}).`));
      });
      if (signal?.aborted) abortWorker();
      else signal?.addEventListener('abort', abortWorker, { once: true });
    });
  }

  createMapSeed() {
    return randomInt(MIN_MAP_SEED, MAX_MAP_SEED + 1);
  }

  startMatch(client) {
    const room = this.requireClientRoom(client);
    if (room.hostId !== client.id) {
      throw new RoomManagerError('Only the current room host can start a match.');
    }
    if (room.match) {
      throw new RoomManagerError('A match is already in progress.');
    }
    if (room.quickPlay) {
      const modeLabel = SERIES_MODE_RULES[room.gameMode]?.label ?? 'Series';
      throw new RoomManagerError(`${modeLabel} starts automatically after players ready up.`);
    }
    if (room.customSeriesState?.teamShufflePending) {
      throw new RoomManagerError('The host must approve the team shuffle before the next match.');
    }
    if (room.mapGenerationMode === 'host-choice') {
      throw new RoomManagerError('Choose and prepare a map before starting the next match.');
    }
    if ((room.simulationMode === 'host-authoritative' &&
        (room.mapGenerationPending || (!room.preparedMap &&
          !(room.customGameRules.mapMode === 'same' && room.customSeriesMap)))) ||
        (room.simulationMode === 'server-authoritative' &&
          room.customGameRules.mapMode !== 'competitive' && room.mapGenerationPending)) {
      throw new RoomManagerError('Wait for the host to finish generating and submitting a map before starting.');
    }
    return this.startMatchForRoom(room, this.now());
  }

  prepareMatchShop(room, clients, botRoster, matchNumber) {
    const progressionShop = isProgressionShop(room);
    const progressionRound = room.quickPlay
      ? (LONG_PLAY_SHOP_MODES.has(room.gameMode) ? (room.quickPlayState?.round ?? 0) + 1 : 0)
      : progressionShop ? matchNumber : 0;
    const customRules = room.quickPlay ? null : room.customGameRules;
    if (progressionRound) {
      if (customRules && progressionRound === 1) {
        for (const player of clients) {
          player.inventory = createEmptyItemInventory();
          player.inventoryWeaponIds = [LONG_PLAY_STARTER_WEAPON_ID];
          player.selectedWeaponId = LONG_PLAY_STARTER_WEAPON_ID;
          player.selectedGadgetId = null;
          player.gadgetCount = 0;
          player.gadgetCounts = createGadgetCounts();
          player.uniqueGadgetShopCount = 0;
          player.uniqueGadgetShopOfferIds = [];
        }
        for (const bot of botRoster) {
          bot.inventory = createEmptyItemInventory();
          bot.inventoryWeaponIds = [LONG_PLAY_STARTER_WEAPON_ID];
          bot.selectedWeaponId = LONG_PLAY_STARTER_WEAPON_ID;
          bot.selectedGadgetId = null;
          bot.gadgetCount = 0;
          bot.gadgetCounts = createGadgetCounts();
        }
      }
      for (const player of clients) {
        this.prepareLongPlayShop(player, progressionRound, true, { customRules });
      }
      for (const bot of botRoster) {
        this.prepareLongPlayShop(bot, progressionRound, true, { allowUnique: false, customRules });
        this.chooseLongPlayBotShopOffers(bot);
      }
      return;
    }
    if (customRules?.buyPhase === 'none') {
      for (const player of clients) {
        player.uniqueGadgetShopOfferIds = [];
        player.weaponShopOfferIds = [];
        player.itemShopOfferIds = [];
        player.gadgetShopOfferIds = [];
        player.shopPicksRemaining = 0;
        player.weaponShopResolved = true;
        player.itemShopResolved = true;
      }
      for (const bot of botRoster) {
        bot.uniqueGadgetShopOfferIds = [];
        bot.weaponShopOfferIds = [];
        bot.itemShopOfferIds = [];
        bot.gadgetShopOfferIds = [];
        bot.shopPicksRemaining = 0;
        bot.weaponShopResolved = true;
        bot.itemShopResolved = true;
      }
      return;
    }
    for (const player of clients) {
      this.prepareUniqueGadgetShopOffers(player, customRules);
      const selectedGadget = GADGET_DEFINITIONS[player.selectedGadgetId];
      const gadgetId = selectedGadget && (!isUniqueGadgetDefinition(selectedGadget) ||
        isUniqueGadgetAvailableInLoadoutShop(selectedGadget, room) ||
        player.uniqueGadgetShopOfferIds.includes(player.selectedGadgetId))
        ? player.selectedGadgetId : SMOKE_GRENADE_ID;
      player.selectedGadgetId = gadgetId;
      player.gadgetCount = getGadgetStartingChargeCount(gadgetId);
      player.gadgetCounts = createGadgetCounts(gadgetId, player.gadgetCount);
      player.itemShopOfferIds = [];
      player.shopPicksRemaining = 0;
      player.itemShopResolved = true;
    }
    for (const bot of botRoster) {
      bot.inventory = createDefaultMatchItemInventory();
      const gadgetId = getBotStartingGadgetId(bot, this.random);
      bot.uniqueGadgetShopOfferIds = [];
      bot.selectedGadgetId = gadgetId;
      bot.gadgetCount = getGadgetStartingChargeCount(gadgetId);
      bot.gadgetCounts = createGadgetCounts(gadgetId, bot.gadgetCount);
      bot.itemShopOfferIds = [];
      bot.shopPicksRemaining = 0;
      bot.itemShopResolved = true;
    }
  }

  startMatchForRoom(room, startedAt = this.now()) {
    let customMatchNumber = 0;
    if (!room.quickPlay) {
      if (!room.customSeriesState || room.customSeriesState.phase === 'complete') {
        room.customSeriesState = {
          matchNumber: 0,
          score: { A: 0, B: 0 },
          rolesBySquad: { A: 'red', B: 'blue' },
          phase: 'lobby',
          winner: null,
          lastResult: null,
          lastMatchScoreboard: null,
          seriesScoreboard: [],
          teamShufflePending: false,
          teamShuffleApproved: true,
          teamShuffleTargetSizes: null,
        };
        for (const client of room.clients) {
          client.customSquadId = client.team === 'blue' ? 'B' : 'A';
        }
        for (const bot of [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])]) {
          bot.customSquadId = bot.team === 'blue' ? 'B' : 'A';
        }
      }
      customMatchNumber = room.customSeriesState.matchNumber + 1;
      room.customSeriesState.matchNumber = customMatchNumber;
      room.customSeriesState.phase = 'playing';
      room.customSeriesState.winner = null;
      delete room.customSeriesState.nextMatchAt;
    }
    const progressionShop = isProgressionShop(room);
    if (room.simulationMode === 'host-authoritative') {
      const clients = [...room.clients];
      const botRoster = room.quickPlay
        ? this.createQuickPlayBotRoster(clients, room)
        : [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])];
      if (room.quickPlay) room.quickPlayBotRoster = botRoster;
      const map = room.preparedMap ?? room.quickPlayMap?.map ??
        (!room.quickPlay && room.customGameRules?.mapMode === 'same' ? room.customSeriesMap : null);
      if (!map) throw new RoomManagerError('The host has not submitted a map yet.');
      if (!room.quickPlay) room.customSeriesMap = structuredClone(map);
      this.prepareMatchShop(room, clients, botRoster, customMatchNumber);
      const gameplayStartsAt = startedAt + getPrePhaseDurationMs(room);
      const flagPosition = getInitialFlagPosition(map);
      room.match = {
        startedAt,
        gameplayStartsAt,
        endsAt: gameplayStartsAt + getGamePhaseDurationMs(room),
        updatedAt: startedAt,
        infiniteGadgetUse: isInfiniteGadgetUseEnabled(room),
        map,
        flag: { ...flagPosition, heldBy: null, dropped: false, lastDroppedBy: null },
        victory: null,
        postGame: null,
        quickPlayState: null,
        teamRoster: {
          red: clients.filter((player) => player.team === 'red').length +
            botRoster.filter((bot) => bot.team === 'red').length,
          blue: clients.filter((player) => player.team === 'blue').length +
            botRoster.filter((bot) => bot.team === 'blue').length,
        },
        players: [
          ...clients.map((player) => ({
            id: player.id, name: player.playerName, team: player.team,
            ...((room.quickPlay ? player.squadId : player.customSquadId)
              ? { squadId: room.quickPlay ? player.squadId : player.customSquadId } : {}),
            selectedWeaponId: player.selectedWeaponId ?? this.defaultProjectileType,
            selectedGadgetId: player.selectedGadgetId,
            loadoutRevision: player.loadoutRevision ?? 0,
            gadgetCounts: structuredClone(player.gadgetCounts),
            gadgetCount: player.gadgetCount,
            uniqueGadgetShopOfferIds: [...(player.uniqueGadgetShopOfferIds ?? [])],
            inventory: normalizeItemInventory(player.inventory),
            itemShopOfferIds: structuredClone(player.itemShopOfferIds ?? []),
            shopPicksRemaining: player.shopPicksRemaining ?? 0,
            itemShopResolved: player.itemShopResolved === true,
            ...(isProgressionShop(room) ? {
              inventoryWeaponIds: [...(player.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID])],
              weaponShopOfferIds: [...(player.weaponShopOfferIds ?? [])],
              itemShopOfferIds: structuredClone(player.itemShopOfferIds ?? []),
              gadgetShopOfferIds: [...(player.gadgetShopOfferIds ?? [])],
              shopPicksRemaining: player.shopPicksRemaining ?? 0,
              weaponShopResolved: player.weaponShopResolved === true,
            } : {}),
          })),
          ...botRoster.map((bot) => ({
            id: bot.id, name: bot.name, team: bot.team, isBot: true,
            ...((room.quickPlay ? bot.squadId : bot.customSquadId)
              ? { squadId: room.quickPlay ? bot.squadId : bot.customSquadId } : {}),
            selectedWeaponId: bot.selectedWeaponId ?? this.defaultProjectileType,
            selectedGadgetId: bot.selectedGadgetId,
            gadgetCounts: structuredClone(bot.gadgetCounts),
            gadgetCount: bot.gadgetCount,
            uniqueGadgetShopOfferIds: [],
            inventory: normalizeItemInventory(bot.inventory),
            ...(isProgressionShop(room) ? {
              inventoryWeaponIds: [...(bot.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID])],
              weaponShopOfferIds: [...(bot.weaponShopOfferIds ?? [])],
              itemShopOfferIds: structuredClone(bot.itemShopOfferIds ?? []),
              gadgetShopOfferIds: [...(bot.gadgetShopOfferIds ?? [])],
              shopPicksRemaining: bot.shopPicksRemaining ?? 0,
              weaponShopResolved: bot.weaponShopResolved === true,
            } : {}),
            controlledById: null,
            controlRevision: 0,
          })),
        ],
        smokes: [], gadgetEffects: [], destructibleObjects: [],
      };
      room.botActors = new Map(botRoster.map((bot) => [bot.id, {
        [BOT_ACTOR]: true, id: bot.id, playerName: bot.name, team: bot.team, room,
        connected: true, roomInput: { ...EMPTY_INPUT }, roomInputSequence: 0,
        roomInputAt: startedAt,
      }]));
      room.latestHostFrame = null;
      room.hostMap = null;
      room.preparedMap = null;
      if (room.quickPlay) {
        room.quickPlayState.gameMode = room.gameMode;
        room.quickPlayState.round += 1;
        room.quickPlayState.phase = 'countdown';
        room.quickPlayState.phaseEndsAt = gameplayStartsAt;
        if (room.quickPlayState.nextRoundScore) {
          room.quickPlayState.score = { ...room.quickPlayState.nextRoundScore };
          delete room.quickPlayState.nextRoundScore;
        }
        room.quickPlayState.squadScore = { ...room.quickPlayScoreBySquad };
        room.quickPlayState.rolesBySquad = { ...room.quickPlayRoleBySquad };
        room.quickPlayState.sidesSwapped = room.quickPlaySidesSwapped;
        room.quickPlayState.mapGenerationRevision = room.mapGenerationRevision;
        room.quickPlayAutoStartAt = null;
        room.match.quickPlayState = structuredClone(room.quickPlayState);
        room.quickPlayMap = null;
      }
      room.postGame = null;
      return this.toRoomState(room);
    }
    room.lastHostMotionFrame = 0;
    room.latestHostFrame = null;
    room.footstepCueLastAt = new Map();
    const clients = [...room.clients];
    const botRoster = room.quickPlay
      ? this.createQuickPlayBotRoster(clients, room)
      : [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])];
    if (room.quickPlay) room.quickPlayBotRoster = botRoster;
    if (!isProgressionShop(room)) {
      for (const bot of botRoster) {
        if (!this.projectileDefinitions.has(bot.selectedWeaponId)) {
          bot.selectedWeaponId = chooseBotLoadoutWeaponId([...this.projectileDefinitions.values()], this.random) ??
            this.defaultProjectileType;
        }
      }
    }
    this.prepareMatchShop(room, clients, botRoster, customMatchNumber);
    const teamPlayerIndices = { red: 0, blue: 0 };
    const gameplayStartsAt = startedAt + getPrePhaseDurationMs(room);
    let map;
    if (room.quickPlay) {
      const modeLabel = SERIES_MODE_RULES[room.gameMode]?.label ?? 'Practice';
      if (!room.quickPlayMap) throw new RoomManagerError(`The next competitive ${modeLabel} map is still being prepared.`);
      map = room.quickPlaySidesSwapped
        ? mirrorMapHorizontally(room.quickPlayMap.map)
        : room.quickPlayMap.map;
      room.quickPlayUsedMapFingerprints.add(room.quickPlayMap.fingerprint);
      room.quickPlayMap = null;
      room.quickPlayMapFallbackRequested = false;
      room.requestQuickPlayMapFallback = null;
    } else if (room.customGameRules?.mapMode === 'same' && room.customSeriesMap) {
      map = structuredClone(room.customSeriesMap);
    } else {
      map = generateMap(room.mapSeed, MAP_WIDTH, MAP_HEIGHT, getRoomMapOptions(room));
    }
    if (!room.quickPlay) room.customSeriesMap = structuredClone(map);
    for (const player of clients) {
      player.roomInput = { ...EMPTY_INPUT };
      player.roomInputSequence = 0;
      player.roomInputAt = startedAt;
      player.lastWeaponActionSequence = 0;
      if (!isProgressionShop(room)) player.inventory = createDefaultMatchItemInventory();
    }
    if (!isProgressionShop(room)) {
      for (const bot of botRoster) bot.inventory = createDefaultMatchItemInventory();
    }
    const flagPosition = getInitialFlagPosition(map);
    room.match = {
      startedAt,
      gameplayStartsAt,
      endsAt: gameplayStartsAt + getGamePhaseDurationMs(room),
      updatedAt: startedAt,
      infiniteGadgetUse: isInfiniteGadgetUseEnabled(room),
      map,
      flag: {
        ...flagPosition,
        heldBy: null,
        dropped: false,
        lastDroppedBy: null,
      },
      victory: null,
      quickPlayState: null,
      teamIntel: {
        columns: Math.ceil(map.width / VISION_MEMORY_CELL_SIZE),
        rows: Math.ceil(map.height / VISION_MEMORY_CELL_SIZE),
        red: new Uint8Array(Math.ceil(map.width / VISION_MEMORY_CELL_SIZE) * Math.ceil(map.height / VISION_MEMORY_CELL_SIZE)),
        blue: new Uint8Array(Math.ceil(map.width / VISION_MEMORY_CELL_SIZE) * Math.ceil(map.height / VISION_MEMORY_CELL_SIZE)),
        corpses: { red: new Set(), blue: new Set() },
      },
      destructibleObjectIntel: { red: new Map(), blue: new Map() },
      mineIntel: { red: new Set(), blue: new Set() },
      audioCueLastAt: { red: -Infinity, blue: -Infinity },
      teamRoster: {
        red: clients.filter((player) => player.team === 'red').length + botRoster.filter((bot) => bot.team === 'red').length,
        blue: clients.filter((player) => player.team === 'blue').length + botRoster.filter((bot) => bot.team === 'blue').length,
      },
      botNoises: [],
      smokes: [],
      gadgetEffects: [],
      pendingGadgetEffects: [],
      damageContributions: {},
      players: [...clients.map((player) => {
        const team = player.team ?? 'red';
        const teamIndex = teamPlayerIndices[team]++;
        return {
          id: player.id,
          name: player.playerName,
          team,
          ...((room.quickPlay ? player.squadId : player.customSquadId)
            ? { squadId: room.quickPlay ? player.squadId : player.customSquadId } : {}),
          ...getTeamSpawn(map, team, teamIndex),
          vx: 0,
          vy: 0,
          health: PLAYER_MAX_HEALTH,
          armor: getInventoryEffects(player.inventory).armor,
          maxArmor: getInventoryEffects(player.inventory).armor,
          lastDamagedAt: startedAt,
          stats: { kills: 0, assists: 0, deaths: 0 },
          alive: true,
          isSpectator: false,
          weaponLean: 0,
          visionAngle: 0,
          selectedWeaponId: player.selectedWeaponId ?? this.defaultProjectileType,
          selectedGadgetId: player.selectedGadgetId ?? null,
          loadoutRevision: player.loadoutRevision ?? 0,
          gadgetCounts: structuredClone(player.gadgetCounts ?? createGadgetCounts(player.selectedGadgetId, player.gadgetCount ?? 0)),
          gadgetCount: player.gadgetCount ?? 0,
          uniqueGadgetShopOfferIds: [...(player.uniqueGadgetShopOfferIds ?? [])],
          equippedSlot: 'weapon',
          gadgetSwitchStartedAt: null,
          gadgetSwitchEndsAt: null,
          gadgetSwitchTargetSlot: null,
          inventory: normalizeItemInventory(player.inventory),
          ...(isProgressionShop(room) ? {
            inventoryWeaponIds: [...(player.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID])],
            weaponShopOfferIds: [...(player.weaponShopOfferIds ?? [])],
            itemShopOfferIds: structuredClone(player.itemShopOfferIds ?? []),
            gadgetShopOfferIds: [...(player.gadgetShopOfferIds ?? [])],
            shopPicksRemaining: player.shopPicksRemaining ?? 0,
            weaponShopResolved: player.weaponShopResolved === true,
          } : {}),
          weaponStats: createWeaponAccuracyStates(this.projectileDefinitions, startedAt, player.inventory),
          lastInputSequence: 0,
          lastWeaponActionSequence: player.lastWeaponActionSequence ?? 0,
          input: { ...EMPTY_INPUT },
        };
      }), ...botRoster.map((bot) => {
        const teamIndex = teamPlayerIndices[bot.team]++;
        return {
          id: bot.id,
          name: bot.name,
          team: bot.team,
          ...((room.quickPlay ? bot.squadId : bot.customSquadId)
            ? { squadId: room.quickPlay ? bot.squadId : bot.customSquadId } : {}),
          isBot: true,
          ...getTeamSpawn(map, bot.team, teamIndex),
          vx: 0,
          vy: 0,
          health: PLAYER_MAX_HEALTH,
          armor: getInventoryEffects(bot.inventory).armor,
          maxArmor: getInventoryEffects(bot.inventory).armor,
          lastDamagedAt: startedAt,
          stats: { kills: 0, assists: 0, deaths: 0 },
          alive: true,
          isSpectator: false,
          weaponLean: 0,
          visionAngle: 0,
          selectedWeaponId: bot.selectedWeaponId ?? (this.projectileDefinitions.has('assault-rifle') ? 'assault-rifle' : this.defaultProjectileType),
          selectedGadgetId: bot.selectedGadgetId ?? null,
          gadgetCounts: structuredClone(bot.gadgetCounts ?? createGadgetCounts(bot.selectedGadgetId, bot.gadgetCount ?? 0)),
          gadgetCount: bot.gadgetCount ?? 0,
          uniqueGadgetShopOfferIds: [],
          equippedSlot: 'weapon',
          gadgetSwitchStartedAt: null,
          gadgetSwitchEndsAt: null,
          gadgetSwitchTargetSlot: null,
          inventory: normalizeItemInventory(bot.inventory),
          ...(isProgressionShop(room) ? {
            inventoryWeaponIds: [...(bot.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID])],
            weaponShopOfferIds: [...(bot.weaponShopOfferIds ?? [])],
            itemShopOfferIds: structuredClone(bot.itemShopOfferIds ?? []),
            gadgetShopOfferIds: [...(bot.gadgetShopOfferIds ?? [])],
            shopPicksRemaining: bot.shopPicksRemaining ?? 0,
            weaponShopResolved: bot.weaponShopResolved === true,
          } : {}),
          weaponStats: createWeaponAccuracyStates(this.projectileDefinitions, startedAt, bot.inventory),
          lastInputSequence: 0,
          lastWeaponActionSequence: 0,
          input: { ...EMPTY_INPUT },
          controlledById: null,
          controlRevision: 0,
        };
      })],
    };
    room.botActors = new Map(botRoster.map((bot) => [bot.id, {
      [BOT_ACTOR]: true,
      id: bot.id,
      playerName: bot.name,
      team: bot.team,
      room,
      connected: true,
      roomInput: { ...EMPTY_INPUT },
      roomInputSequence: 0,
      roomInputAt: startedAt,
      nextProjectileAt: 0,
      selectedWeaponId: bot.selectedWeaponId ?? (this.projectileDefinitions.has('assault-rifle') ? 'assault-rifle' : this.defaultProjectileType),
    }]));
    if (room.quickPlay) {
      room.quickPlayState.gameMode = room.gameMode;
      room.quickPlayState.score = getQuickPlayScoreByRole(room);
      room.quickPlayState.squadScore = { ...room.quickPlayScoreBySquad };
      room.quickPlayState.rolesBySquad = { ...room.quickPlayRoleBySquad };
      room.quickPlayState.sidesSwapped = room.quickPlaySidesSwapped;
      room.quickPlayState.mapGenerationRevision = room.mapGenerationRevision;
      room.quickPlayState.round += 1;
      room.quickPlayState.phase = 'countdown';
      room.quickPlayState.phaseEndsAt = gameplayStartsAt;
      room.quickPlayAutoStartAt = null;
      room.match.quickPlayState = structuredClone(room.quickPlayState);
    }
    room.postGame = null;
    return this.toRoomState(room);
  }

  advanceGames(deltaSeconds = 0.05) {
    const delta = Math.max(0, Math.min(deltaSeconds, 0.05));
    const updates = [];
    const now = this.now();
    for (const room of this.rooms.values()) {
      let quickPlayMapBecameReady = false;
      const quickPlayLobby = room.quickPlay && room.quickPlayState?.phase === 'lobby';
      if (quickPlayLobby) {
        if (this.areQuickPlayPlayersReady(room) && room.clients.size > 0) {
          if (!room.quickPlayMap) {
            this.requestQuickPlayMapFallback(room);
            this.prepareQuickPlayMap(room);
          } else {
            this.startMatchForRoom(room, now);
            updates.push({ room, match: getMatchSnapshot(room.match), roomState: this.toRoomState(room) });
          }
        } else if (room.quickPlayMap && !room.quickPlayMapReadyNotified) {
          room.quickPlayMapReadyNotified = true;
          updates.push({ room, match: null, roomState: this.toRoomState(room) });
        }
        continue;
      }
      if (room.quickPlay && room.quickPlayState?.phase === 'round-result' &&
          now < room.quickPlayState.phaseEndsAt && room.quickPlayMap && !room.quickPlayMapReadyNotified) {
        room.quickPlayMapReadyNotified = true;
        quickPlayMapBecameReady = true;
      }
      if (room.quickPlay && room.quickPlayState?.phase === 'round-result' && now >= room.quickPlayState.phaseEndsAt) {
        if (!room.quickPlayMap) {
          this.requestQuickPlayMapFallback(room);
          this.prepareQuickPlayMap(room);
        } else {
          this.startMatchForRoom(room, now);
          updates.push({ room, match: getMatchSnapshot(room.match), roomState: this.toRoomState(room) });
          continue;
        }
      }
      if (room.quickPlay && room.quickPlayState?.phase === 'series-report' && now >= room.quickPlayState.phaseEndsAt) {
        room.match = null;
        this.resetQuickPlayLobby(room, now);
        updates.push({ room, match: null, roomState: this.toRoomState(room) });
        continue;
      }
      if (!room.match) continue;
      const quickPlayJustStarted = room.quickPlay && room.quickPlayState?.phase === 'countdown' &&
        now >= room.match.gameplayStartsAt;
      if (quickPlayJustStarted) {
        room.quickPlayState.phase = 'playing';
        room.quickPlayState.phaseEndsAt = null;
        room.match.quickPlayState = structuredClone(room.quickPlayState);
      } else if (room.quickPlay && room.quickPlayState?.phase === 'countdown') {
        if (now - (room.lastCountdownUpdateAt ?? -Infinity) >= 250) {
          room.lastCountdownUpdateAt = now;
          updates.push({ room, match: getMatchSnapshot(room.match) });
        }
        continue;
      }
      if (room.match.victory) {
        if (this.isPostGameFreeRoam(room, now)) {
          const footstepCues = delta > 0 ? this.advancePostGameFreeRoam(room, delta, now) : [];
          if (delta > 0 || quickPlayMapBecameReady) {
            updates.push({
              room,
              match: getMatchSnapshot(room.match),
              ...(footstepCues.length ? { footstepCues } : {}),
              ...(quickPlayMapBecameReady ? { roomState: this.toRoomState(room) } : {}),
            });
          }
          continue;
        }
        if (room.quickPlay) continue;
        const intermissionStarted = this.expirePostGameResponses(room, now);
        if (intermissionStarted) {
          updates.push({
            room,
            match: null,
            roomState: this.toRoomState(room),
            postGameDepartures: [],
          });
        }
        continue;
      }
      const match = room.match;
      match.smokes = (match.smokes ?? []).filter((smoke) => smoke.expiresAt > now);
      const tickStartedAt = now - delta * 1000;
      if (now < match.gameplayStartsAt) {
        if (now - (room.lastCountdownUpdateAt ?? -Infinity) >= 250) {
          room.lastCountdownUpdateAt = now;
          updates.push({ room, match: getMatchSnapshot(match) });
        }
        continue;
      }
      if (now >= match.endsAt) {
        this.setMatchVictory(room, { winner: 'blue', reason: 'time', at: now });
        match.updatedAt = now;
        updateDestructibleObjectIntel(match, now);
        updates.push(room.quickPlay
          ? { room, match: getMatchSnapshot(match), matchByTeam: getMatchSnapshotsByTeam(match), quickPlayResult: true }
          : { room, match: getMatchSnapshot(match), matchByTeam: getMatchSnapshotsByTeam(match) });
        continue;
      }

      const pendingGadgetEffects = [];
      const droppedFlagThisTick = new Set();
      const trophyVisionObjects = [
        ...(match.map?.objects ?? []),
        ...(match.smokes ?? []).filter((smoke) => smoke.expiresAt > now),
      ];
      const trophyInterceptions = findTrophyProjectileInterceptions(
        match.pendingGadgetEffects ?? [],
        match.gadgetEffects ?? [],
        trophyVisionObjects,
        tickStartedAt,
        now,
      );
      if (trophyInterceptions.length) {
        match.gadgetEffects ??= [];
        for (const interception of trophyInterceptions) {
          match.gadgetEffects.push({
            id: `${interception.effectId}:trophy-intercept`.slice(0, 96),
            type: 'trophy-intercept-visual',
            projectileId: interception.effectId,
            trophyId: interception.trophyId,
            trophyTeam: interception.team,
            trophyX: interception.trophyPosition.x,
            trophyY: interception.trophyPosition.y,
            x: interception.position.x,
            y: interception.position.y,
            startedAt: now,
            expiresAt: now + TROPHY_INTERCEPT_VISUAL_DURATION_MS,
            blocksMovement: false,
            blocksProjectiles: false,
            blocksVision: false,
          });
        }
      }
      const interceptedProjectileIds = new Set(trophyInterceptions.map((entry) => entry.effectId));
      for (const pending of match.pendingGadgetEffects ?? []) {
        if (interceptedProjectileIds.has(pending.effect?.id)) continue;
        if (pending.effect?.type === 'orbital-strike-warning') {
          if (pending.detonatesAt > now) pendingGadgetEffects.push(pending);
          else this.resolveOrbitalStrike(match, pending.effect, now);
          continue;
        }
        if (pending.detonatesAt > now) {
          pendingGadgetEffects.push(pending);
          continue;
        }
        if (pending.effect.expiresAt <= now) continue;
        const effect = {
          ...pending.effect,
          startedAt: pending.detonatesAt,
          ...(pending.effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID
            ? { expiresAt: pending.detonatesAt + TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS }
            : {}),
        };
        if (effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID) {
          const cleared = findTrophyCommandClearedEffects({
            pulse: effect,
            gadgetEffects: match.gadgetEffects,
            smokes: match.smokes,
            visionObjects: trophyVisionObjects,
            now: effect.startedAt,
          });
          match.gadgetEffects = (match.gadgetEffects ?? []).filter((candidate) =>
            !cleared.gadgetEffectIds.has(candidate.id));
          match.smokes = (match.smokes ?? []).filter((candidate) =>
            !cleared.smokeIds.has(candidate.id));
        }
        if (effect.type === 'smoke') match.smokes.push(effect);
        else match.gadgetEffects.push(effect);
        if (effect.type === 'flash') {
          const visionObjects = [
            ...(match.map?.objects ?? []),
            ...(match.smokes ?? []).filter((smoke) => smoke.expiresAt > effect.startedAt),
          ];
          applyFlashBlindness(effect, match.players, visionObjects, match.gadgetEffects);
        } else if (effect.type === 'jammer') {
          applyHostJammerDetonation({
            jammer: effect,
            players: match.players,
            gadgetEffects: match.gadgetEffects,
            now: effect.startedAt ?? now,
          });
        }
      }
      match.pendingGadgetEffects = pendingGadgetEffects;
      const removedPlacedGadgetIds = findTrophyPlacedGadgetInterceptions(
        match.gadgetEffects,
        match.gadgetEffects,
        [
          ...(match.map?.objects ?? []),
          ...(match.smokes ?? []).filter((smoke) => smoke.expiresAt > now),
        ],
        now,
      );
      if (removedPlacedGadgetIds.size) {
        match.gadgetEffects = match.gadgetEffects.filter((effect) =>
          !removedPlacedGadgetIds.has(effect.id));
      }

      match.botNoises = (match.botNoises ?? []).filter((cue) => cue.expiresAt > now);
      const clientsById = new Map();
      for (const client of room.clients) clientsById.set(client.id, client);
      for (const actor of room.botActors?.values() ?? []) clientsById.set(actor.id, actor);
      for (const player of room.match.players) {
        advanceOrbitalStrikeCooldown(player, delta * 1000);
        advanceSonarChargeRecharges(player, delta * 1000);
        advancePerChargeGadgetRecharges(player, JAMMER_GRENADE_ID, delta * 1000, {
          cooldownMs: JAMMER_GRENADE_COOLDOWN_MS,
          maximumCharges: 1,
        });
        advancePerChargeGadgetRecharges(player, BIO_FIELD_ID, delta * 1000, {
          cooldownMs: BIO_FIELD_COOLDOWN_MS,
          maximumCharges: GADGET_DEFINITIONS[BIO_FIELD_ID].charges,
        });
        if (Number.isFinite(player.gadgetSwitchEndsAt) && now >= player.gadgetSwitchEndsAt) {
          player.equippedSlot = player.gadgetSwitchTargetSlot ?? player.equippedSlot ?? 'weapon';
          player.gadgetSwitchStartedAt = null;
          player.gadgetSwitchEndsAt = null;
          player.gadgetSwitchTargetSlot = null;
          if (player.equippedSlot === 'weapon') {
            resumeQueuedManualAction(player.weaponStats?.[player.selectedWeaponId], now);
          }
        }
        if (!player.alive || player.health <= 0) {
          if (player.alive && player.health <= 0 && match.flag.heldBy === player.id) {
            match.flag.heldBy = null;
            match.flag.x = player.x;
            match.flag.y = player.y;
            match.flag.dropped = true;
            match.flag.lastDroppedBy = null;
          }
          player.health = Math.max(0, player.health);
          player.alive = false;
          player.isSpectator = true;
          player.vx = 0;
          player.vy = 0;
          player.input = { ...EMPTY_INPUT };
          continue;
        }
        this.updatePlayerArmorRegeneration(player, delta, now);
        const client = clientsById.get(player.id);
        const input = client && client.connected !== false && now - (client.roomInputAt ?? now) <= INPUT_STALE_MS
          ? client.roomInput
          : EMPTY_INPUT;
        const dropPressed = input.drop && !player.input?.drop;
        if (room.simulationMode === 'host-authoritative') {
          this.updateWeaponAccuracy(player, delta, now);
          Object.assign(player, {
            input,
            weaponLean: input.weaponLean ?? player.weaponLean ?? 0,
            visionAngle: Number.isFinite(input.visionAngle) ? input.visionAngle : player.visionAngle ?? 0,
          });
          if (dropPressed && match.flag.heldBy === player.id) {
            match.flag.heldBy = null;
            match.flag.x = player.x;
            match.flag.y = player.y;
            match.flag.dropped = true;
            match.flag.lastDroppedBy = player.id;
            droppedFlagThisTick.add(player.id);
          }
          if (match.flag.heldBy === player.id) {
            match.flag.x = player.x;
            match.flag.y = player.y;
          }
          continue;
        }
        const gadgetMovementScale = getGadgetMovementScale(player, match.gadgetEffects, now);
        const movementScale = getPlayerMovementScale(
          match.flag.heldBy === player.id,
          this.projectileDefinitions.get(player.selectedWeaponId)?.movementScale ?? 0.9,
          getInventoryEffects(player.inventory).movementBonus,
        ) * gadgetMovementScale;
        const next = movePosition(
          player,
          input,
          delta,
          room.match.map.width,
          room.match.map.height,
          room.match.map.objects,
          movementScale,
          gadgetMovementScale > 1 ? movementScale : 1.15,
        );
        const tether = (match.gadgetEffects ?? []).find((effect) =>
          effect.type === VINE_TRAP_ID && effect.latchedEnemyId === player.id && effect.activeUntil > now);
        Object.assign(player, constrainPositionToRadius(
          next, tether, tether?.triggerRadius ?? tether?.radius,
        ), {
          input,
          weaponLean: input.weaponLean ?? player.weaponLean ?? 0,
          visionAngle: client?.roomInput?.visionAngle ?? player.visionAngle ?? 0,
          lastInputSequence: client?.roomInputSequence ?? player.lastInputSequence ?? 0,
        });
        this.updateWeaponAccuracy(player, delta, now);

        if (dropPressed && match.flag.heldBy === player.id) {
          match.flag.heldBy = null;
          match.flag.x = player.x;
          match.flag.y = player.y;
          match.flag.dropped = true;
          match.flag.lastDroppedBy = player.id;
          droppedFlagThisTick.add(player.id);
        }
        if (match.flag.heldBy === player.id) {
          match.flag.x = player.x;
          match.flag.y = player.y;
        }
      }

      this.updateMineIntel(match, now);
      this.applyGadgetEffectDamage(match, tickStartedAt, now);
      this.updateMineIntel(match, now);
      for (const player of match.players) {
        if (player.alive && player.health <= 0) this.markPlayerDead(match, player);
      }

      const removedSonars = advanceHostSonarProjectiles(
        match.gadgetEffects, match.players, delta * 1000, now,
      );
      if (removedSonars.size > 0) {
        match.gadgetEffects = match.gadgetEffects.filter((effect) => !removedSonars.has(effect.id));
      }
      match.gadgetEffects = (match.gadgetEffects ?? []).filter((effect) => effect.expiresAt > now);

      const dropper = match.players.find((player) => player.id === match.flag.lastDroppedBy);
      if (!dropper || Math.hypot(dropper.x - match.flag.x, dropper.y - match.flag.y) > FLAG_PICKUP_RADIUS) {
        match.flag.lastDroppedBy = null;
      }
      if (match.flag.heldBy === null) {
        const redPlayerNearFlag = match.players.find((player) =>
          player.alive && player.team === 'red' && player.id !== match.flag.lastDroppedBy &&
          !droppedFlagThisTick.has(player.id) &&
          Math.hypot(player.x - match.flag.x, player.y - match.flag.y) <= FLAG_PICKUP_RADIUS);
        if (redPlayerNearFlag) {
          match.flag.heldBy = redPlayerNearFlag.id;
          match.flag.dropped = false;
          match.flag.lastDroppedBy = null;
          match.flag.x = redPlayerNearFlag.x;
          match.flag.y = redPlayerNearFlag.y;
        }
      }

      const carrier = match.players.find((player) => player.id === match.flag.heldBy && player.alive && player.team === 'red');
      if (carrier && isInsideZone(carrier, match.map.spawnZones.red)) {
        match.flag.heldBy = null;
        match.flag.x = match.map.spawnZones.red.x + match.map.spawnZones.red.width / 2;
        match.flag.y = match.map.spawnZones.red.y + match.map.spawnZones.red.height / 2;
        match.flag.dropped = false;
        match.flag.lastDroppedBy = null;
        this.setMatchVictory(room, { winner: 'red', reason: 'capture', at: now });
      }

      this.setEliminationVictoryIfNeeded(room, now);

      match.updatedAt = now;
      updateDestructibleObjectIntel(match, now);
      const footstepCues = this.collectFootstepAudioCues(room, now);
      updates.push({
        room,
        match: getMatchSnapshot(match),
        matchByTeam: getMatchSnapshotsByTeam(match),
        ...(footstepCues.length ? { footstepCues } : {}),
        ...(match.victory && room.quickPlay ? { quickPlayResult: true } : {}),
        ...(quickPlayJustStarted ? { roomState: this.toRoomState(room) } : {}),
      });
    }
    return updates;
  }

  assertGameplayStarted(match) {
    if (this.now() < match.gameplayStartsAt) {
      throw new RoomManagerError('The match countdown is still in progress.');
    }
  }

  isPostGameFreeRoam(room, now = this.now()) {
    if (!room.match?.victory) return false;
    if (room.quickPlay) {
      if (room.quickPlayState?.phase === 'round-result') {
        return now < room.quickPlayState.phaseEndsAt || !room.quickPlayMap;
      }
      return room.quickPlayState?.phase === 'series-report' && now < room.quickPlayState.phaseEndsAt;
    }
    return Boolean(room.postGame && now < room.postGame.endsAt);
  }

  advancePostGameFreeRoam(room, delta, now) {
    const match = room.match;
    const clientsById = new Map();
    for (const client of room.clients) clientsById.set(client.id, client);
    for (const player of match.players) {
      if (!player.alive || player.health <= 0) continue;
      const client = clientsById.get(player.id);
      const botActor = player.isBot && player.controlledById ? room.botActors?.get(player.id) : null;
      const inputSource = botActor ?? client;
      const receivedInput = inputSource && inputSource.connected !== false &&
        now - (inputSource.roomInputAt ?? now) <= INPUT_STALE_MS
        ? inputSource.roomInput
        : EMPTY_INPUT;
      const input = receivedInput.drop ? { ...receivedInput, drop: false } : receivedInput;
      this.updateWeaponAccuracy(player, delta, now);
      if (room.simulationMode === 'host-authoritative') {
        Object.assign(player, {
          input,
          weaponLean: input.weaponLean ?? player.weaponLean ?? 0,
          visionAngle: Number.isFinite(input.visionAngle) ? input.visionAngle : player.visionAngle ?? 0,
          lastInputSequence: inputSource?.roomInputSequence ?? player.lastInputSequence ?? 0,
        });
        continue;
      }
      const next = movePosition(
        player,
        input,
        delta,
        match.map.width,
        match.map.height,
        match.map.objects,
        getPlayerMovementScale(false,
          this.projectileDefinitions.get(player.selectedWeaponId)?.movementScale ?? 0.9,
          getInventoryEffects(player.inventory).movementBonus),
      );
      const tether = (match.gadgetEffects ?? []).find((effect) =>
        effect.type === VINE_TRAP_ID && effect.latchedEnemyId === player.id && effect.activeUntil > now);
      Object.assign(player, constrainPositionToRadius(
        next, tether, tether?.triggerRadius ?? tether?.radius,
      ), {
        input,
        weaponLean: input.weaponLean ?? player.weaponLean ?? 0,
        visionAngle: inputSource?.roomInput?.visionAngle ?? player.visionAngle ?? 0,
        lastInputSequence: inputSource?.roomInputSequence ?? player.lastInputSequence ?? 0,
      });
    }
    match.updatedAt = now;
    return this.collectFootstepAudioCues(room, now);
  }

  collectFootstepAudioCues(room, now = this.now()) {
    const match = room.match;
    if (!match || !Array.isArray(match.players)) return [];
    room.footstepCueLastAt ??= new Map();
    const cues = buildFootstepAudioCues(match, now, {
      lastCueAt: room.footstepCueLastAt,
      random: this.random,
      projectileDefinitions: this.projectileDefinitions,
    });
    for (const cue of cues) {
      match.botNoises ??= [];
      match.botNoises.push({ ...cue });
      if (match.botNoises.length > 32) match.botNoises.splice(0, match.botNoises.length - 32);
    }
    return cues;
  }

  revealTeamIntel(client, { spans } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const sender = match?.players.find((player) => player.id === client.id);
    if (!match?.teamIntel || !['red', 'blue'].includes(client.team) ||
        !sender || isPlayerJammed(sender, now) ||
        (match.victory && !this.isPostGameFreeRoam(room, now))) return [];
    if (!Array.isArray(spans) || spans.length > 240 || spans.length % 2 !== 0) {
      throw new RoomManagerError('Vision updates must contain at most 120 cell ranges.');
    }

    const explored = match.teamIntel[client.team];
    const cellCount = explored.length;
    const newlyExplored = [];
    for (let range = 0; range < spans.length; range += 2) {
      const start = spans[range];
      const end = spans[range + 1];
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > cellCount) {
        throw new RoomManagerError('Vision update contains an invalid cell range.');
      }
      let openStart = -1;
      for (let index = start; index < end; index += 1) {
        if (explored[index]) {
          if (openStart !== -1) {
            this.appendIntelSpan(newlyExplored, openStart, index);
            openStart = -1;
          }
          continue;
        }
        explored[index] = 1;
        if (openStart === -1) openStart = index;
      }
      if (openStart !== -1) this.appendIntelSpan(newlyExplored, openStart, end);
    }
    return newlyExplored;
  }

  appendIntelSpan(spans, start, end) {
    const last = spans.length - 2;
    if (last >= 0 && spans[last + 1] === start) spans[last + 1] = end;
    else spans.push(start, end);
  }

  getTeamIntelSpans(client) {
    const intel = client.room?.match?.teamIntel;
    if (!intel || !['red', 'blue'].includes(client.team)) return [];
    const explored = intel[client.team];
    const spans = [];
    let start = -1;
    for (let index = 0; index <= explored.length; index += 1) {
      if (index < explored.length && explored[index]) {
        if (start === -1) start = index;
      } else if (start !== -1) {
        spans.push(start, index);
        start = -1;
      }
    }
    return spans;
  }

  discoverTeamCorpse(client, { playerId } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const sender = match?.players.find((player) => player.id === client.id);
    if (!match?.teamIntel || !['red', 'blue'].includes(client.team) ||
        !sender || isPlayerJammed(sender, this.now()) ||
        (match.victory && !this.isPostGameFreeRoam(room, this.now()))) return false;
    const corpse = match.players.find((player) => player.id === playerId);
    if (!corpse || corpse.team === client.team || corpse.alive !== false || corpse.health > 0) return false;
    const knownCorpses = match.teamIntel.corpses?.[client.team];
    if (!knownCorpses || knownCorpses.has(playerId)) return false;
    knownCorpses.add(playerId);
    return true;
  }

  getTeamCorpseIds(client) {
    const corpses = client.room?.match?.teamIntel?.corpses;
    if (!corpses || !['red', 'blue'].includes(client.team)) return [];
    return [...corpses[client.team]];
  }

  setMatchVictory(room, victory) {
    const match = room.match;
    if (!match || match.victory) return;
    match.victory = victory;
    if (room.quickPlay) {
      const modeRules = SERIES_MODE_RULES[room.gameMode] ?? SERIES_MODE_RULES.quickplay;
      const winnerSquadId = getQuickPlaySquadForTeam(room, victory.winner);
      if (!winnerSquadId) throw new RoomManagerError(`The winning ${modeRules.label} squad could not be identified.`);
      room.quickPlayScoreBySquad[winnerSquadId] += 1;
      const completedRoundScore = getQuickPlayScoreByRole(room);
      const seriesWon = modeRules.winsToWin !== null &&
        room.quickPlayScoreBySquad[winnerSquadId] >= modeRules.winsToWin;
      room.quickPlayState.score = completedRoundScore;
      room.quickPlayState.winnerSquadId = seriesWon ? winnerSquadId : null;
      room.quickPlayState.lastResult = {
        round: room.quickPlayState.round,
        winner: victory.winner,
        winnerSquadId,
        reason: victory.reason,
        at: victory.at,
        score: { ...completedRoundScore },
      };
      const completedRound = room.quickPlayState.round;
      if (completedRound % modeRules.roleSwapEvery === 0) {
        room.quickPlaySidesSwapped = !room.quickPlaySidesSwapped;
        rotateQuickPlayRoles(room);
      }
      const nextRoundScore = Object.fromEntries(Object.entries(room.quickPlayRoleBySquad).map(([squadId, team]) => [
        team,
        room.quickPlayScoreBySquad[squadId],
      ]));
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + Number(!seriesWon);
      room.quickPlayState.phase = seriesWon ? 'series-report' : 'round-result';
      room.quickPlayState.winner = seriesWon ? victory.winner : null;
      room.quickPlayState.phaseEndsAt = victory.at + (seriesWon ? QUICK_PLAY_FINAL_REPORT_MS : QUICK_PLAY_RESULT_MS);
      room.quickPlayState.nextRoundScore = nextRoundScore;
      room.postGame = null;
      match.postGame = null;
      if (!seriesWon) this.prepareQuickPlayMap(room);
      room.quickPlayState.squadScore = { ...room.quickPlayScoreBySquad };
      room.quickPlayState.rolesBySquad = { ...room.quickPlayRoleBySquad };
      room.quickPlayState.sidesSwapped = room.quickPlaySidesSwapped;
      room.quickPlayState.mapGenerationRevision = room.mapGenerationRevision;
      match.quickPlayState = structuredClone(room.quickPlayState);
      return;
    }
    const series = room.customSeriesState;
    if (series?.phase === 'playing') {
      const winnerSquadId = Object.entries(series.rolesBySquad ?? {})
        .find(([, team]) => team === victory.winner)?.[0];
      if (!winnerSquadId) throw new RoomManagerError('The winning custom-game team could not be identified.');
      series.score[winnerSquadId] += 1;
      series.lastMatchScoreboard = match.players.map((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        squadId: player.squadId ?? null,
        isBot: player.isBot === true,
        alive: player.alive !== false,
        controlledById: player.controlledById ?? null,
        stats: {
          kills: player.stats?.kills ?? 0,
          assists: player.stats?.assists ?? 0,
          deaths: player.stats?.deaths ?? 0,
        },
      }));
      const completedById = new Map((series.seriesScoreboard ?? []).map((player) => [player.id, player]));
      for (const player of series.lastMatchScoreboard) {
        const previous = completedById.get(player.id);
        completedById.set(player.id, {
          ...previous,
          ...player,
          stats: {
            kills: (previous?.stats?.kills ?? 0) + player.stats.kills,
            assists: (previous?.stats?.assists ?? 0) + player.stats.assists,
            deaths: (previous?.stats?.deaths ?? 0) + player.stats.deaths,
          },
        });
      }
      series.seriesScoreboard = [...completedById.values()];
      const seriesWon = room.customGameRules.winsToWin !== null &&
        series.score[winnerSquadId] >= room.customGameRules.winsToWin;
      series.winner = seriesWon ? winnerSquadId : null;
      series.phase = seriesWon ? 'complete' : 'postgame';
      if (seriesWon) delete series.nextMatchAt;
      series.lastResult = {
        matchNumber: series.matchNumber,
        winner: victory.winner,
        winnerSquadId,
        reason: victory.reason,
        at: victory.at,
        score: { ...series.score },
      };
      if (!seriesWon && room.customGameRules.roleSwapEveryMatches > 0 &&
          series.matchNumber % room.customGameRules.roleSwapEveryMatches === 0) {
        series.roleSwapPending = true;
      }
      if (!seriesWon && room.customGameRules.teamShuffleEveryMatches > 0 &&
          series.matchNumber % room.customGameRules.teamShuffleEveryMatches === 0) {
        if (room.customGameRules.teamShuffleMode === 'host') {
          series.teamShufflePending = true;
          series.teamShuffleApproved = false;
          series.teamShuffleTargetSizes = this.getCustomTeamSizes(room);
        } else {
          series.pendingTeamShuffleMode = room.customGameRules.teamShuffleMode;
        }
      }
    }
    room.postGame = {
      endsAt: victory.at + getPostPhaseDurationMs(room),
      choices: Object.fromEntries([...room.clients].map((member) => [member.id, 'waiting'])),
    };
    if (series && series.phase !== 'complete') {
      series.nextMatchAt = room.postGame.endsAt;
      if (series.phase === 'postgame') this.prepareCustomNextMap(room);
    }
    match.postGame = room.postGame;
  }

  prepareCustomNextMap(room) {
    const mapMode = room.customGameRules?.mapMode;
    if (room.quickPlay || mapMode === 'same' || mapMode === 'host') return false;
    room.mapGenerationMode = 'competitive';
    room.mapGenerationError = null;
    room.mapGenerationCount = 0;
    room.preparedMap = null;
    room.mapGenerationPending = true;
    if (room.simulationMode === 'host-authoritative') {
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
      this.prepareCustomRoomMap(room);
    } else {
      this.prepareCustomRoomMap(room);
    }
    return true;
  }

  isCustomNextMapReady(room) {
    const mapMode = room.customGameRules?.mapMode;
    if (mapMode === 'host') return true;
    if (mapMode === 'same') return Boolean(room.customSeriesMap || room.match?.map);
    if (room.mapGenerationPending || room.mapGenerationError) return false;
    return room.simulationMode === 'host-authoritative'
      ? Boolean(room.preparedMap)
      : Number.isSafeInteger(room.mapSeed);
  }

  getCustomTeamSizes(room) {
    const bots = [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])];
    return {
      red: [...room.clients].filter((player) => player.team === 'red').length +
        bots.filter((bot) => bot.team === 'red').length,
      blue: [...room.clients].filter((player) => player.team === 'blue').length +
        bots.filter((bot) => bot.team === 'blue').length,
    };
  }

  swapCustomSeriesRoles(room) {
    const series = room.customSeriesState;
    const rolesBySquad = series?.rolesBySquad ?? { A: 'red', B: 'blue' };
    const nextRoles = { A: rolesBySquad.B, B: rolesBySquad.A };
    if (series) series.rolesBySquad = nextRoles;
    for (const client of room.clients) {
      client.customSquadId ??= rolesBySquad.A === client.team ? 'A' : 'B';
      client.team = nextRoles[client.customSquadId];
    }
    const bots = [...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])];
    for (const bot of bots) {
      bot.customSquadId ??= rolesBySquad.A === bot.team ? 'A' : 'B';
      bot.team = nextRoles[bot.customSquadId];
    }
    room.botRoster = {
      red: bots.filter((bot) => bot.team === 'red'),
      blue: bots.filter((bot) => bot.team === 'blue'),
    };
  }

  shuffleCustomTeams(room, mode) {
    const humanPlayers = new Set(room.clients);
    const members = [...room.clients, ...(room.botRoster?.red ?? []), ...(room.botRoster?.blue ?? [])];
    const rolesBySquad = room.customSeriesState?.rolesBySquad ?? { A: 'red', B: 'blue' };
    for (const member of members) {
      member.customSquadId ??= rolesBySquad.A === member.team ? 'A' : 'B';
    }
    const squadA = members.filter((member) => member.customSquadId === 'A');
    const squadB = members.filter((member) => member.customSquadId === 'B');
    const squadASize = squadA.length;
    let shuffled;
    if (mode === 'faro') {
      shuffled = [];
      for (let index = 0; index < Math.max(squadA.length, squadB.length); index += 1) {
        if (squadA[index]) shuffled.push(squadA[index]);
        if (squadB[index]) shuffled.push(squadB[index]);
      }
    } else {
      shuffled = [...squadA, ...squadB];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
      }
    }
    for (const member of shuffled.slice(0, squadASize)) {
      member.customSquadId = 'A';
      member.team = rolesBySquad.A;
    }
    for (const member of shuffled.slice(squadASize)) {
      member.customSquadId = 'B';
      member.team = rolesBySquad.B;
    }
    const roster = members.filter((member) => !humanPlayers.has(member));
    room.botRoster = {
      red: roster.filter((bot) => bot.team === 'red'),
      blue: roster.filter((bot) => bot.team === 'blue'),
    };
  }

  approveCustomTeamShuffle(client) {
    const room = this.requireClientRoom(client);
    const series = room.customSeriesState;
    if (room.quickPlay || room.hostId !== client.id || room.match ||
        !series?.teamShufflePending || series.phase !== 'intermission') {
      throw new RoomManagerError('There is no pending host team shuffle to approve.');
    }
    const sizes = this.getCustomTeamSizes(room);
    if (sizes.red !== series.teamShuffleTargetSizes.red ||
        sizes.blue !== series.teamShuffleTargetSizes.blue) {
      throw new RoomManagerError('Keep the same number of players on each team before approving the shuffle.');
    }
    series.teamShufflePending = false;
    series.teamShuffleApproved = true;
    return this.toRoomState(room);
  }

  endCustomSeries(client) {
    const room = this.requireClientRoom(client);
    if (room.quickPlay || room.hostId !== client.id || room.match || !room.customSeriesState ||
        room.customSeriesState.phase === 'complete') {
      throw new RoomManagerError('Only the host can end a custom series between matches.');
    }
    room.customSeriesState.phase = 'complete';
    room.customSeriesState.winner = null;
    room.customSeriesState.endedByHost = true;
    return this.toRoomState(room);
  }

  prepareCustomIntermission(room) {
    const nextMapReady = this.isCustomNextMapReady(room);
    room.match = null;
    room.postGame = null;
    room.hostMap = null;
    const series = room.customSeriesState;
    if (series && series.phase !== 'complete') {
      if (series.roleSwapPending) {
        this.swapCustomSeriesRoles(room);
        series.roleSwapPending = false;
      }
      if (series.teamShufflePending) {
        series.teamShuffleTargetSizes = this.getCustomTeamSizes(room);
      }
      if (series.pendingTeamShuffleMode) {
        this.shuffleCustomTeams(room, series.pendingTeamShuffleMode);
        delete series.pendingTeamShuffleMode;
      }
      series.phase = 'intermission';
    }
    if (room.customGameRules.mapMode === 'same' && room.customSeriesMap) {
      room.mapGenerationPending = false;
      room.mapGenerationError = null;
      room.mapGenerationCount = 0;
      room.preparedMap = null;
      room.mapGenerationMode = 'competitive';
    } else if (room.customGameRules.mapMode === 'host') {
      room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
      room.mapGenerationPending = false;
      room.mapGenerationError = null;
      room.mapGenerationCount = 0;
      room.preparedMap = null;
      room.customMapPromise = null;
      room.mapGenerationMode = 'host-choice';
    } else {
      if (nextMapReady) {
        room.mapGenerationPending = false;
        room.mapGenerationError = null;
        room.mapGenerationMode = 'competitive';
      } else {
        room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
        room.mapGenerationError = null;
        room.mapGenerationCount = 0;
        room.preparedMap = null;
        room.mapGenerationPending = true;
        room.mapGenerationMode = 'competitive';
        this.prepareCustomRoomMap(room);
      }
    }
  }

  setEliminationVictoryIfNeeded(room, at = this.now()) {
    const match = room.match;
    if (!match || match.victory) return false;
    let redAlive = 0;
    let blueAlive = 0;
    for (const player of match.players) {
      if (!player.alive || player.health <= 0) continue;
      if (player.team === 'red') redAlive += 1;
      else if (player.team === 'blue') blueAlive += 1;
    }
    if (match.teamRoster.red > 0 && redAlive === 0) {
      this.setMatchVictory(room, { winner: 'blue', reason: 'elimination', at });
      return true;
    }
    if (match.teamRoster.blue > 0 && blueAlive === 0) {
      this.setMatchVictory(room, { winner: 'red', reason: 'elimination', at });
      return true;
    }
    return false;
  }

  choosePostGame(client, choice = 'stay') {
    const room = this.requireClientRoom(client);
    if (!room.match?.victory || !room.postGame) {
      throw new RoomManagerError('Postgame choices are not available yet.');
    }
    if (this.now() >= room.postGame.endsAt) {
      throw new RoomManagerError('The postgame response window has expired.');
    }
    if (choice !== 'stay') throw new RoomManagerError('Choose stay to remain in the room.');
    if (!room.postGame.choices[client.id]) throw new RoomManagerError('You are not part of this postgame lobby.');

    room.postGame.choices[client.id] = 'stay';
    room.match.postGame = room.postGame;
    if (room.customSeriesState?.phase !== 'postgame' &&
        [...room.clients].every((member) => room.postGame.choices[member.id] === 'stay')) {
      this.prepareCustomIntermission(room);
    }
    return this.toRoomState(room);
  }

  expirePostGameResponses(room, now = this.now()) {
    if (!room.postGame || now < room.postGame.endsAt) return false;
    if (room.customSeriesState?.phase === 'postgame' &&
        room.customGameRules?.mapMode !== 'host' && !this.isCustomNextMapReady(room)) return false;
    this.prepareCustomIntermission(room);
    return true;
  }

  updateGameInput(client, { sequence, input } = {}) {
    const room = this.requireClientRoom(client);
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!room.match || (room.match.victory && !postGameFreeRoam) ||
        (now >= room.match.endsAt && !postGameFreeRoam)) {
      throw new RoomManagerError('There is no active match.');
    }
    if (!room.match.players.some((player) => player.id === client.id)) {
      throw new RoomManagerError('Join the Strike Team or Flag Team to enter the active match.');
    }
    if (!postGameFreeRoam) this.assertGameplayStarted(room.match);
    const previousSequence = client.roomInputSequence ?? 0;
    if (!Number.isSafeInteger(sequence) || sequence < 1 ||
        sequence - previousSequence > MAX_INPUT_SEQUENCE_GAP || !this.isValidInput(input)) {
      throw new RoomManagerError('Movement input must include directions and a valid sequence.');
    }

    if (sequence <= previousSequence) return { sequence: previousSequence, accepted: false };
    client.roomInputSequence = sequence;
    client.roomInput = {
      up: input.up,
      down: input.down,
      left: input.left,
      right: input.right,
      drop: input.drop === true,
      weaponLean: input.weaponLean ?? 0,
      visionAngle: Number.isFinite(input.visionAngle) ? input.visionAngle : null,
      speedScale: input.speedScale ?? 1,
    };
    const matchPlayer = room.match.players.find((player) => player.id === client.id);
    matchPlayer.weaponLean = client.roomInput.weaponLean;
    if (client.roomInput.visionAngle !== null) matchPlayer.visionAngle = client.roomInput.visionAngle;
    client.roomInputAt = now;
    return { sequence, accepted: true };
  }

  validatePlayerMotion(client, { matchId, frame, player: state } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (room.simulationMode !== 'host-authoritative' || !match || match.startedAt !== matchId ||
        (match.victory && !postGameFreeRoam) || (now >= match.endsAt && !postGameFreeRoam)) {
      return { accepted: false, reason: 'stale-or-unavailable' };
    }
    const lastMotionFrame = client.lastPlayerMotionMatchId === matchId ? client.lastPlayerMotionFrame ?? 0 : 0;
    if (!Number.isSafeInteger(frame)) {
      throw new RoomManagerError('Player motion frame is invalid.');
    }
    if (frame <= lastMotionFrame) return { accepted: false };
    if (!state ||
        typeof state.id !== 'string' || ![state.x, state.y, state.vx, state.vy].every(Number.isFinite) ||
        !Number.isSafeInteger(state.lastInputSequence) || state.lastInputSequence < 0) {
      throw new RoomManagerError('Player motion frame is invalid.');
    }
    const player = match.players.find((entry) => entry.id === state.id);
    const ownsHuman = player && !player.isBot && player.id === client.id;
    const ownsBot = player?.isBot && player.controlledById === client.id &&
      state.controlRevision === (player.controlRevision ?? 0);
    const receivedSequence = player?.isBot
      ? room.botActors?.get(player.id)?.roomInputSequence ?? 0
      : client.roomInputSequence ?? 0;
    if (!player || (!ownsHuman && !ownsBot) || !player.alive || player.health <= 0 ||
        state.lastInputSequence > receivedSequence ||
        state.lastInputSequence < (player.lastInputSequence ?? 0) ||
        state.x < MOVEMENT_PLAYER_RADIUS || state.y < MOVEMENT_PLAYER_RADIUS ||
        state.x > match.map.width - MOVEMENT_PLAYER_RADIUS || state.y > match.map.height - MOVEMENT_PLAYER_RADIUS) {
      return { accepted: false };
    }

    client.lastPlayerMotionMatchId = matchId;
    client.lastPlayerMotionFrame = frame;
    return { accepted: true, motion: { matchId, frame, player: state } };
  }

  applyHostMotion(client, { matchId, epoch, frame, players } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    if (room.simulationMode !== 'host-authoritative' || !match || match.startedAt !== matchId) {
      return { accepted: false, reason: 'stale-match' };
    }
    if (!Array.isArray(players) || players.length > MAX_ROOM_CAPACITY) {
      throw new RoomManagerError('Host motion frame is invalid.');
    }
    if (room.hostId !== client.id || epoch !== room.authorityEpoch) {
      throw new RoomManagerError('Host motion frame is stale or unauthorized.');
    }
    if (!Number.isSafeInteger(frame)) {
      throw new RoomManagerError('Host motion frame is stale or invalid.');
    }
    if (frame <= (room.lastHostMotionFrame ?? 0) || players.length !== match.players.length) {
      return { accepted: false, reason: 'stale-or-out-of-order' };
    }
    const seen = new Set();
    const accepted = [];
    for (const state of players) {
      const player = match.players.find((entry) => entry.id === state?.id);
      if (!player || seen.has(state.id) ||
          ![state.x, state.y, state.vx, state.vy].every(Number.isFinite) ||
          state.x < MOVEMENT_PLAYER_RADIUS || state.y < MOVEMENT_PLAYER_RADIUS ||
          state.x > match.map.width - MOVEMENT_PLAYER_RADIUS || state.y > match.map.height - MOVEMENT_PLAYER_RADIUS ||
          !Number.isSafeInteger(state.lastInputSequence) || state.lastInputSequence < 0) {
        throw new RoomManagerError('Host motion frame contains an invalid player state.');
      }
      const inputOwnerId = player.isBot ? player.controlledById ?? client.id : player.id;
      const owner = [...room.clients].find((member) => member.id === inputOwnerId);
      const acknowledged = player.isBot
        ? room.botActors?.get(player.id)?.roomInputSequence ?? 0
        : owner?.roomInputSequence ?? 0;
      seen.add(state.id);
      accepted.push({
        player,
        state: {
          ...state,
          // Host pose delivery and input relay are separate messages. Preserve
          // the pose if they cross in flight, but never publish an ack the
          // server has not received yet.
          lastInputSequence: Math.min(state.lastInputSequence, acknowledged),
        },
      });
    }
    room.lastHostMotionFrame = frame;
    for (const { player, state } of accepted) {
      Object.assign(player, {
        x: state.x,
        y: state.y,
        vx: state.vx,
        vy: state.vy,
        lastInputSequence: Math.max(player.lastInputSequence ?? 0, state.lastInputSequence),
      });
    }
    return { accepted: true, frame };
  }

  acceptHostFrame(client, frame) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const validation = validateHostFrame(frame);
    if (!validation.valid) throw new RoomManagerError(validation.reason);
    if (room.simulationMode !== 'host-authoritative' || !match ||
        room.hostId !== client.id || frame.authorityEpoch !== room.authorityEpoch ||
        frame.matchId !== match.startedAt) {
      throw new RoomManagerError('Host frame is stale or unauthorized.');
    }
    const frameActorIds = new Set(frame.actors.map((actor) => actor.id));
    if (frameActorIds.size !== match.players.length ||
        !match.players.every((player) => frameActorIds.has(player.id)) ||
        !frameActorIds.has(room.hostId)) {
      throw new RoomManagerError('Host frame actor roster must include every match player, including the host.');
    }

    const previous = room.latestHostFrame;
    const previousVictoryAt = room.match.victory?.at ?? null;
    const previousPostGameEndsAt = room.postGame?.endsAt ?? null;
    if (previous?.authorityEpoch === frame.authorityEpoch &&
        (frame.revision <= previous.revision || frame.tick <= previous.tick)) {
      return { accepted: false, reason: 'stale-or-out-of-order' };
    }
    const previousQuickPlayResultAt = room.quickPlayState?.lastResult?.at;
    const incomingQuickPlayResult = frame.snapshot?.quickPlayState?.lastResult;
    const hasNewQuickPlayResult = room.quickPlay && Number.isFinite(incomingQuickPlayResult?.at) &&
      incomingQuickPlayResult.at !== previousQuickPlayResultAt;
    if (room.quickPlay && !frame.snapshot?.quickPlayState) {
      throw new RoomManagerError('The host frame is missing competitive series state.');
    }

    // Frames are complete snapshots: gaps are accepted so a lost packet does
    // not block recovery. During the buy phase, preserve the server-accepted
    // loadout because a frame may have been produced before a shop request.
    const preGame = !room.match.victory && this.now() < room.match.gameplayStartsAt;
    const acceptedFrame = structuredClone(frame);
    // Team-scoped cues are ephemeral and must never be exposed through the
    // shared room-state/host-handoff snapshot. The live relay fans them out by
    // audience, but durable room state retains only public frame events.
    acceptedFrame.events = acceptedFrame.events.filter((event) => !event.audienceTeam && !event.audiencePlayerId);
    if (preGame || acceptedFrame.actors.some(({ id, state }) => {
      const serverPlayer = room.match.players.find((player) => player.id === id);
      return serverPlayer && (state.loadoutRevision ?? 0) < (serverPlayer.loadoutRevision ?? 0);
    })) {
      const serverPlayers = new Map(room.match.players.map((player) => [player.id, player]));
      acceptedFrame.actors = acceptedFrame.actors.map((actor) => {
        const serverPlayer = serverPlayers.get(actor.id);
        const staleLoadout = serverPlayer &&
          (actor.state.loadoutRevision ?? 0) < (serverPlayer.loadoutRevision ?? 0);
        return serverPlayer && (preGame || staleLoadout)
          ? { ...actor, state: preservePreGameLoadout(actor.state, serverPlayer) }
          : actor;
      });
    }
    if (!room.quickPlay && frame.snapshot?.victory && previousVictoryAt === null) {
      this.setMatchVictory(room, structuredClone(frame.snapshot.victory));
    }
    room.latestHostFrame = acceptedFrame;
    if (frame.snapshot) {
      if (frame.snapshot.map) room.hostMap = structuredClone(frame.snapshot.map);
      const flag = frame.objectives.find((objective) => objective.id === 'flag')?.state ?? room.match.flag;
      room.match = {
        ...room.match,
        ...structuredClone(frame.snapshot),
        players: acceptedFrame.actors.map(({ state }) => structuredClone(state)),
        flag: structuredClone(flag),
        map: structuredClone(frame.snapshot.map ?? room.hostMap ?? room.match.map),
        destructibleObjects: structuredClone(frame.snapshot.destructibleObjects ?? room.match.destructibleObjects ?? []),
      };
    }
    if (!room.quickPlay && room.postGame) {
      room.match.postGame = structuredClone(room.postGame);
      if (acceptedFrame.snapshot) acceptedFrame.snapshot.postGame = structuredClone(room.postGame);
    }
    if (preGame) {
      const serverPlayers = new Map(room.match.players.map((player) => [player.id, player]));
      for (const actor of room.latestHostFrame.actors) {
        const serverPlayer = serverPlayers.get(actor.id);
        if (!serverPlayer) continue;
        actor.state = preservePreGameLoadout(actor.state, serverPlayer);
      }
      room.match.players = room.latestHostFrame.actors.map(({ state }) => structuredClone(state));
    }
    let quickPlayResultChanged = false;
    if (frame.snapshot?.quickPlayState) {
      const nextQuickPlayState = structuredClone(frame.snapshot.quickPlayState);
      if (room.quickPlay) {
        const { rolesBySquad, squadScore, sidesSwapped, mapGenerationRevision } = nextQuickPlayState;
        const validRoles = ['A', 'B'].every((squadId) => ['red', 'blue'].includes(rolesBySquad?.[squadId])) &&
          rolesBySquad.A !== rolesBySquad.B;
        const validScore = ['A', 'B'].every((squadId) =>
          Number.isSafeInteger(squadScore?.[squadId]) && squadScore[squadId] >= 0);
        const validNextRoundScore = nextQuickPlayState.phase !== 'round-result' ||
          ['red', 'blue'].every((team) =>
            Number.isSafeInteger(nextQuickPlayState.nextRoundScore?.[team]) &&
            nextQuickPlayState.nextRoundScore[team] >= 0);
        if (!validRoles || !validScore || typeof sidesSwapped !== 'boolean' ||
            !validNextRoundScore || !Number.isSafeInteger(mapGenerationRevision) ||
            mapGenerationRevision < (room.mapGenerationRevision ?? 0)) {
          throw new RoomManagerError('The host frame contains invalid competitive series data.');
        }
        room.quickPlayRoleBySquad = { A: rolesBySquad.A, B: rolesBySquad.B };
        room.quickPlayScoreBySquad = { A: squadScore.A, B: squadScore.B };
        room.quickPlaySidesSwapped = sidesSwapped;
        room.mapGenerationRevision = mapGenerationRevision;
        for (const member of room.clients) {
          if (room.quickPlayRoleBySquad[member.squadId]) {
            member.team = room.quickPlayRoleBySquad[member.squadId];
          }
        }
        for (const bot of room.quickPlayBotRoster ?? []) {
          if (room.quickPlayRoleBySquad[bot.squadId]) {
            bot.team = room.quickPlayRoleBySquad[bot.squadId];
          }
        }
        quickPlayResultChanged = hasNewQuickPlayResult;
      }
      room.quickPlayState = nextQuickPlayState;
      room.match.quickPlayState = structuredClone(nextQuickPlayState);
      acceptedFrame.snapshot.quickPlayState = structuredClone(nextQuickPlayState);
    }
    if (room.quickPlay && frame.snapshot?.postGame) {
      const previousChoices = room.postGame?.choices ?? {};
      room.postGame = {
        ...structuredClone(frame.snapshot.postGame),
        choices: Object.fromEntries([...room.clients].map((member) => [
          member.id,
          previousChoices[member.id] === 'stay' ? 'stay' : 'waiting',
        ])),
      };
      room.match.postGame = structuredClone(room.postGame);
    }
    const matchLifecycleChanged = Boolean(frame.snapshot && (
      previousVictoryAt !== (room.match.victory?.at ?? null) ||
      previousPostGameEndsAt !== (room.postGame?.endsAt ?? null)
    ));
    return {
      accepted: true,
      revision: frame.revision,
      tick: frame.tick,
      byteLength: validation.byteLength,
      quickPlayResultChanged,
      matchLifecycleChanged,
      actors: acceptedFrame.actors,
    };
  }

  acceptHostMap(client, { map, quickPlay = false, generationRevision } = {}) {
    const room = this.requireClientRoom(client);
    const preparingNextQuickPlayMap = room.quickPlay && room.match?.victory &&
      room.quickPlayState?.phase === 'round-result';
    const preparingNextCustomMap = !room.quickPlay && room.match?.victory &&
      room.customSeriesState?.phase === 'postgame' && room.mapGenerationPending &&
      !['host', 'same'].includes(room.customGameRules?.mapMode);
    const generationPending = room.quickPlay
      ? !room.quickPlayMap && ['lobby', 'round-result'].includes(room.quickPlayState?.phase)
      : room.mapGenerationPending === true;
    if (room.simulationMode !== 'host-authoritative' || room.hostId !== client.id ||
        (room.match && !preparingNextQuickPlayMap && !preparingNextCustomMap) ||
        quickPlay !== room.quickPlay || !generationPending ||
      !Number.isSafeInteger(generationRevision) || generationRevision !== room.mapGenerationRevision ||
        !map || typeof map !== 'object' || Array.isArray(map) ||
        !Number.isFinite(map.width) || !Number.isFinite(map.height) ||
        !Array.isArray(map.rooms) || map.rooms.length > 32 ||
        !Array.isArray(map.objects) || map.objects.length > 2_000 ||
        !map.spawnZones || typeof map.spawnZones !== 'object') {
      throw new RoomManagerError('Host map is invalid or unauthorized.');
    }
    const byteLength = new TextEncoder().encode(JSON.stringify(map)).byteLength;
    if (byteLength > 700 * 1024) throw new RoomManagerError('Host map exceeds the maximum map size.');
    const enforceCustomMapCriteria = room.customGameRules?.mapMode === 'varied' ||
      (room.customGameRules?.mapMode === 'host' && room.mapGenerationMode === 'competitive');
    if (!quickPlay && enforceCustomMapCriteria && room.mapGenerationMode === 'competitive' &&
        !isCompetitiveMap(map, getRoomMapCriteria(room))) {
      throw new RoomManagerError('Host map does not meet the custom room map criteria.');
    }
    const mapCopy = structuredClone(map);
    room.mapSeed = Number.isSafeInteger(map.seed) ? map.seed : room.mapSeed;
    room.mapOptions = map.mapOptions ?? room.mapOptions;
    room.mapGenerationPending = false;
    room.mapGenerationError = null;
    if (quickPlay || room.quickPlay) {
      room.quickPlayMap = { map: mapCopy, seed: room.mapSeed, mapOptions: room.mapOptions, fingerprint: `${room.mapSeed}` };
      room.quickPlayMapReadyNotified = true;
      const leftSiteTeam = Object.entries(map.spawnZones).sort((left, right) => left[1].x - right[1].x)[0]?.[0];
      if ((room.quickPlayState?.round ?? 0) === 0 && leftSiteTeam) {
        room.quickPlaySidesSwapped = room.quickPlayRoleBySquad.A !== leftSiteTeam;
        room.quickPlayState.sidesSwapped = room.quickPlaySidesSwapped;
      }
    } else {
      room.preparedMap = mapCopy;
    }
    let started = false;
    if (room.quickPlay && this.areQuickPlayPlayersReady(room) && !room.match) {
      this.startMatchForRoom(room, this.now());
      started = true;
    }
    return { accepted: true, byteLength, started };
  }

  updateHostMapGenerationProgress(client, { generationRevision, mapsGenerated } = {}) {
    const room = this.requireClientRoom(client);
    if (room.simulationMode !== 'host-authoritative' || room.hostId !== client.id) {
      throw new RoomManagerError('Only the host can report map generation progress.');
    }
    if (room.quickPlay || !room.mapGenerationPending ||
        !Number.isSafeInteger(generationRevision) || generationRevision !== room.mapGenerationRevision) return false;
    if (!Number.isSafeInteger(mapsGenerated) || mapsGenerated < 0 || mapsGenerated > 50_000) {
      throw new RoomManagerError('Map generation progress is invalid.');
    }
    if (mapsGenerated <= (room.mapGenerationCount ?? 0)) return false;
    room.mapGenerationCount = mapsGenerated;
    return true;
  }

  advanceLobbyLifecycle(now = this.now()) {
    const changedRooms = [];
    for (const room of this.rooms.values()) {
      const state = room.quickPlayState;
      if (room.quickPlay && state?.phase === 'countdown' && room.match && now >= room.match.gameplayStartsAt) {
        state.phase = 'playing';
        state.phaseEndsAt = null;
        room.match.quickPlayState = structuredClone(state);
        changedRooms.push(room);
        continue;
      }
      if (room.quickPlay && state?.phase === 'round-result' && now >= state.phaseEndsAt && room.quickPlayMap) {
        this.startMatchForRoom(room, now);
        changedRooms.push(room);
        continue;
      }
      if (room.quickPlay && state?.phase === 'series-report' && now >= state.phaseEndsAt) {
        room.match = null;
        this.resetQuickPlayLobby(room, now);
        changedRooms.push(room);
        continue;
      }
      if (!room.quickPlay && room.postGame && now >= room.postGame.endsAt) {
        if (this.expirePostGameResponses(room, now)) changedRooms.push(room);
      }
      const series = room.customSeriesState;
      const mapReady = !room.quickPlay && (room.simulationMode === 'host-authoritative'
        ? Boolean(room.preparedMap ||
          (room.customGameRules?.mapMode === 'same' && room.customSeriesMap))
        : !room.mapGenerationPending && room.mapGenerationMode !== 'host-choice' &&
          !room.mapGenerationError);
      if (!room.quickPlay && room.clients.size > 0 && !room.match &&
          series?.phase === 'intermission' && !series.teamShufflePending &&
          now >= (series.nextMatchAt ?? 0) && !room.mapGenerationPending &&
          room.mapGenerationMode !== 'host-choice' && mapReady) {
        this.startMatchForRoom(room, now);
        if (!changedRooms.includes(room)) changedRooms.push(room);
      }
    }
    return changedRooms;
  }

  applyBotCommands(client, { commands } = {}) {
    const room = this.requireClientRoom(client);
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!room.match || ((room.match.victory || now >= room.match.endsAt) && !postGameFreeRoam)) {
      throw new RoomManagerError('There is no active match for bot commands.');
    }
    if (!postGameFreeRoam) this.assertGameplayStarted(room.match);
    if (!Array.isArray(commands) || commands.length > BOT_PERSONALITIES.length) {
      throw new RoomManagerError('Bot commands must contain at most ten bot actions.');
    }

    const seen = new Set();
    const acceptedCommands = [];
    for (const command of commands) {
      const actor = room.botActors?.get(command?.botId);
      const player = room.match.players.find((entry) => entry.id === command?.botId && entry.isBot);
      const direction = command?.direction;
      const directionLength = direction && Number.isFinite(direction.x) && Number.isFinite(direction.y)
        ? Math.hypot(direction.x, direction.y) : 0;
      const hostOwnsUnclaimedBot = room.hostId === client.id && player?.controlledById == null;
      const playerOwnsBot = player?.controlledById === client.id;
      const postGamePose = command?.playerPose;
      const postGamePoseValid = !postGameFreeRoam || !playerOwnsBot ||
        (postGamePose && [postGamePose.x, postGamePose.y, postGamePose.vx, postGamePose.vy].every(Number.isFinite) &&
          postGamePose.x >= MOVEMENT_PLAYER_RADIUS && postGamePose.y >= MOVEMENT_PLAYER_RADIUS &&
          postGamePose.x <= room.match.map.width - MOVEMENT_PLAYER_RADIUS &&
          postGamePose.y <= room.match.map.height - MOVEMENT_PLAYER_RADIUS &&
          Math.hypot(postGamePose.vx, postGamePose.vy) <= MOVEMENT_MAX_PLAYER_SPEED + 1e-6);
      if (!actor || !player || (!hostOwnsUnclaimedBot && !playerOwnsBot) ||
          command.controlRevision !== (player.controlRevision ?? 0) || seen.has(command.botId) ||
          !postGamePoseValid ||
          !Number.isSafeInteger(command.sequence) || command.sequence <= actor.roomInputSequence ||
          !this.isValidInput(command.input) || directionLength < 0.9 || directionLength > 1.1 ||
          typeof command.fire !== 'boolean' || typeof command.reload !== 'boolean' ||
          (command.weaponId !== undefined && !this.projectileDefinitions.has(command.weaponId)) ||
          (isProgressionShop(room) && command.weaponId !== undefined &&
            !player?.inventoryWeaponIds?.includes(command.weaponId)) ||
          (now >= room.match.gameplayStartsAt && command.weaponId !== undefined &&
            command.weaponId !== player?.selectedWeaponId) ||
          (command.fire && command.reload) ||
          (playerOwnsBot && command.fire && (!command.playerPose ||
            ![command.playerPose.x, command.playerPose.y, command.playerPose.vx, command.playerPose.vy].every(Number.isFinite) ||
            !Number.isFinite(command.shotAngle) || !Array.isArray(command.shotAngles) ||
            command.shotAngles.length !== (this.projectileDefinitions.get(command?.weaponId ?? player?.selectedWeaponId)?.pelletCount ?? 1) ||
            !command.shotAngles.every(Number.isFinite))) ||
          (command.shotAngle !== undefined && !Number.isFinite(command.shotAngle)) ||
          (command.shotAngles !== undefined && (!Array.isArray(command.shotAngles) ||
            command.shotAngles.length > 32 || !command.shotAngles.every(Number.isFinite)))) {
        throw new RoomManagerError('A bot command is invalid or stale.');
      }
      seen.add(command.botId);
      acceptedCommands.push({ actor, command, player, playerOwnsBot });
    }

    const projectiles = [];
    const audioCues = [];
    const damageCues = [];
    let matchEnded = false;
    for (const { actor, command, player, playerOwnsBot } of acceptedCommands) {
      if (command.weaponId !== undefined) {
        actor.selectedWeaponId = command.weaponId;
        player.selectedWeaponId = command.weaponId;
      }
      this.updateGameInput(actor, { sequence: command.sequence, input: command.input });
      if (postGameFreeRoam && playerOwnsBot && room.simulationMode === 'host-authoritative') {
        Object.assign(player, command.playerPose);
      }
      this.updateGameAim(actor, { type: actor.selectedWeaponId, direction: command.direction });
      const selectedDefinition = this.projectileDefinitions.get(actor.selectedWeaponId);
      const semiAutoTriggerPressed = Boolean(command.fire && !actor.semiAutoTriggerHeld);
      actor.semiAutoTriggerHeld = selectedDefinition?.semiAuto ? command.fire : false;
      if (command.reload) {
        this.beginWeaponReload(actor, { type: actor.selectedWeaponId });
        continue;
      }
      if (!command.fire || !player.alive || player.health <= 0 ||
          (selectedDefinition?.semiAuto && !semiAutoTriggerPressed)) continue;
      const definition = this.projectileDefinitions.get(actor.selectedWeaponId);
      if (playerOwnsBot) {
        const weaponState = player.weaponStats?.[definition.id];
        const canInterruptShellReload = Boolean(definition.reloadPerRound && weaponState?.reloading &&
          (weaponState.ammo ?? 0) > 0);
        if ((weaponState?.reloading && !canInterruptShellReload) ||
            (definition.magazineSize && (weaponState?.ammo ?? 0) <= 0) ||
            (weaponState?.manualActionEndsAt && now < weaponState.manualActionEndsAt) ||
            now < (actor.nextProjectileAt ?? 0)) continue;
      }
      const result = this.fireProjectile(actor, {
        type: actor.selectedWeaponId,
        direction: command.direction,
        shotAngle: command.shotAngle,
        shotAngles: command.shotAngles,
        actionSequence: command.sequence,
        weaponLean: command.input.weaponLean,
        playerPose: command.playerPose,
        localAuthority: player.controlledById === client.id,
      });
      if (result.projectile) projectiles.push(...(result.projectiles ?? [result.projectile]));
      if (result.audioCues) audioCues.push(...result.audioCues);
      else if (result.audioCue) audioCues.push(result.audioCue);
      if (result.damageCues) damageCues.push(...result.damageCues);
      if (result.matchEnded) matchEnded = true;
    }
    if (matchEnded) updateDestructibleObjectIntel(room.match, now);
    return {
      projectiles,
      audioCues,
      damageCues,
      matchEnded,
      ...(matchEnded ? {
        match: getMatchSnapshot(room.match),
        matchByTeam: getMatchSnapshotsByTeam(room.match),
      } : {}),
    };
  }

  fireProjectile(client, {
    type,
    direction,
    shotAngle,
    shotAngles,
    actionSequence,
    weaponLean,
    playerPose,
    localAuthority = false,
  } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!match || (match.victory && !postGameFreeRoam) ||
        (now >= match.endsAt && !postGameFreeRoam)) {
      throw new RoomManagerError('There is no active match.');
    }
    if (!postGameFreeRoam) this.assertGameplayStarted(match);
    const shooter = match.players.find((player) => player.id === client.id);
    if (!shooter || !shooter.alive || shooter.health <= 0) {
      throw new RoomManagerError('Only living players can fire projectiles.');
    }
    if (shooter.equippedSlot === 'gadget' ||
        (Number.isFinite(shooter.gadgetSwitchEndsAt) && now < shooter.gadgetSwitchEndsAt)) {
      return { projectile: null, accepted: false };
    }
    const selectedWeaponId = shooter.selectedWeaponId ?? client.selectedWeaponId ?? this.defaultProjectileType;
    const weaponId = type ?? selectedWeaponId;
    const definition = this.projectileDefinitions.get(weaponId);
    if (!definition) throw new RoomManagerError('That projectile type is not available.');
    if (weaponId !== selectedWeaponId) throw new RoomManagerError('Select that weapon before using it.');
    const currentWeaponStats = shooter.weaponStats?.[definition.id];
    const hasFiniteDirection = direction && Number.isFinite(direction.x) && Number.isFinite(direction.y);
    const directionLength = hasFiniteDirection ? Math.hypot(direction.x, direction.y) : 0;
    const safeDirection = hasFiniteDirection && directionLength > 1e-9
      ? direction
      : Number.isFinite(currentWeaponStats?.aimAngle)
        ? { x: Math.cos(currentWeaponStats.aimAngle), y: Math.sin(currentWeaponStats.aimAngle) }
        : null;
    if (!safeDirection) return { projectile: null, accepted: false };
    const pelletCount = definition.pelletCount ?? 1;
    const ownerShotAnglesValid = localAuthority && Number.isFinite(shotAngle) &&
      Array.isArray(shotAngles) && shotAngles.length === pelletCount && shotAngles.every(Number.isFinite);
    if (localAuthority && !ownerShotAnglesValid) return { projectile: null, accepted: false };
    const ownerPoseValid = localAuthority && playerPose &&
      [playerPose.x, playerPose.y, playerPose.vx, playerPose.vy].every(Number.isFinite) &&
      playerPose.x >= MOVEMENT_PLAYER_RADIUS && playerPose.y >= MOVEMENT_PLAYER_RADIUS &&
      playerPose.x <= match.map.width - MOVEMENT_PLAYER_RADIUS &&
      playerPose.y <= match.map.height - MOVEMENT_PLAYER_RADIUS;
    if (localAuthority && !ownerPoseValid) return { projectile: null, accepted: false };
    const accuracyState = shooter.weaponStats?.[definition.id] ??
      createWeaponAccuracyStates(this.projectileDefinitions, now, shooter.inventory)[definition.id];
    shooter.weaponStats ??= {};
    shooter.weaponStats[definition.id] = accuracyState;
    const canInterruptShellReload = Boolean(definition.reloadPerRound && accuracyState.reloading && accuracyState.ammo > 0);
    const magazineSize = getEffectiveMagazineSize(definition.magazineSize, shooter.inventory);
    if (!localAuthority && ((accuracyState.reloading && !canInterruptShellReload) ||
      (magazineSize && accuracyState.ammo <= 0) ||
        (accuracyState.manualActionEndsAt && now < accuracyState.manualActionEndsAt))) {
      return { projectile: null, accepted: false };
    }
    if (!localAuthority && now < (client.nextProjectileAt ?? 0)) return { projectile: null, accepted: false };
    if (localAuthority) {
      accuracyState.aimAngle = Math.atan2(safeDirection.y, safeDirection.x);
      accuracyState.aimUpdatedAt = now;
      if (Number.isFinite(weaponLean)) shooter.weaponLean = Math.max(-1, Math.min(1, weaponLean));
    } else {
      this.updateGameAim(client, { type, direction: safeDirection });
    }
    if (canInterruptShellReload) {
      clearWeaponReload(accuracyState);
      accuracyState.manualActionQueuedDurationMs = null;
    }
    if (magazineSize) accuracyState.ammo = Math.max(0, accuracyState.ammo - 1);
    if (magazineSize && accuracyState.ammo === 0) {
      startWeaponReload(shooter, definition, now, true);
    }
    startManualAction(accuracyState, definition.manualActionDurationMs, now);
    const speed = Math.hypot(shooter.vx, shooter.vy);
    const accuracySettings = getEffectiveAccuracySettings(definition.accuracy, shooter.inventory);
    const effectiveAccuracy = getEffectiveAccuracy(
      accuracyState.accuracy,
      speed,
      MOVEMENT_MAX_PLAYER_SPEED,
      accuracySettings.movementPenaltyAtMaxSpeed,
    );
    const spreadRadians = ownerShotAnglesValid
      ? shotAngle - accuracyState.aimAngle
      : getGaussianSpreadRadians(effectiveAccuracy, definition.accuracy.maxSpreadDegrees, this.random);
    const directionAngle = ownerShotAnglesValid ? shotAngle : accuracyState.aimAngle + spreadRadians;
    accuracyState.accuracy = applyAccuracyRecoil(accuracyState.accuracy, accuracySettings.recoilPerShot);
    accuracyState.shotsFired += 1;
    if (definition.burstCount) {
      accuracyState.burstShotsRemaining = accuracyState.burstShotsRemaining > 0
        ? accuracyState.burstShotsRemaining - 1
        : definition.burstCount - 1;
      if (accuracyState.ammo === 0) accuracyState.burstShotsRemaining = 0;
      client.nextProjectileAt = now + (accuracyState.burstShotsRemaining > 0
        ? definition.burstShotIntervalMs : definition.burstDelayMs);
    } else {
      accuracyState.burstShotsRemaining = 0;
      client.nextProjectileAt = now + definition.cooldownMs;
    }
    accuracyState.cooldownEndsAt = client.nextProjectileAt;
    accuracyState.effectiveAccuracy = getEffectiveAccuracy(
      accuracyState.accuracy,
      speed,
      MOVEMENT_MAX_PLAYER_SPEED,
      accuracySettings.movementPenaltyAtMaxSpeed,
    );

    const shotLean = localAuthority && Number.isFinite(weaponLean)
      ? Math.max(-1, Math.min(1, weaponLean))
      : shooter.weaponLean;
    const shotSource = localAuthority ? { ...shooter, ...playerPose, weaponLean: shotLean } : shooter;
    const start = getWeaponMuzzlePosition(shotSource, accuracyState.aimAngle, shotLean, match.map.objects);
    const audioCues = definition.suppressed
      ? []
      : this.createShotAudioCues(match, shotSource, start, now);
    const pelletHalfSpread = (definition.pelletSpreadDegrees ?? 0) * Math.PI / 180;
    const projectiles = [];
    const damageCuesByVictim = new Map();
    let destructiblePropHit = false;
    for (let pelletIndex = 0; pelletIndex < pelletCount; pelletIndex += 1) {
      const pelletOffset = pelletCount === 1 ? 0
        : -pelletHalfSpread + (pelletIndex / (pelletCount - 1)) * pelletHalfSpread * 2 +
          (this.random() - 0.5) * (pelletHalfSpread / pelletCount);
      const pelletAngle = ownerShotAnglesValid ? shotAngles[pelletIndex] : directionAngle + pelletOffset;
      const projectile = {
        id: randomUUID(),
        type: definition.id,
        ownerId: shooter.id,
        ownerTeam: shooter.team,
        x: shotSource.x,
        y: shotSource.y,
        damage: definition.damage,
        centerDamageMultiplier: definition.centerDamageMultiplier,
        edgeDamageMultiplier: definition.edgeDamageMultiplier,
        minimumDamageMultiplier: definition.minimumDamageMultiplier,
        damageFalloffStartRange: definition.damageFalloffStartRange,
        damageFalloffEndRange: definition.damageFalloffEndRange,
        radius: definition.radius,
        range: definition.range,
        friendlyFire: definition.friendlyFire,
      };
      const end = {
        x: start.x + Math.cos(pelletAngle) * definition.range,
        y: start.y + Math.sin(pelletAngle) * definition.range,
      };
      const { event: trace, damageCue } = this.traceProjectile(match, projectile, start, end, accuracyState.aimAngle);
      destructiblePropHit ||= Number.isFinite(trace.objectHealth);
      if (damageCue && (!damageCuesByVictim.has(damageCue.victimId) ||
          damageCue.damage > damageCuesByVictim.get(damageCue.victimId).damage)) {
        damageCuesByVictim.set(damageCue.victimId, damageCue);
      }
      trace.accuracy = effectiveAccuracy;
      trace.spreadRadians = pelletAngle - accuracyState.aimAngle;
      if (Number.isSafeInteger(actionSequence)) trace.ownerActionSequence = actionSequence;
      if (pelletCount > 1) trace.pelletIndex = pelletIndex;
      projectiles.push(trace);
    }
    match.updatedAt = now;
    const matchEnded = this.setEliminationVictoryIfNeeded(room, now);
    if (destructiblePropHit || matchEnded) updateDestructibleObjectIntel(match, now);
    return {
      projectile: projectiles[0],
      ...(pelletCount > 1 ? { projectiles } : {}),
      accepted: true,
      ...(audioCues.length ? { audioCue: audioCues[0], audioCues } : {}),
      ...(damageCuesByVictim.size ? { damageCues: [...damageCuesByVictim.values()] } : {}),
      ...(matchEnded ? { matchEnded: true, match: getMatchSnapshot(match), matchByTeam: getMatchSnapshotsByTeam(match) } : {}),
    };
  }

  createShotAudioCues(match, shooter, source, now = this.now()) {
    let listener = null;
    let closestDistanceSquared = Infinity;
    for (const player of match.players) {
      if (!player.alive || player.health <= 0 || player.team === shooter.team ||
          isPlayerJammed(player, now) || isPlayerFlashBlinded(player, now)) continue;
      const dx = player.x - source.x;
      const dy = player.y - source.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < closestDistanceSquared) {
        listener = player;
        closestDistanceSquared = distanceSquared;
      }
    }
    const sonarListener = findSonarListener(
      match.players, source, shooter.team, match.gadgetEffects, now,
    );
    const visionObjects = [...match.map.objects, ...(match.smokes ?? [])];
    const teamCues = [];
    const addTeamCue = (listenerTeam, distanceSquared, listener, sonar) => {
      const visible = !sonar && isAudioSourceVisibleToTeam(
        match.players, listenerTeam, source, visionObjects, this.projectileDefinitions, now,
      );
      match.audioCueLastAt ??= { red: -Infinity, blue: -Infinity };
      if (visible || now - (match.audioCueLastAt[listenerTeam] ?? -Infinity) < 600) return;
      match.audioCueLastAt[listenerTeam] = now;
      const distance = Math.sqrt(distanceSquared);
      const radius = Math.min(320, Math.max(42, 30 + distance * 0.24));
      const angle = this.random() * Math.PI * 2;
      const offset = radius * (0.3 + this.random() * 0.45);
      teamCues.push({
        id: randomUUID(),
        kind: 'gunshot',
        team: listenerTeam,
        ...(sonar
          ? { heardById: sonar.ownerId, sonarId: sonar.sonarId }
          : listener ? { heardById: listener.id } : {}),
        x: source.x + Math.cos(angle) * offset,
        y: source.y + Math.sin(angle) * offset,
        radius,
        expiresAt: now + 2_400,
      });
    };
    if (listener || sonarListener) {
      const useSonar = sonarListener &&
        (!listener || sonarListener.distanceSquared < closestDistanceSquared);
      addTeamCue(
        useSonar ? sonarListener.team : listener.team,
        useSonar ? sonarListener.distanceSquared : closestDistanceSquared,
        useSonar ? null : listener,
        useSonar ? sonarListener : null,
      );
    }

    if (isPlayerJammed(shooter, now)) {
      let teammate = null;
      let teammateDistanceSquared = Infinity;
      for (const player of match.players) {
        if (!player.alive || player.health <= 0 || player.team !== shooter.team ||
            isPlayerJammed(player, now) || isPlayerFlashBlinded(player, now)) continue;
        const dx = player.x - source.x;
        const dy = player.y - source.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < teammateDistanceSquared) {
          teammate = player;
          teammateDistanceSquared = distanceSquared;
        }
      }
      if (teammate) {
        addTeamCue(shooter.team, teammateDistanceSquared, teammate, null);
      }
    }

    match.privateAudioCueLastAt ??= {};
    const personalCues = [];
    for (const jammedListener of match.players) {
      if (!jammedListener.alive || jammedListener.health <= 0 ||
          (jammedListener.team === shooter.team && !isPlayerJammed(shooter, now)) ||
          !isPlayerJammed(jammedListener, now) ||
          isPlayerFlashBlinded(jammedListener, now) ||
          isAudioSourceVisibleToPlayer(
            jammedListener, source, visionObjects, this.projectileDefinitions, now,
          )) continue;
      const key = `${shooter.id}:${jammedListener.id}`;
      if (now - (match.privateAudioCueLastAt[key] ?? -Infinity) < 600) continue;
      match.privateAudioCueLastAt[key] = now;
      const distance = Math.hypot(jammedListener.x - source.x, jammedListener.y - source.y);
      const radius = Math.min(320, Math.max(42, 30 + distance * 0.24));
      const angle = this.random() * Math.PI * 2;
      const offset = radius * (0.3 + this.random() * 0.45);
      personalCues.push({
        id: randomUUID(),
        kind: 'gunshot',
        team: jammedListener.team,
        heardById: jammedListener.id,
        audiencePlayerId: jammedListener.controlledById ?? jammedListener.id,
        x: source.x + Math.cos(angle) * offset,
        y: source.y + Math.sin(angle) * offset,
        radius,
        expiresAt: now + 2_400,
      });
    }

    match.botNoises ??= [];
    match.botNoises.push(...[...teamCues, ...personalCues].map((cue) => ({ ...cue })));
    if (match.botNoises.length > 32) match.botNoises.splice(0, match.botNoises.length - 32);
    return teamCues;
  }

  createTeamPing(client, { x, y } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    if (!match) {
      throw new RoomManagerError('Pings are only available during a match.');
    }
    if (!['red', 'blue'].includes(client.team)) {
      throw new RoomManagerError('Only assigned team members can place a ping.');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > match.map.width || y > match.map.height) {
      throw new RoomManagerError('Ping coordinates must be inside the map.');
    }
    return {
      id: randomUUID(),
      team: client.team,
      x,
      y,
      expiresAt: now + 3_000,
    };
  }

  updateGameAim(client, { type, direction, visionAngle } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!match || (match.victory && !postGameFreeRoam) ||
        (now >= match.endsAt && !postGameFreeRoam)) {
      throw new RoomManagerError('There is no active match.');
    }
    if (!postGameFreeRoam && now >= match.gameplayStartsAt) this.assertGameplayStarted(match);
    const player = match.players.find((entry) => entry.id === client.id);
    if (!player || !player.alive || player.health <= 0) {
      // Aim updates are fire-and-forget and may already be in flight when a
      // death snapshot reaches the client. Treat those stale updates as no-ops.
      return { accepted: false };
    }
    const selectedWeaponId = player.selectedWeaponId ?? client.selectedWeaponId ?? this.defaultProjectileType;
    const weaponId = type ?? selectedWeaponId;
    if (weaponId !== selectedWeaponId) {
      // Aim updates are fire-and-forget; a previous weapon's update can arrive
      // after a selection change. Discard it instead of surfacing an error.
      return { accepted: false };
    }
    const definition = this.projectileDefinitions.get(weaponId);
    if (!definition) throw new RoomManagerError('That weapon is not available.');
    if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y) ||
        Math.hypot(direction.x, direction.y) <= 1e-9) {
      const previousAngle = player.weaponStats?.[definition.id]?.aimAngle;
      return { accepted: false, aimAngle: Number.isFinite(previousAngle) ? previousAngle : 0 };
    }

    player.weaponStats ??= createWeaponAccuracyStates(this.projectileDefinitions, now);
    const stats = player.weaponStats[definition.id];
    const targetAngle = Math.atan2(direction.y, direction.x);
    const elapsedSeconds = Math.max(0, (now - (stats.aimUpdatedAt ?? now)) / 1000);
    const turnScale = getGadgetWeaponTurnScale(player, match.gadgetEffects, now);
    stats.aimAngle = rotateAngleTowards(
      stats.aimAngle ?? 0,
      targetAngle,
      getMaximumRotationRadiansPerSecond(definition.rotationTimeMs) * elapsedSeconds * turnScale,
    );
    stats.aimUpdatedAt = now;
    if (Number.isFinite(visionAngle)) player.visionAngle = visionAngle;
    match.updatedAt = now;
    return { aimAngle: stats.aimAngle };
  }

  applyGadgetAction(client, { action, target } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const infiniteGadgetUse = match?.infiniteGadgetUse === true;
    if (!match || match.victory || now >= match.endsAt) {
      throw new RoomManagerError('There is no active match.');
    }
    this.assertGameplayStarted(match);
    const player = match.players.find((entry) => entry.id === client.id);
    if (!player || !player.alive || player.health <= 0) {
      throw new RoomManagerError('Only living players can use gadgets.');
    }
    if (Number.isFinite(player.gadgetSwitchEndsAt) && now >= player.gadgetSwitchEndsAt) {
      player.equippedSlot = player.gadgetSwitchTargetSlot ?? player.equippedSlot ?? 'weapon';
      player.gadgetSwitchStartedAt = null;
      player.gadgetSwitchEndsAt = null;
      player.gadgetSwitchTargetSlot = null;
      if (player.equippedSlot === 'weapon') {
        resumeQueuedManualAction(player.weaponStats?.[player.selectedWeaponId], now);
      }
    }
    if (Number.isFinite(player.gadgetSwitchEndsAt) && now < player.gadgetSwitchEndsAt) {
      return { accepted: false };
    }

    if (action === 'switch') {
      const targetSlot = player.equippedSlot === 'gadget' ? 'weapon' : 'gadget';
      player.gadgetCounts ??= createGadgetCounts(player.selectedGadgetId, player.gadgetCount ?? 0);
      const placedTrophy = player.selectedGadgetId === TROPHY_SYSTEM_ID
        ? getOwnedActiveTrophySystem(match.gadgetEffects, player.id, now)
        : null;
      const trophyCommandJammed = targetSlot === 'gadget' && placedTrophy &&
        (isPlayerJammed(player, now) || isGadgetJammed(placedTrophy, now));
      const hasPlacedTrophy = Boolean(placedTrophy);
      if (trophyCommandJammed) return { accepted: false };
      if (targetSlot === 'gadget' &&
          (!GADGET_DEFINITIONS[player.selectedGadgetId] ||
            ((player.gadgetCounts[player.selectedGadgetId] ?? 0) <= 0 &&
              !hasPlacedTrophy && !infiniteGadgetUse))) {
        throw new RoomManagerError('That gadget is not available.');
      }
      if (targetSlot === 'gadget' && infiniteGadgetUse) {
        refillGadgetCharges(player, player.selectedGadgetId);
      }
      player.gadgetSwitchStartedAt = now;
      player.gadgetSwitchEndsAt = now + GADGET_SWITCH_DURATION_MS;
      player.gadgetSwitchTargetSlot = targetSlot;
      suspendWeaponActionsForSwitch(player, targetSlot, now);
      match.updatedAt = now;
      return { accepted: true, action, targetSlot };
    }

    player.gadgetCounts ??= createGadgetCounts(player.selectedGadgetId, player.gadgetCount ?? 0);
    if (action === 'select') {
      const gadgetId = target?.gadgetId;
      if (player.equippedSlot !== 'weapon' || !GADGET_DEFINITIONS[gadgetId] ||
          ((player.gadgetCounts[gadgetId] ?? 0) <= 0 && !infiniteGadgetUse)) return { accepted: false };
      if (infiniteGadgetUse) refillGadgetCharges(player, gadgetId);
      player.selectedGadgetId = gadgetId;
      player.gadgetCount = player.gadgetCounts[gadgetId];
      match.updatedAt = now;
      return { accepted: true, action, selectedGadgetId: gadgetId };
    }

    if (action !== 'use' || player.equippedSlot !== 'gadget' || !GADGET_DEFINITIONS[player.selectedGadgetId]) {
      return { accepted: false };
    }
    if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y) ||
        target.x < 0 || target.y < 0 || target.x > match.map.width || target.y > match.map.height) {
      throw new RoomManagerError('Gadget target must be inside the map.');
    }
    const gadget = GADGET_DEFINITIONS[player.selectedGadgetId];
    const ownedTrophy = gadget.id === TROPHY_SYSTEM_ID
      ? getOwnedActiveTrophySystem(match.gadgetEffects, player.id, now)
      : null;
    if (ownedTrophy) {
      if (!infiniteGadgetUse && now < (player.trophyCommandReadyAt ?? 0)) return { accepted: false };
      const projectile = createHostTrophyCommandProjectile({
        id: randomUUID(),
        player,
        trophy: ownedTrophy,
        target,
        mapObjects: match.map.objects,
        now,
        matchEndsAt: match.endsAt,
        mapWidth: match.map.width,
        mapHeight: match.map.height,
      });
      if (!projectile) return { accepted: false };
      match.pendingGadgetEffects ??= [];
      match.pendingGadgetEffects.push(projectile);
      player.trophyCommandReadyAt = now +
        (infiniteGadgetUse ? 0 : TROPHY_SYSTEM_COMMAND_COOLDOWN_MS);
      player.equippedSlot = 'weapon';
      player.gadgetSwitchStartedAt = null;
      player.gadgetSwitchEndsAt = null;
      player.gadgetSwitchTargetSlot = null;
      if (!client[BOT_ACTOR]) client.trophyCommandReadyAt = player.trophyCommandReadyAt;
      match.updatedAt = now;
      return {
        accepted: true,
        action,
        trajectory: projectile.trajectoryPreview,
        commandProjectile: projectile.effect,
        gadgetId: gadget.id,
      };
    }
    if ((player.gadgetCounts[gadget.id] ?? 0) <= 0 && !infiniteGadgetUse) return { accepted: false };
    if (gadget.id === ORBITAL_STRIKE_ID) {
      const warning = createHostOrbitalStrikeWarning({
        id: randomUUID(),
        definition: gadget,
        player,
        target,
        now,
      });
      if (!warning) return { accepted: false };
      match.pendingGadgetEffects ??= [];
      match.pendingGadgetEffects.push({
        effect: warning,
        landedAt: now,
        detonatesAt: warning.strikeAt,
      });
      if (infiniteGadgetUse) refillGadgetCharges(player, gadget.id);
      else consumeGadgetCharge(player, gadget.id);
      player.gadgetCount = player.gadgetCounts[gadget.id];
      if (!infiniteGadgetUse) queueOrbitalStrikeRecharge(player, gadget.cooldownMs);
      if (!client[BOT_ACTOR]) {
        client.selectedGadgetId = player.selectedGadgetId;
        client.gadgetCounts = structuredClone(player.gadgetCounts);
        client.gadgetCount = player.gadgetCount;
      }
      if (player.gadgetCount <= 0) {
        player.equippedSlot = 'weapon';
        player.gadgetSwitchStartedAt = null;
        player.gadgetSwitchEndsAt = null;
        player.gadgetSwitchTargetSlot = null;
      }
      match.updatedAt = now;
      return { accepted: true, action, warning, gadgetId: gadget.id };
    }
    if (gadget.id === SONAR_ID) {
      const origin = getGadgetThrowOrigin(player, target, match.map.objects);
      if (!origin) return { accepted: false };
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 1e-6) return { accepted: false };
      const sonarTarget = {
        x: origin.x + dx / distance * gadget.projectileRange,
        y: origin.y + dy / distance * gadget.projectileRange,
      };
      const trajectory = calculateGadgetTrajectory(origin, sonarTarget, match.map.objects, {
        maximumRange: gadget.projectileRange,
        collisionRadius: gadget.throwCollisionRadius,
        maximumBounces: Infinity,
        includeBounceEpsilon: true,
      });
      const projectile = trajectory && createHostSonarProjectile({
        id: randomUUID(),
        definition: gadget,
        player,
        trajectory,
        now,
      });
      if (!projectile) return { accepted: false };
      match.gadgetEffects ??= [];
      match.gadgetEffects.push(projectile);
      if (infiniteGadgetUse) refillGadgetCharges(player, gadget.id);
      else consumeGadgetCharge(player, gadget.id);
      player.gadgetCount = player.gadgetCounts[gadget.id];
      if (!infiniteGadgetUse) queueSonarChargeRecharge(player, gadget.cooldownMs);
      if (!client[BOT_ACTOR]) {
        client.selectedGadgetId = player.selectedGadgetId;
        client.gadgetCounts = structuredClone(player.gadgetCounts);
        client.gadgetCount = player.gadgetCount;
      }
      if (player.gadgetCount <= 0) {
        player.equippedSlot = 'weapon';
        player.gadgetSwitchStartedAt = null;
        player.gadgetSwitchEndsAt = null;
        player.gadgetSwitchTargetSlot = null;
      }
      match.updatedAt = now;
      return { accepted: true, action, trajectory, sonar: projectile, gadgetId: gadget.id };
    }
    const throwOrigin = getGadgetThrowOrigin(player, target, match.map.objects);
    const trajectory = throwOrigin && calculateGadgetTrajectory(throwOrigin, target, match.map.objects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory) return { accepted: false };
    const created = createHostGadgetEffect({
      id: randomUUID(),
      definition: gadget,
      player,
      trajectory,
      now,
      matchEndsAt: match.endsAt,
    });
    if (!created) return { accepted: false };
    const { effect, landedAt: flightEndsAt, detonatesAt } = created;
    if (infiniteGadgetUse) refillGadgetCharges(player, gadget.id);
    else consumeGadgetCharge(player, gadget.id);
    player.gadgetCount = player.gadgetCounts[gadget.id];
    if (gadget.id === VINE_TRAP_ID) player.vineTrapRechargeAt = null;
    if (!infiniteGadgetUse && Number.isFinite(gadget.cooldownMs) && Number.isSafeInteger(gadget.charges)) {
      queuePerChargeGadgetRecharge(player, gadget.id, gadget.cooldownMs, gadget.charges);
    }
    if (!client[BOT_ACTOR]) {
      client.selectedGadgetId = player.selectedGadgetId;
      client.gadgetCounts = structuredClone(player.gadgetCounts);
      client.gadgetCount = player.gadgetCount;
    }
    if (player.gadgetCounts[gadget.id] <= 0) {
      player.equippedSlot = 'weapon';
      player.gadgetSwitchStartedAt = null;
      player.gadgetSwitchEndsAt = null;
      player.gadgetSwitchTargetSlot = null;
    }
    match.pendingGadgetEffects ??= [];
    match.pendingGadgetEffects.push({
      effect,
      landedAt: flightEndsAt,
      detonatesAt,
      trajectory: created.trajectory,
      projectileSpeed: created.projectileSpeed,
    });
    match.updatedAt = now;
    return { accepted: true, action, trajectory, smoke: effect, gadgetId: gadget.id };
  }

  updateMineIntel(match, now = Date.now()) {
    match.mineIntel ??= { red: new Set(), blue: new Set() };
    const mines = (match.gadgetEffects ?? []).filter((effect) =>
      effect.triggerOnEnemyProximity === true);
    for (const team of ['red', 'blue']) {
      const intel = match.mineIntel[team] ??= new Set();
      intel.clear();
    }

    const visionObjects = [...(match.map?.objects ?? []), ...(match.smokes ?? [])];
    for (const sonar of match.gadgetEffects ?? []) {
      if (sonar.type === 'sonar-projectile' && ['red', 'blue'].includes(sonar.team) &&
          !isGadgetJammed(sonar, now)) {
        match.mineIntel[sonar.team].add(sonar.id);
      }
    }
    for (const mine of mines) {
      const jammed = isGadgetJammed(mine, now);
      if ((mine.team === 'red' || mine.team === 'blue') &&
          !jammed) match.mineIntel[mine.team].add(mine.id);
      const latchedEnemy = match.players.find((player) => player.id === mine.latchedEnemyId);
      if ((latchedEnemy?.team === 'red' || latchedEnemy?.team === 'blue') &&
          !isPlayerJammed(latchedEnemy, now) && (!jammed || latchedEnemy.team !== mine.team)) {
        match.mineIntel[latchedEnemy.team].add(mine.id);
      }
      for (const player of match.players ?? []) {
        if (!player.alive || player.health <= 0 || isPlayerFlashBlinded(player, now) ||
            isPlayerJammed(player, now) ||
            (jammed && player.team === mine.team) ||
            (player.team !== 'red' && player.team !== 'blue')) continue;
        const weapon = this.projectileDefinitions.get(player.selectedWeaponId) ??
          this.projectileDefinitions.get('assault-rifle');
        if (!weapon) continue;
        const angle = player.visionAngle ?? player.weaponStats?.[weapon.id]?.aimAngle ?? 0;
        const origin = getPlayerVisionOrigin(player, visionObjects);
        const vision = { origin, angle, halfAngle: VISION_HALF_ANGLE };
        if (isPointVisible({ x: mine.x, y: mine.y }, vision, visionObjects)) {
          match.mineIntel[player.team].add(mine.id);
        }
      }
    }
  }

  resolveOrbitalStrike(match, warning, now) {
    const impact = createHostOrbitalStrikeImpact(warning, now);
    if (!impact) return;
    const blastDamage = applyGadgetAreaDamage(
      match.gadgetEffects, match.map?.objects, warning, warning.radius,
      warning.explosionDamage, warning.id, now,
    );
    if (blastDamage.removedEffectIds.size > 0) {
      match.gadgetEffects = (match.gadgetEffects ?? [])
        .filter((effect) => !blastDamage.removedEffectIds.has(effect.id));
    }
    for (const player of match.players ?? []) {
      if (!player.alive || player.health <= 0 ||
          Math.hypot(player.x - warning.x, player.y - warning.y) > warning.radius) continue;
      const damage = warning.explosionDamage;
      const armorDamage = Math.min(Math.max(0, player.armor ?? 0), damage);
      player.armor = Math.max(0, (player.armor ?? 0) - armorDamage);
      const healthBefore = player.health;
      player.health = Math.max(0, healthBefore - (damage - armorDamage));
      const dealt = armorDamage + healthBefore - player.health;
      if (dealt <= 0) continue;
      player.lastDamagedAt = now;
      match.damageContributions ??= {};
      const contributions = match.damageContributions[player.id] ??= {};
      contributions[warning.ownerId] = (contributions[warning.ownerId] ?? 0) + dealt;
      if (player.health <= 0) this.markPlayerDead(match, player, warning.ownerId);
    }
    match.gadgetEffects ??= [];
    match.gadgetEffects.push(impact.explosion, impact.fire);
  }

  applyGadgetEffectDamage(match, tickStartedAt, now) {
    const triggeredMines = [];
    const mineVisionObjects = [...(match.map?.objects ?? []), ...(match.smokes ?? [])];
    const effects = match.gadgetEffects ?? [];
    for (const player of match.players) advanceVineTrapRecharge(player, now);
    const { removedEffectIds, burns } = applyMolotovWorldEffects(
      effects, match.map?.objects, tickStartedAt, now,
    );
    for (const { molotov, damage } of burns) {
      for (const player of match.players) {
        if (!player.alive || player.health <= 0 ||
            Math.hypot(player.x - molotov.x, player.y - molotov.y) > (molotov.radius ?? 0)) continue;
        const armorDamage = Math.min(Math.max(0, player.armor ?? 0), damage);
        player.armor = Math.max(0, (player.armor ?? 0) - armorDamage);
        const healthBefore = player.health;
        player.health = Math.max(0, healthBefore - (damage - armorDamage));
        const dealt = armorDamage + healthBefore - player.health;
        if (dealt <= 0) continue;
        player.lastDamagedAt = now;
        match.damageContributions ??= {};
        const contributions = match.damageContributions[player.id] ??= {};
        contributions[molotov.ownerId] = (contributions[molotov.ownerId] ?? 0) + dealt;
        if (player.health <= 0) this.markPlayerDead(match, player, molotov.ownerId);
      }
    }

    if (removedEffectIds.size) {
      match.gadgetEffects = effects.filter((effect) => !removedEffectIds.has(effect.id));
    }

    let activeEffects = match.gadgetEffects ?? [];
    const completedVineTrapIds = new Set();
    for (const effect of activeEffects) {
      if (effect.type !== VINE_TRAP_ID || !effect.latchedEnemyId) continue;
      const targetDied = isVineTrapTargetDead(effect, match.players);
      if (!targetDied && effect.activeUntil > now) continue;
      const owner = match.players.find((player) => player.id === effect.ownerId);
      if (owner && match.infiniteGadgetUse === true) {
        owner.vineTrapRechargeAt = null;
      } else if (owner) {
        startVineTrapRecharge(owner, targetDied ? now : effect.activeUntil ?? now, effect.rechargeDurationMs);
      }
      completedVineTrapIds.add(effect.id);
    }
    if (completedVineTrapIds.size) {
      activeEffects = activeEffects.filter((effect) => !completedVineTrapIds.has(effect.id));
      match.gadgetEffects = activeEffects;
    }

    for (const effect of activeEffects) {
      if (!effect.triggerOnEnemyProximity) continue;
      if (effect.type === VINE_TRAP_ID && effect.latchedEnemyId) continue;
      if (!isProximityMineArmed(effect, now)) {
        effect.armed = false;
        continue;
      }
      effect.armed = true;
      const detectionRadius = effect.triggerRadius ?? effect.radius;
      const detectedEnemy = match.players.find((player) => player.alive && player.health > 0 &&
        player.team !== effect.team && isWithinRadiusAndLineOfSight(
          effect, player, detectionRadius, mineVisionObjects,
        ));
      if (!detectedEnemy) continue;
      if (effect.type === VINE_TRAP_ID) {
        activateVineTrap(effect, detectedEnemy, now);
      } else {
        triggeredMines.push(effect);
      }
    }
    if (triggeredMines.length) {
      const triggeredIds = new Set(triggeredMines.map((mine) => mine.id));
      match.gadgetEffects = (match.gadgetEffects ?? []).filter((effect) => !triggeredIds.has(effect.id));
      for (const mine of triggeredMines) {
        const radius = mine.triggerRadius ?? mine.radius;
        const blastDamage = applyGadgetAreaDamage(
          match.gadgetEffects, match.map?.objects, mine, radius,
          mine.explosionDamage ?? 150, mine.id, now,
        );
        if (blastDamage.removedEffectIds.size > 0) {
          match.gadgetEffects = (match.gadgetEffects ?? [])
            .filter((effect) => !blastDamage.removedEffectIds.has(effect.id));
        }
        for (const player of match.players) {
          if (!player.alive || player.health <= 0 || !isWithinRadiusAndLineOfSight(
            mine, player, radius, mineVisionObjects,
          )) continue;
          const damage = mine.explosionDamage ?? 150;
          const armorDamage = Math.min(Math.max(0, player.armor ?? 0), damage);
          player.armor = Math.max(0, (player.armor ?? 0) - armorDamage);
          const healthBefore = player.health;
          player.health = Math.max(0, healthBefore - (damage - armorDamage));
          const dealt = armorDamage + healthBefore - player.health;
          if (dealt <= 0) continue;
          player.lastDamagedAt = now;
          match.damageContributions ??= {};
          const contributions = match.damageContributions[player.id] ??= {};
          contributions[mine.ownerId] = (contributions[mine.ownerId] ?? 0) + dealt;
          if (player.health <= 0) this.markPlayerDead(match, player, mine.ownerId);
        }
        match.gadgetEffects.push({
          id: randomUUID(),
          shape: 'circle',
          type: 'mine-explosion',
          gadgetId: mine.gadgetId,
          x: mine.x,
          y: mine.y,
          radius,
          ownerId: mine.ownerId,
          team: mine.team,
          startedAt: now,
          expiresAt: now + 500,
          blocksMovement: false,
          blocksProjectiles: false,
          blocksVision: false,
        });
      }
    }
  }

  getMatchSnapshotForClient(client) {
    const match = client.room?.match;
    if (!match) return null;
    const snapshot = getMatchSnapshot(match, client.team);
    const player = match.players.find((entry) => entry.id === client.id) ??
      match.players.find((entry) => entry.controlledById === client.id);
    if (!isPlayerJammed(player, this.now())) return snapshot;
    return {
      ...snapshot,
      botNoises: structuredClone((match.botNoises ?? []).filter((cue) =>
        cue.team === player.team && cue.expiresAt > this.now() &&
        (cue.audiencePlayerId === client.id || cue.heardById === player.id))),
      gadgetEffects: snapshot.gadgetEffects.filter((effect) =>
        effect.team !== client.team || effect.ownerId === player.id),
    };
  }

  beginWeaponReload(client, { type } = {}) {
    const room = this.requireClientRoom(client);
    const match = room.match;
    const now = this.now();
    const postGameFreeRoam = this.isPostGameFreeRoam(room, now);
    if (!match || (match.victory && !postGameFreeRoam) ||
        (now >= match.endsAt && !postGameFreeRoam)) {
      throw new RoomManagerError('There is no active match.');
    }
    if (!postGameFreeRoam) this.assertGameplayStarted(match);
    const player = match.players.find((entry) => entry.id === client.id);
    if (!player || !player.alive || player.health <= 0) {
      throw new RoomManagerError('Only living players can reload.');
    }
    if (player.equippedSlot === 'gadget' ||
        (Number.isFinite(player.gadgetSwitchEndsAt) && now < player.gadgetSwitchEndsAt)) {
      return { accepted: false };
    }
    const selectedWeaponId = player.selectedWeaponId ?? client.selectedWeaponId ?? this.defaultProjectileType;
    const weaponId = type ?? selectedWeaponId;
    if (weaponId !== selectedWeaponId) throw new RoomManagerError('Select that weapon before reloading it.');
    const definition = this.projectileDefinitions.get(weaponId);
    if (!definition) throw new RoomManagerError('That weapon is not available.');
    if (!getEffectiveMagazineSize(definition.magazineSize, player.inventory) ||
      (!definition.reloadDurationMs && !definition.reloadPerRound)) {
      throw new RoomManagerError('That weapon does not use a magazine.');
    }

    player.weaponStats ??= createWeaponAccuracyStates(this.projectileDefinitions);
    const stats = player.weaponStats[definition.id];
    if (!startWeaponReload(player, definition, now)) return { accepted: false };
    match.updatedAt = now;
    return { accepted: true, reloadEndsAt: stats.reloadEndsAt };
  }

  updateWeaponAccuracy(player, delta, now) {
    player.weaponStats ??= createWeaponAccuracyStates(this.projectileDefinitions, now, player.inventory);
    for (const definition of this.projectileDefinitions.values()) {
      const magazineSize = getEffectiveMagazineSize(definition.magazineSize, player.inventory);
      const stats = player.weaponStats[definition.id] ??
        createWeaponAccuracyStates(this.projectileDefinitions, now, player.inventory)[definition.id];
      const switchingAwayFromWeapon = Number.isFinite(player.gadgetSwitchEndsAt) &&
        now < player.gadgetSwitchEndsAt && player.gadgetSwitchTargetSlot === 'gadget';
      if (definition.id === player.selectedWeaponId && player.equippedSlot === 'weapon' &&
          !switchingAwayFromWeapon) {
        resumeQueuedManualAction(stats, now);
      }
      if (stats.reloading && now >= stats.reloadEndsAt) {
        if (definition.reloadPerRound) {
          stats.ammo = Math.min(magazineSize, stats.ammo + 1);
          stats.reloadRoundsInserted += 1;
          const pausedForManualAction = finishReloadRound(stats, stats.ammo >= magazineSize, stats.reloadEndsAt);
          if (!pausedForManualAction && stats.ammo >= magazineSize) {
            const reloadCompletedAt = stats.reloadEndsAt;
            clearWeaponReload(stats);
            resumeQueuedManualAction(stats, reloadCompletedAt);
          } else if (!pausedForManualAction) {
            stats.reloadStartedAt = stats.reloadEndsAt;
            stats.reloadEndsAt += getReloadInterval(definition, stats.reloadRoundsInserted, player.inventory);
          }
        } else {
          const reloadCompletedAt = stats.reloadEndsAt;
          stats.ammo = magazineSize;
          clearWeaponReload(stats);
          resumeQueuedManualAction(stats, reloadCompletedAt);
        }
      }
      if (stats.manualActionEndsAt && now >= stats.manualActionEndsAt) {
        const manualActionCompletedAt = stats.manualActionEndsAt;
        clearManualAction(stats);
        resumePausedReload(stats, manualActionCompletedAt,
          getReloadInterval(definition, stats.reloadRoundsInserted ?? 0, player.inventory));
      }
      stats.accuracy = recoverAccuracy(
        stats.accuracy,
        delta,
        definition.accuracy.recoveryPerSecond,
        definition.accuracy.maxAccuracy,
      );
      const accuracySettings = getEffectiveAccuracySettings(definition.accuracy, player.inventory);
      stats.effectiveAccuracy = getEffectiveAccuracy(
        stats.accuracy,
        Math.hypot(player.vx, player.vy),
        MOVEMENT_MAX_PLAYER_SPEED,
        accuracySettings.movementPenaltyAtMaxSpeed,
      );
      player.weaponStats[definition.id] = stats;
    }
  }

  traceProjectile(match, projectile, start, end, aimAngle = Math.atan2(end.y - start.y, end.x - start.x)) {
    let firstCollision = null;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    for (const object of match.map.objects) {
      if (!segmentMapObjectBoundsOverlap(start, end, object, projectile.radius)) continue;
      const entryT = segmentMapObjectEntryT(start, end, object, projectile.radius);
      if (entryT !== null && (!firstCollision || entryT < firstCollision.t)) {
        firstCollision = { t: entryT, kind: 'surface', objectId: object.id ?? null, object };
      }
    }

    for (const effect of match.gadgetEffects ?? []) {
      const isDamageableDevice = effect.type === SPY_CAMERA_ID || effect.type === TROPHY_SYSTEM_ID;
      if (isDamageableDevice && effect.expiresAt > this.now() &&
          (!Number.isFinite(effect.health) || effect.health > 0) &&
          projectile.ownerTeam && projectile.ownerTeam !== effect.team) {
        const hitRadius = Math.max(0, effect.radius ??
          (effect.type === TROPHY_SYSTEM_ID ? TROPHY_SYSTEM_BODY_RADIUS : SPY_CAMERA_BODY_RADIUS)) +
          (projectile.radius ?? 0);
        if (effect.x < minX - hitRadius || effect.x > maxX + hitRadius ||
            effect.y < minY - hitRadius || effect.y > maxY + hitRadius) continue;
        const entryT = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y,
          effect.x, effect.y, hitRadius);
        if (entryT !== null && (!firstCollision || entryT < firstCollision.t)) {
          firstCollision = { t: entryT, kind: 'gadget', effect };
        }
        continue;
      }
      const isVineTrapBeforeActivation = effect.type === VINE_TRAP_ID && !effect.latchedEnemyId &&
        effect.expiresAt > this.now();
      const isMine = effect.type === 'mine' &&
        (!Number.isFinite(effect.expiresAt) || effect.expiresAt > this.now());
      if (!effect.triggerOnEnemyProximity ||
          (!isVineTrapBeforeActivation && !isMine) ||
          !projectile.ownerTeam || projectile.ownerTeam === effect.team) continue;
      const hitRadius = Math.max(0, effect.hitRadius ?? PROXIMITY_MINE_HIT_RADIUS) + (projectile.radius ?? 0);
      if (effect.x < minX - hitRadius || effect.x > maxX + hitRadius ||
          effect.y < minY - hitRadius || effect.y > maxY + hitRadius) continue;
      const entryT = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y,
        effect.x, effect.y, hitRadius);
      if (entryT === null || (firstCollision && entryT >= firstCollision.t)) continue;
      firstCollision = { t: entryT, kind: 'gadget', effect };
    }

    for (const player of match.players) {
      if (!player.alive || player.health <= 0 || player.id === projectile.ownerId ||
          (!projectile.friendlyFire && player.team === projectile.ownerTeam)) continue;
      const impactRadius = MOVEMENT_PLAYER_RADIUS + projectile.radius;
        if (player.x < minX - impactRadius || player.x > maxX + impactRadius ||
          player.y < minY - impactRadius || player.y > maxY + impactRadius) continue;
      const entryT = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, player.x, player.y, impactRadius);
      if (entryT === null || (firstCollision && entryT >= firstCollision.t)) continue;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const closestT = lengthSquared <= 1e-12 ? 0 : Math.max(0, Math.min(((player.x - start.x) * dx + (player.y - start.y) * dy) / lengthSquared, 1));
      const deltaX = start.x + closestT * dx - player.x;
      const deltaY = start.y + closestT * dy - player.y;
      const distanceFromCenter = Math.hypot(deltaX, deltaY);
      const travelledDistance = closestT * Math.sqrt(lengthSquared);
      const damage = getProjectileDamage(projectile, distanceFromCenter, MOVEMENT_PLAYER_RADIUS, travelledDistance);
      firstCollision = { t: entryT, kind: 'player', player, damage };
    }

    const t = firstCollision?.t ?? 1;
    const impact = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    const event = {
      id: projectile.id,
      type: projectile.type,
      ownerId: projectile.ownerId,
      start,
      end: impact,
      aimAngle,
      speed: this.projectileDefinitions.get(projectile.type).speed,
      baseDamage: projectile.damage,
      hitType: firstCollision?.kind ?? null,
      hitPlayerId: firstCollision?.kind === 'player' ? firstCollision.player.id : null,
      objectId: firstCollision?.kind === 'surface' ? firstCollision.objectId : null,
      ...(firstCollision?.kind === 'gadget' ? {
        gadgetEffectId: firstCollision.effect.id,
        gadgetId: firstCollision.effect.gadgetId,
      } : {}),
      damage: firstCollision?.kind === 'player' ? firstCollision.damage : 0,
    };

    if (firstCollision?.kind === 'gadget') {
      if (firstCollision.effect.type === TROPHY_SYSTEM_ID) {
        const damage = applyTrophySystemDamage(firstCollision.effect, projectile.damage ?? 0);
        event.gadgetHealth = damage.health;
        event.gadgetDestroyed = damage.destroyed;
        if (damage.destroyed) {
          match.gadgetEffects = (match.gadgetEffects ?? [])
            .filter((effect) => effect.id !== firstCollision.effect.id);
        }
      } else {
        match.gadgetEffects = (match.gadgetEffects ?? [])
          .filter((effect) => effect.id !== firstCollision.effect.id);
      }
    }

    if (firstCollision?.object?.role === 'destructible-prop' && Number.isFinite(firstCollision.object.health)) {
      firstCollision.object.health = Math.max(0, firstCollision.object.health - Math.max(0, projectile.damage ?? 0));
      const destroyed = firstCollision.object.health === 0;
      if (destroyed) {
        firstCollision.object.blocksMovement = false;
        firstCollision.object.blocksProjectiles = false;
        firstCollision.object.blocksVision = false;
      }
      event.objectHealth = firstCollision.object.health;
      event.objectDestroyed = destroyed;
    }

    let damageCue = null;
    if (firstCollision?.kind === 'player') {
      const victim = firstCollision.player;
      const armorDamage = Math.min(Math.max(0, victim.armor ?? 0), firstCollision.damage);
      victim.armor = Math.max(0, (victim.armor ?? 0) - armorDamage);
      const previousHealth = victim.health;
      victim.health = Math.max(0, previousHealth - (firstCollision.damage - armorDamage));
      const damageDealt = armorDamage + previousHealth - victim.health;
      if (damageDealt > 0) {
        victim.lastDamagedAt = this.now();
        damageCue = {
          id: randomUUID(),
          victimId: victim.id,
          team: victim.team,
          bearing: Math.atan2(start.y - victim.y, start.x - victim.x),
          expiresAt: this.now() + 1_300,
          damage: damageDealt,
        };
      }
      if (damageDealt > 0 && projectile.ownerTeam !== victim.team) {
        match.damageContributions ??= {};
        const contributions = match.damageContributions[victim.id] ??= {};
        contributions[projectile.ownerId] = (contributions[projectile.ownerId] ?? 0) + damageDealt;
      }
      if (victim.health <= 0) this.markPlayerDead(match, victim, projectile.ownerId);
    }
    return { event, damageCue };
  }

  updatePlayerArmorRegeneration(player, delta, now) {
    regeneratePlayerArmor(player, delta, now);
  }

  markPlayerDead(match, player, killerId = null) {
    if (!player.alive) return;
    player.stats ??= { kills: 0, assists: 0, deaths: 0 };
    player.stats.deaths += 1;
    const contributions = match.damageContributions?.[player.id] ?? {};
    player.deathAttribution = awardKillAndAssists(match.players, player, killerId, contributions);
    if (match.damageContributions) delete match.damageContributions[player.id];
    player.health = 0;
    player.alive = false;
    player.isSpectator = true;
    player.vx = 0;
    player.vy = 0;
    player.weaponLean = 0;
    player.input = { ...EMPTY_INPUT };
    if (player.isBot && player.controlledById) {
      player.controlledById = null;
      player.controlRevision = (player.controlRevision ?? 0) + 1;
    }
    const room = [...this.rooms.values()].find((entry) => entry.match === match);
    for (const bot of match.players) {
      if (!bot.isBot || bot.controlledById !== player.id) continue;
      bot.controlledById = null;
      bot.controlRevision = (bot.controlRevision ?? 0) + 1;
      bot.input = { ...EMPTY_INPUT };
      const actor = room?.botActors?.get(bot.id);
      if (actor) {
        bot.lastInputSequence = actor.roomInputSequence;
        actor.roomInput = { ...EMPTY_INPUT };
        actor.roomInputAt = this.now();
      }
    }
    if (match.flag.heldBy === player.id) {
      match.flag.heldBy = null;
      match.flag.x = player.x;
      match.flag.y = player.y;
      match.flag.dropped = true;
      match.flag.lastDroppedBy = null;
    }
  }

  isValidInput(input) {
    return input !== null && typeof input === 'object' &&
      ['up', 'down', 'left', 'right'].every((direction) => typeof input[direction] === 'boolean') &&
      (input.drop === undefined || typeof input.drop === 'boolean') &&
      (input.weaponLean === undefined || input.weaponLean === -1 || input.weaponLean === 0 || input.weaponLean === 1) &&
      (input.speedScale === undefined || (Number.isFinite(input.speedScale) && input.speedScale >= 0.5 && input.speedScale <= 1)) &&
      (input.visionAngle === undefined || (Number.isFinite(input.visionAngle) && input.visionAngle >= -Math.PI && input.visionAngle <= Math.PI));
  }

  finishMatch(client) {
    const room = this.requireClientRoom(client);
    if (room.quickPlay) {
      const modeLabel = SERIES_MODE_RULES[room.gameMode]?.label ?? 'Series';
      const progressLabel = room.gameMode === 'quickplay' ? 'round' : 'series';
      throw new RoomManagerError(`${modeLabel} ${progressLabel} progress is automatic.`);
    }
    if (!room.match) return this.toRoomState(room);
    if (!room.match.victory) {
      const message = this.now() < room.match.endsAt ? 'The match timer has not expired.' : 'The match outcome is not ready yet.';
      throw new RoomManagerError(message);
    }
    this.prepareCustomIntermission(room);
    return this.toRoomState(room);
  }

  getHost(room) {
    return [...room.clients].find((client) => client.id === room.hostId) ?? null;
  }

  electHost(room) {
    const nextHost = [...room.clients]
      .filter((client) => client.connected !== false)
      .sort((left, right) => left.joinedAt - right.joinedAt || left.joinOrder - right.joinOrder)[0] ?? null;
    const nextHostId = nextHost?.id ?? null;
    if (room.hostId === nextHostId) return false;
    room.hostId = nextHostId;
    room.authorityEpoch = (room.authorityEpoch ?? 0) + 1;
    room.lastHostMotionFrame = 0;
    return true;
  }

  addClient(room, client, team, displayName = null, squadId = null) {
    client.id ??= randomUUID();
    delete client.playerColor;
    delete client.avatarDataUrl;
    client.joinedAt = this.now();
    client.joinOrder = this.nextJoinOrder++;
    client.playerName = displayName ?? `Player ${room.nextPlayerNumber++}`;
    client.team = team;
    if (!room.quickPlay && room.customSeriesState?.rolesBySquad) {
      client.customSquadId = Object.entries(room.customSeriesState.rolesBySquad)
        .find(([, role]) => role === team)?.[0] ?? null;
    }
    client.inventory = isProgressionShop(room)
      ? normalizeItemInventory(client.inventory ?? createEmptyItemInventory())
      : createDefaultMatchItemInventory();
    client.squadId = room.quickPlay ? squadId ?? getQuickPlaySquadForTeam(room, team) : null;
    client.selectedGadgetId ??= null;
    client.gadgetCount ??= 0;
    client.gadgetCounts ??= createGadgetCounts(client.selectedGadgetId, client.gadgetCount);
    client.gadgetShopOfferIds ??= [];
    client.uniqueGadgetShopOfferIds ??= [];
    client.uniqueGadgetShopCount ??= 0;
    if (isProgressionShop(room)) {
      client.inventoryWeaponIds ??= [LONG_PLAY_STARTER_WEAPON_ID];
      client.selectedWeaponId ??= LONG_PLAY_STARTER_WEAPON_ID;
      client.weaponShopOfferIds ??= [];
      client.itemShopOfferIds ??= [];
      client.gadgetShopOfferIds ??= [];
      client.shopPicksRemaining ??= 0;
      client.weaponShopResolved ??= false;
    } else {
      client.selectedWeaponId ??= this.defaultProjectileType;
    }
    client.roomInput = { ...EMPTY_INPUT };
    client.roomInputSequence = 0;
    client.roomInputAt = this.now();
    room.clients.add(client);
    client.room = room;
    if (room.hostId === null || room.hostId === undefined) this.electHost(room);

    if (room.quickPlay && room.quickPlayState?.phase === 'lobby') {
      room.quickPlayState.ready[client.id] = false;
    }

    if (room.postGame) {
      room.postGame.choices[client.id] = 'waiting';
      if (room.match) room.match.postGame = room.postGame;
    }

    if (room.match && team !== null && !room.quickPlay) this.addMatchPlayer(room, client);
  }

  addMatchPlayer(room, client) {
    const teamIndex = room.match.players.filter((player) => player.team === client.team).length;
    room.match.players.push({
      id: client.id,
      name: client.playerName,
      team: client.team,
      ...getTeamSpawn(room.match.map, client.team, teamIndex),
      vx: 0,
      vy: 0,
      health: PLAYER_MAX_HEALTH,
      armor: getInventoryEffects(client.inventory).armor,
      maxArmor: getInventoryEffects(client.inventory).armor,
      lastDamagedAt: this.now(),
      stats: { kills: 0, assists: 0, deaths: 0 },
      alive: true,
      isSpectator: false,
      weaponLean: 0,
      visionAngle: 0,
      selectedWeaponId: client.selectedWeaponId ?? this.defaultProjectileType,
      selectedGadgetId: client.selectedGadgetId ?? null,
      loadoutRevision: client.loadoutRevision ?? 0,
      gadgetCount: client.gadgetCount ?? 0,
      gadgetCounts: structuredClone(client.gadgetCounts ?? createGadgetCounts(client.selectedGadgetId, client.gadgetCount ?? 0)),
      uniqueGadgetShopOfferIds: [...(client.uniqueGadgetShopOfferIds ?? [])],
      inventory: normalizeItemInventory(client.inventory),
      weaponStats: createWeaponAccuracyStates(this.projectileDefinitions, this.now(), client.inventory),
      lastInputSequence: 0,
      input: { ...EMPTY_INPUT },
    });
    room.match.teamRoster[client.team] += 1;
    room.match.updatedAt = this.now();
  }

  syncMatchPlayerTeam(room, client) {
    if (!room.match) return;
    const matchPlayer = room.match.players.find((player) => player.id === client.id);
    if (matchPlayer) {
      matchPlayer.team = client.team;
    } else {
      client.roomInput = { ...EMPTY_INPUT };
      client.roomInputAt = this.now();
      this.addMatchPlayer(room, client);
    }
  }

  requireClientRoom(client) {
    const internalBot = Boolean(client?.[BOT_ACTOR] && client.room?.botActors?.get(client.id) === client);
    if (!internalBot) this.assertClientConnected(client);
    if (!client.room || (!client.room.clients.has(client) && !internalBot)) {
      throw new RoomManagerError('Join a room before performing that action.');
    }
    return client.room;
  }

  ensureClientId(client) {
    client.id ??= randomUUID();
  }

  selectWeapon(client, { weaponId } = {}) {
    const room = this.requireClientRoom(client);
    if (room.customGameRules?.buyPhase === 'none') {
      throw new RoomManagerError('Weapon selection is disabled for this custom match.');
    }
    const definition = this.projectileDefinitions.get(weaponId);
    if (!definition) throw new RoomManagerError('That weapon is not available.');
    const now = this.now();
    if (!room.match || room.match.victory || now >= room.match.gameplayStartsAt) {
      throw new RoomManagerError('Weapons can only be selected during the pre-game countdown.');
    }
    const player = room.match?.players.find((entry) => entry.id === client.id);
    if (isProgressionShop(room)) {
      if ((client.shopPicksRemaining ?? 0) <= 0 || !(client.weaponShopOfferIds ?? []).includes(definition.id)) {
        throw new RoomManagerError('That weapon is not in your shop.');
      }
      client.inventoryWeaponIds = [definition.id];
      this.consumeLongPlayShopPick(client, { kind: 'weapon', id: definition.id });
    }
    client.selectedWeaponId = definition.id;
    if (player) {
      player.selectedWeaponId = definition.id;
      if (isProgressionShop(room)) {
        player.inventoryWeaponIds = [...client.inventoryWeaponIds];
        player.weaponShopOfferIds = [...client.weaponShopOfferIds];
        player.itemShopOfferIds = structuredClone(client.itemShopOfferIds);
        player.gadgetShopOfferIds = [...client.gadgetShopOfferIds];
        player.shopPicksRemaining = client.shopPicksRemaining;
        player.weaponShopResolved = client.weaponShopResolved === true;
        player.inventory = normalizeItemInventory(client.inventory);
      }
    }
    this.incrementLoadoutRevision(client, player);
    client.nextProjectileAt = 0;
    return this.toRoomState(room);
  }

  selectGadget(client, { gadgetId } = {}) {
    const room = this.requireClientRoom(client);
    if (room.customGameRules?.buyPhase === 'none') {
      throw new RoomManagerError('Gadget selection is disabled for this custom match.');
    }
    const now = this.now();
    const gadgetDefinition = GADGET_DEFINITIONS[gadgetId];
    if (!gadgetDefinition) throw new RoomManagerError('That gadget is not available.');
    if (!room.match || room.match.victory || now >= room.match.gameplayStartsAt) {
      throw new RoomManagerError('Gadgets can only be selected during the pre-game countdown.');
    }
    const availableInLoadoutShop = isUniqueGadgetAvailableInLoadoutShop(gadgetDefinition, room);
    if (isUniqueGadgetDefinition(gadgetDefinition) && !availableInLoadoutShop &&
        !(client.uniqueGadgetShopOfferIds ?? []).includes(gadgetId)) {
      throw new RoomManagerError('That unique gadget is not in your shop.');
    }
    if (isProgressionShop(room)) {
      if ((client.shopPicksRemaining ?? 0) <= 0 || !(client.gadgetShopOfferIds ?? []).includes(gadgetId)) {
        throw new RoomManagerError('That gadget is not in your shop.');
      }
      this.consumeLongPlayShopPick(client, { kind: 'gadget', id: gadgetId });
      if (isUniqueGadgetDefinition(gadgetDefinition)) {
        client.uniqueGadgetShopOfferIds = client.uniqueGadgetShopOfferIds.filter((id) => id !== gadgetId);
      }
    }
    client.selectedGadgetId = gadgetId;
    client.gadgetCount = getGadgetStartingChargeCount(gadgetId);
    client.gadgetCounts = createGadgetCounts(gadgetId, client.gadgetCount);
    const player = room.match.players.find((entry) => entry.id === client.id);
    if (player) {
      player.selectedGadgetId = gadgetId;
      player.gadgetCount = getGadgetStartingChargeCount(gadgetId);
      player.gadgetCounts = createGadgetCounts(gadgetId, player.gadgetCount);
      if (isProgressionShop(room)) {
        player.weaponShopOfferIds = [...client.weaponShopOfferIds];
        player.itemShopOfferIds = structuredClone(client.itemShopOfferIds);
        player.gadgetShopOfferIds = [...client.gadgetShopOfferIds];
        player.shopPicksRemaining = client.shopPicksRemaining;
        player.weaponShopResolved = client.weaponShopResolved === true;
        player.uniqueGadgetShopOfferIds = [...(client.uniqueGadgetShopOfferIds ?? [])];
      }
    }
    this.incrementLoadoutRevision(client, player);
    return this.toRoomState(room);
  }

  selectShopItem(client, { itemId, level, kind } = {}) {
    const room = this.requireClientRoom(client);
    if (!isProgressionShop(room)) {
      throw new RoomManagerError('Perks and armor upgrades are only available in Quick Play or Long Play.');
    }
    const now = this.now();
    if (!room.match || room.match.victory || now >= room.match.gameplayStartsAt) {
      throw new RoomManagerError('Items can only be selected during the pre-game shop.');
    }
    const player = room.match.players.find((entry) => entry.id === client.id);
    const offer = (client.itemShopOfferIds ?? []).find((item) =>
      item.id === itemId && item.level === level && item.kind === kind);
    if (!offer || (client.shopPicksRemaining ?? 0) <= 0) throw new RoomManagerError('That item is not in your shop.');
    const levelDefinition = getItemLevelDefinition(itemId, level);
    if (!levelDefinition) throw new RoomManagerError('That item level is not available.');

    const inventory = normalizeItemInventory(client.inventory);
    if (kind === 'armor' && itemId === 'armor') {
      const expectedLevel = (inventory.armor?.level ?? 0) + 1;
      if (level !== expectedLevel || level > 3) throw new RoomManagerError('That armor upgrade is not available.');
      inventory.armor = { id: itemId, name: levelDefinition.name, level };
    } else if (kind === 'perk') {
      const current = inventory.perks.find((item) => item.id === itemId);
      const expectedLevel = (current?.level ?? 0) + 1;
      if (level !== expectedLevel || level > 2) throw new RoomManagerError('That perk upgrade is not available.');
      inventory.perks = inventory.perks.filter((item) => item.id !== itemId);
      inventory.perks.push({ id: itemId, name: levelDefinition.name, level });
    } else {
      throw new RoomManagerError('That item type is not available.');
    }

    client.inventory = normalizeItemInventory(inventory);
    if (isProgressionShop(room)) {
      this.consumeLongPlayShopPick(client, offer);
    } else {
      client.itemShopOfferIds = (client.itemShopOfferIds ?? []).filter((item) =>
        !(item.kind === offer.kind && item.id === offer.id && item.level === offer.level));
      client.shopPicksRemaining = Math.max(0, (client.shopPicksRemaining ?? 0) - 1);
      client.itemShopResolved = client.shopPicksRemaining === 0;
      if (client.itemShopResolved) client.itemShopOfferIds = [];
    }
    if (player) {
      player.inventory = normalizeItemInventory(client.inventory);
      player.itemShopOfferIds = structuredClone(client.itemShopOfferIds ?? []);
      player.shopPicksRemaining = client.shopPicksRemaining ?? 0;
      player.itemShopResolved = client.itemShopResolved === true;
      if (isProgressionShop(room)) {
        player.weaponShopResolved = client.weaponShopResolved;
        player.weaponShopOfferIds = [...client.weaponShopOfferIds];
      }
      player.itemShopOfferIds = structuredClone(client.itemShopOfferIds);
      player.gadgetShopOfferIds = [...client.gadgetShopOfferIds];
      player.shopPicksRemaining = client.shopPicksRemaining;
      const effects = getInventoryEffects(player.inventory);
      player.maxArmor = effects.armor;
      player.armor = effects.armor;
      for (const definition of this.projectileDefinitions.values()) {
        const stats = player.weaponStats?.[definition.id];
        if (stats) stats.ammo = getEffectiveMagazineSize(definition.magazineSize, player.inventory) ?? null;
      }
    }
    this.incrementLoadoutRevision(client, player);
    return this.toRoomState(room);
  }

  incrementLoadoutRevision(client, player) {
    const revision = Math.max(client.loadoutRevision ?? 0, player?.loadoutRevision ?? 0) + 1;
    client.loadoutRevision = revision;
    if (player) player.loadoutRevision = revision;
  }

  consumeLongPlayShopPick(client, offer) {
    client.weaponShopOfferIds = (client.weaponShopOfferIds ?? []).filter((id) =>
      !(offer.kind === 'weapon' && id === offer.id));
    client.itemShopOfferIds = (client.itemShopOfferIds ?? []).filter((item) =>
      !(offer.kind !== 'weapon' && item.kind === offer.kind && item.id === offer.id && item.level === offer.level));
    client.gadgetShopOfferIds = (client.gadgetShopOfferIds ?? []).filter((id) =>
      !(offer.kind === 'gadget' && id === offer.id));
    client.shopPicksRemaining = Math.max(0, (client.shopPicksRemaining ?? 0) - 1);
    client.weaponShopResolved = client.shopPicksRemaining === 0 ||
      !(client.weaponShopOfferIds.length + client.itemShopOfferIds.length + client.gadgetShopOfferIds.length);
    if (client.weaponShopResolved) {
      client.weaponShopOfferIds = [];
      client.itemShopOfferIds = [];
      client.gadgetShopOfferIds = [];
    }
  }

  skipWeaponShop(client) {
    const room = this.requireClientRoom(client);
    const now = this.now();
    if (!isProgressionShop(room) || !room.match || room.match.victory ||
        now >= room.match.gameplayStartsAt) {
      throw new RoomManagerError('The Quick Play or Long Play shop can only be skipped during its pre-game countdown.');
    }
    client.weaponShopResolved = true;
    if (room.customGameRules?.carryOverShopPicks === false && !room.quickPlay) {
      client.shopPicksRemaining = 0;
    }
    client.weaponShopOfferIds = [];
    client.itemShopOfferIds = [];
    client.gadgetShopOfferIds = [];
    const player = room.match.players.find((entry) => entry.id === client.id);
    if (player) {
      player.weaponShopResolved = true;
      player.shopPicksRemaining = client.shopPicksRemaining;
      player.weaponShopOfferIds = [];
      player.itemShopOfferIds = [];
      player.gadgetShopOfferIds = [];
    }
    this.incrementLoadoutRevision(client, player);
    return this.toRoomState(room);
  }

  toRoomState(room) {
    const botRoster = room.botRoster ?? { red: [], blue: [] };
    const quickPlayBots = room.quickPlayBotRoster ?? [];
    const visibleBotRoster = room.quickPlay
      ? quickPlayBots
      : [...botRoster.red, ...botRoster.blue];
    let match = room.match ? clonePublicMatch(room.match) : null;
    const frame = room.latestHostFrame;
    if (match && frame?.matchId === match.startedAt && frame.snapshot) {
      const objective = frame.objectives.find((entry) => entry.id === 'flag');
      const preGame = !room.match.victory && this.now() < room.match.gameplayStartsAt;
      const serverPlayers = new Map(room.match.players.map((player) => [player.id, player]));
      const frameActorIds = new Set(frame.actors.map((actor) => actor.id));
      match = {
        ...match,
        ...structuredClone(frame.snapshot),
        players: [
          ...frame.actors.map(({ id, state }) => {
            const copiedState = structuredClone(state);
            const serverPlayer = serverPlayers.get(id);
            const staleLoadout = serverPlayer &&
              (copiedState.loadoutRevision ?? 0) < (serverPlayer.loadoutRevision ?? 0);
            const roomStatePlayer = serverPlayer && (preGame || staleLoadout)
              ? preservePreGameLoadout(copiedState, serverPlayer)
              : copiedState;
            if (serverPlayer?.isBot) {
              roomStatePlayer.controlledById = serverPlayer.controlledById ?? null;
              roomStatePlayer.controlRevision = serverPlayer.controlRevision ?? 0;
            }
            return roomStatePlayer;
          }),
          ...room.match.players.filter((player) => !frameActorIds.has(player.id))
            .map((player) => structuredClone(player)),
        ],
        flag: structuredClone(objective?.state ?? match.flag),
        map: structuredClone(frame.snapshot.map ?? room.hostMap ?? match.map),
        destructibleObjects: structuredClone(frame.snapshot.destructibleObjects ?? match.destructibleObjects ?? []),
      };
    }
    return {
      name: room.name,
      locked: room.passwordHash !== null,
      quickPlay: room.quickPlay === true,
      gameMode: room.gameMode ?? (room.quickPlay ? 'quickplay' : 'custom'),
      gameModeLabel: room.quickPlay ? (SERIES_MODE_RULES[room.gameMode]?.label ?? 'Practice') : null,
      simulation: {
        mode: room.simulationMode ?? 'server-authoritative',
        authorityId: room.hostId,
        epoch: room.authorityEpoch ?? 0,
      },
      authorityFrame: frame ? structuredClone(frame) : null,
      quickPlayStartedAt: room.quickPlayStartedAt ?? null,
      quickPlayAutoStartAt: room.quickPlayAutoStartAt ?? null,
      quickPlayMapGenerationPending: Boolean(room.quickPlay && !room.quickPlayMap &&
        ['lobby', 'round-result'].includes(room.quickPlayState?.phase)),
      quickPlayState: room.quickPlayState ? structuredClone(room.quickPlayState) : null,
      quickPlaySquadRoles: room.quickPlay ? { ...room.quickPlayRoleBySquad } : null,
      quickPlaySquadScore: room.quickPlay ? { ...room.quickPlayScoreBySquad } : null,
      quickPlaySidesSwapped: room.quickPlay ? room.quickPlaySidesSwapped : null,
      mapGenerationPending: room.quickPlay ? false : room.mapGenerationPending === true,
      mapReady: room.quickPlay ? Boolean(room.quickPlayMap) : room.simulationMode === 'host-authoritative'
        ? Boolean(room.preparedMap || (room.customGameRules?.mapMode === 'same' && room.customSeriesMap))
        : !room.mapGenerationPending && room.mapGenerationMode !== 'host-choice',
      mapGenerationMode: room.mapGenerationMode ?? 'competitive',
      mapGenerationRevision: room.mapGenerationRevision ?? 0,
      mapGenerationCount: room.mapGenerationCount ?? 0,
      mapGenerationError: room.quickPlay ? null : room.mapGenerationError ?? null,
      seed: room.quickPlay ? null : room.mapSeed,
      mapOptions: room.quickPlay ? null : { ...room.mapOptions },
      customGameRules: room.quickPlay ? null : structuredClone(room.customGameRules ?? DEFAULT_CUSTOM_GAME_RULES),
      customSeriesState: room.quickPlay ? null : room.customSeriesState ? structuredClone(room.customSeriesState) : null,
      postGame: room.postGame ? structuredClone(room.postGame) : null,
      hostId: room.hostId,
      hostName: this.getHost(room)?.playerName ?? 'Unknown player',
      players: [...room.clients].map((client) => ({
        id: client.id,
        name: client.playerName,
        team: client.team,
        connected: client.connected !== false,
        ...(room.quickPlay ? { squadId: client.squadId } : {}),
        selectedWeaponId: client.selectedWeaponId ?? this.defaultProjectileType,
        selectedGadgetId: client.selectedGadgetId ?? null,
        gadgetCount: client.gadgetCount ?? 0,
        gadgetCounts: structuredClone(client.gadgetCounts ?? createGadgetCounts(client.selectedGadgetId, client.gadgetCount ?? 0)),
        uniqueGadgetShopOfferIds: [...(client.uniqueGadgetShopOfferIds ?? [])],
        inventory: normalizeItemInventory(client.inventory),
        itemShopOfferIds: structuredClone(client.itemShopOfferIds ?? []),
        shopPicksRemaining: client.shopPicksRemaining ?? 0,
        itemShopResolved: client.itemShopResolved === true,
        ...(isProgressionShop(room) ? {
          inventoryWeaponIds: [...(client.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID])],
          weaponShopOfferIds: [...(client.weaponShopOfferIds ?? [])],
          itemShopOfferIds: structuredClone(client.itemShopOfferIds ?? []),
          gadgetShopOfferIds: [...(client.gadgetShopOfferIds ?? [])],
          shopPicksRemaining: client.shopPicksRemaining ?? 0,
          weaponShopResolved: client.weaponShopResolved === true,
        } : {}),
      })),
      bots: {
        counts: {
          red: visibleBotRoster.filter((bot) => bot.team === 'red').length,
          blue: visibleBotRoster.filter((bot) => bot.team === 'blue').length,
        },
        roster: visibleBotRoster.map((bot) => ({ ...bot })),
        catalog: BOT_PERSONALITIES.map((bot) => ({ ...bot, parameters: { ...bot.parameters } })),
      },
      match,
    };
  }

  resetQuickPlayLobby(room, now = this.now()) {
    if (!room.quickPlay) return;
    room.mapGenerationRevision = (room.mapGenerationRevision ?? 0) + 1;
    const modeRules = SERIES_MODE_RULES[room.gameMode] ?? SERIES_MODE_RULES.quickplay;
    room.quickPlayBotRoster = [];
    if (LONG_PLAY_SHOP_MODES.has(room.gameMode)) {
      for (const client of room.clients) {
        client.inventoryWeaponIds = [LONG_PLAY_STARTER_WEAPON_ID];
        client.selectedWeaponId = LONG_PLAY_STARTER_WEAPON_ID;
        client.selectedGadgetId = null;
        client.gadgetCount = 0;
        client.gadgetCounts = createGadgetCounts();
        client.weaponShopOfferIds = [];
        client.itemShopOfferIds = [];
        client.gadgetShopOfferIds = [];
        client.shopPicksRemaining = 0;
        client.weaponShopResolved = false;
        client.inventory = createEmptyItemInventory();
      }
    }
    for (const client of room.clients) {
      client.uniqueGadgetShopOfferIds = [];
      client.uniqueGadgetShopCount = 0;
    }
    room.quickPlayStartedAt = now;
    room.quickPlayAutoStartAt = null;
    room.quickPlayMap = null;
    room.quickPlayMapPromise = null;
    room.quickPlayMapFallbackRequested = false;
    room.requestQuickPlayMapFallback = null;
    room.quickPlayState = {
      gameMode: room.gameMode,
      winsToWin: modeRules.winsToWin,
      roleSwapEvery: modeRules.roleSwapEvery,
      phase: 'lobby',
      round: 0,
      score: { red: 0, blue: 0 },
      squadScore: { A: 0, B: 0 },
      rolesBySquad: { ...room.quickPlayRoleBySquad },
      sidesSwapped: room.quickPlaySidesSwapped,
      mapGenerationRevision: room.mapGenerationRevision,
      ready: Object.fromEntries([...room.clients].map((member) => [member.id, false])),
      phaseEndsAt: null,
      lastResult: null,
      winner: null,
      winnerSquadId: null,
    };
    room.quickPlayScoreBySquad = { A: 0, B: 0 };
    this.prepareQuickPlayMap(room);
  }

  createQuickPlayBotRoster(clients, room) {
    const roster = [...(room.quickPlayBotRoster ?? [])];
    const existingIds = new Set(roster.map((bot) => bot.id));
    const availablePersonalities = BOT_PERSONALITIES
      .filter((bot) => !existingIds.has(bot.id))
      .map((bot) => ({ ...bot, parameters: { ...bot.parameters } }));
    for (let index = availablePersonalities.length - 1; index > 0; index -= 1) {
      const swapIndex = randomInt(index + 1);
      [availablePersonalities[index], availablePersonalities[swapIndex]] =
        [availablePersonalities[swapIndex], availablePersonalities[index]];
    }
    for (const squadId of ['A', 'B']) {
      const team = room.quickPlayRoleBySquad[squadId];
      const humanCount = clients.filter((client) => client.squadId === squadId).length;
      const vacancies = Math.max(0, TEAM_CAPACITY - humanCount);
      const squadBots = roster.filter((bot) => bot.squadId === squadId);
      for (const excessBot of squadBots.slice(vacancies)) {
        roster.splice(roster.indexOf(excessBot), 1);
      }
      for (const bot of squadBots.slice(0, vacancies)) bot.team = team;
      for (let index = squadBots.length; index < vacancies; index += 1) {
        const personality = availablePersonalities.pop();
        if (!personality) break;
        roster.push({
          ...personality,
          team,
          squadId,
          ...(LONG_PLAY_SHOP_MODES.has(room.gameMode) ? {
            inventoryWeaponIds: [LONG_PLAY_STARTER_WEAPON_ID],
            selectedWeaponId: LONG_PLAY_STARTER_WEAPON_ID,
            gadgetPreferenceOrder: this.createBotGadgetPreferenceOrder(),
            weaponShopOfferIds: [],
            itemShopOfferIds: [],
            gadgetShopOfferIds: [],
            selectedGadgetId: null,
            gadgetCount: 0,
            gadgetCounts: createGadgetCounts(),
            shopPicksRemaining: 0,
            weaponShopResolved: false,
            inventory: createEmptyItemInventory(),
          } : {}),
        });
      }
    }
    const rerollPracticeLoadouts = room.gameMode === 'quickplay' && (room.quickPlayState?.round ?? 0) > 0;
    const weapons = rerollPracticeLoadouts ? [...this.projectileDefinitions.values()] : null;
    for (const bot of roster) {
      bot.team = room.quickPlayRoleBySquad[bot.squadId];
      if (rerollPracticeLoadouts) {
        bot.selectedWeaponId = chooseBotLoadoutWeaponId(weapons, this.random) ?? this.defaultProjectileType;
        bot.selectedGadgetId = chooseBotLoadoutGadgetId(BOT_GADGETS, this.random) ?? SMOKE_GRENADE_ID;
      }
    }
    return roster;
  }

  createBotGadgetPreferenceOrder() {
    const preferenceOrder = [...STANDARD_GADGET_IDS];
    for (let index = preferenceOrder.length - 1; index > 0; index -= 1) {
      const randomValue = this.random();
      const swapIndex = Number.isFinite(randomValue)
        ? Math.max(0, Math.min(index, Math.floor(randomValue * (index + 1))))
        : 0;
      [preferenceOrder[index], preferenceOrder[swapIndex]] =
        [preferenceOrder[swapIndex], preferenceOrder[index]];
    }
    return preferenceOrder;
  }

  prepareUniqueGadgetShopOffers(player, customRules = null) {
    const shopCount = (Number.isInteger(player.uniqueGadgetShopCount) && player.uniqueGadgetShopCount > 0
      ? player.uniqueGadgetShopCount : 0) + 1;
    const chanceOptions = customRules ? {
      initialChance: customRules.uniqueGadgetInitialChancePercent / 100,
      increment: customRules.uniqueGadgetChanceIncrementPercent / 100,
      maxChance: customRules.uniqueGadgetMaxChancePercent / 100,
    } : undefined;
    player.uniqueGadgetShopCount = shopCount;
    const uniqueGadgetId = chooseUniqueGadgetOffer(
      GADGET_DEFINITIONS,
      shopCount,
      this.random,
      player.selectedGadgetId ? [player.selectedGadgetId] : [],
      chanceOptions,
    );
    player.uniqueGadgetShopOfferIds = uniqueGadgetId ? [uniqueGadgetId] : [];
    return uniqueGadgetId;
  }

  prepareLongPlayShop(
    player,
    round,
    includeItems = true,
    { allowUnique = true, customRules = null } = {},
  ) {
    if (!allowUnique && isUniqueGadgetDefinition(GADGET_DEFINITIONS[player.selectedGadgetId])) {
      player.selectedGadgetId = null;
      player.gadgetCount = 0;
      player.gadgetCounts = createGadgetCounts();
    }
    player.inventory = normalizeItemInventory(player.inventory ?? createEmptyItemInventory());
    player.inventoryWeaponIds ??= [LONG_PLAY_STARTER_WEAPON_ID];
    player.selectedWeaponId ??= player.inventoryWeaponIds[0] ?? LONG_PLAY_STARTER_WEAPON_ID;
    player.inventoryWeaponIds = [player.selectedWeaponId];
    player.gadgetCount ??= 0;
    player.gadgetCounts ??= createGadgetCounts(player.selectedGadgetId, player.gadgetCount);
    if (GADGET_DEFINITIONS[player.selectedGadgetId]) {
      player.gadgetCount = getGadgetStartingChargeCount(player.selectedGadgetId);
      player.gadgetCounts = createGadgetCounts(player.selectedGadgetId, player.gadgetCount);
    } else {
      player.selectedGadgetId = null;
      player.gadgetCount = 0;
      player.gadgetCounts = createGadgetCounts();
    }
    const owned = new Set(player.inventoryWeaponIds);
    const progressionRound = customRules?.shopProgression === 'fixed' ? 100 : round;
    const weaponOffers = LONG_PLAY_SHOP_WEAPON_IDS
      .filter((id) => this.projectileDefinitions.has(id) && !owned.has(id))
      .filter((id) => {
        const shopValue = this.projectileDefinitions.get(id)?.shopValue;
        if (customRules?.shopProgression !== 'fixed' && round < getMinimumWeaponShopMatch(shopValue)) return false;
        if (customRules?.shopProgression === 'fixed') return true;
        if (round === 1) return LONG_PLAY_FIRST_ROUND_WEAPON_IDS.has(id);
        return round === 2 || !LONG_PLAY_FIRST_ROUND_WEAPON_IDS.has(id);
      })
      .map((id) => ({ kind: 'weapon', id }));
    const nextItems = includeItems ? getNextItemShopOffers(player.inventory) : [];
    const offerCount = round === 1
      ? customRules?.firstShopOffers ?? LONG_PLAY_FIRST_SHOP_OFFER_COUNT
      : customRules?.laterShopOffers ?? LONG_PLAY_LATER_SHOP_OFFER_COUNT;
    const armorOffers = nextItems.filter((offer) => offer.kind === 'armor');
    const perkOffers = nextItems.filter((offer) => offer.kind === 'perk');
    const weaponSlotCount = this.random() < 0.5 ? 1 : 2;
    const uniqueGadgetOfferId = allowUnique
      ? this.prepareUniqueGadgetShopOffers(player, customRules) : null;
    if (!allowUnique) player.uniqueGadgetShopOfferIds = [];
    const gadgetOffers = STANDARD_GADGET_IDS
      .filter((id) => id !== player.selectedGadgetId)
      .map((id) => ({ kind: 'gadget', id }));
    const selectedGadgets = uniqueGadgetOfferId
      ? [{ kind: 'gadget', id: uniqueGadgetOfferId }]
      : [gadgetOffers[Math.min(gadgetOffers.length - 1,
        Math.floor(this.random() * gadgetOffers.length))]];
    const selectedArmor = this.drawWeightedLongPlayOffers(armorOffers, round).slice(0, 1);
    const selectedWeapons = this.drawWeightedLongPlayOffers(weaponOffers, progressionRound).slice(0, weaponSlotCount);
    const perkSlotCount = Math.max(0,
      offerCount - selectedArmor.length - selectedGadgets.length - selectedWeapons.length);
    const selectedPerks = this.drawWeightedLongPlayOffers(perkOffers, round).slice(0, perkSlotCount);
    const offers = [...selectedArmor, ...selectedGadgets, ...selectedWeapons, ...selectedPerks];
    if (offers.length < offerCount) {
      const selectedKeys = new Set(offers.map((offer) => `${offer.kind}:${offer.id}:${offer.level ?? ''}`));
      const remainingOffers = [...weaponOffers, ...armorOffers, ...perkOffers, ...gadgetOffers]
        .filter((offer) => !selectedKeys.has(`${offer.kind}:${offer.id}:${offer.level ?? ''}`));
      offers.push(...this.drawWeightedLongPlayOffers(remainingOffers, round).slice(0, offerCount - offers.length));
    }
    for (let index = offers.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.min(index, Math.floor(this.random() * (index + 1)));
      [offers[index], offers[swapIndex]] = [offers[swapIndex], offers[index]];
    }
    player.weaponShopOfferIds = offers.filter((offer) => offer.kind === 'weapon').map((offer) => offer.id);
    player.itemShopOfferIds = offers.filter((offer) => offer.kind !== 'weapon');
    player.itemShopOfferIds = player.itemShopOfferIds.filter((offer) => offer.kind !== 'gadget');
    player.gadgetShopOfferIds = offers.filter((offer) => offer.kind === 'gadget').map((offer) => offer.id);
    const carriedPicks = round > 1 && customRules?.carryOverShopPicks !== false
      ? player.shopPicksRemaining ?? 0 : 0;
    player.shopPicksRemaining = carriedPicks + Math.min(
      offers.length,
      round === 1
        ? customRules?.firstShopPicks ?? LONG_PLAY_FIRST_SHOP_PICK_COUNT
        : customRules?.laterShopPicks ?? LONG_PLAY_LATER_SHOP_PICK_COUNT,
    );
    player.weaponShopResolved = player.shopPicksRemaining === 0;
  }

  drawWeightedLongPlayOffers(offers, round) {
    const pool = offers.map((offer) => {
      if (offer.kind !== 'weapon') {
        return { offer, weight: offer.kind === 'armor' ? 1.15 : 1 };
      }
      const definition = this.projectileDefinitions.get(offer.id);
      return { offer, weight: getWeaponShopOfferWeight(definition?.shopValue, round) };
    });
    const result = [];
    while (pool.length) {
      const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
      let choice = this.random() * totalWeight;
      let selectedIndex = pool.length - 1;
      for (let index = 0; index < pool.length; index += 1) {
        choice -= pool[index].weight;
        if (choice < 0) {
          selectedIndex = index;
          break;
        }
      }
      result.push(pool.splice(selectedIndex, 1)[0].offer);
    }
    return result;
  }

  chooseLongPlayBotShopOffers(bot) {
    let availableOffers = [
      ...(bot.itemShopOfferIds ?? []),
      ...(bot.weaponShopOfferIds ?? []).map((id) => ({ kind: 'weapon', id })),
      ...(bot.gadgetShopOfferIds ?? [])
        .filter((id) => !isUniqueGadgetDefinition(GADGET_DEFINITIONS[id]))
        .map((id) => ({ kind: 'gadget', id })),
    ];
    if (GADGET_DEFINITIONS[bot.selectedGadgetId]) {
      const preferenceOrder = bot.gadgetPreferenceOrder;
      const currentRank = Array.isArray(preferenceOrder)
        ? preferenceOrder.indexOf(bot.selectedGadgetId) : -1;
      availableOffers = availableOffers.filter((offer) =>
        offer.kind !== 'gadget' || (currentRank >= 0 &&
          preferenceOrder.indexOf(offer.id) >= 0 &&
          preferenceOrder.indexOf(offer.id) < currentRank));
    }
    const owned = bot.inventoryWeaponIds ?? [LONG_PLAY_STARTER_WEAPON_ID];
    let picksRemaining = bot.shopPicksRemaining ?? 0;
    while (availableOffers.length && picksRemaining > 0) {
      const weights = availableOffers.map((offer) => this.getLongPlayBotShopOfferWeight(bot, offer));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let choice = this.random() * totalWeight;
      let selectedIndex = availableOffers.length - 1;
      for (let index = 0; index < availableOffers.length; index += 1) {
        choice -= weights[index];
        if (choice < 0) {
          selectedIndex = index;
          break;
        }
      }
      const [offer] = availableOffers.splice(selectedIndex, 1);
      if (this.purchaseLongPlayBotShopOffer(bot, offer)) picksRemaining -= 1;
    }
    if (picksRemaining > 0) {
      throw new Error(`Bot ${bot.id ?? '<unknown>'} could not spend ${picksRemaining} competitive-series shop pick(s).`);
    }

    bot.weaponShopOfferIds = [];
    bot.itemShopOfferIds = [];
    bot.gadgetShopOfferIds = [];
    bot.shopPicksRemaining = 0;
    bot.weaponShopResolved = true;
    bot.inventoryWeaponIds = [bot.selectedWeaponId ?? owned[0] ?? LONG_PLAY_STARTER_WEAPON_ID];
    bot.selectedWeaponId = bot.inventoryWeaponIds[0];
  }

  getLongPlayBotShopOfferWeight(bot, offer) {
    if (offer.kind === 'gadget') {
      const appeal = GADGET_DEFINITIONS[offer.id]?.botAppeal ?? 1;
      const preferenceOrder = bot.gadgetPreferenceOrder;
      const offeredRank = preferenceOrder?.indexOf(offer.id) ?? -1;
      const currentRank = preferenceOrder?.indexOf(bot.selectedGadgetId) ?? -1;
      const preferenceGain = offeredRank < 0 ? 0
        : currentRank >= 0 ? Math.max(0, currentRank - offeredRank)
          : preferenceOrder.length - offeredRank;
      return appeal * 2.5 * (1 + preferenceGain / Math.max(1, preferenceOrder?.length ?? 0));
    }
    if (offer.kind === 'weapon') {
      const currentId = bot.selectedWeaponId ?? LONG_PLAY_STARTER_WEAPON_ID;
      const currentPreference = BOT_WEAPON_PREFERENCES.filter((id) => id === currentId).length;
      const offerPreference = BOT_WEAPON_PREFERENCES.filter((id) => id === offer.id).length;
      const currentClass = this.projectileDefinitions.get(currentId)?.weaponClass;
      const offerClass = this.projectileDefinitions.get(offer.id)?.weaponClass;
      const preferenceWeight = offerPreference > currentPreference
        ? 1.7 : offerPreference === currentPreference ? 0.85 : 0.4;
      const replacesPistol = currentClass === 'pistol' && offerClass !== 'pistol';
      return preferenceWeight * (replacesPistol ? 1.5 : 1) *
        (offer.id === bot.botBrain?.loadoutWeaponId ? 1.25 : 1);
    }
    if (offer.kind === 'armor') return bot.inventory?.armor ? 1.8 : 2.5;
    const hasSamePerk = bot.inventory?.perks?.some((item) => item.id === offer.id);
    return hasSamePerk ? 1.8 : bot.inventory?.perks?.length ? 3 : 4.5;
  }

  purchaseLongPlayBotShopOffer(bot, offer) {
    if (offer.kind === 'weapon') {
      if (!this.projectileDefinitions.has(offer.id)) return false;
      bot.inventoryWeaponIds = [offer.id];
      bot.selectedWeaponId = offer.id;
      return true;
    }
    if (offer.kind === 'gadget' && GADGET_DEFINITIONS[offer.id] &&
        !isUniqueGadgetDefinition(GADGET_DEFINITIONS[offer.id])) {
      bot.selectedGadgetId = offer.id;
      bot.gadgetCount = 1;
      bot.gadgetCounts = createGadgetCounts(offer.id, 1);
      return true;
    }
    const levelDefinition = getItemLevelDefinition(offer.id, offer.level);
    if (!levelDefinition) return false;
    const inventory = normalizeItemInventory(bot.inventory);
    if (offer.kind === 'armor' && offer.id === 'armor' &&
        offer.level === (inventory.armor?.level ?? 0) + 1) {
      inventory.armor = { id: offer.id, name: levelDefinition.name, level: offer.level };
    } else if (offer.kind === 'perk') {
      const current = inventory.perks.find((item) => item.id === offer.id);
      if (offer.level !== (current?.level ?? 0) + 1) return false;
      inventory.perks = inventory.perks.filter((item) => item.id !== offer.id);
      inventory.perks.push({ id: offer.id, name: levelDefinition.name, level: offer.level });
    } else {
      return false;
    }
    bot.inventory = normalizeItemInventory(inventory);
    return true;
  }

  validateRoomDetails(name, password) {
    if (typeof name !== 'string') {
      throw new RoomManagerError('Enter a room name.');
    }

    const normalizedName = name.trim();
    if (!ROOM_NAME_PATTERN.test(normalizedName)) {
      throw new RoomManagerError('Room names must be 1–32 letters, numbers, spaces, hyphens, or underscores.');
    }

    if (typeof password !== 'string' || password.length > 128) {
      throw new RoomManagerError('Passwords must be 128 characters or fewer.');
    }

    return { name: normalizedName, password };
  }

  validateDisplayName(displayName) {
    if (displayName === undefined || displayName === null) return null;
    if (typeof displayName !== 'string') {
      throw new RoomManagerError('Display names must be 1–24 letters, numbers, spaces, apostrophes, hyphens, or underscores.');
    }
    const normalized = displayName.trim().replace(/\s+/gu, ' ');
    const length = Array.from(normalized).length;
    if (length < 1 || length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u.test(normalized)) {
      throw new RoomManagerError('Display names must be 1–24 letters, numbers, spaces, apostrophes, hyphens, or underscores.');
    }
    return normalized;
  }

  validateTeam(team) {
    if (!getTeamGroup(team)) {
      throw new RoomManagerError('Choose Strike Team or Flag Team.');
    }
    return team;
  }

  getTeamCounts(room) {
    const counts = this.getHumanTeamCounts(room);
    for (const team of ['red', 'blue']) counts[team] += room.botRoster?.[team]?.length ?? 0;
    return counts;
  }

  getHumanTeamCounts(room) {
    const counts = Object.fromEntries(TEAM_GROUPS.map(({ id }) => [id, 0]));
    for (const client of room.clients) {
      const teamId = getTeamGroupId(client.team);
      if (!teamId) throw new RoomManagerError('Every room player must be assigned to the Strike Team or Flag Team.');
      counts[teamId] += 1;
    }
    return counts;
  }

  getBalancedTeam(room) {
    const counts = this.getTeamCounts(room);
    if (counts.red >= TEAM_CAPACITY && counts.blue >= TEAM_CAPACITY) {
      throw new RoomManagerError('That room has no open team slots.');
    }
    if (counts.red === counts.blue) {
      const randomTeam = this.getRandomTeam();
      if (counts[randomTeam] < TEAM_CAPACITY) return randomTeam;
      return randomTeam === 'red' ? 'blue' : 'red';
    }
    return counts.red < counts.blue ? 'red' : 'blue';
  }

  getBalancedQuickPlayTeam(room) {
    const counts = this.getHumanTeamCounts(room);
    if (counts.red >= TEAM_CAPACITY && counts.blue >= TEAM_CAPACITY) {
      throw new RoomManagerError('That room has no open team slots.');
    }
    if (counts.red === counts.blue) {
      const randomTeam = this.getRandomTeam();
      return counts[randomTeam] < TEAM_CAPACITY ? randomTeam : getOppositeTeam(randomTeam);
    }
    return counts.red < counts.blue ? 'red' : 'blue';
  }

  getRandomTeam() {
    return this.randomTeam() < 0.5 ? 'red' : 'blue';
  }

  assertRoomCanBeCreated(key) {
    if (this.rooms.has(key)) {
      throw new RoomManagerError('A room with that name already exists.');
    }
    if (this.rooms.size >= this.maxRooms) {
      throw new RoomManagerError('The server has reached its active room limit.');
    }
  }

  assertClientConnected(client) {
    if (client.connected === false) {
      throw new RoomManagerError('Your connection was lost. Please reconnect and try again.');
    }
  }

  toPublicRoom(room) {
    const teamCounts = this.getTeamCounts(room);
    const quickPlaySquadCounts = room.quickPlay
      ? Object.fromEntries(['A', 'B'].map((squadId) => [squadId,
        [...room.clients].filter((client) => client.squadId === squadId).length +
        (room.quickPlayBotRoster ?? []).filter((bot) => bot.squadId === squadId).length,
      ]))
      : null;
    return {
      name: room.name,
      clients: room.clients.size,
      capacity: this.maxClientsPerRoom,
      full: room.clients.size >= this.maxClientsPerRoom ||
        (teamCounts.red >= TEAM_CAPACITY && teamCounts.blue >= TEAM_CAPACITY),
      teamCounts,
      quickPlaySquadCounts,
      teamCapacity: TEAM_CAPACITY,
      locked: room.passwordHash !== null,
      hostName: this.getHost(room)?.playerName ?? 'Unknown player',
      inProgress: room.match !== null,
      quickPlay: room.quickPlay === true,
      gameMode: room.gameMode ?? (room.quickPlay ? 'quickplay' : 'custom'),
      quickPlayPhase: room.quickPlayState?.phase ?? null,
      quickPlayRound: room.quickPlayState?.round ?? 0,
      quickPlayAutoStartAt: room.quickPlayAutoStartAt ?? null,
    };
  }
}
