const SHAPE_FIELDS = {
  segment: ['x1', 'y1', 'x2', 'y2'],
  circle: ['x', 'y', 'radius'],
  rect: ['x', 'y', 'width', 'height'],
};

export function createMapObject(id, shape, geometry, role = 'cover') {
  const requiredFields = SHAPE_FIELDS[shape];
  if (!requiredFields || typeof id !== 'string' || !id || typeof role !== 'string' || !role || !geometry || typeof geometry !== 'object') {
    throw new TypeError('A map object requires an id, supported shape, and geometry.');
  }
  for (const field of requiredFields) {
    if (!Number.isFinite(geometry[field])) throw new TypeError(`Map object ${id} requires a finite ${field}.`);
  }
  if ((shape === 'circle' && geometry.radius <= 0) ||
      (shape === 'rect' && (geometry.width <= 0 || geometry.height <= 0))) {
    throw new RangeError(`Map object ${id} must have positive dimensions.`);
  }
  if (shape === 'segment' && geometry.x1 === geometry.x2 && geometry.y1 === geometry.y2) {
    throw new RangeError(`Map object ${id} must have a non-zero segment length.`);
  }
  return {
    ...geometry,
    id,
    shape,
    role,
    blocksMovement: true,
    blocksProjectiles: true,
  };
}

export function getMapObjectCenter(object) {
  if (object.shape === 'segment') {
    return { x: (object.x1 + object.x2) / 2, y: (object.y1 + object.y2) / 2 };
  }
  return { x: object.x, y: object.y };
}

export function getMapObjectBoundingRadius(object) {
  if (object.shape === 'circle') return object.radius;
  if (object.shape === 'rect') return Math.hypot(object.width, object.height) / 2;
  return Math.hypot(object.x2 - object.x1, object.y2 - object.y1) / 2;
}
