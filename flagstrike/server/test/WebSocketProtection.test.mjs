import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAllowedOriginSet,
  getClientIp,
  IpRateLimiter,
  isAllowedWebSocketOrigin,
} from '../WebSocketProtection.mjs';

describe('WebSocket protection', () => {
  it('allows only explicitly configured origins', () => {
    const allowedOrigins = createAllowedOriginSet('https://game.example, https://www.game.example');
    assert.equal(isAllowedWebSocketOrigin('https://game.example', allowedOrigins), true);
    assert.equal(isAllowedWebSocketOrigin('https://game.example.attacker.test', allowedOrigins), false);
    assert.equal(isAllowedWebSocketOrigin('null', allowedOrigins), false);
    assert.equal(isAllowedWebSocketOrigin(undefined, allowedOrigins), false);
  });

  it('uses the production allowlist by default and rejects malformed configuration', () => {
    const allowedOrigins = createAllowedOriginSet(undefined, true);
    assert.equal(isAllowedWebSocketOrigin('https://bushwill.ca', allowedOrigins), true);
    assert.equal(isAllowedWebSocketOrigin('http://localhost:5173', allowedOrigins), false);
    assert.throws(() => createAllowedOriginSet('https://game.example/path'), /Invalid WebSocket origin/);
    assert.throws(() => createAllowedOriginSet(''), /at least one origin/);
  });

  it('uses a validated proxy client IP and falls back to the socket address', () => {
    assert.equal(getClientIp({
      headers: { 'x-real-ip': '203.0.113.8' },
      socket: { remoteAddress: '::ffff:172.18.0.2' },
    }), '203.0.113.8');
    assert.equal(getClientIp({
      headers: { 'x-real-ip': 'not-an-ip' },
      socket: { remoteAddress: '::ffff:172.18.0.2' },
    }), '172.18.0.2');
  });

  it('enforces a bounded per-IP window and expires old buckets', () => {
    const limiter = new IpRateLimiter(2, 1_000);
    assert.equal(limiter.consume('203.0.113.1', 0), true);
    assert.equal(limiter.consume('203.0.113.1', 1), true);
    assert.equal(limiter.consume('203.0.113.1', 2), false);
    assert.equal(limiter.consume('203.0.113.1', 1_000), true);
    limiter.pruneExpired(2_000);
    assert.equal(limiter.buckets.size, 0);
  });

  it('fails closed when the rate-limit key table is full', () => {
    const limiter = new IpRateLimiter(2, 1_000, 1);
    assert.equal(limiter.consume('203.0.113.1', 0), true);
    assert.equal(limiter.consume('203.0.113.2', 1), false);
    assert.equal(limiter.consume('203.0.113.2', 1_000), true);
  });
});
