import { WebSocketServer } from 'ws';
import express from 'express';
import msgpack5 from 'msgpack5';
const msgpack = msgpack5();
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { MapObject } from './Map.mjs';
import { Player } from './Player.mjs';
import { NavySalvagePlane, NavySalvageBoat, EnemyPlane } from './Enemy.mjs';
import { Projectile } from './Projectile.mjs';
import { Crate } from './Crate.mjs';
import { createEngine, createChassis, createWings } from './ComponentList.mjs';
import { Party } from './Party.mjs';
import { createEnemyGun } from './WeaponList.mjs';

const admin_name = 'Shluck'

const mapData = new MapObject();
const recovery = mapData.getRecovery();

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INACTIVITY_THRESHOLD = 10 * 60 * 1000;

let timeSpeed = 1;

let players = [];
let enemies = [];
const playerSockets = new Map();
let parties = [];
let lastEnemySpawnTime = 0;
let enemySpawnRate = 500;
let projectiles = [];
let crates = [];
let crateScale = 10;
let max_money_crates = crateScale * 40; // Maximum number of crates allowed
let max_component_crates = crateScale * 10; // Maximum number of component crates allowed
let crateSpawnExclusionRadius = 1000; // Crates will not spawn within this distance from x=0

const startMillis = Date.now();

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const wss = new WebSocketServer({
  server,
  perMessageDeflate: { zlibDeflateOptions: { level: 9 } } // Highest compression
});

// Debug WebSocket connection attempts
server.on('upgrade', (request, socket, head) => {
  console.log('WebSocket upgrade request received:', request.url, request.headers);
});

function millis() {
  return Date.now() - startMillis;
}

// Helper: return the water surface Y at a given x coordinate.
// Picks the water biome that contains x (x1 <= x <= x2) or falls back to the first water biome.
// Returns the numerically smaller of y1 and y2 (higher on-screen), or null if none found.
function getWaterSurfaceAt(x) {
  if (!mapData || !Array.isArray(mapData.biomes)) return null;
  let waterBiome = mapData.biomes.find(b => b.type === 'water' && b.x1 <= x && x <= b.x2);
  if (!waterBiome) waterBiome = mapData.biomes.find(b => b.type === 'water');
  if (!waterBiome) return null;

  const y1 = (typeof waterBiome.y1 === 'number') ? waterBiome.y1 : Infinity;
  const y2 = (typeof waterBiome.y2 === 'number') ? waterBiome.y2 : Infinity;
  const surfaceY = Math.min(y1, y2);
  if (!isFinite(surfaceY)) return null;
  return surfaceY;
}

function updatePlayers() {
  players.forEach((player) => {
    checkPlayerBiome(player);
    updatePlayer(player);
    updateHull(player);
    player.messages = player.messages.filter((msg) => millis() - msg[0] < 8000);
  });
}

// Enemy plane update loop
function updateEnemies() {
  enemies.forEach((enemy) => {
    checkPlayerBiome(enemy);
    updateEnemy(enemy, players);
    updateHull(enemy);
    enemy.messages = enemy.messages.filter((msg) => millis() - msg[0] < 8000);
  });
}

function updateEnemy(enemy) {
  if (enemy instanceof EnemyPlane) {
    updatePlane(enemy);
  } else if (enemy instanceof NavySalvageBoat) {
    updateBoat(enemy);
  }
  enemy.updateAI(players);
  // Destroy enemy if it enters recovery biome
  if (enemy.biome === 'recovery') {
    handleDeath(enemy); // Remove enemy from the game
  }
}

function updatePlayer(player) {
  updatePlane(player);
  checkSpawnEnemyPlane(player);
  // Recovery zone logic for players only
  const deltaTime = 0.01 * timeSpeed;
  if (player.biome === 'recovery') {
    applyRecoveryJello(player, deltaTime);
    
    // Check for recovery zone and twin information
    const currentRecoveryZone = mapData.getRecoveryZoneAtPosition(player.x, player.y);
    const twinZone = currentRecoveryZone ? mapData.getTwinRecoveryZone(currentRecoveryZone) : null;
    
    // Store twin zone info on player for client
    player.currentRecoveryZone = currentRecoveryZone;
    player.twinRecoveryZone = twinZone;
    
    if (player.inventory.length > 0) {
      if (player.browsing === false) player.browsing = true; // Set browsing flag if player has items in inventory
    }
  } else if (player.browsing === true) {
    player.browsing = false; // Reset browsing flag if player is not in recovery biome
    player.currentRecoveryZone = null; // Clear recovery zone info
    player.twinRecoveryZone = null;
    sendNoticeMessage(player.username, "Sold all items for $" + player.sellAll(), 'game'); // Sell all items when leaving recovery biome
  }
}

// Update a single enemy plane (AI controlled)
// Shared plane update logic for both players and enemies
function updatePlane(plane) {
  if (!validatePlaneCoordinates(plane)) return;
  const deltaTime = 0.01 * timeSpeed;
  const speed = getSpeed(plane);

  if (!plane.keys['r']) {
    applyTurning(plane, speed, deltaTime);
    applyThrottle(plane);
    checkPlayerShooting(plane);
    checkDetach(plane);
  } else {
    applyRepairs(plane, deltaTime);
  }
  applyPropulsion(plane, deltaTime);
  applyHeat(plane, speed, deltaTime);
  updateGuns(plane, deltaTime);
  applyLiftForce(plane, speed, deltaTime);
  applyPlayerGravity(plane);
  applyPlayerDrag(plane, deltaTime);
  updatePosition(plane);
}

// Update a single enemy boat (AI controlled)
function updateBoat(boat) {
  // Boats handle their own gun targeting but need gun heat/cooldown updates and shooting
  const deltaTime = 0.01 * timeSpeed;
  updateGuns(boat, deltaTime);
  checkPlayerShooting(boat);
}

function updateProjectiles() {
  projectiles.forEach((projectile) => {
    updateProjectile(projectile);
  });
}

function updateProjectile(projectile) {
  const deltaTime = 0.01 * timeSpeed;
  // Check if projectile is in any recovery zone using biome detection
  if (mapData.getBiomeAtPosition(projectile.x, projectile.y) === 'recovery') {
    // remove projectile
    projectiles = projectiles.filter((p) => p !== projectile);
    return
  } else if (projectile.lifespan <= 0) {
    projectiles = projectiles.filter((p) => p !== projectile); // Remove expired projectile
    return;
  } else {
    projectile.lifespan -= 1000 * deltaTime; // Decrease lifespan
  }

  // Update position based on velocity
  projectile.x += projectile.vx * deltaTime;
  projectile.y += projectile.vy * deltaTime;

  // Update projectile biome
  projectile.biome = mapData.getBiomeAtPosition(projectile.x, projectile.y);

  // Check for collisions with players
  players.forEach((player) => {
    if (player.username === projectile.owner) return; // Skip collision with self
    const dx = Math.abs(player.x - projectile.x);
    const dy = Math.abs(player.y - projectile.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < player.size + projectile.size) {
      // Call entity's damage handler
      if (player.onDamaged) {
        player.onDamaged(projectile);
      }
      projectiles = projectiles.filter((p) => p !== projectile); // Remove projectile
    }
  });

  // Check for collisions with enemies
  enemies.forEach((enemy) => {
    if (enemy.username === projectile.owner) return; // Skip collision with self
    const dx = Math.abs(enemy.x - projectile.x);
    const dy = Math.abs(enemy.y - projectile.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < enemy.size + projectile.size) {
      // Call entity's damage handler
      if (enemy.onDamaged) {
        enemy.onDamaged(projectile);
      }
      projectiles = projectiles.filter((p) => p !== projectile); // Remove projectile
    }
  });


}

