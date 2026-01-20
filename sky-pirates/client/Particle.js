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
        
        // Alpha transparency (used for smoke and other effects)
        this.alpha = 255; // Default full opacity
        
        // Death animation properties
        this.deathDuration = 10; // Frames for death animation
        this.deathTimer = 0;
        this.isDying = false;
        this.isDead = false;
    }
    
    update(deltaTime = 1, lowQuality = false) {
        // Apply physics based on particle type
        if (this.type === 'water') {
            // Apply gentle gravity to water particles
            this.vy += 0.2 * deltaTime; 
            
            // Linear drag approx for low quality optimization
            if (lowQuality) {
                const drag = 1 - 0.005 * deltaTime;
                this.vx *= drag; this.vy *= drag; this.vz *= drag;
            } else {
                const dragFactor = 0.995; 
                this.vx *= Math.pow(dragFactor, deltaTime);
                this.vy *= Math.pow(dragFactor, deltaTime);
                this.vz *= Math.pow(dragFactor, deltaTime);
            }
            
            // Optimization: Skip biome checks periodically in low quality mode
            if (!lowQuality || Math.random() < 0.1) {
                const currentBiome = getBiomeAtPosition(this.x, this.y);
                if (currentBiome === 'water' && !this.isDying) {
                    this.isDying = true;
                    this.deathTimer = 15; 
                    return; 
                }
            }
        } else if (this.type === 'foam') {
            // Optimization: Skip biome checks periodically in low quality mode
            // Default to 'water' behavior if we skip check (assume we are still in water)
            let currentBiome = 'water';
            if (!lowQuality || Math.random() < 0.1) {
                currentBiome = getBiomeAtPosition(this.x, this.y);
            }
            
            if (currentBiome === 'water') {
                // In water: apply buoyancy to float and start dissolving
                this.vy += -0.05 * deltaTime; 
                
                // Heavy drag to simulate water resistance
                const waterDragFactor = 0.80;
                if (lowQuality) {
                    const drag = 1 - (1 - waterDragFactor) * deltaTime;
                    this.vx *= drag; this.vy *= drag; this.vz *= drag;
                } else {
                    this.vx *= Math.pow(waterDragFactor, deltaTime);
                    this.vy *= Math.pow(waterDragFactor, deltaTime);
                    this.vz *= Math.pow(waterDragFactor, deltaTime);
                }
                
                // Foam dissolves faster when in water
                if (!this.isDying) {
                    this.isDying = true;
                    // Slightly longer life for wake trails
                    this.deathTimer = 100; 
                }
            } else {
                // In air: normal gravity applies
                this.vy += 0.4 * deltaTime; // Normal gravity when not in water
                
                const airDragFactor = 0.98;
                if (lowQuality) {
                   const drag = 1 - 0.02 * deltaTime;
                   this.vx *= drag; this.vy *= drag; this.vz *= drag;
                } else {
                   this.vx *= Math.pow(airDragFactor, deltaTime);
                   this.vy *= Math.pow(airDragFactor, deltaTime);
                   this.vz *= Math.pow(airDragFactor, deltaTime);
                }
            }
        } else if (this.type === 'flame') {
            // Optimization: Skip biome checks to convert flame to foam in low quality logic
            if (!lowQuality && Math.random() < 0.2) {
                const currentBiome = getBiomeAtPosition(this.x, this.y);
                if (currentBiome === 'water') {
                    // Convert flame to foam particle
                    this.type = 'foam';
                    this.r = 255;
                    this.g = 255;
                    this.b = 255;
                    this.lifetime = 60 + Math.random() * 60; // 2-4 seconds
                    this.maxLifetime = this.lifetime;
                    this.size = 0.8 + Math.random() * 0.8;
                    this.originalSize = this.size;
                    this.isDying = false;
                    this.isDead = false;
                    this.deathTimer = 0;
                    this.vx *= 0.5;
                    this.vy *= 0.5;
                    this.vz *= 0.5;
                    return; // Skip rest of flame physics
                }
            }
            
            // Flame particles - no upward movement
            const flameDragFactor = 0.98;
            if (lowQuality) {
                const drag = 1 - 0.02 * deltaTime;
                 this.vx *= drag; this.vy *= drag; this.vz *= drag;
            } else {
                this.vx *= Math.pow(flameDragFactor, deltaTime);
                this.vy *= Math.pow(flameDragFactor, deltaTime);
                this.vz *= Math.pow(flameDragFactor, deltaTime);
            }
            
        } else if (this.type === 'smoke') {
            // Smoke rises very gently (50% of original)
            this.vy += -0.1 * deltaTime; // Gentle upward drift
            
            // Add wind-like horizontal drift
            this.vx += (Math.random() - 0.5) * 0.1 * deltaTime;
            
            const smokeDragFactor = 0.95;
            if (lowQuality) {
                const drag = 1 - 0.05 * deltaTime;
                 this.vx *= drag; this.vy *= drag; this.vz *= drag;
            } else {
                this.vx *= Math.pow(smokeDragFactor, deltaTime);
                this.vy *= Math.pow(smokeDragFactor, deltaTime);
                this.vz *= Math.pow(smokeDragFactor, deltaTime);
            }
            
            // Smoke fades as it ages (alpha decreases)
            const ageRatio = 1 - (this.lifetime / this.maxLifetime);
            this.alpha = Math.max(20, 150 * (1 - ageRatio)); // Fade from 150 to 20
            
        } else if (this.type === 'spark') {
            // Spark particles - erratic, fast-dissipating
            // Add random jittery movement (increased jitter for more erratic motion)
            this.vx += (Math.random() - 0.5) * 1.2 * deltaTime; // More jitter
            this.vy += (Math.random() - 0.5) * 1.2 * deltaTime; // More jitter
            this.vz += (Math.random() - 0.5) * 0.5 * deltaTime;
            
            // Medium drag - sparks lose energy but not instantly
            const sparkDragFactor = 0.95;
            if (lowQuality) {
                const drag = 1 - 0.05 * deltaTime;
                 this.vx *= drag; this.vy *= drag; this.vz *= drag;
            } else {
                this.vx *= Math.pow(sparkDragFactor, deltaTime);
                this.vy *= Math.pow(sparkDragFactor, deltaTime);
                this.vz *= Math.pow(sparkDragFactor, deltaTime);
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
                if (!lowQuality) { // Skip check in low quality
                   const currentBiome = getBiomeAtPosition(this.x, this.y);
                   if (currentBiome === 'water') {
                       deathDuration = 15; // Faster disappearance when hitting water
                   }
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
    
    draw(cameraX = 0, cameraY = 0, lowQuality = false) {
        if (this.isDead || this.size <= 0) return;
        
        // Calculate screen position relative to camera
        const screenX = this.x - cameraX;
        const screenY = this.y - cameraY;
        
        // Optimization: Don't draw if off-screen (basic culling)
        if (screenX < -50 || screenX > windowWidth + 50 || 
            screenY < -50 || screenY > windowHeight + 50) return;

        // Low Quality: Optimized rendering
        if (lowQuality) {
             noStroke();
             
             // Simplier color logic for low quality
             if (this.type === 'smoke' || this.type === 'default' && this.r===255) {
                // Usually opaque white/grey for speed, unless it looks terrible
                fill(this.r, this.g, this.b, 200); 
             } else {
                fill(this.r, this.g, this.b);
             }
             
             // Keep circles as requested, just skip other fancy logic if any
             circle(screenX, screenY, this.size);
             return;
        }

        // Simple circle rendering for all particle types
        if (this.type === 'flame') {
            // Debug: Check if flame colors are being corrupted
            if (this.r === 255 && this.g === 255 && this.b === 255) {
                console.log(`WHITE FLAME PARTICLE DETECTED! RGB(${this.r}, ${this.g}, ${this.b})`);
            }
            
            // Flame particles - simple colored circle
            fill(this.r, this.g, this.b, 200);
            noStroke();
            circle(screenX, screenY, this.size);
            
        } else if (this.type === 'smoke') {
            // Smoke particles - gray circle with fading alpha
            fill(100, 100, 100, this.alpha);
            noStroke();
            circle(screenX, screenY, this.size);
            
        } else if (this.type === 'spark') {
            // Spark particles - bright, small, fading quickly
            fill(this.r, this.g, this.b, this.alpha);
            noStroke();
            circle(screenX, screenY, this.size);
            
        } else {
            // Default particle rendering
            if (this.r === 255 && this.g === 255 && this.b === 255) {
                // White particles get transparency based on lifetime
                const alpha = Math.max(50, (this.lifetime / this.maxLifetime) * 150);
                fill(this.r, this.g, this.b, alpha);
            } else {
                // Other particles use full opacity or custom alpha
                const alpha = this.alpha !== 255 ? this.alpha : 255;
                fill(this.r, this.g, this.b, alpha);
            }
            noStroke();
            circle(screenX, screenY, this.size);
        }
    }
}