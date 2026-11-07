import { createMapObject } from './MapObject.js';
import { circleOverlapsMapObjects } from './MapGeometry.js';
import { segmentMapObjectBoundsOverlap, segmentMapObjectEntryT } from './ProjectileModel.js';
import { TEAM_SPAWN_OFFSETS } from './GameRules.js';

export const MAP_GENERATOR_VERSION = 22;
export const MAP_WIDTH = 1500;
export const MAP_HEIGHT = 1000;
export const MIN_MAP_SEED = 1;
export const MAX_MAP_SEED = 0xffffffff;
export const MIN_ROOMS = 1;
export const MAX_ROOMS = 13;
export const DEFAULT_MIN_ROOMS = 4;
export const DEFAULT_MAX_ROOMS = 4;
export const USEFUL_ROUTE_DETOUR_RATIO = 0.1;
export const COMPETITIVE_MAP_RULES = Object.freeze({
  minRooms: 4,
  maxRooms: 6,
  minDoorwaysPerSite: 2,
  minSymmetryPercent: 35,
  minRoomUtilization: 0.75,
  maxSiteApproachSightline: 750,
});

export function isCompetitiveMap(map, rules = COMPETITIVE_MAP_RULES) {
  const metrics = map?.metrics;
  if (!metrics || !Number.isInteger(metrics.roomCount) ||
      metrics.roomCount < rules.minRooms ||
      metrics.roomCount > rules.maxRooms) return false;

  const sitesQualify = ['red', 'blue'].every((team) =>
    metrics.siteDoorways?.[team]?.doorwayCount >= rules.minDoorwaysPerSite &&
    metrics.siteDoorways?.[team]?.graphEdgeCount >= rules.minDoorwaysPerSite);
  const symmetryQualifies = metrics.topology?.maxSymmetryPercent >= rules.minSymmetryPercent;
  const utilizationQualifies = metrics.roomUtilization?.ratio >= rules.minRoomUtilization;
  const sightline = metrics.siteSightline;
  const sightlinesQualify = sightline?.mutuallyOccluded === true &&
    sightline.nearSiteSampleCount > 0 && sightline.longNearSiteSightlineCount === 0;

  return sitesQualify && symmetryQualifies && utilizationQualifies && sightlinesQualify;
}

const SPAWN_ZONE_MIN_SIZE = 220;
const SPAWN_SIDE_MARGIN_MIN = 24;
const SPAWN_SIDE_MARGIN_MAX = 111;
const SIGHTLINE_BAFFLE_HALL_CLEARANCE = 13;
const SITE_SIGHTLINE_SAMPLE_DIVISIONS = 5;
const SITE_APPROACH_CLEARANCE = 120;
const SITE_APPROACH_SAMPLE_SIZE = 45;
const SITE_APPROACH_CONE_STEPS = 4;
const LAYOUT_MARGIN = 90;
const LAYOUT_ITERATIONS = 150;

// The map is modelled as a graph: each node is a room, each edge a corridor.
// The Strike and Flag sites are the two mandatory nodes every other room connects back to.
export function generateMap(seed, width = MAP_WIDTH, height = MAP_HEIGHT, {
  minRooms = DEFAULT_MIN_ROOMS,
  maxRooms = DEFAULT_MAX_ROOMS,
  maxSiteApproachSightline = COMPETITIVE_MAP_RULES.maxSiteApproachSightline,
} = {}) {
  if (!Number.isInteger(seed) || seed < MIN_MAP_SEED || seed > MAX_MAP_SEED) {
    throw new RangeError(`Map seed must be an integer from ${MIN_MAP_SEED} to ${MAX_MAP_SEED}.`);
  }
  if (!(Number.isFinite(width) && width > 900 && Number.isFinite(height) && height > 700)) {
    throw new RangeError('Map dimensions are too small for gameplay.');
  }
  if (!Number.isInteger(minRooms) || !Number.isInteger(maxRooms) ||
      minRooms < MIN_ROOMS || maxRooms > MAX_ROOMS || minRooms > maxRooms) {
    throw new RangeError(`Room counts must be from ${MIN_ROOMS} to ${MAX_ROOMS}, with minRooms <= maxRooms.`);
  }
  if (!Number.isInteger(maxSiteApproachSightline) ||
      maxSiteApproachSightline < 200 || maxSiteApproachSightline > 1_500) {
    throw new RangeError('Maximum site approach sightline must be from 200 to 1500.');
  }

  const random = createRandom(seed);
  const spawnZones = {
    red: generateSpawnZone(random, 'red', width, height),
    blue: generateSpawnZone(random, 'blue', width, height),
  };

  const graph = generateRoomGraph(random, minRooms, maxRooms);
  const extents = computeRoomExtents(graph, width, height, spawnZones);
  const positions = resolveLayout(seed, graph, extents, width, height, spawnZones);
  const { rooms, corridors } = buildRoomsAndCorridors(random, graph, positions, extents, spawnZones, width, height);
  const objects = generateMapBoundaryWalls(rooms, corridors);
  const sightlineBaffle = addSiteSightlineBaffle(rooms, corridors, objects, width, height);
  const corridorLengths = new Map(corridors.map((corridor) => [corridor.id, pathLength(corridor.points)]));
  for (const edge of graph.edges) edge.layoutLength = corridorLengths.get(edge.id);
  const siteSightline = analyzeSiteSightlines(
    rooms, corridors, objects, width, height, maxSiteApproachSightline,
  );

  const metrics = computeMapMetrics({
    rooms,
    corridors,
    graph,
    width,
    height,
    sightlineBaffle,
    siteSightline,
    interiorWalls: objects.filter((object) => object.role === 'sightline-baffle'),
  });
  const siteDoorways = metrics.siteDoorways;
  objects.push(...generateDestructibleProps(random, rooms, corridors, objects));

  return {
    seed,
    generatorVersion: MAP_GENERATOR_VERSION,
    width,
    height,
    mapOptions: {
      minRooms,
      maxRooms,
      ...(maxSiteApproachSightline !== COMPETITIVE_MAP_RULES.maxSiteApproachSightline
        ? { maxSiteApproachSightline } : {}),
    },
    spawnZones,
    graph,
    rooms,
    corridors,
    objects,
    metrics,
    siteDoorways,
    sightlineBaffle,
  };
}

const DESTRUCTIBLE_PROP_HEALTH = 300;

function generateDestructibleProps(random, rooms, corridors, mapObjects) {
  const walls = mapObjects.slice();
  const props = [];
  let nextPropId = 1;

  const place = (region, placement) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const propType = random() < 0.5 ? 'box' : 'barrel';
      const object = createGeneratedProp(nextPropId, propType, region.kind);
      const center = placement(object, attempt);
      if (!center) continue;
      object.x = center.x;
      object.y = center.y;
      const footprint = getPropFootprintPoints(object);
      if (!footprint.every((point) => region.contains(point))) continue;
      if (region.isClear && !region.isClear(object)) continue;
      if (!clearsCorridorCenterlines(object, corridors)) continue;
      if (!isPropPlacementClear(object, footprint, walls, props)) continue;
      nextPropId += 1;
      props.push(object);
      return;
    }
  };

  for (const room of rooms) {
    const polygon = room.vertices;
    const doorways = corridors.flatMap((corridor) => {
      if (corridor.a === room.id) return [{ point: corridor.points[0], width: corridor.width }];
      if (corridor.b === room.id) return [{ point: corridor.points.at(-1), width: corridor.width }];
      return [];
    });
    const spawnDirection = room.team === 'red' ? 1 : -1;
    const reservedPoints = room.isSpawn
      ? [...TEAM_SPAWN_OFFSETS.map((offset) => ({
        x: room.x + offset.x * spawnDirection,
        y: room.y + offset.y,
        clearance: 12,
      })), ...(room.team === 'blue' ? [{ x: room.x, y: room.y, clearance: 30 }] : [])]
      : [];
    const roomRegion = {
      kind: 'room',
      contains: (point) => isPointInsidePolygon(point, polygon),
      isClear: (object) => {
        const propRadius = object.shape === 'rect' ? Math.hypot(object.width, object.height) / 2 : object.radius;
        return doorways.every(({ point, width }) => Math.hypot(object.x - point.x, object.y - point.y) >= width / 2 + propRadius + 10) &&
          reservedPoints.every((point) => Math.hypot(object.x - point.x, object.y - point.y) >= point.clearance + propRadius);
      },
    };
    // A central prop and a separate wall-side prop dress every site and room.
    place(roomRegion, (object, attempt) => {
      const marginX = object.shape === 'rect' ? object.width / 2 + 8 : object.radius + 8;
      const marginY = object.shape === 'rect' ? object.height / 2 + 8 : object.radius + 8;
      const spreadX = Math.max(0, room.width * 0.2 - marginX);
      const spreadY = Math.max(0, room.height * 0.2 - marginY);
      return {
        x: room.x + randomBetween(random, -spreadX, spreadX),
        y: room.y + randomBetween(random, -spreadY, spreadY),
      };
    });
    place(roomRegion, (object, attempt) => {
      const side = ['north', 'south', 'east', 'west'][randomInt(random, 0, 4)];
      const halfWidth = room.width / 2;
      const halfHeight = room.height / 2;
      const halfPropWidth = object.shape === 'rect' ? object.width / 2 : object.radius;
      const halfPropHeight = object.shape === 'rect' ? object.height / 2 : object.radius;
      const along = side === 'north' || side === 'south'
        ? Math.max(0, halfWidth - halfPropWidth - 30)
        : Math.max(0, halfHeight - halfPropHeight - 30);
      const alongOffset = randomBetween(random, -along, along);
      const inset = 8;
      if (side === 'north') return { x: room.x + alongOffset, y: room.y - halfHeight + halfPropHeight + inset };
      if (side === 'south') return { x: room.x + alongOffset, y: room.y + halfHeight - halfPropHeight - inset };
      if (side === 'east') return { x: room.x + halfWidth - halfPropWidth - inset, y: room.y + alongOffset };
      return { x: room.x - halfWidth + halfPropWidth + inset, y: room.y + alongOffset };
    });
  }

  for (const corridor of corridors) {
    const eligibleSegments = corridor.points.slice(1).map((end, index) => ({
      start: corridor.points[index],
      end,
    })).filter(({ start, end }) => Math.hypot(end.x - start.x, end.y - start.y) >= 54);
    if (eligibleSegments.length === 0) continue;
    const corridorRegion = {
      kind: 'corridor',
      contains: (point) => corridor.polygons.some((polygon) => isPointInsidePolygon(point, polygon)),
    };
    place(corridorRegion, (object) => {
      const segment = eligibleSegments[randomInt(random, 0, eligibleSegments.length)];
      const dx = segment.end.x - segment.start.x;
      const dy = segment.end.y - segment.start.y;
      const length = Math.hypot(dx, dy);
      const tangent = { x: dx / length, y: dy / length };
      const normal = { x: -tangent.y, y: tangent.x };
      const along = randomBetween(random, 0.35, 0.65);
      const crossHalfSize = object.shape === 'rect'
        ? Math.abs(normal.x) * object.width / 2 + Math.abs(normal.y) * object.height / 2
        : object.radius;
      const offset = corridor.width / 2 - crossHalfSize - 2;
      const side = random() < 0.5 ? -1 : 1;
      return {
        x: segment.start.x + dx * along + normal.x * offset * side,
        y: segment.start.y + dy * along + normal.y * offset * side,
      };
    });
  }

  return props;
}

