import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { ASSAULT_RIFLE_MOVEMENT_SCALE, FLAG_CARRIER_MOVEMENT_SCALE, getDesiredVelocity, getPlayerMovementScale, interpolatePosition, MAX_PLAYER_SPEED, movePosition, movePositionWithCatchUp, PLAYER_RADIUS, selectSnapshotPosition, shouldHostSimulateActor, PLAYER_TURN_ACCELERATION, SLOW_WALK_SPEED_SCALE } from './MovementModel.js';

const idle = { up: false, down: false, left: false, right: false };

describe('movement model', () => {
  it('allows host movement simulation only for unowned bots', () => {
    assert.equal(shouldHostSimulateActor({
      id: 'host', isBot: false, alive: true, health: 100,
    }, 'host'), false);
    assert.equal(shouldHostSimulateActor({
      id: 'remote', isBot: false, alive: true, health: 100,
    }, 'host'), false);
    assert.equal(shouldHostSimulateActor({
      id: 'controlled-bot', isBot: true, controlledById: 'owner', alive: true, health: 100,
    }, 'host'), false);
    assert.equal(shouldHostSimulateActor({
      id: 'unowned-bot', isBot: true, controlledById: null, alive: true, health: 100,
    }, 'host'), true);
  });

  it('uses the reduced global maximum movement speed', () => {
    assert.equal(MAX_PLAYER_SPEED, 80);
  });

  it('uses weapon-specific movement speeds and 70% while carrying the flag', () => {
    assert.equal(ASSAULT_RIFLE_MOVEMENT_SCALE, DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale);
    assert.equal(getPlayerMovementScale(), DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.movementScale);
    for (const weapon of Object.values(DEFAULT_PROJECTILE_DEFINITIONS)) {
      assert.equal(getPlayerMovementScale(false, weapon.movementScale), weapon.movementScale,
        `${weapon.id} uses its configured movement scale`);
    }
    assert.equal(getPlayerMovementScale(true), FLAG_CARRIER_MOVEMENT_SCALE);
    assert.equal(getPlayerMovementScale(true, 0.95), FLAG_CARRIER_MOVEMENT_SCALE, 'flag carrying overrides weapon movement');

    const rifleStep = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      [],
      getPlayerMovementScale(),
    );
    assert.equal(rifleStep.vx, 250 * ASSAULT_RIFLE_MOVEMENT_SCALE * 0.05);
  });

    it('applies an additive lightweight movement bonus only when not carrying the flag', () => {
      assert.ok(Math.abs(getPlayerMovementScale(false, 0.9, 0.05) - 0.95) < 1e-9);
      assert.ok(Math.abs(getPlayerMovementScale(false, 1, 0.1) - 1.1) < 1e-9);
      assert.equal(getPlayerMovementScale(true, 1, 0.1), FLAG_CARRIER_MOVEMENT_SCALE);
    });

  it('accelerates into movement and normalizes diagonal acceleration', () => {
    let player = { x: 400, y: 400, vx: 0, vy: 0 };
    for (let frame = 0; frame < 10; frame += 1) {
      player = movePosition(player, { ...idle, right: true }, 1 / 60, 1000);
    }
    assert.ok(player.vx > 0);
    assert.equal(player.vy, 0);
    assert.ok(player.x > 400);

    const diagonal = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      { up: true, right: true, down: false, left: false },
      1 / 60,
      1000,
    );
    assert.ok(Math.abs(diagonal.vx - Math.abs(diagonal.vy)) < 1e-9);
  });

  it('catches up through a short frame stall using bounded physics substeps', () => {
    const start = { x: 400, y: 400, vx: 0, vy: 0 };
    const direction = { ...idle, right: true };
    const firstStep = movePosition(start, direction, 0.05, 1000);
    const expected = movePosition(firstStep, direction, 0.05, 1000);
    const caughtUp = movePositionWithCatchUp(start, direction, 0.1, 1000);

    assert.deepEqual(caughtUp, expected);
    assert.ok(caughtUp.x > firstStep.x, 'elapsed movement beyond the first 50 ms step is not discarded');
  });

  it('damps sideways momentum faster during sharp turns', () => {
    let player = { x: 500, y: 500, vx: 90, vy: 0 };
    const turnUp = { up: true, down: false, left: false, right: false };
    for (let frame = 0; frame < 6; frame += 1) {
      player = movePosition(player, turnUp, 1 / 60, 1000);
    }

    assert.ok(player.vx < 65, 'turning should shed most of the previous sideways velocity');
    assert.ok(player.vy < 0, 'the player should start moving in the new direction');
    assert.equal(PLAYER_TURN_ACCELERATION, 500);
  });

  it('uses the same top speed in every cardinal and diagonal direction', () => {
    const directions = [
      { ...idle, up: true },
      { ...idle, down: true },
      { ...idle, left: true },
      { ...idle, right: true },
      { up: true, down: false, left: true, right: false },
      { up: true, down: false, left: false, right: true },
      { up: false, down: true, left: true, right: false },
      { up: false, down: true, left: false, right: true },
    ];

    for (const direction of directions) {
      const velocity = getDesiredVelocity(direction);
      assert.ok(Math.abs(Math.hypot(velocity.x, velocity.y) - MAX_PLAYER_SPEED) < 1e-9);
    }

    const upRight = getDesiredVelocity({ up: true, down: false, left: false, right: true });
    assert.ok(upRight.x > 0 && upRight.y < 0);
    assert.ok(Math.abs(upRight.x - Math.abs(upRight.y)) < 1e-9);
  });

  it('scales both acceleration and maximum speed for a flag carrier', () => {
    const direction = { ...idle, right: true };
    const firstStep = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      direction,
      0.05,
      1000,
      1000,
      [],
      FLAG_CARRIER_MOVEMENT_SCALE,
    );
    assert.equal(firstStep.vx, 250 * FLAG_CARRIER_MOVEMENT_SCALE * 0.05);

    let carrier = { x: 400, y: 400, vx: 0, vy: 0 };
    for (let frame = 0; frame < 20; frame += 1) {
      carrier = movePosition(carrier, direction, 0.05, 1000, 1000, [], FLAG_CARRIER_MOVEMENT_SCALE);
    }
    assert.ok(Math.abs(Math.hypot(carrier.vx, carrier.vy) - MAX_PLAYER_SPEED * FLAG_CARRIER_MOVEMENT_SCALE) < 1e-9);
  });

  it('applies the bot behavior speed scale without exceeding weapon or carrier limits', () => {
    const direction = { ...idle, right: true };
    const fastBotStep = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      { ...direction, speedScale: 1 },
      0.05, 1000, 1000, [], ASSAULT_RIFLE_MOVEMENT_SCALE,
    );
    const cautiousBotStep = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      { ...direction, speedScale: 0.6 },
      0.05, 1000, 1000, [], ASSAULT_RIFLE_MOVEMENT_SCALE,
    );
    assert.ok(fastBotStep.vx > cautiousBotStep.vx);

    const carrierStep = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 },
      { ...direction, speedScale: 1 },
      0.05, 1000, 1000, [], FLAG_CARRIER_MOVEMENT_SCALE,
    );
    assert.ok(carrierStep.vx < fastBotStep.vx, 'carrying the objective retains its existing speed penalty');
  });

  it('allows the Bio Field friendly speed boost above the normal movement cap', () => {
    const direction = { ...idle, right: true };
    const ordinary = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 }, direction, 0.05, 1000, 1000, [], 0.9,
    );
    const boosted = movePosition(
      { x: 400, y: 400, vx: 0, vy: 0 }, direction, 0.05, 1000, 1000, [], 0.9 * 1.3, 0.9 * 1.3,
    );
    assert.ok(Math.abs(boosted.vx / ordinary.vx - 1.3) < 1e-9);
  });

  it('applies slow-walk on top of the selected weapon and flag-carrier modifiers', () => {
    const direction = { ...idle, right: true, speedScale: SLOW_WALK_SPEED_SCALE };
    for (const [movementScale, expected] of [
      [ASSAULT_RIFLE_MOVEMENT_SCALE, MAX_PLAYER_SPEED * 0.9 * 0.6],
      [FLAG_CARRIER_MOVEMENT_SCALE, MAX_PLAYER_SPEED * 0.7 * 0.6],
    ]) {
      let player = { x: 400, y: 400, vx: 0, vy: 0 };
      for (let frame = 0; frame < 40; frame += 1) {
        player = movePosition(player, direction, 0.05, 1000, 1000, [], movementScale);
      }
      assert.ok(Math.abs(player.vx - expected) < 1e-9);
    }
  });

  it('clamps players inside the square map', () => {
    const atWall = movePosition({ x: PLAYER_RADIUS, y: 50, vx: -100, vy: 0 }, { ...idle, left: true }, 1 / 60, 100);
    assert.equal(atWall.x, PLAYER_RADIUS);
    assert.equal(atWall.vx, 0);
  });

  it('clamps players to independent rectangular map dimensions', () => {
    const atBottom = movePosition(
      { x: 500, y: 990, vx: 0, vy: 200 },
      { ...idle, down: true },
      1 / 60,
      1500,
      1000,
    );
    assert.equal(atBottom.y, 1000 - PLAYER_RADIUS);
    assert.equal(atBottom.vy, 0);

    const atRight = movePosition(
      { x: 1490, y: 700, vx: 200, vy: 0 },
      { ...idle, right: true },
      1 / 60,
      1500,
      1000,
    );
    assert.equal(atRight.x, 1500 - PLAYER_RADIUS);
    assert.equal(atRight.vx, 0);
  });

  it('stops at a wall instead of tunneling through it', () => {
    const wall = [{ shape: 'segment', x1: 500, y1: 400, x2: 500, y2: 600 }];
    const player = movePosition(
      { x: 488, y: 500, vx: 100, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      wall,
    );

    assert.ok(player.x <= 500 - PLAYER_RADIUS + 1e-7);
    assert.equal(player.vx, 0);
  });

  it('preserves wall collision with large maps using indexed movement candidates', () => {
    const wall = { shape: 'segment', x1: 500, y1: 400, x2: 500, y2: 600 };
    const objects = [wall, ...Array.from({ length: 80 }, (_, index) => ({
      shape: 'circle', x: 1_500 + index * 140, y: 1_500, radius: 12,
    }))];
    const indexed = movePosition(
      { x: 488, y: 500, vx: 100, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      objects,
    );
    const reference = movePosition(
      { x: 488, y: 500, vx: 100, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      [wall],
    );

    assert.deepEqual(indexed, reference);
  });

  it('allows movement along a wall after contact', () => {
    const wall = [{ shape: 'segment', x1: 500, y1: 400, x2: 500, y2: 600 }];
    const player = movePosition(
      { x: 500 - PLAYER_RADIUS, y: 500, vx: 0, vy: MAX_PLAYER_SPEED },
      { ...idle, down: true },
      0.05,
      1000,
      1000,
      wall,
    );

    assert.ok(Math.abs(player.x - (500 - PLAYER_RADIUS)) < 1e-7);
    assert.ok(player.y > 500);
    assert.equal(player.vy, MAX_PLAYER_SPEED);
  });

  it('collides with rectangular and circular cover objects', () => {
    const rectangularCover = [{ shape: 'rect', x: 500, y: 500, width: 40, height: 100 }];
    const nearRectangle = movePosition(
      { x: 470, y: 500, vx: 100, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      rectangularCover,
    );
    assert.ok(nearRectangle.x <= 500 - 20 - PLAYER_RADIUS + 1e-7);
    assert.equal(nearRectangle.vx, 0);

    const circularCover = [{ shape: 'circle', x: 500, y: 500, radius: 15 }];
    const nearCircle = movePosition(
      { x: 475, y: 500, vx: MAX_PLAYER_SPEED, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      circularCover,
    );
    assert.ok(nearCircle.x <= 500 - 15 - PLAYER_RADIUS + 1e-7);
    assert.equal(nearCircle.vx, 0);
  });

  it('ignores map objects that do not block movement', () => {
    const sensor = [{ shape: 'circle', x: 500, y: 500, radius: 30, blocksMovement: false }];
    const player = movePosition(
      { x: 475, y: 500, vx: 100, vy: 0 },
      { ...idle, right: true },
      0.05,
      1000,
      1000,
      sensor,
    );

    assert.ok(player.x > 475);
    assert.equal(player.vx, MAX_PLAYER_SPEED);
  });

  it('brakes quickly but not instantly when movement keys are released', () => {
    let player = { x: 400, y: 400, vx: MAX_PLAYER_SPEED, vy: 0 };
    player = movePosition(player, idle, 1 / 60, 1000);
    assert.ok(player.vx > 0, 'momentum should persist briefly after release');

    for (let frame = 1; frame < 10 && player.vx !== 0; frame += 1) {
      player = movePosition(player, idle, 1 / 60, 1000);
    }
    assert.equal(player.vx, 0, 'player should settle within about 80 ms');
    const stopped = movePosition(player, idle, 1 / 60, 1000);
    assert.equal(stopped.x, player.x);
    assert.equal(stopped.y, player.y);
  });

  it('limits top speed and preserves the local predicted position between snapshots', () => {
    let player = { x: 400, y: 400, vx: 0, vy: 0 };
    for (let frame = 0; frame < 200; frame += 1) {
      player = movePosition(player, { ...idle, right: true }, 1 / 60, 1000);
    }
    assert.ok(Math.hypot(player.vx, player.vy) <= MAX_PLAYER_SPEED + 1e-9);

    const predicted = { x: 481.5, y: 620.25 };
    const hostSnapshot = { x: 459, y: 620.25 };

    assert.deepEqual(selectSnapshotPosition(predicted, hostSnapshot, true), predicted);
    assert.deepEqual(selectSnapshotPosition(predicted, hostSnapshot, false), hostSnapshot);
    assert.deepEqual(selectSnapshotPosition(null, hostSnapshot, true), hostSnapshot);
    assert.deepEqual(selectSnapshotPosition({ x: undefined, y: undefined }, hostSnapshot, true), hostSnapshot,
      'an invalid prior pose must not hide the first authoritative remote pose');

    const remoteBeforeReconnect = { x: 700, y: 350 };
    const remoteSnapshot = { x: 520, y: 810 };
    assert.deepEqual(selectSnapshotPosition(remoteBeforeReconnect, remoteSnapshot, true), remoteBeforeReconnect);
    assert.deepEqual(selectSnapshotPosition(remoteBeforeReconnect, remoteSnapshot, false), remoteSnapshot);
  });

  it('interpolates remote players smoothly toward host snapshots', () => {
    const next = interpolatePosition({ x: 0, y: 0 }, { x: 100, y: 50 }, 16);

    assert.ok(next.x > 0 && next.x < 100);
    assert.ok(next.y > 0 && next.y < 50);
  });
});
