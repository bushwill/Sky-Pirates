class MenuManager {
    constructor(colorPicker) {
        this.screens = {};
        this.current = null;
        this.colorPicker = colorPicker;
    }

    addScreen(name, screen) {
        this.screens[name] = screen;
    }

    show(name) {
        this.current = this.screens[name];
        // Only show the color picker on the login screen when the user is NOT already signed in
        if (name === 'login' && this.colorPicker && !signedIn) {
            this.colorPicker.show();
        } else if (this.colorPicker) {
            this.colorPicker.hide();
        }
    }

    draw(x, y, w, h) {
        if (this.current) this.current.draw(x, y, w, h);
    }

    navigate(dir) {
        if (this.current) this.current.navigate(dir);
    }

    choose() {
        if (this.current) this.current.choose();
    }
}

class MenuScreen {
    constructor(title, options = []) {
        this.title = title;
        this.options = options;
        this.selected = 0;
    }

    addOption(label, callback) {
        this.options.push(new MenuOption(label, callback));
    }

    draw(x, y, w, h, spacing = 50) {
        textAlign(CENTER, CENTER);
        textSize(32);
        fill(255);
        text(this.title, x + w / 2, y + spacing / 2);

        for (let i = 0; i < this.options.length; i++) {
            if (i === this.selected) fill(0, 200, 255);
            else fill(255);
            rect(x, y + spacing * (i + 1), w, spacing - 10, 10);
            fill(0);
            text(this.options[i].label, x + w / 2, y + spacing * (i + 1) + (spacing - 10) / 2);
        }
    }

    navigate(dir) {
        this.selected = (this.selected + dir + this.options.length) % this.options.length;
    }

    choose() {
        this.options[this.selected].callback();
    }
}

class MenuOption {
    /**
     * @param {string} label - Display label for the menu option
     * @param {Function} callback - Function to call when chosen
     * @param {number} x - X position (left of option)
     * @param {number} y - Y position (top of option)
     * @param {number} w - Width of option
     * @param {number} h - Height of option
     */
    constructor(label, callback, x = 0, y = 0, w = 160, h = 40) {
        this.label = label;
        this.callback = callback;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.selected = false;
    }

    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    setSize(w, h) {
        this.w = w;
        this.h = h;
    }

    draw() {
        // Draw background
        fill(this.selected ? [0, 200, 255] : 255);
        stroke(0);
        rect(this.x, this.y, this.w, this.h, 10);

        // Draw label
        noStroke();
        fill(0);
        textAlign(CENTER, CENTER);
        textSize(18);
        text(this.label, this.x + this.w / 2, this.y + this.h / 2);
    }

    mousePressed(mx, my) {
        return mx > this.x && mx < this.x + this.w &&
            my > this.y && my < this.y + this.h;
    }
}

class WeaponMenuOption extends MenuOption {
    /**
     * @param {string} weaponName - Name of the weapon (used for icon and label)
     * @param {Function} callback - Function to call when chosen
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} w - Width
     * @param {number} h - Height
     */
    constructor(weaponName, callback, x = 0, y = 0, w = 160, h = 40) {
        super(weaponName, callback, x, y, w, h);
        this.weaponName = weaponName;
    }

    draw() {
        // Draw the base option background with different colors for different selection states
        let bgColor;
        if (this.selected === true) {
            // Navigation highlight (light blue)
            bgColor = [100, 180, 255];
        } else if (this.selected === "weapon") {
            // Weapon selection highlight (darker blue/green)
            bgColor = [0, 150, 100];
        } else {
            // Not selected
            bgColor = 255;
        }
        
        fill(bgColor);
        stroke(0);
        rect(this.x, this.y, this.w, this.h, 10);

        // Draw weapon icon to the left inside the option
        let iconSize = Math.min(this.h - 8, 32);
        let iconX = this.x + 8 + iconSize / 2;
        let iconY = this.y + this.h / 2;
        drawWeaponItem(this.weaponName, iconX, iconY, iconSize);

        // Draw label next to icon
        noStroke();
        fill(0);
        textAlign(LEFT, CENTER);
        textSize(14);
        text(this.label, this.x + 16 + iconSize, this.y + this.h / 2);
    }
}

