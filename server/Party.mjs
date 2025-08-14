export class Party {
    constructor(name) {
        this.name = name;
        this.players = []; // Store player object references
        this.r = Math.random() * 255;
        this.g = Math.random() * 255;
        this.b = Math.random() * 255;
    }

    addPlayer(player) {
        // Remove from previous party if necessary
        if (player.party && player.party.name !== this.name && player.party._partyRef) {
            player.party._partyRef.removePlayer(player);
        }
        // Prevent duplicates
        if (!this.players.includes(player)) {
            this.players.push(player);
            // Store reference to this party for future removal
            player.party = {name: this.name, r: this.r, g: this.g, b: this.b, _partyRef: this};
        }
    }

    removePlayer(player) {
        const index = this.players.indexOf(player);
        if (index !== -1) {
            this.players.splice(index, 1);
            player.party = null;
        } else {
            console.error("Player not found in party:", player.username);
        }
    }

    getPlayerUsernames() {
        return this.players.map(p => p.username);
    }
}