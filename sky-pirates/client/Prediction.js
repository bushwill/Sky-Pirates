// Prediction logic moved from Game.js to keep it organized

// Track previous biome states for projectiles
let projectilePreviousBiomes = new Map();

function estimatePlayerPositions() {
    let deltaTime = 0.01;
    players.forEach(player => {
        player.x += player.vx * deltaTime;
        player.y += player.vy * deltaTime;
    });
}

function estimateProjectilePositions() {
    let deltaTime = 0.01;
    projectiles.forEach((projectile, index) => {
        // Get a unique identifier for this projectile (using index for now)
        const projectileId = `${projectile.owner}_${projectile.x}_${projectile.y}_${index}`;
        
        // Store previous biome for comparison
        const prevBiome = projectilePreviousBiomes.get(projectileId) || 'air';
        
        // Update position (client prediction)
        projectile.x += projectile.vx * deltaTime;
        projectile.y += projectile.vy * deltaTime;
        
        // Check if projectile entered water according to server data
        const currentBiome = projectile.biome || 'air';
        
        // Update the stored previous biome
        projectilePreviousBiomes.set(projectileId, currentBiome);
    });
    
    // Clean up old projectile biome tracking (remove entries for projectiles that no longer exist)
    const currentProjectileIds = new Set();
    projectiles.forEach((projectile, index) => {
        const projectileId = `${projectile.owner}_${projectile.x}_${projectile.y}_${index}`;
        currentProjectileIds.add(projectileId);
    });
    
    for (const [id] of projectilePreviousBiomes) {
        if (!currentProjectileIds.has(id)) {
            projectilePreviousBiomes.delete(id);
        }
    }
}

function estimateCratePositions() {
    let deltaTime = 0.01;
    crates.forEach(crate => {
        // Store previous position to detect water entry
        const prevX = crate.x;
        const prevY = crate.y;
        
        // Update crate position
        crate.x += crate.vx * deltaTime;
        crate.y += crate.vy * deltaTime;
        
        // Check if crate is in water biome and moving
        const crateBiome = getBiomeAtPosition(crate.x, crate.y);
        if (crateBiome === 'water') {
            // Check if crate has significant velocity (moving through water)
            const speed = Math.sqrt(crate.vx * crate.vx + crate.vy * crate.vy);
            if (speed > 5) { // Only create foam if moving fast enough
                // Spawn foam particles occasionally (not every frame)
                if (Math.random() < 0.3) { // 30% chance per frame
                    spawnWaterFoamParticles(crate.x, crate.y, { vx: crate.vx, vy: crate.vy }, 1.5);
                }
            }
        }
    });
}

// Advanced player prediction that replicates server physics
function advancedPlayerPrediction(player, inputKeys) {
    if (!player) return;
    
    const deltaTime = 0.01;
    const speed = getPlayerSpeed(player);

    // Only apply physics if not repairing
    if (!inputKeys.r) {
        applyPlayerTurning(player, speed, deltaTime, inputKeys);
        applyPlayerThrottle(player, inputKeys);
    }
    
    applyPlayerPropulsion(player, deltaTime);
    applyPlayerLiftForce(player, speed, deltaTime);
    applyPlayerGravityForce(player);
    applyPlayerDragForce(player, deltaTime, inputKeys);
    updatePlayerPosition(player, deltaTime);
}

// Helper functions that replicate server physics

function getPlayerSpeed(player) {
    return Math.sqrt(player.vx * player.vx + player.vy * player.vy);
}

function applyPlayerTurning(player, speed, deltaTime, inputKeys) {
    if (!player.wings) return;
    
    const baseTurnSpeed = player.wings.baseTurnSpeed || 0.1;
    const minTurnSpeed = player.wings.minTurnSpeed || 0.05;
    const maxSpeed = player.wings.maxSpeed || 100;

    const speedFactor = 1 - Math.min(speed / maxSpeed, 1);
    const turnSpeed = (minTurnSpeed + (baseTurnSpeed - minTurnSpeed) * speedFactor) * deltaTime;

    if (inputKeys.a) player.angle -= turnSpeed;
    if (inputKeys.d) player.angle += turnSpeed;
}

