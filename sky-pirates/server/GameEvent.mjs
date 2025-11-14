// Event class for transient visual effects
export class GameEvent {
  constructor(type, x, y, angle, velocity, size = 0) {
    this.type = type; // 'hit', 'explosion', 'gunshot', etc.
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.velocity = velocity; // For hit events: impact velocity, for gunshot events: projectile speed
    this.size = size; // For explosion/gunshot events: size multiplier
    this.timestamp = Date.now();
  }
}

