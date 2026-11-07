import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCurrentMatchPlayer,
  isMatchTimerUrgent,
  isUniqueGadgetAvailableInLoadoutShop,
  RoomLobby,
} from '../src/ui/RoomLobby.js';
import { getPostGameCountdownLabel } from '../src/game/MatchStatus.js';
import { GADGET_DEFINITIONS, SPY_CAMERA_ID } from '../../shared/GadgetModel.js';
import { getTeamGroup } from '../../shared/GameRules.js';

function createLobby() {
  const calls = { shown: null, hidden: 0, feedback: null, roomControls: null };
  const lobby = Object.assign(Object.create(RoomLobby.prototype), {
    roomClient: {
      clearReliableOutbox() {},
      setSessionToken() {},
    },
    gameView: {
      computationLevel: 'LOW',
      hide() { calls.hidden += 1; },
      show(state, playerId) { calls.shown = { state, playerId }; },
    },
    computationLevel: 'LOW',
    lastAdaptiveInventoryRenderAt: -Infinity,
    lastAdaptiveMatchUiRenderAt: -Infinity,
    renderWeaponAmmo() {},
    elements: {
      connectedMessage: { textContent: '' },
      roomCredentialsToggle: {
        hidden: true,
        textContent: '',
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
      },
      roomCredentials: { hidden: true },
      roomCredentialName: { textContent: '' },
      roomCredentialPassword: { textContent: '' },
      lobby: { hidden: false },
      roomView: { hidden: true },
    },
    showFeedback(message, isError) { calls.feedback = { message, isError }; },
    renderRoomControls(state) { calls.roomControls = state; },
  });
  return { lobby, calls };
}

