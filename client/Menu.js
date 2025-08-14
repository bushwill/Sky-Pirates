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
        if (name === 'login' && this.colorPicker) {
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
        // Draw the base option background and label
        fill(this.selected ? [0, 200, 255] : 255);
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
        if (keyCode === BACKSPACE) {
            this.value = this.value.slice(0, -1);
            return true;
        }
        return false;
    }
    keyTyped(k) {
        if (!this.focused) return false;
        if (k.length === 1 && this.value.length < 13) {
            this.value += k;
            return true;
        }
        return false;
    }
}

class LoginMenuScreen extends MenuScreen {
    constructor(colorPicker) {
        super("Login");
        this.usernameField = new MenuInputField("Name:", 150, 220, 240, 40);
        this.colorPicker = colorPicker;
        this.loginMsg = '';
        this.color = '#ff8800';

        // Login button option (drawn separately, not in .options array)
        this.loginButton = new MenuOption("Log In", () => this.tryLogin());

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
    }

    draw(x, y, w, h) {
        rectMode(CORNER);
        fill(255, 255, 255, 200);
        noStroke();
        rect(x, y, w, h, 30);

        fill(0);
        textSize(40);

        if (this.colorPicker) {
            this.colorPicker.position(x + w / 2 + 120, y + 183);
        }

        textAlign(CENTER, CENTER);
        text("SKY PIRATES", x + w / 2, y + 50);
        textSize(20)
        text("What be yar bird's nomenclature, matey?", x + w / 2, y + 100)
        text("[Translated] What's your plane's name?", x + w / 2, y + 140)

        // Draw input field centered horizontally
        this.usernameField.x = x + w / 2 - 120;
        this.usernameField.y = y + 170;
        this.usernameField.draw();

        // --- Draw login button ---
        let loginBtnX = x + w / 2 - 60;
        let loginBtnY = y + 270;
        this.loginButton.setPosition(loginBtnX, loginBtnY);
        this.loginButton.setSize(120, 40);
        this.loginButton.selected = (this.selected === -1);
        this.loginButton.draw();

        // --- Draw weapon lists ---
        let listSpacing = 54;
        let listYOffset = loginBtnY + 55;
        let gunListW = 180, gunListH = 44;
        let gunListPad = 40;

        // Gun1 list (left)
        let gun1X = x + w / 2 - gunListW - gunListPad;
        let gun1Y = listYOffset;
        textSize(22);
        fill(0);
        text("Gun 1", gun1X + gunListW / 2, gun1Y - 34);
        for (let i = 0; i < this.gun1Options.length; i++) {
            let opt = this.gun1Options[i];
            opt.setPosition(gun1X, gun1Y + i * listSpacing);
            opt.setSize(gunListW, gunListH);
            // Blue highlight if selected as the weapon, else highlight if navigated
            opt.selected = (this.selected === i) || (selectedGun1 === i);
            opt.draw();
        }

        // Gun2 list (right)
        let gun2X = x + w / 2 + gunListPad;
        let gun2Y = listYOffset;
        textSize(22);
        fill(0);
        text("Gun 2", gun2X + gunListW / 2, gun2Y - 34);
        for (let i = 0; i < this.gun2Options.length; i++) {
            let opt = this.gun2Options[i];
            opt.setPosition(gun2X, gun2Y + i * listSpacing);
            opt.setSize(gunListW, gunListH);
            opt.selected = (this.selected === i + this.gun1Options.length) || (selectedGun2 === i);
            opt.draw();
        }

        // Error message
        textAlign(CENTER, CENTER);
        fill(255, 0, 0); textSize(16);
        text(this.loginMsg, x + w / 2, y + 240);
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
        this.usernameField.mousePressed(mx, my);

        // Login button
        let loginBtnX = x + w / 2 - 60;
        let loginBtnY = y + 270;
        if (mx > loginBtnX && mx < loginBtnX + 120 && my > loginBtnY && my < loginBtnY + 40) {
            this.selected = -1;
            this.loginButton.callback();
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
        if (k === 'ArrowUp') this.navigate(-1);
        if (k === 'ArrowDown') this.navigate(1);
    }
    keyTyped(k) {
        if (this.usernameField.focused) {
            this.usernameField.keyTyped(k);
            return;
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
        // Use weaponNames to get the selected names for login
        loginPlayer(username, {
            r, g, b,
            gun1: this.weaponNames[selectedGun1],
            gun2: this.weaponNames[selectedGun2]
        });
        this.loginMsg = "Logging in...";
    }
}