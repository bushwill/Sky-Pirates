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

let players = [];
let projectiles = [];
let crates = [];

// Global array to store clickable regions for inventory items.
// Each element will be an object: { item, x, y, size }
let inventoryRegions = [];

let chat_messages = [];
let notice_messages = [];

let username;
let r, g, b;
let usedKeys = ['w', 'a', 's', 'd', 'c', 'r', 'mouse'];
let keys = { w: false, a: false, s: false, d: false, c: false, r: false, mouse: false };
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

// --- Menu and color picker setup ---
let menuManager;
let colorPicker;

function setup() {
    createCanvas(windowWidth, windowHeight);
    connectWebSocket();
    rectMode(CENTER);
    stroke(0);
    textAlign(CENTER);
    background(255, 155, 0);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    colorPicker = createColorPicker('#ff8800');
    // Set to initial position, will be updated each frame in draw()
    colorPicker.hide();

    menuManager = new MenuManager(colorPicker);

    // Add screens
    menuManager.addScreen('login', new LoginMenuScreen(colorPicker));
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
            serverSync(controlledPlayer);
            if (clientEstimating) {
                estimatePlayerPositions();
                estimateProjectilePositions();
                estimateCratePositions();
            }
            if (mapData) {
                handleGameDisplay(controlledPlayer);
            }
        }
    }
}

function serverSync(player = null) {
    updateUpdates();
    if (millis() - lastPlayerUpdate > playerUpdateTime) {
        sendPlayerData(player);
        getPlayerData();
        getProjectileData();
        getCrateData();
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
        if (millis() - signedInTime < 10000 && !helpWindow) {
            textSize(16);
            text("Early Access", windowWidth / 2, windowHeight * 0.2);
            textSize(12);
        }
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap, controlledPlayer.x, controlledPlayer.y);
        drawMapPolygonsSides(mapPolygonsMap, controlledPlayer.x, controlledPlayer.y);
        displayCrates(controlledPlayer.x, controlledPlayer.y);
        drawMapPolygonsFronts(mapPolygonsMap, controlledPlayer.x, controlledPlayer.y);
        drawPartyIndicator(controlledPlayer, controlledPlayer.x, controlledPlayer.y);
        displayProjectiles(controlledPlayer.x, controlledPlayer.y);
        displayPlayers(controlledPlayer.x, controlledPlayer.y);
        if (helpWindow && !chatting) handleHelpWindow();
    } else {
        const mapPolygonsMap = getMapPolygonsMap(mapData);
        preparePolygonsForDrawing(mapPolygonsMap);
        drawMapPolygonsSides(mapPolygonsMap);
        displayCrates();
        drawMapPolygonsFronts(mapPolygonsMap);
        displayProjectiles();
        displayPlayers();
    }
    displayChat();
    displayNoticeMessages();
    displayAppInfo();
}

function estimatePlayerPositions() {
    let deltaTime = 0.01;
    players.forEach(player => {
        player.x += player.vx * deltaTime;
        player.y += player.vy * deltaTime;
    });
}

function estimateProjectilePositions() {
    let deltaTime = 0.01;
    projectiles.forEach(projectile => {
        projectile.x += projectile.vx * deltaTime;
        projectile.y += projectile.vy * deltaTime;
    });
}

function estimateCratePositions() {
    let deltaTime = 0.01;
    crates.forEach(crate => {
        crate.x += crate.vx * deltaTime;
        crate.y += crate.vy * deltaTime;
    });
}

function handleDisconnectPage() {
    background(100);
    fill(255, 255, 255);
    textSize(32);
    text("Trying to connect...", windowWidth * 0.5, windowHeight * 0.2);
    if (!reconnecting) {
        reconnecting = true;
        setTimeout(() => {
            connectWebSocket();
            reconnecting = false;
        }, 1000);
    }
}

// --- Remove all legacy login UI code below this line ---
// function handleLoginPage() { ... }
// function initLoginUI() { ... }

// --- Utility ---
function hasNonWhitespace(str) {
    return str.trim().length > 0;
}

let testing = false;
