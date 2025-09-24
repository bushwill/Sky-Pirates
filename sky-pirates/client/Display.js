// Helper to check if a position is on screen
function isOnScreen(drawX, drawY, margin = 0) {
    return (
        drawX >= -margin && drawX <= windowWidth + margin &&
        drawY >= -margin && drawY <= windowHeight + margin
    );
}

// Draw enemy indicators on screen edge if they have the player targeted and are off-screen
function drawEnemyTargetIndicators(controlledPlayer, centerX = 0, centerY = -400) {
    if (!controlledPlayer) return;
    for (let i in enemies) {
        const enemy = enemies[i];
        // Check if enemy has the controlled player targeted
        if (enemy.target && enemy.target.username === controlledPlayer.username) {
            const drawX = windowWidth / 2 + (enemy.x - centerX);
            const drawY = windowHeight / 2 + (enemy.y - centerY);
            if (drawX < 0 || drawX > windowWidth || drawY < 0 || drawY > windowHeight) {
                // Clamp positions to screen edges
                let indicatorX = drawX;
                let indicatorY = drawY;
                if (drawX < 0) indicatorX = 40;
                else if (drawX > windowWidth) indicatorX = windowWidth - 40;
                if (drawY < 0) indicatorY = 40;
                else if (drawY > windowHeight) indicatorY = windowHeight - 40;
                // Draw enemy indicator triangle (same style as party)
                push();
                translate(indicatorX, indicatorY);
                rotate(enemy.angle);
                fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
                stroke(100, 0, 0);
                triangle(-5, -3, -5, 3, 7, 0);
                pop();
                // Draw enemy name or faction
                fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
                textAlign(CENTER);
                textSize(12);
                text(enemy.faction ?? "Enemy", indicatorX, indicatorY - 15);
                // Display distance to player
                let distance = Math.sqrt((enemy.x - controlledPlayer.x) ** 2 + (enemy.y - controlledPlayer.y) ** 2);
                text(distance.toFixed(0) + "m", indicatorX, indicatorY + 25);
            }
        }
    }
}
// Display all enemies
function displayEnemies(centerX = 0, centerY = -400) {
    for (let i in enemies) {
        stroke(100, 0, 0); // Different color for enemies
        rectMode(CENTER);
        const enemy = enemies[i];
        const drawX = windowWidth / 2 + (enemy.x - centerX);
        const drawY = windowHeight / 2 + (enemy.y - centerY);
        displayEnemy(enemy, drawX, drawY, centerX, centerY);
    }
}

// Display a single enemy
function displayEnemy(enemy, drawX = 0, drawY = -400, centerX = 0, centerY = -400) {
    // Spawn trail particles if enemy is throttling
    if (enemy.engine && enemy.engine.power > 0.1) {
        // Very occasional spawning for subtle effect
        if (Math.random() < 0.05) { // 5% chance to spawn trail particles
            spawnTrailParticles(enemy.x, enemy.y, enemy.angle, enemy.engine.power, enemy.engine);
        }
    }
    // Spawn foam particles if enemy is in water
    const enemyBiome = getBiomeAtPosition(enemy.x, enemy.y);
    if (enemyBiome === 'water') {
        // More frequent spawning for consistent wake
        if (Math.random() < 0.3) { // 30% chance when displaying (increased from 12%)
            spawnWaterFoamParticles(enemy.x, enemy.y, { vx: enemy.vx, vy: enemy.vy });
        }
    }
    textSize(12);
    textAlign(CENTER);
    stroke(100, 0, 0);
    fill(enemy.r ?? 255, enemy.g ?? 50, enemy.b ?? 50);
    push();
    translate(drawX, drawY);
    rotate(enemy.angle);
    triangle(-5, -3, -5, 3, 7, 0);
    pop();
    // Draw enemy hull/health arc
    const arcRadius = 60;
    const arcThickness = 4;
    const hullRatio = Math.max(0, Math.min(1, enemy.chassis.hull / enemy.chassis.maxHull));
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

    fill(255, 50, 50);
    textSize(12);
    if (!enemy || !enemy.username) {
        console.warn("Invalid enemy or missing username:", enemy);
        return;
    }
    text(enemy.faction ?? "Enemy", drawX, drawY - 15);
}

