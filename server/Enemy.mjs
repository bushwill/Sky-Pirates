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
  constructor(biome, username, r, g, b, x, y) {
    super(biome, username, r, g, b, x, y, 'navy');
    this.gun1 = createEnemyGun(0, 1);
    this.gun2 = null;
    this.engine = createEnemyEngine(0, 1);
    this.chassis = createEnemyChassis(0, 1);
    this.wings = createEnemyWings(0, 1);
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
        this.moveTowardTarget();
      } else {
        this.aiState = "searching";
      }
    }
  }

  findTarget(players) {
    if (!players || players.length === 0) return null;
    let minDist = Infinity;
    let nearest = null;
    for (const player of players) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        nearest = player;
      }
    }
    this.target = nearest;
    return nearest;
  }

  moveTowardTarget() {
    if (!this.target) return;
    const targetX = this.target.x;
    const targetY = this.target.y;
    // Calculate angle to target
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const targetAngle = Math.atan2(dy, dx);
    let angleDiff = targetAngle - this.angle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Turn toward player
    this.keys.a = angleDiff < -0.1;
    this.keys.d = angleDiff > 0.1;

    // If turning, slow throttle and speed for faster turning
    if (Math.abs(angleDiff) > 0.1) {
      // Reduce throttle and engine power to minimum
      this.engine.power = this.engine.minPower;
      this.keys.w = false;
      this.keys.s = false;
    } else {
      // Resume normal throttle toward target
      this.engine.power = this.engine.maxPower;
      this.keys.w = true;
      this.keys.s = false;
    }

    // Set targeting for guns (if needed)
    this.t_x = targetX;
    this.t_y = targetY;

    // --- Shooting logic ---
    // Only shoot if target is within distance and gun angle
    const shootDistance = 600; // Example: 600 units
    const distToTarget = Math.sqrt(dx * dx + dy * dy);
    if (distToTarget < shootDistance && this.gun1) {
      // Check if target is within gun's firing arc
      const gunAngle = this.gun1.angle;
      const gunMaxAngle = this.gun1.maxAngle ?? (Math.PI / 4); // fallback to 45deg
      let gunAngleDiff = targetAngle - gunAngle;
      while (gunAngleDiff > Math.PI) gunAngleDiff -= 2 * Math.PI;
      while (gunAngleDiff < -Math.PI) gunAngleDiff += 2 * Math.PI;
      if (Math.abs(gunAngleDiff) < gunMaxAngle) {
        // Simulate mouse press to shoot
        this.selectedGun = 1;
        this.keys.mouse = true;
      } else {
        this.keys.mouse = false;
      }
    } else {
      this.keys.mouse = false;
    }
  }
}