class MenuInputField {
    constructor(label, x, y, w, h, isPassword = false) {
        this.label = label;
        this.value = '';
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.focused = false;
        this.isPassword = isPassword;
    }

    draw() {
        fill(this.focused ? 255 : 230);
        stroke(this.focused ? 0 : 150);
        rect(this.x, this.y, this.w, this.h, 6);
        fill(80);
        textAlign(LEFT, CENTER);
        textSize(16);
        if (this.value === '') text(this.label, this.x + 8, this.y + this.h / 2);
        fill(0);
        let displayVal = this.isPassword ? '*'.repeat(this.value.length) : this.value;
        text(displayVal, this.x + 8, this.y + this.h / 2);
    }

    mousePressed(mx, my) {
        this.focused = mx > this.x && mx < this.x + this.w && my > this.y && my < this.y + this.h;
        return this.focused;
    }

    keyPressed(k) {
        if (!this.focused) return false;
        // If a DOM key string was passed (from our handleKeyDown), handle it here
        if (typeof k === 'string') {
            // Backspace handling
            if (k === 'Backspace') {
                this.value = this.value.slice(0, -1);
                return true;
            }
            // Printable single-character keys: append
            if (k.length === 1 && this.value.length < 13) {
                this.value += k;
                return true;
            }
            // Ignore other keys here
            return false;
        }

        // Fallback: legacy p5 keyCode handling
        if (typeof keyCode !== 'undefined' && keyCode === BACKSPACE) {
            this.value = this.value.slice(0, -1);
            return true;
        }
        return false;
    }
    keyTyped(k) {
        if (!this.focused) return false;
        if (typeof k === 'string' && k.length === 1 && this.value.length < 13) {
            this.value += k;
            return true;
        }
        return false;
    }
}

class LoginMenuScreen extends MenuScreen {
    constructor(colorPicker) {
        super("Login");
        // Customizable headers for login vs pause (signed-in) views
        this.loginHeader = "What be yar bird's nomenclature, matey?";
        this.loginSubheader = "[Translated] What's your plane's name?";
        this.pauseHeader = "";
        this.pauseSubheader = "There's no greater love in a sailor's heart than his vessel.";
        this.usernameField = new MenuInputField("Name:", 150, 220, 240, 40);
        this.colorPicker = colorPicker;
        this.loginMsg = '';
        this.color = '#ff8800';

        // Load saved preferences from cookies
        this.loadSavedPreferences();

        // Login button option (drawn separately, not in .options array)
        this.loginButton = new MenuOption("Log In", () => this.tryLogin());
        
        // Settings button
        this.settingsButton = new MenuOption("Settings", () => menuManager.show('settings'));
        
        // Party name input field
        this.partyField = new MenuInputField("Party (optional):", 150, 270, 240, 40);

        // Simple string list of weapon names (shared for both guns)
        this.weaponNames = [
            "Machine Gun",
            "Cannon",
            "Scorpion"
        ];

        // Generate WeaponMenuOptions for both gun1 and gun2 using the weaponNames list
        this.gun1Options = this.weaponNames.map(
            (name, i) => new WeaponMenuOption(name, () => this.selectGun1(i), 0, 0, 180, 44)
        );
        this.gun2Options = this.weaponNames.map(
            (name, i) => new WeaponMenuOption(name, () => this.selectGun2(i), 0, 0, 180, 44)
        );
        // selected: -1 for login button, 0-weaponNames.length-1 for gun1Options, weaponNames.length... for gun2Options
        this.selected = 0;

        if (this.colorPicker) {
            this.colorPicker.value(this.color);
            this.colorPicker.input(() => {
                this.color = this.colorPicker.value();
            });
        }
        
        // Load saved preferences from cookies (after all fields are created)
        this.loadSavedPreferences();
    }

