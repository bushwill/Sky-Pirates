let ws;
let pingTimes = [];

let connected = false;
let reconnecting = false;

let avgPing = 100;
let playerUpdateTime = 100;
let lastPlayerUpdate = 0;
let pingUpdateTime = 100;
let lastPing = 0;
let gameUpdateTime = 10;
let lastGameUpdate = 0;

let mapData;
let recovery = null;
let lastMapRequest = -2000;

// Track previous biome to detect when player enters recovery zone
let previousBiome = null;

let players = [];
let enemies = [];
let projectiles = [];
let crates = [];
let particles = [];
let events = [];
let displayedEventIds = new Set(); // Track which events we've already displayed

// Global array to store clickable regions for inventory items.
// Each element will be an object: { item, x, y, size }
let inventoryRegions = [];

// Global variable to store teleport button region
let teleportButtonRegion = null;

let chat_messages = [];
let notice_messages = [];

let username;
let r, g, b;
let usedKeys = ['w', 'a', 's', 'd', 'c', 'r', 'f', 'p', 'mouse'];
let keys = { w: false, a: false, s: false, d: false, c: false, r: false, f: false, p: false, mouse: false };
let lastKeyPressTimes = { w: 0, a: 0, s: 0, d: 0 };
let selectedGun1 = 0;
let selectedGun2 = 1;

let helpWindow = false;
let signedIn = false;
let signedInTime = 0;

let chat_message;
let current_chat = "";
let chatting = false;

let clientEstimating = true;

// Settings dictionary - contains all user-configurable settings
let settings = {
    dynamicCamera: true,
    screenShake: true
};

// --- Menu and color picker setup ---
let menuManager;
let colorPicker;
// Whether the menu overlay is visible during gameplay (toggle with ESC)
let menuVisible = false;

function setup() {
    createCanvas(windowWidth, windowHeight);
    connectWebSocket();
    rectMode(CENTER);
    stroke(0);
    textAlign(CENTER);
    background(255, 155, 0);

    // p5 provides keyPressed/keyTyped/ keyReleased hooks — use those instead of duplicating DOM key events
    // (window listeners for keydown/keyup were removed to avoid duplicate input handling)
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    // Load settings from cookies
    if (typeof loadSettings === 'function') {
        const loadedSettings = loadSettings();
        // Merge loaded settings with defaults
        settings = { ...settings, ...loadedSettings };
    }

    colorPicker = createColorPicker('#ff8800');
    // Set to initial position, will be updated each frame in draw()
    colorPicker.hide();

    menuManager = new MenuManager(colorPicker);

    // Add screens
    menuManager.addScreen('login', new LoginMenuScreen(colorPicker));
    menuManager.addScreen('settings', new SettingsMenuScreen());
    // ... add your other menus here

    // Start at login
    menuManager.show('login');
}

function draw() {
    background(255, 155, 0);
    if (!signedIn) {
        if (connected) serverSync();
        // If you want the actual map visible even when not signed in:
        if (mapData) {
            handleGameDisplay();
            // Draw other map elements here
        } else {
            background(255, 155, 0);
        }

        // Calculate login menu dimensions
        let mw = width * 0.6;
        let mh = height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        menuManager.draw(mx, my, mw, mh);
        return;
    } else {
        if (colorPicker) colorPicker.hide();
        if (!connected) {
            handleDisconnectPage();
        } else {
            background(255, 155, 0)
            const controlledPlayer = players.find(player => player.username === username);
            
            // Check if player entered recovery zone and sort inventory
            if (controlledPlayer && controlledPlayer.biome === 'recovery' && previousBiome !== 'recovery') {
                if (controlledPlayer.inventory && Array.isArray(controlledPlayer.inventory)) {
                    sortInventory(controlledPlayer.inventory);
                }
            }
            // Update previous biome for next frame
            if (controlledPlayer) {
                previousBiome = controlledPlayer.biome;
            }
            
            serverSync(controlledPlayer);
            if (clientEstimating) {
                estimatePlayerPositions();
                estimateProjectilePositions();
                estimateCratePositions();

                // Use advanced prediction for controlled player, simple for others
                if (controlledPlayer) {
                    advancedPlayerPrediction(controlledPlayer, keys);
                }
            }
            if (mapData) {
                handleGameDisplay(controlledPlayer);
                // Draw menu overlay if toggled during gameplay
                if (menuVisible) {
                    let mw = width * 0.6;
                    let mh = height * 0.8;
                    let mx = (width - mw) / 2;
                    let my = (height - mh) / 2;
                    menuManager.draw(mx, my, mw, mh);
                }
            }
        }
    }
}

