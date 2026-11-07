import { getPlayerVisionOrigin, isPointVisible, VISION_HALF_ANGLE } from './VisionModel.js';
import { MAX_PLAYER_SPEED, PLAYER_RADIUS, SLOW_WALK_SPEED_SCALE } from './MovementModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS, segmentCircleEntryTCoordinates, segmentMapObjectBoundsOverlap, segmentMapObjectEntryT } from './ProjectileModel.js';
import { getWeaponAimAngle, getWeaponMuzzlePosition } from './WeaponGeometry.js';
import { getMaximumSpreadRadians } from './WeaponAccuracy.js';
import { circleOverlapsMapObjects } from './MapGeometry.js';
import { getInventoryEffects } from './InventoryModel.js';
import {
  calculateGadgetTrajectory,
  BIO_FIELD_ID,
  BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER,
  CRYO_GRENADE_ID,
  CRYO_MOVEMENT_SPEED_MULTIPLIER,
  DEFAULT_GADGET_THROW_COLLISION_RADIUS,
  FLASH_GRENADE_ID,
  GADGET_DEFINITIONS,
  getGadgetProjectileSpeed,
  isPlayerFlashBlinded,
  JAMMER_GRENADE_ID,
  JAMMER_GRENADE_RADIUS,
  isGadgetJammed,
  isPlayerJammed,
  isProximityMineArmed,
  calculateKatanaDash,
  getGadgetThrowOrigin,
  KATANA_ID,
  KATANA_DASH_HIT_RADIUS,
  MOLOTOV_ID,
  ORBITAL_STRIKE_ID,
  PROXIMITY_MINE_BODY_RADIUS,
  PROXIMITY_MINE_HIT_RADIUS,
  PROXIMITY_MINE_ARMING_DURATION_MS,
  PROXIMITY_MINE_ID,
  PROXIMITY_MINE_THROW_RANGE,
  PROXIMITY_MINE_TRIGGER_RADIUS,
  SONAR_ID,
  SMOKE_GRENADE_ID,
  SPY_CAMERA_BODY_RADIUS,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_HEALTH,
  TROPHY_SYSTEM_COMMAND_RADIUS,
  VINE_TRAP_ID,
} from './GadgetModel.js';
import { hasTrophyLineOfSight } from './TrophySystemModel.js';
import { isTrophyCommandEffectInRangeAndSight } from './HostGadgetModel.js';
import { getBotMapStrategy } from './BotMapStrategy.js';
import { collectBotPerception } from './BotPerception.js';
import { someMapObjectAlongSegment } from './MapSpatialIndex.js';

const BOT_TRAVEL_SPEED = MAX_PLAYER_SPEED;
const BOT_GADGETS = Object.values(GADGET_DEFINITIONS);

export const DEFAULT_BOT_PARAMETERS = Object.freeze({
  reflexMs: 280,
  accuracy: 0.72,
  thinkingComplexity: 3,
  thinkingTimeMs: 120,
  aggressiveness: 0.58,
  objectiveFocus: 0.72,
  defenseFocus: 0.62,
  retreatHealth: 32,
});

export const BOT_PARAMETER_LIMITS = Object.freeze({
  reflexMs: [0, 1_500],
  accuracy: [0.1, 1],
  thinkingComplexity: [1, 5],
  thinkingTimeMs: [0, 1_500],
  aggressiveness: [0, 1],
  objectiveFocus: [0, 1],
  defenseFocus: [0, 1],
  retreatHealth: [10, 90],
});

export const BOT_PERSONALITIES = Object.freeze([
  { id: 'bot-1', name: 'Lee Kee Buhm', parameters: { reflexMs: 230, accuracy: 0.86, thinkingComplexity: 3, thinkingTimeMs: 100, aggressiveness: 0.36, objectiveFocus: 0.94, defenseFocus: 0.72, retreatHealth: 25 } },
  { id: 'bot-2', name: 'Chris P. Bacon', parameters: { reflexMs: 185, accuracy: 0.72, thinkingComplexity: 2, thinkingTimeMs: 65, aggressiveness: 0.91, objectiveFocus: 0.48, defenseFocus: 0.38, retreatHealth: 18 } },
  { id: 'bot-3', name: 'Brock Lee', parameters: { reflexMs: 310, accuracy: 0.82, thinkingComplexity: 4, thinkingTimeMs: 190, aggressiveness: 0.34, objectiveFocus: 0.82, defenseFocus: 0.96, retreatHealth: 48 } },
  { id: 'bot-4', name: 'Ben Dover', parameters: { reflexMs: 175, accuracy: 0.58, thinkingComplexity: 1, thinkingTimeMs: 50, aggressiveness: 0.98, objectiveFocus: 0.42, defenseFocus: 0.3, retreatHealth: 15 } },
  { id: 'bot-5', name: 'Phil McCracken', parameters: { reflexMs: 275, accuracy: 0.78, thinkingComplexity: 3, thinkingTimeMs: 120, aggressiveness: 0.58, objectiveFocus: 0.9, defenseFocus: 0.68, retreatHealth: 34 } },
  { id: 'bot-6', name: 'Moe Zarella', parameters: { reflexMs: 225, accuracy: 0.64, thinkingComplexity: 3, thinkingTimeMs: 80, aggressiveness: 0.76, objectiveFocus: 0.64, defenseFocus: 0.52, retreatHealth: 28 } },
  { id: 'bot-7', name: 'Hai Howie Yu', parameters: { reflexMs: 340, accuracy: 0.9, thinkingComplexity: 5, thinkingTimeMs: 200, aggressiveness: 0.22, objectiveFocus: 0.75, defenseFocus: 0.9, retreatHealth: 55 } },
  { id: 'bot-8', name: 'Chip Munk', parameters: { reflexMs: 195, accuracy: 0.52, thinkingComplexity: 2, thinkingTimeMs: 60, aggressiveness: 0.88, objectiveFocus: 0.58, defenseFocus: 0.44, retreatHealth: 20 } },
  { id: 'bot-9', name: 'Shay King', parameters: { reflexMs: 295, accuracy: 0.84, thinkingComplexity: 4, thinkingTimeMs: 175, aggressiveness: 0.48, objectiveFocus: 0.72, defenseFocus: 0.84, retreatHealth: 42 } },
  { id: 'bot-10', name: 'Anita Bath', parameters: { reflexMs: 250, accuracy: 0.7, thinkingComplexity: 3, thinkingTimeMs: 110, aggressiveness: 0.68, objectiveFocus: 0.86, defenseFocus: 0.58, retreatHealth: 30 } },
].map((bot) => Object.freeze({ ...bot, parameters: Object.freeze(bot.parameters) })));

const TAU = Math.PI * 2;
const COVER_RADIAL_DIRECTIONS = Array.from({ length: 16 }, (_, index) => {
  const angle = index * TAU / 16;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});
const COVER_ENDPOINT_DIRECTIONS = Array.from({ length: 8 }, (_, index) => {
  const angle = index * TAU / 8;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});
const COVER_SEGMENT_FRACTIONS = [0.12, 0.38, 0.64, 0.88];
const SEEN_MEMORY_MS = 12_000;
const COMBAT_TARGET_MEMORY_MS = 1_200;
const STRIKE_SPY_CAMERA_MIN_PROGRESS = 0.35;
const EXPLORE_CELL_SIZE = 96;
const STUCK_TIMEOUT_MS = 850;
const RED_OBJECTIVE_DETOUR_MS = 1_400;
const RED_OBJECTIVE_RECOVERY_MS = 2_500;
const TEAMMATE_THREAT_RADIUS = 420;
export const BOT_TEAM_SIGHTING_RESPONSE_RANGE = 1_200;
const TEAM_SIGHTING_INVESTIGATION_RANGE = 1_000;
const ORBITAL_STRIKE_MAX_INTEL_AGE_MS = 350;
const TACTICAL_COVER_SEARCH_RANGE = 190;
const MIN_DEFENDER_COVER_SPACING = 54;
const MIN_DEFENDER_POST_SPACING = 88;
const MIN_DEFENDER_WATCH_SPACING = 110;
const TACTICAL_COVER_REPLAN_MS = 350;
export const BOT_TEAM_DAMAGE_RESPONSE_RANGE = 760;
export const BOT_TEAM_INTEL_RESPONDER_COUNT = 2;
const CLEARING_ACTIONS = new Set([
  'leave-spawn', 'capture', 'recover-flag', 'escort', 'intercept', 'hunt', 'hunt-carrier',
  'search-flag', 'support', 'respond-team-threat', 'respond-teammate-death',
  'investigate-team-sighting', 'investigate-audio', 'investigate-ping',
]);
const RED_LOW_PRIORITY_ACTIONS = new Set([
  'hunt', 'respond-teammate-death', 'investigate-audio', 'watch-entrance',
]);
const PING_PROTECTED_ACTIONS = new Set([
  'leave-spawn', 'recover-flag', 'escort', 'intercept', 'hunt-carrier',
  'search-flag', 'armor-recovery',
]);
const BOT_WEAPONS = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
const BOT_WEAPONS_BY_ID = new Map(BOT_WEAPONS.map((weapon) => [weapon.id, weapon]));
export function normalizeBotParameters(parameters = {}) {
  const normalized = {};
  for (const [name, [minimum, maximum]] of Object.entries(BOT_PARAMETER_LIMITS)) {
    const value = parameters[name] ?? DEFAULT_BOT_PARAMETERS[name];
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
    }
    normalized[name] = name === 'thinkingComplexity' ? Math.round(value) : value;
  }
  return normalized;
}

const AREA_DENIAL_GADGET_IDS = new Set([
  BIO_FIELD_ID,
  CRYO_GRENADE_ID,
  MOLOTOV_ID,
  ORBITAL_STRIKE_ID,
]);

function getCurrentGadgetEffects(match, now) {
  const effects = [];
  const effectIds = new Set();
  for (const effect of match.gadgetEffects ?? []) {
    if ((effect.startedAt ?? 0) > now || effect.expiresAt <= now) continue;
    effects.push(effect);
    if (typeof effect.id === 'string') effectIds.add(effect.id);
  }
  for (const pending of match.pendingGadgetEffects ?? []) {
    const effect = pending?.effect;
    const startsAt = pending?.detonatesAt ?? pending?.landedAt ?? effect?.startedAt ?? now;
    if (!effect || startsAt < now || effect.expiresAt <= startsAt ||
        (typeof effect.id === 'string' && effectIds.has(effect.id))) continue;
    effects.push({ ...effect, startedAt: startsAt });
    if (typeof effect.id === 'string') effectIds.add(effect.id);
  }
  return effects;
}

function isAreaDenialEffect(effect) {
  return AREA_DENIAL_GADGET_IDS.has(effect?.gadgetId) ||
    [BIO_FIELD_ID, CRYO_GRENADE_ID, MOLOTOV_ID, 'orbital-strike-warning',
      'orbital-strike-explosion'].includes(effect?.type);
}

function getEffectAreaRadius(effect) {
  return effect?.radius ?? GADGET_DEFINITIONS[effect?.gadgetId]?.effectRadius ?? 0;
}

function overlapsEffectArea(point, radius, effect) {
  return distance(point, effect) <= radius + getEffectAreaRadius(effect);
}

function getKnownEnemyTrophies(bot, gadgetEffects, now, context) {
  const visionObjects = context.visionObjects ?? [];
  const visionSources = [
    ...(context.vision ? [context.vision] : []),
    ...(context.teamIntel?.visionSources ?? []),
  ];
  return gadgetEffects.filter((effect) =>
    effect.type === TROPHY_SYSTEM_ID && effect.team !== bot.team &&
    (effect.startedAt ?? 0) <= now && effect.expiresAt > now &&
    (effect.health ?? TROPHY_SYSTEM_HEALTH) > 0 &&
    visionSources.some((vision) =>
      isPointVisible(effect, vision, vision.xray ? [] : visionObjects)));
}

function isTrajectoryCoveredByTrophy(trajectory, trophies, visionObjects) {
  if (!trophies.length || !Array.isArray(trajectory?.points)) return false;
  for (let index = 1; index < trajectory.points.length; index += 1) {
    const start = trajectory.points[index - 1];
    const end = trajectory.points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const position = { x: start.x + dx * progress, y: start.y + dy * progress };
      if (trophies.some((trophy) => hasTrophyLineOfSight(trophy, position, visionObjects))) {
        return true;
      }
    }
  }
  return false;
}

function isPointCoveredByTrophy(point, trophies, visionObjects) {
  return trophies.some((trophy) => hasTrophyLineOfSight(trophy, point, visionObjects));
}

function chooseBioFieldTarget(bot, match, teammates, visibleEnemies, now, context, gadgetEffects) {
  const gadget = GADGET_DEFINITIONS[BIO_FIELD_ID];
  const radius = gadget.effectRadius;
  const allies = [bot, ...teammates.filter((ally) => ally.id !== bot.id)].filter((ally) =>
    ally.alive !== false && (ally.health ?? 100) > 0 && ally.team === bot.team);
  const activeFields = gadgetEffects.filter((effect) =>
    effect.type === BIO_FIELD_ID && effect.team === bot.team);
  const activeAreaDenial = gadgetEffects.filter(isAreaDenialEffect);
  const enemyFields = gadgetEffects.filter((effect) =>
    effect.type === BIO_FIELD_ID && effect.team !== bot.team &&
    (!context.vision ||
      isPointVisible(effect, context.vision, context.visionObjects ?? match.map.objects)));
  const candidates = allies.map((ally) => ({ x: ally.x, y: ally.y }));
  for (let first = 0; first < allies.length; first += 1) {
    for (let second = first + 1; second < allies.length; second += 1) {
      if (distance(allies[first], allies[second]) <= radius * 2) {
        candidates.push({
          x: (allies[first].x + allies[second].x) / 2,
          y: (allies[first].y + allies[second].y) / 2,
        });
      }
    }
  }
  candidates.push(...enemyFields.map((field) => ({ x: field.x, y: field.y })));
  let best = null;
  for (const target of candidates) {
    const origin = getGadgetThrowOrigin(bot, target, match.map.objects);
    const trajectory = calculateGadgetTrajectory(origin, target, match.map.objects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory || isTrajectoryCoveredByTrophy(
      trajectory, context.knownEnemyTrophies ?? [], context.visionObjects ?? match.map.objects,
    )) continue;
    const endpoint = trajectory.endpoint;
    const overlappingEffects = activeAreaDenial.filter((effect) =>
      overlapsEffectArea(endpoint, radius, effect));
    const neutralizedEnemyFields = overlappingEffects.filter((effect) =>
      effect.type === BIO_FIELD_ID && effect.team !== bot.team);
    if (overlappingEffects.some((effect) =>
      effect.type !== BIO_FIELD_ID || effect.team === bot.team) ||
        (overlappingEffects.some((effect) => effect.type === BIO_FIELD_ID &&
          effect.team === bot.team) && neutralizedEnemyFields.length === 0)) continue;
    const freshAllies = allies.filter((ally) =>
      distance(ally, endpoint) <= radius &&
      !activeFields.some((field) => distance(ally, field) <= getEffectAreaRadius(field)));
    const affectedEnemies = visibleEnemies.filter((enemy) => distance(enemy, endpoint) <= radius);
    if (freshAllies.length === 0 && affectedEnemies.length === 0 &&
        neutralizedEnemyFields.length === 0) continue;
    const score = freshAllies.length * 2 + affectedEnemies.length +
      neutralizedEnemyFields.length * 3;
    const range = distance(bot, endpoint);
    if (!best || score > best.score || (score === best.score && range < best.range)) {
      best = { target, score, range };
    }
  }
  return best?.target ?? null;
}

export function createBotBrain(id, now = 0, random = Math.random) {
  return {
    id,
    loadoutWeaponId: chooseBotLoadoutWeaponId(Object.values(DEFAULT_PROJECTILE_DEFINITIONS), random),
    nextThinkAt: now,
    rememberedEnemies: {},
    orbitalStrikeWarningSeenAtById: {},
    strafeSign: hashString(id) % 2 === 0 ? 1 : -1,
    visitedCells: {},
    blockedCells: {},
    lastProgressAt: now,
    lastWasMoving: false,
    stuckCount: 0,
    detourTarget: null,
    detourUntil: 0,
    explorationTarget: null,
    combatMode: 'approach',
    tacticalCoverCache: null,
    clearanceCover: null,
    defenseRouteAssignment: null,
    defensePost: null,
  };
}

export function chooseBotLoadoutWeaponId(weapons = BOT_WEAPONS, random = Math.random) {
  return chooseBotLoadoutByAppeal(weapons, random);
}

export function chooseBotLoadoutGadgetId(gadgets = BOT_GADGETS, random = Math.random) {
  return chooseBotLoadoutByAppeal(gadgets, random);
}

function chooseBotLoadoutByAppeal(definitions, random) {
  const candidates = [...definitions]
    .filter((definition) => Number.isFinite(definition.botAppeal) && definition.botAppeal > 0);
  const totalAppeal = candidates.reduce((total, definition) => total + definition.botAppeal, 0);
  if (totalAppeal <= 0) return candidates[0]?.id ?? definitions[0]?.id ?? null;

  let choice = Math.max(0, Math.min(1 - Number.EPSILON, random())) * totalAppeal;
  for (const definition of candidates) {
    choice -= definition.botAppeal;
    if (choice < 0) return definition.id;
  }
  return candidates.at(-1)?.id ?? null;
}

