export class Crate{
    constructor(x, y, type = 'money', cargo = 100) {
        this.type = type; // 'ammo', 'health', 'parts'
        this.cargo = cargo;

        this.size = 5; // Size of the crate
        this.weight = 1; // Weight of the crate

        this.x = x;
        this.y = y;
        this.vx = 0; // Initial horizontal velocity
        this.vy = 0; // Initial vertical velocity
        this.angle = 0;
        this.carrier = null; // Entity currently carrying the crate, if any (in string form)
    }
    
    // Method to apply the crate's effect to a player
    attach(player) {
        this.carrier = player; // Set the carrier to the player who picked up the crate
    }

    detach() {
        this.carrier = null; // Clear the carrier reference when the crate is dropped
    }

    open(player) {
        if (this.type === 'money') {
            player.money += parseInt(this.cargo, 10);
        } else if (this.type === 'component') {
            this.cargo.position = player.inventory.length + 1; // Set the position in the inventory
            player.inventory.push(this.cargo); // Add component to player's inventory
        }
        player.detachCrate(this); // Detach the crate from the player
    }
} 