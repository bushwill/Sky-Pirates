import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CompetitiveMapStore } from '../CompetitiveMapStore.mjs';

describe('CompetitiveMapStore', () => {
  it('persists map seeds and room counts across store instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flagstrike-map-store-'));
    const filePath = join(directory, 'catalog.json');

    try {
      const firstStore = new CompetitiveMapStore(filePath);
      await Promise.all([
        firstStore.record({ seed: 101, roomCount: 4 }),
        firstStore.record({ seed: 202, roomCount: 6 }),
        firstStore.record({ seed: 101, roomCount: 4 }),
      ]);

      const restartedStore = new CompetitiveMapStore(filePath);
      const maps = await restartedStore.list();
      assert.deepEqual(maps.map(({ seed, roomCount }) => ({ seed, roomCount })), [
        { seed: 101, roomCount: 4 },
        { seed: 202, roomCount: 6 },
      ]);
      assert.ok(maps.every((map) => Number.isFinite(Date.parse(map.recordedAt))));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects entries outside the competitive map range', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flagstrike-map-store-'));
    const store = new CompetitiveMapStore(join(directory, 'catalog.json'));

    try {
      await assert.rejects(store.record({ seed: 1, roomCount: 3 }), /room count/);
      await assert.rejects(store.record({ seed: 0, roomCount: 4 }), /seed/);
      assert.deepEqual(await store.list(), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});