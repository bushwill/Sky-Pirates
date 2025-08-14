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
export function createMachineGun(level) {
    const name = "Machine Gun Lvl " + level;
    const weight = 0.5;
    const maxHeat = 100.0 + level * 25.0;
    const heatEfficiency = 5.0 - level * 0.5;
    const damage = 15.0 + level * 2.5;
    const cooldownTime = 150 - level * 10;
    const projectileSpeed = 1500.0 + level * 50.0;
    const projectileSize = 1 + level * 0.25;
    const maxAngle = Math.PI / 12 + level * Math.PI / 36;
    const value = 10 + level * 10;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createCannon(level) {
    const name = "Cannon Lvl " + level;
    const weight = 2.2;
    const maxHeat = 150.0 + level * 10.0;
    const heatEfficiency = 25 - level * 5;
    const damage = 50.0 + level * 5;
    const cooldownTime = 600 - level * 100;
    const projectileSpeed = 3000.0 + level * 1000.0;
    const projectileSize = 2.0 + level * 0.5;
    const maxAngle = Math.PI / 12 + level * Math.PI / 60;
    const value = 10 + level * 10;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

export function createScorpion(level) {
    const name = "Scorpion Lvl " + level;
    const weight = 1.5;
    const maxHeat = 100.0 + level * 25.0;
    const heatEfficiency = 4.0 - level;
    const damage = 8.0 + level;
    const cooldownTime = 70 - level * 10;
    const projectileSpeed = 1000.0 + level * 100.0;
    const projectileSize = 0.5;
    const maxAngle = Math.PI / 48 + level * Math.PI / 96;
    const value = 10 + level * 10;

    return new Gun(name, weight, maxHeat, heatEfficiency, damage, cooldownTime, projectileSpeed, projectileSize, maxAngle, value);
}

