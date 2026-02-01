// Global state for mobile selection
window.mobileSelection = null; // { type: 'inventory'|'shop'|'equipped', item: ..., index: ... }
window.mobileActionButtons = []; // Array of click regions for action buttons

// Helper to check if a position is on screen
function isOnScreen(drawX, drawY, margin = 0) {
    return (
        drawX >= -margin && drawX <= windowWidth + margin &&
        drawY >= -margin && drawY <= windowHeight + margin
    );
}

// Helper to calculate intersection of a ray from start point to target point with screen bounds
function calculateScreenEdgeIntersection(startX, startY, targetX, targetY, margin = 40) {
    const dx = targetX - startX;
    const dy = targetY - startY;
    
    if (dx === 0 && dy === 0) return { x: startX, y: startY, angle: 0 };
    
    // Screen bounds
    const minX = margin;
    const maxX = windowWidth - margin;
    const minY = margin;
    const maxY = windowHeight - margin;
    
    let tMin = Infinity;
    
    // Check Right Edge (x = maxX)
    if (dx > 0) {
        const t = (maxX - startX) / dx;
        if (t >= 0 && t < tMin) tMin = t;
    }
    // Check Left Edge (x = minX)
    else if (dx < 0) {
        const t = (minX - startX) / dx;
        if (t >= 0 && t < tMin) tMin = t;
    }
    
    // Check Bottom Edge (y = maxY)
    if (dy > 0) {
        const t = (maxY - startY) / dy;
        if (t >= 0 && t < tMin) tMin = t;
    }
    // Check Top Edge (y = minY)
    else if (dy < 0) {
        const t = (minY - startY) / dy;
        if (t >= 0 && t < tMin) tMin = t;
    }
    
    let x = targetX;
    let y = targetY;
    
    if (tMin !== Infinity) {
        x = startX + tMin * dx;
        y = startY + tMin * dy;
    }
    
    // Clamp to ensure it stays within bounds
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
    
    return { x, y, angle: Math.atan2(dy, dx) };
}


// Display all enemies
function displayEnemies(centerX = 0, centerY = -400) {
    for (let i in enemies) {
        stroke(100, 0, 0); // Different color for enemies
        rectMode(CENTER);
        const enemy = enemies[i];
        
        // Use display coordinates if available (for smoothing), otherwise physics coordinates
        const eX = (typeof enemy.displayX !== 'undefined') ? enemy.displayX : enemy.x;
        const eY = (typeof enemy.displayY !== 'undefined') ? enemy.displayY : enemy.y;
        
        const drawX = windowWidth / 2 + (eX - centerX);
        const drawY = windowHeight / 2 + (eY - centerY);
        
        // Create a visual proxy for displayEnemy so particles spawn at visual location
        const visualEnemy = { ...enemy, x: eX, y: eY };
        
        displayEnemy(visualEnemy, drawX, drawY, centerX, centerY);
    }
}

// Display a single enemy
function displayEnemy(enemy, drawX = 0, drawY = -400, centerX = 0, centerY = -400) {
    // Spawn trail particles if enemy is throttling
    if (!enemy) {
        console.warn('displayEnemy called with invalid enemy:', enemy);
        return;
    }

    // Normalize type to a string to avoid .includes on undefined
    const enemyType = (typeof enemy.type === 'string') ? enemy.type : '';

    if (enemy.engine && enemy.engine.power > 0.1) {
        // Very occasional spawning for subtle effect
        if (Math.random() < 0.05) { // 5% chance to spawn trail particles
            spawnTrailParticles(enemy.x, enemy.y, enemy.angle, enemy.engine.power, enemy.engine);
        }
    }
    // Spawn foam particles if enemy is in water
    const enemyBiome = getBiomeAtPosition(enemy.x, enemy.y);
    if (enemyBiome === 'water') {
        if (Math.random() < 0.3) { // 30% chance when displaying (increased from 12%)
            spawnWaterFoamParticles(enemy.x, enemy.y, { vx: enemy.vx, vy: enemy.vy });
        }
    }

    push(); // Start Main Enemy push

    textSize(12);
    textAlign(CENTER);
    stroke(100, 0, 0);
    fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
    
    push(); // Transformation push
    translate(drawX, drawY);

    // Draw enemy based on type using dedicated functions
    if (enemyType.includes('Plane')) {
        drawEnemyPlane(enemy);
    } else if (enemyType.includes('Boat')) {
        drawEnemyBoat(enemy);
    } else {
        drawEnemyDefault(enemy);
    }

    pop(); // End Transformation push

    // Draw enemy hull/health arc (guard chassis fields)
    const arcRadius = 60;
    const arcThickness = 4;
    // Support both direct hull (boats) and chassis.hull (planes/players)
    const hull = (typeof enemy.hull === 'number') ? enemy.hull : (enemy.chassis && typeof enemy.chassis.hull === 'number' ? enemy.chassis.hull : 0);
    const maxHull = (typeof enemy.maxHull === 'number') ? enemy.maxHull : (enemy.chassis && typeof enemy.chassis.maxHull === 'number' ? enemy.chassis.maxHull : 1);
    const hullRatio = Math.max(0, Math.min(1, hull / maxHull));
    push();
    translate(drawX, drawY);
    strokeWeight(arcThickness);
    noFill();
    stroke(255, 0, 0, 200);
    arc(
        0, 0,
        arcRadius, arcRadius,
        2 * Math.PI,
        2 * Math.PI - Math.PI * -hullRatio,
        true
    );
    pop();

    // --- DEBUG: Show enemy firing target when testing ---
    if (testing && enemy.isFiring && enemy.aimPoint && enemy.aimPoint.x !== null && enemy.aimPoint.y !== null) {
        const fireDrawX = windowWidth / 2 + (enemy.aimPoint.x - centerX);
        const fireDrawY = windowHeight / 2 + (enemy.aimPoint.y - centerY);
        push();
        stroke(255, 0, 0);
        strokeWeight(3);
        noFill();
        ellipse(fireDrawX, fireDrawY, 36, 36); // Red circle for firing target
        pop();
    }

    // Draw a single unified label for the enemy above its position.
    noStroke();
    fill(255);
    textSize(12);
    // Prefer an explicit username when available; otherwise fall back to displayName, type, or constructor name
    const labelText = (enemy && enemy.username) ? enemy.username
        : (enemy && enemy.displayName) ? enemy.displayName
            : (enemy.type || (enemy && enemy.constructor && enemy.constructor.name) || 'Enemy');
    text(labelText, drawX, drawY - 15);

    // Display DPS for dummy enemies
    if (enemy.isDummy && typeof enemy.dps === 'number') {
        fill(255, 100, 0); // Orange text for DPS
        textSize(14);
        textStyle(BOLD);
        text(`${Math.round(enemy.dps)} DPS`, drawX, drawY - 45); // Display above AI state
        textStyle(NORMAL);
    }

    if (testing) {
        fill(0, 255, 0); // Green text for AI state
        textSize(10);
        text(`AI: ${enemy.aiState}`, drawX, drawY - 30); // Display above the enemy label
    }

    pop(); // End Main Enemy push

}

// Draw enemy indicators on screen edge if they have the player targeted and are off-screen
function drawEnemyTargetIndicators(controlledPlayer, centerX = 0, centerY = -400) {
    if (!controlledPlayer) return;
    
    // Calculate player's screen position
    const pX = (typeof controlledPlayer.displayX !== 'undefined') ? controlledPlayer.displayX : controlledPlayer.x;
    const pY = (typeof controlledPlayer.displayY !== 'undefined') ? controlledPlayer.displayY : controlledPlayer.y;
    
    const playerScreenX = windowWidth / 2 + (pX - centerX);
    const playerScreenY = windowHeight / 2 + (pY - centerY);

    for (let i in enemies) {
        const enemy = enemies[i];
        // Check if enemy has the controlled player targeted (using targetUsername from server)
        if (enemy.targetUsername && enemy.targetUsername === controlledPlayer.username) {
            // Use display coordinates if available
            const eX = (typeof enemy.displayX !== 'undefined') ? enemy.displayX : enemy.x;
            const eY = (typeof enemy.displayY !== 'undefined') ? enemy.displayY : enemy.y;
            
            const drawX = windowWidth / 2 + (eX - centerX);
            const drawY = windowHeight / 2 + (eY - centerY);
            
            if (!isOnScreen(drawX, drawY)) {
                // Calculate intersection from player's screen position to enemy's screen position
                const edgePos = calculateScreenEdgeIntersection(playerScreenX, playerScreenY, drawX, drawY, 40);
                const indicatorX = edgePos.x;
                const indicatorY = edgePos.y;

                // Draw enemy indicator using appropriate helper function
                push();
                translate(indicatorX, indicatorY);
                fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
                stroke(100, 0, 0);

                // Normalize type to a string to avoid .includes on undefined
                const enemyType = (typeof enemy.type === 'string') ? enemy.type : '';

                // Use appropriate drawing function based on enemy type
                if (enemyType.includes('Plane')) {
                    drawEnemyPlane(enemy);
                } else if (enemyType.includes('Boat')) {
                    drawEnemyBoat(enemy);
                } else {
                    // Fallback: draw simple triangle for unknown types
                    rotate(enemy.angle);
                    triangle(-5, -3, -5, 3, 7, 0);
                }

                pop();

                push();
                // Draw enemy name or faction
                fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
                textAlign(CENTER);
                textSize(12);
                noStroke();
                text(enemy.faction ?? "Enemy", indicatorX, indicatorY - 15);
                // Display distance to player
                let distance = Math.sqrt((eX - pX) ** 2 + (eY - pY) ** 2);
                text(distance.toFixed(0) + "m", indicatorX, indicatorY + 25);
                pop();
            }
        }
    }
}

function drawPlayerIcon(player, angle) {
    const r = player.r || 150;
    const g = player.g || 150;
    const b = player.b || 150;
    const ang = angle !== undefined ? angle : player.angle;

    push();
    rotate(ang);
    
    noStroke();
    fill(r, g, b);
    stroke(0);
    triangle(-5, -3, -5, 3, 7, 0);
    
    pop();
}

function displayPlayers(centerX = 0, centerY = -400) {
    push();
    for (let i in players) {
        stroke(0);
        rectMode(CENTER);
        const player = players[i];
        
        // Use display coordinates if available (for smoothing), otherwise physics coordinates
        const pX = (typeof player.displayX !== 'undefined') ? player.displayX : player.x;
        const pY = (typeof player.displayY !== 'undefined') ? player.displayY : player.y;
        
        const drawX = windowWidth / 2 + (pX - centerX);
        const drawY = windowHeight / 2 + (pY - centerY);
        
        // Create a visual proxy for displayPlayer so particles spawn at visual location
        const visualPlayer = { ...player, x: pX, y: pY };
        
        displayPlayer(visualPlayer, drawX, drawY);
        if (player.username === username) {
            displayControlledPlayerStatus(player, drawX, drawY);
        } else {
            displayOtherPlayerStatus(player, drawX, drawY);
        }
        displayMessages(player, drawX, drawY);
    }
    pop();
}

