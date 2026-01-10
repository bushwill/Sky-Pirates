import { createEngine, createChassis, createWings } from './ComponentList.mjs';
import { createGun, getRandomGunType } from './WeaponList.mjs';

export class Shop {
  constructor(recoveryZoneId, centerX) {
    this.recoveryZoneId = recoveryZoneId;
    this.centerX = centerX; // Center X position of the recovery zone
    this.inventory = []; // Array of 5 components + 1 weapon
    this.lastRefreshTime = Date.now();
    this.nextRefreshTime = this.lastRefreshTime + 120000; // Refresh every 2 minutes
    
    // Generate initial inventory
    this.generateInventory();
  }

  /**
   * Calculate component level based on distance from center (0,0)
   * Uses the same logic as generateRandomBasicComponentCrate
   */
  calculateLevelForZone() {
    const value = Math.abs(this.centerX);
    
    if (value >= 140000) return 10;
    else if (value >= 120000) return 9;
    else if (value >= 100000) return 8;
    else if (value >= 80000) return 7;
    else if (value >= 60000) return 6;
    else if (value >= 40000) return 5;
    else if (value >= 25000) return 4;
    else if (value >= 14000) return 3;
    else if (value >= 5000) return 2;
    else return 1;
  }

  /**
   * Generate 5 random components + 1 random weapon at the appropriate level for this zone
   */
  generateInventory() {
    this.inventory = [];
    const level = this.calculateLevelForZone();
    
    // Generate 5 components (engine, chassis, wings)
    for (let i = 0; i < 5; i++) {
      const type = Math.floor(Math.random() * 3); // 0-2 for engine, chassis, wings
      const manufacturer = Math.floor(Math.random() * 4) + 1; // 1-4 for manufacturers
      
      let component = null;
      if (type === 0) {
        component = createEngine(manufacturer, level);
      } else if (type === 1) {
        component = createChassis(manufacturer, level);
      } else {
        component = createWings(manufacturer, level);
      }
      
      // Set shop price to 1.5x the component's value
      const shopPrice = Math.round(component.value * 1.5);
      
      this.inventory.push({
        component: component,
        price: shopPrice
      });
    }
    
    // Generate 1 random weapon using weighted probability
    const weaponType = getRandomGunType();
    const weapon = createGun(weaponType, level);
    const weaponPrice = Math.round(weapon.value * 1.5);
    
    this.inventory.push({
      component: weapon,
      price: weaponPrice
    });
  }

  /**
   * Check if this shop needs to refresh and regenerate inventory if needed
   * Returns true if the shop was refreshed
   */
  checkAndRefresh(currentTime) {
    if (currentTime >= this.nextRefreshTime) {
      this.generateInventory();
      this.lastRefreshTime = currentTime;
      this.nextRefreshTime = currentTime + 120000; // Next refresh in 2 minutes
      return true;
    }
    return false;
  }

  /**
   * Convert shop data to a format suitable for sending to clients
   */
  toClientData() {
    return {
      recoveryZoneId: this.recoveryZoneId,
      inventory: this.inventory.map(item => ({
        component: item.component,
        price: item.price
      })),
      nextRefreshTime: this.nextRefreshTime
    };
  }

  /**
   * Purchase a component from the shop
   * Deducts money, adds component to inventory, and auto-equips it
   * The old equipped component is automatically moved to inventory by Player.install()
   * Returns the result object with success status
   */
  purchase(player, inventoryIndex) {
    if (inventoryIndex < 0 || inventoryIndex >= this.inventory.length) {
      return { success: false, reason: 'Invalid item index' };
    }

    const shopItem = this.inventory[inventoryIndex];
    if (player.money < shopItem.price) {
      return { success: false, reason: 'Insufficient funds' };
    }

    // Deduct money and add component to player inventory
    player.money -= shopItem.price;
    player.inventory.push(shopItem.component);

    // Auto-equip the new component (this will move old component to inventory)
    const installSuccess = player.install(shopItem.component);
    
    if (!installSuccess) {
      // If install failed for some reason, component is still in inventory
      console.warn(`Failed to auto-equip purchased component: ${shopItem.component.name}`);
    }

    return { success: true, component: shopItem.component, price: shopItem.price, autoEquipped: installSuccess };
  }
}
