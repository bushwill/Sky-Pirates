import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acknowledgeWeaponActions, retryWeaponActions } from './OwnerActionQueue.js';

describe('owner weapon action delivery', () => {
  it('retries the same action sequence until acknowledged', () => {
    const pending = new Map([[4, {
      messageType: 'game:fire',
      payload: { matchId: 1, actionSequence: 4 },
      sentAt: 100,
      attempts: 1,
    }]]);
    const sends = [];

    const send = (messageType, payload) => {
      sends.push([messageType, payload]);
      return true;
    };
    retryWeaponActions(pending, 349, send);
    assert.equal(sends.length, 0);
    retryWeaponActions(pending, 350, send);
    assert.deepEqual(sends, [['game:fire', { matchId: 1, actionSequence: 4 }]]);
    assert.equal(pending.get(4).attempts, 2);

    acknowledgeWeaponActions(pending, 4);
    assert.equal(pending.size, 0);
  });

  it('keeps retrying across transient transport failures until the host acknowledges', () => {
    const pending = new Map([[7, {
      messageType: 'game:reload',
      payload: { actionSequence: 7 },
      sentAt: 0,
      attempts: 3,
    }]]);

    retryWeaponActions(pending, 250, () => false);
    assert.equal(pending.get(7).attempts, 3);
    assert.equal(pending.get(7).sentAt, 250, 'failed sends are throttled instead of retried every frame');
    retryWeaponActions(pending, 500, () => true);
    assert.equal(pending.get(7).attempts, 4);
    retryWeaponActions(pending, 750, () => true);
    assert.equal(pending.has(7), true, 'unacknowledged actions are never silently discarded');
    acknowledgeWeaponActions(pending, 7);
    assert.equal(pending.has(7), false);
  });

  it('acknowledges all earlier actions using the host sequence watermark', () => {
    const pending = new Map([[1, {}], [2, {}], [3, {}]]);
    acknowledgeWeaponActions(pending, 2);
    assert.deepEqual([...pending.keys()], [3]);
  });
});
