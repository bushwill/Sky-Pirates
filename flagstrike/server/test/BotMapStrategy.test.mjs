import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getBotMapStrategy } from '../../shared/BotMapStrategy.js';

function createMapSnapshot() {
  const rooms = [
    { id: 'a', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', x: 10, y: 0, width: 10, height: 10 },
    { id: 'c', x: 20, y: 0, width: 10, height: 10 },
  ];
  return {
    seed: 1,
    generatorVersion: 'test',
    width: 1_000,
    height: 700,
    mapOptions: { minRooms: 1, maxRooms: 1 },
    rooms,
    corridors: [
      { id: 'a-b', a: 'a', b: 'b', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
      { id: 'b-c', a: 'b', b: 'c', points: [{ x: 10, y: 0 }, { x: 20, y: 0 }] },
      { id: 'a-c', a: 'a', b: 'c', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] },
    ],
  };
}

describe('bot map strategy', () => {
  it('reuses topology and shortest paths across snapshots of the same generated map', () => {
    const firstMap = createMapSnapshot();
    const firstStrategy = getBotMapStrategy(firstMap);
    const path = firstStrategy.findRoomPath('a', 'c');

    assert.deepEqual(path.nodes, ['a', 'b', 'c']);
    assert.equal(path.distance, 20);
    assert.equal(firstStrategy.findRoomPath('a', 'c'), path);

    const nextSnapshot = {
      ...firstMap,
      rooms: firstMap.rooms.map((room) => ({ ...room })),
      corridors: firstMap.corridors.map((corridor) => ({
        ...corridor,
        points: corridor.points.map((point) => ({ ...point })),
      })),
    };
    assert.equal(getBotMapStrategy(nextSnapshot), firstStrategy);
  });
});
