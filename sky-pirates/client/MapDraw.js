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
  function drawMapPolygonsSides(map, typeFilter = null) {
    textSize(12);
    textAlign(CENTER);
    stroke(0);
  
    const cameraX = windowWidth / 2;
    const cameraY = windowHeight / 2;

    // Ocean Color Modification at Night
    let waterColorMod = { r: 1, g: 1, b: 1 };
    if (typeof cycleTime !== 'undefined' && typeof DAY_DURATION !== 'undefined') {
        if (cycleTime >= DAY_DURATION) {
             // Less blue at night (darker/desaturated)
             // 0.4 multiplier for blue channel specifically? Or darken overall.
             // "become less blue at night" -> Reduce Blue channel intensity 
             waterColorMod = { r: 0.6, g: 0.6, b: 0.4 }; 
        } else {
            // Transitions etc can be added here if desired, using same logic as clouds
            // For now, binary switch for simplicity or smooth transition
             const transitionTime = 60000;
             let dayFactor = 1.0;
             if (cycleTime < transitionTime) dayFactor = cycleTime / transitionTime;
             else if (cycleTime > DAY_DURATION - transitionTime) dayFactor = (DAY_DURATION - cycleTime) / transitionTime;
             
             waterColorMod = { 
                 r: lerp(0.6, 1, dayFactor), 
                 g: lerp(0.6, 1, dayFactor), 
                 b: lerp(0.4, 1, dayFactor) 
             };
        }
    }
  
    for (const polygon of map.polygons) {
      if (typeFilter) {
          if (typeFilter === 'water' && polygon.type !== 'water') continue;
          if (typeFilter === 'other' && polygon.type === 'water') continue;
      }
      
      // Set fill based on color, applying a 0.7 multiplier.
      if (polygon.color) {
        let r = polygon.color.r * 0.7;
        let g = polygon.color.g * 0.7;
        let b = polygon.color.b * 0.7;
        
        if (polygon.type === 'water') {
            r *= waterColorMod.r;
            g *= waterColorMod.g;
            b *= waterColorMod.b;
        }

        fill(r, g, b, polygon.color.t);
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

    // Ocean Color Modification at Night (Shared Logic)
    let waterColorMod = { r: 1, g: 1, b: 1 };
    if (typeof cycleTime !== 'undefined' && typeof DAY_DURATION !== 'undefined') {
        if (cycleTime >= DAY_DURATION) {
             waterColorMod = { r: 0.6, g: 0.6, b: 0.4 }; 
        } else {
             const transitionTime = 60000;
             let dayFactor = 1.0;
             if (cycleTime < transitionTime) dayFactor = cycleTime / transitionTime;
             else if (cycleTime > DAY_DURATION - transitionTime) dayFactor = (DAY_DURATION - cycleTime) / transitionTime;
             
             waterColorMod = { 
                 r: lerp(0.6, 1, dayFactor), 
                 g: lerp(0.6, 1, dayFactor), 
                 b: lerp(0.4, 1, dayFactor) 
             };
        }
    }
  
    for (const polygon of map.polygons) {
      if (polygon.color) {
        let r = polygon.color.r;
        let g = polygon.color.g;
        let b = polygon.color.b;

        if (polygon.type === 'water') {
            r *= waterColorMod.r;
            g *= waterColorMod.g;
            b *= waterColorMod.b;
        }
        fill(r, g, b, polygon.color.t);
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
  function createBiomePolygon(biome, color, depth, type) {
    return {
      vertices: [
        { x: biome.x1, y: biome.y1 },
        { x: biome.x2, y: biome.y1 },
        { x: biome.x2, y: biome.y2 },
        { x: biome.x1, y: biome.y2 },
      ],
      color: color,
      depth: depth,
      type: type
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
        mapObj.polygons.push(createBiomePolygon(biome, waterColor, 97, 'water'));
      } else if (biome.type === 'recovery') {
        const recoveryColor = { r: 0, g: 255, b: 0, t: 100 };
        mapObj.polygons.push(createBiomePolygon(biome, recoveryColor, 20, 'recovery'));
      }
    }
    return mapObj;
  }
  
  function regenerateStaticStars() {
    const stars = [];
    const starCount = Math.max(150, Math.floor((windowWidth * windowHeight) / 9000));
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * windowWidth,
        y: Math.random() * (windowHeight * 0.7),
        size: Math.random() * 2 + 1,
        blinkOffset: Math.random() * 100
      });
    }
    window.staticStars = stars;
    window.staticStarsViewport = { width: windowWidth, height: windowHeight };
  }

  // Draws the map background with the specified colors.
  // First draws sky with sun and clouds, then overlays the map background color
  function drawMapBackground(map, centerX = 0) {
    // Determine Time of Day
    // cycleTime is 0 to (16+8)*60*1000 = 1,440,000
    // Day: 0 to 960,000 (16 mins). Peak at 8 mins (480,000).
    // Night: 960,000 to 1,440,000 (8 mins). Peak at 20 mins (1,200,000).

    const totalDuration = DAY_DURATION + NIGHT_DURATION;
    const isNight = cycleTime >= DAY_DURATION;
    
    // Horizon Y position (matches celestial body logic)
    const horizonY = windowHeight * 0.6;
    const horizonRatio = 0.6;

    // Transition Config
    const transTime = 60000; // 1 minute
    
    // Base Colors
    const daySky = color(135, 206, 235);
    const dayHorizon = color(200, 230, 255); // Whiter horizon
    
    const nightSky = color(20, 24, 50);
    const nightHorizon = color(10, 12, 30); // Dark horizon
    
    const sunriseHorizon = color(255, 100, 50); // Orange
    const sunsetHorizon = color(255, 60, 30); // Redder orange

    let displaySky;
    let displayHorizon;

    if (isNight) {
        // Deep Night
        displaySky = nightSky;
        displayHorizon = nightHorizon;
        
        // Sunrise/Sunset Transition within Night?
        // Night 0-10m.
        // Sunset Fade Out: 0-1m of night (after 20m day)
        // Sunrise Fade In: 9-10m of night (before 0m day)
        const timeInNight = cycleTime - DAY_DURATION;
        if (timeInNight < transTime) {
            // Dusk (Day fading completely)
            const t = timeInNight / transTime;
            displaySky = lerpColor(color(60,60,80), nightSky, t); // Fading from dusk blue
            displayHorizon = lerpColor(sunsetHorizon, nightHorizon, t);
        } else if (timeInNight > NIGHT_DURATION - transTime) {
            // Dawn (Night fading to Day)
            const t = (timeInNight - (NIGHT_DURATION - transTime)) / transTime;
            displaySky = lerpColor(nightSky, color(60,60,80), t);
            displayHorizon = lerpColor(nightHorizon, sunriseHorizon, t);
        }

    } else {
        // Day
        if (cycleTime < transTime) {
            // Sunrise (Completion)
            const t = cycleTime / transTime;
            displaySky = lerpColor(color(60,60,80), daySky, t);
            displayHorizon = lerpColor(sunriseHorizon, dayHorizon, t);
        } else if (cycleTime > DAY_DURATION - transTime) {
            // Sunset (Start)
            const t = (cycleTime - (DAY_DURATION - transTime)) / transTime;
            displaySky = lerpColor(daySky, color(60,60,80), t);
            displayHorizon = lerpColor(dayHorizon, sunsetHorizon, t);
        } else {
            // Full Day
            displaySky = daySky;
            displayHorizon = dayHorizon;
        }
    }

    // Draw Gradient Background
    // Optimization: fast linear gradient using drawingContext
    let ctx = drawingContext;
    let gradient = ctx.createLinearGradient(0, 0, 0, windowHeight);
    
    // Gradient Stops:
    // 0.0 (Top) -> Sky Color
    // 0.6 (Horizon) -> Horizon Color
    // 1.0 (Bottom) -> Horizon/Dark Color (Underwater depth effect)
    
    gradient.addColorStop(0, displaySky.toString());
    gradient.addColorStop(horizonRatio, displayHorizon.toString());
    
    // Bottom: Darker version of horizon or reuse horizon?
    // Since ocean is transparent, if we make it dark it simulates depth
    let bottomColor = lerpColor(displayHorizon, color(0,0,20), 0.5); 
    gradient.addColorStop(1, bottomColor.toString());

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, windowWidth, windowHeight);
    
    // Parallax Logic
    const parallaxFactor = 0.5;
    const mapBounds = 150000;
    const normalizedPos = Math.max(-1, Math.min(1, centerX / mapBounds));
    const parallaxOffsetX = normalizedPos * (windowWidth * parallaxFactor);
    
    // Keep star positions synced to viewport size so stars cover the full screen after resize.
    const starsNeedRefresh =
      !window.staticStars ||
      !window.staticStarsViewport ||
      window.staticStarsViewport.width !== windowWidth ||
      window.staticStarsViewport.height !== windowHeight;
    if (starsNeedRefresh) regenerateStaticStars();

    if (isNight) {
        // Calculate Star Opacity
        // Full opacity during deep night, fade in/out near transition?
        // Let's use simple opacity based on night depth
        let starAlpha = 200;
        
        // Optionally fade in/out
        const transitionTime = 60000;
        const timeInNight = cycleTime - DAY_DURATION;
        if (timeInNight < transitionTime) { // Dawn of night? (Dusk)
            starAlpha = lerp(0, 200, timeInNight / transitionTime);
        } else if (timeInNight > NIGHT_DURATION - transitionTime) { // Dawn
             starAlpha = lerp(200, 0, (timeInNight - (NIGHT_DURATION - transitionTime)) / transitionTime);
        }
        
        push();
        noStroke();
        fill(255, 255, 255, starAlpha);
        
        // Apply Zoom Scaling to Stars
        let zoomScale = 1.0;
        if (typeof window.cameraZoom === 'number' && !isNaN(window.cameraZoom)) {
            zoomScale = window.cameraZoom;
        }

        for (const star of window.staticStars) {
             // Simple twinkling
             const flicker = Math.sin((millis() / 500) + star.blinkOffset) * 50; 
             fill(255, 255, 255, starAlpha + flicker);
             
             // Parallax for stars
             let drawX = (star.x - (parallaxOffsetX * 0.1)) % windowWidth;
             if (drawX < 0) drawX += windowWidth;
             let drawY = star.y;

             // Apply Zoom from Center
             let relX = drawX - windowWidth / 2;
             let relY = drawY - windowHeight / 2;
             
             let finalX = (windowWidth / 2) + (relX * zoomScale);
             let finalY = (windowHeight / 2) + (relY * zoomScale);
             let finalSize = star.size * zoomScale;
             
             circle(finalX, finalY, finalSize);
        }
        pop();
    }
    
    // Draw Celestial Body (Sun or Moon)
    let bodyX = (windowWidth / 2) - parallaxOffsetX;
    let bodyY;
    
    // Peak height for celestial bodies
    const peakY = windowHeight * 0.1; // Highest point near top of screen
    
    if (!isNight) {
        // Sun Cycle
        const timeInData = cycleTime;
        const sunProgress = timeInData / DAY_DURATION; // 0 to 1
        // Sine wave: 0 (horizon) -> 1 (peak) -> 0 (horizon)
        const heightFactor = Math.sin(sunProgress * Math.PI); 
        
        // Map height factor to Y position (Interpolate between Horizon and Peak)
        bodyY = horizonY - (heightFactor * (horizonY - peakY));
        
        // Transparency Fade: 0 to 1 based on height (fades out near horizon)
        // Starts fading below 20% height
        let fadeAlpha = 1;
        if (heightFactor < 0.2) {
            fadeAlpha = heightFactor / 0.2;
        }

        // Apply Zoom Scaling to Celestial Bodies (Sun/Moon/Stars)
        let zoomScale = 1.0;
        if (typeof window.cameraZoom === 'number' && !isNaN(window.cameraZoom)) {
            zoomScale = window.cameraZoom;
        }
        
        // Transform body position relative to center
        let relX = bodyX - windowWidth / 2;
        // Move pivot down for sky elements so they don't fly off screen as fast when zooming in
        // or just keep them centered if they are just background.
        // But usually "zooming in" means looking closer at the horizon.
        
        // Let's scale relative to center of screen for now
        let relY = bodyY - windowHeight / 2;
        
        let finalBodyX = (windowWidth / 2) + (relX * zoomScale);
        let finalBodyY = (windowHeight / 2) + (relY * zoomScale);
        let finalScale = zoomScale;

        // Draw Sun
        const sunRadius = 60 * finalScale;
        noStroke();
        fill(255, 255, 200, 80 * fadeAlpha);
        circle(finalBodyX, finalBodyY, sunRadius * 2.5);
        fill(255, 255, 150, 120 * fadeAlpha);
        circle(finalBodyX, finalBodyY, sunRadius * 1.8);
        fill(255, 255, 100, 255 * fadeAlpha);
        circle(finalBodyX, finalBodyY, sunRadius);

    } else {
        // Moon Cycle
        const timeInNight = cycleTime - DAY_DURATION;
        const moonProgress = timeInNight / NIGHT_DURATION; // 0 to 1
        const heightFactor = Math.sin(moonProgress * Math.PI);
        
        bodyY = horizonY - (heightFactor * (horizonY - peakY));
        
        let fadeAlpha = 1;
        if (heightFactor < 0.2) {
            fadeAlpha = heightFactor / 0.2;
        }
        
        // Apply Zoom Scaling (same as Sun)
        let zoomScale = 1.0;
        if (typeof window.cameraZoom === 'number' && !isNaN(window.cameraZoom)) {
            zoomScale = window.cameraZoom;
        }
        
        let relX = bodyX - windowWidth / 2;
        let relY = bodyY - windowHeight / 2;
        
        let finalBodyX = (windowWidth / 2) + (relX * zoomScale);
        let finalBodyY = (windowHeight / 2) + (relY * zoomScale);
        let finalScale = zoomScale;

        // Draw Moon
        const moonRadius = 50 * finalScale;
        noStroke();
        fill(200, 200, 255, 50 * fadeAlpha); // Glow
        circle(finalBodyX, finalBodyY, moonRadius * 2.2);
        fill(240, 240, 255, 255 * fadeAlpha); // Main body
        circle(finalBodyX, finalBodyY, moonRadius);
        
        // Craters
        fill(200, 200, 230, 255 * fadeAlpha);
        circle(finalBodyX - (10 * finalScale), finalBodyY - (5 * finalScale), 15 * finalScale);
        circle(finalBodyX + (15 * finalScale), finalBodyY + (10 * finalScale), 10 * finalScale);
        circle(finalBodyX + (5 * finalScale), finalBodyY - (15 * finalScale), 8 * finalScale);
    }
  }

  // Standalone helper to draw the map from a specific camera center
  function drawMapTerrain(map, centerX, centerY) {
      if (!map) return;
      preparePolygonsForDrawing(map, centerX, centerY);
      drawMapPolygonsSides(map);
      drawMapPolygonsFronts(map);
      
      // Draw biome text
      drawBiomeText(map, centerX, centerY);
  }

// Biome name drawing helper
function drawBiomeText(map, centerX, centerY) {
    if (!map.biomes) return;
    
    textAlign(CENTER);
    textSize(24);
    fill(0);
    noStroke();
    
    const cameraX = windowWidth / 2;
    const cameraY = windowHeight / 2;

    for (const biome of map.biomes) {
        if (!biome.name) continue;
        
        // Approximate center of biome
        const bx = (biome.x1 + biome.x2) / 2;
        const by = (biome.y1 + biome.y2) / 2;
        
        // Screen position
        const screenX = cameraX + (bx - centerX);
        const screenY = cameraY + (by - centerY);
        
        // Only draw if on screen
        if (screenX > -100 && screenX < windowWidth + 100 && 
            screenY > -100 && screenY < windowHeight + 100) {
            text(biome.name, screenX, screenY);
        }
    }
}
  