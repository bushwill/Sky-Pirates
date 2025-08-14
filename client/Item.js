/**
 * Draws an item based on its class type.
 * The item is expected to be an instance of one of these classes:
 * Chassis, Wings, Engine, or Gun.
 *
 * Each corresponding drawing function (drawChassisItem, drawWingsItem, drawEngineItem, drawWeaponItem)
 * is called based on the item's type.
 *
 * @param {Object} item - The item to be drawn.
 * @param {number} [x=0] - The x-coordinate on the canvas.
 * @param {number} [y=0] - The y-coordinate on the canvas.
 * @param {number} [size=40] - The size or scale for drawing the item.
 */
function drawItem(item, x = 0, y = 0, size = 40) {
    if (item.type == "gun") {
      drawWeaponItem(item.name, x, y, size);
    } else if (item.type == "chassis") {
      drawChassisItem(item.name, x, y, size);
    } else if (item.type == "wings") {
      drawWingsItem(item.name, x, y, size);
    } else if (item.type == "engine") {
      drawEngineItem(item.name, x, y, size);
    } else {
      console.warn("drawItem: Unknown item type for:", item);
    }
  }
  
function drawWeaponItem(weaponName, x = 0, y = 0, size = 40) {
    push();
    translate(x, y);
    rectMode(CENTER)

    const name = (weaponName || "").toLowerCase();

    // Machine Gun
    if (name.includes("machine gun")) {
        // Body
        stroke(0); 
        fill(80, 160, 80);
        rect(-size/3, 0, size * 0.75, size * 0.75, 6);
        // Barrels
        stroke(0); 
        fill(140, 140, 160);
        rect(size/8, size/8, size * 0.8, size/6, 6);
        rect(size/8, -size/8, size * 0.8, size/6, 6);
        fill(100, 100, 100);
        rect(-size/8, size/8, size * 0.8, size/6, 6);
        rect(-size/8, -size/8, size * 0.8, size/6, 6);
    }
    // High Caliber Cannon
    else if (name.includes("cannon")) {
        // Body
        stroke(0); 
        fill(180, 180, 60);
        rect(-size/3, 0, size/2, size/2, 6);
        // Barrels
        stroke(0); 
        fill(140, 140, 160);
        rect(size/8, 0, size * 0.6, size/6, 6);
        fill(100, 100, 100);
        rect(-size/8, 0, size * 0.7, size/6, 6);
    }
    // Scorpion
    else if (name.includes("scorpion")) {
        // Body
        stroke(0); 
        fill(80, 120, 160);
        rect(-size/3, 0, size * 0.75, size * 0.75, 6);
        // Barrels
        stroke(0); 
        fill(140, 140, 160);
        rect(size/8, size/8, size * 0.8, size/6, 6);
        rect(size/8, -size/8, size * 0.8, size/6, 6);
        fill(100, 100, 100);
        rect(-size/8, size/8, size * 0.8, size/6, 6);
        rect(-size/8, -size/8, size * 0.8, size/6, 6);
        // Tip
        fill(220, 80, 80);
        ellipse(size/2, size/8, size/7, size/7);
        ellipse(size/2, -size/8, size/7, size/7);
        // "Stinger" spike
        stroke(220, 80, 80); strokeWeight(2);
        line(size/2, size/8, size/2 + 6, size/8);
        line(size/2, -size/8, size/2 + 6, -size/8);
        strokeWeight(1);
    }
    // Unknown/default
    else {
        stroke(0); fill(200, 200, 200, 80);
        ellipse(0, 0, size, size);
        fill(80, 80, 80);
        textAlign(CENTER, CENTER);
        textSize(size/3);
        text("?", 0, 0);
    }
    pop();
}

function drawChassisItem(chassisName, x = 0, y = 0, size = 40) {
    push();
    translate(x, y);
    rectMode(CENTER);

    const name = (chassisName || "").toLowerCase();

    // Draw chassis as a more robust, tank-like base - moved up slightly
    stroke(0); 
    fill(180, 180, 180);
    // Main body - wider and more rectangular
    rect(0, -size * 0.1, size * 1.4, size * 0.6, 8);
    
    // Front armor plate
    fill(120, 120, 120);
    rect(0, -size * 0.25, size * 1.4, size * 0.15, 4);
    
    // Side armor details
    fill(160, 160, 160);
    rect(-size * 0.5, -size * 0.1, size * 0.15, size * 0.45, 2);
    rect(size * 0.5, -size * 0.1, size * 0.15, size * 0.45, 2);
    
    // Text background panel - same as engine and wings
    stroke(0);
    fill(220, 220, 220);
    rect(0, size * 0.28, size * 0.9, size * 0.25, 6);
    
    // Chassis manufacturer text - same size and position as others
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(size / 4);
    fill(60, 60, 60);

    // Chassis manufacturers
    if (name.includes("pirate")) {
        text("Pirate", 0, size * 0.28);
    } else if (name.includes("core")) {
        text("Core", 0, size * 0.28);
    } else if (name.includes("kamen")) {
        text("Kamen", 0, size * 0.28);
    } else if (name.includes("aero")) {
        text("Aero", 0, size * 0.28);
    } else if (name.includes("nova")) {
        text("Nova", 0, size * 0.28);
    }
    // Unknown/default
    else {
        fill(180, 40, 40);
        text("?", 0, size * 0.28);
    }
    pop();
}

