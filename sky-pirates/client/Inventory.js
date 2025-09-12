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
 * Arranges items in a perfect circle around the controlled player's center position,
 * which is assumed to be at (windowWidth/2, windowHeight/2).
 *
 * Note:
 * Removing the recovery zone clamping ensures that the items form a true circle on-screen.
 * If clamping to the recovery zone is necessary, it may distort the circular layout.
 *
 * @param {Object} controlledPlayer - The controlled player object.
 * @param {number} radius - The radius in pixels at which items are displayed around the center.
 * @param {number} slotSize - The size for each inventory item display.
 * @returns {Array} Array of region objects with properties: item, x, y, size, and angle.
 */
function computeInventoryRegions(controlledPlayer, radius, slotSize) {
    const itemCount = controlledPlayer.inventory.length;
    const regions = [];
    
    // Calculate each item's position in a perfect circle centered at (windowWidth/2, windowHeight/2)
    for (let i = 0; i < itemCount; i++) {
      const item = controlledPlayer.inventory[i];
      
      // Calculate the angle for even distribution in a circle.
      const angle = (2 * Math.PI * i) / itemCount;
      
      // Compute the screen coordinates directly relative to the center of the window.
      const drawX = windowWidth / 2 + radius * Math.cos(angle);
      const drawY = windowHeight / 2 + radius * Math.sin(angle);
      
      regions.push({
        item: item,
        x: drawX,
        y: drawY,
        size: slotSize,
        angle: angle  // Optional, for logging/debug convenience.
      });
    }
    return regions;
  }