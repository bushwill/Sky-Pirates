let canvas;

let angleY = 0;
let touchStartX = 0;
let touchStartY = 0;
let tapThreshold = 10;

let depthInputLabel;
let treeButtons = [];
let treeDescriptionsElements = [];

let sentence = "";
let maxDepth = 6;
let depthInput;
let angle;
let baseLen = 10;
let treeScale = 1.0;

let selected_tree = 0;

let trees = {
  "My Tree":
  {
    "F":
      [
        "FF",
        "[+F]F[-F]",
        "[^F]F[&F]",
        "[+F][^F]",
        "[-F]",
        "F[+F]F",
        "F[^F]F[+F]",
        "F[-F]F",
        "F[&F]F[-F]",
        "F[+F][-F][+F][^F][&F]"
      ]
  },
  "Tong Lin Bush": {
    "F": [
      "[&F]F[-F[+++A]]F",
      "[+F]F[&&&A]",
      "[^F]F[+++A]"
    ],
    "A": [
      "[++++G][++GG][GGGGGG][-GGG][--G][----G]"
    ]
  },
  "Castro Tree": {
    "G": [
      "F+[[G]-G]-F[-FG]+G",
      "F^[[G]&G]&F[&FG]^G"
    ]
  },
  "2D Ashok Samal Tree": {
    "F": [
      "F[+F][-F]F"
    ]
  },
  "3D Ashok Samal Tree": {
    "F": [
      "F[+F][-F][^F][&F]F"
    ]
  }
}
let treeDescriptions = {
  "My Tree": "A branching abstract tree.",
  "Tong Lin Bush": "Inspired by natural recursion.",
  "Castro Tree": "A plant-like structure.",
  "2D Ashok Samal Tree": "A 2D deterministic tree-like structure.",
  "3D Ashok Samal Tree": "A 3D deterministic tree-like structure. Not recommended."
};

let treeColors = {
  "My Tree": { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 },
  "Tong Lin Bush": { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 },
  "Castro Tree": { r1: 200, g1: 64, b1: 160, r2: 200, g2: 160, b2: 64},
  "2D Ashok Samal Tree": { r1: 40, g1: 160, b1: 120, r2: 150, g2: 40, b2: 200 },
  "3D Ashok Samal Tree": { r1: 160, g1: 160, b1: 160, r2: 255, g2: 255, b2: 255 }
};

function setup() {
  canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  angle = radians(22.5);
  createTreeButtons();
  createDepthInput();
  generateTree();
}

function draw() {
  background(50);
  selectAll('p').forEach(p => p.style('color', 'white'));
  directionalLight(255, 255, 255, 0, -1, -1);
  ambientLight(50);
  translate(0, height / 2, 0);
  if (abs(movedX) > 0) {
    angleY += movedX * 0.005;
  }

  push();
  scale(treeScale * 2);
  rotateY(angleY);
  turtle3DWithDepth(sentence, baseLen, 0);
  pop();
}

function generateTree() {
  let treeKeys = Object.keys(trees);
  if (selected_tree < 0 || selected_tree >= treeKeys.length) {
    console.error("Invalid tree index:", selected_tree);
    return;
  }
  let selected_tree_obj = trees[treeKeys[selected_tree]];
  sentence = Object.keys(selected_tree_obj)[0];
  for (let i = 0; i < maxDepth; i++) {
    sentence = generate(sentence, selected_tree_obj);
  }
}

function generate(s, tree_object) {
  let next = "";
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c in tree_object) {
      let options = tree_object[c];
      next += random(options);
    } else {
      next += c;
    }
  }
  return next;
}

function turtle3DWithDepth(s, len, depth) {
  let depthStack = [];

  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    switch (c) {
      case 'F':
        let t = map(depth, 0, maxDepth, 0, 1);
        let treeName = Object.keys(trees)[selected_tree];
        let colors = treeColors[treeName] || { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 };
        let r = lerp(colors.r1, colors.r2, t);
        let g = lerp(colors.g1, colors.g2, t);
        let b = lerp(colors.b1, colors.b2, t);
        stroke(r, g, b);
        strokeWeight(map(len, 1, 100, 0.2, 3));
        line(0, 0, 0, 0, -len, 0);
        translate(0, -len, 0);
        break;
      case '+':
        rotateZ(angle);
        break;
      case '-':
        rotateZ(-angle);
        break;
      case '&':
        rotateX(angle);
        break;
      case '^':
        rotateX(-angle);
        break;
      case '[':
        push();
        depthStack.push(depth + 1);
        break;
      case ']':
        pop();
        depth = depthStack.pop();
        break;
    }
  }
}

function createTreeButtons() {
  for (let el of treeButtons) el.remove();
  for (let el of treeDescriptionsElements) el.remove();
  treeButtons = [];
  treeDescriptionsElements = [];

  let treeKeys = Object.keys(trees);
  for (let i = 0; i < treeKeys.length; i++) {
    let treeName = treeKeys[i];

    let description = createP(treeDescriptions[treeName] || treeName);
    description.position(10, 20 + i * 60);
    treeDescriptionsElements.push(description);

    let btn = createButton(treeName);
    btn.position(10, 60 + i * 60);
    btn.mousePressed(() => {
      selected_tree = i;
      generateTree();
    });
    treeButtons.push(btn);
  }
}

function createDepthInput() {
  if (depthInput) depthInput.remove();
  if (depthInputLabel) depthInputLabel.remove();

  if (isMobile()) {
    depthInput = null;
    depthInputLabel = null;
    return;
  }

  depthInputLabel = createP("Complexity");
  depthInputLabel.position(windowWidth - 100, 20);

  depthInput = createInput(maxDepth.toString());
  depthInput.position(windowWidth - 100, 60);
  depthInput.size(50);
  depthInput.input(() => {
    const val = parseInt(depthInput.value());
    if (!isNaN(val) && val >= 0 && val <= 10) {
      maxDepth = val;
      generateTree();
    }
  });
}

function mousePressed(event) {
  let bounds = canvas.elt.getBoundingClientRect();
  let x = event.clientX;
  let y = event.clientY;

  if (
    x >= bounds.left && x <= bounds.right &&
    y >= bounds.top && y <= bounds.bottom
  ) {
    generateTree();
  }
}

function touchMoved() {
  let dx = mouseX - pmouseX;
  angleY += dx * 0.005;
  return false;
}

function touchStarted(event) {
  if (event.target.tagName !== 'CANVAS') return;

  touchStartX = mouseX;
  touchStartY = mouseY;
  return false;
}

function touchEnded(event) {
  if (event.target.tagName !== 'CANVAS') return;

  let dx = mouseX - touchStartX;
  let dy = mouseY - touchStartY;
  let distMoved = sqrt(dx * dx + dy * dy);

  if (distMoved < tapThreshold) {
    generateTree();
  }
  return false;
}

function mouseWheel(event) {
  let delta = event.deltaY;
  treeScale *= pow(0.95, delta / 100);
  treeScale = constrain(treeScale, 0.1, 10);
  return false;
}

function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod|Tablet/i.test(navigator.userAgent);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  createTreeButtons();
  createDepthInput();
}
