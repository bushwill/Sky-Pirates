import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCurrentMatchPlayer,
  isMatchTimerUrgent,
  isUniqueGadgetAvailableInLoadoutShop,
  RoomLobby,
} from '../src/ui/RoomLobby.js';
import { GADGET_DEFINITIONS, SPY_CAMERA_ID } from '../../shared/GadgetModel.js';

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
    lobby.renderScoreboard = () => rendered.push('scoreboard');

    lobby.updateLocalHostMatch(match);

    assert.equal(state.match, match);
    assert.equal(state.quickPlayState, match.quickPlayState);
    assert.deepEqual(state.quickPlaySquadScore, { A: 1, B: 0 });
    assert.equal(state.mapGenerationRevision, 4);
    assert.equal(state.quickPlayMapGenerationPending, true);
    assert.deepEqual(rendered, ['hud', 'scoreboard']);
  });

  it('refreshes changed scoreboard data even when adaptive match HUD rendering is deferred', () => {
    const { lobby } = createLobby();
    const now = performance.now();
    lobby.gameView.computationLevel = 'HIGH';
    lobby.lastAdaptiveInventoryRenderAt = now;
    lobby.lastAdaptiveMatchUiRenderAt = now;
    lobby.currentRoomState = { match: null };
    let scoreboardRenders = 0;
    let matchHudRenders = 0;
    lobby.renderScoreboard = () => { scoreboardRenders += 1; };
    lobby.renderMatchTeamHud = () => { matchHudRenders += 1; };

    lobby.updateLocalHostMatch({ startedAt: 1, players: [] });

    assert.equal(scoreboardRenders, 1);
    assert.equal(matchHudRenders, 0);
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
