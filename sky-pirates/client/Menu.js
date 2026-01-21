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
        this.selected = 0;
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

        fill(0);
        textSize(32);
        textAlign(CENTER, TOP);
        text(this.title, x + w / 2, y + 40);

        // Fields
        let contentX = x + w / 2 - 120;
        let contentY = y + 120;

        this.usernameField.x = contentX;
        this.usernameField.y = contentY;
        this.usernameField.draw();

        contentY += 60;
        this.passwordField.x = contentX;
        this.passwordField.y = contentY;
        this.passwordField.draw();

        if (this.mode === 'create' && this.confirmPasswordField) {
             contentY += 60;
             this.confirmPasswordField.x = contentX;
             this.confirmPasswordField.y = contentY;
             this.confirmPasswordField.draw();
        }

        // Message
        contentY += 60;
        textSize(16);
        fill(this.msg.startsWith("Success") ? [0,150,0] : [200,0,0]);
        textAlign(CENTER, TOP);
        text(this.msg, x + w / 2, contentY);

        // Buttons
        contentY += 40;
        this.submitButton.setPosition(x + w / 2 - 100, contentY);
        this.submitButton.setSize(200, 40);
        this.submitButton.selected = (this.selected === 0);
        this.submitButton.draw();

        contentY += 50;
        this.backButton.setPosition(x + w / 2 - 100, contentY);
        this.backButton.setSize(200, 40);
        this.backButton.selected = (this.selected === 1);
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
            this.selected = 0;
            this.submitButton.callback();
            return;
        }
        if (this.backButton.mousePressed(mx, my)) {
            this.selected = 1;
            this.backButton.callback();
            return;
        }
    }

    keyPressed(k) {
         if (this.usernameField.focused) this.usernameField.keyPressed(k);
         else if (this.passwordField.focused) this.passwordField.keyPressed(k);
         else if (this.mode === 'create' && this.confirmPasswordField && this.confirmPasswordField.focused) this.confirmPasswordField.keyPressed(k);
         else if (k === 'Enter') this.choose();
         else if (k === 'ArrowUp') this.navigate(-1);
         else if (k === 'ArrowDown') this.navigate(1);
    }
    
    keyTyped(k) {
         if (this.usernameField.focused) this.usernameField.keyTyped(k);
         else if (this.passwordField.focused) this.passwordField.keyTyped(k);
         else if (this.mode === 'create' && this.confirmPasswordField && this.confirmPasswordField.focused) this.confirmPasswordField.keyTyped(k);
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
        this.selected = 0;
        this.isSessionActive = false;
        this.serverSaveExists = true; // Assume true until server says otherwise
        this.isAccountSession = false; // Add explicit instance property for account state
        this.accountName = null; // Add explicit instance property for account name
        // Side menu data
        this.leftMenuList = ["Tip: Press M for Map", "Tip: Press I for Inventory", "Tip: Press B for Shop"];
        this.rightMenuList = ["Online Players:", "Loading..."]; 
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

        // Update local state from global if needed (legacy compatibility) but prefer instance state
        if (typeof isAccountSession !== 'undefined' && isAccountSession && !this.isAccountSession) {
             this.isAccountSession = true;
        }

        // Draw Side Menus
        let sideW = Math.max(200, width * 0.2);
        let gap = 20;

        // Left Panel
        let leftX = x - gap - sideW;
        if (leftX > -sideW * 0.5) { 
            fill(255, 255, 255, 200);
            noStroke();
            rect(leftX, y, sideW, h, 30);

            fill(0);
            textSize(24);
            textAlign(CENTER, TOP);
            text("Game Info", leftX + sideW / 2, y + 30);

            textSize(16);
            textAlign(CENTER, TOP);
            if (this.leftMenuList) {
                for (let i = 0; i < this.leftMenuList.length; i++) {
                    text(this.leftMenuList[i], leftX + sideW / 2, y + 80 + i * 35);
                }
            }
        }

        // Right Panel
        let rightX = x + w + gap;
        if (rightX < width + sideW * 0.5) {
            fill(255, 255, 255, 200);
            noStroke();
            rect(rightX, y, sideW, h, 30);

            fill(0);
            textSize(24);
            textAlign(CENTER, TOP);
            text(signedIn ? "Online" : "Community", rightX + sideW / 2, y + 30);

            textSize(16);
            textAlign(CENTER, TOP);
            if (this.rightMenuList) {
                for (let i = 0; i < this.rightMenuList.length; i++) {
                    text(this.rightMenuList[i], rightX + sideW / 2, y + 80 + i * 35);
                }
            }
        }

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

        // Login button - updated to match new position (right of party field)
        let loginBtnX = x + w / 2 + 120 + 10;
        let loginBtnY = y + 220;
    this.loginButton.setPosition(loginBtnX, loginBtnY);
    this.loginButton.setSize(120, 40);
    // Change label when signed in: allow changing party mid-match
    if (signedIn) {
        this.loginButton.label = "Change Party";
    } else {
        this.loginButton.label = this.hasSavedState ? "Continue" : "Start";
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

        // Error message / status text
        // If logged in via account, and in PAUSE menu or Lobby, show "Logged in as" instead of generic messages,
        // unless there is a specific error/status message (like "Updating party...")
        
        let showLoginMsg = true;

        if (signedIn && this.isAccountSession && this.accountName) {
            // In pause menu for account users: replace loginMsg with account info
            // But if we are "Updating party...", we might want to show that momentarily?
            // The user requested "loginmsg shouldn't appear in the pause menu anymore"
            // So we prioritize account text.
            showLoginMsg = false;
            
            textAlign(CENTER, CENTER);
            textSize(14);
            fill(80); 
            text("Logged in as: " + this.accountName, x + w / 2, y + 280);
        }

        if (showLoginMsg && this.loginMsg) {
            textAlign(CENTER, CENTER);
            fill(0); 
            textSize(16);
            text(this.loginMsg, x + w / 2, y + 280); 
        }

        // --- Draw weapon lists ---
        // If the player is already signed in, or if resuming is available (AND verified by server), hide weapon selection
        // Exception: If server hasn't responded yet (serverSaveExists is true/undefined), trust cookie for momentary flicker prevention,
        // but if server strictly says false, show weapons.
        if (!signedIn && (!this.hasSavedState || this.serverSaveExists === false)) {
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
        
        // Drawn account management buttons or logout button
        if (!signedIn) {
            let btnY = y + h - 60;
            // Check global 'isAccountSession' (assume undefined = guest)
            
            if (this.isAccountSession) {
                 if (this.accountName) {
                     textSize(14);
                     textAlign(CENTER, BOTTOM);
                     fill(80); // Dark Gray
                     text("Logged in as: " + this.accountName, x + w/2, btnY - 5);
                 }

                 this.logoutBtn.setPosition(x + w/2 - 75, btnY);
                 this.logoutBtn.setSize(150, 40);
                 this.logoutBtn.draw();
            } else {
                 this.createAccountBtn.setPosition(x + w/2 - 160, btnY);
                 this.createAccountBtn.setSize(150, 40);
                 this.createAccountBtn.draw();

                 this.loginAccountBtn.setPosition(x + w/2 + 10, btnY);
                 this.loginAccountBtn.setSize(150, 40);
                 this.loginAccountBtn.draw();
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
                if (typeof menuVisible !== 'undefined') menuVisible = false;
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
        
        // Optimized particles toggle option
        this.particlesToggle = new MenuOption(
            settings.optimizedParticles ? "Particles: Optimized" : "Particles: High Quality",
            () => this.toggleParticles()
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
            
            // If logged in via account, resetting progress means deleting the SERVER save but keeping the account
            if (this.isAccountSession) {
                const playerId = getCookie('skyPiratesClientId');
                if (playerId && ws && ws.readyState === WebSocket.OPEN) {
                    // Send reset command to server to wipe the save file but keep the session active
                    sendResetAccountProgress(playerId);
                    
                    alert("Account progress reset! You can now start a new game.");
                    
                    // Update UI state to reflect no save
                    this.hasSavedState = false;
                    this.serverSaveExists = false;
                    this.loginButton.label = "Start";
                    return; 
                }
            }

            // GUEST MODE: Delete the client ID cookie to lose the link
            deleteCookie('skyPiratesClientId');
            
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

        // Draw particles toggle
        optionY += optionSpacing;
        this.particlesToggle.setPosition(x + w / 2 - 150, optionY);
        this.particlesToggle.setSize(300, 50);
        this.particlesToggle.selected = (this.selected === 2);
        this.particlesToggle.draw();
        
        // Draw particles description
        textSize(14);
        fill(100);
        textAlign(CENTER, TOP);
        text("Reduces quality if too many particles (Recommended)", x + w / 2, optionY + 60);

        // Only show reset progress button when not signed in
        let resetButtonIndex = 3;
        let backButtonIndex = 4;
        if (!signedIn) {
            // Draw reset progress button
            optionY += optionSpacing;
            this.resetProgressButton.setPosition(x + w / 2 - 150, optionY);
            this.resetProgressButton.setSize(300, 50);
            this.resetProgressButton.selected = (this.selected === 3);
            this.resetProgressButton.draw();
            
            // Draw reset description
            textSize(14);
            fill(100);
            textAlign(CENTER, TOP);
            text("Delete saved game and start fresh", x + w / 2, optionY + 60);
        } else {
            // If signed in, skip the reset button
            backButtonIndex = 3;
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
            this.selected = 0;
            this.cameraToggle.callback();
            return;
        }
        
        if (this.shakeToggle.mousePressed(mx, my)) {
            this.selected = 1;
            this.shakeToggle.callback();
            return;
        }

        if (this.particlesToggle.mousePressed(mx, my)) {
            this.selected = 2;
            this.particlesToggle.callback();
            return;
        }
        
        // Only handle reset button click if not signed in
        if (!signedIn && this.resetProgressButton.mousePressed(mx, my)) {
            this.selected = 3;
            this.resetProgressButton.callback();
            return;
        }
        
        if (this.backButton.mousePressed(mx, my)) {
            this.selected = signedIn ? 3 : 4;
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