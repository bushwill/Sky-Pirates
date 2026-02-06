// ========================================
// GLOBAL VARIABLES
// ========================================

// Connection and network
let ws;
var isMobile = false;
let pingTimes = [];
let connected = false;
let reconnecting = false;
let avgPing = 100;
let playerUpdateTime = 50; // Fixed update rate (20Hz) for consistent input handling
let lastPlayerUpdate = 0;
let pingUpdateTime = 1000; // Reduced ping rate to 1/sec
let lastPing = 0;
let lastCommunityUpdate = 0;
let gameUpdateTime = 10;
let lastGameUpdate = 0;

// Input prediction and reconciliation
let inputSequence = 0;
let pendingInputs = []; // Buffer to store inputs for reconciliation

// Map and biome tracking
let mapData;
let recovery = null;
let lastMapRequest = -2000;
let previousBiome = null; // Track previous biome to detect when player enters recovery zone

// Game entities
let players = [];
let enemies = [];
let animals = [];
let projectiles = [];
let crates = [];
let particles = [];
let clouds = [];
let events = [];
let shops = [];
let displayedEventIds = new Set(); // Track which events we've already displayed

// UI regions for click detection
var inventoryRegions = []; // { item, x, y, size }
var shopRegions = []; // { component, price, shopIndex, itemIndex, x, y, size }
var teleportButtonRegion = null;
var shopButtonRegion = null;
var sellAllButtonRegion = null;
var shopOpen = false; // Track if shop is open or closed

// Expose these regions globally so Controls.js (which is a module or script) can access them
window.inventoryRegions = inventoryRegions;
window.shopRegions = shopRegions;
window.teleportButtonRegion = teleportButtonRegion;
window.shopButtonRegion = shopButtonRegion;
window.sellAllButtonRegion = sellAllButtonRegion;

// Helper to keep window vars in sync (since simplistic assignment above only copies initial nulls/arrays)
// We need to update these whenever we update the local vars in draw or other functions.
// Actually, it's better to just ensure Controls.js looks for window.teleportButtonRegion if the local one isn't found,
// OR we replace local vars with window vars throughout Game.js.
// For safety, let's keep local vars but push them to window in the draw loop or where they are updated.

// Day/Night Cycle (Shared with server, updated by packet)
var cycleTime = 0; // 0 to 30 mins (in ms)
var DAY_DURATION = 16 * 60 * 1000;
var NIGHT_DURATION = 8 * 60 * 1000;

// Chat and messaging
let chat_messages = [];
let notice_messages = [];

// Account state
let isAccountSession = false;

// Scaled Camera
// Attach to window to ensure visibility across scripts (Controls.js)
window.cameraZoom = 1.0;
window.MAX_ZOOM_VIEW_WIDTH = 2500; // Standardized width that limits field of view

// Player state
let username;
let r, g, b;
let usedKeys = ['w', 'a', 's', 'd', 'c', 'r', 'f', 'p', 'mouse'];
let keys = { w: false, a: false, s: false, d: false, c: false, r: false, f: false, p: false, mouse: false };
let lastKeyPressTimes = { w: 0, a: 0, s: 0, d: 0 };
let selectedGun1 = 0;
let selectedGun2 = 1;

// UI state
var helpWindow = false;
var signedIn = false;
let signedInTime = 0;
let chat_message;
var current_chat = "";
var chatting = false;
let clientEstimating = true;

// Respawn delay state
let respawnDelay = false; // Whether we're in the respawn delay period
let respawnDelayEnd = 0; // Timestamp when respawn delay ends
let deathCameraX = 0; // Camera X position at death
let deathCameraY = 0; // Camera Y position at death
let globalCameraX = 0; // Global camera X for aiming logic
let globalCameraY = 0; // Global camera Y for aiming logic

// Settings dictionary - contains all user-configurable settings
let settings = {
    dynamicCamera: true,
    screenShake: true,
    optimizedParticles: true
};

// Water bobbing smoothing
let currentBobX = 0;
let currentBobY = 0;

// Menu and color picker setup
var menuManager;
var colorPicker;
var menuVisible = false; // Whether the menu overlay is visible during gameplay (toggle with ESC)

// Screensaver state
window.lastInputTime = 0; // Exposed global for Controls.js
let screensaverOpacity = 0;

// Global setter for menu visibility (accessible from other scripts)
window.setMenuVisible = function(visible) {
    menuVisible = visible;
};

