import { forEachMapObjectInBounds, someMapObjectInBounds } from './MapSpatialIndex.js';

export function resolveCircleMovement(position, displacement, objects, radius) {
  const distance = Math.hypot(displacement.x, displacement.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(radius / 2, 1)));
  const step = { x: displacement.x / steps, y: displacement.y / steps };
  const result = { x: position.x, y: position.y, collisionNormals: [] };

  for (let index = 0; index < steps; index += 1) {
    result.x += step.x;
    result.y += step.y;
    for (let pass = 0; pass < 4; pass += 1) {
      let collided = false;
      forEachMapObjectInBounds(objects, {
        minX: result.x - radius,
        minY: result.y - radius,
        maxX: result.x + radius,
        maxY: result.y + radius,
      }, (object) => {
        if (object.blocksMovement === false) return;
        if (!circleCanReachObject(result.x, result.y, object, radius)) return;
        const collision = getCircleCollision(result.x, result.y, object, radius, step);
        if (!collision) return;
        result.x += collision.normal.x * collision.penetration;
        result.y += collision.normal.y * collision.penetration;
        result.collisionNormals.push(collision.normal);
        collided = true;
      });
      if (!collided) break;
    }
  }
  return result;
}

export function circleOverlapsMapObjects(position, objects, radius) {
  const overlaps = (object) => object.blocksMovement !== false &&
    getCircleCollision(position.x, position.y, object, radius, { x: 0, y: 0 });
  return someMapObjectInBounds(objects, {
    minX: position.x - radius,
    minY: position.y - radius,
    maxX: position.x + radius,
    maxY: position.y + radius,
  }, overlaps);
}

function getCircleCollision(x, y, object, radius, step) {
  switch (object.shape) {
    case 'segment': return collideWithSegment(x, y, object, radius, step);
    case 'circle': return collideWithCircle(x, y, object, radius, step);
    case 'rect': return collideWithRect(x, y, object, radius, step);
    default: return null;
  }
}

function collideWithSegment(x, y, segment, radius, step) {
  const nearest = closestPointOnSegment(x, y, segment);
  const dx = x - nearest.x;
  const dy = y - nearest.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return null;

  let normal;
  if (distance > 1e-9) {
    normal = { x: dx / distance, y: dy / distance };
  } else {
    const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) || 1;
    normal = { x: (segment.y2 - segment.y1) / length, y: (segment.x1 - segment.x2) / length };
    if (dot(normal, step) > 0) normal = negate(normal);
  }
  return { normal, penetration: radius - distance };
}

function collideWithCircle(x, y, circle, radius, step) {
  const dx = x - circle.x;
  const dy = y - circle.y;
  const distance = Math.hypot(dx, dy);
  const penetration = radius + circle.radius - distance;
  if (penetration <= 0) return null;
  return {
    normal: distance > 1e-9 ? { x: dx / distance, y: dy / distance } : opposingNormal(step),
    penetration,
  };
}

function collideWithRect(x, y, rect, radius, step) {
  const left = rect.x - rect.width / 2;
  const right = rect.x + rect.width / 2;
  const top = rect.y - rect.height / 2;
  const bottom = rect.y + rect.height / 2;
  const nearestX = clamp(x, left, right);
  const nearestY = clamp(y, top, bottom);
  const dx = x - nearestX;
  const dy = y - nearestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= radius) return null;
  if (distance > 1e-9) return { normal: { x: dx / distance, y: dy / distance }, penetration: radius - distance };

  let edgeDistance = x - left;
  let normalX = -1;
  let normalY = 0;
  const rightDistance = right - x;
  if (rightDistance < edgeDistance) {
    edgeDistance = rightDistance;
    normalX = 1;
  }
  const topDistance = y - top;
  if (topDistance < edgeDistance) {
    edgeDistance = topDistance;
    normalX = 0;
    normalY = -1;
  }
  const bottomDistance = bottom - y;
  if (bottomDistance < edgeDistance) {
    edgeDistance = bottomDistance;
    normalX = 0;
    normalY = 1;
  }
  if (edgeDistance < 1e-9 && normalX * step.x + normalY * step.y > 0) {
    const normal = opposingNormal(step);
    normalX = normal.x;
    normalY = normal.y;
  }
  return { normal: { x: normalX, y: normalY }, penetration: radius + edgeDistance };
}

function circleCanReachObject(x, y, object, radius) {
  if (object.shape === 'circle') {
    const extent = radius + object.radius;
    return Math.abs(x - object.x) < extent && Math.abs(y - object.y) < extent;
  }
  if (object.shape === 'rect') {
    return x + radius > object.x - object.width / 2 && x - radius < object.x + object.width / 2 &&
      y + radius > object.y - object.height / 2 && y - radius < object.y + object.height / 2;
  }
  if (object.shape === 'segment') {
    return x + radius > Math.min(object.x1, object.x2) && x - radius < Math.max(object.x1, object.x2) &&
      y + radius > Math.min(object.y1, object.y2) && y - radius < Math.max(object.y1, object.y2);
  }
  return true;
}

function closestPointOnSegment(x, y, segment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared, 0, 1);
  return { x: segment.x1 + t * dx, y: segment.y1 + t * dy };
}

function opposingNormal(vector) {
  const length = Math.hypot(vector.x, vector.y);
  return length > 1e-9 ? { x: -vector.x / length, y: -vector.y / length } : { x: 1, y: 0 };
}

function negate(vector) {
  return { x: -vector.x, y: -vector.y };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