function createGeneratedProp(number, propType, regionKind) {
  const id = `prop-${number}`;
  const size = regionKind === 'corridor' ? 16 : 28;
  const object = propType === 'box'
    ? createMapObject(id, 'rect', { x: 0, y: 0, width: size, height: size }, 'destructible-prop')
    : createMapObject(id, 'circle', { x: 0, y: 0, radius: size / 2 }, 'destructible-prop');
  Object.assign(object, {
    propType,
    health: DESTRUCTIBLE_PROP_HEALTH,
    maxHealth: DESTRUCTIBLE_PROP_HEALTH,
    blocksVision: true,
  });
  return object;
}

function getPropFootprintPoints(object) {
  if (object.shape === 'circle') {
    return Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return { x: object.x + Math.cos(angle) * object.radius, y: object.y + Math.sin(angle) * object.radius };
    });
  }
  const left = object.x - object.width / 2;
  const right = object.x + object.width / 2;
  const top = object.y - object.height / 2;
  const bottom = object.y + object.height / 2;
  const points = [];
  for (let index = 0; index <= 6; index += 1) {
    const t = index / 6;
    points.push({ x: left + object.width * t, y: top }, { x: left + object.width * t, y: bottom });
    points.push({ x: left, y: top + object.height * t }, { x: right, y: top + object.height * t });
  }
  return points;
}

function isPropPlacementClear(object, footprint, walls, props) {
  const samplePoints = [...footprint, { x: object.x, y: object.y }];
  if (object.shape === 'rect') {
    for (let x = -object.width / 2 + 3; x < object.width / 2; x += 6) {
      for (let y = -object.height / 2 + 3; y < object.height / 2; y += 6) {
        samplePoints.push({ x: object.x + x, y: object.y + y });
      }
    }
  }
  return samplePoints.every((point) =>
    !circleOverlapsMapObjects(point, walls, 1.5) && !circleOverlapsMapObjects(point, props, 1.5));
}

function clearsCorridorCenterlines(object, corridors) {
  for (const corridor of corridors) {
    for (let index = 0; index < corridor.points.length - 1; index += 1) {
      const start = corridor.points[index];
      const end = corridor.points[index + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const normalX = -dy / length;
      const normalY = dx / length;
      const halfWidth = object.shape === 'rect'
        ? Math.abs(normalX) * object.width / 2 + Math.abs(normalY) * object.height / 2
        : object.radius;
      const segmentLengthSquared = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(((object.x - start.x) * dx + (object.y - start.y) * dy) /
        segmentLengthSquared, 1));
      const nearestX = start.x + dx * t;
      const nearestY = start.y + dy * t;
      if (Math.hypot(object.x - nearestX, object.y - nearestY) < halfWidth + 10) return false;
    }
  }
  return true;
}

function isPointInsidePolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function addSiteSightlineBaffle(rooms, corridors, objects, width, height) {
  const red = rooms.find((room) => room.id === 'red-spawn');
  const blue = rooms.find((room) => room.id === 'blue-spawn');
  const start = { x: red.x, y: red.y };
  const end = { x: blue.x, y: blue.y };
  const sightline = { start, end };
  if (objects.some((wall) => getSegmentIntersection(sightline, { start: { x: wall.x1, y: wall.y1 }, end: { x: wall.x2, y: wall.y2 } }))) {
    return { added: false };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineLength = Math.hypot(dx, dy) || 1;
  const candidates = [];
  for (const corridor of corridors) {
    for (let index = 0; index < corridor.points.length - 1; index += 1) {
      const first = corridor.points[index];
      const second = corridor.points[index + 1];
      const intersection = getSegmentIntersection(sightline, { start: first, end: second });
      if (!intersection) continue;
      const sightlineProgress = ((intersection.x - start.x) * dx + (intersection.y - start.y) * dy) / (lineLength * lineLength);
      const segmentLength = Math.hypot(second.x - first.x, second.y - first.y);
      const tangent = { x: (second.x - first.x) / segmentLength, y: (second.y - first.y) / segmentLength };
      const progressOnCorridor = ((intersection.x - first.x) * tangent.x + (intersection.y - first.y) * tangent.y);
      if (sightlineProgress < 0.2 || sightlineProgress > 0.8 ||
          progressOnCorridor < corridor.width / 2 + 24 ||
          segmentLength - progressOnCorridor < corridor.width / 2 + 24) continue;
      candidates.push({ corridor, segmentIndex: index, intersection, tangent, progressOnCorridor, sightlineProgress });
    }
  }
  candidates.sort((a, b) => Math.abs(a.sightlineProgress - 0.5) - Math.abs(b.sightlineProgress - 0.5));
  const candidate = candidates[0];
  if (!candidate) {
    const normal = { x: -dy / lineLength, y: dx / lineLength };
    const halfLength = 18;
    const safeCandidates = [];
    for (let progress = 0.2; progress <= 0.8001; progress += 0.025) {
      const center = { x: start.x + dx * progress, y: start.y + dy * progress };
      const a = { x: center.x - normal.x * halfLength, y: center.y - normal.y * halfLength };
      const b = { x: center.x + normal.x * halfLength, y: center.y + normal.y * halfLength };
      const inBounds = [a, b].every((point) => point.x >= 10 && point.x <= width - 10 && point.y >= 10 && point.y <= height - 10);
      const clearOfHalls = corridors.every((corridor) => corridor.points.slice(1).every((point, index) => {
        const hallSegment = { start: corridor.points[index], end: point };
        const baffleSegment = { start: a, end: b };
        return getSegmentIntersection(baffleSegment, hallSegment) === null &&
          segmentDistance(baffleSegment, hallSegment) >= SIGHTLINE_BAFFLE_HALL_CLEARANCE;
      }));
      if (inBounds && clearOfHalls) safeCandidates.push({ center, a, b, progress });
    }
    safeCandidates.sort((a, b) => Math.abs(a.progress - 0.5) - Math.abs(b.progress - 0.5));
    const selected = safeCandidates[0];
    if (!selected) return { added: false, type: 'no-safe-baffle', openingWidth: null };
    const { a, b } = selected;
    objects.push(createMapObject('sightline-baffle-1', 'segment', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 'sightline-baffle'));
    return { added: true, type: 'short-room-baffle', openingWidth: null, isolated: Boolean(selected) };
  }

  const corridor = candidate.corridor;
  const halfWidth = corridor.width / 2;
  const openingWidth = Math.min(corridor.width - 20, Math.max(28, corridor.width * 0.4));
  const normal = { x: -candidate.tangent.y, y: candidate.tangent.x };
  const gapStart = halfWidth - openingWidth;
  const wallStart = { x: candidate.intersection.x - normal.x * halfWidth, y: candidate.intersection.y - normal.y * halfWidth };
  const wallEnd = { x: candidate.intersection.x + normal.x * gapStart, y: candidate.intersection.y + normal.y * gapStart };
  objects.push(createMapObject('sightline-baffle-1', 'segment', { x1: wallStart.x, y1: wallStart.y, x2: wallEnd.x, y2: wallEnd.y }, 'sightline-baffle'));

  const detourDistance = Math.min(28, candidate.progressOnCorridor - 1,
    Math.hypot(corridor.points[candidate.segmentIndex + 1].x - candidate.intersection.x,
      corridor.points[candidate.segmentIndex + 1].y - candidate.intersection.y) - 1);
  const entrance = {
    x: candidate.intersection.x - candidate.tangent.x * detourDistance,
    y: candidate.intersection.y - candidate.tangent.y * detourDistance,
  };
  const exit = {
    x: candidate.intersection.x + candidate.tangent.x * detourDistance,
    y: candidate.intersection.y + candidate.tangent.y * detourDistance,
  };
  const openingOffset = halfWidth - openingWidth / 2;
  const route = [
    ...corridor.points.slice(0, candidate.segmentIndex + 1),
    entrance,
    { x: entrance.x + normal.x * openingOffset, y: entrance.y + normal.y * openingOffset },
    { x: exit.x + normal.x * openingOffset, y: exit.y + normal.y * openingOffset },
    exit,
    ...corridor.points.slice(candidate.segmentIndex + 1),
  ];
  corridor.points = simplifyPath(route);
  return { added: true, type: 'hallway-baffle', corridorId: corridor.id, openingWidth };
}

function generateSpawnZone(random, team, width, height) {
  const maxZoneWidth = Math.floor(Math.min(320, width * 0.28));
  const maxZoneHeight = Math.floor(Math.min(320, height * 0.42));
  const zoneWidth = randomInt(random, SPAWN_ZONE_MIN_SIZE, maxZoneWidth + 1);
  const zoneHeight = randomInt(random, SPAWN_ZONE_MIN_SIZE, maxZoneHeight + 1);
  const maxEdgeMargin = Math.min(SPAWN_SIDE_MARGIN_MAX, width / 2 - zoneWidth - 32);
  const edgeMargin = randomBetween(random, SPAWN_SIDE_MARGIN_MIN, Math.max(SPAWN_SIDE_MARGIN_MIN, maxEdgeMargin));
    const x = team === 'red' ? edgeMargin : width - edgeMargin - zoneWidth;
  const minY = 32;
  const maxY = height - zoneHeight - 32;
  const y = clamp((height - zoneHeight) / 2 + randomBetween(random, -height * 0.24, height * 0.24), minY, maxY);
  return { x, y, width: zoneWidth, height: zoneHeight };
}

// Builds the abstract room graph: Strike/Flag sites plus `minRooms`-`maxRooms` rooms,
// each new room either fanning out to two or more existing rooms, or splitting an
// existing edge (optionally also linking a few extra rooms for additional loops).
function generateRoomGraph(random, minRooms, maxRooms) {
  const roomCount = randomInt(random, minRooms, maxRooms + 1);
  const nodes = [
    { id: 'red-spawn', isSpawn: true, team: 'red', value: 1 },
    { id: 'blue-spawn', isSpawn: true, team: 'blue', value: 1 },
  ];
  const edges = [];
  let nextEdgeNumber = 1;
  let nextRoomNumber = 1;

  const addNode = () => {
    const node = {
      id: `room-${nextRoomNumber}`,
      isSpawn: false,
      team: null,
      value: randomBetween(random, 0, 1),
      aspect: randomBetween(random, 0.8, 1.25),
      shape: random() < 0.4 ? 'chamfered' : 'rect',
      chamfer: randomBetween(random, 0.08, 0.18),
    };
    nextRoomNumber += 1;
    nodes.push(node);
    return node;
  };
  const hasEdge = (idA, idB) => edges.some((edge) => (edge.a === idA && edge.b === idB) || (edge.a === idB && edge.b === idA));
  const addEdge = (nodeA, nodeB) => {
    edges.push({ id: `edge-${nextEdgeNumber++}`, a: nodeA.id, b: nodeB.id, weight: randomBetween(random, 0.6, 1.4) });
  };
  const attachExtra = (room, candidates, count, excludeIds) => {
    const pool = candidates.filter((candidate) => candidate.id !== room.id && !excludeIds.includes(candidate.id) && !hasEdge(candidate.id, room.id));
    for (let linked = 0; linked < count && pool.length > 0; linked += 1) {
      const [target] = pool.splice(randomInt(random, 0, pool.length), 1);
      addEdge(room, target);
    }
  };
  // The first room always bridges the two spawns directly.
  const firstRoom = addNode();
  addEdge(nodes[0], firstRoom);
  addEdge(firstRoom, nodes[1]);

  for (let placed = 1; placed < roomCount; placed += 1) {
    const room = addNode();
    const existingNodes = nodes.slice(0, -1);
    if (edges.length > 0 && random() < 0.5) {
      const [removed] = edges.splice(randomInt(random, 0, edges.length), 1);
      const nodeA = nodes.find((candidate) => candidate.id === removed.a);
      const nodeB = nodes.find((candidate) => candidate.id === removed.b);
      addEdge(nodeA, room);
      addEdge(room, nodeB);
      attachExtra(room, existingNodes, randomInt(random, 0, 2), [nodeA.id, nodeB.id]);
    } else {
      const linkCount = randomInt(random, 2, Math.min(4, existingNodes.length) + 1);
      attachExtra(room, existingNodes, linkCount, []);
    }
  }

  return { nodes, edges };
}

// Resolves each node's final half-width/half-height up front (area stays constant
// across aspect ratios) so layout repulsion and room geometry always agree.
function computeRoomExtents(graph, width, height, spawnZones) {
  const roomNodes = graph.nodes.filter((node) => !node.isSpawn);
  const centralWidth = spawnZones.blue.x - (spawnZones.red.x + spawnZones.red.width) - 48;
  const playableArea = Math.max(1, centralWidth) * (height - LAYOUT_MARGIN * 2);
  const areaBudget = playableArea * 0.24;
  const baseRadius = Math.min(
    clamp(Math.sqrt(areaBudget / Math.max(roomNodes.length, 1) / Math.PI), 44, 100),
    Math.max(36, centralWidth * 0.28),
  );
  const extents = new Map();
  for (const node of graph.nodes) {
    if (node.isSpawn) {
      const zone = spawnZones[node.team];
      extents.set(node.id, { halfWidth: zone.width / 2, halfHeight: zone.height / 2 });
      continue;
    }
    const radius = baseRadius * (0.75 + node.value * 0.6);
    extents.set(node.id, {
      halfWidth: radius * Math.sqrt(node.aspect),
      halfHeight: radius / Math.sqrt(node.aspect),
    });
  }
  return extents;
}
function resolveLayout(seed, graph, extents, width, height, spawnZones) {
  let positions;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const layoutRandom = createRandom(mixSeed(seed, 0x9e3779b9 + attempt));
    positions = layoutGraph(layoutRandom, graph, extents, width, height, spawnZones);
    if (!roomsOverlap(graph, positions, extents)) break;
  }
  return positions;
}

