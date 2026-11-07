import { segmentMapObjectBoundsOverlap, segmentMapObjectEntryT } from './ProjectileModel.js';
import { someMapObjectAlongSegment } from './MapSpatialIndex.js';
import { getWeaponMuzzlePosition } from './WeaponGeometry.js';

export const VISION_HALF_ANGLE = 40 * Math.PI / 180;
export const VISION_MEMORY_CELL_SIZE = 4;
export const TEAMMATE_VISION_BASE_RAY_COUNT = 96;
const BASE_RAY_COUNT = 128;
const ANGLE_EPSILON = 1e-5;
const VISION_CORNER_PADDING = 2.5;
const WALL_MEMORY_FRAGMENT_LENGTH = 2;
const visionGeometryCache = new WeakMap();

export function getPlayerVisionOrigin(player, mapObjects = [], firingAngle) {
  const weaponId = player.selectedWeaponId ?? 'assault-rifle';
  const weaponAngle = Number.isFinite(firingAngle)
    ? firingAngle
    : player.weaponStats?.[weaponId]?.aimAngle ?? player.visionAngle ?? 0;
  return getWeaponMuzzlePosition(player, weaponAngle, player.weaponLean ?? 0, mapObjects);
}

export function createVision(
  origin,
  angle,
  mapObjects,
  mapWidth,
  mapHeight,
  halfAngle = VISION_HALF_ANGLE,
  maximumRange = Math.hypot(mapWidth, mapHeight) * 2,
  projectileRadius = 0,
  baseRayCount = BASE_RAY_COUNT,
) {
  if (!Number.isInteger(baseRayCount) || baseRayCount < 1) {
    throw new RangeError('Vision base ray count must be a positive integer.');
  }
  const visionObjects = getVisionCandidateObjects(origin, angle, halfAngle, maximumRange, projectileRadius, mapObjects);
  const angles = new Set();
  for (let index = 0; index <= baseRayCount; index += 1) {
    angles.add(angle - halfAngle + (2 * halfAngle * index) / baseRayCount);
  }
  for (const candidate of visionObjects) {
    for (const vertex of candidate.vertices) {
      const vertexAngle = Math.atan2(vertex.y - origin.y, vertex.x - origin.x);
      const difference = normalizeAngle(vertexAngle - angle);
      if (Math.abs(difference) > halfAngle + ANGLE_EPSILON) continue;
      angles.add(angle + difference - ANGLE_EPSILON);
      angles.add(angle + difference);
      angles.add(angle + difference + ANGLE_EPSILON);
    }
  }

  const points = [origin];
  const walls = new Map();
  for (const rayAngle of [...angles].sort((left, right) => left - right)) {
    const { end: endpoint, firstObject } = traceVisionRay(
      origin, rayAngle, maximumRange, visionObjects, projectileRadius,
    );
    points.push(endpoint);
    if (firstObject) {
      if (firstObject.role === 'vision-smoke') continue;
      if (firstObject.shape === 'segment') {
        const fragment = getVisibleSegmentFragment(firstObject, endpoint);
        walls.set(fragment.id, fragment);
      } else if (firstObject.role === 'destructible-prop') {
        const fragment = getVisiblePropSurfaceFragment(firstObject, endpoint);
        walls.set(fragment.id, fragment);
      } else {
        const id = firstObject.id ?? `${firstObject.shape}:${firstObject.x}:${firstObject.y}`;
        walls.set(id, { ...firstObject, id });
      }
    }
  }

  return { origin, angle, halfAngle, maximumRange, points, walls: [...walls.values()] };
}

export function createXrayVision(
  origin,
  angle,
  mapWidth,
  mapHeight,
  halfAngle = VISION_HALF_ANGLE,
  maximumRange = Math.hypot(mapWidth, mapHeight) * 2,
) {
  return {
    ...createVision(origin, angle, [], mapWidth, mapHeight, halfAngle, maximumRange),
    xray: true,
  };
}

