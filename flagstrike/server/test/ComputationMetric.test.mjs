import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_FRAME_INTERVAL_MS,
  getAdaptiveUpdateProfile,
  getComputationLevel,
  getTeammateVisionInterval,
  smoothComputationTime,
} from '../../shared/ComputationMetric.js';

describe('ComputationMetric', () => {
  it('classifies client update cost into low, medium, and high levels', () => {
    assert.equal(getComputationLevel(2.8), 'LOW');
    assert.equal(getComputationLevel(4), 'MEDIUM');
    assert.equal(getComputationLevel(9.99), 'MEDIUM');
    assert.equal(getComputationLevel(10), 'HIGH');
  });

  it('smooths frame measurements to avoid a flickering load indicator', () => {
    assert.equal(smoothComputationTime(undefined, 5), 5);
    assert.equal(smoothComputationTime(5, 10, 0.1), 5.5);
    assert.equal(smoothComputationTime(5, Number.NaN), 5);
  });

  it('increases teammate vision intervals by distance and client computation load', () => {
    assert.deepEqual([
      getTeammateVisionInterval('LOW', 0),
      getTeammateVisionInterval('LOW', 3),
      getTeammateVisionInterval('MEDIUM', 0),
      getTeammateVisionInterval('MEDIUM', 3),
      getTeammateVisionInterval('HIGH', 0),
      getTeammateVisionInterval('HIGH', 3),
    ], [50, 125, 100, 325, 200, 800]);
    assert.equal(getTeammateVisionInterval('HIGH', 8), 1_000);
    assert.throws(() => getTeammateVisionInterval('LOW', -1), RangeError);
    assert.throws(() => getTeammateVisionInterval('UNKNOWN', 0), RangeError);
  });

  it('caps lower-priority work and lengthens its intervals under higher load', () => {
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').frameOverlayIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').frameOverlayIntervalMs,
      getAdaptiveUpdateProfile('HIGH').frameOverlayIntervalMs,
    ], [1000 / 60, 1000 / 40, 1000 / 30]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').inventoryIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').inventoryIntervalMs,
      getAdaptiveUpdateProfile('HIGH').inventoryIntervalMs,
    ], [50, 50, 100]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').matchHudIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').matchHudIntervalMs,
      getAdaptiveUpdateProfile('HIGH').matchHudIntervalMs,
    ], [50, 100, 200]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').maxTeammateVisionUpdatesPerFrame,
      getAdaptiveUpdateProfile('MEDIUM').maxTeammateVisionUpdatesPerFrame,
      getAdaptiveUpdateProfile('HIGH').maxTeammateVisionUpdatesPerFrame,
    ], [1, 1, 1]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').controlledVisionIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').controlledVisionIntervalMs,
      getAdaptiveUpdateProfile('HIGH').controlledVisionIntervalMs,
    ], [1000 / 60, 25, 1000 / 30]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').smokeVisibilityIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').smokeVisibilityIntervalMs,
      getAdaptiveUpdateProfile('HIGH').smokeVisibilityIntervalMs,
    ], [1000 / 60, 1000 / 30, 50]);
    assert.deepEqual([
      getAdaptiveUpdateProfile('LOW').visiblePropIntervalMs,
      getAdaptiveUpdateProfile('MEDIUM').visiblePropIntervalMs,
      getAdaptiveUpdateProfile('HIGH').visiblePropIntervalMs,
    ], [100, 150, 250]);
  });

  it('publishes host frames at a fixed 20 Hz interval', () => {
    assert.equal(HOST_FRAME_INTERVAL_MS, 50);
  });
});
