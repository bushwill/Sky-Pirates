const PAUSE_JOKES = {
    "What did the crew see when they looked in the toilet?": "The Captain's log.",
    "What does the pirate say when he turns 80?": "Aye matey!",
    "Why did the pirate have a paper towel roll on his head?": "He had a Bounty on him.",
    "What is a pirate's favourite drink?": "Boo-tea.",
    "Why do pirates carry swords?": "Because swords can't walk.",
    "What do you call a pirate that pees on people?": "Arr Kelly.",
    "How do you turn a pirate furious?": "Remove the p.",
    "What do you call a pirate with two eyes, two hands and two legs?": "A beginner.",
    "What has 8 legs, 8 arms, and 8 eyes?": "8 pirates.",
};

class MenuManager {
    constructor(colorPicker) {
        this.screens = {};
        this.current = null;
        this.colorPicker = colorPicker;
        this.closeButtonRegion = null;
    }

    addScreen(name, screen) {
        this.screens[name] = screen;
    }

    show(name) {
        if (this.current && this.current.hide) {
            this.current.hide();
        }
        this.current = this.screens[name];
        // Only show the color picker on the login screen when the user is NOT already signed in
        if (name === 'login' && this.colorPicker && !signedIn) {
            this.colorPicker.show();
        } else if (this.colorPicker) {
            this.colorPicker.hide();
        }
        if (this.current && this.current.show) {
            this.current.show();
        }
    }

    draw(x, y, w, h) {
        // Periodically request community data if in menu
        if (typeof millis === 'function' && typeof requestCommunityUpdate === 'function') {
            if (!this.lastCommunityUpdate) this.lastCommunityUpdate = 0;
            // Update every 10 seconds
            if (millis() - this.lastCommunityUpdate > 10000) {
                 this.lastCommunityUpdate = millis();
                 requestCommunityUpdate();
            }
        }

        if (this.current) {
            this.current.draw(x, y, w, h);
            
            // Draw Close Button logic for Pause Menu (when signed in and menu is actually toggle-able)
            if (signedIn) {
                const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
                const closeSize = 30 * s;
                const closeX = x + (15 * s);
                const closeY = y + (10 * s); 
                
                // Draw X
                push();
                stroke(0);
                strokeWeight(3);
                line(closeX, closeY, closeX + closeSize, closeY + closeSize);
                line(closeX + closeSize, closeY, closeX, closeY + closeSize);
                pop();
                
                // Store region for touch/mouse handling
                this.closeButtonRegion = { x: closeX, y: closeY, w: closeSize, h: closeSize };
            } else {
                this.closeButtonRegion = null;
            }
        }
    }
    
    mousePressed(mx, my, x, y, w, h) {
        // Handle "Outside Tap" logic for achievement dismissal
        if (this.current && this.current.selectedAchievement) {
            // Check if tap is outside the menu bounds OR just handled generally
            // If the user taps exactly on the close button, that should take precedence.
            // But if they tap effectively "space" around the menu...
            
            // Actually, we modified LoginMenuScreen.mousePressed to handle "outside menu" taps.
            // But Controls.js only calls menuManager.mousePressed. 
            // If menuManager.mousePressed returns false, Controls.js treats it as unhandled? 
            // If menu is visible, specific logic in mousePressed (Controls.js):
            /*
            if (menuVisible && menuManager) {
                // ... calc bounds ...
                if (menuManager.mousePressed(mouseX, mouseY, mx, my, mw, mh)) {
                    return; 
                }
                return; // Consumed by menu overlay
            }
            */
           // So if we return false, it is just consumed.
           // We need to ensure LoginMenuScreen.mousePressed actually gets called even if the click is outside the visual menu area?
           // No, Controls.js passes coordinates. The implementation of LoginMenuScreen.mousePressed needs to check them.
           // MenuManager unconditionally calls current.mousePressed.
        }

        // Check Close Button first
        if (this.closeButtonRegion) {
            const btn = this.closeButtonRegion;
            // Pad touch area slightly
            const padding = 10;
            if (mx >= btn.x - padding && mx <= btn.x + btn.w + padding &&
                my >= btn.y - padding && my <= btn.y + btn.h + padding) {
                
                // Close menu - using global helper
                if (typeof setMenuVisible === 'function') {
                    setMenuVisible(false);
                } else if (typeof menuVisible !== 'undefined') {
                    menuVisible = false;
                } else if (window.menuVisible !== undefined) {
                    window.menuVisible = false;
                }

                // Explicitly cleanup current screen (DOM elements)
                if (this.current && this.current.hide) {
                    this.current.hide();
                }
                if (this.colorPicker) {
                    this.colorPicker.hide();
                }

                return true; 
            }
        }
    
        if (this.current && this.current.mousePressed) {
            return this.current.mousePressed(mx, my, x, y, w, h);
        }
        return false;
    }

    touchStarted() {
         // Forward to mousePressed with first touch
         if (typeof touches !== 'undefined' && touches.length > 0) {
              const mx = touches[0].x;
              const my = touches[0].y;
              return this.mousePressed(mx, my);
         }
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
        this.selected = -1;
    }

    addOption(label, callback) {
        this.options.push(new MenuOption(label, callback));
    }