function serverSync(player = null) {
    updateUpdates();
    if (millis() - lastPlayerUpdate > playerUpdateTime) {
        sendPlayerData(player);
        getPlayerData();
        getEnemyData();
        getProjectileData();
        getCrateData();
        getEventData();
        lastPlayerUpdate = millis();
    }
    if (millis() - lastPing > pingUpdateTime) {
        sendPing();
        lastPing = millis();
    }
    if (!mapData) getMapData();
}

function handleGameDisplay(controlledPlayer) {
    if (controlledPlayer) drawMapBackground(mapData);
    else drawMapBackground(mapData);
    textSize(12);
    textAlign(CENTER);
    stroke(0)
    if (controlledPlayer && signedIn) {
        // Display help menu prompt for first 10 seconds
        if (millis() - signedInTime < 10000 && !helpWindow) {
            textSize(16);
            text("Early Access / Press H key to show help window", windowWidth / 2, windowHeight * 0.2);
            textSize(12);
        }
        
        // Calculate camera center between player and mouse cursor
        const cameraCenter = getCameraCenter(controlledPlayer, mouseX, mouseY);
        const centerX = cameraCenter.x;
        const centerY = cameraCenter.y;
        
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap, centerX, centerY);
        drawMapPolygonsSides(mapPolygonsMap, centerX, centerY);

        // Draw particles behind all game objects
        updateParticles();
        displayEvents(centerX, centerY);
        drawParticles(centerX, centerY);

        displayCrates(centerX, centerY);
        drawMapPolygonsFronts(mapPolygonsMap, centerX, centerY);
        drawPartyIndicator(controlledPlayer, centerX, centerY);
        displayProjectiles(centerX, centerY);
        displayPlayers(centerX, centerY);
        displayEnemies(centerX, centerY);
        if (helpWindow && !chatting) handleHelpWindow();
    } else {
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap);
        drawMapPolygonsSides(mapPolygonsMap);

        // Draw particles behind all game objects
        updateParticles();
        displayEvents();
        drawParticles();

        displayCrates();
        drawMapPolygonsFronts(mapPolygonsMap);
        displayProjectiles();
        displayPlayers();
        displayEnemies();
    }
    displayChat();
    displayNoticeMessages();
    displayAppInfo();
}

// Draws the help window overlay
function handleHelpWindow() {
    drawHelpWindow();
}

// Function to check what biome a position is in
function getBiomeAtPosition(x, y) {
    if (!mapData || !mapData.biomes) return 'air'; // Default to air if no map data

    // Iterate all biomes to check if the position is within any biome
    for (let i = 0; i < mapData.biomes.length; i++) {
        const biome = mapData.biomes[i];
        if (biome.x1 <= x && x <= biome.x2 && biome.y1 <= y && y <= biome.y2) {
            return biome.type;
        }
    }

    // If no matching biome is found, default to 'air'
    return 'air';
}

