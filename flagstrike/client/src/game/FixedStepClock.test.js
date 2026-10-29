import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { consumeFixedSteps, SIMULATION_STEP_MS } from './FixedStepClock.js';

describe('fixed-step clock', () => {
  it('produces the same simulation steps across render rates', () => {
    const run = (frameMs, frames) => {
      let accumulatorMs = 0;
      let steps = 0;
      for (let frame = 0; frame < frames; frame += 1) {
        const result = consumeFixedSteps(accumulatorMs, frameMs);
        steps += result.steps;
        accumulatorMs = result.accumulatorMs;
      }
      return { steps, accumulatorMs };
    };

    const at30Fps = run(1000 / 30, 30);
    const at60Fps = run(1000 / 60, 60);
    const at144Fps = run(1000 / 144, 144);
    assert.equal(at30Fps.steps, 60);
    assert.equal(at60Fps.steps, 60);
    assert.equal(at144Fps.steps, 60);
    assert.ok(Math.abs(at30Fps.accumulatorMs) < 1e-7);
    assert.ok(Math.abs(at60Fps.accumulatorMs) < 1e-7);
    assert.ok(Math.abs(at144Fps.accumulatorMs) < 1e-7);
  });

  it('preserves unprocessed time when catch-up work is bounded', () => {
    const result = consumeFixedSteps(0, 500, SIMULATION_STEP_MS, 8);
    assert.equal(result.steps, 8);
    assert.ok(Math.abs(result.accumulatorMs - (500 - 8 * SIMULATION_STEP_MS)) < 1e-7);
  });

  it('rejects invalid clock parameters instead of silently changing game time', () => {
    assert.throws(() => consumeFixedSteps(0, 16, 0), RangeError);
    assert.throws(() => consumeFixedSteps(-1, 16), RangeError);
  });
});
