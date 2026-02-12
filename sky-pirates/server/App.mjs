import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import msgpack5 from 'msgpack5';
const msgpack = msgpack5();
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { MapObject } from './Map.mjs';
import { Player } from './Player.mjs';
import { NavySalvagePlane, NavySalvageBoat, EnemyPlane, DummyPlane } from './Enemy.mjs';
import { Animal, Bird, Fish } from './Animal.mjs';
import { Projectile, FireworkRocket, Fire } from './Projectile.mjs';
import { Crate } from './Crate.mjs';
import { GameEvent } from './GameEvent.mjs';
import { createEngine, createChassis, createWings } from './ComponentList.mjs';
import { Party } from './Party.mjs';
import { createEnemyGun, createGun, getRandomGunType } from './WeaponList.mjs';
import { Shop } from './Shop.mjs';
import { generatePlayerId, savePlayerState, savePlayerStateSync, loadPlayerState, deletePlayerState, playerStateExists } from './PlayerStateManager.mjs';
import { clientManager } from './ClientManager.mjs';
import { syncPlayerAchievements, getAchievementDataForClient } from './Achievements.mjs';
import { isMessageAppropriate } from './ChatFilter.mjs';

const TICK_RATE_MS = 20; // 50 Hz
const BASE_DT = TICK_RATE_MS / 1000; // 0.02
const admin_name = 'Shluck'

export const mapData = new MapObject();

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INACTIVITY_THRESHOLD = 10 * 60 * 1000;
const FLEET_SPAWN_COOLDOWN = 1 * 60 * 1000;
const FLEET_RESPAWN_DELAY_MS = 2 * 60 * 1000;
const MAX_FLEET_BOATS = 5;
const MIN_FLEET_DISTANCE = 30000;
const AUTOSAVE_INTERVAL = 5 * 60 * 1000;

// Animal Spawning Parameters
const FISH_DENSITY_PER_KM = 5; // Target number of fish per 1000m radius
const ANIMAL_SPAWN_RADIUS = 2000; // Radius around player to spawn/keep animals
const ANIMAL_SPAWN_INTERVAL = 1000; // Check for spawning every 1 second
let lastAnimalSpawnTime = 0;

let timeSpeed = 1;
let players = [];
let enemies = [];
let animals = [];
const playerSockets = new Map();
let parties = [];
let spatialGrid = new Map();
const GRID_CELL_SIZE = 1000;
let lastEnemySpawnTime = 0;
let enemySpawnRate = 500;
let projectiles = [];
let crates = [];
let events = [];

// Spatial Partitioning for High Performance
// Replaces naive O(N^2) loops with O(N) spatial queries
function rebuildSpatialGrid() {
    spatialGrid.clear();
    
    // Helper: Add entity to all grid cells it overlaps
    const addRectToGrid = (entity, type, radius) => {
        const minX = Math.floor((entity.x - radius) / GRID_CELL_SIZE);
        const maxX = Math.floor((entity.x + radius) / GRID_CELL_SIZE);
        const minY = Math.floor((entity.y - radius) / GRID_CELL_SIZE);
        const maxY = Math.floor((entity.y + radius) / GRID_CELL_SIZE);

        for (let x = minX; x <= maxX; x++) {
             for (let y = minY; y <= maxY; y++) {
                 const key = `${x},${y}`;
                 let cell = spatialGrid.get(key);
                 if (!cell) { cell = []; spatialGrid.set(key, cell); }
                 cell.push({ entity, type });
             }
        }
    };

    // Populate grid with potential targets
    for(const p of players) addRectToGrid(p, 'player', p.size || 20);
    for(const e of enemies) addRectToGrid(e, 'enemy', e.size || 20);
    for(const a of animals) {
        // Skip dead animals waiting for cleanup
        if (!a.dead) addRectToGrid(a, 'animal', a.size || 10);
    }
    
    // Add solid projectiles (rockets) that can be detonated
    for(const pr of projectiles) {
        if (!pr.markedForDeletion && pr.type !== 'bullet') {
             addRectToGrid(pr, 'projectile', pr.size || 5);
        }
    }
}

let crateScale = 10;
let max_money_crates = crateScale * 40;
let max_component_crates = crateScale * 10;
let max_weapon_crates = crateScale * 2.5;
let crateSpawnExclusionRadius = 1000;
let pendingRespawns = []; // Track players waiting to respawn with { player, respawnTime }
let lastFleetSpawnTime = 0;
let AUTO_SPAWN_FLEETS = true;
let fleetCounter = 1;
let lastFleetShipDestroyedAt = 0;

// Day/Night Cycle
const DAY_DURATION = 16 * 60 * 1000; // 16 minutes
const NIGHT_DURATION = 8 * 60 * 1000; // 8 minutes
const TOTAL_CYCLE_DURATION = DAY_DURATION + NIGHT_DURATION;
let cycleTime = 0; // Start at morning (beginning of day)


// Zone-based crate spawning for even distribution
const CRATE_ZONE_SIZE = 5000; // Each zone is 5km wide
let crateZoneDensity = new Map(); // Track crate count per zone

const shops = new Map();
const startMillis = Date.now();

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log('Initializing fleet boats...');
  for (let i = 0; i < 5; i++) {
    spawnFleetBoat();
  }
  console.log(`Initialized ${enemies.filter(e => e.isFleetBoat).length} fleet boats`);
});

// Avoid timeouts from Nginx/LoadBalancers by keeping the TCP connection alive longer
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const wss = new WebSocketServer({
  server,
  perMessageDeflate: { zlibDeflateOptions: { level: 9 } }
});

function millis() {
  return Date.now() - startMillis;
}

initializeShops();

// ========================================
// CORE UPDATE LOOPS
// ========================================

function updatePlayers() {
  players.forEach((player) => {
    checkPlayerBiome(player);
    updatePlayer(player);
    updateHull(player);
    player.updateNavyAggro(); // Check if navy aggro has timed out
    // Message cleanup moved to cleanupMessages() interval
  });
}

// Enemy plane update loop
function updateEnemies() {
  // Early exit if no players
  if (players.length === 0) return;

  enemies.forEach((enemy) => {
    checkPlayerBiome(enemy);

    // Always update all enemies regardless of distance
    updateEnemy(enemy, players);

    updateHull(enemy);
    // Message cleanup moved to cleanupMessages() interval
  });
}

function manageAnimalSpawning() {
  const now = Date.now();
  if (now - lastAnimalSpawnTime > ANIMAL_SPAWN_INTERVAL) {
    lastAnimalSpawnTime = now;

    players.forEach(player => {
      // Count fish near player
      let nearbyFish = 0;
      const rangeSq = ANIMAL_SPAWN_RADIUS * ANIMAL_SPAWN_RADIUS;

      for (const animal of animals) {
        if (animal.type === 'fish') {
          const dx = animal.x - player.x;
          const dy = animal.y - player.y;
          if (dx * dx + dy * dy <= rangeSq) {
            nearbyFish++;
          }
        }
      }

      // Calculate target (Density per 1000m of width)
      const targetFish = (ANIMAL_SPAWN_RADIUS * 2 / 1000) * FISH_DENSITY_PER_KM;

      if (nearbyFish < targetFish) {
        // Spawn up to 2 fish per check to avoid spikes
        const toSpawn = Math.min(targetFish - nearbyFish, 2);

        // Performance optimization: 
        // If player is high up (y < -500), they are likely >800 units from water surface.
        // In this case, we can spawn directly underneath (minDist = 0).
        // Otherwise, enforce horizontal off-screen buffer (minDist = 1200).
        const isHighAltitude = player.y < -200;
        const minSpawnDist = isHighAltitude ? 0 : 1200;
        const range = ANIMAL_SPAWN_RADIUS - minSpawnDist;

        for (let i = 0; i < toSpawn; i++) {
          // Deterministic single-pass generation
          const sign = Math.random() < 0.5 ? -1 : 1;
          const offset = sign * (minSpawnDist + Math.random() * range);
          const spawnX = player.x + offset;

          // Find water biome at this X
          const waterBiome = mapData.biomes.find(b =>
            b.type === 'water' &&
            spawnX >= b.x1 && spawnX <= b.x2
          );

          if (waterBiome) {
            // Spawn near surface (top 200 units)
            const maxDepth = Math.min(200, waterBiome.y2 - waterBiome.y1);
            const minDepth = 10;
            const actualMax = Math.max(minDepth, maxDepth);
            const depth = minDepth + Math.random() * (actualMax - minDepth);
            const spawnY = waterBiome.y1 + depth;

            // Only verifying distance slightly to ensure we don't spawn exactly on player if high altitude check was borderline
            // But generally trusting the minSpawnDist heuristic for performance
            const fish = new Fish(Date.now() + Math.random(), spawnX, spawnY);
            animals.push(fish);
          }
        }
      }
    });
  }
}

function updateAnimal(animal, deltaTime, threatGrid, gridSize) {
  animal.update(deltaTime, threatGrid, gridSize);
}

function updateAnimals() {
  const deltaTime = BASE_DT * timeSpeed;
  const despawnDistSq = ANIMAL_SPAWN_RADIUS * ANIMAL_SPAWN_RADIUS; // Precompute square

  manageAnimalSpawning();

  // Spatial Grid for efficient threat detection
  const GRID_CELL_SIZE = 500;
  const threatGrid = new Map();

  function addToGrid(entity) {
    const key = `${Math.floor(entity.x / GRID_CELL_SIZE)},${Math.floor(entity.y / GRID_CELL_SIZE)}`;
    let cell = threatGrid.get(key);
    if (!cell) {
        cell = [];
        threatGrid.set(key, cell);
    }
    cell.push(entity);
  }

  // Only rebuild grid if we have animals to update
  if (animals.length > 0) {
      for (let i = 0; i < players.length; i++) addToGrid(players[i]);
      for (let i = 0; i < projectiles.length; i++) addToGrid(projectiles[i]);
  }

  // Iterate backwards to allow safe removal (splice)
  for (let i = animals.length - 1; i >= 0; i--) {
    const animal = animals[i];
    
    // 1. Check bounds for fish (INSTANT KILL)
    if (animal.type === 'fish') {
      if (animal.x < -mapData.sizeX || animal.x > mapData.sizeX ||
        animal.y > mapData.oceanDepth || animal.y < -mapData.skyHeight) {
        animals.splice(i, 1);
        continue;
      }
    }

    // 2. Check if animal is within range of ANY player
    // Optimization: Check squared distance, avoid Math.sqrt
    let isNearPlayer = false;
    for (let j = 0; j < players.length; j++) {
        const player = players[j];
        const dx = animal.x - player.x;
        const dy = animal.y - player.y;
        if ((dx * dx + dy * dy) <= despawnDistSq) {
            isNearPlayer = true;
            break;
        }
    }

    if (!isNearPlayer) {
      animals.splice(i, 1);
      continue;
    }

    // Update logic
    animal.update(deltaTime, threatGrid, GRID_CELL_SIZE);
  }
}

function updateFleets() {
  if (players.length === 0) return;

  const now = Date.now();

  // Create a quick lookup set for O(1) checks
  const enemySet = new Set(enemies);

  if (AUTO_SPAWN_FLEETS) {
    const fleetBoats = enemies.filter(e => e.isFleetBoat);
    if (lastFleetShipDestroyedAt && (now - lastFleetShipDestroyedAt) < FLEET_RESPAWN_DELAY_MS) {
      // Waiting for respawn delay
    } else {
      if (lastFleetShipDestroyedAt && (now - lastFleetShipDestroyedAt) >= FLEET_RESPAWN_DELAY_MS) {
        lastFleetShipDestroyedAt = 0;
        lastFleetSpawnTime = now - FLEET_SPAWN_COOLDOWN;
        console.log('Fleet respawn pause ended - beginning staggered refill');
      }
      if (fleetBoats.length < MAX_FLEET_BOATS && now - lastFleetSpawnTime > FLEET_SPAWN_COOLDOWN) {
        console.time('FleetSpawn');
        if (spawnFleetBoat()) {
           lastFleetSpawnTime = now;
           console.log('Spawned fleet boat');
        }
        console.timeEnd('FleetSpawn');
      }
    }

    // Check if any fleet boats need to respawn missing planes
    fleetBoats.forEach(boat => {
      checkAndRespawnFleetPlanes(boat, now, enemySet);
    });
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (enemy.type && enemy.type.includes('Plane') && enemy.faction === 'navy' && enemy.fleetBoat) {
      // Use Set for O(1) lookup instead of O(N) array scan
      const boatStillExists = enemySet.has(enemy.fleetBoat);
      if (!boatStillExists) {
        // console.log(`Plane ${enemy.username} lost its fleet boat, becoming independent`);
        enemy.fleetBoat = null;
      }
    }
  }
}

function checkAndRespawnFleetPlanes(boat, now, enemySet) {
  if (!boat || !boat.isFleetBoat || !boat.planeLevels || boat.planeLevels.length === 0) return;

  // Count current planes (filter out any that might have been destroyed but still in array)
  // Use enemySet if provided for O(1) checks, otherwise fall back to linear scan
  if (enemySet) {
    boat.planes = boat.planes.filter(p => enemySet.has(p));
  } else {
    boat.planes = boat.planes.filter(p => enemies.includes(p));
  }

  const currentPlaneCount = boat.planes.length;
  const expectedPlaneCount = boat.planeLevels.length;

  // If missing planes and enough time has passed since last destruction
  if (currentPlaneCount < expectedPlaneCount) {
    if (boat.lastPlaneDestroyedAt && (now - boat.lastPlaneDestroyedAt) >= boat.planeRespawnDelay) {
      const missingCount = expectedPlaneCount - currentPlaneCount;

      // Determine which plane levels to respawn (the ones that are missing)
      const existingLevels = boat.planes.map(p => p.level);
      const levelsToSpawn = [];

      for (let i = 0; i < boat.planeLevels.length && levelsToSpawn.length < missingCount; i++) {
        const level = boat.planeLevels[i];
        const indexInExisting = existingLevels.indexOf(level);
        if (indexInExisting === -1) {
          levelsToSpawn.push(level);
        } else {
          // Remove from existing so we don't match the same plane twice
          existingLevels.splice(indexInExisting, 1);
        }
      }

      // Spawn the missing planes
      if (levelsToSpawn.length > 0) {
        const newPlanes = boat.spawnPlanes(levelsToSpawn);
        enemies.push(...newPlanes);
        console.log(`Fleet boat ${boat.username} respawned ${newPlanes.length} missing planes (levels: ${levelsToSpawn.join(', ')})`);
        // Reset the timer
        boat.lastPlaneDestroyedAt = 0;
      }
    }
  }
}

function updateEnemy(enemy) {
  if (enemy.isDummy) return;

  if (enemy instanceof NavySalvagePlane) {
    enemy.updateAI(players, crates, enemies);
  } else {
    enemy.updateAI(players);
  }

  if (enemy instanceof EnemyPlane) {
    updatePlane(enemy);
  } else if (enemy instanceof NavySalvageBoat) {
    updateBoat(enemy);
  }

  if (enemy.biome === 'recovery') {
    handleDeath(enemy);
  }
}