/** Produces one bounded, explainable tactical choice from the bot's current perception. */
export function decideBotAction(bot, match, parameters = DEFAULT_BOT_PARAMETERS, now = 0, teamContext = {}) {
  const settings = normalizeBotParameters(parameters);
  const brain = bot.botBrain ?? (bot.botBrain = createBotBrain(bot.id, now));
  const worldState = teamContext?.worldState;
  const livingPlayers = worldState?.livingPlayers ??
    match.players.filter((player) => player.alive && player.health > 0);
  const livingPlayersByTeam = worldState?.livingPlayersByTeam;
  const teammates = livingPlayersByTeam?.get(bot.team) ??
    livingPlayers.filter((player) => player.team === bot.team);
  const opposingTeam = bot.team === 'red' ? 'blue' : bot.team === 'blue' ? 'red' : null;
  const enemies = opposingTeam && livingPlayersByTeam?.has(opposingTeam)
    ? livingPlayersByTeam.get(opposingTeam)
    : livingPlayers.filter((player) => player.team !== bot.team);
  const playersById = worldState?.playersById;
  const mapStrategy = teamContext?.mapStrategy ?? getBotMapStrategy(match.map);
  brain.matchWeaponId = bot.selectedWeaponId ?? brain.loadoutWeaponId ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.id;
  const damageCue = teamContext?.damageCue;
  const activeDamageCue = damageCue && Number.isFinite(damageCue.bearing) &&
    Number.isFinite(damageCue.expiresAt) && damageCue.expiresAt > now ? damageCue : null;
  let visionObjects = teamContext?.visionObjects;
  if (!visionObjects) {
    const activeSmokes = (match.smokes ?? []).filter((smoke) => smoke.expiresAt > now);
    visionObjects = activeSmokes.length ? [...match.map.objects, ...activeSmokes] : match.map.objects;
  }
  const weapon = BOT_WEAPONS_BY_ID.get(brain.matchWeaponId) ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
  const weaponState = bot.weaponStats?.[weapon.id] ?? {};
  const {
    visionAngle,
    vision,
    visibleEnemies,
    visibleEnemyMines,
    visibleEnemyDeployables,
  } = collectBotPerception(bot, match, weaponState, enemies, now, visionObjects);

  for (const enemy of visibleEnemies) {
    const previous = brain.rememberedEnemies[enemy.id];
    const reacquired = previous && now - previous.seenAt <= 700;
    brain.rememberedEnemies[enemy.id] = {
      x: enemy.x,
      y: enemy.y,
      seenAt: now,
      firstSeenAt: reacquired ? previous.firstSeenAt : now,
    };
  }
  for (const [enemyId, memory] of Object.entries(brain.rememberedEnemies)) {
    if (now - memory.seenAt > SEEN_MEMORY_MS) delete brain.rememberedEnemies[enemyId];
  }

  const rankedEnemies = visibleEnemies.map((enemy) => ({ enemy, distance: distance(bot, enemy) }))
    .sort((a, b) => Number(b.enemy.id === match.flag.heldBy) - Number(a.enemy.id === match.flag.heldBy) ||
      a.distance - b.distance || a.enemy.id.localeCompare(b.enemy.id));
  const nearestEnemy = rankedEnemies[0]?.enemy ?? null;
  const flagCarrierEnemy = visibleEnemies.find((enemy) => enemy.id === match.flag.heldBy) ?? null;
  const committedEnemy = visibleEnemies.find((enemy) => enemy.id === brain.targetEnemyId);
  let targetEnemy = flagCarrierEnemy ?? (committedEnemy && nearestEnemy &&
    distance(bot, committedEnemy) <= distance(bot, nearestEnemy) + 100 ? committedEnemy : nearestEnemy);
  if (targetEnemy) {
    brain.targetEnemyId = targetEnemy.id;
  } else if (brain.targetEnemyId) {
    const remembered = brain.rememberedEnemies[brain.targetEnemyId];
    const rememberedActor = playersById?.get(brain.targetEnemyId) ??
      match.players.find((player) => player.id === brain.targetEnemyId);
    if (remembered && rememberedActor?.alive && rememberedActor.health > 0 &&
        now - remembered.seenAt <= COMBAT_TARGET_MEMORY_MS) {
      targetEnemy = { id: rememberedActor.id, team: rememberedActor.team, x: remembered.x, y: remembered.y };
    } else {
      brain.targetEnemyId = null;
    }
  }
  const targetIsVisible = Boolean(targetEnemy && visibleEnemies.some((enemy) => enemy.id === targetEnemy.id));
  const enemyDistance = targetEnemy ? distance(bot, targetEnemy) : Infinity;
  const plannedWeaponId = weapon.id;
  const plannedWeapon = weapon;
  const rememberedEnemy = Object.values(brain.rememberedEnemies)
    .filter((memory) => now - memory.seenAt < 1_200 + settings.thinkingComplexity * 700)
    .sort((a, b) => distance(bot, a) - distance(bot, b))[0] ?? null;
  const alliesNearby = teammates.filter((ally) => ally.id !== bot.id && distance(bot, ally) < 280).length;
  const enemiesNearby = visibleEnemies.filter((enemy) => distance(bot, enemy) < 280).length;
  const outnumbered = enemiesNearby > alliesNearby;
  const flag = match.flag;
  const carrier = playersById?.get(flag.heldBy) ??
    match.players.find((candidate) => candidate.id === flag.heldBy) ?? null;
  const isCarrier = flag.heldBy === bot.id;
  const friendlyCarrier = carrier?.team === bot.team ? carrier : null;
  const actualEnemyCarrier = carrier && carrier.team !== bot.team ? carrier : null;
  const rememberedCarrierMemory = actualEnemyCarrier ? brain.rememberedEnemies[actualEnemyCarrier.id] : null;
  const rememberedCarrier = rememberedCarrierMemory &&
    now - rememberedCarrierMemory.seenAt <= 2_000 + settings.thinkingComplexity * 1_000
    ? rememberedCarrierMemory : null;
  const enemyCarrier = actualEnemyCarrier && (visibleEnemies.some((enemy) => enemy.id === actualEnemyCarrier.id) ||
    rememberedCarrier) ? actualEnemyCarrier : null;
  const lowHealth = bot.health <= settings.retreatHealth ||
    (outnumbered && bot.health <= settings.retreatHealth * 1.5);
  const inventoryEffects = getInventoryEffects(bot.inventory);
  const maximumArmor = Math.max(0, bot.maxArmor ?? inventoryEffects.armor);
  const currentArmor = maximumArmor > 0
    ? clamp(bot.armor ?? maximumArmor, 0, maximumArmor) : 0;
  const armorConfidence = maximumArmor > 0 ? currentArmor / maximumArmor : 1;
  const lowArmor = maximumArmor > 0 && currentArmor <= Math.max(1, maximumArmor * 0.15);
  const teamIntel = teamContext?.teamIntel;
  const teamPings = (teamIntel?.pings ?? []).filter((ping) =>
    ping.team === bot.team && Number.isFinite(ping.expiresAt) && ping.expiresAt > now &&
    Number.isFinite(ping.x) && Number.isFinite(ping.y));
  const assignedPing = teamPings
    .filter((ping) => ping.responderId === bot.id)
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0] ?? null;
  const gameplayStartsAt = Number.isFinite(match.gameplayStartsAt) ? match.gameplayStartsAt : 0;
  const endsAt = Number.isFinite(match.endsAt) ? match.endsAt : gameplayStartsAt + 180_000;
  const remaining = Math.max(0, endsAt - now);
  const redTimePressure = bot.team === 'red'
    ? clamp(1 - remaining / Math.max(1, endsAt - gameplayStartsAt), 0, 1) : 0;
  const smallRedSquad = bot.team === 'red' && teammates.length <= 3;
  const baseEffectiveAggression = clamp(settings.aggressiveness + redTimePressure * 0.45, 0, 1);
  const roomEntryConfidence = getRoomEntryConfidence(
    bot, teammates, enemies, visibleEnemies, targetEnemy, enemyDistance, plannedWeapon,
    settings, baseEffectiveAggression, now, match, teamIntel, maximumArmor, currentArmor,
  );
  const effectiveAggression = baseEffectiveAggression;
  const roomClearanceHoldMs = 250 + (1 - roomEntryConfidence) * 900;
  const roleIndex = Number.isInteger(teamContext?.roleIndex) ? teamContext.roleIndex : hashString(bot.id) % Math.max(1, teammates.length);
  const roleCount = Math.max(1, Number.isInteger(teamContext?.roleCount)
    ? teamContext.roleCount : teammates.filter((ally) => ally.isBot).length);
  const sharedCarrierPosition = bot.team === 'blue'
    ? getSharedFlagCarrierPosition(bot, match, teamIntel, now, playersById)
    : null;
  const teamSightingTarget = getTeamSightingTarget(bot, match, teamIntel, teammates, now, worldState);
  const personalDamageThreat = activeDamageCue
    ? getEstimatedDamageThreatPosition(bot, activeDamageCue.bearing, bot.team, teamIntel, match.map, now)
    : null;
  const localAudioCues = match.botNoises ?? [];
  const audioCues = teamIntel?.audioCues
    ? [...teamIntel.audioCues, ...localAudioCues.filter((cue) => cue.audiencePlayerId === bot.id)]
    : localAudioCues;
  const noise = audioCues
    .filter((cue) => cue.team === bot.team && (!cue.botId || cue.botId === bot.id) &&
      (!cue.audiencePlayerId || cue.audiencePlayerId === bot.id) &&
      cue.expiresAt > now && Number.isFinite(cue.x) && Number.isFinite(cue.y))
    .filter((cue) => distance(bot, cue) <= Math.min(1_000, (cue.radius ?? 180) +
      (cue.kind === 'footstep' ? 500 : 360)) &&
      isOneOfNearestBotResponders(bot, teammates, cue, BOT_TEAM_INTEL_RESPONDER_COUNT))
    .sort((left, right) =>
      Number(right.kind === 'gunshot') - Number(left.kind === 'gunshot') ||
      Number(right.kind === 'footstep') - Number(left.kind === 'footstep') ||
      right.expiresAt - left.expiresAt || distance(bot, left) - distance(bot, right))[0] ?? null;

  markExploredCell(bot, brain, now);
  const objective = chooseObjective(bot, match, settings, brain, teammates, carrier,
    friendlyCarrier, targetEnemy?.id === enemyCarrier?.id ? targetEnemy : null,
    rememberedCarrier, now, { roleIndex, roleCount, timePressure: redTimePressure,
      aggression: effectiveAggression, perceivedThreat: targetEnemy, noise,
      confidence: roomEntryConfidence,
      defensiveThreats: bot.team === 'blue' ? [
        ...visibleEnemies,
        ...(teamSightingTarget ? [teamSightingTarget.position] : []),
        ...(targetEnemy && !targetIsVisible ? [targetEnemy] : []),
      ] : [],
      teamIntel, sharedCarrierPosition, visionObjects,
      teammateTacticalPositions: teamContext.teammateTacticalPositions ?? [] });
  let action = objective.action;
  let navigationTarget = objective.target;
  let intelLookTarget = null;
  let blindFireIntel = null;
  const ammo = weaponState.ammo ?? weapon.magazineSize;
  const closeThreat = visibleEnemies.some((enemy) => distance(bot, enemy) < 360);
  const reload = Boolean(!weaponState.reloading && ammo < weapon.magazineSize &&
    (ammo === 0 || (ammo <= Math.ceil(weapon.magazineSize * 0.25) && !closeThreat)));

  // Objective movement is the default. Combat only takes over briefly for a nearby
  // threat; at range bots keep advancing while aiming and taking safe shots.
  const defensiveSite = center(match.map.spawnZones[bot.team]);
  const enemyNearBlueSite = bot.team === 'blue' && targetEnemy &&
    distance(targetEnemy, defensiveSite) <= 470;
  const confidenceEngagementScale = 0.55 + roomEntryConfidence * 0.45;
  const redEngageRange = (190 + effectiveAggression * 75 - settings.objectiveFocus * 35) *
    confidenceEngagementScale;
  const blueEngageRange = (250 + effectiveAggression * 100 - settings.defenseFocus * 30) *
    confidenceEngagementScale;
  const shouldFight = Boolean(targetEnemy && (enemyDistance <= (bot.team === 'blue' ? blueEngageRange : redEngageRange) ||
    (bot.team === 'blue' && enemyNearBlueSite && enemyDistance <= blueEngageRange + 100) ||
    (plannedWeapon?.weaponClass === 'sniper' &&
      enemyDistance <= (plannedWeapon.range ?? 760) * confidenceEngagementScale) ||
    targetEnemy.id === flag.heldBy));
  const visibleDamageThreat = activeDamageCue && targetIsVisible && targetEnemy &&
    Math.abs(normalizeAngle(
      Math.atan2(targetEnemy.y - bot.y, targetEnemy.x - bot.x) - activeDamageCue.bearing,
    )) <= Math.PI / 3
    ? targetEnemy : null;
  const damageThreat = activeDamageCue
    ? visibleDamageThreat ?? personalDamageThreat
    : targetEnemy;
  const rangedThreatNeedsCover = Boolean(activeDamageCue && damageThreat);
  const rangedCoverTarget = rangedThreatNeedsCover
    ? findReloadCover(bot, [damageThreat], match.map, navigationTarget)
    : null;
  if (shouldFight) {
    action = 'fight';
    brain.combatCommitUntil = now + 900;
  } else if (now < (brain.combatCommitUntil ?? 0) && targetEnemy && enemyDistance <= 320) {
    action = 'fight';
  } else {
    brain.combatCommitUntil = 0;
  }

  const bluePressed = Boolean(bot.team === 'blue' && targetEnemy && enemyNearBlueSite &&
    targetEnemy.id !== enemyCarrier?.id && enemyDistance < 145 && distance(bot, defensiveSite) < 360);
  const shouldRetreat = Boolean(bluePressed || ((lowHealth || lowArmor) && targetEnemy && enemyDistance < 330 &&
    settings.aggressiveness < 0.96 && !isCarrier && !smallRedSquad));
  if (bluePressed) action = 'fall-back';
  else if (shouldRetreat) action = 'retreat';
  if (action === 'fight') {
    if (bot.team !== 'red' || (plannedWeapon?.weaponClass === 'sniper' && targetEnemy?.id === flag.heldBy)) {
      navigationTarget = combatMovementTarget(bot, targetEnemy, brain, match.map, roleIndex, plannedWeaponId);
    }
    if (bot.team === 'blue' && targetEnemy?.id !== enemyCarrier?.id) {
      const leash = 300 + (1 - settings.defenseFocus) * 220;
      const dx = navigationTarget.x - defensiveSite.x;
      const dy = navigationTarget.y - defensiveSite.y;
      const length = Math.hypot(dx, dy);
      if (length > leash) navigationTarget = {
        x: defensiveSite.x + dx / length * leash,
        y: defensiveSite.y + dy / length * leash,
      };
    }
  } else if (shouldRetreat) {
    navigationTarget = bot.team === 'blue'
      ? getBlueDefensePost(bot, match.map, roleIndex, roleCount, true, targetEnemy, settings)
      : retreatPoint(bot, targetEnemy, match.map, brain.strafeSign);
  } else if (!targetEnemy && rememberedEnemy && settings.aggressiveness >= 0.65 && settings.thinkingComplexity >= 3 &&
      distance(bot, rememberedEnemy) < 360 &&
      !['capture', 'recover-flag', 'escort', 'intercept', 'hunt-carrier', 'search-flag', 'support', 'leave-spawn'].includes(action)) {
    action = 'hunt';
    navigationTarget = rememberedEnemy;
  }

  if (!activeDamageCue && !shouldFight) {
    const nearbyDamageIncident = (teamIntel?.incidents ?? [])
      .filter((incident) => incident.team === bot.team && incident.kind === 'damage' &&
        incident.victimId !== bot.id && Number.isFinite(incident.bearing) &&
        Number.isFinite(incident.x) && Number.isFinite(incident.y) && incident.expiresAt > now &&
        distance(bot, incident) <= BOT_TEAM_DAMAGE_RESPONSE_RANGE &&
        isOneOfNearestBotResponders(bot, teammates, incident, BOT_TEAM_INTEL_RESPONDER_COUNT))
      .sort((left, right) =>
        distance(bot, left) + Math.max(0, now - (left.observedAt ?? now)) * 0.04 -
        distance(bot, right) - Math.max(0, now - (right.observedAt ?? now)) * 0.04)[0] ?? null;
    if (nearbyDamageIncident) {
      const threatPosition = getEstimatedDamageThreatPosition(
        nearbyDamageIncident, nearbyDamageIncident.bearing, bot.team, teamIntel, match.map, now,
      );
      blindFireIntel = {
        position: threatPosition,
        targetRadius: PLAYER_RADIUS * 2,
        source: 'damage',
      };
      const threatCovered = getTeamCoverageCount(
        threatPosition, match.map, teamIntel, visionObjects, bot.id,
      ) > 0;
      const entrance = threatCovered ? null : getNearbyIntelEntrance(
        bot, match.map, threatPosition, teamIntel, visionObjects,
      );
      const responseAnchor = entrance ?? threatPosition;
      const spreadTarget = getTeamSpreadTarget(
        bot, teammates, responseAnchor, threatCovered ? 110 : 150,
        brain, 'damage-response', roleIndex,
      );
      const cover = findReloadCover(bot, [threatPosition], match.map, spreadTarget);
      action = 'assist-damaged-teammate';
      intelLookTarget = threatPosition;
      navigationTarget = cover ?? spreadTarget;
    } else if (!targetEnemy) {
      const nearbyIncident = (teamIntel?.incidents ?? [])
        .filter((incident) => incident.team === bot.team && incident.kind === 'death' &&
          Number.isFinite(incident.x) && Number.isFinite(incident.y) && incident.expiresAt > now &&
          distance(bot, incident) <= 400)
        .sort((left, right) => distance(bot, left) - distance(bot, right) ||
          right.expiresAt - left.expiresAt)[0];
    if (teamSightingTarget?.urgent) {
      action = 'respond-team-threat';
      intelLookTarget = teamSightingTarget.position;
      if (teamSightingTarget.ageMs <= COMBAT_TARGET_MEMORY_MS) {
        blindFireIntel = {
          position: teamSightingTarget.position,
          targetRadius: PLAYER_RADIUS + Math.min(72, teamSightingTarget.ageMs * 0.06),
          source: 'sighting',
        };
      }
      navigationTarget = getTeamSpreadTarget(
        bot, teammates, teamSightingTarget.position, 95, brain, 'intel-response', roleIndex,
      );
    } else if (nearbyIncident) {
      action = 'respond-teammate-death';
      navigationTarget = { x: nearbyIncident.x, y: nearbyIncident.y };
      intelLookTarget = navigationTarget;
    } else if (teamSightingTarget &&
        distance(bot, teamSightingTarget.position) <= TEAM_SIGHTING_INVESTIGATION_RANGE) {
      action = 'investigate-team-sighting';
      intelLookTarget = teamSightingTarget.position;
      if (teamSightingTarget.ageMs <= COMBAT_TARGET_MEMORY_MS) {
        blindFireIntel = {
          position: teamSightingTarget.position,
          targetRadius: PLAYER_RADIUS + Math.min(72, teamSightingTarget.ageMs * 0.06),
          source: 'sighting',
        };
      }
      navigationTarget = getNearbyIntelEntrance(
        bot, match.map, intelLookTarget, teamIntel, visionObjects,
      ) ?? intelLookTarget;
    } else if (noise) {
      intelLookTarget = { x: noise.x, y: noise.y };
      blindFireIntel = {
        position: intelLookTarget,
        targetRadius: PLAYER_RADIUS + Math.min(96, Math.max(0, noise.radius ?? 0) * 0.5),
        source: 'audio',
      };
      const entrance = getNearbyIntelEntrance(bot, match.map, intelLookTarget, teamIntel, visionObjects);
      action = entrance ? 'watch-entrance' : 'investigate-audio';
      navigationTarget = entrance ?? intelLookTarget;
    }
    }
  }

  if (bot.team === 'blue' && sharedCarrierPosition && !targetEnemy && !activeDamageCue) {
    action = 'hunt-carrier';
    navigationTarget = sharedCarrierPosition;
    intelLookTarget = sharedCarrierPosition;
  }

  // Red may briefly check nearby intel, but repeated distractions must not keep
  // the attacker away from its flag objective indefinitely.
  if (bot.team === 'red' && RED_LOW_PRIORITY_ACTIONS.has(action)) {
    if (now < (brain.redObjectiveRecoveryUntil ?? 0)) {
      action = objective.action;
      navigationTarget = objective.target;
      brain.redObjectiveDetourStartedAt = null;
    } else {
      if (!Number.isFinite(brain.redObjectiveDetourStartedAt)) brain.redObjectiveDetourStartedAt = now;
      if (now - brain.redObjectiveDetourStartedAt >= RED_OBJECTIVE_DETOUR_MS) {
        brain.redObjectiveRecoveryUntil = now + RED_OBJECTIVE_RECOVERY_MS;
        brain.redObjectiveDetourStartedAt = null;
        action = objective.action;
        navigationTarget = objective.target;
      }
    }
  } else {
    brain.redObjectiveDetourStartedAt = null;
  }

  if (assignedPing && !shouldFight && !shouldRetreat && !activeDamageCue && !isCarrier &&
      !friendlyCarrier && !enemyCarrier && !sharedCarrierPosition &&
      !PING_PROTECTED_ACTIONS.has(action) && !(targetEnemy && enemyDistance < 300)) {
    intelLookTarget = { x: assignedPing.x, y: assignedPing.y };
    if (distance(bot, assignedPing) <= 130) {
      action = 'watch-ping';
      navigationTarget = { x: bot.x, y: bot.y };
    } else {
      action = 'investigate-ping';
      navigationTarget = { x: assignedPing.x, y: assignedPing.y };
    }
  }

  const storedCover = brain.reloadCoverTarget;
  const shouldSeekReloadCover = (reload || weaponState.reloading) && visibleEnemies.length > 0;
  if (shouldSeekReloadCover) {
    const cover = storedCover && distance(bot, storedCover) > 36 &&
      isSafeCoverPoint(bot, storedCover, match.map)
      ? storedCover : findReloadCover(bot, visibleEnemies, match.map, navigationTarget);
    if (cover) {
      brain.reloadCoverTarget = { ...cover };
      action = 'reload-cover';
      navigationTarget = cover;
    } else {
      brain.reloadCoverTarget = null;
    }
  } else if (!weaponState.reloading || !storedCover || distance(bot, storedCover) <= 36) {
    brain.reloadCoverTarget = null;
  } else {
    action = 'reload-cover';
    navigationTarget = storedCover;
  }

  if (rangedCoverTarget) {
    brain.combatCoverTarget = { ...rangedCoverTarget };
    action = 'damage-cover';
    navigationTarget = rangedCoverTarget;
  } else {
    brain.combatCoverTarget = null;
  }

  // Taking damage is an urgent local threat even when the shooter is outside
  // engagement range or currently visible. Face and search along the incoming
  // bearing instead of allowing site defense, intel, or reload cover to ignore it.
  if (activeDamageCue && !rangedCoverTarget) {
    action = shouldRetreat ? 'retreat' : 'investigate-damage';
    const reportedThreat = damageThreat ?? {
      x: bot.x + Math.cos(activeDamageCue.bearing) * 100,
      y: bot.y + Math.sin(activeDamageCue.bearing) * 100,
    };
    navigationTarget = retreatPoint(bot, reportedThreat, match.map, brain.strafeSign);
  }

  if (!activeDamageCue && bot.team === 'red' && objective.action === 'leave-spawn' &&
      !['investigate-audio', 'damage-cover', 'assist-damaged-teammate', 'respond-team-threat'].includes(action)) {
    action = 'leave-spawn';
    navigationTarget = objective.target;
    brain.reloadCoverTarget = null;
    brain.redObjectiveDetourStartedAt = null;
  }

  if (!activeDamageCue && bot.team === 'blue' && !['investigate-damage', 'damage-cover', 'assist-damaged-teammate']
      .includes(action) && !isCarrier && !enemyCarrier &&
      !(sharedCarrierPosition && action === 'hunt-carrier' && !targetEnemy)) {
    const site = center(match.map.spawnZones.blue);
    const leash = 250 + (1 - settings.defenseFocus) * 70;
    const dx = navigationTarget.x - site.x;
    const dy = navigationTarget.y - site.y;
    const length = Math.hypot(dx, dy);
    if (length > leash) {
      navigationTarget = {
        x: site.x + dx / length * leash,
        y: site.y + dy / length * leash,
      };
    }
  }

  let armorRecoveryActive = false;
  const canRegenerateArmor = maximumArmor > 0 && inventoryEffects.armorRegeneration > 0;
  const armorRecoveryNeeded = canRegenerateArmor && !isCarrier &&
    currentArmor < maximumArmor - 0.01;
  if (!armorRecoveryNeeded) {
    brain.armorRecovery = false;
    brain.armorRecoveryCoverTarget = null;
  } else if (lowArmor) {
    brain.armorRecovery = true;
  }
  const immediateArmorThreat = visibleEnemies.some((enemy) => distance(bot, enemy) < 155);
  if (brain.armorRecovery && armorRecoveryNeeded && !activeDamageCue &&
      !immediateArmorThreat && !bluePressed) {
    const armorThreats = [];
    const addArmorThreat = (threat) => {
      if (![threat?.x, threat?.y].every(Number.isFinite) ||
          armorThreats.some((known) => distance(known, threat) < 90)) return;
      armorThreats.push({ x: threat.x, y: threat.y });
    };
    for (const enemy of visibleEnemies) addArmorThreat(enemy);
    for (const memory of Object.values(brain.rememberedEnemies)
      .filter((entry) => now - entry.seenAt <= 6_000)
      .sort((left, right) => distance(bot, left) - distance(bot, right))
      .slice(0, 4)) addArmorThreat(memory);
    if (teamSightingTarget) addArmorThreat(teamSightingTarget.position);
    if (noise) addArmorThreat(noise);
    if (personalDamageThreat) addArmorThreat(personalDamageThreat);

    const storedArmorCover = brain.armorRecoveryCoverTarget;
    const storedCoverStillWorks = storedArmorCover && isSafeCoverPoint(bot, storedArmorCover, match.map) &&
      armorThreats.length > 0 &&
      armorThreats.every((threat) => !hasClearLine(threat, storedArmorCover, match.map.objects ?? []));
    const cover = storedCoverStillWorks
      ? storedArmorCover
      : armorThreats.length > 0
        ? findReloadCover(bot, armorThreats, match.map, navigationTarget)
        : null;
    const alreadySheltered = armorThreats.length > 0 &&
      armorThreats.every((threat) => !hasClearLine(threat, bot, match.map.objects ?? []));
    if (cover || alreadySheltered) {
      armorRecoveryActive = true;
      action = 'armor-recovery';
      if (cover) {
        brain.armorRecoveryCoverTarget = { ...cover };
        navigationTarget = cover;
      } else {
        navigationTarget = { x: bot.x, y: bot.y };
      }
    }
  }

  let tacticalLean = 0;
  let approachingCover = false;
  let clearanceSweepTarget = null;
  const coverThreat = targetEnemy ?? personalDamageThreat ?? teamSightingTarget?.position ??
    intelLookTarget ?? (action === 'hold-site' ? brain.defenseWatchTarget : null);
  if (coverThreat && ['hold-site', 'defend', 'fight', 'watch-entrance', 'assist-damaged-teammate'].includes(action)) {
    const holdsBluePost = bot.team === 'blue' && brain.defensePost &&
      ['hold-site', 'defend', 'fight'].includes(action);
    const coverPlan = getCachedTacticalCoverPlan(
      bot, coverThreat, holdsBluePost ? brain.defensePost : navigationTarget, match.map, brain, now,
      action === 'fight' && !holdsBluePost ? 'combat' : 'hold',
      action === 'hold-site' || action === 'defend',
      teammates,
      teamContext.teammateTacticalPositions ?? [],
    );
    if (coverPlan) {
      navigationTarget = coverPlan.point;
      if (distance(bot, coverPlan.point) <= PLAYER_RADIUS * 2.5) tacticalLean = coverPlan.lean;
      else approachingCover = true;
    }
  }

  const previousStuckCount = brain.stuckCount ?? 0;
  const activeHazards = (match.gadgetEffects ?? []).filter((effect) =>
    (['molotov', 'cryo'].includes(effect.type) ||
      (effect.type === BIO_FIELD_ID && effect.team !== bot.team)) &&
    effect.startedAt <= now && effect.expiresAt > now);
  activeHazards.push(...visibleEnemyMines
    .filter((effect) => ['mine', VINE_TRAP_ID].includes(effect.type))
    .map((effect) => ({
      ...effect,
      radius: effect.triggerRadius ?? effect.radius ?? PROXIMITY_MINE_TRIGGER_RADIUS,
    })));
  const reactedOrbitalWarnings = getReactedOrbitalStrikeWarnings(match, bot, brain, now, settings.reflexMs);
  activeHazards.push(...reactedOrbitalWarnings);
  const escapingHazard = activeHazards.some((effect) =>
    ['molotov', 'mine', 'orbital-strike-warning'].includes(effect.type) &&
    distance(bot, effect) <= (effect.radius ?? 60) + PLAYER_RADIUS);
  let routeTarget = null;
  if (CLEARING_ACTIONS.has(action)) {
    routeTarget = getNavigationTarget(bot, navigationTarget, match.map, brain, now, mapStrategy);
    const sweepTarget = targetEnemy ?? teamSightingTarget?.position ?? intelLookTarget ?? navigationTarget;
    const routeKey = `${Math.round(navigationTarget.x / 48)}:${Math.round(navigationTarget.y / 48)}`;
    const continuingClearance = brain.clearanceCover?.routeKey === routeKey;
    if ((distance(bot, navigationTarget) > 125 || continuingClearance) &&
        !hasClearLine(bot, sweepTarget, match.map.objects ?? [])) {
      const clearance = getClearanceCoverPlan(
        bot, sweepTarget, routeTarget, navigationTarget, match.map, brain, now,
        roomClearanceHoldMs,
      );
      if (clearance) {
        clearanceSweepTarget = sweepTarget;
        if (clearance.stage === 'hold') {
          action = 'clear-cover-hold';
          navigationTarget = { x: bot.x, y: bot.y };
          tacticalLean = clearance.lean;
          routeTarget = navigationTarget;
        } else {
          action = 'clear-cover';
          navigationTarget = clearance.point;
          approachingCover = true;
          routeTarget = clearance.point;
        }
      }
    } else {
      brain.clearanceCover = null;
    }
  }
  let waypoint = chooseHazardAwareWaypoint(bot,
    routeTarget ?? getNavigationTarget(bot, navigationTarget, match.map, brain, now, mapStrategy),
    match.map, activeHazards, now);
  updateNavigationProgress(bot, brain, now, navigationTarget, action, waypoint);
  if ((brain.stuckCount ?? 0) > previousStuckCount) {
    waypoint = chooseHazardAwareWaypoint(bot,
      getNavigationTarget(bot, navigationTarget, match.map, brain, now, mapStrategy),
      match.map, activeHazards, now);
    updateNavigationProgress(bot, brain, now, navigationTarget, action, waypoint);
  }
  const move = directionInput(bot, waypoint);
  brain.lastWasMoving = move.up || move.down || move.left || move.right;
  const isSpottedByEnemy = visibleEnemies.some((enemy) =>
    isBotSpottedByEnemy(bot, enemy, match.map, visionObjects, now));
  const nearbyKnownThreat = visibleEnemies.some((enemy) => distance(bot, enemy) <= 650) ||
    Object.values(brain.rememberedEnemies).some((memory) =>
      now - memory.seenAt <= 4_000 && distance(bot, memory) <= 650) ||
    (teamSightingTarget && distance(bot, teamSightingTarget.position) <= 650) ||
    (noise && distance(bot, noise) <= 700) ||
    teamPings.some((ping) => distance(bot, ping) <= 650);
  const canHideFootsteps = roomEntryConfidence < 0.5 && brain.lastWasMoving &&
    nearbyKnownThreat && !isSpottedByEnemy && action !== 'fight' && !activeDamageCue;
  const movementSpeedScale = clamp(
    0.68 + baseEffectiveAggression * 0.22 + settings.objectiveFocus * 0.1, 0.68, 1,
  ) * (canHideFootsteps ? SLOW_WALK_SPEED_SCALE : 1) *
    (approachingCover && distance(bot, navigationTarget) <= 96 &&
      !isSpottedByEnemy && action !== 'fight' && !activeDamageCue
      ? SLOW_WALK_SPEED_SCALE : 1);

  const damageBearingTarget = personalDamageThreat;
  const enemyLaneIsClear = Boolean(targetIsVisible && targetEnemy &&
    getVisibleEnemyAimPoint(
      bot, targetEnemy, vision, visionObjects, match.map, weapon, teammates, tacticalLean,
    ));
  const canShootMine = (mine) => isShotLaneClear(
    bot, mine, unitVector(bot, mine), match.map, weapon, teammates,
    mine.hitRadius ?? (mine.type === VINE_TRAP_ID ? PROXIMITY_MINE_HIT_RADIUS : PROXIMITY_MINE_BODY_RADIUS),
  );
  const vineTrapOnPath = visibleEnemyMines.find((mine) =>
    mine.type === VINE_TRAP_ID &&
    getSegmentCircleLength(bot, waypoint, mine,
      (mine.triggerRadius ?? PROXIMITY_MINE_TRIGGER_RADIUS) + PLAYER_RADIUS) > 0 &&
    canShootMine(mine));
  const mineTarget = vineTrapOnPath ?? visibleEnemyMines.find(canShootMine) ?? null;
  const deployableTarget = visibleEnemyDeployables.find((deployable) => isShotLaneClear(
    bot, deployable, unitVector(bot, deployable), match.map, weapon, teammates,
    deployable.radius ?? (deployable.type === TROPHY_SYSTEM_ID
      ? TROPHY_SYSTEM_BODY_RADIUS : SPY_CAMERA_BODY_RADIUS),
  )) ?? null;
  const aimAtMine = Boolean(mineTarget && (!enemyLaneIsClear || mineTarget === vineTrapOnPath));
  const aimAtDeployable = Boolean(!aimAtMine && deployableTarget && !enemyLaneIsClear);
  const shotLean = aimAtMine || aimAtDeployable ? 0 : tacticalLean;
  const visibleEnemyAimPoint = targetIsVisible && targetEnemy
    ? getVisibleEnemyAimPoint(
      bot, targetEnemy, vision, visionObjects, match.map, weapon, teammates, shotLean,
    )
    : null;
  const rememberedTargetAge = targetEnemy && !targetIsVisible
    ? now - (brain.rememberedEnemies[targetEnemy.id]?.seenAt ?? -Infinity)
    : Infinity;
  const blindFireCandidate = !targetIsVisible
    ? activeDamageCue && personalDamageThreat
      ? { position: personalDamageThreat, targetRadius: PLAYER_RADIUS * 2, source: 'damage' }
      : blindFireIntel?.source === 'damage' || blindFireIntel?.source === 'sighting'
        ? blindFireIntel
        : targetEnemy && rememberedTargetAge <= COMBAT_TARGET_MEMORY_MS
          ? {
            position: targetEnemy,
            targetRadius: PLAYER_RADIUS + Math.min(36, rememberedTargetAge * 0.04),
            source: 'memory',
          }
          : blindFireIntel
    : null;
  if (!intelLookTarget && !targetEnemy && !activeDamageCue) {
    const watchPing = teamPings
      .filter((ping) => distance(bot, ping) <= 700)
      .sort((left, right) => distance(bot, left) - distance(bot, right) ||
        (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
    if (watchPing) intelLookTarget = { x: watchPing.x, y: watchPing.y };
  }
  const aimTarget = aimAtMine ? mineTarget : aimAtDeployable ? deployableTarget :
    blindFireCandidate?.position ?? visibleEnemyAimPoint ?? targetEnemy ?? damageBearingTarget ?? intelLookTarget ?? (bot.team === 'blue' && action === 'hold-site' && brain.defenseWatchTarget
    ? brain.defenseWatchTarget : clearanceSweepTarget ?? (action === 'hunt' ? navigationTarget : waypoint));
  const dx = aimTarget.x - bot.x;
  const dy = aimTarget.y - bot.y;
  const aimBearing = Math.atan2(dy || Math.sin(visionAngle), dx || Math.cos(visionAngle));
  const navigationBearing = Math.atan2(waypoint.y - bot.y || Math.sin(visionAngle),
    waypoint.x - bot.x || Math.cos(visionAngle));
  const scanRate = 0.0008 + effectiveAggression * 0.0012;
  const scanWave = Math.sin(now * scanRate + (hashString(bot.id) % 628) / 100) * Math.PI * 0.45;
  const aimErrorTarget = aimAtMine ? mineTarget : aimAtDeployable ? deployableTarget : targetEnemy;
  const aimError = aimErrorTarget ? (1 - settings.accuracy) * 0.12 *
    (hashString(`${bot.id}:${aimErrorTarget.id}`) % 2 ? 1 : -1) : 0;
  const aimBaseAngle = shotLean === 0
    ? aimBearing
    : getWeaponAimAngle(bot, aimTarget, shotLean, match.map.objects);
  const aimScanOffset = clearanceSweepTarget ? scanWave * 0.55
    : tacticalLean !== 0 || activeDamageCue || intelLookTarget ? 0 : scanWave;
  const aimAngle = aimErrorTarget ? aimBaseAngle + aimError : aimBaseAngle + aimScanOffset;
  const direction = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const inReflexWindow = !aimAtMine && targetEnemy &&
    now - (brain.rememberedEnemies[targetEnemy.id]?.firstSeenAt ?? now) < settings.reflexMs;
  const currentAim = weaponState.aimAngle ?? visionAngle;
  const aimReady = Math.abs(normalizeAngle(aimAngle - currentAim)) <= 0.12;
  const safeShot = targetIsVisible && !aimAtMine &&
    isShotLaneClear(bot, targetEnemy, direction, match.map, weapon, teammates,
      PLAYER_RADIUS, shotLean);
  const safeBlindShot = Boolean(blindFireCandidate && !aimAtMine && !aimAtDeployable &&
    isShotLaneClear(bot, blindFireCandidate.position, direction, match.map, weapon, teammates,
      blindFireCandidate.targetRadius, shotLean));
  const safeMineShot = aimAtMine && isShotLaneClear(bot, mineTarget, direction, match.map, weapon, teammates,
    mineTarget.hitRadius ?? (mineTarget.type === VINE_TRAP_ID
      ? PROXIMITY_MINE_HIT_RADIUS : PROXIMITY_MINE_BODY_RADIUS), shotLean);
  const safeDeployableShot = aimAtDeployable && isShotLaneClear(
    bot, deployableTarget, direction, match.map, weapon, teammates,
    deployableTarget.radius ?? (deployableTarget.type === TROPHY_SYSTEM_ID
      ? TROPHY_SYSTEM_BODY_RADIUS : SPY_CAMERA_BODY_RADIUS), shotLean,
  );
  const canInterruptRoundReload = Boolean(weapon.reloadPerRound && weaponState.reloading && ammo > 0);
  const gadgetAction = chooseBotGadgetAction(bot, match, visibleEnemies, teammates, now, {
    visionObjects,
    vision,
    armorRecovery: armorRecoveryActive,
    lowHealth,
    isCarrier,
    action,
    activeDamageCue,
    teamIntel: teamContext?.teamIntel,
    worldState,
    retreating: action === 'retreat' || action === 'fall-back',
    moving: brain.lastWasMoving,
    waypoint,
  });
  const gadgetSlotTransitioning = Number.isFinite(bot.gadgetSwitchEndsAt) && bot.gadgetSwitchEndsAt > now;
  const weaponSlotEquipped = !gadgetSlotTransitioning && getBotEquippedSlot(bot, now) === 'weapon';

  return {
    action,
    target: { x: navigationTarget.x, y: navigationTarget.y },
    waypoint,
    input: {
      ...move,
      visionAngle: normalizeAngle(aimAngle),
      drop: false,
      weaponLean: shotLean,
      speedScale: movementSpeedScale,
    },
    direction,
    enemyId: targetEnemy?.id ?? null,
    ...(gadgetAction ? { gadgetAction } : {}),
    fire: Boolean(weaponSlotEquipped && !armorRecoveryActive && !gadgetAction &&
      ((targetIsVisible && !inReflexWindow && safeShot) ||
        (!inReflexWindow || blindFireCandidate?.source !== 'memory') && safeBlindShot ||
        safeMineShot || safeDeployableShot) && aimReady && !reload &&
      (!weaponState.reloading || canInterruptRoundReload)),
    reload: Boolean(weaponSlotEquipped && !gadgetAction && reload),
    weaponId: plannedWeaponId,
    thinkingTimeMs: escapingHazard
      ? 50
      : Math.max(50, settings.thinkingTimeMs * (1 - effectiveAggression * 0.35)),
    objectiveScore: (bot.team === 'red' ? settings.objectiveFocus * (100 + redTimePressure * 100)
      : settings.defenseFocus * 100),
  };
}

function chooseObjective(player, match, settings, brain, teammates, carrier, friendlyCarrier, enemyCarrier, rememberedCarrier, now, teamContext) {
  const flag = match.flag;
  const home = match.map.spawnZones[player.team];
  const enemySite = center(match.map.spawnZones[player.team === 'red' ? 'blue' : 'red']);
  if (player.team === 'red') {
    const insideHome = pointInsideRect(player, home, 8);
    if (!brain.spawnExited && insideHome) {
      if (!brain.spawnExitTarget) {
        const exit = getSpawnExit(match.map, 'red', teamContext.roleIndex, teamContext.roleCount,
          teammates, enemySite, player.id);
        brain.spawnExitTarget = exit?.outside ?? getSpawnCorridorExit(
          match.map, 'red', teamContext.roleIndex, enemySite) ?? getGeometricSpawnExit(
            match.map, 'red', teamContext.roleIndex, teamContext.roleCount, teammates, enemySite, player.id) ?? enemySite;
      }
      return { action: 'leave-spawn', target: brain.spawnExitTarget };
    }
    if (!insideHome) {
      brain.spawnExited = true;
      brain.spawnExitTarget = null;
    }
  }

  if (player.team === 'red') {
    if (friendlyCarrier?.id === player.id) return { action: 'capture', target: center(home) };
    if (friendlyCarrier) {
      const homeCenter = center(home);
      const towardHome = unitVector(friendlyCarrier, homeCenter);
      const offset = (teamContext.roleIndex - (teamContext.roleCount - 1) / 2) * 90;
      return { action: 'escort', target: {
        x: clamp(friendlyCarrier.x + towardHome.x * 100 - towardHome.y * offset,
          PLAYER_RADIUS + 8, match.map.width - PLAYER_RADIUS - 8),
        y: clamp(friendlyCarrier.y + towardHome.y * 100 + towardHome.x * offset,
          PLAYER_RADIUS + 8, match.map.height - PLAYER_RADIUS - 8),
      } };
    }
    if (enemyCarrier) {
      const lastKnown = rememberedCarrier ?? enemyCarrier;
      return { action: rememberedCarrier ? 'hunt-carrier' : 'intercept', target: lastKnown };
    }
    if (carrier?.team === 'blue') {
      const lastKnown = rememberedCarrier ?? { x: flag.x, y: flag.y };
      return { action: rememberedCarrier ? 'hunt-carrier' : 'search-flag', target: getExploreTarget(
        player, match.map, brain, teammates, lastKnown, 260 + teamContext.aggression * 130,
        now, teamContext.roleIndex, teamContext.roleCount, enemySite,
        teamContext.teamIntel, teamContext.visionObjects) };
    }
    const flagGoalKey = `${Math.round(flag.x / 64)}:${Math.round(flag.y / 64)}:${flag.dropped === true}`;
    if (brain.flagRunnerGoalKey !== flagGoalKey) {
      brain.flagRunnerGoalKey = flagGoalKey;
      brain.flagRunnerId = null;
    }
    let runner = teammates.find((ally) => ally.id === brain.flagRunnerId);
    if (!runner) {
      runner = [...teammates].sort((a, b) => distance(a, flag) - distance(b, flag) || a.id.localeCompare(b.id))[0];
      brain.flagRunnerId = runner?.id ?? null;
    }
    if (!runner || runner.id === player.id) {
      return { action: flag.dropped ? 'recover-flag' : 'capture', target: flag };
    }
    const attackDirection = unitVector(center(home), flag);
    const laneSpacing = 90 + (1 - settings.objectiveFocus) * 120 +
      (1 - settings.aggressiveness) * 30;
    const leadDistance = 65 + (1 - settings.aggressiveness) * 100;
    const lane = (teamContext.roleIndex - (teamContext.roleCount - 1) / 2) * laneSpacing;
    return { action: 'support', target: {
      x: clamp(flag.x - attackDirection.x * leadDistance - attackDirection.y * lane,
        PLAYER_RADIUS + 8, match.map.width - PLAYER_RADIUS - 8),
      y: clamp(flag.y - attackDirection.y * leadDistance + attackDirection.x * lane,
        PLAYER_RADIUS + 8, match.map.height - PLAYER_RADIUS - 8),
    } };
  }

  const site = center(match.map.spawnZones.blue);
  const post = getBlueDefensePost(player, match.map, teamContext.roleIndex,
    teamContext.roleCount, false, null, settings, brain,
    teamContext.teamIntel, teamContext.visionObjects, teammates,
    teamContext.teammateTacticalPositions, teamContext.confidence,
    teamContext.defensiveThreats);
  if (enemyCarrier) return { action: 'defend', target: rememberedCarrier ?? enemyCarrier };
  if (teamContext.sharedCarrierPosition) {
    return { action: 'hunt-carrier', target: teamContext.sharedCarrierPosition };
  }
  const visibleThreat = teamContext.perceivedThreat;
  if (visibleThreat && distance(visibleThreat, site) <= 420 && distance(player, visibleThreat) <= 300) {
    return { action: 'defend', target: visibleThreat };
  }
  return { action: 'hold-site', target: post };
}

function getRoomEntryConfidence(
  bot, teammates, enemies, visibleEnemies, targetEnemy, enemyDistance, weapon,
  settings, effectiveAggression, now, match, teamIntel, maximumArmor, currentArmor,
) {
  const nearbyAllies = teammates.filter((ally) =>
    ally.alive !== false && (ally.health ?? 100) > 0 && distance(bot, ally) <= 420).length;
  const nearbyEnemies = visibleEnemies.filter((enemy) => distance(bot, enemy) <= 520);
  const nearbyAudioThreats = [];
  for (const cue of [...(teamIntel?.audioCues ?? []), ...(match.botNoises ?? [])]) {
    if (cue.team !== bot.team || cue.expiresAt <= now ||
        !['footstep', 'gunshot'].includes(cue.kind) ||
        (cue.audiencePlayerId && cue.audiencePlayerId !== bot.id) ||
        ![cue.x, cue.y].every(Number.isFinite) ||
        distance(bot, cue) > Math.min(850, (cue.radius ?? 180) + 480) ||
        nearbyEnemies.some((enemy) => distance(enemy, cue) <= 120) ||
        nearbyAudioThreats.some((position) => distance(position, cue) <= 150)) continue;
    nearbyAudioThreats.push({ x: cue.x, y: cue.y });
    if (nearbyAudioThreats.length >= 4) break;
  }
  for (const ping of teamIntel?.pings ?? []) {
    if (nearbyAudioThreats.length >= 4) break;
    if (ping.team !== bot.team || !Number.isFinite(ping.expiresAt) || ping.expiresAt <= now ||
        ![ping.x, ping.y].every(Number.isFinite) || distance(bot, ping) > 850 ||
        nearbyEnemies.some((enemy) => distance(enemy, ping) <= 120) ||
        nearbyAudioThreats.some((position) => distance(position, ping) <= 150)) continue;
    nearbyAudioThreats.push({ x: ping.x, y: ping.y });
  }
  const sensedEnemies = nearbyEnemies.length + nearbyAudioThreats.length;
  const localAdvantage = (nearbyAllies - sensedEnemies) /
    Math.max(1, nearbyAllies + sensedEnemies);
  const knownEnemyCount = Math.max(enemies.length, sensedEnemies);
  const teamAdvantage = (teammates.length - knownEnemyCount) /
    Math.max(1, teammates.length + knownEnemyCount);
  const impairedEnemies = nearbyEnemies.filter((enemy) =>
    isPlayerFlashBlinded(enemy, now) || isPlayerJammed(enemy, now)).length;
  const utilityAdvantage = impairedEnemies / Math.max(1, nearbyEnemies.length);
  const preferredRange = (weapon.damageFalloffStartRange ?? weapon.range * 0.5) * 0.65;
  const weaponRangeFit = targetEnemy
    ? clamp(1 - Math.abs(enemyDistance - preferredRange) / Math.max(preferredRange, 120), 0, 1)
    : 0;
  const healthConfidence = clamp((bot.health ?? 100) / 100, 0, 1);
  const armorConfidence = maximumArmor > 0 ? clamp(currentArmor / maximumArmor, 0, 1) : 1;
  const resilienceConfidence = healthConfidence * 0.65 + armorConfidence * 0.35;
  const tacticalConfidence = clamp(
    0.5 + localAdvantage * 0.5 + teamAdvantage * 0.1 +
      utilityAdvantage * 0.18 + weaponRangeFit * 0.12 +
      (resilienceConfidence - 0.7) * 0.4,
    0, 1,
  );
  return clamp(
    tacticalConfidence * 0.55 + effectiveAggression * 0.25 +
      (settings.objectiveFocus + settings.defenseFocus) * 0.1,
    0, 1,
  );
}

function getSharedFlagCarrierPosition(bot, match, teamIntel, now, playersById = null) {
  const carrierId = match.flag?.heldBy;
  const carrier = playersById?.get(carrierId) ?? match.players.find((player) => player.id === carrierId);
  if (!carrier || carrier.team === bot.team || !carrier.alive || carrier.health <= 0) return null;

  const sighting = (teamIntel?.sightings ?? [])
    .filter((entry) => entry.team === bot.team && entry.enemyId === carrierId &&
      Number.isFinite(entry.expiresAt) && entry.expiresAt > now &&
      Number.isFinite(entry.x) && Number.isFinite(entry.y))
    .sort((left, right) => (right.observedAt ?? now) - (left.observedAt ?? now))[0];
  if (!sighting) return null;

  const observedAt = Number.isFinite(sighting.observedAt) ? sighting.observedAt : now;
  const ageMs = Math.max(0, now - observedAt);
  if (ageMs > 6_000) return null;
  const leadSeconds = Math.min(0.35, ageMs / 1_000);
  let leadX = (sighting.vx ?? 0) * leadSeconds;
  let leadY = (sighting.vy ?? 0) * leadSeconds;
  const leadDistance = Math.hypot(leadX, leadY);
  if (leadDistance > 120) {
    leadX *= 120 / leadDistance;
    leadY *= 120 / leadDistance;
  }
  return {
    x: clamp(sighting.x + leadX, PLAYER_RADIUS, match.map.width - PLAYER_RADIUS),
    y: clamp(sighting.y + leadY, PLAYER_RADIUS, match.map.height - PLAYER_RADIUS),
  };
}

function pointInsideRect(point, rect, margin = 0) {
  return point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin &&
    point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
}

function chooseProtectedDefensePost(player, map, roleIndex, roleCount, brain, teamIntel,
  visionObjects, teammates, teammateTacticalPositions, settings, confidence, threatPositions) {
  const zone = map.spawnZones?.blue;
  if (!zone) return null;
  const blueRoom = (map.rooms ?? []).find((room) => room.id === 'blue-spawn' || (room.isSpawn && room.team === 'blue'));
  const ingresses = (map.corridors ?? []).filter((corridor) =>
    corridor.a === blueRoom?.id || corridor.b === blueRoom?.id)
    .map((corridor) => {
      const points = corridor.a === blueRoom.id ? corridor.points ?? [] : [...(corridor.points ?? [])].reverse();
      const doorway = points[0];
      if (!doorway || !points[1]) return null;
      return {
        id: corridor.id,
        points,
        doorway,
      };
    }).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!ingresses.length) return null;

  const defaultIngress = ingresses[roleIndex % ingresses.length];
  const threatenedIngress = ingresses
    .map((candidate) => getDefenseThreatPressure(candidate, threatPositions, map))
    .sort((left, right) => right.pressure - left.pressure)[0];
  const ingress = threatenedIngress?.pressure >= 0.2
    ? threatenedIngress.route : defaultIngress;
  const laneIndex = Math.floor(roleIndex / ingresses.length);
  const laneCount = Math.ceil(Math.max(1, roleCount) / ingresses.length);
  const reservations = getReservedDefensePositions(player.id, teammates, teammateTacticalPositions);
  const watchTarget = chooseDistinctIngressWatchTarget(
    ingress.points, 180 + laneIndex * 130, map, reservations,
  );
  if (brain) brain.defenseWatchTarget = { ...watchTarget };
  const direction = unitVector(ingress.points[0], ingress.points[1]);
  const laneOffset = (laneIndex - (laneCount - 1) / 2) * 72;
  const lateral = { x: -direction.y, y: direction.x };
  const lateralLength = Math.hypot(lateral.x, lateral.y) || 1;
  const laneAnchor = {
    x: ingress.doorway.x + lateral.x / lateralLength * laneOffset,
    y: ingress.doorway.y + lateral.y / lateralLength * laneOffset,
  };
  const site = center(zone);
  const defensePosture = getBlueDefensePosture(settings, confidence);
  const preferred = {
    x: site.x + (laneAnchor.x - site.x) * defensePosture,
    y: site.y + (laneAnchor.y - site.y) * defensePosture,
  };
  const threat = (threatPositions ?? [])
    .filter((position) => getStrikeMineProgress(position, map) >= 0.55)
    .sort((left, right) =>
      distance(left, site) - distance(right, site))[0];
  if (threat && defensePosture > 0.5) {
    preferred.x = site.x + (preferred.x - site.x) * 0.65 + (threat.x - site.x) * 0.35;
    preferred.y = site.y + (preferred.y - site.y) * 0.65 + (threat.y - site.y) * 0.35;
  }
  const candidates = [];
  const steps = 6;
  for (let xIndex = 0; xIndex < steps; xIndex += 1) {
    for (let yIndex = 0; yIndex < steps; yIndex += 1) {
      const candidate = {
        x: zone.x + PLAYER_RADIUS + 8 + (zone.width - (PLAYER_RADIUS + 8) * 2) * xIndex / (steps - 1),
        y: zone.y + PLAYER_RADIUS + 8 + (zone.height - (PLAYER_RADIUS + 8) * 2) * yIndex / (steps - 1),
      };
      if (circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS) ||
          !hasClearLine(candidate, watchTarget, map.objects ?? [])) continue;
      const protectedRoutes = ingresses.filter((route) => route.id !== ingress.id &&
        !hasClearLine(candidate, pointAlongPolylineExtended(route.points, 130, map), map.objects ?? [])).length;
      const interiorDepth = Math.min(candidate.x - zone.x, zone.x + zone.width - candidate.x,
        candidate.y - zone.y, zone.y + zone.height - candidate.y);
      const score = distance(candidate, preferred) * 0.55 + distance(candidate, site) *
        (0.25 - defensePosture * 0.17) -
        protectedRoutes * 115 - Math.min(interiorDepth, 48) * 0.25 +
        getDefenseSpacingPenalty(candidate, watchTarget, reservations) +
        getTeamCoverageCount(watchTarget, map, teamIntel, visionObjects, player.id) * 100 +
        ((hashString(`${player.id}:${ingress.id}:${xIndex}:${yIndex}`) % 11) * 0.1);
      candidates.push({ point: candidate, watchTarget, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (!candidates.length) return null;
  if (brain) brain.defenseWatchTarget = { ...candidates[0].watchTarget };
  return candidates[0].point;
}

function findReloadCover(player, enemies, map, objective) {
  const objects = map.objects ?? [];
  const candidates = getCoverCandidates(player, map, 285, PLAYER_RADIUS + 12);

  const scoredCandidates = candidates.map((point, index) => ({
    point,
    index,
    baseScore: distance(player, point) + (objective ? distance(point, objective) * 0.12 : 0),
  })).sort((left, right) => left.baseScore - right.baseScore || left.index - right.index);
  let best = null;
  let bestScore = Infinity;
  let bestIndex = Infinity;
  for (const candidate of scoredCandidates) {
    if (candidate.baseScore - enemies.length * 170 > bestScore) break;
    if (!isSafeCoverPoint(player, candidate.point, map)) continue;
    let hiddenCount = 0;
    for (const enemy of enemies) {
      if (!hasClearLine(enemy, candidate.point, objects)) hiddenCount += 1;
    }
    if (hiddenCount === 0) continue;
    const score = candidate.baseScore - hiddenCount * 170;
    if (score < bestScore || (score === bestScore && candidate.index < bestIndex)) {
      best = candidate.point;
      bestScore = score;
      bestIndex = candidate.index;
    }
    if (hiddenCount === enemies.length) break;
  }
  return best;
}

function getCoverCandidates(player, map, maximumDistance, offset, includeCurrent = false) {
  const candidates = [];
  const candidateKeys = new Set();
  const maximumDistanceSquared = maximumDistance * maximumDistance;
  const addCandidate = (candidate) => {
    const dx = candidate.x - player.x;
    const dy = candidate.y - player.y;
    if (dx * dx + dy * dy > maximumDistanceSquared ||
        candidate.x < PLAYER_RADIUS + 8 || candidate.y < PLAYER_RADIUS + 8 ||
        candidate.x > map.width - PLAYER_RADIUS - 8 || candidate.y > map.height - PLAYER_RADIUS - 8) return;
    const key = `${candidate.x},${candidate.y}`;
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push(candidate);
  };
  if (includeCurrent) addCandidate({ x: player.x, y: player.y });
  for (const object of map.objects ?? []) {
    if (object.blocksVision === false || object.blocksProjectiles === false) continue;
    const point = object.shape === 'segment'
      ? { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 }
      : object;
    const extent = object.shape === 'circle' ? object.radius
      : object.shape === 'rect' ? Math.hypot(object.width, object.height) / 2
        : Math.hypot(object.x2 - object.x1, object.y2 - object.y1) / 2;
    const objectReach = maximumDistance + 15 + extent;
    const dx = point.x - player.x;
    const dy = point.y - player.y;
    if (dx * dx + dy * dy > objectReach * objectReach) continue;
    if (object.shape === 'segment') {
      const length = Math.hypot(object.x2 - object.x1, object.y2 - object.y1) || 1;
      const normal = { x: -(object.y2 - object.y1) / length, y: (object.x2 - object.x1) / length };
      for (const t of COVER_SEGMENT_FRACTIONS) {
        const along = { x: object.x1 + (object.x2 - object.x1) * t, y: object.y1 + (object.y2 - object.y1) * t };
        for (const sign of [-1, 1]) addCandidate({
          x: along.x + normal.x * offset * sign,
          y: along.y + normal.y * offset * sign,
        });
      }
      for (const endpoint of [{ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }]) {
        for (const direction of COVER_ENDPOINT_DIRECTIONS) {
          const endpointOffset = offset + 2;
          addCandidate({
            x: endpoint.x + direction.x * endpointOffset,
            y: endpoint.y + direction.y * endpointOffset,
          });
        }
      }
    } else {
      const radius = extent + offset;
      for (const direction of COVER_RADIAL_DIRECTIONS) {
        addCandidate({ x: point.x + direction.x * radius, y: point.y + direction.y * radius });
      }
    }
  }
  return candidates;
}

function getCachedTacticalCoverPlan(player, threat, preferredPoint, map, brain, now, mode, allowFallback,
  teammates, teammateTacticalPositions) {
  const threatKey = threat.id ?? `${Math.round(threat.x / 48)}:${Math.round(threat.y / 48)}`;
  const preferredKey = `${Math.round(preferredPoint.x / 32)}:${Math.round(preferredPoint.y / 32)}`;
  const key = `${mode}:${threatKey}:${preferredKey}`;
  const cache = brain.tacticalCoverCache;
  if (cache?.key === key && now < cache.retryAt) {
    if (!cache.point) return null;
    if (isSafeCoverPoint(player, cache.point, map) &&
        !isOccupiedDefensivePosition(cache.point, player.id, teammates, teammateTacticalPositions)) {
      if (cache.requiresPeek) {
        const lean = getPeekLeanAtPosition(cache.point, threat, map, brain.strafeSign);
        if (lean !== null) return { point: cache.point, lean };
      } else if (!hasClearLine(threat, cache.point, map.objects ?? [])) {
        return { point: cache.point, lean: 0 };
      }
    }
  }

  const candidates = getCoverCandidates(
    player, map, TACTICAL_COVER_SEARCH_RANGE, PLAYER_RADIUS + 2, true,
  ).filter((point) => mode !== 'hold' ||
    !isOccupiedDefensivePosition(point, player.id, teammates, teammateTacticalPositions))
    .map((point, index) => ({
      point,
      index,
      score: distance(player, point) + distance(point, preferredPoint) * (mode === 'hold' ? 1.6 : 0.45) +
        (mode === 'hold'
          ? getDefensivePositionSpacingPenalty(point, player.id, teammates, teammateTacticalPositions)
          : 0),
    })).sort((left, right) => left.score - right.score || left.index - right.index);
  let plan = null;
  for (const candidate of candidates) {
    if (!isSafeCoverPoint(player, candidate.point, map)) continue;
    const lean = getPeekLeanAtPosition(candidate.point, threat, map, brain.strafeSign);
    if (lean !== null) {
      plan = { point: candidate.point, lean };
      break;
    }
  }
  if (!plan && allowFallback) {
    const point = findReloadCover(player, [threat], map, preferredPoint);
    if (point && (mode !== 'hold' ||
        !isOccupiedDefensivePosition(point, player.id, teammates, teammateTacticalPositions))) {
      plan = { point, lean: 0 };
    }
  }
  brain.tacticalCoverCache = {
    key,
    point: plan?.point ?? null,
    requiresPeek: Boolean(plan && plan.lean !== 0),
    retryAt: now + TACTICAL_COVER_REPLAN_MS,
  };
  return plan;
}

function getDefensivePositionSpacingPenalty(point, playerId, teammates, teammateTacticalPositions) {
  let penalty = 0;
  for (const ally of teammates) {
    if (ally.id === playerId || ally.alive === false || (ally.health ?? 100) <= 0) continue;
    penalty += Math.max(0, 84 - distance(point, ally)) * 1.5;
    const coverPoint = ally.botBrain?.tacticalCoverCache?.point;
    if (coverPoint) penalty += Math.max(0, 110 - distance(point, coverPoint)) * 3;
    const defensePost = ally.botBrain?.defensePost;
    if (defensePost) penalty += Math.max(0, 72 - distance(point, defensePost)) * 1.5;
  }
  for (const assignment of teammateTacticalPositions) {
    if (assignment.id === playerId) continue;
    if (assignment.coverPoint) {
      penalty += Math.max(0, 110 - distance(point, assignment.coverPoint)) * 3;
    }
    if (assignment.defensePost) {
      penalty += Math.max(0, 72 - distance(point, assignment.defensePost)) * 1.5;
    }
  }
  return penalty;
}

function isOccupiedDefensivePosition(point, playerId, teammates, teammateTacticalPositions) {
  return teammates.some((ally) => {
    if (ally.id === playerId || ally.alive === false || (ally.health ?? 100) <= 0) return false;
    const coverPoint = ally.botBrain?.tacticalCoverCache?.point;
    const defensePost = ally.botBrain?.defensePost;
    return (coverPoint && distance(point, coverPoint) < MIN_DEFENDER_COVER_SPACING) ||
      (defensePost && distance(point, defensePost) < MIN_DEFENDER_POST_SPACING);
  }) ||
    teammateTacticalPositions.some((assignment) => assignment.id !== playerId &&
      ((assignment.coverPoint && distance(point, assignment.coverPoint) < MIN_DEFENDER_COVER_SPACING) ||
        (assignment.defensePost && distance(point, assignment.defensePost) < MIN_DEFENDER_POST_SPACING)));
}

function getPeekLeanAtPosition(position, target, map, preferredLean = 1) {
  const objects = map.objects ?? [];
  if (hasClearLine(target, position, objects)) return null;
  const angle = Math.atan2(target.y - position.y, target.x - position.x);
  const firstLean = preferredLean === -1 ? -1 : 1;
  for (const lean of [firstLean, -firstLean]) {
    const muzzle = getWeaponMuzzlePosition(position, angle, lean, objects);
    if (hasClearLine(muzzle, target, objects)) return lean;
  }
  return null;
}

function getClearanceCoverPlan(player, threat, routeTarget, routeIdentity, map, brain, now, holdDurationMs) {
  const routeKey = `${Math.round(routeIdentity.x / 48)}:${Math.round(routeIdentity.y / 48)}`;
  const existing = brain.clearanceCover;
  if (existing?.routeKey === routeKey) {
    const lean = isSafeCoverPoint(player, existing.point, map)
      ? getPeekLeanAtPosition(existing.point, threat, map, brain.strafeSign)
      : null;
    if (lean !== null) {
      if (distance(player, existing.point) > PLAYER_RADIUS * 2.5) {
        return { point: existing.point, lean: 0, stage: 'approach' };
      }
      existing.holdUntil ??= now + holdDurationMs;
      if (now < existing.holdUntil) return { point: existing.point, lean, stage: 'hold' };
    }
    brain.clearanceCover = null;
  } else {
    brain.clearanceCover = null;
  }

  const plan = findLeanCoverPlan(
    player, threat, routeTarget, map, TACTICAL_COVER_SEARCH_RANGE, true, brain.strafeSign,
  );
  if (!plan) return null;
  brain.clearanceCover = { routeKey, point: plan.point, holdUntil: null };
  return { point: plan.point, lean: 0, stage: 'approach' };
}

function findLeanCoverPlan(player, threat, preferredPoint, map, maximumDistance, mustAdvance, preferredLean) {
  const candidates = getCoverCandidates(
    player, map, maximumDistance, PLAYER_RADIUS + 2, true,
  ).map((point, index) => ({
    point,
    index,
    score: distance(player, point) + distance(point, preferredPoint) * 0.45,
  })).sort((left, right) => left.score - right.score || left.index - right.index);
  const currentGoalDistance = distance(player, preferredPoint);
  for (const candidate of candidates) {
    if (mustAdvance && distance(candidate.point, preferredPoint) > currentGoalDistance - 32) continue;
    if (!isSafeCoverPoint(player, candidate.point, map)) continue;
    const lean = getPeekLeanAtPosition(candidate.point, threat, map, preferredLean);
    if (lean !== null) return { point: candidate.point, lean };
  }
  return null;
}

function isSafeCoverPoint(player, point, map) {
  if (point.x < PLAYER_RADIUS + 8 || point.y < PLAYER_RADIUS + 8 ||
      point.x > map.width - PLAYER_RADIUS - 8 || point.y > map.height - PLAYER_RADIUS - 8) return false;
  const objects = map.objects ?? [];
  if (circleOverlapsMapObjects(point, objects, PLAYER_RADIUS)) return false;
  return !someMapObjectAlongSegment(objects, player, point, PLAYER_RADIUS * 0.35, (object) => {
    if (!segmentMapObjectBoundsOverlap(player, point, object, PLAYER_RADIUS * 0.35)) return false;
    const hit = segmentMapObjectEntryT(player, point, object, PLAYER_RADIUS * 0.35);
    return hit !== null && hit < 0.98;
  });
}

function hasClearLine(start, end, objects) {
  return !someMapObjectAlongSegment(objects, start, end, 0, (object) => {
    if (object.blocksVision === false || !segmentMapObjectBoundsOverlap(start, end, object)) return false;
    const hit = segmentMapObjectEntryT(start, end, object, 0);
    return hit !== null && hit < 1 - 1e-4;
  });
}

function getSniperOverwatchTarget(player, enemy, map) {
  let best = null;
  let bestScore = Infinity;
  for (let index = 0; index < 20; index += 1) {
    const angle = index * TAU / 20;
    const candidate = {
      x: clamp(enemy.x + Math.cos(angle) * 560, PLAYER_RADIUS + 8, map.width - PLAYER_RADIUS - 8),
      y: clamp(enemy.y + Math.sin(angle) * 560, PLAYER_RADIUS + 8, map.height - PLAYER_RADIUS - 8),
    };
    if (circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS) ||
        (map.objects ?? []).some((object) => {
          const hit = segmentMapObjectEntryT(player, candidate, object, PLAYER_RADIUS * 0.35);
          return hit !== null && hit < 0.98;
        }) || !hasClearLine(candidate, enemy, map.objects ?? [])) continue;
    const room = (map.rooms ?? []).filter((entry) => pointRectDistance(candidate, entry) <= 0)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const largeAngleBonus = room ? Math.min(180, room.width * room.height / 1_200) : 0;
    const score = distance(player, candidate) + Math.abs(distance(candidate, enemy) - 560) * 0.25 - largeAngleBonus;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

function getSpawnExit(map, team, roleIndex = 0, roleCount = 1, teammates = [], objective = null, playerId = null) {
  const zone = map.spawnZones[team];
  if (!zone) return null;
  const objectivePoint = objective ?? center(map.spawnZones[team === 'red' ? 'blue' : 'red']);
  const siteCenter = center(zone);
  const candidates = [];
  const localObjects = (map.objects ?? []).filter((object) => {
    const point = object.shape === 'segment'
      ? { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 }
      : object;
    const extent = object.shape === 'circle' ? object.radius
      : object.shape === 'rect' ? Math.hypot(object.width, object.height) / 2 : 80;
    return distance(point, siteCenter) <= Math.hypot(zone.width, zone.height) / 2 + extent + 90;
  });
  const preferredDirection = unitVector(siteCenter, objectivePoint);
  const baseAngle = Math.atan2(preferredDirection.y, preferredDirection.x);
  const corridorWidth = Math.min(...(map.corridors ?? [])
    .filter((corridor) => corridor.a === `${team}-spawn` || corridor.b === `${team}-spawn`)
    .map((corridor) => corridor.width ?? 64), 64);
  const maximumLaneOffset = Math.max(0, corridorWidth / 2 - PLAYER_RADIUS - 3);
  const laneOffset = clamp((roleIndex - (roleCount - 1) / 2) * 12,
    -maximumLaneOffset, maximumLaneOffset);
  const samples = 36;
  for (let index = 0; index < samples; index += 1) {
    const angle = baseAngle + (index / samples - 0.5) * Math.PI * 1.25;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const horizontalScale = Math.abs(direction.x) > 1e-5 ? zone.width / 2 / Math.abs(direction.x) : Infinity;
    const verticalScale = Math.abs(direction.y) > 1e-5 ? zone.height / 2 / Math.abs(direction.y) : Infinity;
    const wallDistance = Math.min(horizontalScale, verticalScale);
    const doorway = {
      x: siteCenter.x + direction.x * wallDistance,
      y: siteCenter.y + direction.y * wallDistance,
    };
    const inside = { x: doorway.x - direction.x * 20, y: doorway.y - direction.y * 20 };
    const outside = { x: doorway.x + direction.x * 42, y: doorway.y + direction.y * 42 };
    const blocked = localObjects.some((object) => segmentMapObjectEntryT(inside, outside, object, PLAYER_RADIUS) !== null);
    if (blocked) continue;
    const target = {
      x: outside.x + direction.x * 20 - direction.y * laneOffset,
      y: outside.y + direction.y * 20 + direction.x * laneOffset,
    };
    if (target.x < 20 || target.y < 20 || target.x > map.width - 20 || target.y > map.height - 20) continue;
    if (circleOverlapsMapObjects(target, localObjects, PLAYER_RADIUS) ||
        localObjects.some((object) => segmentMapObjectEntryT(inside, target, object, PLAYER_RADIUS) !== null)) continue;
    const teammateCrowding = teammates.filter((teammate) => teammate.id !== playerId)
      .reduce((sum, teammate) => sum + Math.max(0, 95 - distance(target, teammate)) * 1.8, 0);
    const outwardAlignment = direction.x * preferredDirection.x + direction.y * preferredDirection.y;
    const score = distance(target, objectivePoint) + teammateCrowding - outwardAlignment * 300 + index * 0.01;
    candidates.push({ doorway, direction, outside, inside, target, score });
  }
  candidates.sort((a, b) => a.score - b.score);
  if (!candidates.length) return null;
  const preferredCount = Math.min(candidates.length, Math.max(1, roleCount));
  const preferredIndex = Math.min(preferredCount - 1, Math.floor(roleIndex * preferredCount / Math.max(1, roleCount)));
  return candidates[preferredIndex];
}

function getGeometricSpawnExit(map, team, roleIndex, roleCount, teammates, objective, playerId) {
  const zone = map.spawnZones[team];
  const centerPoint = center(zone);
  const objectiveDirection = unitVector(centerPoint, objective);
  const samples = 20;
  let best = null;
  let bestScore = Infinity;
  for (let index = 0; index < samples; index += 1) {
    const angle = (index / samples) * TAU;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const base = {
      x: centerPoint.x + direction.x * (Math.max(zone.width, zone.height) * 0.72),
      y: centerPoint.y + direction.y * (Math.max(zone.width, zone.height) * 0.72),
    };
    const laneOffset = (roleIndex - (roleCount - 1) / 2) * 38;
    const target = {
      x: clamp(base.x - objectiveDirection.y * laneOffset, 18, map.width - 18),
      y: clamp(base.y + objectiveDirection.x * laneOffset, 18, map.height - 18),
    };
    const blocked = (map.objects ?? []).some((object) => segmentMapObjectEntryT(centerPoint, target, object, PLAYER_RADIUS) !== null);
    if (blocked) continue;
    const crowding = teammates.filter((teammate) => teammate.id !== playerId)
      .reduce((sum, teammate) => sum + Math.max(0, 100 - distance(target, teammate)) * 2, 0);
    const score = distance(target, objective) + crowding - (direction.x * objectiveDirection.x + direction.y * objectiveDirection.y) * 220;
    if (score < bestScore) { best = target; bestScore = score; }
  }
  if (best) return best;
  return null;
}

function getSpawnCorridorExit(map, team, roleIndex, objective) {
  const spawnRoom = (map.rooms ?? []).find((room) => room.id === `${team}-spawn` ||
    (room.isSpawn && room.team === team));
  if (!spawnRoom) return null;
  const routes = (map.corridors ?? []).filter((corridor) =>
    corridor.a === spawnRoom.id || corridor.b === spawnRoom.id)
    .map((corridor) => ({
      id: corridor.id,
      points: corridor.a === spawnRoom.id ? corridor.points : [...corridor.points].reverse(),
    }))
    .filter((route) => Array.isArray(route.points) && route.points.length > 1)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!routes.length) return null;

  const rankedRoutes = routes.map((route) => {
    const length = polylineLength(route.points);
    const target = pointAlongPolyline(route.points, Math.min(110, length));
    const direction = unitVector(route.points[0], route.points.at(-1));
    const objectiveDirection = unitVector(center(spawnRoom), objective);
    return {
      target,
      score: distance(target, objective) -
        (direction.x * objectiveDirection.x + direction.y * objectiveDirection.y) * 180,
    };
  }).sort((a, b) => a.score - b.score);
  return rankedRoutes[((roleIndex % rankedRoutes.length) + rankedRoutes.length) % rankedRoutes.length]?.target ?? null;
}

function getBlueDefensePost(player, map, roleIndex = 0, roleCount = 1, retreating = false,
  threat = null, settings = DEFAULT_BOT_PARAMETERS, brain = null, teamIntel = null,
  visionObjects = null, teammates = [], teammateTacticalPositions = [],
  confidence = 0.5, threatPositions = []) {
  const rememberPost = (post) => {
    if (brain) brain.defensePost = { ...post };
    return post;
  };
  const zone = map.spawnZones.blue;
  const exit = getSpawnExit(map, 'blue', roleIndex, roleCount, [], center(map.spawnZones.red), player.id);
  const site = center(zone);
  if (retreating && threat) {
    const deeper = unitVector(threat, site);
    const lateral = (roleIndex - (roleCount - 1) / 2) * 18;
    const depth = Math.min(zone.width, zone.height) * 0.48;
    return {
      x: clamp(player.x + deeper.x * depth - deeper.y * lateral, zone.x + PLAYER_RADIUS + 4, zone.x + zone.width - PLAYER_RADIUS - 4),
      y: clamp(player.y + deeper.y * depth + deeper.x * lateral, zone.y + PLAYER_RADIUS + 4, zone.y + zone.height - PLAYER_RADIUS - 4),
    };
  }
  if (!retreating) {
    const routePost = getBlueRouteGuardPost(
      player, map, roleIndex, roleCount, settings, brain, teamIntel, visionObjects,
      teammates, teammateTacticalPositions, confidence, threatPositions,
    );
    if (routePost) return rememberPost(routePost);
    const post = chooseProtectedDefensePost(player, map, roleIndex, roleCount, brain,
      teamIntel, visionObjects, teammates, teammateTacticalPositions,
      settings, confidence, threatPositions);
    if (post) return rememberPost(post);
    const fallbackPost = getFallbackBlueDefensePost(player, map, roleIndex, roleCount,
      brain, teamIntel, visionObjects, teammates, teammateTacticalPositions,
      settings, confidence, threatPositions);
    if (fallbackPost) return rememberPost(fallbackPost);
  }
  if (!exit) return rememberPost(site);
  const innerDepth = retreating ? 0.34 : 0.16;
  const depth = Math.min(zone.width, zone.height) * innerDepth;
  return rememberPost({
    x: clamp(exit.doorway.x - exit.direction.x * depth, zone.x + PLAYER_RADIUS + 4, zone.x + zone.width - PLAYER_RADIUS - 4),
    y: clamp(exit.doorway.y - exit.direction.y * depth, zone.y + PLAYER_RADIUS + 4, zone.y + zone.height - PLAYER_RADIUS - 4),
  });
}

function getBlueDefensePosture(settings, confidence) {
  return clamp(
    settings.aggressiveness * 0.35 + (1 - settings.defenseFocus) * 0.4 +
      settings.objectiveFocus * 0.15 + confidence * 0.1,
    0, 1,
  );
}

function getDefenseThreatPressure(route, threatPositions, map) {
  let best = { route, pressure: 0, projection: null };
  for (const threat of threatPositions ?? []) {
    if (![threat?.x, threat?.y].every(Number.isFinite)) continue;
    const progress = getStrikeMineProgress(threat, map);
    if (progress === null || progress < 0.25) continue;
    const projection = getPolylineProjection(threat, route.points);
    if (projection.distance > 450) continue;
    const pressure = clamp((progress - 0.25) / 0.6, 0, 1) *
      clamp(1 - projection.distance / 450, 0, 1);
    if (pressure > best.pressure) best = { route, pressure, projection };
  }
  return best;
}

function getBlueRouteGuardPost(player, map, roleIndex, roleCount, settings, brain,
  teamIntel, visionObjects, teammates, teammateTacticalPositions, confidence, threatPositions) {
  const blueRoom = (map.rooms ?? []).find((room) => room.id === 'blue-spawn' || (room.isSpawn && room.team === 'blue'));
  if (!blueRoom) return null;
  const routes = (map.corridors ?? []).filter((corridor) => corridor.a === blueRoom.id || corridor.b === blueRoom.id)
    .map((corridor) => {
      const points = corridor.a === blueRoom.id ? corridor.points : [...corridor.points].reverse();
      if (!points || points.length < 2) return null;
      return { id: corridor.id, points };
    }).filter(Boolean).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!routes.length) return null;

  const defensePosture = getBlueDefensePosture(settings, confidence);
  const baseDistance = 35 + defensePosture * 265;
  const routeMapKey = `${blueRoom.id}:${blueRoom.x}:${blueRoom.y}:${blueRoom.width}:${blueRoom.height}:` +
    routes.map((route) => `${route.id}:${route.points.map((point) => `${point.x},${point.y}`).join(';')}`).join('|');
  let assignment = brain?.defenseRouteAssignment;
  let route = assignment?.mapKey === routeMapKey &&
    assignment.roleIndex === roleIndex && assignment.roleCount === roleCount
    ? routes.find((candidate) => candidate.id === assignment.routeId)
    : null;
  if (!route) {
    const rankedRoutes = routes.map((candidate) => {
      const watchTarget = pointAlongPolyline(candidate.points, baseDistance + 120) ?? candidate.points.at(-1);
      return {
        route: candidate,
        coverage: getTeamCoverageCount(watchTarget, map, teamIntel, visionObjects, brain?.id),
      };
    }).sort((left, right) =>
      left.coverage - right.coverage || String(left.route.id).localeCompare(String(right.route.id)));
    route = rankedRoutes[((roleIndex % rankedRoutes.length) + rankedRoutes.length) % rankedRoutes.length].route;
    assignment = {
      mapKey: routeMapKey,
      routeId: route.id,
      roleIndex,
      roleCount,
      laneIndex: Math.floor(roleIndex / routes.length),
      laneCount: Math.ceil(Math.max(1, roleCount) / routes.length),
    };
    if (brain) brain.defenseRouteAssignment = assignment;
  }
  const threatenedRoutes = routes.map((candidate) =>
    getDefenseThreatPressure(candidate, threatPositions, map))
    .filter((entry) => entry.pressure > 0)
    .sort((left, right) => right.pressure - left.pressure);
  const strongestThreatRoute = threatenedRoutes[0];
  if (strongestThreatRoute && strongestThreatRoute.pressure >= 0.2) {
    const currentThreatPressure = getDefenseThreatPressure(route, threatPositions, map).pressure;
    if (strongestThreatRoute.route.id !== route.id &&
        strongestThreatRoute.pressure > currentThreatPressure + 0.15) {
      route = strongestThreatRoute.route;
      assignment = {
        ...(assignment ?? {}),
        mapKey: routeMapKey,
        routeId: route.id,
        roleIndex,
        roleCount,
        laneIndex: Math.floor(roleIndex / routes.length),
        laneCount: Math.ceil(Math.max(1, roleCount) / routes.length),
      };
      if (brain) brain.defenseRouteAssignment = assignment;
    }
  }
  const laneIndex = Math.floor(roleIndex / routes.length);
  const laneCount = Math.ceil(Math.max(1, roleCount) / routes.length);
  const routeLength = polylineLength(route.points);
  const maximumPostDistance = Math.max(0, routeLength - PLAYER_RADIUS);
  let desiredPostDistance = Math.min(baseDistance, maximumPostDistance);
  const threatPressure = getDefenseThreatPressure(route, threatPositions, map);
  if (threatPressure.pressure > 0) {
    const standOff = clamp(
      40 + settings.defenseFocus * 80 + (1 - confidence) * 60 -
        (settings.aggressiveness + settings.objectiveFocus) * 30,
      20,
      190,
    );
    const responseDistance = clamp(
      threatPressure.projection.distanceAlong - standOff,
      0,
      maximumPostDistance,
    );
    desiredPostDistance = baseDistance * (1 - threatPressure.pressure) +
      responseDistance * threatPressure.pressure;
  }
  desiredPostDistance = clamp(desiredPostDistance, 0, maximumPostDistance);
  const laneSpread = Math.min(
    MIN_DEFENDER_POST_SPACING * Math.max(0, laneCount - 1),
    maximumPostDistance,
  );
  const firstDistance = clamp(desiredPostDistance - laneSpread / 2, 0,
    Math.max(0, maximumPostDistance - laneSpread));
  const lastDistance = firstDistance + laneSpread;
  const idealDistance = laneCount > 1
    ? firstDistance + (lastDistance - firstDistance) * laneIndex / (laneCount - 1)
    : desiredPostDistance;
  const reservations = getReservedDefensePositions(player.id, teammates, teammateTacticalPositions);
  const defaultWatchTarget = pointAlongPolylineExtended(route.points, idealDistance + 130, map);
  if (brain) brain.defenseWatchTarget = { ...defaultWatchTarget };
  const candidateDistances = new Set([firstDistance, lastDistance, idealDistance]);
  for (let distanceAlongRoute = firstDistance + MIN_DEFENDER_POST_SPACING;
    distanceAlongRoute < lastDistance; distanceAlongRoute += MIN_DEFENDER_POST_SPACING) {
    candidateDistances.add(distanceAlongRoute);
  }
  const candidates = [];
  for (const distanceAlongRoute of candidateDistances) {
    const post = pointAlongPolyline(route.points, distanceAlongRoute);
    if (!post || circleOverlapsMapObjects(post, map.objects ?? [], PLAYER_RADIUS)) continue;
    const watchTarget = pointAlongPolylineExtended(route.points, distanceAlongRoute + 130, map);
    const postDistance = minimumReservedDistance(post, reservations, 'post');
    const watchDistance = minimumReservedDistance(watchTarget, reservations, 'watch');
    if (postDistance < MIN_DEFENDER_POST_SPACING ||
        watchDistance < MIN_DEFENDER_WATCH_SPACING) continue;
    const coverage = getTeamCoverageCount(watchTarget, map, teamIntel, visionObjects, player.id);
    candidates.push({
      post,
      watchTarget,
      score: Math.abs(distanceAlongRoute - idealDistance) +
        distance(player, post) * 0.08 + coverage * 100,
    });
  }
  candidates.sort((left, right) => left.score - right.score);
  const best = candidates[0];
  if (!best) return null;
  if (brain) brain.defenseWatchTarget = { ...best.watchTarget };
  return best.post;
}

function getFallbackBlueDefensePost(player, map, roleIndex, roleCount, brain, teamIntel,
  visionObjects, teammates, teammateTacticalPositions, settings, confidence, threatPositions) {
  const zone = map.spawnZones?.blue;
  if (!zone) return null;
  const site = center(zone);
  const opposingSite = map.spawnZones?.red ? center(map.spawnZones.red) : {
    x: map.width / 2,
    y: map.height / 2,
  };
  const blueRoom = (map.rooms ?? []).find((room) =>
    room.id === 'blue-spawn' || (room.isSpawn && room.team === 'blue'));
  const ingresses = blueRoom
    ? (map.corridors ?? []).filter((corridor) =>
      corridor.a === blueRoom.id || corridor.b === blueRoom.id)
    .map((corridor) => ({
      id: corridor.id,
      points: corridor.a === blueRoom.id
        ? corridor.points : [...(corridor.points ?? [])].reverse(),
    }))
    .filter((entry) => entry.points?.length > 1)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    : [];
  const route = ingresses.length ? ingresses[roleIndex % ingresses.length] : null;
  const forward = route
    ? unitVector(route.points[0], route.points.at(-1))
    : unitVector(site, opposingSite);
  const lateral = { x: -forward.y, y: forward.x };
  const defensePosture = getBlueDefensePosture(settings, confidence);
  const laneIndex = Math.floor(roleIndex / Math.max(1, ingresses.length));
  const laneOffset = (roleIndex - (roleCount - 1) / 2) * 140;
  const reservations = getReservedDefensePositions(player.id, teammates, teammateTacticalPositions);
  const watchTarget = route
    ? chooseDistinctIngressWatchTarget(
      route.points, 150 + defensePosture * 170 + laneIndex * 130, map, reservations,
    )
    : {
      x: clamp(site.x + forward.x * (150 + defensePosture * 170) + lateral.x * laneOffset,
        PLAYER_RADIUS, map.width - PLAYER_RADIUS),
      y: clamp(site.y + forward.y * (150 + defensePosture * 170) + lateral.y * laneOffset,
        PLAYER_RADIUS, map.height - PLAYER_RADIUS),
    };
  if (brain) brain.defenseWatchTarget = watchTarget;
  const advancingThreat = (threatPositions ?? [])
    .filter((position) => getStrikeMineProgress(position, map) >= 0.55)
    .sort((left, right) =>
      distance(left, site) - distance(right, site))[0];
  const threatShift = advancingThreat && defensePosture > 0.5 ? 0.35 : 0;
  const depth = 15 + defensePosture * (Math.min(zone.width, zone.height) * 0.35);
  const preferred = {
    x: clamp(site.x + forward.x * depth +
      (advancingThreat ? (advancingThreat.x - site.x) * threatShift : 0) +
      lateral.x * laneOffset * 0.3,
      zone.x + PLAYER_RADIUS + 4, zone.x + zone.width - PLAYER_RADIUS - 4),
    y: clamp(site.y + forward.y * depth +
      (advancingThreat ? (advancingThreat.y - site.y) * threatShift : 0) +
      lateral.y * laneOffset * 0.3,
      zone.y + PLAYER_RADIUS + 4, zone.y + zone.height - PLAYER_RADIUS - 4),
  };
  let best = null;
  for (let xIndex = 0; xIndex < 7; xIndex += 1) {
    for (let yIndex = 0; yIndex < 7; yIndex += 1) {
      const point = {
        x: zone.x + PLAYER_RADIUS + 4 +
          (zone.width - (PLAYER_RADIUS + 4) * 2) * xIndex / 6,
        y: zone.y + PLAYER_RADIUS + 4 +
          (zone.height - (PLAYER_RADIUS + 4) * 2) * yIndex / 6,
      };
      if (circleOverlapsMapObjects(point, map.objects ?? [], PLAYER_RADIUS)) continue;
      const score = distance(point, preferred) * 0.4 +
        getDefenseSpacingPenalty(point, watchTarget, reservations) +
        getTeamCoverageCount(watchTarget, map, teamIntel, visionObjects, player.id) * 80 +
        (hashString(`${player.id}:${xIndex}:${yIndex}`) % 13) * 0.05;
      if (!best || score < best.score) best = { point, score };
    }
  }
  return best?.point ?? null;
}

function getReservedDefensePositions(playerId, teammates, teammateTacticalPositions = []) {
  const byId = new Map();
  const add = (id, post, watch, cover) => {
    if (!id || id === playerId) return;
    const reservation = byId.get(id) ?? { id };
    if (post) reservation.post = post;
    if (watch) reservation.watch = watch;
    if (cover) reservation.cover = cover;
    byId.set(id, reservation);
  };
  for (const teammate of teammates) {
    if (teammate.alive === false || (teammate.health ?? 100) <= 0) continue;
    add(teammate.id, teammate.botBrain?.defensePost,
      teammate.botBrain?.defenseWatchTarget, teammate.botBrain?.tacticalCoverCache?.point);
  }
  for (const assignment of teammateTacticalPositions) {
    add(assignment.id, assignment.defensePost, assignment.defenseWatchTarget, assignment.coverPoint);
  }
  return [...byId.values()];
}

function minimumReservedDistance(point, reservations, key) {
  let minimum = Infinity;
  for (const reservation of reservations) {
    const reservedPoint = key === 'post'
      ? reservation.post ?? reservation.cover
      : reservation.watch;
    if (reservedPoint) minimum = Math.min(minimum, distance(point, reservedPoint));
  }
  return minimum;
}

function getPolylineProjection(point, points) {
  let distanceAlong = 0;
  let bestDistance = Infinity;
  let bestDistanceAlong = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const length = Math.sqrt(lengthSquared);
    if (lengthSquared <= 1e-9) continue;
    const fraction = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) /
      lengthSquared, 0, 1);
    const projection = {
      x: start.x + dx * fraction,
      y: start.y + dy * fraction,
    };
    const projectionDistance = distance(point, projection);
    if (projectionDistance < bestDistance) {
      bestDistance = projectionDistance;
      bestDistanceAlong = distanceAlong + length * fraction;
    }
    distanceAlong += length;
  }
  return { distance: bestDistance, distanceAlong: bestDistanceAlong };
}

