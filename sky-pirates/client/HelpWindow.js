// --- Text content variables ---
const controlsText = "WASD: Move\nWS: Increase/decrease throttle\nAD: Turn left/right\nC: Switch weapons\nF: Drop crate\nR: Repair hull\nMouse: Aim\nLeft Click: Fire\nEnter: Open/close chat";
const tutorialText = "Collect crates for upgrades to become the most powerful pirate.\nOpen crates at spawn base (Big Green Rectangle).\nFight with or against other pirates\nFind rare components/weapons in crates\nGood luck, pirate!";

// Draws the help window overlay
function drawHelpWindow() {
	push();
	textAlign(CENTER, CENTER);
	rectMode(CENTER);
	fill(50, 50, 50, 220);
	stroke(255);
	rect(windowWidth/2, windowHeight/2, windowWidth*0.8, windowHeight*0.7, 20);
	fill(255);
	// Title
	textSize(30);
	text('Help Window', windowWidth/2, windowHeight/2 - windowHeight*0.33);

	// Column positions
	const col1 = windowWidth/2 - windowWidth*0.15;
	const col2 = windowWidth/2 + windowWidth*0.15;
	const topY = windowHeight/2 - windowHeight*0.22;

	// Controls Section (Left)
	textAlign(CENTER, TOP);
	textSize(20);
	text('Controls', col1, topY);
	textSize(15);
	text(controlsText, col1, topY + 35);

	// Tutorial Section (Right)
	textSize(20);
	text('How to Play', col2, topY);
	textSize(15);
	text(tutorialText, col2, topY + 35);

	// Footer
	textAlign(CENTER, CENTER);
	textSize(12);
	text('Press H key to close this window.', windowWidth/2, windowHeight/2 + windowHeight*0.33);
	pop();
}
