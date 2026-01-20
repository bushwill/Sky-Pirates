
import { mapData } from './App.mjs';

let waterBiomesCache = null;
function getWaterBiomes() {
    if (!waterBiomesCache && mapData && mapData.biomes) {
        waterBiomesCache = mapData.biomes.filter(b => b.type === 'water');
    }
    return waterBiomesCache || [];
}

export class Animal {
    constructor(id, x, y, type, size, angle = 0) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.type = type; // 'bird' or 'fish'
        this.size = size;
        this.angle = angle;
        this.vx = 0;
        this.vy = 0;
        this.aiTimer = Math.random() * 0.2; // Random offset
    }

    update(deltaTime = 0.01, threatGrid = null, gridSize = 500) {
        // Determine biome
        let inWater = false;
        const waterBiomes = getWaterBiomes();
        for (const biome of waterBiomes) {
            if (this.x >= biome.x1 && this.x <= biome.x2 &&
                this.y >= biome.y1 && this.y <= biome.y2) {
                inWater = true;
                break;
            }
        }

        // Biome transition check
        if (inWater !== this.wasInWater) {
            this.onBiomeChange(inWater);
        }
        this.wasInWater = inWater;

        // Update timers
        if (this.fleeTimer > 0) {
            this.fleeTimer -= deltaTime;
        }

        this.aiTimer -= deltaTime;
        if (this.aiTimer <= 0) {
            this.aiTimer = 0.1; // Run AI every 100ms (more frequent)
            this.updateAI(threatGrid, gridSize, inWater, deltaTime);
        }
        
        this.applyPhysics(inWater, deltaTime);

        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
    }

    updateAI(threatGrid, gridSize, inWater, deltaTime) {
        // Default AI (none)
    }

    onBiomeChange(inWater) {
        // Default implementation (empty)
    }

    applyPhysics(inWater, deltaTime) {
        // Default physics
    }
}

export class Bird extends Animal {
    constructor(id, x, y, size = 3) {
        super(id, x, y, 'bird', size);
    }

    applyPhysics(inWater, deltaTime) {
        // Birds: No gravity anywhere.
        // Drag: Air drag and water drag.
        const drag = inWater ? 0.90 : 0.99;
        
        // Apply drag scaled by time
        const dragFactor = Math.pow(drag, deltaTime * 100);
        this.vx *= dragFactor;
        this.vy *= dragFactor;
    }
}

export class Fish extends Animal {
    constructor(id, x, y, size = 3) {
        super(id, x, y, 'fish', size);
        // Random direction: Left (PI) or Right (0)
        this.angle = Math.random() < 0.5 ? 0 : Math.PI;
        this.normalSpeed = 10 + Math.random() * 20;
        this.speed = this.normalSpeed;
        this.fleeTimer = 0;
        this.wasInWater = true;
        this.desiredY = y;

        // Fish Colors
        const colors = [
            { r: 255, g: 50, b: 50 },   // Red
            { r: 255, g: 255, b: 50 },  // Yellow
            { r: 50, g: 50, b: 255 },   // Blue
            { r: 50, g: 255, b: 50 },   // Green
            { r: 150, g: 50, b: 255 }   // Purple
        ];
        const baseColor = colors[Math.floor(Math.random() * colors.length)];
        
        // Add random variation (+- 30)
        this.r = Math.min(255, Math.max(0, baseColor.r + (Math.random() * 60 - 30)));
        this.g = Math.min(255, Math.max(0, baseColor.g + (Math.random() * 60 - 30)));
        this.b = Math.min(255, Math.max(0, baseColor.b + (Math.random() * 60 - 30)));
    }

    pickDesiredY() {
        const waterBiomes = getWaterBiomes();
        const biome = waterBiomes.find(b => 
            this.x >= b.x1 && this.x <= b.x2
        );
        if (biome) {
            const minDepth = 10;
            const maxDepth = Math.min(200, biome.y2 - biome.y1);
            const actualMax = Math.max(minDepth, maxDepth);
            this.desiredY = biome.y1 + minDepth + Math.random() * (actualMax - minDepth);
        } else {
            this.desiredY = this.y;
        }
    }