function updatePlayer(player) {
  updatePlane(player);
  checkSpawnEnemyPlane(player);
  const deltaTime = BASE_DT * timeSpeed;

  // Map Boundary Check - 10 Second Death Logic
  const boundaryX = mapData.sizeX;
  const boundarySky = -mapData.skyHeight;
  const boundarySea = mapData.oceanDepth;
  
  // Check if outside: Right, Left, Top, Bottom
  // Note: Y is negative up (likely), skyHeight is positive in mapData but map polygon uses -skyHeight
  // Checking Map.mjs: { x: -this.sizeX, y: -this.skyHeight } to { x: this.sizeX, y: this.oceanDepth }
  const isOutside = (player.x > boundaryX) || (player.x < -boundaryX) ||
                    (player.y < boundarySky) || (player.y > boundarySea);

  if (isOutside) {
      if (!player.outOfBoundsSnapshot) {
          // Check hull on chassis first if it exists, otherwise fall back to player.hull
          const currentHull = (player.chassis && typeof player.chassis.hull === 'number') ? player.chassis.hull : player.hull;
          
          player.outOfBoundsSnapshot = currentHull;
          // Send warning - logic depends on snapshot being null initially
          sendNoticeMessage(player.username, "WARNING: Leaving Playable Area! Taking Hull Damage!", 'urgent');
      }
      
      const damageTick = (player.outOfBoundsSnapshot / 10) * deltaTime;
      
      // Apply damage to correct property
      if (player.chassis && typeof player.chassis.hull === 'number') {
          if (player.chassis.hull > 0) {
              player.chassis.hull -= damageTick;
              if (player.chassis.hull < 0) player.chassis.hull = 0;
          }
          // Check death
          if (player.chassis.hull <= 0) {
              player.chassis.hull = 0;
              handleDeath(player); 
          }
      } else {
          // Fallback if hull is on player object
          if (player.hull > 0) {
              player.hull -= damageTick;
              if (player.hull < 0) player.hull = 0;
          }
           if (player.hull <= 0) {
              player.hull = 0;
              handleDeath(player); 
          }
      }
      
  } else {
      if (player.outOfBoundsSnapshot) {
          player.outOfBoundsSnapshot = null;
          sendNoticeMessage(player.username, "Back in Playable Area.", 'game');
      }
  }

  if (player.biome === 'recovery') {
    // 1. Auto-Open Crates
    if (player.crates.length > 0) {
      const cratesToOpen = [...player.crates];
      let moneyGained = 0;
      let itemsGained = 0;

      cratesToOpen.forEach(crate => {
        if (crate.type === 'money') {
             moneyGained += parseInt(crate.cargo, 10);
        } else {
             itemsGained++;
        }
        
        handleCrateCollection(crate, player, true); // Batch mode = true
      });

      // Cleanup global crates list
      crates = crates.filter(c => !c.removedFromWorld);
      
      // Notify player
      if (moneyGained > 0 && itemsGained > 0) {
          sendNoticeMessage(player.username, `Secured ${moneyGained} coins and ${itemsGained} items!`, 'pickup');
      } else if (moneyGained > 0) {
          sendNoticeMessage(player.username, `Secured ${moneyGained} coins!`, 'pickup');
      } else if (itemsGained > 0) {
          sendNoticeMessage(player.username, `Secured ${itemsGained} items!`, 'pickup');
      }
    }

    // 2. Autosave on Entry (after crates are processed)
    if (!player.hasAutoSavedInRecovery) {
      savePlayerState(player.playerId, player);
      if (player.clientId) {
        clientManager.saveClient(player.clientId);
      }
      sendNoticeMessage(player.username, "Progress Saved", 'game');
      player.hasAutoSavedInRecovery = true;
    }

    applyRecoveryJello(player, deltaTime);

    const currentRecoveryZone = mapData.getRecoveryZoneAtPosition(player.x, player.y);
    const twinZone = currentRecoveryZone ? mapData.getTwinRecoveryZone(currentRecoveryZone) : null;

    player.currentRecoveryZone = currentRecoveryZone;
    player.twinRecoveryZone = twinZone;
    // Remember the last recovery zone we've been in so we can respawn there on death
    if (currentRecoveryZone) player.lastRecoveryZone = currentRecoveryZone;

    if (player.navyTargeted) {
      player.navyTargeted = false;
      player.navyActivityTime = 0;
    }

    if (player.inventory.length > 0 && !player.browsing) {
      player.browsing = true;
    }
  } else {
    player.hasAutoSavedInRecovery = false;
    
    if (player.browsing) {
      player.browsing = false;
      player.currentRecoveryZone = null;
      player.twinRecoveryZone = null;
      // Items remain in inventory until explicitly sold
    }
  }

}

function updatePlane(plane) {
  if (!validatePlaneCoordinates(plane)) return;
  const deltaTime = BASE_DT * timeSpeed;
  const speed = getSpeed(plane);

  // Stats Tracking (only for Player instances)
  if (plane.playerId) { // Simple check if it's a Player
       // Top Speed
       if (plane.achievements && plane.achievements['top_speed']) {
           // Do not track top speed in recovery zones (boosted speed)
           if (plane.biome !== 'recovery') {
               const updateUI = plane.achievements['top_speed'].increment(plane, speed);
               if (updateUI) sendPlayerAchievements(plane);
           }
       }
       
       // Distance Travelled
       if (plane.achievements && plane.achievements['distance_flown']) {
           // Calculate distance moved this frame (ignoring teleport jumps)
           // Use lastX/lastY to measure
           if (typeof plane.lastX !== 'undefined' && typeof plane.lastY !== 'undefined') {
               const dx = plane.x - plane.lastX;
               const dy = plane.y - plane.lastY;
               const distSq = dx*dx + dy*dy;
               
               // Threshold to ignore teleports (e.g. > 500 units/frame is likely a teleport/respawn)
               if (distSq < 250000 && distSq > 0) {
                   const dist = Math.sqrt(distSq);
                   // Assuming 1 unit = 1 meter for simplicity
                   const updateUI = plane.achievements['distance_flown'].increment(plane, dist);
                   if (updateUI) sendPlayerAchievements(plane);
               }
           }
           plane.lastX = plane.x;
           plane.lastY = plane.y;
       }
  }

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
  applyPlayerGravity(plane, deltaTime);
  applyPlayerDrag(plane, deltaTime);
  updatePosition(plane);
}

// Update a single enemy boat (AI controlled)
function updateBoat(boat) {
  const deltaTime = BASE_DT * timeSpeed;

  if (boat.target) {
    updateGuns(boat, deltaTime);
    checkPlayerShooting(boat);
  } else {
    const hasPassiveAim = typeof boat.t_x === 'number' && typeof boat.t_y === 'number' &&
      (boat.t_x !== boat.x || boat.t_y !== boat.y);
    if (hasPassiveAim) {
      updateGuns(boat, deltaTime);
    } else {
      if (boat.gun1) {
        updateGunCooldown(boat.gun1, deltaTime);
        updateGunHeat(boat, boat.gun1, deltaTime);
      }
      if (boat.gun2) {
        updateGunCooldown(boat.gun2, deltaTime);
        updateGunHeat(boat, boat.gun2, deltaTime);
      }
    }
  }
}

function updateProjectiles() {
  projectiles.forEach((projectile) => {
    updateProjectile(projectile);
  });
  // Batch removal at end of frame
  if (projectiles.some(p => p.markedForDeletion)) {
      projectiles = projectiles.filter(p => !p.markedForDeletion);
  }
}

function handleProjectileExplosion(projectile) {
  if (projectile.markedForDeletion) return;
  projectile.markedForDeletion = true;

  if (typeof projectile.onExpire === 'function') {
    const newProjectiles = projectile.onExpire();
    if (newProjectiles && newProjectiles.length > 0) {
      projectiles.push(...newProjectiles);
    }
  }
}

function updateProjectile(projectile) {
  if (projectile.markedForDeletion) return;

  const deltaTime = BASE_DT * timeSpeed;
  if (mapData.getBiomeAtPosition(projectile.x, projectile.y) === 'recovery') {
    projectile.markedForDeletion = true;
    return;
  }
  
  const age = Date.now() - (projectile.creationTime || 0);
  const expiredByTime = age >= (projectile.lifetime || 5000);
  const expiredByDistance = projectile.distanceTraveled >= projectile.maxDistance;

  if (expiredByDistance || expiredByTime) {
    handleProjectileExplosion(projectile);
    return;
  }

  const prevX = projectile.x;
  const prevY = projectile.y;

  projectile.x += projectile.vx * deltaTime;
  projectile.y += projectile.vy * deltaTime;

  // Track distance traveled
  const dx = projectile.x - prevX;
  const dy = projectile.y - prevY;
  projectile.distanceTraveled += Math.sqrt(dx * dx + dy * dy);

  projectile.biome = mapData.getBiomeAtPosition(projectile.x, projectile.y);

  if (projectile.biome === 'water' && (projectile.type === 'fire' || projectile.type === 'fireworks_fire')) {
    projectile.markedForDeletion = true;
    return;
  }
  
  // ----------------------------------------------------------------
  // SPATIAL GRID COLLISION DETECTION (Optimized O(N))
  // ----------------------------------------------------------------
  
  // Skip collision checks if damageDelay active
  if (age < (projectile.damageDelay || 0)) return;

  const cx = Math.floor(projectile.x / GRID_CELL_SIZE);
  const cy = Math.floor(projectile.y / GRID_CELL_SIZE);
  // Check previous cell too to catch high-speed crossings
  const prevCx = Math.floor(prevX / GRID_CELL_SIZE);
  const prevCy = Math.floor(prevY / GRID_CELL_SIZE);

  const potentialColliders = new Set();
  
  const collectFromCell = (key) => {
      const cell = spatialGrid.get(key);
      if (cell) {
          for (let i = 0; i < cell.length; i++) potentialColliders.add(cell[i]);
      }
  };
  
  collectFromCell(`${cx},${cy}`);
  if (cx !== prevCx || cy !== prevCy) collectFromCell(`${prevCx},${prevCy}`);

  for (const entry of potentialColliders) {
      if (projectile.markedForDeletion) break;
      const { entity, type } = entry;
      
      if (entity === projectile) continue;
      if (entity.markedForDeletion || (type === 'animal' && entity.dead)) continue;
      
      // Friendly Fire Check
      if (entity.username === projectile.owner) continue;
      if (type === 'projectile' && entity.owner === projectile.owner && (entity.type === 'fire' || entity.type === 'fireworks_fire')) continue;
      if (type === 'enemy' && enemies.some(e => e.username === projectile.owner)) continue; // Enemy hits enemy

      // Bounding Box Pre-Check (Cheap)
      const contactDist = (entity.size || 20) + (projectile.size || 5) + 5;
      if (Math.abs(entity.x - projectile.x) > contactDist || Math.abs(entity.y - projectile.y) > contactDist) continue;

      // Type-Specific Handlers
      if (type === 'player' || type === 'enemy') {
          if (checkSweptCollision(prevX, prevY, projectile.x, projectile.y, projectile.size, entity.x, entity.y, entity.size)) {
              handleEntityHit(projectile, entity, type);
          }
      } else if (type === 'animal') {
          if (checkSweptCollision(prevX, prevY, projectile.x, projectile.y, projectile.size, entity.x, entity.y, entity.size)) {
              handleAnimalHit(projectile, entity);
          }
      } else if (type === 'projectile') {
          // Only solid projectiles collide with other projectiles
          const isSolid = ['bullet', 'rocket', 'firework_rocket'].includes(projectile.type);
          if (isSolid && checkSweptCollision(prevX, prevY, projectile.x, projectile.y, projectile.size, entity.x, entity.y, entity.size)) {
               handleProjectileVsProjectile(projectile, entity);
          }
      }
  }
}

function handleEntityHit(projectile, entity, type) {
      createHitEvent(entity.x, entity.y, projectile);
      
      // Pacifist Logic
      if (projectile.owner) {
          const ownerPlayer = players.find(p => p.username === projectile.owner);
          if (ownerPlayer) ownerPlayer.pacifist = false;
          
          // Sharpshooter
          if (ownerPlayer && projectile.distanceTraveled > 1250) {
              if (ownerPlayer.achievements && ownerPlayer.achievements['sharpshooter']) {
                  ownerPlayer.achievements['sharpshooter'].complete(ownerPlayer);
              }
          }
      }

      if (entity.onDamaged) {
          // entity is Player or Enemy
          entity.onDamaged(projectile, players); 
      }

      if (typeof projectile.onExpire === 'function') {
        const newProjectiles = projectile.onExpire();
        if (newProjectiles && newProjectiles.length > 0) projectiles.push(...newProjectiles);
      }

      if (projectile.piercing > 0) {
          projectile.piercing--;
          projectile.hitEntities = projectile.hitEntities || [];
          projectile.hitEntities.push(entity.id || entity.username);
      } else {
        projectile.markedForDeletion = true;
      }
}

function handleAnimalHit(projectile, animal) {
      if (projectile.owner) {
          const killer = players.find(p => p.username === projectile.owner);
          if (killer && killer.achievements) {
              const animalInWater = mapData.getBiomeAtPosition(animal.x, animal.y) === 'water';
              if (killer.achievements['fish_killer'] && animal.type === 'fish') killer.achievements['fish_killer'].increment(killer, 1);
              
              if (animal.type === 'fish' && !animalInWater) {
                  if (killer.achievements['sky_angler']) killer.achievements['sky_angler'].complete(killer);
                  if ((projectile.fireDamage > 0 || projectile.type === 'fire') && killer.achievements['barbecue']) killer.achievements['barbecue'].complete(killer);
                  
                  projectile.midairFishHitCount = (projectile.midairFishHitCount || 0) + 1;
                  if (projectile.midairFishHitCount >= 2 && killer.achievements['two_birds']) killer.achievements['two_birds'].complete(killer);
              }
          }
      }

      const velocity = Math.sqrt(projectile.vx**2 + projectile.vy**2);
      events.push(new GameEvent('animal_explosion', animal.x, animal.y, projectile.angle, velocity));

      // Mark animal dead instead of filtering list (handled in rebuild next frame or updateAnimals)
      animal.dead = true; 
      animals = animals.filter(a => !a.dead); // Keep immediate cleanup for now to match old behavior
      
      if (projectile.piercing > 0) projectile.piercing--;
      else projectile.markedForDeletion = true;
}

function handleProjectileVsProjectile(projectile, other) {
   // Hitting a Firework Rocket -> Activate it
   if (other.type === 'firework_rocket') {
       if (projectile.owner) {
            const shooter = players.find(p => p.username === projectile.owner);
            if (shooter && shooter.achievements && shooter.achievements['fireworks']) {
                shooter.achievements['fireworks'].complete(shooter);
            }
       }
       handleProjectileExplosion(other);
       handleProjectileExplosion(projectile);
       return;
   }
   // Hitting Fire -> Destroy Fire
   if (other.type === 'fire' || other.type === 'fireworks_fire') {
       handleProjectileExplosion(other);
       handleProjectileExplosion(projectile);
   }
}

function createHitEvent(x, y, projectile) {
  const velocity = Math.sqrt(projectile.vx * projectile.vx + projectile.vy * projectile.vy);
  const event = new GameEvent('hit', x, y, projectile.angle, velocity);
  events.push(event);
}

function createGunshotEvent(x, y, angle, projectileSpeed, projectileSize) {
  const event = new GameEvent('gunshot', x, y, angle, projectileSpeed, projectileSize);
  events.push(event);
}

function createExplosionEvent(x, y, size = 1) {
  const event = new GameEvent('explosion', x, y, 0, size);
  events.push(event);
}

function updateEvents() {
  const now = Date.now();
  const EVENT_LIFETIME = 5000;
  events = events.filter(event => now - event.timestamp < EVENT_LIFETIME);
}

function updateShops() {
  const now = Date.now();
  shops.forEach((shop, zoneId) => {
    const wasRefreshed = shop.checkAndRefresh(now);
  });
}

let lastCrateGenTime = 0;

function updateCrates() {
  const now = Date.now();
  if (now - lastCrateGenTime > 1000) {
    lastCrateGenTime = now;
    generateMoneyCrates();
    generateStandardComponentCrates();
    generateWeaponCrates();
  }

  // Optimize carrier lookup with a Map
  const entityMap = new Map();
  for (const p of players) entityMap.set(p.username, p);
  for (const e of enemies) entityMap.set(e.username, e);

  crates.forEach((crate) => {
    updateCrate(crate, entityMap);
  });
}

// Helper function to get zone ID from x coordinate
function getZoneId(x) {
  return Math.floor(x / CRATE_ZONE_SIZE);
}

// Update zone density map based on current crates
function updateZoneDensity() {
  crateZoneDensity.clear();

  for (const crate of crates) {
    const zoneId = getZoneId(crate.x);
    crateZoneDensity.set(zoneId, (crateZoneDensity.get(zoneId) || 0) + 1);
  }
}

