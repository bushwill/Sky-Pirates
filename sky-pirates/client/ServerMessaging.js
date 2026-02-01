let wasDisconnected = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let lastLogin = null;
let maxReconnectAttempts = 10;
let serverTimeOffset = 0; // Difference between server time and client time

// Global cycle variables
window.cycleTime = 0;
window.DAY_DURATION = 16 * 60 * 1000;
window.NIGHT_DURATION = 8 * 60 * 1000;

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
        
        // Check session status if we have a saved ID
        const savedClientId = getCookie('skyPiratesClientId');
        if (savedClientId) {
            checkSessionStatus(savedClientId);
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
            
            // Reject messages older than 100ms using synchronized clock
            const now = Date.now();
            if (decodedMessage.timeSent) {
                const estimatedServerTime = now + serverTimeOffset;
                // Allow 150ms tolerance for jitter
                if ((estimatedServerTime - decodedMessage.timeSent) > 150) {
                    // console.warn(`Rejected stale message (age: ${estimatedServerTime - decodedMessage.timeSent}ms):`, decodedMessage.type);
                    // return; 
                    // Commented out strict rejection for now to prevent dropping valid packets during jitter spikes
                }
            }
            
            handleDecodedMessage(decodedMessage);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    };
}

function handleDecodedMessage(decodedMessage) {
    switch (decodedMessage.type) {
        case 'session_status':
            if (decodedMessage.account) {
                 // Account identified by server
                 isAccountSession = true;
                 if (menuManager && menuManager.screens && menuManager.screens['login']) {
                     const loginScreen = menuManager.screens['login'];
                     loginScreen.isAccountSession = true;
                     if (decodedMessage.account.username) {
                        loginScreen.accountName = decodedMessage.account.username;
                     }
                     // Force login message update to reflect account status immediately
                     if (!loginScreen.loginMsg) {
                         loginScreen.loginMsg = ""; // Trigger refresh if needed
                     }
                 }
            } else {
                 isAccountSession = false;
                 if (menuManager && menuManager.screens && menuManager.screens['login']) {
                     menuManager.screens['login'].isAccountSession = false;
                 }
            }

            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].setSessionActive(decodedMessage.active);
                menuManager.screens['login'].setSaveExists(decodedMessage.saveExists);
            }
            break;

        case 'register_success':
            if (menuManager.screens['createAccount']) {
                menuManager.screens['createAccount'].msg = "Success!";
                setTimeout(() => {
                    if (typeof isAccountSession !== 'undefined') isAccountSession = true;
                    if (menuManager.screens['login']) {
                        menuManager.screens['login'].isAccountSession = true;
                        if (decodedMessage.username) {
                             menuManager.screens['login'].accountName = decodedMessage.username;
                        }
                    }
                    menuManager.show('login');
                }, 1000);
            }
            break;

        case 'register_failed':
             if (menuManager.screens['createAccount']) {
                menuManager.screens['createAccount'].msg = "Error: " + decodedMessage.message;
             }
             break;

        case 'account_login_success':
             if (typeof isAccountSession !== 'undefined') isAccountSession = true;
             if (menuManager.screens['login']) {
                 menuManager.screens['login'].isAccountSession = true;
             }
             if (decodedMessage.playerId) {
                setCookie('skyPiratesClientId', decodedMessage.playerId, 30);
             }
             if (menuManager.screens['login'] && decodedMessage.username) {
                  menuManager.screens['login'].accountName = decodedMessage.username;
                  
                  // Save credentials for auto-login
                  if (window.pendingAccountLogin && window.pendingAccountLogin.username === decodedMessage.username) {
                      setCookie('skypirates_account_name', window.pendingAccountLogin.username, 30);
                      setCookie('skypirates_account_password', window.pendingAccountLogin.password, 30);
                      window.pendingAccountLogin = null;
                  }
             }
             if (menuManager.screens['loginAccount']) {
                menuManager.screens['loginAccount'].msg = "Success!";
                setTimeout(() => menuManager.show('login'), 1000);
             }
             
             // Update save state awareness
             if (menuManager.screens['login']) {
                 menuManager.screens['login'].setSaveExists(decodedMessage.saveExists);
             }
             break;
             
        case 'achievements_update':
            // Update achievements list in the login menu (or wherever we store client state)
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].achievements = decodedMessage.achievements;
            }
            break;

        case 'account_login_failed':
             if (menuManager.screens['loginAccount']) {
                menuManager.screens['loginAccount'].msg = "Error: " + decodedMessage.message;
             }
             break;

        case 'map_data':
            mapData = decodedMessage.map;
            recovery = mapData.biomes.find(biome => biome.type === "recovery")
            break;

        case 'map_data':
            if (decodedMessage.map) {
                mapData = decodedMessage.map;
                // Also assign to global 'map' specific for polygon logic if needed
                // Assuming 'map' variable is used somewhere else or MapDraw handles it
                map = decodedMessage.map;
            }
            break;

        case 'login_success':
            signedIn = true;
            signedInTime = millis();
            
            // Store client ID in cookie for session persistence (expires in 30 days)
            if (decodedMessage.playerId) {
                setCookie('skyPiratesClientId', decodedMessage.playerId, 30);
                console.log('Client ID saved to cookie:', decodedMessage.playerId);
            }
            
            // If server sent an 'updated' message it's a party/info update while already logged in
            if (decodedMessage.message === 'updated') {
                // Close any overlay menu and show a brief confirmation in the login screen area
                if (typeof menuVisible !== 'undefined') {
                    menuVisible = false;
                    if (menuManager && menuManager.current && menuManager.current.hide) {
                        menuManager.current.hide();
                    }
                }
                if (menuManager && menuManager.screens && menuManager.screens['login']) {
                    menuManager.screens['login'].loginMsg = 'Party updated.';
                    // Clear the message after a short delay
                    setTimeout(() => {
                        if (menuManager && menuManager.screens && menuManager.screens['login']) {
                            menuManager.screens['login'].loginMsg = '';
                        }
                    }, 2000);
                }
            } else {
                if (menuManager && menuManager.screens && menuManager.screens['login']) {
                    menuManager.screens['login'].loginMsg = "Logged in.";
                }
                menuManager.show("main"); // or whatever is your game screen
                console.log("Successfully logged in!");
            }
            break;
        
        case 'player_id_update':
            // Update the client ID cookie when progress is reset/migrated
            if (decodedMessage.playerId) {
                setCookie('skyPiratesClientId', decodedMessage.playerId, 30);
                console.log('New client ID saved to cookie after reset:', decodedMessage.playerId);
            }
            break;
            
        case 'login_failed':
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].loginMsg = decodedMessage.message;
            }
            break;

        case 'gamestate_update':
            // Combined update packet
            // 0. Time
            if (decodedMessage.time !== undefined) {
                cycleTime = decodedMessage.time; 
            }
            if (decodedMessage.dayDuration !== undefined) {
                window.DAY_DURATION = decodedMessage.dayDuration;
            }
            if (decodedMessage.nightDuration !== undefined) {
                window.NIGHT_DURATION = decodedMessage.nightDuration;
            }

            // 1. Players
            if (decodedMessage.players && Array.isArray(decodedMessage.players)) {
                 const newPlayers = decodedMessage.players.filter(p => p && p.username && p.username.trim() !== "");
                 const visualState = new Map();
                 if (players && players.length > 0) {
                    players.forEach(p => {
                        if (p.username && typeof p.displayX !== 'undefined') {
                            visualState.set(p.username, { x: p.displayX, y: p.displayY });
                        }
                    });
                }
                if (typeof reconcilePlayer === 'function' && username) {
                    const localPlayerServerState = newPlayers.find(p => p.username === username);
                    if (localPlayerServerState) reconcilePlayer(localPlayerServerState);
                }
                players = newPlayers;
                if (menuManager && menuManager.screens && menuManager.screens['login']) {
                    menuManager.screens['login'].hasReceivedPlayerData = true;
                }
                players.forEach(p => {
                    if (visualState.has(p.username)) {
                        const state = visualState.get(p.username);
                        p.displayX = state.x; p.displayY = state.y;
                    } else {
                        p.displayX = p.x; p.displayY = p.y;
                    }
                });
                
                // Messages
                 if (decodedMessage.messages && Array.isArray(decodedMessage.messages)) {
                    decodedMessage.messages.forEach(msg => {
                        if (!chat_messages.find(m => m.id === msg.id)) {
                            chat_messages.push(msg);
                        }
                    });
                }
            }

            // 2. Enemies
            if (decodedMessage.enemies && Array.isArray(decodedMessage.enemies)) {
                enemies = decodedMessage.enemies;
            }

            // 3. Animals
            if (decodedMessage.animals && Array.isArray(decodedMessage.animals)) {
                animals = decodedMessage.animals;
            }

            // 4. Projectiles
            if (decodedMessage.projectiles && Array.isArray(decodedMessage.projectiles)) {
                projectiles = decodedMessage.projectiles;
            }

            // 5. Crates
            if (decodedMessage.crates && Array.isArray(decodedMessage.crates)) {
                crates = decodedMessage.crates;
            }

            // 6. Events
            if (decodedMessage.events && Array.isArray(decodedMessage.events)) {
                events = decodedMessage.events;
                // Auto-clear old displayed events tracking if list is empty?
                if (events.length === 0) displayedEventIds.clear();
            }
            break;

        case 'player_data':
            if (!decodedMessage.players || !Array.isArray(decodedMessage.players)) {
                console.warn('Invalid players data:', decodedMessage.players);
                players = [];
            } else {
                const newPlayers = decodedMessage.players.filter(p => p && p.username && p.username.trim() !== "");
                
                // Preserve visual state (displayX/Y) across updates
                const visualState = new Map();
                if (players && players.length > 0) {
                    players.forEach(p => {
                        if (p.username && typeof p.displayX !== 'undefined') {
                            visualState.set(p.username, { x: p.displayX, y: p.displayY });
                        }
                    });
                }

                // Handle reconciliation for local player
                if (typeof reconcilePlayer === 'function' && username) {
                    const localPlayerServerState = newPlayers.find(p => p.username === username);
                    if (localPlayerServerState) {
                        reconcilePlayer(localPlayerServerState);
                    }
                }
                
                players = newPlayers;

                // Update community data status for Login Menu
                if (menuManager && menuManager.screens && menuManager.screens['login']) {
                    menuManager.screens['login'].hasReceivedPlayerData = true;
                }
                
                // Restore visual state
                players.forEach(p => {
                    if (visualState.has(p.username)) {
                        const state = visualState.get(p.username);
                        p.displayX = state.x;
                        p.displayY = state.y;
                    } else {
                        // Initialize for new players
                        p.displayY = p.y;
                    }
                });

                // Handle global chat messages
                if (decodedMessage.messages && Array.isArray(decodedMessage.messages)) {
                    decodedMessage.messages.forEach(msg => {
                        if (!chat_messages.find(m => m.id === msg.id)) {
                             // msg format from server: { id, username, message }
                            chat_messages.push(msg);
                        }
                    });
                }
            }
            break;

        case 'enemy_data':
            if (!decodedMessage.enemies || !Array.isArray(decodedMessage.enemies)) {
                console.warn('Invalid enemies data:', decodedMessage.enemies);
                enemies = [];
            } else {
                enemies = decodedMessage.enemies;
                // Debug: log enemy positions
                if (enemies.length > 0 && enemies[0].type === 'boat') {
                    console.log('Boat enemy received:', enemies[0].x, enemies[0].y, 'type:', enemies[0].type);
                }
            }
            break;

        case 'animal_data':
            if (!decodedMessage.animals || !Array.isArray(decodedMessage.animals)) {
                console.warn('Invalid animals data:', decodedMessage.animals);
                animals = [];
            } else {
                animals = decodedMessage.animals;
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
        case 'event_data':
            if (!decodedMessage.events || !Array.isArray(decodedMessage.events)) {
                console.warn('Invalid events data:', decodedMessage.events);
                events = [];
            } else {
                events = decodedMessage.events;
            }
            break;

        case 'low_freq_update':
            if (decodedMessage.shops && Array.isArray(decodedMessage.shops)) {
                shops = decodedMessage.shops;
            }
            if (decodedMessage.community && Array.isArray(decodedMessage.community)) {
                window.allPlayers = decodedMessage.community;
            }
            break;

        case 'pong': {
            const now = Date.now();
            const rtt = now - decodedMessage.clientTime;
            pingTimes.push(rtt / 2);
            if (pingTimes.length > 10) pingTimes.shift();
            avgPing = pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length;
            
            // Calculate clock offset: serverTime = clientTime + offset
            if (decodedMessage.timeSent) {
                const estimatedServerTime = decodedMessage.timeSent;
                const estimatedClientTimeAtServer = now - (rtt / 2);
                serverTimeOffset = estimatedServerTime - estimatedClientTimeAtServer;
            }
            break;
        }

        case 'notice_message':
            notice_messages.push({
                message: decodedMessage.message,
                timeShown: 0,
                timeDelay: 3000 + decodedMessage.message.length * 100,
                message_type: decodedMessage.message_type,
            });
            break;

        case 'player_destroyed':
            // Store current camera position before clearing player
            const dyingPlayer = players.find(player => player.username === username);
            if (dyingPlayer) {
                const cameraCenter = getCameraCenter(dyingPlayer, mouseX, mouseY);
                deathCameraX = cameraCenter.x;
                deathCameraY = cameraCenter.y;
            } else {
                deathCameraX = 0;
                deathCameraY = 0;
            }
            
            // INSTANTLY go to menu, no respawn delay
            respawnDelay = false;
            
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
            
            // Show login screen immediately
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "Your plane was destroyed! Insufficient funds to respawn.";
            }
            break;

        case 'player_downed':
            // Player is downed but will respawn (has money)
            // Store current camera position before clearing player
            const downedPlayer = players.find(player => player.username === username);
            if (downedPlayer) {
                const cameraCenter = getCameraCenter(downedPlayer, mouseX, mouseY);
                deathCameraX = cameraCenter.x;
                deathCameraY = cameraCenter.y;
            } else {
                deathCameraX = 0;
                deathCameraY = 0;
            }
            
            // Set respawn delay
            respawnDelay = true;
            respawnDelayEnd = millis() + (decodedMessage.respawnTime || 2000);
            
            // Clear players array temporarily (player will be re-added after respawn)
            players = [];
            
            // Reset all keys to prevent stuck inputs
            keys = { w: false, a: false, s: false, d: false, c: false, r: false, f: false, p: false, mouse: false };
            
            // Note: Don't set signedIn = false or clear username, as player will respawn
            break;

        case 'logout_success':
            signedIn = false;
            helpWindow = false;
            menuVisible = true;
            players = [];
            username = "";
            r = 0; g = 0; b = 0;
            chatting = false;
            current_chat = "";
            isAccountSession = false; // Reset global
            // Reset all keys to prevent stuck inputs
            keys = { w: false, a: false, s: false, d: false, c: false, r: false, f: false, p: false, mouse: false };
            // Show login menu with reset message
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = decodedMessage.message || "Logged out successfully.";
                menuManager.screens['login'].isAccountSession = false; // Reset instance state
                menuManager.screens['login'].accountName = null;
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
    // Removed dynamic update rate logic
    // if (avgPing < 100) playerUpdateTime = avgPing;
    // else playerUpdateTime = 100;
}

