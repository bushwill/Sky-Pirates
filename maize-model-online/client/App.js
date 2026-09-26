let canvas;

let angleY = 0;
let touchStartX = 0;
let touchStartY = 0;
let tapThreshold = 10;
let touchGestureMode = null;

let treeButtons = [];
let treeDescriptionsElements = [];
let iterationControls = {};
let customizationPanel = null;
let warningToastElement = null;
let customizationPanelOpen = false;

let sentence = "";
let sentenceTokens = [];
let maxDepth = 1;
let angle;
let baseLen = 10;
const DEFAULT_TREE_SCALE = 5.0;
let treeScale = DEFAULT_TREE_SCALE;

const MIN_ITERATION = 0;
const DEFAULT_ITERATION = 5;
const MAX_ITERATION = 40;
const GENERATION_TIME_LIMIT_MS = 1000;
const TARGET_RENDER_MS = 18;
const SLOW_RENDER_MS = 35;
const MIN_SENTENCE_BUDGET = 12000;
const MAX_SENTENCE_BUDGET = 160000;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const MOBILE_MAX_ZOOM = 6.0;
const MOBILE_ZOOM_DRAG_RATE = 0.994;
const MOBILE_GESTURE_THRESHOLD = 8;
const TRUNK_BASE_LENGTH = 0.18;
const BRANCH_BASE_LENGTH = 0.12;
const PLANT_ORIGIN_PANEL_GAP = 18;
const DEFAULT_TREE_NAME = "Simple Tree";
const TWO_D_TREE_NAMES = ["Simplest Tree", "2D Ashok Samal Tree"];

let sentenceBudget = getInitialSentenceBudget();
let fastRenderFrames = 0;
let overrideComputeLimits = false;
let selected_tree = 0;
let generationHistories = {};
let lastGoodSentence = '';
let lastGoodSentenceTokens = [];
let lastGoodMaxDepth = 0;
let lastDrawFailureSignature = null;

let trees = {
  "Big Tree": {
    "axiom": "G",
    "G": [
      "G [+A]",
      "G [-A]",
      "G [&A]",
      "G [^A]",
      "G T",
      "G"
    ],
    "T": [
      "T",
      "T [+A]",
      "T [-A]",
      "T [&A]",
      "T [^A]"
    ],
    "A": [
      "B",
      "A",
      "A L"
    ],
    "B": [
      "B [+L] [-L] [&L] [^L]",
      "B [+L] [-L] [+A] L",
      "B [&L] [^L] [-A] L",
      "B [+L] [&L] [&A] [-L]",
      "B [-L] [^L] [^A] [+L]",
      "B [+L] [-L] [++A] [&L]",
      "B [&L] [^L] [--A] [-L]",
      "B [+L] [&&A] [-L] [^L]",
      "B [&L] [^^A] [+L] [-L]",
      "B L"
    ],
    "L": [
      "L"
    ]
  },
  "Simple Tree": {
    "axiom": "F",
    "F": [
      "F F",
      "F [F]",
      "F [+F]",
      "F [-F]",
      "F [&F]",
      "F [^F]",
      "F [+&F]",
      "F [-^F]"
    ]
  },
  "Simplest Tree": {
    "axiom": "F",
    "F": [
      "F",
      "F [+F]",
      "F [-F]"
    ]
  },
  "Castro Tree": {
    "axiom": "G",
    "G": [
      "F +[ [G] -G] -F [-F G] +G",
      "F ^[ [G] &G] &F [&F G] ^G"
    ]
  },
  "2D Ashok Samal Tree": {
    "axiom": "F",
    "F": [
      "F [+F] [-F] F"
    ]
  },
  "3D Ashok Samal Tree": {
    "axiom": "F",
    "F": [
      "F[+F][-F][^F][&F]F"
    ]
  }
}

let archivedTrees = {
  "Tong Lin Bush": {
    "axiom": "F",
    "F": [
      "[&F] F [-F [+++A]]F",
      "[+F] F [&&&A]",
      "[^F] F [+++A]"
    ],
    "A": [
      "[++++G] [++G G] [G G G G G G] [-G G G] [--G] [----G]"
    ]
  }
}
let treeDescriptions = {
  "Big Tree": "3D Trunk, buds, branches, and leaves.",
  "Simple Tree": "3D branching abstract tree.",
  "Simplest Tree": "2D branching example.",
  "Castro Tree": "3D plant-like structure.",
  "2D Ashok Samal Tree": "2D deterministic tree-like structure.",
  "3D Ashok Samal Tree": "3D deterministic tree-like structure.",
};