function getVisiblePropSurfaceFragment(object, hitPoint) {
  const fragmentLength = 6;
  if (object.shape === 'circle') {
    const angle = Math.atan2(hitPoint.y - object.y, hitPoint.x - object.x);
    const halfAngle = Math.min(Math.PI / 2, fragmentLength / (2 * object.radius));
    const startAngle = angle - halfAngle;
    const endAngle = angle + halfAngle;
    return {
      id: `${object.id}:surface:${Math.round(angle * object.radius / fragmentLength)}`,
      objectId: object.id,
      role: object.role,
      health: object.health,
      maxHealth: object.maxHealth,
      shape: 'segment',
      x1: object.x + Math.cos(startAngle) * object.radius,
      y1: object.y + Math.sin(startAngle) * object.radius,
      x2: object.x + Math.cos(endAngle) * object.radius,
      y2: object.y + Math.sin(endAngle) * object.radius,
    };
  }

  const left = object.x - object.width / 2;
  const right = object.x + object.width / 2;
  const top = object.y - object.height / 2;
  const bottom = object.y + object.height / 2;
  const distances = [
    { side: 'left', distance: Math.abs(hitPoint.x - left), coordinate: hitPoint.y, min: top, max: bottom },
    { side: 'right', distance: Math.abs(hitPoint.x - right), coordinate: hitPoint.y, min: top, max: bottom },
    { side: 'top', distance: Math.abs(hitPoint.y - top), coordinate: hitPoint.x, min: left, max: right },
    { side: 'bottom', distance: Math.abs(hitPoint.y - bottom), coordinate: hitPoint.x, min: left, max: right },
  ].sort((a, b) => a.distance - b.distance);
  const { side, coordinate, min, max } = distances[0];
  const fragmentCount = Math.max(1, Math.ceil((max - min) / fragmentLength));
  const fragmentIndex = Math.max(0, Math.min(fragmentCount - 1, Math.floor((coordinate - min) / fragmentLength)));
  const start = min + fragmentIndex * fragmentLength;
  const end = Math.min(max, start + fragmentLength);
  const id = `${object.id}:surface:${side}:${fragmentIndex}`;
  const fragment = { id, objectId: object.id, role: object.role, health: object.health, maxHealth: object.maxHealth, shape: 'segment' };
  if (side === 'left' || side === 'right') {
    const x = side === 'left' ? left : right;
    return { ...fragment, x1: x, y1: start, x2: x, y2: end };
  }
  const y = side === 'top' ? top : bottom;
  return { ...fragment, x1: start, y1: y, x2: end, y2: y };
}

function getVisionCandidateObjects(origin, angle, halfAngle, maximumRange, padding, mapObjects) {
  const candidates = [];
  let objectIndex = 0;
  for (const object of mapObjects ?? []) {
    const index = objectIndex;
    objectIndex += 1;
    if (!object || typeof object !== 'object' || object.blocksVision === false) continue;
    const geometry = getVisionObjectGeometry(object);
    if (!geometry) continue;
    const objectPadding = Math.max(
      padding,
      object.shape === 'segment' ? VISION_CORNER_PADDING : 0,
    );
    const minX = geometry.minX - objectPadding;
    const minY = geometry.minY - objectPadding;
    const maxX = geometry.maxX + objectPadding;
    const maxY = geometry.maxY + objectPadding;

    const nearestX = Math.max(minX, Math.min(origin.x, maxX));
    const nearestY = Math.max(minY, Math.min(origin.y, maxY));
    if (Math.hypot(nearestX - origin.x, nearestY - origin.y) > maximumRange) continue;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const radius = Math.hypot(maxX - minX, maxY - minY) / 2;
    const dx = centerX - origin.x;
    const dy = centerY - origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= radius) {
      candidates.push({
        object,
        index,
        vertices: geometry.vertices,
        fullCircle: true,
        minimumDistance: 0,
      });
      continue;
    }
    const angularRadius = Math.asin(Math.min(1, radius / distance));
    if (Math.abs(normalizeAngle(Math.atan2(dy, dx) - angle)) <=
        halfAngle + angularRadius + ANGLE_EPSILON) {
      candidates.push({
        object,
        index,
        vertices: geometry.vertices,
        unitX: dx / distance,
        unitY: dy / distance,
        cosAngularRadius: Math.cos(angularRadius),
        minimumDistance: Math.max(0, distance - radius),
      });
    }
  }
  return candidates.sort((left, right) =>
    left.minimumDistance - right.minimumDistance || left.index - right.index);
}

