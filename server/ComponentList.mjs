import { Engine, Chassis, Wings } from "./Components.mjs";

/* 
   ENGINE COMPONENTS
   The selection parameter maps to the following variants:
     0: Pirate Standard Engine – the default balanced engine.
     1: Core Standard Engine   – the core manufacturer's engine.
     2: Kamen Standard Engine  – adjust values as needed.
     3: Aero Standard Engine   – adjust values as needed.
     4: Nova Standard Engine   – adjust values as needed.
*/
export function createEngine(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPirateStandardEngine(level);
    case 1:
      return createCoreStandardEngine(level);
    case 2:
      return createKamenStandardEngine(level);
    case 3:
      return createAeroStandardEngine(level);
    case 4:
      return createNovaStandardEngine(level);
    default:
      console.warn("No engine variant available for selection " + selection + ". Defaulting to Pirate Standard Engine.");
      return createPirateStandardEngine(level);
  }
}

/* 
   CHASSIS COMPONENTS
   The selection parameter maps to the following variants:
     0: Pirate Standard Chassis – the default chassis.
     1: Core Standard Chassis   – the core manufacturer's chassis.
     2: Kamen Standard Chassis  – adjust values as needed.
     3: Aero Standard Chassis   – adjust values as needed.
     4: Nova Standard Chassis   – adjust values as needed.
*/
export function createChassis(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPirateStandardChassis(level);
    case 1:
      return createCoreStandardChassis(level);
    case 2:
      return createKamenStandardChassis(level);
    case 3:
      return createAeroStandardChassis(level);
    case 4:
      return createNovaStandardChassis(level);
    default:
      console.warn("No chassis variant available for selection " + selection + ". Defaulting to Pirate Standard Chassis.");
      return createPirateStandardChassis(level);
  }
}

/* 
   WINGS COMPONENTS
   The selection parameter maps to the following variants:
     0: Pirate Standard Wings – the default wings.
     1: Core Standard Wings   – the core manufacturer's wings.
     2: Kamen Standard Wings  – adjust values as needed.
     3: Aero Standard Wings   – adjust values as needed.
     4: Nova Standard Wings   – adjust values as needed.
*/
export function createWings(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPirateStandardWings(level);
    case 1:
      return createCoreStandardWings(level);
    case 2:
      return createKamenStandardWings(level);
    case 3:
      return createAeroStandardWings(level);
    case 4:
      return createNovaStandardWings(level);
    default:
      console.warn("No wings variant available for selection " + selection + ". Defaulting to Pirate Standard Wings.");
      return createPirateStandardWings(level);
  }
}

