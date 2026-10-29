import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDeathFeedbackStyle, getDeathFeedbackType } from './DeathFeedback.js';

describe('death feedback classification', () => {
  const attribution = { killerId: 'killer', assisterIds: ['assister'] };

  it('classifies the killer for red feedback', () => {
    assert.equal(getDeathFeedbackType(attribution, 'killer'), 'kill');
  });

  it('classifies credited damage contributors for yellow feedback', () => {
    assert.equal(getDeathFeedbackType(attribution, 'assister'), 'assist');
  });

  it('classifies uninvolved players and unattributed deaths for black feedback', () => {
    assert.equal(getDeathFeedbackType(attribution, 'uninvolved'), 'other');
    assert.equal(getDeathFeedbackType(null, 'uninvolved'), 'other');
  });

  it('increases kill X size, glow, and vibration as the match streak grows', () => {
    const firstKill = getDeathFeedbackStyle('kill', 1);
    const fourthKill = getDeathFeedbackStyle('kill', 4);
    assert.ok(fourthKill.radius > firstKill.radius);
    assert.ok(fourthKill.lineWidth > firstKill.lineWidth);
    assert.ok(fourthKill.glowAlpha > firstKill.glowAlpha);
    assert.ok(fourthKill.vibration > firstKill.vibration);
    assert.ok(fourthKill.vibrationCount > firstKill.vibrationCount);
  });

  it('keeps assist and uninvolved X effects at baseline without streak vibration', () => {
    assert.equal(getDeathFeedbackStyle('assist', 10).vibration, 0);
    assert.equal(getDeathFeedbackStyle('other', 10).vibration, 0);
  });
});