function chooseDistinctIngressWatchTarget(points, preferredDistance, map, reservations) {
  let best = pointAlongPolylineExtended(points, preferredDistance, map);
  let bestSpacing = minimumReservedDistance(best, reservations, 'watch');
  if (bestSpacing >= MIN_DEFENDER_WATCH_SPACING) return best;
  for (let offset = 1; offset <= 12; offset += 1) {
    for (const sign of [1, -1]) {
      const candidate = pointAlongPolylineExtended(
        points,
        preferredDistance + offset * MIN_DEFENDER_WATCH_SPACING * sign,
        map,
      );
      const spacing = minimumReservedDistance(candidate, reservations, 'watch');
      if (spacing >= MIN_DEFENDER_WATCH_SPACING) return candidate;
      if (spacing > bestSpacing) {
        best = candidate;
        bestSpacing = spacing;
      }
    }
  }
  return best;
}

function getDefenseSpacingPenalty(post, watchTarget, reservations) {
  let penalty = 0;
  for (const reservation of reservations) {
    const reservedPost = reservation.post ?? reservation.cover;
    if (reservedPost) {
      penalty += Math.max(0, MIN_DEFENDER_POST_SPACING - distance(post, reservedPost)) * 12;
    }
    if (reservation.watch) {
      penalty += Math.max(0, MIN_DEFENDER_WATCH_SPACING - distance(watchTarget, reservation.watch)) * 8;
    }
  }
  return penalty;
}

