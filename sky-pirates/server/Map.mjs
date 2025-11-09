export class MapObject {
    constructor() {
      this.sizeX = 150000;
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
        // Center (spawn zone - no twin)
        { type: 'recovery', x1: -800, x2: 800, y1: -600, y2: 200, id: 'spawn', twin: null },
        // East 20000
        { type: 'recovery', x1: 19600, x2: 20400, y1: -200, y2: 200, id: 'east_20k', twin: 'west_20k' },
        // West 20000
        { type: 'recovery', x1: -20400, x2: -19600, y1: -200, y2: 200, id: 'west_20k', twin: 'east_20k' },
        // East 50000
        { type: 'recovery', x1: 49600, x2: 50400, y1: -200, y2: 200, id: 'east_50k', twin: 'west_50k' },
        // West 50000
        { type: 'recovery', x1: -50400, x2: -49600, y1: -200, y2: 200, id: 'west_50k', twin: 'east_50k' },
        // East 100000
        { type: 'recovery', x1: 99600, x2: 100400, y1: -200, y2: 200, id: 'east_100k', twin: 'west_100k' },
        // West 100000
        { type: 'recovery', x1: -100400, x2: -99600, y1: -200, y2: 200, id: 'west_100k', twin: 'east_100k' },
        
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

    // Get the recovery zone at a given position
    getRecoveryZoneAtPosition(x, y) {
      for (let i = 0; i < this.biomes.length; i++) {
        const biome = this.biomes[i];
        if (biome.type === 'recovery' && 
            biome.x1 <= x && x <= biome.x2 && 
            biome.y1 <= y && y <= biome.y2) {
          return biome;
        }
      }
      return null;
    }

    // Get recovery zone by ID
    getRecoveryZoneById(id) {
      return this.biomes.find(biome => biome.type === 'recovery' && biome.id === id);
    }

    // Get the twin recovery zone for a given recovery zone
    getTwinRecoveryZone(recoveryZone) {
      if (!recoveryZone || !recoveryZone.twin) return null;
      return this.getRecoveryZoneById(recoveryZone.twin);
    }

    // Get the biome type at a given position
    getBiomeAtPosition(x, y) {
      // Check all biomes to see if the position is within any biome
      for (let i = 0; i < this.biomes.length; i++) {
        const biome = this.biomes[i];
        if (biome.x1 <= x && x <= biome.x2 && biome.y1 <= y && y <= biome.y2) {
          return biome.type;
        }
      }
      
      // If no matching biome is found, default to 'air'
      return 'air';
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