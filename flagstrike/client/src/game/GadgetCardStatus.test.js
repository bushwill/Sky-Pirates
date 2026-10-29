import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getGadgetCardStatus, getSpyCameraBatteryStatus } from './GadgetCardStatus.js';

describe('gadget card status', () => {
  it('shows the remaining battery life of a deployed Spy Camera', () => {
    const camera = { startedAt: 1_000, expiresAt: 61_000, health: 50 };
    assert.equal(getSpyCameraBatteryStatus(camera, 10_000), 'Battery · 51s remaining');
    assert.equal(getSpyCameraBatteryStatus(camera, 60_001), 'Battery · 1s remaining');
    assert.equal(getSpyCameraBatteryStatus(camera, 61_000), null);
    assert.equal(getSpyCameraBatteryStatus({ ...camera, health: 0 }, 10_000), null);
  });

  it('shows the same empty state regardless of which slot was equipped', () => {
    assert.equal(getGadgetCardStatus({ hasGadget: true, gadgetCount: 0, equippedSlot: 'weapon' }),
      'No uses remaining');
    assert.equal(getGadgetCardStatus({ hasGadget: true, gadgetCount: 0, equippedSlot: 'gadget' }),
      'No uses remaining');
  });

  it('shows equip and use instructions while a gadget charge remains', () => {
    assert.equal(getGadgetCardStatus({ hasGadget: true, gadgetCount: 1, equippedSlot: 'weapon' }),
      'Right-click to equip');
    assert.equal(getGadgetCardStatus({ hasGadget: true, gadgetCount: 1, equippedSlot: 'gadget' }),
      'Equipped · Right-click to use');
  });

  it('prioritizes switching and handles an empty gadget slot', () => {
    assert.equal(getGadgetCardStatus({ hasGadget: true, gadgetCount: 0, switching: true, switchRemainingMs: 450 }),
      'Switching · 0.5s');
    assert.equal(getGadgetCardStatus(), 'Choose a gadget during the buy phase');
  });

  it('shows a cooldown countdown when the charge is recharging', () => {
    assert.equal(getGadgetCardStatus({
      hasGadget: true,
      gadgetCount: 0,
      cooldownRemainingMs: 42_500,
    }), 'Recharging · 42.5s');
  });

  it('shows a recharge countdown while a multi-charge gadget still has a use', () => {
    assert.equal(getGadgetCardStatus({
      hasGadget: true,
      gadgetCount: 1,
      maxCharges: 2,
      equippedSlot: 'gadget',
      cooldownRemainingMs: 42_500,
    }), 'Equipped · Right-click to use · Recharging · 42.5s');
  });
});