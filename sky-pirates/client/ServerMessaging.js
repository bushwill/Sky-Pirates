let wasDisconnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let lastLogin = null;
let maxReconnectAttempts = 10;

function connectWebSocket() {
    if (connected) return;

    console.log(`Attempting to connect... (attempt ${reconnectAttempts + 1})`);
    ws = new WebSocket(WS_ADDRESS);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        connected = true;
        reconnecting = false;
        reconnectAttempts = 0;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        console.log("WebSocket connection established.");
        
        if (wasDisconnected) {
            wasDisconnected = false;
            // Always show login screen on reconnect - no auto-login
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "Reconnected. Please log in again.";
            }
        }
    };

    ws.onclose = () => {
        connected = false;
        signedIn = false;
        wasDisconnected = true;
        
        // Clear login cache to force re-login on reconnect
        clearLoginCache();
        
        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
            let delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
            
            console.log(`Connection closed. Reconnecting in ${delay/1000}s... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
            
            if (!reconnecting) {
                reconnecting = true;
                reconnectTimeout = setTimeout(() => {
                    reconnecting = false;
                    connectWebSocket();
                }, delay);
            }
            
            // Update UI with reconnection status
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = `Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`;
            }
        } else {
            // Max attempts reached
            console.log("Max reconnection attempts reached. Please refresh the page.");
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "Connection failed. Please refresh the page.";
            }
        }
    };

    ws.onerror = (error) => {
        connected = false;
        signedIn = false;
        console.error("WebSocket encountered an error:", error);
        
        // Don't show error immediately - let onclose handle reconnection
        // Only show error if we've exhausted reconnection attempts
        if (reconnectAttempts >= maxReconnectAttempts) {
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].loginMsg = "Connection error. Please refresh the page.";
            }
        }
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
            console.log("Successfully logged in!");
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

        case 'enemy_data':
            if (!decodedMessage.enemies || !Array.isArray(decodedMessage.enemies)) {
                console.warn('Invalid enemies data:', decodedMessage.enemies);
                enemies = [];
            } else {
                enemies = decodedMessage.enemies;
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
            // Reset all keys to prevent stuck inputs on respawn
            keys = { w: false, a: false, s: false, d: false, c: false, r: false, f: false, p: false, mouse: false };
            // Clear cached credentials since player was destroyed
            clearLoginCache();
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

function getEnemyData() {
    const message = { type: 'get_enemies' };
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
function loginPlayer(name, colorObj, weaponChoices = null, partyName = "") {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            if (reconnecting) {
                menuManager.screens['login'].loginMsg = `Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`;
            } else {
                menuManager.screens['login'].loginMsg = "Not connected to server yet. Please wait...";
            }
        }
        return;
    }

    if (!name || !name.trim()) {
        if (menuManager && menuManager.screens && menuManager.screens['login']) {
            menuManager.screens['login'].loginMsg = "Please enter a username.";
        }
        return;
    }

    // Update weapon selections if provided
    if (weaponChoices) {
        selectedGun1 = weaponChoices.gun1;
        selectedGun2 = weaponChoices.gun2;
    }

    // Save preferences to cookies
    saveUserPreferences(name.trim(), `#${hex(colorObj.r, 2)}${hex(colorObj.g, 2)}${hex(colorObj.b, 2)}`, selectedGun1, selectedGun2, partyName);

    // Cache login credentials for auto-reconnect
    lastLogin = { name: name.trim(), colorObj, weaponChoices: { gun1: selectedGun1, gun2: selectedGun2 }, partyName };
    
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
        partyName: partyName.trim(),
    };

    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

// Function to manually retry connection (can be called from UI)
function retryConnection() {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    reconnectAttempts = 0;
    reconnecting = false;
    connectWebSocket();
}

// Function to clear cached login credentials
function clearLoginCache() {
    lastLogin = null;
}

// Function to get current connection status
function getConnectionStatus() {
    return {
        connected,
        reconnecting,
        reconnectAttempts,
        maxReconnectAttempts,
        hasCache: !!lastLogin
    };
}

// Cookie utility functions
function setCookie(name, value, days = 90) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i];
        while (cookie.charAt(0) === ' ') {
            cookie = cookie.substring(1, cookie.length);
        }
        if (cookie.indexOf(nameEQ) === 0) {
            return decodeURIComponent(cookie.substring(nameEQ.length, cookie.length));
        }
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

// Save user preferences to cookies
function saveUserPreferences(name, color, gun1, gun2, party = "") {
    setCookie('skypirates_username', name);
    setCookie('skypirates_color', color);
    setCookie('skypirates_gun1', gun1.toString());
    setCookie('skypirates_gun2', gun2.toString());
    setCookie('skypirates_party', party);
}

// Save settings to cookies
function saveSettings(settings) {
    setCookie('skypirates_settings', JSON.stringify(settings));
}

// Load settings from cookies
function loadSettings() {
    const settingsStr = getCookie('skypirates_settings');
    if (settingsStr) {
        try {
            return JSON.parse(settingsStr);
        } catch (e) {
            console.error('Failed to parse settings cookie:', e);
        }
    }
    
    // Return default settings if none found
    return {
        dynamicCamera: false
    };
}

// Load user preferences from cookies
function loadUserPreferences() {
    const name = getCookie('skypirates_username');
    const color = getCookie('skypirates_color');
    const gun1 = getCookie('skypirates_gun1');
    const gun2 = getCookie('skypirates_gun2');
    const party = getCookie('skypirates_party');
    
    return {
        name: name || '',
        color: color || '#ff8800',
        gun1: gun1 ? parseInt(gun1) : 0,  // Default: Machine Gun
        gun2: gun2 ? parseInt(gun2) : 1,  // Default: Cannon (to match Game.js)
        party: party || ''
    };
}

// Clear all Sky Pirates cookies
function clearAllSkyPiratesCookies() {
    deleteCookie('skypirates_username');
    deleteCookie('skypirates_color');
    deleteCookie('skypirates_gun1');
    deleteCookie('skypirates_gun2');
    deleteCookie('skypirates_party');
    deleteCookie('skypirates_settings');
    console.log('All Sky Pirates cookies cleared');
}