describe('RoomLobby session recovery', () => {
  it('labels continuing custom-series and completed postgame countdowns correctly', () => {
    assert.equal(getPostGameCountdownLabel({
      quickPlay: false,
      customSeriesState: { phase: 'postgame' },
    }), 'Next match');
    assert.equal(getPostGameCountdownLabel({
      quickPlay: false,
      customSeriesState: { phase: 'complete' },
    }), 'Returning to lobby');
    assert.equal(getPostGameCountdownLabel({ quickPlay: true }), 'Returning to lobby');
  });

  it('uses the controlled bot as the local match player', () => {
    const human = { id: 'human-1', alive: false };
    const bot = { id: 'bot-1', isBot: true, controlledById: 'human-1', alive: true };

    assert.equal(getCurrentMatchPlayer([human, bot], 'human-1'), bot);
    assert.equal(getCurrentMatchPlayer([human], 'human-1'), human);
    assert.equal(getCurrentMatchPlayer([bot], 'missing-human'), null);
  });

  it('toggles visibility of the joined room name and password', () => {
    const { lobby } = createLobby();
    lobby.setRoomCredentials('Private scrim', 'invite-code');

    assert.equal(lobby.elements.roomCredentialName.textContent, 'Private scrim');
    assert.equal(lobby.elements.roomCredentialPassword.textContent, 'invite-code');
    assert.equal(lobby.elements.roomCredentialsToggle.hidden, false);
    assert.equal(lobby.elements.roomCredentials.hidden, true);

    lobby.toggleRoomCredentials();
    assert.equal(lobby.elements.roomCredentials.hidden, false);
    assert.equal(lobby.elements.roomCredentialsToggle.attributes['aria-expanded'], 'true');
    assert.equal(lobby.elements.roomCredentialsToggle.textContent, 'Hide room details');

    lobby.toggleRoomCredentials();
    assert.equal(lobby.elements.roomCredentials.hidden, true);
    assert.equal(lobby.elements.roomCredentialsToggle.attributes['aria-expanded'], 'false');
  });

  it('allows distinct shop selections to queue while another selection is pending', () => {
    const { lobby } = createLobby();
    lobby.pendingShopSelections = new Set();
    lobby.pendingShopGadgetIds = new Set();
    lobby.renderWeaponSelection = () => {};

    assert.equal(lobby.beginShopSelection('weapon:assault-rifle'), true);
    assert.equal(lobby.beginShopSelection('gadget:bio-field', 'bio-field'), true);
    assert.equal(lobby.beginShopSelection('item:armor:armor:1'), true);
    assert.equal(lobby.beginShopSelection('weapon:assault-rifle'), false);
    assert.deepEqual([...lobby.pendingShopGadgetIds], ['bio-field']);

    assert.equal(lobby.beginShopSelection('skip'), true);
    assert.equal(lobby.beginShopSelection('gadget:sonar', 'sonar'), false);
    lobby.finishShopSelection('skip');
    lobby.finishShopSelection('gadget:bio-field', 'bio-field');
    assert.equal(lobby.pendingShopGadgetIds.size, 0);
  });

  it('renders bot settings without the removed team-panel container', () => {
    const { lobby } = createLobby();
    lobby.roomClient.socket = { readyState: 1 };
    lobby.botAssignmentButtons = new Map();
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket ??= { OPEN: 1 };

    try {
      lobby.renderBotSettings({
        quickPlay: false,
        match: null,
        players: [],
        bots: { roster: [] },
      }, true);
    } finally {
      if (originalWebSocket === undefined) delete globalThis.WebSocket;
    }
  });

  it('offers teammate bot takeover to eliminated players and explains when none are available', () => {
    const originalDocument = globalThis.document;
    const originalWebSocket = globalThis.WebSocket;
    const buttons = [];
    globalThis.document = {
      createElement() {
        const button = {
          dataset: {},
          classList: { toggle() {} },
        };
        buttons.push(button);
        return button;
      },
    };
    globalThis.WebSocket ??= { OPEN: 1 };
    const { lobby } = createLobby();
    lobby.currentPlayerId = 'player-1';
    lobby.roomClient.socket = { readyState: 1 };
    lobby.botTakeoverButtons = new Map();
    const options = {
      children: [],
      append(button) { this.children.push(button); },
      replaceChildren() { this.children = []; },
    };
    lobby.elements = {
      botTakeoverPanel: { hidden: true },
      botTakeoverHelp: { textContent: '' },
      botTakeoverOptions: options,
    };
    const state = {
      players: [{ id: 'player-1', team: 'red' }],
      match: {
        players: [
          { id: 'player-1', team: 'red', isSpectator: true, alive: true, health: 100 },
          { id: 'bot-1', name: 'Red Bot', team: 'red', isBot: true, alive: true, health: 100 },
        ],
      },
    };

    try {
      lobby.renderBotTakeover(state);
      assert.equal(lobby.elements.botTakeoverPanel.hidden, false);
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].textContent, 'Take over Red Bot');
      assert.equal(buttons[0].disabled, false);

      state.match.players.pop();
      lobby.renderBotTakeover(state);
      assert.equal(lobby.elements.botTakeoverPanel.hidden, false);
      assert.equal(lobby.elements.botTakeoverHelp.textContent,
        'No living teammate bots are available to take over.');
      assert.equal(options.children.length, 0);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalWebSocket === undefined) delete globalThis.WebSocket;
    }
  });

  it('enables the progression-shop buy phase when offer progression is selected', () => {
    const buyPhase = { value: 'loadout' };
    const { lobby } = createLobby();
    lobby.elements = {
      customRulesForm: {
        elements: {
          namedItem(name) {
            return name === 'buyPhase' ? buyPhase : null;
          },
        },
      },
    };

    lobby.enableCustomProgressionShop();

    assert.equal(buyPhase.value, 'progression');
  });

  it('saves the configured custom-series win target from the rules form', async () => {
    const values = {
      buyPhase: 'progression',
      prePhaseSeconds: '15',
      gamePhaseSeconds: '180',
      postPhaseSeconds: '15',
      winsToWin: '3',
      roleSwapEveryMatches: '2',
      teamShuffleEveryMatches: '0',
      teamShuffleMode: 'random',
      mapMode: 'competitive',
      minRooms: '4',
      maxRooms: '6',
      minDoorwaysPerSite: '2',
      minSymmetryPercent: '35',
      minRoomUtilizationPercent: '75',
      maxSiteApproachSightline: '750',
      shopProgression: 'escalating',
      firstShopOffers: '6',
      firstShopPicks: '2',
      laterShopOffers: '5',
      laterShopPicks: '1',
      infiniteGadgetUse: 'on',
      uniqueGadgetInitialChancePercent: '1',
      uniqueGadgetChanceIncrementPercent: '2',
      uniqueGadgetMaxChancePercent: '100',
    };
    const { lobby } = createLobby();
    let request;
    lobby.currentRoomState = { customGameRules: { mapCriteria: {} } };
    lobby.elements = {
      customRulesForm: {
        elements: {
          namedItem(name) {
            return {
              value: values[name],
              checked: ['carryOverShopPicks', 'infiniteGadgetUse'].includes(name),
            };
          },
        },
        querySelectorAll() { return []; },
      },
      customAutoFillBots: { checked: false },
      customRulesDialog: { close() {} },
    };
    lobby.roomClient.request = async (type, payload) => {
      request = { type, payload };
      assert.equal(payload.rules.carryOverShopPicks, true);
      assert.equal(payload.rules.infiniteGadgetUse, true);
      return { state: {} };
    };
    lobby.updateRoomState = () => {};
    lobby.showFeedback = () => {};

    await lobby.saveCustomRules({ preventDefault() {} });

    assert.equal(request.type, 'room:custom-rules');
    assert.equal(request.payload.rules.winsToWin, 3);
    assert.equal(request.payload.rules.buyPhase, 'progression');
    assert.equal(request.payload.rules.infiniteGadgetUse, true);
    assert.equal(request.payload.rules.shopProgression, 'escalating');
  });

  it('renders the weapon panel for a custom match without a buy phase', () => {
    const classList = { toggle() {} };
    const headingHint = { textContent: '' };
    const panel = {
      hidden: false,
      classList,
      querySelector() { return headingHint; },
    };
    const tab = () => ({ setAttribute() {}, classList, tabIndex: -1 });
    const emptyOptions = {
      hidden: false,
      querySelectorAll() { return []; },
      replaceChildren() {},
    };
    const { lobby } = createLobby();
    lobby.currentPlayerId = 'player-1';
    lobby.quickShopCategory = 'rifles';
    lobby.weaponShopButtons = new Map();
    lobby.gadgetShopButtons = new Map();
    lobby.pendingShopSelections = new Set();
    lobby.pendingShopGadgetIds = new Set();
    lobby.weaponSelectOfferSignature = '';
    lobby.itemShopOfferSignature = JSON.stringify([]);
    lobby.formsBusy = false;
    lobby.roomClient.socket = { readyState: 1 };
    lobby.getSelectedWeaponId = () => 'assault-rifle';
    lobby.renderInfoPanelOrdering = () => {};
    lobby.renderWeaponAmmo = () => {};
    lobby.elements = {
      weaponSelectPanel: panel,
      weaponSelectTitle: { textContent: '' },
      quickShopCategories: { hidden: false },
      quickShopRiflesTab: tab(),
      quickShopPistolsTab: tab(),
      quickShopGadgetsTab: tab(),
      quickShopUniqueTab: tab(),
      quickShopRiflesPanel: { hidden: false },
      quickShopPistolsPanel: { hidden: false },
      quickShopGadgetsPanel: { hidden: false },
      quickShopUniquePanel: { hidden: false },
      weaponShopSkip: { hidden: false, disabled: false },
      gadgetShopOptions: emptyOptions,
      uniqueGadgetShopOptions: emptyOptions,
      uniqueGadgetShopEmpty: { hidden: false },
      itemShopOptions: emptyOptions,
    };
    const state = {
      quickPlay: false,
      customGameRules: { buyPhase: 'none' },
      players: [{ id: 'player-1' }],
      match: { gameplayStartsAt: Date.now() + 60_000, players: [] },
    };
    const originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket ??= { OPEN: 1 };

    try {
      lobby.renderWeaponSelection(state);
    } finally {
      if (originalWebSocket === undefined) delete globalThis.WebSocket;
    }

    assert.equal(panel.hidden, true);
  });

  it('makes Spy Camera available in custom and Quick Play loadouts', () => {
    const spyCamera = GADGET_DEFINITIONS[SPY_CAMERA_ID];

    assert.equal(isUniqueGadgetAvailableInLoadoutShop(spyCamera, false), true);
    assert.equal(isUniqueGadgetAvailableInLoadoutShop(spyCamera, true), true);
  });

  it('logs performance snapshots only when client computation is high', () => {
    const { lobby } = createLobby();
    lobby.currentRoomState = { hostId: 'host', match: { startedAt: 1 } };
    lobby.gameView.scene = { playerId: 'host', hostFrameRevision: 1 };
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      lobby.logPerformanceSnapshot({ computationLevel: 'MEDIUM', computationMs: 8 });
      assert.equal(warnings.length, 0);

      lobby.logPerformanceSnapshot({ computationLevel: 'HIGH', computationMs: 12 });
      lobby.logPerformanceSnapshot({ computationLevel: 'HIGH', computationMs: 13 });
      assert.equal(warnings.length, 1, 'high-compute snapshots remain rate-limited');
      assert.equal(warnings[0][0].type, 'game-performance');
      assert.equal(warnings[0][0].computationLevel, 'HIGH');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('restores the room view and active player after a reconnect', () => {
    const { lobby, calls } = createLobby();
    const state = { name: 'Test room', match: { startedAt: 1 } };

    lobby.restoreSession({ state, playerId: 'player-1' });

    assert.equal(lobby.currentPlayerId, 'player-1');
    assert.equal(lobby.currentRoomState, state);
    assert.deepEqual(calls.shown, { state, playerId: 'player-1' });
    assert.equal(lobby.elements.lobby.hidden, true);
    assert.equal(lobby.elements.roomView.hidden, false);
    assert.equal(calls.feedback.message, 'Connection restored.');
  });

  describe('game HUD timer urgency', () => {
    it('warns in the last five seconds before gameplay starts', () => {
      assert.equal(isMatchTimerUrgent({ gameplayStartsAt: 6_000 }, 1_000), true);
      assert.equal(isMatchTimerUrgent({ gameplayStartsAt: 6_001 }, 1_000), false);
    });

    it('warns in the last fifteen seconds of the game phase', () => {
      assert.equal(isMatchTimerUrgent({ gameplayStartsAt: 0, endsAt: 16_000 }, 1_000), true);
      assert.equal(isMatchTimerUrgent({ gameplayStartsAt: 0, endsAt: 16_001 }, 1_000), false);
    });

    it('does not warn for expired or completed match timers', () => {
      assert.equal(isMatchTimerUrgent({ endsAt: 999 }, 1_000), false);
      assert.equal(isMatchTimerUrgent({ endsAt: 2_000, victory: { winner: 'red' } }, 1_000), false);
    });
  });

  it('clears an expired session and returns to the lobby', () => {
    const { lobby, calls } = createLobby();
    lobby.currentPlayerId = 'player-1';
    lobby.currentRoomState = { name: 'Expired room' };

    lobby.resetExpiredSession('Your room session expired.');

    assert.equal(lobby.currentPlayerId, null);
    assert.equal(lobby.currentRoomState, null);
    assert.equal(calls.hidden, 1);
    assert.equal(lobby.elements.lobby.hidden, false);
    assert.equal(lobby.elements.roomView.hidden, true);
    assert.equal(calls.roomControls, null);
    assert.deepEqual(calls.feedback, { message: 'Your room session expired.', isError: true });
  });

  it('refreshes host-side scoreboard data from the live match frame', () => {
    const { lobby } = createLobby();
    const state = {
      quickPlay: true,
      quickPlaySquadRoles: { A: 'red', B: 'blue' },
      quickPlaySquadScore: { A: 0, B: 0 },
      match: null,
    };
    const match = {
      players: [{ id: 'player-1', stats: { kills: 1, assists: 0, deaths: 0 } }],
      quickPlayState: {
        score: { red: 1, blue: 0 },
        squadScore: { A: 1, B: 0 },
        rolesBySquad: { A: 'red', B: 'blue' },
        sidesSwapped: false,
        mapGenerationRevision: 4,
        phase: 'round-result',
      },
    };
    lobby.currentRoomState = state;
    const rendered = [];
    lobby.renderMatchTeamHud = () => rendered.push('hud');
    lobby.renderBotTakeover = () => rendered.push('takeover');
    lobby.renderScoreboard = () => rendered.push('scoreboard');

    lobby.updateLocalHostMatch(match);

    assert.equal(state.match, match);
    assert.equal(state.quickPlayState, match.quickPlayState);
    assert.deepEqual(state.quickPlaySquadScore, { A: 1, B: 0 });
    assert.equal(state.mapGenerationRevision, 4);
    assert.equal(state.quickPlayMapGenerationPending, true);
    assert.deepEqual(rendered, ['hud', 'takeover', 'scoreboard']);
  });

  it('renders the custom-series score using stable squad roles', () => {
    const createClassList = () => {
      const classes = new Set();
      return {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
        },
        contains(name) { return classes.has(name); },
      };
    };
    const createElement = () => ({
      textContent: '',
      hidden: false,
      style: {
        color: '',
        gridColumn: '',
        setProperty() {},
        removeProperty() {},
      },
      classList: createClassList(),
      children: [{}, {}],
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    const scoreContainer = createElement();
    const { lobby } = createLobby();
    lobby.elements = {
      gameHudTeamA: createElement(),
      gameHudTeamB: createElement(),
      gameHudAlive: createElement(),
      gameHudScoreA: createElement(),
      gameHudScoreB: createElement(),
      gameHudLabelA: createElement(),
      gameHudLabelB: createElement(),
      gameHudTimer: createElement(),
      gameHudTeamLabels: createElement(),
      gameHud: createElement(),
    };
    lobby.elements.gameHudScoreA.parentElement = scoreContainer;
    const state = {
      quickPlay: false,
      quickPlaySquadRoles: { A: 'red', B: 'blue' },
      customSeriesState: {
        phase: 'playing',
        rolesBySquad: { A: 'blue', B: 'red' },
        score: { A: 2, B: 1 },
      },
      match: {
        map: { spawnZones: { red: { x: 0 }, blue: { x: 100 } } },
        players: [],
      },
    };

    lobby.renderMatchTeamHud(state);

    assert.equal(lobby.elements.gameHudScoreA.textContent, '2');
    assert.equal(lobby.elements.gameHudScoreB.textContent, '1');
    assert.equal(lobby.elements.gameHudLabelA.style.color, getTeamGroup('blue').accent);
    assert.equal(lobby.elements.gameHudLabelB.style.color, getTeamGroup('red').accent);
    assert.equal(scoreContainer.attributes['aria-label'], 'Series score');
    assert.equal(scoreContainer.classList.contains('is-hidden'), false);

    state.match.victory = { winner: 'blue' };
    state.customSeriesState.phase = 'postgame';
    lobby.renderMatchTeamHud(state);
    assert.equal(lobby.elements.gameHudAlive.classList.contains('is-winner'), false,
      'a continuing custom series uses the same round-result HUD as playlists');

    state.customSeriesState.phase = 'complete';
    state.customSeriesState.lastResult = { winner: 'blue' };
    lobby.renderMatchTeamHud(state);
    assert.equal(lobby.elements.gameHudAlive.classList.contains('is-winner'), true,
      'the custom-series winner banner appears only when the series is complete');

    state.customSeriesState.phase = 'intermission';
    state.customSeriesState.lastResult = { at: 1, winner: 'blue' };
    state.customSeriesState.seriesScoreboard = [{
      id: 'player-1',
      team: 'blue',
      alive: true,
    }];
    state.match = null;
    state.mapGenerationMode = 'host-choice';
    state.mapReady = false;
    lobby.renderMatchTeamHud(state);
    assert.equal(lobby.elements.gameHud.hidden, false);
    assert.equal(lobby.elements.gameHudScoreA.textContent, '2');
    assert.equal(lobby.elements.gameHudTimer.textContent, 'Choose next map');
    assert.equal(lobby.elements.gameHudAlive.classList.contains('is-winner'), false,
      'the previous match winner is not shown as the series winner during intermission');

    state.customSeriesState.phase = 'complete';
    lobby.renderMatchTeamHud(state);
    assert.equal(lobby.elements.gameHudAlive.classList.contains('is-winner'), true,
      'the final custom-series result remains visible after the match object is cleared');
  });

  it('refreshes changed scoreboard data even when adaptive match HUD rendering is deferred', () => {
    const { lobby } = createLobby();
    const now = performance.now();
    lobby.gameView.computationLevel = 'HIGH';
    lobby.lastAdaptiveInventoryRenderAt = now;
    lobby.lastAdaptiveMatchUiRenderAt = now;
    lobby.currentRoomState = {
      match: { players: [{ id: 'player-1', alive: true, health: 100 }] },
      players: [{ id: 'player-1', team: 'red' }],
    };
    let scoreboardRenders = 0;
    let matchHudRenders = 0;
    lobby.renderBotTakeover = () => {};
    lobby.renderScoreboard = () => { scoreboardRenders += 1; };
    lobby.renderMatchTeamHud = () => { matchHudRenders += 1; };

    lobby.updateLocalHostMatch({ startedAt: 1, players: [] });

    assert.equal(scoreboardRenders, 1);
    assert.equal(matchHudRenders, 0);
  });

  it('keeps the canonical team scoreboard visible with stable squad roles in intermission', () => {
    const makeNode = () => ({
      children: [],
      classList: { toggle() {} },
      append(...nodes) { this.children.push(...nodes); },
      setAttribute() {},
    });
    const originalDocument = globalThis.document;
    globalThis.document = {
      createDocumentFragment: makeNode,
      createElement: makeNode,
    };
    const { lobby } = createLobby();
    lobby.currentPlayerId = 'player-1';
    lobby.scoreboardSignature = '';
    lobby.renderInfoPanelOrdering = () => {};
    const state = {
      quickPlay: false,
      customGameRules: { winsToWin: 3 },
      customSeriesState: {
        phase: 'intermission',
        score: { A: 1, B: 0 },
        rolesBySquad: { A: 'red', B: 'blue' },
        lastResult: { matchNumber: 1 },
        seriesScoreboard: [{
          id: 'player-1',
          name: 'Host',
          team: 'red',
          alive: true,
          stats: { kills: 2, assists: 1, deaths: 0 },
        }],
        lastMatchScoreboard: [{
          id: 'player-1',
          name: 'Host',
          team: 'red',
          alive: true,
          stats: { kills: 2, assists: 1, deaths: 0 },
        }],
      },
      players: [{ id: 'player-1', team: 'blue' }],
      match: null,
    };
    const scoreboardPanel = { hidden: true };
    const seriesScore = { hidden: true, textContent: '' };
    const scoreboardTeams = {
      replaceChildren(fragment) { this.children = fragment.children; },
    };
    lobby.elements = {
      scoreboardPanel,
      scoreboardSeriesScore: seriesScore,
      scoreboardTeams,
    };

    try {
      lobby.renderScoreboard(state);
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    }

    assert.equal(scoreboardPanel.hidden, false);
    assert.equal(seriesScore.hidden, true);
    assert.equal(seriesScore.textContent, '');
    assert.equal(scoreboardTeams.children.length, 2);
    assert.match(scoreboardTeams.children[0].children[0].textContent, /TEAM A · YOUR TEAM/);
    assert.match(scoreboardTeams.children[1].children[0].textContent, /TEAM B · OPPONENTS/);
  });

  it('keeps inventory refreshes faster than low-priority match HUD refreshes under high load', () => {
    const { lobby } = createLobby();
    lobby.gameView.computationLevel = 'HIGH';

    assert.equal(lobby.shouldRenderAdaptiveInventory(0), true);
    assert.equal(lobby.shouldRenderAdaptiveInventory(99), false);
    assert.equal(lobby.shouldRenderAdaptiveInventory(100), true);
    assert.equal(lobby.shouldRenderAdaptiveMatchUi(0), true);
    assert.equal(lobby.shouldRenderAdaptiveMatchUi(199), false);
    assert.equal(lobby.shouldRenderAdaptiveMatchUi(200), true);
  });

  it('tracks host frame cadence, application cost, and received revision gaps', () => {
    const { lobby } = createLobby();
    lobby.recordHostFrameActivity('RX', 10, { now: 10, revision: 1, applyMs: 2 });
    lobby.recordHostFrameActivity('RX', 10, { now: 35, revision: 3, applyMs: 4 });

    assert.equal(lobby.smoothedHostFrameIntervalMs, 25);
    assert.equal(lobby.smoothedHostFrameApplyMs, 2.4);
    assert.equal(lobby.hostFrameRevisionGaps, 1);
  });
});
