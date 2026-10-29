import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { COMPETITIVE_MAP_RULES } from '../shared/MapGenerator.js';

const STORE_VERSION = 1;

export class CompetitiveMapStore {
  constructor(filePath = process.env.COMPETITIVE_MAP_STORE_PATH ?? './data/competitive-maps.json') {
    this.filePath = resolve(filePath);
    this.pendingWrites = Promise.resolve();
  }

  record({ seed, roomCount }) {
    const operation = this.pendingWrites.then(() => this.recordSerialized({ seed, roomCount }));
    this.pendingWrites = operation.catch(() => {});
    return operation;
  }

  async list() {
    await this.pendingWrites;
    const store = await this.readStore();
    return structuredClone(store.maps);
  }

  async recordSerialized({ seed, roomCount }) {
    if (!Number.isSafeInteger(seed) || seed < 1) {
      throw new TypeError('Competitive map seed must be a positive safe integer.');
    }
    if (!Number.isInteger(roomCount) || roomCount < COMPETITIVE_MAP_RULES.minRooms ||
        roomCount > COMPETITIVE_MAP_RULES.maxRooms) {
      throw new TypeError('Competitive map room count is outside the competitive range.');
    }

    const store = await this.readStore();
    if (store.maps.some((map) => map.seed === seed && map.roomCount === roomCount)) return;
    store.maps.push({ seed, roomCount, recordedAt: new Date().toISOString() });

    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  async readStore() {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const store = JSON.parse(contents);
      if (store.version !== STORE_VERSION || !Array.isArray(store.maps)) {
        throw new Error(`Unsupported competitive map store format: ${this.filePath}`);
      }
      return store;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: STORE_VERSION, maps: [] };
      throw error;
    }
  }
}