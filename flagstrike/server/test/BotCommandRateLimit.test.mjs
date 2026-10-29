import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldThrottleBotCommand } from '../BotCommandRateLimit.mjs';

describe('bot command input rate limit', () => {
  it('throttles frequent movement-only packets', () => {
    assert.equal(shouldThrottleBotCommand([{ fire: false, reload: false }], 115, 100), true);
    assert.equal(shouldThrottleBotCommand([{ fire: false, reload: false }], 120, 100), false);
  });

  it('never drops an edge-triggered fire or reload action inside the movement interval', () => {
    assert.equal(shouldThrottleBotCommand([{ fire: true, reload: false }], 105, 100), false);
    assert.equal(shouldThrottleBotCommand([{ fire: false, reload: true }], 105, 100), false);
  });
});
