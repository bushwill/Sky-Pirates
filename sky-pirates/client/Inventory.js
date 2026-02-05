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
    if (typeof isMobile !== 'undefined' && isMobile) {
        const padding = 20; // Increase touch area
        for (let region of shopRegions) {
            if (mx >= region.x - padding && mx <= region.x + region.width + padding &&
                my >= region.y - padding && my <= region.y + region.height + padding) {
                // Select item
                window.mobileSelection = {
                    type: 'shop',
                    item: region.component,
                    index: region.itemIndex
                };
                return true;
            }
        }
        return false;
    }

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
    
    // Transform input coordinates to match the zoomed drawing context
    let activeZoom = 1.0;
    if (typeof isMobile !== 'undefined' && isMobile) {
        activeZoom = 0.65;
    } else {
        if (typeof window.cameraZoom === 'number' && !isNaN(window.cameraZoom) && window.cameraZoom > 0.01) {
            activeZoom = window.cameraZoom;
        }
    }

    // Apply inverse transformation: World = (Screen - Center) / Zoom + Center
    const cx = width / 2;
    const cy = height / 2;
    const worldMx = (mx - cx) / activeZoom + cx;
    const worldMy = (my - cy) / activeZoom + cy;
    
    // Iterate over each recorded inventory item region.
    for (let region of inventoryRegions) {
        // Since inventory items are drawn in CENTER mode, determine the bounding box.
        const halfSize = region.size / 2;
        const padding = (typeof isMobile !== 'undefined' && isMobile) ? 20 : 0; // Mobile padding

        const left = region.x - halfSize - padding;
        const right = region.x + halfSize + padding;
        const top = region.y - halfSize - padding;
        const bottom = region.y + halfSize + padding;

        if (worldMx >= left && worldMx <= right && worldMy >= top && worldMy <= bottom) {
            if (typeof isMobile !== 'undefined' && isMobile) {
                // Mobile Select
                window.mobileSelection = {
                    type: 'inventory',
                    item: region.item,
                    index: region.inventoryIndex
                };
                return true;
            }

            // Use the stored inventory index from the region
            itemIndex = region.inventoryIndex;
            if (itemIndex === undefined || itemIndex === -1) {
                console.warn("Item index not found in inventory region.");
                return true;
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
            return true;
        }
    }
    return false;
}

function handleEquippedClick(mx, my) {
    if (typeof window.topRightComponentRegions === 'undefined') return false;
    
    const padding = (typeof isMobile !== 'undefined' && isMobile) ? 20 : 0;

    for (let region of window.topRightComponentRegions) {
         // Using square bounds with padding instead of circle dist for easier touch
         if (mx >= region.x - region.size/2 - padding && mx <= region.x + region.size/2 + padding &&
             my >= region.y - region.size/2 - padding && my <= region.y + region.size/2 + padding) {
         // if (dist(mx, my, region.x, region.y) <= region.size / 2 + padding) {
             if (typeof isMobile !== 'undefined' && isMobile) {
                 window.mobileSelection = {
                     type: 'equipped',
                     item: region.component,
                     index: 0 
                 };
             }
             return true;
         }
    }
    return false;
}

/**
 * Calculates the inventory regions based on the sorted inventory display.
 * Arranges items in multiple concentric circles around the player's screen position
 * when inventory has many items to prevent overlap.
 *
 * @param {Array} sortedInventory - The sorted inventory array to display.
 * @param {number} radius - The base radius in pixels at which items are displayed around the center.
 * @param {number} slotSize - The size for each inventory item display.
 * @param {number} playerScreenX - The player's current X position on screen.
 * @param {number} playerScreenY - The player's current Y position on screen.
 * @param {Map} sortedToOriginalIndex - Map from sorted items to their original unsorted indices.
 * @returns {Array} Array of region objects with properties: item, x, y, size, and angle.
 */
function computeInventoryRegions(sortedInventory, radius, slotSize, playerScreenX, playerScreenY, sortedToOriginalIndex) {
    const itemCount = sortedInventory.length;
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
        const item = sortedInventory[itemIndex];
        
        // Get the original index (before sorting) from the map - this matches server's array
        const originalIndex = sortedToOriginalIndex ? sortedToOriginalIndex.get(item) : itemIndex;
        
        // Calculate the angle for even distribution in this ring
        const angle = (2 * Math.PI * i) / itemsInThisRing;
        
        // Compute the screen coordinates relative to the player's screen position
        const drawX = playerScreenX + currentRadius * Math.cos(angle);
        const drawY = playerScreenY + currentRadius * Math.sin(angle);
        
        regions.push({
          item: item,
          inventoryIndex: originalIndex,  // Store the ORIGINAL inventory index (server's index)
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