    draw(x, y, w, h) {
        rectMode(CORNER);
        fill(255, 255, 255, 200);
        noStroke();
        rect(x, y, w, h, 30);

        fill(0);
        textSize(40);

        // Only position/show color picker when not already signed in
        if (!signedIn && this.colorPicker) {
            this.colorPicker.position(x + w / 2 + 120, y + 183);
        }

        textAlign(CENTER, CENTER);
        if (window.WS_ADDRESS === 'ws://localhost:3001') {
            text("SKY PIRATES (test environment)", x + w / 2, y + 50);
        } else {
            text("SKY PIRATES", x + w / 2, y + 50);
        }
        textSize(20);
        // Show different header/subheader depending on whether this is the pre-login screen or the in-game pause menu
        if (signedIn) {
            text(this.pauseHeader, x + w / 2, y + 100);
            text(this.pauseSubheader, x + w / 2, y + 140);
        } else {
            text(this.loginHeader, x + w / 2, y + 100);
            text(this.loginSubheader, x + w / 2, y + 140);
        }

        // Draw input field centered horizontally
        this.usernameField.x = x + w / 2 - 120;
        this.usernameField.y = y + 170;
        // If already signed in, display username read-only; otherwise draw editable field
        if (signedIn) {
            fill(50);
            textAlign(LEFT, CENTER);
            textSize(18);
            const displayName = username || this.usernameField.value || '(unknown)';
            text(displayName, this.usernameField.x + 8, this.usernameField.y + this.usernameField.h / 2);
        } else {
            this.usernameField.draw();
        }
        
        // Draw party field below username
        this.partyField.x = x + w / 2 - 120;
        this.partyField.y = y + 220;
        this.partyField.draw();

        // --- Draw login button to the right of party field ---
        let loginBtnX = x + w / 2 + 120 + 10; // Right of party field with 10px spacing
        let loginBtnY = y + 220; // Same Y as party field
    this.loginButton.setPosition(loginBtnX, loginBtnY);
    this.loginButton.setSize(120, 40);
    // Change label when signed in: allow changing party mid-match
    if (signedIn) {
        this.loginButton.label = "Change Party";
    } else {
        this.loginButton.label = this.hasSavedState ? "Resume" : "Log In";
    }
    this.loginButton.selected = (this.selected === -1);
    this.loginButton.draw();
        
        // --- Draw settings button in top-right corner ---
        let settingsBtnX = x + w - 130; // 130px from right edge
        let settingsBtnY = y + 20; // 20px from top
        this.settingsButton.setPosition(settingsBtnX, settingsBtnY);
        this.settingsButton.setSize(110, 40);
        this.settingsButton.selected = false; // Not part of navigation
        this.settingsButton.draw();

        // Error message - positioned where login button used to be
        if (this.loginMsg) {
            textAlign(CENTER, CENTER);
            fill(0); 
            textSize(16);
            text(this.loginMsg, x + w / 2, y + 280); // Where login button used to be (y + 270 + 10 for spacing)
        }

        // --- Draw weapon lists ---
        // If the player is already signed in or resuming, hide weapon selection (can't change weapons)
        if (!signedIn && !this.hasSavedState) {
            let listSpacing = 54;
            let listYOffset = y + 360; // Position well below error message area
            let gunListW = 180, gunListH = 44;
            let gunListPad = 40;

            // Gun1 list (left)
            let gun1X = x + w / 2 - gunListW - gunListPad;
            let gun1Y = listYOffset;
            textSize(22);
            fill(0);
            textAlign(CENTER, CENTER);
            text("Gun 1", gun1X + gunListW / 2, gun1Y - 34);
            for (let i = 0; i < this.gun1Options.length; i++) {
                let opt = this.gun1Options[i];
                opt.setPosition(gun1X, gun1Y + i * listSpacing);
                opt.setSize(gunListW, gunListH);
                
                // Simplified logic: ONLY show weapon selection highlight
                // Navigation highlight is disabled to prevent conflicts
                if (selectedGun1 === i) {
                    opt.selected = "weapon";
                } else {
                    opt.selected = false;
                }
                opt.draw();
            }

            // Gun2 list (right)
            let gun2X = x + w / 2 + gunListPad;
            let gun2Y = listYOffset;
            textSize(22);
            fill(0);
            textAlign(CENTER, CENTER);
            text("Gun 2", gun2X + gunListW / 2, gun2Y - 34);
            for (let i = 0; i < this.gun2Options.length; i++) {
                let opt = this.gun2Options[i];
                opt.setPosition(gun2X, gun2Y + i * listSpacing);
                opt.setSize(gunListW, gunListH);
                
                // Same simplified logic for gun2
                if (selectedGun2 === i) {
                    opt.selected = "weapon";
                } else {
                    opt.selected = false;
                }
                opt.draw();
            }
        }
    }

