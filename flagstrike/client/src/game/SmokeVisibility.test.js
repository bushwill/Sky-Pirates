import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSmokeVisibleSamples } from './SmokeVisibility.js';

describe('smoke visibility discovery', () => {
  it('reveals the complete smoke boundary when a teammate observer is inside it', () => {
    const smoke = { x: 100, y: 100, radius: 60 };
    const visions = [{ origin: { x: 140, y: 100 } }];
    const samples = getSmokeVisibleSamples(smoke, visions, 32, () => false);
    assert.equal(samples.length, 32);
    assert.ok(samples.every(Boolean));
  });

  it('reveals the complete smoke boundary to its thrower', () => {
    const smoke = { x: 100, y: 100, radius: 60 };
    const samples = getSmokeVisibleSamples(smoke, [], 32, () => false, true);
    assert.equal(samples.length, 32);
    assert.ok(samples.every(Boolean));
  });

  it('reveals only boundary samples visible from outside the smoke', () => {
    const smoke = { x: 100, y: 100, radius: 60 };
    const visions = [{ origin: { x: 0, y: 100 } }];
    const samples = getSmokeVisibleSamples(smoke, visions, 4, (point) => point.x < 90);
    assert.deepEqual(samples, [false, false, true, false]);
  });
});