// ========================================
// P5.JS LIFECYCLE FUNCTIONS
// ========================================

function setup() {
    createCanvas(windowWidth, windowHeight);

    // Check for mobile device
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    rectMode(CENTER);
    stroke(0);
    textAlign(CENTER);
    background(255, 155, 0);

    // p5 provides keyPressed/keyTyped/ keyReleased hooks — use those instead of duplicating DOM key events
    // (window listeners for keydown/keyup were removed to avoid duplicate input handling)
    // Mouse events are also handled by p5.js mousePressed/mouseReleased
    // window.addEventListener("mousedown", handleMouseDown);
    // window.addEventListener("mouseup", handleMouseUp);
    
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

    // Generate procedural cloud layer
    generateCloudLayer(clouds);

    // Add screens
    menuManager.addScreen('login', new LoginMenuScreen(colorPicker));
    menuManager.addScreen('createAccount', new AccountAuthMenuScreen('create'));
    menuManager.addScreen('loginAccount', new AccountAuthMenuScreen('login'));
    menuManager.addScreen('settings', new SettingsMenuScreen());
    // ... add your other menus here

    // Start at login
    menuManager.show('login');

    lastInputTime = millis();

    // Connect AFTER UI is ready to ensure session status updates are handled correctly
    connectWebSocket();
}