export function createPirateStandardEngine(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Engine Lvl " + level;
  const weight = 1.0;
  const maxPower = 350.0 + adjustedLevel * 200.0;
  const minPower = 0.0;
  const heatEfficiency = 0.06;
  const maxHeat = 80.0 + adjustedLevel * 10.0;
  // Value matching engine: 20 + adjustedLevel * 40
  const value = 20 + adjustedLevel * 60;
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createCoreStandardEngine(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Core Standard Engine Lvl " + level;
  const weight = 1.5;
  const maxPower = 400.0 + adjustedLevel * 200.0;
  const minPower = 0.0;
  const heatEfficiency = 0.05;
  const maxHeat = 100.0 + adjustedLevel * 10.0;
  // Value matching engine: 80 + adjustedLevel * 100
  const value = 80 + adjustedLevel * 200;
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createKamenStandardEngine(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Engine Lvl " + level;
  const weight = 3.0;
  const maxPower = 600.0 + adjustedLevel * 200.0;
  const minPower = 0.0;
  const heatEfficiency = 0.04;
  const maxHeat = 200.0 + adjustedLevel * 50.0;
  // Value matching engine: 100 + adjustedLevel * 150
  const value = 100 + adjustedLevel * 300;
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createAeroStandardEngine(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Aero Standard Engine Lvl " + level;
  const weight = 0.8;
  const maxPower = 400.0 + adjustedLevel * 200.0;
  const minPower = 0.0;
  const heatEfficiency = 0.05;
  const maxHeat = 100.0 + adjustedLevel * 10.0;
  // Value matching engine: 80 + adjustedLevel * 100
  const value = 80 + adjustedLevel * 200;
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createNovaStandardEngine(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Nova Standard Engine Lvl " + level;
  const weight = 2.0;
  const maxPower = 800.0 + adjustedLevel * 400.0;
  const minPower = 0.0;
  const heatEfficiency = 0.05;
  const maxHeat = 150.0 + adjustedLevel * 20.0;
  // Value matching engine: 200 + adjustedLevel * 500
  const value = 200 + adjustedLevel * 500;
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createPirateStandardChassis(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Chassis Lvl " + level;
  const weight = 1.5;
  const topSpeed = 180.0 + adjustedLevel * 20;
  const maxHull = 90.0 + adjustedLevel * 10;
  const heatDispersion = 12.5 + adjustedLevel * 1.25;
  const buoyancy = 2.5;
  const value = 20 + adjustedLevel * 60;
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createCoreStandardChassis(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Core Standard Chassis Lvl " + level;
  const weight = 1.5;
  const topSpeed = 200.0 + adjustedLevel * 20;
  const maxHull = 100.0 + adjustedLevel * 10;
  const heatDispersion = 16.0 + adjustedLevel * 1.5;
  const buoyancy = 2.0;
  const value = 80 + adjustedLevel * 200;
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createKamenStandardChassis(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Chassis Lvl " + level;
  const weight = 4.0;
  const topSpeed = 300.0 + adjustedLevel * 50;
  const maxHull = 150.0 + adjustedLevel * 10;
  const heatDispersion = 15.0 + adjustedLevel * 1.2;
  const buoyancy = 1.0;
  const value = 100 + adjustedLevel * 300;
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createAeroStandardChassis(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Aero Standard Chassis Lvl " + level;
  const weight = 1.0;
  const topSpeed = 180.0 + adjustedLevel * 10;
  const maxHull = 80.0 + adjustedLevel * 10;
  const heatDispersion = 20.0 + adjustedLevel * 2.0;
  const buoyancy = 3.0;
  const value = 80 + adjustedLevel * 200;
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createNovaStandardChassis(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Nova Standard Chassis Lvl " + level;
  const weight = 2.0 + adjustedLevel * 0.3;
  const topSpeed = 250.0 + adjustedLevel * 20;
  const maxHull = 100.0 + adjustedLevel * 10;
  const heatDispersion = 17.5 + adjustedLevel * 2.0;
  const buoyancy = 2.0;
  const value = 200 + adjustedLevel * 500;
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createPirateStandardWings(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Wings Lvl " + level;
  const weight = 0.5;
  const baseTurnSpeed = 1.8 + adjustedLevel * 0.2;
  const minTurnSpeed = 0.15 + adjustedLevel * 0.05;
  const maxSpeed = 150.0 + adjustedLevel * 15;
  const liftEfficiency = 0.5;
  const minLiftSpeed = 50.0 - adjustedLevel * 5;
  const liftAngle = Math.PI / 8 + adjustedLevel * Math.PI / 32;
  const airBrake = true;
  const airBrakeStrength = 2.0 + adjustedLevel * 0.2;
  const value = 20 + adjustedLevel * 60;
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createCoreStandardWings(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Core Standard Wings Lvl " + level;
  const weight = 0.5;
  const baseTurnSpeed = 2.0 + adjustedLevel * 0.2;
  const minTurnSpeed = 0.2 + adjustedLevel * 0.05;
  const maxSpeed = 180.0 + adjustedLevel * 18;
  const liftEfficiency = 0.5;
  const minLiftSpeed = 60.0 - adjustedLevel * 5;
  const liftAngle = Math.PI / 8 + adjustedLevel * Math.PI / 32;
  const airBrake = true;
  // Value adjusted to match engine: 80 + adjustedLevel * 100
  const airBrakeStrength = 3.0 + adjustedLevel * 0.3;
  const value = 80 + adjustedLevel * 200;
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createKamenStandardWings(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Wings Lvl " + level;
  const weight = 1.5;
  const baseTurnSpeed = 1.5 + adjustedLevel * 0.2;
  const minTurnSpeed = 0.3 + adjustedLevel * 0.05;
  const maxSpeed = 220.0 + adjustedLevel * 18;
  const liftEfficiency = 0.6;
  const minLiftSpeed = 80.0 - adjustedLevel * 5;
  const liftAngle = Math.PI / 10 + adjustedLevel * Math.PI / 32;
  const airBrake = true;
  // Value adjusted to match engine: 100 + adjustedLevel * 150
  const airBrakeStrength = 2.0 + adjustedLevel * 0.2;
  const value = 100 + adjustedLevel * 300;
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createAeroStandardWings(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Aero Standard Wings Lvl " + level;
  const weight = 0.3;
  const baseTurnSpeed = 3.0 + adjustedLevel * 0.2;
  const minTurnSpeed = 0.1 + adjustedLevel * 0.05;
  const maxSpeed = 160.0 + adjustedLevel * 18;
  const liftEfficiency = 0.8;
  const minLiftSpeed = 60.0 - adjustedLevel * 5;
  const liftAngle = Math.PI / 6 + adjustedLevel * Math.PI / 32;
  const airBrake = true;
  // Value adjusted to match engine: 80 + adjustedLevel * 100
  const airBrakeStrength = 4.0 + adjustedLevel * 0.4;
  const value = 80 + adjustedLevel * 200;
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createNovaStandardWings(level = 1) {
  const adjustedLevel = level - 1;
  const name = "Nova Standard Wings Lvl " + level;
  const weight = 1.0;
  const baseTurnSpeed = 2.2 + adjustedLevel * 0.2;
  const minTurnSpeed = 0.5 + adjustedLevel * 0.05;
  const maxSpeed = 220.0 + adjustedLevel * 18;
  const liftEfficiency = 0.4;
  const minLiftSpeed = 80.0 - adjustedLevel * 5;
  const liftAngle = Math.PI / 12 + adjustedLevel * Math.PI / 32;
  const airBrake = true;
  // Value adjusted to match engine: 200 + adjustedLevel * 500
  const airBrakeStrength = 3.0 + adjustedLevel * 0.3;
  const value = 200 + adjustedLevel * 500;
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}