let treeColors = {
  "Big Tree": { r1: 104, g1: 66, b1: 34, r2: 44, g2: 130, b2: 48 },
  "2D Ashok Samal Tree": { r1: 40, g1: 160, b1: 120, r2: 150, g2: 40, b2: 200 },
  "3D Ashok Samal Tree": { r1: 160, g1: 160, b1: 160, r2: 255, g2: 255, b2: 255 },
  "Simple Tree": { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 },
  "Simplest Tree": { r1: 120, g1: 78, b1: 38, r2: 50, g2: 165, b2: 70 },
  "Tong Lin Bush": { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 },
  "Castro Tree": { r1: 200, g1: 64, b1: 160, r2: 200, g2: 160, b2: 64 }
};

function setup() {
  canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  canvas.elt.style.position = 'fixed';
  canvas.elt.style.top = '0';
  canvas.elt.style.left = '0';
  canvas.elt.style.zIndex = '0';
  canvas.elt.style.pointerEvents = 'auto';
  selected_tree = getDefaultTreeIndex();
  angle = radians(22.5);
  createTreeButtons();
  createIterationControls();
  createCustomizationPanel();
  resetToBaseIteration();
}

function getDefaultTreeIndex() {
  let treeKeys = Object.keys(trees);
  let defaultIndex = treeKeys.indexOf(DEFAULT_TREE_NAME);
  return defaultIndex >= 0 ? defaultIndex : 0;
}

function isCurrentTree2D() {
  return TWO_D_TREE_NAMES.includes(Object.keys(trees)[selected_tree]);
}

function getPlantOriginY() {
  if (!customizationPanel || !customizationPanel.elt) {
    return height / 2;
  }

  let panelBounds = customizationPanel.elt.getBoundingClientRect();
  return height / 2 - panelBounds.height - PLANT_ORIGIN_PANEL_GAP;
}

function draw() {
  const renderStart = performance.now();

  background(50);
  directionalLight(255, 255, 255, 0, -1, -1);
  ambientLight(50);

  let is2D = isCurrentTree2D();
  if (is2D) {
    ortho();
  } else {
    perspective();
  }

  translate(0, getPlantOriginY(), 0);

  push();
  scale(treeScale * 2);
  if (!is2D) {
    rotateY(angleY);
  }

  try {
    turtle3DWithDepth(sentenceTokens, baseLen, 0);
    lastGoodSentence = sentence;
    lastGoodSentenceTokens = sentenceTokens;
    lastGoodMaxDepth = maxDepth;
    lastDrawFailureSignature = null;
  } catch (error) {
    handleDrawFailure(error);
  }
  pop();

  updateSentenceBudget(performance.now() - renderStart);
}

function resetToBaseIteration() {
  maxDepth = DEFAULT_ITERATION;
  generateTree(maxDepth);
  updateIterationDisplay();
}

function handleDrawFailure(error) {
  let failureSignature = `${getSelectedTreeName()}::${maxDepth}::${sentenceTokens.length}`;
  console.error('Plant rendering failed, reverting to last safe state:', error);

  if (failureSignature !== lastDrawFailureSignature) {
    lastDrawFailureSignature = failureSignature;
    showIterationWarning('This plant could not be drawn due to an invalid generated structure. Reverted to the last safe view.');
  }

  sentence = lastGoodSentence;
  sentenceTokens = lastGoodSentenceTokens;
  maxDepth = lastGoodMaxDepth;
  updateIterationDisplay();
}

function resimulateCurrentIteration() {
  resetSimulationHistory();
  if (!generateTree(maxDepth)) {
    applySafeIterationLimit();
  }
}

function updateIterationDisplay() {
  if (iterationControls.value) {
    iterationControls.value.html(maxDepth.toString());
  }
}

function updateZoomDisplay() {
  if (iterationControls.zoomValue) {
    iterationControls.zoomValue.html(treeScale.toFixed(2) + 'x');
  }
  if (iterationControls.zoomSlider) {
    iterationControls.zoomSlider.value(treeScale);
  }
}

function showIterationWarning(message) {
  let warning = getWarningToastElement();

  warning.textContent = message;
  warning.style.display = 'block';
  warning.style.opacity = '1';

  clearTimeout(showIterationWarning.timeoutId);
  showIterationWarning.timeoutId = setTimeout(() => {
    warning.style.display = 'none';
    warning.textContent = '';
  }, 1800);
}

function getWarningToastElement() {
  if (warningToastElement) return warningToastElement;

  warningToastElement = document.createElement('div');
  warningToastElement.className = 'iteration-warning-toast';
  warningToastElement.style.position = 'fixed';
  warningToastElement.style.left = '16px';
  warningToastElement.style.top = '16px';
  warningToastElement.style.display = 'none';
  warningToastElement.style.color = '#ffcc66';
  warningToastElement.style.fontSize = '13px';
  warningToastElement.style.maxWidth = 'min(420px, calc(100vw - 32px))';
  warningToastElement.style.lineHeight = '1.35';
  warningToastElement.style.margin = '0';
  warningToastElement.style.zIndex = '10000';
  warningToastElement.style.pointerEvents = 'none';
  warningToastElement.style.background = 'rgba(20, 16, 8, 0.88)';
  warningToastElement.style.border = '1px solid rgba(255, 204, 102, 0.5)';
  warningToastElement.style.borderRadius = '6px';
  warningToastElement.style.padding = '8px 10px';
  warningToastElement.style.boxShadow = '0 8px 18px rgba(0, 0, 0, 0.28)';
  document.body.appendChild(warningToastElement);

  return warningToastElement;
}

