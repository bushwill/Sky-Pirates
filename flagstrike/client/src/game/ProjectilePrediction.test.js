import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consumePredictedShotPellet,
  shouldRenderConfirmedProjectile,
} from './ProjectilePrediction.js';

describe('predicted projectile matching', () => {
  it('suppresses duplicate authoritative tracers but keeps the confirmed hit for impact rendering', () => {
    const pending = new Map([['player-1:8', 2]]);
    const authoritativeHit = {
      ownerId: 'player-1',
      ownerActionSequence: 8,
      hitType: 'player',
      hitPlayerId: 'player-2',
    };

    assert.equal(consumePredictedShotPellet(pending, authoritativeHit), true);
    assert.equal(authoritativeHit.hitType, 'player', 'the caller can still render the authoritative impact');
    assert.equal(pending.get('player-1:8'), 1);
    assert.equal(consumePredictedShotPellet(pending, {
      ownerId: 'player-1', ownerActionSequence: 8, hitType: 'surface',
    }), true);
    assert.equal(pending.has('player-1:8'), false);
    assert.equal(consumePredictedShotPellet(pending, authoritativeHit), false);
  });

  it('does not consume a prediction for another owner or sequence', () => {
    const pending = new Map([['player-1:8', 1]]);
    assert.equal(consumePredictedShotPellet(pending, {
      ownerId: 'player-2', ownerActionSequence: 8,
    }), false);
    assert.equal(consumePredictedShotPellet(pending, {
      ownerId: 'player-1', ownerActionSequence: 9,
    }), false);
    assert.equal(pending.get('player-1:8'), 1);
  });

  it('does not replay a confirmed tracer after its prediction has already finished', () => {
    assert.equal(shouldRenderConfirmedProjectile(true, false), false);
    assert.equal(shouldRenderConfirmedProjectile(true, true), true);
    assert.equal(shouldRenderConfirmedProjectile(false, false), true);
  });
});
