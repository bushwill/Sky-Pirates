// --- Text content variables ---
const controlsText = "Esc.: Pause menu\nWASD: Move\nWS: Increase/decrease throttle\nAD: Turn left/right\nC: Switch weapons\nF: Drop crate\nR: Repair hull\nMouse: Aim\nLeft Click: Fire\nEnter: Open/close chat";
const gameText = "Collect crates for upgrades to become the most powerful pirate.\nOpen crates at recovery zones (Big Green Rectangles).\nThe further away the crate is found, the better the rewards.\nFight with or against other pirates\nAvoid the navy, they're out to collect crates too.\nGood luck, pirate!";
const pilotText = "Plane chassis can overheat and cause hull damage.\nEngines generate heat when throttled.\nHigh speeds generate friction heat.\nWings require minimum speeds to generate lift.\nGoing to slowly will cause your plane to stall.\nIt's harder to turn at higher speeds.\nWeight is added to your plane by component weight and crates carried.\nMore weight means slower climbing and faster diving.";

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

	// Two column positions
	const col1 = windowWidth/2 - windowWidth*0.2;
	const col2 = windowWidth/2 + windowWidth*0.2;
	const topY = windowHeight/2 - windowHeight*0.22;
	const midY = windowHeight/2 - windowHeight*0.02;

	// Controls Section (Left Column)
	textAlign(CENTER, TOP);
	textSize(20);
	text('Controls', col1, topY);
	textSize(15);
	text(controlsText, col1, topY + 35);

	// Tutorial Section (Right Column - Top)
	textSize(20);
	text('How to Play', col2, topY);
	textSize(15);
	text(gameText, col2, topY + 35);

	// Pilot Tips Section (Right Column - Bottom)
	textSize(20);
	text('Pilot Tips', col2, midY);
	textSize(15);
	text(pilotText, col2, midY + 35);

	// Footer
	textAlign(CENTER, CENTER);
	textSize(12);
	text('Press H key to close this window.', windowWidth/2, windowHeight/2 + windowHeight*0.33);
	pop();
}