function isComputeLimitOverridden() {
  if (iterationControls.overrideInput) {
    return iterationControls.overrideInput.checked;
  }

  return overrideComputeLimits;
}

function setComputeLimitOverride(enabled) {
  overrideComputeLimits = enabled;

  if (iterationControls.overrideInput && iterationControls.overrideInput.checked !== enabled) {
    iterationControls.overrideInput.checked = enabled;
  }

  if (overrideComputeLimits) {
    showIterationWarning('Compute limits overridden. High iterations may freeze this browser.');
  } else {
    showIterationWarning('Compute limits restored.');
    applySafeIterationLimit();
  }
}

function getInitialSentenceBudget() {
  let budget = 35000;

  if (navigator.deviceMemory) {
    budget *= Math.min(2, Math.max(0.7, navigator.deviceMemory / 4));
  }
  if (navigator.hardwareConcurrency) {
    budget *= Math.min(1.8, Math.max(0.8, navigator.hardwareConcurrency / 4));
  }
  if (isMobile()) {
    budget *= 0.45;
  }

  return Math.round(Math.max(MIN_SENTENCE_BUDGET, Math.min(MAX_SENTENCE_BUDGET, budget)));
}

function updateSentenceBudget(renderMs) {
  if (renderMs > SLOW_RENDER_MS) {
    sentenceBudget = Math.max(MIN_SENTENCE_BUDGET, Math.floor(sentenceBudget * 0.75));
    fastRenderFrames = 0;
    return;
  }

  if (renderMs < TARGET_RENDER_MS && sentenceTokens.length < sentenceBudget * 0.5) {
    fastRenderFrames++;
    if (fastRenderFrames > 120) {
      sentenceBudget = Math.min(MAX_SENTENCE_BUDGET, Math.floor(sentenceBudget * 1.08));
      fastRenderFrames = 0;
    }
  } else {
    fastRenderFrames = 0;
  }
}

function tokenizeSentence(text, tree_object = null) {
  let tokens = [];

  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (/\s/.test(c)) continue;

    if ('+-&^[]'.includes(c)) {
      tokens.push(c);
      continue;
    }

    if (/[A-Za-z0-9]/.test(c)) {
      let symbol = '';
      while (/[A-Za-z0-9]/.test(text[i] || '')) {
        symbol += text[i];
        i++;
      }
      tokens.push(symbol);
      i--;
    }
  }

  return tokens;
}

function getTokenSymbol(token) {
  let match = String(token).match(/^([A-Za-z0-9]+)/);
  return match ? match[1] : token;
}

function getAxiom(tree_object) {
  return tree_object.axiom || Object.keys(tree_object).find(key => key !== 'axiom');
}

function hasBalancedBrackets(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '[') depth++;
    else if (tokens[i] === ']') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function getSelectedTreeName() {
  return Object.keys(trees)[selected_tree];
}

function getTreeSignature(tree_object) {
  return JSON.stringify(tree_object);
}

function resetSimulationHistory(plantName = getSelectedTreeName()) {
  if (plantName) {
    delete generationHistories[plantName];
  }
}

function getSimulationHistory(treeName, tree_object) {
  let signature = getTreeSignature(tree_object);
  let history = generationHistories[treeName];

  if (!history || history.signature !== signature) {
    let axiomTokens = tokenizeSentence(getAxiom(tree_object), tree_object);
    if (!hasBalancedBrackets(axiomTokens)) {
      showIterationWarning(`The axiom for ${treeName} has unbalanced brackets and cannot be drawn. Using a blank axiom instead.`);
      axiomTokens = [];
    }
    history = {
      signature,
      generations: [
        { sentence: tokensToSentence(axiomTokens), tokens: axiomTokens }
      ]
    };
    generationHistories[treeName] = history;
  }

  return history;
}

function tokensToSentence(tokens) {
  return tokens.join(' ');
}

function countTokens(tokens) {
  let counts = {};
  for (let i = 0; i < tokens.length; i++) {
    let token = getTokenSymbol(tokens[i]);
    counts[token] = (counts[token] || 0) + 1;
  }
  return counts;
}