function segmentDistance(first, second) {
  if (getSegmentIntersection(first, second)) return 0;
  return Math.min(
    pointSegmentDistance(first.start, second.start, second.end),
    pointSegmentDistance(first.end, second.start, second.end),
    pointSegmentDistance(second.start, first.start, first.end),
    pointSegmentDistance(second.end, first.start, first.end),
  );
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

function mixSeed(seed, salt) {
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

// Deterministic force-directed layout: edge weight stretches corridor length,
// node value inflates room size, and rectangular repulsion plus boundary
// clamping keep every room inside the map and non-overlapping as rooms grow.
function layoutGraph(random, graph, extents, width, height, spawnZones) {
  const positions = new Map([
    ['red-spawn', { x: spawnZones.red.x + spawnZones.red.width / 2, y: spawnZones.red.y + spawnZones.red.height / 2 }],
    ['blue-spawn', { x: spawnZones.blue.x + spawnZones.blue.width / 2, y: spawnZones.blue.y + spawnZones.blue.height / 2 }],
  ]);
  const roomNodes = graph.nodes.filter((node) => !node.isSpawn);
  const centralMinX = spawnZones.red.x + spawnZones.red.width + 20;
  const centralMaxX = spawnZones.blue.x - 20;

  for (const [index, node] of roomNodes.entries()) {
    const t = (index + 1) / (roomNodes.length + 1);
    const extent = extents.get(node.id);
    positions.set(node.id, {
      x: clamp(LAYOUT_MARGIN + t * (width - LAYOUT_MARGIN * 2) + randomBetween(random, -40, 40), centralMinX + extent.halfWidth, centralMaxX - extent.halfWidth),
      y: clamp(LAYOUT_MARGIN + randomBetween(random, 0, height - LAYOUT_MARGIN * 2), LAYOUT_MARGIN + extent.halfHeight, height - LAYOUT_MARGIN - extent.halfHeight),
    });
  }

  const baseCorridor = clamp((width - LAYOUT_MARGIN * 2) / Math.max(roomNodes.length, 4), 90, 260);
  for (let iteration = 0; iteration < LAYOUT_ITERATIONS; iteration += 1) {
    const forces = new Map(graph.nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (const edge of graph.edges) {
      const a = positions.get(edge.a);
      const b = positions.get(edge.b);
      const extentA = extents.get(edge.a);
      const extentB = extents.get(edge.b);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const restLength = baseCorridor * edge.weight +
        (extentA.halfWidth + extentA.halfHeight) / 2 + (extentB.halfWidth + extentB.halfHeight) / 2;
      const stretch = (distance - restLength) * 0.02;
      const nx = dx / distance;
      const ny = dy / distance;
      forces.get(edge.a).x += nx * stretch;
      forces.get(edge.a).y += ny * stretch;
      forces.get(edge.b).x -= nx * stretch;
      forces.get(edge.b).y -= ny * stretch;
    }

    for (let i = 0; i < graph.nodes.length; i += 1) {
      for (let j = i + 1; j < graph.nodes.length; j += 1) {
        const nodeA = graph.nodes[i];
        const nodeB = graph.nodes[j];
        const a = positions.get(nodeA.id);
        const b = positions.get(nodeB.id);
        const extentA = extents.get(nodeA.id);
        const extentB = extents.get(nodeB.id);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const requiredX = extentA.halfWidth + extentB.halfWidth + 130;
        const requiredY = extentA.halfHeight + extentB.halfHeight + 130;
        const overlapX = requiredX - Math.abs(dx);
        const overlapY = requiredY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // Resolve along whichever axis needs the smaller push (minimum translation vector).
        const push = Math.min(overlapX, overlapY) * 0.5;
        const pushX = overlapX <= overlapY ? Math.sign(dx || 1) * push : 0;
        const pushY = overlapX <= overlapY ? 0 : Math.sign(dy || 1) * push;
        forces.get(nodeA.id).x += pushX;
        forces.get(nodeA.id).y += pushY;
        forces.get(nodeB.id).x -= pushX;
        forces.get(nodeB.id).y -= pushY;
      }
    }

    for (const node of roomNodes) {
      const position = positions.get(node.id);
      const force = forces.get(node.id);
      const extent = extents.get(node.id);
      position.x = clamp(position.x + force.x, centralMinX + extent.halfWidth, centralMaxX - extent.halfWidth);
      position.y = clamp(position.y + force.y, LAYOUT_MARGIN + extent.halfHeight, height - LAYOUT_MARGIN - extent.halfHeight);
    }
  }

  separateOverlappingRooms(graph, roomNodes, positions, extents, width, height, LAYOUT_MARGIN, centralMinX, centralMaxX);
  if (roomsOverlap(graph, positions, extents)) {
    // Crowded seeds can deadlock against the aesthetic margin; retry allowing
    // rooms to use the full map bounds so every room is still guaranteed clear.
    separateOverlappingRooms(graph, roomNodes, positions, extents, width, height, 4, centralMinX, centralMaxX);
  }
  return positions;
}

function roomsOverlap(graph, positions, extents) {
  for (let i = 0; i < graph.nodes.length; i += 1) {
    for (let j = i + 1; j < graph.nodes.length; j += 1) {
      const a = positions.get(graph.nodes[i].id);
      const b = positions.get(graph.nodes[j].id);
      const extentA = extents.get(graph.nodes[i].id);
      const extentB = extents.get(graph.nodes[j].id);
      const overlapX = extentA.halfWidth + extentB.halfWidth + 130 - Math.abs(a.x - b.x);
      const overlapY = extentA.halfHeight + extentB.halfHeight + 130 - Math.abs(a.y - b.y);
      if (overlapX > 0 && overlapY > 0) return true;
    }
  }
  return false;
}

// Spring forces can leave a few rooms still touching once the map is crowded,
// so finish with pure separation (no springs pulling rooms back together)
// until every pair clears its required rectangular gap or iterations run out.
function separateOverlappingRooms(graph, roomNodes, positions, extents, width, height, margin, centralMinX, centralMaxX) {
  for (let iteration = 0; iteration < 150; iteration += 1) {
    let resolvedAny = false;
    for (let i = 0; i < graph.nodes.length; i += 1) {
      for (let j = i + 1; j < graph.nodes.length; j += 1) {
        const nodeA = graph.nodes[i];
        const nodeB = graph.nodes[j];
        const movableA = roomNodes.includes(nodeA);
        const movableB = roomNodes.includes(nodeB);
        if (!movableA && !movableB) continue;
        const a = positions.get(nodeA.id);
        const b = positions.get(nodeB.id);
        const extentA = extents.get(nodeA.id);
        const extentB = extents.get(nodeB.id);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const overlapX = extentA.halfWidth + extentB.halfWidth + 130 - Math.abs(dx);
        const overlapY = extentA.halfHeight + extentB.halfHeight + 130 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        resolvedAny = true;
        const moversCount = (movableA ? 1 : 0) + (movableB ? 1 : 0);
        const push = Math.min(overlapX, overlapY) / moversCount;
        const alongX = overlapX <= overlapY;
        const pushX = alongX ? Math.sign(dx || 1) * push : 0;
        const pushY = alongX ? 0 : Math.sign(dy || 1) * push;
        if (movableA) {
          a.x = clamp(a.x + pushX, centralMinX + extentA.halfWidth, centralMaxX - extentA.halfWidth);
          a.y = clamp(a.y + pushY, margin + extentA.halfHeight, height - margin - extentA.halfHeight);
        }
        if (movableB) {
          b.x = clamp(b.x - pushX, centralMinX + extentB.halfWidth, centralMaxX - extentB.halfWidth);
          b.y = clamp(b.y - pushY, margin + extentB.halfHeight, height - margin - extentB.halfHeight);
        }
      }
    }
    if (!resolvedAny) break;
  }
}

// Converts laid-out node positions into axis-aligned room rects, then routes
// each edge as an orthogonal corridor that enters each room on the side facing
// its neighbor, spreading multiple doors on the same side so they do not overlap.
function buildRoomsAndCorridors(random, graph, positions, extents, spawnZones, width, height) {
  const roomsById = new Map();
  for (const node of graph.nodes) {
    const position = positions.get(node.id);
    const extent = extents.get(node.id);
    roomsById.set(node.id, {
      id: node.id,
      x: position.x,
      y: position.y,
      width: extent.halfWidth * 2,
      height: extent.halfHeight * 2,
      isSpawn: node.isSpawn,
      team: node.team,
      value: node.value,
      shape: node.isSpawn ? 'rect' : node.shape,
      chamfer: node.isSpawn ? 0 : node.chamfer,
    });
  }

  for (const room of roomsById.values()) room.vertices = getRoomVertices(room);

  const corridorPlans = graph.edges.map((edge) => {
    const roomA = roomsById.get(edge.a);
    const roomB = roomsById.get(edge.b);
    const dx = roomB.x - roomA.x;
    const dy = roomB.y - roomA.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    return {
      id: edge.id,
      a: edge.a,
      b: edge.b,
      weight: edge.weight,
      width: randomInt(random, 60, 81),
      horizontal,
      sideA: horizontal ? (dx >= 0 ? 'east' : 'west') : (dy >= 0 ? 'south' : 'north'),
      sideB: horizontal ? (dx >= 0 ? 'west' : 'east') : (dy >= 0 ? 'north' : 'south'),
    };
  });

  for (const plan of corridorPlans) {
    const roomA = roomsById.get(plan.a);
    const roomB = roomsById.get(plan.b);
    plan.sideA = selectClearRoomSide(roomA, roomB, plan.sideA, plan.width, roomsById, width, height);
    plan.sideB = selectClearRoomSide(roomB, roomA, plan.sideB, plan.width, roomsById, width, height);
  }

  // Distribute every door sharing a room side evenly along that wall so they never overlap.
  const doorOffsets = new Map();
  for (const room of roomsById.values()) {
    for (const side of ['north', 'south', 'east', 'west']) {
      const attached = corridorPlans
        .map((plan) => (plan.a === room.id && plan.sideA === side ? { plan, end: 'a' }
          : plan.b === room.id && plan.sideB === side ? { plan, end: 'b' } : null))
        .filter(Boolean);
      if (attached.length === 0) continue;
      const axisVertical = side === 'east' || side === 'west';
      const half = (axisVertical ? room.height : room.width) / 2;
      const chamferInset = room.shape === 'chamfered' ? Math.min(room.width, room.height) * room.chamfer : 0;
      const margin = Math.max(...attached.map(({ plan }) => plan.width / 2)) + 10 + chamferInset;
      const extent = Math.max(half - margin, 0);
      attached.forEach(({ plan, end }, index) => {
        const t = attached.length === 1 ? 0 : (index / (attached.length - 1)) * 2 - 1;
        const coordinate = (axisVertical ? room.y : room.x) + t * extent;
        doorOffsets.set(`${plan.id}:${end}`, coordinate);
      });
    }
  }

  const corridors = corridorPlans.map((plan) => {
    const roomA = roomsById.get(plan.a);
    const roomB = roomsById.get(plan.b);
    const entryA = getRoomEntryPoint(roomA, plan.sideA, doorOffsets.get(`${plan.id}:a`));
    const entryB = getRoomEntryPoint(roomB, plan.sideB, doorOffsets.get(`${plan.id}:b`));
    const points = routeAroundRooms(entryA, entryB, plan, roomsById, width, height);
    return {
      id: plan.id,
      a: plan.a,
      b: plan.b,
      weight: plan.weight,
      width: plan.width,
      points,
      polygons: getCorridorPolygons(points, plan.width),
    };
  });

  return { rooms: [...roomsById.values()], corridors };
}

function getRoomEntryPoint(room, side, coordinate) {
  switch (side) {
    case 'west': return { x: room.x - room.width / 2, y: coordinate };
    case 'east': return { x: room.x + room.width / 2, y: coordinate };
    case 'north': return { x: coordinate, y: room.y - room.height / 2 };
    case 'south': return { x: coordinate, y: room.y + room.height / 2 };
    default: throw new Error(`Unknown room side: ${side}`);
  }
}

function getRoomVertices(room) {
  const left = room.x - room.width / 2;
  const right = room.x + room.width / 2;
  const top = room.y - room.height / 2;
  const bottom = room.y + room.height / 2;
  if (room.shape !== 'chamfered') {
    return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  }
  const cut = Math.min(room.width, room.height) * room.chamfer;
  return [
    { x: left + cut, y: top },
    { x: right - cut, y: top },
    { x: right, y: top + cut },
    { x: right, y: bottom - cut },
    { x: right - cut, y: bottom },
    { x: left + cut, y: bottom },
    { x: left, y: bottom - cut },
    { x: left, y: top + cut },
  ];
}

function getCorridorPolygons(points, width) {
  const halfWidth = width / 2;
  const polygons = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const normal = { x: -dy / length * halfWidth, y: dx / length * halfWidth };
    polygons.push([
      { x: start.x + normal.x, y: start.y + normal.y },
      { x: end.x + normal.x, y: end.y + normal.y },
      { x: end.x - normal.x, y: end.y - normal.y },
      { x: start.x - normal.x, y: start.y - normal.y },
    ]);
  }
  for (const point of points.slice(1, -1)) {
    polygons.push([
      { x: point.x, y: point.y - halfWidth },
      { x: point.x + halfWidth, y: point.y },
      { x: point.x, y: point.y + halfWidth },
      { x: point.x - halfWidth, y: point.y },
    ]);
  }
  return polygons;
}

function selectClearRoomSide(room, target, preferredSide, corridorWidth, roomsById, mapWidth, mapHeight) {
  const clearance = corridorWidth / 2 + 10;
  const candidates = ['north', 'south', 'east', 'west'].map((side) => {
    const coordinate = side === 'north' || side === 'south' ? room.x : room.y;
    const entry = getRoomEntryPoint(room, side, coordinate);
    const stub = offsetFromRoomSide(entry, side, clearance + 2);
    const sideLength = side === 'north' || side === 'south' ? room.width : room.height;
    const chamferInset = room.shape === 'chamfered' ? Math.min(room.width, room.height) * room.chamfer : 0;
    const sideFitsDoor = sideLength - 2 * chamferInset >= corridorWidth + 20;
    const insideMap = stub.x >= corridorWidth / 2 && stub.x <= mapWidth - corridorWidth / 2 &&
      stub.y >= corridorWidth / 2 && stub.y <= mapHeight - corridorWidth / 2;
    const clear = sideFitsDoor && insideMap && [...roomsById.values()].every((other) => {
      if (other.id === room.id) return true;
      return stub.x <= other.x - other.width / 2 - clearance || stub.x >= other.x + other.width / 2 + clearance ||
        stub.y <= other.y - other.height / 2 - clearance || stub.y >= other.y + other.height / 2 + clearance;
    });
    const normal = side === 'north' ? { x: 0, y: -1 } : side === 'south' ? { x: 0, y: 1 }
      : side === 'east' ? { x: 1, y: 0 } : { x: -1, y: 0 };
    const score = normal.x * (target.x - room.x) + normal.y * (target.y - room.y) + (side === preferredSide ? 10000 : 0);
    return { side, clear, score };
  });
  const available = candidates.filter((candidate) => candidate.clear);
  return (available.length > 0 ? available : candidates).sort((a, b) => b.score - a.score)[0].side;
}

function routeAroundRooms(entryA, entryB, plan, roomsById, mapWidth, mapHeight) {
  const clearance = plan.width / 2 + 10;
  const roomA = roomsById.get(plan.a);
  const roomB = roomsById.get(plan.b);
  const stubDistance = clearance + 2;
  const stubA = offsetFromRoomSide(entryA, plan.sideA, stubDistance);
  const stubB = offsetFromRoomSide(entryB, plan.sideB, stubDistance);
  const obstacles = [...roomsById.values()]
    .map((room) => ({
      left: room.x - room.width / 2 - clearance,
      right: room.x + room.width / 2 + clearance,
      top: room.y - room.height / 2 - clearance,
      bottom: room.y + room.height / 2 + clearance,
    }));
  const margin = plan.width / 2;
  const xChannels = [margin, mapWidth - margin, stubA.x, stubB.x];
  const yChannels = [margin, mapHeight - margin, stubA.y, stubB.y];
  for (const obstacle of obstacles) {
    if (obstacle.left >= margin && obstacle.left <= mapWidth - margin) xChannels.push(obstacle.left);
    if (obstacle.right >= margin && obstacle.right <= mapWidth - margin) xChannels.push(obstacle.right);
    if (obstacle.top >= margin && obstacle.top <= mapHeight - margin) yChannels.push(obstacle.top);
    if (obstacle.bottom >= margin && obstacle.bottom <= mapHeight - margin) yChannels.push(obstacle.bottom);
  }
  const route = findOrthogonalRoute(stubA, stubB, xChannels, yChannels, obstacles, margin, mapWidth - margin, mapHeight - margin);
  const fallback = plan.horizontal
    ? [stubA, { x: (stubA.x + stubB.x) / 2, y: stubA.y }, { x: (stubA.x + stubB.x) / 2, y: stubB.y }, stubB]
    : [stubA, { x: stubA.x, y: (stubA.y + stubB.y) / 2 }, { x: stubB.x, y: (stubA.y + stubB.y) / 2 }, stubB];
  return simplifyPath([entryA, ...(route ?? fallback), entryB]);
}

function findOrthogonalRoute(start, end, xChannels, yChannels, obstacles, min, maxX, maxY) {
  const xs = [...new Set(xChannels)].sort((a, b) => a - b);
  const ys = [...new Set(yChannels)].sort((a, b) => a - b);
  const yCount = ys.length;
  const nodeCount = xs.length * yCount;
  const valid = new Uint8Array(nodeCount);
  const position = (node) => ({ x: xs[Math.floor(node / yCount)], y: ys[node % yCount] });
  const nodeId = (x, y) => x * yCount + y;

  for (let x = 0; x < xs.length; x += 1) {
    for (let y = 0; y < ys.length; y += 1) {
      const point = { x: xs[x], y: ys[y] };
      valid[nodeId(x, y)] = point.x >= min && point.x <= maxX && point.y >= min && point.y <= maxY &&
        !obstacles.some((rect) => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom)
        ? 1 : 0;
    }
  }

  const startId = nodeId(xs.indexOf(start.x), ys.indexOf(start.y));
  const endId = nodeId(xs.indexOf(end.x), ys.indexOf(end.y));
  if (valid[startId] !== 1 || valid[endId] !== 1) return null;
  const distances = new Float64Array(nodeCount);
  distances.fill(Infinity);
  const previous = new Int32Array(nodeCount);
  previous.fill(-1);
  const visited = new Uint8Array(nodeCount);
  const queue = [];
  distances[startId] = 0;
  pushRouteNode(queue, { id: startId, distance: 0 });

  while (queue.length > 0) {
    const current = popRouteNode(queue);
    if (visited[current.id]) continue;
    visited[current.id] = 1;
    if (current.id === endId) break;
    const x = Math.floor(current.id / yCount);
    const y = current.id % yCount;
    const neighbors = [
      x > 0 ? nodeId(x - 1, y) : -1,
      x + 1 < xs.length ? nodeId(x + 1, y) : -1,
      y > 0 ? nodeId(x, y - 1) : -1,
      y + 1 < ys.length ? nodeId(x, y + 1) : -1,
    ];
    const from = position(current.id);
    for (const neighbor of neighbors) {
      if (neighbor < 0 || visited[neighbor] || valid[neighbor] !== 1) continue;
      const to = position(neighbor);
      if (!pathAvoidsRooms([from, to], obstacles)) continue;
      const distance = current.distance + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      if (distance >= distances[neighbor]) continue;
      distances[neighbor] = distance;
      previous[neighbor] = current.id;
      pushRouteNode(queue, { id: neighbor, distance });
    }
  }

  if (!Number.isFinite(distances[endId])) return null;
  const reversed = [];
  for (let node = endId; node >= 0; node = previous[node]) {
    reversed.push(position(node));
    if (node === startId) break;
  }
  return simplifyPath(reversed.reverse());
}

function pushRouteNode(heap, node) {
  let index = heap.length;
  heap.push(node);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].distance <= node.distance) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = node;
}

