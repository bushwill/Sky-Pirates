import { Plane } from './Plane.mjs';
import { Gun } from './Gun.mjs';
import { createGun } from './WeaponList.mjs';
import { createEngine, createChassis, createWings } from './ComponentList.mjs'
import { Engine, Chassis, Wings } from './Components.mjs';

export class Player extends Plane {
  constructor(biome, username, r, g, b, x, y, startMillis, selectedGun1 = 0, selectedGun2 = 0) {
    super(biome, username, r, g, b, x, y);
    // Player-specific attributes
    this.chassis = createChassis(0, 1); // Standard chassis
    this.engine = createEngine(0, 1); // Standard engine
    this.wings = createWings(0, 1); // Standard wings
    this.gun1 = createGun(selectedGun1, 1); // Primary gun
    this.gun2 = createGun(selectedGun2, 1); // Secondary gun
    this.selectedGun = 1;
    this.gunToggleCooldown = 0;
    this.inventory = [];
    this.browsing = false;
    this.party = null;
    this.messages = [];
    this.lastActivity = Date.now() - startMillis;
    this.startMillis = startMillis;
    this.privileges = false;
    this.maxCrates = 50;
    
    // Navy aggro tracking
    this.navyTargeted = false; // Whether this player is currently targeted by navy
    this.lastNavyActivity = 0; // Timestamp of last navy-related activity (spotted or damaged navy)
    // Track the last recovery zone the player visited (object or null)
    this.lastRecoveryZone = null;
    
    // Player ID for session persistence
    this.playerId = null;
    
    // Achievements tracking
    this.achievements = {};
    
    // Stats tracking
    this.lastX = x;
    this.lastY = y;
    this.sessionDistance = 0;

    // Update plane value and weight after setting selected guns
    this.updatePlane();
  }

  /**
   * Create a Player from saved state
   * @param {Object} state - Saved player state
   * @param {number} startMillis - Server start time
   * @returns {Player} Restored player instance
   */
  static fromSavedState(state, startMillis) {
    // Create a new player with basic info
    const player = new Player(
      state.biome || 'air',
      state.username,
      state.r,
      state.g,
      state.b,
      state.x,
      state.y,
      startMillis,
      0, // selectedGun1 - will be overwritten
      0  // selectedGun2 - will be overwritten
    );

    // Restore last recovery zone first
    player.lastRecoveryZone = state.lastRecoveryZone || null;
    
    // Restore position - if there's a last recovery zone, spawn at its center
    if (player.lastRecoveryZone) {
      const zone = player.lastRecoveryZone;
      player.x = (zone.x1 + zone.x2) / 2;
      player.y = (zone.y1 + zone.y2) / 2;
    } else {
      // Fall back to saved position if no recovery zone
      player.x = state.x;
      player.y = state.y;
    }
    
    player.money = state.money || 0;
    player.biome = state.biome || 'air';
    player.selectedGun = state.selectedGun || 1;
    player.playerId = state.playerId;
    // Restore achievements
    player.achievements = state.achievements || {};
    
    // Stats tracking setup
    player.lastX = player.x;
    player.lastY = player.y;
    player.sessionDistance = 0;

    // Restore components
    if (state.chassis) player.chassis = deserializeComponent(state.chassis);
    if (state.engine) player.engine = deserializeComponent(state.engine);
    if (state.wings) player.wings = deserializeComponent(state.wings);
    if (state.gun1) player.gun1 = deserializeComponent(state.gun1);
    if (state.gun2) player.gun2 = deserializeComponent(state.gun2);

    // Restore inventory
    if (state.inventory && Array.isArray(state.inventory)) {
      player.inventory = state.inventory
        .map(itemData => deserializeComponent(itemData))
        .filter(item => item !== null);
    }

    // Update plane stats after restoring all components
    player.updatePlane();

    console.log(`Restored player ${player.username} from saved state`);
    return player;
  }

  respawn() {
    // If the player has a recorded last recovery zone, respawn at its center.
    // Otherwise fall back to the original starting position.
    if (this.lastRecoveryZone) {
      try {
        const zone = this.lastRecoveryZone;
        const centerX = (zone.x1 + zone.x2) / 2;
        const centerY = (zone.y1 + zone.y2) / 2;
        this.x = centerX;
        this.y = centerY;
      } catch (err) {
        // Fallback to default start position on any error while reading zone
        this.x = this.startX;
        this.y = this.startY;
      }
    } else {
      this.x = this.startX;
      this.y = this.startY;
    }
    this.vx = 0;
    this.vy = 0;
    this.t_x = 0;
    this.t_y = 0;
    this.angle = 0;
    this.gun1.reset();
    this.gun2.reset();
    this.chassis.hull = this.chassis.maxHull; // Reset hull to chassis hull
    this.engine.heat = 0; // Reset engine heat
    this.engine.power = 0; // Reset engine power to minimum

    this.detachAllCrates(); // Clear all crdates when respawning
    this.updateWeight(); // Update weight after respawn
  }

  updatePlane() {
    this.updateValue(); // Update the total value of the plane
    this.updateWeight(); // Update the total weight of the plane
  }

  updateValue() {
    this.value = Math.round(
      this.chassis.value
      + this.engine.value
      + this.wings.value
      + this.gun1.value
      + this.gun2.value
    );
  }