    draw(x, y, w, h, spacing = 50) {
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        
        textAlign(CENTER, CENTER);
        textSize(32 * s);
        fill(255);
        text(this.title, x + w / 2, y + (spacing * s) / 2);

        for (let i = 0; i < this.options.length; i++) {
            let ry = y + (spacing * s) * (i + 1);
            let rh = (spacing * s) - (10 * s);
            let isHovered = mouseX > x && mouseX < x + w && mouseY > ry && mouseY < ry + rh;

            if (i === this.selected || isHovered) fill(0, 200, 255);
            else fill(255);
            rect(x, ry, w, rh, 10 * s);
            fill(0);
            text(this.options[i].label, x + w / 2, ry + rh / 2);
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
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        
        // Check hover
        let isHovered = mouseX > this.x && mouseX < this.x + this.w && 
                        mouseY > this.y && mouseY < this.y + this.h;

        // Draw background
        fill((this.selected || isHovered) ? [0, 200, 255] : 255);
        stroke(0);
        rect(this.x, this.y, this.w, this.h, 10 * s);

        // Draw label
        noStroke();
        fill(0);
        textAlign(CENTER, CENTER);
        textSize(18 * s);
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
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        
        // Check hover
        let isHovered = mouseX > this.x && mouseX < this.x + this.w && 
                        mouseY > this.y && mouseY < this.y + this.h;

        // Draw the base option background with different colors for different selection states
        let bgColor;
        if (this.selected === true || isHovered) {
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
        rect(this.x, this.y, this.w, this.h, 10 * s);

        // Draw weapon icon to the left inside the option
        let iconSize = Math.min(this.h - (8 * s), 32 * s);
        let iconX = this.x + (8 * s) + iconSize / 2;
        let iconY = this.y + this.h / 2;
        drawWeaponItem(this.weaponName, iconX, iconY, iconSize);

        // Draw label next to icon
        noStroke();
        fill(0);
        textAlign(LEFT, CENTER);
        textSize(14 * s);
        text(this.label, this.x + (16 * s) + iconSize, this.y + this.h / 2);
    }
}

class MenuInputField {
    constructor(label, x, y, w, h, isPassword = false) {
        this.label = label;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        
        // Create DOM input
        this.input = createInput('');
        if (isPassword) {
            this.input.attribute('type', 'password');
        }
        
        // Style to look similar to the canvas version
        this.input.style('font-size', '16px');
        this.input.style('padding', '5px');
        this.input.style('border-radius', '6px');
        this.input.style('border', '1px solid #999');
        this.input.style('outline', 'none');
        this.input.style('color', '#000');
        this.input.style('background', '#fff');
        this.input.style('box-sizing', 'border-box'); // Ensure padding doesn't affect width
        
        // Placeholder
        this.input.attribute('placeholder', label);

        this.input.hide();
    }

    draw() {
        // Update position and size
        this.input.position(this.x, this.y);
        this.input.size(this.w, this.h);
        this.input.show();
    }
    
    // Delegate value property
    get value() {
        return this.input.value();
    }
    
    set value(v) {
        this.input.value(v);
    }
    
    get focused() {
        return document.activeElement === this.input.elt;
    }
    
    hide() {
        this.input.hide();
    }
    
    show() {
        this.input.show();
    }

    // Legacy methods no longer needed
    mousePressed(mx, my) { return false; }
    keyPressed(k) { return false; }
    keyTyped(k) { return false; }
}

class AccountAuthMenuScreen extends MenuScreen {
    constructor(mode = 'login') {
        super(mode === 'login' ? "Account Login" : "Create Account");
        this.mode = mode; // 'login' or 'create'
        this.usernameField = new MenuInputField("Username:", 0, 0, 240, 40);
        this.passwordField = new MenuInputField("Password:", 0, 0, 240, 40, true);
        if (mode === 'create') {
            this.confirmPasswordField = new MenuInputField("Confirm Password:", 0, 0, 240, 40, true);
        }
        
        this.submitButton = new MenuOption(mode === 'login' ? "Log In" : "Create", () => this.submit());
        this.backButton = new MenuOption("Back", () => menuManager.show('login'));
        
        this.msg = "";
        this.selected = -1;
    }

    hide() {
        this.usernameField.hide();
        this.passwordField.hide();
        if (this.confirmPasswordField) this.confirmPasswordField.hide();
    }

    submit() {
        const username = this.usernameField.value.trim();
        const password = this.passwordField.value.trim();
        
        if (!username || !password) {
            this.msg = "Please enter username and password.";
            return;
        }

        if (this.mode === 'create') {
            const confirm = this.confirmPasswordField.value.trim();
            if (password !== confirm) {
                 this.msg = "Passwords do not match!";
                 return;
            }
        }

        this.msg = "Processing...";
        if (this.mode === 'create') {
            sendRegisterAccount(username, password);
        } else {
            sendLoginAccount(username, password);
        }
    }

    draw(x, y, w, h) {
        rectMode(CORNER);
        fill(255, 255, 255, 200);
        noStroke();
        rect(x, y, w, h, 30); // Background panel

        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        // Determine layout/spacing based on available height or mobile flag
        // Use reduced spacing if on mobile or restricted height
        const isCompact = (typeof isMobile !== 'undefined' && isMobile) || h < 600;
        
        const titleSize = isCompact ? 24 : 32;
        const titleY = isCompact ? 20 : 40;
        const startY = isCompact ? 60 : 120;
        const spacing = isCompact ? 45 : 60;
        const msgSpacing = isCompact ? 30 : 60;
        const btnSpacing = isCompact ? 35 : 50;
        const fieldH = isCompact ? 30 : 40;

        fill(0);
        textSize(titleSize);
        textAlign(CENTER, TOP);
        text(this.title, x + w / 2, y + titleY);

        // Fields
        let contentX = x + w / 2 - 120;
        let contentY = y + startY;

        this.usernameField.x = contentX;
        this.usernameField.y = contentY;
        this.usernameField.h = fieldH;
        this.usernameField.draw();

        contentY += spacing;
        this.passwordField.x = contentX;
        this.passwordField.y = contentY;
        this.passwordField.h = fieldH;
        this.passwordField.draw();

        if (this.mode === 'create' && this.confirmPasswordField) {
             contentY += spacing;
             this.confirmPasswordField.x = contentX;
             this.confirmPasswordField.y = contentY;
             this.confirmPasswordField.h = fieldH;
             this.confirmPasswordField.draw();
        }

        // Message
        contentY += msgSpacing;
        textSize(isCompact ? 14 : 16);
        fill(this.msg.startsWith("Success") ? [0,150,0] : [200,0,0]);
        textAlign(CENTER, TOP);
        text(this.msg, x + w / 2, contentY);

        // Buttons
        // If compact, stack buttons closer
        contentY += isCompact ? 25 : 40;
        
        let btnW = 200;
        let btnH = isCompact ? 30 : 40;

        this.submitButton.setPosition(x + w / 2 - btnW/2, contentY);
        this.submitButton.setSize(btnW, btnH);
        this.submitButton.draw();

        contentY += btnSpacing;
        this.backButton.setPosition(x + w / 2 - btnW/2, contentY);
        this.backButton.setSize(btnW, btnH);
        this.backButton.draw();
    }

    navigate(dir) {
        this.selected = (this.selected + dir + 2) % 2;
    }

    choose() {
        if (this.selected === 0) this.submitButton.callback();
        else this.backButton.callback();
    }

    mousePressed(mx, my) {
        if (this.usernameField.mousePressed(mx, my)) return;
        if (this.passwordField.mousePressed(mx, my)) return;
        if (this.mode === 'create' && this.confirmPasswordField && this.confirmPasswordField.mousePressed(mx, my)) return;

        if (this.submitButton.mousePressed(mx, my)) {
            this.submitButton.callback();
            return;
        }
        if (this.backButton.mousePressed(mx, my)) {
            this.backButton.callback();
            return;
        }
    }

    keyPressed(k) {
         if (k === 'Enter') {
             this.submit();
             return;
         }
    }
    
    keyTyped(k) {
        // DOM handles text input
    }
}

class LoginMenuScreen extends MenuScreen {
    constructor(colorPicker) {
        super("Login");
        // Customizable headers for login vs pause (signed-in) views
        this.loginHeader = "What be yar bird's nomenclature, matey?";
        this.loginSubheader = "[Translated] What's your plane's name?";
        
        // Random pause subheaders
        const jokeKeys = Object.keys(PAUSE_JOKES);
        const randomKey = jokeKeys[Math.floor(Math.random() * jokeKeys.length)];
        
        this.pauseHeader = randomKey;
        this.pauseSubheader = PAUSE_JOKES[randomKey];
        
        this.lastTouchY = 0;
        
        this.usernameField = new MenuInputField("Name:", 150, 220, 240, 40);
        this.usernameField.input.input(() => {
            if (typeof saveUserPreferences === 'function') {
                saveUserPreferences(
                    this.usernameField.value.trim(), 
                    this.color, 
                    selectedGun1, 
                    selectedGun2, 
                    (this.partyField ? this.partyField.value.trim() : "")
                );
            }
        });

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
        this.partyField.input.input(() => {
            if (typeof saveUserPreferences === 'function') {
                saveUserPreferences(
                    this.usernameField.value.trim(), 
                    this.color, 
                    selectedGun1, 
                    selectedGun2, 
                    this.partyField.value.trim()
                );
            }
        });

        // Account management buttons
        this.createAccountBtn = new MenuOption("Create Account", () => menuManager.show('createAccount'));
        this.loginAccountBtn = new MenuOption("Account Login", () => menuManager.show('loginAccount'));
        this.logoutBtn = new MenuOption("Log Out", () => this.logout());

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
        this.selected = -1;
        this.isSessionActive = false;
        this.serverSaveExists = true; // Assume true until server says otherwise
        this.isAccountSession = false; // Add explicit instance property for account state
        this.accountName = null; // Add explicit instance property for account name
        // Side menu data
        this.leftMenuList = ["Tip: Press M for Map", "Tip: Press I for Inventory", "Tip: Press B for Shop"];
        this.rightMenuList = ["Online Players:", "Loading..."]; 
        this.achievements = [];
        this.achievementScroll = 0;
        this.hoveredAchievement = null;
        this.selectedAchievement = null; // For mobile/click interaction
        this.playerScroll = 0;
        
        // Define panel bounds for scrolling interaction
        this.leftPanelBounds = { x: 0, y: 0, w: 0, h: 0 };
        this.rightPanelBounds = { x: 0, y: 0, w: 0, h: 0 };

        if (this.colorPicker) {
            this.colorPicker.value(this.color);
            this.colorPicker.input(() => {
                this.color = this.colorPicker.value();
                // Save immediately on color change
                if (typeof saveUserPreferences === 'function') {
                    const name = (this.usernameField && this.usernameField.value) ? this.usernameField.value.trim() : "";
                    const party = (this.partyField && this.partyField.value) ? this.partyField.value.trim() : "";
                    saveUserPreferences(name, this.color, selectedGun1, selectedGun2, party);
                }
            });
        }

        this.activeTab = 'main'; // 'main', 'community', 'achievements'
        
        // Load saved preferences from cookies (after all fields are created)
        this.loadSavedPreferences();
    }

    hide() {
        this.usernameField.hide();
        this.partyField.hide();
        if (this.colorPicker) this.colorPicker.hide();
    }

    draw(x, y, w, h) {
        rectMode(CORNER);
        
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;

        // Update local state from global if needed (legacy compatibility) but prefer instance state
        if (typeof isAccountSession !== 'undefined' && isAccountSession && !this.isAccountSession) {
             this.isAccountSession = true;
        }

        // --- Liquid Layout Logic ---
        let sideW = Math.max(200 * s, width * 0.2);
        let gap = 20 * s;
        // Check if we have room for side panels
        // Normal layout requires: sideW + gap + w + gap + sideW < width
        // Wait, 'w' passed here is usually calculated in Game.js as 45-95% of width.
        // If we want side panels, we need to check if they would fit OUTSIDE 'w'.
        // If Game.js gives us 95% width (isMobile), then sideWidth won't fit.
        
        let isNarrow = false;
        // If the calculated left/right panel positions (based on x, w) would fall offscreen, we are narrow.
        if (x - gap - sideW < 0 || x + w + gap + sideW > width) {
            isNarrow = true;
        }

        if (!isNarrow) {
            // Force main tab if we have space (reset view)
            if (this.activeTab !== 'main') this.activeTab = 'main';

            // Draw Side Menus Normal
            // Left Panel
            let leftX = x - gap - sideW;
            fill(255, 255, 255, 200);
            noStroke();
            rect(leftX, y, sideW, h, 30 * s);
            this.leftPanelBounds = { x: leftX, y: y, w: sideW, h: h };
            this.drawPlayerList(leftX, y, sideW, h);

            // Right Panel
            let rightX = x + w + gap;
            fill(255, 255, 255, 200);
            noStroke();
            rect(rightX, y, sideW, h, 30 * s);
            this.rightPanelBounds = { x: rightX, y: y, w: sideW, h: h };
            this.drawAchievements(rightX, y, sideW, h);

            // Draw Central Main Panel Background
            fill(255, 255, 255, 200);
            noStroke();
            rect(x, y, w, h, 30 * s);
            
            // Draw Main Content
            this.drawMainContent(x, y, w, h, s);

        } else {
            // NARROW MODE (Mobile / Small Window)
            // Use the full available area (x,y,w,h) for the active tab content
            
            // Draw background for the whole modal
            fill(255, 255, 255, 240); // Slightly more opaque for mobile
            noStroke();
            rect(x, y, w, h, 20 * s);

            // Draw Tab Bar at Top
            let tabH = 50 * s;
            let tabs = ['Main', 'Community', 'Achievements'];
            let tabW = w / tabs.length;
            
            textAlign(CENTER, CENTER);
            textSize(18 * s);
            // Tab Background
            // fill(200);
            // rect(x, y, w, tabH, 20 * s, 20 * s, 0, 0); // Rounded top corners
            
            for (let i = 0; i < tabs.length; i++) {
                let tx = x + i * tabW;
                let ty = y;
                let tLabel = tabs[i];
                let tKey = tLabel === 'Achievements' ? 'achievements' : tLabel.toLowerCase();
                
                let isActive = this.activeTab === tKey;
                
                fill(isActive ? [255, 255, 255] : [220, 220, 220]);
                // Round top corners only? 
                if (isActive) {
                    stroke(200);
                    // Open bottom
                    rect(tx, ty, tabW, tabH + 5, 10 * s, 10 * s, 0, 0);
                    noStroke();
                    rect(tx + 2, ty + tabH - 2, tabW - 4, 10); // Cover bottom border
                } else {
                    stroke(200);
                    rect(tx, ty, tabW, tabH, 10 * s, 10 * s, 0, 0);
                }
                
                noStroke();
                fill(isActive ? 0 : 100);
                text(tLabel, tx + tabW / 2, ty + tabH / 2);
                
                // Click region handled in mousePressed
            }
            
            // Separator
            stroke(200);
            line(x, y + tabH, x + w, y + tabH);
            noStroke();

            // Draw Content Area
            let contentY = y + tabH;
            let contentH = h - tabH;
            
            if (this.activeTab === 'main') {
                this.drawMainContent(x, contentY, w, contentH, s);
            } else if (this.activeTab === 'community') {
                // Pass bounds to helper
                this.leftPanelBounds = { x: x, y: contentY, w: w, h: contentH };
                this.drawPlayerList(x, contentY, w, contentH);
            } else if (this.activeTab === 'achievements') {
                this.rightPanelBounds = { x: x, y: contentY, w: w, h: contentH };
                this.drawAchievements(x, contentY, w, contentH);
            }
        }
    }

    // Extracted Main Content Logic (Login fields, buttons, etc.)
    drawMainContent(x, y, w, h, s) {
        fill(0);
        textSize(40 * s);

        // Only position/show color picker when not already signed in
        if (!signedIn && this.colorPicker) {
            // Hide if not main tab? handled by hide in draw?
            // Actually color picker is DOM element.
            if (this.activeTab === 'main') {
               this.colorPicker.show();
               this.colorPicker.position(x + w / 2 + (120 * s), y + (183 * s));
            } else {
               this.colorPicker.hide();
            }
        } else if (this.colorPicker) {
            this.colorPicker.hide();
        }

        textAlign(CENTER, CENTER);
        if (window.WS_ADDRESS === 'ws://localhost:3001') {
            text("SKY PIRATES (test environment)", x + w / 2, y + (50 * s));
        } else {
            text("SKY PIRATES", x + w / 2, y + (50 * s));
        }
        textSize(20 * s);
        // Show different header/subheader depending on whether this is the pre-login screen or the in-game pause menu
        if (signedIn) {
            text(this.pauseHeader, x + w / 2, y + (100 * s));
            text(this.pauseSubheader, x + w / 2, y + (140 * s));
        } else {
            text(this.loginHeader, x + w / 2, y + (100 * s));
            text(this.loginSubheader, x + w / 2, y + (140 * s));
        }

        // Draw input field logic... (username, party)
        // Need to ensure we only show DOM inputs if main tab is active
        // But drawMainContent is only called if activeTab is main.
        
        // Scale input dimensions
        let fieldW = 240 * s;
        let fieldH = 40 * s;
        let halfFieldW = fieldW / 2;
        
        this.usernameField.x = x + w / 2 - halfFieldW;
        this.usernameField.y = y + (170 * s);
        this.usernameField.w = fieldW;
        this.usernameField.h = fieldH;
        
        // If already signed in, display username read-only; otherwise draw editable field
        if (signedIn) {
            this.usernameField.hide();
            fill(50);
            textAlign(LEFT, CENTER);
            textSize(18 * s);
            const displayName = username || this.usernameField.value || '(unknown)';
            text(displayName, this.usernameField.x + (8 * s), this.usernameField.y + this.usernameField.h / 2);
        } else {
            this.usernameField.draw();
        }
        
        // Draw party field below username
        this.partyField.x = x + w / 2 - halfFieldW;
        this.partyField.y = y + (220 * s);
        this.partyField.w = fieldW;
        this.partyField.h = fieldH;
        this.partyField.draw();

        // Login button - updated to match new position (right of party field)
        // Adjust logic: Make it sit beside if space, or below if very small?
        // Original: right of party field
        let loginBtnW = 120 * s;
        let loginBtnH = 40 * s;
        
        // If very narrow, stack below OR if we are in Narrow Mode we almost certainly want to stack below
        // The original logic checked 'w'.
        let loginBtnX, loginBtnY;
        if (w < 400 * s) { // This threshold might trip in narrow mode
             loginBtnX = x + w / 2 - (loginBtnW / 2);
             loginBtnY = y + (270 * s); // shifted down
        } else {
             loginBtnX = x + w / 2 + halfFieldW + (10 * s);
             loginBtnY = y + (220 * s);
        }

        this.loginButton.setPosition(loginBtnX, loginBtnY);
        this.loginButton.setSize(loginBtnW, loginBtnH);
        // Change label when signed in
        if (signedIn) {
            this.loginButton.label = "Change Party";
        } else {
            this.loginButton.label = this.hasSavedState ? "Continue" : "Start";
        }
        this.loginButton.draw();
        
        // --- Draw settings button in top-right corner ---
        // Warning: in narrow mode, 'y' is shifted down by tabH? No, y is passed as contentY.
        // But settings button might look weird inside content area.
        // It's ok.
        let settingsBtnW = 110 * s;
        let settingsBtnH = 40 * s;
        let settingsBtnX = x + w - (130 * s); // 130px from right edge
        let settingsBtnY = y + (20 * s); // 20px from top
        this.settingsButton.setPosition(settingsBtnX, settingsBtnY);
        this.settingsButton.setSize(settingsBtnW, settingsBtnH);
        this.settingsButton.selected = false; // Not part of navigation
        this.settingsButton.draw();

        // Error message / status text
        let showLoginMsg = true;

        if (signedIn) {
            showLoginMsg = false;
            textAlign(CENTER, CENTER);
            textSize(14 * s);
            fill(80);
            
            let statusY = (w < 400 * s) ? y + (320 * s) : y + (280 * s);
            
            if (this.isAccountSession && this.accountName) {
                text("Logged in as: " + this.accountName, x + w / 2, statusY);
            } else {
                 text("Logged in as a guest", x + w / 2, statusY);
            }
        }

        if (showLoginMsg && this.loginMsg) {
            textAlign(CENTER, CENTER);
            fill(0); 
            textSize(16 * s);
            let statusY = (w < 400 * s) ? y + (320 * s) : y + (280 * s);
            text(this.loginMsg, x + w / 2, statusY); 
        }

        // --- Draw weapon lists ---
        if (!signedIn && (!this.hasSavedState || this.serverSaveExists === false)) {
            let listSpacing = 54 * s;
            let listYOffset = (w < 400 * s) ? y + (360 * s) : y + (360 * s); // Could adjust if needed
            let gunListW = 180 * s, gunListH = 44 * s;
            let gunListPad = 40 * s; // 40
            
            // Adjust for really narrow screens
            if (w < 400 * s) { 
                gunListPad = 5 * s;
                gunListW = 150 * s;
            }

            // Gun1 list (left)
            let gun1X = x + w / 2 - gunListW - gunListPad;
            let gun1Y = listYOffset;
            textSize(22 * s);
            fill(0);
            textAlign(CENTER, CENTER);
            text("Gun 1", gun1X + gunListW / 2, gun1Y - (34 * s));
            for (let i = 0; i < this.gun1Options.length; i++) {
                let opt = this.gun1Options[i];
                opt.setPosition(gun1X, gun1Y + i * listSpacing);
                opt.setSize(gunListW, gunListH);
                if (selectedGun1 === i) opt.selected = "weapon";
                else opt.selected = false;
                opt.draw();
            }

            // Gun2 list (right)
            let gun2X = x + w / 2 + gunListPad;
            let gun2Y = listYOffset;
            textSize(22 * s);
            fill(0);
            textAlign(CENTER, CENTER);
            text("Gun 2", gun2X + gunListW / 2, gun2Y - (34 * s));
            for (let i = 0; i < this.gun2Options.length; i++) {
                let opt = this.gun2Options[i];
                opt.setPosition(gun2X, gun2Y + i * listSpacing);
                opt.setSize(gunListW, gunListH);
                if (selectedGun2 === i) opt.selected = "weapon";
                else opt.selected = false;
                opt.draw();
            }
        }
        
        // Drawn account management buttons or logout button
        if (!signedIn) {
            let btnY = y + h - (60 * s);
            
            if (this.isAccountSession) {
                 if (this.accountName) {
                     textSize(14 * s);
                     textAlign(CENTER, BOTTOM);
                     fill(80); // Dark Gray
                     text("Logged in as: " + this.accountName, x + w/2, btnY - (5 * s));
                 }

                 this.logoutBtn.setPosition(x + w/2 - (75 * s), btnY);
                 this.logoutBtn.setSize(150 * s, 40 * s);
                 this.logoutBtn.draw();
            } else {
                 textSize(14 * s);
                 textAlign(CENTER, BOTTOM);
                 fill(80);
                 text("Logged in as a guest", x + w/2, btnY - (5 * s));
                 
                 let authBtnW = 150 * s;
                 let authBtnH = 40 * s;

                 this.createAccountBtn.setPosition(x + w/2 - authBtnW - (10 * s), btnY);
                 this.createAccountBtn.setSize(authBtnW, authBtnH);
                 this.createAccountBtn.draw();

                 this.loginAccountBtn.setPosition(x + w/2 + (10 * s), btnY);
                 this.loginAccountBtn.setSize(authBtnW, authBtnH);
                 this.loginAccountBtn.draw();
            }
        }
        
        // Draw tooltip if needed (after everything else to stay on top)
        if (this.hoveredAchievement) {
            this.drawAchievementTooltip(this.hoveredAchievement);
        }
    }

    drawPlayerList(x, y, w, h) {
        fill(0);
        textSize(24);
        textAlign(CENTER, TOP);
        
        // Use full server list if available, otherwise fallback to local players array
        let communityList = (typeof window.allPlayers !== 'undefined' && window.allPlayers) ? window.allPlayers : ((typeof players !== 'undefined') ? players : []);
        let onlineCount = communityList.length;

        text("Community", x + w/2, y + 25);
        textSize(16);
        fill(100);
        text(onlineCount + " Online", x + w/2, y + 55);
        
        // List area
        let listX = x + 20;
        let listY = y + 80;
        let listW = w - 40;
        let listH = h - 100;
        
        // Show "Connecting..." only if we haven't received initial data yet.
        if (!this.hasReceivedPlayerData && communityList.length === 0) {
            textSize(16);
            fill(100);
            text("Connecting...", x + w/2, listY + 50);
            return;
        }

        if (communityList.length === 0) {
            textSize(16);
            fill(100);
            text("No pilots online.", x + w/2, listY + 50);
            return;
        }

        let itemHeight = 50;
        let totalHeight = communityList.length * itemHeight;
        
        // Scroll handling
        if (totalHeight > listH) {
            this.playerScroll = constrain(this.playerScroll, -totalHeight + listH, 0);
        } else {
            this.playerScroll = 0;
        }

        if (typeof drawingContext !== 'undefined') {
             drawingContext.save();
             drawingContext.beginPath();
             drawingContext.rect(listX, listY, listW, listH);
             drawingContext.clip();
        }

        let currentY = listY + this.playerScroll;
        
        // Use a consistent sort order (e.g., username) to stop jitter
        // But players array order might be stable enough from server
        // Let's iterate
        for (let p of communityList) {
             // Only draw if visible
             if (currentY + itemHeight > listY && currentY < listY + listH) {
                 fill(245, 245, 245, 200);
                 stroke(200);
                 rect(listX, currentY, listW, 40, 5);
                 
                 // Draw Plane Icon using helper
                 push();
                 translate(listX + 25, currentY + 20);
                 scale(1.5);
                 // Override angle to point up (-PI/2)
                 drawPlayerIcon(p, 0);
                 pop();

                 noStroke();
                 fill(0);
                 textAlign(LEFT, CENTER);
                 textSize(16);
                 text(p.username, listX + 50, currentY + 20);
             }
             currentY += itemHeight;
        }

        if (typeof drawingContext !== 'undefined') {
             drawingContext.restore();
        }
    }

    drawAchievements(x, y, w, h) {
        fill(0);
        textSize(24);
        textAlign(CENTER, TOP);
        text("Achievements", x + w/2, y + 30);
        
        // List area
        let listX = x + 20;
        let listY = y + 70;
        let listW = w - 40;
        let listH = h - 90;
        
        if (!this.achievements || this.achievements.length === 0) {
            textSize(16);
            fill(100);
            text("No achievements yet.", x + w/2, listY + 50);
            return;
        }

        let itemHeight = 50;
        let totalHeight = this.achievements.length * itemHeight;
        
        // Scroll handling
        if (totalHeight > listH) {
            this.achievementScroll = constrain(this.achievementScroll, -totalHeight + listH, 0);
        } else {
            this.achievementScroll = 0;
        }

        // Use strict clipping if available, otherwise just draw
        if (typeof drawingContext !== 'undefined') {
             drawingContext.save();
             drawingContext.beginPath();
             drawingContext.rect(listX, listY, listW, listH);
             drawingContext.clip();
        }

        let currentY = listY + this.achievementScroll;
        let mouseInList = mouseX > listX && mouseX < listX + listW && mouseY > listY && mouseY < listY + listH;
        this.hoveredAchievement = null; // Reset for this frame

        for (let ach of this.achievements) {
             // Only draw if visible
             if (currentY + itemHeight > listY && currentY < listY + listH) {
                 fill(ach.completed ? [220, 255, 220, 240] : [200, 200, 200, 240]);
                 stroke(0);
                 rect(listX, currentY, listW, 40, 5);
                 
                 noStroke();
                 fill(0);
                 textAlign(LEFT, CENTER);
                 textSize(16);
                 
                 // Defensive defaults
                 let safeProgress = typeof ach.progress === 'number' ? ach.progress : 0;
                 let safeMax = (typeof ach.maxProgress === 'number' && ach.maxProgress > 0) ? ach.maxProgress : 1;
                 
                 let showProgress = !ach.completed && safeMax > 1;

                 if (showProgress) {
                     text(ach.title, listX + 10, currentY + 14);
                     
                     // Draw Progress Bar background
                     let barX = listX + 10;
                     let barY = currentY + 28;
                     let barW = listW - 20;
                     let barH = 6;
                     
                     fill(255, 255, 255, 150);
                     rect(barX, barY, barW, barH, 3);
                     
                     // Draw Progress Fill
                     let progPct = constrain(safeProgress / safeMax, 0, 1);
                     if (isNaN(progPct)) progPct = 0;
                     
                     fill(0, 180, 0);
                     rect(barX, barY, barW * progPct, barH, 3);

                     // Progress Text
                     textAlign(RIGHT, CENTER);
                     textSize(11);
                     fill(80);
                     text(`${safeProgress} / ${safeMax}`, listX + listW - 10, currentY + 14);

                 } else {
                     text(ach.title, listX + 10, currentY + 20);
                 }
                 
                 if (ach.completed) {
                     fill(0, 150, 0);
                     textAlign(RIGHT, CENTER);
                     textSize(16);
                     text("✔", listX + listW - 10, currentY + 20);
                 }
                 
                 // Hover check
                 if (mouseInList && mouseY > currentY && mouseY < currentY + 40) {
                     this.hoveredAchievement = ach;
                 }
             }
             currentY += itemHeight;
        }

        if (typeof drawingContext !== 'undefined') {
             drawingContext.restore();
        }

        // Display tooltip for hovered or selected achievement
        let activeAch = this.hoveredAchievement || this.selectedAchievement;
        if (activeAch) {
            this.drawAchievementTooltip(activeAch);
        }
    }
    
    drawAchievementTooltip(ach) {
        push();
        textSize(12); // measuring font size
        let textW = textWidth(ach.description) + 30;
        if (textW < 220) textW = 220;
        
        let textH = 50; 
        
        let showUnlockedDate = ach.completed && ach.unlockedAt;
        let nextMilestone = null;
        if (ach.milestones && ach.milestones.length > 0) {
            nextMilestone = ach.milestones.find(m => !m.unlocked);
        }

        if (showUnlockedDate) textH += 20;
        if (nextMilestone) textH += 20;

        let tx = mouseX + 15;
        let ty = mouseY + 15;
        
        // Bounds check
        if (tx + textW > width) tx = mouseX - textW - 5;
        if (ty + textH > height) ty = mouseY - textH - 5;
        
        // Draw background
        fill(255, 255, 235);
        stroke(0);
        rect(tx, ty, textW, textH, 5);
        
        fill(0);
        noStroke();
        textAlign(LEFT, TOP);
        
        // Title
        textSize(16);
        textStyle(BOLD);
        text(ach.title, tx + 10, ty + 10);
        
        // Description
        textStyle(NORMAL);
        textSize(12);
        text(ach.description, tx + 10, ty + 30);
        
        let lineY = ty + 48;
        
        if (showUnlockedDate) {
             fill(0, 100, 0);
             text("Completed: " + new Date(ach.unlockedAt).toLocaleDateString(), tx + 10, lineY);
             lineY += 20;
        }
        
        if (nextMilestone) {
             fill(0, 0, 150);
             text(`Next: ${nextMilestone.title} (${ach.progress} / ${nextMilestone.target})`, tx + 10, lineY);
        }
        pop();
    }

    mouseWheel(event) {
        let delta = event.deltaY || event.delta || 0;
        
        // Check bounds for right panel (achievements)
        if (this.achievements && this.achievements.length > 0) {
            // If mouse is over right panel
            if (mouseX > this.rightPanelBounds.x && mouseX < this.rightPanelBounds.x + this.rightPanelBounds.w &&
                mouseY > this.rightPanelBounds.y && mouseY < this.rightPanelBounds.y + this.rightPanelBounds.h) {
                this.achievementScroll -= delta;
                return;
            }
        }
        
        // Check bounds for left panel (players)
        // Draw is called when !signedIn OR signedIn (now logic changed to always draw left panel if fit?)
        // Left panel is drawn in draw() if space permits.
        if (mouseX > this.leftPanelBounds.x && mouseX < this.leftPanelBounds.x + this.leftPanelBounds.w &&
            mouseY > this.leftPanelBounds.y && mouseY < this.leftPanelBounds.y + this.leftPanelBounds.h) {
             this.playerScroll -= delta;
        }
    }

    touchStarted() {
        if (typeof touches !== 'undefined' && touches.length > 0) {
            this.lastTouchY = touches[0].y;
        }
    }

    touchMoved() {
        if (typeof touches !== 'undefined' && touches.length > 0) {
            let currentY = touches[0].y;
            let delta = currentY - this.lastTouchY;
            this.lastTouchY = currentY;
            
            // Check bounds for right panel (achievements)
            if (this.achievements && this.achievements.length > 0) {
                let tx = touches[0].x;
                let ty = touches[0].y;
                if (tx > this.rightPanelBounds.x && tx < this.rightPanelBounds.x + this.rightPanelBounds.w &&
                    ty > this.rightPanelBounds.y && ty < this.rightPanelBounds.y + this.rightPanelBounds.h) {
                    this.achievementScroll += delta;
                    return false;
                }
            }
            
            // Check bounds for left panel
            let tx = touches[0].x;
            let ty = touches[0].y;
            if (tx > this.leftPanelBounds.x && tx < this.leftPanelBounds.x + this.leftPanelBounds.w &&
                ty > this.leftPanelBounds.y && ty < this.leftPanelBounds.y + this.leftPanelBounds.h) {
                 this.playerScroll += delta;
                 return false;
            }
        }
    }

    setSessionActive(active) {
        this.isSessionActive = active;
    }

    setSaveExists(exists) {
        this.serverSaveExists = exists;
        // If the server confirms no save exists, update label and clear "hasSavedState" illusion
        if (exists === false && !this.isSessionActive) {
             this.hasSavedState = false;
             // Also force label update immediately if not signed in
             if (!signedIn) {
                 this.loginButton.label = "Start";
             }
        } else if (exists === true) {
             // Server says save exists
             this.hasSavedState = true;
             if (!signedIn) {
                 this.loginButton.label = "Continue";
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
        // Save immediately
        if (typeof saveUserPreferences === 'function') {
            const name = (this.usernameField && this.usernameField.value) ? this.usernameField.value.trim() : "";
            const party = (this.partyField && this.partyField.value) ? this.partyField.value.trim() : "";
            saveUserPreferences(name, this.color, selectedGun1, selectedGun2, party);
        }
    }

    selectGun2(idx) {
        selectedGun2 = idx;
        // Save immediately
        if (typeof saveUserPreferences === 'function') {
            const name = (this.usernameField && this.usernameField.value) ? this.usernameField.value.trim() : "";
            const party = (this.partyField && this.partyField.value) ? this.partyField.value.trim() : "";
            saveUserPreferences(name, this.color, selectedGun1, selectedGun2, party);
        }
    }

    mousePressed(mx, my, x, y, w, h) {
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        let sideW = Math.max(200 * s, width * 0.2);
        let gap = 20 * s;

        // Handle closing selected achievement window if clicking completely outside menu
        // This must be checked first to ensure "Outside Tap" works regardless of narrow/wide layout logic
        if (this.selectedAchievement && (mx < x || mx > x + w || my < y || my > y + h)) {
             this.selectedAchievement = null;
             return true; 
        }

        // Check if narrow mode
        let isNarrow = false;
        if (x - gap - sideW < 0 || x + w + gap + sideW > width) {
            isNarrow = true;
        }

        if (isNarrow) {
            // TAB BAR CLICK LOGIC
            // Tabs: Main, Community, Achievements
            let tabH = 50 * s;
            if (my >= y && my <= y + tabH && mx >= x && mx <= x + w) {
                let tabs = ['Main', 'Community', 'Achievements'];
                let tabW = w / tabs.length;
                let clickedIndex = Math.floor((mx - x) / tabW);
                if (clickedIndex >= 0 && clickedIndex < tabs.length) {
                    let clickedTabLabel = tabs[clickedIndex];
                    let clickedTabKey = clickedTabLabel === 'Achievements' ? 'achievements' : clickedTabLabel.toLowerCase();
                    this.activeTab = clickedTabKey;
                    
                    // Reset selected items when switching tabs
                    this.selectedAchievement = null;

                    // Show/Hide inputs based on tab
                    if (this.activeTab !== 'main') {
                        if (this.usernameField) this.usernameField.hide();
                        if (this.partyField) this.partyField.hide();
                    }

                    // Show/Hide color picker based on tab
                    if (this.colorPicker) {
                         if (this.activeTab === 'main' && !signedIn) {
                             this.colorPicker.show();
                         } else {
                             this.colorPicker.hide();
                         }
                    }
                    return true;
                }
            }
            // If clicking content area
            let contentY = y + tabH;
            
            // If If active tab is NOT main, handle specific tab interactions
            if (this.activeTab === 'achievements') {
                // Handle achievement clicks (for mobile/toggle)
                // Replicate layout logic from drawAchievements
                let listY = contentY + 70;
                let listX = x + 20; 
                let listW = w - 40;
                let listH = h - tabH - 90; // h passed to mousePressed is full height? 
                
                // Note: h in mousePressed is full menu height. 
                // In draw: contentH = h - tabH.
                // In drawAchievements: listH = contentH - 90.
                
                if (mx > listX && mx < listX + listW && my > listY && my < listY + listH) {
                    let relativeY = my - listY - this.achievementScroll;
                    let itemHeight = 50;
                    let idx = Math.floor(relativeY / itemHeight);
                    
                    if (idx >= 0 && idx < this.achievements.length) {
                        let clickedAch = this.achievements[idx];
                        // Toggle selection
                        if (this.selectedAchievement === clickedAch) {
                            this.selectedAchievement = null;
                        } else {
                            this.selectedAchievement = clickedAch;
                        }
                        return true;
                    }
                }
                
                // If clicked outside the list items properly (but inside menu), deselect
                if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
                    this.selectedAchievement = null;
                    return true;
                }
                
                return; 
            }
        }


        if (isNarrow && this.activeTab !== 'main') {
            return;
        }

    // Only allow focusing the username field when not signed in
    if (!signedIn) this.usernameField.mousePressed(mx, my);
        this.partyField.mousePressed(mx, my);
        
        // Settings button - in top-right corner
        if (this.settingsButton.mousePressed(mx, my)) {
            this.settingsButton.callback();
            return;
        }

        // Login button - updated to match new position (right of party field)
        if (this.loginButton.mousePressed(mx, my)) {
            // If signed in, change party action should only update party
            if (signedIn) {
                this.changeParty();
            } else {
                this.loginButton.callback();
            }
            return;
        }

        // Account Buttons logic
        if (!signedIn) {
            if (this.isAccountSession) {
                 if (this.logoutBtn.mousePressed(mx, my)) {
                     this.logoutBtn.callback();
                     return;
                 }
            } else {
                 if (this.createAccountBtn.mousePressed(mx, my)) {
                      this.createAccountBtn.callback();
                      return;
                 }
                 if (this.loginAccountBtn.mousePressed(mx, my)) {
                      this.loginAccountBtn.callback();
                      return;
                 }
            }
        }

        // Gun1 options
        for (let i = 0; i < this.gun1Options.length; i++) {
            let opt = this.gun1Options[i];
            if (opt.mousePressed(mx, my)) {
                this.selectGun1(i);
                return;
            }
        }

        // Gun2 options
        for (let i = 0; i < this.gun2Options.length; i++) {
            let opt = this.gun2Options[i];
            if (opt.mousePressed(mx, my)) {
                this.selectGun2(i);
                return;
            }
        }
    }

    keyPressed(k) {
        if (k === 'Enter') {
            if (signedIn) {
                // Close pause menu
                if (typeof setMenuVisible === 'function') {
                    setMenuVisible(false);
                } else if (typeof menuVisible !== 'undefined') {
                    menuVisible = false;
                }
            } else {
                this.tryLogin();
            }
            return;
        }
    }
    keyTyped(k) {
        // Handled by DOM inputs and 'input' event listeners
    }

    loadSavedPreferences() {
        // Load preferences using the global function (if available)
        if (typeof loadUserPreferences === 'function') {
            const prefs = loadUserPreferences();
            
            // Check for saved state via client ID cookie
            this.hasSavedState = typeof getCookie === 'function' && !!getCookie('skyPiratesClientId');

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
        
        // Prevent empty account state from lingering if previously logged in logic failed to clear
        if (!this.isAccountSession) {
             this.accountName = null;
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
                if (typeof menuVisible !== 'undefined') {
                    menuVisible = false;
                    this.hide();
                }
            }, 1500);
            return;
        }

        // Re-use loginPlayer to update the party on the server side; preserve existing username and color
        loginPlayer(username, { r, g, b }, { gun1: selectedGun1, gun2: selectedGun2 }, partyName, false);
        this.loginMsg = "Updating party...";
    }

    logout() {
        if (confirm("Are you sure you want to log out? This will return you to a new guest session.")) {
            deleteCookie('skyPiratesClientId');
            deleteCookie('skypirates_account_name');
            deleteCookie('skypirates_account_password');
            location.reload();
        }
    }
}

class SettingsMenuScreen extends MenuScreen {
    constructor() {
        super("Settings");
        
        // Force fixed camera on mobile
        if (typeof isMobile !== 'undefined' && isMobile) {
            settings.dynamicCamera = false;
        }

        // Camera toggle option
        this.cameraToggle = new MenuOption(
            (typeof isMobile !== 'undefined' && isMobile) ? "Camera: Fixed (Locked)" : (settings.dynamicCamera ? "Camera: Dynamic" : "Camera: Fixed"),
            () => this.toggleCamera()
        );
        
        // Screen shake toggle option
        this.shakeToggle = new MenuOption(
            settings.screenShake ? "Screen Shake: On" : "Screen Shake: Off",
            () => this.toggleShake()
        );
        
        // Optimized particles toggle option
        this.particlesToggle = new MenuOption(
            settings.optimizedParticles ? "Particles: Optimized" : "Particles: High Quality",
            () => this.toggleParticles()
        );
        
        // Reset progress button
        this.resetProgressButton = new MenuOption("Reset Progress", () => this.resetProgress());
        
        // Back button
        this.backButton = new MenuOption("Back", () => menuManager.show('login'));
        
        this.selected = -1;
    }

    toggleCamera() {
        if (typeof isMobile !== 'undefined' && isMobile) return;

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
    
    toggleParticles() {
        settings.optimizedParticles = !settings.optimizedParticles;
        this.particlesToggle.label = settings.optimizedParticles ? "Particles: Optimized" : "Particles: High Quality";
        
        // Save settings to cookies
        if (typeof saveSettings === 'function') {
            saveSettings(settings);
        }
    }

    resetProgress() {
        // This should only be called when not signed in (guest mode)
        // OR via settings if implemented for account
        if (confirm("Are you sure you want to reset your progress? This will delete your saved game state and you'll start fresh.")) {
            
            const playerId = getCookie('skyPiratesClientId');
            
            if (playerId && ws && ws.readyState === WebSocket.OPEN) {
                // Send reset command to server to wipe the save file
                // This works for both Guest and Account sessions, preserving the client ID/Cookie
                sendResetAccountProgress(playerId);
                
                alert("Progress reset! You can now start a new game.");
                
                // Update UI state to reflect no save
                this.hasSavedState = false;
                this.serverSaveExists = false;
                this.loginButton.label = "Start";
                return; 
            }
            
            // Fallback if no cookie exists (shouldn't happen if they have progress, but safe cleanup)
             if (typeof menuManager !== 'undefined' && menuManager.screens && menuManager.screens['login']) {
                menuManager.screens['login'].loadSavedPreferences();
            }
        }
    }

    draw(x, y, w, h) {
        const s = typeof getUIScale === 'function' ? getUIScale() : 1.0;
        rectMode(CORNER);
        fill(255, 255, 255, 200);
        noStroke();
        rect(x, y, w, h, 30 * s);

        fill(0);
        textSize(40 * s);
        textAlign(CENTER, CENTER);
        text("Settings", x + w / 2, y + 80 * s);

        // Responsive layout calculations
        const optionsCount = signedIn ? 4 : 5;
        let headerH = 140 * s; // Reduced header height slightly
        let optionSpacing = 85 * s; // Reduced default spacing
        let showDescriptions = true;
        
        // If content is too tall, compress layout
        if (headerH + (optionsCount * optionSpacing) > h - 20 * s) {
             // Try to fit by reducing spacing
             let availableH = h - headerH - 20 * s;
             optionSpacing = Math.max(50 * s, availableH / optionsCount);
             
             // If heavily compressed, hide descriptions to avoid overlap
             if (optionSpacing < 65 * s) { // Adjusted threshold
                 showDescriptions = false;
             }
        }

        // Draw camera toggle
        let optionY = y + headerH;
        let buttonW = 300 * s;
        let buttonH = 40 * s; // Slightly smaller default height
        if (optionSpacing < 60 * s) buttonH = 30 * s;
        
        // Ensure buttons fit within menu width
        if (buttonW > w - 40 * s) buttonW = w - 40 * s;
        
        this.cameraToggle.setPosition(x + w / 2 - buttonW / 2, optionY);
        this.cameraToggle.setSize(buttonW, buttonH);
        this.cameraToggle.draw();
        
        // Draw camera description
        if (showDescriptions) {
            textSize(14 * s);
            fill(100);
            textAlign(CENTER, TOP);
            // Hug the button closely
            text("Dynamic: Camera follows your mouse cursor", x + w / 2, optionY + buttonH + 2 * s);
            text("Fixed: Camera stays centered on your plane", x + w / 2, optionY + buttonH + 16 * s);
        }

        // Draw screen shake toggle
        optionY += optionSpacing;
        this.shakeToggle.setPosition(x + w / 2 - buttonW / 2, optionY);
        this.shakeToggle.setSize(buttonW, buttonH);
        this.shakeToggle.draw();
        
        // Draw shake description
        if (showDescriptions) {
            textSize(14 * s);
            fill(100);
            textAlign(CENTER, TOP);
            text("Adds subtle camera sway based on speed", x + w / 2, optionY + buttonH + 2 * s);
        }

        // Draw particles toggle
        optionY += optionSpacing;
        this.particlesToggle.setPosition(x + w / 2 - buttonW / 2, optionY);
        this.particlesToggle.setSize(buttonW, buttonH);
        this.particlesToggle.draw();
        
        // Draw particles description
        if (showDescriptions) {
            textSize(14 * s);
            fill(100);
            textAlign(CENTER, TOP);
            text("Reduces quality if too many particles (Recommended)", x + w / 2, optionY + buttonH + 2 * s);
        }

        // Only show reset progress button when not signed in
        let resetButtonIndex = 3;
        let backButtonIndex = 4;
        if (!signedIn) {
            // Draw reset progress button
            optionY += optionSpacing;
            this.resetProgressButton.setPosition(x + w / 2 - buttonW / 2, optionY);
            this.resetProgressButton.setSize(buttonW, buttonH);
            this.resetProgressButton.draw();
            
            // Draw reset description
            if (showDescriptions) {
                textSize(14 * s);
                fill(100);
                textAlign(CENTER, TOP);
                text("Delete saved game and start fresh", x + w / 2, optionY + buttonH + 2 * s);
            }
        } else {
            // If signed in, skip the reset button
            backButtonIndex = 3;
        }

        // Draw back button
        let backBtnW = 200 * s;
        if (backBtnW > w - 40 * s) backBtnW = w - 40 * s;

        optionY += optionSpacing;
        this.backButton.setPosition(x + w / 2 - backBtnW / 2, optionY);
        this.backButton.setSize(backBtnW, buttonH);
        this.backButton.draw();
    }

    navigate(dir) {
        // Determine max options based on signedIn state
        const maxOptions = signedIn ? 4 : 5; // Camera, Shake, Particles, [Reset if !signedIn], Back
        this.selected = (this.selected + dir + maxOptions) % maxOptions;
    }

    choose() {
        if (this.selected === 0) {
            this.cameraToggle.callback();
        } else if (this.selected === 1) {
            this.shakeToggle.callback();
        } else if (this.selected === 2) {
            this.particlesToggle.callback();
        } else if (this.selected === 3) {
            if (!signedIn) {
                this.resetProgressButton.callback();
            } else {
                this.backButton.callback();
            }
        } else if (this.selected === 4) {
            this.backButton.callback();
        }
    }

    mousePressed(mx, my, x, y, w, h) {
        if (this.cameraToggle.mousePressed(mx, my)) {
            this.cameraToggle.callback();
            return;
        }
        
        if (this.shakeToggle.mousePressed(mx, my)) {
            this.shakeToggle.callback();
            return;
        }

        if (this.particlesToggle.mousePressed(mx, my)) {
            this.particlesToggle.callback();
            return;
        }
        
        // Only handle reset button click if not signed in
        if (!signedIn && this.resetProgressButton.mousePressed(mx, my)) {
            this.resetProgressButton.callback();
            return;
        }
        
        if (this.backButton.mousePressed(mx, my)) {
            this.backButton.callback();
            return;
        }
    }

    keyPressed(k) {
        if (k === 'Escape') this.backButton.callback();
    }

    keyTyped(k) {
        // No text input in settings
    }
}