function popRouteNode(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    const child = right < heap.length && heap[right].distance < heap[left].distance ? right : left;
    if (heap[child].distance >= last.distance) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function offsetFromRoomSide(point, side, distance) {
  switch (side) {
    case 'west': return { x: point.x - distance, y: point.y };
    case 'east': return { x: point.x + distance, y: point.y };
    case 'north': return { x: point.x, y: point.y - distance };
    case 'south': return { x: point.x, y: point.y + distance };
    default: throw new Error(`Unknown room side: ${side}`);
  }
}

function pathAvoidsRooms(points, obstacles) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    for (const obstacle of obstacles) {
      if (Math.abs(a.y - b.y) < 1e-9) {
        if (a.y > obstacle.top && a.y < obstacle.bottom &&
            Math.max(Math.min(a.x, b.x), obstacle.left) < Math.min(Math.max(a.x, b.x), obstacle.right)) return false;
      } else if (Math.abs(a.x - b.x) < 1e-9 &&
          a.x > obstacle.left && a.x < obstacle.right &&
          Math.max(Math.min(a.y, b.y), obstacle.top) < Math.min(Math.max(a.y, b.y), obstacle.bottom)) return false;
    }
  }
  return true;
}

function simplifyPath(points) {
  const unique = [];
  for (const [index, point] of points.entries()) {
    const previous = unique.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.01) unique.push(point);
    else if (index === points.length - 1) unique[unique.length - 1] = point;
  }
  return unique.filter((point, index) => index === 0 || index === unique.length - 1 ||
    !((Math.abs(unique[index - 1].x - point.x) < 1e-9 && Math.abs(point.x - unique[index + 1].x) < 1e-9) ||
      (Math.abs(unique[index - 1].y - point.y) < 1e-9 && Math.abs(point.y - unique[index + 1].y) < 1e-9)));
}