// Find the zone with lowest crate density that's outside exclusion zone
function findLowestDensityZone() {
  // Note: updateZoneDensity() should be called BEFORE this function
  // to avoid recalculating density for every crate spawn

  // Find all zones within map bounds
  const minZone = getZoneId(-mapData.sizeX);
  const maxZone = getZoneId(mapData.sizeX);

  let lowestDensity = Infinity;
  let lowestZones = [];

  for (let zoneId = minZone; zoneId <= maxZone; zoneId++) {
    // Skip zones that are entirely within the exclusion radius
    const zoneStart = zoneId * CRATE_ZONE_SIZE;
    const zoneEnd = (zoneId + 1) * CRATE_ZONE_SIZE;

    // Check if zone overlaps with exclusion area (-1000 to +1000)
    // Only skip if the ENTIRE zone is within exclusion radius
    if (zoneStart >= -crateSpawnExclusionRadius && zoneEnd <= crateSpawnExclusionRadius) {
      continue;
    }

    // Skip zones that have no valid space within map bounds
    const clampedMinX = Math.max(zoneStart, -mapData.sizeX);
    const clampedMaxX = Math.min(zoneEnd, mapData.sizeX);
    if (clampedMinX >= clampedMaxX) {
      continue; // Zone extends beyond map bounds with no valid space
    }

    const density = crateZoneDensity.get(zoneId) || 0;

    if (density < lowestDensity) {
      lowestDensity = density;
      lowestZones = [zoneId];
    } else if (density === lowestDensity) {
      lowestZones.push(zoneId);
    }
  }

  // Return a random zone from those with lowest density
  return lowestZones[Math.floor(Math.random() * lowestZones.length)];
}

// Get a random x position within a zone
function getRandomXInZone(zoneId) {
  const zoneStart = zoneId * CRATE_ZONE_SIZE;
  const zoneEnd = (zoneId + 1) * CRATE_ZONE_SIZE;

  // Clamp to map bounds
  let minX = Math.max(zoneStart, -mapData.sizeX);
  let maxX = Math.min(zoneEnd, mapData.sizeX);

  // If this zone overlaps with exclusion area, avoid the exclusion zone
  if (minX < crateSpawnExclusionRadius && maxX > -crateSpawnExclusionRadius) {
    // Zone spans the exclusion area - pick a side
    if (Math.abs(minX) > Math.abs(maxX - crateSpawnExclusionRadius)) {
      // More space on left side
      maxX = -crateSpawnExclusionRadius;
    } else {
      // More space on right side
      minX = crateSpawnExclusionRadius;
    }
  }

  // Add buffer from exact boundaries to prevent edge clustering (BEFORE range check)
  const initialRange = maxX - minX;
  const buffer = Math.min(100, initialRange * 0.05); // 5% buffer or 100 units, whichever is smaller
  minX += buffer;
  maxX -= buffer;

  // Ensure we have valid range after applying buffer
  const finalRange = maxX - minX;
  if (finalRange <= 0) {
    return null; // Signal that this zone is invalid
  }

  return minX + Math.random() * (maxX - minX);
}

function handleCarriedCratePhysics(crate, carrier, deltaTime) {
  const ROPE_LENGTH = 5;
  const TELEPORT_THRESHOLD = 3000;
  const springStrength = 32;

  const ropeAngle = carrier.angle + Math.PI;
  const targetX = carrier.x + Math.cos(ropeAngle) * ROPE_LENGTH;
  const targetY = carrier.y + Math.sin(ropeAngle) * ROPE_LENGTH;

  const deltaX = targetX - crate.x;
  const deltaY = targetY - crate.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (distance > TELEPORT_THRESHOLD) {
    crate.x = crate.x + deltaX * 0.5;
    crate.y = crate.y + deltaY * 0.5;
    crate.vx = 0;
    crate.vy = 0;
  } else {
    crate.vx += deltaX * springStrength * deltaTime;
    crate.vy += deltaY * springStrength * deltaTime;
  }

  applyCrateDrag(crate, 1.0, deltaTime);
  applyCrateBuoyancy(crate, null);

  // Optimization: Reuse previously calculated distance (distanceToTarget is identical to distance)
  let dampingFactor = 0.8;
  if (distance > 1000) {
    dampingFactor -= Math.min(0.3, distance / 50000);
  }

  crate.vx *= dampingFactor;
  crate.vy *= dampingFactor;

  const maxVelocity = Math.min(5000, 200 + (distance * 0.3));
  const speed = Math.sqrt(crate.vx * crate.vx + crate.vy * crate.vy);
  if (speed > maxVelocity) {
    const scale = maxVelocity / speed;
    crate.vx *= scale;
    crate.vy *= scale;
  }

  updateCratePosition(crate, deltaTime);
}

function handleFreeCratePhysics(crate, deltaTime) {
  let fluidDensity = 1.0;
  let biomeType = null;

  for (let i = 0; i < mapData.biomes.length; i++) {
    const biome = mapData.biomes[i];
    if (biome.x1 <= crate.x && crate.x <= biome.x2 && biome.y1 <= crate.y && crate.y <= biome.y2) {
      biomeType = biome.type;
      if (biome.type === 'water') fluidDensity = 20.0;
      break;
    }
  }

  applyCrateDrag(crate, fluidDensity, deltaTime);
  applyCrateBuoyancy(crate, biomeType);
  updateCratePosition(crate, deltaTime);
}

function applyCrateRepulsion(crate, allCrates, deltaTime, entityMap) {
  const REPULSION_RADIUS = crate.size * 2;
  const REPULSION_STRENGTH = 12;
  const CHECK_RADIUS = REPULSION_RADIUS * 3; // Check slightly larger area

  let cratesToCheck = [];

  if (crate.carrier) {
    // Optimization: Look up carrier directly instead of searching allCrates
    let carrier = null;
    if (entityMap) {
      carrier = entityMap.get(crate.carrier);
    } else {
       carrier = players.find(p => p.username === crate.carrier) || enemies.find(e => e.username === crate.carrier);
    }

    // Only check against other crates in the same carrier's inventory
    // This reduces checks from O(TotalCrates) to O(CarriedCrates), effectively O(1)
    if (carrier && carrier.crates) {
        const myIndex = carrier.crates.indexOf(crate);
        if (myIndex !== -1) {
            // Only check crates after this one in the carrier's list to avoid double physics application
            cratesToCheck = carrier.crates.slice(myIndex + 1);
        }
    }
  } else {
    // Legacy logic for free-floating crates (checks against all other free/carried crates)
    const crateIndex = allCrates.indexOf(crate);
    if (crateIndex !== -1) {
        cratesToCheck = allCrates.slice(crateIndex + 1);
    }
  }

  cratesToCheck.forEach(otherCrate => {
    const dx = crate.x - otherCrate.x;
    const dy = crate.y - otherCrate.y;

    // Quick distance check before expensive sqrt
    const distanceSquared = dx * dx + dy * dy;
    const checkRadiusSquared = CHECK_RADIUS * CHECK_RADIUS;

    // Skip if crates are too far apart
    if (distanceSquared > checkRadiusSquared) return;

    const distance = Math.sqrt(distanceSquared);

    if (distance < REPULSION_RADIUS && distance > 0.01) {
      const nx = dx / distance;
      const ny = dy / distance;
      const force = REPULSION_STRENGTH * (REPULSION_RADIUS - distance) / REPULSION_RADIUS;
      crate.x += nx * force * deltaTime;
      crate.y += ny * force * deltaTime;
      otherCrate.x -= nx * force * deltaTime;
      otherCrate.y -= ny * force * deltaTime;
    }
  });
}

// Helper for consistency in crate opening
function handleCrateCollection(crate, player, batchMode = false) {
  crate.open(player);
  crate.removedFromWorld = true;

  // In batch mode, we don't send individual messages or filter immediately
  if (!batchMode) {
    if (crate.type === 'money') {
      sendNoticeMessage(player.username, `+$${crate.cargo}!`, 'pickup');
    } else if (crate.type === 'component' || crate.type === 'weapon') {
      sendNoticeMessage(player.username, `Picked up ${crate.cargo.name}`, 'pickup');
    }
    // Immediate cleanup for single crate
    crates = crates.filter((c) => c !== crate);
  }
}

function updateCrate(crate, entityMap) {
  if (!crate.type) {
    crate.removedFromWorld = true;
    crates = crates.filter((c) => c !== crate);
    return;
  }

  const deltaTime = BASE_DT * timeSpeed;
  let carrier = null;
  let player = null;

  if (crate.carrier) {
    if (entityMap) {
      carrier = entityMap.get(crate.carrier);
    } else {
      carrier = players.find(p => p.username === crate.carrier) || enemies.find(e => e.username === crate.carrier);
    }
    // Check if carrier is a player (using type check or property)
    if (carrier && players.includes(carrier)) {
       player = carrier;
    }
  }

  if (crate.carrier) {
    if (!carrier) {
      crate.detach();
      return;
    }

    if (player && mapData.getBiomeAtPosition(crate.x, crate.y) === 'recovery') {
      handleCrateCollection(crate, player, false);
      return;
    }

    handleCarriedCratePhysics(crate, carrier, deltaTime);
  } else {
    handleFreeCratePhysics(crate, deltaTime);
  }

  applyCrateRepulsion(crate, crates, deltaTime, entityMap);

  players.forEach((new_player) => {
    if (new_player.crates.length >= new_player.maxCrates) return;
    const dx = new_player.x - crate.x;
    const dy = new_player.y - crate.y;
    // Optimization: Squared distance check to avoid Sqrt
    const distSq = dx * dx + dy * dy;
    const attach_radius = 2 * (new_player.size + crate.size + 5); 
    const attach_radius_sq = attach_radius * attach_radius;
    
    if (distSq <= attach_radius_sq && new_player.username !== crate.carrier) {
      // If crate is currently carried by someone, detach it from them first
      if (crate.carrier) {
        let previousCarrier = null;
        if(entityMap) {
            previousCarrier = entityMap.get(crate.carrier);
        } else {
             previousCarrier = players.find(p => p.username === crate.carrier) ||
          enemies.find(e => e.username === crate.carrier);
        }

        if (previousCarrier && previousCarrier.detachCrate) {
          previousCarrier.detachCrate(crate);
        }
      }
      // Now attach to new player
      new_player.attachCrate(crate);
    }
  });
  
  // Optimization: Skip enemy pickup loops if crate is already carried (enemies don't steal)
  if (crate.carrier) return;

  // --- Enemy interactions: first handle plane attachments deterministically ---
  const DEFAULT_PLANE_PICKUP = 60;
  const DEFAULT_PLANE_PICKUP_SQ = DEFAULT_PLANE_PICKUP * DEFAULT_PLANE_PICKUP;
  
  let nearestPlane = null;
  let nearestPlaneDistSq = Infinity;
  for (const e of enemies) {
    if (!e) continue;
    if (e.type && e.type.includes('Plane') && e.faction === 'navy') {
      const dx = e.x - crate.x;
      const dy = e.y - crate.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= DEFAULT_PLANE_PICKUP_SQ && d2 < nearestPlaneDistSq) {
        nearestPlane = e;
        nearestPlaneDistSq = d2;
      }
    }
  }

  if (nearestPlane) {
    // Attempt attach (Enemy.attachCrate will also defensively refuse if crate.carrier is set)
    nearestPlane.attachCrate(crate);
  }

  // --- Then handle boat pickups (boats only take unattached crates) ---
  for (const enemy of enemies) {
    if (!enemy) continue;
    if (enemy.isFleetBoat && typeof enemy.storeCrate === 'function') {
      const dxB = enemy.x - crate.x;
      const dyB = enemy.y - crate.y;
      // Optimization: Squared distance check
      const distSq = dxB * dxB + dyB * dyB;
      const DEFAULT_PICKUP_RADIUS = 100;
      const pickupRadius = Math.max(DEFAULT_PICKUP_RADIUS, 2 * (enemy.size + crate.size + 10));
      const pickupRadiusSq = pickupRadius * pickupRadius;
      
      if (distSq <= pickupRadiusSq && crate.carrier !== enemy.username) {
        if (!crate.carrier) {
          // Prevent immediate pickup of crates that were just detached (race condition)
          const PICKUP_COOLDOWN_MS = 500; // ignore crates detached within this many ms
          const nowMs = Date.now();
          if (crate.lastDetachedAt && (nowMs - crate.lastDetachedAt) < PICKUP_COOLDOWN_MS) {
            // Skip this crate for now
            continue;
          }
          try {
            enemy.storeCrate(crate);
          } catch (err) {
            console.error('Error storing crate in boat inventory', err);
          }
          crate.removedFromWorld = true;
          crates = crates.filter(c => c !== crate);
        }
      }
    }
  }
}

function generateMoneyCrates() {
  const crate_count = max_money_crates - crates.filter(c => c.type === 'money').length;

  if (players.length === 0 || crates.length > max_money_crates) return;

  // Update zone density ONCE before spawning all crates
  updateZoneDensity();

  // Map boundaries
  const seaLevel = 300; // Top of water biome from your map definition

  for (let i = 0; i < crate_count; i++) {
    // Find zone with lowest density for even distribution
    const targetZone = findLowestDensityZone();
    if (targetZone === undefined) {
      console.warn("No valid zone found for crate spawning");
      continue;
    }

    // Get random position within the target zone
    const x = getRandomXInZone(targetZone);
    if (x === null) {
      console.warn(`Could not generate valid position in zone ${targetZone}`);
      continue;
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

    // Incrementally update the zone density after spawning each crate
    // This ensures subsequent crates in this batch avoid the same zone
    const zoneId = getZoneId(x);
    crateZoneDensity.set(zoneId, (crateZoneDensity.get(zoneId) || 0) + 1);
  }
}

function generateMoneyCrate(x, y, amount = 100) {
  crates.push(new Crate(x, y, "money", amount));
}

function generateStandardComponentCrates() {
  const crate_count = max_component_crates - crates.filter(c => c.type === 'component').length;

  if (players.length === 0 || crate_count <= 0) return;

  // Update zone density ONCE before spawning all crates
  updateZoneDensity();

  // Map boundaries
  const seaLevel = 300; // Top of water biome from your map definition

  for (let i = 0; i < crate_count; i++) {
    // Find zone with lowest density for even distribution
    const targetZone = findLowestDensityZone();
    if (targetZone === undefined) {
      console.warn("No valid zone found for crate spawning");
      continue;
    }

    // Get random position within the target zone
    const x = getRandomXInZone(targetZone);
    if (x === null) {
      console.warn(`Could not generate valid position in zone ${targetZone}`);
      continue;
    }
    const y = seaLevel;

    generateRandomBasicComponentCrate(x, y);

    // Incrementally update the zone density after spawning each crate
    // This ensures subsequent crates in this batch avoid the same zone
    const zoneId = getZoneId(x);
    crateZoneDensity.set(zoneId, (crateZoneDensity.get(zoneId) || 0) + 1);
  }
}

function generateRandomBasicComponentCrate(x, y) {
  let value = Math.abs(x);
  let level = 1;
  let type = Math.floor(Math.random() * 3);
  let manufacturer = Math.floor(Math.random() * 4) + 1;
  let component = null;

  if (value >= 140000) level = 10;
  else if (value >= 120000) level = 9;
  else if (value >= 100000) level = 8;
  else if (value >= 80000) level = 7;
  else if (value >= 60000) level = 6;
  else if (value >= 40000) level = 5;
  else if (value >= 25000) level = 4;
  else if (value >= 14000) level = 3;
  else if (value >= 5000) level = 2;

  if (type < 1) {
    component = createEngine(manufacturer, level);
  } else if (type < 2) {
    component = createChassis(manufacturer, level);
  } else {
    component = createWings(manufacturer, level);
  }
  crates.push(new Crate(x, y, "component", component));
}

function generateWeaponCrates() {
  const crate_count = max_weapon_crates - crates.filter(c => c.type === 'weapon').length;

  if (players.length === 0 || crate_count <= 0) return;

  // Update zone density ONCE before spawning all crates
  updateZoneDensity();

  // Map boundaries
  const seaLevel = 300; // Top of water biome from your map definition

  for (let i = 0; i < crate_count; i++) {
    // Find zone with lowest density for even distribution
    const targetZone = findLowestDensityZone();
    if (targetZone === undefined) {
      console.warn("No valid zone found for crate spawning");
      continue;
    }

    // Get random position within the target zone
    const x = getRandomXInZone(targetZone);
    if (x === null) {
      console.warn(`Could not generate valid position in zone ${targetZone}`);
      continue;
    }
    const y = seaLevel;

    generateRandomWeaponCrate(x, y);

    // Incrementally update the zone density after spawning each crate
    // This ensures subsequent crates in this batch avoid the same zone
    const zoneId = getZoneId(x);
    crateZoneDensity.set(zoneId, (crateZoneDensity.get(zoneId) || 0) + 1);
  }
}

function generateRandomWeaponCrate(x, y) {
  let value = Math.abs(x);
  let level = 1;
  let type = getRandomGunType();
  let component = null;

  if (value >= 140000) level = 10;
  else if (value >= 120000) level = 9;
  else if (value >= 100000) level = 8;
  else if (value >= 80000) level = 7;
  else if (value >= 60000) level = 6;
  else if (value >= 40000) level = 5;
  else if (value >= 25000) level = 4;
  else if (value >= 14000) level = 3;
  else if (value >= 5000) level = 2;

  component = createGun(type, level);
  crates.push(new Crate(x, y, "weapon", component));
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
    const gun = player.selectedGun === 1 ? player.gun1 : (player.selectedGun === 2 ? player.gun2 : null);
    if (gun) {
      attemptFireGun(player, gun);
    }
  }
}

