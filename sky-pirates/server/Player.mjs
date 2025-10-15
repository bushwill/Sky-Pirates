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
    
    // Navy aggro tracking
    this.navyTargeted = false; // Whether this player is currently targeted by navy
    this.lastNavyActivity = 0; // Timestamp of last navy-related activity (spotted or damaged navy)
  }

  respawn() {
    this.x = this.startX;
    this.y = this.startY;
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
      totalValue += parseInt(item.value, 10); // Assuming each crate has a value property
    });
    this.inventory = []; // Clear the inventory after selling
    this.money += parseInt(totalValue, 10); // Add the total value to the player's money
    return totalValue; // Return the total value of sold crates
  }
}
