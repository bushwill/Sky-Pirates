class Particle {
    constructor(x, y, z, vx, vy, vz, r, g, b, size, lifetime, type = 'default') {
        // Position coordinates
        this.x = x;
        this.y = y;
        this.z = z;
        
        // Velocity
        this.vx = vx;
        this.vy = vy;
        this.vz = vz;
        
        // Color (RGB)
        this.r = r;
        this.g = g;
        this.b = b;
        
        // Size and lifetime
        this.originalSize = size;
        this.size = size;
        this.lifetime = lifetime;
        this.maxLifetime = lifetime;
        
        // Particle type for physics
        this.type = type;
        
        // Death animation properties
        this.deathDuration = 10; // Frames for death animation
        this.deathTimer = 0;
        this.isDying = false;
        this.isDead = false;
    }
    
    update(deltaTime = 1) {
        // Apply physics based on particle type
        if (this.type === 'water') {
            // Apply gentle gravity to water particles
            this.vy += 0.2 * deltaTime; // Much gentler gravity (was 0.8)
            
            // Apply light drag/air resistance
            const dragFactor = 0.995; // Much less drag (was 0.98)
            this.vx *= Math.pow(dragFactor, deltaTime);
            this.vy *= Math.pow(dragFactor, deltaTime);
            this.vz *= Math.pow(dragFactor, deltaTime);
            
            // Check what biome the particle is currently in
            const currentBiome = getBiomeAtPosition(this.x, this.y);
            
            // Water particles should disappear when hitting water biome
            if (currentBiome === 'water' && !this.isDying) {
                // Water particle hit water biome - start shrinking immediately
                this.isDying = true;
                this.deathTimer = 15; // Medium speed disappearance into water
                return; // Skip normal lifetime processing
            }
        } else if (this.type === 'foam') {
            // Check what biome the foam particle is currently in
            const currentBiome = getBiomeAtPosition(this.x, this.y);
            
            if (currentBiome === 'water') {
                // In water: apply buoyancy to float and start dissolving
                this.vy += -0.3 * deltaTime; // Strong buoyancy force upward
                
                // Heavy drag to simulate water resistance
                const waterDragFactor = 0.85;
                this.vx *= Math.pow(waterDragFactor, deltaTime);
                this.vy *= Math.pow(waterDragFactor, deltaTime);
                this.vz *= Math.pow(waterDragFactor, deltaTime);
                
                // Foam dissolves faster when in water
                if (!this.isDying) {
                    this.isDying = true;
                    this.deathTimer = 60; // 60 frames = ~2 seconds to dissolve
                }
            } else {
                // In air: normal gravity applies
                this.vy += 0.4 * deltaTime; // Normal gravity when not in water
                
                // Light air resistance
                const airDragFactor = 0.98;
                this.vx *= Math.pow(airDragFactor, deltaTime);
                this.vy *= Math.pow(airDragFactor, deltaTime);
                this.vz *= Math.pow(airDragFactor, deltaTime);
            }
        }
        
        // Update position based on velocity
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.z += this.vz * deltaTime;
        
        // Decrease lifetime for all particle types
        this.lifetime -= deltaTime;
        
        // Check if lifetime expired and start death animation
        if (this.lifetime <= 0 && !this.isDying) {
            this.isDying = true;
            this.deathTimer = this.deathDuration;
        }
        
        // Handle death animation (rapid size decrease)
        if (this.isDying) {
            this.deathTimer -= deltaTime;
            
            // Use appropriate death duration based on particle type and death cause
            let deathDuration = this.deathDuration;
            if (this.type === 'water') {
                const currentBiome = getBiomeAtPosition(this.x, this.y);
                if (currentBiome === 'water') {
                    deathDuration = 15; // Faster disappearance when hitting water
                }
            }
            
            const shrinkProgress = 1 - (this.deathTimer / deathDuration);
            this.size = this.originalSize * (1 - shrinkProgress);
            
            // Mark as dead when animation complete
            if (this.deathTimer <= 0) {
                this.isDead = true;
            }
        }
    }
    
    draw(cameraX = 0, cameraY = 0) {
        if (this.isDead || this.size <= 0) return;
        
        // Calculate screen position relative to camera
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Set color with transparency for white particles
        if (this.r === 255 && this.g === 255 && this.b === 255) {
            // White particles get transparency based on lifetime
            const alpha = Math.max(50, (this.lifetime / this.maxLifetime) * 150);
            fill(this.r, this.g, this.b, alpha);
        } else {
            // Other particles use full opacity
            fill(this.r, this.g, this.b);
        }
        noStroke();
        
        // Draw particle as circle
        circle(screenX, screenY, this.size);
    }
}