function displayPlayer(player, drawX = 0, drawY = -400) {
    // Spawn trail particles if player is throttling
    if (player.engine && player.engine.power > 0.1) {
        // Very occasional spawning for subtle effect
        if (Math.random() < 0.05) { // 5% chance to spawn trail particles
            spawnTrailParticles(player.x, player.y, player.angle, player.engine.power, player.engine, player);
        }
    }

    // Spawn foam particles if player is in water
    const playerBiome = getBiomeAtPosition(player.x, player.y);
    if (playerBiome === 'water') {
        // More frequent spawning for consistent wake
        if (Math.random() < 0.3) { // 30% chance when displaying (increased from 12%)
            spawnWaterFoamParticles(player.x, player.y, { vx: player.vx, vy: player.vy });
        }
    } else {
        // Rooster Tail Effect (Flying low over water)
        // Check if there is a water biome directly below the player
        if (mapData && mapData.biomes) {
            const waterBiome = mapData.biomes.find(b => 
                b.type === 'water' && player.x >= b.x1 && player.x <= b.x2
            );

            if (waterBiome) {
                // Calculate distance to water surface (assuming +Y is down, surface is at y1)
                const distToWater = waterBiome.y1 - player.y;
                // Calculate total speed
                const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
                
                // Activation height: 80 units (approx 1.5 plane heights) - REDUCED from 120
                // Speed threshold: 50
                const maxEffectHeight = 80;

                if (distToWater > 0 && distToWater < maxEffectHeight && speed > 50) {
                    // Calculate base intensity factors
                    // Squared falloff for sharper boundary
                    const ratio = distToWater / maxEffectHeight;
                    const proximityFactor = (1 - ratio) * (1 - ratio); 
                    
                    // Speed Factor bands:
                    // < 50: No wake (Stall) -> Handled by if-check
                    // 50-80: Weak wake (Stall/Slow)
                    // 80-120: Light wake (Slow flight)
                    // 120-200: Medium wake (Cruising)
                    // 200+: Heavy wake (Fast/Boost)
                    let speedFactor = 0;
                    
                    if (speed < 80) {
                        // 50-80: 0.1 to 0.3
                        speedFactor = 0.1 + 0.2 * ((speed - 50) / 30);
                    } else if (speed < 120) {
                        // 80-120: 0.3 to 0.6
                        speedFactor = 0.3 + 0.3 * ((speed - 80) / 40);
                    } else if (speed < 200) {
                        // 120-200: 0.6 to 1.0
                        speedFactor = 0.6 + 0.4 * ((speed - 120) / 80);
                    } else {
                        // 200+: 1.0 scaling up to ~2.5 at 500 speed
                        speedFactor = 1.0 + 1.5 * Math.min(1, (speed - 200) / 300);
                    }

                    // Combined intensity
                    const finalIntensity = speedFactor * proximityFactor;

                    // Probability check to avoid over-spawning, scaled by intensity
                    // Intense wakes spawn more continually
                    if (finalIntensity > 0.05 && Math.random() < (0.2 + finalIntensity * 0.3)) {
                        spawnRoosterTailParticles(player.x, waterBiome.y1, player.vx, finalIntensity); 
                    }
                }
            }
        }
    }

    push();
    textSize(12);
    textAlign(CENTER);
    stroke(0);
    fill(player.r, player.g, player.b);
    
    // Position handling must be done by caller or wrapping push/pop
    push();
    translate(drawX, drawY);
    drawPlayerIcon(player);
    pop();

    fill(255);
    textSize(12);
    if (!player || !player.username) {
        console.warn("Invalid player or missing username:", player);
        pop();
        return;  // skip drawing text if no username
    }
    if (player.party) {
        fill(player.party.r, player.party.g, player.party.b);
    }
    // Ensure no stroke is applied to player text (prevents white outlines from leaking UI state)
    noStroke();
    text(player.username, drawX, drawY - 15);
    pop();
}

function drawPartyIndicator(controlledPlayer, centerX = 0, centerY = -400) {
    // Only proceed if the controlled player has a party
    if (!controlledPlayer || !controlledPlayer.party) {
        return;
    }

    // Calculate player's screen position
    const pX = (typeof controlledPlayer.displayX !== 'undefined') ? controlledPlayer.displayX : controlledPlayer.x;
    const pY = (typeof controlledPlayer.displayY !== 'undefined') ? controlledPlayer.displayY : controlledPlayer.y;
    
    const playerScreenX = windowWidth / 2 + (pX - centerX);
    const playerScreenY = windowHeight / 2 + (pY - centerY);

    // Loop through all players to find party members
    for (let i in players) {
        const player = players[i];

        // Skip if this player doesn't have a party or it's not the same party
        if (!player.party ||
            player.party.r !== controlledPlayer.party.r ||
            player.party.g !== controlledPlayer.party.g ||
            player.party.b !== controlledPlayer.party.b) {
            continue;
        }

        // Skip the controlled player (don't draw indicator for yourself)
        if (player.username === controlledPlayer.username) {
            continue;
        }

        // Calculate draw position
        const memberX = (typeof player.displayX !== 'undefined') ? player.displayX : player.x;
        const memberY = (typeof player.displayY !== 'undefined') ? player.displayY : player.y;
        
        const drawX = windowWidth / 2 + (memberX - centerX);
        const drawY = windowHeight / 2 + (memberY - centerY);

        // Check if player is out of bounds
        if (!isOnScreen(drawX, drawY)) {
            // Calculate intersection from player's screen position to party member's screen position
            const edgePos = calculateScreenEdgeIntersection(playerScreenX, playerScreenY, drawX, drawY, 40);
            const indicatorX = edgePos.x;
            const indicatorY = edgePos.y;

            // Draw party indicator triangle
            push();
            translate(indicatorX, indicatorY);
            drawPlayerIcon(player);
            pop();

            // Draw username
            push();
            fill(player.party.r, player.party.g, player.party.b);
            textAlign(CENTER);
            textSize(12);
            text(player.username, indicatorX, indicatorY - 15);

            // Calculate and display distance
            let distance = Math.sqrt((memberX - pX) ** 2 + (memberY - pY) ** 2);
            text(distance.toFixed(0) + "m", indicatorX, indicatorY + 25);
            pop();
        } else {
            // Draw party indicator above player if on screen
            push();
            translate(drawX, drawY - 40);
            fill(player.party.r, player.party.g, player.party.b);
            stroke(0);
            triangle(-5, -5, 5, -5, 0, 0); // Downward pointing triangle
            pop();
        }
    }
}

function displayProjectiles(centerX = 0, centerY = -400) {
    push();
    rectMode(CENTER);
    for (let i in projectiles) {
        const projectile = projectiles[i];
        const drawX = windowWidth / 2 + (projectile.x - centerX);
        const drawY = windowHeight / 2 + (projectile.y - centerY);
        displayProjectile(projectile, drawX, drawY);
    }
    pop();
}

function displayProjectile(projectile, drawX = 0, drawY = -400) {
    // Spawn foam particles if projectile is in water
    if (projectile.biome === 'water') {
        // More frequent spawning for consistent foam trails
        const projectileSizeMultiplier = Math.max(0.2, (projectile.size || 1) * 0.3);
        spawnWaterFoamParticles(projectile.x, projectile.y, { vx: projectile.vx, vy: projectile.vy }, projectileSizeMultiplier);
    }

    push();
    textSize(12);
    textAlign(CENTER);
    
    // Bullet Stroke Logic (Stroke only during day)
    let projectileStroke = true; // Default to stroke (Day)
    
    if (typeof cycleTime !== 'undefined' && typeof DAY_DURATION !== 'undefined') {
        if (cycleTime >= DAY_DURATION) {
             projectileStroke = false; // No stroke at night
        }
    }
    
    if (projectileStroke) {
        strokeWeight(1);
        stroke(0);
    } else {
        noStroke();
    }
    
    fill(projectile.r, projectile.g, projectile.b);

    const s = projectile.size; // size scale

    translate(drawX, drawY);
    rotate(projectile.angle); // assumes angle in radians

    if (projectile.type === 'firework_rocket') {
        rectMode(CENTER);
        stroke(0);
        strokeWeight(1);
        
        // Rocket Body
        fill(projectile.r, projectile.g, projectile.b);
        rect(0, 0, 6 * s, 3 * s);
        
        // Rocket Head
        fill(255, 0, 0);
        triangle(3 * s, -1.5 * s, 3 * s, 3 * s, 5 * s, 0);

        // Occasional trail particle
        if (Math.random() < 0.5) {
            // Spawn at the back of the rocket
            const offset = 12 * s; 
            const px = projectile.x - Math.cos(projectile.angle) * offset;
            const py = projectile.y - Math.sin(projectile.angle) * offset;
            
            if (typeof spawnSmokeParticles === 'function') {
                spawnSmokeParticles(px, py, 1, 1.0);
            }
        }

    } else if (projectile.type === 'fire') {
        noStroke();
        fill(projectile.r, projectile.g, projectile.b, 200);
        circle(0, 0, 5 * s);

        // Smoke trail for flamethrower fire
        if (Math.random() < 0.3) {
             const vx = (Math.random() - 0.5) * 0.5;
             const vy = -0.5; // Upward drift
             const vz = 0;
             const size = 2 + Math.random() * 2;
             const lifetime = 10 + Math.random() * 20; // Short lifetime (10-30 frames)
             
             if (typeof spawnParticle === 'function') {
                spawnParticle(projectile.x, projectile.y, 0, vx, vy, vz, 100, 100, 100, size, lifetime, 'smoke');
             }
        }

    } else if (projectile.type === 'fireworks_fire') {
        noStroke();
        fill(projectile.r, projectile.g, projectile.b, 200);
        circle(0, 0, 5 * s);
    } else {
        // Standard bullet
        triangle(-5 / 3 * s, -1 * s, -5 / 3 * s, 1 * s, 7 / 3 * s, 0);
    }

    pop();
}

function displayEvents(centerX = 0, centerY = -400) {
    for (let i in events) {
        const event = events[i];
        displayEvent(event, centerX, centerY);
    }
}

