function mousePressed() {
    if (typeof lastInputTime !== 'undefined') lastInputTime = millis();

    // On mobile, skip mousePressed entirely - touchStarted handles everything
    if (typeof isMobile !== 'undefined' && isMobile) {
        return;
    }

    // If menu is visible (either before sign-in or toggled during gameplay) route clicks to it
    if (menuVisible && menuManager) {
        let mw = (typeof isMobile !== 'undefined' && isMobile) ? width * 0.95 : width * 0.45;
        // Match logic from Game.js draw loop
        if (!isMobile) mw = Math.max(Math.min(500, width * 0.9), width * 0.45);
        let mh = (typeof isMobile !== 'undefined' && isMobile) ? height * 0.9 : height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        
        // Pass clicks to manager (which handles close button)
        if (menuManager.mousePressed(mouseX, mouseY, mx, my, mw, mh)) {
            return; // Handled by manager (e.g. close button)
        }
        return; // Consumed by menu overlay
    }
    
    // Fallback if menuVisible is false but signedIn is false (initial login screen, failsafe)
    if (!signedIn && menuManager && menuManager.current) {
        let mw = (typeof isMobile !== 'undefined' && isMobile) ? width * 0.95 : width * 0.45;
        if (!isMobile) mw = Math.max(Math.min(500, width * 0.9), width * 0.45);
        let mh = (typeof isMobile !== 'undefined' && isMobile) ? height * 0.9 : height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;

        if (menuManager.mousePressed(mouseX, mouseY, mx, my, mw, mh)) return;
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
    if (typeof lastInputTime !== 'undefined') lastInputTime = millis();

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

    // Scroll to Zoom (PC only)
    if (typeof isMobile === 'undefined' || !isMobile) {
        // Zoom Sensitivity
        const zoomSpeed = 0.001;
        
        // Update Zoom
        if (typeof window.cameraZoom !== 'number' || isNaN(window.cameraZoom)) window.cameraZoom = 1.0;
        
        // Ensure event.delta is valid
        let delta = 0;
        if (typeof event.delta === 'number') delta = event.delta;
        else if (typeof event.deltaY === 'number') delta = event.deltaY;
        
        window.cameraZoom -= delta * zoomSpeed;
        
        // Constrain Zoom
        // Min scale (widest view) depends on screen width
        let safeMaxView = (typeof window.MAX_ZOOM_VIEW_WIDTH === 'number') ? window.MAX_ZOOM_VIEW_WIDTH : 2500;
        
        const minZoom = (width && safeMaxView) ? (width / safeMaxView) : 0.5;
        const maxZoom = 2.0; // Max magnification (200%)
        
        window.cameraZoom = constrain(window.cameraZoom, minZoom, maxZoom);
        
        return false; // Prevent default browser scrolling
    }
}

/* Mobile Controls Configuration */
// Configurations are now functions to allow dynamic screen resizing
let mobileButtonTimers = {};

function getMobileButtons() {
    // Ensure spacing is at least diameter + padding (40*2 + 10 = 90)
    // Use a larger percentage of screen or a hard floor
    const spacing = Math.max(90, Math.min(width, height) * 0.18); 
    const startX = 140; // Moved right from 100
    const startY = height - 80; // Moved down from height-100
    
    // Check for narrow screen overlap (stack right buttons if needed)
    const stackRightButtons = width < 550;

    let rightButtons = [];
    if (stackRightButtons) {
        // Stack vertically on right edge
        let rX = width - 50;
        let rStartY = height - 120;
        let rGap = 70;
        rightButtons = [
             { label: 'FIRE', key: 'mouse', x: width - 80, y: startY - 40, r: 50, color: [255, 50, 50] },
             { label: 'R', key: 'r', x: rX, y: rStartY, r: 35 },
             { label: 'F', key: 'f', x: rX, y: rStartY - rGap * 1, r: 35 },
             { label: 'C', key: 'c', x: rX, y: rStartY - rGap * 2, r: 35 }
        ];
    } else {
        rightButtons = [
            { label: 'FIRE', key: 'mouse', x: width - 80, y: startY - 40, r: 50, color: [255, 50, 50] },
            { label: 'R', key: 'r', x: width - 60, y: startY - spacing - 80, r: 35 }, 
            { label: 'F', key: 'f', x: width - 140, y: startY - spacing - 80, r: 35 },
            { label: 'C', key: 'c', x: width - 220, y: startY - spacing - 80, r: 35 }
        ];
    }

    return [
        { label: 'W', key: 'w', x: startX, y: startY - spacing, r: 40 },
        { label: 'A', key: 'a', x: startX - spacing, y: startY, r: 40 }, 
        { label: 'S', key: 's', x: startX, y: startY, r: 40 },
        { label: 'D', key: 'd', x: startX + spacing, y: startY, r: 40 }, 
        ...rightButtons
    ];
}

function getMobilePauseButton() {
    // If getUIScale not defined yet, fallback to 1.0
    const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
    return { 
        x: width * 0.5, 
        y: 50 * s, 
        w: 80 * s, 
        h: 40 * s, 
        label: menuVisible ? 'RESUME' : 'PAUSE' 
    };
}

function getMobileChatButton() {
    const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
    return { 
        x: 50 * s, 
        y: 50 * s, 
        w: 80 * s, 
        h: 40 * s, 
        label: 'CHAT' 
    };
}


function drawMobilePauseButton() {
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn || menuVisible) return;
    
    const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
    
    push();
    textAlign(CENTER, CENTER);
    textSize(16 * s);
    noStroke();
    
    const btn = getMobilePauseButton();
    // Use button dimensions directly as they are now scaled
    
    fill(200, 200, 200, 200); // Higher opacity
    rectMode(CENTER);
    rect(btn.x, btn.y, btn.w, btn.h, 8 * s);
    fill(0);
    text(btn.label, btn.x, btn.y);
    
    pop();
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
        // Actually, we delegate to the dedicated function but we need to match logic
        // But drawMobileControls might be called under the menu.
        // We will call drawMobilePauseButton again in Game.js ON TOP of menu.
        // Here we can draw it too or skip it. Drawing it twice doesn't hurt much.
        drawMobilePauseButton();
    }
    
    // Hide controls if an item stats popup is selected/open
    if (typeof window.mobileSelection !== 'undefined' && window.mobileSelection) {
        pop();
        return;
    }

    // Hide other controls if menu or shop is open
    if (menuVisible || (typeof shopOpen !== 'undefined' && shopOpen)) {
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
    if (typeof isMobile === 'undefined' || !isMobile || !signedIn || menuVisible || (typeof shopOpen !== 'undefined' && shopOpen)) return;
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
            
            // Find best button for this touch (prevent one touch hitting multiple)
            let bestBtn = null;
            let minD = Infinity;

            for (let btn of buttons) {
                let bx = btn.x;
                let by = btn.y;
                let d = dist(tx, ty, bx, by);
                if (d < btn.r * 1.5) { 
                    if (d < minD) {
                        minD = d;
                        bestBtn = btn;
                    }
                }
            }
            
            if (bestBtn) {
                keys[bestBtn.key] = true;
                mobileButtonTimers[bestBtn.key] = millis();
            }
        }
    }

    // Apply latching (minimum hold time) to prevent dropped inputs on fast taps
    const LATCH_MS = 50; // Reduced from 100ms to 50ms for snappier response
    for (let btn of buttons) {
        if (!keys[btn.key]) { // If not currently held by a touch
            if (mobileButtonTimers[btn.key] && (millis() - mobileButtonTimers[btn.key] < LATCH_MS)) {
                keys[btn.key] = true;
            }
        }
    }
}