    onBiomeChange(inWater) {
        if (inWater) {
            this.pickDesiredY();
            // Re-entry splash: flee downwards randomly
            this.fleeTimer = 1.0;
            this.speed = this.normalSpeed * 3;
            // Downward angle (PI is Left, 0 is Right, PI/2 is Down)
            // 0 to PI covers all downward directions as per math conventions usually 0=Right, PI/2=Down, PI=Left, 3PI/2=Up
            // But here gravity is +y (down), so positive Y is down.
            // Angle 0=Right, PI=Left. Down is PI/2?
            // "Math.random() * Math.PI" gives 0 to 3.14.
            // If 0 is Right and PI is Left, then angles between 0 and PI are "Down" in canvas/screen coords where +Y is Down.
            this.angle = Math.random() * Math.PI;
        }
    }

    updateAI(threatGrid, gridSize, inWater, deltaTime) {
        let closestDistSq = Infinity;
        let closestThreat = null;

        // Lazy threat lookup
        if (threatGrid && inWater) {
            const cx = Math.floor(this.x / gridSize);
            const cy = Math.floor(this.y / gridSize);
            
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const key = `${cx + i},${cy + j}`;
                    if (threatGrid.has(key)) {
                        const cellThreats = threatGrid.get(key);
                        for (const threat of cellThreats) {
                            const dx = this.x - threat.x;
                            const dy = this.y - threat.y;
                            let effectiveDistSq = dx * dx + dy * dy;
                            
                            const vx = threat.vx || 0;
                            const vy = threat.vy || 0;

                            // Optimization: Dot product check.
                            // Only calculate future position if threat is moving closer (dot > 0).
                            // If dot <= 0, the threat is moving away or perpendicular, so current position is closest.
                            if ((dx * vx + dy * vy) > 0) {
                                // Lookahead 0.3s for fast moving threats
                                const futureX = threat.x + vx * 0.3;
                                const futureY = threat.y + vy * 0.3;
                                const fdx = this.x - futureX;
                                const fdy = this.y - futureY;
                                const futureDistSq = fdx * fdx + fdy * fdy;
                                
                                if (futureDistSq < effectiveDistSq) effectiveDistSq = futureDistSq;
                            }

                            if (effectiveDistSq < closestDistSq) {
                                closestDistSq = effectiveDistSq;
                                closestThreat = threat;
                            }
                        }
                    }
                }
            }
        }

        const fleeDistance = 150; // Increased detection range
        if (closestThreat && closestDistSq < fleeDistance * fleeDistance) {
            // Flee
            const dx = this.x - closestThreat.x;
            const dy = this.y - closestThreat.y;
            this.angle = Math.atan2(dy, dx);
            this.speed = this.normalSpeed * 3; // Swim faster
            this.fleeTimer = 1.5; // Continue fleeing for 1.5 seconds
        } else if (this.fleeTimer > 0) {
            // Continue fleeing
            this.speed = this.normalSpeed * 3;
            
            if (this.fleeTimer <= 0) {
                this.pickDesiredY();
            }
        } else {
            // Return to normal
            this.speed = this.normalSpeed;
            
            if (inWater) {
                // Determine base horizontal direction
                if (Math.abs(Math.cos(this.angle)) < 0.5) {
                     this.angle = Math.random() < 0.5 ? 0 : Math.PI;
                }
                const baseAngle = (Math.abs(this.angle) < Math.PI / 2) ? 0 : Math.PI;
                
                // Adjust for desiredY
                const dy = this.desiredY - this.y;
                const threshold = 5;
                
                if (Math.abs(dy) > threshold) {
                    const incline = 0.2; 
                    if (dy > 0) { // Target is below
                        this.angle = baseAngle === 0 ? incline : Math.PI - incline;
                    } else { // Target is above
                        this.angle = baseAngle === 0 ? -incline : Math.PI + incline;
                    }
                } else {
                    this.angle = baseAngle;
                }
            }
        }
    }

    applyPhysics(inWater, deltaTime) {
        // Fish: Gravity in air, no gravity in water.
        if (!inWater) {
            // Gravity
            this.vy += 50.0 * deltaTime;
            
            // Air Drag
            const drag = 0.99;
            const dragFactor = Math.pow(drag, deltaTime * 100);
            this.vx *= dragFactor;
            this.vy *= dragFactor;
        } else {
            // In water: Swim in direction
            this.vx = Math.cos(this.angle) * this.speed;
            this.vy = Math.sin(this.angle) * this.speed;
        }
    }
}
