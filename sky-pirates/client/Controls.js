function mousePressed() {
    // If menu is visible (either before sign-in or toggled during gameplay) route clicks to it
    if (menuVisible && menuManager.current && menuManager.current.mousePressed) {
        let mw = Math.max(500, width * 0.45); // Reduced width to match drawing logic
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.current.mousePressed(mouseX, mouseY, mx, my, mw, mh);
        return;
    }
    if (!signedIn && menuManager.current && menuManager.current.mousePressed) {
        let mw = Math.max(500, width * 0.45); // Reduced width to match drawing logic
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.current.mousePressed(mouseX, mouseY, mx, my, mw, mh);
    } else if (signedIn) {
        // Check teleport button first (higher priority)
        if (teleportButtonRegion) {
            const teleportClicked = handleTeleportButtonClick(mouseX, mouseY);
            if (teleportClicked) return; // If teleport button was clicked, don't check other regions
        }
        
        // Check shop toggle button
        if (shopButtonRegion) {
            const shopButtonClicked = handleShopButtonClick(mouseX, mouseY);
            if (shopButtonClicked) return; // If shop button was clicked, don't check other regions
        }
        
        // Check sell all button
        if (sellAllButtonRegion) {
            const sellAllClicked = handleSellAllButtonClick(mouseX, mouseY);
            if (sellAllClicked) return; // If sell all button was clicked, don't check other regions
        }
        
        // Check shop items
        if (shopRegions.length > 0) {
            const shopClicked = handleShopClick(mouseX, mouseY);
            if (shopClicked) return; // If shop item was clicked, don't check inventory
        }
        
        // Then check inventory
        if (inventoryRegions.length > 0) {
            handleInventoryClick(mouseX, mouseY);
        }
    }
}

function keyPressed() {
    // First: handle Escape toggle (only when signed in)
    if (keyCode === ESCAPE) {
        if (chatting) {
            chatting = false;
            return;
        }
        // Only allow ESC to toggle menu when signed in (in-game)
        if (signedIn) {
            menuVisible = !menuVisible;
            if (menuVisible) {
                menuManager.show('login');
            } else {
                if (menuManager.current && menuManager.current.hide) {
                    menuManager.current.hide();
                }
                if (menuManager.colorPicker) {
                    menuManager.colorPicker.hide();
                }
            }
        }
        return;
    }

    // If menu is visible, forward non-printable keys to menu.keyPressed (printable chars are handled in keyTyped)
    if (menuVisible && menuManager && menuManager.current) {
        // Non-printable keys have length !== 1 (e.g., 'Enter', 'Backspace', 'ArrowUp')
        if (typeof key === 'string' && key.length !== 1 && typeof menuManager.current.keyPressed === 'function') {
            menuManager.current.keyPressed(key);
            return;
        }
        // If printable, do not handle here; keyTyped will forward the character
        return;
    }

    if (!signedIn && menuManager && menuManager.current) {
        // If not signed in, and menu present, allow non-printable keys to be handled by menu
        if (typeof key === 'string' && key.length !== 1 && typeof menuManager.current.keyPressed === 'function') {
            menuManager.current.keyPressed(key);
            return;
        }
    }

    // Gameplay/chat handling
    if (signedIn) {
        if (chatting) {
            if (keyCode === ENTER) {
                chat_message = current_chat;
                current_chat = "";
                chatting = false;
                return;
            } else if (keyCode === BACKSPACE) {
                // Backspace in chat handled via keyTyped/keyPressed for deletion
                current_chat = current_chat.slice(0, -1);
                return;
            }
        } else {
            if (keyCode === ENTER) {
                chatting = true;
                helpWindow = false;
                return;
            }
            // Teleport key
            if (key === 't' || key === 'T') {
                handleTeleportRequest();
                return;
            }

            // Shop toggle key
            if (key === 'b' || key === 'B') {
                handleShopToggleRequest();
                return;
            }

            // Help toggle
            if (key === 'h' || key === 'H') {
                // Only toggle help when not typing chat
                helpWindow = !helpWindow;
                // If opening help, ensure we aren't in chat
                if (helpWindow) chatting = false;
                return;
            }

            // Movement keys: mark pressed
            const k = (typeof key === 'string') ? key.toLowerCase() : '';
            if (usedKeys.includes(k)) {
                keys[k] = true;
            }
        }
    }
}

