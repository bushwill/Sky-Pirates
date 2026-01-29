// name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle


import { Gun } from "./Gun.mjs"

export function getRandomGunType() {
    // Weights: MachineGun(2), Cannon(2), Scorpion(2), Firework(1), Flamethrower(1)
    const weights = [
        { type: 0, weight: 2 },
        { type: 1, weight: 2 },
        { type: 2, weight: 2 },
        { type: 3, weight: 1 },
        { type: 4, weight: 1 }
    ];
    
    const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const item of weights) {
        if (random < item.weight) {
            return item.type;
        }
        random -= item.weight;
    }
    return 0; // Fallback
}

export function createGun(selection, level = 1) {
    switch (selection) {
        case 0:
            return createMachineGun(level);
        case 1:
            return createCannon(level);
        case 2:
            return createScorpion(level);
        case 3:
            return createFireworkLauncher(level);
        case 4:
            return createFlamethrower(level);
        default:
            throw new Error("Invalid gun selection");
    }
}

export function createMachineGun(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Machine Gun Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (5.0 - level * 0.1);
    const damage = randomFactor * (20.0 + level * 1.0);
    const cooldownTime = randomFactor * (150 - level * 5);
    const projectileSpeed = randomFactor * (1500.0 + level * 30.0);
    const projectileSize = randomFactor * (1 + level * 0.05);
    // Inverted: Starts wide (45 deg), gets narrow (18 deg at Lvl 10)
    const maxAngle = randomFactor * Math.max(0.01, Math.PI / 4 - (level - 1) * Math.PI / 60);
    const value = randomFactor * (50 + adjustedLevel * 200);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel);
    const projectileRange = 1500;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createCannon(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Cannon Lvl " + level;
    const weight = randomFactor * 2.2;
    const maxHeat = randomFactor * (150.0 + level * 8.0);
    const heatEfficiency = randomFactor * (25 - level * 0.5);
    const damage = randomFactor * (50.0 + level * 2.5);
    const cooldownTime = randomFactor * (600 - level * 10);
    const projectileSpeed = randomFactor * (3000.0 + level * 150.0);
    const projectileSize = randomFactor * (2.0 + level * 0.1);
    // Inverted: Starts wide (~37 deg), gets narrow (~17 deg at Lvl 10)
    const maxAngle = randomFactor * Math.max(0.01, 5 * Math.PI / 24 - (level - 1) * Math.PI / 80);
    const value = randomFactor * (150 + adjustedLevel * 300);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel);
    const projectileRange = 1500;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createScorpion(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Scorpion Lvl " + level;
    const weight = randomFactor * 1.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (4.0 - level * 0.1);
    const damage = randomFactor * (10.0 + level * 0.5);
    const cooldownTime = randomFactor * (70 - level * 4);
    const projectileSpeed = randomFactor * (1000.0 + level * 50.0);
    const projectileSize = randomFactor * 0.5;
    // Inverted: Starts wide (~19 deg), gets narrow (~5 deg at Lvl 10)
    const maxAngle = randomFactor * Math.max(0.01, 5 * Math.PI / 48 - (level - 1) * Math.PI / 120);
    const value = randomFactor * (80 + adjustedLevel * 350);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel);
    const projectileRange = 1000;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createFireworkLauncher(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Firework Launcher Lvl " + level;
    const weight = randomFactor * 1.0;
    const maxHeat = 100.0;
    const heatEfficiency = 100.0;
    const damage = randomFactor * (40.0 + level * 5.0); // Explosion damage handled in projectiles
    const cooldownTime = 0; // No cooldown, limited by heat
    const projectileSpeed = randomFactor * (300.0 + level * 10.0);
    const projectileSize = randomFactor * 1.0;
    // Inverted: Starts wide (15 deg), gets narrow (~5 deg at Lvl 10)
    const maxAngle = randomFactor * Math.max(0.01, Math.PI / 12 - (level - 1) * Math.PI / 160);
    const value = randomFactor * (120 + adjustedLevel * 150);
    const heatDispersion = randomFactor * (20 + adjustedLevel);
    const projectileLifetime = 750;
    const projectileRange = projectileSpeed * (projectileLifetime / 1000);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createFlamethrower(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Flamethrower Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (200.0 + level * 20.0);
    const heatEfficiency = randomFactor * (2.0 - level * 0.1); // High heat generation per shot, but rapid fire
    const damage = randomFactor * (1.0 + level * 0.05); // Low damage per particle
    const cooldownTime = 10;
    const projectileSpeed = randomFactor * (250.0 + level * 10.0); // Slower than bullets
    const projectileSize = randomFactor * (1 + level * 0.05);
    const maxAngle = Math.PI * 2; // 360 degrees
    const value = randomFactor * (100 + adjustedLevel * 250);
    const heatDispersion = randomFactor * (40.0 + adjustedLevel * 2.0); // Rapid cooling needed
    const projectileRange = 200; // Short range
    const projectileLifetime = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createEnemyGun(selection, level = 1) {
    switch (selection) {
        case 0:
            return createPeaShooter(level);
        case 1:
            return createBoatGun(level);
        case 2:
            return createBoatScorpion(level);
        default:
            throw new Error("Invalid gun selection");
    }
}

export function createPeaShooter(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Pea Shooter Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (10.0 - level * 0.4);
    const damage = randomFactor * (8.0 + level * 1.0);
    const cooldownTime = randomFactor * (500 - level * 40);
    const projectileSpeed = randomFactor * (1000.0 + level * 150.0);
    const projectileSize = randomFactor * (0.75 + level * 0.15);
    const maxAngle = Math.PI / 8 + level * Math.PI / 40;
    const value = randomFactor * (20 + level * 30);
    const adjustedLevel = level - 1;
    const heatDispersion = randomFactor * (12.5 + adjustedLevel * 2.0);
    const projectileRange = 1000;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createBoatGun(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Boat Heavy Gun Lvl " + level;
    const weight = randomFactor * 1.0;
    const maxHeat = randomFactor * (120.0 + level * 12.0);
    const heatEfficiency = randomFactor * (20.0 - level * 1.0);
    const damage = randomFactor * (20.0 + level * 2.0);
    const cooldownTime = randomFactor * 1000;
    const projectileSpeed = randomFactor * (1400.0 + level * 100.0);
    const projectileSize = randomFactor * (2.5 + level * 0.3);
    const maxAngle = Math.PI;
    const value = randomFactor * (50 + level * 30);
    const heatDispersion = 30;
    const projectileRange = 1500;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}

export function createBoatScorpion(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Boat Scorpion Lvl " + level;
    const weight = randomFactor * 1.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (4.0 - level * 0.3);
    const damage = randomFactor * (5.0 + level * 0.5);
    const cooldownTime = randomFactor * (70 - level * 4);
    const projectileSpeed = randomFactor * (1000.0 + level * 50.0);
    const projectileSize = randomFactor * 0.5;
    const maxAngle = Math.PI;
    const value = randomFactor * (10 + level * 10);
    const heatDispersion = 30;
    const projectileRange = 1000;
    const projectileLifetime = 5000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange, projectileLifetime);
}