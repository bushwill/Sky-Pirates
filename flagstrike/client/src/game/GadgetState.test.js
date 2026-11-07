import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  beginGadgetSwitch,
  consumeSelectedGadget,
  getEquippedSlot,
  preservePendingGadgetState,
  preservePendingGadgetSwitch,
} from './GadgetState.js';

describe('GadgetState', () => {
  it('switches to gadget and back by committing each completed switch', () => {
    const player = { equippedSlot: 'weapon' };
    assert.equal(beginGadgetSwitch(player, 100), 'gadget');
    assert.equal(getEquippedSlot(player, 1_100), 'gadget');
    assert.equal(beginGadgetSwitch(player, 1_200), 'weapon');
    assert.equal(getEquippedSlot(player, 2_200), 'weapon');
    assert.equal(player.gadgetSwitchEndsAt, null);
  });

  it('pauses a manual action while swapped away and resumes it on return', () => {
    const player = {
      equippedSlot: 'weapon',
      selectedWeaponId: 'sniper',
      weaponStats: {
        sniper: {
          reloading: false,
          reloadStartedAt: null,
          reloadEndsAt: null,
          reloadRoundsInserted: null,
          manualActionStartedAt: null,
          manualActionEndsAt: null,
        },
      },
    };
    player.weaponStats.sniper.manualActionStartedAt = 1_000;
    player.weaponStats.sniper.manualActionEndsAt = 1_500;
    assert.equal(beginGadgetSwitch(player, 1_200), 'gadget');
    assert.equal(player.weaponStats.sniper.reloading, false);
    assert.equal(player.weaponStats.sniper.reloading, false);
    assert.equal(player.weaponStats.sniper.manualActionEndsAt, null);
    assert.equal(player.weaponStats.sniper.manualActionQueuedDurationMs, 300);
    assert.equal(getEquippedSlot(player, 1_500), 'weapon');
    assert.equal(player.weaponStats.sniper.manualActionEndsAt, null,
      'the queued manual action remains paused until the switch to gadget completes');

    assert.equal(getEquippedSlot(player, 2_200), 'gadget');
    assert.equal(beginGadgetSwitch(player, 2_300), 'weapon');
    assert.equal(getEquippedSlot(player, 3_300), 'weapon');
    assert.equal(player.weaponStats.sniper.manualActionStartedAt, 3_300);
    assert.equal(player.weaponStats.sniper.manualActionEndsAt, 3_600);
    assert.equal(player.weaponStats.sniper.manualActionQueuedDurationMs, null);
  });

  it('cancels reload when swapping away from the weapon', () => {
    const player = {
      equippedSlot: 'weapon',
      selectedWeaponId: 'sniper',
      weaponStats: {
        sniper: {
          reloading: true,
          reloadStartedAt: 100,
          reloadEndsAt: 2_000,
          reloadRoundsInserted: null,
        },
      },
    };

    assert.equal(beginGadgetSwitch(player, 1_200), 'gadget');
    assert.equal(player.weaponStats.sniper.reloading, false);
    assert.equal(player.weaponStats.sniper.reloadStartedAt, null);
    assert.equal(player.weaponStats.sniper.reloadEndsAt, null);
  });

  it('automatically equips the weapon when the final gadget use is consumed', () => {
    const player = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'smoke-grenade',
      gadgetCount: 1,
      gadgetCounts: { 'smoke-grenade': 1 },
      gadgetSwitchEndsAt: 500,
      gadgetSwitchTargetSlot: 'gadget',
    };
    assert.equal(consumeSelectedGadget(player), 0);
    assert.equal(player.equippedSlot, 'weapon');
    assert.equal(player.gadgetSwitchEndsAt, null);
    assert.equal(player.gadgetSwitchTargetSlot, null);
  });

  it('switches back to the weapon immediately when Katana is spent without a kill', () => {
    const player = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'katana',
      gadgetCount: 1,
      gadgetCounts: { katana: 1 },
    };
    assert.equal(consumeSelectedGadget(player), 0);
    assert.equal(player.equippedSlot, 'weapon');
    assert.equal(player.gadgetSwitchStartedAt, null);
    assert.equal(player.gadgetSwitchEndsAt, null);
    assert.equal(player.gadgetSwitchTargetSlot, null);
  });

  it('keeps Katana equipped when a confirmed kill spends its charge', () => {
    const player = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'katana',
      gadgetCount: 1,
      gadgetCounts: { katana: 1 },
    };
    assert.equal(consumeSelectedGadget(player, { keepEquippedWhenEmpty: true }), 0);
    assert.equal(player.equippedSlot, 'gadget');
    assert.equal(beginGadgetSwitch(player, 1_000), 'weapon');
    assert.equal(getEquippedSlot(player, 1_999), 'gadget');
    assert.equal(getEquippedSlot(player, 2_000), 'weapon');
  });

  it('clears an old Vine Trap recharge deadline when a new trap is used', () => {
    const player = {
      selectedGadgetId: 'vine-trap',
      gadgetCount: 1,
      gadgetCounts: { 'vine-trap': 1 },
      vineTrapRechargeAt: 10_000,
    };
    assert.equal(consumeSelectedGadget(player), 0);
    assert.equal(player.vineTrapRechargeAt, null);
  });

  it('refills gadget charges without cooldowns when infinite use is enabled', () => {
    const player = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'bio-field',
      gadgetCount: 1,
      gadgetCounts: { 'bio-field': 1 },
      gadgetChargeRechargeRemainingMs: { 'bio-field': [30_000] },
    };

    assert.equal(consumeSelectedGadget(player, { infiniteUse: true }), 2);
    assert.equal(player.gadgetCounts['bio-field'], 2);
    assert.equal(player.gadgetCount, 2);
    assert.deepEqual(player.gadgetChargeRechargeRemainingMs['bio-field'], []);
    assert.equal(player.equippedSlot, 'gadget');

    const spyCamera = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'spy-camera',
      gadgetCount: 0,
      gadgetCounts: { 'spy-camera': 0 },
    };
    assert.equal(consumeSelectedGadget(spyCamera, { infiniteUse: true }), 1);
    assert.equal(consumeSelectedGadget(spyCamera, { infiniteUse: true }), 1);
    assert.equal(spyCamera.gadgetCounts['spy-camera'], 1);

    const trophy = {
      equippedSlot: 'gadget',
      selectedGadgetId: 'trophy-system',
      gadgetCount: 0,
      gadgetCounts: { 'trophy-system': 0 },
      trophyCommandReadyAt: 50_000,
    };
    assert.equal(consumeSelectedGadget(trophy, { infiniteUse: true }), 1);
    assert.equal(trophy.trophyCommandReadyAt, 0);
  });

  it('preserves an unacknowledged local switch against stale host snapshots', () => {
    const previous = {
      equippedSlot: 'weapon',
      gadgetSwitchStartedAt: 100,
      gadgetSwitchEndsAt: 1_100,
      gadgetSwitchTargetSlot: 'gadget',
    };
    const staleSnapshot = {
      equippedSlot: 'weapon',
      gadgetSwitchStartedAt: null,
      gadgetSwitchEndsAt: null,
      gadgetSwitchTargetSlot: null,
    };

    assert.deepEqual(
      preservePendingGadgetSwitch(previous, staleSnapshot, 5, 4, 500),
      previous,
    );
    assert.deepEqual(
      preservePendingGadgetSwitch(previous, staleSnapshot, 5, 4, 1_200),
      { ...staleSnapshot, equippedSlot: 'gadget' },
    );
    assert.deepEqual(
      preservePendingGadgetSwitch(previous, staleSnapshot, 5, 5, 500),
      staleSnapshot,
      'an acknowledged action uses the host snapshot',
    );
  });

  it('preserves a predicted gadget charge and cooldown against a stale host snapshot', () => {
    const previous = {
      selectedGadgetId: 'orbital-strike',
      gadgetCounts: { 'orbital-strike': 0 },
      gadgetCount: 0,
      gadgetChargeRechargeRemainingMs: { 'orbital-strike': [60_000] },
      orbitalStrikeCooldownRemainingMs: 60_000,
    };
    const staleSnapshot = {
      selectedGadgetId: 'orbital-strike',
      gadgetCounts: { 'orbital-strike': 1 },
      gadgetCount: 1,
      gadgetChargeRechargeRemainingMs: { 'orbital-strike': [] },
      orbitalStrikeCooldownRemainingMs: 0,
    };

    const pending = preservePendingGadgetState(previous, staleSnapshot, 5, 4);
    assert.equal(pending.gadgetCounts['orbital-strike'], 0);
    assert.equal(pending.gadgetChargeRechargeRemainingMs['orbital-strike'][0], 60_000);
    assert.equal(pending.orbitalStrikeCooldownRemainingMs, 60_000);

    assert.deepEqual(preservePendingGadgetState(previous, staleSnapshot, 5, 5), staleSnapshot);
  });
});
