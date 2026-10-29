import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectOwnerControlledPose } from './MovementPrediction.js';

describe('owner-controlled movement pose', () => {
  it('keeps the locally simulated pose when host snapshots disagree', () => {
    assert.deepEqual(selectOwnerControlledPose(
      { x: 410, y: 280, vx: 80, vy: -12 },
      { x: 404, y: 284, vx: 0, vy: 0 },
    ), { x: 410, y: 280, vx: 80, vy: -12 });
    assert.deepEqual(selectOwnerControlledPose(
      { x: 410, y: 280, vx: 80, vy: -12 },
      { x: 404, y: 284, vx: 0, vy: 0 },
      false,
    ), { x: 410, y: 280, vx: 80, vy: -12 }, 'snapshot timing flags cannot snap the owner pose');
  });

  it('initializes or hands off control from the current authoritative pose', () => {
    assert.deepEqual(selectOwnerControlledPose(
      { x: 410, y: 280, vx: 80, vy: -12 },
      { x: 404, y: 284, vx: 0, vy: 0 },
      true,
    ), { x: 404, y: 284, vx: 0, vy: 0 });
    assert.deepEqual(selectOwnerControlledPose(null, { x: 404, y: 284 }),
      { x: 404, y: 284, vx: 0, vy: 0 });
  });

  it('recovers from an unpositioned player manifest when the first host frame arrives', () => {
    assert.deepEqual(selectOwnerControlledPose(
      { x: undefined, y: undefined, vx: 0, vy: 0 },
      { x: 404, y: 284, vx: 0, vy: 0 },
    ), { x: 404, y: 284, vx: 0, vy: 0 });
  });
});
