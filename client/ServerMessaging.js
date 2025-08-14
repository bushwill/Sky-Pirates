let wasDisconnected = false;

function connectWebSocket() {
    if (connected) return;

    console.log("Attempting to reconnect...");
    ws = new WebSocket('ws://34.198.45.181:3000');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        connected = true;
        reconnecting = false;
        console.log("WebSocket connection established.");
        if (wasDisconnected) {
            wasDisconnected = false;
            // Show the login menu with a message (MenuManager version)
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "Reconnected. Please log in again.";
            }
        }
        // Optionally: you can disable/enable menu options here, if you do that in your menu system
    };

    ws.onclose = () => {
        connected = false;
        signedIn = false;
        wasDisconnected = true;
        // Optionally: disable menu login option or show error in menu
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            menuManager.show('login');
            menuManager.screens['login'].loginMsg = "Connection closed. Please try again.";
        }
        console.log("WebSocket connection closed.");
    };

    ws.onerror = (error) => {
        connected = false;
        signedIn = false;
        // Optionally: show error in menu
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            menuManager.screens['login'].loginMsg = "WebSocket error!";
        }
        console.error("WebSocket encountered an error:", error);
    };

    ws.onmessage = (event) => {
        try {
            const buffer = new Uint8Array(event.data);

            if (buffer.length < 4) {
                console.warn('Received incomplete or non-data message.');
                return;
            }

            const view = new DataView(buffer.buffer);
            const length = view.getUint32(0, true);

            if (buffer.length < 4 + length) {
                console.error('Received incomplete message: payload length mismatch');
                return;
            }
            const compressedData = buffer.slice(4, 4 + length);
            const decodedMessage = msgpack.decode(compressedData);
            handleDecodedMessage(decodedMessage);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
}

function handleDecodedMessage(decodedMessage) {
    switch (decodedMessage.type) {
        case 'map_data':
            mapData = decodedMessage.map;
            recovery = mapData.biomes.find(biome => biome.type === "recovery")
            break;

        case 'login_success':
            signedIn = true;
            signedInTime = millis();
            menuManager.show("main"); // or whatever is your game screen
            break;
            
        case 'login_failed':
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].loginMsg = decodedMessage.message;
            }
            break;

        case 'player_data':
            if (!decodedMessage.players || !Array.isArray(decodedMessage.players)) {
                console.warn('Invalid players data:', decodedMessage.players);
                players = [];
            } else {
                players = decodedMessage.players.filter(p => p && p.username && p.username.trim() !== "");
            }
            break;

        case 'projectile_data':
            if (!decodedMessage.projectiles || !Array.isArray(decodedMessage.projectiles)) {
                console.warn('Invalid projectiles data:', decodedMessage.projectiles);
                projectiles = [];
            } else {
                projectiles = decodedMessage.projectiles;
            }
            break;

        case 'crate_data':
            if (!decodedMessage.crates || !Array.isArray(decodedMessage.crates)) {
                console.warn('Invalid crates data:', decodedMessage.crates);
                crates = [];
            } else {
                crates = decodedMessage.crates;
            }
            break;

        case 'pong':
            const rtt = Date.now() - decodedMessage.clientTime;
            pingTimes.push(rtt / 2);
            if (pingTimes.length > 10) pingTimes.shift();
            avgPing = pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length;
            break;

        case 'notice_message':
            notice_messages.push({
                message: decodedMessage.message,
                timeShown: 0,
                timeDelay: 3000 + decodedMessage.message.length * 100,
                message_type: decodedMessage.message_type,
            });
            break;

        case 'player_destroyed':
            signedIn = false;
            helpWindow = false;
            players = [];
            username = "";
            r = 0; g = 0; b = 0;
            chatting = false;
            current_chat = "";
            // Show login menu with death message
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "You were destroyed! Please log in again.";
            }
            break;

        default:
            console.warn('Unhandled message type:', decodedMessage.type);
    }
}

function sendPing() {
    const clientTime = Date.now();
    const message = {
        type: "ping",
        clientTime: clientTime
    };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function updateUpdates() {
    if (avgPing < 100) playerUpdateTime = avgPing;
    else playerUpdateTime = 100;
}

function sendPlayerData(player = null) {
    let t_x = mouseX - windowWidth / 2;
    let t_y = mouseY - windowHeight / 2;
    if (player) {
        t_x += player.x;
        t_y += player.y;
    }
    const message = {
        type: 'update',
        username,
        keys,
        t_x,
        t_y,
        chat_message,
    };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
    chat_message = null;
}

function sendEquipMessage(index) {
    const message = {
        type: 'equip_item',
        itemIndex: index,
    };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
    console.log(`Sent equip message for item index: ${index}`);
}

function getPlayerData() {
    const message = { type: 'get_players' };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function getProjectileData() {
    const message = { type: 'get_projectiles' };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function getCrateData() {
    const message = { type: 'get_crates' };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function getMapData() {
    if (millis() - lastMapRequest > 2000) {
        const message = { type: 'get_map' };
        const encodedMessage = msgpack.encode(message);
        ws.send(encodedMessage);
        lastMapRequest = millis();
    }
}

// Accept username and color params from menu, not HTML inputs
function loginPlayer(name, colorObj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            menuManager.screens['login'].loginMsg = "Not connected to server yet. Please wait...";
        }
        return;
    }

    if (!name || !name.trim()) {
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            menuManager.screens['login'].loginMsg = "Please enter a username.";
        }
        return;
    }

    username = name.trim();
    r = colorObj.r;
    g = colorObj.g;
    b = colorObj.b;
    x = 0;
    y = 0;

    const message = {
        type: 'login',
        username,
        r,
        g,
        b,
        selectedGun1,
        selectedGun2,
    };

    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}