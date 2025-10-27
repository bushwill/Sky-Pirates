import { Plane } from './Plane.mjs';
import { createEnemyGun } from './WeaponList.mjs';
import { createEnemyEngine, createEnemyChassis, createEnemyWings } from './ComponentList.mjs';
import { MapObject } from './Map.mjs';
import { mapData } from './App.mjs';

export class EnemyPlane extends Plane {
  constructor(username, r, g, b, x, y, faction = null, target = null) {
    super('air', username, r, g, b, x, y); // Default to 'air', will be updated by checkPlayerBiome()
    this.faction = faction;
    this.aiState = "idle";
    this.target = target;
  }

  updateAI() {
    console.log("Can't update ai of unspecified enemy");
  }

  findTarget() {
    console.log("Can't find target of unspecified enemy");
  }

  moveTowardTarget() {
    console.log("Can't move toward target of unspecified enemy");
  }
}

export class EnemyBoat {
  constructor(username, r, g, b, x, y, faction = null, target = null) {
    this.type = 'Boat';
    this.biome = 'water'; // Default to 'water', will be updated by checkPlayerBiome()
    this.username = username;
    this.r = r;
    this.g = g;
    this.b = b;
    this.x = x;
    this.y = y;
    this.faction = faction;
    this.angle = 0;
    this.target = target;
    this.keys = {};
    this.messages = [];
    // Default size and chassis so projectiles can collide and damage hull
    this.size = 25;
    // Boats don't get plane chassis; give them a simple hull property instead
    this.maxHull = 100; // reasonable default for enemy boats
    this.hull = this.maxHull;
  }

  updateAI() {
    console.log("Can't update ai of unspecified enemy");
  }

  findTarget() {
    console.log("Can't find target of unspecified enemy");
  }

  // Called when this entity takes damage from a projectile
  onDamaged(projectile) {
    // Apply damage to hull
    if (typeof this.hull === 'number') {
      this.hull -= projectile.damage;
    } else if (this.chassis && typeof this.chassis.hull === 'number') {
      this.chassis.hull -= projectile.damage;
    }
  }
}

export class NavySalvagePlane extends EnemyPlane {
  constructor(username, r, g, b, x, y) {
    super(username, r, g, b, x, y, 'navy');
    this.gun1 = createEnemyGun(0, 1);
    this.gun2 = null;
    this.engine = createEnemyEngine(0, 1);
    this.chassis = createEnemyChassis(0, 1);
    this.wings = createEnemyWings(0, 1);
    this.isFiring = false;
    this.aimPoint = { x: null, y: null };
    this.t_x = x; // Initialize target coordinates to current position
    this.t_y = y;
    this.fleetBoat = null;
    this.crates = [];
    this.searchDirection = Math.random() < 0.5 ? -1 : 1;
    this.targetCrate = null;
    this.lastCrateSearchTime = 0;
    this.lastHostileCheckTime = 0;
    this.crateTargetStartiTime = 0; // Track when we started targeting a crate
  }

  updateAI(players, crates, enemies) {
    // Initialize state
    if (!this.aiState || this.aiState === "idle") {
      this.aiState = "searching";
    }

    // Global threat check (runs in all states)
    this.checkForThreats(players);

    // State machine
    if (this.aiState === "searching") {
      this.patrolAndCollect();
    } else if (this.aiState === "returning") {
      ``
      // Returning to fleet boat to drop off crates
    }
    else if (this.aiState === "attacking") {
      this.attackPlayer(players);
    }
  }

