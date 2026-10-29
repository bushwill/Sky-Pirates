import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_ROOMS,
  DEFAULT_MIN_ROOMS,
  analyzeRoomUtilization,
  analyzeSiteDoorways,
  generateMap as generateMapUncached,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_MAP_SEED,
  MAX_ROOMS,
  MIN_MAP_SEED,
  MIN_ROOMS,
} from '../../shared/MapGenerator.js';
import { circleOverlapsMapObjects } from '../../shared/MapGeometry.js';
import { TEAM_SPAWN_OFFSETS } from '../../shared/GameRules.js';

const generatedMaps = new Map();

function generateMap(seed, width, height, options) {
  const key = JSON.stringify([seed, width, height, options]);
  if (!generatedMaps.has(key)) generatedMaps.set(key, generateMapUncached(seed, width, height, options));
  // Tests can freely inspect/mutate their copy without contaminating other tests.
  return structuredClone(generatedMaps.get(key));
}

function assertConnected(graph) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, graph.edges.length);
  for (const edge of graph.edges) {
    assert.ok(adjacency.has(edge.a));
    assert.ok(adjacency.has(edge.b));
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const visited = new Set(['red-spawn']);
  const queue = ['red-spawn'];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift())) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  assert.equal(visited.size, graph.nodes.length);
  assert.ok(adjacency.get('red-spawn').length > 0);
  assert.ok(adjacency.get('blue-spawn').length > 0);
}

function getRoomSideAtPoint(room, point) {
  const left = room.x - room.width / 2;
  const right = room.x + room.width / 2;
  const top = room.y - room.height / 2;
  const bottom = room.y + room.height / 2;
  if (Math.abs(point.x - left) < 1e-6) return 'west';
  if (Math.abs(point.x - right) < 1e-6) return 'east';
  if (Math.abs(point.y - top) < 1e-6) return 'north';
  if (Math.abs(point.y - bottom) < 1e-6) return 'south';
  return null;
}

function assertPerpendicularRoomConnections(map, corridor) {
  const roomA = map.rooms.find((room) => room.id === corridor.a);
  const roomB = map.rooms.find((room) => room.id === corridor.b);
  const start = corridor.points[0];
  const next = corridor.points[1];
  const previous = corridor.points.at(-2);
  const end = corridor.points.at(-1);
  const sideA = getRoomSideAtPoint(roomA, start);
  const sideB = getRoomSideAtPoint(roomB, end);
  assert.ok(sideA, `${corridor.id} must start on room ${roomA.id}'s perimeter`);
  assert.ok(sideB, `${corridor.id} must end on room ${roomB.id}'s perimeter`);
  for (const [room, side, point] of [[roomA, sideA, start], [roomB, sideB, end]]) {
    const halfSpan = (side === 'west' || side === 'east' ? room.height : room.width) / 2;
    const chamfer = room.shape === 'chamfered' ? Math.min(room.width, room.height) * room.chamfer : 0;
    const coordinate = side === 'west' || side === 'east' ? point.y - room.y : point.x - room.x;
    assert.ok(Math.abs(coordinate) + corridor.width / 2 <= halfSpan - chamfer,
      `${corridor.id} doorway must fit on room ${room.id}'s straight ${side} wall`);
  }
  if (sideA === 'west') assert.ok(next.x < start.x);
  if (sideA === 'east') assert.ok(next.x > start.x);
  if (sideA === 'north') assert.ok(next.y < start.y);
  if (sideA === 'south') assert.ok(next.y > start.y);
  if (sideB === 'west') assert.ok(previous.x < end.x);
  if (sideB === 'east') assert.ok(previous.x > end.x);
  if (sideB === 'north') assert.ok(previous.y < end.y);
  if (sideB === 'south') assert.ok(previous.y > end.y);
}

