import { createHash, randomInt } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { COMPETITIVE_MAP_RULES, generateMap, isCompetitiveMap, MAP_HEIGHT, MAP_WIDTH, MAX_MAP_SEED, MIN_MAP_SEED } from '../shared/MapGenerator.js';

function fingerprintMap(map) {
  const geometry = JSON.stringify({ rooms: map.rooms, corridors: map.corridors, objects: map.objects });
  return createHash('sha256').update(geometry).digest('hex');
}

async function createQuickPlayMapData({ maxAttempts = Infinity, excludedFingerprints = [] } = {}) {
  const excluded = new Set(excludedFingerprints);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const roomCount = randomInt(COMPETITIVE_MAP_RULES.minRooms, COMPETITIVE_MAP_RULES.maxRooms + 1);
    const seed = randomInt(MIN_MAP_SEED, MAX_MAP_SEED + 1);
    const mapOptions = { minRooms: roomCount, maxRooms: roomCount };
    const map = generateMap(seed, MAP_WIDTH, MAP_HEIGHT, mapOptions);
    if (!isCompetitiveMap(map)) {
      if (attempt % 4 === 3) await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    const fingerprint = fingerprintMap(map);
    if (excluded.has(fingerprint)) continue;
    return { seed, mapOptions, map, fingerprint, attempts: attempt + 1 };
  }
  throw new Error(`Could not find a competitive map after ${maxAttempts} attempts. Try again.`);
}

try {
  const prepared = await createQuickPlayMapData(workerData);
  parentPort.postMessage({ prepared });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : 'Could not generate the next Quick Play map.' });
} finally {
  parentPort.close();
}