    navigate(dir) {
        // selected: -1 for login button, 0-gun1Options.length-1 for gun1Options, gun1Options.length... for gun2Options
        let total = this.gun1Options.length + this.gun2Options.length + 1;
        this.selected = (this.selected + dir + total) % total;
    }

    choose() {
        if (this.selected === -1) {
            this.loginButton.callback();
        } else if (this.selected >= 0 && this.selected < this.gun1Options.length) {
            // Select weapon for gun1
            this.selectGun1(this.selected);
        } else if (
            this.selected >= this.gun1Options.length &&
            this.selected < this.gun1Options.length + this.gun2Options.length
        ) {
            let idx = this.selected - this.gun1Options.length;
            this.selectGun2(idx);
        }
    }

    selectGun1(idx) {
        selectedGun1 = idx;
    }

    selectGun2(idx) {
        selectedGun2 = idx;
    }

    mousePressed(mx, my, x, y, w, h) {
    // Only allow focusing the username field when not signed in
    if (!signedIn) this.usernameField.mousePressed(mx, my);
        this.partyField.mousePressed(mx, my);
        
        // Settings button - in top-right corner
        let settingsBtnX = x + w - 130;
        let settingsBtnY = y + 20;
        if (mx > settingsBtnX && mx < settingsBtnX + 110 && my > settingsBtnY && my < settingsBtnY + 40) {
            this.settingsButton.callback();
            return;
        }

        // Login button - updated to match new position (right of party field)
        let loginBtnX = x + w / 2 + 120 + 10;
        let loginBtnY = y + 220;
        if (mx > loginBtnX && mx < loginBtnX + 120 && my > loginBtnY && my < loginBtnY + 40) {
            this.selected = -1;
            // If signed in, change party action should only update party
            if (signedIn) {
                this.changeParty();
            } else {
                this.loginButton.callback();
            }
            return;
        }

        // Gun1 options
        for (let i = 0; i < this.gun1Options.length; i++) {
            let opt = this.gun1Options[i];
            if (opt.mousePressed(mx, my)) {
                this.selected = i;
                this.selectGun1(i);
                return;
            }
        }

        // Gun2 options
        for (let i = 0; i < this.gun2Options.length; i++) {
            let opt = this.gun2Options[i];
            if (opt.mousePressed(mx, my)) {
                this.selected = i + this.gun1Options.length;
                this.selectGun2(i);
                return;
            }
        }
    }

    keyPressed(k) {
        if (k === 'Enter') this.tryLogin();
        if (this.usernameField.focused) {
            this.usernameField.keyPressed(k);
            return;
        }
        if (this.partyField.focused) {
            this.partyField.keyPressed(k);
            return;
        }
        if (k === 'ArrowUp') this.navigate(-1);
        if (k === 'ArrowDown') this.navigate(1);
    }
    keyTyped(k) {
        if (this.usernameField.focused) {
            this.usernameField.keyTyped(k);
            return;
        }
        if (this.partyField.focused) {
            this.partyField.keyTyped(k);
            return;
        }
    }

