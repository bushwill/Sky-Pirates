export function getWeaponShopOfferWeight(shopValue, matchNumber) {
  const value = Math.max(1, Number.isFinite(shopValue) ? shopValue : 3);
  const matchProgression = Math.max(0, (Number.isFinite(matchNumber) ? matchNumber : 1) - 1);
  const rarityScale = Math.max(0.2, 0.75 - matchProgression * 0.09);
  return Math.exp(-value * rarityScale);
}

export function getMinimumWeaponShopMatch(shopValue) {
  const value = Number.isFinite(shopValue) ? shopValue : 3;
  return Math.max(1, Math.ceil(value));
}

export const UNIQUE_GADGET_INITIAL_CHANCE = 0.01;
export const UNIQUE_GADGET_CHANCE_INCREMENT = 0.02;
export const UNIQUE_GADGET_MAX_CHANCE = 0.1;

export function getUniqueGadgetOfferChance(shopCount) {
  const count = Math.max(1, Number.isFinite(shopCount) ? Math.floor(shopCount) : 1);
  return Math.min(UNIQUE_GADGET_MAX_CHANCE,
    UNIQUE_GADGET_INITIAL_CHANCE + (count - 1) * UNIQUE_GADGET_CHANCE_INCREMENT);
}

export function chooseUniqueGadgetOffer(gadgetDefinitions, shopCount, random = Math.random, excludedIds = []) {
  const available = Object.values(gadgetDefinitions ?? {})
    .filter((definition) => definition?.rarity === 'unique' && typeof definition.id === 'string' &&
      !excludedIds.includes(definition.id));
  if (!available.length || random() >= getUniqueGadgetOfferChance(shopCount)) return null;
  const index = Math.min(available.length - 1, Math.floor(random() * available.length));
  return available[index].id;
}

export function isUniqueGadgetDefinition(definition) {
  return definition?.rarity === 'unique';
}