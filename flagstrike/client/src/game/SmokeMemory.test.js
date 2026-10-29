import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pruneSmokeMemory, rememberSmokeObservation } from './SmokeMemory.js';

describe('smoke object memory', () => {
  it('reveals the entire smoke after any part is seen and keeps its appearance remembered', () => {
    const memoryById = new Map();
    const smoke = { id: 'smoke-1', x: 10, y: 20, radius: 60, expiresAt: 15_000 };

    const firstObservation = rememberSmokeObservation(memoryById, smoke, [true, false, false, false], 1_000);
    assert.equal(firstObservation.status, 'visible');
    assert.equal(firstObservation.known, true, 'a single visible sector reveals the whole smoke object');
    assert.equal(firstObservation.lastSeenAt, 1_000);

    const remembered = rememberSmokeObservation(memoryById, smoke, [false, false, false, false], 1_500);
    assert.equal(remembered.status, 'remembered');
    assert.equal(remembered.known, true, 'the complete cloud stays known while active');
    assert.equal(remembered.lastSeenAt, 1_000, 'losing sight does not refresh the observation time');

    const refreshed = rememberSmokeObservation(memoryById, smoke, [false, true, false, false], 2_000);
    assert.equal(refreshed.status, 'visible');
    assert.equal(refreshed.lastSeenAt, 2_000);
    assert.equal(refreshed.known, true);
  });

  it('forgets a temporary smoke when the authoritative active-object list expires it', () => {
    const memoryById = new Map();
    const smoke = { id: 'smoke-expired', x: 0, y: 0, radius: 60, expiresAt: 1_000 };
    rememberSmokeObservation(memoryById, smoke, [true, true], 500);

    pruneSmokeMemory(memoryById, new Set());

    assert.equal(memoryById.has(smoke.id), false);
  });
});