function pointAlongPolylineExtended(points, requestedDistance, map) {
  const routeLength = polylineLength(points);
  const point = pointAlongPolyline(points, Math.min(requestedDistance, routeLength));
  if (!point || requestedDistance <= routeLength || points.length < 2) return point;
  const previous = points.at(-2);
  const end = points.at(-1);
  const direction = unitVector(previous, end);
  const extension = requestedDistance - routeLength;
  return {
    x: clamp(end.x + direction.x * extension, PLAYER_RADIUS, map.width - PLAYER_RADIUS),
    y: clamp(end.y + direction.y * extension, PLAYER_RADIUS, map.height - PLAYER_RADIUS),
  };
}

function pointAlongPolyline(points, requestedDistance) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let remaining = requestedDistance;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentLength = distance(start, end);
    if (segmentLength >= remaining && segmentLength > 0) {
      const fraction = remaining / segmentLength;
      return { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction };
    }
    remaining -= segmentLength;
  }
  return { ...points.at(-1) };
}

function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  return { x: dx / magnitude, y: dy / magnitude };
}

function markExploredCell(player, brain, now) {
  const key = explorationCellKey(player);
  brain.visitedCells[key] = now;
  for (const [cell, visitedAt] of Object.entries(brain.visitedCells)) {
    if (now - visitedAt > 90_000) delete brain.visitedCells[cell];
  }
  for (const [cell, blockedUntil] of Object.entries(brain.blockedCells)) {
    if (blockedUntil <= now) delete brain.blockedCells[cell];
  }
}