function draw() {
    // Reset mobile action buttons every frame to prevent ghost inputs
    window.mobileActionButtons = [];
    
    // Screensaver logic
    // Only active if in a menu (Main Menu or Pause Menu) AND inactive for > 60s
    const SCREENSAVER_TIMEOUT = 60 * 1000;
    const inMenu = !signedIn || menuVisible;
    let targetScreensaverAlpha = (inMenu && (millis() - window.lastInputTime > SCREENSAVER_TIMEOUT)) ? 1.0 : 0.0;
    
    // Force reset if input detected recently (even if fading out)
    if (millis() - window.lastInputTime < 100) targetScreensaverAlpha = 0.0;
    
    screensaverOpacity = lerp(screensaverOpacity, targetScreensaverAlpha, 0.05);
    
    // Determine background color based on cycle time before map draw overrides it
    // If MapDraw.js drawMapBackground is called, it might cover this.
    // If not signed in, we still want to show the day/night cycle if possible.
    
    // Default fallback - ONLY if we don't have mapData OR valid cycle time yet
    // This preserves the orange loading screen until the real environment is ready
    if (!mapData || typeof cycleTime === 'undefined') {
        background(255, 155, 0); 
    }
    // Note: drawMapBackground handles clear() / background() logic usually.

    if (!signedIn) {
        if (connected) {
             // In Game.js, serverSync() handles receive but we don't send updates if not signed in usually
             // But we need to process incoming messages to get the time.
             // We'll rely on onmessage handler in ServerMessaging.js

             // Maintain connection with pings to receive broadcasts (Time/Community status)
             // This ensures cycleTime updates during screensaver or menu
             if (millis() - lastPing > pingUpdateTime) {
                sendPing();
                lastPing = millis();
            }
            
            // Request community update (players online + time of day) for screensaver/menu
            if (typeof requestCommunityUpdate === 'function') {
                 if (millis() - lastCommunityUpdate > 10000) {
                      requestCommunityUpdate();
                      lastCommunityUpdate = millis();
                 }
            }
        }
        
        // Only draw the dynamic background if we have valid map data to know dimensions/context
        // and valid time from server. Otherwise keep the orange solid color.
        if (mapData && typeof cycleTime !== 'undefined') {
             // Swaying Menu Camera Logic
             // Move far to the right (X=6000) to avoid Recovery Zone (X~0)
             // Y constrained between -200 and 200 as requested ("above the ocean")
             const menuCamX = 6000 + Math.sin(millis() / 20000) * 1500; 
             const menuCamY = Math.sin(millis() / 15000) * 200; 

             drawMapBackground(mapData, menuCamX);
             
            // Also draw clouds for ambience
            if (typeof displayClouds === 'function') {
                 displayClouds(menuCamX, menuCamY);
            }
    
            // Render the Map Terrain and Entities if we have data
            if (typeof drawMapTerrain === 'function' && typeof getMapPolygonsMap === 'function') {
                push();
                // Simulate "Height" (Altitude) by zooming out slightly
                // scale(0.65) gives a nice overview without being "Way too high"
                translate(width/2, height/2);
                scale(0.65); 
                translate(-width/2, -height/2);
                
                // Draw Map
                // Must generate polygons first to include Water/Recovery zones
                const mapPolygonsMap = getMapPolygonsMap(mapData);
                
                drawMapTerrain(mapPolygonsMap, menuCamX, menuCamY); 
                
                // Draw Entities relative to this transform
                if (typeof displayEnemies === 'function') displayEnemies(menuCamX, menuCamY);
                // Don't show players in menu to reduce clutter? Or keep them? User said "world with movement sway".
                // Usually keeping them makes the world feel alive.
                if (typeof displayPlayers === 'function') displayPlayers(menuCamX, menuCamY);
                if (typeof displayProjectiles === 'function') displayProjectiles(menuCamX, menuCamY);
                if (typeof displayCrates === 'function') displayCrates(menuCamX, menuCamY);
    
                pop();
            }
        } else {
             // Ensure background stays refreshed if not drawing map
             background(255, 155, 0);
        }

        // Calculate login menu dimensions
        let mw = (typeof isMobile !== 'undefined' && isMobile) ? width * 0.95 : width * 0.45;
        if (!isMobile) mw = Math.max(Math.min(500, width * 0.9), width * 0.45);
        let mh = (typeof isMobile !== 'undefined' && isMobile) ? height * 0.9 : height * 0.8;
        let mx = (width - mw) / 2;
        let my = (height - mh) / 2;
        
        // Screensaver active? Fade menu out
        if (screensaverOpacity < 0.99) {
            push();
            if (typeof drawingContext !== 'undefined') drawingContext.globalAlpha = 1.0 - screensaverOpacity;
            menuManager.draw(mx, my, mw, mh);
            
            // Hide DOM elements (inputs) if the menu is too transparent
            if (screensaverOpacity > 0.1) {
                if (colorPicker) colorPicker.hide();
                if (menuManager.current && menuManager.current.hide) {
                    menuManager.current.hide();
                }
            }
            pop();
        }

        // Draw Screensaver Title & Ensure inputs hidden if screensaver is full
        if (screensaverOpacity >= 0.99) {
             if (colorPicker) colorPicker.hide();
             if (menuManager.current && menuManager.current.hide) {
                 menuManager.current.hide();
             }
        }

        if (screensaverOpacity > 0.01) {
            push();
            if (typeof drawingContext !== 'undefined') drawingContext.globalAlpha = screensaverOpacity;
            textAlign(CENTER, TOP);
            textSize(64);
            fill(255);
            stroke(0);
            strokeWeight(4);
            // Draw mostly at top, slight bob
            text("Sky Pirates", width / 2, 50 + Math.sin(millis()/1000) * 5);
            pop();
        }
        return;
    } else {
        if (colorPicker) colorPicker.hide();
        if (!connected) {
            handleDisconnectPage();
        } else {
            background(255, 155, 0)
            const controlledPlayer = players.find(player => player.username === username);
            
            // Update previous biome for next frame
            if (controlledPlayer) {
                previousBiome = controlledPlayer.biome;
            }

            // Smooth visual interpolation for all players
            players.forEach(p => {
                if (typeof p.displayX === 'undefined') {
                    p.displayX = p.x;
                    p.displayY = p.y;
                }
                // Smoothly interpolate display position towards physics position
                // Use a fixed lerp factor. 0.3 is a good balance between smoothness and responsiveness.
                let smoothFactor = 0.3;
                p.displayX = lerp(p.displayX, p.x, smoothFactor);
                p.displayY = lerp(p.displayY, p.y, smoothFactor);
                
                // Snap if too far (teleport)
                if (dist(p.x, p.y, p.displayX, p.displayY) > 500) {
                    p.displayX = p.x;
                    p.displayY = p.y;
                }
            });
            
            serverSync(controlledPlayer);
            if (clientEstimating) {
                // Use actual frame time for prediction to match real-time speed
                // p5.js deltaTime is in milliseconds, convert to seconds
                // Cap dt to avoid huge jumps if frame drops (e.g. max 100ms)
                const dt = Math.min(deltaTime, 100) / 1000;
                
                estimatePlayerPositions(dt);
                estimateEnemyPositions(dt);
                estimateProjectilePositions(dt);
                estimateCratePositions(dt);

                // Use advanced prediction for controlled player only
                if (controlledPlayer) {
                    advancedPlayerPrediction(controlledPlayer, keys, dt);
                }
            }
            if (mapData) {
                handleGameDisplay(controlledPlayer);
                
                // Update and Draw Mobile Controls
                if (typeof updateMobileControls === 'function') {
                    updateMobileControls();
                }
                if (typeof drawMobileControls === 'function') {
                    drawMobileControls();
                }

                // Draw menu overlay if toggled during gameplay
                if (menuVisible) {
                    let mw = (typeof isMobile !== 'undefined' && isMobile) ? width * 0.95 : width * 0.45;
                    // Ensure menu width fits on smaller screens (scaling down min width)
                    if (!isMobile) mw = Math.max(Math.min(500, width * 0.9), width * 0.45);
                    
                    let mh = (typeof isMobile !== 'undefined' && isMobile) ? height * 0.9 : height * 0.8;
                    let mx = (width - mw) / 2;
                    let my = (height - mh) / 2;
                    
                    if (screensaverOpacity < 0.99) {
                        push();
                        translate(0,0); // Reset transform ensures menu draws on top of everything
                        if (typeof drawingContext !== 'undefined') drawingContext.globalAlpha = 1.0 - screensaverOpacity;
                        menuManager.draw(mx, my, mw, mh);
                        
                        // Hide DOM elements (inputs) if the menu is too transparent
                        if (screensaverOpacity > 0.1) {
                            if (colorPicker) colorPicker.hide();
                            if (menuManager.current && menuManager.current.hide) {
                                menuManager.current.hide();
                            }
                        }
                        pop();
                    } else {
                         // Screensaver active: hide inputs
                         if (colorPicker) colorPicker.hide();
                         if (menuManager.current && menuManager.current.hide) {
                             menuManager.current.hide();
                         }
                    }
                } 
            }
        }
    }
}

