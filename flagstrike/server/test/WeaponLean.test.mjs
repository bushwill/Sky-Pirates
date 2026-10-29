import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateWeaponLeanState } from '../../shared/WeaponLean.js';

function update(state, qDown, eDown, now) {
  return updateWeaponLeanState(state, { qDown, eDown }, now);
}

const centered = () => ({ toggleLean: 0, currentLean: 0, qDown: false, eDown: false, qPressedAt: null, ePressedAt: null });

describe('WeaponLean', () => {
  it('toggles a lean on a quick tap and toggles it off on the next tap', () => {
    let state = update(centered(), true, false, 10);
    assert.equal(state.currentLean, -1, 'lean engages immediately on press');
    state = update(state, false, false, 80);
    assert.equal(state.currentLean, -1, 'a short press toggles left lean on release');

    state = update(state, true, false, 100);
    state = update(state, false, false, 150);
    assert.equal(state.currentLean, 0, 'a second short press toggles left lean off');
  });

  it('leans while held, then returns to the prior toggle state on release', () => {
    let state = update(centered(), false, true, 0);
    assert.equal(state.currentLean, 1);
    state = update(state, false, true, 500);
    assert.equal(state.currentLean, 1);
    state = update(state, false, false, 510);
    assert.equal(state.currentLean, 0);
  });

  it('temporarily holds the opposite lean without losing the toggled lean', () => {
    let state = update(centered(), true, false, 0);
    state = update(state, false, false, 50);
    assert.equal(state.currentLean, -1);

    state = update(state, false, true, 100);
    assert.equal(state.currentLean, 1);
    state = update(state, false, false, 400);
    assert.equal(state.currentLean, -1);
  });
});
