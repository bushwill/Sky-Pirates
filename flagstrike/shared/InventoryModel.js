export const MAX_ARMOR_LEVEL = 3;
export const MAX_PERK_LEVEL = 2;

export const LONG_PLAY_ITEM_CATALOG = Object.freeze({
  armor: Object.freeze({
    kind: 'armor',
    name: 'Armor',
    levels: Object.freeze([
      Object.freeze({ armor: 25, armorRegeneration: 5, regenerationDelayMs: 5_000,
        description: 'Adds 25 armor.' }),
      Object.freeze({ armor: 40, armorRegeneration: 8, regenerationDelayMs: 5_000,
        description: 'Adds 40 armor.' }),
      Object.freeze({ armor: 50, armorRegeneration: 10, regenerationDelayMs: 5_000,
        description: 'Adds 50 armor.' }),
    ]),
  }),
  'extended-mag': Object.freeze({
    kind: 'perk',
    name: 'Extended Mag',
    levels: Object.freeze([
      Object.freeze({ magazineBonus: 0.15, description: 'Increases magazine size by 15%.' }),
      Object.freeze({ magazineBonus: 0.30, description: 'Increases magazine size by 30%.' }),
    ]),
  }),
  'reload-training': Object.freeze({
    kind: 'perk',
    name: 'Reload Training',
    levels: Object.freeze([
      Object.freeze({ reloadSpeedBonus: 0.15, description: 'Reloads 15% faster, including round reloads.' }),
      Object.freeze({ reloadSpeedBonus: 0.25, description: 'Reloads 25% faster, including round reloads.' }),
    ]),
  }),
  'lightweight-frame': Object.freeze({
    kind: 'perk',
    name: 'Lightweight Frame',
    levels: Object.freeze([
      Object.freeze({ movementBonus: 0.05,
        description: 'Adds +0.05 to weapon movement scale (e.g. AR 0.90→0.95; pistol 1.00→1.05). No effect while carrying the flag.' }),
      Object.freeze({ movementBonus: 0.10,
        description: 'Adds +0.10 to weapon movement scale (e.g. AR 0.90→1.00; pistol 1.00→1.10). No effect while carrying the flag.' }),
    ]),
  }),
  'recoil-training': Object.freeze({
    kind: 'perk',
    name: 'Recoil Training',
    levels: Object.freeze([
      Object.freeze({ recoilReduction: 0.15, description: 'Reduces recoil by 15%.' }),
      Object.freeze({ recoilReduction: 0.30, description: 'Reduces recoil by 30%.' }),
    ]),
  }),
  foregrip: Object.freeze({
    kind: 'perk',
    name: 'Foregrip',
    levels: Object.freeze([
      Object.freeze({ movingAccuracyBonus: 0.15, description: 'Reduces the movement accuracy penalty by 15%.' }),
      Object.freeze({ movingAccuracyBonus: 0.30, description: 'Reduces the movement accuracy penalty by 30%.' }),
    ]),
  }),
});

export function createEmptyItemInventory() {
  return { armor: null, perks: [] };
}

export function createDefaultMatchItemInventory() {
  return { armor: { id: 'armor', name: 'Armor', level: 1 }, perks: [] };
}

export function getItemLevelDefinition(id, level) {
  const item = LONG_PLAY_ITEM_CATALOG[id];
  if (!item || !Number.isInteger(level) || level < 1 || level > item.levels.length) return null;
  return { id, level, name: item.name, ...item.levels[level - 1] };
}

export function getNextItemShopOffers(inventory) {
  const normalized = normalizeItemInventory(inventory);
  const offers = [];
  const nextArmorLevel = (normalized.armor?.level ?? 0) + 1;
  if (nextArmorLevel <= MAX_ARMOR_LEVEL) offers.push({ kind: 'armor', ...getItemLevelDefinition('armor', nextArmorLevel) });
  for (const id of Object.keys(LONG_PLAY_ITEM_CATALOG).filter((itemId) => itemId !== 'armor')) {
    const current = normalized.perks.find((perk) => perk.id === id);
    const nextLevel = (current?.level ?? 0) + 1;
    if (nextLevel <= MAX_PERK_LEVEL) {
      offers.push({ kind: 'perk', ...getItemLevelDefinition(id, nextLevel) });
    }
  }
  return offers;
}