function updateCrates() {
  generateMoneyCrates();
  generateStandardComponentCrates();
  crates.forEach((crate) => {
    updateCrate(crate);
  });
}

function updateCrate(crate) {
  if (!crate.type) crates = crates.filter((c) => c !== crate); // Remove crate if type is undefined
  const deltaTime = 0.01 * timeSpeed;
  const ROPE_LENGTH = 5;
  const springStrength = 32;

  // Determine the crate's biome for drag/buoyancy
  let fluidDensity = 1.0;
  let biomeType = null;
  const player = players.find(p => p.username === crate.carrier);
  // Look up the player object by username
  if (crate.carrier) {
    if (!player) {
      crate.detach();
      return;
    } // Defensive: skip update if carrier is missing
    // Check if crate is in any recovery zone using biome detection
    if (mapData.getBiomeAtPosition(crate.x, crate.y) === 'recovery') {
      crate.open(player) // Open crate when in recovery zone
      if (crate.type === 'money') sendNoticeMessage(player.username, `+$${crate.cargo}!`, 'pickup');
      else if (crate.type === 'component') sendNoticeMessage(player.username, `Picked up ${crate.cargo.name}`, 'pickup');
      crates = crates.filter((c) => c !== crate);
      return;
    }
    // --- Rope physics ---
    // Find the rope's target position (behind the player)
    const ropeAngle = player.angle + Math.PI;
    const targetX = player.x + Math.cos(ropeAngle) * ROPE_LENGTH;
    const targetY = player.y + Math.sin(ropeAngle) * ROPE_LENGTH;

    const deltaX = targetX - crate.x;
    const deltaY = targetY - crate.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // For very distant crates, use teleportation approach to avoid physics instability
    const TELEPORT_THRESHOLD = 3000; // If crate is more than 3km away, use teleportation
    
    if (distance > TELEPORT_THRESHOLD) {
      // Halve the distance between crate and target position
      const midX = crate.x + deltaX * 0.5;
      const midY = crate.y + deltaY * 0.5;
      
      crate.x = midX;
      crate.y = midY;
      
      // Reset velocity to prevent physics artifacts
      crate.vx = 0;
      crate.vy = 0;
    } else {
      // Use normal spring physics for nearby crates
      crate.vx += deltaX * springStrength * deltaTime;
      crate.vy += deltaY * springStrength * deltaTime;
    }

    // Apply drag using your formula
    applyCrateDrag(crate, fluidDensity, deltaTime);

    // Buoyancy/Gravity (float in water)
    applyCrateBuoyancy(crate, biomeType);

    // Enhanced damping for distant crates to prevent oscillation
    const distanceToTarget = Math.sqrt((targetX - crate.x) ** 2 + (targetY - crate.y) ** 2);
    
    // Increase damping based on distance to prevent overshooting
    let dampingFactor = 0.8; // Base damping
    if (distanceToTarget > 1000) {
      // For very distant crates, add extra damping to prevent oscillation
      const extraDamping = Math.min(0.3, distanceToTarget / 50000); // More damping as distance increases
      dampingFactor -= extraDamping;
    }
    
    crate.vx *= dampingFactor;
    crate.vy *= dampingFactor;

    // Dynamic velocity limit based on distance - allow higher speeds for distant crates
    const BASE_MAX_VELOCITY = 200;
    const DISTANCE_VELOCITY_SCALE = 0.3; // Reduced from 0.5 to prevent excessive speeds
    const maxVelocity = Math.min(5000, BASE_MAX_VELOCITY + (distanceToTarget * DISTANCE_VELOCITY_SCALE)); // Cap at 5000
    
    const speed = Math.sqrt(crate.vx * crate.vx + crate.vy * crate.vy);
    if (speed > maxVelocity) {
      const scale = maxVelocity / speed;
      crate.vx *= scale;
      crate.vy *= scale;
    }

    // Update position
    updateCratePosition(crate, deltaTime);

  } else {
    for (let i = 0; i < mapData.biomes.length; i++) {
      const biome = mapData.biomes[i];
      if (biome.x1 <= crate.x && crate.x <= biome.x2 && biome.y1 <= crate.y && crate.y <= biome.y2) {
        biomeType = biome.type;
        if (biome.type === 'water') fluidDensity = 20.0;
        break;
      }
    }

    // Apply drag
    applyCrateDrag(crate, fluidDensity, deltaTime);

    // Buoyancy/Gravity
    applyCrateBuoyancy(crate, biomeType);

    // Update position
    updateCratePosition(crate, deltaTime);
  }

  // --- Crate-to-crate repulsion ---
  const REPULSION_RADIUS = crate.size * 2; // Repel if closer than 2x crate size
  const REPULSION_STRENGTH = 12; // Adjust this for how strongly crates push away

  crates.forEach(otherCrate => {
    if (otherCrate === crate) return; // Skip self
    const dx = crate.x - otherCrate.x;
    const dy = crate.y - otherCrate.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < REPULSION_RADIUS && distance > 0.01) {
      // Calculate normalized direction away from otherCrate
      const nx = dx / distance;
      const ny = dy / distance;
      // Repulsion force decreases with distance (stronger when closer)
      const force = REPULSION_STRENGTH * (REPULSION_RADIUS - distance) / REPULSION_RADIUS;
      crate.x += nx * force * deltaTime;
      crate.y += ny * force * deltaTime;
      otherCrate.x -= nx * force * deltaTime;
      otherCrate.y -= ny * force * deltaTime;
    }
  });

  // Collision: Attach to player if collision
  players.forEach((new_player) => {
    const dx = new_player.x - crate.x;
    const dy = new_player.y - crate.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const attach_radius = 2 * (new_player.size + crate.size + 5); // Double the pickup distance
    if (distance <= attach_radius && new_player.username !== crate.carrier) {
      new_player.attachCrate(crate);
      if (player) player.detachCrate(crate); // Detach from previous carrier if any
    }
  });
}

