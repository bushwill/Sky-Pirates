// Prediction logic moved from Game.js to keep it organized
//
// Client-side prediction reduces perceived lag by simulating entity movement
// between server updates. This gives smooth, responsive gameplay.
//
// Prediction Strategy:
// - Players: Simple velocity-based prediction (vx, vy) for all players
//   - Controlled player: Also gets advanced physics prediction (lift, drag, gravity, propulsion)
// - Enemies: Simple velocity-based prediction (vx, vy)
// - Projectiles: Simple velocity-based prediction (ballistic motion)
// - Crates: Simple velocity-based prediction with water foam effects

// Track previous biome states for projectiles
let projectilePreviousBiomes = new Map();

// Reconcile local player state with server state
function reconcilePlayer(serverState) {
    // Find the local player object in the current players array
    // Note: 'players' is global from Game.js
    const localPlayer = players.find(p => p.username === serverState.username);
    if (!localPlayer) return;

    // 1. Reset local player to server's authoritative state
    localPlayer.x = serverState.x;
    localPlayer.y = serverState.y;
    localPlayer.vx = serverState.vx;
    localPlayer.vy = serverState.vy;
    localPlayer.angle = serverState.angle;
    // Also sync other physics properties if needed (e.g. engine power, heat)
    if (localPlayer.engine && serverState.engine) {
        localPlayer.engine.power = serverState.engine.power;
        localPlayer.engine.heat = serverState.engine.heat;
    }

    // 2. Remove processed inputs from pending buffer
    // serverState.lastInputSequence is the last sequence number the server processed
    const lastProcessed = serverState.lastInputSequence || 0;
    
    // Keep only inputs that haven't been processed yet
    // pendingInputs is global from Game.js
    if (typeof pendingInputs !== 'undefined') {
        // Filter out inputs that are older than or equal to the last processed sequence
        // We modify the array in-place or replace it. Replacing is safer.
        // However, pendingInputs is a let variable in Game.js, so we can't reassign it directly if it's not exported.
        // But since this file is likely concatenated or loaded in global scope, we assume access.
        // If pendingInputs is not accessible, we need to expose it.
        // Assuming global access:
        
        // Remove processed inputs
        while (pendingInputs.length > 0 && pendingInputs[0].sequence <= lastProcessed) {
            pendingInputs.shift();
        }

        // 3. Re-apply remaining pending inputs
        pendingInputs.forEach(input => {
            // Apply the input to the physics simulation
            // We need to make sure we use the keys from the input
            advancedPlayerPrediction(localPlayer, input.keys);
        });
    }
}

function estimatePlayerPositions(dt = 0.01) {
    players.forEach(player => {
        // Skip prediction for local player if we are reconciling (handled in draw loop via advancedPlayerPrediction)
        // But wait, advancedPlayerPrediction is called in draw() for the local player.
        // Here we are just doing simple extrapolation for others.
        // We should check if this is the local player.
        if (typeof username !== 'undefined' && player.username === username) {
            // Local player is handled by advancedPlayerPrediction in Game.js draw loop
            return;
        }

        player.x += player.vx * dt;
        player.y += player.vy * dt;
    });
}

function estimateEnemyPositions(dt = 0.01) {
    enemies.forEach(enemy => {
        // Only predict if enemy has valid position and velocity data
        if (enemy && typeof enemy.x === 'number' && typeof enemy.y === 'number' &&
            typeof enemy.vx === 'number' && typeof enemy.vy === 'number') {
            // Apply velocity-based prediction for enemies
            enemy.x += enemy.vx * dt;
            enemy.y += enemy.vy * dt;
        }
    });
}

function estimateProjectilePositions(dt = 0.01) {
    projectiles.forEach((projectile, index) => {
        // Get a unique identifier for this projectile (using index for now)
        const projectileId = `${projectile.owner}_${projectile.x}_${projectile.y}_${index}`;
        
        // Store previous biome for comparison
        const prevBiome = projectilePreviousBiomes.get(projectileId) || 'air';
        
        // Update position (client prediction)
        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;
        
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

function estimateCratePositions(dt = 0.01) {
    crates.forEach(crate => {
        // Store previous position to detect water entry
        const prevX = crate.x;
        const prevY = crate.y;
        
        // Update crate position
        crate.x += crate.vx * dt;
        crate.y += crate.vy * dt;
        
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
function advancedPlayerPrediction(player, inputKeys, dt = 0.01) {
    if (!player) return;
    
    const speed = getPlayerSpeed(player);

    // Only apply input-based physics to controlled player
    if (inputKeys) {
        // Only apply physics if not repairing
        if (!inputKeys.r) {
            applyPlayerTurning(player, speed, dt, inputKeys);
            applyPlayerThrottle(player, inputKeys);
        }
    }
    
    // Apply physics to all players (controlled or not)
    applyPlayerPropulsion(player, dt);
    applyPlayerLiftForce(player, speed, dt);
    applyPlayerGravityForce(player);
    applyPlayerDragForce(player, dt, inputKeys);
    updatePlayerPosition(player, dt);
}

// Predict all players with physics-based simulation
function predictAllPlayers(controlledPlayer, inputKeys) {
    players.forEach(player => {
        if (player === controlledPlayer) {
            // Controlled player gets input-based prediction
            advancedPlayerPrediction(player, inputKeys);
        } else {
            // Other players get physics prediction without input
            advancedPlayerPrediction(player, null);
        }
    });
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
    
    // Air brake logic (only for controlled player with input keys)
    if (inputKeys && player.wings?.airBrake) {
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