function getVisionObjectGeometry(object) {
  const cached = visionGeometryCache.get(object);
  if (cached && cached.shape === object.shape &&
      cached.x === object.x && cached.y === object.y &&
      cached.width === object.width && cached.height === object.height &&
      cached.radius === object.radius &&
      cached.x1 === object.x1 && cached.y1 === object.y1 &&
      cached.x2 === object.x2 && cached.y2 === object.y2) {
    return cached;
  }

  let minX;
  let minY;
  let maxX;
  let maxY;
  if (object.shape === 'segment') {
    minX = Math.min(object.x1, object.x2);
    minY = Math.min(object.y1, object.y2);
    maxX = Math.max(object.x1, object.x2);
    maxY = Math.max(object.y1, object.y2);
  } else if (object.shape === 'rect') {
    minX = object.x - object.width / 2;
    minY = object.y - object.height / 2;
    maxX = object.x + object.width / 2;
    maxY = object.y + object.height / 2;
  } else if (object.shape === 'circle') {
    minX = object.x - object.radius;
    minY = object.y - object.radius;
    maxX = object.x + object.radius;
    maxY = object.y + object.radius;
  } else {
    return null;
  }

  const geometry = {
    shape: object.shape,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    radius: object.radius,
    x1: object.x1,
    y1: object.y1,
    x2: object.x2,
    y2: object.y2,
    minX,
    minY,
    maxX,
    maxY,
    vertices: getObjectVertices(object),
  };
  visionGeometryCache.set(object, geometry);
  return geometry;
}

function getVisibleSegmentFragment(segment, hitPoint) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const length = Math.hypot(dx, dy);
  const along = Math.max(0, Math.min(length,
    ((hitPoint.x - segment.x1) * dx + (hitPoint.y - segment.y1) * dy) / length));
  const index = Math.floor(along / WALL_MEMORY_FRAGMENT_LENGTH);
  const startAlong = index * WALL_MEMORY_FRAGMENT_LENGTH;
  const endAlong = Math.min(length, startAlong + WALL_MEMORY_FRAGMENT_LENGTH);
  const unitX = dx / length;
  const unitY = dy / length;
  return {
    id: `${segment.id ?? `${segment.x1}:${segment.y1}:${segment.x2}:${segment.y2}`}:visible:${index}`,
    shape: 'segment',
    x1: segment.x1 + unitX * startAlong,
    y1: segment.y1 + unitY * startAlong,
    x2: segment.x1 + unitX * endAlong,
    y2: segment.y1 + unitY * endAlong,
  };
}

export function isPointVisible(point, vision, mapObjects) {
  const dx = point.x - vision.origin.x;
  const dy = point.y - vision.origin.y;
  const distance = Math.hypot(dx, dy);
  if (Number.isFinite(vision.maximumRange) && distance > vision.maximumRange) return false;
  const angleDifference = normalizeAngle(Math.atan2(dy, dx) - vision.angle);
  if (Math.abs(angleDifference) > vision.halfAngle) return false;
  if (vision.xray === true) return true;
  if (distance <= 1e-9) return true;

  return !someMapObjectAlongSegment(mapObjects, vision.origin, point, 0, (object) => {
    const padding = object.shape === 'segment' ? VISION_CORNER_PADDING : 0;
    if (object.blocksVision === false ||
        !segmentMapObjectBoundsOverlap(vision.origin, point, object, padding)) return false;
    const hit = getVisionObjectEntryT(vision.origin, point, object, 0, mapObjects);
    return hit !== null && hit < 1 - 1e-10;
  });
}

function isCandidateOnRay(candidate, rayX, rayY) {
  return candidate.fullCircle ||
    candidate.unitX * rayX + candidate.unitY * rayY >= candidate.cosAngularRadius - ANGLE_EPSILON;
}