function displayPlayers(centerX = 0, centerY = -400) {
    for (let i in players) {
        stroke(0);
        rectMode(CENTER);
        const player = players[i];
        const drawX = windowWidth / 2 + (player.x - centerX);
        const drawY = windowHeight / 2 + (player.y - centerY);
        displayPlayer(player, drawX, drawY);
        if (player.username === username) {
            displayControlledPlayerStatus(player, drawX, drawY);
        } else {
            displayOtherPlayerStatus(player, drawX, drawY);
        }
        displayMessages(player, centerX, centerY);
    }
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
    }
    
    textSize(12);
    textAlign(CENTER);
    stroke(0);
    fill(player.r, player.g, player.b);
    push();
    translate(drawX, drawY);
    rotate(player.angle); // assumes angle in radians
    triangle(-5, -3, -5, 3, 7, 0);
    pop();

    fill(255);
    textSize(12);
    if (!player || !player.username) {
        console.warn("Invalid player or missing username:", player);
        return;  // skip drawing text if no username
    }
    if (player.party) {
        fill(player.party.r, player.party.g, player.party.b);
    }
    text(player.username, drawX, drawY - 15);
}

function displayProjectiles(centerX = 0, centerY = -400) {
    for (let i in projectiles) {
        rectMode(CENTER);
        const projectile = projectiles[i];
        const drawX = windowWidth / 2 + (projectile.x - centerX);
        const drawY = windowHeight / 2 + (projectile.y - centerY);
        displayProjectile(projectile, drawX, drawY);
    }
}