// ========================================
// SERVER SYNC AND GAME DISPLAY
// ========================================

function serverSync(player = null) {
    // updateUpdates(); // Removed dynamic update rate to ensure consistent input sampling
    if (millis() - lastPlayerUpdate > playerUpdateTime) {
        sendPlayerData(player);
        // Polling removed in favor of Server Push (gamestate_update)
        /*
        getPlayerData();
        getEnemyData();
        getAnimalData();
        getProjectileData();
        getCrateData();
        getEventData();
        getShopData();
        */
        lastPlayerUpdate = millis();
    }
    if (millis() - lastPing > pingUpdateTime) {
        sendPing();
        lastPing = millis();
    }
    if (!mapData) getMapData();
}

function handleGameDisplay(controlledPlayer) {
    // 1. Calculate Camera Position
    let centerX = 0;
    let centerY = 0;

    if (controlledPlayer && signedIn) {
        // Calculate camera center between player and mouse cursor
        const cameraCenter = getCameraCenter({
            ...controlledPlayer, 
            x: controlledPlayer.displayX, 
            y: controlledPlayer.displayY
        }, mouseX, mouseY);
        centerX = cameraCenter.x;
        centerY = cameraCenter.y;
    } else if (respawnDelay) {
        centerX = deathCameraX;
        centerY = deathCameraY;
    } else {
        // Fallback or Menu Background (Matches main menu settings)
        centerX = Math.sin(millis() / 5000) * 1500;
        centerY = -2000 + Math.cos(millis() / 7000) * 500;
    }

    // 2. Draw Background (Sky + Sun)
    drawMapBackground(mapData, centerX);

    push(); // Start Zoom Layer
    
    let activeZoom = 1.0;
    if (typeof isMobile !== 'undefined' && isMobile) {
        activeZoom = 0.65;
        // Expose active zoom for other systems (e.g. input handling)
        window.currentGameZoom = activeZoom;
        
        translate(windowWidth / 2, windowHeight / 2);
        scale(activeZoom); 
        translate(-windowWidth / 2, -windowHeight / 2);
    } else {
        // Enforce minimum zoom to prevent unfair field of view on large screens
        // Scale must be at least width / MAX_VIEW allowed
        let safeMaxView = (typeof window.MAX_ZOOM_VIEW_WIDTH === 'number') ? window.MAX_ZOOM_VIEW_WIDTH : 2500;
        let minAllowedZoom = (width && safeMaxView) ? (width / safeMaxView) : 0.5;
        
        // Ensure valid numbers
        if (typeof window.cameraZoom !== 'number' || isNaN(window.cameraZoom)) window.cameraZoom = 1.0;
        if (isNaN(minAllowedZoom)) minAllowedZoom = 0.5;

        // Clamp user zoom setting, but ensure we don't lock it if window resizes
        if (window.cameraZoom < minAllowedZoom) window.cameraZoom = minAllowedZoom;
        
        activeZoom = window.cameraZoom;
        
        // Final safety check for rendering
        if (isNaN(activeZoom) || activeZoom <= 0.01) activeZoom = 1.0;
        
        window.currentGameZoom = activeZoom;

        // Expose active zoom for other systems (e.g. input handling)
        window.currentGameZoom = activeZoom;
        // console.log("Zoom updated:", window.currentGameZoom); // Uncomment for spammy debug

        translate(windowWidth / 2, windowHeight / 2);
        scale(activeZoom); 
        translate(-windowWidth / 2, -windowHeight / 2);
    }
    
    // Check if respawn delay has ended
    if (respawnDelay && millis() >= respawnDelayEnd) {
        respawnDelay = false;
        // Only show login menu if player was truly destroyed (signedIn = false)
        // If player was just downed, they'll respawn automatically (signedIn stays true)
        if (!signedIn) {
            if (menuManager && menuManager.screens && menuManager.screens['login']) {
                menuManager.show('login');
                menuManager.screens['login'].loginMsg = "You were destroyed! Please log in again.";
            }
        }
    }
    
    if (controlledPlayer && signedIn) {
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap, centerX, centerY);

        // Draw Water sides first (Background)
        drawMapPolygonsSides(mapPolygonsMap, 'water');

        // Draw background elements (Clouds)
        displayClouds(centerX, centerY);

        // Draw Everything else (Land/Recovery sides)
        drawMapPolygonsSides(mapPolygonsMap, 'other');

        // Draw particles behind all game objects
        updateParticles();
        displayEvents(centerX, centerY);
        drawParticles(centerX, centerY);

        displayCrates(centerX, centerY);
        drawMapPolygonsFronts(mapPolygonsMap, centerX, centerY);
        drawPartyIndicator(controlledPlayer, centerX, centerY);
        displayProjectiles(centerX, centerY);
        drawAnimals(centerX, centerY);
        displayPlayers(centerX, centerY);
        displayEnemies(centerX, centerY);
        drawEnemyTargetIndicators(controlledPlayer, centerX, centerY);
        
        displayHelpPrompt();
        if (helpWindow && !chatting) handleHelpWindow();
    } else if (respawnDelay) {
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap, centerX, centerY);

        // Draw Water sides first (Background)
        drawMapPolygonsSides(mapPolygonsMap, 'water');

        // Draw background elements (Clouds)
        displayClouds(centerX, centerY);

        // Draw Everything else (Land/Recovery sides)
        drawMapPolygonsSides(mapPolygonsMap, 'other');

        // Draw particles behind all game objects
        updateParticles();
        displayEvents(centerX, centerY);
        drawParticles(centerX, centerY);

        displayCrates(centerX, centerY);
        drawMapPolygonsFronts(mapPolygonsMap, centerX, centerY);
        displayProjectiles(centerX, centerY);
        displayPlayers(centerX, centerY);
        displayEnemies(centerX, centerY);
        
        // Show respawn message
        textSize(32);
        fill(255);
        stroke(0);
        strokeWeight(3);
        textAlign(CENTER, CENTER);
        text("Respawning...", windowWidth / 2, windowHeight / 2);
        strokeWeight(1);
    } else {
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap, centerX, centerY);

        // Draw Water sides first (Background)
        drawMapPolygonsSides(mapPolygonsMap, 'water');

        // Draw background elements (Clouds)
        displayClouds(centerX, centerY);

        // Draw Everything else (Land/Recovery sides)
        drawMapPolygonsSides(mapPolygonsMap, 'other');

        // Draw particles behind all game objects
        updateParticles();
        displayEvents(centerX, centerY);
        drawParticles(centerX, centerY);

        displayCrates(centerX, centerY);
        drawMapPolygonsFronts(mapPolygonsMap, centerX, centerY);
        displayProjectiles(centerX, centerY);
        drawAnimals(centerX, centerY);
        displayPlayers(centerX, centerY);
        displayEnemies(centerX, centerY);
    }

    pop(); // End Zoom Layer

    // Draw UI Elements (Unscaled HUD)
    // Only if menu is NOT visible AND screensaver is NOT active
    // Note: If menuVisible is true, HUD is hidden. If screensaver is active (opacity > 0.1), menus fade out but we still hide HUD.
    if (controlledPlayer && signedIn && !menuVisible) {
        // Draw HUD elements here so they aren't scaled by mobile zoom
        if (typeof drawPlaneInfo === 'function') drawPlaneInfo(controlledPlayer);
        if (typeof drawCompass === 'function') drawCompass(controlledPlayer);
        
        // Recovery Zone Buttons
        if (controlledPlayer.biome === 'recovery') {
            if (typeof displayShop === 'function') displayShop(controlledPlayer);
            if (typeof displayTeleportButton === 'function') displayTeleportButton(controlledPlayer);
            if (typeof displaySellAllButton === 'function') displaySellAllButton(controlledPlayer);
        } else {
            // Clear UI regions when leaving recovery zone to prevent ghost clicks
            if (typeof window !== 'undefined') {
                window.sellAllButtonRegion = null;
                window.shopButtonRegion = null;
                window.teleportButtonRegion = null;
                window.shopBounds = null;
                if (window.shopRegions && window.shopRegions.length > 0) window.shopRegions = [];
            }
            // Update local scope variables if they exist
            sellAllButtonRegion = null;
            shopButtonRegion = null;
            teleportButtonRegion = null;
            shopRegions = [];

            // Force close shop and update controls
            if (shopOpen) {
                shopOpen = false;
                if (typeof updateMobileControls === 'function') updateMobileControls();
            }
        }
    }

    // Screensaver Title Overlay (In Game)
    if (screensaverOpacity > 0.01) {
        push();
        if (typeof drawingContext !== 'undefined') drawingContext.globalAlpha = screensaverOpacity;
        textAlign(CENTER, TOP);
        textSize(64);
        fill(255);
        stroke(0);
        strokeWeight(4);
        text("Sky Pirates", width / 2, 50 + Math.sin(millis()/1000) * 5);
        pop();
    }

    displayChat();
    displayNoticeMessages();
    displayAppInfo();
}

