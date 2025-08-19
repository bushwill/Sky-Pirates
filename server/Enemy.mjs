import { Plane } from './Plane.mjs';
import { createEnemyGun } from './WeaponList.mjs';
import { createEnemyEngine, createEnemyChassis, createEnemyWings } from './ComponentList.mjs'

export class Enemy extends Plane {
  constructor(biome, username, r, g, b, x, y, faction = null, target = null) {
    super(biome, username, r, g, b, x, y);
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

export class NavySalvagePlane extends Enemy {
  lastRLTrain = 0;
  constructor(biome, username, r, g, b, x, y) {
    super(biome, username, r, g, b, x, y, 'navy');
    this.gun1 = createEnemyGun(0, 1);
    this.gun2 = null;
    this.engine = createEnemyEngine(0, 1);
    this.chassis = createEnemyChassis(0, 1);
    this.wings = createEnemyWings(0, 1);
    // RL histories
    this.stateHistory = [];
    this.actionHistory = [];
    this.rewardHistory = [];
    this.nextStateHistory = [];
    // Firing and aim debug
    this.isFiring = false;
    this.aimPoint = { x: null, y: null };
  }

  // Methods to add rewards/punishments
  reward(n) {
    this.rewardHistory.push(n);
  }
  punish(n) {
    this.rewardHistory.push(-Math.abs(n));
  }

  updateAI(players) {
    if (this.aiState === "idle" || this.aiState === null) {
      this.aiState = "searching";
    } else if (this.aiState === "searching") {
      this.findTarget(players);
      if (this.target != null) this.aiState = "traveling";

    } else if (this.aiState === "traveling") {
      // If target no longer exists in players, switch to searching
      const targetStillExists = this.target && players.some(p => p.username === this.target.username);
      if (!targetStillExists) {
        this.target = null;
        this.aiState = "searching";
        return;
      }
      if (this.target) {
        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1000) {
          this.aiState = "attacking";
        } else {
          this.moveTowardTarget();
        }
      } else {
        this.aiState = "searching";
      }
    } else if (this.aiState === "attacking") {
      const targetStillExists = this.target && players.some(p => p.username === this.target.username);
      if (!targetStillExists) {
        this.target = null;
        this.aiState = "searching";
        return;
      }
      this.combatTargets([this.target]);
    }
  }

  findTarget(targets) {
    if (!targets || targets.length === 0) return null;
    let minDist = Infinity;
    let nearest = null;
    for (const target of targets) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        nearest = target;
      }
    }
    this.target = nearest;
    return nearest;
  }

  combatTargets() {
    if (!this.target) return;
    const targetX = this.target.x;
    const targetY = this.target.y;
    const targetVX = this.target.vx ?? 0;
    const targetVY = this.target.vy ?? 0;
    // Calculate angle to target
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distToTarget = Math.sqrt(dx * dx + dy * dy);
    const projectileSpeed = this.gun1?.projectileSpeed ?? 20; // fallback speed
    // Predict time to hit
    const timeToHit = distToTarget / projectileSpeed;
    // Predict future position
    const predictedX = targetX + targetVX * timeToHit;
    const predictedY = targetY + targetVY * timeToHit;
    // Randomly select a spot between current and predicted position
    const t = Math.random();
    const aimX = targetX + (predictedX - targetX) * t;
    const aimY = targetY + (predictedY - targetY) * t;
    // Calculate angle to aim spot
    const aimDX = aimX - this.x;
    const aimDY = aimY - this.y;
    const aimAngle = Math.atan2(aimDY, aimDX);
    let angleDiff = aimAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    // Turn toward aim spot
    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;
    // Throttle logic (same as before)
    if (Math.abs(angleDiff) > 0.1) {
      this.engine.power = this.engine.minPower;
      this.keys.w = false;
      this.keys.s = false;
    } else {
      this.engine.power = this.engine.maxPower;
      this.keys.w = true;
      this.keys.s = false;
    }
  // Set targeting for guns and debug aim point
  this.t_x = aimX;
  this.t_y = aimY;
  this.aimPoint = { x: aimX, y: aimY };
    // --- Shooting logic ---
    const shootDistance = 600;
    if (distToTarget < shootDistance && this.gun1) {
      // Check if aim spot is within gun's firing arc
      const gunAngle = this.gun1.angle;
      const gunMaxAngle = this.gun1.maxAngle ?? (Math.PI / 4);
      let gunAngleDiff = aimAngle - gunAngle;
      while (gunAngleDiff > Math.PI) gunAngleDiff -= 2 * Math.PI;
      while (gunAngleDiff < -Math.PI) gunAngleDiff += 2 * Math.PI;
      if (Math.abs(gunAngleDiff) < gunMaxAngle) {
        this.selectedGun = 1;
        this.keys.mouse = true;
        this.isFiring = true;
      } else {
        this.keys.mouse = false;
        this.isFiring = false;
      }
    } else {
      this.keys.mouse = false;
      this.isFiring = false;
    }
  }

  moveTowardTarget() {
    if (!this.target) return;
    // Calculate direction to target
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Set keypresses for steering
    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;

    // Throttle forward if mostly facing target
    if (Math.abs(angleDiff) < 0.3) {
      this.keys.w = true;
      this.keys.s = false;
    } else {
      // Slow down for turning
      this.keys.w = false;
      this.keys.s = false;
    }
  }
}