function sendPlayerData(player = null) {
    let t_x = 0;
    let t_y = 0;
    
    // For mobile users, always aim forward in the direction of travel
    if (isMobile && player && typeof player.angle !== 'undefined') {
        t_x = player.x + Math.cos(player.angle) * 500;
        t_y = player.y + Math.sin(player.angle) * 500;
    }
    // Use the global camera position if available, which includes screen shake and offsets
    else if (typeof globalCameraX !== 'undefined' && typeof globalCameraY !== 'undefined') {
        t_x = mouseX - windowWidth / 2 + globalCameraX;
        t_y = mouseY - windowHeight / 2 + globalCameraY;
    } else {
        // Fallback to basic player-centered calculation
        t_x = mouseX - windowWidth / 2;
        t_y = mouseY - windowHeight / 2;
        if (player) {
            t_x += player.x;
            t_y += player.y;
        }
    }

    const message = {
        type: 'update',
        username,
        keys,
        t_x,
        t_y,
        chat_message,
        sequence: inputSequence
    };
    
    // Store input for reconciliation
    if (player) {
        pendingInputs.push({
            sequence: inputSequence,
            keys: { ...keys },
            angle: player.angle // Store angle if needed for prediction
        });
        inputSequence++;
    }

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

function sendSuicide() {
    const message = {
        type: 'suicide'
    };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
    console.log('Sent suicide message to reset progress');
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

function getAnimalData() {
    const message = { type: 'get_animals' };
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

function getEventData() {
    const message = { type: 'get_events' };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function getShopData() {
    const message = { type: 'get_shops' };
    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function purchaseShopItem(itemIndex) {
    const message = { type: 'purchase_shop_item', itemIndex: itemIndex };
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
function checkSessionStatus(clientId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const accountName = getCookie('skypirates_account_name');
    const password = getCookie('skypirates_account_password');

    // Send check_session request
    const message = {
        type: 'check_session',
        playerId: clientId,
        username: accountName || undefined,
        password: password || undefined
    };
    
    const encoded = msgpack.encode(message);
    ws.send(encoded);
}

function sendResetAccountProgress(playerId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const message = {
        type: 'reset_account_progress',
        playerId
    };
    
    const encoded = msgpack.encode(message);
    ws.send(encoded);
}

function loginPlayer(name, colorObj, weaponChoices = null, partyName = "", clearParty = false) {
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

    // Get client ID from cookie if it exists
    const clientId = getCookie('skyPiratesClientId');
    
    // Get account credentials if they exist (for verification)
    const accountPassword = getCookie('skypirates_account_password');

    const message = {
        type: 'login',
        username,
        r,
        g,
        b,
        selectedGun1,
        selectedGun2,
        partyName: partyName.trim(),
        clearParty: !!clearParty,
        playerId: clientId || null, // Send client ID if available
        password: accountPassword || null
    };

    const encodedMessage = msgpack.encode(message);
    ws.send(encodedMessage);
}

function getOrInitPlayerId() {
    let id = getCookie('skyPiratesClientId');
    if (!id) {
        // Simple fallback UUID generator
        id = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        try {
            if (crypto && crypto.randomUUID) {
                id = crypto.randomUUID();
            }
        } catch (e) {
            console.warn("crypto.randomUUID not available, using fallback ID");
        }
        setCookie('skyPiratesClientId', id, 30);
    }
    return id;
}

function sendRegisterAccount(username, password) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const playerId = getOrInitPlayerId();
    // Cache credentials to allow auto-login cookie saving upon success
    window.pendingAccountLogin = { username, password };
    const message = {
        type: 'register_account',
        username,
        password,
        playerId
    };
    ws.send(msgpack.encode(message));
}

function sendLoginAccount(username, password) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const playerId = getOrInitPlayerId();
    // Cache credentials temporarily to save to cookie upon success
    window.pendingAccountLogin = { username, password };
    const message = {
        type: 'login_account',
        username,
        password,
        playerId
    };
    ws.send(msgpack.encode(message));
}

// Cookie helper functions
// REMOVED DUPLICATE DEFINITIONS


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
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Strict`;
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
    // Delete with strict attributes
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Strict`;
    // Delete with just path (legacy fallback)
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