// p5 keyReleased() - unset movement keys when released (only affects gameplay when menu closed)
function keyReleased() {
    // If menu is visible, ignore key releases for gameplay
    if (menuVisible) return;

    if (!signedIn) return;
    const k = (typeof key === 'string') ? key.toLowerCase() : '';
    if (usedKeys.includes(k)) {
        keys[k] = false;
        lastKeyPressTimes[k] = millis();
    }
}

function keyTyped() {
    if (menuVisible && menuManager.current && menuManager.current.keyTyped) {
        menuManager.current.keyTyped(key);
        return;
    }
    if (!signedIn && menuManager.current && menuManager.current.keyTyped) {
        menuManager.current.keyTyped(key);
        return;
    }

    if (signedIn && chatting && key.length === 1) {
        // Only add printable characters to chat
        current_chat += key;
    }
}

function handleMouseDown(event) {
    if (event.button === 0 && signedIn) {
        keys.mouse = true;
    }
}

function handleMouseUp(event) {
    if (event.button === 0 && signedIn) {
        keys.mouse = false;
    }
}

function handleKeyDown(event) {
    // No-op: prefer p5's keyPressed/keyReleased handlers (window listeners removed in Game.js)
    return;
}

function handleKeyUp(event) {
    // No-op: key up is handled via p5 keyReleased if needed; this function kept for compatibility but does nothing.
    return;
}

function mouseWheel(event) {
    if ((menuVisible || !signedIn) && menuManager && menuManager.current && menuManager.current.mouseWheel) {
        menuManager.current.mouseWheel(event);
        return false;
    }
}

/* Mobile Controls Configuration */
// Configurations are now functions to allow dynamic screen resizing
function getMobileButtons() {
    // Ensure spacing is at least diameter + padding (40*2 + 10 = 90)
    // Use a larger percentage of screen or a hard floor
    const spacing = Math.max(90, Math.min(width, height) * 0.18); 
    const startX = 100;
    const startY = height - 100;
    
    return [
        { label: 'W', key: 'w', x: startX, y: startY - spacing, r: 40 },
        { label: 'A', key: 'a', x: startX - spacing, y: startY, r: 40 }, // Increased horizontal spacing
        { label: 'S', key: 's', x: startX, y: startY, r: 40 },
        { label: 'D', key: 'd', x: startX + spacing, y: startY, r: 40 }, // Increased horizontal spacing
        
        // Right side actions
        { label: 'FIRE', key: 'mouse', x: width - 80, y: startY - 40, r: 50, color: [255, 50, 50] },
        { label: 'R', key: 'r', x: width - 60, y: startY - spacing - 80, r: 35 }, // Adjusted Y to clear overlapping
        { label: 'F', key: 'f', x: width - 140, y: startY - spacing - 80, r: 35 },
        { label: 'C', key: 'c', x: width - 220, y: startY - spacing - 80, r: 35 }
    ];
}

function getMobilePauseButton() {
    return { x: width * 0.5, y: 50, w: 80, h: 40, label: menuVisible ? 'RESUME' : 'PAUSE' };
}

function getMobileChatButton() {
    return { x: 50, y: 50, w: 80, h: 40, label: 'CHAT' };
}


