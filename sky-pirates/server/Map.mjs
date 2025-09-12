export class MapObject {
    constructor() {
      this.sizeX = 20000;
      this.skyHeight = 5000;
      this.oceanDepth = 2000;
      this.width = this.sizeX * 2;
      this.height = this.skyHeight + this.oceanDepth;
      this.backgroundR = 0;
      this.backgroundG = 165;
      this.backgroundB = 255;
      this.polygons = [
        {
          type: 'boundary',
          vertices: [
            { x: -this.sizeX, y: -this.skyHeight },
            { x: -this.sizeX, y: this.oceanDepth },
            { x: this.sizeX, y: this.oceanDepth },
            { x: this.sizeX, y: -this.skyHeight }
          ]
        } // Map Boundary
      ];
      this.biomes = [
        { type: 'recovery', x1: -400, x2: 400, y1: -200, y2: 200 },
        { type: 'water', x1: -this.sizeX, x2: this.sizeX, y1: 310, y2: this.oceanDepth },
        { type: 'air', x1: -this.sizeX, x2: this.sizeX, y1: -this.skyHeight, y2: 310 },
      ];
    }
  
    // Check collisions on each axis by testing a given point for collision against all polygons.
    checkCollisions(object, nextX = object.x, nextY = object.y) {
      const collisionX = this.checkCollisionAtPoint(object, nextX, object.y);
      const collisionY = this.checkCollisionAtPoint(object, object.x, nextY);
      return { collisionX, collisionY };
    }
  
    // Common helper for checking collision for a point (px, py) given an object.
    checkCollisionAtPoint(object, px, py) {
      const threshold = object.size / 2;
  
      for (const polygon of this.polygons) {
        if (polygon.type === 'boundary') {
          // For boundaries, we invert the test.
          if (!this.pointInPolygon(px, py, polygon.vertices)) {
            return true;
          }
        } else {
          // For other polygons, check if point is inside.
          if (this.pointInPolygon(px, py, polygon.vertices)) {
            return true;
          }
  
          // Also check for close proximity to any edge of the polygon.
          const { vertices } = polygon;
          for (let i = 0; i < vertices.length; i++) {
            const v1 = vertices[i];
            const v2 = vertices[(i + 1) % vertices.length];
            const edgeDist = this.getDistanceToEdge(px, py, v1.x, v1.y, v2.x, v2.y);
            if (edgeDist <= threshold) {
              return true;
            }
          }
        }
      }
      return false;
    }
  
    // Returns the distance from point (px,py) to the edge defined by (x1,y1)-(x2,y2)
    getDistanceToEdge(px, py, x1, y1, x2, y2) {
      const edgeLengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (edgeLengthSquared === 0) return Math.hypot(px - x1, py - y1);
      const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / edgeLengthSquared));
      const projX = x1 + t * (x2 - x1);
      const projY = y1 + t * (y2 - y1);
      return Math.hypot(px - projX, py - projY);
    }

    getRecovery() {
      return this.biomes.find(p => p.type === 'recovery');
    }
  
    // Determines if point (px,py) is inside a polygon defined by an array of vertices.
    pointInPolygon(px, py, vertices) {
      let inside = false;
      for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }
  }