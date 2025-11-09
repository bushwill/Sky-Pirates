export class Projectile {
    constructor(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b) {
        this.x = x;          // X position of the projectile
        this.y = y;          // Y position of the projectile
        this.vx = vx;        // X velocity of the projectile
        this.vy = vy;        // Y velocity of the projectile
        this.angle = angle;  // Angle of the projectile in radians
        this.damage = damage; // Damage dealt by the projectile
        this.size = size;    // Size of the projectile
        this.owner = owner;   // Owner of the projectile (Player instance)
        this.maxDistance = maxDistance; // Maximum distance the projectile can travel in meters
        this.distanceTraveled = 0; // Distance traveled so far in meters
        this.r = r;          // Red color component
        this.g = g;          // Green color component
        this.b = b;          // Blue color component
        this.size = size; // Size of the projectile
        this.biome = 'air';  // Current biome the projectile is in
    }
}