function estimateMinimumSentenceLengthForDepth(depth, tree_object, limit) {
  let counts = countTokens(tokenizeSentence(getAxiom(tree_object), tree_object));
  let total = 1;

  for (let i = 0; i < depth; i++) {
    let nextCounts = {};
    total = 0;

    for (let c in counts) {
      let count = counts[c];
      let replacement = [c];

      if (c in tree_object) {
        let shortest = tree_object[c].reduce((currentShortest, option) => {
          return tokenizeSentence(option, tree_object).length < tokenizeSentence(currentShortest, tree_object).length ? option : currentShortest;
        });
        replacement = tokenizeSentence(shortest, tree_object);
      }

      for (let j = 0; j < replacement.length; j++) {
        let nextToken = replacement[j];
        nextCounts[nextToken] = (nextCounts[nextToken] || 0) + count;
        total += count;

        if (total > limit) {
          return total;
        }
      }
    }

    counts = nextCounts;
  }

  return total;
}

function computeSentenceForDepth(depth, limit = sentenceBudget, timeLimitMs = GENERATION_TIME_LIMIT_MS) {
  let treeKeys = Object.keys(trees);
  if (selected_tree < 0 || selected_tree >= treeKeys.length) {
    console.error("Invalid tree index:", selected_tree);
    return { ok: false, sentence: "", tokens: [], reason: "Invalid tree selection." };
  }

  let treeName = treeKeys[selected_tree];
  let selected_tree_obj = trees[treeName];
  let history = getSimulationHistory(treeName, selected_tree_obj);

  if (!isComputeLimitOverridden()) {
    let minimumLength = estimateMinimumSentenceLengthForDepth(depth, selected_tree_obj, limit);
    if (minimumLength > limit) {
      return { ok: false, sentence: "", tokens: [], reason: `Iteration ${depth} must create at least ${minimumLength.toLocaleString()} commands, above this browser's current safe limit of ${limit.toLocaleString()}. Enable override compute limits to try anyway.` };
    }
  }

  if (history.generations[depth]) {
    let generation = history.generations[depth];
    return { ok: true, sentence: generation.sentence, tokens: generation.tokens };
  }

  while (history.generations.length <= depth) {
    let previousGeneration = history.generations[history.generations.length - 1];
    let deadline = performance.now() + timeLimitMs;
    let result = generate(previousGeneration.tokens, selected_tree_obj, limit, deadline);
    if (!result.ok) {
      return result;
    }

    if (!hasBalancedBrackets(result.tokens)) {
      return { ok: false, sentence: "", tokens: [], reason: `Iteration ${history.generations.length} has unbalanced brackets in its rules and cannot be drawn safely. Check the rule productions for matching "[" and "]".` };
    }

    history.generations.push({ sentence: result.sentence, tokens: result.tokens });
  }

  let generation = history.generations[depth];
  return { ok: true, sentence: generation.sentence, tokens: generation.tokens };
}

function generateTree(targetDepth = maxDepth) {
  const safeDepth = Math.max(MIN_ITERATION, Math.min(MAX_ITERATION, Math.round(targetDepth)));
  let result = computeSentenceForDepth(safeDepth);
  if (!result.ok) {
    showIterationWarning(result.reason);
    return false;
  }

  sentence = result.sentence;
  sentenceTokens = result.tokens;
  maxDepth = safeDepth;
  updateIterationDisplay();
  return true;
}

function setIteration(nextDepth) {
  const previousDepth = maxDepth;
  const requestedDepth = Math.max(MIN_ITERATION, Math.min(MAX_ITERATION, Math.round(nextDepth)));

  if (requestedDepth === previousDepth) {
    if (nextDepth < MIN_ITERATION) {
      showIterationWarning(`Minimum iteration is ${MIN_ITERATION}.`);
    } else if (nextDepth > MAX_ITERATION) {
      showIterationWarning(`Maximum iteration is ${MAX_ITERATION}.`);
    }
    return;
  }

  let result = computeSentenceForDepth(requestedDepth);
  if (!result.ok) {
    if (requestedDepth < previousDepth) {
      applySafeIterationLimit(requestedDepth);
      return;
    }

    showIterationWarning(`${result.reason} Keeping iteration ${previousDepth}.`);
    return;
  }

  sentence = result.sentence;
  sentenceTokens = result.tokens;
  maxDepth = requestedDepth;
  updateIterationDisplay();
}

function applySafeIterationLimit(startDepth = maxDepth) {
  for (let depth = Math.min(startDepth, MAX_ITERATION); depth >= MIN_ITERATION; depth--) {
    let result = computeSentenceForDepth(depth);
    if (result.ok) {
      let previousDepth = maxDepth;
      sentence = result.sentence;
      sentenceTokens = result.tokens;
      maxDepth = depth;
      updateIterationDisplay();

      if (depth < previousDepth) {
        showIterationWarning(`Compute limits restored. Reduced to iteration ${depth}.`);
      }
      return true;
    }
  }

  resetToBaseIteration();
  showIterationWarning(`Compute limits restored. Reduced to iteration ${maxDepth}.`);
  return false;
}

