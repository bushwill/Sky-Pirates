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
    const adjustedLevel = level - 1;
    const name = "Machine Gun Lvl " + level;
    const weight = randomFactor * 0.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (5.0 - level * 0.3);
    const damage = randomFactor * (20.0 + level * 1.0);
    const cooldownTime = randomFactor * (150 - level * 5);
    const projectileSpeed = randomFactor * (1500.0 + level * 30.0);
    const projectileSize = randomFactor * (1 + level * 0.15);
    const maxAngle = randomFactor * (Math.PI / 12 + level * Math.PI / 60);
    const value = randomFactor * (50 + adjustedLevel * 150);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel * 3.5 + Math.max(0, adjustedLevel - 4) * 2.0);
    const projectileRange = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
}

export function createCannon(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Cannon Lvl " + level;
    const weight = randomFactor * 2.2;
    const maxHeat = randomFactor * (150.0 + level * 8.0);
    const heatEfficiency = randomFactor * (25 - level * 2);
    const damage = randomFactor * (50.0 + level * 2.0);
    const cooldownTime = randomFactor * (600 - level * 40);
    const projectileSpeed = randomFactor * (3000.0 + level * 300.0);
    const projectileSize = randomFactor * (2.0 + level * 0.3);
    const maxAngle = randomFactor * (Math.PI / 12 + level * Math.PI / 80);
    const value = randomFactor * (150 + adjustedLevel * 400);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel * 3.5 + Math.max(0, adjustedLevel - 4) * 2.0);
    const projectileRange = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
}

export function createScorpion(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const adjustedLevel = level - 1;
    const name = "Scorpion Lvl " + level;
    const weight = randomFactor * 1.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (4.0 - level * 0.3);
    const damage = randomFactor * (10.0 + level * 0.5);
    const cooldownTime = randomFactor * (70 - level * 4);
    const projectileSpeed = randomFactor * (1000.0 + level * 50.0);
    const projectileSize = randomFactor * 0.5;
    const maxAngle = randomFactor * (Math.PI / 48 + level * Math.PI / 120);
    const value = randomFactor * (80 + adjustedLevel * 200);
    const heatDispersion = randomFactor * (17.5 + adjustedLevel * 3.5 + Math.max(0, adjustedLevel - 4) * 2.0);
    const projectileRange = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
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

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
}

export function createBoatGun(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Boat Heavy Gun Lvl " + level;
    const weight = randomFactor * 1.0;
    const maxHeat = randomFactor * (120.0 + level * 12.0);
    const heatEfficiency = randomFactor * (20.0 - level * 1.0);
    const damage = randomFactor * (35.0 + level * 3.0);
    const cooldownTime = randomFactor * 1500;
    const projectileSpeed = randomFactor * (1400.0 + level * 100.0);
    const projectileSize = randomFactor * (2.5 + level * 0.3);
    const maxAngle = Math.PI;
    const value = randomFactor * (50 + level * 30);
    const heatDispersion = 30;
    const projectileRange = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
}

export function createBoatScorpion(level, random = true) {
    const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
    const name = "Boat Scorpion Lvl " + level;
    const weight = randomFactor * 1.5;
    const maxHeat = randomFactor * (100.0 + level * 15.0);
    const heatEfficiency = randomFactor * (4.0 - level * 0.3);
    const damage = randomFactor * (10.0 + level * 0.5);
    const cooldownTime = randomFactor * (70 - level * 4);
    const projectileSpeed = randomFactor * (1000.0 + level * 50.0);
    const projectileSize = randomFactor * 0.5;
    const maxAngle = Math.PI;
    const value = randomFactor * (10 + level * 10);
    const heatDispersion = 30;
    const projectileRange = 1000;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value, heatDispersion, projectileRange);
}