function generateMoneyCrates() {
  const crate_count = max_money_crates - crates.filter(c => c.type === 'money').length;

  if (players.length === 0 || crates.length > max_money_crates) return;
  // Map boundaries
  const seaLevel = 300; // Top of water biome from your map definition

  for (let i = 0; i < crate_count; i++) {
    let x;
    // Determine the valid range for x outside the exclusion zone
    // Valid x values are in [-mapData.sizeX, -crateSpawnExclusionRadius] and [crateSpawnExclusionRadius, mapData.sizeX]
    const validRange = mapData.sizeX - crateSpawnExclusionRadius * 2;
    if (validRange <= 0) {
      console.warn("Map size is too small to place crate outside exclusion region.");
      return;
    }
    // Randomly choose left or right side
    if (Math.random() < 0.5) {
      // Left side: from -mapData.sizeX up to -crateSpawnExclusionRadius
      x = -crateSpawnExclusionRadius - Math.random() * validRange;
    } else {
      // Right side: from crateSpawnExclusionRadius to mapData.sizeX
      x = crateSpawnExclusionRadius + Math.random() * validRange;
    }
    const y = seaLevel;
    
    // Calculate level based on distance (same system as components)
    let level = 1;
    if (Math.abs(x) > 140000) level = 10;        // Level 10: Very far (140km+)
    else if (Math.abs(x) > 120000) level = 9;    // Level 9: 120-140km
    else if (Math.abs(x) > 100000) level = 8;    // Level 8: 100-120km
    else if (Math.abs(x) > 80000) level = 7;     // Level 7: 80-100km
    else if (Math.abs(x) > 60000) level = 6;     // Level 6: 60-80km
    else if (Math.abs(x) > 40000) level = 5;     // Level 5: 40-60km
    else if (Math.abs(x) > 25000) level = 4;     // Level 4: 25-40km
    else if (Math.abs(x) > 14000) level = 3;     // Level 3: 14-25km
    else if (Math.abs(x) > 5000) level = 2;      // Level 2: 5-14km
    // Level 1: 0-5km (default)
    
    // Money scales as a fraction of average component value for that level
    const baseAmount = 15 + level * 25; // 40 at level 1, 290 at level 10
    const randomFactor = 0.8 + Math.random() * 0.4; // 80-120% variation
    const amount = Math.round(baseAmount * randomFactor);
    
    generateMoneyCrate(x, y, amount);
  }
}

function generateMoneyCrate(x, y, amount = 100) {
  crates.push(new Crate(x, y, "money", amount));
}

function generateStandardComponentCrates() {
  const crate_count = max_component_crates - crates.filter(c => c.type === 'component').length;

  if (players.length === 0 || crate_count <= 0) return;

  // Map boundaries
  const seaLevel = 300; // Top of water biome from your map definition

  for (let i = 0; i < crate_count; i++) {
    let x;
    // Determine the valid range for x outside the exclusion zone
    // Valid x values are in [-mapData.sizeX, -crateSpawnExclusionRadius] and [crateSpawnExclusionRadius, mapData.sizeX]
    const validRange = mapData.sizeX - crateSpawnExclusionRadius * 2;
    if (validRange <= 0) {
      console.warn("Map size is too small to place crate outside exclusion region.");
      return;
    }
    // Randomly choose left or right side
    if (Math.random() < 0.5) {
      // Left side: from -mapData.sizeX up to -crateSpawnExclusionRadius
      x = -crateSpawnExclusionRadius - Math.random() * validRange;
    } else {
      // Right side: from crateSpawnExclusionRadius to mapData.sizeX
      x = crateSpawnExclusionRadius + Math.random() * validRange;
    }
    const y = seaLevel;
    generateRandomBasicComponentCrate(x, y);
  }
}

function generateRandomBasicComponentCrate(x, y) {
  let value = Math.abs(x); // Use absolute distance from center
  let level = 1;
  let type = Math.floor(Math.random() * 3); // 0-2 for different component types
  let manufacturer = Math.floor(Math.random() * 4) + 1; // 1-4 for different manufacturers  
  let component = null;
  
  // Level distribution based on distance from center
  if (value > 140000) level = 10;        // Level 10: Very far (140km+)
  else if (value > 120000) level = 9;    // Level 9: 120-140km
  else if (value > 100000) level = 8;    // Level 8: 100-120km
  else if (value > 80000) level = 7;     // Level 7: 80-100km
  else if (value > 60000) level = 6;     // Level 6: 60-80km
  else if (value > 40000) level = 5;     // Level 5: 40-60km
  else if (value > 25000) level = 4;     // Level 4: 25-40km
  else if (value > 14000) level = 3;     // Level 3: 14-25km
  else if (value > 5000) level = 2;      // Level 2: 5-14km
  // Level 1: 0-5km (default)
  
  if (type < 1) {
    component = createEngine(manufacturer, level); // Create a standard engine component
  } else if (type < 2) {
    component = createChassis(manufacturer, level); // Create a chassis component
  } else {
    component = createWings(manufacturer, level); // Create a wings component
  }
  crates.push(new Crate(x, y, "component", component));
}

// --- Utility functions using your existing formulas ---

function applyRecoveryJello(player, deltaTime) {
  // Deactivate gravity: do not apply gravity in recovery zone

  const speed = Math.sqrt(player.vx ** 2 + player.vy ** 2);
  const throttle = player.engine.power;
  
  // Only apply friction if not throttling - this prevents getting stuck
  if (throttle <= player.engine.minPower) {
    const stopThreshold = 0.5; // Much lower threshold when not throttling
    // Moderate friction (0.85-0.95) instead of high friction
    let friction = 0.85 + Math.min(0.1, speed / 100); // At speed 100, friction is 0.95

    // If speed is very low and no throttle, stop the player
    if (speed < stopThreshold) {
      player.vx = 0;
      player.vy = 0;
    } else {
      // Apply friction to slow the player
      player.vx *= friction;
      player.vy *= friction;
    }
  } else {
    // When throttling, apply much lighter friction to allow acceleration
    // Light friction to provide some resistance but not prevent movement
    let lightFriction = 0.98 + Math.min(0.015, speed / 200); // Very light friction (0.98-0.995)
    player.vx *= lightFriction;
    player.vy *= lightFriction;
    
    // Guaranteed minimum propulsion when throttling - ensures movement even from zero
    const minAcceleration = 0.1; // Minimum acceleration to ensure movement
    const acceleration = Math.max(minAcceleration, (throttle / player.weight) * deltaTime * 2); // Boosted in recovery
    player.vx += Math.cos(player.angle) * acceleration;
    player.vy += Math.sin(player.angle) * acceleration;
  }
}

function applyCrateDrag(crate, fluidDensity, deltaTime) {
  const dragCoefficient = 0.06;
  const speed = Math.sqrt(crate.vx ** 2 + crate.vy ** 2);
  if (speed > 0) {
    const dragForce = 0.5 * fluidDensity * speed * speed * dragCoefficient;
    const dragAccel = dragForce / crate.weight;
    crate.vx += -(crate.vx / speed) * dragAccel * deltaTime;
    crate.vy += -(crate.vy / speed) * dragAccel * deltaTime;
    // Clamp tiny velocities
    if (Math.abs(crate.vx) < 0.001) crate.vx = 0;
    if (Math.abs(crate.vy) < 0.001) crate.vy = 0;
  }
}

function applyCrateBuoyancy(crate, biomeType) {
  const gravityForce = 1.0;
  const crateBuoyancy = 2.0;
  if (biomeType === 'water') {
    crate.vy += gravityForce - crateBuoyancy;
  } else {
    crate.vy += gravityForce;
  }
}

function updateCratePosition(crate, deltaTime) {
  crate.x += crate.vx * deltaTime;
  crate.y += crate.vy * deltaTime;
}