function traceVisionRay(origin, angle, range, objects, projectileRadius) {
  const rayX = Math.cos(angle);
  const rayY = Math.sin(angle);
  const end = { x: origin.x + rayX * range, y: origin.y + rayY * range };
  let firstHitT = 1;
  let firstHitObjectIndex = Infinity;
  let firstObject = null;
  for (const candidate of objects ?? []) {
    if (candidate.minimumDistance > firstHitT * range + ANGLE_EPSILON) break;
    if (!isCandidateOnRay(candidate, rayX, rayY)) continue;
    const object = candidate.object;
    if (object.blocksVision === false) continue;
    const padding = Math.max(
      Number.isFinite(projectileRadius) ? projectileRadius : 0,
      object.shape === 'segment' ? VISION_CORNER_PADDING : 0,
    );
    if (!segmentMapObjectBoundsOverlap(origin, end, object, padding)) continue;
    const hit = getVisionObjectEntryT(origin, end, object, projectileRadius, objects, rayX, rayY);
    if (hit !== null && (hit < firstHitT ||
        (hit === firstHitT && candidate.index < firstHitObjectIndex))) {
      firstHitT = hit;
      firstHitObjectIndex = candidate.index;
      firstObject = object;
    }
  }
  return {
    end: {
      x: origin.x + (end.x - origin.x) * firstHitT,
      y: origin.y + (end.y - origin.y) * firstHitT,
    },
    firstObject,
  };
}

function getVisionObjectEntryT(start, end, object, projectileRadius, mapObjects, rayX, rayY) {
  const radius = Number.isFinite(projectileRadius) ? projectileRadius : 0;
  const exactHit = segmentMapObjectEntryT(start, end, object, radius, 'blocksVision');
  if (exactHit !== null || object.shape !== 'segment' || radius >= VISION_CORNER_PADDING) return exactHit;

  const cornerHit = segmentMapObjectEntryT(start, end, object, VISION_CORNER_PADDING, 'blocksVision');
  if (cornerHit === null) return null;
  const hitPoint = {
    x: start.x + (end.x - start.x) * cornerHit,
    y: start.y + (end.y - start.y) * cornerHit,
  };
  const dx = object.x2 - object.x1;
  const dy = object.y2 - object.y1;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return cornerHit;
  const along = ((hitPoint.x - object.x1) * dx + (hitPoint.y - object.y1) * dy) / length;
  const endpoint = along <= VISION_CORNER_PADDING
    ? { x: object.x1, y: object.y1 }
    : length - along <= VISION_CORNER_PADDING
      ? { x: object.x2, y: object.y2 }
      : null;
  if (!endpoint || !hasNearbyWallEndpoint(object, endpoint, mapObjects, rayX, rayY)) return null;
  return cornerHit;
}

function hasNearbyWallEndpoint(object, endpoint, mapObjects, rayX, rayY) {
  const maximumDistanceSquared = (2 * VISION_CORNER_PADDING) ** 2;
  for (const candidate of mapObjects ?? []) {
    // Polygon rays previously supplied only angularly overlapping candidates.
    if (rayX !== undefined && !isCandidateOnRay(candidate, rayX, rayY)) continue;
    const other = candidate.object ?? candidate;
    if (!other || other === object || other.shape !== 'segment' || other.blocksVision === false) continue;
    for (const candidate of [{ x: other.x1, y: other.y1 }, { x: other.x2, y: other.y2 }]) {
      const dx = endpoint.x - candidate.x;
      const dy = endpoint.y - candidate.y;
      if (dx * dx + dy * dy <= maximumDistanceSquared) return true;
    }
  }
  return false;
}