function generateMapBoundaryWalls(rooms, corridors) {
  const polygons = rooms.map((room) => room.vertices);
  for (const corridor of corridors) polygons.push(...corridor.polygons);

  const edges = polygons.flatMap((polygon) => polygon.map((start, index) => ({
    start,
    end: polygon[(index + 1) % polygon.length],
  })).filter(({ start, end }) => Math.hypot(end.x - start.x, end.y - start.y) > 1e-6));
  const splitPoints = edges.map(({ start, end }) => [start, end]);

  for (let first = 0; first < edges.length; first += 1) {
    for (let second = first + 1; second < edges.length; second += 1) {
      const intersection = getSegmentIntersection(edges[first], edges[second]);
      if (!intersection) continue;
      splitPoints[first].push(intersection);
      splitPoints[second].push(intersection);
    }
  }

  const uniqueEdges = new Map();
  edges.forEach((edge, index) => {
    const points = splitPoints[index].sort((a, b) => distanceSquared(edge.start, a) - distanceSquared(edge.start, b));
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const start = points[pointIndex];
      const end = points[pointIndex + 1];
      if (distanceSquared(start, end) < 1e-8) continue;
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const normal = getSegmentNormal(start, end);
      const epsilon = 0.01;
      const leftInside = pointInAnyPolygon({ x: midpoint.x + normal.x * epsilon, y: midpoint.y + normal.y * epsilon }, polygons);
      const rightInside = pointInAnyPolygon({ x: midpoint.x - normal.x * epsilon, y: midpoint.y - normal.y * epsilon }, polygons);
      if (leftInside === rightInside) continue;
      const directedStart = leftInside ? start : end;
      const directedEnd = leftInside ? end : start;
      const key = `${coordinateKey(directedStart)}>${coordinateKey(directedEnd)}`;
      uniqueEdges.set(key, { start: directedStart, end: directedEnd });
    }
  });

  const boundaryEdges = [...uniqueEdges.values()];
  const outgoing = new Map();
  for (const edge of boundaryEdges) {
    const key = coordinateKey(edge.start);
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  }

  const unused = new Set(boundaryEdges);
  const walls = [];
  while (unused.size > 0) {
    const first = unused.values().next().value;
    const loop = [first.start];
    let current = first;
    let guard = boundaryEdges.length + 1;
    while (current && unused.has(current) && guard-- > 0) {
      unused.delete(current);
      loop.push(current.end);
      if (coordinateKey(current.end) === coordinateKey(first.start)) break;
      const candidates = (outgoing.get(coordinateKey(current.end)) ?? []).filter((edge) => unused.has(edge));
      current = selectBoundaryContinuation(current, candidates);
    }
    for (const segment of simplifyBoundaryLoop(loop)) {
      if (distanceSquared(segment.start, segment.end) < 1e-8) continue;
      walls.push(createMapObject(`map-wall-${walls.length + 1}`, 'segment', {
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
      }, 'map-wall'));
    }
  }
  return walls;
}

function getSegmentIntersection(first, second) {
  const a = first.start;
  const b = first.end;
  const c = second.start;
  const d = second.end;
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const firstT = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const secondT = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (firstT < -1e-9 || firstT > 1 + 1e-9 || secondT < -1e-9 || secondT > 1 + 1e-9) return null;
  return { x: a.x + firstT * (b.x - a.x), y: a.y + firstT * (b.y - a.y) };
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function getSegmentNormal(start, end) {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  return { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
}

function pointInAnyPolygon(point, polygons) {
  return polygons.some((polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y) &&
          point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  });
}

function coordinateKey(point) {
  return `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)}`;
}

function selectBoundaryContinuation(previous, candidates) {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const incoming = Math.atan2(previous.end.y - previous.start.y, previous.end.x - previous.start.x);
  return candidates.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestTurn = normalizeAngle(Math.atan2(best.end.y - best.start.y, best.end.x - best.start.x) - incoming);
    const candidateTurn = normalizeAngle(Math.atan2(candidate.end.y - candidate.start.y, candidate.end.x - candidate.start.x) - incoming);
    return candidateTurn < bestTurn ? candidate : best;
  }, null);
}

function simplifyBoundaryLoop(points) {
  const simplified = points.filter((point, index) => index === 0 ||
    coordinateKey(point) !== coordinateKey(points[index - 1]));
  const isClosed = simplified.length > 2 && coordinateKey(simplified[0]) === coordinateKey(simplified.at(-1));
  if (!isClosed) {
    const open = [...simplified];
    let changedOpen = true;
    while (changedOpen && open.length > 2) {
      changedOpen = false;
      for (let index = 1; index < open.length - 1; index += 1) {
        const previous = open[index - 1];
        const current = open[index];
        const next = open[index + 1];
        const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
        if (Math.abs(cross) < 1e-7) {
          open.splice(index, 1);
          changedOpen = true;
          break;
        }
      }
    }
    return open.slice(0, -1).map((start, index) => ({ start, end: open[index + 1] }));
  }
  let changed = true;
  while (changed && simplified.length > 3) {
    changed = false;
    for (let index = 0; index < simplified.length - 1; index += 1) {
      const previous = simplified[(index - 1 + simplified.length - 1) % (simplified.length - 1)];
      const current = simplified[index];
      const next = simplified[(index + 1) % (simplified.length - 1)];
      const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
      if (Math.abs(cross) < 1e-7) {
        simplified.splice(index, 1);
        simplified[simplified.length - 1] = simplified[0];
        changed = true;
        break;
      }
    }
  }
  return simplified.slice(0, -1).map((start, index, loop) => ({ start, end: loop[(index + 1) % loop.length] }));
}

function normalizeAngle(angle) {
  return (angle + Math.PI * 2) % (Math.PI * 2);
}

function analyzeSiteSightlines(
  rooms,
  corridors,
  walls,
  width,
  height,
  maxSiteApproachSightline = COMPETITIVE_MAP_RULES.maxSiteApproachSightline,
) {
  const red = rooms.find((room) => room.isSpawn && room.team === 'red');
  const blue = rooms.find((room) => room.isSpawn && room.team === 'blue');
  const spawnRooms = [red, blue];
  const redPoints = sampleRoomInterior(red);
  const bluePoints = sampleRoomInterior(blue);
  let sampledVisiblePairs = 0;
  for (const redPoint of redPoints) {
    for (const bluePoint of bluePoints) {
      if (hasClearLineOfSight(redPoint, bluePoint, walls)) sampledVisiblePairs += 1;
    }
  }

  const polygons = [...rooms.map((room) => room.vertices), ...corridors.flatMap((corridor) => corridor.polygons)];
  const nearSitePolygons = spawnRooms.map((room) => room.vertices);
  let nearSiteSampleCount = 0;
  let longNearSiteSightlineCount = 0;
  let maxNearSiteSightline = 0;
  const coneStep = Math.PI * 2 / 32;
  const rayLength = Math.hypot(width, height) * 2;
  const wallSegments = walls.map((wall) => ({ start: { x: wall.x1, y: wall.y1 }, end: { x: wall.x2, y: wall.y2 } }));
  const zones = spawnRooms.map((room) => ({
    left: room.x - room.width / 2,
    right: room.x + room.width / 2,
    top: room.y - room.height / 2,
    bottom: room.y + room.height / 2,
  }));
  for (let y = SITE_APPROACH_SAMPLE_SIZE / 2; y < height; y += SITE_APPROACH_SAMPLE_SIZE) {
    for (let x = SITE_APPROACH_SAMPLE_SIZE / 2; x < width; x += SITE_APPROACH_SAMPLE_SIZE) {
      const origin = { x, y };
      if (!pointInAnyPolygon(origin, polygons) || pointInAnyPolygon(origin, nearSitePolygons)) continue;
      const siteDistances = zones.map((zone) => {
        const dx = Math.max(zone.left - x, 0, x - zone.right);
        const dy = Math.max(zone.top - y, 0, y - zone.bottom);
        return Math.hypot(dx, dy);
      });
      const nearestSiteIndex = siteDistances[0] <= siteDistances[1] ? 0 : 1;
      const distanceToSite = siteDistances[nearestSiteIndex];
      if (distanceToSite > SITE_APPROACH_CLEARANCE) continue;
      nearSiteSampleCount += 1;
      const opposingSite = spawnRooms[1 - nearestSiteIndex];
      const targetAngle = Math.atan2(opposingSite.y - y, opposingSite.x - x);
      for (let coneStepIndex = -SITE_APPROACH_CONE_STEPS; coneStepIndex <= SITE_APPROACH_CONE_STEPS; coneStepIndex += 1) {
        const angle = targetAngle + coneStepIndex * coneStep;
        const ray = { x: Math.cos(angle), y: Math.sin(angle) };
        let distance = rayLength;
        for (const wall of wallSegments) distance = Math.min(distance, raySegmentDistance(origin, ray, wall));
        maxNearSiteSightline = Math.max(maxNearSiteSightline, distance);
        if (distance > maxSiteApproachSightline) longNearSiteSightlineCount += 1;
      }
    }
  }

  const centerlineClear = hasClearLineOfSight(
    { x: red.x, y: red.y },
    { x: blue.x, y: blue.y },
    walls,
  );
  return {
    centerlineBlocked: !centerlineClear,
    baffleAdded: walls.some((wall) => wall.role === 'sightline-baffle'),
    sampledPairCount: redPoints.length * bluePoints.length,
    sampledVisiblePairs,
    mutuallyOccluded: sampledVisiblePairs === 0,
    nearSiteSampleCount,
    longNearSiteSightlineCount,
    maxNearSiteSightline: Math.round(maxNearSiteSightline),
  };
}

function sampleRoomInterior(room) {
  const points = [];
  const margin = 12;
  for (let row = 0; row < SITE_SIGHTLINE_SAMPLE_DIVISIONS; row += 1) {
    for (let column = 0; column < SITE_SIGHTLINE_SAMPLE_DIVISIONS; column += 1) {
      points.push({
        x: room.x - room.width / 2 + margin + (room.width - margin * 2) * column / (SITE_SIGHTLINE_SAMPLE_DIVISIONS - 1),
        y: room.y - room.height / 2 + margin + (room.height - margin * 2) * row / (SITE_SIGHTLINE_SAMPLE_DIVISIONS - 1),
      });
    }
  }
  return points;
}

function hasClearLineOfSight(start, end, walls) {
  for (const wall of walls) {
    if (!segmentMapObjectBoundsOverlap(start, end, wall)) continue;
    const entry = segmentMapObjectEntryT(start, end, wall, 0);
    if (entry !== null && entry > 1e-8 && entry < 1 - 1e-8) return false;
  }
  return true;
}