function checkPlayerShooting(player) {
  if (player.keys.c && player.gunToggleCooldown <= 0) {
    player.selectedGun = player.selectedGun === 1 ? 2 : 1;
    player.gunToggleCooldown = 200; // Set cooldown for gun toggle
  }

  player.gunToggleCooldown = Math.max(0, player.gunToggleCooldown - 10 * timeSpeed); // Decrease cooldown

  if (player.biome === 'recovery') {
    return;
  }
  if (player.keys?.mouse) {
    if (player.selectedGun === 1) {
      if (player.gun1.cooldown === 0 && player.gun1.heat < player.gun1.maxHeat - player.gun1.heatEfficiency) {
        projectiles.push(createBullet(player, player.gun1));
        player.gun1.cooldown = player.gun1.cooldownTime;
        player.gun1.heat = Math.min(player.gun1.maxHeat, player.gun1.heat + player.gun1.heatEfficiency);
      }
    } else if (player.selectedGun === 2) {
      if (player.gun2.cooldown === 0 && player.gun2.heat < player.gun2.maxHeat - player.gun2.heatEfficiency) {
        projectiles.push(createBullet(player, player.gun2));
        player.gun2.cooldown = player.gun2.cooldownTime;
        player.gun2.heat = Math.min(player.gun2.maxHeat, player.gun2.heat + player.gun2.heatEfficiency);
      }
    }
  }
}

function checkDetach(plane) {
  if (plane.keys['f']) {
    plane.detachAllCrates();
  }
}

function checkSpawnEnemyPlane(plane) {
  const now = Date.now();
  if (plane.keys['p'] && plane.privileges && (now - lastEnemySpawnTime > enemySpawnRate)) {
    lastEnemySpawnTime = now;
    const enemy = new NavySalvagePlane(
      plane.biome,
      `NavySalvage_${Date.now()}`,
      50, 50, 200,
      plane.x,
      plane.y - 500
    );
    enemies.push(enemy);
  }
}

function createBullet(player, gun) {
  const angle = gun.angle;
  const vx = Math.cos(angle) * gun.projectileSpeed;
  const vy = Math.sin(angle) * gun.projectileSpeed;

  const projectile = new Projectile(
    player.x,
    player.y,
    vx,
    vy,
    angle,
    gun.damage, // damage
    gun.projectileSize, // size
    player.username,
    5000, // lifespan in seconds
    100,
    100, // color RGB
    100
  );

  return projectile;
}

function applyRepairs(player, deltaTime) {
  // Support both direct hull and chassis.hull
  const maxHull = (typeof player.maxHull === 'number') ? player.maxHull : (player.chassis && typeof player.chassis.maxHull === 'number' ? player.chassis.maxHull : null);
  if (!maxHull) return;
  const repairRate = maxHull / 15; // Hull repaired per second

  if (player.biome === 'water') return; // No repairs in water

  if (typeof player.hull === 'number') {
    if (player.hull < maxHull) {
      player.hull += repairRate * deltaTime;
      if (player.hull > maxHull) player.hull = maxHull;
    }
  } else if (player.chassis && typeof player.chassis.hull === 'number') {
    if (player.chassis.hull < maxHull) {
      player.chassis.hull += repairRate * deltaTime;
      if (player.chassis.hull > maxHull) player.chassis.hull = maxHull; // Clamp to max hull
    }
  }
}

function getSpeed(player) {
  return Math.sqrt(player.vx ** 2 + player.vy ** 2);
}

function applyTurning(player, speed, deltaTime) {
  const baseTurnSpeed = player.wings.baseTurnSpeed;
  const minTurnSpeed = player.wings.minTurnSpeed;
  const maxSpeed = player.wings.maxSpeed;

  const speedFactor = 1 - Math.min(speed / maxSpeed, 1);
  const turnSpeed = (minTurnSpeed + (baseTurnSpeed - minTurnSpeed) * speedFactor) * deltaTime;

  if (player.keys?.a) player.angle -= turnSpeed;
  if (player.keys?.d) player.angle += turnSpeed;
}

function applyThrottle(player) {
  const throttleStep = player.engine.maxPower / 100;
  if (player.keys?.w) player.engine.power += throttleStep;
  if (player.keys?.s) player.engine.power -= throttleStep;

  player.engine.power = Math.max(player.engine.minPower, Math.min(player.engine.maxPower, player.engine.power)); // clamping of engine power
}

function applyHeat(player, speed, deltaTime) {
  var generated = player.engine.power * player.engine.heatEfficiency * deltaTime;
  var dispersed = player.chassis.heatDispersion * deltaTime;

  if (speed > player.chassis.topSpeed) {
    const excessSpeed = speed - player.chassis.topSpeed;
    generated += excessSpeed * deltaTime; // reduce multiplier to smooth jump
  }


  if (player.biome === 'water') {
    dispersed *= 2; // Increase heat dispersion in water
  } else if (player.biome === 'recovery') {
    // Instantly reset heat to 0 in recovery zones
    player.engine.heat = 0;
    return; // Exit early since heat is already handled
  }

  if (player.engine.heat >= player.engine.maxHeat && generated > dispersed) {
    const heatDamage = (generated - dispersed) / 5;
    if (typeof player.hull === 'number') player.hull -= heatDamage;
    else if (player.chassis && typeof player.chassis.hull === 'number') player.chassis.hull -= heatDamage; // Hull damage if heat is too high
  } else {
    player.engine.heat += (generated - dispersed);
  }

  // Clamp heat between 0 and maxHeat
  player.engine.heat = Math.max(0, Math.min(player.engine.maxHeat, player.engine.heat));
}

function validatePlaneCoordinates(plane) {
  if (
    typeof plane.t_x !== 'number' ||
    typeof plane.t_y !== 'number' ||
    typeof plane.x !== 'number' ||
    typeof plane.y !== 'number'
  ) {
    console.error(`Invalid coordinates for plane ${plane.username}:`, {
      t_x: plane.t_x,
      t_y: plane.t_y,
      x: plane.x,
      y: plane.y,
    });
    return false;
  }
  return true;
}

function clampAngle(gunAngle, playerAngle, maxAngle) {
  // Normalize both angles first to avoid weird wraparound issues
  gunAngle = normalizeAngle(gunAngle);
  playerAngle = normalizeAngle(playerAngle);

  // Calculate difference from player angle, normalized between -PI and PI
  let diff = normalizeAngle(gunAngle - playerAngle);

  // Clamp the difference to the range [-maxAngle, maxAngle]
  if (diff > maxAngle) diff = maxAngle;
  else if (diff < -maxAngle) diff = -maxAngle;

  // Return the clamped angle relative to playerAngle
  return normalizeAngle(playerAngle + diff);
}


function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function getTargetAngle(player) {
  const dx = player.t_x - player.x;
  const dy = player.t_y - player.y;
  return normalizeAngle(Math.atan2(dy, dx));
}

function updateGunAngle(player, gun, targetAngle, deltaTime) {
  if (!gun) return;
  // Normalize angles to [-π, π]
  targetAngle = ((targetAngle + Math.PI) % (2 * Math.PI)) - Math.PI;
  gun.angle = ((gun.angle + Math.PI) % (2 * Math.PI)) - Math.PI;

  // Calculate the shortest angular difference
  let diff = shortestAngleDiff(targetAngle, gun.angle);

  // Determine constant rotation speed based on weight
  // Here, rotationSpeed is constant per second, you may adjust the base factor as needed.
  const rotationSpeed = 1 / gun.weight; // For example: if weight is higher, turn slower

  // Compute the maximum change permitted this frame
  const maxChange = rotationSpeed * deltaTime;

  // If the difference is smaller than our maximum change, snap to target
  if (Math.abs(diff) <= maxChange) {
    gun.angle = targetAngle;
  } else {
    // Rotate in the direction of the target angle
    gun.angle += Math.sign(diff) * maxChange;
    // Normalize result
    gun.angle = ((gun.angle + Math.PI) % (2 * Math.PI)) - Math.PI;
  }
}

