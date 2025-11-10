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

// Helper: map plane level/type to a human-friendly label.
// Placed here (after basic enemy classes) so it's not at the top of the file
// but still available to the NavySalvagePlane/NavySalvageBoat logic below.
function planeLabelForLevel(level) {
  switch (level) {
    case 1:
      return 'Navy Fighter';
    case 2:
      return 'Navy Officer';
    default:
      return `Navy Craft L${level}`;
  }
}

export class NavySalvagePlane extends EnemyPlane {
  // Constructor: build components and initialize state
  constructor(username, r, g, b, x, y, level = 1) {
    super(username, r, g, b, x, y, 'navy');
    this.level = level || 1;

    // Components (level-scaled)
    this.gun1 = createEnemyGun(0, this.level);
    this.gun2 = null;
    this.engine = createEnemyEngine(0, this.level);
    this.chassis = createEnemyChassis(0, this.level);
    this.wings = createEnemyWings(0, this.level);

    // State
    this.isFiring = false;
    this.aimPoint = { x: null, y: null };
    this.t_x = x;
    this.t_y = y;
    this.fleetBoat = null; // assigned when joining a fleet
    this.crates = [];
    this.searchDirection = Math.random() < 0.5 ? -1 : 1;
    this.targetCrate = null;
    this.lastCrateSearchTime = 0;
    this.lastHostileCheckTime = 0;
    this.crateTargetStartiTime = 0;

    // Preferred patrol altitude
    this.patrolAltitude = 280;
  }

  updateAI(players, crates, enemies) {

    // Initialize AI state if missing
    if (!this.aiState || this.aiState === 'idle') this.enterSearchingState();

    // Use helper to detect threats; the helper may set this.aiState = 'attacking' and select this.target
    // but it will not call the attacking handler itself. We keep updateAI as a simple dispatcher.
    this.checkForThreats(players);

    // If we have no fleet, ensure we're in seekFleet state (unless we've been set to attacking)
    if (!this.fleetBoat && this.aiState !== 'attacking') {
      if (this.aiState !== 'seekFleet') {
        this.aiState = 'seekFleet';
        this._ensureSeekStateInitialized();
      }
    }

    // If we're joined to a fleet and not attacking, decide to return when loaded
    if (this.fleetBoat && this.aiState !== 'attacking' && this.crates && this.crates.length >= 5) {
      this.aiState = 'returning';
    }

    // Single dispatch: call the appropriate handler exactly once
    switch (this.aiState) {
      case 'attacking':
        this.handleAttacking(players);
        break;
      case 'seekFleet':
        this.handleSeekFleet(enemies);
        break;
      case 'returning':
        this.handleReturning(crates);
        break;
      case 'searching':
      default:
        this.handleSearching();
        break;
    }
  }

  // --- State handlers (small and easy to locate) ---
  handleSearching() {
    // Maintain horizontal patrol at patrolAltitude and pick up crates as we pass
    // If too far from boat, bias search towards the boat direction
    if (this.fleetBoat) {
      const dx = this.fleetBoat.x - this.x;
      const distSq = dx * dx + (this.fleetBoat.y - this.y) * (this.fleetBoat.y - this.y);
      const FAR_THRESHOLD = 10000 * 10000; // squared distance threshold (10000 units)
      if (distSq > FAR_THRESHOLD) {
        // head toward the boat horizontally
        this.searchDirection = dx >= 0 ? 1 : -1;
      }
    }

    // Use existing patrol logic to maintain altitude and gather crates
    this.patrolAndCollect();
  }

