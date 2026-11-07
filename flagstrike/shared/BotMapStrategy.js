const strategiesByMap = new WeakMap();
const strategiesByKey = new Map();
const MAX_CACHED_MAP_STRATEGIES = 8;

export function getBotMapStrategy(map) {
  if (!map || typeof map !== 'object') {
    throw new TypeError('A map is required to build bot map strategy.');
  }

  const cachedByIdentity = strategiesByMap.get(map);
  if (cachedByIdentity) return cachedByIdentity;

  const cacheKey = getMapCacheKey(map);
  const cachedByKey = cacheKey ? strategiesByKey.get(cacheKey) : null;
  if (cachedByKey) {
    strategiesByKey.delete(cacheKey);
    strategiesByKey.set(cacheKey, cachedByKey);
    strategiesByMap.set(map, cachedByKey);
    return cachedByKey;
  }

  const strategy = createBotMapStrategy(map);
  strategiesByMap.set(map, strategy);
  if (cacheKey) {
    strategiesByKey.set(cacheKey, strategy);
    while (strategiesByKey.size > MAX_CACHED_MAP_STRATEGIES) {
      strategiesByKey.delete(strategiesByKey.keys().next().value);
    }
  }
  return strategy;
}

function getMapCacheKey(map) {
  if (!Number.isInteger(map.seed) || !map.generatorVersion) return null;
  const options = map.mapOptions ?? {};
  return [
    map.generatorVersion,
    map.seed,
    map.width,
    map.height,
    options.minRooms ?? '',
    options.maxRooms ?? '',
  ].join(':');
}

function createBotMapStrategy(map) {
  const rooms = map.rooms ?? [];
  const corridors = map.corridors ?? [];
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const corridorsByRoom = new Map(rooms.map((room) => [room.id, []]));

  for (const corridor of corridors) {
    const firstEdges = corridorsByRoom.get(corridor.a);
    const secondEdges = corridorsByRoom.get(corridor.b);
    const firstRoom = roomsById.get(corridor.a);
    const secondRoom = roomsById.get(corridor.b);
    if (firstEdges && secondRoom) {
      firstEdges.push({
        roomId: corridor.b,
        corridor,
        cost: polylineLength(corridor.points) || distance(firstRoom, secondRoom),
      });
    }
    if (secondEdges && firstRoom) {
      secondEdges.push({
        roomId: corridor.a,
        corridor,
        cost: polylineLength(corridor.points) || distance(firstRoom, secondRoom),
      });
    }
  }

  const pathsByStart = new Map();
  return {
    rooms,
    corridors,
    roomsById,
    findRoomPath(startId, goalId) {
      let pathsByGoal = pathsByStart.get(startId);
      if (!pathsByGoal) {
        pathsByGoal = new Map();
        pathsByStart.set(startId, pathsByGoal);
      } else if (pathsByGoal.has(goalId)) {
        return pathsByGoal.get(goalId);
      }

      const path = findRoomPath(startId, goalId, rooms, corridorsByRoom);
      pathsByGoal.set(goalId, path);
      return path;
    },
  };
}

function findRoomPath(startId, goalId, rooms, corridorsByRoom) {
  if (startId === goalId) return { nodes: [startId], edges: [], distance: 0 };

  const distances = new Map([[startId, 0]]);
  const previous = new Map();
  const unvisited = new Set(rooms.map((room) => room.id));
  while (unvisited.size > 0) {
    let current = null;
    let best = Infinity;
    for (const id of unvisited) {
      const candidate = distances.get(id) ?? Infinity;
      if (candidate < best) {
        current = id;
        best = candidate;
      }
    }
    if (current === null || current === goalId) break;
    unvisited.delete(current);
    for (const edge of corridorsByRoom.get(current) ?? []) {
      if (!unvisited.has(edge.roomId)) continue;
      const alternate = best + edge.cost;
      if (alternate >= (distances.get(edge.roomId) ?? Infinity)) continue;
      distances.set(edge.roomId, alternate);
      previous.set(edge.roomId, { id: current, corridor: edge.corridor });
    }
  }
  if (!distances.has(goalId)) return null;

  const nodes = [goalId];
  const edges = [];
  let cursor = goalId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) return null;
    edges.unshift(step.corridor);
    cursor = step.id;
    nodes.unshift(cursor);
  }
  return { nodes, edges, distance: distances.get(goalId) };
}

function polylineLength(points = []) {
  let length = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    length += distance(points[index], points[index + 1]);
  }
  return length;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
