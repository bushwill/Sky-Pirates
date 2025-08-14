export class Party {
    constructor(name) {
        this.name = name
        this.players = [];
        this.r = Math.random() * 255;
        this.g = Math.random() * 255;
        this.b = Math.random() * 255;
    }

    addPlayer(player) {
        this.players.push(player.username);
        player.party = {name: this.name, r: this.r, g: this.g, b: this.b};
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
}