function assertClearPolyline(points, objects, radius, context) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 20));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const point = { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
      const obstruction = objects.find((object) => object.role !== 'sightline-baffle' &&
        circleOverlapsMapObjects(point, [object], radius));
      assert.equal(obstruction, undefined, `${context} obstructed by ${JSON.stringify(obstruction)}`);
    }
  }
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) => q.x >= Math.min(p.x, r.x) - 1e-8 && q.x <= Math.max(p.x, r.x) + 1e-8 &&
    q.y >= Math.min(p.y, r.y) - 1e-8 && q.y <= Math.max(p.y, r.y) + 1e-8;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (Math.abs(o1) < 1e-8 && onSegment(a, c, b)) ||
    (Math.abs(o2) < 1e-8 && onSegment(a, d, b)) ||
    (Math.abs(o3) < 1e-8 && onSegment(c, a, d)) ||
    (Math.abs(o4) < 1e-8 && onSegment(c, b, d));
}

function pointInsidePolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function hasWallOnRoomSide(room, side, objects) {
  const left = room.x - room.width / 2;
  const right = room.x + room.width / 2;
  const top = room.y - room.height / 2;
  const bottom = room.y + room.height / 2;
  return objects.some((object) => {
    if (object.role !== 'map-wall') return false;
    if (side === 'west') return Math.abs(object.x1 - left) < 1e-6 && Math.abs(object.x2 - left) < 1e-6;
    if (side === 'east') return Math.abs(object.x1 - right) < 1e-6 && Math.abs(object.x2 - right) < 1e-6;
    if (side === 'north') return Math.abs(object.y1 - top) < 1e-6 && Math.abs(object.y2 - top) < 1e-6;
    return Math.abs(object.y1 - bottom) < 1e-6 && Math.abs(object.y2 - bottom) < 1e-6;
  });
}