    loadSavedPreferences() {
        // Load preferences using the global function (if available)
        if (typeof loadUserPreferences === 'function') {
            const prefs = loadUserPreferences();
            
            // Check for saved state via player ID cookie
            this.hasSavedState = typeof getCookie === 'function' && !!getCookie('skyPiratesPlayerId');

            if (prefs.name) {
                this.usernameField.value = prefs.name;
            }
            if (prefs.color) {
                this.color = prefs.color;
                // Update the color picker if it exists
                if (this.colorPicker) {
                    this.colorPicker.value(prefs.color);
                }
            }
            if (prefs.party && this.partyField) {
                this.partyField.value = prefs.party;
            }
            // Set global weapon selections
            selectedGun1 = prefs.gun1;
            selectedGun2 = prefs.gun2;
            
            // Update navigation position to match the primary weapon selection
            // This prevents the double-highlight issue
            this.selected = selectedGun1;
        }
    }

    tryLogin() {
        const name = this.usernameField.value.trim();
        if (!name) {
            this.loginMsg = "Enter a username!";
            return;
        }
        username = name;
        let c = this.colorPicker ? this.colorPicker.value() : this.color;
        [r, g, b] = [red(c), green(c), blue(c)];
        // Get party name from party field
        let partyName = (this.partyField && this.partyField.value) ? this.partyField.value.trim() : "";
        // Use weaponNames to get the selected names for login
        loginPlayer(username, {
            r, g, b
        }, {
            gun1: selectedGun1,
            gun2: selectedGun2
        }, partyName);
        this.loginMsg = "Logging in...";
    }

    // Change party while already signed in
    changeParty() {
        if (!signedIn) return;
        let partyName = (this.partyField && this.partyField.value) ? this.partyField.value.trim() : "";
        // If partyName is empty, treat as an explicit clear request and send clearParty flag
        if (!partyName) {
            // Send login message with clearParty=true to instruct server to leave current party
            loginPlayer(username, { r, g, b }, { gun1: selectedGun1, gun2: selectedGun2 }, "", true);
            this.loginMsg = 'Removing from party...';
            setTimeout(() => {
                this.loginMsg = '';
                if (typeof menuVisible !== 'undefined') menuVisible = false;
            }, 1500);
            return;
        }

        // Re-use loginPlayer to update the party on the server side; preserve existing username and color
        loginPlayer(username, { r, g, b }, { gun1: selectedGun1, gun2: selectedGun2 }, partyName, false);
        this.loginMsg = "Updating party...";
    }
}

class SettingsMenuScreen extends MenuScreen {
    constructor() {
        super("Settings");
        
        // Camera toggle option
        this.cameraToggle = new MenuOption(
            settings.dynamicCamera ? "Camera: Dynamic" : "Camera: Fixed",
            () => this.toggleCamera()
        );
        
        // Screen shake toggle option
        this.shakeToggle = new MenuOption(
            settings.screenShake ? "Screen Shake: On" : "Screen Shake: Off",
            () => this.toggleShake()
        );
        
        // Reset progress button
        this.resetProgressButton = new MenuOption("Reset Progress", () => this.resetProgress());
        
        // Back button
        this.backButton = new MenuOption("Back", () => menuManager.show('login'));
        
        this.selected = 0;
    }

    toggleCamera() {
        settings.dynamicCamera = !settings.dynamicCamera;
        this.cameraToggle.label = settings.dynamicCamera ? "Camera: Dynamic" : "Camera: Fixed";
        
        // Save settings to cookies
        if (typeof saveSettings === 'function') {
            saveSettings(settings);
        }
    }

    toggleShake() {
        settings.screenShake = !settings.screenShake;
        this.shakeToggle.label = settings.screenShake ? "Screen Shake: On" : "Screen Shake: Off";
        
        // Save settings to cookies
        if (typeof saveSettings === 'function') {
            saveSettings(settings);
        }
    }