function displayEvent(event, centerX = 0, centerY = -400) {
    // Create a unique ID for this event based on its properties
    const eventId = `${event.type}_${event.x}_${event.y}_${event.timestamp}`;

    // Only display each event once
    if (displayedEventIds.has(eventId)) {
        return;
    }

    // Mark this event as displayed
    displayedEventIds.add(eventId);

    // Handle different event types
    if (event.type === 'hit') {
        const particleCount = 20;

        for (let i = 0; i < particleCount; i++) {
            let particleAngle, speed;

            // 1/3 of sparks ricochet back (opposite direction with wide spread)
            if (i < particleCount / 3) {
                // Ricochet: fly backwards with wide random spread
                const wideSpread = (Math.random() - 0.5) * Math.PI * 1.5; // ±135 degrees (very wide)
                particleAngle = event.angle + Math.PI + wideSpread; // Add PI to reverse direction
                speed = Math.min(event.velocity * 0.2, 4) + Math.random() * 1.5; // Slower ricochets
            }
            // 2/3 of sparks continue forward (through target)
            else {
                // Bell curve distribution for forward sparks
                const random1 = Math.random() - 0.5;
                const random2 = Math.random() - 0.5;
                const bellCurveRandom = (random1 + random2) / 2; // Concentrated in center

                const spread = bellCurveRandom * (Math.PI / 4); // ±45 degrees, concentrated
                particleAngle = event.angle + spread;
                speed = Math.min(event.velocity * 0.3, 5) + Math.random() * 2; // Normal speed
            }

            const vx = Math.cos(particleAngle) * speed;
            const vy = Math.sin(particleAngle) * speed;
            const vz = (Math.random() - 0.5) * 0.5;

            // Primarily yellow sparks with slight variation
            const colorChoice = Math.random();
            let r, g, b;
            if (colorChoice < 0.8) {
                // Bright yellow (80% of sparks)
                r = 255;
                g = 255;
                b = 50 + Math.random() * 100; // 50-150 (darker yellow)
            } else {
                // Orange accent (20% of sparks)
                r = 255;
                g = 200 + Math.random() * 55; // 200-255
                b = 0;
            }

            const size = 0.8 + Math.random() * 0.8;
            const lifetime = 5 + Math.random() * 5;

            spawnParticle(event.x, event.y, 0, vx, vy, vz, r, g, b, size, lifetime, 'spark');
        }
        
        // Add flame particles (5-8 particles radiating outward)
        const flameCount = 5 + Math.floor(Math.random() * 4); // 5-8 flames
        for (let i = 0; i < flameCount; i++) {
            // Random angle in all directions (360 degrees)
            const flameAngle = Math.random() * Math.PI * 2;
            
            // Slower, expanding outward
            const flameSpeed = 0.5 + Math.random() * 1.5;
            const fvx = Math.cos(flameAngle) * flameSpeed;
            const fvy = Math.sin(flameAngle) * flameSpeed;
            const fvz = (Math.random() - 0.5) * 0.5;
            
            // Flame colors - red/orange/yellow
            const flameColorChoice = Math.random();
            let fr, fg, fb;
            if (flameColorChoice < 0.33) {
                fr = 255; fg = 30 + Math.random() * 70; fb = 0; // Red
            } else if (flameColorChoice < 0.66) {
                fr = 255; fg = 100 + Math.random() * 100; fb = 0; // Orange
            } else {
                fr = 255; fg = 255; fb = 20 + Math.random() * 40; // Yellow
            }
            
            const flameSize = 2 + Math.random() * 3;
            const flameLifetime = 15 + Math.random() * 20;
            
            spawnParticle(event.x, event.y, 0, fvx, fvy, fvz, fr, fg, fb, flameSize, flameLifetime, 'flame');
        }
    } else if (event.type === 'animal_explosion') {
        const particleCount = 10;
        for (let i = 0; i < particleCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 1.5 + 0.5;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            const vz = (Math.random() - 0.5) * 1;
            
            // Red blood color
            const r = 200 + Math.random() * 55;
            const g = 0;
            const b = 0;
            
            const size = Math.random() * 1.5 + 1;
            const lifetime = 30 + Math.random() * 20;
            
            spawnParticle(event.x, event.y, 0, vx, vy, vz, r, g, b, size, lifetime, 'water');
        }
    } else if (event.type === 'gunshot') {
        // Gunshot event - smoke particles and muzzle flash
        // event.angle is the gun angle
        // event.velocity is the projectile speed
        // event.size is the projectile size
        const projectileSpeed = event.velocity || 100;
        const projectileSize = event.size || 1;
        
        console.log('Gunshot event:', {
            projectileSpeed,
            projectileSize,
            angle: event.angle,
            x: event.x,
            y: event.y,
            fullEvent: event
        });
        
        // Random speed factor between 0.5 and 1.5
        const speedFactor = 0.5 + Math.random();
        
        // Calculate base particle speed, normalized
        const particleSpeed = speedFactor * (projectileSpeed / 100);
        
        // Helper function: Generate angle with distribution heavier near center
        // Uses triangular distribution for weighted randomness
        const getWeightedAngleSpread = (maxSpreadDegrees) => {
            const maxSpreadRad = maxSpreadDegrees * Math.PI / 180;
            // Triangular distribution: average of two random values gives center-weighted distribution
            const r1 = Math.random() - 0.5;
            const r2 = Math.random() - 0.5;
            return (r1 + r2) * maxSpreadRad;
        };
        
        // Projectile size affects particle count and size
        // More smoke particles for larger projectiles
        const baseSmokeCount = 3 + Math.floor(Math.random() * 3); // 3-5 base
        const smokeCount = Math.floor(baseSmokeCount * projectileSize);
        
        // Spawn smoke particles
        for (let i = 0; i < smokeCount; i++) {
            // Tight cone within ±15 degrees, heavier distribution near true angle
            const spread = getWeightedAngleSpread(15);
            const smokeAngle = event.angle + spread;
            
            // Reduced and more randomized speed for smoke
            const smokeSpeedFactor = 0.2 + Math.random() * 0.6; // Random factor between 0.2 and 0.8
            const smokeSpeed = smokeSpeedFactor * (projectileSpeed / 100);

            // Particle velocity based on angle and speed
            const svx = Math.cos(smokeAngle) * smokeSpeed;
            const svy = Math.sin(smokeAngle) * smokeSpeed;
            const svz = (Math.random() - 0.5) * 0.3;
            
            // Gray/dark smoke colors
            const smokeShade = 80 + Math.random() * 100; // 80-180 gray
            const size = 1.5 + Math.random() * 2; // Size is no longer affected by projectileSize
            const lifetime = 20 + Math.random() * 30;
            
            spawnParticle(event.x, event.y, 0, svx, svy, svz, smokeShade, smokeShade, smokeShade, size, lifetime, 'smoke');
        }
        
        // Muzzle blast flame particles - count also scales with projectile size
        const baseFlameCount = 8 + Math.floor(Math.random() * 5); // 8-12 base
        const flameCount = Math.floor(baseFlameCount * projectileSize);
        
        // Spawn muzzle blast flame particles
        for (let i = 0; i < flameCount; i++) {
            // Tight cone within ±15 degrees, heavier distribution near true angle
            const spread = getWeightedAngleSpread(15);
            const flameAngle = event.angle + spread;
            
            // Slower and more random speed for muzzle blast
            const flameSpeedFactor = 0.3 + Math.random() * 0.5; // Random factor between 0.3 and 0.8
            const flameSpeed = flameSpeedFactor * (projectileSpeed / 100);

            // Particle velocity based on angle and speed
            const fvx = Math.cos(flameAngle) * flameSpeed;
            const fvy = Math.sin(flameAngle) * flameSpeed;
            const fvz = (Math.random() - 0.5) * 0.5;
            
            // Bright orange/yellow for muzzle flash
            let fr, fg, fb;
            const colorChoice = Math.random();
            if (colorChoice < 0.4) {
                // Bright orange
                fr = 255;
                fg = 120 + Math.random() * 80;
                fb = 0;
            } else if (colorChoice < 0.8) {
                // Yellow-orange
                fr = 255;
                fg = 200 + Math.random() * 55;
                fb = 0;
            } else {
                // Bright yellow
                fr = 255;
                fg = 240 + Math.random() * 15;
                fb = 50 + Math.random() * 50;
            }
            
            const flameSize = 1 + Math.random() * 1.5; // Size is no longer affected by projectileSize
            const flameLifetime = 4 + Math.random() * 6; // Shorter lifetime for a quick flash
            
            spawnParticle(event.x, event.y, 0, fvx, fvy, fvz, fr, fg, fb, flameSize, flameLifetime, 'flame');
        }

    } else if (event.type === 'explosion') {
        // Large explosion - lots of fire and smoke
        const explosionScale = 0.5;
        
        // Spawn flame particles (30-50 particles for large explosion)
        var explosionFlameCount = Math.floor(30 + Math.random() * 20);
        for (let i = 0; i < explosionFlameCount; i++) {
            // Random angle in all directions
            const angle = Math.random() * Math.PI * 2;
            
            // Expanding outward with varying speeds
            const speed = (1 + Math.random() * 3) * explosionScale;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            const vz = (Math.random() - 0.5) * 1;
            
            // Flame colors - red/orange/yellow
            const colorChoice = Math.random();
            let r, g, b;
            if (colorChoice < 0.4) {
                r = 255; g = 30 + Math.random() * 70; b = 0; // Red (40%)
            } else if (colorChoice < 0.7) {
                r = 255; g = 100 + Math.random() * 100; b = 0; // Orange (30%)
            } else {
                r = 255; g = 255; b = 20 + Math.random() * 40; // Yellow (30%)
            }
            
            const size = (6 + Math.random()) * explosionScale; // Larger flames
            const lifetime = 60 + Math.random() * 120; // 2-3 seconds (60-180 frames)
            
            spawnParticle(event.x, event.y, 0, vx, vy, vz, r, g, b, size, lifetime, 'flame');
        }
        
        // Spawn smoke particles (20-30 particles)
        const explosionSmokeCount = Math.floor(20 + Math.random() * 10) * explosionScale;
        for (let i = 0; i < explosionSmokeCount; i++) {
            // Random angle in all directions
            const angle = Math.random() * Math.PI * 2;
            
            // Slower expansion than flames
            const speed = (0.5 + Math.random() * 1.5) * explosionScale;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed - 0.2; // Slight upward drift
            const vz = (Math.random() - 0.5) * 0.5;
            
            // Dark gray/black smoke
            const r = 80 + Math.random() * 40; // 80-120 (darker)
            const g = 80 + Math.random() * 40;
            const b = 80 + Math.random() * 40;
            
            const size = (4 + Math.random() * 6) * explosionScale; // Large smoke clouds
            const lifetime = 300 + Math.random() * 120; // 5-7 seconds (300-420 frames)
            
            spawnParticle(event.x, event.y, 0, vx, vy, vz, r, g, b, size, lifetime, 'smoke');
        }
    }
}

function displayCrates(centerX = 0, centerY = -400) {
    for (let i in crates) {
        const crate = crates[i];
        displayCrate(crate, centerX, centerY);
    }
}

function displayCrate(crate, centerX = 0, centerY = -400) {
    // Debug logging for attached crates that are far from their carrier
    if (crate.carrier && crate.carrier === username) {
        const currentPlayer = players.find(p => p.username === username);
        if (currentPlayer) {
            const distanceToPlayer = Math.sqrt((crate.x - currentPlayer.x) ** 2 + (crate.y - currentPlayer.y) ** 2);
            if (distanceToPlayer > 500) {
                // debug removed
            }
        }
    }

    // Spawn foam particles if crate is in water and moving
    const crateBiome = getBiomeAtPosition(crate.x, crate.y);
    if (crateBiome === 'water') {
        const crateSpeed = Math.sqrt(crate.vx ** 2 + crate.vy ** 2);
        if (crateSpeed > 0.5 && Math.random() < 0.35) { // 35% chance when displaying moving crates (increased from 10%)
            spawnWaterFoamParticles(crate.x, crate.y, { vx: crate.vx, vy: crate.vy }, 1.5);
        }
    }

    push();
    textSize(12);
    textAlign(CENTER);
    if (crate.type === 'money') {
        fill(222, 191, 138);
    } else if (crate.type === 'component') {
        fill(255, 156, 69);
    } else if (crate.type === 'weapon') {
        fill(220, 50, 50);
    } else {
        fill(0, 255, 0);
    }
    const drawX = windowWidth / 2 + (crate.x - centerX);
    const drawY = windowHeight / 2 + (crate.y - centerY);
    const s = crate.size; // size scale
    stroke(168, 144, 103);

    // If crate is attached to a player or enemy, draw a line (rope) to the carrier
    if (crate.carrier) {
        // Find the carrier player object by username
        const carrierPlayer = players.find(p => p.username === crate.carrier);
        if (carrierPlayer) {
            // Use display coordinates if available (for smoothing), otherwise physics coordinates
            const pX = (typeof carrierPlayer.displayX !== 'undefined') ? carrierPlayer.displayX : carrierPlayer.x;
            const pY = (typeof carrierPlayer.displayY !== 'undefined') ? carrierPlayer.displayY : carrierPlayer.y;

            const carrierDrawX = windowWidth / 2 + (pX - centerX);
            const carrierDrawY = windowHeight / 2 + (pY - centerY);
            line(drawX, drawY, carrierDrawX, carrierDrawY);
        } else {
            // Check if carrier is an enemy
            const carrierEnemy = enemies.find(e => e.username === crate.carrier);
            if (carrierEnemy) {
                const carrierDrawX = windowWidth / 2 + (carrierEnemy.x - centerX);
                const carrierDrawY = windowHeight / 2 + (carrierEnemy.y - centerY);
                line(drawX, drawY, carrierDrawX, carrierDrawY);
            }
        }
    }

    strokeWeight(1);
    translate(drawX, drawY);
    rotate(crate.angle); // assumes angle in radians

    // Scale the rectangle points by crate size
    rectMode(CENTER);
    rect(0, 0, 2 * s, 2 * s);

    pop();
}

function displayControlledPlayerStatus(player, drawX, drawY) {
    const speed = Math.sqrt(player.vx ** 2 + player.vy ** 2);
    drawThrottleArc(player, drawX, drawY);
    drawPlaneHeat(player, drawX, drawY);
    drawPlaneHull(player, drawX, drawY);
    drawSpeed(player, drawX, drawY);
    if (speed > player.chassis.topSpeed) drawOverSpeedFireIcon(player, drawX, drawY);
    else drawStallWarning(player, drawX, drawY);
    drawGunCursor(player, drawX, drawY);
    drawGunHeat(player, drawX, drawY);
    drawGunArc(player, drawX, drawY);
    // Info and Compass are HUD elements, moved to Game.js for unscaled drawing
    // drawPlaneInfo(player);
    // drawCompass(player);

    // drawEnemyTargetIndicators moved to main loop
    if (player.browsing) {
        displayInventory(player, drawX, drawY);
    }
    // Shop UI is now handled in Game.js to prevent scaling issues
}

function drawOverSpeedFireIcon(player, drawX, drawY) {
    if (player.biome === 'recovery') return;
    push();
    translate(drawX + 40, drawY - 30);
    scale(1.2);
    noStroke();

    // Base red flame (ellipse)
    fill(255, 0, 0);
    ellipse(0, 5, 18, 14);

    // Middle orange flame (ellipse)
    fill(255, 140, 0);
    ellipse(0, 4, 14, 13);

    // Central yellow tip (ellipse, smaller, a bit offset)
    fill(255, 220, 0);
    ellipse(0, 3, 8, 12);

    // Left flick of flame (triangle)
    fill(255, 180, 0);
    triangle(-6, 7, -2, -8, 0, 6);

    // Right flick of flame (triangle)
    fill(255, 180, 0);
    triangle(6, 7, 0, -6, 0, 6);

    pop();
}

function getUIScale() {
    const w = windowWidth || width;
    // Scale down if width is less than standard desktop (1280px)
    // Mobile width ~400 -> scale ~0.5
    // Tablet ~800 -> scale ~0.8
    if (w < 1280) {
        return Math.min(1.0, Math.max(0.5, w / 1000));
    }
    return 1.0;
}