export function isCircleVisible(center, radius, vision, mapObjects) {
  if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y) ||
      !Number.isFinite(radius) || radius < 0) return false;
  if (radius === 0) return isPointVisible(center, vision, mapObjects);
  const dx = center.x - vision.origin.x;
  const dy = center.y - vision.origin.y;
  const distance = Math.hypot(dx, dy);
  if (Number.isFinite(vision.maximumRange) && distance - radius > vision.maximumRange) return false;
  const angularRadius = distance <= radius ? Math.PI : Math.asin(Math.min(1, radius / distance));
  const angleDifference = Math.abs(normalizeAngle(Math.atan2(dy, dx) - vision.angle));
  if (angleDifference > vision.halfAngle + angularRadius) return false;
  if (isPointVisible(center, vision, mapObjects)) return true;

  const points = vision?.points;
  if (Array.isArray(points) && points.length >= 3) {
    if (pointInVisionPolygon(center, vision)) return true;
    const radiusSquared = radius * radius;
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared));
      const nearestX = start.x + dx * along;
      const nearestY = start.y + dy * along;
      const offsetX = center.x - nearestX;
      const offsetY = center.y - nearestY;
      if (offsetX * offsetX + offsetY * offsetY <= radiusSquared) return true;
    }
    return false;
  }

  const sampleCount = Math.max(24, Math.ceil((2 * Math.PI * radius) / 1.25));
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = (index / sampleCount) * Math.PI * 2;
    if (isPointVisible({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }, vision, mapObjects)) return true;
  }
  return false;
}

export function pointInVisionPolygon(point, polygon) {
  let inside = false;
  const points = polygon.points;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[current];
    const b = points[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function getVisionPolygonScanlineIntervals(vision, y) {
  const points = vision?.points;
  if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(y)) return [];

  const intersections = [];
  for (let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current, current += 1) {
    const a = points[current];
    const b = points[previous];
    if ((a.y > y) !== (b.y > y)) {
      intersections.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
  }
  intersections.sort((left, right) => left - right);

  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const left = intersections[index];
    const right = intersections[index + 1];
    if (right > left) intervals.push([left, right]);
  }
  return intervals;
}

export function isSegmentInVision(start, end, vision) {
  if (pointInVisionPolygon(start, vision) || pointInVisionPolygon(end, vision)) return true;
  return getSegmentVisionIntervals(start, end, vision).length > 0;
}

export function getSegmentVisionIntervals(start, end, vision) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) + Math.abs(dy) <= 1e-12) {
    return pointInVisionPolygon(start, vision) ? [[0, 1]] : [];
  }

  const intersections = [0, 1];
  const points = vision.points;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[previous];
    const b = points[current];
    const edgeX = b.x - a.x;
    const edgeY = b.y - a.y;
    const denominator = dx * edgeY - dy * edgeX;
    const offsetX = a.x - start.x;
    const offsetY = a.y - start.y;
    if (Math.abs(denominator) <= 1e-12) {
      if (Math.abs(offsetX * dy - offsetY * dx) > 1e-9) continue;
      const lengthSquared = dx * dx + dy * dy;
      const first = (offsetX * dx + offsetY * dy) / lengthSquared;
      const second = ((b.x - start.x) * dx + (b.y - start.y) * dy) / lengthSquared;
      if (first >= 0 && first <= 1) intersections.push(first);
      if (second >= 0 && second <= 1) intersections.push(second);
      continue;
    }
    const t = (offsetX * edgeY - offsetY * edgeX) / denominator;
    const u = (offsetX * dy - offsetY * dx) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) intersections.push(t);
  }

  intersections.sort((left, right) => left - right);
  const unique = [];
  for (const value of intersections) {
    if (unique.length === 0 || value - unique[unique.length - 1] > 1e-9) unique.push(value);
  }
  const intervals = [];
  for (let index = 0; index + 1 < unique.length; index += 1) {
    const first = unique[index];
    const second = unique[index + 1];
    if (second - first <= 1e-9) continue;
    const midpoint = (first + second) / 2;
    if (pointInVisionPolygon({ x: start.x + dx * midpoint, y: start.y + dy * midpoint }, vision)) {
      intervals.push([first, second]);
    }
  }
  return intervals;
}