function getScaledInputCoordinates(screenX, screenY) {
    if (typeof isMobile !== 'undefined' && isMobile) {
        const cx = width / 2;
        const cy = height / 2;
        const s = 0.65;
        // Inverse of: drawnX = (logicX - cx) * s + cx
        // logicX - cx = (drawnX - cx) / s
        // logicX = (drawnX - cx) / s + cx
        return {
            x: (screenX - cx) / s + cx,
            y: (screenY - cy) / s + cy
        };
    }
    return { x: screenX, y: screenY };
}

function touchStarted(event) {
    // Explicitly update window.lastInputTime for global visibility
    window.lastInputTime = millis();
    if (typeof lastInputTime !== 'undefined') lastInputTime = millis();

    // Ensure audio context is started on first user interaction (mobile requirement)
    if (typeof getAudioContext === 'function' && getAudioContext().state !== 'running') {
        userStartAudio();
    }
    
    // Force fullscreen on first touch if on mobile
    if (typeof isMobile !== 'undefined' && isMobile) {
        let fs = fullscreen();
        if (!fs) {
            fullscreen(true);
        }
    }

    // Allow default browser behavior for inputs (text fields, etc.)
    if (event && event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) {
        return true;
    }

    // CHECK MOBILE CONTROLS FIRST (HUD)
    // This allows clicking Pause (Resume) even when menu is open, and ensures HUD buttons take priority
    if (typeof isMobile !== 'undefined' && isMobile && signedIn) {
        // Mobile Interactions - Check ALL active touches to handle multi-touch interactions (e.g. moving + pausing)
        for (let i = 0; i < touches.length; i++) {
        const mx = touches[i].x;
        const my = touches[i].y;
        
        // Pause Button - Check regardless of menu state for exit behavior
        const pauseBtn = getMobilePauseButton();
        if (Math.abs(mx - pauseBtn.x) < pauseBtn.w/2 + 30 &&
            Math.abs(my - pauseBtn.y) < pauseBtn.h/2 + 30) {
             
             // Toggle logic (Debounced)
             if (typeof window.lastPauseToggleTime === 'undefined') window.lastPauseToggleTime = 0;
             if (millis() - window.lastPauseToggleTime > 500) {
                 window.lastPauseToggleTime = millis();
                 if (menuVisible) {
                     menuVisible = false;
                 } else {
                     menuVisible = true;
                     if (menuManager) menuManager.show('login');
                 }
             }
             return false;
        }

        // If menu is open, handle menu interactions via manager later, but SKIP game controls
        if (menuVisible) continue; // Skip to next touch or end

        // Chat Button
        const chatBtn = getMobileChatButton();
        if (Math.abs(mx - chatBtn.x) < chatBtn.w/2 + 30 &&
            Math.abs(my - chatBtn.y) < chatBtn.h/2 + 30) {
             toggleMobileChat();
             return false;
        }

        // Check teleport button first
        if (teleportButtonRegion) {
            const teleportClicked = handleTeleportButtonClick(mx, my);
            if (teleportClicked) {
                return false; // Consume event
            }
        }
        
        // Check shop toggle button
        if (shopButtonRegion) {
            const shopButtonClicked = handleShopButtonClick(mx, my);
            if (shopButtonClicked) {
                return false; // Consume event
            }
        }

        // Check sell all button
        if (sellAllButtonRegion) {
            const sellAllClicked = handleSellAllButtonClick(mx, my);
            if (sellAllClicked) {
                return false; // Consume event
            }
        }
        
        // Action Buttons
        if (typeof window.mobileActionButtons !== 'undefined' && window.mobileActionButtons.length > 0) {
            let actionHit = false;
            const actionPadding = 20; // Extra hit area for action buttons
            
            for (let btn of window.mobileActionButtons) {
                if (mx >= btn.x - actionPadding && mx <= btn.x + btn.w + actionPadding && 
                    my >= btn.y - actionPadding && my <= btn.y + btn.h + actionPadding) {
                    
                    const action = btn.action;
                     if (action.type === 'buy') {
                         purchaseShopItem(action.index);
                    } else if (action.type === 'equip') {
                         sendEquipMessage(action.index);
                    } else if (action.type === 'sell') {
                         sendSellItemMessage(action.index);
                    }
                    window.mobileSelection = null;
                    actionHit = true;
                    // Debounce to prevent fallthrough clicks
                    window.lastActionTime = millis();
                    break;
                }
            }
            if (actionHit) return false;
        }
        
        // Check Selection Hits
        let uiHit = false;
        
        // Get scaled coordinates for elements inside the Zoom Layer
        const scaledClick = getScaledInputCoordinates(mx, my);

        // Equipped Click checks HUD elements (Unscaled) -> Use Raw Coords
        if (handleEquippedClick(mx, my)) uiHit = true;
        
        // Shop is unscaled now, so use raw mx/my
        if (!uiHit && typeof shopRegions !== 'undefined' && shopRegions.length > 0) {
             if (handleShopClick(mx, my)) uiHit = true;
        }
        
        // Inventory is in Zoom Layer -> Use Scaled Coords
        if (!uiHit && typeof inventoryRegions !== 'undefined') {
             for (let region of inventoryRegions) {
                 const halfSize = region.size / 2;
                 if (scaledClick.x >= region.x - halfSize && scaledClick.x <= region.x + halfSize &&
                     scaledClick.y >= region.y - halfSize && scaledClick.y <= region.y + halfSize) {
                      handleInventoryClick(scaledClick.x, scaledClick.y); 
                      uiHit = true;
                      break;
                 }
             }
        }
        
        if (uiHit) return false;
        
        // Clear selection if tapping empty space
        if (window.mobileSelection && !uiHit && !menuVisible) {
             window.mobileSelection = null;
        }

        } // End of touch loop

        if (menuVisible) {
            // fallthrough to menu handling
        } else {
             updateMobileControls();
             return false;
        }
    }

    // Handle Menu Interactions
    if ((menuVisible || !signedIn) && menuManager) {
        if (typeof menuManager.touchStarted === 'function') {
            if (menuManager.touchStarted()) return false;
        }
    }

    // Allow touch interactions for gameplay if signed in (non-mobile fallback)
    if (signedIn && !menuVisible && (!isMobile)) {
        keys.mouse = true;
    }
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
    window.lastInputTime = millis();
    if (typeof lastInputTime !== 'undefined') lastInputTime = millis();

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
function toggleMobileChat(forceState) {
    if (typeof forceState !== 'undefined') {
        chatting = forceState;
    } else {
        chatting = !chatting;
    }
    const container = document.getElementById('mobileChatContainer');
    const input = document.getElementById('mobileChatInput');
    
    if (chatting) {
        if (container) container.style.display = 'flex';
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
                }
                toggleMobileChat(false); // Close chat
            }
        });

        // Close chat when keyboard is dismissed or user clicks outside (blur)
        input.addEventListener('blur', () => {
             // Delay to allow send button click to register
             setTimeout(() => {
                 toggleMobileChat(false);
             }, 200);
        });
    }
    
    if (sendBtn) {
        const sendMessage = () => {
             if (current_chat.length > 0) {
                 chat_message = current_chat;
                 current_chat = "";
                 if (input) input.value = "";
             }
             toggleMobileChat(false);
        };

        sendBtn.addEventListener('click', (e) => {
             e.preventDefault();
             sendMessage();
        });
        
        // Prevent immediate blur when pressing the button with mouse
        sendBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        // Handle touch interaction explicitly to ensure it works before blur
        sendBtn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevents blur and synthetic click
            sendMessage();
        });
    }
});
function mouseMoved() { lastInputTime = millis(); }
