/**
 * Sorts the player's inventory by type of part -> name -> level.
 * This ensures consistent ordering when opening crates in recovery zones.
 * 
 * @param {Array} inventory - The player's inventory array to sort in-place.
 */
function sortInventory(inventory) {
    if (!inventory || !Array.isArray(inventory)) return;
    
    // Define type ordering priority
    const typeOrder = { 'engine': 1, 'chassis': 2, 'wings': 3, 'gun': 4 };
    
    inventory.sort((a, b) => {
        // First sort by type (engine, chassis, wings, gun)
        const typeA = typeOrder[a.type] || 999;
        const typeB = typeOrder[b.type] || 999;
        if (typeA !== typeB) {
            return typeA - typeB;
        }
        
        // Then by name (which contains manufacturer info like "Pirate", "Core", etc.)
        if (a.name !== b.name) {
            return a.name.localeCompare(b.name);
        }
        
        // Finally by level (numeric) - extract from name if level property doesn't exist
        const levelA = a.level || parseInt(a.name.match(/Lvl\s*(\d+)/)?.[1]) || 0;
        const levelB = b.level || parseInt(b.name.match(/Lvl\s*(\d+)/)?.[1]) || 0;
        return levelA - levelB;
    });
}

/**
 * Checks if the given mouse coordinates (mx, my) are within any inventory item region.
 * If a region is hit, call handleItemEquip(item) for that item.
 *
 * @param {number} mx - The mouse x-coordinate.
 * @param {number} my - The mouse y-coordinate.
 */
/**
 * Handle shop item clicks
 * When a shop item is clicked, purchase it from the server
 * @param {number} mx - Mouse X coordinate
 * @param {number} my - Mouse Y coordinate
 * @returns {boolean} True if a shop item was clicked, false otherwise
 */
function handleShopClick(mx, my) {
    // Iterate over each recorded shop item region
    for (let region of shopRegions) {
        // Check if click is within the shop item's bounding box
        if (mx >= region.x && mx <= region.x + region.width &&
            my >= region.y && my <= region.y + region.height) {
            console.log(`Shop item '${region.component.name}' clicked. Purchasing for $${region.price}...`);
            
            // Send purchase request to server
            purchaseShopItem(region.itemIndex);
            return true;
        }
    }
    return false;
}

function handleInventoryClick(mx, my) {
    // Check if player is in recovery zone and holding shift key for selling
    const controlledPlayer = players.find(p => p.username === username);
    const inRecoveryZone = controlledPlayer && controlledPlayer.biome === 'recovery';
    const shiftHeld = keyIsDown(SHIFT);
    
    // Iterate over each recorded inventory item region.
    for (let region of inventoryRegions) {
        // Since inventory items are drawn in CENTER mode, determine the bounding box.
        const halfSize = region.size / 2;
        const left = region.x - halfSize;
        const right = region.x + halfSize;
        const top = region.y - halfSize;
        const bottom = region.y + halfSize;

        if (mx >= left && mx <= right && my >= top && my <= bottom) {
            // Use the stored inventory index from the region
            itemIndex = region.inventoryIndex;
            if (itemIndex === undefined || itemIndex === -1) {
                console.warn("Item index not found in inventory region.");
                return;
            }
            
            // If in recovery zone and holding shift, sell the item
            if (inRecoveryZone && shiftHeld) {
                console.log(`Selling inventory item '${region.item.name}' at index ${itemIndex}`);
                sendSellItemMessage(itemIndex);
            } else {
                // Otherwise, equip the item
                console.log(`Inventory item '${region.item.name}' clicked at (${mx}, ${my}). Equipping item...`);
                sendEquipMessage(itemIndex);
            }
            break;
        }
    }
}

/**
 * Calculates the inventory regions based on the controlled player's inventory.
 * Arranges items in multiple concentric circles around the player's screen position
 * when inventory has many items to prevent overlap.
 *
 * @param {Object} controlledPlayer - The controlled player object.
 * @param {number} radius - The base radius in pixels at which items are displayed around the center.
 * @param {number} slotSize - The size for each inventory item display.
 * @param {number} playerScreenX - The player's current X position on screen.
 * @param {number} playerScreenY - The player's current Y position on screen.
 * @param {Map} originalIndices - DEPRECATED - not used anymore, always use current index after sorting.
 * @returns {Array} Array of region objects with properties: item, x, y, size, and angle.
 */
function computeInventoryRegions(controlledPlayer, radius, slotSize, playerScreenX, playerScreenY, originalIndices) {
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
        
        // Always use current index (after sorting) - this matches the actual position in inventory array
        const currentIndex = itemIndex;
        
        // Calculate the angle for even distribution in this ring
        const angle = (2 * Math.PI * i) / itemsInThisRing;
        
        // Compute the screen coordinates relative to the player's screen position
        const drawX = playerScreenX + currentRadius * Math.cos(angle);
        const drawY = playerScreenY + currentRadius * Math.sin(angle);
        
        regions.push({
          item: item,
          inventoryIndex: currentIndex,  // Store the current inventory index (post-sort)
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