function shortestAngleDiff(target, source) {
  let a = target - source;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function updateGunCooldown(gun, deltaTime) {
  if (gun.cooldown > 0) {
    gun.cooldown = Math.max(0, gun.cooldown - deltaTime * 1000);
  }
}

function updateGunHeat(entity, gun, deltaTime) {
  if (entity.biome === 'recovery') {
    // Instantly reset gun heat to 0 in recovery zones
    gun.heat = 0;
    return;
  }
  
  if (gun.heat > 0) {
    // Use chassis.heatDispersion for players, default value for enemies
    const heatDispersion = entity.chassis?.heatDispersion ?? 30;
    gun.heat = Math.max(0, gun.heat - heatDispersion * deltaTime);
  }
}

function updateGuns(entity, deltaTime) {
  const targetAngle = getTargetAngle(entity);

  if (isNaN(targetAngle)) {
    console.error(`NaN targetAngle for entity ${entity.username}`, {
      targetAngle,
      gun1Angle: entity.gun1?.angle,
      gun2Angle: entity.gun2?.angle,
    });
    return;
  }

  if (entity.gun1) {
    updateGunAngle(entity, entity.gun1, targetAngle, deltaTime);
    entity.gun1.angle = clampAngle(entity.gun1.angle, entity.angle, entity.gun1.maxAngle);
    updateGunCooldown(entity.gun1, deltaTime);
    updateGunHeat(entity, entity.gun1, deltaTime);
  }

  if (entity.gun2) {
    updateGunAngle(entity, entity.gun2, targetAngle, deltaTime);
    entity.gun2.angle = clampAngle(entity.gun2.angle, entity.angle, entity.gun2.maxAngle);
    updateGunCooldown(entity.gun2, deltaTime);
    updateGunHeat(entity, entity.gun2, deltaTime);
  }
}

function applyPropulsion(player, deltaTime) {
  const acceleration = (player.engine.power / player.weight) * deltaTime;

  const ax = Math.cos(player.angle) * acceleration;
  const ay = Math.sin(player.angle) * acceleration;

  player.vx += ax;
  player.vy += ay;
}

function applyPlayerGravity(player) {
  const gravityForce = 0.5; // normal gravity

  if (player.biome === 'water') {
    // Enhanced buoyancy for easier water lift-off
    const buoyancyForce = player.chassis.buoyancy * 1.5; // 50% stronger buoyancy
    // Buoyancy opposes gravity
    player.vy += gravityForce - buoyancyForce;
  } else if (player.biome === 'recovery') {
    return;
  } else {
    player.vy += gravityForce;
  }

}

function applyLiftForce(player, speed, deltaTime) {
  const vx = player.vx;
  const vy = player.vy;
  const velocityAngle = Math.atan2(vy, vx);
  let angleOfAttack = player.angle - velocityAngle;

  // Normalize AoA to [-π, π]
  angleOfAttack = Math.atan2(Math.sin(angleOfAttack), Math.cos(angleOfAttack));

  // Only apply lift within ±liftAngle (e.g., π/8)
  if (Math.abs(angleOfAttack) > player.wings.liftAngle) {
    player.stalling = true;
    return;
  } else {
    player.stalling = false;
  }

  const liftCoefficient = player.wings.liftEfficiency;
  const minLiftSpeed = player.wings.minLiftSpeed;

  // Only apply lift if at or above minLiftSpeed
  if (speed < minLiftSpeed) return;

  const speedSquared = speed * speed;
  // Lift scaled by smooth ramp * liftCoefficient * speedSquared * sin(angleOfAttack)
  let liftMagnitude = liftCoefficient * speedSquared * Math.sin(angleOfAttack);

  // Clamp lift to avoid instability
  const MAX_LIFT = 1000;
  liftMagnitude = Math.max(Math.min(liftMagnitude, MAX_LIFT), -MAX_LIFT);

  // Lift acts perpendicular to velocity (left-hand normal)
  const liftAngle = velocityAngle + Math.PI / 2;
  const liftX = Math.cos(liftAngle) * liftMagnitude * deltaTime;
  const liftY = Math.sin(liftAngle) * liftMagnitude * deltaTime;

  player.vx += liftX;
  player.vy += liftY;
}


function applyPlayerDrag(player, deltaTime) {
  var fluidDensity = 1.0;
  const speed = Math.sqrt(player.vx ** 2 + player.vy ** 2);
  const wingArea = 0.5;         // smaller area = less drag

  if (player.biome === 'water') {
    fluidDensity = 20.0;
  }
  var dragCoefficient = 0.06;  // from 0.47 to 0.1 = less drag
  if (player.wings.airBrake) {
    if (player.keys.s && player.engine.power == player.engine.minPower) {
      dragCoefficient *= player.wings.airBrakeStrength; // increase drag when air brake is active
    }
  }
  if (speed === 0) return;

  // Drag force formula: Fd = 0.5 * fluidDensity * speed^2 * dragCoefficient * area
  const dragForce = 0.5 * fluidDensity * speed * speed * dragCoefficient * wingArea;

  // Drag acceleration = dragForce / mass
  const dragAccel = dragForce / player.weight;

  // Drag vector is opposite velocity
  const dragX = -(player.vx / speed) * dragAccel * deltaTime;
  const dragY = -(player.vy / speed) * dragAccel * deltaTime;

  player.vx += dragX;
  player.vy += dragY;

  // Optional: clamp tiny velocities to zero
  if (Math.abs(player.vx) < 0.001) player.vx = 0;
  if (Math.abs(player.vy) < 0.001) player.vy = 0;
}

function updateHull(entity) {
  const deltaTime = 0.01 * timeSpeed;
  // Support both direct hull (boats) and chassis.hull (planes/players)
  const hull = (typeof entity.hull === 'number') ? entity.hull : (entity.chassis && typeof entity.chassis.hull === 'number' ? entity.chassis.hull : null);
  const maxHull = (typeof entity.maxHull === 'number') ? entity.maxHull : (entity.chassis && typeof entity.chassis.maxHull === 'number' ? entity.chassis.maxHull : null);

  if (hull !== null && hull <= 0) {
    // Determine if this entity is a player (has money/value) or an enemy
    const isPlayer = players.some(p => p.username === entity.username);
    if (isPlayer) {
      if (entity.money >= entity.value) handleRevive(entity);
      else handleDeath(entity);
    } else {
      // For enemies, just remove them
      handleDeath(entity);
    }
  }

  // No automatic hull drain in water here; repair/heat systems handle repair/damage elsewhere.
}

function handleRevive(player) {
  player.money -= player.value;
  sendNoticeMessageAll(`${player.username} has been downed!`, 'server');
  sendNoticeMessage(player.username, `You have been downed! -$${player.value}.`, 'urgent');
  player.respawn();
}

function handleDeath(plane) {
  // Check if plane is a player or enemy
  const playerIndex = players.findIndex((p) => p.username === plane.username);
  const enemyIndex = typeof enemies !== 'undefined' ? enemies.findIndex((e) => e.username === plane.username) : -1;
  const socket = playerSockets.get(plane.username);

  if (playerIndex !== -1) {
    sendNoticeMessageAll(`${plane.username} has been killed!`, 'server');
    if (socket) {
      sendMessage(socket, {
        type: 'player_destroyed'
      });
    }
    plane.detachAllCrates();
    players.splice(playerIndex, 1);
    playerSockets.delete(plane.username);
    return;
  }

  // Remove enemy plane without messages or websockets
  if (enemyIndex !== -1) {
    plane.detachAllCrates?.(); // Detach all crates from enemy plane
    enemies.splice(enemyIndex, 1);
    return;
  }
}

function updatePosition(player, deltaTime = 0.01 * timeSpeed) {
  player.x += player.vx * deltaTime;
  player.y += player.vy * deltaTime;
}

function checkPlayerBiome(player) {
  let foundBiome = null;
  // Iterate all biomes to check if the player's position is within any biome.
  for (let i = 0; i < mapData.biomes.length; i++) {
    const biome = mapData.biomes[i];
    if (
      biome.x1 <= player.x &&
      player.x <= biome.x2 &&
      biome.y1 <= player.y &&
      player.y <= biome.y2
    ) {
      foundBiome = biome.type;
      break; // exit loop on first matching biome
    }
  }

  // If no matching biome is found, default to 'air'
  if (!foundBiome) {
    foundBiome = 'air';
  }

  player.biome = foundBiome;
}

function checkParties() {
  parties.forEach((party) => {
    if (party.players.length > 0) {
      parties = parties.filter((p) => p.players.length > 0); // Remove empty parties
    }
  });
  // If you need usernames, use party.getPlayerUsernames()
}

// Utility to get serializable party info
function getSerializableParties() {
  return parties.map(party => ({
    name: party.name,
    color: { r: party.r, g: party.g, b: party.b },
    players: party.getPlayerUsernames()
  }));
}

wss.on('connection', (ws, request) => {
  console.log('WebSocket connection established from:', request.socket.remoteAddress, 'URL:', request.url);
  ws.currentUsername = null; // Initialize username per connection

  ws.on('message', (data) => {
    const decodedMessage = msgpack.decode(data);
    handleIncomingMessage(ws, decodedMessage);
  });

  ws.on('close', () => {
    if (ws.currentUsername) {
      let player = players.find((p) => p.username === ws.currentUsername);
      player.detachAllCrates();
      players = players.filter((p) => p.username !== ws.currentUsername);
      playerSockets.delete(ws.currentUsername);
      sendNoticeMessageAll(ws.currentUsername + ' has disconnected', 'server');
      console.log(`Player disconnected: ${ws.currentUsername}`);
    }
  });
});

function handleIncomingMessage(ws, message) {
  switch (message.type) {
    case 'login':
      handleLogin(ws, message);
      break;
    case 'update':
      handleUpdate(ws, message);
      break;
    case 'get_players':
      sendMessage(ws, { type: 'player_data', players: players });
      break;
    case 'get_enemies':
      const playerForEnemies = players.find(p => p.username === ws.currentUsername);
      const filteredEnemies = filterEntitiesInRange(enemies, playerForEnemies);
      sendMessage(ws, { type: 'enemy_data', enemies: filteredEnemies });
      break;
    case 'get_parties':
      sendMessage(ws, { type: 'party_data', parties: getSerializableParties() });
      break;
    case 'get_map':
      sendMessage(ws, { type: 'map_data', map: mapData })
      break;
    case 'get_projectiles':
      const playerForProjectiles = players.find(p => p.username === ws.currentUsername);
      const filteredProjectiles = filterEntitiesInRange(projectiles, playerForProjectiles);
      sendMessage(ws, { type: 'projectile_data', projectiles: filteredProjectiles });
      break;
    case 'get_crates':
      const playerForCrates = players.find(p => p.username === ws.currentUsername);
      const filteredCrates = filterCratesInRange(crates, playerForCrates);
      sendMessage(ws, { type: 'crate_data', crates: filteredCrates });
      break;
    case 'equip_item':
      handleEquipItem(ws, message);
      break;
    case 'ping':
      handlePing(ws, message);
      break;
    case 'teleport_to_twin':
      handleTeleportToTwin(ws, message);
      break;
  }
}

function handleEquipItem(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (player) {
    const item = player.inventory[message.itemIndex];
    if (item) {
      let equipSuccess = player.install(item);
      if (equipSuccess) {
        sendNoticeMessage(ws.currentUsername, `Equipped ${item.name}`, 'game');
      } else {
        sendNoticeMessage(ws.currentUsername, `Failed to equip ${item.name}`, 'game');
      }
    } else {
      console.warn('Item not found in inventory:', message.itemIndex);
    }
  } else {
    console.warn('Player not found for equip_item:', ws.currentUsername);
  }
};

function handleTeleportToTwin(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (!player) {
    console.warn('Player not found for teleport:', ws.currentUsername);
    return;
  }

  // Check if player is in a recovery zone
  const currentRecoveryZone = mapData.getRecoveryZoneAtPosition(player.x, player.y);
  if (!currentRecoveryZone) {
    sendNoticeMessage(ws.currentUsername, 'You must be in a recovery zone to teleport!', 'urgent');
    return;
  }

  // Check if the recovery zone has a twin
  const twinZone = mapData.getTwinRecoveryZone(currentRecoveryZone);
  if (!twinZone) {
    sendNoticeMessage(ws.currentUsername, 'This recovery zone has no twin destination!', 'urgent');
    return;
  }

  // Calculate center of twin recovery zone
  const twinCenterX = (twinZone.x1 + twinZone.x2) / 2;
  const twinCenterY = (twinZone.y1 + twinZone.y2) / 2;

  // Store current position for feedback
  const oldX = Math.round(player.x);
  const oldY = Math.round(player.y);

  // Teleport the player to the twin zone center
  player.x = twinCenterX;
  player.y = twinCenterY;

  // Reset velocity to prevent momentum carrying over
  player.vx = 0;
  player.vy = 0;

  // Send feedback messages
  sendNoticeMessage(ws.currentUsername, `Teleported from ${currentRecoveryZone.id} to ${twinZone.id}!`, 'game');
};

function handleLogin(ws, { username, r, g, b, selectedGun1, selectedGun2, partyName }) {
  const existingPlayer = players.find((player) => player.username === username);
  if (!existingPlayer) {
    sendNoticeMessageAll(username + " joined!", "server")
    const player = new Player('air', username, r, g, b, 0, -400, startMillis, selectedGun1, selectedGun2);
    players.push(player);
    playerSockets.set(username, ws);
    ws.currentUsername = username; // Set username in socket context
    
    // Handle party joining
    if (partyName && partyName.trim()) {
      let party = parties.find(party => party.name === partyName.trim());
      if (!party) {
        parties.push(new Party(partyName.trim()));
        party = parties.find(party => party.name === partyName.trim());
        sendNoticeMessage(username, `Created and joined party "${partyName.trim()}"`, 'server');
      } else {
        sendNoticeMessage(username, `Joined party "${partyName.trim()}"`, 'server');
      }
      party.addPlayer(player);
    }
    
    sendMessage(ws, { type: 'login_success', username, map: mapData });
    sendNoticeMessage(username, "Hi!", 'game');
    sendNoticeMessage(username, "Current players: " + players.length, 'server');
    logPlayerJoin(username);
    if (player.username === admin_name) {
      sendNoticeMessage(username, "You are the admin.", 'server');
      player.privileges = true; // Grant admin privileges
    }
  } else {
    sendMessage(ws, { type: 'login_failed', message: 'Username already in use.' });
  }
}

function handleUpdate(ws, { username, keys, t_x, t_y, chat_message }) {
  const player = players.find((p) => p.username === username);
  if (player) {
    player.keys = keys || player.keys;
    player.t_x = t_x;
    player.t_y = t_y;
    if (chat_message) {
      logMessage(username, chat_message);
      if (chat_message[0] === '/') checkCommand(chat_message, player);
      else player.messages.push([millis(), chat_message]);
    }
    player.lastActivity = millis();
  }
}

// Message types are: urgent, game, server, pickup
function sendNoticeMessage(username, message, type) {
  const playerSocket = playerSockets.get(username);
  if (playerSocket) {
    sendMessage(playerSocket, {
      type: 'notice_message',
      message: message,
      message_type: type
    });
  } else {
    console.warn('No WebSocket connection found for the username:' + username);
    return;
  }
}

function sendNoticeMessageAll(message, type) {
  playerSockets.forEach((playerSocket, username) => {
    sendMessage(playerSocket, {
      type: 'notice_message',
      message: message,
      message_type: type
    });
  });
}

function handlePing(ws, message) {
  const clientTime = message.clientTime; // Client's timestamp

  const response = {
    type: 'pong',
    clientTime: clientTime, // Echo client's timestamp
  };

  sendMessage(ws, response); // Encode and send the pong message
}

// Helper function to filter entities within culling range of a player
function filterEntitiesInRange(entities, player, cullingDistance = 2000) {
  if (!player) return [];
  return entities.filter(entity => {
    const dist = Math.sqrt(
      (entity.x - player.x) ** 2 + 
      (entity.y - player.y) ** 2
    );
    return dist <= cullingDistance;
  });
}

// Helper function to filter crates for a player
function filterCratesInRange(entities, player, cullingDistance = 2000) {
  if (!player) return [];
  return entities.filter(entity => {
    if (entity.carrier === player.username) return true; // Always include carried crates
    const dist = Math.sqrt(
      (entity.x - player.x) ** 2 + 
      (entity.y - player.y) ** 2
    );
    return dist <= cullingDistance;
  });
}

function sendMessage(ws, data) {
  try {
    data.timeSent = Date.now();
    const encodedData = msgpack.encode(data);
    const buffer = new Uint8Array(4 + encodedData.length);
    const view = new DataView(buffer.buffer);
    view.setUint32(0, encodedData.length, true); // Add length prefix in little-endian
    buffer.set(encodedData, 4);
    ws.send(buffer);
  } catch (error) {
    console.error('Error encoding or sending message:', error);
  }
}

function logToFile(filename, data) {
  fs.appendFile(filename, `${data}\n`, (err) => {
    if (err) {
      console.error(`Failed to log to ${filename}:`, err);
    }
  });
}

function logPlayerJoin(username) {
  const logMessage = `Player joined: ${username} at ${new Date().toISOString()}`;
  logToFile('players.log', logMessage);
}

function logMessage(username, message) {
  const logMessage = `[${new Date().toISOString()}] ${username}: ${message}`;
  logToFile('messages.log', logMessage);
}

function smoothstep(edge0, edge1, x) {
  // Scale, clamp x to [0..1] range
  let t = (x - edge0) / (edge1 - edge0);
  t = Math.min(Math.max(t, 0), 1);
  // Evaluate polynomial
  return t * t * (3 - 2 * t);
}

function itemTest(manufacturer, level, player) {
  // Create components for the specified manufacturer and level
  const engineComp = createEngine(manufacturer, level);
  const chassisComp = createChassis(manufacturer, level);
  const wingsComp = createWings(manufacturer, level);

  // Create 3 crates at the player's current location, with slight spacing
  const baseX = player.x;
  const baseY = player.y;
  crates.push(new Crate(baseX - 20, baseY, 'component', engineComp));
  crates.push(new Crate(baseX, baseY, 'component', chassisComp));
  crates.push(new Crate(baseX + 20, baseY, 'component', wingsComp));

  sendNoticeMessage(player.username, `Created level ${level} item test crates for manufacturer ${manufacturer} at your location`, 'server');
}

function weaponTest(weaponNumber, player) {
  // Create level 1 components for the specified manufacturer
  const weapon = createEnemyGun(weaponNumber, 1);
  player.equip(weapon);
  sendNoticeMessage(player.username, "Equipped weapon " + weapon.name, 'game');
}

function enemyTest(player, type = 0) {
  try {
    if (type === 0) {
      const enemy = new NavySalvagePlane(
        player.biome,
        `NavySalvage_${Date.now()}`,
        50, 50, 200,
        player.x,
        player.y - 500
      );
      enemies.push(enemy);
      console.log(`Spawned plane ${enemy.username} at ${enemy.x},${enemy.y}`);
      sendNoticeMessage(player.username, `Spawned plane ${enemy.username}`, 'server');
    } else if (type === 1) {
      // Spawn boat at player's x and at ocean surface.
      // Prefer the water biome that contains the player's x, otherwise fall back to the first water biome.
      let waterBiome = mapData.biomes.find(b => b.type === 'water' && b.x1 <= player.x && player.x <= b.x2);
      if (!waterBiome) waterBiome = mapData.biomes.find(b => b.type === 'water');

      // Determine surface Y using helper
      let waterY = getWaterSurfaceAt(player.x);
      if (waterY === null) waterY = 310;

      const enemy = new NavySalvageBoat(
        player.biome,
        `NavyBoat_${Date.now()}`,
        50, 50, 200,
        player.x,
        waterY
      );
      enemies.push(enemy);
      console.log(`Spawned boat ${enemy.username} at ${enemy.x},${enemy.y}`);
      sendNoticeMessage(player.username, `Spawned boat ${enemy.username}`, 'server');
    } else {
      sendNoticeMessage(player.username, `Unknown enemy type ${type}`, 'server');
    }
  } catch (err) {
    console.error('Failed to spawn enemy:', err);
    sendNoticeMessage(player.username, 'Failed to spawn enemy: ' + err.message, 'server');
  }
}

function checkCommand(command, player) {
  let match;
  // No Privilege Requirement
  let players_command = /^\/players$/;
  let parties_command = /^\/party\s(\w+)$/;
  let align_command = /^\/align$/;
  let privilege_command = /^\/Shluck$/;

  // Full Privilege Requirement
  let ep_command = /^\/ep\s(\d+(\.\d+)?)$/;
  let itemtest_command = /^\/itemtest\s+(\d+)(?:\s+(\d+))?$/;
  let weapontest_command = /^\/weapontest\s+(\d+)$/;
  let clearcrates_command = /^\/clearcrates$/;
  let tp_command = /^\/tp\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
  let tp_other_command = /^\/tp\s+"([^"]+)"\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
  let enemytest_command = /^\/enemytest\s+(\d+)$/;

  
  match = command.match(players_command);
  if (match) {
    sendNoticeMessage(player.username, players.map(player => player.username).join(", "), 'server');
  }

  match = command.match(parties_command);
  if (match) {
    const name = match[1];
    let party = parties.find(party => party.name === name);
    if (!party) {
      parties.push(new Party(name, player.username));
      party = parties.find(party => party.name === name);
      party.addPlayer(player);
      sendNoticeMessage(player.username, "Created and joined party " + name, 'server');
    } else {
      party.addPlayer(player);
      sendNoticeMessage(player.username, "Joined party " + name, 'server');
    }
  }

  match = command.match(align_command);
  if (match) {
    // Snap player angle to nearest 90-degree direction
    const currentAngle = normalizeAngle(player.angle);
    
    // Define the four cardinal directions in radians
    const directions = [
      { angle: 0, name: "right" },           // 0° - Right
      { angle: Math.PI / 2, name: "down" },  // 90° - Down  
      { angle: Math.PI, name: "left" },      // 180° - Left
      { angle: -Math.PI / 2, name: "up" }    // -90° - Up
    ];
    
    // Find the closest direction
    let closestDirection = directions[0];
    let smallestDiff = Math.abs(currentAngle - directions[0].angle);
    
    for (let dir of directions) {
      let diff = Math.abs(currentAngle - dir.angle);
      // Handle wraparound case (e.g., -179° vs 179°)
      if (diff > Math.PI) {
        diff = 2 * Math.PI - diff;
      }
      if (diff < smallestDiff) {
        smallestDiff = diff;
        closestDirection = dir;
      }
    }
    
    // Set player angle to the closest cardinal direction
    player.angle = closestDirection.angle;
    
    sendNoticeMessage(player.username, `Aligned to face ${closestDirection.name}`, 'game');
  }

  match = command.match(privilege_command);
  if (match) {
    try {
      sendNoticeMessage(player.username, "Command privileges enabled.", 'server');
      player.privileges = true;
    } catch (err) {
      console.error('Error enabling privileges for', player && player.username, err);
      // Avoid crashing the server; notify the admin if possible
      try {
        sendNoticeMessage(player.username, 'Failed to enable privileges: ' + (err && err.message), 'server');
      } catch (e) {
        console.error('Also failed to send failure notice:', e);
      }
    }
  }

  if (!player.privileges) return false;

  // Admin-only commands
  match = command.match(enemytest_command);
  if (match) {
    const type = parseInt(match[1]);
    if (typeof enemyTest === 'function') {
      enemyTest(player, type);
    } else {
      sendNoticeMessage(player.username, "enemyTest() not implemented.", 'server');
    }
    return true;
  }

  match = command.match(ep_command);
  if (match) {
    let value = parseFloat(match[1]);
    player.engine.maxPower = value;
    player.chassis.topSpeed = value ** 2;
    player.chassis.heatDispersion = value * player.engine.heatEfficiency;
    player.wings.maxSpeed = value ** 2;
    sendNoticeMessage(player.username, "Changed max engine power to " + value, 'server');
  }

  match = command.match(itemtest_command);
  if (match) {
    const manufacturer = parseInt(match[1]);
    const level = match[2] ? parseInt(match[2]) : 1; // Default to level 1 if not specified
    itemTest(manufacturer, level, player);
  }

  match = command.match(weapontest_command);
  if (match) {
    const weaponNumber = parseInt(match[1]);
    weaponTest(weaponNumber, player);
  }

  match = command.match(clearcrates_command);
  if (match) {
    // Clear all existing crates
    const crateCount = crates.length;
    crates.length = 0; // Clear the crates array
    
    // Respawn all crates
    generateMoneyCrates();
    generateStandardComponentCrates();
    
    sendNoticeMessage(player.username, `Cleared ${crateCount} crates and respawned all crates.`, 'server');
    sendNoticeMessageAll(`${player.username} cleared and respawned all crates.`, 'server');
  }

  match = command.match(tp_command);
  if (match) {
    match = command.match(tp_command);
  if (match) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    
    // Store current position for feedback
    const oldX = Math.round(player.x);
    const oldY = Math.round(player.y);
    
    // Teleport the player
    player.x = x;
    player.y = y;
    
    // Reset velocity to prevent momentum carrying over
    player.vx = 0;
    player.vy = 0;
    
    sendNoticeMessage(player.username, `Teleported from (${oldX}, ${oldY}) to (${Math.round(x)}, ${Math.round(y)})`, 'server');
  }

  match = command.match(tp_other_command);
  if (match) {
    const targetUsername = match[1];
    const x = parseFloat(match[2]);
    const y = parseFloat(match[3]);
    
    // Find the target player
    const targetPlayer = players.find(p => p.username === targetUsername);
    
    if (!targetPlayer) {
      sendNoticeMessage(player.username, `Player "${targetUsername}" not found.`, 'server');
      return;
    }
    
    // Store current position for feedback
    const oldX = Math.round(targetPlayer.x);
    const oldY = Math.round(targetPlayer.y);
    
    // Teleport the target player
    targetPlayer.x = x;
    targetPlayer.y = y;
    
    // Reset velocity to prevent momentum carrying over
    targetPlayer.vx = 0;
    targetPlayer.vy = 0;
    
    // Send feedback to both admin and target player
    sendNoticeMessage(player.username, `Teleported ${targetUsername} from (${oldX}, ${oldY}) to (${Math.round(x)}, ${Math.round(y)})`, 'server');
    sendNoticeMessage(targetUsername, `You were teleported to (${Math.round(x)}, ${Math.round(y)}) by ${player.username}`, 'server');
  }
  }
}