function computeMapMetrics({ rooms, corridors, graph, width, height, sightlineBaffle, siteSightline, interiorWalls }) {
  const nonSpawnRooms = rooms.filter((room) => !room.isSpawn);
  const routeStats = analyzeSpawnRoutes(graph, 'red-spawn', 'blue-spawn');
  const siteDoorways = analyzeSiteDoorways(rooms, corridors, graph);
  const loopCount = Math.max(0, graph.edges.length - graph.nodes.length + 1);
  const averageDegree = graph.nodes.reduce((sum, node) => sum + routeStats.adjacency.get(node.id).length, 0) / graph.nodes.length;
  const averageEccentricity = computeAverageEccentricity(graph, routeStats.adjacency, routeStats.edgeLengths);
  const polygons = [...rooms.map((room) => room.vertices), ...corridors.flatMap((corridor) => corridor.polygons)];
  const spatialStats = sampleSpatialMetrics(polygons, width, height, interiorWalls);
  const junctionCount = graph.nodes.filter((node) => routeStats.adjacency.get(node.id).length >= 3).length;
  const junctionRatio = junctionCount / graph.nodes.length;
  const largeRoomAreaRatio = nonSpawnRooms.filter((room) => room.width * room.height >= 50000).length / Math.max(nonSpawnRooms.length, 1);
  const aggressionScore = clamp(
    spatialStats.visibility.averageOpenAngleRatio * 0.4 +
    spatialStats.visibility.averageSightlineRatio * 0.3 +
    largeRoomAreaRatio * 0.15 +
    junctionRatio * 0.15,
    0,
    1,
  );

  const shortestPathLength = shortestWeightedDistance(routeStats.adjacency, routeStats.edgeLengths, 'red-spawn', 'blue-spawn');
  const estimatedEngagementSeconds = shortestPathLength / 180 +
    (1 - spatialStats.visibility.averageOpenAngleRatio) * 2;
  const estimatedFightOpportunities = Math.max(1,
    Math.log1p(routeStats.routeCount) * 0.45 +
    routeStats.usedRoomCount * 0.12 +
    loopCount * 0.12 +
    junctionCount * 0.1);
  const paceRate = estimatedFightOpportunities / Math.max(estimatedEngagementSeconds, 0.25);
  const paceScore = clamp(2 / (1 + Math.exp(-5 * paceRate)) - 1, 0, 1);
  const complexityScore = clamp(
    (Math.log1p(routeStats.routeCount) / Math.log(9)) * 0.45 +
    (loopCount / Math.max(nonSpawnRooms.length, 1)) * 0.35 +
    (averageDegree / 5) * 0.2,
    0,
    1,
  );

  return {
    siteSightline: { ...siteSightline, baffleAdded: sightlineBaffle.added },
    siteDoorways,
    roomUtilization: {
      usedRooms: routeStats.usedRoomCount,
      totalRooms: nonSpawnRooms.length,
      ratio: routeStats.usedRoomCount / Math.max(nonSpawnRooms.length, 1),
      percent: roundTo(routeStats.usedRoomCount / Math.max(nonSpawnRooms.length, 1), 2),
      deadEndRooms: routeStats.deadEndRoomCount,
      offRouteRooms: routeStats.offRouteRoomCount,
      nearOptimalRooms: routeStats.nearOptimalRoomCount,
      criticalRooms: routeStats.criticalRoomCount,
      maxDetourPercent: Math.round(USEFUL_ROUTE_DETOUR_RATIO * 100),
    },
    complexity: {
      score: roundTo(complexityScore, 2),
      label: scoreLabel(complexityScore, ['Simple', 'Moderate', 'Complex']),
      routeCount: routeStats.routeCount,
      routeCountCapped: routeStats.routeCountCapped,
      loopCount,
      averageDegree: roundTo(averageDegree, 2),
    },
    topology: {
      walkableAreaPercent: spatialStats.walkableAreaPercent,
      xSymmetryPercent: spatialStats.xSymmetryPercent,
      ySymmetryPercent: spatialStats.ySymmetryPercent,
      maxSymmetryPercent: Math.max(spatialStats.xSymmetryPercent, spatialStats.ySymmetryPercent),
      averageEccentricity: Math.round(averageEccentricity),
    },
    visibility: {
      averageOpenAngleRatio: roundTo(spatialStats.visibility.averageOpenAngleRatio, 2),
      averageVisibleDirections: roundTo(spatialStats.visibility.averageVisibleDirections, 1),
      maxVisibleDirections: spatialStats.visibility.maxVisibleDirections,
      maxSightline: Math.round(spatialStats.visibility.maxSightline),
    },
    aggressiveness: {
      score: roundTo(aggressionScore, 2),
      label: scoreLabel(aggressionScore, ['Defensive', 'Balanced', 'Aggressive']),
      basis: 'sampled visibility, room size, and junction density',
    },
    pace: {
      score: roundTo(paceScore, 2),
      label: scoreLabel(paceScore, ['Slow', 'Moderate', 'Fast']),
      estimated: true,
      basis: 'topology estimate; not bot-simulated',
      estimatedEngagementSeconds: roundTo(estimatedEngagementSeconds, 1),
      estimatedFightOpportunities: roundTo(estimatedFightOpportunities, 1),
    },
    routeCount: routeStats.routeCount,
    shortestPathHops: routeStats.shortestPathHops,
    roomCount: nonSpawnRooms.length,
    corridorCount: corridors.length,
    averageRoomArea: Math.round(nonSpawnRooms.reduce((sum, room) => sum + room.width * room.height, 0) / Math.max(nonSpawnRooms.length, 1)),
  };
}

export function analyzeSiteDoorways(rooms, corridors, graph) {
  return Object.fromEntries(['red', 'blue'].map((team) => {
    const spawnId = `${team}-spawn`;
    const spawnRoom = rooms.find((room) => room.id === spawnId && room.isSpawn);
    if (!spawnRoom) throw new Error(`Missing ${team} spawn room while measuring site doorways.`);

    const intervalsBySide = new Map(['north', 'south', 'east', 'west'].map((side) => [side, []]));
    for (const corridor of corridors) {
      const isStart = corridor.a === spawnId;
      if (!isStart && corridor.b !== spawnId) continue;
      const endpoint = isStart ? corridor.points[0] : corridor.points.at(-1);
      const side = getRoomSideAtPoint(spawnRoom, endpoint);
      if (!side) continue;
      const isVerticalWall = side === 'east' || side === 'west';
      const wallStart = isVerticalWall ? spawnRoom.y - spawnRoom.height / 2 : spawnRoom.x - spawnRoom.width / 2;
      const wallEnd = isVerticalWall ? spawnRoom.y + spawnRoom.height / 2 : spawnRoom.x + spawnRoom.width / 2;
      const center = isVerticalWall ? endpoint.y : endpoint.x;
      const start = clamp(center - corridor.width / 2, wallStart, wallEnd);
      const end = clamp(center + corridor.width / 2, wallStart, wallEnd);
      if (end > start) intervalsBySide.get(side).push({ start, end });
    }

    const openings = [];
    for (const [side, intervals] of intervalsBySide) {
      intervals.sort((a, b) => a.start - b.start);
      for (const interval of intervals) {
        const previous = openings.at(-1);
        if (previous?.side === side && interval.start <= previous.end + 1e-6) {
          previous.end = Math.max(previous.end, interval.end);
          previous.connectionCount += 1;
        } else {
          openings.push({ side, start: interval.start, end: interval.end, connectionCount: 1 });
        }
      }
    }

    const graphEdgeCount = graph.edges.filter((edge) => edge.a === spawnId || edge.b === spawnId).length;
    return [team, {
      doorwayCount: openings.length,
      graphEdgeCount,
      mergedConnections: graphEdgeCount - openings.length,
      openings: openings.map(({ side, start, end, connectionCount }) => ({
        side,
        width: roundTo(end - start, 1),
        connectionCount,
      })),
    }];
  }));
}

function getRoomSideAtPoint(room, point) {
  const tolerance = 1e-5;
  if (Math.abs(point.x - (room.x - room.width / 2)) < tolerance) return 'west';
  if (Math.abs(point.x - (room.x + room.width / 2)) < tolerance) return 'east';
  if (Math.abs(point.y - (room.y - room.height / 2)) < tolerance) return 'north';
  if (Math.abs(point.y - (room.y + room.height / 2)) < tolerance) return 'south';
  return null;
}

function analyzeSpawnRoutes(graph, startId, endId, routeLimit = 10000) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  const edgeLengths = new Map();
  for (const edge of graph.edges) {
    const length = edge.layoutLength ?? edge.weight;
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
    edgeLengths.set(`${edge.a}:${edge.b}`, length);
    edgeLengths.set(`${edge.b}:${edge.a}`, length);
  }
  const visited = new Set([startId]);
  let routeCount = 0;
  let routeCountCapped = false;
  const visit = (nodeId) => {
    if (routeCount >= routeLimit) {
      routeCountCapped = true;
      return;
    }
    if (nodeId === endId) {
      routeCount += 1;
      return;
    }
    for (const neighbor of adjacency.get(nodeId)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      visit(neighbor);
      visited.delete(neighbor);
      if (routeCountCapped) return;
    }
  };
  visit(startId);

  const utilization = calculateRoomUtilization(graph, adjacency, edgeLengths, startId, endId);
  return {
    adjacency,
    edgeLengths,
    ...utilization,
    routeCount,
    routeCountCapped,
    shortestPathHops: shortestHopCount(graph, startId, endId),
  };
}

