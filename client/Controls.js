function mousePressed() {
    if (!signedIn && menuManager.current && menuManager.current.mousePressed) {
        let mw = width * 0.6;
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.current.mousePressed(mouseX, mouseY, mx, my, mw, mh);
    } else if (signedIn && inventoryRegions.length > 0) {
        handleInventoryClick(mouseX, mouseY);
    }
}

function keyPressed() {
    if (!signedIn && menuManager.current && menuManager.current.keyPressed) {
        menuManager.current.keyPressed(key);
        return;
    }

    if (signedIn) {
        if (chatting) {
            // Special keys for chat input
            if (keyCode === ENTER) {
                chat_message = current_chat;
                current_chat = "";
                chatting = false;
            } else if (keyCode === BACKSPACE) {
                current_chat = current_chat.slice(0, -1);
            } else if (keyCode === ESCAPE) {
                chatting = false;
            }
        } else {
            // Start chatting with Enter (when not chatting)
            if (keyCode === ENTER) {
                chatting = true;
                helpWindow = false;
            }
        }
    }
}

function keyTyped() {
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
    if (signedIn && !chatting) {
        const key = event.key.toLowerCase();
        if (usedKeys.includes(key)) {
            keys[key] = true;
        }
    }
}

function handleKeyUp(event) {
    if (signedIn) {
        const key = event.key.toLowerCase();
        if (usedKeys.includes(key)) {
            keys[key] = false;
            lastKeyPressTimes[key] = millis();
        }
    }
}