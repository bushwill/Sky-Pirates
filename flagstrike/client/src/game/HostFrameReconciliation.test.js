import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHostFrame, createHostFrame } from '../../../shared/HostFrameSnapshot.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { reconcileOwnerWeaponSnapshot } from './HostFrameReconciliation.js';

const shotgun = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;

function makeMatch(weaponState, actionSequence) {
  return {
    startedAt: 1_000,
    gameplayStartsAt: 1_000,
    endsAt: 100_000,
    updatedAt: 1_100,
    map: { width: 1_000, height: 1_000, objects: [] },
    players: [{
      id: 'owner',
      name: 'Owner',
      team: 'red',
      x: 100,
      y: 100,
      vx: 0,
      vy: 0,
      alive: true,
      selectedWeaponId: shotgun.id,
      weaponStats: { [shotgun.id]: weaponState },
      lastWeaponActionSequence: actionSequence,
    }],
    flag: { x: 500, y: 500, heldBy: null, dropped: false, lastDroppedBy: null },
    smokes: [],
    gadgetEffects: [],
    victory: null,
    postGame: null,
    quickPlayState: null,
  };
}

describe('owner state reconciliation from host frames', () => {
  it('keeps a locally predicted shotgun shell/action while host acknowledgement is pending, then accepts host state once', () => {
    const initial = {
      ammo: shotgun.magazineSize,
      accuracy: shotgun.accuracy.startingAccuracy,
      effectiveAccuracy: shotgun.accuracy.startingAccuracy,
      aimAngle: 0.4,
      aimUpdatedAt: 1_000,
      reloading: false,
      shotsFired: 0,
      cooldownEndsAt: 0,
    };
    const action = {
      sequence: 5,
      kind: 'fire',
      weaponId: shotgun.id,
      at: 1_100,
    };
    const pending = [action];
    const frame = createHostFrame({
      match: makeMatch(initial, 4),
      authorityEpoch: 1,
      revision: 1,
      simulationTimeMs: 100,
    });
    const received = applyHostFrame(frame, makeMatch(initial, 4));
    const predicted = reconcileOwnerWeaponSnapshot(received.players[0], pending, 1_100);

    assert.equal(predicted.stats[shotgun.id].ammo, shotgun.magazineSize - 1);
    assert.equal(predicted.stats[shotgun.id].manualActionEndsAt,
      action.at + shotgun.manualActionDurationMs);
    assert.equal(predicted.pending.length, 1);

    const acceptedMatch = makeMatch(predicted.stats[shotgun.id], action.sequence);
    const acceptedFrame = createHostFrame({
      match: acceptedMatch,
      authorityEpoch: 1,
      revision: 2,
      simulationTimeMs: 150,
    });
    const acknowledged = applyHostFrame(acceptedFrame, received);
    const reconciled = reconcileOwnerWeaponSnapshot(acknowledged.players[0], pending, 1_150);

    assert.equal(reconciled.stats[shotgun.id].ammo, shotgun.magazineSize - 1);
    assert.equal(reconciled.pending.length, 0);
  });
});
