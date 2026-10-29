import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMapObject, getMapObjectBoundingRadius, getMapObjectCenter } from '../../shared/MapObject.js';

describe('MapObject', () => {
  it('keeps supported geometries serializable with common collision flags', () => {
    const objects = [
      createMapObject('wall-1', 'segment', { x1: 0, y1: 0, x2: 30, y2: 0 }, 'map-wall'),
      createMapObject('cover-1', 'rect', { x: 60, y: 40, width: 20, height: 10 }),
      createMapObject('cover-2', 'circle', { x: 100, y: 50, radius: 12 }),
    ];

    assert.ok(objects.every((object) => object.blocksMovement && object.blocksProjectiles));
    assert.deepEqual(JSON.parse(JSON.stringify(objects)), objects);
    assert.deepEqual(getMapObjectCenter(objects[0]), { x: 15, y: 0 });
    assert.equal(getMapObjectBoundingRadius(objects[1]), Math.hypot(20, 10) / 2);
    assert.equal(getMapObjectBoundingRadius(objects[2]), 12);
  });

  it('rejects malformed or zero-sized geometry', () => {
    assert.throws(() => createMapObject('bad', 'triangle', {}), TypeError);
    assert.throws(() => createMapObject('bad', 'circle', { x: 1, y: 2, radius: 0 }), RangeError);
    assert.throws(() => createMapObject('bad', 'segment', { x1: 1, y1: 2, x2: 1, y2: 2 }), RangeError);
  });
});