function handleDisconnectPage() {
    background(100);
    fill(255, 255, 255);
    textAlign(CENTER);
    textSize(32);

    if (reconnecting) {
        text(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`, windowWidth * 0.5, windowHeight * 0.2);
        textSize(16);
        text("Please wait...", windowWidth * 0.5, windowHeight * 0.3);
    } else if (reconnectAttempts >= maxReconnectAttempts) {
        text("Connection Failed", windowWidth * 0.5, windowHeight * 0.2);
        textSize(16);
        text("Please refresh the page to try again", windowWidth * 0.5, windowHeight * 0.3);
    } else {
        text("Disconnected", windowWidth * 0.5, windowHeight * 0.2);
        textSize(16);
        text("Attempting to reconnect...", windowWidth * 0.5, windowHeight * 0.3);
    }
}

// --- Remove all legacy login UI code below this line ---
// function handleLoginPage() { ... }
// function initLoginUI() { ... }

// --- Utility ---
function hasNonWhitespace(str) {
    return str.trim().length > 0;
}

// --- Teleport Functions ---
function handleTeleportRequest() {
    const controlledPlayer = players.find(player => player.username === username);
    if (!controlledPlayer || !controlledPlayer.twinRecoveryZone) {
        return; // No twin zone available
    }

    sendTeleportMessage();
}

function handleTeleportButtonClick(mouseX, mouseY) {
    if (!teleportButtonRegion) return false;

    const isInside = mouseX >= teleportButtonRegion.x - teleportButtonRegion.width / 2 &&
        mouseX <= teleportButtonRegion.x + teleportButtonRegion.width / 2 &&
        mouseY >= teleportButtonRegion.y - teleportButtonRegion.height / 2 &&
        mouseY <= teleportButtonRegion.y + teleportButtonRegion.height / 2;

    if (isInside) {
        handleTeleportRequest();
        return true; // Button was clicked
    }

    return false; // Button was not clicked
}

function sendTeleportMessage() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'teleport_to_twin'
        };
        ws.send(msgpack.encode(message));
    }
}

// Helper function to convert screen coordinates to world coordinates
function screenToWorld(screenX, screenY, cameraWorldX, cameraWorldY) {
    const offsetX = screenX - width / 2;
    const offsetY = screenY - height / 2;
    return {
        x: cameraWorldX + offsetX,
        y: cameraWorldY + offsetY
    };
}

// Helper function to calculate camera center between player and mouse
// Uses smooth interpolation based on mouse distance from center
function getCameraCenter(player, mouseScreenX, mouseScreenY) {
    // Compute base camera position depending on dynamicCamera setting
    let camX, camY;
    if (!settings.dynamicCamera) {
        // Static camera: center directly on player
        camX = player.x;
        camY = player.y;
    } else {
        // Dynamic camera: follow mouse smoothly between player and cursor
        // Convert mouse screen coordinates to world coordinates
        const mouseWorld = screenToWorld(mouseScreenX, mouseScreenY, player.x, player.y);
        
        // Calculate normalized mouse distance from screen center (0-1)
        // Use max of horizontal and vertical distances for consistent edge behavior
        const mouseDX = Math.abs(mouseScreenX - width / 2);
        const mouseDY = Math.abs(mouseScreenY - height / 2);
        
        // Normalize each dimension separately, then take the maximum
        // This creates a square deadzone instead of circular
        const normalizedX = mouseDX / (width / 2);
        const normalizedY = mouseDY / (height / 2);
        const normalizedDistance = Math.max(normalizedX, normalizedY);
        
        // Clamp to 1.0 (in case mouse goes slightly outside canvas)
        const clampedDistance = Math.min(normalizedDistance, 1.0);
        
    // Use smooth curve for interpolation (ease-out quadratic)
    // When mouse is at center (0): t = 0 (camera at player)
    // When mouse is at edge (1): t = 0.67 (camera 2/3 towards mouse) on reference screens
    // Scale the maximum interpolation by screen size so larger displays get a less aggressive camera.
    // Compute a screen scale factor (based on diagonal logical pixels) relative to a reference diagonal.
    const diag = Math.sqrt(width * width + height * height);
    const REFERENCE_DIAG = 1400; // reference diagonal (logical pixels) where behavior is unchanged
    const screenScale = Math.max(0.5, Math.min(2.0, diag / REFERENCE_DIAG));
    // Dampening reduces the effective t on larger screens. Use sqrt for gentle curve.
    const dampening = 1 / Math.sqrt(screenScale);
    const baseMax = 0.67; // original maximum interpolation at edge
    const maxT = baseMax * dampening; // scaled max interpolation
    const t = clampedDistance * clampedDistance * maxT;
        
        // Calculate base camera position
        camX = player.x + (mouseWorld.x - player.x) * t;
        camY = player.y + (mouseWorld.y - player.y) * t;
    }
    
    // Add screen shake based on speed if enabled (applies for both static and dynamic cameras)
    if (settings.screenShake) {
        const speed = Math.sqrt(player.vx * player.vx + player.vy * player.vy);
        const shakeIntensity = Math.min(speed * 0.05, 3); // Max 3 units of shake
        
        // Use time-based noise with multiple frequencies for more variation
        const time = millis() * 0.001; // Convert to seconds
        const shakeX = (
            Math.sin(time * 2.3) * Math.cos(time * 1.7) * 0.5 +
            Math.sin(time * 3.1) * 0.3 +
            Math.cos(time * 1.3) * Math.sin(time * 2.7) * 0.2
        ) * shakeIntensity;
        const shakeY = (
            Math.cos(time * 1.9) * Math.sin(time * 2.1) * 0.5 +
            Math.cos(time * 2.8) * 0.3 +
            Math.sin(time * 1.5) * Math.cos(time * 3.3) * 0.2
        ) * shakeIntensity;
        
        camX += shakeX;
        camY += shakeY;
    }
    
    // Interpolate between player position and mouse position
    return {
        x: camX,
        y: camY
    };
}

let testing = false;