function attemptFireGun(player, gun) {
  if (gun.cooldown === 0 && gun.heat <= gun.maxHeat - gun.heatEfficiency) {
    const projectile = createBullet(player, gun);
    projectiles.push(projectile);

    let visualSpeed = gun.projectileSpeed;
    if (gun.name.includes('Fireworks')) {
      visualSpeed += 1000;
    }

    if (!gun.name.includes('Flamethrower')) {
      createGunshotEvent(player.x, player.y, gun.angle, visualSpeed, gun.projectileSize);
    }
    
    gun.cooldown = gun.cooldownTime;
    gun.heat = Math.min(gun.maxHeat, gun.heat + gun.heatEfficiency);
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
  const vx = Math.cos(angle) * gun.projectileSpeed + (player.vx || 0);
  const vy = Math.sin(angle) * gun.projectileSpeed + (player.vy || 0);

  const deltaTime = BASE_DT * timeSpeed;

  if (gun.name.includes('Firework Launcher')) {
    return new FireworkRocket(
      player.x - vx * deltaTime,
      player.y - vy * deltaTime,
      vx,
      vy,
      angle,
      gun.damage,
      gun.projectileSize,
      player.username,
      gun.projectileRange,
      gun.projectileLifetime,
      255, 0, 0, // Red rocket
      gun.fireDamage // Pass fireDamage from gun
    );
  }

  if (gun.name.includes('Flamethrower')) {
    // Gaussian distribution for angle (Box-Muller transform)
    const u1 = 1.0 - Math.random(); 
    const u2 = 1.0 - Math.random();
    const randStdNormal = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const spreadAngle = angle + (randStdNormal * 0.1); // ~11 degrees standard deviation

    const fireVx = Math.cos(spreadAngle) * gun.projectileSpeed + (player.vx || 0);
    const fireVy = Math.sin(spreadAngle) * gun.projectileSpeed + (player.vy || 0);

    return new Fire(
      player.x - fireVx * deltaTime,
      player.y - fireVy * deltaTime,
      fireVx,
      fireVy,
      spreadAngle,
      gun.damage,
      gun.projectileSize,
      player.username,
      gun.projectileRange,
      gun.projectileLifetime,
      255, 100 + Math.random() * 100, 0, // Orange-yellow variable color
      gun.fireDamage // Pass fireDamage from gun
    );
  }

  const proj = new Projectile(
    player.x - vx * deltaTime,
    player.y - vy * deltaTime,
    vx,
    vy,
    angle,
    gun.damage, // damage
    gun.projectileSize, // size
    player.username,
    gun.projectileRange, // max distance in meters
    gun.projectileLifetime,
    200,
    200, // color RGB
    200
  );

  proj.piercing = 1; 

  return proj;
}

function applyRepairs(player, deltaTime) {
  // Support both direct hull and chassis.hull
  const maxHull = (typeof player.maxHull === 'number') ? player.maxHull : (player.chassis && typeof player.chassis.maxHull === 'number' ? player.chassis.maxHull : null);
  if (!maxHull) return;
  const repairRate = maxHull / 15; // Hull repaired per second

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
  const rotationSpeed = 2 / gun.weight; // For example: if weight is higher, turn slower

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

// Swept collision detection for fast-moving projectiles
// Checks if a moving sphere (projectile) hits a stationary sphere (target) along its path
function checkSweptCollision(startX, startY, endX, endY, projectileRadius, targetX, targetY, targetRadius) {
  // Calculate the movement vector
  const dx = endX - startX;
  const dy = endY - startY;

  // Vector from start position to target
  const fx = startX - targetX;
  const fy = startY - targetY;

  // Combined radius for collision
  const combinedRadius = projectileRadius + targetRadius;

  // Solve quadratic equation for ray-sphere intersection
  // (dx, dy) is the ray direction
  // (fx, fy) is from ray origin to sphere center
  const a = dx * dx + dy * dy;

  // If projectile didn't move, use simple distance check
  if (a < 0.0001) {
    const dist = Math.sqrt(fx * fx + fy * fy);
    return dist <= combinedRadius;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = (fx * fx + fy * fy) - combinedRadius * combinedRadius;

  const discriminant = b * b - 4 * a * c;

  // No intersection if discriminant is negative
  if (discriminant < 0) {
    return false;
  }

  // Calculate the intersection point(s)
  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / (2 * a);
  const t2 = (-b + sqrtDisc) / (2 * a);

  // Check if collision occurred within the movement segment (t between 0 and 1)
  // We want the first intersection point
  if (t1 >= 0 && t1 <= 1) {
    return true;
  }
  if (t2 >= 0 && t2 <= 1) {
    return true;
  }

  // Also check endpoints explicitly for edge cases
  // Check start position
  const startDist = Math.sqrt(fx * fx + fy * fy);
  if (startDist <= combinedRadius) {
    return true;
  }

  // Check end position
  const ex = endX - targetX;
  const ey = endY - targetY;
  const endDist = Math.sqrt(ex * ex + ey * ey);
  if (endDist <= combinedRadius) {
    return true;
  }

  return false;
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
    // Use gun's own heatDispersion property
    const heatDispersion = gun.heatDispersion ?? 30; // Fallback to 30 if not set
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

function applyPlayerGravity(player, deltaTime) {
  // Gravity Normalized:
  // Previous: 0.5 added per tick. (Effective 50Hz = 25/sec).
  // New: Accel * dt.
  // Target: Accel * 0.02 = 0.5 => Accel = 25.0
  const GRAVITY_ACCEL = 25.0; 
  const gravityForce = GRAVITY_ACCEL * deltaTime; 

  if (player.biome === 'water') {
    // Find actual water surface level from biome data
    let waterSurfaceY = 310; // Default fallback
    if (mapData && mapData.biomes) {
        const waterBiome = mapData.biomes.find(b => b.type === 'water' && player.x >= b.x1 && player.x <= b.x2);
        if (waterBiome) waterSurfaceY = waterBiome.y1;
    }

    const isStationary = player.engine.power <= player.engine.minPower;
    const distToSurface = Math.abs(player.y - waterSurfaceY);
    const isNearSurface = distToSurface < 50;

    if (isStationary && isNearSurface) {
      // When throttle is 0 AND near surface, make the boat float at equilibrium
      // Equilibrium requires depth=10 (to get 0.5 upward force matches gravity).
      // So set target higher (-12) so the equilibrium point (at +10 depth from target) ends up slightly above surface.
      const targetFloatDepth = -12; 
      const targetY = waterSurfaceY + targetFloatDepth;

      // Calculate distance from target (positive means deeper)
      const depth = player.y - targetY;

      if (depth > 0) {
        // Below target (deeper in water) - apply upward buoyancy
        // Force must exceed gravity (0.5) to push up
        // Spring-like force: stronger when deeper
        // Cap max force to avoid rocket-launching, but ensure it's > 0.5
        const springForce = Math.min(depth * 5.0 * deltaTime, 1.5 * GRAVITY_ACCEL * deltaTime); 
        
        player.vy += gravityForce - springForce;
        
        // Apply Drag (damping) only, don't hard multiply
        player.vy *= 0.95; 
      } else {
         // Above target (in air or just surfaced) - apply gravity + damping to settle
         // If we are slightly above target (e.g. bobbed up), gravity pulls down.
         player.vy += gravityForce;
         
         // If very close to surface, dampen to stop bouncing forever?
         if (depth > -20) {
            player.vy *= 0.90;
         }
      }

    } else {
      // Normal water physics (moving OR deep underwater)
      // Enhanced buoyancy for easier water lift-off when moving, or just floating up from deep
      const buoyancyForce = (player.chassis.buoyancy * 1.5) * (GRAVITY_ACCEL * 2.0 * deltaTime); // Scaled to deltaTime
      
      // Buoyancy opposes gravity
      player.vy += gravityForce - buoyancyForce;
      
      // Apply water drag to vertical movement to prevent infinite acceleration
      if (Math.abs(player.vy) > 2) {
          player.vy *= 0.98;
      }
    }
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
  
  var dragCoefficient = 0.06;  // Reverted to original value matching 0.02s timestep
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
  const deltaTime = BASE_DT * timeSpeed;
  // Support both direct hull (boats) and chassis.hull (planes/players)
  const hull = (typeof entity.hull === 'number') ? entity.hull : (entity.chassis && typeof entity.chassis.hull === 'number' ? entity.chassis.hull : null);
  const maxHull = (typeof entity.maxHull === 'number') ? entity.maxHull : (entity.chassis && typeof entity.chassis.maxHull === 'number' ? entity.chassis.maxHull : null);

  if (hull !== null && hull <= 0) {
    // Determine if this entity is a player (has money/value) or an enemy
    const isPlayer = players.some(p => p.username === entity.username);
    if (isPlayer) {
      // Check if player is already pending respawn to prevent multiple triggers
      const alreadyPendingRespawn = pendingRespawns.some(pr => pr.player.username === entity.username);

      if (!alreadyPendingRespawn) {
        // Drop a random part (component or weapon) as a crate
        dropRandomPlayerPart(entity);

        if (entity.money >= entity.value) handleRevive(entity);
        else handleDeath(entity);
      }
    } else {
      // For enemies, just remove them
      handleDeath(entity);
    }
  }

  // No automatic hull drain in water here; repair/heat systems handle repair/damage elsewhere.
}

function handleRevive(player) {
  // Create explosion immediately at death location
  const explosionSize = Math.max(player.size / 10 || 1, 1);
  createExplosionEvent(player.x, player.y, explosionSize);

  // Store player info for respawn
  const username = player.username;
  const respawnCost = player.value;
  const socket = playerSockets.get(username);
  const deathX = player.x;
  const deathY = player.y;

  // Detach crates
  player.detachAllCrates();

  // Remove player from the game temporarily
  const playerIndex = players.findIndex(p => p.username === username);
  if (playerIndex !== -1) {
    players.splice(playerIndex, 1);
  }

  sendNoticeMessageAll(`${player.username} has been downed!`, 'server');

  if (socket) {
    sendMessage(socket, {
      type: 'player_downed',
      respawnTime: 2000,
      cost: respawnCost
    });
  }

  // Schedule respawn after 2 seconds (will deduct money and re-add player then)
  const respawnTime = Date.now() + 2000;
  pendingRespawns.push({ player, respawnTime, respawnCost, socket, username, deathX, deathY });

  console.log(`${username} scheduled for respawn in 2 seconds (cost: $${respawnCost})`);
}

function processPendingRespawns() {
  const now = Date.now();

  // Process all respawns that are ready
  for (let i = pendingRespawns.length - 1; i >= 0; i--) {
    const pending = pendingRespawns[i];

    if (now >= pending.respawnTime) {
      const player = pending.player;
      const cost = pending.respawnCost;
      const socket = pending.socket;
      const username = pending.username;

      // Check if player's socket is still connected
      if (socket && playerSockets.has(username)) {
        // Deduct repair cost at respawn time
        player.money -= cost;

        try {
          // Respawn the player
          player.respawn();

          // Re-add player to the game
          players.push(player);

          if (player && player.lastRecoveryZone) {
            sendNoticeMessage(username, `You were respawned at recovery zone ${player.lastRecoveryZone.id}. -$${cost}`, 'game');
          } else {
            sendNoticeMessage(username, `You respawned. -$${cost}`, 'game');
          }
          console.log(`${username} respawned after delay (cost: $${cost})`);
        } catch (err) {
          console.error('Error during delayed respawn', username, err);
          try {
            player.respawn();
            players.push(player);
          } catch (e) { /* ignore */ }
        }
      } else {
        console.log(`${username} disconnected before respawn could complete`);
      }

      // Remove this respawn from the queue
      pendingRespawns.splice(i, 1);
    }
  }
}

function dropRandomPlayerPart(player) {
  // Collect all valid equipable items from the player
  const parts = [player.engine, player.chassis, player.wings, player.gun1, player.gun2].filter(p => p);
  
  if (parts.length === 0) return;
  
  // Pick one at random
  const part = parts[Math.floor(Math.random() * parts.length)];
  
  // Create a clone to ensure independence from the player's current equipment
  // (In case they respawn and keep the original)
  const clone = Object.assign(Object.create(Object.getPrototypeOf(part)), part);
  
  // Determine Type: Weapons usually have 'damage' or fireRate
  let crateType = 'component';
  if (part.damage !== undefined || part.fireRate !== undefined) {
      crateType = 'weapon';
  }
  
  // Drop centered on player
  crates.push(new Crate(player.x, player.y, crateType, clone));
}

function handleDeath(entity) {
  // Create explosion event at death location
  const explosionSize = Math.max(entity.size / 10 || 1, 1); // Use entity size if available

  // Check if entity is a player or enemy
  const playerIndex = players.findIndex((p) => p.username === entity.username);
  const enemyIndex = typeof enemies !== 'undefined' ? enemies.findIndex((e) => e.username === entity.username) : -1;
  const socket = playerSockets.get(entity.username);

  if (playerIndex !== -1) {
    sendNoticeMessageAll(`${entity.username} has been killed!`, 'server');

    // PvP Killer Achievement
    if (entity.lastAttackerUsername) {
        const attacker = players.find(p => p.username === entity.lastAttackerUsername);
        if (attacker && attacker !== entity && attacker.achievements && attacker.achievements['player_killer']) {
            attacker.achievements['player_killer'].increment(attacker, 1);
            sendPlayerAchievements(attacker);
        }
    }

    // Delete the player's saved state so they start fresh on next login
    if (entity.playerId) {
      deletePlayerState(entity.playerId);
      console.log(`Deleted player state for ${entity.username} (ID: ${entity.playerId}) after death`);
    }

    if (socket) {
      sendMessage(socket, {
        type: 'player_destroyed'
      });
    }
    createExplosionEvent(entity.x, entity.y, explosionSize);
    entity.detachAllCrates();
    // Remove player from players list and clean up socket references (death = removal)
    players.splice(playerIndex, 1);
    playerSockets.delete(entity.username);
    return;
  }

  // Remove enemy plane without messages or websockets
  if (enemyIndex !== -1) {
    const enemy = enemies[enemyIndex];

    // Achievement: Enemy Killer
    if (enemy.lastAttackerUsername) {
        const attacker = players.find(p => p.username === enemy.lastAttackerUsername);
        if (attacker && attacker.achievements && attacker.achievements['enemy_killer']) {
            attacker.achievements['enemy_killer'].increment(attacker, 1);
            // Re-send specific achievement update to client to reflect progress bar immediately?
            // "increment" saves to DB, but doesn't auto-send websocket update unless we add it.
            // Let's send it.
            
            // Only send individual update if not completed (completed sends notification likely)
            // Actually let's just send the full update to keep UI in sync
            sendPlayerAchievements(attacker);
        }
    }

    // Create explosion event for enemy
    // For boats, spawn explosion above water surface
    let explosionY = enemy.y;
    if (enemy && enemy.isFleetBoat) {
      const waterSurface = getWaterSurfaceAt(enemy.x);
      if (waterSurface !== null) {
        explosionY = waterSurface - 1;
      }
    }
    createExplosionEvent(enemy.x, explosionY, explosionSize);

    // If this is a fleet plane, notify its boat and track destruction time
    if (enemy.fleetBoat && enemy.fleetBoat.isFleetBoat) {
      const boat = enemy.fleetBoat;
      // Remove plane from boat's planes array
      boat.planes = boat.planes.filter(p => p.username !== enemy.username);
      // Update last plane destroyed time
      boat.lastPlaneDestroyedAt = Date.now();
      console.log(`Fleet plane ${enemy.username} destroyed. Boat ${boat.username} now has ${boat.planes.length}/${boat.planeLevels.length} planes`);
    }

    // If enemy is a fleet boat and has stored crates, drop them into the world
    if (enemy && typeof enemy.dropAllStoredCrates === 'function') {
      try {
        const dropped = enemy.dropAllStoredCrates();
        if (dropped && dropped.length > 0) {
          // Place dropped crates at enemy position with small jitter and re-add to world
          dropped.forEach((crate, idx) => {
            crate.x = enemy.x + (Math.random() - 0.5) * 20;
            crate.y = enemy.y + (Math.random() - 0.5) * 20;
            crate.vx = 0;
            crate.vy = 0;
            crate.removedFromWorld = false;
            crate.lastDetachedAt = Date.now();
            crates.push(crate);
          });
        }
      } catch (err) {
        console.error('Error dropping stored crates for enemy', enemy && enemy.username, err);
      }
    }
    // If this was a fleet boat, record the destruction time so we delay automatic respawns
    try {
      if (enemy && enemy.isFleetBoat) {
        lastFleetShipDestroyedAt = Date.now();
        console.log(`Fleet ship ${enemy.username} destroyed - delaying fleet respawns for ${FLEET_RESPAWN_DELAY_MS / 1000} seconds`);

        // Immediately notify all planes that belonged to this fleet boat
        if (enemy.planes && Array.isArray(enemy.planes)) {
          enemy.planes.forEach(plane => {
            if (plane && plane.fleetBoat === enemy) {
              plane.fleetBoat = null;
              plane.aiState = 'seekFleet';
              console.log(`Plane ${plane.username} notified of fleet boat destruction, switching to seekFleet`);
            }
          });
        }

        // Also check all enemy planes in case they reference this boat but aren't in the boat's array
        enemies.forEach(e => {
          if (e.fleetBoat === enemy) {
            e.fleetBoat = null;
            e.aiState = 'seekFleet';
            console.log(`Plane ${e.username} found referencing destroyed boat, switching to seekFleet`);
          }
        });
      }
    } catch (e) {
      console.error('Error handling fleet boat destruction cleanup:', e);
    }
    // Detach any crates held by the enemy in its standard 'crates' array
    entity.detachAllCrates?.(); // Detach all crates from enemy entity
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
  const BIOME_HYSTERESIS = 5; // Add buffer to prevent flickering at boundaries

  // Iterate all biomes to check if the player's position is within any biome.
  for (let i = 0; i < mapData.biomes.length; i++) {
    const biome = mapData.biomes[i];

    // Apply hysteresis: if player is already in this biome, extend the boundaries slightly
    const isCurrentBiome = player.biome === biome.type;
    const buffer = isCurrentBiome ? BIOME_HYSTERESIS : 0;

    if (
      biome.x1 - buffer <= player.x &&
      player.x <= biome.x2 + buffer &&
      biome.y1 - buffer <= player.y &&
      player.y <= biome.y2 + buffer
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

function findLargestGapForFleetBoat() {
  const waterBiome = mapData.biomes.find(b => b.type === 'water');
  if (!waterBiome) return null;

  const waterY = Math.min(waterBiome.y1, waterBiome.y2);
  const RECOVERY_ZONE_BUFFER = 500; // Stay 500m away from recovery zones

  // Get all fleet boats
  const fleetBoats = enemies.filter(e => e.isFleetBoat && e instanceof NavySalvageBoat);

  // Get all recovery zones from map
  const recoveryZones = mapData.biomes.filter(b => b.type === 'recovery');

  // If no fleet boats exist, spawn anywhere on the map (away from recovery zones)
  if (fleetBoats.length === 0) {
    // Try random positions until we find one far from all recovery zones
    for (let attempts = 0; attempts < 20; attempts++) {
      let x;
      // Avoid spawning in exclusion zone
      if (Math.random() < 0.5) {
        x = -mapData.sizeX + Math.random() * (mapData.sizeX - crateSpawnExclusionRadius * 2);
      } else {
        x = crateSpawnExclusionRadius * 2 + Math.random() * (mapData.sizeX - crateSpawnExclusionRadius * 2);
      }

      // Check distance to all recovery zones
      let tooClose = false;
      for (const zone of recoveryZones) {
        const zoneCenterX = (zone.x1 + zone.x2) / 2;
        const zoneHalfWidth = (zone.x2 - zone.x1) / 2;
        const distanceToZone = Math.abs(x - zoneCenterX) - zoneHalfWidth;

        if (distanceToZone < RECOVERY_ZONE_BUFFER) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return { x, y: waterY };
      }
    }
    return null; // Couldn't find suitable location after 20 attempts
  }

  // Sort fleet boats by x position
  const sortedBoats = [...fleetBoats].sort((a, b) => a.x - b.x);

  // Find largest gap that can fit a new fleet with MIN_FLEET_DISTANCE on both sides
  let largestGap = { size: 0, x1: 0, x2: 0 };

  // Check gap before first boat
  const firstGapSize = sortedBoats[0].x - (-mapData.sizeX);
  if (firstGapSize > largestGap.size) {
    largestGap = { size: firstGapSize, x1: -mapData.sizeX, x2: sortedBoats[0].x };
  }

  // Check gaps between boats
  for (let i = 0; i < sortedBoats.length - 1; i++) {
    const gapSize = sortedBoats[i + 1].x - sortedBoats[i].x;
    if (gapSize > largestGap.size) {
      largestGap = { size: gapSize, x1: sortedBoats[i].x, x2: sortedBoats[i + 1].x };
    }
  }

  // Check gap after last boat
  const lastGapSize = mapData.sizeX - sortedBoats[sortedBoats.length - 1].x;
  if (lastGapSize > largestGap.size) {
    largestGap = { size: lastGapSize, x1: sortedBoats[sortedBoats.length - 1].x, x2: mapData.sizeX };
  }

  // A viable gap must be at least 2 * MIN_FLEET_DISTANCE
  const minViableGapSize = MIN_FLEET_DISTANCE * 2;
  if (largestGap.size < minViableGapSize) {
    return null; // No viable gap
  }

  // Calculate the viable spawn range
  let viableX1 = largestGap.x1 + MIN_FLEET_DISTANCE;
  let viableX2 = largestGap.x2 - MIN_FLEET_DISTANCE;

  // Exclude recovery zones and their 500m buffers, plus center exclusion zone
  const exclusions = [];

  // Add center exclusion zone (crates)
  const exclusionMin = -crateSpawnExclusionRadius * 2;
  const exclusionMax = crateSpawnExclusionRadius * 2;
  exclusions.push({ x1: exclusionMin, x2: exclusionMax });

  // Add Fleet-specific Central Exclusion (10km)
  // Fleets should not spawn within 10,000 units of x=0
  const fleetCenterExclusion = 10000;
  exclusions.push({ x1: -fleetCenterExclusion, x2: fleetCenterExclusion });

  // Add all recovery zones with 500m buffer
  for (const zone of recoveryZones) {
    exclusions.push({ x1: zone.x1 - RECOVERY_ZONE_BUFFER, x2: zone.x2 + RECOVERY_ZONE_BUFFER });
  }

  // Sort exclusions by x1
  exclusions.sort((a, b) => a.x1 - b.x1);

  // Find segments of viable range not in exclusion zones
  const viableSegments = [];
  let currentStart = viableX1;

  for (const exclusion of exclusions) {
    // If exclusion starts after viable range, we're done
    if (exclusion.x1 >= viableX2) break;

    // If exclusion ends before viable range starts, skip it
    if (exclusion.x2 <= viableX1) continue;

    // If there's a gap before this exclusion, add it as a segment
    if (currentStart < exclusion.x1 && exclusion.x1 <= viableX2) {
      viableSegments.push({ x1: currentStart, x2: Math.min(exclusion.x1, viableX2) });
    }

    // Move current start to after this exclusion
    currentStart = Math.max(currentStart, exclusion.x2);
  }

  // Add final segment if there's space after all exclusions
  if (currentStart < viableX2) {
    viableSegments.push({ x1: currentStart, x2: viableX2 });
  }

  // If no viable segments, can't spawn
  if (viableSegments.length === 0) {
    return null;
  }

  // Choose segment weighted by size
  const totalSize = viableSegments.reduce((sum, seg) => sum + (seg.x2 - seg.x1), 0);
  let randomPoint = Math.random() * totalSize;

  for (const segment of viableSegments) {
    const segmentSize = segment.x2 - segment.x1;
    if (randomPoint < segmentSize) {
      const x = segment.x1 + randomPoint;
      return { x, y: waterY };
    }
    randomPoint -= segmentSize;
  }

  return null; // Fallback
}

function spawnFleetBoat() {
  const location = findLargestGapForFleetBoat();
  if (!location) return null;

  const boatUsername = `Navy Ship ${fleetCounter}`;
  fleetCounter++; // Increment counter for next fleet

  // Determine boat level based on distance-from-spawn (spawn origin at x=0,y=-400)
  const spawnOrigin = { x: 0, y: -400 };
  const dx = location.x - spawnOrigin.x;
  const dy = location.y - spawnOrigin.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Boat level scaling:
  // <50k: Level 1
  // 50k-100k: Level 2
  // >=100k: Level 3
  let boatLevel = 1;
  if (distance >= 100000) {
    boatLevel = 3;
  } else if (distance >= 50000) {
    boatLevel = 2;
  }

  const boat = new NavySalvageBoat(
    boatUsername,
    50, 50, 200, // navy blue
    location.x,
    location.y,
    3, // default planeCount (may be overridden by levels array below)
    boatLevel
  );

  // Add boat to enemies
  enemies.push(boat);

  // Determine plane levels based on distance-from-spawn
  // <20k: two lvl1 planes
  // 20k-50k: one lvl2 plane, two lvl1 planes
  // 50k-100k: three lvl2 + one lvl3
  // 100k-150k: three lvl3 + three lvl4 (6 planes)
  let levels = null;
  if (distance < 20000) {
    levels = [1, 1];
  } else if (distance < 50000) {
    levels = [2, 1, 1];
  } else if (distance < 100000) {
    levels = [2, 2, 2, 3];
  } else if (distance < 150000) {
    levels = [3, 3, 3, 4, 4, 4];
  } else {
    levels = [3, 3, 3, 4, 4, 4];
  }

  // Spawn its planes with the computed levels
  const planes = boat.spawnPlanes(levels);
  enemies.push(...planes);

  console.log(`Fleet boat ${boatUsername} spawned at (${Math.round(location.x)}, ${Math.round(location.y)}) with ${planes.length} planes`);
  return boat;
}

function checkParties() {
  parties = parties.filter((p) => p.players.length > 0); // Remove empty parties
  // If you need usernames, use party.getPlayerUsernames()
}

function manageAutoSave() {
  if (players.length === 0) return;

  console.log(`[AutoSave] Saving data for ${players.length} active players...`);
  let count = 0;

  players.forEach(player => {
    if (player.playerId) {
      // Save Game State
      savePlayerState(player.playerId, player);

      // Save Client/Account if linked
      if (player.clientId) {
        clientManager.saveClient(player.clientId);

        // Save Account if logged in
        const clientData = clientManager.clients[player.clientId];
        if (clientData && clientData.type === 'account' && clientData.accountName) {
          clientManager.saveAccount(clientData.accountName);
        }
      }
      count++;
    }
  });
  console.log(`[AutoSave] Completed for ${count} players.`);
}

// Utility to get serializable party info
function getSerializableParties() {
  return parties.map(party => ({
    name: party.name,
    color: { r: party.r, g: party.g, b: party.b },
    players: party.getPlayerUsernames()
  }));
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Initialize shops for all recovery zones
 */
function initializeShops() {
  const recoveryZones = mapData.biomes.filter(b => b.type === 'recovery');

  recoveryZones.forEach(zone => {
    // Calculate center X of the zone
    const centerX = (zone.x1 + zone.x2) / 2;
    const shop = new Shop(zone.id, centerX);
    shops.set(zone.id, shop);
    console.log(`Initialized shop for zone ${zone.id} at x=${centerX} with level ${shop.calculateLevelForZone()}`);
  });
}

/**
 * Helper: return the water surface Y at a given x coordinate.
 * Picks the water biome that contains x (x1 <= x <= x2) or falls back to the first water biome.
 * Returns the numerically smaller of y1 and y2 (higher on-screen), or null if none found.
 */
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

// Helper function to get player position for entity filtering
// Returns either the active player or a ghost position for respawning players
function getPlayerOrRespawningPlayer(username) {
  // First check if player is active
  const activePlayer = players.find(p => p.username === username);
  if (activePlayer) return activePlayer;

  // Check if player is pending respawn
  const respawning = pendingRespawns.find(pr => pr.username === username);
  if (respawning) {
    // Return a ghost object with the death location for entity filtering
    return {
      username: respawning.username,
      x: respawning.deathX,
      y: respawning.deathY,
      party: respawning.player.party
    };
  }

  return null;
}

// ========================================
// WEBSOCKET CONNECTION HANDLING
// ========================================

wss.on('connection', (ws, request) => {
  console.log('WebSocket connection established from:', request.socket.remoteAddress, 'URL:', request.url);
  ws.currentUsername = null; // Initialize username per connection

  // Send initial environment sync and map data to new connection (before login)
  sendMessage(ws, {
    type: 'gamestate_update',
    time: cycleTime,
    dayDuration: DAY_DURATION,
    nightDuration: NIGHT_DURATION
  });
  
  // Send map data immediately for background rendering
  sendMessage(ws, {
      type: 'map_data',
      map: mapData
  });

  // Send initial community list so user can see who is online before joining
  const communityList = players.map(p => ({
      username: p.username,
      r: p.r,
      g: p.g,
      b: p.b
  }));
  
  sendMessage(ws, {
      type: 'low_freq_update',
      community: communityList
  });

  ws.on('message', (data) => {
    const decodedMessage = msgpack.decode(data);
    handleIncomingMessage(ws, decodedMessage);
  });

  ws.on('close', (code, reason) => {
    // Log abnormal closures to help debug 60s timeout issues
    /* if (code !== 1000 && code !== 1001) {
       console.log(`[WS] Abnormal Disconnect: ${ws.currentUsername || 'Anonymous'} | Code: ${code} | Reason: ${reason}`);
    } */

    if (ws.currentUsername) {
      let player = players.find((p) => p.username === ws.currentUsername);
      if (player) {
        // Save player state before disconnect if they have a player ID
        if (player.playerId) {
          savePlayerState(player.playerId, player);
        }

        // Defensive: only call methods if the player object still exists
        if (typeof player.detachAllCrates === 'function') {
          try {
            player.detachAllCrates();
          } catch (err) {
            console.error('Error detaching crates for player on close:', err);
          }
        }
        players = players.filter((p) => p.username !== ws.currentUsername);
      } else {
        console.warn(`ws.close: no player object found for username ${ws.currentUsername}`);
      }

      // Always remove socket mapping and notify
      playerSockets.delete(ws.currentUsername);
      sendNoticeMessageAll(ws.currentUsername + ' has disconnected', 'server');
      console.log(`Player disconnected: ${ws.currentUsername}`);
      broadcastCommunityUpdate(); // Update community list on disconnect
    }
  });
});

function handleIncomingMessage(ws, message) {
  switch (message.type) {
    case 'login':
      handleLogin(ws, message);
      break;
    case 'register_account':
      handleRegisterAccount(ws, message);
      break;
    case 'login_account':
      handleAccountLogin(ws, message);
      break;
    case 'reset_account_progress':
      handleResetAccountProgress(ws, message);
      break;
    case 'check_session':
      handleCheckSession(ws, message);
      break;
    case 'request_community_update':
      const communityList = players.map(p => ({
          username: p.username,
          r: p.r,
          g: p.g,
          b: p.b
      }));
      sendMessage(ws, { 
          type: 'community_update', 
          community: communityList, 
          time: cycleTime 
      });
      break;
    case 'update':
      handleUpdate(ws, message);
      break;
    case 'get_players':
      // Optimized player serialization with culling
      const requestingPlayer = getPlayerOrRespawningPlayer(ws.currentUsername);
      const cullingDistance = 4000;
      
      const serializedPlayers = players
        .filter(p => {
          // If we don't know who is asking, send everyone (fallback)
          if (!requestingPlayer) return true;
          
          // 1. Always include self
          if (p.username === ws.currentUsername) return true;
          
          // 2. Always include party members
          if (requestingPlayer.party && p.party && requestingPlayer.party.name === p.party.name) return true;
          
          // 3. Include nearby players
          const dist = Math.sqrt((p.x - requestingPlayer.x) ** 2 + (p.y - requestingPlayer.y) ** 2);
          return dist <= cullingDistance;
        })
        .map(p => {
          // Only send full data (inventory, etc) if it's the requesting player
          const includePrivate = (p.username === ws.currentUsername);
          return p.toClientData(includePrivate);
        });

      // Collect chat messages from ALL players (ignoring culling) to support global chat
      const globalMessages = [];
      players.forEach(p => {
        if (p.messages && p.messages.length > 0) {
            // Check if messages are recent enough (already filtered by update loop loops but double check if needed)
            // p.messages structure: [timestamp, messageContent]
            p.messages.forEach(msg => {
                globalMessages.push({
                    id: msg[0], 
                    username: p.username, 
                    message: msg[1]
                });
            });
        }
      });

      sendMessage(ws, { type: 'player_data', players: serializedPlayers, messages: globalMessages });
      break;
    case 'get_enemies':
      const playerForEnemies = getPlayerOrRespawningPlayer(ws.currentUsername);
      const filteredEnemies = filterEntitiesInRange(enemies, playerForEnemies);
      // Serialize enemies with minimal data for client
      const serializedEnemies = filteredEnemies.map(enemy => {
        if (enemy.toClientData) {
          return enemy.toClientData();
        }
        // Fallback for enemies without toClientData method
        return {
          type: enemy.type,
          username: enemy.username,
          faction: enemy.faction,
          x: +enemy.x.toFixed(2),
          y: +enemy.y.toFixed(2),
          angle: +enemy.angle.toFixed(3),
          vx: +enemy.vx.toFixed(2),
          vy: +enemy.vy.toFixed(2),
          r: enemy.r,
          g: enemy.g,
          b: enemy.b,
          size: enemy.size,
          hull: enemy.hull ?? enemy.chassis?.hull ?? 0,
          maxHull: enemy.maxHull ?? enemy.chassis?.maxHull ?? 1
        };
      });
      sendMessage(ws, { type: 'enemy_data', enemies: serializedEnemies });
      break;
    case 'get_animals':
    // ... animals ... 
    // We didn't add toClientData to Animal yet, but we should wrap it similarly later or now. 
    // For now skipping to keep scope manageable unless requested.
      const playerForAnimals = getPlayerOrRespawningPlayer(ws.currentUsername);
      const filteredAnimals = filterEntitiesInRange(animals, playerForAnimals);
      sendMessage(ws, { type: 'animal_data', animals: filteredAnimals });
      break;
    case 'get_parties':
      sendMessage(ws, { type: 'party_data', parties: getSerializableParties() });
      break;
    case 'get_map':
      sendMessage(ws, { type: 'map_data', map: mapData })
      break;
    case 'get_projectiles':
      const playerForProjectiles = getPlayerOrRespawningPlayer(ws.currentUsername);
      const filteredProjectiles = filterEntitiesInRange(projectiles, playerForProjectiles);
      const serializedProjectiles = filteredProjectiles.map(p => p.toClientData());
      sendMessage(ws, { type: 'projectile_data', projectiles: serializedProjectiles });
      break;
    case 'get_crates':
      const playerForCrates = getPlayerOrRespawningPlayer(ws.currentUsername);
      // increased range for creates update
      const filteredCrates = filterEntitiesInRange(crates, playerForCrates, 2000, true);
      const serializedCrates = filteredCrates.map(c => c.toClientData());
      sendMessage(ws, { type: 'crate_data', crates: serializedCrates });
      break;
    case 'get_events':
      const playerForEvents = getPlayerOrRespawningPlayer(ws.currentUsername);
      const filteredEvents = filterEntitiesInRange(events, playerForEvents, 5000);
      sendMessage(ws, { type: 'event_data', events: filteredEvents });
      break;
    case 'get_shops':
      // Send all shop data to the client
      const shopsData = Array.from(shops.values()).map(shop => shop.toClientData());
      sendMessage(ws, { type: 'shop_data', shops: shopsData });
      break;
    case 'purchase_shop_item':
      handlePurchaseShopItem(ws, message);
      break;
    case 'equip_item':
      handleEquipItem(ws, message);
      break;
    case 'sell_all':
      handleSellAll(ws, message);
      break;
    case 'sell_item':
      handleSellItem(ws, message);
      break;
    case 'teleport_to_twin':
      handleTeleportToTwin(ws, message);
      break;
    case 'ping':
      handlePing(ws, message);
      break;
    case 'suicide':
      handleSuicide(ws, message);
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
}

function handleSellAll(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (!player) {
    console.warn('Player not found for sell_all:', ws.currentUsername);
    return;
  }

  // Check if player is in a recovery zone
  if (player.biome !== 'recovery') {
    sendNoticeMessage(ws.currentUsername, 'You must be in a recovery zone to sell items!', 'urgent');
    return;
  }

  const totalValue = player.sellAll();
  sendNoticeMessage(ws.currentUsername, `Sold all items for $${totalValue}`, 'game');
}

function handleSellItem(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (!player) {
    console.warn('Player not found for sell_item:', ws.currentUsername);
    return;
  }

  // Check if player is in a recovery zone
  if (player.biome !== 'recovery') {
    sendNoticeMessage(ws.currentUsername, 'You must be in a recovery zone to sell items!', 'urgent');
    return;
  }

  const value = player.sellItem(message.itemIndex);
  if (value > 0) {
    sendNoticeMessage(ws.currentUsername, `Sold item for $${value}`, 'game');
  } else {
    sendNoticeMessage(ws.currentUsername, 'Failed to sell item', 'urgent');
  }
}

function handlePurchaseShopItem(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (!player) {
    console.warn('Player not found for purchase:', ws.currentUsername);
    return;
  }

  // Check if player is in a recovery zone
  const currentRecoveryZone = mapData.getRecoveryZoneAtPosition(player.x, player.y);
  if (!currentRecoveryZone) {
    sendNoticeMessage(ws.currentUsername, 'You must be in a recovery zone to shop!', 'urgent');
    return;
  }

  // Get the shop for this zone
  const shop = shops.get(currentRecoveryZone.id);
  if (!shop) {
    console.warn('Shop not found for zone:', currentRecoveryZone.id);
    sendNoticeMessage(ws.currentUsername, 'Shop is unavailable!', 'urgent');
    return;
  }

  // Attempt purchase
  const result = shop.purchase(player, message.itemIndex);
  if (result.success) {
    if (result.autoEquipped) {
      sendNoticeMessage(ws.currentUsername, `Purchased and equipped ${result.component.name} for $${result.price}`, 'game');
    } else {
      sendNoticeMessage(ws.currentUsername, `Purchased ${result.component.name} for $${result.price} (added to inventory)`, 'game');
    }
  } else {
    sendNoticeMessage(ws.currentUsername, `Purchase failed: ${result.reason}`, 'urgent');
  }
}

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

function handleCheckSession(ws, { playerId, username, password }) {
  if (!playerId) return;

  let targetPlayerId = null;
  let accountInfo = null;

  // 1. Account Auto-Login Attempt
  if (username && password) {
      // Validate credentials
      const accountPlayerId = clientManager.verifyAccount(username, password);
      
      if (!accountPlayerId) {
          // Invalid credentials - Do not auto-login
          sendMessage(ws, { type: 'session_status', active: false, saveExists: false });
          return;
      }
      
      // Check if ClientID matches the account link (Client Verification)
      const client = clientManager.getClient(playerId);
      if (!client || client.accountName !== username) {
          // Client ID does not belong to this account (orphaned cookie or hijack attempt)
          sendMessage(ws, { type: 'session_status', active: false, saveExists: false });
          return;
      }

      targetPlayerId = accountPlayerId;
      accountInfo = { username: username };
  } 
  // 2. Cookie/Guest Login Attempt (No password provided)
  else {
      // Allow known clients (even accounts) to resume session if identifying cookie matches
      const client = clientManager.getClient(playerId);
      
      if (client && client.type === 'account') {
            // It's a known device linked to an account. Allow auto-login.
            targetPlayerId = clientManager.getGameSaveIdForClient(playerId);
            
            // Resolve display username
            const account = clientManager.getAccount(client.accountName);
            if (account) {
                accountInfo = { username: account.username };
            }
      } else {
            // Pure guest
            targetPlayerId = clientManager.getGameSaveIdForClient(playerId);
      }
  }

  if (!targetPlayerId) {
       sendMessage(ws, { type: 'session_status', active: false, saveExists: false });
       return;
  }

  const isSessionActive = players.some(p => p.playerId === targetPlayerId);
  const saveExists = playerStateExists(targetPlayerId);

  sendMessage(ws, {
    type: 'session_status',
    active: isSessionActive,
    saveExists: saveExists,
    account: accountInfo
  });

  // Load and send achievements from Client/Account storage
  let achievementData = [];
  
  // If player is already spawned, use the live object (which should have synced with client store on spawn)
  const livePlayer = players.find(p => p.playerId === targetPlayerId);
  
  if (livePlayer) {
      achievementData = getAchievementDataForClient(livePlayer);
  } else {
      // If not spawned, load directly from Client Manager using the Connect ID
      const clientAchievements = clientManager.getAchievementsForClient(playerId);
      const tempPlayer = { achievements: {} };
      syncPlayerAchievements(tempPlayer, clientAchievements);
      achievementData = getAchievementDataForClient(tempPlayer);
  }

  if (achievementData.length > 0) {
      sendMessage(ws, { type: 'achievements_update', achievements: achievementData });
  }
}

function handleRegisterAccount(ws, { username, password, playerId }) {
    // playerId here is the Client/Cookie UUID
    if (!playerId || !username || !password) {
        sendMessage(ws, { type: 'register_failed', message: 'Missing fields.' });
        return;
    }

    if (!isMessageAppropriate(username)) {
      sendMessage(ws, { type: 'register_failed', message: 'Username contains inappropriate language.' });
      return;
    }
    
    // Check if client is valid guest
    // Ensure client exists (create if needed, though they should usually exist by now)
    const client = clientManager.getClient(playerId);
    if (!client) {
         // Should technically happen only if playerId is missing
         sendMessage(ws, { type: 'register_failed', message: 'Invalid client session.' });
         return;
    }
    
    // Grab guest achievements BEFORE we verify/link account
    const guestAchievements = client.achievements || {};
    
    // We link the CURRENT game save (resolved from client) to the NEW account
    let gameSaveId = clientManager.getGameSaveIdForClient(playerId);
    
    // If no existing game save to link, generate a new one for this account
    if (!gameSaveId) {
         gameSaveId = generatePlayerId();
    }

    const result = clientManager.createAccount(username, password, gameSaveId);
    if (result.success) {
        // Init account with guest achievements
        // Direct access via clientManager internal structure would be cleaner but we need a public method ideally
        // We can use updateAchievement loop or just manual hack if within same process memory
        const account = clientManager.getAccount(username);
        if (account) {
            account.achievements = { ...guestAchievements }; // Copy
            clientManager.saveAccount(username);
        }
        
        clientManager.assignClientToAccount(playerId, username);
        sendMessage(ws, { type: 'register_success', username });
        
        // Auto-login the user immediately after registration to ensure cookies are set
        // and session state is fully initialized on the client side.
        handleAccountLogin(ws, { username, password, playerId });
    } else {
        sendMessage(ws, { type: 'register_failed', message: result.message });
    }
}

function handleAccountLogin(ws, { username, password, playerId }) {
    // playerId is the CLIENT UUID of the device attempting login
    if (!username || !password) return;

    if (!isMessageAppropriate(username)) {
      sendMessage(ws, { type: 'login_failed', message: 'Account name contains inappropriate language.' });
      return;
    }
    
    // Ensure the client record exists before we try to assign it
    // If it's a fresh visitor, they might not be in clients.json yet
    if (playerId) {
        clientManager.getClient(playerId);
    }
    
    const accountGameSaveId = clientManager.verifyAccount(username, password);
    if (accountGameSaveId) {
        // Login successful.
        if (playerId) {
            // Retrieve actual display name (e.g. "William" instead of "wILLIAM")
            // verifyAccount uses normalized lookup, so we can now fetch proper casing
            const account = clientManager.getAccount(username);
            const displayUsername = (account && account.username) ? account.username : username;

            clientManager.assignClientToAccount(playerId, displayUsername);
            const saveExists = playerStateExists(accountGameSaveId);
            sendMessage(ws, { type: 'account_login_success', username: displayUsername, playerId: playerId, saveExists }); 

            // Send achievements for the logged-in account (or client if not fully linked yet, but verifyAccount confirms link)
            let achievementData = [];
            
            // If the account has an active player
            const livePlayer = players.find(p => p.playerId === accountGameSaveId);
            
            if (livePlayer) {
                achievementData = getAchievementDataForClient(livePlayer);
            } else {
                // Load from client manager (which handles delegation to Account)
                // Note: 'playerId' here is the Client UUID. Since we just logged in, clientManager maps this ID to the account.
                const clientAchievements = clientManager.getAchievementsForClient(playerId);
                const tempPlayer = { achievements: {} };
                syncPlayerAchievements(tempPlayer, clientAchievements);
                achievementData = getAchievementDataForClient(tempPlayer);
            }

            if (achievementData.length > 0) {
                sendMessage(ws, { type: 'achievements_update', achievements: achievementData });
            }
        } else {
            sendMessage(ws, { type: 'account_login_failed', message: 'No device session found.' });
        }
    } else {
        sendMessage(ws, { type: 'account_login_failed', message: 'Invalid credentials.' });
    }
}

function handleResetAccountProgress(ws, { playerId }) {
  if (!playerId) return;

  // Resolve target game save ID from client manager
  const targetGameSaveId = clientManager.getGameSaveIdForClient(playerId);
  if (!targetGameSaveId) return; // No save to delete

  // Delete the save file from disk
  deletePlayerState(targetGameSaveId);
  
  // Also kick any active player with this ID (unlikely if in menu, but safe)
  const activeSession = players.findIndex(p => p.playerId === targetGameSaveId);
  if (activeSession !== -1) {
       players.splice(activeSession, 1);
  }

  // Check if there is an account associated and include it so client stays logged in
  const account = clientManager.getAccountForClient(playerId);
  
  // Update client to reflect no save exists
  const msg = { type: 'session_status', saveExists: false, active: false };
  if (account) {
      msg.account = account;
  }
  sendMessage(ws, msg);
}

function handleLogin(ws, { username, r, g, b, selectedGun1, selectedGun2, partyName, clearParty, playerId, password }) {
  if (!isMessageAppropriate(username)) {
    sendMessage(ws, { type: 'login_failed', message: 'Display name contains inappropriate language.' });
    return;
  }

  // playerId from client is the Client/Device UUID (Cookie)
  let clientUUID = playerId;
  
  // Ensure we have a valid client record (creates guest if new)
  // If clientUUID is null/undefined, we'll generate one, but temporarily use null
  // We pass null as defaultSaveId to prevent linking to a non-existent save file named after the ClientUUID
  let client = clientUUID ? clientManager.getClient(clientUUID, null) : null;
  
  // Security Check: If the client ID is linked to an account, we MUST verify the password matches
  if (client && client.type === 'account') {
      const accountGameSaveId = clientManager.verifyAccount(client.accountName, password);
      // If password validation fails, or if verifyAccount returns null (wrong password)
      if (!accountGameSaveId) {
          // Reject this login attempt on this Client ID.
          // Force them to be treated as a NEW Guest (ignore the hijacking attempt)
          console.log(`Security: Rejected account access for client ${clientUUID} (Invalid/Missing Password)`);
          clientUUID = generatePlayerId(); // Generate fresh Client ID
          client = clientManager.getClient(clientUUID, null); // Create new guest
          // We will generate a new Save ID for this guest below
      }
  }
  
  // Resolve the actual game save ID (Player ID)
  let targetGameSaveId = client ? clientManager.getGameSaveIdForClient(clientUUID) : null;

  const existingPlayer = players.find((player) => player.username === username);
  if (!existingPlayer) {
    let player;

    // Try to load saved state if targetGameSaveId is resolved
    if (targetGameSaveId) {
      // Check if this game save is already in use by an active player
      const activeSession = players.find(p => p.playerId === targetGameSaveId);
      if (activeSession) {
        sendMessage(ws, { type: 'login_failed', message: 'Game save is being used by another player.' });
        return;
      }

      const savedState = loadPlayerState(targetGameSaveId);
      if (savedState) {
        // Restore player from saved state (username-independent)
        player = Player.fromSavedState(savedState, startMillis);
        // Correctly restore the ID since we don't save it in file anymore
        player.playerId = targetGameSaveId;
        // Update username to the current login username
        player.username = username;
        
        // Sync RGB from client choice (overwrite save)
        player.r = r;
        player.g = g;
        player.b = b;
        
        sendNoticeMessageAll(username + " rejoined!", "server");
      }
    }

    // Create new player if no saved state found
    if (!player) {
      player = new Player('air', username, r, g, b, 0, -400, startMillis, selectedGun1, selectedGun2);
      player.playerId = generatePlayerId(); // Generate new unique ID for the SAVE FILE
      sendNoticeMessageAll(username + " joined!", "server");
      
      // If we didn't have a clientUUID, generate a DISTINCT one for the device
      if (!clientUUID) {
          clientUUID = generatePlayerId(); // Generates a UUID
      }
      
      // Ensure client is registered and linked to this new save
      clientManager.getClient(clientUUID, player.playerId);
      
      // If the client already existed but pointed to a missing/invalid save, update it to the new one
      if (clientUUID && clientManager.getGameSaveIdForClient(clientUUID) !== player.playerId) {
           clientManager.updateClientGameSaveId(clientUUID, player.playerId);
      }
      
      // If this client is logged into an account, update the account's save ID to match this new file
      if (client && client.type === 'account' && client.accountName) {
           clientManager.updateAccountGameSaveId(client.accountName, player.playerId);
      }

      // Update targetGameSaveId for consistency
      targetGameSaveId = player.playerId;
    }

    players.push(player);
    playerSockets.set(username, ws);
    ws.currentUsername = username; // Set username in socket context
    
    // Attach Client/Device ID to the in-game player object for achievement tracking
    player.clientId = clientUUID;

    // Sync achievements from CLIENT storage, not game save
    const clientAchievements = clientManager.getAchievementsForClient(clientUUID);
    syncPlayerAchievements(player, clientAchievements);
    
    // Attempt to unlock First Login achievement
    let achievementsModified = false;
    if (player.achievements && player.achievements['first_login']) {
        if (player.achievements['first_login'].complete(player)) {
            achievementsModified = true;
        }
    }
    // Always send initial state
    sendPlayerAchievements(player);

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

    // Send Client ID (Cookie UUID) back to client to store in cookie
    // This ensures the client "device" is remembered.
    sendMessage(ws, { type: 'login_success', username, playerId: clientUUID, map: mapData });

    logPlayerJoin(username);
    
    // Broadcast community update when a player successfully logs in
    broadcastCommunityUpdate();

    // Check account privileges
    if (client && client.type === 'account') {
        const account = clientManager.getAccount(client.accountName);
        if (account && account.privileges) {
            player.privileges = true;
        }
    }

    if (player.privileges) {
      sendNoticeMessage(username, "You are the admin.", 'server');
    }
  } else {
    // Username already exists. Allow update if this message comes from the same socket that owns the player
    const existingSocket = playerSockets.get(username);
    // Consider it the same owner if the ws already has currentUsername set to this username
    const sameOwner = (existingSocket === ws) || (ws.currentUsername === username) || (!existingSocket && ws.currentUsername === username);
    if (sameOwner) {
      // Treat as an in-place update (party change / color update)
      // Update color if provided
      if (typeof r === 'number') existingPlayer.r = r;
      if (typeof g === 'number') existingPlayer.g = g;
      if (typeof b === 'number') existingPlayer.b = b;
      // Update selected guns only if provided (client may omit on party-change)
      if (typeof selectedGun1 !== 'undefined') existingPlayer.selectedGun1 = selectedGun1;
      if (typeof selectedGun2 !== 'undefined') existingPlayer.selectedGun2 = selectedGun2;

      // Handle party joining/updating only when a non-empty partyName is provided.
      // If partyName is missing or empty and clearParty is not set, leave the existingPlayer.party unchanged.
      if (typeof partyName !== 'undefined' && partyName && partyName.trim()) {
        const trimmed = partyName.trim();

        // Check if player is already in a different party and remove them
        if (existingPlayer.party && existingPlayer.party.name && existingPlayer.party.name !== trimmed) {
            const oldParty = parties.find(p => p.name === existingPlayer.party.name);
            if (oldParty) oldParty.removePlayer(existingPlayer);
        }

        let party = parties.find(party => party.name === trimmed);
        if (!party) {
          parties.push(new Party(trimmed));
          party = parties.find(party => party.name === trimmed);
          sendNoticeMessage(username, `Created and joined party "${trimmed}"`, 'server');
        } else {
          // If already in this party, adding again is harmless due to check in addPlayer, 
          // but we only want to say "Joined" if they weren't already in it.
          if (!existingPlayer.party || existingPlayer.party.name !== trimmed) {
             sendNoticeMessage(username, `Joined party "${trimmed}"`, 'server');
          }
        }
        party.addPlayer(existingPlayer);
      }
      else if (clearParty) {
        // Explicit request to leave party
        if (existingPlayer.party && existingPlayer.party.name) {
          const oldParty = parties.find(p => p.name === existingPlayer.party.name);
          if (oldParty && typeof oldParty.removePlayer === 'function') {
            oldParty.removePlayer(existingPlayer);
            sendNoticeMessage(username, `Left party "${oldParty.name}"`, 'server');
          } else {
            // Fallback: just clear the player's party object
            existingPlayer.party = null;
            sendNoticeMessage(username, 'Left party', 'server');
          }
        } else {
          // No party to leave
          sendNoticeMessage(username, 'Not in a party.', 'server');
        }
      }

      // Ensure the socket mapping and context are set
      playerSockets.set(username, ws);
      ws.currentUsername = username;

      sendMessage(ws, { type: 'login_success', username, map: mapData, message: 'updated' });
      sendNoticeMessage(username, 'Login info updated.', 'game');
    } else {
      // Different socket owns this username - reject with clearer message
      sendMessage(ws, { type: 'login_failed', message: 'Username already in use by another connection.' });
    }
  }
}

function handleUpdate(ws, { username, keys, t_x, t_y, chat_message, sequence }) {
  const player = players.find((p) => p.username === username);
  if (player) {
    player.keys = keys || player.keys;
    player.t_x = t_x;
    player.t_y = t_y;
    if (sequence) {
      player.lastInputSequence = sequence;
    }
    if (chat_message) {
      // Log all messages regardless of filter for review
      logMessage(username, chat_message);
      
      if (chat_message[0] === '/') {
          checkCommand(chat_message, player);
      } else {
          // Check for inappropriate content
          if (isMessageAppropriate(chat_message)) {
               player.messages.push([millis(), chat_message]);
          } else {
               // Send a private warning to the sender
               sendNoticeMessage(username, "Message blocked: Inappropriate content.", 'urgent');
               console.log(`Blocked message from ${username}: ${chat_message}`);
          }
      }
    }
    player.lastActivity = millis();
  }
}

// Message types are: urgent, game, server, pickup
export function sendNoticeMessage(username, message, type) {
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

export function sendPlayerAchievements(player) {
    const ws = playerSockets.get(player.username);
    if (ws) {
        const data = getAchievementDataForClient(player);
        sendMessage(ws, {
            type: 'achievements_update',
            achievements: data
        });
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
  if (!message) return; 
  const clientTime = message.clientTime; // Client's timestamp

  const response = {
    type: 'pong',
    clientTime: clientTime, // Echo client's timestamp
  };

  sendMessage(ws, response); // Encode and send the pong message
}

function handleSuicide(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (!player) return;

  // Store player info
  const username = player.username;

  // Create explosion at player location
  const explosionSize = Math.max(player.size / 10 || 1, 1);
  createExplosionEvent(player.x, player.y, explosionSize);

  // Detach all crates
  if (typeof player.detachAllCrates === 'function') {
    player.detachAllCrates();
  }

  // Remove the player from the game
  players = players.filter(p => p.username !== username);

  // Clean up the socket mapping
  playerSockets.delete(username);
  ws.currentUsername = null;

  // Send logout confirmation to client
  const logoutMessage = msgpack.encode({
    type: 'logout_success',
    message: 'Progress reset complete. Please sign in again.'
  });
  ws.send(logoutMessage);

  console.log(`${username} reset their progress via suicide`);
}


function handleDeletePlayerState(ws, message) {
  const player = players.find(p => p.username === ws.currentUsername);
  if (player && player.playerId) {
    // Delete the player's saved state file
    deletePlayerState(player.playerId);
    console.log(`Deleted player state for ${player.username} (ID: ${player.playerId})`);

    // Remove the player from the active players list
    players = players.filter((p) => p.username !== ws.currentUsername);

    // Clean up the socket mapping
    playerSockets.delete(ws.currentUsername);

    // Notify other players
    sendNoticeMessageAll(ws.currentUsername + ' has reset their progress', 'server');
  }
}

// Helper function to filter entities within culling range of a player
function filterEntitiesInRange(entities, player, cullingDistance = 2000, includeCarried = false) {
  if (!player) return [];
  return entities.filter(entity => {
    if (includeCarried && entity.carrier === player.username) return true;
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
    
    // Diagnostic: Check if we are sending a massive packet (lower threshold to 20KB)
    /* if (encodedData.length > 20000) {
      console.warn(`[Network] sending large packet: ${data.type} size: ${Math.round(encodedData.length / 1024)}KB`);
    } */

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

function weaponTest(weaponNumber, level, player) {
  // Create specfied level player weapon for the specified type
  const weapon = createGun(weaponNumber, level);
  player.equip(weapon);
  sendNoticeMessage(player.username, `Equipped level ${level} weapon ${weapon.name}`, 'game');
}

function enemyWeaponTest(weaponNumber, player) {
  // Create level 1 enemy weapon for the specified type
  const weapon = createEnemyGun(weaponNumber, 1);
  player.equip(weapon);
  sendNoticeMessage(player.username, "Equipped enemy weapon " + weapon.name, 'game');
}

function enemyTest(player, type = 0) {
  try {
    if (type === 0) {
      const enemy = new NavySalvagePlane(
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

      // Calculate boat level from distance (same as automatic spawning)
      const spawnOrigin = { x: 0, y: -400 };
      const dx = player.x - spawnOrigin.x;
      const dy = waterY - spawnOrigin.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let boatLevel = 1;
      if (distance >= 100000) {
        boatLevel = 3;
      } else if (distance >= 50000) {
        boatLevel = 2;
      }

      const enemy = new NavySalvageBoat(
        `NavyBoat_${Date.now()}`,
        50, 50, 200,
        player.x,
        waterY,
        3, // planeCount
        boatLevel
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
  console.log(`[CMD] Processing command '${command}' from user '${player.username}' (Privileges: ${player.privileges})`);
  let match;
  // No Privilege Requirement
  let players_command = /^\/players\s*$/i;
  let parties_command = /^\/party\s+(\w+)\s*$/i;
  let align_command = /^\/align\s*$/i;
  let privilege_command = /^\/Shluck\s*$/; // Case sensitive password-like

  // Full Privilege Requirement
  let ep_command = /^\/ep\s+(\d+(\.\d+)?)\s*$/i;
  let itemtest_command = /^\/itemtest\s+(\d+)(?:\s+(\d+))?\s*$/i;
  let weapontest_command = /^\/weapontest\s+(\d+)(?:\s+(\d+))?\s*$/i;
  let enemyweapontest_command = /^\/enemyweapontest\s+(\d+)\s*$/i;
  let clearcrates_command = /^\/clearcrates\s*$/i;
  let spawnfleet_command = /^\/spawnfleet\s*$/i;
  let spawnfish_command = /^\/spawnfish\s*$/i;
  let fleets_command = /^\/fleets\s*$/i;
  let resetachievements_command = /^\/resetachievements\s*$/i;
  let tp_command = /^\/tp\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i;
  let tp_other_command = /^\/tp\s+"([^"]+)"\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i;
  let enemytest_command = /^\/enemytest\s+(\d+)\s*$/i;
  let dummy_set_command = /^\/dummy set\s*$/i;
  let dummy_remove_command = /^\/dummy remove\s*$/i;
  let time_command = /^\/time\s+(\d+)\s*$/i;


  match = command.match(time_command);
  if (match) {
    if (player.privileges) {
        const inputVal = parseInt(match[1]);
        if (!isNaN(inputVal)) {
           // Input is 0-200. 
           // 0-100 maps to DAY_DURATION.
           // 100-200 maps to NIGHT_DURATION.
           
           let targetMs = 0;
           
           if (inputVal <= 100) {
               // Day Phase (0 to DAY_DURATION)
               const ratio = inputVal / 100;
               targetMs = ratio * DAY_DURATION;
           } else {
               // Night Phase (DAY_DURATION to TOTAL_CYCLE_DURATION)
               const ratio = (inputVal - 100) / 100;
               targetMs = DAY_DURATION + (ratio * NIGHT_DURATION);
           }
           
           // Clamp to safely handle 200+ or <0 if regex allowed it
           targetMs = targetMs % TOTAL_CYCLE_DURATION;
           cycleTime = targetMs;
           
           console.log(`[CMD] Time set to ${inputVal} (mapped to ${cycleTime}ms).`);
           sendNoticeMessage(player.username, `Time set to ${inputVal}`, 'server');
        }
    } else {
        console.log(`[CMD] Time command denied. Privileges: ${player.privileges}`);
        sendNoticeMessage(player.username, "Insufficient privileges.", 'server');
    }
  }

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
      console.log(`[CMD] Granting privileges to ${player.username}`);
      player.privileges = true;
      sendNoticeMessage(player.username, "Command privileges enabled for this session.", 'server');

      // Persistence Logic: If logged in, save to account
      if (player.clientId) {
          const client = clientManager.getClient(player.clientId);
          if (client && client.type === 'account' && client.accountName) {
              const account = clientManager.getAccount(client.accountName);
              if (account) {
                  account.privileges = true;
                  clientManager.saveAccount(client.accountName);
                  sendNoticeMessage(player.username, "Privileges permanently saved to account.", 'server');
              }
          }
      }
    } catch (err) {
      console.error('Error enabling privileges for', player && player.username, err);
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
    player.chassis.heatDispersion = value * player.engine.heatEfficiency; // For engine heat cooling
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
    const level = match[2] ? parseInt(match[2]) : 1; // Default to level 1 if not specified
    weaponTest(weaponNumber, level, player);
  }

  match = command.match(enemyweapontest_command);
  if (match) {
    const weaponNumber = parseInt(match[1]);
    enemyWeaponTest(weaponNumber, player);
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

  match = command.match(spawnfleet_command);
  if (match) {
    // Spawn fleet at player's X coordinate, Y = 310 (sea level)
    const spawnX = player.x;
    const spawnY = 310;

    const boatUsername = `Navy Ship ${fleetCounter}`;
    fleetCounter++; // Increment counter for next fleet

    // Compute distance from spawn origin and determine boat level
    const spawnOrigin = { x: 0, y: -400 };
    const dx = spawnX - spawnOrigin.x;
    const dy = spawnY - spawnOrigin.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let boatLevel = 1;
    if (distance >= 100000) {
      boatLevel = 3;
    } else if (distance >= 50000) {
      boatLevel = 2;
    }

    const boat = new NavySalvageBoat(
      boatUsername,
      50, 50, 200, // navy blue
      spawnX,
      spawnY,
      3, // default plane count
      boatLevel
    );

    // Add boat to enemies
    enemies.push(boat);

    // Determine plane levels based on distance (same as automatic spawns)
    let levels = null;
    if (distance < 20000) {
      levels = [1, 1];
    } else if (distance < 50000) {
      levels = [1, 1, 1];
    } else if (distance < 100000) {
      levels = [1, 1, 1, 2];
    } else if (distance < 150000) {
      levels = [2, 2, 2, 1, 1, 1];
    } else {
      levels = [2, 2, 2, 1, 1, 1];
    }

    // Spawn its planes with selected levels
    const planes = boat.spawnPlanes(levels);
    enemies.push(...planes);

    sendNoticeMessage(player.username, `Fleet spawned at (${Math.round(spawnX)}, ${spawnY}) with ${planes.length} planes.`, 'server');
    console.log(`Fleet boat ${boatUsername} spawned by admin at (${Math.round(spawnX)}, ${spawnY}) with ${planes.length} planes`);
  }

  match = command.match(spawnfish_command);
  if (match) {
    const fish = new Fish(Date.now(), player.x, player.y);
    animals.push(fish);
    sendNoticeMessage(player.username, `Spawned a fish at (${Math.round(player.x)}, ${Math.round(player.y)}).`, 'server');
  }

  // List all known fleet boats and their locations
  match = command.match(fleets_command);
  if (match) {
    const fleetBoats = enemies.filter(e => e.isFleetBoat);
    if (!fleetBoats || fleetBoats.length === 0) {
      sendNoticeMessage(player.username, 'No fleets detected.', 'server');
    } else {
      const lines = fleetBoats.map(b => `${b.username}: (${Math.round(b.x)}, ${Math.round(b.y)})`);
      // Send multiple messages if the list is long
      lines.forEach(line => sendNoticeMessage(player.username, line, 'server'));
    }
  }

  match = command.match(resetachievements_command);
  if (match) {
      if (player.privileges) {
          // Reset by re-initializing the achievements map with fresh instances
          syncPlayerAchievements(player, {}); 
          
          // Force save the empty state to disk immediately
          Object.values(player.achievements).forEach(ach => ach.save(player));
          
          // Push update to client immediately
          sendPlayerAchievements(player);
          sendNoticeMessage(player.username, "Achievements have been reset.", 'server');
      }
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

  match = command.match(dummy_set_command);
  if (match) {
    // Spawn a dummy plane at the player's current position
    const dummyUsername = `Dummy_${Date.now()}`;
    const dummy = new DummyPlane(dummyUsername, player.x, player.y);
    enemies.push(dummy);
    sendNoticeMessage(player.username, `Spawned dummy at (${Math.round(player.x)}, ${Math.round(player.y)})`, 'server');
    console.log(`Dummy ${dummyUsername} spawned by ${player.username} at (${player.x}, ${player.y})`);
  }

  match = command.match(dummy_remove_command);
  if (match) {
    // Remove all dummy planes
    const dummyCount = enemies.filter(e => e.isDummy).length;
    enemies = enemies.filter(e => !e.isDummy);
    sendNoticeMessage(player.username, `Removed ${dummyCount} dummy plane(s)`, 'server');
    console.log(`${player.username} removed ${dummyCount} dummy planes`);
  }
}

// Perform initial cleanup
clientManager.performDatabaseCleanup();

// Inactivity Check (Offset: 0s)
setInterval(() => {
  const now = millis();
  
  // Optimization: Don't do heavy filtering if no players
  if (players.length === 0) return;

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

// Physics feel should remain similar due to client-side interpolation.
// Consolidated Game Loop
// Reduced from 10ms (100Hz) to 20ms (50Hz) to drastically improve performance with multiple players.
// Physics feel should remain similar due to client-side interpolation.
setInterval(() => {
  if (players.length > 0 || projectiles.length > 0) rebuildSpatialGrid(); // Build grid once per frame if active
  if (players.length > 0) updatePlayers();
  if (enemies.length > 0) updateEnemies();
  if (players.length > 0 || animals.length > 0) updateAnimals();
  if (projectiles.length > 0) updateProjectiles();
  if (players.length > 0) updateCrates();
}, TICK_RATE_MS);

setInterval(() => { updateFleets() }, 5000);
setInterval(() => { if (events.length > 0) updateEvents() }, 1000); // Clean up old events every second

// CheckParties (Offset: 20s)
setInterval(() => {
    if (players.length > 0) {
        checkParties();
    }
}, 60000);

setInterval(() => { 
  updateShops(); 
}, 1000); // Check shop refresh every second

// Achievement Checks (Interval: 1s)
setInterval(() => {
    if (players.length > 0) {
        players.forEach(player => {
            // Achievement Check: Max Altitude (Above the Clouds!)
            if (player.y < -7000) {
                if (player.achievements && player.achievements['mile_high_club']) {
                    player.achievements['mile_high_club'].complete(player);
                }
            }

            // Achievement Check: Pacifist Run (Reach 100km zone)
            // 100km = 100,000 units.
            if (Math.abs(player.x) > 100000) {
                if (player.pacifist && player.achievements && player.achievements['pacifist_run']) {
                    player.achievements['pacifist_run'].complete(player);
                }
                // Achievement Check: Purist (Reach 100km with base gear)
                if (player.baseGearRun && player.achievements && player.achievements['purist']) {
                    player.achievements['purist'].complete(player);
                }
            }

            // Achievement Check: Brand Loyalty
            if (player.achievements && player.brandLoyalty && !player.failedBrandLoyalty) {
                 const brand = player.brandLoyalty;
                 const achKey = `${brand.toLowerCase()}_loyalist`;

                 if (player.achievements[achKey] && !player.achievements[achKey].completed) {
                    const checkComponent = (comp, requiredBrand) => {
                        if (!comp || !comp.name) return false;
                        return comp.name.startsWith(requiredBrand) && comp.name.endsWith("Lvl 10");
                    };

                    const validChassis = checkComponent(player.chassis, brand);
                    const validEngine = checkComponent(player.engine, brand);
                    const validWings = checkComponent(player.wings, brand);

                    if (validChassis && validEngine && validWings) {
                        player.achievements[achKey].complete(player);
                    }
                 }
            }
        });
    }
}, 1000);

setInterval(() => { if (pendingRespawns.length > 0) processPendingRespawns() }, 100); // Check pending respawns frequently

// SendAchievements (Offset: 40s)
// Optimization: Check rarely (every 5 mins), rely on event-based updates
setInterval(() => {
  if (players.length > 0) {
    // Only send if data changed? For now, just measure size.
    // players.forEach(p => sendPlayerAchievements(p)); 
  }
}, 300000); // 5 minutes interval

// AutoSave (Interval: 5 mins)
setInterval(() => {
  manageAutoSave();
}, AUTOSAVE_INTERVAL);

// Messages Cleanup (Interval: 1s)
setInterval(() => {
    const now = millis();
    if (players.length > 0) {
        players.forEach(p => {
            if (p.messages && p.messages.length > 0) {
                p.messages = p.messages.filter((msg) => now - msg[0] < 8000);
            }
        });
    }
    if (enemies.length > 0) {
        enemies.forEach(e => {
            if (e.messages && e.messages.length > 0) {
                e.messages = e.messages.filter((msg) => now - msg[0] < 8000);
            }
        });
    }
}, 1000);

// ========================================
// BROADCAST LOOPS (Server Push)
// ========================================

// Main Game State Broadcast (20Hz)
setInterval(() => {
    // Update Cycle Time
    cycleTime = (cycleTime + 50) % TOTAL_CYCLE_DURATION;

    if (players.length === 0) return;
    
    // Pre-calculate Global State that doesn't change per-player
    // 1. Global Chat Messages
    const globalMessages = [];
    // Only process messages if any exist to avoid iteration overhead
    let hasMessages = false;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (p.messages && p.messages.length > 0) {
            hasMessages = true;
            for (let j = 0; j < p.messages.length; j++) {
                const msg = p.messages[j];
                globalMessages.push({
                    id: msg[0], 
                    username: p.username, 
                    message: msg[1]
                });
            }
        }
    }

    // 2. Pre-serialize ALL entities once (Huge GC optimization)
    // We create the "public" version of all players once.
    const allPublicPlayers = players.map(p => p.toClientData(false));
    
    // Players map for fast private lookup
    const playerMap = new Map();
    players.forEach(p => playerMap.set(p.username, p));

    const allEnemies = enemies.map(enemy => {
        if (enemy.toClientData) return enemy.toClientData();
        return {
            type: enemy.type,
            username: enemy.username,
            faction: enemy.faction,
            x: +enemy.x.toFixed(2),
            y: +enemy.y.toFixed(2),
            angle: +enemy.angle.toFixed(3),
            vx: +enemy.vx.toFixed(2),
            vy: +enemy.vy.toFixed(2),
            r: enemy.r, g: enemy.g, b: enemy.b,
            size: enemy.size,
            hull: enemy.hull ?? enemy.chassis?.hull ?? 0,
            maxHull: enemy.maxHull ?? enemy.chassis?.maxHull ?? 1
        };
    });

    const allProjectiles = projectiles.map(p => p.toClientData());
    const allCrates = crates.map(c => c.toClientData());
    // Animals and Events are simple objects, we can filter them directly or map them if needed
    // Assuming animals don't have a complex toClientData yet, or it's lightweight. 
    // If they do, map here. For now, use raw animals array as they are simple.

    // Broadcast to each connected client
    playerSockets.forEach((ws, username) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        
        const requestingPlayer = getPlayerOrRespawningPlayer(username);
        if (!requestingPlayer) return; 

        const cullingDistance = 4000;
        const cullingSq = cullingDistance * cullingDistance;
        const extendedCulling = 5000;
        const extendedSq = extendedCulling * extendedCulling;
        const crateSq = 2000 * 2000;

        // 1. Players: Combine pre-serialized public data with private data for self
        const serializedPlayers = [];
        for (let i = 0; i < allPublicPlayers.length; i++) {
            const pData = allPublicPlayers[i];
            
            // Check visibility matches
            let isVisible = false;
            // Always include self
            if (pData.username === username) {
                // For self, we need to regenerate to include private data? 
                // Or just merge it? Merging is safer.
                // Actually, calling toClientData(true) for just ONE player (self) is cheap.
                const myRealPlayer = playerMap.get(username);
                if (myRealPlayer) {
                    serializedPlayers.push(myRealPlayer.toClientData(true));
                }
                continue; 
            }

            // Check party
            if (requestingPlayer.party && pData.party && requestingPlayer.party.name === pData.party.name) {
                isVisible = true;
            } else {
                // Check distance
                const dx = pData.x - requestingPlayer.x;
                const dy = pData.y - requestingPlayer.y;
                if (dx*dx + dy*dy <= cullingSq) isVisible = true;
            }

            if (isVisible) {
                serializedPlayers.push(pData);
            }
        }

        // 2. Enemies (Filter pre-serialized)
        const filteredEnemies = [];
        for (let i = 0; i < allEnemies.length; i++) {
            const e = allEnemies[i];
            const dx = e.x - requestingPlayer.x;
            const dy = e.y - requestingPlayer.y;
            if (dx*dx + dy*dy <= cullingSq) {
                filteredEnemies.push(e);
            }
        }

        // 3. Animals (Filter raw)
        const filteredAnimals = [];
        for (let i = 0; i < animals.length; i++) {
            const a = animals[i];
            const dx = a.x - requestingPlayer.x;
            const dy = a.y - requestingPlayer.y;
            if (dx*dx + dy*dy <= cullingSq) {
                filteredAnimals.push(a);
            }
        }

        // 4. Projectiles (Filter pre-serialized)
        const filteredProjectiles = [];
        for (let i = 0; i < allProjectiles.length; i++) {
            const p = allProjectiles[i];
            const dx = p.x - requestingPlayer.x;
            const dy = p.y - requestingPlayer.y;
            if (dx*dx + dy*dy <= cullingSq) {
                filteredProjectiles.push(p);
            }
        }

        // 5. Crates (Filter pre-serialized)
        const filteredCrates = [];
        for (let i = 0; i < allCrates.length; i++) {
            const c = allCrates[i];
            const dx = c.x - requestingPlayer.x;
            const dy = c.y - requestingPlayer.y;
            if (dx*dx + dy*dy <= crateSq) { // 2000m range
                filteredCrates.push(c);
            }
        }

        // 6. Events (Filter raw)
        const filteredEvents = [];
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            const dx = e.x - requestingPlayer.x;
            const dy = e.y - requestingPlayer.y;
            if (dx*dx + dy*dy <= extendedSq) {
                filteredEvents.push(e);
            }
        }

        sendMessage(ws, {
            type: 'gamestate_update',
            time: cycleTime, 
            players: serializedPlayers,
            messages: globalMessages,
            enemies: filteredEnemies,
            animals: filteredAnimals,
            projectiles: filteredProjectiles,
            crates: filteredCrates,
            events: filteredEvents
        });
    });

}, 50);

// Low-Frequency Updates (1Hz) - Shops only
setInterval(() => {
    if (players.length === 0) return;
    
    const shopsData = Array.from(shops.values()).map(shop => shop.toClientData());
    
    playerSockets.forEach((ws, username) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendMessage(ws, { 
            type: 'low_freq_update', 
            shops: shopsData
            // Community list sent event-based via broadcastCommunityUpdate
        });
    });
}, 1000);

function broadcastCommunityUpdate() {
    // Community List (All Players)
    const communityList = players.map(p => ({
        username: p.username,
        r: p.r,
        g: p.g,
        b: p.b
    }));
    
    playerSockets.forEach((ws) => {
         if (ws.readyState === WebSocket.OPEN) {
             sendMessage(ws, {
                 type: 'low_freq_update',
                 community: communityList
             });
         }
    });
}

// Graceful Shutdown
function handleShutdown(signal) {
    console.log(`\nReceived ${signal}. Saving all players before shutdown...`);
    
    // Check if we have players to save
    if (players.length > 0) {
        players.forEach(player => {
            console.log(`Saving player: ${player.username}`);
            try {
                // Force save state
                savePlayerStateSync(player);
            } catch (err) {
                console.error(`Failed to save player ${player.username}:`, err);
            }
        });
        console.log(`All ${players.length} players saved successfully.`);
    } else {
        console.log('No active players to save.');
    }

    // Save Client Manager data (Clients & Accounts linkings)
    try {
        clientManager.saveAllSync();
    } catch (err) {
        console.error("Failed to save client manager data:", err);
    }

    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