function generate(tokens, tree_object, limit = sentenceBudget, deadline = performance.now() + GENERATION_TIME_LIMIT_MS) {
  let next = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isComputeLimitOverridden() && performance.now() > deadline) {
      return { ok: false, sentence: "", tokens: [], reason: "Generation took too long for this browser. Enable override compute limits to try anyway." };
    }

    let c = tokens[i];
    let symbol = getTokenSymbol(c);
    if (symbol in tree_object) {
      let options = tree_object[symbol];
      let replacement = tokenizeSentence(random(options), tree_object);
      if (!isComputeLimitOverridden() && next.length + replacement.length > limit) {
        return { ok: false, sentence: "", tokens: [], reason: `Generated command count would exceed this browser's current safe limit of ${limit.toLocaleString()}. Enable override compute limits to try anyway.` };
      }
      next = next.concat(replacement);
    } else {
      if (!isComputeLimitOverridden() && next.length + 1 > limit) {
        return { ok: false, sentence: "", tokens: [], reason: `Generated command count would exceed this browser's current safe limit of ${limit.toLocaleString()}. Enable override compute limits to try anyway.` };
      }
      next.push(c);
    }
  }
  return { ok: true, sentence: tokensToSentence(next), tokens: next };
}

function getZoomStrokeScale() {
  return treeScale / DEFAULT_TREE_SCALE;
}

function drawWoodSegment(segmentLength, segmentWeight, color) {
  stroke(color.r, color.g, color.b);
  strokeWeight(Math.max(1, segmentWeight * getZoomStrokeScale()));
  line(0, 0, 0, 0, -segmentLength, 0);
  translate(0, -segmentLength, 0);
}

function drawGenericSymbolSegment(len, depth) {
  let t = map(depth, 0, maxDepth, 0, 1);
  let treeName = Object.keys(trees)[selected_tree];
  let colors = treeColors[treeName] || { r1: 139, g1: 69, b1: 19, r2: 34, g2: 139, b2: 34 };
  let r = lerp(colors.r1, colors.r2, t);
  let g = lerp(colors.g1, colors.g2, t);
  let b = lerp(colors.b1, colors.b2, t);

  drawWoodSegment(len, map(len, 1, 100, 0.2, 3), { r, g, b });
}

function drawLeaf() {
  let leafScale = map(maxDepth, MIN_ITERATION, MAX_ITERATION, 1.0, 3.0);

  push();
  scale(leafScale);
  noFill();
  stroke(84, 218, 78);
  strokeWeight(1.25 * getZoomStrokeScale());
  translate(0, -0.6, 0);
  beginShape();
  vertex(0, -1.25, 0);
  vertex(0.42, -0.2, 0);
  vertex(0.16, 0.8, 0);
  vertex(0, 1.05, 0);
  vertex(-0.16, 0.8, 0);
  vertex(-0.42, -0.2, 0);
  endShape(CLOSE);
  line(0, -1.1, 0, 0, 0.95, 0);
  pop();
}

function getTrunkSegmentLength(len) {
  return len * (TRUNK_BASE_LENGTH + maxDepth * 0.18);
}

function getBranchSegmentLength(len) {
  return len * (BRANCH_BASE_LENGTH + maxDepth * 0.14);
}

function turtle3DWithDepth(s, len, depth) {
  let depthStack = [];
  let treeName = Object.keys(trees)[selected_tree];
  let usesBigTreeGraphics = treeName === 'Big Tree';

  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    let symbol = getTokenSymbol(c);
    switch (symbol) {
      case 'T':
        if (usesBigTreeGraphics) {
          drawWoodSegment(getTrunkSegmentLength(len), 5.4 + maxDepth * 0.35, { r: 113, g: 72, b: 36 });
        } else {
          drawGenericSymbolSegment(len, depth);
        }
        break;
      case 'G':
        if (usesBigTreeGraphics) {
          drawWoodSegment(getTrunkSegmentLength(len) * 0.8, 4.6 + maxDepth * 0.25, { r: 123, g: 82, b: 42 });
        } else {
          drawGenericSymbolSegment(len, depth);
        }
        break;
      case 'B':
        if (usesBigTreeGraphics) {
          drawWoodSegment(getBranchSegmentLength(len), 1.1 + maxDepth * 0.16, { r: 126, g: 82, b: 42 });
        } else {
          drawGenericSymbolSegment(len, depth);
        }
        break;
      case 'A':
        if (!usesBigTreeGraphics) {
          drawGenericSymbolSegment(len, depth);
        }
        break;
      case 'L':
        if (usesBigTreeGraphics) {
          drawLeaf();
        } else {
          drawGenericSymbolSegment(len, depth);
        }
        break;
      case 'F':
        drawGenericSymbolSegment(len, depth);
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
        if (depthStack.length === 0) {
          break;
        }
        pop();
        depth = depthStack.pop();
        break;
      default:
        drawGenericSymbolSegment(len, depth);
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
    description.style('color', 'white');
    description.style('position', 'absolute');
    description.style('z-index', '50');
    description.style('pointer-events', 'none');
    treeDescriptionsElements.push(description);

    let btn = createButton(treeName);
    btn.position(10, 60 + i * 60);
    btn.style('position', 'absolute');
    btn.style('z-index', '100');
    btn.style('pointer-events', 'auto');
    btn.mousePressed(() => {
      if (selected_tree === i) return;

      selected_tree = i;
      if (isCurrentTree2D()) {
        angleY = 0;
      }
      renderCustomizationPanel();
      resetToBaseIteration();
    });
    treeButtons.push(btn);
  }
}