function drawMobileControls() {
    // Always draw pause button if signed in (even if menu is visible, so we can exit)
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn) return;
    
    push();
    textAlign(CENTER, CENTER);
    textSize(16);
    noStroke();

    // Draw Pause Button (Always visible when signed in)
    {
        const btn = getMobilePauseButton();
        const bx = btn.x;
        const by = btn.y;
        fill(200, 200, 200, 200); // Higher opacity
        rectMode(CENTER);
        rect(bx, by, btn.w, btn.h, 8);
        fill(0);
        text(btn.label, bx, by);
    }
    
    // Hide controls if an item stats popup is selected/open
    if (typeof window.mobileSelection !== 'undefined' && window.mobileSelection) {
        pop();
        return;
    }

    // Hide other controls if menu is open
    if (menuVisible) {
        pop();
        return;
    }
    
    // Draw Chat Button
    {
        const btn = getMobileChatButton();
        const bx = btn.x;
        const by = btn.y;
        fill(chatting ? 100 : 200, chatting ? 255 : 200, chatting ? 100 : 200, 100);
        rectMode(CENTER);
        rect(bx, by, btn.w, btn.h, 8);
        fill(255);
        text(btn.label, bx, by);
    }
    
    const buttons = getMobileButtons();
    for (let btn of buttons) {
        let bx = btn.x;
        let by = btn.y;
        
        let isPressed = typeof keys !== 'undefined' && keys[btn.key];
        
        // Highlight if pressed
        if (isPressed) fill(255, 255, 255, 150);
        else fill(btn.color || [200, 200, 200, 100]);
        
        circle(bx, by, btn.r * 2);
        
        fill(0);
        textSize(20);
        text(btn.label, bx, by);
    }
    pop();
}

function updateMobileControls() {
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn || menuVisible) return;
    if (typeof keys === 'undefined') return;
    
    // Disable control updates if stats popup is open
    if (typeof window.mobileSelection !== 'undefined' && window.mobileSelection) {
        return;
    }

    const buttons = getMobileButtons();

    // Reset keys handled by mobile controls
    for (let btn of buttons) {
        keys[btn.key] = false;
    }
    
    // Check all touches
    if (typeof touches !== 'undefined') {
        for (let i = 0; i < touches.length; i++) {
            let tx = touches[i].x;
            let ty = touches[i].y;
            
            for (let btn of buttons) {
                let bx = btn.x;
                let by = btn.y;
                if (dist(tx, ty, bx, by) < btn.r * 1.5) { 
                    keys[btn.key] = true;
                }
            }
        }
    }
}