function drawPlaneInfo(player) {
    push();
    
    const s = getUIScale();
    const startX = 20 * s;
    let currentY = 20 * s;
    
    noStroke();
    textAlign(LEFT, TOP);
    
    // Money display
    fill(100, 255, 100);
    textSize(32 * s);
    textStyle(BOLD);
    text('$' + player.money.toLocaleString(), startX, currentY);
    currentY += 45 * s;
    
    // Plane value display
    fill(200, 200, 100);
    textSize(18 * s);
    textStyle(NORMAL);
    text('Plane Value: $' + player.value.toLocaleString(), startX, currentY);
    currentY += 35 * s;
    
    // Component icons
    const iconSize = 40 * s;
    const iconSpacing = 60 * s;
    const iconsStartX = startX + iconSize / 2; // Offset by half icon size since drawItem draws from center
    
    // Store regions for hover detection
    if (!window.topRightComponentRegions) window.topRightComponentRegions = [];
    window.topRightComponentRegions = [];
    
    // Draw engine icon
    push();
    translate(iconsStartX, currentY + iconSize / 2);
    drawItem(player.engine, 0, 0, iconSize);
    pop();
    window.topRightComponentRegions.push({
        component: player.engine,
        x: iconsStartX,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    // Draw chassis icon
    push();
    translate(iconsStartX + iconSpacing, currentY + iconSize / 2);
    drawItem(player.chassis, 0, 0, iconSize);
    pop();
    window.topRightComponentRegions.push({
        component: player.chassis,
        x: iconsStartX + iconSpacing,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    // Draw wings icon
    push();
    translate(iconsStartX + iconSpacing * 2, currentY + iconSize / 2);
    drawItem(player.wings, 0, 0, iconSize);
    pop();
    window.topRightComponentRegions.push({
        component: player.wings,
        x: iconsStartX + iconSpacing * 2,
        y: currentY + iconSize / 2,
        size: iconSize
    });

    pop();
}
    push();
    translate(iconsStartX + iconSpacing, currentY + iconSize / 2);
    drawItem(player.chassis, 0, 0, iconSize);
    pop();
    window.topRightComponentRegions.push({
        component: player.chassis,
        x: iconsStartX + iconSpacing,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    // Draw wings icon
    push();
    translate(iconsStartX + iconSpacing * 2, currentY + iconSize / 2);
    drawItem(player.wings, 0, 0, iconSize);
    pop();
    window.topRightComponentRegions.push({
        component: player.wings,
        x: iconsStartX + iconSpacing * 2,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    currentY += iconSize + 20;
    
    // Draw weapon icons centered under the 3 components
    // Components span: iconsStartX to (iconsStartX + 2*iconSpacing)
    // Center 2 weapons under 3 components by offsetting by half spacing
    const weaponsStartX = startX + iconSize / 2 + iconSpacing / 2;
    
    // Draw gun1 icon
    push();
    translate(weaponsStartX, currentY + iconSize / 2);
    drawItem(player.gun1, 0, 0, iconSize);
    // Draw equipped indicator if this gun is selected
    if (player.selectedGun === 1) {
        fill(100, 255, 100);
        noStroke();
        circle(iconSize / 2, -5, 8);
    }
    pop();
    window.topRightComponentRegions.push({
        component: player.gun1,
        x: weaponsStartX,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    // Draw gun2 icon
    push();
    translate(weaponsStartX + iconSpacing, currentY + iconSize / 2);
    drawItem(player.gun2, 0, 0, iconSize);
    // Draw equipped indicator if this gun is selected
    if (player.selectedGun === 2) {
        fill(100, 255, 100);
        noStroke();
        circle(iconSize / 2, -5, 8);
    }
    pop();
    window.topRightComponentRegions.push({
        component: player.gun2,
        x: weaponsStartX + iconSpacing,
        y: currentY + iconSize / 2,
        size: iconSize
    });
    
    pop();
    
    // Draw component stats popup on hover
    drawTopRightComponentStats(player);
}

// Helper function to generate component stats array
function getComponentStats(component, equippedComponent = null) {
    // Helper to round to 1 decimal place
    const round1 = (val) => Math.round(val * 10) / 10;
    
    const roundedValue = Math.round(component.value);
    const formattedValue = '$' + roundedValue.toLocaleString();
    
    if (component.type === 'engine') {
        return [
            { label: 'Max Power', value: round1(component.maxPower), equipped: equippedComponent ? round1(equippedComponent.maxPower) : null },
            { label: 'Heat Use', value: round1(component.heatEfficiency * 100), equipped: equippedComponent ? round1(equippedComponent.heatEfficiency * 100) : null, lowerIsBetter: true },
            { label: 'Max Heat', value: round1(component.maxHeat), equipped: equippedComponent ? round1(equippedComponent.maxHeat) : null },
            { label: 'Weight', value: round1(component.weight), equipped: equippedComponent ? round1(equippedComponent.weight) : null, lowerIsBetter: true },    
            { label: 'Value', value: formattedValue, numericValue: roundedValue, equipped: equippedComponent ? Math.round(equippedComponent.value) : null, lowerIsBetter: true }
        ];
    } else if (component.type === 'chassis') {
        return [
            { label: 'Max Hull', value: round1(component.maxHull), equipped: equippedComponent ? round1(equippedComponent.maxHull) : null },
            { label: 'Top Speed', value: round1(component.topSpeed), equipped: equippedComponent ? round1(equippedComponent.topSpeed) : null },
            { label: 'Heat Dispersion', value: round1(component.heatDispersion), equipped: equippedComponent ? round1(equippedComponent.heatDispersion) : null },
            { label: 'Buoyancy', value: round1(component.buoyancy), equipped: equippedComponent ? round1(equippedComponent.buoyancy) : null },
            { label: 'Weight', value: round1(component.weight), equipped: equippedComponent ? round1(equippedComponent.weight) : null, lowerIsBetter: true },
            { label: 'Value', value: formattedValue, numericValue: roundedValue, equipped: equippedComponent ? Math.round(equippedComponent.value) : null, lowerIsBetter: true }
        ];
    } else if (component.type === 'wings') {
        return [
            { label: 'Max Speed', value: round1(component.maxSpeed), equipped: equippedComponent ? round1(equippedComponent.maxSpeed) : null },
            { label: 'Base Turn Speed', value: round1(component.baseTurnSpeed * 100), equipped: equippedComponent ? round1(equippedComponent.baseTurnSpeed * 100) : null },
            { label: 'Min Turn Speed', value: round1(component.minTurnSpeed * 100), equipped: equippedComponent ? round1(equippedComponent.minTurnSpeed * 100) : null },
            { label: 'Lift Efficiency', value: round1(component.liftEfficiency * 100), equipped: equippedComponent ? round1(equippedComponent.liftEfficiency * 100) : null },
            { label: 'Min Lift Speed', value: round1(component.minLiftSpeed), equipped: equippedComponent ? round1(equippedComponent.minLiftSpeed) : null, lowerIsBetter: true },
            { label: 'Weight', value: round1(component.weight), equipped: equippedComponent ? round1(equippedComponent.weight) : null, lowerIsBetter: true },
            { label: 'Value', value: formattedValue, numericValue: roundedValue, equipped: equippedComponent ? Math.round(equippedComponent.value) : null, lowerIsBetter: true }
        ];
    } else if (component.type === 'gun') {
        // Calculate DPS: shots per second * damage per shot
        let dps;
        if (component.cooldownTime <= 0) dps = round1(component.damage);
        else dps = round1((1000 / component.cooldownTime) * component.damage);
        
        let equippedDps = null;
        if (equippedComponent) {
             if (equippedComponent.cooldownTime <= 0) equippedDps = round1(equippedComponent.damage);
             else equippedDps = round1((1000 / equippedComponent.cooldownTime) * equippedComponent.damage);
        }
        
        // Convert maxAngle from radians to degrees for display (Doubled as requested)
        const angleDegrees = Math.round(component.maxAngle * (180 / Math.PI)) * 2;
        const equippedAngleDegrees = equippedComponent ? Math.round(equippedComponent.maxAngle * (180 / Math.PI)) * 2 : null;
        
        return [
            { label: 'DPS', value: round1(dps), equipped: equippedDps },
            { label: 'Max Angle', value: angleDegrees + '°', numericValue: angleDegrees, equipped: equippedAngleDegrees },
            { label: 'Damage', value: round1(component.damage), equipped: equippedComponent ? round1(equippedComponent.damage) : null },
            { label: 'Range', value: round1(component.projectileRange), equipped: equippedComponent ? round1(equippedComponent.projectileRange) : null },
            { label: 'Lifetime', value: round1(component.projectileLifetime) + 'ms', numericValue: round1(component.projectileLifetime), equipped: equippedComponent ? round1(equippedComponent.projectileLifetime) : null },
            { label: 'Cooldown', value: round1(component.cooldownTime) + 'ms', numericValue: round1(component.cooldownTime), equipped: equippedComponent ? round1(equippedComponent.cooldownTime) : null, lowerIsBetter: true },
            { label: 'Max Heat', value: round1(component.maxHeat), equipped: equippedComponent ? round1(equippedComponent.maxHeat) : null },
            { label: 'Heat Use', value: round1(component.heatEfficiency), equipped: equippedComponent ? round1(equippedComponent.heatEfficiency) : null, lowerIsBetter: true },
            { label: 'Heat Dispersion', value: round1(component.heatDispersion), equipped: equippedComponent ? round1(equippedComponent.heatDispersion) : null },
            { label: 'Projectile Speed', value: round1(component.projectileSpeed), equipped: equippedComponent ? round1(equippedComponent.projectileSpeed) : null },
            { label: 'Weight', value: round1(component.weight), equipped: equippedComponent ? round1(equippedComponent.weight) : null, lowerIsBetter: true },
            { label: 'Value', value: formattedValue, numericValue: roundedValue, equipped: equippedComponent ? Math.round(equippedComponent.value) : null, lowerIsBetter: true }
        ];
    }
    return [];
}

// Helper function to draw component popup background and header
function drawComponentPopupBase(componentName, stats, popupWidth, lineHeight, padding) {
    const popupHeight = padding * 2 + lineHeight * (stats.length + 1);
    
    // Position popup near mouse, but keep it on screen
    let popupX = mouseX + 20;
    let popupY = mouseY + 20;
    
    if (popupX + popupWidth > windowWidth) popupX = mouseX - popupWidth - 20;
    if (popupY + popupHeight > windowHeight) popupY = mouseY - popupHeight - 20;
    
    push();
    rectMode(CORNER);
    
    // Background
    fill(20, 20, 30, 240);
    stroke(200, 200, 220);
    strokeWeight(2);
    rect(popupX, popupY, popupWidth, popupHeight, 8);
    
    // Header
    fill(255, 255, 255);
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    
    return { popupX, popupY, popupHeight };
}

function drawTopRightComponentStats(player) {
    if (!window.topRightComponentRegions || window.topRightComponentRegions.length === 0) return;
    
    let targetComponent = null;

    if (typeof isMobile !== 'undefined' && isMobile) {
        if (window.mobileSelection && window.mobileSelection.type === 'equipped') {
             targetComponent = window.mobileSelection.item;
        }
    } else {
        // Find which component is being hovered
        for (let region of window.topRightComponentRegions) {
            if (dist(mouseX, mouseY, region.x, region.y) <= region.size / 2) {
                targetComponent = region.component;
                break;
            }
        }
    }
    
    if (!targetComponent) return;
    
    const stats = getComponentStats(targetComponent);
    const popupWidth = 250;
    const lineHeight = 20;
    const padding = 10;
    
    const { popupX, popupY } = drawComponentPopupBase(targetComponent.name, stats, popupWidth, lineHeight, padding);
    
    textSize(16);
    text(targetComponent.name, popupX + padding, popupY + padding);
    
    // Stats
    textSize(14);
    textStyle(NORMAL);
    let y = popupY + padding + lineHeight;
    
    for (let stat of stats) {
        fill(200, 200, 200);
        text(stat.label + ':', popupX + padding, y);
        fill(255, 255, 255);
        text(stat.value, popupX + padding + 150, y);
        y += lineHeight;
    }
    
    pop();
}



function drawStallWarning(player, drawX, drawY) {
    speed = Math.sqrt(player.vx ** 2 + player.vy ** 2).toFixed(0);
    
    // Check if player is near water surface (floating or landing)
    let nearWater = false; // Default false
    if (typeof mapData !== 'undefined' && mapData.biomes) {
        const waterBiome = mapData.biomes.find(b => b.type === 'water');
        // Check if within 25 units of water surface (floating height is ~12-15 units above)
        if (waterBiome && player.y > waterBiome.y1 - 25) { 
            nearWater = true;
        }
    }

    // Determine if we should suppress warnings because we are "floating"
    // Floating criteria: Near water AND low/no throttle.
    // If throttle is high, we are likely attempting to take off or fly low, so show stall warnings.
    let isFloating = false;
    if (nearWater) {
        // Safe access to engine power (sync'd from server)
        const enginePower = (player.engine && player.engine.power !== undefined) ? player.engine.power : 999;
        const minPower = (player.engine && player.engine.minPower !== undefined) ? player.engine.minPower : 0;
        
        if (enginePower <= minPower) {
            isFloating = true;
        }
    }

    // Draw stalling icon if stalling is true
    // Hide in recovery, actual water biome, or if floating on surface
    if (player.biome !== 'recovery' && player.biome !== 'water' && !isFloating) {
        if (player.stalling) {
            drawStallIndicator(player, drawX, drawY, 255, 0, 0);
        } else if (speed < player.wings.minLiftSpeed) {
            drawStallIndicator(player, drawX, drawY, 255, 255, 0);
        }
    }
}

function drawStallIndicator(player, drawX, drawY, r, g, b) {
    push();
    translate(drawX + 30, drawY - 30);
    fill(r, g, b);
    stroke(0);
    ellipse(0, 0, 20, 20);
    if (r + g + b >= 382.5) fill(0)
    else fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(14);
    text("!", 0, 1); // Exclamation mark
    pop();
}

function displayOtherPlayerStatus(player, drawX, drawY) {
    drawPlaneHull(player, drawX, drawY);
}

function drawGunCursor(player, drawX, drawY) {
    if (typeof isMobile !== 'undefined' && isMobile) return;

    var gun;
    if (player.selectedGun === 1) {
        gun = player.gun1;
    } else {
        gun = player.gun2;
    }
    const cursorSize = 10; // length of each line in the crosshair
    const cursorOffset = 100; // Offset from the player's position
    const cursorX = drawX + Math.cos(gun.angle) * cursorOffset;
    const cursorY = drawY + Math.sin(gun.angle) * cursorOffset;

    push();
    stroke(255, 255, 255);
    noFill();

    // Draw crosshair at gun's aiming position
    line(cursorX - cursorSize / 2, cursorY, cursorX + cursorSize / 2, cursorY);
    line(cursorX, cursorY - cursorSize / 2, cursorX, cursorY + cursorSize / 2);
    pop();
}

function drawGunHeat(player, drawX, drawY) {
    const heatRatio1 = Math.max(0, Math.min(1, player.gun1.heat / player.gun1.maxHeat));
    const heatRatio2 = Math.max(0, Math.min(1, player.gun2.heat / player.gun2.maxHeat));
    
    push();
    stroke(255);
    noFill();
    if (player.selectedGun === 1) {
        rect(drawX - 50, drawY, 10, 50);
    } else {
        rect(drawX + 50, drawY, 10, 50);
    }
    noStroke();
    fill(200, 100, 0)
    rect(drawX - 50, drawY, 10, 50 * heatRatio1);
    rect(drawX + 50, drawY, 10, 50 * heatRatio2);
    pop();
}

function drawGunArc(player, drawX, drawY, options = {}) {
    // Get selected gun and max angle (in radians)
    const gun = player.selectedGun === 2 ? player.gun2 : player.gun1;
    const maxAngle = gun.maxAngle ?? (Math.PI / 4); // fallback to 45deg if not set

    const arcRadius = options.radius || 105;
    const arcThickness = options.thickness || 4;
    const arcColor = options.color || [0, 200, 255, 120];

    push();
    translate(drawX, drawY);
    rotate(player.angle); // Player's facing direction

    stroke(...arcColor);
    strokeWeight(arcThickness);
    noFill();
    // Draw arc from -maxAngle to +maxAngle (relative to the front)
    arc(
        0, 0,
        arcRadius * 2, arcRadius * 2,
        -maxAngle, maxAngle
    );

    pop();
}

function drawThrottleArc(player, drawX, drawY) {
    const maxThrottle = player.engine.maxPower;
    const throttle = Math.max(0, player.engine.power); // clamp to 0 if needed
    // Prevent division by zero, but allow maxThrottle to be 0 (which would result in normalized = 0)
    const normalized = maxThrottle > 0 ? Math.max(0, Math.min(1, throttle / maxThrottle)) : 0;

    const arcRadius = 40;
    const arcThickness = 5;
    const startAngle = -PI / 2 - QUARTER_PI;
    const endAngle = -PI / 2 + QUARTER_PI;

    push();
    translate(drawX, drawY);
    strokeWeight(arcThickness);
    noFill();

    // Background arc
    stroke(100, 100, 100, 150);
    arc(0, 0, arcRadius * 2, arcRadius * 2, startAngle, endAngle);

    // Filled portion based on normalized throttle (from 0 to 1)
    if (normalized > 0.001) { // Only draw arc if throttle is above a small threshold
        stroke(0, 255, 0, 220);
        const throttleAngle = startAngle + (endAngle - startAngle) * normalized;
        // Ensure we don't draw a full circle due to angle precision issues
        const clampedThrottleAngle = Math.max(startAngle + 0.01, Math.min(endAngle, throttleAngle));
        arc(0, 0, arcRadius * 2, arcRadius * 2, startAngle, clampedThrottleAngle);
    }

    pop();
}

function drawPlaneHeat(player, drawX = 0, drawY = 0) {
    if (player.biome === 'recovery') return;
    const arcRadius = 60;
    const arcThickness = 4;
    // Add safety check for negative maxHeat to prevent division issues
    const maxHeat = Math.max(1, player.engine.maxHeat);
    const heatRatio = Math.max(0, Math.min(1, player.engine.heat / maxHeat));
    push();
    translate(drawX, drawY);
    strokeWeight(arcThickness);
    noFill();
    // Heat arc (right bottom semicircle: from 2*PI to PI)
    // We'll draw this in the opposite direction so it doesn't overlap
    if (heatRatio > 0.001) { // Only draw if above threshold to prevent full circles
        stroke(255 * heatRatio, 255 - (255 * heatRatio), 255 - (255 * heatRatio), 100 + 155 * heatRatio);
        const heatEndAngle = Math.max(Math.PI, 2 * Math.PI - Math.PI * -heatRatio); // Clamp to prevent full circles
        arc(
            0, 0,
            arcRadius * 1.2, arcRadius * 1.2,
            2 * Math.PI,                    // start at 360°
            heatEndAngle,                   // clamped end angle
            true                           // draw counter-clockwise
        );
    }
    pop();
}

function drawPlaneHull(player, drawX = 0, drawY = 0) {
    const arcRadius = 60;
    const arcThickness = 4;
    // Support both direct hull (boats) and chassis.hull (planes/players)
    const currentHull = (typeof player.hull === 'number') ? player.hull : (player.chassis && typeof player.chassis.hull === 'number' ? player.chassis.hull : 0);
    const maxHull = (typeof player.maxHull === 'number') ? player.maxHull : (player.chassis && typeof player.chassis.maxHull === 'number' ? player.chassis.maxHull : 1);
    const hullRatio = Math.max(0, Math.min(1, currentHull / maxHull));
    push();
    translate(drawX, drawY);
    strokeWeight(arcThickness);
    noFill();
    // Hull arc (left bottom semicircle: from PI to 2*PI)
    if (hullRatio > 0.001) { // Only draw if above threshold to prevent full circles
        if (player.keys['r']) {
            stroke(200, 255, 50, 200)
        } else {
            stroke(50, 255, 50, 200);
        }
        const hullEndAngle = Math.max(Math.PI, 2 * Math.PI - Math.PI * -hullRatio); // Clamp to prevent full circles
        arc(
            0, 0,
            arcRadius, arcRadius,
            2 * Math.PI,                    // start at 360°
            hullEndAngle,                   // clamped end angle
            true                           // draw counter-clockwise
        );
    }
    pop();
}

function drawSpeed(player, drawX, drawY) {
    push();
    // Defensive noStroke to avoid outlines from previous UI drawing state
    noStroke();
    fill(255);
    text(Math.sqrt(player.vx ** 2 + player.vy ** 2).toFixed(0), drawX, drawY - 50);
    pop();
}

function drawCompass(controlledPlayer) {
    let dist = Math.abs(controlledPlayer.x);
    if (dist >= 1000) {
        push();
        textSize(32);
        textAlign(CENTER, CENTER);
        fill(255);
        let label = (dist / 1000).toFixed(1) + "km";
        if (controlledPlayer.x < -0.01) text(label + " west of center", windowWidth / 2, 30);
        else if (controlledPlayer.x > 0.01) text(label + " east of center", windowWidth / 2, 30);
        pop();
    }
}

function displayMessages(player, drawX, drawY) {
    push();
    stroke(0);
    fill(255);
    textSize(12);
    textAlign(CENTER);
    
    if (!chatting || player.username !== username) {
        for (let i in player.messages) {
            const message = player.messages[i];
            text(message[1], drawX, drawY + 50 + (i * 15));
            if (!chat_messages.find(msg => msg.id === message[0])) {
                chat_messages.push({ id: message[0], username: player.username, message: message[1] });
            }
        }
    } else {
        for (let i in player.messages) {
            const message = player.messages[i];
            text(message[1], drawX, drawY + 50 + (i * 15));
            if (!chat_messages.find(msg => msg.id === message[0])) {
                chat_messages.push({ id: message[0], username: player.username, message: message[1] });
            }
        }
        push();
        stroke(0);
        strokeWeight(1);
        textStyle(ITALIC);
        textSize(12);
        fill(0, 0, 0);
        rect(drawX, drawY + 20, current_chat.length * 7 + 10, 20);
        fill(255, 255, 255);
        text(current_chat, drawX, drawY + 20);
        pop();
    }
    pop();
}

function displayChat() {
    push();
    noTint(); // Reset any transparency
    fill(255); // Solid white text
    stroke(0);
    strokeWeight(2); // Thick black outline for visibility without box
    textSize(12);
    textStyle(BOLD);
    textAlign(LEFT, BASELINE);
    
    // Filter and limit messages older than one hour
    chat_messages = chat_messages.filter((msg) => millis() - msg.id < 1 * 60 * 60 * 1000);
    const maxMsgs = 16;
    const lineHeight = 16;
    
    // We only display the latest 'maxMsgs'
    let displayCount = Math.min(chat_messages.length, maxMsgs);
    
    if (displayCount > 0) {
        for (let i = 0; i < displayCount; i++) {
            const message = chat_messages[chat_messages.length - 1 - i];
            // Render text from bottom up
            let textY = windowHeight - 15 - (i * lineHeight);
            text("[" + message.username + "] " + message.message, 20, textY);
        }
    }
    pop();
}

function displayNoticeMessages() {
    if (notice_messages.length > 0) {
        push();
        for (let i in notice_messages) {
            rectMode(CORNER);
            textAlign(LEFT, CENTER);
            textSize(20);
            noStroke();
            if (notice_messages[i].timeShown == 0) {
                notice_messages[i].timeShown = millis();
            }
            if (millis() - notice_messages[i].timeShown < notice_messages[i].timeDelay) {
                let r = 255;
                let g = 255;
                let b = 255;
                if (notice_messages[i].message_type === 'urgent') {
                    r = 255;
                    g = 0;
                    b = 0;
                }
                else if (notice_messages[i].message_type === 'game') {
                    r = 255;
                    g = 155;
                    b = 0;
                }
                else if (notice_messages[i].message_type === 'server') {
                    r = 0;
                    g = 0;
                    b = 255;
                } else if (notice_messages[i].message_type === 'pickup') {
                    r = 13;
                    g = 214;
                    b = 46;
                }
                fill(r, g, b);
                rect(windowWidth - notice_messages[i].message.length * 12 - 10, windowHeight / 4 + (38 * i), notice_messages[i].message.length * 12 + 10, 38);
                fill(r + 50, g + 50, b + 50);
                rect(windowWidth - notice_messages[i].message.length * 12 - 5, windowHeight / 4 + (38 * i), notice_messages[i].message.length * 12 + 10, 33);
                fill(255)
                stroke(0);
                text(notice_messages[i].message, windowWidth - notice_messages[i].message.length * 12, windowHeight / 4 + 24 + (38 * i));
            } else {
                notice_messages.splice(0, 1);
            }
        }
        pop();
    }
}

function displayInventory(controlledPlayer, playerScreenX, playerScreenY) {
    if (!controlledPlayer) return;

    // Check browsing state; if not browsing, clear regions and return.
    if (!controlledPlayer.browsing) {
        if (inventoryRegions.length > 0) {
            console.log("Clearing inventory regions as browsing state is false.");
            inventoryRegions = [];
        }
        return;
    } else {
        // Create a map of items to their original indices BEFORE sorting
        // Don't track original indices - we need to use current indices after sorting
        // Sort inventory for display - use a COPY so we don't modify the original array
        // This preserves the server's indexing
        let sortedInventory = controlledPlayer.inventory.slice(); // Make a copy
        sortInventory(sortedInventory);
        
        // Create a map from sorted items back to their original indices
        const sortedToOriginalIndex = new Map();
        sortedInventory.forEach((sortedItem) => {
            // Find this item's index in the original unsorted inventory
            const originalIndex = controlledPlayer.inventory.indexOf(sortedItem);
            sortedToOriginalIndex.set(sortedItem, originalIndex);
        });
        
        // Set constants for inventory display.
        const radius = 100; // World unit radius for inventory items.
        const slotSize = 40; // Display size for each item.
        push();
        rectMode(CENTER);
        inventoryRegions = computeInventoryRegions(sortedInventory, radius, slotSize, playerScreenX, playerScreenY, sortedToOriginalIndex);
        // Loop through computed regions and draw each inventory item.
        for (let region of inventoryRegions) {
            // Skip null or undefined items
            if (!region.item) continue;
            
            // Draw the inventory item using a helper function (assumes drawItem is defined).
            drawItem(region.item, region.x, region.y, region.size);
        }
        pop();
        
        // Draw comparison popup if hovering over an item
        drawComponentComparisonPopup(controlledPlayer, inventoryRegions, false);
    }
}

/**
 * Display shop interface when player is in a recovery zone
 * Shows available items with prices and handles click regions
 */
function displayShop(controlledPlayer) {
    // Only show shop if shopOpen is true
    if (!shopOpen || !controlledPlayer || controlledPlayer.biome !== 'recovery') {
        // Clear shop regions when not in recovery zone or shop is closed
        if (shopRegions.length > 0) {
            shopRegions = [];
        }
        return;
    }

    // Find the shop for the current recovery zone
    const currentZone = mapData.biomes.find(b => 
        b.type === 'recovery' && 
        b.x1 <= controlledPlayer.x && controlledPlayer.x <= b.x2 &&
        b.y1 <= controlledPlayer.y && controlledPlayer.y <= b.y2
    );

    if (!currentZone) {
        shopRegions = [];
        return;
    }

    const currentShop = shops.find(shop => shop.recoveryZoneId === currentZone.id);
    if (!currentShop || !currentShop.inventory || currentShop.inventory.length === 0) {
        shopRegions = [];
        return;
    }

    // Shop display settings - made twice as wide, positioned on left side
    const s = getUIScale();
    const shopX = 20 * s; // Left side of screen
    const shopY = 100 * s; // Top of screen
    const itemWidth = 400 * s; // Doubled from 200
    const itemHeight = 80 * s;
    const itemSpacing = 10 * s;
    const headerHeight = 60 * s;

    push();
    rectMode(CORNER);

    // Shop background panel
    fill(40, 40, 50, 230);
    stroke(200, 200, 220);
    strokeWeight(2);
    rect(shopX - (10 * s), shopY - (10 * s), itemWidth + (20 * s), headerHeight + (itemHeight + itemSpacing) * currentShop.inventory.length + (20 * s), 10 * s);

    // Shop header
    fill(255, 255, 255);
    noStroke();
    textAlign(CENTER, TOP);
    textSize(20 * s);
    textStyle(BOLD);
    text("SHOP", shopX + itemWidth / 2, shopY);

    // Shop zone level indicator
    textSize(14 * s);
    textStyle(NORMAL);
    fill(150, 200, 255);
    const shopLevel = Math.abs(currentZone.x1 + currentZone.x2) / 2; // Center X position
    let levelText = "";
    if (shopLevel < 5000) levelText = "Level 1";
    else if (shopLevel < 14000) levelText = "Level 2";
    else if (shopLevel < 25000) levelText = "Level 3";
    else if (shopLevel < 40000) levelText = "Level 4";
    else if (shopLevel < 60000) levelText = "Level 5";
    else if (shopLevel < 80000) levelText = "Level 6";
    else if (shopLevel < 100000) levelText = "Level 7";
    else if (shopLevel < 120000) levelText = "Level 8";
    else if (shopLevel < 140000) levelText = "Level 9";
    else levelText = "Level 10";
    text(levelText, shopX + itemWidth / 2, shopY + 25);

    // Refresh timer
    const timeUntilRefresh = Math.max(0, currentShop.nextRefreshTime - Date.now());
    const minutesLeft = Math.floor(timeUntilRefresh / 60000);
    const secondsLeft = Math.floor((timeUntilRefresh % 60000) / 1000);
    textSize(12);
    fill(200, 200, 200);
    if (timeUntilRefresh < 20000) fill(255, 100, 100);
    text(`Refresh in ${minutesLeft}:${secondsLeft.toString().padStart(2, '0')}`, shopX + itemWidth / 2, shopY + 42);

    // Clear previous shop regions
    shopRegions = [];

    // Display each shop item
    for (let i = 0; i < currentShop.inventory.length; i++) {
        const shopItem = currentShop.inventory[i];
        const itemY = shopY + headerHeight + i * (itemHeight + itemSpacing);

        // Check if mouse is hovering
        const isHovering = mouseX >= shopX && mouseX <= shopX + itemWidth &&
                          mouseY >= itemY && mouseY <= itemY + itemHeight;

        // Item background
        fill(isHovering ? 70 : 50, isHovering ? 70 : 50, isHovering ? 80 : 60, 220);
        stroke(isHovering ? 255 : 180, isHovering ? 255 : 180, isHovering ? 100 : 200);
        strokeWeight(1);
        rect(shopX, itemY, itemWidth, itemHeight, 5);

        // Draw component icon on the left
        const iconX = shopX + 40;
        const iconY = itemY + itemHeight / 2;
        drawItem(shopItem.component, iconX, iconY, 35);

        // Component name on the right
        fill(255, 255, 255);
        noStroke();
        textAlign(LEFT, CENTER);
        textSize(16);
        textStyle(NORMAL);
        text(shopItem.component.name, shopX + 80, itemY + itemHeight / 2 - 10);

        // Price display
        const canAfford = controlledPlayer.money >= shopItem.price;
        fill(canAfford ? 100 : 255, canAfford ? 255 : 100, canAfford ? 100 : 100);
        textSize(18);
        textStyle(BOLD);
        text(`$${shopItem.price}`, shopX + 80, itemY + itemHeight / 2 + 15);

        // Store clickable region
        shopRegions.push({
            component: shopItem.component,
            price: shopItem.price,
            itemIndex: i,
            x: shopX,
            y: itemY,
            width: itemWidth,
            height: itemHeight
        });
    }

    pop();
    
    // Draw comparison popup if hovering over an item
    drawComponentComparisonPopup(controlledPlayer, shopRegions, true);
}

function drawMobileActionButtons(popupX, popupY, popupHeight, popupWidth, region, isShop) {
    const btnHeight = 40;
    const padding = 10;
    let currentY = popupY + popupHeight + padding;
    
    // Reset regions
    window.mobileActionButtons = []; 

    push();
    // Enforce drawing mode to ensure alignment matches calculation
    rectMode(CORNER);
    textSize(16);
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    
    if (isShop) {
        // BUY button
        const btnX = popupX;
        const btnW = popupWidth;
        
        fill(50, 200, 50);
        stroke(255);
        rect(btnX, currentY, btnW, btnHeight, 8);
        
        fill(255);
        noStroke();
        // Text at center of button rectangle
        text("BUY", btnX + btnW/2, currentY + btnHeight/2);
        
        window.mobileActionButtons.push({
            x: btnX, y: currentY, w: btnW, h: btnHeight,
            action: { type: 'buy', index: region.itemIndex }
        });
    } else {
        // Stacked Layout: EQUIP on top, SELL on bottom
        const btnW = popupWidth;
        
        // Equip (Top)
        const equipX = popupX;
        fill(50, 150, 250);
        stroke(255);
        rect(equipX, currentY, btnW, btnHeight, 8);
        
        fill(255);
        noStroke();
        text("EQUIP", equipX + btnW/2, currentY + btnHeight/2);
        
        window.mobileActionButtons.push({
            x: equipX, y: currentY, w: btnW, h: btnHeight,
            action: { type: 'equip', index: region.inventoryIndex }
        });
        
        currentY += btnHeight + padding;
        
        // Sell (Bottom)
        const sellX = popupX;
        fill(250, 150, 50);
        stroke(255);
        rect(sellX, currentY, btnW, btnHeight, 8);
        
        fill(255);
        noStroke();
        text("SELL", sellX + btnW/2, currentY + btnHeight/2);
        
        window.mobileActionButtons.push({
            x: sellX, y: currentY, w: btnW, h: btnHeight,
            action: { type: 'sell', index: region.inventoryIndex } 
        });
    }
    pop();
}

/**
 * Draw a comparison popup when hovering over a component
 * Shows all stats of the hovered component and compares to equipped component
 */
function drawComponentComparisonPopup(controlledPlayer, regions, isShop = false) {
    if (!controlledPlayer || !regions || regions.length === 0) return;
    
    let targetRegion = null;

    if (typeof isMobile !== 'undefined' && isMobile) {
        // Mobile: Check selection
        if (window.mobileSelection) {
             const sel = window.mobileSelection;
             const contextMatch = (isShop && sel.type === 'shop') || (!isShop && sel.type === 'inventory');
             
             if (contextMatch) {
                targetRegion = regions.find(r => 
                    (isShop ? r.itemIndex : r.inventoryIndex) === sel.index
                );
             }
        }
    } else {
        // Desktop: Hover logic
        for (let region of regions) {
            const inRegion = isShop ? 
                (mouseX >= region.x && mouseX <= region.x + region.width &&
                 mouseY >= region.y && mouseY <= region.y + region.height) :
                (dist(mouseX, mouseY, region.x, region.y) <= region.size / 2);
            
            if (inRegion) {
                targetRegion = region;
                break;
            }
        }
    }
    
    if (!targetRegion) return;
    
    const component = targetRegion.component || targetRegion.item;
    if (!component) return;
    
    // Get equipped component of the same type
    let equippedComponent = null;
    if (component.type === 'engine') equippedComponent = controlledPlayer.engine;
    else if (component.type === 'chassis') equippedComponent = controlledPlayer.chassis;
    else if (component.type === 'wings') equippedComponent = controlledPlayer.wings;
    else if (component.type === 'gun') {
        // For guns, compare to the currently selected gun
        equippedComponent = controlledPlayer.selectedGun === 2 ? controlledPlayer.gun2 : controlledPlayer.gun1;
    }
    
    const stats = getComponentStats(component, equippedComponent);
    const popupWidth = 300;
    const lineHeight = 20;
    const padding = 10;
    
    // Add extra height for hint text if showing inventory in recovery zone
    const extraLines = (!isShop && controlledPlayer.biome === 'recovery') ? 1 : 0;
    const statsWithExtra = [...stats];
    if (extraLines > 0) {
        // Add dummy stat entries for height calculation
        for (let i = 0; i < extraLines; i++) {
            statsWithExtra.push({ label: '', value: '' });
        }
    }
    
    // Increase popup height to accommodate buttons if mobile
    // We handle button drawing separately but need to know position?
    // Actually drawComponentPopupBase returns popup height based on stats.
    // We will draw buttons BELOW that.
    
    const { popupX, popupY, popupHeight } = drawComponentPopupBase(component.name, statsWithExtra, popupWidth, lineHeight, padding);
    
    textSize(14);
    text(component.name, popupX + padding, popupY + padding);
    
    // Stats with comparison
    textSize(12);
    textStyle(NORMAL);
    
    for (let i = 0; i < stats.length; i++) {
        const stat = stats[i];
        const y = popupY + padding + (i + 1) * lineHeight;
        
        // Stat label
        fill(180, 180, 180);
        text(stat.label + ':', popupX + padding, y);
        
        // Hovered value
        fill(255, 255, 255);
        text(stat.value, popupX + padding + 120, y);
        
        // Comparison arrow and equipped value
        if (stat.equipped !== null) {
            const hoveredVal = stat.numericValue !== undefined ? stat.numericValue : stat.value;
            const equippedVal = stat.equipped;
            const diff = hoveredVal - equippedVal;
            const roundedDiff = Math.round(diff * 10) / 10;
            
            const isImprovement = stat.lowerIsBetter ? (diff < 0) : (diff > 0);
            const isWorse = stat.lowerIsBetter ? (diff > 0) : (diff < 0);
            
            if (isImprovement) {
                fill(100, 255, 100);
                const sign = roundedDiff > 0 ? '+' : '';
                text('▲ ' + sign + roundedDiff, popupX + padding + 170, y);
            } else if (isWorse) {
                fill(255, 100, 100);
                const sign = roundedDiff > 0 ? '+' : '';
                text('▼ ' + sign + roundedDiff, popupX + padding + 170, y);
            } else {
                fill(200, 200, 200);
                text('=', popupX + padding + 170, y);
            }
        }
    }
    
    // Add hint text for selling items in recovery zone (only for inventory, not shop)
    // Mobile doesn't need this hint as it has buttons.
    if (!isShop && controlledPlayer.biome === 'recovery' && (!isMobile)) {
        const hintY = popupY + padding + (stats.length + 1) * lineHeight + 5;
        fill(160, 160, 160);
        textStyle(ITALIC);
        textSize(11);
        textAlign(LEFT, TOP);
        text('shift+click to sell item', popupX + padding, hintY);
    }
    
    pop();

    // IF MOBILE: Draw Action Buttons
    if (typeof isMobile !== 'undefined' && isMobile) {
        drawMobileActionButtons(popupX, popupY, popupHeight, popupWidth, targetRegion, isShop);
    }
}

function displayTeleportButton(controlledPlayer) {
    // If on mobile and an item stats popup is active (mobileSelection), hide these buttons
    if (typeof isMobile !== 'undefined' && isMobile && typeof window.mobileSelection !== 'undefined' && window.mobileSelection) {
        teleportButtonRegion = null;
        shopButtonRegion = null;
        return;
    }

    const inRecoveryZone = controlledPlayer && controlledPlayer.biome === 'recovery';
    const hasTwin = controlledPlayer && controlledPlayer.twinRecoveryZone;
    
    // Check if we should show any buttons
    if (!inRecoveryZone) {
        teleportButtonRegion = null;
        shopButtonRegion = null;
        return;
    }
    
    // Determine how many buttons to show
    const showTeleport = hasTwin;
    const showShop = true; // Always show shop button in recovery zones
    const buttonCount = (showTeleport ? 1 : 0) + (showShop ? 1 : 0);
    
    if (buttonCount === 0) {
        teleportButtonRegion = null;
        shopButtonRegion = null;
        return;
    }
    
    // Button dimensions
    const s = getUIScale();
    const buttonWidth = 200 * s;
    const buttonHeight = 50 * s;
    const buttonSpacing = 20 * s;
    
    // Calculate center position for button area
    const centerX = windowWidth / 2;
    const buttonY = windowHeight - (100 * s);
    
    // Calculate button positions based on count
    let teleportX, shopX;
    
    if (buttonCount === 1) {
        // Single button - center it directly
        if (showTeleport) {
            teleportX = centerX;
            shopButtonRegion = null;
        } else {
            shopX = centerX;
            teleportButtonRegion = null;
        }
    } else {
        // Two buttons - center the button area, teleport on left, shop on right
        const totalWidth = buttonWidth * 2 + buttonSpacing;
        teleportX = centerX - totalWidth / 2 + buttonWidth / 2;
        shopX = centerX + totalWidth / 2 - buttonWidth / 2;
    }
    
    // Save current drawing state
    push();
    
    // Reset all text properties to default
    textFont('Arial');
    textStyle(NORMAL);
    rectMode(CENTER);
    
    // Draw Teleport Button
    if (showTeleport) {
        teleportButtonRegion = {
            x: teleportX,
            y: buttonY,
            width: buttonWidth,
            height: buttonHeight
        };
        
        const isTeleportHovering = mouseX >= teleportX - buttonWidth / 2 &&
            mouseX <= teleportX + buttonWidth / 2 &&
            mouseY >= buttonY - buttonHeight / 2 &&
            mouseY <= buttonY + buttonHeight / 2;
        
        fill(isTeleportHovering ? 80 : 60, 120, isTeleportHovering ? 255 : 200, 200);
        stroke(255, 255, 255, 180);
        strokeWeight(2);
        rect(teleportX, buttonY, buttonWidth, buttonHeight, 8 * s);
        
        fill(255, 255, 255);
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(16 * s);
        text(`Teleport to ${controlledPlayer.twinRecoveryZone.id}`, teleportX, buttonY - (5 * s));
        
        textSize(12 * s);
        fill(200, 200, 200);
        text("Press T or click", teleportX, buttonY + (15 * s));
    } else {
        teleportButtonRegion = null;
    }
    
    // Draw Shop Button
    if (showShop) {
        shopButtonRegion = {
            x: shopX,
            y: buttonY,
            width: buttonWidth,
            height: buttonHeight
        };
        
        const isShopHovering = mouseX >= shopX - buttonWidth / 2 &&
            mouseX <= shopX + buttonWidth / 2 &&
            mouseY >= buttonY - buttonHeight / 2 &&
            mouseY <= buttonY + buttonHeight / 2;
        
        fill(isShopHovering ? 80 : 60, isShopHovering ? 180 : 140, 60, 200);
        stroke(255, 255, 255, 180);
        strokeWeight(2);
        rect(shopX, buttonY, buttonWidth, buttonHeight, 8 * s);
        
        fill(255, 255, 255);
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(16 * s);
        text(shopOpen ? "Close Shop" : "Open Shop", shopX, buttonY - (5 * s));
        
        textSize(12 * s);
        fill(200, 200, 200);
        text("Press B or click", shopX, buttonY + (15 * s));
    } else {
        shopButtonRegion = null;
    }
    
    // Restore previous drawing state
    pop();
}

function displaySellAllButton(controlledPlayer) {
    // If on mobile and an item stats popup is active (mobileSelection), hide this button
    if (typeof isMobile !== 'undefined' && isMobile && typeof window.mobileSelection !== 'undefined' && window.mobileSelection) {
        sellAllButtonRegion = null;
        return;
    }

    const inRecoveryZone = controlledPlayer && controlledPlayer.biome === 'recovery';
    const hasInventory = controlledPlayer && controlledPlayer.inventory && controlledPlayer.inventory.length > 0;
    
    // Only show button if in recovery zone and has items in inventory
    if (!inRecoveryZone || !hasInventory) {
        sellAllButtonRegion = null;
        return;
    }
    
    // Button dimensions
    const s = getUIScale();
    const buttonWidth = 200 * s;
    const buttonHeight = 40 * s;
    
    // Position at bottom center, below shop/teleport buttons
    const centerX = windowWidth / 2;
    const buttonY = windowHeight - (50 * s);
    
    sellAllButtonRegion = {
        x: centerX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight
    };
    
    const isHovering = mouseX >= centerX - buttonWidth / 2 &&
        mouseX <= centerX + buttonWidth / 2 &&
        mouseY >= buttonY - buttonHeight / 2 &&
        mouseY <= buttonY + buttonHeight / 2;
    
    // Save current drawing state
    push();
    
    // Reset all text properties to default
    textFont('Arial');
    textStyle(NORMAL);
    rectMode(CENTER);
    
    // Draw button (green/gold color for selling)
    fill(isHovering ? 200 : 150, isHovering ? 160 : 120, 40, 200);
    stroke(255, 255, 255, 180);
    strokeWeight(2);
    rect(centerX, buttonY, buttonWidth, buttonHeight, 8 * s);
    
    fill(255, 255, 255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(16 * s);
    text(`Sell All (${controlledPlayer.inventory.length} items)`, centerX, buttonY - (5 * s));
    
    textSize(12 * s);
    fill(200, 200, 200);
    text("Click to sell", centerX, buttonY + (15 * s));
    
    // Restore previous drawing state
    pop();
}


function displayAppInfo() {
    push();
    fill(255, 255, 255);
    noStroke();
    textSize(16);
    textAlign(CENTER);
    text("Ping: " + Math.round(avgPing), windowWidth - 50, windowHeight - 40);
    text("V Alpha", windowWidth - 50, windowHeight - 20);
    pop();
}

// Particle System Functions
function updateParticles() {
    // Optimize: Decrease update quality if too many particles AND optimization is enabled
    // If > 400 particles, use simplified physics and reduced checks
    const lowQuality = settings.optimizedParticles && particles.length > 400;

    // Update all particles and remove dead ones
    // Iterate backwards.
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update(1, lowQuality);
        if (particles[i].isDead) {
            // Optimization: Swap with last element and pop (O(1)) instead of splice (O(N))
            // This changes draw order, but in particle systems this is usually acceptable,
            // especially in optimized mode where performance is priority.
            if (lowQuality) {
                particles[i] = particles[particles.length - 1];
                particles.pop();
            } else {
                particles.splice(i, 1);
            }
        }
    }
}

function drawParticles(centerX = 0, centerY = -400) {
    if (!particles || particles.length === 0) return;

    // Optimize: Decrease render quality if too many particles AND optimization is enabled
    const lowQuality = settings.optimizedParticles && particles.length > 400;

    push();
    // Calculate camera offset from center position
    const cameraX = centerX - windowWidth / 2;
    const cameraY = centerY - windowHeight / 2;

    // Draw all particles
    particles.forEach(particle => {
        particle.draw(cameraX, cameraY, lowQuality);
    });
    pop();
}

function displayClouds(centerX, centerY) {
    push();
    const screenCenterX = windowWidth / 2;
    const screenCenterY = windowHeight / 2;

    // Day/Night Cycle Cloud Appearance Logic
    let brightnessMult = 1.0;
    let alphaMult = 1.0;

    if (typeof cycleTime !== 'undefined' && typeof DAY_DURATION !== 'undefined') {
        const transitionTime = 60000; // 1 minute fade
        let dayFactor = 1.0; // 1 = Day, 0 = Night

        if (cycleTime >= DAY_DURATION) {
            // Night
            dayFactor = 0.0;
        } else if (cycleTime < transitionTime) {
            // Sunrise
            dayFactor = cycleTime / transitionTime;
        } else if (cycleTime > DAY_DURATION - transitionTime) {
            // Sunset
            dayFactor = (DAY_DURATION - cycleTime) / transitionTime;
        }

        // Configuration:
        // Day: Brightness 1.0, Alpha 1.0
        // Night: Brightness 0.2 (Dark), Alpha 0.3 (Transparent)
        brightnessMult = lerp(0.2, 1.0, dayFactor);
        alphaMult = lerp(0.3, 1.0, dayFactor);
    }

    for (const cloud of clouds) {
        // Base distance from camera center
        let relX = cloud.x - centerX;
        let relY = cloud.y - centerY;

        // Parallax scaling factor based on Z depth
        // Uses inverse distance scaling for natural perspective (scale = focal / (focal + z))
        const focalLength = 2000; 
        const scale = focalLength / (focalLength + cloud.z);

        // Don't draw if behind camera or invalid scale
        if (scale <= 0) continue;

        // Project position
        let drawX = screenCenterX + (relX * scale);
        let drawY = screenCenterY + (relY * scale);
        
        // Project size
        let drawSize = cloud.size * scale;

        // Culling
        if (drawX + drawSize < 0 || drawX - drawSize > windowWidth ||
            drawY + drawSize < 0 || drawY - drawSize > windowHeight) {
            continue;
        }

        noStroke();
        // Add minimal brightness (+5) to base, then apply day/night multipliers
        fill(
            Math.min(255, cloud.r + 5) * brightnessMult, 
            Math.min(255, cloud.g + 5) * brightnessMult, 
            Math.min(255, cloud.b + 5) * brightnessMult, 
            cloud.alpha * alphaMult
        );
        circle(drawX, drawY, drawSize);
    }
    pop();
}

function spawnParticle(x, y, z, vx, vy, vz, r, g, b, size, lifetime, type = 'default') {
    // Optimization: Throttling in optimized mode
    // If optimized mode is ON and particle count is somewhat high (>100),
    // randomly skip spawning 50% of new particles to prevent overload.
    if (settings.optimizedParticles && particles.length > 100) {
        if (Math.random() < 0.5) return; 
    }

    // Add a new particle to the global particles array
    particles.push(new Particle(x, y, z, vx, vy, vz, r, g, b, size, lifetime, type));
}

// Helper function to spawn flame particles (for engines, explosions, etc.)
function spawnFlameParticles(x, y, count = 5, intensity = 1.0) {
    for (let i = 0; i < count; i++) {
        // Random velocity spread for realistic flame movement
        const vx = (Math.random() - 0.5) * 1 * intensity;
        const vy = (Math.random() - 0.5) * 1 * intensity;
        const vz = (Math.random() - 0.5) * 0.5 * intensity;

        // Simple flame colors - random between red, orange, yellow
        const colorChoice = Math.random();
        let r, g, b;
        if (colorChoice < 0.33) {
            // Red - ensure it's clearly red
            r = 255;
            g = Math.floor(30 + Math.random() * 70);  // 30-99
            b = 0;
        } else if (colorChoice < 0.66) {
            // Orange - ensure it's clearly orange
            r = 255;
            g = Math.floor(100 + Math.random() * 100); // 100-199
            b = 0;
        } else {
            // Yellow - much darker to prevent white-like appearance
            r = 255;
            g = 255;
            b = Math.floor(20 + Math.random() * 40); // 20-59 (much darker)
        }

        const size = 2 + Math.random() * 3; // Slightly larger particles for visibility
        const lifetime = 15 + Math.random() * 20; // Slightly longer lifetime for visibility

        spawnParticle(x, y, 0, vx, vy, vz, r, g, b, size, lifetime, 'flame');
    }
}

// Helper function to spawn smoke particles (for engines, damage, etc.)
function spawnSmokeParticles(x, y, count = 3, intensity = 1.0) {
    for (let i = 0; i < count; i++) {
        // Smoke drifts slowly with minimal upward bias
        const vx = (Math.random() - 0.5) * 0.5 * intensity;
        const vy = -0.1 * intensity; // Gentle upward movement
        const vz = (Math.random() - 0.5) * 0.2 * intensity;

        // Simple gray smoke
        const r = 100;
        const g = 100;
        const b = 100;

        const size = 2 + Math.random() * 3;
        const lifetime = 120 + Math.random() * 80; // Slow dissipation (2-3.3 seconds at 60fps)

        spawnParticle(x, y, 0, vx, vy, vz, r, g, b, size, lifetime, 'smoke');
    }
}

function spawnGunFireParticles(x, y, angle, gunType = 0) {
    // Create muzzle flash particles
    const particleCount = 3 + Math.floor(Math.random() * 3); // 3-5 particles

    for (let i = 0; i < particleCount; i++) {
        // Random spread around gun angle
        const spread = (Math.random() - 0.5) * 0.5; // ±0.25 radians
        const particleAngle = angle + spread;

        // Forward velocity with randomness
        const speed = 2 + Math.random() * 3;
        const vx = Math.cos(particleAngle) * speed;
        const vy = Math.sin(particleAngle) * speed;

        // Particle properties based on gun type
        let r, g, b, size, lifetime;
        switch (gunType) {
            case 0: // Machine Gun - yellow/orange
                r = 255;
                g = 200 + Math.random() * 55;
                b = 0;
                size = 2 + Math.random() * 2;
                lifetime = 15 + Math.random() * 10;
                break;
            case 1: // Cannon - red/orange
                r = 255;
                g = 100 + Math.random() * 100;
                b = 0;
                size = 3 + Math.random() * 3;
                lifetime = 20 + Math.random() * 15;
                break;
            case 2: // Scorpion - blue/white
                r = 100 + Math.random() * 155;
                g = 150 + Math.random() * 105;
                b = 255;
                size = 2 + Math.random() * 2;
                lifetime = 12 + Math.random() * 8;
                break;
            default:
                r = 255; g = 255; b = 0;
                size = 2; lifetime = 15;
        }

        spawnParticle(x, y, 0, vx, vy, 0, r, g, b, size, lifetime);
    }

    // Add flame particles for enhanced muzzle flash effect
    const flameIntensity = gunType === 1 ? 0.8 : 0.4; // Cannons get more intense flames
    spawnFlameParticles(x, y, 2 + gunType, flameIntensity);

    // Add smoke for larger guns
    if (gunType >= 1) { // Cannon and larger
        spawnSmokeParticles(x, y, 1, 0.3);
    }
}

function spawnTrailParticles(x, y, angle, throttle, engine = null, player = null) {
    // Only spawn trail particles if throttle is above minimum
    if (throttle <= 0.1) return;

    // Calculate position behind the plane
    const trailDistance = 15 + Math.random() * 5;
    const trailX = x - Math.cos(angle) * trailDistance;
    const trailY = y - Math.sin(angle) * trailDistance;

    // Random spread for trail particles
    const spreadX = (Math.random() - 0.5) * 8;
    const spreadY = (Math.random() - 0.5) * 8;

    // Check engine heat status
    const heatRatio = engine ? engine.heat / engine.maxHeat : 0;

    // Check speed vs max speed for overspeed flame effects
    let overspeedFlames = false;
    if (player && player.vx !== undefined && player.vy !== undefined) {
        const currentSpeed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
        const maxSpeed = player.chassis ? player.chassis.topSpeed : 200; // Default to 200 if no chassis data
        overspeedFlames = currentSpeed > maxSpeed;
    }

    // Flame particles when heat is at 100% OR when exceeding max speed
    if ((engine && heatRatio >= 1.0) || overspeedFlames) {
        const flameChance = overspeedFlames ? 0.6 : 0.8; // Slightly less frequent for overspeed
        if (Math.random() < flameChance) {
            const flameCount = overspeedFlames ? 3 : 2; // More flames when overspeeding
            spawnFlameParticles(trailX + spreadX, trailY + spreadY, flameCount, 1.0);
        }
    }

    // Smoke appears when heat is above 50%
    if (engine && heatRatio > 0.5) {
        const smokeIntensity = Math.min(1.0, (heatRatio - 0.5) / 0.5); // Scales from 50% to 100% heat
        if (Math.random() < 0.3 * smokeIntensity) { // Chance increases with heat level
            spawnSmokeParticles(trailX + spreadX, trailY + spreadY, 1, smokeIntensity);
        }
    }

    // Regular exhaust trail (original white particles)
    // Velocity based on throttle (opposite to plane direction)
    const speed = 0.5 + Math.random() * 1;
    const vx = -Math.cos(angle) * speed + (Math.random() - 0.5) * 0.5;
    const vy = -Math.sin(angle) * speed + (Math.random() - 0.5) * 0.5;

    // Trail particle properties (transparent white exhaust)
    const intensity = Math.min(throttle, 1);
    const r = 255; // White
    const g = 255; // White
    const b = 255; // White
    const size = 0.5 + Math.random() * 1; // Much smaller particles
    const lifetime = 15 + Math.random() * 10; // Shorter lifetime

    spawnParticle(trailX + spreadX, trailY + spreadY, 0, vx, vy, 0, r, g, b, size, lifetime);
}

function spawnRoosterTailParticles(x, y, vx, intensity) {
    // "Wake" logic - simple surface interaction
    // Generate V-shape wake on surface.
    
    // Size Reference: Plane is very small (~12px long). 
    // Particles must be tiny (~1px) to look realistic.
    
    // Frequency: High intensity = continuous stream
    // Spawns 1-3 particles per frame based on intensity
    const particleCount = Math.floor(1 + intensity * 1.5);

    // Determine Spawn X: Should be just slightly behind the plane's center logic (~tail).
    // User requested "almost directly below" so we minimize the offset.
    // Reducing from 15 to 4 pixels behind center.
    const spawnOffsetX = (vx > 0 ? 1 : -1) * 4;

    for (let k = 0; k < particleCount; k++) {
        // Outward Expansion (Z-axis) creates the V-shape
        // Random direction (+/-) for Z to cover both sides
        const sideDir = (Math.random() < 0.5 ? -1 : 1);
        
        // Expansion rate scales with speed/intensity
        // REDUCED aggressiveness: narrower V-shape
        const expansionSpeed = (0.1 + intensity * 0.25);
        
        // Jitter Calculation
        // "Very small random direction and velocity" that scales with intensity
        const jitterStrength = 0.05 + intensity * 0.2; 
        
        const jitterX = (Math.random() - 0.5) * jitterStrength;
        const jitterY = (Math.random() - 0.5) * jitterStrength;
        const jitterZ = (Math.random() - 0.5) * jitterStrength;

        // Vertical: Flat on water + jitter
        const vy = jitterY;
        
        // Forward: Stationary + jitter
        const particleVx = jitterX;
        
        // Depth: Expansion + jitter
        const vz = sideDir * expansionSpeed + jitterZ;

        // Size: Dependent on speed (intensity).
        // Low speed (<80) = Tiny/Insignificant.
        // High speed (200+) = Large/Significant.
        // Using power curve so size ramps up dramatically at higher speeds.
        const size = (0.4 + Math.random() * 0.6) * (0.2 + Math.pow(intensity, 1.5));
        
        // Lifetime: Wake lingers.
        const lifetime = 100 + Math.random() * 50; 

        spawnParticle(x - spawnOffsetX, y, 0, particleVx, vy, vz, 245, 250, 255, size, lifetime, 'foam');
    }
}

function spawnWaterFoamParticles(x, y, velocity = 0, sizeMultiplier = 1) {
    // Scale foam based on velocity (speed of impact)
    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy) || 10;
    const speedFactor = Math.min(speed / 50, 3); // Cap at 3x for very fast speeds

    // Adjust particle count based on size multiplier - smaller objects = fewer particles
    const baseParticleCount = 1;
    const particleCount = Math.floor(baseParticleCount * speedFactor); // Scale with speed

    for (let i = 0; i < particleCount; i++) {
        // Small spread pattern around the impact point
        const offsetX = (Math.random() - 0.5) * 8 * speedFactor * sizeMultiplier; // Scale spread with size
        const offsetY = (Math.random() - 0.5) * 4 * speedFactor * sizeMultiplier; // Scale spread with size

        // Very slow, gentle movement like foam floating
        const vx = (Math.random() - 0.5) * 1 * speedFactor; // More movement for faster impacts
        const vy = -Math.random() * 0.5 * speedFactor; // More upward float
        const vz = (Math.random() - 0.5) * 0.5; // Minimal 3D movement

        // Foamy white/light blue colors
        const r = 200 + Math.random() * 55; // 200-255 (bright white foam)
        const g = 240 + Math.random() * 15; // 240-255 (very light)
        const b = 255; // Pure white foam

        // Scale foam bubble size with multiplier, but keep generally smaller
        const size = (0.8 + Math.random() * 0.8) * sizeMultiplier; // 0.8-1.6 size * multiplier (smaller base)
        const lifetime = 3000 + Math.random() * 2000; // 3-5 seconds to dissipate

        // Spawn at water surface level with slight random offset
        const spawnX = x + offsetX;
        const spawnY = y + offsetY;
        spawnParticle(spawnX, spawnY, 0, vx, vy, vz, r, g, b, size, lifetime, 'foam');
    }
}

// Enemy drawing functions - abstracted for better organization
function drawEnemyPlane(enemy) {
    // Plane: draw triangle
    rotate(enemy.angle);
    triangle(-5, -3, -5, 3, 7, 0);
}

function drawEnemyBoat(enemy) {
    // Simple boat: trapezoid shape with red gun line
    const base = enemy.size ?? 30;
    const length = base * 1.2;
    const height = base * 0.5;

    // Hull trapezoid (flat deck on top, pointed hull bottom)
    fill(120, 120, 120);
    noStroke();
    beginShape();
    vertex(-length / 2, -height / 5);     // top left (deck)
    vertex(length / 2, -height / 5);      // top right (deck) - flat top
    vertex(length / 3, height / 2);       // bottom right (hull point)
    vertex(-length / 3, height / 2);      // bottom left (hull point)
    endShape(CLOSE);

    // Red gun line - rotates to follow gun angle
    // gun1.angle is the absolute world angle where the gun is pointing
    // But we're in a translated (not rotated) coordinate system
    // So we need to draw the gun at: gun.angle - boat.angle
    const gunWorldAngle = enemy.gun1?.angle ?? 0;
    const gunLocalAngle = gunWorldAngle;

    stroke(255, 0, 0);
    strokeWeight(3);
    const gunLength = length * 0.4;
    line(0, 0, Math.cos(gunLocalAngle) * gunLength, Math.sin(gunLocalAngle) * gunLength);
    noStroke();
}

function drawEnemyDefault(enemy) {
    // Default enemy: draw square
    let sz = enemy.size ?? 10;
    rectMode(CENTER);
    rect(0, 0, sz, sz);
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}
function drawAnimals(centerX, centerY) {
    animals.forEach(animal => {
        // Calculate screen position relative to camera
        const drawX = windowWidth / 2 + (animal.x - centerX);
        const drawY = windowHeight / 2 + (animal.y - centerY);

        // Only draw if on screen
        if (isOnScreen(drawX, drawY, animal.size)) {
            push();
            translate(drawX, drawY);
            rotate(animal.angle);

            if (animal.type === 'fish') {
                // Draw a simple fish
                if (animal.r !== undefined) {
                    fill(animal.r, animal.g, animal.b);
                } else {
                    fill(255, 100, 50); // Default fallback
                }
                noStroke();
                ellipse(0, 0, animal.size * 2, animal.size); // Body
                triangle(-animal.size, 0, -animal.size * 1.5, -animal.size/2, -animal.size * 1.5, animal.size/2); // Tail
            } else if (animal.type === 'bird') {
                // Draw a simple bird
                fill(255);
                noStroke();
                ellipse(0, 0, animal.size, animal.size/2);
                // Wings
                stroke(0);
                line(-animal.size/2, 0, -animal.size, -animal.size);
                line(animal.size/2, 0, animal.size, -animal.size);
            }

            pop();
        }
    });
}