  updateWeight() {
    this.weight = this.chassis.weight
      + this.engine.weight
      + this.wings.weight
      + this.crates.reduce((sum, crate) => sum + crate.weight, 0);
  }

  equip(weapon) {
    if (weapon instanceof Gun) {
      if (this.selectedGun === 1) {
        this.gun1 = weapon;
      } else {
        this.gun2 = weapon;
      }
    }
    this.updatePlane();
  }

  install(new_component) {
    let oldComponent = null;
    // using includes (ES6+)
    if (!this.inventory.includes(new_component)) {
      console.log("install: new_component not in inventory:", new_component, this.inventory);
      return false;
    }
    if (new_component instanceof Chassis) {
      oldComponent = this.chassis; // Store the old chassis
      this.chassis = new_component;
    } else if (new_component instanceof Engine) {
      oldComponent = this.engine; // Store the old engine
      this.engine = new_component;
    } else if (new_component instanceof Wings) {
      oldComponent = this.wings; // Store the old wings
      this.wings = new_component;
    } else if (new_component instanceof Gun) {
      // Equip gun to currently selected slot
      if (this.selectedGun === 1) {
        oldComponent = this.gun1;
        this.gun1 = new_component;
      } else {
        oldComponent = this.gun2;
        this.gun2 = new_component;
      }
    }
    // Remove the installed item from inventory
    const index = this.inventory.indexOf(new_component);
    if (index !== -1) {
      this.inventory[index] = oldComponent; // Replace the installed item from inventory
    }
    this.updatePlane(); // Update weight after attaching a new new_component
    return true; // Return the old new_component that was replaced
  }

  attachCrate(crate) {
    const MAX_CRATES = this.maxCrates;
    
    // If at max capacity, detach the oldest crate first
    if (this.crates.length >= MAX_CRATES) {
      const oldestCrate = this.crates[0];
      this.detachCrate(oldestCrate);
    }
    
    this.crates.push(crate); // Add the crate to the player's carrying array
    crate.attach(this.username); // Call the attach method of the crate to apply its effect
    this.updatePlane(); // Update player's weight based on current components
  }

  detachCrate(crate) {
    const index = this.crates.indexOf(crate);
    if (index !== -1) {
      this.crates.splice(index, 1); // Remove the crate from the carrying array
      crate.detach(); // Clear the carrier reference in the crate
      this.updatePlane(); // Update player's weight after detaching a crate
    }
  }

  detachAllCrates() {
    this.crates.forEach(crate => crate.detach()); // Clear carrier reference for all crates
    this.crates = []; // Clear the carrying array
    this.updatePlane(); // Update player's weight after detaching all crates
  }

  // Update navy aggro status based on timer
  updateNavyAggro() {
    const now = Date.now();
    const aggroTimeout = 2 * 60 * 1000; // 2 minutes in milliseconds
    
    if (this.navyTargeted) {
      // Check if aggro has timed out
      const timeSinceActivity = now - this.lastNavyActivity;
      
      if (timeSinceActivity > aggroTimeout) {
        // Reset aggro status
        this.navyTargeted = false;
      }
    }
  }
  
  // Mark player as having navy activity (spotted or damaged navy)
  markNavyActivity() {
    this.lastNavyActivity = Date.now();
    this.navyTargeted = true;
  }

  sellAll() {
    let totalValue = 0;
    this.inventory.forEach(item => {
      totalValue += parseInt(item.value, 10)/2; // Assuming each crate has a value property
    });
    this.inventory = []; // Clear the inventory after selling
    this.money += parseInt(totalValue, 10); // Add the total value to the player's money
    return totalValue; // Return the total value of sold crates
  }

  sellItem(itemIndex) {
    if (itemIndex < 0 || itemIndex >= this.inventory.length) {
      return 0; // Invalid index
    }
    const item = this.inventory[itemIndex];
    const value = parseInt(item.value, 10) / 2;
    this.inventory.splice(itemIndex, 1); // Remove the item from inventory
    this.money += parseInt(value, 10);
    return value;
  }
}

/**
 * Deserialize a component from plain object back to class instance
 */
function deserializeComponent(data) {
  if (!data || !data.type) return null;

  try {
    if (data.type === 'engine') {
      return new Engine(
        data.name,
        data.weight,
        data.maxPower,
        data.minPower,
        data.heatEfficiency,
        data.maxHeat,
        data.value
      );
    } else if (data.type === 'chassis') {
      return new Chassis(
        data.name,
        data.weight,
        data.topSpeed,
        data.maxHull,
        data.heatDispersion,
        data.buoyancy,
        data.value
      );
    } else if (data.type === 'wings') {
      return new Wings(
        data.name,
        data.weight,
        data.baseTurnSpeed,
        data.minTurnSpeed,
        data.maxSpeed,
        data.liftEfficiency,
        data.minLiftSpeed,
        data.liftAngle,
        data.airBrake,
        data.airBrakeStrength,
        data.value
      );
    } else if (data.type === 'gun') {
      return new Gun(
        data.name,
        data.weight,
        data.maxHeat,
        data.heatEfficiency,
        data.damage,
        data.cooldownTime,
        data.projectileSpeed,
        data.projectileSize,
        data.maxAngle * 2, // Multiply by 2 because Gun constructor divides by 2
        data.value,
        data.heatDispersion,
        data.projectileRange
      );
    }
  } catch (error) {
    console.error('Error deserializing component:', error);
    return null;
  }

  return null;
}