function touchStarted(event) {
    // Allow default browser behavior for inputs (text fields, etc.)
    if (event && event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) {
        return true;
    }

    // Handle Menu Interactions
    if ((menuVisible || !signedIn) && menuManager && menuManager.current) {
        if (menuManager.current.touchStarted) {
            menuManager.current.touchStarted();
        }
        
        // Treat tap as mouse press for menu buttons
        if (menuManager.current.mousePressed && typeof touches !== 'undefined' && touches.length > 0) {
            let mw = Math.max(500, width * 0.45);
            let mh = height * 0.8;
            let mx = (width - mw) / 2;
            let my = (height - mh) / 2;
            menuManager.current.mousePressed(touches[0].x, touches[0].y, mx, my, mw, mh);
        }
        
        return false;
    }
    
    if (typeof isMobile !== 'undefined' && isMobile && signedIn) {
        // Mobile Interactions
        const mx = touches[0].x;
        const my = touches[0].y;
        
        // Pause Button - Check regardless of menu state for exit behavior
        const pauseBtn = getMobilePauseButton();
        if (Math.abs(mx - pauseBtn.x) < pauseBtn.w/2 + 20 &&
            Math.abs(my - pauseBtn.y) < pauseBtn.h/2 + 20) {
             
             // Toggle logic
             if (menuVisible) {
                 menuVisible = false;
                 // Don't show login immediately when closing
                 // if (menuManager && menuManager.current && menuManager.current.hide) menuManager.current.hide(); 
             } else {
                 menuVisible = true;
                 if (menuManager) menuManager.show('login');
             }
             return false;
        }

        // If menu is open, don't process potential game controls underneath
        if (menuVisible) return false;

        // Chat Button
        const chatBtn = getMobileChatButton();
        if (Math.abs(mx - chatBtn.x) < chatBtn.w/2 &&
            Math.abs(my - chatBtn.y) < chatBtn.h/2) {
             toggleMobileChat();
             return false;
        }

        // Check teleport button first
        if (typeof teleportButtonRegion !== 'undefined' && teleportButtonRegion) {
            const teleportClicked = handleTeleportButtonClick(mx, my);
            if (teleportClicked) return false;
        }
        
        // Check shop toggle button
        if (typeof shopButtonRegion !== 'undefined' && shopButtonRegion) {
            const shopButtonClicked = handleShopButtonClick(mx, my);
            if (shopButtonClicked) return false;
        }

        // Check sell all button
        if (typeof sellAllButtonRegion !== 'undefined' && sellAllButtonRegion) {
            const sellAllClicked = handleSellAllButtonClick(mx, my);
            if (sellAllClicked) return false;
        }
        
        // Action Buttons
        if (typeof window.mobileActionButtons !== 'undefined' && window.mobileActionButtons.length > 0) {
            for (let btn of window.mobileActionButtons) {
                if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
                    const action = btn.action;
                     if (action.type === 'buy') {
                         purchaseShopItem(action.index);
                    } else if (action.type === 'equip') {
                         sendEquipMessage(action.index);
                    } else if (action.type === 'sell') {
                         sendSellItemMessage(action.index);
                    }
                    window.mobileSelection = null;
                    return false;
                }
            }
        }
        
        // Check Selection Hits
        let uiHit = false;
        
        if (handleEquippedClick(mx, my)) uiHit = true;
        
        if (!uiHit && typeof shopRegions !== 'undefined' && shopRegions.length > 0) {
             if (handleShopClick(mx, my)) uiHit = true;
        }
        
        if (!uiHit && typeof inventoryRegions !== 'undefined') {
             for (let region of inventoryRegions) {
                 const halfSize = region.size / 2;
                 if (mx >= region.x - halfSize && mx <= region.x + halfSize &&
                     my >= region.y - halfSize && my <= region.y + halfSize) {
                      handleInventoryClick(mx, my); 
                      uiHit = true;
                      break;
                 }
             }
        }
        
        if (uiHit) return false;
        
        // Clear selection if tapping empty space
        if (window.mobileSelection) {
             window.mobileSelection = null;
        }

        updateMobileControls();
        return false;
    }

    // Allow touch interactions for gameplay if signed in (non-mobile fallback)
    if (signedIn && !menuVisible && (!isMobile)) {
        keys.mouse = true;
    }
    // Prevent default browser behavior
    // return false; 
}

function touchEnded() {
    if (typeof isMobile !== 'undefined' && isMobile && signedIn && !menuVisible) {
        updateMobileControls();
        return false;
    }

    if (signedIn && !isMobile) {
        keys.mouse = false;
    }
}

function touchMoved() {
    if ((menuVisible || !signedIn) && menuManager && menuManager.current && menuManager.current.touchMoved) {
        let result = menuManager.current.touchMoved();
        if (result === false) return false;
    }
    
    if (typeof isMobile !== 'undefined' && isMobile && signedIn && !menuVisible) {
        updateMobileControls();
        return false;
    }
    
    // Prevent default scrolling on game canvas
    return false;
}

/* Mobile Helper Functions */
function toggleMobileChat() {
    chatting = !chatting;
    const container = document.getElementById('mobileChatContainer');
    const input = document.getElementById('mobileChatInput');
    
    if (chatting) {
        if (container) container.style.display = 'block';
        if (input) {
             input.value = current_chat; // Sync existing draft
             input.focus();
        }
    } else {
        if (container) container.style.display = 'none';
        if (input) input.blur();
    }
}

// Initialize Mobile Chat Listeners
window.addEventListener('load', function() {
    const input = document.getElementById('mobileChatInput');
    const sendBtn = document.getElementById('mobileChatSend');
    
    if (input) {
        input.addEventListener('input', (e) => {
            current_chat = e.target.value;
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (current_chat.length > 0) {
                     chat_message = current_chat;
                     current_chat = "";
                     input.value = "";
                     toggleMobileChat(); // Close chat
                }
            }
        });
    }
    
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
             if (current_chat.length > 0) {
                 chat_message = current_chat;
                 current_chat = "";
                 if (input) input.value = "";
                 toggleMobileChat();
            }
        });
    }
});
