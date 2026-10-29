import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOST_FRAME_PROTOCOL_VERSION,
  MAX_HOST_FRAME_BYTES,
  validateHostFrame,
} from '../../shared/HostFrameProtocol.js';

function createFrame(overrides = {}) {
  return {
    protocolVersion: HOST_FRAME_PROTOCOL_VERSION,
    matchId: 1234,
    authorityEpoch: 2,
    revision: 7,
    tick: 7,
    simulationTimeMs: 116.7,
    actors: [{ id: 'player-1', state: { x: 10, y: 20, health: 100 } }],
    objectives: [{ id: 'flag', state: { carrierId: null, x: 50, y: 60 } }],
    events: [{ id: 'event-7-1', type: 'shot-fired', data: { actorId: 'player-1' } }],
    acknowledgements: [{ id: 'player-1', inputSequence: 4, actionSequence: 2 }],
    ...overrides,
  };
}

describe('host frame protocol', () => {
  it('accepts complete versioned state, events, and action acknowledgements', () => {
    assert.equal(validateHostFrame(createFrame()).valid, true);
  });

  it('rejects invalid metadata, duplicate identities, and malformed acknowledgements', () => {
    assert.equal(validateHostFrame(createFrame({ authorityEpoch: 0 })).valid, false);
    assert.equal(validateHostFrame(createFrame({
      actors: [{ id: 'same', state: {} }, { id: 'same', state: {} }],
    })).valid, false);
    assert.equal(validateHostFrame(createFrame({
      actors: [{ id: 'player-1', state: { y: 20 } }],
    })).valid, false, 'actor snapshots must contain a usable position');
    assert.equal(validateHostFrame(createFrame({
      acknowledgements: [{ id: 'player-1', inputSequence: -1, actionSequence: 0 }],
    })).valid, false);
  });

  it('enforces a serialized frame byte limit', () => {
    const validation = validateHostFrame(createFrame({ actors: [{ id: 'large', state: { data: 'x'.repeat(MAX_HOST_FRAME_BYTES) } }] }));
    assert.equal(validation.valid, false);
    assert.match(validation.reason, /maximum frame size/);
  });
});