describe('graph-based procedural map generator', () => {
  it('counts merged corridor apertures as one physical site doorway', () => {
    const rooms = [
      { id: 'red-spawn', isSpawn: true, team: 'red', x: 100, y: 100, width: 150, height: 180 },
      { id: 'blue-spawn', isSpawn: true, team: 'blue', x: 900, y: 100, width: 150, height: 180 },
    ];
    const corridors = [
      { id: 'r1', a: 'red-spawn', b: 'a', width: 70, points: [{ x: 175, y: 90 }] },
      { id: 'r2', a: 'red-spawn', b: 'b', width: 70, points: [{ x: 175, y: 110 }] },
      { id: 'r3', a: 'red-spawn', b: 'c', width: 60, points: [{ x: 25, y: 100 }] },
      { id: 'b1', a: 'blue-spawn', b: 'a', width: 70, points: [{ x: 825, y: 100 }] },
    ];
    const graph = {
      nodes: [{ id: 'red-spawn', isSpawn: true }, { id: 'blue-spawn', isSpawn: true }],
      edges: [
        { a: 'red-spawn', b: 'a' }, { a: 'red-spawn', b: 'b' },
        { a: 'red-spawn', b: 'c' }, { a: 'blue-spawn', b: 'a' },
      ],
    };

    const metrics = analyzeSiteDoorways(rooms, corridors, graph);

    assert.equal(metrics.red.graphEdgeCount, 3);
    assert.equal(metrics.red.doorwayCount, 2);
    assert.equal(metrics.red.mergedConnections, 1);
    assert.deepEqual(metrics.red.openings.map((opening) => opening.side).sort(), ['east', 'west']);
    assert.equal(metrics.blue.graphEdgeCount, 1);
    assert.equal(metrics.blue.doorwayCount, 1);
  });

  it('counts only rooms on routes within the strict shortest-path detour threshold', () => {
    const graph = {
      nodes: [
        { id: 'red-spawn', isSpawn: true },
        { id: 'blue-spawn', isSpawn: true },
        { id: 'main-room', isSpawn: false },
        { id: 'near-route-room', isSpawn: false },
        { id: 'detour-room-a', isSpawn: false },
        { id: 'detour-room-b', isSpawn: false },
        { id: 'leaf-room', isSpawn: false },
      ],
      edges: [
        { a: 'red-spawn', b: 'main-room', layoutLength: 100 },
        { a: 'main-room', b: 'blue-spawn', layoutLength: 100 },
        { a: 'red-spawn', b: 'near-route-room', layoutLength: 105 },
        { a: 'near-route-room', b: 'blue-spawn', layoutLength: 105 },
        { a: 'red-spawn', b: 'detour-room-a', layoutLength: 400 },
        { a: 'detour-room-a', b: 'detour-room-b', layoutLength: 400 },
        { a: 'detour-room-b', b: 'blue-spawn', layoutLength: 400 },
        { a: 'detour-room-a', b: 'leaf-room', layoutLength: 20 },
      ],
    };

    const metrics = analyzeRoomUtilization(graph);

    assert.equal(metrics.usedRoomCount, 2);
    assert.equal(metrics.nearOptimalRoomCount, 2);
    assert.equal(metrics.criticalRoomCount, 0);
    assert.equal(metrics.offRouteRoomCount, 3);
    assert.equal(metrics.deadEndRoomCount, 1);
  });

  it('does not count rooms whose shortest start and end legs overlap', () => {
    const graph = {
      nodes: [
        { id: 'red-spawn', isSpawn: true },
        { id: 'blue-spawn', isSpawn: true },
        { id: 'main-room', isSpawn: false },
        { id: 'spur-room-a', isSpawn: false },
        { id: 'spur-room-b', isSpawn: false },
      ],
      edges: [
        { a: 'red-spawn', b: 'main-room', layoutLength: 50 },
        { a: 'main-room', b: 'blue-spawn', layoutLength: 50 },
        { a: 'main-room', b: 'spur-room-a', layoutLength: 1 },
        { a: 'spur-room-a', b: 'spur-room-b', layoutLength: 1 },
        { a: 'spur-room-b', b: 'main-room', layoutLength: 1 },
      ],
    };

    const metrics = analyzeRoomUtilization(graph);

    assert.equal(metrics.usedRoomCount, 1);
    assert.equal(metrics.nearOptimalRoomCount, 1);
    assert.equal(metrics.offRouteRoomCount, 2);
  });

  it('uses the detour cutoff inclusively and rejects routes beyond it', () => {
    const graph = {
      nodes: [
        { id: 'red-spawn', isSpawn: true },
        { id: 'blue-spawn', isSpawn: true },
        { id: 'short-room', isSpawn: false },
        { id: 'limit-room', isSpawn: false },
        { id: 'over-limit-room', isSpawn: false },
      ],
      edges: [
        { a: 'red-spawn', b: 'short-room', layoutLength: 50 },
        { a: 'short-room', b: 'blue-spawn', layoutLength: 50 },
        { a: 'red-spawn', b: 'limit-room', layoutLength: 55 },
        { a: 'limit-room', b: 'blue-spawn', layoutLength: 55 },
        { a: 'red-spawn', b: 'over-limit-room', layoutLength: 55.01 },
        { a: 'over-limit-room', b: 'blue-spawn', layoutLength: 55.01 },
      ],
    };

    const metrics = analyzeRoomUtilization(graph);

    assert.equal(metrics.usedRoomCount, 2);
    assert.equal(metrics.offRouteRoomCount, 1);
  });

  it('keeps a room that is the only Strike-to-Flag connection route', () => {
    const graph = {
      nodes: [
        { id: 'red-spawn', isSpawn: true },
        { id: 'blue-spawn', isSpawn: true },
        { id: 'critical-room', isSpawn: false },
      ],
      edges: [
        { a: 'red-spawn', b: 'critical-room', layoutLength: 120 },
        { a: 'critical-room', b: 'blue-spawn', layoutLength: 130 },
      ],
    };

    const metrics = analyzeRoomUtilization(graph);

    assert.equal(metrics.usedRoomCount, 1);
    assert.equal(metrics.criticalRoomCount, 1);
    assert.equal(metrics.offRouteRoomCount, 0);
  });

  it('generates identical complete layouts from identical inputs', () => {
    assert.deepEqual(generateMap(123456789), generateMap(123456789));
    assert.deepEqual(generateMap(42, MAP_WIDTH, MAP_HEIGHT, { minRooms: 7, maxRooms: 7 }),
      generateMap(42, MAP_WIDTH, MAP_HEIGHT, { minRooms: 7, maxRooms: 7 }));
    const defaultMap = generateMap(42);
    assert.deepEqual(defaultMap.mapOptions, { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS });
    assert.equal(defaultMap.metrics.roomCount, 4);
    assert.deepEqual(generateMap(42, MAP_WIDTH, MAP_HEIGHT, { minRooms: 3, maxRooms: 6 }).mapOptions,
      { minRooms: 3, maxRooms: 6 });
  });

  it('generates deterministic 300-health boxes and barrels in rooms and corridors', () => {
    for (const seed of [1, 7, 29, 104, 2026]) {
      const map = generateMap(seed);
      const props = map.objects.filter((object) => object.role === 'destructible-prop');
      assert.deepEqual(props, generateMap(seed).objects.filter((object) => object.role === 'destructible-prop'));
      assert.ok(props.length >= map.rooms.length, `seed ${seed} should furnish the sites and rooms`);
      assert.equal(new Set(props.map((object) => object.id)).size, props.length);
      assert.ok(props.every((object) => object.health === 300 && object.maxHealth === 300));
      assert.ok(props.some((object) => object.propType === 'box' && object.shape === 'rect'));
      assert.ok(props.some((object) => object.propType === 'barrel' && object.shape === 'circle'));
      assert.ok(props.some((object) => map.rooms.some((room) => pointInsidePolygon(object, room.vertices))));
      assert.ok(props.some((object) => map.corridors.some((corridor) =>
        corridor.polygons.some((polygon) => pointInsidePolygon(object, polygon)))),
      `seed ${seed} should place props in corridors`);
    }
  });

  it('keeps every generated prop clear of all five spawn positions at both sites', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const map = generateMap(seed);
      const props = map.objects.filter((object) => object.role === 'destructible-prop');
      for (const room of map.rooms.filter((candidate) => candidate.isSpawn)) {
        const direction = room.x < map.width / 2 ? 1 : -1;
        for (const offset of TEAM_SPAWN_OFFSETS) {
          const spawn = { x: room.x + offset.x * direction, y: room.y + offset.y };
          for (const prop of props) {
            const boundingRadius = prop.shape === 'rect'
              ? Math.hypot(prop.width, prop.height) / 2
              : prop.radius;
            assert.ok(Math.hypot(prop.x - spawn.x, prop.y - spawn.y) >= boundingRadius + 12,
              `seed ${seed} ${prop.id} overlaps ${room.team} spawn at offset ${JSON.stringify(offset)}`);
          }
        }
      }
    }
  });

  it('varies deterministic graph sizes within the requested inclusive range', () => {
    const counts = new Set(Array.from({ length: 10 }, (_, index) =>
      generateMap(index + 1, MAP_WIDTH, MAP_HEIGHT, { minRooms: 1, maxRooms: 13 }).metrics.roomCount));
    assert.ok([...counts].every((count) => count >= 1 && count <= 13));
    assert.ok(counts.size > 1);
    for (const seed of [1, 5, 10]) {
      assert.equal(generateMap(seed, MAP_WIDTH, MAP_HEIGHT, { minRooms: 8, maxRooms: 8 }).metrics.roomCount, 8);
    }
  });

  it('places the larger Strike and Flag sites dynamically within their map halves', () => {
    const placements = new Set();
    for (let seed = 1; seed <= 20; seed += 1) {
      const map = generateMap(seed);
      const redZone = map.spawnZones.red;
      const blueZone = map.spawnZones.blue;
      assert.ok(redZone.x >= 24 && redZone.x <= 110);
      assert.ok(map.width - blueZone.x - blueZone.width >= 24 && map.width - blueZone.x - blueZone.width <= 110);
      assert.ok(map.rooms.filter((room) => !room.isSpawn).every((room) =>
        room.x - room.width / 2 >= redZone.x + redZone.width + 19 &&
        room.x + room.width / 2 <= blueZone.x - 19));
      for (const team of ['red', 'blue']) {
        const zone = map.spawnZones[team];
        assert.ok(zone.width >= 220 && zone.width <= 320);
        assert.ok(zone.height >= 220 && zone.height <= 320);
        assert.ok(zone.x >= 0 && zone.y >= 0);
        assert.ok(zone.x + zone.width <= map.width);
        assert.ok(zone.y + zone.height <= map.height);
        assert.ok(team === 'red'
          ? zone.x + zone.width <= map.width / 2
          : zone.x >= map.width / 2);
        placements.add(`${team}:${zone.x.toFixed(1)},${zone.y.toFixed(1)},${zone.width},${zone.height}`);
      }
    }
    assert.ok(placements.size > 20, 'spawn sites should vary deterministically across seeds');
  });

  it('reports centerline and sampled site-to-site sightlines from final wall geometry', () => {
    for (let seed = 1; seed <= 16; seed += 1) {
      const map = generateMap(seed);
      const red = map.rooms.find((room) => room.id === 'red-spawn');
      const blue = map.rooms.find((room) => room.id === 'blue-spawn');
      const start = { x: red.x, y: red.y };
      const end = { x: blue.x, y: blue.y };
      const centerlineBlocked = map.objects.some((wall) => wall.shape === 'segment' && segmentsIntersect(start, end,
        { x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }));
      assert.equal(map.metrics.siteSightline.centerlineBlocked, centerlineBlocked,
        `seed ${seed} centerline metric must reflect final walls`);
      assert.equal(map.metrics.siteSightline.sampledPairCount, 25 * 25);
      assert.equal(map.metrics.siteSightline.mutuallyOccluded,
        map.metrics.siteSightline.sampledVisiblePairs === 0);
      assert.ok(Number.isFinite(map.metrics.siteSightline.maxNearSiteSightline));
      if (map.sightlineBaffle.type === 'short-room-baffle') {
        const baffle = map.objects.find((wall) => wall.role === 'sightline-baffle');
        assert.ok(Math.hypot(baffle.x2 - baffle.x1, baffle.y2 - baffle.y1) <= 36.01,
          `seed ${seed} fallback sightline wall should remain compact`);
      }
    }
  });

  it('generates the minimum supported map as one traversable room between both spawns', () => {
    for (const seed of [1, 17, 24680]) {
      const map = generateMap(seed, MAP_WIDTH, MAP_HEIGHT, { minRooms: 1, maxRooms: 1 });
      assert.equal(map.metrics.roomCount, 1);
      assert.equal(map.rooms.length, 3);
      assert.equal(map.corridors.length, 2);
      assert.equal(map.graph.nodes.filter((node) => !node.isSpawn).length, 1);
      assertConnected(map.graph);
      for (const room of map.rooms) {
        for (const side of ['north', 'south', 'east', 'west']) {
          assert.ok(hasWallOnRoomSide(room, side, map.objects), `${room.id} missing ${side} outline at seed ${seed}`);
        }
      }
      assert.ok(map.corridors.every((corridor) => corridor.points.length >= 2));
      for (const corridor of map.corridors) {
        assertClearPolyline(corridor.points, map.objects, 9, `one-room seed ${seed} ${corridor.id}`);
      }
    }
  });

  it('keeps every generated room within bounds and connects both spawn nodes', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const map = generateMap(seed);
      assert.equal(map.width, MAP_WIDTH);
      assert.equal(map.height, MAP_HEIGHT);
      assert.equal(map.rooms.length, map.metrics.roomCount + 2);
      assert.equal(map.graph.nodes.filter((node) => node.isSpawn).length, 2);
      assert.equal(map.graph.nodes.find((node) => node.id === 'red-spawn').team, 'red');
      assert.equal(map.graph.nodes.find((node) => node.id === 'blue-spawn').team, 'blue');
      assertConnected(map.graph);

      for (const room of map.rooms) {
        assert.ok(room.width > 0 && room.height > 0);
        assert.ok(room.x - room.width / 2 >= -0.5, `${room.id} left edge outside map`);
        assert.ok(room.y - room.height / 2 >= -0.5, `${room.id} top edge outside map`);
        assert.ok(room.x + room.width / 2 <= map.width + 0.5, `${room.id} right edge outside map`);
        assert.ok(room.y + room.height / 2 <= map.height + 0.5, `${room.id} bottom edge outside map`);
      }

      for (const team of ['red', 'blue']) {
        const spawn = map.rooms.find((room) => room.isSpawn && room.team === team);
        assert.ok(spawn);
        assert.deepEqual(map.spawnZones[team], {
          x: spawn.x - spawn.width / 2,
          y: spawn.y - spawn.height / 2,
          width: spawn.width,
          height: spawn.height,
        });
      }
    }
  });

  it('derives orthogonal room/corridor walls and clear corridor centerlines', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const map = generateMap(seed);
      assert.ok(map.corridors.length >= map.rooms.length - 1);
      assert.ok(map.objects.length > 0);
      assert.ok(map.objects.filter((object) => object.role !== 'destructible-prop').every((object) => object.shape === 'segment'));
      assert.ok(map.objects.every((object) => ['map-wall', 'sightline-baffle', 'destructible-prop'].includes(object.role)));
      assert.ok(map.objects.filter((object) => object.role === 'destructible-prop').every((object) => object.blocksMovement &&
        object.blocksProjectiles && object.blocksVision));
      assert.ok(map.objects.filter((object) => object.role === 'map-wall').every((object) => {
        const dx = Math.abs(object.x1 - object.x2);
        const dy = Math.abs(object.y1 - object.y2);
        return dx < 1e-9 || dy < 1e-9 || Math.abs(dx - dy) < 1e-4;
      }));

      for (const corridor of map.corridors) {
        assert.ok(corridor.width >= 60 && corridor.width <= 80);
        assert.ok(corridor.points.length >= 2);
        assertPerpendicularRoomConnections(map, corridor);
        assert.ok(corridor.points.slice(1).every((point, index) =>
          Math.abs(point.x - corridor.points[index].x) < 1e-9 ||
          Math.abs(point.y - corridor.points[index].y) < 1e-9));
        assertClearPolyline(corridor.points, map.objects, 9, `seed ${seed} ${corridor.id}`);
      }
    }
  });

  it('traces angled 45-degree walls around chamfered rooms', () => {
    let angledWalls = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const map = generateMap(seed);
      for (const room of map.rooms.filter((candidate) => candidate.shape === 'chamfered')) {
        assert.equal(room.vertices.length, 8);
        for (const vertex of room.vertices) {
          assert.ok(vertex.x >= room.x - room.width / 2 && vertex.x <= room.x + room.width / 2);
          assert.ok(vertex.y >= room.y - room.height / 2 && vertex.y <= room.y + room.height / 2);
        }
      }
      angledWalls += map.objects.filter((object) => {
        if (object.role !== 'map-wall') return false;
        const dx = Math.abs(object.x2 - object.x1);
        const dy = Math.abs(object.y2 - object.y1);
        return dx > 1e-6 && dy > 1e-6 && Math.abs(dx - dy) < 1e-4;
      }).length;
    }
    assert.ok(angledWalls > 0, 'Expected traced map boundaries to include 45-degree segments');
  });

  it('keeps six-room hallways clear for seeds with chamfered doorway edges', () => {
    for (const seed of [3, 460172757]) {
      const map = generateMap(seed, MAP_WIDTH, MAP_HEIGHT, { minRooms: 6, maxRooms: 6 });
      assert.equal(map.metrics.roomCount, 6);
      for (const corridor of map.corridors) {
        assertPerpendicularRoomConnections(map, corridor);
        assertClearPolyline(corridor.points, map.objects, 9, `seed ${seed} ${corridor.id}`);
      }
      assert.ok(map.objects.filter((wall) => wall.role === 'map-wall' || wall.role === 'sightline-baffle')
        .every((wall) => Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) < 500));
    }
  });

  it('exposes finite host-facing pace and aggressiveness metrics', () => {
    const map = generateMap(9876);
    for (const team of ['red', 'blue']) {
      const spawnNodeId = `${team}-spawn`;
      const graphDoorwayCount = map.graph.edges.filter((edge) => edge.a === spawnNodeId || edge.b === spawnNodeId).length;
      assert.ok(graphDoorwayCount > 0);
      assert.ok(map.siteDoorways[team].doorwayCount > 0);
      assert.ok(map.siteDoorways[team].doorwayCount <= graphDoorwayCount);
      assert.equal(map.siteDoorways[team].graphEdgeCount, graphDoorwayCount);
      assert.equal(map.metrics.siteDoorways[team].doorwayCount, map.siteDoorways[team].doorwayCount);
    }
    assert.deepEqual(map.siteDoorways, map.metrics.siteDoorways);
    assert.ok(map.metrics.roomCount >= MIN_ROOMS && map.metrics.roomCount <= MAX_ROOMS);
    assert.ok(map.metrics.corridorCount > 0);
    assert.ok(map.metrics.routeCount > 0);
    assert.ok(Number.isFinite(map.metrics.aggressiveness.score));
    assert.ok(Number.isFinite(map.metrics.pace.score));
    assert.ok(map.metrics.aggressiveness.label);
    assert.ok(map.metrics.pace.label);
    assert.ok(Number.isFinite(map.metrics.shortestPathHops));
    assert.ok(map.metrics.roomUtilization.usedRooms <= map.metrics.roomUtilization.totalRooms);
    assert.equal(map.metrics.roomUtilization.offRouteRooms,
      map.metrics.roomUtilization.totalRooms - map.metrics.roomUtilization.usedRooms);
    assert.ok(map.metrics.roomUtilization.deadEndRooms <= map.metrics.roomUtilization.totalRooms);
    assert.ok(map.metrics.roomUtilization.nearOptimalRooms <= map.metrics.roomUtilization.usedRooms);
    assert.ok(map.metrics.roomUtilization.criticalRooms <= map.metrics.roomUtilization.usedRooms);
    assert.equal(map.metrics.roomUtilization.maxDetourPercent, 10);
    assert.equal(map.metrics.roomUtilization.percent,
      Math.round(map.metrics.roomUtilization.usedRooms / Math.max(map.metrics.roomUtilization.totalRooms, 1) * 100) / 100);
    assert.ok(map.metrics.complexity.routeCount >= 1);
    assert.equal(map.metrics.complexity.loopCount, map.graph.edges.length - map.graph.nodes.length + 1);
    assert.ok(map.metrics.topology.walkableAreaPercent > 0 && map.metrics.topology.walkableAreaPercent <= 100);
    assert.ok(map.metrics.topology.maxSymmetryPercent >= 0 && map.metrics.topology.maxSymmetryPercent <= 100);
    assert.ok(Number.isFinite(map.metrics.topology.averageEccentricity));
    assert.ok(map.metrics.visibility.averageVisibleDirections >= 0 && map.metrics.visibility.averageVisibleDirections <= 16);
    assert.ok(map.metrics.visibility.maxVisibleDirections >= map.metrics.visibility.averageVisibleDirections);
    assert.equal(map.metrics.pace.estimated, true);
    assert.ok(map.metrics.pace.estimatedEngagementSeconds > 0);
  });

  it('rejects invalid seeds, dimensions, and room-count ranges', () => {
    assert.throws(() => generateMap(MIN_MAP_SEED - 1), RangeError);
    assert.throws(() => generateMap(MAX_MAP_SEED + 1), RangeError);
    assert.throws(() => generateMap(1, 500, MAP_HEIGHT), RangeError);
    assert.throws(() => generateMap(1, MAP_WIDTH, MAP_HEIGHT, { minRooms: 0, maxRooms: 5 }), RangeError);
    assert.throws(() => generateMap(1, MAP_WIDTH, MAP_HEIGHT, { minRooms: 8, maxRooms: 7 }), RangeError);
    assert.throws(() => generateMap(1, MAP_WIDTH, MAP_HEIGHT, { minRooms: 5, maxRooms: MAX_ROOMS + 1 }), RangeError);
  });
});