function updateNavigationProgress(player, brain, now, goal, action, waypoint = goal) {
  const changedGoal = !brain.progressGoal || brain.progressAction !== action || distance(brain.progressGoal, goal) > 150;
  if (changedGoal) {
    brain.progressGoal = { ...goal };
    brain.progressAction = action;
    brain.progressWaypoint = { ...waypoint };
    brain.progressPosition = { x: player.x, y: player.y };
    brain.progressGoalDistance = distance(player, waypoint);
    brain.lastProgressAt = now;
    brain.stuckCount = 0;
    return;
  }

  brain.progressWaypoint ??= { ...(brain.progressGoal ?? goal) };
  const reachedWaypoint = distance(player, brain.progressWaypoint) <= 42;
  if (distance(waypoint, brain.progressWaypoint) > 40 && (reachedWaypoint || brain.detourTarget)) {
    brain.progressWaypoint = { ...waypoint };
    brain.progressPosition = { x: player.x, y: player.y };
    brain.progressGoalDistance = distance(player, waypoint);
    brain.lastProgressAt = now;
    if (!brain.detourTarget) brain.stuckCount = 0;
    return;
  }

  const progressTarget = brain.detourTarget ?? brain.progressWaypoint;
  const progressDistance = distance(player, progressTarget);
  const improved = progressDistance < (brain.progressGoalDistance ?? Infinity) - 8;
  const displacedDuringCombat = action === 'fight' && distance(player, brain.progressPosition) >= 18;
  if (improved || displacedDuringCombat) {
    brain.progressPosition = { x: player.x, y: player.y };
    brain.progressGoalDistance = progressDistance;
    brain.lastProgressAt = now;
    brain.stuckCount = 0;
    if (brain.detourTarget) brain.detourUntil = now + 1_000;
    return;
  }
  if (brain.lastWasMoving && now - brain.lastProgressAt >= STUCK_TIMEOUT_MS) {
    brain.stuckCount = (brain.stuckCount ?? 0) + 1;
    brain.detourIndex = (brain.detourIndex ?? 0) + 1;
    brain.lastProgressAt = now;
    brain.progressPosition = { x: player.x, y: player.y };
    brain.progressGoalDistance = progressDistance;
    brain.blockedCells[explorationCellKey(player)] = now + 6_000;
    brain.explorationTarget = null;
    brain.detourTarget = null;
    brain.detourUntil = 0;
    brain.graphRouteKey = null;
    brain.graphRoute = null;
  }
}

function getNavigationTarget(player, goal, map, brain, now, mapStrategy = getBotMapStrategy(map)) {
  if (brain.detourTarget && distance(player, brain.detourTarget) <= 32) {
    brain.detourTarget = null;
    brain.detourUntil = 0;
  }
  if (brain.detourTarget && now < brain.detourUntil) return brain.detourTarget;
  const activeRoute = brain.routeWaypoint;
  if (activeRoute) {
    const activeRouteDistance = distance(player, activeRoute);
    const routeGoalMatches = brain.routeGoal && distance(brain.routeGoal, goal) < 125;
    if (activeRouteDistance <= 28 || activeRouteDistance > 230 || !routeGoalMatches) {
      brain.routeWaypoint = null;
      brain.routeGoal = null;
    } else {
      if (!isMovementPathClear(player, activeRoute, map.objects)) {
        brain.routeWaypoint = null;
        brain.routeGoal = null;
      } else {
        return activeRoute;
      }
    }
  }

  const graphWaypoint = getRoomGraphWaypoint(player, goal, map, brain, mapStrategy);
  if (graphWaypoint) {
    const blocked = (map.objects ?? []).some((object) =>
      segmentMapObjectEntryT(player, graphWaypoint, object, PLAYER_RADIUS) !== null);
    if (!blocked) return graphWaypoint;
    goal = graphWaypoint;
  }
  if (brain.stuckCount > 0) {
    const detours = [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, Math.PI * 0.72, -Math.PI * 0.72, Math.PI];
    const directAngle = Math.atan2(goal.y - player.y, goal.x - player.x);
    for (let attempt = 0; attempt < detours.length; attempt += 1) {
      const index = ((brain.detourIndex ?? 1) - 1 + attempt) % detours.length;
      const angle = directAngle + detours[index];
      const candidate = {
        x: clamp(player.x + Math.cos(angle) * 165, PLAYER_RADIUS + 4, map.width - PLAYER_RADIUS - 4),
        y: clamp(player.y + Math.sin(angle) * 165, PLAYER_RADIUS + 4, map.height - PLAYER_RADIUS - 4),
      };
      const blockedUntil = brain.blockedCells[explorationCellKey(candidate)] ?? 0;
      if (blockedUntil <= now &&
          !circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS)) {
        brain.detourTarget = candidate;
        brain.detourUntil = now + 1_000;
        brain.progressGoalDistance = distance(player, candidate);
        brain.progressPosition = { x: player.x, y: player.y };
        brain.lastProgressAt = now;
        return candidate;
      }
    }
  }
  brain.routeWaypoint = null;
  brain.routeGoal = null;

  const localEnd = {
    x: player.x + (goal.x - player.x) * Math.min(1, 260 / Math.max(1, distance(player, goal))),
    y: player.y + (goal.y - player.y) * Math.min(1, 260 / Math.max(1, distance(player, goal))),
  };
  const nearbyObjects = (map.objects ?? []).filter((object) => {
    const point = object.shape === 'segment'
      ? { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 }
      : object;
    const radius = object.shape === 'circle' ? object.radius
      : object.shape === 'rect' ? Math.hypot(object.width, object.height) / 2
        : Math.hypot(object.x2 - object.x1, object.y2 - object.y1) / 2;
    const midpointNearby = distance(player, point) <= 260 + radius;
    const segmentCrossesRoute = object.shape === 'segment' &&
      segmentMapObjectBoundsOverlap(player, localEnd, object, PLAYER_RADIUS);
    return object.blocksMovement !== false && (midpointNearby || segmentCrossesRoute);
  });
  const obstruction = nearbyObjects.find((object) =>
    segmentMapObjectEntryT(player, localEnd, object, PLAYER_RADIUS) !== null);
  if (obstruction) {
    const direction = Math.atan2(goal.y - player.y, goal.x - player.x);
    let obstaclePoint;
    let obstacleRadius = 54;
    if (obstruction.shape === 'segment') {
      obstaclePoint = { x: (obstruction.x1 + obstruction.x2) / 2, y: (obstruction.y1 + obstruction.y2) / 2 };
      obstacleRadius = Math.max(58, Math.hypot(obstruction.x2 - obstruction.x1, obstruction.y2 - obstruction.y1) / 2 + 24);
    } else if (obstruction.shape === 'circle') {
      obstaclePoint = obstruction;
      obstacleRadius = obstruction.radius + PLAYER_RADIUS + 18;
    } else {
      obstaclePoint = obstruction;
      obstacleRadius = Math.hypot(obstruction.width, obstruction.height) / 2 + PLAYER_RADIUS + 18;
    }
    const sides = [Math.PI / 2, -Math.PI / 2, Math.PI / 3, -Math.PI / 3, Math.PI * 0.72, -Math.PI * 0.72];
    let best = null;
    let bestScore = Infinity;
    for (const side of sides) {
      const angle = direction + side;
      const candidate = {
        x: clamp(obstaclePoint.x + Math.cos(angle) * obstacleRadius, PLAYER_RADIUS + 8, map.width - PLAYER_RADIUS - 8),
        y: clamp(obstaclePoint.y + Math.sin(angle) * obstacleRadius, PLAYER_RADIUS + 8, map.height - PLAYER_RADIUS - 8),
      };
      if (distance(player, candidate) < 28) continue;
      if (circleOverlapsMapObjects(candidate, nearbyObjects, PLAYER_RADIUS)) continue;
      const inboundBlocked = nearbyObjects.some((object) =>
        segmentMapObjectEntryT(player, candidate, object, PLAYER_RADIUS) !== null);
      if (inboundBlocked) continue;
      const outboundBlocked = nearbyObjects.some((object) =>
        segmentMapObjectEntryT(candidate, localEnd, object, PLAYER_RADIUS) !== null);
      const score = distance(player, candidate) + distance(candidate, localEnd) + (outboundBlocked ? 190 : 0) +
        Math.max(0, 0 - ((candidate.x - player.x) * Math.cos(direction) + (candidate.y - player.y) * Math.sin(direction))) * 3;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    if (best) {
      brain.routeWaypoint = best;
      brain.routeGoal = { ...goal };
      return best;
    }
    // A partially clear direct route lets movement collision slide the bot along
    // wall edges; stopping in place here can strand it before stuck recovery runs.
    return goal;
  }
  return goal;
}

function getReactedOrbitalStrikeWarnings(match, bot, brain, now, reflexMs) {
  const seenAtById = brain.orbitalStrikeWarningSeenAtById ??= {};
  const activeWarningIds = new Set();
  const reactedWarnings = [];

  for (const pending of match.pendingGadgetEffects ?? []) {
    const warning = pending.effect;
    const strikeAt = pending.detonatesAt ?? warning?.strikeAt ?? warning?.expiresAt;
    if (warning?.type !== 'orbital-strike-warning' || warning.startedAt > now ||
        ![warning.x, warning.y, warning.radius, strikeAt].every(Number.isFinite) ||
        strikeAt <= now) continue;
    activeWarningIds.add(warning.id);
    if (!Number.isFinite(seenAtById[warning.id])) seenAtById[warning.id] = now;
    if (now - seenAtById[warning.id] < reflexMs) continue;
    reactedWarnings.push({ ...warning, expiresAt: strikeAt });
  }

  for (const warningId of Object.keys(seenAtById)) {
    if (!activeWarningIds.has(warningId)) delete seenAtById[warningId];
  }
  return reactedWarnings;
}

function chooseHazardAwareWaypoint(player, waypoint, map, hazards, now) {
  const activeHazards = hazards.filter((effect) =>
    Number.isFinite(effect.expiresAt) && effect.expiresAt > now &&
    Number.isFinite(effect.x) && Number.isFinite(effect.y));
  const escapeWaypoint = getImmediateHazardEscapeWaypoint(player, waypoint, map, activeHazards);
  if (escapeWaypoint) return escapeWaypoint;
  const directRisk = getHazardRouteCost([player, waypoint], activeHazards, player.health, now);
  if (directRisk <= 0) return waypoint;

  let bestPoint = waypoint;
  let bestCost = distance(player, waypoint) + directRisk;
  for (const hazard of activeHazards) {
    const radius = Math.max(0, hazard.radius ?? 60) + PLAYER_RADIUS;
    if (getSegmentCircleLength(player, waypoint, hazard, radius) <= 0) continue;
    const detourRadius = radius + 12;
    for (let index = 0; index < 16; index += 1) {
      const angle = index * TAU / 16;
      const candidate = {
        x: hazard.x + Math.cos(angle) * detourRadius,
        y: hazard.y + Math.sin(angle) * detourRadius,
      };
      if (candidate.x < PLAYER_RADIUS + 8 || candidate.y < PLAYER_RADIUS + 8 ||
          candidate.x > map.width - PLAYER_RADIUS - 8 || candidate.y > map.height - PLAYER_RADIUS - 8 ||
          circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS) ||
          !isMovementPathClear(player, candidate, map.objects) ||
          !isMovementPathClear(candidate, waypoint, map.objects)) continue;
      const route = [player, candidate, waypoint];
      const cost = distance(player, candidate) + distance(candidate, waypoint) +
        getHazardRouteCost(route, activeHazards, player.health, now);
      if (cost < bestCost) {
        bestPoint = candidate;
        bestCost = cost;
      }
    }
  }
  return Number.isFinite(bestCost) ? bestPoint :
    getHardHazardStopPoint(player, waypoint, map, activeHazards) ?? bestPoint;
}

function getImmediateHazardEscapeWaypoint(player, waypoint, map, hazards) {
  const dangerousZones = hazards.filter((effect) =>
    ['molotov', 'mine', 'orbital-strike-warning'].includes(effect.type) &&
    distance(player, effect) <= (effect.radius ?? 60) + PLAYER_RADIUS);
  if (!dangerousZones.length) return null;

  let bestPoint = null;
  let bestScore = Infinity;
  for (const hazard of dangerousZones) {
    const escapeRadius = (hazard.radius ?? 60) + PLAYER_RADIUS + 12;
    for (let index = 0; index < 32; index += 1) {
      const angle = index * TAU / 32;
      const candidate = {
        x: hazard.x + Math.cos(angle) * escapeRadius,
        y: hazard.y + Math.sin(angle) * escapeRadius,
      };
      if (candidate.x < PLAYER_RADIUS + 8 || candidate.y < PLAYER_RADIUS + 8 ||
          candidate.x > map.width - PLAYER_RADIUS - 8 || candidate.y > map.height - PLAYER_RADIUS - 8 ||
          circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS) ||
          !isMovementPathClear(player, candidate, map.objects)) continue;

      const remainsInDanger = hazards.some((effect) =>
        ['molotov', 'mine', 'orbital-strike-warning'].includes(effect.type) &&
        distance(candidate, effect) <= (effect.radius ?? 60) + PLAYER_RADIUS);
      const score = distance(player, candidate) + distance(candidate, waypoint) * 0.08 +
        (remainsInDanger ? 10_000 : 0);
      if (score < bestScore) {
        bestPoint = candidate;
        bestScore = score;
      }
    }
  }
  return bestPoint;
}

function getHardHazardStopPoint(player, waypoint, map, hazards) {
  const pathLength = distance(player, waypoint);
  if (pathLength <= 1) return { x: player.x, y: player.y };
  const firstHazard = hazards
    .filter((hazard) => ['molotov', 'mine'].includes(hazard.type))
    .map((hazard) => ({
      entryT: segmentCircleEntryTCoordinates(
        player.x, player.y, waypoint.x, waypoint.y,
        hazard.x, hazard.y, (hazard.radius ?? 60) + PLAYER_RADIUS,
      ),
    }))
    .filter(({ entryT }) => entryT !== null)
    .sort((left, right) => left.entryT - right.entryT)[0];
  if (!firstHazard) return null;

  const stopT = Math.max(0, firstHazard.entryT - (PLAYER_RADIUS + 8) / pathLength);
  const candidate = {
    x: player.x + (waypoint.x - player.x) * stopT,
    y: player.y + (waypoint.y - player.y) * stopT,
  };
  if (circleOverlapsMapObjects(candidate, map.objects ?? [], PLAYER_RADIUS) ||
      !isMovementPathClear(player, candidate, map.objects)) {
    return { x: player.x, y: player.y };
  }
  return candidate;
}

function getHazardRouteCost(points, hazards, health, now) {
  let cost = 0;
  for (const hazard of hazards) {
    const radius = Math.max(0, hazard.radius ?? 60) + PLAYER_RADIUS;
    const insideLength = points.slice(1).reduce((sum, point, index) =>
      sum + getSegmentCircleLength(points[index], point, hazard, radius), 0);
    if (insideLength <= 0) continue;
    if (hazard.type === 'molotov' || hazard.type === 'mine') return Infinity;
    const remainingSeconds = (hazard.expiresAt - now) / 1_000;
    const exposureSeconds = Math.min(remainingSeconds, insideLength / BOT_TRAVEL_SPEED);
    if (hazard.type === 'cryo') {
      cost += exposureSeconds * BOT_TRAVEL_SPEED * (1 / CRYO_MOVEMENT_SPEED_MULTIPLIER - 1);
    } else if (hazard.type === BIO_FIELD_ID) {
      cost += exposureSeconds * BOT_TRAVEL_SPEED * (1 / BIO_FIELD_ENEMY_MOVEMENT_MULTIPLIER - 1);
    } else if (hazard.type === VINE_TRAP_ID) {
      cost += 2_000 + insideLength * 8;
    } else if (hazard.type === 'orbital-strike-warning') {
      const predictedDamage = exposureSeconds * (hazard.damagePerSecond ?? 50);
      cost += 100_000 + predictedDamage * 1.5 + (predictedDamage >= health ? 2_000 : 0);
    }
  }
  return cost;
}

function getSegmentCircleLength(start, end, center, radius) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return 0;
  const fromStartToCenterX = center.x - start.x;
  const fromStartToCenterY = center.y - start.y;
  const projection = (fromStartToCenterX * dx + fromStartToCenterY * dy) / (length * length);
  const closestX = start.x + dx * projection;
  const closestY = start.y + dy * projection;
  const perpendicularDistance = Math.hypot(center.x - closestX, center.y - closestY);
  if (perpendicularDistance >= radius) return 0;
  const halfChord = Math.sqrt(radius * radius - perpendicularDistance * perpendicularDistance) / length;
  const entry = Math.max(0, projection - halfChord);
  const exit = Math.min(1, projection + halfChord);
  return Math.max(0, exit - entry) * length;
}

function isMovementPathClear(start, end, objects = []) {
  return !someMapObjectAlongSegment(objects, start, end, PLAYER_RADIUS, (object) =>
    segmentMapObjectBoundsOverlap(start, end, object, PLAYER_RADIUS) &&
    segmentMapObjectEntryT(start, end, object, PLAYER_RADIUS, 'blocksMovement') !== null);
}