  // Helper: Calculate distance between two points
  distanceTo(target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Helper: Calculate angle difference (normalized to -π to π)
  angleDiffTo(targetAngle) {
    let diff = targetAngle - this.angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  // Helper: Navigate toward a target position
  navigateTo(target, fullThrottle = false, alignThreshold = 0.3) {
    const dx = target.x - this.x;
    const dy = target.y - this.y - 50;
    const targetAngle = Math.atan2(dy, dx);
    const angleDiff = this.angleDiffTo(targetAngle);

    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;

    if (fullThrottle || Math.abs(angleDiff) < alignThreshold) {
      this.engine.power = this.engine.maxPower;
    } else {
      this.engine.power = this.engine.minPower;
    }
  }

  // Helper: Clear targeting state
  clearTarget() {
    this.target = null;
    this.t_x = this.x; // Set to current position instead of null
    this.t_y = this.y;
  }

  // Reset movement keys to a neutral state to avoid stuck turning
  resetMovementKeys() {
    this.keys.a = false;
    this.keys.d = false;
    this.keys.w = false;
    this.keys.s = false;
    this.keys.mouse = false;
    this.keys.f = false;
    this.engine.power = this.engine ? this.engine.minPower : 0;
  }

  // Reset combat-related flags and selected weapons
  resetCombatState() {
    this.isFiring = false;
    this.selectedGun = 0;
    this.resetMovementKeys();
  }

  // Enter searching (patrol) state with conservative defaults
  enterSearchingState() {
    this.aiState = 'searching';
    this.clearTarget();
    this.resetMovementKeys();
  }

  // Helper: Flip search direction when moving away from boat or at boundaries
  ensureDirectionRelativeToBoat(distanceFromBoat, maxPatrolDistance) {
    // If loaded with crates, prefer returning toward boat
    if (this.crates && this.crates.length >= 5) {
      const movingAwayFromBoat = (this.x > this.fleetBoat.x && this.searchDirection > 0) ||
        (this.x < this.fleetBoat.x && this.searchDirection < 0);

      if (movingAwayFromBoat) this.searchDirection *= -1;
    }

    // Reverse at patrol boundary
    if (distanceFromBoat > maxPatrolDistance) {
      const movingAwayFromBoat = (this.x > this.fleetBoat.x && this.searchDirection > 0) ||
        (this.x < this.fleetBoat.x && this.searchDirection < 0);

      if (movingAwayFromBoat) this.searchDirection *= -1;
    }
  }

  // Helper: Reverse if recovery zones are nearby and we're heading toward them
  checkRecoveryZonesAndMaybeReverse(buffer) {
    const recoveryZones = mapData?.biomes?.filter(b => b.type === 'recoveryzone') || [];
    for (const zone of recoveryZones) {
      const distToZone = Math.abs(this.x - zone.center);
      if (distToZone < zone.radius + buffer) {
        const movingTowardZone = (this.x < zone.center && this.searchDirection > 0) ||
          (this.x > zone.center && this.searchDirection < 0);

        if (movingTowardZone) this.searchDirection *= -1;
      }
    }
  }

  // Helper: compute the desired patrol angle based on search direction and altitude
  computePatrolTargetAngle(targetAltitude, diffAmount = 10) {
    const altitudeDiff = this.y - targetAltitude; // Positive = too low
    let targetAngle;

    if (this.searchDirection > 0) {
      // Want to go RIGHT (0 radians)
      if (altitudeDiff > diffAmount || this.biome === 'water') {
        targetAngle = -0.3; // climb slightly
      } else if (altitudeDiff < -diffAmount) {
        targetAngle = 0.3; // descend slightly
      } else {
        targetAngle = 0; // level
      }
    } else {
      // Want to go LEFT (π radians)
      if (altitudeDiff > diffAmount || this.biome === 'water') {
        targetAngle = Math.PI + 0.3; // climb up-left
      } else if (altitudeDiff < -diffAmount) {
        targetAngle = Math.PI - 0.3; // descend slightly
      } else {
        targetAngle = Math.PI; // level
      }
    }

    return targetAngle;
  }

  // Helper: apply turning logic toward a target angle (includes 180-degree special-case)
  applyTurningToward(targetAngle, deadzone = 0.05) {
    // Normalize angle difference to range (-PI, PI]
    let diff = targetAngle - this.angle;
    const TWO_PI = Math.PI * 2;
    diff = ((diff + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

    if (diff < -deadzone) {
      this.keys.a = true;
      this.keys.d = false;
    } else if (diff > deadzone) {
      this.keys.d = true;
      this.keys.a = false;
    } else {
      this.keys.a = false;
      this.keys.d = false;
    }

    // Reduce throttle while making large-angle maneuvers
    if (this.engine) {
      this.engine.power = Math.abs(diff) > 0.1 ? this.engine.minPower : this.engine.maxPower;
    }

    return diff;
  }

  // Helper: throttle and drop crate behavior
  applyThrottleAndDropLogic(distToBoat) {
    // Throttle control - full power while patrolling
    this.keys.w = true;
    this.keys.s = false;

    // Drop crates when close to the boat
    if (this.crates && this.crates.length > 0 && distToBoat <= 50) {
      this.keys.f = true; // request drop
    } else {
      this.keys.f = false;
    }
  }

  // Simple patrol: fly straight horizontally above ocean, collecting crates passively
  patrolAndCollect() {
    if (!this.fleetBoat) return;

    const TARGET_ALTITUDE = 280;
    const MAX_PATROL_DISTANCE = 10000;

    const distanceFromBoat = Math.abs(this.x - this.fleetBoat.x);

    // Handle direction changes due to load or boundaries
    this.ensureDirectionRelativeToBoat(distanceFromBoat, MAX_PATROL_DISTANCE);

    // Recovery zones
    this.checkRecoveryZonesAndMaybeReverse(500);

    // Compute desired patrol angle
    const targetAngle = this.computePatrolTargetAngle(TARGET_ALTITUDE);

    // Apply turning toward that angle
    const angleDiff = this.applyTurningToward(targetAngle, 0.05);

    // Throttle and crate drop behavior
    const distToBoat = this.fleetBoat ? Math.sqrt(
      Math.pow(this.x - this.fleetBoat.x, 2) +
      Math.pow(this.y - this.fleetBoat.y, 2)
    ) : Infinity;

    this.applyThrottleAndDropLogic(distToBoat);

    // Stop firing while patrolling
    this.keys.mouse = false;
    this.isFiring = false;
    this.selectedGun = 0;
  }

  // Check for threats and drop crates if needed
  checkForThreats(players) {
    const now = Date.now();
    if (now - this.lastHostileCheckTime < 1000) return;
    this.lastHostileCheckTime = now;

    // Check for hostile players with crates nearby (500m) - switch to attacking
    const hostilePlayer = this.findHostilePlayer(players);
    if (hostilePlayer) {
      this.target = hostilePlayer;
      this.aiState = "attacking";
    }
  }

  findHostilePlayer(players) {
    if (!players || players.length === 0) return null;

    const AGGRO_RANGE = 500; // 500m

    for (const player of players) {
      // Skip players in recovery zones (safe zones)
      if (player.biome === 'recovery') continue;

      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Attack if: player has crates AND is within 500m
      if ((dist < AGGRO_RANGE && player.crates && player.crates.length > 0) || (player.navyTargeted && dist < 2000)) {
        player.markNavyActivity(); // Mark them as navy target
        this.keys.f = true;
        return player;
      }
    }
    return null;
  }

  attackPlayer(players) {
    this.keys.f = this.crates && this.crates.length > 0;

    const targetPlayer = this.target && players.find(p => p.username === this.target.username);

    if (!targetPlayer || targetPlayer.biome === 'recovery') {
      this.enterSearchingState();
      return;
    }

    this.target = targetPlayer;

    const hasCrates = this.target.crates && this.target.crates.length > 0;
    if (!hasCrates && !this.target.navyTargeted) {
      this.enterSearchingState();
      return;
    }

    this.combatTargets();
  }

  combatTargets() {
    if (!this.target) return;

    const distToTarget = this.distanceTo(this.target);
    const projectileSpeed = this.gun1?.projectileSpeed ?? 20;
    const timeToHit = distToTarget / projectileSpeed;

    // Predictive aiming
    const predictedX = this.target.x + (this.target.vx ?? 0) * timeToHit;
    const predictedY = this.target.y + (this.target.vy ?? 0) * timeToHit;
    const t = Math.random();
    const aimX = this.target.x + (predictedX - this.target.x) * t;
    const aimY = this.target.y + (predictedY - this.target.y) * t;

    const aimAngle = Math.atan2(aimY - this.y, aimX - this.x);
    const angleDiff = this.angleDiffTo(aimAngle);

    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;
    this.engine.power = Math.abs(angleDiff) > 0.1 ? this.engine.minPower : this.engine.maxPower;

    this.t_x = aimX;
    this.t_y = aimY;
    this.aimPoint = { x: aimX, y: aimY };

    // Shooting logic
    const inRange = distToTarget < 1000 && this.gun1;
    const gunAngleDiff = inRange ? Math.abs(this.angleDiffTo(aimAngle)) : Infinity;
    const canShoot = inRange && gunAngleDiff < (this.gun1.maxAngle ?? Math.PI / 4);

    this.selectedGun = canShoot ? 1 : 0;
    this.keys.mouse = canShoot;
    this.isFiring = canShoot;
  }

  // Crate management methods
  attachCrate(crate) {
    if (!this.crates) this.crates = [];
    this.crates.push(crate);
    crate.attach(this.username);
  }

  detachCrate(crate) {
    if (!this.crates) return;
    const index = this.crates.indexOf(crate);
    if (index !== -1) {
      this.crates.splice(index, 1);
      crate.detach();
    }
  }

  detachAllCrates() {
    if (!this.crates) return;
    this.crates.forEach(crate => crate.detach());
    this.crates = [];
  }

  // Exclude circular references from serialization
  toJSON() {
    const { fleetBoat, ...rest } = this;
    return rest;
  }

  // Lightweight serialization for client - only send essential data
  toClientData() {
    return {
      type: this.type,
      username: this.username,
      faction: this.faction,
      x: this.x,
      y: this.y,
      angle: this.angle,
      vx: this.vx,
      vy: this.vy,
      r: this.r,
      g: this.g,
      b: this.b,
      size: this.size,
      hull: this.chassis?.hull ?? 0,
      maxHull: this.chassis?.maxHull ?? 1,
      engine: this.engine ? { power: this.engine.power } : null,
      isFiring: this.isFiring,
      aimPoint: this.aimPoint,
      aiState: this.aiState
    };
  }

  // Override damage handling to retaliate against attacker
  onDamaged(projectile, players) {
    // Call parent method to apply damage
    super.onDamaged(projectile);

    // Find the attacking player and mark them as target
    if (projectile.owner && players) {
      const attacker = players.find(p => p.username === projectile.owner);
      if (attacker) {
        this.target = attacker;
        this.aiState = "attacking";
        attacker.markNavyActivity(); // Mark as navy target
      }
    }
  }
}

// A stationary enemy boat that only shoots at players
export class NavySalvageBoat extends EnemyBoat {
  constructor(username, r, g, b, x, y, planeCount = 3) {
    super(username, r, g, b, x, y, 'navy');
    this.angle = -Math.PI / 2; // Point boat upward so gun can cover upper hemisphere
    this.maxHull = 400;
    this.hull = this.maxHull;
    this.gun1 = createEnemyGun(1, 1); // You can adjust gun type as needed
    this.gun2 = null;
    this.isFiring = false;
    this.aimPoint = { x: null, y: null };
    this.t_x = x; // Initialize target position to own position
    this.t_y = y;
    this.planes = []; // Array of planes belonging to this fleet
    this.planeCount = planeCount; // How many planes this boat should command
    this.isFleetBoat = true; // Mark as a fleet headquarters
    this.aiState = "idle"; // Track AI state for debugging
  }

  updateAI(players) {
    // Early exit if no players to reduce CPU usage
    if (!players || players.length === 0) {
      this.resetToPassive();
      return;
    }

    // Look for any player with navyTargeted = true
    if (!this.target) {
      this.findTarget(players);
    }

    // Check if current target is still valid
    if (this.target) {
      // Update target reference to current player object (prevents stale references)
      const targetPlayer = players.find(p => p.username === this.target.username);

      if (!targetPlayer) {
        // Target disconnected
        this.resetToPassive();
        this.findTarget(players);
        return;
      }

      // Update reference
      this.target = targetPlayer;

      // If target no longer has navyTargeted flag, clear target
      if (!this.target.navyTargeted) {
        this.resetToPassive();
        return;
      }
    }

    // If we have a valid target, mark them as spotted and engage
    if (this.target && this.target.navyTargeted) {
      this.aiState = "attacking";
      this.target.markNavyActivity();
      this.combatTargets();
    } else {
      // No valid target, stay idle
      this.aiState = "idle";
      this.resetToPassive();
      // While idle, allow the boat's gun to track the nearest nearby player (no firing)
      this.trackNearestPlayerWhileIdle(players);
    }
  }

  // While idle, track the nearest nearby player with the gun (but don't engage)
  trackNearestPlayerWhileIdle(players) {
    if (!players || players.length === 0) return;

    const TRACK_RANGE = 800; // meters to start passively tracking
    const trackRangeSq = TRACK_RANGE * TRACK_RANGE;
    let nearest = null;
    let minDistSq = Infinity;

    // Single pass: find nearest non-recovery player within track range
    for (const player of players) {
      if (!player || player.biome === 'recovery') continue;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= trackRangeSq && d2 < minDistSq) {
        minDistSq = d2;
        nearest = player;
      }
    }

    if (!nearest) {
      // No one nearby to track; reset aim to boat
      this.t_x = this.x;
      this.t_y = this.y;
      this.aimPoint = { x: null, y: null };
      return;
    }

    // Predict where the player will be shortly for smoother tracking.
    // Use sqrt only once to compute a time-to-lead heuristic.
    const projectileSpeed = this.gun1?.projectileSpeed ?? 20;
    const dist = Math.sqrt(minDistSq);
    const timeToLead = Math.min(2, Math.max(0.2, dist / (projectileSpeed + 1)));
    const predictedX = nearest.x + (nearest.vx ?? 0) * timeToLead;
    const predictedY = nearest.y + (nearest.vy ?? 0) * timeToLead;

    this.t_x = predictedX;
    this.t_y = predictedY;
    this.aimPoint = { x: predictedX, y: predictedY };
    // Passive only: don't set firing flags here
  }

  resetToPassive() {
    this.target = null;
    this.t_x = this.x; // Set to current position instead of null
    this.t_y = this.y;
    this.isFiring = false;
    this.keys = {};
    this.aiState = "idle";
  }

  findTarget(players) {
    if (!players || players.length === 0) {
      this.target = null;
      return null;
    }
    const AGGRO_RANGE = 500;
    const aggroRangeSq = AGGRO_RANGE * AGGRO_RANGE;

    // Single pass: prefer players carrying crates within aggro range; otherwise
    // prefer the nearest player with navyTargeted flag.
    let nearestTargeted = null;
    let nearestTargetedDistSq = Infinity;

    for (const player of players) {
      if (!player || player.biome === 'recovery') continue;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const d2 = dx * dx + dy * dy;

      // Immediate priority: player with crates within AGGRO_RANGE
      if (player.crates && player.crates.length > 0 && d2 <= aggroRangeSq) {
        player.markNavyActivity();
        this.target = player;
        return player;
      }

      // Otherwise, track nearest navyTargeted player as fallback
      if (player.navyTargeted && d2 < nearestTargetedDistSq) {
        nearestTargetedDistSq = d2;
        nearestTargeted = player;
      }
    }

    this.target = nearestTargeted;
    return nearestTargeted;
  }

  combatTargets() {
    if (!this.target) return;

    const targetX = this.target.x;
    const targetY = this.target.y;
    const targetVX = this.target.vx ?? 0;
    const targetVY = this.target.vy ?? 0;

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq); // computed once for time/thresholds

    const projectileSpeed = this.gun1?.projectileSpeed ?? 20;
    const timeToHit = dist / projectileSpeed;
    const predictedX = targetX + targetVX * timeToHit;
    const predictedY = targetY + targetVY * timeToHit;

    // Randomly select a spot between current and predicted position
    const t = Math.random();
    const aimX = targetX + (predictedX - targetX) * t;
    const aimY = targetY + (predictedY - targetY) * t;

    // Set t_x and t_y for updateGuns to use
    this.t_x = aimX;
    this.t_y = aimY;
    this.aimPoint = { x: aimX, y: aimY };

    const shootDistance = 1000;
    if (dist < shootDistance && this.gun1) {
      this.selectedGun = 1;
      this.keys.mouse = true;
      this.isFiring = true;
    } else {
      this.keys.mouse = false;
      this.isFiring = false;
    }
  }

  // Spawn planes for this fleet
  spawnPlanes() {
    const newPlanes = [];
    for (let i = 0; i < this.planeCount; i++) {
      const planeX = this.x;
      const planeY = this.y - 310;

      const planeUsername = `Navy-Plane-${this.username.split('-')[2]}-${i + 1}`; // e.g. Navy-Plane-1-1, Navy-Plane-1-2
      const plane = new NavySalvagePlane(
        planeUsername,
        50, 50, 200, // navy blue
        planeX,
        planeY
      );

      plane.fleetBoat = this; // Give plane reference to its commanding boat
      this.planes.push(plane);
      newPlanes.push(plane);
    }
    console.log(`Fleet boat ${this.username} spawned ${this.planeCount} planes`);
    return newPlanes;
  }

  // Override damage handling to mark player as navy target
  onDamaged(projectile, players) {
    // Call parent method to apply damage
    super.onDamaged(projectile);

    // Find the attacking player and mark them as navy target
    if (projectile.owner) {
      const attacker = players?.find(p => p.username === projectile.owner);
      if (attacker) {
        attacker.markNavyActivity();
      }
    }
  }

  // Exclude circular references from serialization
  toJSON() {
    const { planes, ...rest } = this;
    return rest;
  }

  // Lightweight serialization for client - only send essential data
  toClientData() {
    return {
      type: this.type,
      username: this.username,
      faction: this.faction,
      x: this.x,
      y: this.y,
      angle: this.angle,
      vx: this.vx,
      vy: this.vy,
      r: this.r,
      g: this.g,
      b: this.b,
      size: this.size,
      hull: this.hull,
      maxHull: this.maxHull,
      gun1: this.gun1 ? { angle: this.gun1.angle } : null,
      isFiring: this.isFiring,
      aimPoint: this.aimPoint,
      aiState: this.aiState
    };
  }
}