function drawWingsItem(wingsName, x = 0, y = 0, size = 40) {
    push();
    translate(x, y);
    rectMode(CENTER);

    const name = (wingsName || "").toLowerCase();

    // Draw wings as a more traditional aircraft wing design
    stroke(0);
    fill(150, 200, 150);
    
    // Main wing body - more aircraft-like with curved edges
    beginShape();
    vertex(-size * 0.7, 0);
    vertex(-size * 0.3, -size * 0.25);
    vertex(size * 0.2, -size * 0.35);
    vertex(size * 0.7, -size * 0.15);
    vertex(size * 0.7, size * 0.15);
    vertex(size * 0.2, size * 0.35);
    vertex(-size * 0.3, size * 0.25);
    endShape(CLOSE);
    
    // Wing struts/supports
    stroke(0);
    strokeWeight(2);
    line(-size * 0.2, -size * 0.15, -size * 0.2, size * 0.15);
    line(size * 0.1, -size * 0.2, size * 0.1, size * 0.2);
    strokeWeight(1);
    
    // Wing control surfaces/flaps
    noStroke();
    fill(120, 180, 120);
    beginShape();
    vertex(size * 0.3, -size * 0.25);
    vertex(size * 0.6, -size * 0.12);
    vertex(size * 0.6, size * 0.12);
    vertex(size * 0.3, size * 0.25);
    endShape(CLOSE);
    
    // Wing lights/navigation
    fill(255, 100, 100);
    ellipse(size * 0.65, -size * 0.08, size * 0.08, size * 0.08);
    fill(100, 255, 100);
    ellipse(size * 0.65, size * 0.08, size * 0.08, size * 0.08);
    
    // Text background panel - same size as engine
    stroke(0);
    fill(220, 220, 220);
    rect(0, size * 0.4, size * 0.9, size * 0.25, 6);
    
    // Wing manufacturer text - same size as engine
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(size / 4);
    fill(60, 60, 60);
    
    // Wing manufacturers
    if (name.includes("pirate")) {
        text("Pirate", 0, size * 0.4);
    } else if (name.includes("core")) {
        text("Core", 0, size * 0.4);
    } else if (name.includes("kamen")) {
        text("Kamen", 0, size * 0.4);
    } else if (name.includes("aero")) {
        text("Aero", 0, size * 0.4);
    } else if (name.includes("nova")) {
        text("Nova", 0, size * 0.4);
    }
    // Unknown/default
    else {
        fill(180, 40, 40);
        text("?", 0, size * 0.28);
    }
    pop();
}

function drawEngineItem(engineName, x = 0, y = 0, size = 40) {
    push();
    translate(x, y);
    rectMode(CENTER);

    const name = (engineName || "").toLowerCase();

    // Draw engine as a cylindrical thruster design
    stroke(0);
    fill(200, 150, 150);
    
    // Main engine body - cylindrical
    rect(0, -size * 0.1, size * 1.0, size * 0.6, 12);
    
    // Engine nozzle/exhaust
    fill(120, 80, 80);
    rect(size * 0.35, -size * 0.1, size * 0.3, size * 0.45, 8);
    
    // Engine intake
    fill(160, 110, 110);
    rect(-size * 0.35, -size * 0.1, size * 0.3, size * 0.45, 8);
    
    // Engine cooling vents
    stroke(0);
    strokeWeight(1);
    fill(100, 60, 60);
    for (let i = -1; i <= 1; i++) {
        rect(0, -size * 0.1 + i * size * 0.15, size * 0.6, size * 0.04, 2);
    }
    
    // Thruster glow effect
    noStroke();
    fill(255, 180, 100, 150);
    ellipse(size * 0.45, -size * 0.1, size * 0.15, size * 0.3);
    
    // Text background panel - clean area for text
    stroke(0);
    fill(220, 220, 220);
    rect(0, size * 0.28, size * 0.9, size * 0.25, 6);
    
    // Engine manufacturer text
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(size / 4);
    fill(60, 60, 60); // Dark text for good contrast
    
    // Engine manufacturers
    if (name.includes("pirate")) {
        text("Pirate", 0, size * 0.28);
    } else if (name.includes("core")) {
        text("Core", 0, size * 0.28);
    } else if (name.includes("kamen")) {
        text("Kamen", 0, size * 0.28);
    } else if (name.includes("aero")) {
        text("Aero", 0, size * 0.28);
    } else if (name.includes("nova")) {
        text("Nova", 0, size * 0.28);
    }
    // Unknown/default
    else {
        fill(180, 40, 40);
        text("?", 0, size * 0.28);
    }
    pop();
}