setInterval(() => {
  const now = millis();
  const inactivePlayers = players.filter(player => now - player.lastActivity >= INACTIVITY_THRESHOLD);
  
  // Properly kick each inactive player
  inactivePlayers.forEach(player => {
    console.log(`Kicking inactive player: ${player.username} (inactive for ${Math.round((now - player.lastActivity) / 1000)}s)`);
    
    // Send notification before kicking
    sendNoticeMessage(player.username, "You have been disconnected due to inactivity (10+ minutes)", 'urgent');
    
    // Close their WebSocket connection properly
    const playerSocket = playerSockets.get(player.username);
    if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
      playerSocket.close(1000, "Inactivity timeout");
    }
    
    // Clean up the socket reference
    playerSockets.delete(player.username);
  });
  
  // Remove inactive players from the array
  players = players.filter((player) => now - player.lastActivity < INACTIVITY_THRESHOLD);
}, 60000);

setInterval(() => { if (players.length > 0) updatePlayers() }, 10);
setInterval(() => { if (enemies.length > 0) updateEnemies() }, 10);
setInterval(() => { if (projectiles.length > 0 && players.length > 0) updateProjectiles() }, 10);
setInterval(() => { if (players.length > 0) updateCrates() }, 10);
setInterval(() => { if (players.length > 0) checkParties() }, 60000);