function displayHelpPrompt() {
    // Display help menu prompt for first 10 seconds
    if (millis() - signedInTime < 10000 && !helpWindow && !menuVisible) {
        push();
        
        let zoomScale = 1.0;
        if (typeof window.cameraZoom === 'number' && !isNaN(window.cameraZoom)) {
            zoomScale = window.cameraZoom;
        }

        // Scale text size
        textSize(16 * zoomScale);
        textAlign(CENTER, CENTER);
        fill(255);
        stroke(0);
        
        // Scale position relative to screen center
        // Target is normally 20% down from top
        let targetY = windowHeight * 0.2;
        let centerY = windowHeight / 2;
        let finalY = centerY + (targetY - centerY) * zoomScale;
        
        text("Early Access", windowWidth / 2, finalY);
        pop();
    }
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

function handleShopToggleRequest() {
    const controlledPlayer = players.find(player => player.username === username);
    if (!controlledPlayer || controlledPlayer.biome !== 'recovery') {
        return; 
    }
    shopOpen = !shopOpen;
    console.log(`Shop ${shopOpen ? 'opened' : 'closed'}`);
}

function handleTeleportButtonClick(mouseX, mouseY) {
    if (!teleportButtonRegion) return false;

    // Use tighter padding for mobile (0) to ensure precise clicks
    const padding = (typeof isMobile !== 'undefined' && isMobile) ? 0 : 0;

    const isInside = mouseX >= teleportButtonRegion.x - teleportButtonRegion.width / 2 - padding &&
        mouseX <= teleportButtonRegion.x + teleportButtonRegion.width / 2 + padding &&
        mouseY >= teleportButtonRegion.y - teleportButtonRegion.height / 2 - padding &&
        mouseY <= teleportButtonRegion.y + teleportButtonRegion.height / 2 + padding;

    if (isInside) {
        // Debounce to prevent double-firing
        if (typeof lastTeleportClickTime === 'undefined') window.lastTeleportClickTime = 0;
        if (millis() - window.lastTeleportClickTime < 500) return true;
        window.lastTeleportClickTime = millis();

        handleTeleportRequest();
        return true; // Button was clicked
    }

    return false; // Button was not clicked
}

function handleShopButtonClick(mouseX, mouseY) {
    if (!shopButtonRegion) return false;

    // Use tighter padding for mobile (0) to ensure precise clicks
    const padding = (typeof isMobile !== 'undefined' && isMobile) ? 0 : 0;

    const isInside = mouseX >= shopButtonRegion.x - shopButtonRegion.width / 2 - padding &&
        mouseX <= shopButtonRegion.x + shopButtonRegion.width / 2 + padding &&
        mouseY >= shopButtonRegion.y - shopButtonRegion.height / 2 - padding &&
        mouseY <= shopButtonRegion.y + shopButtonRegion.height / 2 + padding;

    if (isInside) {
        // Debounce to prevent double-toggling (open -> close -> open)
        if (typeof lastShopClickTime === 'undefined') window.lastShopClickTime = 0;
        if (millis() - window.lastShopClickTime < 500) return true;
        window.lastShopClickTime = millis();

        shopOpen = !shopOpen; // Toggle shop state
        console.log(`Shop ${shopOpen ? 'opened' : 'closed'}`);
        return true; // Button was clicked
    }

    return false; // Button was not clicked
}

function handleSellAllButtonClick(mouseX, mouseY) {
    if (!sellAllButtonRegion) return false;

    // Use tighter hit detection for mobile since button is large enough
    const padding = (typeof isMobile !== 'undefined' && isMobile) ? 0 : 0;

    const isInside = mouseX >= sellAllButtonRegion.x - sellAllButtonRegion.width / 2 - padding &&
        mouseX <= sellAllButtonRegion.x + sellAllButtonRegion.width / 2 + padding &&
        mouseY >= sellAllButtonRegion.y - sellAllButtonRegion.height / 2 - padding &&
        mouseY <= sellAllButtonRegion.y + sellAllButtonRegion.height / 2 + padding;

    if (isInside) {
        // Debounce
        if (typeof lastSellClickTime === 'undefined') window.lastSellClickTime = 0;
        if (millis() - window.lastSellClickTime < 500) return true;
        window.lastSellClickTime = millis();

        sendSellAllMessage();
        console.log('Sell All button clicked');
        return true; // Button was clicked
    }

    return false; // Button was not clicked
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

function sendSellAllMessage() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'sell_all'
        };
        ws.send(msgpack.encode(message));
    }
}

