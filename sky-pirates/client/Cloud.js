class Cloud {
    constructor(x, y, z, r, g, b, alpha, size) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.r = r;
        this.g = g;
        this.b = b;
        this.alpha = alpha;
        this.size = size;
    }
}

// Random number generator for deterministic cloud generation
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    // Simple Linear Congruential Generator (LCG)
    random() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    range(min, max) {
        return min + this.random() * (max - min);
    }
}

// Function to generate deterministic cloud layer
function generateCloudLayer(targetArray) {
    // Determine the fixed seed so clouds are always the same for everyone
    const rng = new SeededRandom(67);
    
    // Limits
    const minX = -150000;
    const maxX = 150000;

    // Helper function to generate clusters
    const createClusters = (numClusters, minY, maxY, minZ, maxZ) => {
        for (let i = 0; i < numClusters; i++) {
            // Cluster center
            const cx = rng.range(minX, maxX);
            // Cluster height (Y)
            const cy = (minY === maxY) ? minY : rng.range(minY, maxY);
            
            // Distribute Z uniformly across a deep range
            // With inverse-distance scaling in Display.js, uniform Z means most clouds appear far away (small)
            // Range 200 (close/large) to 80000 (horizon/tiny) - Deep background
            const baseZ = rng.range(minZ, maxZ); 
            
            // Randomize cluster characteristics
            // Roughly 15,000 clouds total target (avg 37 per cluster)
            const cloudsInCluster = Math.floor(rng.range(20, 55));
            const clusterSpreadX = rng.range(1500, 5000); // How wide the cloud bank is
            const clusterSpreadZ = rng.range(0, 2); // Keep Z tight so they move together as a parallax layer
            
            for (let j = 0; j < cloudsInCluster; j++) {
                // Gaussian-ish distribution for organic shape (bias towards center of cluster)
                // Summing two randoms creates a "triangle" distribution, good enough for "clumping"
                const xOffset = (rng.random() - 0.5 + rng.random() - 0.5) * clusterSpreadX;
                // Slight Z variation to prevent z-fighting flicker if that was an issue, but mostly flat
                const zOffset = (rng.random() - 0.5) * clusterSpreadZ;
                
                const x = cx + xOffset;
                const y = cy; 
                const z = baseZ + zOffset;

                // Visual properties
                const greyVal = rng.range(220, 240);
                const r = greyVal;
                const g = greyVal;
                const b = greyVal;
                
                // Fade alpha slightly at edges of cluster to blend
                const distFactor = Math.abs(xOffset) / clusterSpreadX; 
                const alphaBase = rng.range(20, 100);
                const alpha = alphaBase * (1.0 - (distFactor * 0.2)); // 30% fade at max extent

                // Size variation
                const size = rng.range(500, 2000) * (0.8 + rng.random() * 0.4);
                
                targetArray.push(new Cloud(x, y, z, r, g, b, alpha, size));
            }
        }
    };
    
    // Heavy Cloud Zone (Original Layer)
    // Fixed at Y = -6000
    createClusters(400, -6000, -6000, 200, 80000);

    // Light Cloud Zone (New Layer)
    // Spanning -6000 < y < -3000
    // Exclusively closer in Z value (Foreground only)
    createClusters(100, -6000, -3000, 200, 15000);

    // Sort clouds by Z descending (painter's algorithm)
    // Higher Z (background) drawn first, Lower Z (foreground) drawn last
    // This happens once at the end of generation
    targetArray.sort((a, b) => b.z - a.z);
}
