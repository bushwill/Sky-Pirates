import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHostFrame, createHostFrame } from '../../../shared/HostFrameSnapshot.js';
import { selectSnapshotPosition } from '../../../shared/MovementModel.js';
import { validateOwnerMovementUpdate } from '../../../shared/OwnerMovementProtocol.js';
import { applyOwnerMovementUpdate } from './OwnerMovementSync.js';

const bounds = { width: 1_000, height: 800 };
const input = {
  up: false, down: false, left: false, right: true, drop: false,
  weaponLean: 0, speedScale: 1, visionAngle: 0.3, aimAngle: 0.2,
};

describe('owner position synchronization', () => {
  it('carries an accepted owner pose through a host frame to remote clients', () => {
    const owner = {
      id: 'owner', name: 'Owner', team: 'red', isBot: false,
      alive: true, health: 100, x: 100, y: 100, vx: 0, vy: 0,
      lastInputSequence: 1,
      selectedWeaponId: 'assault-rifle',
      weaponStats: { 'assault-rifle': { ammo: 30, aimAngle: 0 } },
    };
    const bot = {
      id: 'bot', name: 'Bot', team: 'blue', isBot: true,
      alive: true, health: 100, x: 400, y: 300, vx: 0, vy: 0,
      selectedWeaponId: 'assault-rifle',
      weaponStats: { 'assault-rifle': { ammo: 30 } },
    };
    const host = {
      id: 'host', name: 'Host', team: 'blue', isBot: false,
      alive: true, health: 100, x: 700, y: 500, vx: 12, vy: 4,
      selectedWeaponId: 'assault-rifle',
      weaponStats: { 'assault-rifle': { ammo: 30 } },
    };
    const update = {
      sequence: 2,
      input,
      playerPose: { id: owner.id, x: 145, y: 100, vx: 45, vy: 0 },
    };

    assert.equal(applyOwnerMovementUpdate(owner, update, bounds), true);
    assert.deepEqual([owner.x, owner.y, owner.vx, owner.vy, owner.lastInputSequence],
      [145, 100, 45, 0, 2]);
    assert.equal(owner.visionAngle, input.visionAngle);
    assert.equal(owner.weaponLean, input.weaponLean);
    assert.equal(owner.weaponStats['assault-rifle'].aimAngle, input.aimAngle);

    const match = {
      startedAt: 10,
      gameplayStartsAt: 10,
      endsAt: 100_000,
      updatedAt: 1_000,
      map: { ...bounds, objects: [] },
      players: [owner, bot, host],
      flag: { x: 500, y: 400, heldBy: null, dropped: false, lastDroppedBy: null },
      smokes: [],
      gadgetEffects: [],
      victory: null,
      postGame: null,
      quickPlayState: null,
    };
    const frame = createHostFrame({
      match,
      authorityEpoch: 1,
      revision: 1,
      simulationTimeMs: 50,
    });
    const remoteMatch = applyHostFrame(frame, {
      ...match,
      players: match.players.map((player) => ({ ...player, x: 90, y: 90 })),
    });

    assert.deepEqual([remoteMatch.players[0].x, remoteMatch.players[0].y], [145, 100]);
    assert.deepEqual([remoteMatch.players[1].x, remoteMatch.players[1].y], [400, 300],
      'bot poses are replicated in the same host actor snapshot');
    assert.deepEqual(
      [remoteMatch.players.find((player) => player.id === host.id).x,
        remoteMatch.players.find((player) => player.id === host.id).y],
      [host.x, host.y],
      'the host actor pose is replicated to remote clients with other actors',
    );
    assert.equal(remoteMatch.players[0].weaponStats['assault-rifle'].aimAngle, input.aimAngle,
      'the owner aim angle is included with the host-authored actor state');
    assert.deepEqual(selectSnapshotPosition({ x: 90, y: 90 }, remoteMatch.players[0], true),
      { x: 90, y: 90 }, 'remote clients interpolate from their rendered pose toward the new host pose');
    assert.equal(remoteMatch.players[0].lastInputSequence, 2);
  });

  it('rejects stale owner states so delayed packets cannot roll positions backward', () => {
    const owner = { id: 'owner', alive: true, x: 200, y: 100, vx: 0, vy: 0, lastInputSequence: 8 };
    assert.equal(applyOwnerMovementUpdate(owner, {
      sequence: 7,
      input,
      playerPose: { id: 'owner', x: 150, y: 100, vx: 20, vy: 0 },
    }, bounds), false);
    assert.deepEqual([owner.x, owner.y, owner.lastInputSequence], [200, 100, 8]);
  });

  it('does not apply invalid poses to the host actor', () => {
    const owner = { id: 'owner', alive: true, x: 200, y: 100, vx: 0, vy: 0, lastInputSequence: 1 };
    assert.equal(applyOwnerMovementUpdate(owner, {
      sequence: 2,
      input,
      playerPose: { id: 'owner', x: 1_001, y: 100, vx: 20, vy: 0 },
    }, bounds), false);
    assert.deepEqual([owner.x, owner.y, owner.lastInputSequence], [200, 100, 1]);
  });

  it('validates owner movement on the host client rather than the relay server', () => {
    const valid = {
      sequence: 4,
      input,
      playerPose: { id: 'owner', x: 150, y: 100, vx: 40, vy: 0 },
    };
    assert.deepEqual(validateOwnerMovementUpdate(valid, {
      playerId: 'owner', mapWidth: bounds.width, mapHeight: bounds.height,
    }), { valid: true });
    assert.equal(validateOwnerMovementUpdate({
      ...valid,
      playerPose: { ...valid.playerPose, id: 'someone-else' },
    }, {
      playerId: 'owner', mapWidth: bounds.width, mapHeight: bounds.height,
    }).valid, false);
    assert.equal(validateOwnerMovementUpdate({
      ...valid,
      input: { ...input, aimAngle: undefined },
    }, {
      playerId: 'owner', mapWidth: bounds.width, mapHeight: bounds.height,
    }).valid, false, 'owner state includes validated aim as well as movement');
  });

  it('accepts owner-computed poses for a controlled bot using the same state contract', () => {
    const bot = {
      id: 'bot', isBot: true, controlledById: 'owner', alive: true,
      x: 400, y: 300, vx: 0, vy: 0, lastInputSequence: 3,
      selectedWeaponId: 'assault-rifle',
    };
    assert.equal(applyOwnerMovementUpdate(bot, {
      sequence: 4,
      input,
      playerPose: { id: bot.id, x: 420, y: 300, vx: 40, vy: 0 },
    }, bounds), true);
    assert.deepEqual([bot.x, bot.y, bot.lastInputSequence], [420, 300, 4]);
    assert.equal(bot.weaponStats['assault-rifle'].aimAngle, input.aimAngle);
  });

  it('preserves the locally predicted pose when the host receives its own bot command', () => {
    const bot = {
      id: 'bot', isBot: true, controlledById: 'host', alive: true,
      x: 420, y: 300, vx: 40, vy: 0, lastInputSequence: 3,
      selectedWeaponId: 'assault-rifle',
    };
    assert.equal(applyOwnerMovementUpdate(bot, {
      sequence: 4,
      input,
      playerPose: { id: bot.id, x: 410, y: 300, vx: 32, vy: 0 },
    }, bounds, { preservePose: true }), true);
    assert.deepEqual([bot.x, bot.y, bot.vx, bot.vy], [420, 300, 40, 0]);
    assert.equal(bot.lastInputSequence, 4);
    assert.equal(bot.visionAngle, input.visionAngle);
  });
});