    resetProgress() {
        // This should only be called when not signed in
        if (confirm("Are you sure you want to reset your progress? This will delete your saved game state and you'll start fresh.")) {
            // Delete the player ID cookie
            document.cookie = 'skyPiratesPlayerId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict';
            
            // Update login screen state if it exists
            if (typeof menuManager !== 'undefined' && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].loadSavedPreferences();
            }
            
            alert("Progress reset! You'll start a new game on your next login.");
        }
    }

    draw(x, y, w, h) {
        rectMode(CORNER);
        fill(255, 255, 255, 200);
        noStroke();
        rect(x, y, w, h, 30);

        fill(0);
        textSize(40);
        textAlign(CENTER, CENTER);
        text("Settings", x + w / 2, y + 80);

        // Draw camera toggle
        let optionY = y + 160;
        let optionSpacing = 100;
        
        this.cameraToggle.setPosition(x + w / 2 - 150, optionY);
        this.cameraToggle.setSize(300, 50);
        this.cameraToggle.selected = (this.selected === 0);
        this.cameraToggle.draw();
        
        // Draw camera description
        textSize(14);
        fill(100);
        textAlign(CENTER, TOP);
        text("Dynamic: Camera follows your mouse cursor", x + w / 2, optionY + 60);
        text("Fixed: Camera stays centered on your plane", x + w / 2, optionY + 80);

        // Draw screen shake toggle
        optionY += optionSpacing;
        this.shakeToggle.setPosition(x + w / 2 - 150, optionY);
        this.shakeToggle.setSize(300, 50);
        this.shakeToggle.selected = (this.selected === 1);
        this.shakeToggle.draw();
        
        // Draw shake description
        textSize(14);
        fill(100);
        textAlign(CENTER, TOP);
        text("Adds subtle camera sway based on speed", x + w / 2, optionY + 60);

        // Only show reset progress button when not signed in
        let resetButtonIndex = 2;
        let backButtonIndex = 3;
        if (!signedIn) {
            // Draw reset progress button
            optionY += optionSpacing;
            this.resetProgressButton.setPosition(x + w / 2 - 150, optionY);
            this.resetProgressButton.setSize(300, 50);
            this.resetProgressButton.selected = (this.selected === 2);
            this.resetProgressButton.draw();
            
            // Draw reset description
            textSize(14);
            fill(100);
            textAlign(CENTER, TOP);
            text("Delete saved game and start fresh", x + w / 2, optionY + 60);
        } else {
            // If signed in, skip the reset button
            backButtonIndex = 2;
        }

        // Draw back button
        optionY += optionSpacing;
        this.backButton.setPosition(x + w / 2 - 100, optionY);
        this.backButton.setSize(200, 50);
        this.backButton.selected = (this.selected === backButtonIndex);
        this.backButton.draw();
    }

    navigate(dir) {
        // Determine max options based on signedIn state
        const maxOptions = signedIn ? 3 : 4; // Camera, Shake, [Reset if !signedIn], Back
        this.selected = (this.selected + dir + maxOptions) % maxOptions;
    }

    choose() {
        if (this.selected === 0) {
            this.cameraToggle.callback();
        } else if (this.selected === 1) {
            this.shakeToggle.callback();
        } else if (this.selected === 2) {
            if (!signedIn) {
                this.resetProgressButton.callback();
            } else {
                this.backButton.callback();
            }
        } else if (this.selected === 3) {
            this.backButton.callback();
        }
    }

    mousePressed(mx, my, x, y, w, h) {
        if (this.cameraToggle.mousePressed(mx, my)) {
            this.selected = 0;
            this.cameraToggle.callback();
            return;
        }
        
        if (this.shakeToggle.mousePressed(mx, my)) {
            this.selected = 1;
            this.shakeToggle.callback();
            return;
        }
        
        // Only handle reset button click if not signed in
        if (!signedIn && this.resetProgressButton.mousePressed(mx, my)) {
            this.selected = 2;
            this.resetProgressButton.callback();
            return;
        }
        
        if (this.backButton.mousePressed(mx, my)) {
            this.selected = signedIn ? 2 : 3;
            this.backButton.callback();
            return;
        }
    }

    keyPressed(k) {
        if (k === 'ArrowUp') this.navigate(-1);
        if (k === 'ArrowDown') this.navigate(1);
        if (k === 'Enter') this.choose();
        if (k === 'Escape') this.backButton.callback();
    }

    keyTyped(k) {
        // No text input in settings
    }
}