export function analyzeRoomUtilization(graph, startId = 'red-spawn', endId = 'blue-spawn') {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  const edgeLengths = new Map();
  for (const edge of graph.edges) {
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
    const length = edge.layoutLength ?? edge.weight ?? 1;
    edgeLengths.set(`${edge.a}:${edge.b}`, length);
    edgeLengths.set(`${edge.b}:${edge.a}`, length);
  }
  return calculateRoomUtilization(graph, adjacency, edgeLengths, startId, endId);
}

function calculateRoomUtilization(graph, adjacency, edgeLengths, startId, endId) {
  const nonSpawnNodes = graph.nodes.filter((node) => !node.isSpawn);
  const fromStart = shortestDistances(adjacency, edgeLengths, startId);
  const shortestLength = fromStart.get(endId) ?? Infinity;
  const nearOptimalRoomIds = findRoomsOnNearOptimalSimpleRoutes(
    nonSpawnNodes,
    adjacency,
    edgeLengths,
    startId,
    endId,
    shortestLength,
  );
  const criticalRoomIds = new Set();
  for (const node of nonSpawnNodes) {
    const withoutRoom = shortestDistances(adjacency, edgeLengths, startId, node.id).get(endId) ?? Infinity;
    const critical = !Number.isFinite(withoutRoom) ||
      withoutRoom > shortestLength * (1 + USEFUL_ROUTE_DETOUR_RATIO);
    if (critical) criticalRoomIds.add(node.id);
  }
  const usefulRoomIds = new Set([...nearOptimalRoomIds, ...criticalRoomIds]);
  const deadEndRoomCount = nonSpawnNodes.filter((node) => adjacency.get(node.id).length <= 1).length;
  return {
    usedRoomCount: usefulRoomIds.size,
    deadEndRoomCount,
    offRouteRoomCount: nonSpawnNodes.length - usefulRoomIds.size,
    nearOptimalRoomCount: nearOptimalRoomIds.size,
    criticalRoomCount: criticalRoomIds.size,
  };
}

function findRoomsOnNearOptimalSimpleRoutes(nonSpawnNodes, adjacency, edgeLengths, startId, endId, shortestLength) {
  const threshold = shortestLength * (1 + USEFUL_ROUTE_DETOUR_RATIO);
  const nearOptimalRoomIds = new Set();
  if (!Number.isFinite(shortestLength)) return nearOptimalRoomIds;
  const nonSpawnIds = new Set(nonSpawnNodes.map((node) => node.id));
  const visited = new Set([startId]);
  const path = [startId];
  const visit = (nodeId, length) => {
    if (nearOptimalRoomIds.size === nonSpawnIds.size || length > threshold + 1e-9) return;
    if (nodeId === endId) {
      for (const id of path) if (nonSpawnIds.has(id)) nearOptimalRoomIds.add(id);
      return;
    }
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (visited.has(neighbor)) continue;
      const nextLength = length + (edgeLengths.get(`${nodeId}:${neighbor}`) ?? 1);
      if (nextLength > threshold + 1e-9) continue;
      visited.add(neighbor);
      path.push(neighbor);
      visit(neighbor, nextLength);
      path.pop();
      visited.delete(neighbor);
    }
  };
  visit(startId, 0);
  return nearOptimalRoomIds;
}

function computeAverageEccentricity(graph, adjacency, edgeLengths) {
  const eccentricities = graph.nodes.map((node) => {
    const distances = shortestDistances(adjacency, edgeLengths, node.id);
    return Math.max(...distances.values());
  });
  return eccentricities.reduce((sum, value) => sum + value, 0) / Math.max(eccentricities.length, 1);
}

function shortestWeightedDistance(adjacency, edgeLengths, startId, endId) {
  return shortestDistances(adjacency, edgeLengths, startId).get(endId) ?? Infinity;
}

function shortestDistances(adjacency, edgeLengths, startId, excludedNodeId = null) {
  const distances = new Map([...adjacency.keys()].map((id) => [id, Infinity]));
  const remaining = new Set([...adjacency.keys()].filter((id) => id !== excludedNodeId));
  if (startId === excludedNodeId) return distances;
  distances.set(startId, 0);
  while (remaining.size > 0) {
    let current = null;
    for (const id of remaining) {
      if (current === null || distances.get(id) < distances.get(current)) current = id;
    }
    if (current === null || !Number.isFinite(distances.get(current))) break;
    remaining.delete(current);
    for (const neighbor of adjacency.get(current)) {
      if (!remaining.has(neighbor)) continue;
      const candidate = distances.get(current) + (edgeLengths.get(`${current}:${neighbor}`) ?? 1);
      if (candidate < distances.get(neighbor)) distances.set(neighbor, candidate);
    }
  }
  return distances;
}

function sampleSpatialMetrics(polygons, width, height, interiorWalls = []) {
  const cellSize = 30;
  const columns = Math.floor(width / cellSize);
  const rows = Math.floor(height / cellSize);
  const walkable = new Uint8Array(columns * rows);
  const index = (column, row) => row * columns + column;
  let walkableCount = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!pointInAnyPolygon({ x: (column + 0.5) * cellSize, y: (row + 0.5) * cellSize }, polygons)) continue;
      walkable[index(column, row)] = 1;
      walkableCount += 1;
    }
  }

  const symmetry = (flipX) => {
    let intersection = 0;
    let union = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const mirrorColumn = flipX ? columns - 1 - column : column;
        const mirrorRow = flipX ? row : rows - 1 - row;
        const current = walkable[index(column, row)];
        const mirror = walkable[index(mirrorColumn, mirrorRow)];
        if (current && mirror) intersection += 1;
        if (current || mirror) union += 1;
      }
    }
    return roundTo(union ? intersection / union * 100 : 100, 1);
  };

  const visibility = estimateVisibility(polygons, cellSize, columns, rows, width, height, interiorWalls);
  return {
    walkableAreaPercent: roundTo(walkableCount / (columns * rows) * 100, 1),
    xSymmetryPercent: symmetry(true),
    ySymmetryPercent: symmetry(false),
    visibility,
  };
}

function estimateVisibility(polygons, cellSize, columns, rows, width, height, interiorWalls = []) {
  const directions = Array.from({ length: 16 }, (_, index) => index * Math.PI / 8);
  const maximumRay = 450;
  const sampleStep = 3;
  const walls = [];
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      walls.push({ start: polygon[index], end: polygon[(index + 1) % polygon.length] });
    }
  }
  walls.push(...interiorWalls.map((wall) => ({ start: { x: wall.x1, y: wall.y1 }, end: { x: wall.x2, y: wall.y2 } })));
  let openAngleTotal = 0;
  let visibleDirectionTotal = 0;
  let sightlineDistanceTotal = 0;
  let sampleCount = 0;
  let maxVisibleDirections = 0;
  let maxSightline = 0;
  for (let row = 1; row < rows; row += sampleStep) {
    for (let column = 1; column < columns; column += sampleStep) {
      const origin = { x: (column + 0.5) * cellSize, y: (row + 0.5) * cellSize };
      if (!pointInAnyPolygon(origin, polygons)) continue;
      sampleCount += 1;
      let visibleDirections = 0;
      for (const angle of directions) {
        const ray = { x: Math.cos(angle), y: Math.sin(angle) };
        let distance = maximumRay;
        for (const wall of walls) distance = Math.min(distance, raySegmentDistance(origin, ray, wall));
        maxSightline = Math.max(maxSightline, distance);
        sightlineDistanceTotal += distance;
        if (distance >= 180) visibleDirections += 1;
      }
      visibleDirectionTotal += visibleDirections;
      openAngleTotal += visibleDirections / directions.length;
      maxVisibleDirections = Math.max(maxVisibleDirections, visibleDirections);
    }
  }
  return {
    averageOpenAngleRatio: openAngleTotal / Math.max(sampleCount, 1),
    averageVisibleDirections: visibleDirectionTotal / Math.max(sampleCount, 1),
    averageSightlineRatio: sightlineDistanceTotal / (Math.max(sampleCount, 1) * directions.length * maximumRay),
    averageSightline: sightlineDistanceTotal / (Math.max(sampleCount, 1) * directions.length),
    maxVisibleDirections,
    maxSightline,
    sampleCount,
  };
}

function raySegmentDistance(origin, ray, segment) {
  const sx = segment.end.x - segment.start.x;
  const sy = segment.end.y - segment.start.y;
  const denominator = ray.x * sy - ray.y * sx;
  if (Math.abs(denominator) < 1e-9) return Infinity;
  const dx = segment.start.x - origin.x;
  const dy = segment.start.y - origin.y;
  const rayT = (dx * sy - dy * sx) / denominator;
  const segmentT = (dx * ray.y - dy * ray.x) / denominator;
  return rayT >= 0 && segmentT >= 0 && segmentT <= 1 ? rayT : Infinity;
}

function scoreLabel(score, labels) {
  return labels[Math.min(labels.length - 1, Math.floor(score * labels.length))];
}

function shortestHopCount(graph, startId, endId) {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    adjacency.get(edge.a).push(edge.b);
    adjacency.get(edge.b).push(edge.a);
  }
  const visited = new Set([startId]);
  let frontier = [startId];
  let hops = 0;
  while (frontier.length > 0) {
    if (frontier.includes(endId)) return hops;
    const next = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    hops += 1;
  }
  return Infinity;
}

function pathLength(points) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
  }
  return length;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function createRandom(seed) {
  // Small sequential seeds barely perturb xorshift32's first output, so pre-mix
  // the seed through an integer hash to get good avalanche from the first call.
  let state = seed >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomInt(random, minimum, maximumExclusive) {
  return Math.floor(random() * (maximumExclusive - minimum)) + minimum;
}

function randomBetween(random, minimum, maximum) {
  return minimum + random() * (maximum - minimum);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