function getRoomGraphWaypoint(player, goal, map, brain, mapStrategy) {
  const { rooms, corridors, roomsById, findRoomPath } = mapStrategy;
  if (rooms.length < 2 || corridors.length === 0) return null;
  const goalRoom = nearestRoom(goal, rooms);
  if (!goalRoom) return null;
  const containingRoom = rooms.find((room) => pointRectDistance(player, room) <= 1);
  if (containingRoom?.id === goalRoom.id) {
    brain.graphRouteKey = null;
    brain.graphRoute = null;
    brain.graphGoalRoom = null;
    return null;
  }
  if (brain.graphRoute?.length && brain.graphGoalRoom === goalRoom.id) {
    brain.graphRoute[brain.graphRoute.length - 1] = { ...goal };
    while (brain.graphRouteIndex < brain.graphRoute.length - 1 &&
        distance(player, brain.graphRoute[brain.graphRouteIndex]) <= 42) brain.graphRouteIndex += 1;
    const next = brain.graphRoute[brain.graphRouteIndex];
    return distance(player, next) <= 42 ? goal : next;
  }

  let route = null;
  let routeScore = Infinity;
  const currentRoom = nearestRoom(player, rooms);
  if (currentRoom) {
    const graphPath = findRoomPath(currentRoom.id, goalRoom.id);
    if (graphPath) {
      route = buildRoomRoute(graphPath, roomsById, goal);
      routeScore = pointRectDistance(player, currentRoom) + graphPath.distance;
    }
  }

  let closestCorridor = null;
  for (const corridor of corridors) {
    const projection = projectOntoPolyline(player, corridor.points);
    if (!projection || projection.distance > Math.max(70, (corridor.width ?? 60) / 2 + 24)) continue;
    if (!closestCorridor || projection.distance < closestCorridor.projection.distance) {
      closestCorridor = { corridor, projection };
    }
  }
  if (closestCorridor) {
    for (const endpoint of ['a', 'b']) {
      const roomId = closestCorridor.corridor[endpoint];
      const graphPath = findRoomPath(roomId, goalRoom.id);
      if (!graphPath) continue;
      const towardStart = endpoint === 'a';
      const along = polylineRemainder(closestCorridor.corridor.points, closestCorridor.projection, towardStart);
      const candidateRoute = [...along, ...buildRoomRoute(graphPath, roomsById, goal)];
      const score = closestCorridor.projection.distance + polylineLength(along) + graphPath.distance;
      if (score < routeScore) {
        route = candidateRoute;
        routeScore = score;
      }
    }
  }

  if (!route?.length) return null;
  const routeKey = `${goalRoom.id}:${route.slice(1, -1)
    .map((point) => `${Math.round(point.x / 20)},${Math.round(point.y / 20)}`).join('|')}`;
  if (brain.graphRouteKey !== routeKey) {
    brain.graphRouteKey = routeKey;
    brain.graphRoute = route;
    brain.graphRouteIndex = 0;
    brain.graphGoalRoom = goalRoom.id;
  } else {
    brain.graphRoute[brain.graphRoute.length - 1] = { ...goal };
  }
  const waypoints = brain.graphRoute;
  while (brain.graphRouteIndex < waypoints.length - 1 &&
      distance(player, waypoints[brain.graphRouteIndex]) <= 42) brain.graphRouteIndex += 1;
  const next = waypoints[brain.graphRouteIndex];
  return distance(player, next) <= 42 ? goal : next;
}

function nearestRoom(point, rooms) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const room of rooms) {
    const candidateDistance = pointRectDistance(point, room);
    if (candidateDistance < nearestDistance) {
      nearest = room;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}

function buildRoomRoute(path, roomsById, goal) {
  if (path.edges.length === 0) return [{ ...goal }];
  const points = [];
  for (let index = 0; index < path.edges.length; index += 1) {
    const corridor = path.edges[index];
    const forward = corridor.a === path.nodes[index];
    const edgePoints = forward ? corridor.points : [...corridor.points].reverse();
    points.push(...edgePoints.map((point) => ({ x: point.x, y: point.y })));
    if (index < path.edges.length - 1) {
      const room = roomsById.get(path.nodes[index + 1]);
      if (room) points.push({ x: room.x, y: room.y });
    }
  }
  points.push({ ...goal });
  return deduplicateRoute(points);
}

function projectOntoPolyline(point, points = []) {
  let best = null;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-9) continue;
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    const projection = { x: start.x + dx * t, y: start.y + dy * t };
    const candidate = { index, t, point: projection, distance: distance(point, projection) };
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

function polylineRemainder(points, projection, towardStart) {
  if (towardStart) {
    return deduplicateRoute([projection.point, ...points.slice(0, projection.index + 1).reverse()]);
  }
  return deduplicateRoute([projection.point, ...points.slice(projection.index + 1)]);
}

function deduplicateRoute(points) {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > 8);
}

function polylineLength(points = []) {
  let length = 0;
  for (let index = 0; index + 1 < points.length; index += 1) length += distance(points[index], points[index + 1]);
  return length;
}

function pointRectDistance(point, rect) {
  const dx = Math.max(rect.x - rect.width / 2 - point.x, 0, point.x - rect.x - rect.width / 2);
  const dy = Math.max(rect.y - rect.height / 2 - point.y, 0, point.y - rect.y - rect.height / 2);
  return Math.hypot(dx, dy);
}

function getExploreTarget(
  player, map, brain, teammates, anchor, radius, now, roleIndex = 0, roleCount = 1,
  forwardAnchor = anchor, teamIntel = null, visionObjects = null,
) {
  const currentCell = explorationCellKey(player);
  const previous = brain.explorationTarget;
  if (previous && distance(player, previous) > 58 &&
      explorationCellKey(previous) !== currentCell &&
      (brain.blockedCells[explorationCellKey(previous)] ?? 0) <= now &&
      !isCoveredByTeamIntel(previous, map, teamIntel, visionObjects)) return previous;

  const forwardAngle = Math.atan2(forwardAnchor.y - anchor.y, forwardAnchor.x - anchor.x);
  const sectorWidth = Math.min(Math.PI * 0.9, (Math.PI * 1.5) / Math.max(1, roleCount));
  const sectorOffset = (roleIndex - (roleCount - 1) / 2) * sectorWidth;
  const preferredAngle = forwardAngle + sectorOffset;
  const radii = [radius * 0.85, radius * 1.35, radius * 1.8];
  let best = null;
  let bestScore = Infinity;
  for (let ring = 0; ring < radii.length; ring += 1) {
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const angle = preferredAngle + ((spoke / 15) - 0.5) * sectorWidth;
      const candidate = {
        x: clamp(anchor.x + Math.cos(angle) * radii[ring], 28, map.width - 28),
        y: clamp(anchor.y + Math.sin(angle) * radii[ring], 28, map.height - 28),
      };
      const key = explorationCellKey(candidate);
      const visitedAt = brain.visitedCells[key] ?? 0;
      const blockedUntil = brain.blockedCells[key] ?? 0;
      const teamSpacingPenalty = teammates.filter((ally) => ally.id !== player.id)
        .reduce((sum, ally) => sum + Math.max(0, 150 - distance(candidate, ally)) * 1.8, 0);
      const coveragePenalty = isCoveredByTeamIntel(candidate, map, teamIntel, visionObjects) ? 650 : 0;
      const score = distance(player, candidate) * 0.45 + distance(anchor, candidate) * 0.2 +
        teamSpacingPenalty + (visitedAt > now - 25_000 ? 450 : 0) + (blockedUntil > now ? 1_000 : 0) +
        coveragePenalty + ring * 8 + spoke * 0.03;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
  }
  brain.explorationTarget = best ?? { ...anchor };
  return brain.explorationTarget;
}

function getTeamSpreadTarget(player, teammates, anchor, radius, brain, role, roleIndex = 0) {
  const cached = brain.spreadTarget;
  if (cached?.role === role && distance(cached.anchor, anchor) < 75 && distance(player, cached.target) > 38) {
    const crowded = teammates.some((ally) => ally.id !== player.id && distance(ally, cached.target) < 60);
    if (!crowded) return cached.target;
  }
  const start = ((roleIndex * 5) + hashString(`${player.id}:${role}`) % 3) % 16;
  let best = null;
  let bestScore = Infinity;
  for (let offset = 0; offset < 16; offset += 1) {
    const sector = (start + offset) % 16;
    const angle = (sector * TAU) / 16;
    const candidate = { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
    const spacingPenalty = teammates.filter((ally) => ally.id !== player.id)
      .reduce((sum, ally) => sum + Math.max(0, 125 - distance(ally, candidate)) * 2.4, 0);
    const score = distance(player, candidate) + spacingPenalty + offset * 2;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  brain.spreadTarget = { role, anchor: { ...anchor }, target: best ?? { ...anchor } };
  return brain.spreadTarget.target;
}

function isCoveredByTeamIntel(point, map, teamIntel, visionObjects) {
  return getTeamCoverageCount(point, map, teamIntel, visionObjects) > 0;
}

function getTeamCoverageCount(point, map, teamIntel, visionObjects, excludedObserverId = null) {
  let coverage = 0;
  const objects = visionObjects ?? map.objects ?? [];
  for (const source of teamIntel?.visionSources ?? []) {
    if (source.observerId === excludedObserverId) continue;
    if (isPointVisible(point, source, source.xray ? [] : objects)) coverage += 1;
  }
  return coverage;
}

function getNearbyIntelEntrance(player, map, intelPosition, teamIntel = null, visionObjects = null) {
  let best = null;
  let bestScore = Infinity;
  for (const corridor of map.corridors ?? []) {
    for (const point of corridor.points ?? []) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          distance(point, intelPosition) > 260 || distance(player, point) > 1_000 ||
          !hasClearLine(point, intelPosition, map.objects ?? [])) continue;
      const coveragePenalty = getTeamCoverageCount(
        point, map, teamIntel, visionObjects, player.id,
      ) * 220;
      const score = distance(player, point) + distance(point, intelPosition) * 0.45 + coveragePenalty;
      if (score < bestScore) {
        best = { x: point.x, y: point.y };
        bestScore = score;
      }
    }
  }
  return best;
}

function isOneOfNearestBotResponders(bot, teammates, target, responseLimit) {
  const responders = teammates.filter((ally) =>
    (ally.id === bot.id || ally.isBot === true) && (!ally.controlledById || ally.id === bot.id));
  if (!responders.some((ally) => ally.id === bot.id)) responders.push(bot);
  responders.sort((left, right) =>
    distance(left, target) - distance(right, target) || left.id.localeCompare(right.id));
  return responders.findIndex((ally) => ally.id === bot.id) < responseLimit;
}

function explorationCellKey(point) {
  return `${Math.floor(point.x / EXPLORE_CELL_SIZE)}:${Math.floor(point.y / EXPLORE_CELL_SIZE)}`;
}

function isShotLaneClear(shooter, enemy, direction, map, weapon, teammates,
  targetRadius = PLAYER_RADIUS, lean = shooter.weaponLean ?? 0) {
  const targetDistance = distance(shooter, enemy);
  if (targetDistance <= 1 || targetDistance > weapon.range) return false;
  const angle = Math.atan2(direction.y, direction.x);
  const start = getWeaponMuzzlePosition(shooter, angle, lean, map.objects);
  const length = Math.min(weapon.range, targetDistance + PLAYER_RADIUS * 3);
  const end = { x: start.x + direction.x * length, y: start.y + direction.y * length };
  const targetHit = segmentCircleEntryTCoordinates(start.x, start.y, end.x, end.y, enemy.x, enemy.y,
    targetRadius + weapon.radius);
  const targetPassDistance = targetHit === null ? targetDistance : targetHit * length + targetRadius * 2;
  let firstWall = Infinity;
  for (const object of map.objects) {
    const hit = segmentMapObjectEntryT(start, end, object, weapon.radius);
    if (hit !== null) firstWall = Math.min(firstWall, hit * length);
  }
  if (firstWall < targetPassDistance) return false;
  const weaponStats = shooter.weaponStats?.[weapon.id] ?? {};
  const accuracy = weaponStats.effectiveAccuracy ?? weaponStats.accuracy ?? weapon.accuracy.startingAccuracy ?? 0.75;
  const spread = getMaximumSpreadRadians(accuracy, weapon.accuracy.maxSpreadDegrees);
  for (const ally of teammates) {
    if (ally.id === shooter.id || !ally.alive || ally.health <= 0) continue;
    const dx = ally.x - start.x;
    const dy = ally.y - start.y;
    const along = dx * direction.x + dy * direction.y;
    if (along <= 0 || along >= Math.min(firstWall, targetPassDistance)) continue;
    const lateral = Math.abs(dx * direction.y - dy * direction.x);
    const safetyRadius = PLAYER_RADIUS + weapon.radius + Math.tan(spread) * along;
    if (lateral <= safetyRadius) return false;
  }
  return true;
}

function isBotSpottedByEnemy(bot, enemy, map, visionObjects, now) {
  if (isPlayerFlashBlinded(enemy, now) || isPlayerJammed(enemy, now)) return false;
  const weaponId = enemy.selectedWeaponId ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.id;
  const enemyVision = {
    origin: getPlayerVisionOrigin(enemy, map.objects ?? []),
    angle: enemy.visionAngle ?? enemy.weaponStats?.[weaponId]?.aimAngle ?? 0,
    halfAngle: VISION_HALF_ANGLE,
  };
  return isPointVisible(bot, enemyVision, visionObjects);
}

function getVisibleEnemyAimPoint(shooter, enemy, vision, visionObjects, map, weapon, teammates, lean) {
  const isClearAimPoint = (point) => isPointVisible(point, vision, visionObjects) &&
    isShotLaneClear(
      shooter,
      enemy,
      unitVector(shooter, point),
      map,
      weapon,
      teammates,
      enemy.radius ?? PLAYER_RADIUS,
      lean,
    );
  if (isClearAimPoint(enemy)) return { x: enemy.x, y: enemy.y };

  const radius = enemy.radius ?? PLAYER_RADIUS;
  const sampleCount = Math.max(24, Math.ceil(TAU * radius / 1.25));
  for (const fraction of [0.55, 0.98]) {
    for (let index = 0; index < sampleCount; index += 1) {
      const angle = index * TAU / sampleCount;
      const point = {
        x: enemy.x + Math.cos(angle) * radius * fraction,
        y: enemy.y + Math.sin(angle) * radius * fraction,
      };
      if (isClearAimPoint(point)) return point;
    }
  }
  return { x: enemy.x, y: enemy.y };
}

function combatMovementTarget(player, enemy, brain, map, roleIndex, weaponId = 'assault-rifle') {
  const distanceToEnemy = distance(player, enemy);
  const weapon = BOT_WEAPONS_BY_ID.get(weaponId);
  if (weapon?.weaponClass === 'sniper' && distanceToEnemy > 360) {
    return getSniperOverwatchTarget(player, enemy, map) ?? enemy;
  }
  const isSmg = weaponId === 'smg' || weaponId === 'suppressed-smg';
  const preferredRange = weaponId === 'shotgun' ? 145 : isSmg ? 245 : 255;
  const enterStrafe = weaponId === 'shotgun' ? 175 : isSmg ? 250 : 255;
  const resumeApproach = weaponId === 'shotgun' ? 230 : isSmg ? 330 : 335;
  const retreatRange = weaponId === 'shotgun' ? 72 : 112;
  const resumeStrafe = weaponId === 'shotgun' ? 108 : 155;
  if (brain.combatMode === 'approach' && distanceToEnemy < enterStrafe) brain.combatMode = 'strafe';
  else if (brain.combatMode === 'strafe' && distanceToEnemy > resumeApproach) brain.combatMode = 'approach';
  else if (brain.combatMode === 'strafe' && distanceToEnemy < retreatRange) brain.combatMode = 'retreat';
  else if (brain.combatMode === 'retreat' && distanceToEnemy > resumeStrafe) brain.combatMode = 'strafe';
  if (brain.combatMode === 'approach') return enemy;
  if (brain.combatMode === 'retreat') {
    return { x: player.x + (player.x - enemy.x) * 0.8, y: player.y + (player.y - enemy.y) * 0.8 };
  }
  if (Math.abs(distanceToEnemy - preferredRange) > 55) {
    const toward = unitVector(player, enemy);
    const step = Math.min(115, Math.abs(distanceToEnemy - preferredRange));
    const sign = distanceToEnemy > preferredRange ? 1 : -1;
    return { x: player.x + toward.x * step * sign, y: player.y + toward.y * step * sign };
  }
  const dx = enemy.x - player.x;
  const dy = enemy.y - player.y;
  return { x: player.x - dy * brain.strafeSign, y: player.y + dx * brain.strafeSign };
}

function retreatPoint(player, enemy, map, sign) {
  const awayAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x) + sign * 0.75;
  return {
    x: clamp(player.x + Math.cos(awayAngle) * 240, 24, map.width - 24),
    y: clamp(player.y + Math.sin(awayAngle) * 240, 24, map.height - 24),
  };
}

function directionInput(position, target) {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  if (Math.hypot(dx, dy) < 18) return { up: false, down: false, left: false, right: false };
  return { up: dy < -8, down: dy > 8, left: dx < -8, right: dx > 8 };
}

const GADGET_TACTIC_WEIGHTS = Object.freeze({
  [MOLOTOV_ID]: Object.freeze({ group: 4.5, approachingThreat: 1.8, teammateMargin: 65 }),
  [CRYO_GRENADE_ID]: Object.freeze({ group: 2.5, approachingThreat: 3, teammateMargin: 35 }),
});
const TROPHY_COMMAND_CLEAR_WEIGHTS = Object.freeze({
  [MOLOTOV_ID]: 5,
  [BIO_FIELD_ID]: 5,
  [ORBITAL_STRIKE_ID]: 5,
  [CRYO_GRENADE_ID]: 4,
  [TROPHY_SYSTEM_ID]: 4,
  [PROXIMITY_MINE_ID]: 3,
  [VINE_TRAP_ID]: 3,
  [SPY_CAMERA_ID]: 3,
  [JAMMER_GRENADE_ID]: 3,
  [SMOKE_GRENADE_ID]: 2,
  [FLASH_GRENADE_ID]: 2,
  [SONAR_ID]: 2,
});
const BOT_GADGET_CLOSE_THREAT_RANGE = 360;

function chooseBotGadgetAction(bot, match, visibleEnemies, teammates, now, context = {}) {
  if (Number.isFinite(bot.gadgetSwitchEndsAt) && bot.gadgetSwitchEndsAt > now) return null;

  const equippedSlot = getBotEquippedSlot(bot, now);
  if (context.armorRecovery) return equippedSlot === 'gadget' ? { action: 'switch' } : null;
  const gadgetId = bot.selectedGadgetId;
  const gadget = GADGET_DEFINITIONS[gadgetId];
  const count = bot.gadgetCounts?.[gadgetId] ?? bot.gadgetCount ?? 0;
  const gadgetEffects = getCurrentGadgetEffects(match, now);
  const gadgetContext = {
    ...context,
    gadgetEffects,
    knownEnemyTrophies: getKnownEnemyTrophies(bot, gadgetEffects, now, context),
  };
  const infiniteGadgetUse = match.infiniteGadgetUse === true;
  const ownedTrophy = gadgetId === TROPHY_SYSTEM_ID
    ? (match.gadgetEffects ?? []).find((effect) => effect.ownerId === bot.id &&
      effect.type === TROPHY_SYSTEM_ID && effect.team === bot.team &&
      effect.startedAt <= now && effect.expiresAt > now &&
      (effect.health ?? TROPHY_SYSTEM_HEALTH) > 0)
    : null;
  const trophyCommandReady = ownedTrophy &&
    (infiniteGadgetUse || now >= (bot.trophyCommandReadyAt ?? 0));
  const canUse = now >= (match.gameplayStartsAt ?? 0) &&
    (count > 0 || infiniteGadgetUse || trophyCommandReady);
  let target = null;
  if (canUse) {
    switch (gadgetId) {
      case SMOKE_GRENADE_ID:
        target = chooseSmokeTarget(bot, match, visibleEnemies, teammates, now, context);
        break;
      case FLASH_GRENADE_ID:
        target = chooseFlashTarget(bot, match, visibleEnemies, teammates, now, context);
        break;
      case JAMMER_GRENADE_ID:
        target = chooseJammerTarget(bot, match, visibleEnemies, now, gadgetContext);
        break;
      case BIO_FIELD_ID:
        target = chooseBioFieldTarget(bot, match, teammates, visibleEnemies, now, gadgetContext, gadgetEffects);
        break;
      case PROXIMITY_MINE_ID:
      case VINE_TRAP_ID:
        target = chooseProximityMineTarget(bot, match, visibleEnemies, teammates, now, gadgetContext);
        break;
      case ORBITAL_STRIKE_ID:
        target = chooseOrbitalStrikeTarget(bot, match, visibleEnemies, teammates, now, context);
        break;
      case SPY_CAMERA_ID:
        target = chooseSpyCameraTarget(bot, match, visibleEnemies, now, gadgetContext);
        break;
      case TROPHY_SYSTEM_ID:
        target = ownedTrophy
          ? chooseTrophyCommandTarget(bot, match, ownedTrophy, now, gadgetContext)
          : chooseTrophySystemTarget(bot, match, visibleEnemies, now, gadgetContext);
        break;
      case SONAR_ID:
        target = chooseSonarTarget(bot, match, visibleEnemies, now, context);
        break;
      case KATANA_ID:
        target = chooseKatanaDashTarget(bot, match, visibleEnemies);
        break;
      default:
        if (gadgetId === MOLOTOV_ID || gadgetId === CRYO_GRENADE_ID) {
          target = gadgetId === CRYO_GRENADE_ID
            ? chooseMolotovCounterTarget(bot, match, teammates, now, gadgetContext, gadgetEffects) ??
              chooseGadgetTarget(bot, match, gadget, visibleEnemies, teammates, now,
                gadgetEffects, gadgetContext)
            : chooseGadgetTarget(bot, match, gadget, visibleEnemies, teammates, now,
              gadgetEffects, gadgetContext);
        }
    }
  }

  if (target) {
    return equippedSlot === 'gadget'
      ? { action: 'use', target }
      : { action: 'switch' };
  }
  return equippedSlot === 'gadget' ? { action: 'switch' } : null;
}

function getBotEquippedSlot(bot, now) {
  if (Number.isFinite(bot.gadgetSwitchEndsAt) && bot.gadgetSwitchEndsAt <= now) {
    return bot.gadgetSwitchTargetSlot ?? bot.equippedSlot ?? 'weapon';
  }
  return bot.equippedSlot ?? 'weapon';
}

function chooseJammerTarget(bot, match, visibleEnemies, now, context) {
  const gadget = GADGET_DEFINITIONS[JAMMER_GRENADE_ID];
  const mapObjects = match.map.objects ?? [];
  const visionObjects = context.visionObjects ?? mapObjects;
  const candidates = visibleEnemies
    .filter((enemy) => !isPlayerJammed(enemy, now) && distance(bot, enemy) <= gadget.throwRange)
    .map((enemy) => ({ x: enemy.x, y: enemy.y }));
  let best = null;
  for (const target of candidates) {
    const origin = getGadgetThrowOrigin(bot, target, mapObjects);
    const trajectory = origin && calculateGadgetTrajectory(origin, target, mapObjects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory || isTrajectoryCoveredByTrophy(
      trajectory, context.knownEnemyTrophies ?? [], visionObjects,
    )) continue;
    const nearbyEnemies = visibleEnemies.filter((enemy) =>
      distance(trajectory.endpoint, enemy) <= JAMMER_GRENADE_RADIUS).length;
    const nearbyGadgets = (context.gadgetEffects ?? match.gadgetEffects ?? []).filter((effect) =>
      effect.team !== bot.team && effect.expiresAt > now &&
      Number.isFinite(effect.x) && Number.isFinite(effect.y) &&
      distance(trajectory.endpoint, effect) <= JAMMER_GRENADE_RADIUS).length;
    const score = nearbyEnemies * 10 + nearbyGadgets;
    if (!best || score > best.score) best = { target, score };
  }
  return best?.target ?? null;
}

