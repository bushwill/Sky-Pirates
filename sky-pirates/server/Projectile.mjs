export class Projectile {
    constructor(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b) {
        this.type = 'bullet';
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
        this.creationTime = Date.now();
        this.damageDelay = 0; // Default: deal damage immediately
        this.lifetime = 5000; // Default lifetime in ms
    }

    onExpire() {
        return [];
    }
}

export class FireworkRocket extends Projectile {
    constructor(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b) {
        super(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b);
        this.type = 'firework_rocket';
        this.lifetime = 3000;
    }

    onExpire() {
        const projectiles = [];
        const explosionPower = 100; // Slower general speed (was 300)
        const particleRange = 100; // Reduced range/lifetime

        // 1. Generate Palette (1-3 distinct colors shared by all particles)
        const colors = [];
        const numColors = Math.floor(Math.random() * 3) + 1;
        for(let c=0; c<numColors; c++) {
            colors.push({
                r: Math.floor(100 + Math.random() * 156), // Bright colors
                g: Math.floor(100 + Math.random() * 156),
                b: Math.floor(100 + Math.random() * 156)
            });
        }

        // OUTER CIRCLE: Distinct ring with slightly varying speeds
        const outerCount = 40;
        for (let i = 0; i < outerCount; i++) {
            // Evenly distributed angles
            const angle = (i / outerCount) * Math.PI * 2;
            
            // Speed is mostly constant to form a ring, but with slight variance (0.9 to 1.1)
            const speed = explosionPower * (0.9 + Math.random() * 0.2); 
            
            const pVx = Math.cos(angle) * speed;
            const pVy = Math.sin(angle) * speed;

            // Cycle through colors for outer ring
            const color = colors[i % numColors];

            projectiles.push(new FireworksFire(
                this.x,
                this.y,
                pVx,
                pVy,
                angle,
                this.damage * 0.2,
                this.size,
                this.owner,
                particleRange, 
                color.r, color.g, color.b
            ));
        }

        // INNER FILL: Random chaotic sparks
        const innerCount = 20;
        for (let i = 0; i < innerCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            // Speed is 50%-100% of outer speed
            const speed = explosionPower * (0.5 + Math.random() * 0.5);
            
            const pVx = Math.cos(angle) * speed;
            const pVy = Math.sin(angle) * speed;

            // Random pick from palette for inner sparks
            const color = colors[Math.floor(Math.random() * numColors)];

            projectiles.push(new FireworksFire(
                this.x,
                this.y,
                pVx,
                pVy,
                angle,
                this.damage * 0.1, // Less damage for inner sparks
                this.size * 0.8,   // Smaller
                this.owner,
                particleRange * 0.8, // Slightly shorter range for inner
                color.r, color.g, color.b
            ));
        }

        return projectiles;
    }
}

export class Fire extends Projectile {
    constructor(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b) {
        super(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b);
        this.type = 'fire';
        this.damageDelay = 200; // Shorter delay for direct flamethrower
        this.lifetime = 1500;
    }
}

export class FireworksFire extends Projectile {
    constructor(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b) {
        super(x, y, vx, vy, angle, damage, size, owner, maxDistance, r, g, b);
        this.type = 'fireworks_fire';
        this.damageDelay = 500; // 0.5 seconds delay before dealing damage
        this.lifetime = 3000;
    }
}