function applyPlayerThrottle(player, inputKeys) {
    if (!player.engine) return;
    
    const throttleStep = (player.engine.maxPower || 100) / 100;
    if (inputKeys.w) player.engine.power += throttleStep;
    if (inputKeys.s) player.engine.power -= throttleStep;

    const minPower = player.engine.minPower || 0;
    const maxPower = player.engine.maxPower || 100;
    player.engine.power = Math.max(minPower, Math.min(maxPower, player.engine.power));
}

function applyPlayerPropulsion(player, deltaTime) {
    if (!player.engine || !player.weight) return;
    
    const acceleration = (player.engine.power / player.weight) * deltaTime;
    const ax = Math.cos(player.angle) * acceleration;
    const ay = Math.sin(player.angle) * acceleration;

    player.vx += ax;
    player.vy += ay;
}

function applyPlayerLiftForce(player, speed, deltaTime) {
    if (!player.wings) return;
    
    const vx = player.vx;
    const vy = player.vy;
    const velocityAngle = Math.atan2(vy, vx);
    let angleOfAttack = player.angle - velocityAngle;

    // Normalize AoA to [-π, π]
    angleOfAttack = Math.atan2(Math.sin(angleOfAttack), Math.cos(angleOfAttack));

    // Only apply lift within ±liftAngle
    const liftAngle = player.wings.liftAngle || Math.PI / 8;
    if (Math.abs(angleOfAttack) > liftAngle) {
        player.stalling = true;
        return;
    } else {
        player.stalling = false;
    }

    const liftCoefficient = player.wings.liftEfficiency || 0.001;
    const minLiftSpeed = player.wings.minLiftSpeed || 10;

    // Only apply lift if at or above minLiftSpeed
    if (speed < minLiftSpeed) return;

    const speedSquared = speed * speed;
    let liftMagnitude = liftCoefficient * speedSquared * Math.sin(angleOfAttack);

    // Clamp lift to avoid instability
    const MAX_LIFT = 1000;
    liftMagnitude = Math.max(Math.min(liftMagnitude, MAX_LIFT), -MAX_LIFT);

    // Lift acts perpendicular to velocity
    const liftAngle_calc = velocityAngle + Math.PI / 2;
    const liftX = Math.cos(liftAngle_calc) * liftMagnitude * deltaTime;
    const liftY = Math.sin(liftAngle_calc) * liftMagnitude * deltaTime;

    player.vx += liftX;
    player.vy += liftY;
}

function applyPlayerGravityForce(player) {
    const gravityForce = 0.5;
    const biome = player.biome || 'air';

    if (biome === 'water') {
        const buoyancyForce = (player.chassis?.buoyancy || 0.3) * 1.5;
        player.vy += gravityForce - buoyancyForce;
    } else if (biome === 'recovery') {
        return; // No gravity in recovery zones
    } else {
        player.vy += gravityForce;
    }
}

function applyPlayerDragForce(player, deltaTime, inputKeys) {
    let fluidDensity = 1.0;
    const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
    const wingArea = 0.5;
    const biome = player.biome || 'air';

    if (biome === 'water') {
        fluidDensity = 20.0;
    }
    
    let dragCoefficient = 0.06;
    
    // Air brake logic
    if (player.wings?.airBrake) {
        const minPower = player.engine?.minPower || 0;
        if (inputKeys.s && player.engine?.power === minPower) {
            dragCoefficient *= player.wings.airBrakeStrength || 3;
        }
    }
    
    if (speed === 0) return;

    // Drag force formula
    const dragForce = 0.5 * fluidDensity * speed * speed * dragCoefficient * wingArea;
    const dragAccel = dragForce / (player.weight || 100);

    // Drag vector is opposite velocity
    const dragX = -(player.vx / speed) * dragAccel * deltaTime;
    const dragY = -(player.vy / speed) * dragAccel * deltaTime;

    player.vx += dragX;
    player.vy += dragY;

    // Clamp tiny velocities to zero
    if (Math.abs(player.vx) < 0.001) player.vx = 0;
    if (Math.abs(player.vy) < 0.001) player.vy = 0;
}

function updatePlayerPosition(player, deltaTime) {
    player.x += player.vx * deltaTime;
    player.y += player.vy * deltaTime;
}