function displayProjectile(projectile, drawX = 0, drawY = -400) {
    // Spawn foam particles if projectile is in water
    if (projectile.biome === 'water') {
        // More frequent spawning for consistent foam trails
        if (Math.random() < 0.4) { // 40% chance when displaying (increased from 15%)
            const projectileSizeMultiplier = Math.max(0.2, (projectile.size || 1) * 0.3);
            spawnWaterFoamParticles(projectile.x, projectile.y, { vx: projectile.vx, vy: projectile.vy }, projectileSizeMultiplier);
        }
    }
    
    textSize(12);
    textAlign(CENTER);
    strokeWeight(1);
    stroke(0);
    fill(projectile.r, projectile.g, projectile.b);

    const s = projectile.size; // size scale

    push();
    translate(drawX, drawY);
    rotate(projectile.angle); // assumes angle in radians

    // Scale the triangle points by projectile size
    triangle(-5 / 3 * s, -1 * s, -5 / 3 * s, 1 * s, 7 / 3 * s, 0);

    pop();
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
            if (distanceToPlayer > 500) { // Log when crate is more than 500 units away
                console.log(`[CRATE DEBUG] Player: ${username} at (${currentPlayer.x.toFixed(1)}, ${currentPlayer.y.toFixed(1)}) | Carried Crate at (${crate.x.toFixed(1)}, ${crate.y.toFixed(1)}) | Distance: ${distanceToPlayer.toFixed(1)} | Velocity: (${crate.vx.toFixed(2)}, ${crate.vy.toFixed(2)})`);
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
    
    textSize(12);
    textAlign(CENTER);
    if (crate.type === 'money') {
        fill(222, 191, 138);
    } else if (crate.type === 'component') {
        fill(255, 156, 69);
    } else {
        fill(0, 255, 0);
    }
    const drawX = windowWidth / 2 + (crate.x - centerX);
    const drawY = windowHeight / 2 + (crate.y - centerY);
    const s = crate.size; // size scale
    stroke(168, 144, 103);

    // If crate is attached to a player, draw a line (rope) to the carrier
    if (crate.carrier) {
        // Find the carrier player object by username
        const carrierPlayer = players.find(p => p.username === crate.carrier);
        if (carrierPlayer) {
            const carrierDrawX = windowWidth / 2 + (carrierPlayer.x - centerX);
            const carrierDrawY = windowHeight / 2 + (carrierPlayer.y - centerY);
            line(drawX, drawY, carrierDrawX, carrierDrawY);
        }
    }

    push();
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
    drawPlaneData(player, drawX, drawY);
    drawCompass(player);
    drawEnemyTargetIndicators(player, player.x, player.y); // Show enemy indicators on edge
    if (player.browsing) {
        displayInventory(player, drawX, drawY);
    }
    // Always check for teleport button when in recovery zone
    if (player.biome === 'recovery') {
        displayTeleportButton(player);
    }
}

function drawOverSpeedFireIcon(player, drawX, drawY) {
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


function drawPlaneData(player) {
    fill(255);
    textAlign(LEFT);
    textSize(12);
    const x = player.x.toFixed(0);
    const y = player.y.toFixed(0);
    // Components
    text(`Engine: ${player.engine.name}`, 10, 45);
    text(`Chassis: ${player.chassis.name}`, 10, 60);
    text(`Wings: ${player.wings.name}`, 10, 75);
    // Money/value/crates
    text('Plane value: ' + player.value, 10, 105);
    text('Money: ' + player.money, 10, 120);
    if (player.crates.length > 0) text('Crates: ' + player.crates.length, 10, 135);
}

function drawPartyIndicator(controlledPlayer, centerX = 0, centerY = -400) {
    // Only proceed if the controlled player has a party
    if (!controlledPlayer || !controlledPlayer.party) {
        return;
    }

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
        const drawX = windowWidth / 2 + (player.x - centerX);
        const drawY = windowHeight / 2 + (player.y - centerY);

        // Check if player is out of bounds
        if (drawX < 0 || drawX > windowWidth || drawY < 0 || drawY > windowHeight) {
            // Clamp positions to screen edges
            let indicatorX = drawX;
            let indicatorY = drawY;

            if (drawX < 0) indicatorX = 40;
            else if (drawX > windowWidth) indicatorX = windowWidth - 40;

            if (drawY < 0) indicatorY = 40;
            else if (drawY > windowHeight) indicatorY = windowHeight - 40;

            // Draw party indicator triangle
            push();
            translate(indicatorX, indicatorY);
            rotate(player.angle);
            fill(player.party.r, player.party.g, player.party.b);
            stroke(0);
            triangle(-5, -3, -5, 3, 7, 0);
            pop();

            // Draw username
            fill(player.party.r, player.party.g, player.party.b);
            textAlign(CENTER);
            textSize(12);
            text(player.username, indicatorX, indicatorY - 15);

            // Calculate and display distance
            let distance = Math.sqrt((player.x - controlledPlayer.x) ** 2 + (player.y - controlledPlayer.y) ** 2);
            text(distance.toFixed(0) + "m", indicatorX, indicatorY + 25);
        }
    }
}

function drawStallWarning(player, drawX, drawY) {
    speed = Math.sqrt(player.vx ** 2 + player.vy ** 2).toFixed(0);
    // Draw stalling icon if stalling is true
    if (player.biome !== 'recovery') {
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

    stroke(255, 255, 255);
    noFill();

    // Draw crosshair at gun's aiming position
    line(cursorX - cursorSize / 2, cursorY, cursorX + cursorSize / 2, cursorY);
    line(cursorX, cursorY - cursorSize / 2, cursorX, cursorY + cursorSize / 2);
}

function drawGunHeat(player, drawX, drawY) {
    if (player.biome === 'recovery') return;
    const heatRatio1 = Math.max(0, Math.min(1, player.gun1.heat / player.gun1.maxHeat));
    const heatRatio2 = Math.max(0, Math.min(1, player.gun2.heat / player.gun2.maxHeat));
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
    const hullRatio = Math.max(0, Math.min(1, player.chassis.hull / player.chassis.maxHull));
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
    fill(255);
    text(Math.sqrt(player.vx ** 2 + player.vy ** 2).toFixed(0), drawX, drawY - 50);
}

function drawCompass(controlledPlayer) {
    let dist = Math.abs(controlledPlayer.x);
    if (dist >= 1000) {
        textSize(32);
        textAlign(CENTER, CENTER);
        fill(255);
        let label = (dist / 1000).toFixed(1) + "km";
        if (controlledPlayer.x < -0.01) text("Center is " + label + " east", windowWidth / 2, 30);
        else if (controlledPlayer.x > 0.01) text("Center is " + label + " west", windowWidth / 2, 30);
    }
}

function displayMessages(player, centerX = 0, centerY = 0) {
    stroke(0);
    fill(255);
    textSize(12);
    textAlign(CENTER);
    const drawX = windowWidth / 2 + (player.x - centerX);
    const drawY = windowHeight / 2 + (player.y - centerY);
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
        textStyle(ITALIC);
        fill(0, 0, 0);
        rect(drawX, drawY + 20, current_chat.length * 5 + 10, 20);
        fill(255, 255, 255);
        text(current_chat, drawX, drawY + 20);
        textStyle(NORMAL);
    }
}

function displayChat() {
    stroke(0);
    fill(255);
    textAlign(LEFT);
    chat_messages = chat_messages.filter((msg) => millis() - msg.id < 60 * 1000);
    for (let i in chat_messages) {
        const message = chat_messages[chat_messages.length - 1 - i];
        text("[" + message.username + "] " + message.message, 20, windowHeight - ((20 * i) + 10));
        if (i > 13) break;
    }
}

function displayNoticeMessages() {
    if (notice_messages.length > 0) {
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
    }
}

function displayInventory(controlledPlayer) {
    if (!controlledPlayer) return;

    // Check browsing state; if not browsing, clear regions and return.
    if (!controlledPlayer.browsing) {
        if (inventoryRegions.length > 0) {
            console.log("Clearing inventory regions as browsing state is false.");
            inventoryRegions = [];
        }
        return;
    } else {
        // Set constants for inventory display.
        const radius = 100; // World unit radius for inventory items.
        const slotSize = 40; // Display size for each item.
        rectMode(CENTER);
        inventoryRegions = computeInventoryRegions(controlledPlayer, radius, slotSize);
        // Loop through computed regions and draw each inventory item.
        for (let region of inventoryRegions) {
            // Draw the inventory item using a helper function (assumes drawItem is defined).
            drawItem(region.item, region.x, region.y, region.size);

            // Only display the item name if the mouse is hovering over the item.
            if (dist(mouseX, mouseY, region.x, region.y) <= region.size / 2) {
                fill(0);
                textAlign(CENTER, CENTER);
                textSize(14);
                text(region.item.name, region.x, region.y + region.size / 2 + 10);
            }
        }
    }
}

function displayTeleportButton(controlledPlayer) {
    if (!controlledPlayer || !controlledPlayer.twinRecoveryZone) {
        // Clear button region when not showing
        teleportButtonRegion = null;
        return;
    }
    
    // Button position (bottom center of screen)
    const buttonX = windowWidth / 2;
    const buttonY = windowHeight - 100;
    const buttonWidth = 200;
    const buttonHeight = 40;
    
    // Store button region for click detection
    teleportButtonRegion = {
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight
    };
    
    // Save current drawing state
    push();
    
    // Reset all text properties to default
    textFont('Arial'); // Use a standard font
    textStyle(NORMAL); // Ensure no bold/italic
    rectMode(CENTER);
    
    // Check if mouse is hovering for highlight effect
    const isHovering = mouseX >= buttonX - buttonWidth/2 && 
                      mouseX <= buttonX + buttonWidth/2 && 
                      mouseY >= buttonY - buttonHeight/2 && 
                      mouseY <= buttonY + buttonHeight/2;
    
    // Button background with hover effect
    fill(isHovering ? 80 : 60, 120, isHovering ? 255 : 200, 200);
    stroke(255, 255, 255, 180);
    strokeWeight(2);
    rect(buttonX, buttonY, buttonWidth, buttonHeight, 8);
    
    // Button text
    fill(255, 255, 255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(16);
    textStyle(NORMAL);
    text(`Teleport to ${controlledPlayer.twinRecoveryZone.id}`, buttonX, buttonY - 2);
    
    // Instruction text
    textSize(12);
    textStyle(NORMAL);
    fill(200, 200, 200);
    text("Press T or click to teleport", buttonX, buttonY + 15);
    
    // Restore previous drawing state
    pop();
}

function displayAppInfo() {
    fill(255, 255, 255);
    textSize(16);
    textAlign(CENTER);
    text("Ping: " + Math.round(avgPing), windowWidth - 50, windowHeight - 40);
    text("V Alpha", windowWidth - 50, windowHeight - 20);
}

// Particle System Functions
function updateParticles() {
    // Update all particles and remove dead ones
    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        if (particles[i].isDead) {
            particles.splice(i, 1);
        }
    }
}

function drawParticles() {
    if (!particles || particles.length === 0) return;
    
    // Calculate camera offset for current player
    let cameraX = 0, cameraY = 0;
    if (signedIn && players.length > 0) {
        const currentPlayer = players.find(p => p.username === username);
        if (currentPlayer) {
            cameraX = currentPlayer.x - windowWidth / 2;
            cameraY = currentPlayer.y - windowHeight / 2;
        }
    }
    
    // Draw all particles
    particles.forEach(particle => {
        particle.draw(cameraX, cameraY);
    });
}

function spawnParticle(x, y, z, vx, vy, vz, r, g, b, size, lifetime, type = 'default') {
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

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}