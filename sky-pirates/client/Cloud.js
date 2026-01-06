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
    const rng = new SeededRandom(12345);
    
    // Limits
    const minX = -100000;
    const maxX = 100000;
    const fixedY = -6000;
    
    // Create cloud clusters for structure instead of uniform noise
    const numClusters = 400; 
    
    for (let i = 0; i < numClusters; i++) {
        // Cluster center
        const cx = rng.range(minX, maxX);
        const baseZ = rng.range(50, 95);
        
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
            const y = fixedY; 
            const z = baseZ + zOffset;

            // Visual properties
            const greyVal = rng.range(220, 255);
            const r = greyVal;
            const g = greyVal;
            const b = greyVal;
            
            // Fade alpha slightly at edges of cluster to blend
            const distFactor = Math.abs(xOffset) / clusterSpreadX; 
            const alphaBase = rng.range(20, 100);
            const alpha = alphaBase * (1.0 - (distFactor * 0.3)); // 30% fade at max extent

            // Size variation
            const size = rng.range(500, 2000) * (0.8 + rng.random() * 0.4);
            
            targetArray.push(new Cloud(x, y, z, r, g, b, alpha, size));
        }
    }
}
