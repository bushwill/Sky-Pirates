// Map drawing and polygon utilities refactored for clarity

// Computes the signed area (winding) of a polygon given its vertices.
function polygonWinding(verts) {
    let area = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      const x1 = verts[i].x, y1 = verts[i].y;
      const x2 = verts[j].x, y2 = verts[j].y;
      area += x1 * y2 - y1 * x2;
    }
    return area * 0.5;
  }
  
  // Checks if the edge from f1 to f2 is facing the camera.
  function isEdgeFacingCamera(f1, f2, camX, camY, isClockwise) {
    const edgeX = f2.x - f1.x;
    const edgeY = f2.y - f1.y;
    const camVecX = camX - f1.x;
    const camVecY = camY - f1.y;
    const cross = edgeX * camVecY - edgeY * camVecX;
    return isClockwise ? cross > 0 : cross < 0;
  }
  
  // Prepares polygons for drawing by computing an average distance used for sorting,
  // then computing transformed front and back vertices along with the winding value.
  function preparePolygonsForDrawing(map, centerX = 0, centerY = -400) {
    // Compute average distance for each polygon from a center point.
    for (const polygon of map.polygons) {
      let sumDist = 0;
      for (const v of polygon.vertices) {
        const dx = v.x - centerX;
        const dy = v.y - centerY;
        sumDist += Math.sqrt(dx * dx + dy * dy);
      }
      polygon._avgDistance = sumDist / polygon.vertices.length;
    }
  
    // Sort polygons so that the farthest polygons are drawn first.
    map.polygons.sort((a, b) => b._avgDistance - a._avgDistance);
  
    const cameraX = windowWidth / 2;
    const cameraY = windowHeight / 2;
  
    // For each polygon, compute front and back vertices along with the winding value.
    for (const polygon of map.polygons) {
      const depth = polygon.depth || 20;
  
      const frontVerts = polygon.vertices.map(v => ({
        x: cameraX + (v.x - centerX),
        y: cameraY + (v.y - centerY)
      }));
  
      // Create back vertices by applying a slight depth-based offset.
      const backVerts = frontVerts.map(fv => {
        const dx = fv.x - cameraX;
        const dy = fv.y - cameraY;
        return {
          x: fv.x - dx * 0.01 * depth,
          y: fv.y - dy * 0.01 * depth
        };
      });
  
      // Calculate the winding for the polygon.
      const windingValue = polygonWinding(frontVerts);
      polygon._frontVerts = frontVerts;
      polygon._backVerts = backVerts;
      polygon._winding = windingValue;
    }
  }
  
  // Draws the sides of polygons that face the camera.
  function drawMapPolygonsSides(map) {
    textSize(12);
    textAlign(CENTER);
    stroke(0);
  
    const cameraX = windowWidth / 2;
    const cameraY = windowHeight / 2;
  
    for (const polygon of map.polygons) {
      // Set fill based on color, applying a 0.7 multiplier.
      if (polygon.color) {
        fill(
          polygon.color.r * 0.7,
          polygon.color.g * 0.7,
          polygon.color.b * 0.7,
          polygon.color.t
        );
      } else {
        noFill();
      }
  
      const frontVerts = polygon._frontVerts || [];
      const backVerts  = polygon._backVerts  || [];
      const winding    = polygon._winding    || 0;
      const isClockwise = winding < 0;
  
      beginShape(QUADS);
      for (let i = 0; i < frontVerts.length; i++) {
        const j = (i + 1) % frontVerts.length;
        const f1 = frontVerts[i];
        const f2 = frontVerts[j];
        const b1 = backVerts[i];
        const b2 = backVerts[j];
  
        // Only draw the edge if it faces the camera.
        if (isEdgeFacingCamera(f1, f2, cameraX, cameraY, isClockwise)) {
          vertex(f1.x, f1.y);
          vertex(f2.x, f2.y);
          vertex(b2.x, b2.y);
          vertex(b1.x, b1.y);
        }
      }
      endShape(CLOSE);
    }
  }
  
  // Draws the front faces of polygons.
  function drawMapPolygonsFronts(map) {
    textSize(12);
    textAlign(CENTER);
    stroke(0);
  
    for (const polygon of map.polygons) {
      if (polygon.color) {
        fill(polygon.color.r, polygon.color.g, polygon.color.b, polygon.color.t);
      } else {
        noFill();
      }
  
      const frontVerts = polygon._frontVerts || [];
      beginShape();
      for (const fv of frontVerts) {
        vertex(fv.x, fv.y);
      }
      endShape(CLOSE);
    }
  }
  
  // Helper to build a polygon from biome data.
  function createBiomePolygon(biome, color, depth) {
    return {
      vertices: [
        { x: biome.x1, y: biome.y1 },
        { x: biome.x2, y: biome.y1 },
        { x: biome.x2, y: biome.y2 },
        { x: biome.x1, y: biome.y2 },
      ],
      color: color,
      depth: depth,
    };
  }
  
  // Constructs a map object with polygons from the original map as well as biome-based polygons.
  function getMapPolygonsMap(map) {
    // Clone the original polygons array.
    const mapObj = { polygons: [...map.polygons] };
  
    // Process each biome type and add a corresponding polygon.
    for (const biome of map.biomes) {
      if (biome.type === 'water') {
        const waterColor = {
          r: 3,
          g: 49,
          b: 255,
          t: 150,
        };
        mapObj.polygons.push(createBiomePolygon(biome, waterColor, 90));
      } else if (biome.type === 'recovery') {
        const recoveryColor = { r: 0, g: 255, b: 0, t: 100 };
        mapObj.polygons.push(createBiomePolygon(biome, recoveryColor, 20));
      }
    }
    return mapObj;
  }
  
  // Draws the map background with the specified colors.
  function drawMapBackground(map) {
    background(map.backgroundR, map.backgroundG, map.backgroundB);
  }
  