function chooseFlashTarget(bot, match, visibleEnemies, teammates, now, context) {
  const gadget = GADGET_DEFINITIONS[FLASH_GRENADE_ID];
  const radius = gadget.effectRadius;
  const map = match.map;
  const mapObjects = map.objects ?? [];
  const visionObjects = context.visionObjects ?? mapObjects;
  const candidates = visibleEnemies
    .filter((enemy) => !Number.isFinite(enemy.flashUntil) || enemy.flashUntil <= now)
    .map(({ x, y }) => ({ x, y }));

  for (let first = 0; first < visibleEnemies.length; first += 1) {
    const left = visibleEnemies[first];
    if (Number.isFinite(left.flashUntil) && left.flashUntil > now) continue;
    for (let second = first + 1; second < visibleEnemies.length; second += 1) {
      const right = visibleEnemies[second];
      if (Number.isFinite(right.flashUntil) && right.flashUntil > now) continue;
      if (distance(left, right) > radius * 2) continue;
      candidates.push({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    }
  }
  let best = null;
  for (const target of candidates) {
    const origin = getGadgetThrowOrigin(bot, target, mapObjects);
    const trajectory = calculateGadgetTrajectory(origin, target, mapObjects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory || isTrajectoryCoveredByTrophy(
      trajectory, context.knownEnemyTrophies ?? [], visionObjects,
    )) continue;
    const endpoint = trajectory.endpoint;
    const detonationSeconds = (trajectory.distance / getGadgetProjectileSpeed(gadget)) +
      (gadget.detonationDelayMs ?? 0) / 1_000;
    const predictedBot = predictGadgetActorPosition(bot, detonationSeconds, map);
    const flashVision = {
      origin: endpoint,
      angle: 0,
      halfAngle: Math.PI,
      maximumRange: radius,
    };
    const wouldBlindTeammate = teammates.some((ally) => {
      const positions = [ally, predictGadgetActorPosition(ally, detonationSeconds, map)];
      return positions.some((position) =>
        distance(position, endpoint) <= radius &&
        isPointVisible(position, flashVision, visionObjects));
    });
    if (wouldBlindTeammate) continue;

    const affectedEnemies = visibleEnemies.filter((enemy) => {
      if (Number.isFinite(enemy.flashUntil) && enemy.flashUntil > now) return false;
      const predictedEnemy = predictGadgetActorPosition(enemy, detonationSeconds, map);
      return distance(predictedEnemy, endpoint) <= radius &&
        isPointVisible(predictedEnemy, flashVision, visionObjects);
    });
    if (!affectedEnemies.length) continue;
    const approachingCount = affectedEnemies.filter((enemy) => isApproachingThreat(enemy, bot, match)).length;
    const closeThreatCount = affectedEnemies.filter((enemy) =>
      distance(predictGadgetActorPosition(enemy, detonationSeconds, map), predictedBot) <=
      BOT_GADGET_CLOSE_THREAT_RANGE).length;

    const score = 1 + Math.max(0, affectedEnemies.length - 1) * 3.5 +
      Math.min(approachingCount, 1) * 1.5 + Number(closeThreatCount > 0) * 1.3;
    const targetDistance = distance(bot, endpoint);
    if (!best || score > best.score || (score === best.score && targetDistance < best.distance)) {
      best = { target, score, distance: targetDistance };
    }
  }
  return best?.target ?? null;
}

function predictGadgetActorPosition(actor, seconds, map) {
  return {
    x: clamp(actor.x + (actor.vx ?? 0) * seconds, PLAYER_RADIUS, map.width - PLAYER_RADIUS),
    y: clamp(actor.y + (actor.vy ?? 0) * seconds, PLAYER_RADIUS, map.height - PLAYER_RADIUS),
  };
}

function chooseMolotovCounterTarget(bot, match, teammates, now, context, gadgetEffects) {
  const cryo = GADGET_DEFINITIONS[CRYO_GRENADE_ID];
  const cryoRadius = cryo.effectRadius;
  const mapObjects = match.map.objects ?? [];
  const visionObjects = context.visionObjects ?? mapObjects;
  const allies = [bot, ...teammates].filter((ally) =>
    ally.team === bot.team && ally.alive !== false && (ally.health ?? 100) > 0);
  const activeCryos = gadgetEffects.filter((effect) => effect.type === 'cryo');
  const activeAreaDenial = gadgetEffects.filter(isAreaDenialEffect);
  const molotovs = gadgetEffects.filter((effect) =>
    effect.type === 'molotov' && effect.startedAt <= now && effect.expiresAt > now &&
    ['red', 'blue'].includes(effect.team) && effect.team !== bot.team &&
    (!context.vision || isPointVisible(effect, context.vision, visionObjects)));
  let best = null;

  for (const molotov of molotovs) {
    const molotovRadius = getEffectAreaRadius(molotov);
    if (activeCryos.some((effect) => overlapsEffectArea(molotov, molotovRadius, effect))) continue;
    const threatenedAllies = allies.filter((ally) =>
      distance(ally, molotov) <= molotovRadius + PLAYER_RADIUS);
    const waypoint = context.waypoint;
    const blocksTeamRoute = waypoint && allies.some((ally) =>
      distanceToSegment(molotov, ally, waypoint) <= molotovRadius + PLAYER_RADIUS);
    if (threatenedAllies.length === 0 && !blocksTeamRoute) continue;

    const safetyRadius = cryoRadius + PLAYER_RADIUS +
      GADGET_TACTIC_WEIGHTS[CRYO_GRENADE_ID].teammateMargin;
    const requiredSeparation = Math.min(
      cryoRadius + molotovRadius - 1,
      safetyRadius + 2,
    );
    const candidates = [{ x: molotov.x, y: molotov.y }];
    for (let index = 0; index < 16; index += 1) {
      const angle = index * TAU / 16;
      candidates.push({
        x: molotov.x + Math.cos(angle) * requiredSeparation,
        y: molotov.y + Math.sin(angle) * requiredSeparation,
      });
    }

    for (const target of candidates) {
      if (target.x < PLAYER_RADIUS || target.y < PLAYER_RADIUS ||
          target.x > match.map.width - PLAYER_RADIUS || target.y > match.map.height - PLAYER_RADIUS) continue;
      const origin = getGadgetThrowOrigin(bot, target, mapObjects);
      const trajectory = origin && calculateGadgetTrajectory(origin, target, mapObjects, {
        maximumRange: cryo.throwRange,
        collisionRadius: cryo.throwCollisionRadius,
        maximumBounces: cryo.maxBounces,
      });
      if (!trajectory || isTrajectoryCoveredByTrophy(
        trajectory, context.knownEnemyTrophies ?? [], visionObjects,
      ) || distance(trajectory.endpoint, molotov) > cryoRadius + molotovRadius) continue;
      const flightSeconds = trajectory.distance / getGadgetProjectileSpeed(cryo);
      const predictedAllies = allies.map((ally) => predictGadgetActorPosition(ally, flightSeconds, match.map));
      if (predictedAllies.some((ally) => distance(ally, trajectory.endpoint) < safetyRadius)) continue;

      const otherAreaOverlap = activeAreaDenial.some((effect) =>
        effect.id !== molotov.id &&
        overlapsEffectArea(trajectory.endpoint, cryoRadius, effect));
      if (otherAreaOverlap) continue;

      const score = 8 + threatenedAllies.length * 4 + Number(Boolean(blocksTeamRoute)) * 3;
      const targetDistance = distance(bot, trajectory.endpoint);
      if (!best || score > best.score ||
          (score === best.score && targetDistance < best.distance)) {
        best = { target, score, distance: targetDistance };
      }
    }
  }
  return best?.target ?? null;
}

function chooseGadgetTarget(
  bot, match, gadget, visibleEnemies, teammates, now, gadgetEffects, context,
) {
  if (!visibleEnemies.length) return null;
  const weights = GADGET_TACTIC_WEIGHTS[gadget.id];
  const radius = gadget.effectRadius ?? 60;
  const safetyRadius = radius + PLAYER_RADIUS + weights.teammateMargin;
  const candidates = visibleEnemies.map(({ x, y }) => ({ x, y }));

  for (let first = 0; first < visibleEnemies.length; first += 1) {
    for (let second = first + 1; second < visibleEnemies.length; second += 1) {
      const left = visibleEnemies[first];
      const right = visibleEnemies[second];
      if (distance(left, right) > radius * 2) continue;
      candidates.push({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 });
    }
  }

  const mapObjects = match.map.objects;
  const activeEffects = gadgetEffects.filter((effect) =>
    effect.type === gadget.effectType && effect.startedAt <= now && effect.expiresAt > now);
  const activeAreaDenial = gadgetEffects.filter(isAreaDenialEffect);
  let best = null;
  for (const target of candidates) {
    const origin = getGadgetThrowOrigin(bot, target, mapObjects);
    const trajectory = calculateGadgetTrajectory(origin, target, mapObjects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory || isTrajectoryCoveredByTrophy(
      trajectory, context.knownEnemyTrophies ?? [], match.map.objects ?? [],
    )) continue;
    const endpoint = trajectory.endpoint;
    if (teammates.some((ally) => ally.id !== bot.id && distance(ally, endpoint) < safetyRadius)) continue;
    if ((gadget.id === MOLOTOV_ID || gadget.id === CRYO_GRENADE_ID) &&
        activeAreaDenial.some((effect) => overlapsEffectArea(endpoint, radius, effect))) continue;

    const affectedEnemies = visibleEnemies.filter((enemy) =>
      distance(enemy, endpoint) <= radius &&
      !activeEffects.some((effect) => distance(enemy, effect) <= (effect.radius ?? radius)));
    const groupCount = affectedEnemies.length;
    if (!groupCount) continue;
    const closeThreatCount = affectedEnemies.filter((enemy) =>
      distance(enemy, bot) <= BOT_GADGET_CLOSE_THREAT_RANGE).length;
    const approachingCount = affectedEnemies.filter((enemy) =>
      isApproachingThreat(enemy, bot, match)).length;
    if (groupCount < 2 && closeThreatCount === 0 && approachingCount === 0) continue;

    const score = Math.max(0, groupCount - 1) * weights.group +
      Math.min(approachingCount, 1) * weights.approachingThreat;
    const distanceToTarget = distance(bot, endpoint);
    if (!best || score > best.score ||
        (score === best.score && distanceToTarget < best.distance)) {
      best = { target, score, distance: distanceToTarget };
    }
  }
  return best?.target ?? null;
}

function chooseOrbitalStrikeTarget(bot, match, visibleEnemies, teammates, now, context) {
  const gadget = GADGET_DEFINITIONS[ORBITAL_STRIKE_ID];
  const radius = gadget.effectRadius;
  const warningSeconds = (gadget.warningDurationMs ?? 0) / 1_000;
  const candidates = visibleEnemies.map((enemy) => ({
    x: enemy.x + (enemy.vx ?? 0) * warningSeconds,
    y: enemy.y + (enemy.vy ?? 0) * warningSeconds,
    priority: enemy.id === match.flag?.heldBy ? 5 : 3,
  }));
  for (let first = 0; first < visibleEnemies.length; first += 1) {
    for (let second = first + 1; second < visibleEnemies.length; second += 1) {
      const left = visibleEnemies[first];
      const right = visibleEnemies[second];
      if (distance(left, right) <= radius * 2) {
        candidates.push({
          x: (left.x + right.x) / 2,
          y: (left.y + right.y) / 2,
          priority: 4,
        });
      }
    }
  }
  for (const hint of getEnemyPositionHints(bot, match, visibleEnemies, now, context)) {
    if (hint.source === 'sighting' && hint.ageMs <= ORBITAL_STRIKE_MAX_INTEL_AGE_MS) {
      const speed = Math.hypot(hint.vx ?? 0, hint.vy ?? 0);
      const leadSeconds = hint.ageMs / 1_000 + warningSeconds;
      const uncertainty = PLAYER_RADIUS + speed * leadSeconds * 0.15;
      if (uncertainty <= radius) {
        candidates.push({
          x: hint.x + (hint.vx ?? 0) * leadSeconds,
          y: hint.y + (hint.vy ?? 0) * leadSeconds,
          priority: hint.priority,
        });
      }
    } else if (hint.source === 'audio' && hint.kind === 'gunshot' &&
        hint.ageMs <= ORBITAL_STRIKE_MAX_INTEL_AGE_MS && hint.uncertainty <= radius) {
      candidates.push({ x: hint.x, y: hint.y, priority: hint.priority });
    }
  }

  const activeWarnings = [
    ...(match.pendingGadgetEffects ?? [])
      .filter((pending) => pending.effect?.type === 'orbital-strike-warning' &&
        (pending.detonatesAt ?? pending.effect.expiresAt) > now)
      .map((pending) => pending.effect),
    ...(match.gadgetEffects ?? []).filter((effect) =>
      effect.type === 'orbital-strike' && effect.expiresAt > now),
  ];
  let best = null;
  for (const target of candidates) {
    if (target.x < 0 || target.y < 0 || target.x > match.map.width || target.y > match.map.height ||
        teammates.some((ally) => ally.id !== bot.id &&
          distance(ally, target) <= radius + PLAYER_RADIUS + 8) ||
        activeWarnings.some((warning) => distance(warning, target) <= (warning.radius ?? radius) + radius)) {
      continue;
    }
    const affectedEnemies = visibleEnemies.filter((enemy) => {
      const predicted = {
        x: enemy.x + (enemy.vx ?? 0) * warningSeconds,
        y: enemy.y + (enemy.vy ?? 0) * warningSeconds,
      };
      return distance(predicted, target) <= radius;
    }).length;
    const score = target.priority + affectedEnemies * 3;
    const targetDistance = distance(bot, target);
    if (!best || score > best.score || (score === best.score && targetDistance < best.distance)) {
      best = { target: { x: target.x, y: target.y }, score, distance: targetDistance };
    }
  }
  return best?.target ?? null;
}

function chooseSpyCameraTarget(bot, match, visibleEnemies, now, context) {
  const visionObjects = context.visionObjects ?? match.map.objects ?? [];
  if (isPointCoveredByTrophy(
    bot, context.knownEnemyTrophies ?? [], visionObjects,
  )) return null;
  if (bot.team === 'red') {
    const strikeProgress = getStrikeMineProgress(bot, match.map);
    if (strikeProgress === null || strikeProgress < STRIKE_SPY_CAMERA_MIN_PROGRESS) return null;
  }
  const gadget = GADGET_DEFINITIONS[SPY_CAMERA_ID];
  const map = match.map;
  const mapObjects = map.objects ?? [];
  const cameraEffects = (context.gadgetEffects ?? getCurrentGadgetEffects(match, now))
    .filter((effect) => effect.type === SPY_CAMERA_ID && effect.team === bot.team &&
      (effect.startedAt ?? 0) <= now && effect.expiresAt > now && (effect.health ?? 1) > 0 &&
      (!Number.isFinite(effect.disabledUntil) || effect.disabledUntil <= now) &&
      !isGadgetJammed(effect, now))
    .map((camera) => ({
      origin: { x: camera.x, y: camera.y },
      angle: camera.angle ?? 0,
      halfAngle: camera.visionHalfAngle ?? gadget.visionHalfAngle,
      maximumRange: camera.visionRange ?? gadget.visionRange,
      xray: true,
    }));
  const interests = [];
  const candidates = [];
  const addInterest = (point, priority, candidatePriority = priority) => {
    if (![point?.x, point?.y].every(Number.isFinite)) return;
    interests.push({ point, priority });
    addCandidate(point, candidatePriority);
  };
  const addCandidate = (point, priority = 0) => {
    if (candidates.length >= 48 || ![point?.x, point?.y].every(Number.isFinite) ||
        distance(bot, point) <= 1) return;
    const angle = Math.atan2(point.y - bot.y, point.x - bot.x);
    if (candidates.some((candidate) =>
      Math.abs(normalizeAngle(candidate.angle - angle)) < 0.035)) return;
    candidates.push({ point: { x: point.x, y: point.y }, angle, priority });
  };
  for (const enemy of visibleEnemies) {
    const priority = enemy.id === match.flag?.heldBy ? 16 : 10;
    addInterest(enemy, priority, priority / 2);
  }
  for (const hint of getEnemyPositionHints(bot, match, visibleEnemies, now, context).slice(0, 8)) {
    const priority = hint.priority ?? 2;
    addInterest(hint, priority, priority);
  }
  const waypoint = context.waypoint ?? match.flag;
  if (waypoint) addInterest(waypoint, 2);

  const blueRoom = (map.rooms ?? []).find((room) =>
    room.id === 'blue-spawn' || (room.isSpawn && room.team === 'blue'));
  if (bot.team === 'red' && map.spawnZones?.blue) {
    addInterest(center(map.spawnZones.blue), 8, 4);
  }
  if (blueRoom) {
    for (const corridor of map.corridors ?? []) {
      if (corridor.a !== blueRoom.id && corridor.b !== blueRoom.id) continue;
      const points = corridor.a === blueRoom.id
        ? corridor.points ?? [] : [...(corridor.points ?? [])].reverse();
      const routeLength = polylineLength(points);
      if (routeLength <= 0) continue;
      const sampleDistances = [80, 160, 240].filter((along) => along < routeLength);
      if (sampleDistances.length === 0) sampleDistances.push(routeLength * 0.5);
      for (const along of sampleDistances) {
        const point = pointAlongPolyline(points, along);
        addInterest(point, bot.team === 'blue' ? 9 : 7, 3);
      }
    }
  }
  for (const corridor of map.corridors ?? []) {
    for (const point of corridor.points ?? []) {
      if (candidates.length >= 32) break;
      addCandidate(point, 0.5);
    }
    if (candidates.length >= 32) break;
  }
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU;
    addCandidate({
      x: bot.x + Math.cos(angle) * gadget.visionRange * 0.8,
      y: bot.y + Math.sin(angle) * gadget.visionRange * 0.8,
    });
  }

  let best = null;
  for (const candidate of candidates) {
    if (cameraEffects.some((camera) => isPointVisible(candidate.point, camera, []))) continue;
    const view = {
      origin: { x: bot.x, y: bot.y },
      angle: candidate.angle,
      halfAngle: gadget.visionHalfAngle,
      maximumRange: gadget.visionRange,
      xray: true,
    };
    const totalSamples = 25;
    let openSamples = 0;
    let uniqueSamples = 0;
    for (const radius of [65, 125, 185, 245, gadget.visionRange - 10]) {
      for (const spread of [-0.9, -0.45, 0, 0.45, 0.9]) {
        const angle = candidate.angle + gadget.visionHalfAngle * spread;
        const sample = {
          x: bot.x + Math.cos(angle) * radius,
          y: bot.y + Math.sin(angle) * radius,
        };
        if (sample.x < PLAYER_RADIUS || sample.y < PLAYER_RADIUS ||
            sample.x > map.width - PLAYER_RADIUS || sample.y > map.height - PLAYER_RADIUS ||
            circleOverlapsMapObjects(sample, mapObjects, PLAYER_RADIUS * 0.5) ||
            !isPointVisible(sample, view, visionObjects)) continue;
        openSamples += 1;
        if (!cameraEffects.some((camera) => isPointVisible(sample, camera, []))) uniqueSamples += 1;
      }
    }
    if (openSamples < totalSamples * 0.55 ||
        uniqueSamples < Math.max(5, Math.ceil(openSamples * 0.35))) continue;
    const interestScore = interests.reduce((score, interest) =>
      score + (isPointVisible(interest.point, view, visionObjects) ? interest.priority : 0), 0);
    const score = uniqueSamples + interestScore * 2 + candidate.priority;
    if (!best || score > best.score) best = { point: candidate.point, score };
  }
  return best?.point ?? null;
}

function chooseTrophySystemTarget(bot, match, visibleEnemies, now, context) {
  const visionObjects = context.visionObjects ?? match.map.objects ?? [];
  const knownEnemyTrophies = context.knownEnemyTrophies ?? [];
  if (isPointCoveredByTrophy(bot, knownEnemyTrophies, visionObjects)) return null;
  const alreadyPlaced = (match.gadgetEffects ?? []).some((effect) =>
    effect.type === TROPHY_SYSTEM_ID && effect.ownerId === bot.id &&
    effect.team === bot.team && effect.expiresAt > now && (effect.health ?? TROPHY_SYSTEM_HEALTH) > 0);
  if (alreadyPlaced) return null;
  const nearbyThreat = visibleEnemies.some((enemy) => distance(bot, enemy) <= 650) ||
    Boolean(context.activeDamageCue);
  const progressedStrike = bot.team === 'red' &&
    (getStrikeMineProgress(bot, match.map) ?? 0) >= STRIKE_SPY_CAMERA_MIN_PROGRESS;
  const defendingSite = bot.team === 'blue' && ['hold-site', 'defend'].includes(context.action);
  if (!nearbyThreat && !progressedStrike && !defendingSite) return null;
  const friendlyTrophies = (context.gadgetEffects ?? getCurrentGadgetEffects(match, now))
    .filter((effect) => effect.type === TROPHY_SYSTEM_ID && effect.team === bot.team &&
      effect.ownerId !== bot.id && (effect.startedAt ?? 0) <= now && effect.expiresAt > now &&
      (effect.health ?? TROPHY_SYSTEM_HEALTH) > 0 && !isGadgetJammed(effect, now));
  const overlapsFriendlyCoverage = (point) => friendlyTrophies.some((trophy) =>
    distance(point, trophy) <= TROPHY_SYSTEM_COMMAND_RADIUS &&
    hasTrophyLineOfSight(trophy, point, visionObjects));
  if (!overlapsFriendlyCoverage(bot)) return { x: bot.x, y: bot.y };

  const gadget = GADGET_DEFINITIONS[TROPHY_SYSTEM_ID];
  const mapObjects = match.map.objects ?? [];
  let best = null;
  for (const radius of [100, 150, gadget.throwRange * 0.95, gadget.throwRange]) {
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const angle = spoke * TAU / 16;
      const target = {
        x: bot.x + Math.cos(angle) * radius,
        y: bot.y + Math.sin(angle) * radius,
      };
      if (target.x < PLAYER_RADIUS || target.y < PLAYER_RADIUS ||
          target.x > match.map.width - PLAYER_RADIUS || target.y > match.map.height - PLAYER_RADIUS ||
          circleOverlapsMapObjects(target, mapObjects, TROPHY_SYSTEM_BODY_RADIUS)) continue;
      const origin = getGadgetThrowOrigin(bot, target, mapObjects);
      const trajectory = origin && calculateGadgetTrajectory(origin, target, mapObjects, {
        maximumRange: gadget.throwRange,
        collisionRadius: gadget.throwCollisionRadius,
        maximumBounces: gadget.maxBounces,
      });
      if (!trajectory || distance(trajectory.endpoint, target) > 30 ||
          overlapsFriendlyCoverage(trajectory.endpoint) ||
          isTrajectoryCoveredByTrophy(trajectory, knownEnemyTrophies, visionObjects)) continue;
      const nearestFriendly = Math.min(...friendlyTrophies.map((trophy) =>
        distance(trajectory.endpoint, trophy)));
      const score = nearestFriendly - distance(bot, trajectory.endpoint) * 0.1;
      if (!best || score > best.score) best = { target, score };
    }
  }
  return best?.target ?? null;
}

function chooseTrophyCommandTarget(bot, match, trophy, now, context) {
  if (isPlayerJammed(bot, now) || isGadgetJammed(trophy, now)) return null;
  const visionObjects = context.visionObjects ?? match.map.objects;
  const projectileObjects = (match.map.objects ?? []).filter((object) => object?.blocksVision !== true);
  const candidates = [...(match.gadgetEffects ?? []), ...(match.smokes ?? [])].filter((effect) => {
    if (!GADGET_DEFINITIONS[effect?.gadgetId] || effect.team === bot.team ||
        !['red', 'blue'].includes(effect.team) || !Number.isFinite(effect.expiresAt) ||
        effect.expiresAt <= now || (Number.isFinite(effect.health) && effect.health <= 0) ||
        ![effect.x, effect.y].every(Number.isFinite) ||
        Math.hypot(effect.x - trophy.x, effect.y - trophy.y) <= 1e-6) return false;
    const targetVisionObjects = visionObjects.filter((object) => object?.id !== effect.id);
    if (!isPointVisible(effect, context.vision, targetVisionObjects) ||
        !hasTrophyLineOfSight(trophy, effect, targetVisionObjects)) return false;
    const trajectory = calculateGadgetTrajectory(
      { x: trophy.x, y: trophy.y },
      effect,
      projectileObjects,
      {
        maximumRange: Math.hypot(match.map.width, match.map.height),
        collisionRadius: DEFAULT_GADGET_THROW_COLLISION_RADIUS,
        maximumBounces: 0,
      },
    );
    return trajectory && !isTrajectoryCoveredByTrophy(
      trajectory,
      context.knownEnemyTrophies ?? [],
      visionObjects,
    );
  });
  let best = null;
  for (const target of candidates) {
    const pulseOrigin = { x: target.x, y: target.y };
    const targetScore = candidates.reduce((score, effect) => {
      if (!isTrophyCommandEffectInRangeAndSight(
        pulseOrigin,
        effect,
        visionObjects,
        TROPHY_SYSTEM_COMMAND_RADIUS,
      )) {
        return score;
      }
      return score + (TROPHY_COMMAND_CLEAR_WEIGHTS[effect.gadgetId] ?? 2);
    }, 0);
    const targetDistance = distance(trophy, target);
    if (!best || targetScore > best.score ||
        (targetScore === best.score && targetDistance < best.distance)) {
      best = { target: { x: target.x, y: target.y }, score: targetScore, distance: targetDistance };
    }
  }
  return best?.target ?? null;
}

function chooseSonarTarget(bot, match, visibleEnemies, now, context) {
  const activeOwnedSonar = (match.gadgetEffects ?? []).some((effect) =>
    effect.type === 'sonar-projectile' && effect.ownerId === bot.id && effect.expiresAt > now);
  if (activeOwnedSonar) return null;
  const hint = getEnemyPositionHints(bot, match, visibleEnemies, now, context)[0];
  if (hint) return { x: hint.x, y: hint.y };
  const waypoint = context.waypoint ?? match.flag;
  if (waypoint && distance(bot, waypoint) > 1) return { x: waypoint.x, y: waypoint.y };
  const enemySpawn = match.map.spawnZones?.[bot.team === 'red' ? 'blue' : 'red'];
  const fallback = enemySpawn ? center(enemySpawn) : { x: match.map.width / 2, y: match.map.height / 2 };
  if (distance(bot, fallback) > 1) return fallback;
  const angle = bot.visionAngle ?? 0;
  return { x: bot.x + Math.cos(angle) * 100, y: bot.y + Math.sin(angle) * 100 };
}

function chooseKatanaDashTarget(bot, match, visibleEnemies) {
  const map = match.map;
  const candidates = visibleEnemies
    .map((enemy) => ({ enemy, distance: distance(bot, enemy) }))
    .filter(({ distance: targetDistance }) => targetDistance <=
      GADGET_DEFINITIONS[KATANA_ID].dashDistance + KATANA_DASH_HIT_RADIUS)
    .sort((left, right) => Number(right.enemy.id === match.flag?.heldBy) -
      Number(left.enemy.id === match.flag?.heldBy) || left.distance - right.distance);
  for (const { enemy } of candidates) {
    const dash = calculateKatanaDash(bot, enemy, map.objects, map.width, map.height);
    if (!dash) continue;
    const firstHit = visibleEnemies
      .map((candidate) => ({
        candidate,
        entryT: segmentCircleEntryTCoordinates(
          dash.start.x, dash.start.y, dash.end.x, dash.end.y,
          candidate.x, candidate.y, KATANA_DASH_HIT_RADIUS,
        ),
      }))
      .filter((hit) => hit.entryT !== null)
      .sort((left, right) => left.entryT - right.entryT)[0];
    if (firstHit?.candidate.id === enemy.id) return { x: enemy.x, y: enemy.y };
  }
  return null;
}

