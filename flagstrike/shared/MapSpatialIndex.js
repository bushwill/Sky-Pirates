const CELL_SIZE = 128;
const MAX_CELLS_PER_OBJECT = 64;
const MAX_QUERY_CELLS = 128;
const indexCache = new WeakMap();

function getObjectBounds(object) {
  if (object.shape === 'circle') {
    return {
      minX: object.x - object.radius,
      minY: object.y - object.radius,
      maxX: object.x + object.radius,
      maxY: object.y + object.radius,
    };
  }
  if (object.shape === 'rect') {
    return {
      minX: object.x - object.width / 2,
      minY: object.y - object.height / 2,
      maxX: object.x + object.width / 2,
      maxY: object.y + object.height / 2,
    };
  }
  if (object.shape === 'segment') {
    return {
      minX: Math.min(object.x1, object.x2),
      minY: Math.min(object.y1, object.y2),
      maxX: Math.max(object.x1, object.x2),
      maxY: Math.max(object.y1, object.y2),
    };
  }
  return null;
}

function getCellRange(bounds) {
  return {
    minX: Math.floor(bounds.minX / CELL_SIZE),
    minY: Math.floor(bounds.minY / CELL_SIZE),
    maxX: Math.floor(bounds.maxX / CELL_SIZE),
    maxY: Math.floor(bounds.maxY / CELL_SIZE),
  };
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function buildIndex(objects) {
  const cells = new Map();
  const largeObjectIndices = [];
  let minCellX = Infinity;
  let minCellY = Infinity;
  let maxCellX = -Infinity;
  let maxCellY = -Infinity;

  for (let index = 0; index < objects.length; index += 1) {
    const bounds = getObjectBounds(objects[index]);
    if (!bounds) continue;
    const range = getCellRange(bounds);
    const cellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
    minCellX = Math.min(minCellX, range.minX);
    minCellY = Math.min(minCellY, range.minY);
    maxCellX = Math.max(maxCellX, range.maxX);
    maxCellY = Math.max(maxCellY, range.maxY);
    if (cellCount > MAX_CELLS_PER_OBJECT) {
      largeObjectIndices.push(index);
      continue;
    }
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        const key = cellKey(x, y);
        const indices = cells.get(key) ?? [];
        indices.push(index);
        cells.set(key, indices);
      }
    }
  }

  const index = {
    cells,
    largeObjectIndices,
    marks: new Uint32Array(objects.length),
    generation: 0,
    gridCellCount: Number.isFinite(minCellX)
      ? (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1)
      : 0,
  };
  indexCache.set(objects, index);
  return index;
}

function getIndex(objects) {
  let index = indexCache.get(objects);
  if (!index || index.marks.length !== objects.length) index = buildIndex(objects);
  return index;
}

/** Visits geometry whose bounding boxes overlap a query AABB, in original array order. */
export function forEachMapObjectInBounds(objects, bounds, visit) {
  if (!Array.isArray(objects) || objects.length <= 32) {
    for (const object of objects ?? []) visit(object);
    return;
  }

  const index = getIndex(objects);
  const range = getCellRange(bounds);
  const queryCellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
  if (!Number.isFinite(queryCellCount) || queryCellCount > Math.max(MAX_QUERY_CELLS, index.gridCellCount * 0.6)) {
    for (const object of objects) visit(object);
    return;
  }

  visitIndexedCandidates(objects, index, (addCandidate) => {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (const objectIndex of index.cells.get(cellKey(x, y)) ?? []) addCandidate(objectIndex);
      }
    }
  }, visit);
}

/** Returns whether any geometry overlapping a query AABB passes the predicate. */
export function someMapObjectInBounds(objects, bounds, predicate) {
  if (!Array.isArray(objects)) return objects.some(predicate);
  if (objects.length <= 32) return objects.some(predicate);

  const index = getIndex(objects);
  const range = getCellRange(bounds);
  const queryCellCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
  if (!Number.isFinite(queryCellCount) || queryCellCount > Math.max(MAX_QUERY_CELLS, index.gridCellCount * 0.6)) {
    return objects.some(predicate);
  }

  return someIndexedCandidates(objects, index, (visitCandidate) => {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (const objectIndex of index.cells.get(cellKey(x, y)) ?? []) {
          if (visitCandidate(objectIndex)) return true;
        }
      }
    }
    return false;
  }, predicate);
}

