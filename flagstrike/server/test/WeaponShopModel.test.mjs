import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../shared/ProjectileModel.js';
import {
  chooseUniqueGadgetOffer,
  getMinimumWeaponShopMatch,
  getUniqueGadgetOfferChance,
  getWeaponShopOfferWeight,
  isUniqueGadgetDefinition,
} from '../../shared/WeaponShopModel.js';

describe('WeaponShopModel', () => {
  it('uses each configured shop value to progress offer odds over match number', () => {
    const weapons = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
    for (const weapon of weapons) {
      const earlyWeight = getWeaponShopOfferWeight(weapon.shopValue, 2);
      const lateWeight = getWeaponShopOfferWeight(weapon.shopValue, 6);

      assert.ok(Number.isFinite(earlyWeight) && earlyWeight > 0, `${weapon.id} has a finite offer weight`);
      assert.ok(Number.isFinite(lateWeight) && lateWeight > 0, `${weapon.id} has a finite later offer weight`);
      if (weapon.shopValue > 0) {
        assert.ok(lateWeight > earlyWeight, `${weapon.id} weight progresses with its configured shop value`);
      }
    }

    const positiveValues = [...new Set(weapons.map((weapon) => weapon.shopValue).filter((value) => value > 0))]
      .sort((left, right) => left - right);
    for (let index = 1; index < positiveValues.length; index += 1) {
      assert.ok(getWeaponShopOfferWeight(positiveValues[index - 1], 2) >
        getWeaponShopOfferWeight(positiveValues[index], 2), 'higher configured values are rarer early');
      assert.ok(getWeaponShopOfferWeight(positiveValues[index - 1], 6) >
        getWeaponShopOfferWeight(positiveValues[index], 6), 'higher configured values remain rarer later');
    }
  });

  it('unlocks higher shop-value weapons in later matches', () => {
    assert.equal(getMinimumWeaponShopMatch(0), 1);
    assert.equal(getMinimumWeaponShopMatch(1), 1);
    assert.equal(getMinimumWeaponShopMatch(2), 2);
    assert.equal(getMinimumWeaponShopMatch(3), 3);
    assert.equal(getMinimumWeaponShopMatch(4), 4);
    assert.equal(getMinimumWeaponShopMatch(5), 5);
  });

  it('raises unique gadget offer chance by two points per shop and caps at one hundred percent', () => {
    assert.equal(getUniqueGadgetOfferChance(1), 0.01);
    assert.equal(getUniqueGadgetOfferChance(2), 0.03);
    assert.equal(getUniqueGadgetOfferChance(5), 0.09);
    assert.equal(getUniqueGadgetOfferChance(7), 0.13);
    assert.equal(getUniqueGadgetOfferChance(19), 0.37);
    assert.equal(getUniqueGadgetOfferChance(50), 0.99);
    assert.equal(getUniqueGadgetOfferChance(51), 1);
    assert.equal(getUniqueGadgetOfferChance(100), 1);
  });

  it('offers only explicitly unique gadgets after the per-shop probability roll', () => {
    const gadgets = {
      smoke: { id: 'smoke', rarity: 'common' },
      uniqueA: { id: 'unique-a', rarity: 'unique' },
      uniqueB: { id: 'unique-b', rarity: 'unique' },
    };
    assert.equal(isUniqueGadgetDefinition(gadgets.uniqueA), true);
    assert.equal(isUniqueGadgetDefinition(gadgets.smoke), false);
    assert.equal(chooseUniqueGadgetOffer(gadgets, 1, () => 0.01), null,
      'the first-phase offer chance is exactly one percent');
    assert.equal(chooseUniqueGadgetOffer(gadgets, 1, () => 0.009), 'unique-a');
    assert.equal(chooseUniqueGadgetOffer(gadgets, 2, () => 0.029), 'unique-a',
      'the second shop uses its increased three-percent chance');
    assert.equal(chooseUniqueGadgetOffer(gadgets, 1, () => 0, ['unique-a']), 'unique-b',
      'the currently equipped unique gadget is excluded');
    assert.equal(chooseUniqueGadgetOffer({ smoke: gadgets.smoke }, 1, () => {
      assert.fail('randomness is not consumed when there are no unique gadgets');
    }), null);
  });
});