function getTeamSightingTarget(bot, match, teamIntel, teammates, now, worldState = null) {
  const opposingTeam = bot.team === 'red' ? 'blue' : bot.team === 'blue' ? 'red' : null;
  const livingEnemies = opposingTeam
    ? worldState?.livingPlayersByTeam?.get(opposingTeam) ??
      match.players.filter((player) => player.team === opposingTeam && player.alive && player.health > 0)
    : match.players.filter((player) => player.team !== bot.team && player.alive && player.health > 0);
  const livingEnemyIds = new Set(livingEnemies.map((player) => player.id));
  const botResponders = teammates.filter((ally) =>
    (ally.id === bot.id || ally.isBot === true) && (!ally.controlledById || ally.id === bot.id));
  if (!botResponders.some((ally) => ally.id === bot.id)) botResponders.push(bot);

  let best = null;
  for (const sighting of teamIntel?.sightings ?? []) {
    if (sighting.team !== bot.team || !livingEnemyIds.has(sighting.enemyId) ||
        sighting.expiresAt <= now || !Number.isFinite(sighting.x) || !Number.isFinite(sighting.y)) continue;
    const observedAt = Number.isFinite(sighting.observedAt) ? sighting.observedAt : now;
    const ageMs = Math.max(0, now - observedAt);
    if (ageMs > 6_000) continue;
    const leadSeconds = Math.min(0.35, ageMs / 1_000);
    let leadX = (sighting.vx ?? 0) * leadSeconds;
    let leadY = (sighting.vy ?? 0) * leadSeconds;
    const leadDistance = Math.hypot(leadX, leadY);
    if (leadDistance > 120) {
      leadX *= 120 / leadDistance;
      leadY *= 120 / leadDistance;
    }
    const position = {
      x: clamp(sighting.x + leadX, PLAYER_RADIUS, match.map.width - PLAYER_RADIUS),
      y: clamp(sighting.y + leadY, PLAYER_RADIUS, match.map.height - PLAYER_RADIUS),
    };
    const distanceToTarget = distance(bot, position);
    const isUrgent = teammates.some((ally) => distance(ally, position) <= TEAMMATE_THREAT_RADIUS);
    const responseRange = isUrgent ? BOT_TEAM_SIGHTING_RESPONSE_RANGE : TEAM_SIGHTING_INVESTIGATION_RANGE;
    if (distanceToTarget > responseRange) continue;

    botResponders.sort((left, right) =>
      distance(left, position) - distance(right, position) || left.id.localeCompare(right.id));
    const botRank = botResponders.findIndex((ally) => ally.id === bot.id);
    if (botRank < 0 || botRank >= 2) continue;
    const score = distanceToTarget + ageMs * 0.06 - (isUrgent ? 500 : 0);
    if (!best || score < best.score) best = { position, urgent: isUrgent, score, ageMs };
  }
  return best;
}

function getEstimatedDamageThreatPosition(origin, bearing, team, teamIntel, map, now) {
  const direction = { x: Math.cos(bearing), y: Math.sin(bearing) };
  let best = null;
  const consider = (candidate, tolerance, uncertainty, ageMs = 0) => {
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
    const dx = candidate.x - origin.x;
    const dy = candidate.y - origin.y;
    const along = dx * direction.x + dy * direction.y;
    const across = Math.abs(dx * direction.y - dy * direction.x);
    if (along < -50 || along > 1_800 || across > tolerance) return;
    const score = across + uncertainty + Math.max(0, ageMs) * 0.04 +
      Math.abs(along - 420) * 0.02;
    if (!best || score < best.score) best = { x: candidate.x, y: candidate.y, score };
  };

  for (const sighting of teamIntel?.sightings ?? []) {
    if (sighting.team !== team || sighting.expiresAt <= now ||
        !Number.isFinite(sighting.x) || !Number.isFinite(sighting.y)) continue;
    const ageMs = Math.max(0, now - (sighting.observedAt ?? now));
    if (ageMs > 6_000) continue;
    const range = distance(origin, sighting);
    consider(sighting, Math.max(100, Math.min(240, range * 0.3)), 0, ageMs);
  }
  for (const cue of teamIntel?.audioCues ?? []) {
    if (cue.team !== team || cue.kind !== 'gunshot' || cue.expiresAt <= now ||
        !Number.isFinite(cue.x) || !Number.isFinite(cue.y)) continue;
    const ageMs = Math.max(0, 2_400 - (cue.expiresAt - now));
    consider(cue, (cue.radius ?? 180) + 100, 120, ageMs);
  }

  const position = best ?? {
    x: origin.x + direction.x * 420,
    y: origin.y + direction.y * 420,
  };
  return {
    x: clamp(position.x, PLAYER_RADIUS, map.width - PLAYER_RADIUS),
    y: clamp(position.y, PLAYER_RADIUS, map.height - PLAYER_RADIUS),
  };
}

function getEnemyPositionHints(bot, match, visibleEnemies, now, context) {
  const hints = visibleEnemies.map((enemy) => ({
    x: enemy.x + (enemy.vx ?? 0) * 0.4,
    y: enemy.y + (enemy.vy ?? 0) * 0.4,
    source: 'visible',
    priority: enemy.id === match.flag?.heldBy ? 10 : 8,
    distance: distance(bot, enemy),
  }));
  const opposingTeam = bot.team === 'red' ? 'blue' : bot.team === 'blue' ? 'red' : null;
  const livingEnemies = opposingTeam
    ? context.worldState?.livingPlayersByTeam?.get(opposingTeam) ??
      match.players.filter((player) => player.team === opposingTeam && player.alive && player.health > 0)
    : match.players.filter((player) => player.team !== bot.team && player.alive && player.health > 0);
  const livingEnemyIds = new Set(livingEnemies.map((player) => player.id));
  for (const sighting of context.teamIntel?.sightings ?? []) {
    if (sighting.team !== bot.team || !livingEnemyIds.has(sighting.enemyId) ||
        sighting.expiresAt <= now || !Number.isFinite(sighting.x) || !Number.isFinite(sighting.y)) continue;
    const ageMs = Math.max(0, now - (sighting.observedAt ?? now));
    hints.push({
      x: sighting.x,
      y: sighting.y,
      source: 'sighting',
      priority: 6 + Math.max(0, 1 - ageMs / 6_000),
      distance: distance(bot, sighting),
      ageMs,
      vx: sighting.vx ?? 0,
      vy: sighting.vy ?? 0,
    });
  }
  const localAudioCues = match.botNoises ?? [];
  const audioCues = context.teamIntel?.audioCues
    ? [...context.teamIntel.audioCues, ...localAudioCues.filter((cue) => cue.audiencePlayerId === bot.id)]
    : localAudioCues;
  for (const cue of audioCues) {
    if (cue.team !== bot.team || (cue.botId && cue.botId !== bot.id) ||
        (cue.audiencePlayerId && cue.audiencePlayerId !== bot.id) || cue.expiresAt <= now ||
        !Number.isFinite(cue.x) || !Number.isFinite(cue.y)) continue;
    const lifetimeMs = cue.kind === 'footstep' ? 650 : 2_400;
    const ageMs = Number.isFinite(cue.observedAt)
      ? Math.max(0, now - cue.observedAt)
      : Math.max(0, lifetimeMs - (cue.expiresAt - now));
    const cueRadius = Number.isFinite(cue.radius) ? Math.max(0, cue.radius) : 180;
    hints.push({
      x: cue.x,
      y: cue.y,
      source: cue.kind === 'footstep' ? 'footstep' : 'audio',
      kind: cue.kind ?? 'gunshot',
      priority: cue.kind === 'footstep' ? 6 : 5,
      distance: distance(bot, cue),
      ageMs,
      uncertainty: cueRadius * (cue.kind === 'footstep' ? 0.5 : 0.75),
    });
  }
  for (const incident of context.teamIntel?.incidents ?? []) {
    if (incident.team !== bot.team || !['damage', 'audio'].includes(incident.kind) ||
        incident.expiresAt <= now || !Number.isFinite(incident.x) || !Number.isFinite(incident.y)) continue;
    hints.push({
      x: incident.x,
      y: incident.y,
      source: 'incident',
      priority: 4,
      distance: distance(bot, incident),
    });
  }
  for (const memory of Object.values(bot.botBrain?.rememberedEnemies ?? {})) {
    if (now - memory.seenAt > SEEN_MEMORY_MS) continue;
    const ageMs = Math.max(0, now - memory.seenAt);
    hints.push({
      x: memory.x,
      y: memory.y,
      source: 'memory',
      priority: 3 + Math.max(0, 1 - (now - memory.seenAt) / SEEN_MEMORY_MS),
      distance: distance(bot, memory),
      ageMs,
    });
  }
  return hints.sort((left, right) =>
    right.priority - left.priority || left.distance - right.distance);
}

function chooseProximityMineTarget(bot, match, visibleEnemies, teammates, now, context) {
  const gadgetId = bot.selectedGadgetId === VINE_TRAP_ID ? VINE_TRAP_ID : PROXIMITY_MINE_ID;
  const gadget = GADGET_DEFINITIONS[gadgetId];
  const map = match.map;
  const mapObjects = map.objects ?? [];
  const visionObjects = context.visionObjects ?? mapObjects;
  const armingSeconds = (gadget.armingDurationMs ?? PROXIMITY_MINE_ARMING_DURATION_MS) / 1000;
  if (context.activeDamageCue || (context.lowHealth && context.retreating) ||
      visibleEnemies.some((enemy) => distance(bot, enemy) <= 190)) return null;

  const denialFactor = getFlagTeamMineDenialFactor(bot, match, now, context.worldState);
  const hasRecentEnemyActivity = visibleEnemies.length > 0 ||
    (context.teamIntel?.sightings ?? []).some((sighting) => sighting.expiresAt > now) ||
    (context.teamIntel?.incidents ?? []).some((incident) => incident.expiresAt > now);
  const rearGuardEligible = context.isCarrier || context.action === 'escort' ||
    (['hold-site', 'defend'].includes(context.action) && hasRecentEnemyActivity);
  const rearPoint = rearGuardEligible ? getBotRearGuardPoint(bot, visibleEnemies, context) : null;
  const enemyRoutes = visibleEnemies.map((enemy) => {
    const speed = Math.hypot(enemy.vx ?? 0, enemy.vy ?? 0);
    if (speed < 20) return null;
    return {
      enemy,
      speed,
      end: {
        x: enemy.x + (enemy.vx / speed) * speed * 8,
        y: enemy.y + (enemy.vy / speed) * speed * 8,
      },
    };
  }).filter(Boolean);
  const candidates = getMinePlacementCandidates(bot, map);
  const ownSpawnZone = map.spawnZones?.[bot.team];
  let best = null;

  for (const candidate of candidates) {
    if (distance(bot, candidate) > gadget.throwRange ||
        circleOverlapsMapObjects(candidate, mapObjects, PROXIMITY_MINE_BODY_RADIUS) ||
        (ownSpawnZone && pointInsideRect(candidate, ownSpawnZone, 20)) ||
        teammates.some((ally) => ally.id !== bot.id && isMineOnTeammateRoute(candidate, ally)) ||
        (match.gadgetEffects ?? []).some((effect) =>
          (effect.type === 'mine' || effect.type === VINE_TRAP_ID) &&
          distance(candidate, effect) <= PROXIMITY_MINE_TRIGGER_RADIUS * 2)) continue;

    const origin = getGadgetThrowOrigin(bot, candidate, mapObjects);
    const trajectory = calculateGadgetTrajectory(origin, candidate, mapObjects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: 0,
    });
    if (!trajectory || trajectory.distance > gadget.throwRange ||
        isTrajectoryCoveredByTrophy(
          trajectory, context.knownEnemyTrophies ?? [], visionObjects,
        )) continue;
    const endpoint = trajectory.endpoint;
    if (distance(endpoint, candidate) > 38 ||
        circleOverlapsMapObjects(endpoint, mapObjects, PROXIMITY_MINE_BODY_RADIUS) ||
        teammates.some((ally) => ally.id !== bot.id &&
          distance(ally, endpoint) < PROXIMITY_MINE_TRIGGER_RADIUS + PLAYER_RADIUS) ||
        visibleEnemies.some((enemy) => enemyCanReachMineBeforeArming(enemy, endpoint, armingSeconds))) continue;

    const hiddenFromEnemies = visibleEnemies.every((enemy) =>
      !isPointVisible(endpoint, {
        origin: getPlayerVisionOrigin(enemy, mapObjects),
        angle: enemy.visionAngle ?? enemy.weaponStats?.[enemy.selectedWeaponId]?.aimAngle ?? 0,
        halfAngle: VISION_HALF_ANGLE,
      }, visionObjects));
    const strikeProgress = bot.team === 'red' ? getStrikeMineProgress(endpoint, map) : null;
    const onFlagHalf = strikeProgress !== null && strikeProgress >= 0.5;
    let score = 0;

    if (hiddenFromEnemies) {
      score = Math.max(score, scoreMineAmbush(endpoint, candidate, enemyRoutes, armingSeconds));
      if (!candidate.isFlagIngress && (candidate.isCorner || candidate.corridorWidth <= 90) &&
          (bot.team !== 'red' || onFlagHalf)) {
        const routeTrapScore = 2 + Number(candidate.isCorner) * 0.6 +
          clamp((100 - candidate.corridorWidth) / 50, 0, 0.8);
        score = Math.max(score, routeTrapScore);
      }
      if (rearPoint) {
        const rearDistance = distance(endpoint, rearPoint);
        if (rearDistance <= 110) {
          const rearScore = 2.1 + (candidate.isCorner ? 0.65 : 0) +
            (context.isCarrier ? 1.1 : 0) + (1 - rearDistance / 110);
          score = Math.max(score, rearScore);
        }
      }
    }

    if (candidate.isFlagIngress && denialFactor >= 0.2) {
      const widthBonus = clamp((90 - candidate.corridorWidth) / 30, 0, 1);
      score = Math.max(score, 2.4 + denialFactor * 3.5 + widthBonus);
    }
    if (score <= 0) continue;

    score += (hashString(`${match.gameplayStartsAt}:${bot.id}:${candidate.corridorId}:${Math.round(endpoint.x)}:${Math.round(endpoint.y)}`) % 100) / 1_000;
    const targetDistance = distance(bot, endpoint);
    if (!best || score > best.score || (score === best.score && targetDistance < best.distance)) {
      best = { target: candidate, score, distance: targetDistance };
    }
  }
  return best?.target ?? null;
}

function getStrikeMineProgress(point, map) {
  const strikeSpawn = map.spawnZones?.red;
  const flagSite = map.spawnZones?.blue;
  if (!strikeSpawn || !flagSite) return null;
  const start = center(strikeSpawn);
  const target = center(flagSite);
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return null;
  return clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
}

function getMinePlacementCandidates(bot, map) {
  const candidates = new Map();
  const addCandidate = (point, corridor, options = {}) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        distance(bot, point) > PROXIMITY_MINE_THROW_RANGE) return;
    const key = `${Math.round(point.x / 12)}:${Math.round(point.y / 12)}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.isCorner ||= Boolean(options.isCorner);
      existing.isFlagIngress ||= Boolean(options.isFlagIngress);
      return;
    }
    candidates.set(key, {
      ...point,
      corridorId: corridor.id,
      corridorWidth: corridor.width ?? 70,
      isCorner: Boolean(options.isCorner),
      isFlagIngress: Boolean(options.isFlagIngress),
    });
  };

  for (const corridor of map.corridors ?? []) {
    const points = corridor.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    const width = corridor.width ?? 70;
    const isFlagIngressCorridor = bot.team === 'blue' &&
      (corridor.a === 'blue-spawn' || corridor.b === 'blue-spawn');
    const projection = projectOntoPolyline(bot, points);
    if (!projection || projection.distance > PROXIMITY_MINE_THROW_RANGE + width / 2) continue;

    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const segmentLength = distance(start, end);
      if (segmentLength < 28) continue;
      addCandidate({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      }, corridor, { isFlagIngress: isFlagIngressCorridor });

      if (index > 0 && index < points.length - 1) {
        const previous = points[index - 1];
        const next = points[index + 1];
        const incoming = unitVector(previous, start);
        const outgoing = unitVector(start, next);
        if (incoming.x * outgoing.x + incoming.y * outgoing.y < 0.9) {
          const cornerOffset = Math.min(30, segmentLength * 0.3);
          addCandidate({
            x: start.x + outgoing.x * cornerOffset,
            y: start.y + outgoing.y * cornerOffset,
          }, corridor, { isCorner: true, isFlagIngress: isFlagIngressCorridor });
          const priorLength = distance(previous, start);
          const priorOffset = Math.min(30, priorLength * 0.3);
          addCandidate({
            x: start.x - incoming.x * priorOffset,
            y: start.y - incoming.y * priorOffset,
          }, corridor, { isCorner: true, isFlagIngress: isFlagIngressCorridor });

          const wallOffset = Math.max(0, Math.min(width / 2 - PROXIMITY_MINE_BODY_RADIUS - 5, 18));
          for (const offset of [-wallOffset, wallOffset]) {
            addCandidate({
              x: start.x + outgoing.x * cornerOffset - outgoing.y * offset,
              y: start.y + outgoing.y * cornerOffset + outgoing.x * offset,
            }, corridor, { isCorner: true, isFlagIngress: isFlagIngressCorridor });
          }
        }
      }
    }

    if (isFlagIngressCorridor) {
      const doorway = corridor.a === 'blue-spawn' ? points[0] : points.at(-1);
      const inside = corridor.a === 'blue-spawn' ? points[1] : points.at(-2);
      const direction = unitVector(doorway, inside);
      const offset = Math.min(45, Math.max(24, width * 0.55));
      addCandidate({
        x: doorway.x + direction.x * offset,
        y: doorway.y + direction.y * offset,
      }, corridor, { isFlagIngress: true });
    }
  }
  return [...candidates.values()];
}

function getFlagTeamMineDenialFactor(bot, match, now, worldState = null) {
  if (bot.team !== 'blue' || !Number.isFinite(match.gameplayStartsAt) ||
      !Number.isFinite(match.endsAt) || match.endsAt <= match.gameplayStartsAt) return 0;
  const progress = clamp((now - match.gameplayStartsAt) / (match.endsAt - match.gameplayStartsAt), 0, 1);
  const lateFactor = clamp((progress - 0.45) / 0.4, 0, 1);
  const aliveOnTeam = (team) => worldState?.livingPlayersByTeam?.get(team)?.length ??
    (match.players ?? []).filter((player) =>
      player.team === team && player.alive && player.health > 0).length;
  const lowNumbersFactor = clamp((4 - Math.min(aliveOnTeam('blue'), aliveOnTeam('red'))) / 3, 0, 1);
  return lateFactor * lowNumbersFactor;
}

function getBotRearGuardPoint(bot, visibleEnemies, context) {
  const forwardTarget = context.waypoint;
  let forward = forwardTarget && distance(bot, forwardTarget) > 25
    ? unitVector(bot, forwardTarget)
    : null;
  if (!forward && Math.hypot(bot.vx ?? 0, bot.vy ?? 0) > 20) {
    forward = unitVector({ x: 0, y: 0 }, { x: bot.vx, y: bot.vy });
  }
  if (!forward && visibleEnemies.length) forward = unitVector(bot, visibleEnemies[0]);
  if (!forward) forward = { x: Math.cos(bot.visionAngle ?? 0), y: Math.sin(bot.visionAngle ?? 0) };
  return { x: bot.x - forward.x * 100, y: bot.y - forward.y * 100 };
}

function isMineOnTeammateRoute(point, teammate) {
  if (distance(point, teammate) < PROXIMITY_MINE_TRIGGER_RADIUS + PLAYER_RADIUS + 18) return true;
  const speed = Math.hypot(teammate.vx ?? 0, teammate.vy ?? 0);
  if (speed < 30) return false;
  const end = {
    x: teammate.x + (teammate.vx / speed) * 140,
    y: teammate.y + (teammate.vy / speed) * 140,
  };
  return distanceToSegment(point, teammate, end) < PROXIMITY_MINE_TRIGGER_RADIUS;
}

function enemyCanReachMineBeforeArming(enemy, mine, armingSeconds) {
  const dx = mine.x - enemy.x;
  const dy = mine.y - enemy.y;
  const distanceToMine = Math.hypot(dx, dy);
  const triggerDistance = PROXIMITY_MINE_TRIGGER_RADIUS + PLAYER_RADIUS;
  if (distanceToMine <= triggerDistance) return true;
  const speedTowardMine = ((enemy.vx ?? 0) * dx + (enemy.vy ?? 0) * dy) / distanceToMine;
  return speedTowardMine > 0 && (distanceToMine - triggerDistance) / speedTowardMine < armingSeconds + 0.25;
}

function scoreMineAmbush(mine, candidate, enemyRoutes, armingSeconds) {
  let bestScore = 0;
  for (const route of enemyRoutes) {
    const projection = projectPointOntoSegment(mine, route.enemy, route.end);
    const triggerDistance = PROXIMITY_MINE_TRIGGER_RADIUS + PLAYER_RADIUS;
    if (projection.distance > triggerDistance) continue;
    const secondsToReach = (projection.alongDistance - triggerDistance) / route.speed;
    if (secondsToReach < armingSeconds + 0.25 || secondsToReach > 8) continue;
    const proximity = 1 - projection.distance / triggerDistance;
    bestScore = Math.max(bestScore, 3.2 + Number(candidate.isCorner) * 0.7 + proximity * 0.45);
  }
  return bestScore;
}

function projectPointOntoSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return { distance: distance(point, start), fraction: 0, alongDistance: 0 };
  const fraction = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const projection = { x: start.x + dx * fraction, y: start.y + dy * fraction };
  return { distance: distance(point, projection), fraction, alongDistance: Math.sqrt(lengthSquared) * fraction };
}

function chooseSmokeTarget(bot, match, visibleEnemies, teammates, now, context) {
  const gadget = GADGET_DEFINITIONS[SMOKE_GRENADE_ID];
  const radius = gadget.effectRadius ?? 60;
  const mapObjects = match.map.objects;
  const visionObjects = context.visionObjects ?? mapObjects;
  let best = null;

  for (const enemy of visibleEnemies) {
    const distanceToEnemy = distance(bot, enemy);
    if (distanceToEnemy > gadget.throwRange || distanceToEnemy <= radius + PLAYER_RADIUS + 12) continue;

    const enemyVision = {
      origin: getPlayerVisionOrigin(enemy, mapObjects),
      angle: enemy.visionAngle ?? enemy.weaponStats?.[enemy.selectedWeaponId]?.aimAngle ?? 0,
      halfAngle: VISION_HALF_ANGLE,
    };
    if (!isPointVisible(bot, enemyVision, visionObjects)) continue;

    const approaching = isApproachingThreat(enemy, bot, match);
    const closeApproachingThreat = distanceToEnemy <= BOT_GADGET_CLOSE_THREAT_RANGE && approaching;
    const lowHealthRetreat = context.lowHealth && context.retreating;
    const pressuredCarrier = context.isCarrier &&
      (distanceToEnemy <= BOT_GADGET_CLOSE_THREAT_RANGE || approaching);
    const exposedRoute = context.moving && context.waypoint &&
      distance(bot, context.waypoint) > 40 && isPointVisible(context.waypoint, enemyVision, visionObjects);
    if (!closeApproachingThreat && !lowHealthRetreat && !pressuredCarrier && !exposedRoute) continue;

    const fraction = Math.min(0.9, Math.max(0.65,
      (radius + PLAYER_RADIUS + 12) / distanceToEnemy));
    const target = {
      x: bot.x + (enemy.x - bot.x) * fraction,
      y: bot.y + (enemy.y - bot.y) * fraction,
    };
    const origin = getGadgetThrowOrigin(bot, target, mapObjects);
    const trajectory = calculateGadgetTrajectory(origin, target, mapObjects, {
      maximumRange: gadget.throwRange,
      collisionRadius: gadget.throwCollisionRadius,
      maximumBounces: gadget.maxBounces,
    });
    if (!trajectory || isTrajectoryCoveredByTrophy(
      trajectory, context.knownEnemyTrophies ?? [], visionObjects,
    )) continue;

    const endpoint = trajectory.endpoint;
    if (distance(endpoint, bot) <= radius + PLAYER_RADIUS ||
        distanceToSegment(endpoint, bot, enemy) > radius * 0.75 ||
        teammates.some((ally) => ally.id !== bot.id &&
          distance(ally, endpoint) < radius + PLAYER_RADIUS) ||
        smokeBlocksTeammateShot(endpoint, radius, bot, teammates, visibleEnemies, mapObjects, visionObjects)) {
      continue;
    }

    const urgency = Number(lowHealthRetreat) * 3 + Number(pressuredCarrier) * 2.5 +
      Number(closeApproachingThreat) * 2 + Number(exposedRoute) +
      (1 - distanceToEnemy / gadget.throwRange) * 0.25;
    if (!best || urgency > best.urgency ||
        (urgency === best.urgency && distanceToEnemy < best.distance)) {
      best = { target, urgency, distance: distanceToEnemy };
    }
  }
  return best?.target ?? null;
}

function smokeBlocksTeammateShot(smoke, radius, bot, teammates, enemies, mapObjects, visionObjects) {
  return teammates.some((ally) => {
    if (ally.id === bot.id) return false;
    const vision = {
      origin: getPlayerVisionOrigin(ally, mapObjects),
      angle: ally.visionAngle ?? ally.weaponStats?.[ally.selectedWeaponId]?.aimAngle ?? 0,
      halfAngle: VISION_HALF_ANGLE,
    };
    return enemies.some((enemy) =>
      isPointVisible(enemy, vision, visionObjects) &&
      distanceToSegment(smoke, vision.origin, enemy) <= radius);
  });
}

function isApproachingThreat(enemy, bot, match) {
  const distanceToBot = distance(enemy, bot);
  if (enemy.id === match.flag?.heldBy) return true;
  if (distanceToBot <= 1e-6) return true;
  const speedTowardBot = ((bot.x - enemy.x) * (enemy.vx ?? 0) +
    (bot.y - enemy.y) * (enemy.vy ?? 0)) / distanceToBot;
  return speedTowardBot >= 25;
}

function center(rect) { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distance(point, start);
  const fraction = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (start.x + dx * fraction), point.y - (start.y + dy * fraction));
}
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function normalizeAngle(angle) {
  return ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
