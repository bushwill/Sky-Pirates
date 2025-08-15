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
        if (player.party && player.party.name !== this.name) {
            // Find previous party by name and remove player
            if (typeof parties !== 'undefined') {
                const oldParty = parties.find(p => p.name === player.party.name);
                if (oldParty) oldParty.removePlayer(player);
            }
        }
        // Prevent duplicates
        if (!this.players.includes(player)) {
            this.players.push(player);
            // Store only serializable info
            player.party = { name: this.name, r: this.r, g: this.g, b: this.b };
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