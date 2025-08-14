export class Engine {
  constructor(name = "standard engine", weight = 1.0, maxPower = 400.0, minPower = 0.0, heatEfficiency = 0.05, maxHeat = 100.0, value = 40) {
    this.type = "engine"; // type of component
    this.name = name;
    this.weight = weight;
    this.power = 0;         // current throttle
    this.maxPower = maxPower;    // max engine power
    this.minPower = minPower;   // min engine power
    this.heatEfficiency = heatEfficiency; // heat generated per unit of engine power per second
    this.heat = 0.0;          // current heat level
    this.maxHeat = maxHeat;
    this.value = value;
    this.position = null;
  }
}

export class Chassis {
  constructor(name = "standard chassis", weight = 1.5, topSpeed = 200.0, maxHull = 100.0, heatDispersion = 15.0, buoyancy = 2.0, value = 20) {
    this.type = "chassis"; // type of component
    this.name = name;
    this.weight = weight; // weight of the chassis
    this.topSpeed = topSpeed; // max speed of the chassis before breakdown
    this.hull = maxHull; // current hull strength
    this.maxHull = maxHull; // max hull strength
    this.heatDispersion = heatDispersion; // heat dispersed per second
    this.buoyancy = buoyancy; // buoyancy factor for water
    this.value = value;
    this.position = null;
  }
}

export class Wings {
  constructor(name = "standard wing", weight = 0.5, baseTurnSpeed = 2.0, minTurnSpeed = 0.2, maxSpeed = 180.0, liftEfficiency = 0.5, minLiftSpeed = 60.0, liftAngle = Math.PI / 8, airBrake = true, airBrakeStrength = 2.0, value = 20) {
    this.type = "wings"; // type of component
    this.name = name;
    this.weight = weight; // weight of the wings
    this.baseTurnSpeed = baseTurnSpeed;  // max turn speed at low speed
    this.minTurnSpeed = minTurnSpeed;   // min turn speed at high speed
    this.maxSpeed = maxSpeed;          // speed at which min turn speed applies
    this.liftEfficiency = liftEfficiency;
    this.minLiftSpeed = minLiftSpeed; // speed at which lift starts to apply
    this.liftAngle = liftAngle; // angle of attack boundaries
    this.airBrake = airBrake; // whether the wings can act as an air brake
    this.airBrakeStrength = airBrakeStrength; // strength of the air brake
    this.value = value;
    this.position = null;
  }
}