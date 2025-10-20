function mousePressed() {
    // If menu is visible (either before sign-in or toggled during gameplay) route clicks to it
    if (menuVisible && menuManager.current && menuManager.current.mousePressed) {
        let mw = width * 0.6;
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.current.mousePressed(mouseX, mouseY, mx, my, mw, mh);
        return;
    }
    if (!signedIn && menuManager.current && menuManager.current.mousePressed) {
        let mw = width * 0.6;
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.current.mousePressed(mouseX, mouseY, mx, my, mw, mh);
    } else if (signedIn) {
        // Check teleport button first (higher priority)
        if (teleportButtonRegion) {
            const teleportClicked = handleTeleportButtonClick(mouseX, mouseY);
            if (teleportClicked) return; // If teleport button was clicked, don't check inventory
        }
        
        // Then check inventory
        if (inventoryRegions.length > 0) {
            handleInventoryClick(mouseX, mouseY);
        }
    }
}

function keyPressed() {
    // First: handle Escape toggle (always, before forwarding to menu)
    if (keyCode === ESCAPE) {
        if (chatting) {
            chatting = false;
            return;
        }
        menuVisible = !menuVisible;
        if (menuVisible) menuManager.show('login');
        else if (menuManager && menuManager.colorPicker) menuManager.colorPicker.hide();
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