  handleReturning(crates) {
    if (!this.fleetBoat) { this.enterSearchingState(); return; }

    // Desired altitude (prefer patrolAltitude) but avoid recovery biome
    let desiredY = this.patrolAltitude;
    try {
      const biomeAtDesired = mapData.getBiomeAtPosition(this.fleetBoat.x, desiredY);
      if (biomeAtDesired === 'recovery') desiredY -= 100;
    } catch (e) { desiredY = this.fleetBoat.y - 50; }

    // Compute horizontal base direction toward the fleet boat and keep a gentle pitch
    const dx = this.fleetBoat.x - this.x;
    const dy = desiredY - this.y;
    const baseAngle = dx >= 0 ? 0 : Math.PI; // 0 = right, PI = left

    // Adjust pitch slightly based on altitude difference (avoid diving into sea)
    const altitudeDiff = this.y - desiredY;
    const DIFF_AMOUNT = 10;
    let targetAngle = baseAngle;
    if (baseAngle === 0) {
      if (altitudeDiff > DIFF_AMOUNT || this.biome === 'water') targetAngle = -0.3; // climb
      else if (altitudeDiff < -DIFF_AMOUNT) targetAngle = 0.3; // descend a bit
      else targetAngle = 0;
    } else {
      if (altitudeDiff > DIFF_AMOUNT || this.biome === 'water') targetAngle = Math.PI + 0.3;
      else if (altitudeDiff < -DIFF_AMOUNT) targetAngle = Math.PI - 0.3;
      else targetAngle = Math.PI;
    }

    const angleDiff = this.applyTurningToward(targetAngle, 0.05);
    // Throttle to move toward boat
    if (this.engine) this.engine.power = Math.abs(angleDiff) < 0.6 ? this.engine.maxPower : this.engine.minPower;

    // If very close to the boat, transfer/drop crates and return to searching
    const distSq = dx * dx + (this.fleetBoat.y - this.y) * (this.fleetBoat.y - this.y);
    const DROP_DIST = 50;
    const closeHorizontal = Math.abs(this.x - this.fleetBoat.x) < 80;
    const closeVertical = Math.abs(this.y - this.fleetBoat.y) < 120;
    if (distSq <= DROP_DIST * DROP_DIST || (closeHorizontal && closeVertical)) {
      if (this.crates && this.crates.length > 0 && Array.isArray(crates)) {
        const toTransfer = this.crates.slice();
        for (const c of toTransfer) {
          const gi = crates.indexOf(c);
          if (gi !== -1) crates.splice(gi, 1);
          if (this.fleetBoat && typeof this.fleetBoat.storeCrate === 'function') this.fleetBoat.storeCrate(c);
          else c.detach();
          c.removedFromWorld = true;
        }
        this.crates = [];
        if (typeof this.updatePlane === 'function') this.updatePlane();
      }
      // pick a new random search direction and resume searching
      this.searchDirection = Math.random() < 0.5 ? -1 : 1;
      this.aiState = 'searching';
      this.keys.f = true;
      return;
    }
    this.keys.f = false;
  }

  handleAttacking(players) {
    // If we have no target or the target is no longer valid, switch back to searching
    if (!this.target || this.target.biome === 'recovery') {
      this.enterSearchingState();
      return;
    }

    // Ensure target is still in range for engagement; otherwise resume searching
    const ATTACK_KEEP_RANGE = 2500; // if target goes beyond this, give up
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > ATTACK_KEEP_RANGE * ATTACK_KEEP_RANGE) {
      this.aiState = 'searching';
      this.searchDirection = Math.random() < 0.5 ? -1 : 1;
      this.target = null;
      return;
    }

