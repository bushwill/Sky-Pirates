import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  advanceSonarChargeRecharges,
  calculateGadgetTrajectory,
  DEFAULT_GADGET_MAX_BOUNCES,
  GADGET_DEFINITIONS,
  getSonarRechargeRemainingMs,
  queueSonarChargeRecharge,
  SONAR_CHARGE_COOLDOWN_MS,
  SONAR_CHARGES,
  SONAR_ID,
  SONAR_LISTENING_RADIUS,
  SONAR_PROJECTILE_RANGE,
  SONAR_PROJECTILE_SPEED,
} from '../../shared/GadgetModel.js';
import {
  advanceHostSonarProjectiles,
  createHostSonarProjectile,
} from '../../shared/HostGadgetModel.js';
import { collectFootstepAudioCues, findSonarListener } from '../../shared/AudioCueModel.js';
import { RoomManager } from '../RoomManager.mjs';

describe('Sonar gadget', () => {
  it('has two charges, per-charge cooldowns, and only recharges while alive', () => {
    const definition = GADGET_DEFINITIONS[SONAR_ID];
    assert.equal(SONAR_CHARGE_COOLDOWN_MS, 30_000);
    assert.equal(definition.charges, SONAR_CHARGES);
    assert.equal(definition.cooldownMs, SONAR_CHARGE_COOLDOWN_MS);
    assert.equal(definition.maxBounces, Infinity);
    assert.equal(SONAR_PROJECTILE_SPEED, 250);

    const player = {
      id: 'sonar-owner',
      alive: true,
      health: 100,
      selectedGadgetId: SONAR_ID,
      gadgetCounts: { [SONAR_ID]: 0 },
      gadgetCount: 0,
    };
    queueSonarChargeRecharge(player);
    assert.equal(advanceSonarChargeRecharges(player, SONAR_CHARGE_COOLDOWN_MS), 1);
    assert.equal(player.gadgetCounts[SONAR_ID], 1);
    queueSonarChargeRecharge(player);
    assert.equal(getSonarRechargeRemainingMs(player), SONAR_CHARGE_COOLDOWN_MS);

    player.alive = false;
    assert.equal(advanceSonarChargeRecharges(player, SONAR_CHARGE_COOLDOWN_MS), 0);
    assert.equal(player.gadgetCounts[SONAR_ID], 1);

    player.alive = true;
    assert.equal(advanceSonarChargeRecharges(player, SONAR_CHARGE_COOLDOWN_MS), 1);
    assert.equal(player.gadgetCounts[SONAR_ID], 2);
    assert.equal(player.gadgetCount, 2);
    assert.equal(getSonarRechargeRemainingMs(player), 0);
  });

  it('starts a missing recharge timer whenever charges are below maximum', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: SONAR_ID,
      gadgetCounts: { [SONAR_ID]: 1 },
      gadgetCount: 1,
    };
    assert.equal(advanceSonarChargeRecharges(player, 20_000), 0);
    assert.equal(getSonarRechargeRemainingMs(player), 10_000);
    assert.equal(advanceSonarChargeRecharges(player, 10_000), 1);
    assert.equal(player.gadgetCounts[SONAR_ID], SONAR_CHARGES);
    assert.equal(getSonarRechargeRemainingMs(player), 0);
  });

  it('does not grant cooldown charges to players who do not own the gadget', () => {
    const player = {
      alive: true,
      health: 100,
      selectedGadgetId: 'smoke-grenade',
      gadgetCounts: { [SONAR_ID]: 0 },
    };
    assert.equal(advanceSonarChargeRecharges(player, SONAR_CHARGE_COOLDOWN_MS), 0);
    assert.equal(player.gadgetCounts[SONAR_ID], 0);
    assert.equal(getSonarRechargeRemainingMs(player), 0);
  });

  it('follows an 800-unit path with unlimited wall bounces and is removed when its owner dies', () => {
    const definition = GADGET_DEFINITIONS[SONAR_ID];
    const walls = [
      { shape: 'rect', x: 100, y: 100, width: 2, height: 200, blocksProjectiles: true },
      { shape: 'rect', x: 200, y: 100, width: 2, height: 200, blocksProjectiles: true },
    ];
    const trajectory = calculateGadgetTrajectory(
      { x: 150, y: 100 },
      { x: 1_000, y: 100 },
      walls,
      {
        maximumRange: SONAR_PROJECTILE_RANGE,
        collisionRadius: definition.throwCollisionRadius,
        maximumBounces: Infinity,
        includeBounceEpsilon: true,
      },
    );
    assert.ok(trajectory.bounces > DEFAULT_GADGET_MAX_BOUNCES);
    const owner = { id: 'sonar-owner', team: 'red', alive: true, health: 100 };
    const projectile = createHostSonarProjectile({
      id: 'sonar-projectile',
      definition,
      player: owner,
      trajectory,
      now: 1_000,
    });

    assert.equal(projectile.listeningRadius, SONAR_LISTENING_RADIUS);
    assert.equal(projectile.speed, SONAR_PROJECTILE_SPEED);
    assert.ok(Math.abs(projectile.pathLength - SONAR_PROJECTILE_RANGE) < 1e-6);
    assert.equal(advanceHostSonarProjectiles([projectile], [owner], 1_000, 2_000).size, 0);
    assert.equal(projectile.travelledDistance, SONAR_PROJECTILE_SPEED);
    owner.alive = false;
    assert.deepEqual(
      [...advanceHostSonarProjectiles([projectile], [owner], 16, 2_016)],
      [projectile.id],
    );
  });

  it('listens for enemy footsteps and gunfire only while its owner is alive', () => {
    const owner = { id: 'sonar-owner', team: 'red', alive: true, health: 100, x: 2_000, y: 500 };
    const enemy = {
      id: 'enemy', team: 'blue', alive: true, health: 100, x: 600, y: 500,
      vx: 500, vy: 0, selectedWeaponId: 'assault-rifle',
    };
    const sonar = {
      id: 'sonar-projectile', type: 'sonar-projectile', ownerId: owner.id,
      team: owner.team, x: 500, y: 500, listeningRadius: SONAR_LISTENING_RADIUS,
      expiresAt: 5_000,
    };
    const players = [owner, enemy];

    assert.equal(findSonarListener(players, enemy, enemy.team, [sonar], 1_000).ownerId, owner.id);
    const cues = collectFootstepAudioCues({
      startedAt: 1,
      players,
      gadgetEffects: [sonar],
      map: { objects: [] },
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });
    const sonarCue = cues.find((cue) => cue.sonarId === sonar.id);
    assert.equal(sonarCue.team, owner.team);
    assert.equal(sonarCue.heardById, owner.id);

    owner.alive = false;
    assert.equal(findSonarListener(players, enemy, enemy.team, [sonar], 1_000), null);
    assert.equal(collectFootstepAudioCues({
      startedAt: 1,
      players,
      gadgetEffects: [sonar],
      map: { objects: [] },
    }, 2_000, { lastCueAt: new Map(), random: () => 0 }).length, 0);
  });

  it('exposes the projectile only in its owner team snapshot', () => {
    const manager = new RoomManager();
    const sonar = {
      id: 'sonar-projectile', type: 'sonar-projectile', ownerId: 'red-owner',
      team: 'red', x: 500, y: 500, path: [{ x: 400, y: 500 }, { x: 500, y: 500 }],
      expiresAt: 5_000,
    };
    const match = {
      startedAt: 1,
      players: [],
      gadgetEffects: [sonar],
      botNoises: [{
        id: 'sonar-audio', team: 'red', sonarId: sonar.id, heardById: sonar.ownerId,
      }],
    };

    const redSnapshot = manager.getMatchSnapshotForClient({ room: { match }, team: 'red' });
    const blueSnapshot = manager.getMatchSnapshotForClient({ room: { match }, team: 'blue' });
    const publicSnapshot = manager.getMatchSnapshotForClient({ room: { match }, team: null });
    assert.equal(redSnapshot.gadgetEffects.some((effect) => effect.id === sonar.id), true);
    assert.equal(blueSnapshot.gadgetEffects.some((effect) => effect.id === sonar.id), false);
    assert.equal(publicSnapshot.gadgetEffects.some((effect) => effect.id === sonar.id), false);
    assert.equal(redSnapshot.botNoises.some((cue) => cue.id === 'sonar-audio'), true);
    assert.equal(blueSnapshot.botNoises.some((cue) => cue.id === 'sonar-audio'), false);
    assert.equal(publicSnapshot.botNoises.some((cue) => cue.id === 'sonar-audio'), false);
  });
});
