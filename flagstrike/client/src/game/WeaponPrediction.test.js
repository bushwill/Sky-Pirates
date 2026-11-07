import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { advanceWeaponState, applyWeaponAction, createInitialWeaponState, ensureWeaponState, getPredictedPelletAngles, hasPendingSemiAutoShot, reconcileWeaponStats, selectOwnerWeaponStats } from './WeaponPrediction.js';

const definitions = Object.fromEntries(Object.values(DEFAULT_PROJECTILE_DEFINITIONS).map((weapon) => [weapon.id, weapon]));

describe('client weapon prediction', () => {
  it('consumes semi-auto bot fire presses once while automatic weapons remain hold-driven', () => {
    const semiAuto = { semiAuto: true };
    const automatic = { semiAuto: false };
    assert.equal(hasPendingSemiAutoShot(semiAuto, 2, 1), true);
    assert.equal(hasPendingSemiAutoShot(semiAuto, 2, 2), false);
    assert.equal(hasPendingSemiAutoShot(automatic, 2, 1), false);
  });

  it('does not let routine snapshots replace the owner’s live weapon state', () => {
    const predicted = { 'assault-rifle': { ammo: 17, reloading: true, reloadEndsAt: 5_000, aimAngle: 1.2 } };
    const snapshot = { 'assault-rifle': { ammo: 29, reloading: false, aimAngle: 0.8 } };
    assert.deepEqual(selectOwnerWeaponStats(predicted, snapshot), predicted);
    assert.equal(selectOwnerWeaponStats(predicted, snapshot, true), snapshot,
      'an ownership handoff initializes from the current authoritative state');
  });

  it('loads authoritative weapon states missing from the owner cache without replacing predicted states', () => {
    const predictedRifle = { ammo: 17, aimAngle: 1.2 };
    const snapshot = {
      'assault-rifle': { ammo: 29, aimAngle: 0.8 },
      shotgun: { ammo: 6, aimAngle: 0.4 },
    };
    assert.deepEqual(selectOwnerWeaponStats({ 'assault-rifle': predictedRifle }, snapshot), {
      ...snapshot,
      'assault-rifle': predictedRifle,
    });
    assert.deepEqual(selectOwnerWeaponStats({}, snapshot), snapshot);
  });

  it('fills missing ammo on partial authoritative weapon states', () => {
    const weapon = definitions.smg;
    const partialState = { reloading: false, shotsFired: 0 };
    const state = ensureWeaponState(partialState, weapon, 1_000);

    assert.equal(state.ammo, weapon.magazineSize);
    assert.equal(state.reloading, false);
    assert.equal(state.shotsFired, 0);
  });

  it('reloads a partial sniper magazine but not a full one', () => {
    const weapon = definitions.sniper;
    const state = {
      accuracy: weapon.accuracy.startingAccuracy,
      effectiveAccuracy: weapon.accuracy.startingAccuracy,
      ammo: weapon.magazineSize - 1,
      reloading: false,
      shotsFired: 0,
    };
    const result = applyWeaponAction(state, weapon, {
      sequence: 1,
      kind: 'reload',
      weaponId: weapon.id,
      at: 1_000,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.state.reloading, true);
    assert.equal(result.state.reloadEndsAt, 1_000 + weapon.reloadDurationMs);
    assert.equal(applyWeaponAction({ ...state, ammo: weapon.magazineSize }, weapon, {
      sequence: 2,
      kind: 'reload',
      weaponId: weapon.id,
      at: 1_000,
    }).accepted, false);
  });

  it('uses the suppressed SMG definition for firing and reload timing', () => {
    const weapon = definitions['suppressed-smg'];
    const firedAt = 1_000;
    const initial = createInitialWeaponState(weapon, firedAt);
    const shot = applyWeaponAction(initial, weapon, {
      sequence: 1,
      kind: 'fire',
      weaponId: weapon.id,
      at: firedAt,
      direction: { x: 1, y: 0 },
    });

    assert.equal(shot.accepted, true);
    assert.equal(shot.state.ammo, initial.ammo - 1);
    assert.equal(shot.state.cooldownEndsAt, firedAt + weapon.cooldownMs);

    const reloadAt = shot.state.cooldownEndsAt;
    const reload = applyWeaponAction(shot.state, weapon, {
      sequence: 2,
      kind: 'reload',
      weaponId: weapon.id,
      at: reloadAt,
    });
    assert.equal(reload.accepted, true);
    assert.equal(reload.state.reloadEndsAt, reloadAt + weapon.reloadDurationMs);
  });

  it('allows reloading a partially used heavy sniper magazine', () => {
    const weapon = definitions['heavy-sniper'];
    const initial = createInitialWeaponState(weapon, 1_000);
    const shot = applyWeaponAction(initial, weapon, {
      sequence: 1,
      kind: 'fire',
      weaponId: weapon.id,
      at: 1_100,
      direction: { x: 1, y: 0 },
    });
    assert.equal(shot.accepted, true);
    assert.equal(shot.state.ammo, weapon.magazineSize - 1);

    const reload = applyWeaponAction(shot.state, weapon, {
      sequence: 2,
      kind: 'reload',
      weaponId: weapon.id,
      at: 1_200,
    });
    assert.equal(reload.accepted, true);
    assert.equal(reload.state.ammo, weapon.magazineSize - 1);
    assert.equal(reload.state.reloadEndsAt, 1_200 + weapon.reloadDurationMs);
  });

  it('queues a full manual cycle after a reload interrupts it', () => {
    const weapon = definitions.sniper;
    const initial = createInitialWeaponState(weapon, 1_000);
    const shot = applyWeaponAction(initial, weapon, {
      sequence: 1,
      kind: 'fire',
      weaponId: weapon.id,
      at: 1_000,
      direction: { x: 1, y: 0 },
    });
    const reload = applyWeaponAction(shot.state, weapon, {
      sequence: 2,
      kind: 'reload',
      weaponId: weapon.id,
      at: 1_100,
    });

    assert.equal(reload.state.manualActionEndsAt, null);
    assert.equal(reload.state.manualActionQueuedDurationMs, weapon.manualActionDurationMs);
    assert.equal(reload.state.reloadEndsAt, 1_100 + weapon.reloadDurationMs);

    const completed = advanceWeaponState(reload.state, weapon, reload.state.reloadEndsAt);
    assert.equal(completed.reloading, false);
    assert.equal(completed.manualActionStartedAt, reload.state.reloadEndsAt);
    assert.equal(completed.manualActionEndsAt,
      reload.state.reloadEndsAt + weapon.manualActionDurationMs);
    assert.equal(completed.manualActionQueuedDurationMs, null);
  });

  it('runs the pending manual action after the first shell of a mandatory reload', () => {
    const weapon = definitions.shotgun;
    const state = createInitialWeaponState(weapon, 1_000);
    state.ammo = 1;
    const shot = applyWeaponAction(state, weapon, {
      sequence: 1,
      kind: 'fire',
      weaponId: weapon.id,
      at: 1_000,
      direction: { x: 1, y: 0 },
    });

    assert.equal(shot.state.reloading, true);
    assert.equal(shot.state.reloadIsMandatory, true);
    assert.equal(shot.state.manualActionEndsAt, null);
    assert.equal(shot.state.manualActionQueuedDurationMs, weapon.manualActionDurationMs);

    const firstReloadEndsAt = shot.state.reloadEndsAt;
    const firstShell = advanceWeaponState(shot.state, weapon, firstReloadEndsAt);
    assert.equal(firstShell.ammo, 1);
    assert.equal(firstShell.reloading, false);
    assert.equal(firstShell.reloadPaused, true);
    assert.equal(firstShell.manualActionStartedAt, firstReloadEndsAt);
    assert.equal(firstShell.manualActionEndsAt, firstReloadEndsAt + weapon.manualActionDurationMs);

    const manualActionEndsAt = firstShell.manualActionEndsAt;
    const continuedReload = advanceWeaponState(firstShell, weapon, manualActionEndsAt);
    assert.equal(continuedReload.reloading, true);
    assert.equal(continuedReload.reloadPaused, false);
    assert.equal(continuedReload.reloadEndsAt,
      manualActionEndsAt + weapon.reloadIntervalMs[1]);
  });

  it('computes a stable complete pellet pattern locally for each shot sequence', () => {
    const angles = getPredictedPelletAngles(0.4, definitions.shotgun, 19);
    assert.equal(angles.length, definitions.shotgun.pelletCount);
    assert.deepEqual(angles, getPredictedPelletAngles(0.4, definitions.shotgun, 19));
    assert.notDeepEqual(angles, getPredictedPelletAngles(0.4, definitions.shotgun, 20));
  });

  it('predicts a local shot immediately and replays it until the host acknowledges the action', () => {
    const weapon = definitions['assault-rifle'];
    const authoritative = {
      'assault-rifle': {
        accuracy: weapon.accuracy.startingAccuracy ?? weapon.accuracy.maxAccuracy ?? 1,
        effectiveAccuracy: weapon.accuracy.startingAccuracy ?? weapon.accuracy.maxAccuracy ?? 1,
        ammo: weapon.magazineSize,
        aimAngle: 0.2,
        aimUpdatedAt: 1_000,
        reloading: false,
        shotsFired: 0,
        cooldownEndsAt: 0,
      },
    };
    const action = { sequence: 1, kind: 'fire', weaponId: weapon.id, at: 1_100 };
    const predicted = applyWeaponAction(authoritative['assault-rifle'], weapon, action);
    assert.equal(predicted.accepted, true);
    assert.equal(predicted.state.ammo, authoritative['assault-rifle'].ammo - 1);
    assert.equal(predicted.state.shotsFired, authoritative['assault-rifle'].shotsFired + 1);
    assert.equal(predicted.state.cooldownEndsAt, action.at + weapon.cooldownMs);
    assert.ok(Number.isFinite(predicted.state.predictedShotAngle));

    const replayed = reconcileWeaponStats(authoritative, [action], definitions, 0, 1_100);
    assert.equal(replayed.stats['assault-rifle'].ammo, authoritative['assault-rifle'].ammo - 1);
    assert.equal(replayed.pending.length, 1);
    const confirmed = reconcileWeaponStats({
      ...authoritative,
      'assault-rifle': { ...predicted.state, lastActionSequence: 1 },
    }, [action], definitions, 1, 1_100);
    assert.equal(confirmed.stats['assault-rifle'].ammo, predicted.state.ammo, 'an acknowledged shot is not replayed twice');
    assert.equal(confirmed.pending.length, 0);
  });

  it('bases the predicted shot on the direction sent with the fire action, not stale aim state', () => {
    const weapon = definitions['assault-rifle'];
    const direction = { x: 0, y: 1 };
    const predicted = applyWeaponAction({
      ...createInitialWeaponState(weapon, 1_000),
      aimAngle: 0,
      effectiveAccuracy: 1,
      accuracy: 1,
    }, weapon, {
      sequence: 27,
      kind: 'fire',
      weaponId: weapon.id,
      at: 1_100,
      direction,
    });

    assert.equal(predicted.accepted, true);
    assert.equal(predicted.state.aimAngle, Math.PI / 2);
    assert.equal(predicted.state.predictedShotAngle, Math.PI / 2);
  });

  it('replays a pending shotgun action over host frames without consuming its shell twice', () => {
    const weapon = definitions.shotgun;
    const authoritative = {
      [weapon.id]: {
        accuracy: weapon.accuracy.startingAccuracy,
        effectiveAccuracy: weapon.accuracy.startingAccuracy,
        ammo: weapon.magazineSize,
        aimAngle: 0.7,
        aimUpdatedAt: 1_000,
        reloading: false,
        shotsFired: 0,
        cooldownEndsAt: 0,
      },
    };
    const action = { sequence: 5, kind: 'fire', weaponId: weapon.id, at: 1_100 };
    const firstFrame = reconcileWeaponStats(authoritative, [action], definitions, 4, 1_100);
    const nextUnacknowledgedFrame = reconcileWeaponStats(authoritative, [action], definitions, 4, 1_150);

    assert.equal(firstFrame.stats[weapon.id].ammo, weapon.magazineSize - 1);
    assert.equal(nextUnacknowledgedFrame.stats[weapon.id].ammo, weapon.magazineSize - 1);
    assert.equal(nextUnacknowledgedFrame.stats[weapon.id].manualActionEndsAt,
      action.at + weapon.manualActionDurationMs);
    assert.equal(nextUnacknowledgedFrame.pending.length, 1);

    const accepted = reconcileWeaponStats({
      ...authoritative,
      [weapon.id]: {
        ...firstFrame.stats[weapon.id],
        lastActionSequence: action.sequence,
      },
    }, [action], definitions, action.sequence, 1_150);
    assert.equal(accepted.stats[weapon.id].ammo, weapon.magazineSize - 1);
    assert.equal(accepted.pending.length, 0);
  });

  it('accepts host-authoritative shots when a selected weapon has no cached state', () => {
    for (const weapon of [definitions['assault-rifle'], definitions.shotgun]) {
      const state = createInitialWeaponState(weapon, 1_000);
      const shot = applyWeaponAction(state, weapon, {
        sequence: 1,
        kind: 'fire',
        weaponId: weapon.id,
        at: 1_100,
      });
      assert.equal(shot.accepted, true, `${weapon.id} should not be dropped because its state was absent`);
      assert.equal(shot.state.ammo, weapon.magazineSize - 1);
      assert.equal(shot.state.shotsFired, 1);
    }
  });

  it('keeps host shots finite when initial accuracy fields are absent from raw weapon definitions', () => {
    for (const weapon of [definitions['assault-rifle'], definitions.shotgun]) {
      const missingAccuracy = {
        ammo: weapon.magazineSize,
        aimAngle: 0,
        aimUpdatedAt: 1_000,
        reloading: false,
        shotsFired: 0,
      };
      const shot = applyWeaponAction(missingAccuracy, weapon, {
        sequence: 8,
        kind: 'fire',
        weaponId: weapon.id,
        at: 1_100,
        direction: { x: 0, y: 1 },
      });

      assert.equal(shot.accepted, true, `${weapon.id} shot should be accepted`);
      assert.ok(Number.isFinite(shot.state.accuracy), `${weapon.id} accuracy should stay finite`);
      assert.ok(Number.isFinite(shot.state.effectiveAccuracy), `${weapon.id} effective accuracy should stay finite`);
      assert.ok(Number.isFinite(shot.state.predictedShotAngle), `${weapon.id} shot angle should stay finite`);
      assert.ok(Math.abs(shot.state.aimAngle - Math.PI / 2) < 1e-9,
        `${weapon.id} should fire along its submitted aim direction`);
    }
  });

  it('initializes missing weapon snapshots with finite accuracy and effective accuracy', () => {
    const { stats } = reconcileWeaponStats({}, [], definitions, 0, 1_000);
    for (const weapon of [definitions['assault-rifle'], definitions.shotgun]) {
      assert.ok(Number.isFinite(stats[weapon.id].accuracy), `${weapon.id} accuracy should be initialized`);
      assert.ok(Number.isFinite(stats[weapon.id].effectiveAccuracy),
        `${weapon.id} effective accuracy should be initialized`);
    }
  });

  it('predicts shotgun shell reloads and firing interruption with a loaded shell', () => {
    const weapon = definitions.shotgun;
    const initial = {
      accuracy: weapon.accuracy.startingAccuracy,
      effectiveAccuracy: weapon.accuracy.startingAccuracy,
      ammo: weapon.magazineSize - 3,
      aimAngle: 0,
      reloading: false,
      shotsFired: 0,
    };
    const reload = applyWeaponAction(initial, weapon, { sequence: 1, kind: 'reload', weaponId: weapon.id, at: 1_000 });
    assert.equal(reload.accepted, true);
    assert.equal(reload.state.reloadEndsAt, 1_000 + weapon.reloadIntervalMs[0]);
    const oneShell = applyWeaponAction(reload.state, weapon,
      { sequence: 2, kind: 'fire', weaponId: weapon.id, at: 1_000 + weapon.reloadIntervalMs[0] + 50 });
    assert.equal(oneShell.accepted, true);
    assert.equal(oneShell.state.ammo, initial.ammo, 'one round is inserted, then consumed by the predicted shot');
    assert.equal(oneShell.state.reloading, false);
  });

  it('predicts all shots in a battle-pistol burst with recoil on each shot', () => {
    const weapon = definitions['battle-pistol'];
    let state = {
      accuracy: weapon.accuracy.startingAccuracy,
      effectiveAccuracy: weapon.accuracy.startingAccuracy,
      ammo: weapon.magazineSize,
      aimAngle: 0.4,
      reloading: false,
      shotsFired: 0,
    };
    const shotAngles = [];
    for (let index = 0; index < weapon.burstCount; index += 1) {
      const result = applyWeaponAction(state, weapon, {
        sequence: index + 1,
        kind: 'fire',
        weaponId: weapon.id,
        at: 1_000 + index * weapon.burstShotIntervalMs,
      });
      assert.equal(result.accepted, true);
      state = result.state;
      shotAngles.push(state.predictedShotAngle);
      assert.equal(state.ammo, weapon.magazineSize - index - 1);
      assert.equal(state.burstShotsRemaining, weapon.burstCount - index - 1);
    }
    assert.equal(state.shotsFired, weapon.burstCount);
    assert.ok(state.accuracy < weapon.accuracy.startingAccuracy, 'each round applies recoil');
    assert.equal(state.cooldownEndsAt, 1_000 + 2 * weapon.burstShotIntervalMs + weapon.burstDelayMs);
    assert.equal(new Set(shotAngles).size, weapon.burstCount, 'each round gets its own deterministic spread');
  });
});
