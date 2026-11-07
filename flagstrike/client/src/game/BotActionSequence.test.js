import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getNextBotActionSequence } from './BotActionSequence.js';

describe('controlled bot action sequence', () => {
  it('advances past the bot acknowledgement when the local counter is stale', () => {
    assert.equal(getNextBotActionSequence(15, 16), 17);
  });

  it('advances past either counter and treats invalid counters as zero', () => {
    assert.equal(getNextBotActionSequence(20, 16), 21);
    assert.equal(getNextBotActionSequence(0, 0), 1);
    assert.equal(getNextBotActionSequence(-1, Number.NaN), 1);
  });
});
