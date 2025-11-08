/**
 * Sorts the player's inventory by type of part -> manufacturer -> level.
 * This ensures consistent ordering when opening crates in recovery zones.
 * 
 * @param {Array} inventory - The player's inventory array to sort in-place.
 */
function sortInventory(inventory) {
    if (!inventory || !Array.isArray(inventory)) return;
    
    inventory.sort((a, b) => {
        // First sort by type (e.g., "engine", "gun", "hull")
        if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
        }
        
        // Then by manufacturer
        if (a.manufacturer !== b.manufacturer) {
            return a.manufacturer.localeCompare(b.manufacturer);
        }
        
        // Finally by level (numeric)
        return (a.level || 0) - (b.level || 0);
    });
}

/**
 * Checks if the given mouse coordinates (mx, my) are within any inventory item region.
 * If a region is hit, call handleItemEquip(item) for that item.
 *
 * @param {number} mx - The mouse x-coordinate.
 * @param {number} my - The mouse y-coordinate.
 */
function handleInventoryClick(mx, my) {
    // Iterate over each recorded inventory item region.
    for (let region of inventoryRegions) {
        // Since inventory items are drawn in CENTER mode, determine the bounding box.
        const halfSize = region.size / 2;
        const left = region.x - halfSize;
        const right = region.x + halfSize;
        const top = region.y - halfSize;
        const bottom = region.y + halfSize;

        if (mx >= left && mx <= right && my >= top && my <= bottom) {
            console.log(`Inventory item '${region.item.name}' clicked at (${mx}, ${my}). Equipping item...`);
            itemIndex = inventoryRegions.indexOf(region)
            if (itemIndex === -1) {
                console.warn("Item index not found in inventory regions.");
                return;
            } else {
                sendEquipMessage(itemIndex);
            }
            break;
        }
    }
}

/**
 * Calculates the inventory regions based on the controlled player's inventory.
 * Arranges items in multiple concentric circles around the controlled player's center position
 * when inventory has many items to prevent overlap.
 *
 * Note:
 * Removing the recovery zone clamping ensures that the items form a true circle on-screen.
 * If clamping to the recovery zone is necessary, it may distort the circular layout.
 *
 * @param {Object} controlledPlayer - The controlled player object.
 * @param {number} radius - The base radius in pixels at which items are displayed around the center.
 * @param {number} slotSize - The size for each inventory item display.
 * @returns {Array} Array of region objects with properties: item, x, y, size, and angle.
 */
function computeInventoryRegions(controlledPlayer, radius, slotSize) {
    const itemCount = controlledPlayer.inventory.length;
    const regions = [];
    
    // Maximum items per ring before creating a new ring (based on avoiding overlap)
    // Calculate based on circumference and slot size with some spacing
    const maxItemsPerRing = Math.max(8, Math.floor((2 * Math.PI * radius) / (slotSize * 1.2)));
    
    let itemIndex = 0;
    let ringIndex = 0;
    
    // Distribute items across multiple rings if needed
    while (itemIndex < itemCount) {
      const itemsInThisRing = Math.min(maxItemsPerRing, itemCount - itemIndex);
      const currentRadius = radius + (ringIndex * slotSize * 1.5); // Space rings apart
      
      // Place items in current ring
      for (let i = 0; i < itemsInThisRing; i++) {
        const item = controlledPlayer.inventory[itemIndex];
        
        // Calculate the angle for even distribution in this ring
        const angle = (2 * Math.PI * i) / itemsInThisRing;
        
        // Compute the screen coordinates directly relative to the center of the window
        const drawX = windowWidth / 2 + currentRadius * Math.cos(angle);
        const drawY = windowHeight / 2 + currentRadius * Math.sin(angle);
        
        regions.push({
          item: item,
          x: drawX,
          y: drawY,
          size: slotSize,
          angle: angle,
          ring: ringIndex  // Track which ring this item is in
        });
        
        itemIndex++;
      }
      
      ringIndex++;
    }
    
    return regions;
  }