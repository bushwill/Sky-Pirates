export class Gun {
    constructor(name = "standard gun", weight = 0.5, maxHeat = 100.0, heatEfficiency = 5.0, damage = 15.0, cooldownTime = 150, projectileSpeed = 1000.0, projectileSize = 1, maxAngle = Math.PI/12, value = 10) {
        this.type = "gun"; // type of component
        this.name = name;
        this.weight = weight; // weight of the gun
        this.maxHeat = maxHeat; // max heat level of the gun
        this.heatEfficiency = heatEfficiency; // heat generated per unit of gun power per second
        this.damage = damage; // damage dealt by the gun
        this.cooldownTime = cooldownTime; // time between shots in milliseconds
        this.projectileSpeed = projectileSpeed; // speed of the projectile fired by the gun
        this.projectileSize = projectileSize; // size of the projectile fired by the gun

        this.cooldown = 0.0; // current cooldown time before the next shot can be fired
        this.heat = 0.0; // current heat level of the gun
        this.angle = 0.0; // angle of the gun in radians
        this.maxAngle = maxAngle / 2; // max angle of the gun in radians
        this.value = value;
    }

    reset() {
        this.cooldown = 0.0; // Reset cooldown time
        this.heat = 0.0; // Reset heat level
        this.angle = 0.0; // Reset angle
    }
}