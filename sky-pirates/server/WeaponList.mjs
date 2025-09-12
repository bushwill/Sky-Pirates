// name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle


import { Gun } from "./Gun.mjs"

export function createGun(selection, level = 1) {
    switch (selection) {
        case 0:
            return createMachineGun(level);
        case 1:
            return createCannon(level);
        case 2:
            return createScorpion(level);
        default:
            throw new Error("Invalid gun selection");
    }
}

export function createMachineGun(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Machine Gun Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (100.0 + level * 25.0);
    const heatEfficiency = randomFactor * (5.0 - level * 0.5);
    const damage = randomFactor * (15.0 + level * 2.5);
    const cooldownTime = randomFactor * (150 - level * 10);
    const projectileSpeed = randomFactor * (1500.0 + level * 50.0);
    const projectileSize = randomFactor * (1 + level * 0.25);
    const maxAngle = randomFactor * (Math.PI / 12 + level * Math.PI / 36);
    const value = randomFactor * (10 + level * 10);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createCannon(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Cannon Lvl " + level;
    const weight = randomFactor * 2.2;
    const maxHeat = randomFactor * (150.0 + level * 10.0);
    const heatEfficiency = randomFactor * (25 - level * 5);
    const damage = randomFactor * (50.0 + level * 5);
    const cooldownTime = randomFactor * (600 - level * 100);
    const projectileSpeed = randomFactor * (3000.0 + level * 1000.0);
    const projectileSize = randomFactor * (2.0 + level * 0.5);
    const maxAngle = randomFactor * (Math.PI / 12 + level * Math.PI / 60);
    const value = randomFactor * (10 + level * 10);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createScorpion(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Scorpion Lvl " + level;
    const weight = randomFactor * 1.5;
    const maxHeat = randomFactor * (100.0 + level * 25.0);
    const heatEfficiency = randomFactor * (4.0 - level);
    const damage = randomFactor * (8.0 + level);
    const cooldownTime = randomFactor * (70 - level * 10);
    const projectileSpeed = randomFactor * (1000.0 + level * 100.0);
    const projectileSize = randomFactor * 0.5;
    const maxAngle = randomFactor * (Math.PI / 48 + level * Math.PI / 96);
    const value = randomFactor * (10 + level * 10);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createEnemyGun(selection, level = 1) {
    switch (selection) {
        case 0:
            return createPeaShooter(level);
        case 1:
            return createBoatGun(level);
        default:
            throw new Error("Invalid gun selection");
    }
}

export function createPeaShooter(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1; // Randomness for variation
    const name = "Pea Shooter Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (100.0 + level * 25.0);
    const heatEfficiency = randomFactor * (10.0 - level * 0.5);
    const damage = randomFactor * (3.0 + level * 1.0);
    const cooldownTime = randomFactor * (500 - level * 10);
    const projectileSpeed = randomFactor * (1000.0 + level * 50.0);
    const projectileSize = randomFactor * (0.75 + level * 0.25);
    const maxAngle = Math.PI / 8 + level * Math.PI / 24;
    const value = randomFactor * (20 + level * 30);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createBoatGun(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Boat Gun Lvl " + level;
    const weight = randomFactor * 1.0;
    const maxHeat = randomFactor * (120.0 + level * 20.0);
    const heatEfficiency = randomFactor * (20.0 - level * 2.0);
    const damage = randomFactor * (40.0 + level * 20.0);
    const cooldownTime = randomFactor * 800;
    const projectileSpeed = randomFactor * (1400.0 + level * 200.0);
    const projectileSize = randomFactor * (2.5 + level * 0.5);
    const maxAngle = Math.PI;
    const value = randomFactor * (50 + level * 30);

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}