    // Use existing combat routines to pursue and engage
    this.attackPlayer(players);
  }

  // --- Seek & join helpers ---
  _ensureSeekStateInitialized() {
    if (this.seekingFleet) return;
    this.seekingFleet = true;
    this.searchDirection = Math.random() < 0.5 ? -1 : 1;
    this.seekTargetBoat = null;
    this.lastSeekScanTime = 0;
    this.t_x = this.x + this.searchDirection * 5000;
    this.t_y = this.y;
  }

  // When we have no fleet, actively seek the nearest fleet boat in our chosen direction
  handleSeekFleet(enemies) {
    // If we already locked onto a seekTargetBoat, attempt to join it
    if (this._handleSeekLockAndJoin(enemies)) return;

    // Otherwise scan for a nearby fleet in our chosen horizontal direction
    if (this._scanForFleetAndLock(enemies)) return;

    // If nothing found for now, continue horizontal searching (keeps altitude)
    this._continueHorizontalSearch();
  }

  _handleSeekLockAndJoin(enemies) {
    if (!this.seekTargetBoat) return false;
    if (!this.seekTargetBoat.isFleetBoat || enemies.indexOf(this.seekTargetBoat) === -1) {
      this.seekTargetBoat = null;
      return false;
    }

    // Fly horizontally toward the boat at patrol altitude
    const dx = this.seekTargetBoat.x - this.x;
    const distanceFromBoat = Math.abs(dx);
    this.searchDirection = dx >= 0 ? 1 : -1;
    this.flyHorizontallyAtAltitude(this.patrolAltitude);

    // Join fleet when close enough (horizontal distance only)
    const JOIN_DISTANCE = 100;
    if (distanceFromBoat <= JOIN_DISTANCE) {
      this._joinFleet(this.seekTargetBoat);
      this.seekingFleet = false;
      this.seekTargetBoat = null;
      this.aiState = 'searching';
    }
    return true;
  }

  _joinFleet(boat) {
    this.fleetBoat = boat;
    if (!this.fleetBoat.planes) this.fleetBoat.planes = [];
    if (!this.fleetBoat.planes.includes(this)) {
      this.fleetBoat.planes.push(this);
      this._renameForFleet();
    }
  }

  _renameForFleet() {
    try {
      const match = (this.fleetBoat.username || '').match(/(\d+)$/);
      const fleetId = match ? match[1] : String(Date.now()).slice(-4);
      const index = this.fleetBoat.planes.indexOf(this) + 1;
      const baseLabel = this.displayName || planeLabelForLevel(this.level) || 'Navy Craft';
      this.username = `${baseLabel} ${fleetId}-${index}`;

      // Update crates to reflect new carrier
      if (this.crates && Array.isArray(this.crates)) {
        for (const c of this.crates) {
          try { c.carrier = this.username; } catch (er) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
  }

  _scanForFleetAndLock(enemies) {
    const now = Date.now();
    const SCAN_INTERVAL_MS = 1000;
    if (this.lastSeekScanTime && (now - this.lastSeekScanTime) <= SCAN_INTERVAL_MS) return false;
    this.lastSeekScanTime = now;
    let nearest = null;
    let minDistSq = Infinity;
    const DETECTION_RADIUS = Math.max(150000, (mapData?.sizeX || 150000));
    const DETECTION_RADIUS_SQ = DETECTION_RADIUS * DETECTION_RADIUS;
    for (const e of enemies) {
      if (!e || !e.isFleetBoat) continue;
      if (((e.x - this.x) * this.searchDirection) <= 0) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minDistSq && d2 <= DETECTION_RADIUS_SQ) {
        minDistSq = d2;
        nearest = e;
        if (d2 <= 1000) break;
      }
    }
    if (nearest) {
      this.seekTargetBoat = nearest;
      this.t_x = nearest.x;
      this.t_y = nearest.y;
      return true;
    }
    return false;
  }

  _continueHorizontalSearch() {
    this.flyHorizontallyAtAltitude(this.patrolAltitude);
  }

  flyHorizontallyAtAltitude(targetAltitude) {
    const targetAngle = this.computePatrolTargetAngle(targetAltitude);
    this.applyTurningToward(targetAngle, 0.05);
    this.keys.w = true;
    this.keys.s = false;
  }

  // --- Combat & threat helpers ---
  checkForThreats(players) {
    const now = Date.now();
    if (now - this.lastHostileCheckTime < 1000) return;
    this.lastHostileCheckTime = now;
    const hostilePlayer = this.findHostilePlayer(players);
    if (hostilePlayer) {
      this.target = hostilePlayer;
      this.aiState = 'attacking';
    }
  }

  findHostilePlayer(players) {
    if (!players || players.length === 0) return null;
    const AGGRO_RANGE = 1500;
    for (const player of players) {
      if (player.biome === 'recovery') continue;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if ((dist < AGGRO_RANGE && player.crates && player.crates.length > 0) || (player.navyTargeted && dist < 2000)) {
        player.markNavyActivity();
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
    const inRange = distToTarget < 1000 && this.gun1;
    const gunAngleDiff = inRange ? Math.abs(this.angleDiffTo(aimAngle)) : Infinity;
    const canShoot = inRange && gunAngleDiff < (this.gun1.maxAngle ?? Math.PI / 4);
    this.selectedGun = canShoot ? 1 : 0;
    this.keys.mouse = canShoot;
    this.isFiring = canShoot;
  }

  // --- Patrol & crate handling ---
  patrolAndCollect() {
    if (!this.fleetBoat) return;
    const TARGET_ALTITUDE = 280;
    const MAX_PATROL_DISTANCE = 10000;
    const distanceFromBoat = Math.abs(this.x - this.fleetBoat.x);
    this.ensureDirectionRelativeToBoat(distanceFromBoat, MAX_PATROL_DISTANCE);
    this.checkRecoveryZonesAndMaybeReverse(500);
    const targetAngle = this.computePatrolTargetAngle(TARGET_ALTITUDE);
    this.applyTurningToward(targetAngle, 0.05);
    const distToBoat = this.fleetBoat ? Math.sqrt(Math.pow(this.x - this.fleetBoat.x, 2) + Math.pow(this.y - this.fleetBoat.y, 2)) : Infinity;
    this.applyThrottleAndDropLogic(distToBoat);
    this.keys.mouse = false;
    this.isFiring = false;
    this.selectedGun = 0;
  }

  applyThrottleAndDropLogic(distToBoat) {
    this.keys.w = true;
    this.keys.s = false;
    if (this.crates && this.crates.length > 0 && distToBoat <= 50) this.keys.f = true;
    else this.keys.f = false;
  }

  attachCrate(crate) {
    if (!this.crates) this.crates = [];
    const MAX_CRATES = 10; // Maximum crates an enemy plane can carry
    
    // Do not attach crates that have already been claimed by another carrier
    if (crate.removedFromWorld) return;
    if (crate.carrier) return; // prevent stealing from players or other entities
    
    // If at max capacity, detach the oldest crate first
    if (this.crates.length >= MAX_CRATES) {
      const oldestCrate = this.crates[0];
      this.detachCrate(oldestCrate);
    }
    
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

  // --- Utility helpers ---
  distanceTo(target) {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  angleDiffTo(targetAngle) {
    let diff = targetAngle - this.angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    return diff;
  }

  navigateTo(target, fullThrottle = false, alignThreshold = 0.3) {
    const dx = target.x - this.x;
    const dy = target.y - this.y - 50;
    const targetAngle = Math.atan2(dy, dx);
    const angleDiff = this.angleDiffTo(targetAngle);
    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;
    if (fullThrottle || Math.abs(angleDiff) < alignThreshold) this.engine.power = this.engine.maxPower;
    else this.engine.power = this.engine.minPower;
  }

  clearTarget() {
    this.target = null;
    this.t_x = this.x;
    this.t_y = this.y;
  }

  resetMovementKeys() {
    this.keys.a = false;
    this.keys.d = false;
    this.keys.w = false;
    this.keys.s = false;
    this.keys.mouse = false;
    this.keys.f = false;
    this.engine.power = this.engine ? this.engine.minPower : 0;
  }

  resetCombatState() {
    this.isFiring = false;
    this.selectedGun = 0;
    this.resetMovementKeys();
  }

  enterSearchingState() {
    this.aiState = 'searching';
    this.clearTarget();
    this.resetMovementKeys();
  }

  ensureDirectionRelativeToBoat(distanceFromBoat, maxPatrolDistance) {
    if (this.crates && this.crates.length >= 5) {
      const movingAwayFromBoat = (this.x > this.fleetBoat.x && this.searchDirection > 0) || (this.x < this.fleetBoat.x && this.searchDirection < 0);
      if (movingAwayFromBoat) this.searchDirection *= -1;
    }
    if (distanceFromBoat > maxPatrolDistance) {
      const movingAwayFromBoat = (this.x > this.fleetBoat.x && this.searchDirection > 0) || (this.x < this.fleetBoat.x && this.searchDirection < 0);
      if (movingAwayFromBoat) this.searchDirection *= -1;
    }
  }

  checkRecoveryZonesAndMaybeReverse(buffer) {
    const recoveryZones = mapData?.biomes?.filter(b => b.type === 'recoveryzone') || [];
    for (const zone of recoveryZones) {
      const distToZone = Math.abs(this.x - zone.center);
      if (distToZone < zone.radius + buffer) {
        const movingTowardZone = (this.x < zone.center && this.searchDirection > 0) || (this.x > zone.center && this.searchDirection < 0);
        if (movingTowardZone) this.searchDirection *= -1;
      }
    }
  }

  computePatrolTargetAngle(targetAltitude, diffAmount = 10) {
    const altitudeDiff = this.y - targetAltitude;
    let targetAngle;
    if (this.searchDirection > 0) {
      if (altitudeDiff > diffAmount || this.biome === 'water') targetAngle = -0.3;
      else if (altitudeDiff < -diffAmount) targetAngle = 0.3;
      else targetAngle = 0;
    } else {
      if (altitudeDiff > diffAmount || this.biome === 'water') targetAngle = Math.PI + 0.3;
      else if (altitudeDiff < -diffAmount) targetAngle = Math.PI - 0.3;
      else targetAngle = Math.PI;
    }
    return targetAngle;
  }

  applyTurningToward(targetAngle, deadzone = 0.05) {
    let diff = targetAngle - this.angle;
    const TWO_PI = Math.PI * 2;
    diff = ((diff + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
    if (diff < -deadzone) { this.keys.a = true; this.keys.d = false; }
    else if (diff > deadzone) { this.keys.d = true; this.keys.a = false; }
    else { this.keys.a = false; this.keys.d = false; }
    if (this.engine) this.engine.power = Math.abs(diff) > 0.1 ? this.engine.minPower : this.engine.maxPower;
    return diff;
  }

  // --- Serialization & lifecycle ---
  toJSON() {
    const { fleetBoat, ...rest } = this;
    return rest;
  }

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
      aiState: this.aiState,
      targetUsername: this.target ? this.target.username : null // Include target username for client indicators
    };
  }

  onDamaged(projectile, players) {
    super.onDamaged(projectile);
    if (projectile.owner && players) {
      const attacker = players.find(p => p.username === projectile.owner);
      if (attacker) {
        this.target = attacker;
        this.aiState = 'attacking';
        attacker.markNavyActivity();
      }
    }
  }
}

// A stationary enemy boat that only shoots at players
export class NavySalvageBoat extends EnemyBoat {
  constructor(username, r, g, b, x, y, planeCount = 3, level = 1) {
    super(username, r, g, b, x, y, 'navy');
    this.level = level || 1;
    this.angle = -Math.PI / 2; // Point boat upward so gun can cover upper hemisphere
    this.maxHull = 400 + (this.level - 1) * 200; // Scale hull with level: 400/600/800
    this.hull = this.maxHull;
    const gunType = Math.random() < 0.5 ? 1 : 2; // 50/50 chance between boat gun (1) or boat scorpion (2)
    this.gun1 = createEnemyGun(gunType, this.level);
    this.gun2 = null;
    this.isFiring = false;
    this.aimPoint = { x: null, y: null };
    this.t_x = x; // Initialize target position to own position
    this.t_y = y;
    this.planes = []; // Array of planes belonging to this fleet
    this.planeCount = planeCount; // How many planes this boat should command
    this.isFleetBoat = true; // Mark as a fleet headquarters
    this.aiState = "idle"; // Track AI state for debugging
    this.storedCrates = []; // Crates stored in the boat's inventory
    // Friendly display name for clients
    this.displayName = 'Navy Ship';
    // Plane respawn tracking
    this.lastPlaneDestroyedAt = 0; // Timestamp of last plane destruction
    this.planeRespawnDelay = 3 * 60 * 1000; // 3 minutes in milliseconds
    this.planeLevels = []; // Store the levels of planes that should be spawned
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
    const AGGRO_RANGE = 1500;
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

  // Spawn planes for this fleet. Accept an optional levels array to control plane levels.
  spawnPlanes(levels = null) {
    const newPlanes = [];
    // If levels array provided, use its length; otherwise fall back to planeCount
    const count = Array.isArray(levels) ? levels.length : this.planeCount;
    
    // Store the plane levels for respawning later
    if (Array.isArray(levels) && levels.length > 0) {
      this.planeLevels = [...levels];
    } else if (this.planeLevels.length === 0) {
      // Default to level 1 planes if no levels specified
      this.planeLevels = Array(count).fill(1);
    }
    
    for (let i = 0; i < count; i++) {
      const planeX = this.x;
      const planeY = this.y - 310;

      // Use a guaranteed-unique internal username for the plane so crates/carrier lookups are unambiguous.
      // Also expose a friendly display name for the client.
      const level = Array.isArray(levels) ? (levels[i] || 1) : 1;
      // Friendly type label (use helper so this logic is centralized and easy to extend)
      const baseLabel = planeLabelForLevel(level);
      // Create a unique server username while keeping a human-friendly prefix
      // e.g. 'Navy Fighter 1-1' where '1' is the fleet boat index and '1' is plane index
      const boatIdMatch = (this.username && this.username.match(/(\d+)$/)) ? this.username.match(/(\d+)$/)[1] : String(Date.now()).slice(-4);
      const internalUsername = `${baseLabel} ${boatIdMatch}-${i + 1}`;

      const plane = new NavySalvagePlane(
        internalUsername,
        50, 50, 200, // navy blue
        planeX,
        planeY,
        level
      );
      // Attach a friendly display name used by clients; keep server username unique
      plane.displayName = baseLabel;

      plane.fleetBoat = this; // Give plane reference to its commanding boat
      this.planes.push(plane);
      newPlanes.push(plane);
    }
    console.log(`Fleet boat ${this.username} spawned ${newPlanes.length} planes`);
    return newPlanes;
  }

  // Store a crate in the boat's inventory (remove from world handled by App)
  storeCrate(crate) {
    if (!this.storedCrates) this.storedCrates = [];
    const MAX_STORED_CRATES = 50; // Maximum crates a boat can store
    
    // If at max capacity, remove the oldest crate first
    if (this.storedCrates.length >= MAX_STORED_CRATES) {
      const oldestCrate = this.storedCrates.shift(); // Remove first (oldest) crate
      oldestCrate.detach(); // Clear carrier reference
      // Note: The removed crate is just dropped from memory, not placed back in world
    }
    
    this.storedCrates.push(crate);
    crate.attach(this.username);
  }

  // Drop all stored crates back into the world: caller should push crates into global crates array
  dropAllStoredCrates() {
    if (!this.storedCrates || this.storedCrates.length === 0) return [];
    const dropped = this.storedCrates.slice();
    this.storedCrates = [];
    // Detach carrier so updateCrates treats them as world crates once re-added
    dropped.forEach(c => { c.detach(); });
    return dropped;
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
      displayName: this.displayName || this.username,
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
      aiState: this.aiState,
      storedCrateCount: this.storedCrates ? this.storedCrates.length : 0,
      targetUsername: this.target ? this.target.username : null // Include target username for client indicators
    };
  }
}

// Dummy plane for testing - no AI, no physics, 500 HP
export class DummyPlane extends EnemyPlane {
  constructor(username, x, y) {
    super(username, 255, 165, 0, x, y, 'dummy'); // Orange color

    // Create basic components
    this.gun1 = createEnemyGun(0, 1);
    this.gun2 = null;
    this.engine = createEnemyEngine(0, 1);
    this.chassis = createEnemyChassis(0, 1);
    this.wings = createEnemyWings(0, 1);

    // Dummy-specific properties
    this.isDummy = true;
    this.aiState = "dummy";
    this.t_x = x;
    this.t_y = y;

    // DPS tracking
    this.damageHistory = []; // Array of {timestamp, damage} objects
    this.currentDPS = 0;

    // Set health to 500
    this.chassis.hull = 500;
    this.chassis.maxHull = 500;
  }

  // Override updateAI to do nothing but update DPS
  updateAI() {
    // Dummies don't have AI - maintain "dummy" state
    this.aiState = "dummy";
  }

  updateDPS() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove damage records older than 1 second
    this.damageHistory = this.damageHistory.filter(record => record.timestamp > oneSecondAgo);

    // Calculate total damage in the last second
    this.currentDPS = this.damageHistory.reduce((total, record) => total + record.damage, 0);
  }

  // Override onDamaged to track damage for DPS
  onDamaged(projectile, players) {
    // Track hull before damage
    const hullBefore = this.chassis?.hull ?? 0;

    // Call parent method to apply normal damage
    super.onDamaged(projectile, players);

    // Track hull after damage
    const hullAfter = this.chassis?.hull ?? 0;
    const damageDealt = hullBefore - hullAfter;

    // Record the damage with timestamp
    if (damageDealt > 0) {
      this.damageHistory.push({
        timestamp: Date.now(),
        damage: damageDealt
      });
    }
    this.updateDPS();
  }

  toClientData() {
    return {
      type: this.type,
      username: this.username,
      faction: this.faction,
      isDummy: true,
      dps: this.currentDPS, // Include DPS for display
      x: this.x,
      y: this.y,
      angle: this.angle,
      vx: 0, // Always stationary
      vy: 0, // Always stationary
      r: this.r,
      g: this.g,
      b: this.b,
      size: this.size,
      hull: this.chassis?.hull ?? 0,
      maxHull: this.chassis?.maxHull ?? 1,
      aiState: this.aiState
    };
  }
}
