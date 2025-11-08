// Event class for transient visual effects
export class GameEvent {
  constructor(type, x, y, angle, velocity) {
    this.type = type; // 'hit', 'explosion', etc.
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.velocity = velocity;
    this.timestamp = Date.now();
  }
}
