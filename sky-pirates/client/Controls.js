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
const mobileButtons = [
    { label: 'W', key: 'w', x: 0.15, y: 0.75, r: 40 },
    { label: 'A', key: 'a', x: 0.08, y: 0.85, r: 40 },
    { label: 'S', key: 's', x: 0.15, y: 0.85, r: 40 },
    { label: 'D', key: 'd', x: 0.22, y: 0.85, r: 40 },
    
    // Right side actions
    { label: 'FIRE', key: 'mouse', x: 0.85, y: 0.8, r: 50, color: [255, 50, 50] },
    { label: 'R', key: 'r', x: 0.92, y: 0.65, r: 35 },
    { label: 'F', key: 'f', x: 0.82, y: 0.65, r: 35 },
    { label: 'C', key: 'c', x: 0.72, y: 0.65, r: 35 }
];

const mobilePauseButton = { x: 0.5, y: 0.1, w: 80, h: 40, label: 'PAUSE' };
const mobileChatButton = { x: 0.1, y: 0.1, w: 80, h: 40, label: 'CHAT' };


function drawMobileControls() {
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn || menuVisible) return;
    
    push();
    textAlign(CENTER, CENTER);
    textSize(20);
    noStroke();
    
    // Draw Pause Button
    {
        const bx = width * mobilePauseButton.x;
        const by = height * mobilePauseButton.y;
        fill(200, 200, 200, 100);
        rectMode(CENTER);
        rect(bx, by, mobilePauseButton.w, mobilePauseButton.h, 8);
        fill(255);
        text(mobilePauseButton.label, bx, by);
    }
    
    // Draw Chat Button
    {
        const bx = width * mobileChatButton.x;
        const by = height * mobileChatButton.y;
        fill(chatting ? 100 : 200, chatting ? 255 : 200, chatting ? 100 : 200, 100);
        rectMode(CENTER);
        rect(bx, by, mobileChatButton.w, mobileChatButton.h, 8);
        fill(255);
        text(mobileChatButton.label, bx, by);
    }
    
    for (let btn of mobileButtons) {
        let bx = width * btn.x;
        let by = height * btn.y;
        
        let isPressed = typeof keys !== 'undefined' && keys[btn.key];
        
        // Highlight if pressed
        if (isPressed) fill(255, 255, 255, 150);
        else fill(btn.color || [200, 200, 200, 100]);
        
        circle(bx, by, btn.r * 2);
        
        fill(0);
        text(btn.label, bx, by);
    }
    pop();
}

function updateMobileControls() {
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn || menuVisible) return;
    if (typeof keys === 'undefined') return;

    // Reset keys handled by mobile controls
    for (let btn of mobileButtons) {
        keys[btn.key] = false;
    }
    
    // Check all touches
    if (typeof touches !== 'undefined') {
        for (let i = 0; i < touches.length; i++) {
            let tx = touches[i].x;
            let ty = touches[i].y;
            
            for (let btn of mobileButtons) {
                let bx = width * btn.x;
                let by = height * btn.y;
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
    
    if (typeof isMobile !== 'undefined' && isMobile && signedIn && !menuVisible) {
        // Mobile Interactions
        const mx = touches[0].x;
        const my = touches[0].y;
        
        // Pause Button
        if (Math.abs(mx - width * mobilePauseButton.x) < mobilePauseButton.w/2 &&
            Math.abs(my - height * mobilePauseButton.y) < mobilePauseButton.h/2) {
             menuVisible = true;
             if (menuManager) menuManager.show('login');
             return false;
        }

        // Chat Button
        if (Math.abs(mx - width * mobileChatButton.x) < mobileChatButton.w/2 &&
            Math.abs(my - height * mobileChatButton.y) < mobileChatButton.h/2) {
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
