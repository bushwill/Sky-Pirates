// Placeholder for plant_overlay.js
// The original file was missing, so this is a placeholder to prevent 404 errors.

function setup() {
  console.log("plant_overlay.js placeholder loaded");
  // Create a canvas that covers the window but is transparent
  let c = createCanvas(windowWidth, windowHeight);
  c.position(0, 0);
  c.style('pointer-events', 'none'); // Let clicks pass through
  c.style('z-index', '1'); // Check if this is appropriate vs other content
  clear(); // Make transparent
  noLoop();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  clear();
}
