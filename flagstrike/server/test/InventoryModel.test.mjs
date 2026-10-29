import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyInventoryWeaponEffects,
  createEmptyItemInventory,
  getInventoryEffects,
  getNextItemShopOffers,
  normalizeItemInventory,
  regeneratePlayerArmor,
} from '../../shared/InventoryModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../shared/ProjectileModel.js';

describe('InventoryModel', () => {
  it('creates empty armor and perk slots', () => {
    assert.deepEqual(createEmptyItemInventory(), { armor: null, perks: [] });
  });

  it('normalizes armor and leveled perks while excluding invalid or duplicate items', () => {
    const input = {
      armor: { id: 'armor', name: 'Armor', level: 3 },
      perks: [
        { id: 'foregrip', name: 'Foregrip', level: 1 },
        { id: 'foregrip', name: 'Duplicate', level: 2 },
        { id: 'extended-mag', level: 3 },
        { id: 'missing-level' },
      ],
    };

    const normalized = normalizeItemInventory(input);

    assert.deepEqual(normalized, {
      armor: input.armor,
      perks: [input.perks[1]],
    });
    assert.notEqual(normalized.armor, input.armor, 'inventory items are cloned before publication');
    assert.deepEqual(normalizeItemInventory({ armor: { id: 'armor', level: 4 } }).armor, null);
  });

  it('derives level-specific armor and perk effects', () => {
    assert.deepEqual(getInventoryEffects({ armor: { id: 'armor', level: 1 } }), {
      armor: 25,
      armorRegeneration: 10,
      regenerationDelayMs: 5_000,
      magazineBonus: 0,
      reloadSpeedBonus: 0,
      movementBonus: 0,
      recoilReduction: 0,
      movingAccuracyBonus: 0,
    });
    const effects = getInventoryEffects({
      armor: { id: 'armor', level: 3 },
      perks: [
        { id: 'extended-mag', level: 2 },
        { id: 'reload-training', level: 1 },
        { id: 'lightweight-frame', level: 2 },
        { id: 'recoil-training', level: 1 },
        { id: 'foregrip', level: 2 },
      ],
    });
    assert.equal(effects.armor, 50);
    assert.equal(effects.armorRegeneration, 10);
    assert.equal(effects.regenerationDelayMs, 5_000);
    assert.equal(effects.magazineBonus, 0.3);
    assert.equal(effects.reloadSpeedBonus, 0.15);
    assert.equal(effects.movementBonus, 0.1);
    assert.equal(effects.recoilReduction, 0.15);
    assert.equal(effects.movingAccuracyBonus, 0.3);
  });

  it('regenerates every armor level after its damage-free delay and caps at maximum armor', () => {
    for (const [level, maximumArmor] of [[1, 25], [2, 40], [3, 50]]) {
      const player = {
        inventory: { armor: { id: 'armor', level }, perks: [] },
        armor: 0,
        maxArmor: maximumArmor,
        lastDamagedAt: 1_000,
      };

      assert.equal(regeneratePlayerArmor(player, 0.05, 5_999), false);
      assert.equal(player.armor, 0);
      assert.equal(regeneratePlayerArmor(player, 0.05, 6_000), true);
      assert.equal(player.armor, 0.5);

      player.armor = maximumArmor - 0.1;
      assert.equal(regeneratePlayerArmor(player, 0.05, 6_050), true);
      assert.equal(player.armor, maximumArmor);
      assert.equal(regeneratePlayerArmor(player, 0.05, 6_100), false);
    }
  });

  it('applies magazine, reload, recoil, moving accuracy, and movement perks', () => {
    const inventory = { perks: [
      { id: 'extended-mag', level: 1 },
      { id: 'reload-training', level: 2 },
      { id: 'lightweight-frame', level: 1 },
      { id: 'recoil-training', level: 2 },
      { id: 'foregrip', level: 1 },
    ] };
    const effective = applyInventoryWeaponEffects(DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle, inventory);
    assert.equal(effective.magazineSize, 35);
    assert.equal(effective.reloadDurationMs, 2400);
    assert.equal(effective.accuracy.recoilPerShot,
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.accuracy.recoilPerShot * 0.7);
    assert.equal(effective.accuracy.movementPenaltyAtMaxSpeed,
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.accuracy.movementPenaltyAtMaxSpeed * 0.85);
    assert.equal(effective.movementScale, DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale);
  });

  it('offers only the next valid level for armor and each owned perk', () => {
    const offers = getNextItemShopOffers({
      armor: { id: 'armor', level: 2 },
      perks: [{ id: 'foregrip', level: 1 }, { id: 'extended-mag', level: 2 }],
    });
    assert.ok(offers.some((offer) => offer.id === 'armor' && offer.level === 3));
    assert.ok(offers.some((offer) => offer.id === 'foregrip' && offer.level === 2));
    assert.ok(!offers.some((offer) => offer.id === 'extended-mag'));
    assert.equal(getNextItemShopOffers({ armor: { id: 'armor', level: 3 } })
      .some((offer) => offer.id === 'armor'), false);
  });
});