/** Visits objects whose bounds can intersect a line segment, using grid traversal. */
export function forEachMapObjectAlongSegment(objects, start, end, padding, visit) {
  if (!Array.isArray(objects) || objects.length <= 32) {
    for (const object of objects ?? []) visit(object);
    return;
  }

  if (![start.x, start.y, end.x, end.y, padding].every(Number.isFinite)) {
    for (const object of objects) visit(object);
    return;
  }
  const index = getIndex(objects);
  visitIndexedCandidates(objects, index, (addCandidate) => {
    visitSegmentCells(index, start, end, padding, (objectIndex) => {
      addCandidate(objectIndex);
      return false;
    });
  }, visit);
}

/** Returns whether any geometry along a segment passes the predicate. */
export function someMapObjectAlongSegment(objects, start, end, padding, predicate) {
  if (!Array.isArray(objects) || objects.length <= 32) return (objects ?? []).some(predicate);
  if (![start.x, start.y, end.x, end.y, padding].every(Number.isFinite)) return objects.some(predicate);

  const index = getIndex(objects);
  return someIndexedCandidates(objects, index,
    (visitCandidate) => visitSegmentCells(index, start, end, padding, visitCandidate),
    predicate);
}

function visitSegmentCells(index, start, end, padding, visitObjectIndex) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const reachCells = Math.ceil(Math.max(0, padding) / CELL_SIZE) + 1;
  let cellX = Math.floor(start.x / CELL_SIZE);
  let cellY = Math.floor(start.y / CELL_SIZE);
  const endCellX = Math.floor(end.x / CELL_SIZE);
  const endCellY = Math.floor(end.y / CELL_SIZE);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : CELL_SIZE / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : CELL_SIZE / Math.abs(dy);
  let maxX = dx === 0 ? Infinity : ((stepX > 0 ? cellX + 1 : cellX) * CELL_SIZE - start.x) / dx;
  let maxY = dy === 0 ? Infinity : ((stepY > 0 ? cellY + 1 : cellY) * CELL_SIZE - start.y) / dy;

  while (true) {
    for (let y = cellY - reachCells; y <= cellY + reachCells; y += 1) {
      for (let x = cellX - reachCells; x <= cellX + reachCells; x += 1) {
        for (const objectIndex of index.cells.get(cellKey(x, y)) ?? []) {
          if (visitObjectIndex(objectIndex)) return true;
        }
      }
    }
    if (cellX === endCellX && cellY === endCellY) return false;
    if (maxX < maxY) {
      cellX += stepX;
      maxX += deltaX;
    } else if (maxY < maxX) {
      cellY += stepY;
      maxY += deltaY;
    } else {
      cellX += stepX;
      cellY += stepY;
      maxX += deltaX;
      maxY += deltaY;
    }
  }
}

function someIndexedCandidates(objects, index, collect, predicate) {
  const generation = nextGeneration(index);
  const testCandidate = (objectIndex) => {
    if (index.marks[objectIndex] === generation) return false;
    index.marks[objectIndex] = generation;
    return predicate(objects[objectIndex]);
  };
  for (const objectIndex of index.largeObjectIndices) {
    if (testCandidate(objectIndex)) return true;
  }
  return collect(testCandidate);
}

function visitIndexedCandidates(objects, index, collect, visit) {
  const generation = nextGeneration(index);
  const candidates = [];
  const addCandidate = (objectIndex) => {
    if (index.marks[objectIndex] === generation) return;
    index.marks[objectIndex] = generation;
    candidates.push(objectIndex);
  };

  for (const objectIndex of index.largeObjectIndices) addCandidate(objectIndex);
  collect(addCandidate);
  candidates.sort((left, right) => left - right);
  for (const objectIndex of candidates) visit(objects[objectIndex]);
}

function nextGeneration(index) {
  index.generation += 1;
  if (index.generation >= 0xffffffff) {
    index.marks.fill(0);
    index.generation = 1;
  }
  return index.generation;
}