function createIterationControls() {
  if (iterationControls.container) {
    iterationControls.container.remove();
  }

  const container = createDiv();
  container.position(windowWidth - 220, 20);
  container.style('position', 'absolute');
  container.style('display', 'flex');
  container.style('flex-direction', 'column');
  container.style('align-items', 'flex-end');
  container.style('gap', '8px');
  container.style('color', 'white');
  container.style('font-family', 'sans-serif');
  container.style('user-select', 'none');
  container.style('z-index', '100');
  container.style('pointer-events', 'auto');

  const iterationRow = createDiv();
  iterationRow.style('display', 'flex');
  iterationRow.style('align-items', 'center');
  iterationRow.style('gap', '8px');

  const label = createP('Iteration');
  label.style('margin', '0');
  label.style('font-size', '14px');

  const minus = createButton('-');
  minus.style('position', 'relative');
  minus.style('z-index', '120');
  minus.style('pointer-events', 'auto');
  minus.mousePressed(() => {
    setIteration(maxDepth - 1);
  });

  const value = createP(maxDepth.toString());
  value.style('margin', '0');
  value.style('min-width', '20px');
  value.style('text-align', 'center');
  value.style('font-size', '18px');
  value.style('font-weight', 'bold');

  const plus = createButton('+');
  plus.style('position', 'relative');
  plus.style('z-index', '120');
  plus.style('pointer-events', 'auto');
  plus.mousePressed(() => {
    setIteration(maxDepth + 1);
  });

  iterationRow.child(label);
  iterationRow.child(minus);
  iterationRow.child(value);
  iterationRow.child(plus);

  const newSimulationButton = createButton('New simulation');
  newSimulationButton.style('position', 'relative');
  newSimulationButton.style('z-index', '120');
  newSimulationButton.style('pointer-events', 'auto');
  newSimulationButton.mousePressed(() => {
    resimulateCurrentIteration();
  });

  const overrideCheckbox = createCheckbox('override compute limits', overrideComputeLimits);
  overrideCheckbox.style('font-size', '12px');
  overrideCheckbox.style('line-height', '1.2');
  overrideCheckbox.style('pointer-events', 'auto');

  const overrideInput = overrideCheckbox.elt.querySelector('input');
  if (overrideInput) {
    overrideInput.checked = overrideComputeLimits;
    overrideInput.addEventListener('change', () => {
      setComputeLimitOverride(overrideInput.checked);
    });
  }

  container.child(iterationRow);
  container.child(newSimulationButton);
  container.child(overrideCheckbox);

  iterationControls = { container, label, minus, value, plus, newSimulationButton, overrideCheckbox, overrideInput };
  updateIterationDisplay();
  updateZoomDisplay();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getRuleSymbols(tree_object) {
  return Object.keys(tree_object).filter(key => key !== 'axiom');
}

function getProductions(tree_object, symbol) {
  return Array.isArray(tree_object[symbol]) ? tree_object[symbol] : [String(tree_object[symbol] || symbol)];
}

function cleanSymbol(value) {
  return String(value).replace(/[^A-Za-z0-9]/g, '').trim();
}

function parseProductions(value, fallbackSymbol) {
  let productions = String(value)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  return productions.length > 0 ? productions : [fallbackSymbol];
}

function uniqueRuleSymbol(tree_object, baseSymbol = 'X') {
  let symbol = baseSymbol;
  let suffix = 1;

  while (symbol in tree_object || symbol === 'axiom') {
    symbol = baseSymbol + suffix;
    suffix++;
  }

  return symbol;
}

function regenerateIfSelectedPlant(plantName) {
  let treeKeys = Object.keys(trees);
  if (treeKeys[selected_tree] === plantName) {
    generateTree(maxDepth);
  }
}

function renderCustomizationPanel() {
  if (!customizationPanel) return;

  let treeKeys = Object.keys(trees);
  let treeName = treeKeys[selected_tree] || treeKeys[0];
  let tree = trees[treeName];
  let rules = getRuleSymbols(tree).map(symbol => `
    <details class="ls-rule">
      <summary>Rule ${escapeHtml(symbol)}</summary>
      <label>Symbol
        <input class="ls-rule-symbol" data-plant="${escapeHtml(treeName)}" data-symbol="${escapeHtml(symbol)}" value="${escapeHtml(symbol)}">
      </label>
      <label>Productions
        <textarea class="ls-rule-productions" data-plant="${escapeHtml(treeName)}" data-symbol="${escapeHtml(symbol)}" rows="${Math.max(2, getProductions(tree, symbol).length)}">${escapeHtml(getProductions(tree, symbol).join('\n'))}</textarea>
      </label>
      <button class="ls-remove-rule" data-plant="${escapeHtml(treeName)}" data-symbol="${escapeHtml(symbol)}">Remove rule</button>
    </details>
  `).join('');

  let selectedPlantSection = `
    <details class="ls-plant" open>
      <summary>${escapeHtml(treeName)}</summary>
      <label>Axiom
        <input class="ls-axiom" data-plant="${escapeHtml(treeName)}" value="${escapeHtml(getAxiom(tree))}">
      </label>
      <div class="ls-rules">${rules}</div>
      <button class="ls-add-rule" data-plant="${escapeHtml(treeName)}">Add rule</button>
    </details>
  `;

  customizationPanel.html(`
    <style>
      .ls-editor summary, .ls-plant summary, .ls-rule summary { cursor: pointer; font-weight: 700; }
      .ls-editor-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; padding-top: 8px; }
      .ls-plant, .ls-rule { border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; padding: 7px; }
      .ls-rule { margin-top: 7px; }
      .ls-editor label { display: flex; flex-direction: column; gap: 4px; margin-top: 7px; font-size: 12px; }
      .ls-editor input, .ls-editor textarea { box-sizing: border-box; width: 100%; border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; background: rgba(255,255,255,0.94); color: #182014; padding: 5px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      .ls-editor textarea { resize: vertical; min-height: 48px; }
      .ls-editor button { margin-top: 7px; border: 1px solid rgba(255,255,255,0.26); border-radius: 4px; background: rgba(255,255,255,0.14); color: white; padding: 5px 8px; cursor: pointer; }
      .ls-editor button:hover { background: rgba(255,255,255,0.22); }
    </style>
    <details class="ls-editor" ${customizationPanelOpen ? 'open' : ''}>
      <summary>${escapeHtml(treeName)} L-system</summary>
      <div class="ls-editor-body">${selectedPlantSection}</div>
    </details>
  `);

  attachCustomizationListeners();
}

function attachCustomizationListeners() {
  let root = customizationPanel.elt;
  let editor = root.querySelector('.ls-editor');

  if (editor) {
    editor.addEventListener('toggle', () => {
      customizationPanelOpen = editor.open;
    });
  }

  root.querySelectorAll('.ls-axiom').forEach(input => {
    input.addEventListener('input', () => {
      let plantName = input.dataset.plant;
      trees[plantName].axiom = input.value.trim() || getAxiom(trees[plantName]);
      resetSimulationHistory(plantName);
      regenerateIfSelectedPlant(plantName);
    });
  });

  root.querySelectorAll('.ls-rule-symbol').forEach(input => {
    input.addEventListener('change', () => {
      let plantName = input.dataset.plant;
      let oldSymbol = input.dataset.symbol;
      let newSymbol = cleanSymbol(input.value);
      if (!newSymbol) {
        input.value = oldSymbol;
        showIterationWarning('Rule symbols can only use letters and numbers.');
        return;
      }

      if (newSymbol !== oldSymbol && newSymbol in trees[plantName]) {
        input.value = oldSymbol;
        showIterationWarning(`Rule ${newSymbol} already exists.`);
        return;
      }

      if (newSymbol !== oldSymbol) {
        let productions = trees[plantName][oldSymbol];
        delete trees[plantName][oldSymbol];
        trees[plantName][newSymbol] = productions;
        if (trees[plantName].axiom === oldSymbol) {
          trees[plantName].axiom = newSymbol;
        }
      }

      resetSimulationHistory(plantName);
      renderCustomizationPanel();
      regenerateIfSelectedPlant(plantName);
    });
  });

  root.querySelectorAll('.ls-rule-productions').forEach(textarea => {
    textarea.addEventListener('input', () => {
      let plantName = textarea.dataset.plant;
      let symbol = textarea.dataset.symbol;
      trees[plantName][symbol] = parseProductions(textarea.value, symbol);
      if (!trees[plantName][symbol].every(option => hasBalancedBrackets(tokenizeSentence(option, trees[plantName])))) {
        showIterationWarning(`Rule ${symbol} has unbalanced brackets. Drawing may be blocked until this is fixed.`);
      }
      resetSimulationHistory(plantName);
      regenerateIfSelectedPlant(plantName);
    });
  });

  root.querySelectorAll('.ls-add-rule').forEach(button => {
    button.addEventListener('click', () => {
      let plantName = button.dataset.plant;
      let symbol = uniqueRuleSymbol(trees[plantName]);
      trees[plantName][symbol] = [symbol];
      resetSimulationHistory(plantName);
      renderCustomizationPanel();
      regenerateIfSelectedPlant(plantName);
    });
  });

  root.querySelectorAll('.ls-remove-rule').forEach(button => {
    button.addEventListener('click', () => {
      let plantName = button.dataset.plant;
      let symbol = button.dataset.symbol;
      let ruleSymbols = getRuleSymbols(trees[plantName]);
      if (ruleSymbols.length <= 1) {
        showIterationWarning('Each plant needs at least one rule.');
        return;
      }

      delete trees[plantName][symbol];
      if (trees[plantName].axiom === symbol) {
        trees[plantName].axiom = getRuleSymbols(trees[plantName])[0];
      }

      resetSimulationHistory(plantName);
      renderCustomizationPanel();
      regenerateIfSelectedPlant(plantName);
    });
  });
}

function createCustomizationPanel() {
  if (customizationPanel) {
    customizationPanel.remove();
  }

  customizationPanel = createDiv();
  customizationPanel.style('position', 'fixed');
  customizationPanel.style('left', '12px');
  customizationPanel.style('right', '12px');
  customizationPanel.style('bottom', '12px');
  customizationPanel.style('max-height', '36vh');
  customizationPanel.style('overflow', 'auto');
  customizationPanel.style('z-index', '180');
  customizationPanel.style('pointer-events', 'auto');
  customizationPanel.style('background', 'rgba(18, 20, 16, 0.86)');
  customizationPanel.style('border', '1px solid rgba(255, 255, 255, 0.22)');
  customizationPanel.style('border-radius', '8px');
  customizationPanel.style('box-shadow', '0 12px 30px rgba(0, 0, 0, 0.35)');
  customizationPanel.style('color', 'white');
  customizationPanel.style('font-family', 'sans-serif');
  customizationPanel.style('padding', '10px 12px');

  renderCustomizationPanel();
}

function mousePressed(event) {
  if (!event || event.target !== canvas.elt) return;
  return false;
}

function mouseDragged(event) {
  if (!event || event.target !== canvas.elt || isMobile() || isCurrentTree2D()) return;

  angleY += movedX * 0.005;
  return false;
}

function touchMoved(event) {
  if (!event || event.target.tagName !== 'CANVAS' || !touches || touches.length === 0) return;

  let dx = mouseX - pmouseX;
  let dy = mouseY - pmouseY;
  let totalDx = mouseX - touchStartX;
  let totalDy = mouseY - touchStartY;

  if (touchGestureMode === null) {
    if (Math.hypot(totalDx, totalDy) < MOBILE_GESTURE_THRESHOLD) {
      return false;
    }

    if (Math.abs(totalDx) >= Math.abs(totalDy)) {
      touchGestureMode = isCurrentTree2D() ? 'none' : 'rotate';
    } else {
      touchGestureMode = 'zoom';
    }

    if (touchGestureMode === 'none') {
      return false;
    }

    let gestureDistance = touchGestureMode === 'rotate' ? totalDx : totalDy;
    let movementPastThreshold = Math.sign(gestureDistance) * Math.max(0, Math.abs(gestureDistance) - MOBILE_GESTURE_THRESHOLD);

    if (touchGestureMode === 'rotate') {
      angleY += movementPastThreshold * 0.005;
    } else {
      treeScale *= pow(MOBILE_ZOOM_DRAG_RATE, movementPastThreshold);
      treeScale = constrain(treeScale, MIN_ZOOM, MOBILE_MAX_ZOOM);
      updateZoomDisplay();
    }
    return false;
  }

  if (touchGestureMode === 'rotate') {
    angleY += dx * 0.005;
  } else if (touchGestureMode === 'zoom') {
    treeScale *= pow(MOBILE_ZOOM_DRAG_RATE, dy);
    treeScale = constrain(treeScale, MIN_ZOOM, MOBILE_MAX_ZOOM);
    updateZoomDisplay();
  }
  return false;
}

function touchStarted(event) {
  if (event.target.tagName !== 'CANVAS') return;

  touchStartX = mouseX;
  touchStartY = mouseY;
  touchGestureMode = null;
  return false;
}

function touchEnded(event) {
  if (event.target.tagName !== 'CANVAS') return;
  touchGestureMode = null;
  return false;
}

function mouseWheel(event) {
  if (!event || event.target !== canvas.elt) return true;

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
  if (iterationControls.container) {
    iterationControls.container.position(windowWidth - 220, 20);
  }
}