export function getInventoryEffects(inventory) {
  const normalized = normalizeItemInventory(inventory);
  const armorDefinition = normalized.armor
    ? getItemLevelDefinition('armor', normalized.armor.level) : null;
  const perks = normalized.perks.map((item) => getItemLevelDefinition(item.id, item.level)).filter(Boolean);
  return {
    armor: armorDefinition?.armor ?? 0,
    armorRegeneration: armorDefinition?.armorRegeneration ?? 0,
    regenerationDelayMs: armorDefinition?.regenerationDelayMs ?? Infinity,
    magazineBonus: Math.max(0, ...perks.map((item) => item.magazineBonus ?? 0)),
    reloadSpeedBonus: Math.max(0, ...perks.map((item) => item.reloadSpeedBonus ?? 0)),
    movementBonus: Math.max(0, ...perks.map((item) => item.movementBonus ?? 0)),
    recoilReduction: Math.max(0, ...perks.map((item) => item.recoilReduction ?? 0)),
    movingAccuracyBonus: Math.max(0, ...perks.map((item) => item.movingAccuracyBonus ?? 0)),
  };
}

export function regeneratePlayerArmor(player, deltaSeconds, now) {
  if (!player || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || !Number.isFinite(now)) return false;
  const effects = getInventoryEffects(player.inventory);
  if (effects.armorRegeneration <= 0 ||
      now - (player.lastDamagedAt ?? now) < effects.regenerationDelayMs) return false;
  const maxArmor = player.maxArmor ?? effects.armor;
  const currentArmor = player.armor ?? 0;
  const regeneratedArmor = Math.min(maxArmor, currentArmor + effects.armorRegeneration * deltaSeconds);
  if (regeneratedArmor <= currentArmor) return false;
  player.armor = regeneratedArmor;
  return true;
}

export function getEffectiveMagazineSize(baseMagazineSize, inventory) {
  if (!baseMagazineSize) return baseMagazineSize;
  return Math.ceil(baseMagazineSize * (1 + getInventoryEffects(inventory).magazineBonus));
}

export function getEffectiveReloadDuration(baseDurationMs, inventory) {
  if (!baseDurationMs) return baseDurationMs;
  return Math.ceil(baseDurationMs / (1 + getInventoryEffects(inventory).reloadSpeedBonus));
}

export function getEffectiveAccuracySettings(accuracy, inventory) {
  const effects = getInventoryEffects(inventory);
  return {
    ...accuracy,
    recoilPerShot: accuracy.recoilPerShot * (1 - effects.recoilReduction),
    movementPenaltyAtMaxSpeed: accuracy.movementPenaltyAtMaxSpeed * (1 - effects.movingAccuracyBonus),
  };
}

export function applyInventoryWeaponEffects(definition, inventory) {
  return {
    ...definition,
    magazineSize: getEffectiveMagazineSize(definition.magazineSize, inventory),
    reloadDurationMs: getEffectiveReloadDuration(definition.reloadDurationMs, inventory),
    ...(definition.reloadPerRound ? {
      reloadIntervalMs: definition.reloadIntervalMs.map((interval) => getEffectiveReloadDuration(interval, inventory)),
    } : {}),
    accuracy: getEffectiveAccuracySettings(definition.accuracy, inventory),
  };
}

function normalizeItem(item, maximumLevel) {
  if (!item || typeof item !== 'object' || Array.isArray(item) ||
      typeof item.id !== 'string' || !item.id.trim() ||
      !Number.isInteger(item.level) || item.level < 1 || item.level > maximumLevel) return null;
  return structuredClone(item);
}

export function normalizeItemInventory(inventory) {
  const source = inventory && typeof inventory === 'object' && !Array.isArray(inventory) ? inventory : {};
  const armorCandidate = normalizeItem(source.armor, MAX_ARMOR_LEVEL);
  const armor = armorCandidate && armorCandidate.id === 'armor' ? armorCandidate : null;
  const perksById = new Map();
  for (const candidate of Array.isArray(source.perks) ? source.perks : []) {
    const perk = normalizeItem(candidate, MAX_PERK_LEVEL);
    if (!perk || LONG_PLAY_ITEM_CATALOG[perk.id]?.kind !== 'perk') continue;
    if (perk.level > (perksById.get(perk.id)?.level ?? 0)) {
      perksById.set(perk.id, perk);
    }
  }
  return { armor, perks: [...perksById.values()] };
}