export function revealVisionCells(explored, columns, rows, cellSize, vision) {
  const points = vision.points;
  if (points.length < 3) return [];
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const point of points) {
    minimumY = Math.min(minimumY, point.y);
    maximumY = Math.max(maximumY, point.y);
  }
  minimumY = Math.max(0, Math.floor(minimumY / cellSize));
  maximumY = Math.min(rows - 1, Math.floor(maximumY / cellSize));
  const revealed = [];
  const intersections = [];
  const revealCell = (x, y) => {
    if (x < 0 || x >= columns || y < 0 || y >= rows) return;
    const cellIndex = y * columns + x;
    if (explored[cellIndex]) return;
    explored[cellIndex] = 1;
    revealed.push(cellIndex);
  };

  for (let y = minimumY; y <= maximumY; y += 1) {
    const centerY = (y + 0.5) * cellSize;
    intersections.length = 0;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
      const first = points[previous];
      const second = points[index];
      if ((first.y > centerY) === (second.y > centerY)) continue;
      intersections.push(first.x + ((centerY - first.y) * (second.x - first.x)) / (second.y - first.y));
    }
    intersections.sort((left, right) => left - right);

    for (let pair = 0; pair + 1 < intersections.length; pair += 2) {
      const minimumX = Math.max(0, Math.ceil(intersections[pair] / cellSize - 0.5));
      const maximumX = Math.min(columns - 1, Math.floor(intersections[pair + 1] / cellSize - 0.5));
      for (let x = minimumX; x <= maximumX; x += 1) {
        revealCell(x, y);
      }
    }
  }

  // Center-scan conversion leaves a one-cell staircase along curved and angled
  // blockers. Supercover the polygon edges, nudging samples inward so a cell
  // wholly behind the vision boundary is not cleared just because it touches it.
  const edgeInset = 0.01;
  const maximumEdgeStep = Math.max(0.5, cellSize / 2);
  let signedAreaTwice = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    signedAreaTwice += points[previous].x * points[index].y - points[index].x * points[previous].y;
  }
  const interiorSign = Math.sign(signedAreaTwice);
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const start = points[previous];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9 || interiorSign === 0) continue;
    const steps = Math.max(1, Math.ceil(length / maximumEdgeStep));
    const normalX = -dy / length;
    const normalY = dx / length;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = start.x + dx * t;
      const y = start.y + dy * t;
      const insideX = x + normalX * edgeInset * interiorSign;
      const insideY = y + normalY * edgeInset * interiorSign;
      revealCell(Math.floor(insideX / cellSize), Math.floor(insideY / cellSize));
    }
  }
  return revealed;
}

export function getNewlyRevealedWalls(exploredWallIds, visions) {
  const newlyRevealed = [];
  for (const vision of visions) {
    for (const wall of vision.walls ?? []) {
      const id = wall.id ?? `${wall.shape}:${wall.x1}:${wall.y1}:${wall.x2}:${wall.y2}`;
      if (exploredWallIds.has(id)) continue;
      exploredWallIds.add(id);
      newlyRevealed.push(wall);
    }
  }
  return newlyRevealed;
}

export function forgetRememberedObjectSurfaces(exploredWallIds, rememberedWalls, objectIds) {
  if (!(rememberedWalls instanceof Map) || !Array.isArray(objectIds) || objectIds.length === 0) return;
  const forgotten = new Set(objectIds);
  for (const [fragmentId, wall] of rememberedWalls) {
    if (!forgotten.has(wall.objectId)) continue;
    rememberedWalls.delete(fragmentId);
    exploredWallIds?.delete(fragmentId);
  }
}

function getObjectVertices(object) {
  if (object.shape === 'segment') {
    return [{ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }];
  }
  if (object.shape === 'rect') {
    const halfWidth = object.width / 2;
    const halfHeight = object.height / 2;
    return [
      { x: object.x - halfWidth, y: object.y - halfHeight },
      { x: object.x + halfWidth, y: object.y - halfHeight },
      { x: object.x + halfWidth, y: object.y + halfHeight },
      { x: object.x - halfWidth, y: object.y + halfHeight },
    ];
  }
  if (object.shape === 'circle') {
    return Array.from({ length: 16 }, (_, index) => {
      const angle = index * Math.PI / 8;
      return { x: object.x + Math.cos(angle) * object.radius, y: object.y + Math.sin(angle) * object.radius };
    });
  }
  return [];
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
