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

export function createPirateStandardEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Engine Lvl " + level;
  const weight = randomFactor * 1.0;
  const maxPower = randomFactor * (350.0 + adjustedLevel * 200.0);
  const minPower = randomFactor * 0.0;
  const heatEfficiency = randomFactor * 0.06;
  const maxHeat = randomFactor * (80.0 + adjustedLevel * 10.0);
  const value = randomFactor * (20 + adjustedLevel * 60);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createCoreStandardEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Core Standard Engine Lvl " + level;
  const weight = randomFactor * 1.5;
  const maxPower = randomFactor * (400.0 + adjustedLevel * 200.0);
  const minPower = randomFactor * 0.0;
  const heatEfficiency = randomFactor * 0.05;
  const maxHeat = randomFactor * (100.0 + adjustedLevel * 10.0);
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createKamenStandardEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Engine Lvl " + level;
  const weight = randomFactor * 3.0;
  const maxPower = randomFactor * (600.0 + adjustedLevel * 200.0);
  const minPower = randomFactor * 0.0;
  const heatEfficiency = randomFactor * 0.04;
  const maxHeat = randomFactor * (200.0 + adjustedLevel * 50.0);
  const value = randomFactor * (100 + adjustedLevel * 300);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createAeroStandardEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Aero Standard Engine Lvl " + level;
  const weight = randomFactor * 0.8;
  const maxPower = randomFactor * (400.0 + adjustedLevel * 200.0);
  const minPower = randomFactor * 0.0;
  const heatEfficiency = randomFactor * 0.05;
  const maxHeat = randomFactor * (100.0 + adjustedLevel * 10.0);
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createNovaStandardEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Nova Standard Engine Lvl " + level;
  const weight = randomFactor * 2.0;
  const maxPower = randomFactor * (800.0 + adjustedLevel * 400.0);
  const minPower = randomFactor * 0.0;
  const heatEfficiency = randomFactor * 0.05;
  const maxHeat = randomFactor * (150.0 + adjustedLevel * 20.0);
  const value = randomFactor * (200 + adjustedLevel * 500);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createPirateStandardChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Chassis Lvl " + level;
  const weight = randomFactor * 1.5;
  const topSpeed = randomFactor * (180.0 + adjustedLevel * 20);
  const maxHull = randomFactor * (90.0 + adjustedLevel * 10);
  const heatDispersion = randomFactor * (12.5 + adjustedLevel * 1.25);
  const buoyancy = randomFactor * 2.5;
  const value = randomFactor * (20 + adjustedLevel * 60);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createCoreStandardChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Core Standard Chassis Lvl " + level;
  const weight = randomFactor * 1.5;
  const topSpeed = randomFactor * (200.0 + adjustedLevel * 20);
  const maxHull = randomFactor * (100.0 + adjustedLevel * 10);
  const heatDispersion = randomFactor * (16.0 + adjustedLevel * 1.5);
  const buoyancy = randomFactor * 2.0;
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createKamenStandardChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Chassis Lvl " + level;
  const weight = randomFactor * 4.0;
  const topSpeed = randomFactor * (300.0 + adjustedLevel * 50);
  const maxHull = randomFactor * (150.0 + adjustedLevel * 10);
  const heatDispersion = randomFactor * (15.0 + adjustedLevel * 1.2);
  const buoyancy = randomFactor * 1.0;
  const value = randomFactor * (100 + adjustedLevel * 300);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createAeroStandardChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Aero Standard Chassis Lvl " + level;
  const weight = randomFactor * 1.0;
  const topSpeed = randomFactor * (180.0 + adjustedLevel * 10);
  const maxHull = randomFactor * (80.0 + adjustedLevel * 10);
  const heatDispersion = randomFactor * (20.0 + adjustedLevel * 2.0);
  const buoyancy = randomFactor * 3.0;
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createNovaStandardChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Nova Standard Chassis Lvl " + level;
  const weight = randomFactor * (2.0 + adjustedLevel * 0.3);
  const topSpeed = randomFactor * (250.0 + adjustedLevel * 20);
  const maxHull = randomFactor * (100.0 + adjustedLevel * 10);
  const heatDispersion = randomFactor * (17.5 + adjustedLevel * 2.0);
  const buoyancy = randomFactor * 2.0;
  const value = randomFactor * (200 + adjustedLevel * 500);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createPirateStandardWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pirate Standard Wings Lvl " + level;
  const weight = randomFactor * 0.5;
  const baseTurnSpeed = randomFactor * (1.8 + adjustedLevel * 0.2);
  const minTurnSpeed = randomFactor * (0.15 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (150.0 + adjustedLevel * 15);
  const liftEfficiency = randomFactor * 0.5;
  const minLiftSpeed = randomFactor * (50.0);
  const liftAngle = randomFactor * (Math.PI / 8 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (2.0 + adjustedLevel * 0.2);
  const value = randomFactor * (20 + adjustedLevel * 60);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createCoreStandardWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Core Standard Wings Lvl " + level;
  const weight = randomFactor * 0.5;
  const baseTurnSpeed = randomFactor * (2.0 + adjustedLevel * 0.05);
  const minTurnSpeed = randomFactor * (0.2 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (180.0 + adjustedLevel * 18);
  const liftEfficiency = randomFactor * 0.5;
  const minLiftSpeed = randomFactor * (60.0);
  const liftAngle = randomFactor * (Math.PI / 8 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (3.0 + adjustedLevel * 0.3);
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createKamenStandardWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Kamen Standard Wings Lvl " + level;
  const weight = randomFactor * 1.5;
  const baseTurnSpeed = randomFactor * (1.5 + adjustedLevel * 0.05);
  const minTurnSpeed = randomFactor * (0.3 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (220.0 + adjustedLevel * 18);
  const liftEfficiency = randomFactor * 0.6;
  const minLiftSpeed = randomFactor * (80.0);
  const liftAngle = randomFactor * (Math.PI / 10 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (2.0 + adjustedLevel * 0.2);
  const value = randomFactor * (100 + adjustedLevel * 300);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createAeroStandardWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Aero Standard Wings Lvl " + level;
  const weight = randomFactor * 0.3;
  const baseTurnSpeed = randomFactor * (3.0 + adjustedLevel * 0.05);
  const minTurnSpeed = randomFactor * (0.1 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (160.0 + adjustedLevel * 18);
  const liftEfficiency = randomFactor * 0.8;
  const minLiftSpeed = randomFactor * (60.0);
  const liftAngle = randomFactor * (Math.PI / 6 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (4.0 + adjustedLevel * 0.4);
  const value = randomFactor * (80 + adjustedLevel * 200);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

export function createNovaStandardWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Nova Standard Wings Lvl " + level;
  const weight = randomFactor * 1.0;
  const baseTurnSpeed = randomFactor * (2.2 + adjustedLevel * 0.05);
  const minTurnSpeed = randomFactor * (0.5 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (220.0 + adjustedLevel * 18);
  const liftEfficiency = randomFactor * 0.4;
  const minLiftSpeed = randomFactor * (80.0);
  const liftAngle = randomFactor * (Math.PI / 12 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (3.0 + adjustedLevel * 0.3);
  const value = randomFactor * (200 + adjustedLevel * 500);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}

/* 
   ENGINE COMPONENTS
   The selection parameter maps to the following variants:
     0: Pea Shooter Engine – the default balanced engine.
*/
export function createEnemyEngine(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPeaShooterEngine(level);
    default:
      console.warn("No engine variant available for selection " + selection + ". Defaulting to Pea Shooter Engine.");
      return createPeaShooterEngine(level);
  }
}

/* 
   CHASSIS COMPONENTS
   The selection parameter maps to the following variants:
     0: Pea Shooter Chassis – the default chassis.
*/
export function createEnemyChassis(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPeaShooterChassis(level);
    default:
      console.warn("No chassis variant available for selection " + selection + ". Defaulting to Pea Shooter Chassis.");
      return createPeaShooterChassis(level);
  }
}

/* 
   WINGS COMPONENTS
   The selection parameter maps to the following variants:
     0: Pea Shooter Wings – the default wings.
*/
export function createEnemyWings(selection, level = 1) {
  switch (selection) {
    case 0:
      return createPeaShooterWings(level);
    default:
      console.warn("No wings variant available for selection " + selection + ". Defaulting to Pea Shooter Wings.");
      return createPeaShooterWings(level);
  }
}

export function createPeaShooterEngine(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pea Shooter Engine Lvl " + level;
  const weight = randomFactor * 1.0;
  const maxPower = randomFactor * (150.0 + adjustedLevel * 50.0);
  const minPower = 0.0;
  const heatEfficiency = randomFactor * 0.06;
  const maxHeat = randomFactor * (80.0 + adjustedLevel * 10.0);
  const value = randomFactor * (10 + adjustedLevel * 60);
  return new Engine(name, weight, maxPower, minPower, heatEfficiency, maxHeat, value);
}

export function createPeaShooterChassis(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pea Shooter Chassis Lvl " + level;
  const weight = randomFactor * 1.5;
  const topSpeed = randomFactor * (180.0 + adjustedLevel * 20);
  const maxHull = randomFactor * (40.0 + adjustedLevel * 5);
  const heatDispersion = randomFactor * (12.5 + adjustedLevel * 1.25);
  const buoyancy = randomFactor * 4.0;
  const value = randomFactor * (10 + adjustedLevel * 20);
  return new Chassis(name, weight, topSpeed, maxHull, heatDispersion, buoyancy, value);
}

export function createPeaShooterWings(level = 1, random = true) {
  const randomFactor = random ? 0.9 + Math.random() * 0.2 : 1;
  const adjustedLevel = level - 1;
  const name = "Pea Shooter Wings Lvl " + level;
  const weight = randomFactor * 0.5;
  const baseTurnSpeed = randomFactor * (1.2 + adjustedLevel * 0.2);
  const minTurnSpeed = randomFactor * (0.10 + adjustedLevel * 0.05);
  const maxSpeed = randomFactor * (150.0 + adjustedLevel * 15);
  const liftEfficiency = randomFactor * 0.5;
  const minLiftSpeed = randomFactor * (40.0 - adjustedLevel * 5);
  const liftAngle = randomFactor * (Math.PI / 8 + adjustedLevel * Math.PI / 32);
  const airBrake = true;
  const airBrakeStrength = randomFactor * (2.0 + adjustedLevel * 0.2);
  const value = randomFactor * (10 + adjustedLevel * 20);
  return new Wings(name, weight, baseTurnSpeed, minTurnSpeed, maxSpeed, liftEfficiency, minLiftSpeed, liftAngle, airBrake, airBrakeStrength, value);
}