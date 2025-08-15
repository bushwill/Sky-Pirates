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
            if (testing == true) {
                displayTestInfo(player);
            }
        } else {
            displayOtherPlayerStatus(player, drawX, drawY);
        }
        displayMessages(player, centerX, centerY);
    }
}

function displayPlayer(player, drawX = 0, drawY = -400) {
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
    drawThrottleArc(player, drawX, drawY);
    drawPlaneHeat(player, drawX, drawY);
    drawPlaneHull(player, drawX, drawY);
    drawSpeed(player, drawX, drawY);
    drawGunCursor(player, drawX, drawY);
    drawGunHeat(player, drawX, drawY);
    drawGunArc(player, drawX, drawY);
    drawPlaneData(player, drawX, drawY);
    drawCompass(player);
    if (player.browsing) displayInventory(player, drawX, drawY);

    // Draw stalling icon if stalling is true
    if (player.stalling) {
        push();
        translate(drawX + 30, drawY - 30);
        fill(255, 0, 0);
        stroke(0);
        ellipse(0, 0, 20, 20); // Red circle
        fill(255);
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(14);
        text("!", 0, 1); // Exclamation mark
        pop();
    }
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
    const normalized = throttle / maxThrottle;

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
    stroke(0, 255, 0, 220);
    const throttleAngle = startAngle + (endAngle - startAngle) * normalized;
    arc(0, 0, arcRadius * 2, arcRadius * 2, startAngle, throttleAngle);

    pop();
}

function drawPlaneHeat(player, drawX = 0, drawY = 0) {
    const arcRadius = 60;
    const arcThickness = 4;
    const heatRatio = Math.max(0, Math.min(1, player.engine.heat / player.engine.maxHeat));
    push();
    translate(drawX, drawY);
    strokeWeight(arcThickness);
    noFill();
    // Heat arc (right bottom semicircle: from 2*PI to PI)
    // We'll draw this in the opposite direction so it doesn't overlap
    stroke(255 * heatRatio, 255 - (255 * heatRatio), 255 - (255 * heatRatio), 100 + 155 * heatRatio);
    arc(
        0, 0,
        arcRadius * 1.2, arcRadius * 1.2,
        2 * Math.PI,                    // start at 360°
        2 * Math.PI - Math.PI * -heatRatio, // go backward to between 360° and 180°
        true                           // draw counter-clockwise
    );
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
    if (player.keys['r']) {
        stroke(200, 255, 50, 200)
    } else {
        stroke(50, 255, 50, 200);
    }
    arc(
        0, 0,
        arcRadius, arcRadius,
        2 * Math.PI,                    // start at 360°
        2 * Math.PI - Math.PI * -hullRatio, // go backward to between 360° and 180°
        true                           // draw counter-clockwise
    );
    pop();
}

function drawSpeed(player, drawX, drawY) {
    fill(255);
    text(Math.sqrt(player.vx ** 2 + player.vy ** 2).toFixed(0), drawX, drawY - 50);
}

function drawCompass(controlledPlayer) {
    textSize(32);
    textAlign(CENTER, CENTER);
    fill(255);
    if (controlledPlayer.x < -1000) text("Base is " + Math.abs(controlledPlayer.x.toFixed(0)) + "m east", windowWidth / 2, 30);
    else if (controlledPlayer.x > 1000) text("Base is " + Math.abs(controlledPlayer.x.toFixed(0)) + "m west", windowWidth / 2, 30);
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

function displayAppInfo() {
    fill(255, 255, 255);
    textSize(16);
    textAlign(CENTER);
    text("Ping: " + Math.round(avgPing), windowWidth - 50, windowHeight - 40);
    text("V Alpha", windowWidth - 50, windowHeight - 20);
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function displayTestInfo(player) {
    fill(255, 0, 0);
    textSize(12);
    textAlign(LEFT);

    text(`player.angle: ${player.angle}}`, 10, 20);
    text(`player.x: ${player.x}`, 10, 35);
    text(`player.y: ${player.y}`, 10, 50);
    text(`player.vx: ${player.vx}`, 10, 65);
    text(`player.vy: ${player.vy}`, 10, 80);
}
