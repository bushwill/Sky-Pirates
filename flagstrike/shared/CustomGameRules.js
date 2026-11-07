import { COMPETITIVE_MAP_RULES, MAX_ROOMS, MIN_ROOMS } from './MapGenerator.js';

export const DEFAULT_CUSTOM_GAME_RULES = Object.freeze({
  buyPhase: 'loadout',
  prePhaseSeconds: 15,
  gamePhaseSeconds: 180,
  postPhaseSeconds: 15,
  winsToWin: 1,
  roleSwapEveryMatches: 2,
  teamShuffleEveryMatches: 0,
  teamShuffleMode: 'random',
  autoFillBots: false,
  infiniteGadgetUse: false,
  mapMode: 'competitive',
  mapCriteria: Object.freeze({
    minRooms: COMPETITIVE_MAP_RULES.minRooms,
    maxRooms: COMPETITIVE_MAP_RULES.maxRooms,
    minDoorwaysPerSite: COMPETITIVE_MAP_RULES.minDoorwaysPerSite,
    minSymmetryPercent: COMPETITIVE_MAP_RULES.minSymmetryPercent,
    minRoomUtilizationPercent: Math.round(COMPETITIVE_MAP_RULES.minRoomUtilization * 100),
    maxSiteApproachSightline: COMPETITIVE_MAP_RULES.maxSiteApproachSightline,
  }),
  shopProgression: 'escalating',
  firstShopOffers: 6,
  firstShopPicks: 2,
  laterShopOffers: 5,
  laterShopPicks: 1,
  carryOverShopPicks: true,
  uniqueGadgetInitialChancePercent: 1,
  uniqueGadgetChanceIncrementPercent: 2,
  uniqueGadgetMaxChancePercent: 100,
});

const CUSTOM_GAME_RULE_KEYS = new Set(Object.keys(DEFAULT_CUSTOM_GAME_RULES));
const MAP_CRITERIA_KEYS = new Set(Object.keys(DEFAULT_CUSTOM_GAME_RULES.mapCriteria));

function assertInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a whole number from ${minimum} to ${maximum}.`);
  }
}

function assertChoice(value, name, choices) {
  if (!choices.includes(value)) {
    throw new TypeError(`${name} must be one of: ${choices.join(', ')}.`);
  }
}

export function normalizeCustomGameRules(input, base = DEFAULT_CUSTOM_GAME_RULES) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Custom game rules must be an object.');
  }
  for (const key of Object.keys(input)) {
    if (!CUSTOM_GAME_RULE_KEYS.has(key)) throw new TypeError(`Unknown custom game rule: ${key}.`);
  }
  const mapCriteriaInput = input.mapCriteria ?? {};
  if (!mapCriteriaInput || typeof mapCriteriaInput !== 'object' || Array.isArray(mapCriteriaInput)) {
    throw new TypeError('Map criteria must be an object.');
  }
  for (const key of Object.keys(mapCriteriaInput)) {
    if (!MAP_CRITERIA_KEYS.has(key)) throw new TypeError(`Unknown map criterion: ${key}.`);
  }

  const rules = {
    ...DEFAULT_CUSTOM_GAME_RULES,
    ...base,
    ...input,
    mapCriteria: {
      ...DEFAULT_CUSTOM_GAME_RULES.mapCriteria,
      ...base.mapCriteria,
      ...mapCriteriaInput,
    },
  };
  assertChoice(rules.buyPhase, 'Buy phase', ['none', 'loadout', 'progression']);
  assertInteger(rules.prePhaseSeconds, 'Pre-phase duration', 0, 120);
  assertInteger(rules.gamePhaseSeconds, 'Game-phase duration', 15, 900);
  assertInteger(rules.postPhaseSeconds, 'Post-phase duration', 0, 120);
  if (rules.winsToWin !== null) assertInteger(rules.winsToWin, 'Wins to win', 1, 100);
  assertInteger(rules.roleSwapEveryMatches, 'Role-swap interval', 0, 100);
  assertInteger(rules.teamShuffleEveryMatches, 'Team-shuffle interval', 0, 100);
  assertChoice(rules.teamShuffleMode, 'Team-shuffle mode', ['random', 'faro', 'host']);
  if (typeof rules.autoFillBots !== 'boolean') {
    throw new TypeError('Automatic bot filling must be enabled or disabled.');
  }
  if (typeof rules.infiniteGadgetUse !== 'boolean') {
    throw new TypeError('Infinite gadget use must be enabled or disabled.');
  }
  assertChoice(rules.mapMode, 'Map mode', ['competitive', 'same', 'varied', 'host']);
  assertChoice(rules.shopProgression, 'Shop progression', ['escalating', 'fixed']);
  if (typeof rules.carryOverShopPicks !== 'boolean') {
    throw new TypeError('Shop pick carryover must be enabled or disabled.');
  }
  assertInteger(rules.firstShopOffers, 'First-match offer count', 1, 16);
  assertInteger(rules.firstShopPicks, 'First-match pick count', 0, 16);
  assertInteger(rules.laterShopOffers, 'Later-match offer count', 1, 16);
  assertInteger(rules.laterShopPicks, 'Later-match pick count', 0, 16);
  if (rules.firstShopPicks > rules.firstShopOffers || rules.laterShopPicks > rules.laterShopOffers) {
    throw new TypeError('Shop picks cannot exceed the number of offers.');
  }
  assertInteger(rules.uniqueGadgetInitialChancePercent, 'Initial unique-gadget chance', 0, 100);
  assertInteger(rules.uniqueGadgetChanceIncrementPercent, 'Unique-gadget chance increase', 0, 100);
  assertInteger(rules.uniqueGadgetMaxChancePercent, 'Maximum unique-gadget chance', 0, 100);
  if (rules.uniqueGadgetInitialChancePercent > rules.uniqueGadgetMaxChancePercent) {
    throw new TypeError('Initial unique-gadget chance cannot exceed its maximum.');
  }

  const criteria = rules.mapCriteria;
  assertInteger(criteria.minRooms, 'Minimum map rooms', MIN_ROOMS, MAX_ROOMS);
  assertInteger(criteria.maxRooms, 'Maximum map rooms', MIN_ROOMS, MAX_ROOMS);
  if (criteria.minRooms > criteria.maxRooms) {
    throw new TypeError('Minimum map rooms cannot exceed maximum map rooms.');
  }
  assertInteger(criteria.minDoorwaysPerSite, 'Minimum site doorways', 1, 8);
  assertInteger(criteria.minSymmetryPercent, 'Minimum map symmetry', 0, 100);
  assertInteger(criteria.minRoomUtilizationPercent, 'Minimum room utilization', 0, 100);
  assertInteger(criteria.maxSiteApproachSightline, 'Maximum site sightline', 200, 1_500);

  return {
    ...rules,
    mapCriteria: { ...criteria },
  };
}

export function getCustomMapCriteria(rules = DEFAULT_CUSTOM_GAME_RULES) {
  const { mapCriteria } = normalizeCustomGameRules({}, rules);
  return {
    minRooms: mapCriteria.minRooms,
    maxRooms: mapCriteria.maxRooms,
    minDoorwaysPerSite: mapCriteria.minDoorwaysPerSite,
    minSymmetryPercent: mapCriteria.minSymmetryPercent,
    minRoomUtilization: mapCriteria.minRoomUtilizationPercent / 100,
    maxSiteApproachSightline: mapCriteria.maxSiteApproachSightline,
  };
}