function sendSellItemMessage(itemIndex) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'sell_item',
            itemIndex: itemIndex
        };
        ws.send(msgpack.encode(message));
    }
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
        
        // Add noticeable bobbing effect when floating in water
        if (player.biome === 'water') {
            const bobIntensity = 6.0; // Stronger, more noticeable bob
            const bobSpeed = 0.6; // Slow, wave-like motion
            
            // Primary wave motion (vertical)
            const primaryBobY = Math.sin(time * bobSpeed) * bobIntensity;
            
            // Secondary wave (slightly offset for more natural feel) - increased strength
            const secondaryBobY = Math.sin(time * bobSpeed * 1.4 + 0.5) * bobIntensity * 0.6;
            
            // Horizontal sway
            const targetBobX = Math.sin(time * bobSpeed * 0.7) * bobIntensity * 0.4;
            const targetBobY = primaryBobY + secondaryBobY;
            
            // Smooth interpolation to prevent snapping
            const smoothFactor = 0.1;
            currentBobX += (targetBobX - currentBobX) * smoothFactor;
            currentBobY += (targetBobY - currentBobY) * smoothFactor;
            
            camX += currentBobX;
            camY += currentBobY;
        } else {
            // When not in water, smoothly fade out the bobbing
            const smoothFactor = 0.15;
            currentBobX *= (1 - smoothFactor);
            currentBobY *= (1 - smoothFactor);
            
            camX += currentBobX;
            camY += currentBobY;
        }
    }
    
    // Update global camera variables for aiming logic
    globalCameraX = camX;
    globalCameraY = camY;

    // Interpolate between player position and mouse position
    return {
        x: camX,
        y: camY
    };
}

let testing = false;


function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    // Force immediate redraw to prevent flickering or gray bars
    // Just clearing might be enough if draw loop picks it up, but setting bg is safer
    // Using resizeCanvas is generally preferred over createCanvas for existing canvas

    // Add a delayed resize for Mobile orientation changes which often animate
    // and report incorrect sizes explicitly at the start of the event
    setTimeout(() => {
        resizeCanvas(windowWidth, windowHeight);
    }, 1000);
}
