import { getTeamGroup, getTeamGroupId, TEAM_GROUPS } from '../../../shared/GameRules.js';
import { DEFAULT_MAX_ROOMS, DEFAULT_MIN_ROOMS, generateMap, MAX_ROOMS, MIN_ROOMS } from '../../../shared/MapGenerator.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { GADGET_DEFINITIONS } from '../../../shared/GadgetModel.js';
import { isUniqueGadgetDefinition } from '../../../shared/WeaponShopModel.js';
import { getEffectiveMagazineSize, getInventoryEffects } from '../../../shared/InventoryModel.js';
import { getAdaptiveUpdateProfile, smoothComputationTime } from '../../../shared/ComputationMetric.js';
import { getGadgetCardStatus } from '../game/GadgetCardStatus.js';
import { BOT_PERSONALITIES } from '../../../shared/BotAI.js';
import { BotController } from '../game/BotController.js';
import {
  accumulateQuickPlayRound,
  applyQuickPlayRoundResultToSquadScore,
  getCustomSeriesScoreboardPlayers,
  getQuickPlayScoreboardPlayers,
} from '../game/QuickPlayScore.js';
import { playGameSound } from '../game/SoundEffects.js';
import { getPostGameCountdownLabel } from '../game/MatchStatus.js';
import { DEFAULT_CUSTOM_GAME_RULES } from '../../../shared/CustomGameRules.js';

const DISPLAY_NAME_STORAGE_KEY = 'flagstrike.display-name';
const ROOM_PASSWORD_STORAGE_KEY = 'flagstrike.room-password';
const WEAPON_ICON_SOURCES = Object.freeze({
  'assault-rifle': new URL('../assets/weapons/AK-47.png', import.meta.url).href,
  'battle-rifle': new URL('../assets/weapons/M4A1.png', import.meta.url).href,
  smg: new URL('../assets/weapons/MP5.png', import.meta.url).href,
  'suppressed-smg': new URL('../assets/weapons/TDI Vector Suppressed.png', import.meta.url).href,
  'machine-gun': new URL('../assets/weapons/M249.png', import.meta.url).href,
  shotgun: new URL('../assets/weapons/Benelli M3.png', import.meta.url).href,
  sniper: new URL('../assets/weapons/Dragunov SVD.png', import.meta.url).href,
  'heavy-sniper': new URL('../assets/weapons/Dragunov SVD.png', import.meta.url).href,
  'marksman-rifle': new URL('../assets/weapons/Steyr Scout.png', import.meta.url).href,
  'classic-pistol': new URL('../assets/weapons/Glock.png', import.meta.url).href,
  'battle-pistol': new URL('../assets/weapons/Beretta M9.png', import.meta.url).href,
  'machine-pistol': new URL('../assets/weapons/MAC-10.png', import.meta.url).href,
  'pocket-shotgun': new URL('../assets/weapons/SPAS-12.png', import.meta.url).href,
  revolver: new URL('../assets/weapons/Revolver.png', import.meta.url).href,
});
const SERIES_MODE_COPY = Object.freeze({
  quickplay: {
    label: 'Practice', endless: true,
    joinType: 'quickplay:join', readyType: 'quickplay:ready', buttonElement: 'quickPlayButton',
  },
  longplay: {
    label: 'Quick Play', firstTo: 4, bestOf: 7,
    joinType: 'longplay:join', readyType: 'longplay:ready', buttonElement: 'longPlayButton',
  },
  longseries: {
    label: 'Long Play', firstTo: 10, bestOf: 19,
    joinType: 'longseries:join', readyType: 'longseries:ready', buttonElement: 'longSeriesButton',
  },
});

function getCustomIntermissionStatus(state, now = Date.now()) {
  const series = state?.customSeriesState;
  if (series?.phase === 'complete') return 'Series complete';
  if (series?.teamShufflePending) return 'Approve team shuffle';
  if (state?.mapGenerationPending) return 'Generating next map';
  if (state?.mapGenerationMode === 'host-choice' && state.mapReady !== true) return 'Choose next map';
  const nextMatchAt = series?.nextMatchAt ?? state?.postGame?.endsAt;
  if (Number.isFinite(nextMatchAt) && nextMatchAt > now) {
    return `Next match in ${Math.ceil((nextMatchAt - now) / 1000)}s`;
  }
  return 'Preparing next match';
}
const LONG_PLAY_SHOP_MODES = new Set(['longplay', 'longseries']);

export function isUniqueGadgetAvailableInLoadoutShop(gadget, quickPlay) {
  return gadget.customMatchShopAvailable === true
    ? quickPlay !== true : gadget.alwaysAvailableInLoadoutShop === true;
}

function getSeriesModeCopy(state) {
  return SERIES_MODE_COPY[state?.gameMode ?? state?.quickPlayState?.gameMode] ?? SERIES_MODE_COPY.quickplay;
}

function getWeaponTypeLabel(weapon) {
  let type = weapon.weaponClass;
  if (!type) {
    const id = weapon.id ?? '';
    type = id.includes('shotgun') ? 'shotgun'
      : id.includes('pistol') || id === 'revolver' ? 'pistol'
        : id.includes('sniper') || id.includes('rifle') ? 'rifle' : 'weapon';
  }
  return type.split('-').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
}

function createWeaponIconImage(weaponId) {
  const source = WEAPON_ICON_SOURCES[weaponId];
  if (!source) return null;
  const image = document.createElement('img');
  image.className = 'weapon-image-icon';
  image.src = source;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function createShopItemIcon(kind, itemValue = null) {
  const icon = document.createElement('span');
  icon.className = 'weapon-icon';
  icon.setAttribute('aria-hidden', 'true');
  if (kind === 'weapon') {
    const image = createWeaponIconImage(itemValue);
    if (image) {
      icon.classList.add('weapon-item-icon');
      icon.append(image);
    } else {
      icon.textContent = '⌁';
    }
  } else if (kind === 'gadget') {
    const color = `#${itemValue.colorHex.toString(16).padStart(6, '0')}`;
    icon.classList.add('gadget-icon');
    icon.textContent = '●';
    icon.style.setProperty('--gadget-color', color);
    icon.style.backgroundColor = color;
  } else if (kind === 'armor') {
    icon.classList.add('armor-icon');
    icon.textContent = '⬡';
  } else if (kind === 'item') {
    icon.classList.add('items-icon');
    icon.textContent = '✣';
  } else {
    icon.textContent = '⌁';
  }
  return icon;
}

export function isMatchTimerUrgent(match, now = Date.now()) {
  if (!match || match.victory) return false;
  const prePhaseRemainingMs = match.gameplayStartsAt - now;
  if (Number.isFinite(prePhaseRemainingMs) && prePhaseRemainingMs >= 0 && prePhaseRemainingMs <= 5_000) {
    return true;
  }
  const gamePhaseRemainingMs = match.endsAt - now;
  return Number.isFinite(gamePhaseRemainingMs) && gamePhaseRemainingMs >= 0 && gamePhaseRemainingMs <= 15_000;
}

export function getCurrentMatchPlayer(players, playerId) {
  if (!Array.isArray(players) || !playerId) return null;
  return players.find((player) => player.isBot && player.controlledById === playerId) ??
    players.find((player) => player.id === playerId) ?? null;
}

export class RoomLobby {
  constructor(roomClient, gameView) {
    this.roomClient = roomClient;
    this.gameView = gameView;
    this.pendingSeriesMode = null;
    this.computationLevel = 'LOW';
    this.lastAdaptiveInventoryRenderAt = -Infinity;
    this.lastAdaptiveMatchUiRenderAt = -Infinity;
    this.hostFrameMetricDirection = null;
    this.hostFrameMetricMatchId = null;
    this.lastHostFrameMetricAt = null;
    this.lastPerformanceLogAt = -Infinity;
    this.smoothedHostFrameIntervalMs = null;
    this.smoothedHostFrameApplyMs = null;
    this.lastHostFrameRevision = null;
    this.hostFrameRevisionGaps = 0;
    this.elements = {
      appShell: document.querySelector('.app-shell'),
      connection: document.querySelector('#connection-state'),
      feedback: document.querySelector('#feedback'),
      lobby: document.querySelector('#lobby-view'),
      displayName: document.querySelector('#display-name-input'),
      roomView: document.querySelector('#room-view'),
      gameSidebar: document.querySelector('.game-sidebar'),
      gameHud: document.querySelector('#game-hud'),
      gameHudTeamLabels: document.querySelector('.game-hud-team-labels'),
      gameHudAlive: document.querySelector('.game-hud-alive'),
      gameHudScoreA: document.querySelector('#game-hud-score-a'),
      gameHudScoreB: document.querySelector('#game-hud-score-b'),
      gameHudLabelA: document.querySelector('#game-hud-label-a'),
      gameHudLabelB: document.querySelector('#game-hud-label-b'),
      gameHudTeamA: document.querySelector('#game-hud-team-a'),
      gameHudTeamB: document.querySelector('#game-hud-team-b'),
      gameHudTimer: document.querySelector('#game-hud-timer'),
      clientComputation: document.querySelector('#client-computation'),
      roomList: document.querySelector('#room-list'),
      createForm: document.querySelector('#create-room-form'),
      joinForm: document.querySelector('#join-room-form'),
      joinName: document.querySelector('#join-room-name'),
      joinPassword: document.querySelector('#join-room-password'),
      connectedMessage: document.querySelector('#connected-message'),
      roomCredentialsToggle: document.querySelector('#room-credentials-toggle'),
      roomCredentials: document.querySelector('#room-credentials'),
      roomCredentialName: document.querySelector('#room-credential-name'),
      roomCredentialPassword: document.querySelector('#room-credential-password'),
      roomDetailsForm: document.querySelector('#room-details-form'),
      roomDetailsName: document.querySelector('#room-details-name'),
      roomDetailsPassword: document.querySelector('#room-details-password'),
      hostStatus: document.querySelector('#host-status'),
      startMatchButton: document.querySelector('#start-match-button'),
      customRulesButton: document.querySelector('#custom-rules-button'),
      customRulesDialog: document.querySelector('#custom-rules-dialog'),
      customRulesForm: document.querySelector('#custom-rules-form'),
      customRulesClose: document.querySelector('#custom-rules-close'),
      customRulesCancel: document.querySelector('#custom-rules-cancel'),
      customRulesRulesTab: document.querySelector('#custom-rules-rules-tab'),
      customRulesBotsTab: document.querySelector('#custom-rules-bots-tab'),
      customRulesRulesPanel: document.querySelector('#custom-rules-rules-panel'),
      customRulesBotsPanel: document.querySelector('#custom-rules-bots-panel'),
      customAutoFillBots: document.querySelector('#custom-auto-fill-bots'),
      customMapCriteria: document.querySelector('.custom-map-criteria'),
      customTeamApproveButton: document.querySelector('#custom-team-approve-button'),
      customSeriesEndButton: document.querySelector('#custom-series-end-button'),
      quickPlayReadyButton: document.querySelector('#quick-play-ready-button'),
      backButton: document.querySelector('#back-button'),
      refreshButton: document.querySelector('#refresh-rooms'),
      quickPlayButton: document.querySelector('#quick-play-button'),
      longPlayButton: document.querySelector('#long-play-button'),
      longSeriesButton: document.querySelector('#long-series-button'),
      seriesModeDialog: document.querySelector('#series-mode-dialog'),
      seriesModeTitle: document.querySelector('#series-mode-title'),
      seriesModeDescription: document.querySelector('#series-mode-description'),
      seriesModeChoices: document.querySelector('#series-mode-choices'),
      seriesModePublicButton: document.querySelector('#series-mode-public'),
      seriesModePrivateButton: document.querySelector('#series-mode-private'),
      seriesModeCloseButton: document.querySelector('#series-mode-close'),
      privateSeriesForm: document.querySelector('#private-series-form'),
      privateSeriesRoomName: document.querySelector('#private-series-room-name'),
      privateSeriesPassword: document.querySelector('#private-series-password'),
      privateSeriesBackButton: document.querySelector('#private-series-back'),
      teamPanel: document.querySelector('#team-panel'),
      weaponSelectPanel: document.querySelector('#weapon-select-panel'),
      weaponSelectTitle: document.querySelector('#weapon-select-title'),
      quickShopCategories: document.querySelector('#quick-shop-categories'),
      quickShopRiflesTab: document.querySelector('#quick-shop-rifles-tab'),
      quickShopPistolsTab: document.querySelector('#quick-shop-pistols-tab'),
      quickShopGadgetsTab: document.querySelector('#quick-shop-gadgets-tab'),
      quickShopUniqueTab: document.querySelector('#quick-shop-unique-tab'),
      quickShopRiflesPanel: document.querySelector('#quick-shop-rifles-panel'),
      quickShopPistolsPanel: document.querySelector('#quick-shop-pistols-panel'),
      quickShopGadgetsPanel: document.querySelector('#quick-shop-gadgets-panel'),
      quickShopUniquePanel: document.querySelector('#quick-shop-unique-panel'),
      rifleShopOptions: document.querySelector('#rifle-shop-options'),
      pistolShopOptions: document.querySelector('#pistol-shop-options'),
      gadgetShopOptions: document.querySelector('#gadget-shop-options'),
      uniqueGadgetShopOptions: document.querySelector('#unique-gadget-shop-options'),
      uniqueGadgetShopEmpty: document.querySelector('#unique-gadget-shop-empty'),
      itemShopOptions: document.querySelector('#item-shop-options'),
      weaponShopSkip: document.querySelector('#weapon-shop-skip'),
      inventoryPanel: document.querySelector('#inventory-panel'),
      inventoryWeaponCard: document.querySelector('#inventory-weapon-card'),
      inventoryGadgetCard: document.querySelector('#inventory-gadget-card'),
      inventoryGadgetName: document.querySelector('#inventory-gadget-name'),
      inventoryGadgetDescription: document.querySelector('#inventory-gadget-description'),
      inventoryGadgetIcon: document.querySelector('#inventory-gadget-card .gadget-icon'),
      inventoryGadgetCount: document.querySelector('#inventory-gadget-count'),
      inventoryWeaponType: document.querySelector('#inventory-weapon-type'),
      inventoryWeaponIcon: document.querySelector('#inventory-weapon-icon'),
      inventoryWeaponTags: document.querySelector('#inventory-weapon-tags'),
      inventoryWeaponEquip: document.querySelector('#inventory-weapon-equip'),
      scoreboardPanel: document.querySelector('#scoreboard-panel'),
      scoreboardSeriesScore: document.querySelector('#scoreboard-series-score'),
      scoreboardTeams: document.querySelector('#scoreboard-teams'),
      inventoryWeaponName: document.querySelector('#inventory-weapon-name'),
      inventoryGadgetStatus: document.querySelector('#inventory-gadget-status'),
      inventoryArmorName: document.querySelector('#inventory-armor-name'),
      inventoryArmorLevel: document.querySelector('#inventory-armor-level'),
      inventoryHealthPoints: document.querySelector('#inventory-health-points'),
      inventoryArmorPointsRow: document.querySelector('#inventory-armor-points-row'),
      inventoryArmorPoints: document.querySelector('#inventory-armor-points'),
      inventoryArmorRegen: document.querySelector('#inventory-armor-regen'),
      weaponAmmoCount: document.querySelector('#weapon-ammo-count'),
      weaponAmmoIcons: document.querySelector('#weapon-ammo-icons'),
      weaponReloadStatus: document.querySelector('#weapon-reload-status'),
      inventoryItemGrid: document.querySelector('#inventory-item-grid'),
      inventoryItemsEmpty: document.querySelector('#inventory-items-empty'),
      teamGroups: document.querySelector('#team-groups'),
      teamSelfActions: document.querySelector('#team-self-actions'),
      teamStatus: document.querySelector('#team-assignment-status'),
      teamForm: document.querySelector('#team-control-form'),
      teamPlayerField: document.querySelector('#team-player-field'),
      teamPlayerSelect: document.querySelector('#team-player-select'),
      teamDestinationSelect: document.querySelector('#team-destination-select'),
      teamSwapField: document.querySelector('#team-swap-field'),
      teamSwapSelect: document.querySelector('#team-swap-select'),
      teamSubmitButton: document.querySelector('#team-submit-button'),
      teamHelp: document.querySelector('#team-help'),
      mapSeedControls: document.querySelector('#map-seed-controls'),
      mapSeedForm: document.querySelector('#map-seed-form'),
      mapSeedInput: document.querySelector('#map-seed-input'),
      mapRoomCount: document.querySelector('#map-room-count'),
      mapSeedRandomize: document.querySelector('#map-seed-randomize'),
      mapCompetitiveGenerate: document.querySelector('#map-competitive-generate'),
      mapMetrics: document.querySelector('#map-metrics'),
      botRoster: document.querySelector('#bot-roster'),
      botTakeoverPanel: document.querySelector('#bot-takeover-panel'),
      botTakeoverHelp: document.querySelector('#bot-takeover-help'),
      botTakeoverOptions: document.querySelector('#bot-takeover-options'),
    };
    this.currentRoomName = '';
    this.currentRoomPassword = '';
    this.botController = new BotController(this.roomClient);
    this.gameView.setBotUpdateHandler(() =>
      this.botController.update(() => this.gameView.getRoomStateForSimulation(this.currentRoomState), this.currentPlayerId));
    this.gameView.setDamageCueHandler((cue) => this.botController.acceptDamageCue(cue));
    this.gameView.setAudioCueHandler((cue) => this.botController.acceptAudioCue(cue));
    this.gameView.setHudUpdateHandler((hud) => this.renderGameHud(hud));
    this.gameView.setHostFrameUpdateHandler((match) => this.updateLocalHostMatch(match));
    this.botAssignmentButtons = new Map();
    this.botTakeoverButtons = new Map();
    this.itemShopOfferSignature = null;
    this.pendingShopSelections = new Set();
    this.pendingShopGadgetIds = new Set();
    this.postGameMessage = '';
    this.botSettingsBusy = false;
    this.botTakeoverBusy = false;
    this.uiClickHandler = (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || button.dataset.sound === 'equip') return;
      playGameSound('ui-click', 0.16);
    };
    this.elements.appShell.addEventListener('click', this.uiClickHandler, true);
    this.createBotAssignmentControls();
    this.elements.botTakeoverOptions.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button[data-bot-id]') : null;
      if (!button || !this.elements.botTakeoverOptions.contains(button)) return;
      event.preventDefault();
      event.stopPropagation();
      this.setBotTakeover(button.dataset.botId, button.dataset.takeControl === 'true');
    });
    this.formsBusy = false;
    this.elements.displayName.value = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) ?? '';
    for (const key of ['flagstrike.player-color', 'flagstrike.player-appearance', 'flagstrike.player-avatar']) {
      window.localStorage.removeItem(key);
    }
    this.elements.displayName.addEventListener('input', () => {
      window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, this.elements.displayName.value.slice(0, 24));
    });
    this.mapMetricsCache = new Map();
    this.feedbackTimeout = null;
    this.scoreboardSignature = '';
    this.quickPlaySeriesStats = new Map();
    this.quickPlayAccumulatedMatches = new Map();
    this.postGameCountdownTimer = window.setInterval(() => {
      this.renderPostGameCountdown();
      this.renderQuickPlayCountdown();
      this.renderWeaponSelection();
    }, 250);
    this.weaponAmmoIcons = Array.from({ length: 60 }, () => {
      const icon = document.createElement('span');
      icon.className = 'rifle-ammo-icon';
      icon.setAttribute('aria-hidden', 'true');
      this.elements.weaponAmmoIcons.append(icon);
      return icon;
    });
    this.weaponShopButtons = new Map();
    this.quickShopCategory = 'rifles';
    for (const weapon of Object.values(DEFAULT_PROJECTILE_DEFINITIONS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'weapon-shop-option';
      button.dataset.weaponId = weapon.id;
      button.dataset.sound = 'equip';
      button.setAttribute('aria-pressed', 'false');
      const title = document.createElement('strong');
      title.className = 'weapon-shop-name';
      title.textContent = weapon.name;
      const heading = document.createElement('span');
      heading.className = 'weapon-shop-heading';
      heading.append(createShopItemIcon('weapon', weapon.id), title);
      const description = document.createElement('span');
      description.className = 'weapon-shop-description';
      description.textContent = weapon.description;
      const stats = document.createElement('span');
      stats.className = 'weapon-shop-stats';
      const reloadSeconds = weapon.reloadPerRound
        ? `Round reload · ${weapon.reloadIntervalMs.map((interval) => `${(interval / 1000).toFixed(1)}s`).join(' / ')}`
        : weapon.reloadDurationMs ? `${(weapon.reloadDurationMs / 1000).toFixed(1)}s reload` : 'No reload';
      const damageLabel = weapon.pelletCount
        ? `${weapon.pelletCount} × ${weapon.damage} damage/pellet`
        : `${weapon.damage} damage${weapon.burstCount ? ` · ${weapon.burstCount}-round burst` : ''}`;
      stats.textContent = `${damageLabel} · ${weapon.magazineSize} rounds · ${Math.round(weapon.movementScale * 100)}% move · ${reloadSeconds}`;
      button.append(heading, description, stats);
      button.addEventListener('click', () => this.selectWeapon(weapon.id));
      const isPistol = weapon.weaponClass === 'pistol' || weapon.id.endsWith('-pistol');
      (isPistol ? this.elements.pistolShopOptions : this.elements.rifleShopOptions).append(button);
      this.weaponShopButtons.set(weapon.id, button);
    }
    this.gadgetShopButtons = new Map();
    for (const gadget of Object.values(GADGET_DEFINITIONS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'weapon-shop-option gadget-shop-option';
      button.dataset.gadgetId = gadget.id;
      button.dataset.rarity = gadget.rarity ?? 'standard';
      button.dataset.sound = 'equip';
      button.style.setProperty('--gadget-color', `#${gadget.colorHex.toString(16).padStart(6, '0')}`);
      const title = document.createElement('strong');
      title.className = 'weapon-shop-name';
      title.textContent = gadget.name;
      const heading = document.createElement('span');
      heading.className = 'weapon-shop-heading';
      heading.append(createShopItemIcon('gadget', gadget), title);
      const description = document.createElement('span');
      description.className = 'weapon-shop-description';
      description.textContent = gadget.description;
      const detail = document.createElement('span');
      detail.className = 'weapon-shop-stats';
      const charges = gadget.charges ?? 1;
      const cooldown = Number.isFinite(gadget.cooldownMs) ? ` · recharges after ${gadget.cooldownMs / 1000}s alive` : '';
      detail.textContent = gadget.rarity === 'unique'
        ? `Unique gadget · ${charges} charge${charges === 1 ? '' : 's'}${cooldown}`
        : 'Gadget · 1 use · replaces your current gadget';
      button.append(heading, description, detail);
      button.addEventListener('click', () => this.selectShopGadget(gadget.id));
      const options = isUniqueGadgetDefinition(gadget)
        ? this.elements.uniqueGadgetShopOptions : this.elements.gadgetShopOptions;
      options.append(button);
      this.gadgetShopButtons.set(gadget.id, button);
    }

    this.elements.createForm.addEventListener('submit', (event) => this.handleCreate(event));
    this.elements.joinForm.addEventListener('submit', (event) => this.handleJoin(event));
    this.elements.backButton.addEventListener('click', () => this.leaveRoom());
    this.elements.roomCredentialsToggle.addEventListener('click', () => this.toggleRoomCredentials());
    this.elements.roomDetailsForm.addEventListener('submit', (event) => this.saveRoomDetails(event));
    this.elements.startMatchButton.addEventListener('click', () => this.startMatch());
    this.elements.customRulesButton.addEventListener('click', () => this.openCustomRules());
    this.elements.customRulesClose.addEventListener('click', () => this.elements.customRulesDialog.close());
    this.elements.customRulesCancel.addEventListener('click', () => this.elements.customRulesDialog.close());
    this.elements.customRulesForm.addEventListener('submit', (event) => this.saveCustomRules(event));
    this.elements.customRulesRulesTab.addEventListener('click', () => this.setCustomRulesTab('rules'));
    this.elements.customRulesBotsTab.addEventListener('click', () => this.setCustomRulesTab('bots'));
    this.elements.customRulesForm.elements.namedItem('shopProgression')
      .addEventListener('change', () => this.enableCustomProgressionShop());
    this.elements.customRulesForm.elements.mapMode.addEventListener('change', () => this.updateCustomRulesDependencies());
    this.elements.customTeamApproveButton.addEventListener('click', () => this.approveCustomTeams());
    this.elements.customSeriesEndButton.addEventListener('click', () => this.endCustomSeries());
    this.elements.quickPlayReadyButton.addEventListener('click', () => this.toggleQuickPlayReady());
    this.elements.weaponShopSkip.addEventListener('click', () => this.skipWeaponShop());
    this.elements.quickShopRiflesTab.addEventListener('click', () => this.setQuickShopCategory('rifles'));
    this.elements.quickShopPistolsTab.addEventListener('click', () => this.setQuickShopCategory('pistols'));
    this.elements.quickShopGadgetsTab.addEventListener('click', () => this.setQuickShopCategory('gadgets'));
    this.elements.quickShopUniqueTab.addEventListener('click', () => this.setQuickShopCategory('unique'));
    this.elements.quickShopCategories.addEventListener('keydown', (event) => {
      const categories = ['rifles', 'pistols', 'gadgets', 'unique'];
      const currentIndex = categories.indexOf(this.quickShopCategory);
      const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % categories.length
        : event.key === 'ArrowLeft' ? (currentIndex + categories.length - 1) % categories.length
          : event.key === 'Home' ? 0
            : event.key === 'End' ? categories.length - 1
              : -1;
      const nextCategory = categories[nextIndex];
      if (!nextCategory) return;
      event.preventDefault();
      this.setQuickShopCategory(nextCategory, true);
    });
    this.elements.refreshButton.addEventListener('click', () => this.refreshRooms());
    this.elements.quickPlayButton.addEventListener('click', () => this.quickPlay());
    this.elements.longPlayButton.addEventListener('click', () => this.longPlay());
    this.elements.longSeriesButton.addEventListener('click', () => this.longSeries());
    this.elements.seriesModePublicButton.addEventListener('click', () => this.joinSelectedSeriesPublicly());
    this.elements.seriesModePrivateButton.addEventListener('click', () => this.showPrivateSeriesForm());
    this.elements.seriesModeCloseButton.addEventListener('click', () => this.elements.seriesModeDialog.close());
    this.elements.seriesModeDialog.addEventListener('close', () => {
      this.pendingSeriesMode = null;
      this.elements.privateSeriesForm.reset();
      this.elements.seriesModeChoices.hidden = false;
      this.elements.privateSeriesForm.hidden = true;
    });
    this.elements.privateSeriesForm.addEventListener('submit', (event) => this.handlePrivateSeriesCreate(event));
    this.elements.privateSeriesBackButton.addEventListener('click', () => this.showSeriesModeChoices());
    this.elements.teamForm.addEventListener('submit', (event) => this.submitTeamChange(event));
    this.elements.mapSeedForm.addEventListener('submit', (event) => this.applyMapSeed(event));
    this.elements.mapSeedRandomize.addEventListener('click', () => this.generateNewMapSeed());
    this.elements.mapCompetitiveGenerate.addEventListener('click', () => this.generateCompetitiveMap());
    this.elements.teamPlayerSelect.addEventListener('change', () => this.updateTeamActionOptions(true));
    this.elements.teamDestinationSelect.addEventListener('change', () => this.updateTeamActionOptions());

    this.roomClient.on('connection', (state) => {
      this.setConnectionState(state);
      this.gameView.recordClientConnectionState?.(state);
    });
    this.roomClient.on('heartbeat', (metrics) => this.gameView.recordClientHeartbeat?.(metrics));
    this.roomClient.on('rooms', (rooms) => this.renderRooms(rooms));
    this.roomClient.on('roomState', (state) => this.updateRoomState(state));
    this.roomClient.on('gameState', (state) => this.applyGameState(state));
    this.roomClient.on('authorityInput', (input) => this.gameView.applyAuthorityInput(input));
    this.roomClient.on('authorityAction', (action) => this.gameView.applyAuthorityAction(action));
    this.roomClient.on('authorityBots', (message) => this.gameView.applyAuthorityBots(message));
    this.roomClient.on('hostFrame', (frame) => {
      const frameReceivedAt = performance.now();
      const applyStartedAt = frameReceivedAt;
      const match = this.gameView.applyHostFrame(frame);
      const applyMs = performance.now() - applyStartedAt;
      this.recordHostFrameActivity('RX', frame?.matchId, {
        now: frameReceivedAt,
        revision: frame?.revision,
        applyMs: match ? applyMs : null,
        applied: Boolean(match),
      });
      if (!match || !this.currentRoomState) return;
      for (const event of frame.events ?? []) this.gameView.applyHostEvent(event);
      this.currentRoomState.match = match;
      this.gameView.finalizeMatchClientDiagnostics?.(match);
      this.syncQuickPlayStateFromMatch(match);
      this.currentRoomState.authorityFrame = frame;
      if (this.shouldRenderAdaptiveInventory()) this.renderWeaponAmmo(match.players);
      if (this.shouldRenderAdaptiveMatchUi()) {
        this.renderMatchTeamHud(this.currentRoomState);
        this.renderBotTakeover(this.currentRoomState);
        this.renderPostGameCountdown();
      }
      this.renderScoreboard(this.currentRoomState);
    });
    this.roomClient.on('projectile', (projectile) => this.gameView.applyProjectile(projectile));
    this.roomClient.on('gadgetUsed', (event) => this.gameView.applyGadgetEvent(event));
    this.roomClient.on('audioCue', (cue) => {
      this.gameView.applyAudioCue(cue);
      this.botController.acceptAudioCue(cue);
    });
    this.roomClient.on('damageCue', (cue) => {
      this.gameView.applyDamageCue(cue);
      this.botController.acceptDamageCue(cue);
    });
    this.roomClient.on('gamePing', (ping) => {
      this.gameView.applyPing(ping);
      this.botController.acceptPing(ping);
    });
    this.roomClient.on('gameIntel', (intel) => this.gameView.applyTeamIntel(intel));
    this.roomClient.on('teamMines', (intel) => this.gameView.applyTeamMineIntel(intel));
    this.roomClient.on('teamWalls', (intel) => this.gameView.applyTeamWalls(intel));
    this.roomClient.on('gameCorpses', (corpses) => this.gameView.applyTeamCorpses(corpses));
    this.roomClient.on('sessionResumed', (session) => this.restoreSession(session));
    this.roomClient.on('sessionExpired', (message) => this.resetExpiredSession(message));
    this.roomClient.on('postGameExpired', (message) => {
      this.roomClient.setSessionToken(null);
      this.roomClient.clearReliableOutbox();
      this.resetExpiredSession(message);
    });
    this.roomClient.on('error', (message) => {
      if (message === 'Player position collides with a wall.' || message === 'Movement input crosses a wall.') return;
      this.showFeedback(message, true);
    });

    this.setConnectionState('connecting');
    this.renderRooms([]);
  }

  setConnectionState(state) {
    const connected = state === 'connected';
    this.elements.connection.textContent = connected ? 'Online'
      : state === 'reconnecting' ? 'Reconnecting…'
        : state === 'connecting' ? 'Connecting…' : 'Offline';
    this.elements.connection.dataset.state = state;
    this.elements.refreshButton.disabled = !connected;
    this.elements.quickPlayButton.disabled = !connected || this.formsBusy;
    this.elements.longPlayButton.disabled = !connected || this.formsBusy;
    this.elements.longSeriesButton.disabled = !connected || this.formsBusy;
    this.elements.seriesModePublicButton.disabled = !connected || this.formsBusy;
    this.elements.seriesModePrivateButton.disabled = !connected || this.formsBusy;
    this.elements.privateSeriesForm.querySelectorAll('input, button').forEach((element) => { element.disabled = !connected || this.formsBusy; });
    this.elements.quickPlayReadyButton.disabled = !connected || this.formsBusy;
    this.elements.displayName.disabled = !connected || this.formsBusy;
    this.elements.createForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = !connected; });
    this.elements.joinForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = !connected; });
    if (connected) {
      if (!this.currentPlayerId) this.refreshRooms();
      else this.showFeedback('Connection restored.');
    } else if (state === 'reconnecting') {
      this.elements.refreshButton.disabled = true;
      this.elements.displayName.disabled = true;
      this.elements.createForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
      this.elements.joinForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
      if (this.currentPlayerId) this.showFeedback('Connection interrupted. Reconnecting to the match…');
    } else {
      this.elements.refreshButton.disabled = true;
      this.elements.displayName.disabled = true;
      this.elements.createForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
      this.elements.joinForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = true; });
    }
  }

  restoreSession(session) {
    if (!session?.state || typeof session.playerId !== 'string' || !session.playerId) {
      this.resetExpiredSession('Unable to restore your room session. Please rejoin the room.');
      return;
    }

    this.currentPlayerId = session.playerId;
    this.currentRoomState = session.state;
    this.setRoomCredentials(
      session.state.name,
      globalThis.window?.sessionStorage?.getItem(ROOM_PASSWORD_STORAGE_KEY) ?? '',
    );
    this.elements.connectedMessage.textContent = `Connected to server ${session.state.name}`;
    this.elements.lobby.hidden = true;
    this.elements.roomView.hidden = false;
    this.gameView.show(session.state, session.playerId);
    this.renderRoomControls(session.state);
    this.showFeedback('Connection restored.');
  }

  resetExpiredSession(message) {
    this.roomClient.setSessionToken(null);
    this.roomClient.clearReliableOutbox();
    this.setRoomCredentials('', '');
    this.gameView.hide();
    this.currentPlayerId = null;
    this.currentRoomState = null;
    this.elements.roomView.hidden = true;
    this.elements.lobby.hidden = false;
    this.renderRoomControls(null);
    this.showFeedback(message || 'Your room session expired. Please rejoin the room.', true);
  }

  updateLocalHostMatch(match) {
    if (!match || !this.currentRoomState) return;
    this.recordHostFrameActivity('TX', match.startedAt);
    const previousMatch = this.currentRoomState.match;
    const previousHuman = previousMatch?.players?.find((player) => player.id === this.currentPlayerId);
    const currentHuman = match.players?.find((player) => player.id === this.currentPlayerId);
    const wasEliminated = Boolean(previousHuman &&
      (previousHuman.isSpectator === true || previousHuman.alive === false || previousHuman.health <= 0));
    const isEliminated = Boolean(currentHuman &&
      (currentHuman.isSpectator === true || currentHuman.alive === false || currentHuman.health <= 0));
    const takeoverStateChanged = !previousMatch || wasEliminated !== isEliminated;
    this.currentRoomState.match = match;
    this.syncQuickPlayStateFromMatch(match);
    if (match.quickPlayState && match.victory) this.accumulateQuickPlayRound(match);
    if (this.shouldRenderAdaptiveInventory()) this.renderWeaponAmmo(match.players);
    if (this.shouldRenderAdaptiveMatchUi() || takeoverStateChanged) {
      this.renderMatchTeamHud(this.currentRoomState);
      this.renderBotTakeover(this.currentRoomState);
    }
    this.renderScoreboard(this.currentRoomState);
  }

  recordHostFrameActivity(direction, matchId, {
    now = performance.now(),
    revision = null,
    applyMs = null,
    applied = false,
  } = {}) {
    if (this.hostFrameMetricDirection !== direction || this.hostFrameMetricMatchId !== matchId) {
      this.hostFrameMetricDirection = direction;
      this.hostFrameMetricMatchId = matchId;
      this.lastHostFrameMetricAt = null;
      this.smoothedHostFrameIntervalMs = null;
      this.smoothedHostFrameApplyMs = null;
      this.lastHostFrameRevision = null;
      this.hostFrameRevisionGaps = 0;
    }
    if (Number.isFinite(this.lastHostFrameMetricAt)) {
      this.smoothedHostFrameIntervalMs = smoothComputationTime(
        this.smoothedHostFrameIntervalMs,
        Math.max(0, now - this.lastHostFrameMetricAt),
        0.2,
      );
    }
    this.lastHostFrameMetricAt = now;
    if (direction === 'RX' && Number.isInteger(revision)) {
      if (Number.isInteger(this.lastHostFrameRevision) && revision > this.lastHostFrameRevision + 1) {
        this.hostFrameRevisionGaps += revision - this.lastHostFrameRevision - 1;
      }
      if (!Number.isInteger(this.lastHostFrameRevision) || revision > this.lastHostFrameRevision) {
        this.lastHostFrameRevision = revision;
      }
    }
    if (Number.isFinite(applyMs)) {
      this.smoothedHostFrameApplyMs = smoothComputationTime(
        this.smoothedHostFrameApplyMs,
        applyMs,
        0.2,
      );
    }
    this.gameView.recordClientHostFrameActivity?.({
      direction,
      monotonicNow: now,
      revision,
      applyMs,
      applied,
    });
  }

  shouldRenderAdaptiveInventory(now = performance.now()) {
    const level = this.gameView.computationLevel ?? this.computationLevel;
    const interval = getAdaptiveUpdateProfile(level).inventoryIntervalMs;
    if (now - this.lastAdaptiveInventoryRenderAt < interval) return false;
    this.lastAdaptiveInventoryRenderAt = now;
    return true;
  }

  shouldRenderAdaptiveMatchUi(now = performance.now()) {
    const level = this.gameView.computationLevel ?? this.computationLevel;
    const interval = getAdaptiveUpdateProfile(level).matchHudIntervalMs;
    if (now - this.lastAdaptiveMatchUiRenderAt < interval) return false;
    this.lastAdaptiveMatchUiRenderAt = now;
    return true;
  }

  syncQuickPlayStateFromMatch(match) {
    const series = match?.quickPlayState;
    if (!series || !this.currentRoomState?.quickPlay) return;
    this.currentRoomState.quickPlayState = series;
    if (series.rolesBySquad) {
      this.currentRoomState.quickPlaySquadRoles = { ...series.rolesBySquad };
    }
    if (series.squadScore) {
      this.currentRoomState.quickPlaySquadScore = { ...series.squadScore };
    }
    if (typeof series.sidesSwapped === 'boolean') {
      this.currentRoomState.quickPlaySidesSwapped = series.sidesSwapped;
    }
    if (Number.isSafeInteger(series.mapGenerationRevision)) {
      this.currentRoomState.mapGenerationRevision = series.mapGenerationRevision;
    }
    this.currentRoomState.quickPlayMapGenerationPending = series.phase === 'round-result';
  }

  createBotAssignmentControls() {
    for (const personality of BOT_PERSONALITIES) {
      const row = document.createElement('div');
      row.className = 'bot-roster-row';
      const label = document.createElement('label');
      label.htmlFor = `assign-${personality.id}`;
      label.textContent = personality.name;
      const actions = document.createElement('div');
      actions.className = 'bot-roster-actions';
      const teamButtons = {};
      for (const team of TEAM_GROUPS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `assign-${personality.id}-${team.id}`;
        button.className = 'bot-roster-button';
        button.textContent = `Add ${team.label}`;
        button.addEventListener('click', () => this.assignBot(personality.id, team.id));
        actions.append(button);
        teamButtons[team.id] = button;
      }
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'bot-roster-button bot-roster-button--remove';
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => this.assignBot(personality.id, 'none'));
      actions.append(removeButton);
      row.append(label, actions);
      const summary = document.createElement('span');
      summary.className = 'bot-personality-summary';
      summary.textContent = personality.description ?? '';
      row.append(summary);
      this.elements.botRoster.append(row);
      this.botAssignmentButtons.set(personality.id, { ...teamButtons, remove: removeButton });
    }
  }

  async refreshRooms() {
    try {
      const { rooms } = await this.roomClient.request('rooms:list');
      this.renderRooms(rooms);
      this.showFeedback('');
    } catch (error) {
      this.showFeedback(error.message, true);
    }
  }

  async handleCreate(event) {
    event.preventDefault();
    const formData = new FormData(this.elements.createForm);
    await this.connectToRoom('room:create', {
      name: formData.get('name'),
      password: formData.get('password') || '',
      ...this.getDisplayNamePayload(),
    });
  }

  async handleJoin(event) {
    event.preventDefault();
    const formData = new FormData(this.elements.joinForm);
    await this.connectToRoom('room:join', {
      name: formData.get('name'),
      password: formData.get('password') || '',
      ...this.getDisplayNamePayload(),
    });
  }

  quickPlay() {
    return this.openSeriesModeDialog('quickplay');
  }

  longPlay() {
    return this.openSeriesModeDialog('longplay');
  }

  longSeries() {
    return this.openSeriesModeDialog('longseries');
  }

  openSeriesModeDialog(gameMode) {
    const mode = SERIES_MODE_COPY[gameMode];
    if (!mode || this.formsBusy || this.roomClient.socket.readyState !== WebSocket.OPEN) return;
    this.pendingSeriesMode = gameMode;
    this.elements.seriesModeTitle.textContent = `Play ${mode.label}`;
    this.elements.seriesModeDescription.textContent =
      'Enter public matchmaking, or host a private room.';
    this.elements.seriesModeChoices.hidden = false;
    this.elements.privateSeriesForm.hidden = true;
    this.elements.privateSeriesForm.reset();
    if (!this.elements.seriesModeDialog.open) this.elements.seriesModeDialog.showModal();
  }

  showPrivateSeriesForm() {
    if (!this.pendingSeriesMode) return;
    this.elements.seriesModeChoices.hidden = true;
    this.elements.privateSeriesForm.hidden = false;
    this.elements.privateSeriesRoomName.focus();
  }

  showSeriesModeChoices() {
    this.elements.privateSeriesForm.reset();
    this.elements.privateSeriesForm.hidden = true;
    this.elements.seriesModeChoices.hidden = false;
  }

  async joinSelectedSeriesPublicly() {
    const gameMode = this.pendingSeriesMode;
    if (!gameMode) return;
    this.elements.seriesModeDialog.close();
    await this.joinSeriesMode(gameMode);
  }

  async handlePrivateSeriesCreate(event) {
    event.preventDefault();
    const gameMode = this.pendingSeriesMode;
    if (!gameMode) return;
    const formData = new FormData(this.elements.privateSeriesForm);
    const password = formData.get('password');
    const connected = await this.connectToRoom('series:private:create', {
      name: formData.get('name'),
      password,
      gameMode,
      ...this.getDisplayNamePayload(),
    });
    if (connected) this.elements.seriesModeDialog.close();
  }

  async joinSeriesMode(gameMode) {
    const mode = SERIES_MODE_COPY[gameMode];
    const button = this.elements[mode.buttonElement];
    button.disabled = true;
    button.textContent = `Finding a ${mode.label}…`;
    await this.connectToRoom(mode.joinType, this.getDisplayNamePayload());
    if (this.elements.lobby.hidden) {
      const format = mode.endless
        ? 'Endless rounds with no series win limit'
        : `Best of ${mode.bestOf}, first to ${mode.firstTo} wins`;
      this.showFeedback(`Joined ${mode.label}. ${format}; you can leave at any time.`);
    }
    button.textContent = mode.label;
    button.disabled = this.roomClient.socket.readyState !== WebSocket.OPEN;
  }

  async connectToRoom(action, payload) {
    this.setFormsBusy(true);
    try {
      const { room, state, playerId } = await this.roomClient.request(action, payload);
      this.currentPlayerId = playerId;
      this.currentRoomState = state;
      this.setRoomCredentials(room.name, typeof payload?.password === 'string' ? payload.password : '');
      this.elements.connectedMessage.textContent = `Connected to server ${room.name}`;
      this.elements.lobby.hidden = true;
      this.elements.roomView.hidden = false;
      this.elements.createForm.reset();
      this.elements.joinForm.reset();
      this.gameView.show(state, playerId);
      this.renderRoomControls(state);
      this.showFeedback('');
      return true;
    } catch (error) {
      this.showFeedback(error.message, true);
      return false;
    } finally {
      this.setFormsBusy(false);
      if (this.currentRoomState) this.renderRoomControls(this.currentRoomState);
    }
  }

  getDisplayNamePayload() {
    const displayName = this.elements.displayName.value.trim().replace(/\s+/gu, ' ');
    return displayName ? { displayName } : {};
  }

  setRoomCredentials(name, password) {
    this.currentRoomName = typeof name === 'string' ? name : '';
    this.currentRoomPassword = typeof password === 'string' ? password : '';
    const storage = globalThis.window?.sessionStorage;
    if (storage) {
      if (this.currentRoomPassword) storage.setItem(ROOM_PASSWORD_STORAGE_KEY, this.currentRoomPassword);
      else storage.removeItem(ROOM_PASSWORD_STORAGE_KEY);
    }
    this.elements.roomCredentialName.textContent = this.currentRoomName;
    this.elements.roomCredentialPassword.textContent = this.currentRoomPassword || 'No password (public room)';
    if (this.elements.roomDetailsName &&
        globalThis.document?.activeElement !== this.elements.roomDetailsName) {
      this.elements.roomDetailsName.value = this.currentRoomName;
    }
    if (this.elements.roomDetailsPassword &&
        globalThis.document?.activeElement !== this.elements.roomDetailsPassword) {
      this.elements.roomDetailsPassword.value = this.currentRoomPassword;
    }
    this.elements.roomCredentialsToggle.hidden = !this.currentRoomName;
    this.setRoomCredentialsVisibility(false);
  }

  setRoomCredentialsVisibility(visible) {
    this.elements.roomCredentials.hidden = !visible;
    this.elements.roomCredentialsToggle.setAttribute('aria-expanded', String(visible));
    this.elements.roomCredentialsToggle.textContent = visible ? 'Hide room details' : 'Show room details';
  }

  toggleRoomCredentials() {
    if (!this.currentRoomName) return;
    this.setRoomCredentialsVisibility(this.elements.roomCredentials.hidden);
  }

  async saveRoomDetails(event) {
    event.preventDefault();
    const name = this.elements.roomDetailsName.value.trim();
    const password = this.elements.roomDetailsPassword.value;
    const detailsVisible = !this.elements.roomCredentials.hidden;
    this.elements.roomDetailsForm.querySelectorAll('input, button').forEach((field) => { field.disabled = true; });
    try {
      const { state } = await this.roomClient.request('room:details', { name, password });
      this.setRoomCredentials(state.name, password);
      this.setRoomCredentialsVisibility(detailsVisible);
      this.updateRoomState(state);
      this.showFeedback('Room details updated.');
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.elements.roomDetailsForm.querySelectorAll('input, button').forEach((field) => { field.disabled = false; });
      this.renderRoomControls(this.currentRoomState);
    }
  }

  async leaveRoom() {
    this.elements.backButton.disabled = true;
    if (this.elements.customRulesDialog.open) this.elements.customRulesDialog.close();
    this.gameView.suspendNetworkActivity();
    try {
      await this.roomClient.request('room:leave');
      this.roomClient.setSessionToken(null);
      this.roomClient.clearReliableOutbox();
      this.gameView.hide();
      this.setRoomCredentials('', '');
      this.currentPlayerId = null;
      this.currentRoomState = null;
      this.elements.roomView.hidden = true;
      this.elements.lobby.hidden = false;
      this.showFeedback('You left the room.');
    } catch (error) {
      this.gameView.resumeNetworkActivity();
      this.showFeedback(error.message, true);
    } finally {
      this.elements.backButton.disabled = false;
    }
  }

  async startMatch() {
    this.elements.startMatchButton.disabled = true;
    try {
      const { state } = await this.roomClient.request('match:start');
      this.updateRoomState(state);
      this.showFeedback('');
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.renderRoomControls(this.currentRoomState);
    }
  }

  openCustomRules() {
    const state = this.currentRoomState;
    if (!state || state.quickPlay || state.match || state.hostId !== this.currentPlayerId) return;
    const rules = state.customGameRules ?? DEFAULT_CUSTOM_GAME_RULES;
    const values = {
      ...rules,
      winsToWin: rules.winsToWin ?? 0,
      ...rules.mapCriteria,
    };
    for (const [name, value] of Object.entries(values)) {
      const field = this.elements.customRulesForm.elements.namedItem(name);
      if (field?.type === 'checkbox') field.checked = value === true;
      else if (field) field.value = String(value);
    }
    this.setCustomRulesTab('rules');
    this.elements.customRulesDialog.showModal();
  }

  setCustomRulesTab(tab) {
    const showBots = tab === 'bots';
    this.elements.customRulesRulesTab.classList.toggle('is-active', !showBots);
    this.elements.customRulesRulesTab.setAttribute('aria-selected', String(!showBots));
    this.elements.customRulesBotsTab.classList.toggle('is-active', showBots);
    this.elements.customRulesBotsTab.setAttribute('aria-selected', String(showBots));
    this.elements.customRulesRulesPanel.hidden = showBots;
    this.elements.customRulesBotsPanel.hidden = !showBots;
    for (const [panel, inactive] of [
      [this.elements.customRulesRulesPanel, showBots],
      [this.elements.customRulesBotsPanel, !showBots],
    ]) {
      for (const field of panel.querySelectorAll('input, select, textarea')) {
        field.disabled = inactive;
      }
    }
    this.updateCustomRulesDependencies();
  }

  enableCustomProgressionShop() {
    this.elements.customRulesForm.elements.namedItem('buyPhase').value = 'progression';
  }

  updateCustomRulesDependencies() {
    const isVaried = this.elements.customRulesForm.elements.mapMode.value === 'varied';
    this.elements.customMapCriteria.hidden = !isVaried;
    for (const field of this.elements.customMapCriteria.querySelectorAll('input')) {
      field.disabled = !isVaried || this.elements.customRulesRulesPanel.hidden;
    }
  }

  async saveCustomRules(event) {
    event.preventDefault();
    const form = this.elements.customRulesForm.elements;
    const number = (name) => Number(form.namedItem(name).value);
    const criteria = this.currentRoomState?.customGameRules?.mapCriteria ??
      DEFAULT_CUSTOM_GAME_RULES.mapCriteria;
    const rules = {
      buyPhase: form.namedItem('buyPhase').value,
      infiniteGadgetUse: form.namedItem('infiniteGadgetUse').checked,
      prePhaseSeconds: number('prePhaseSeconds'),
      gamePhaseSeconds: number('gamePhaseSeconds'),
      postPhaseSeconds: number('postPhaseSeconds'),
      winsToWin: number('winsToWin') === 0 ? null : number('winsToWin'),
      roleSwapEveryMatches: number('roleSwapEveryMatches'),
      teamShuffleEveryMatches: number('teamShuffleEveryMatches'),
      teamShuffleMode: form.namedItem('teamShuffleMode').value,
      autoFillBots: this.elements.customAutoFillBots.checked,
      mapMode: form.namedItem('mapMode').value,
      mapCriteria: {
        minRooms: number('minRooms') || criteria.minRooms,
        maxRooms: number('maxRooms') || criteria.maxRooms,
        minDoorwaysPerSite: number('minDoorwaysPerSite') || criteria.minDoorwaysPerSite,
        minSymmetryPercent: number('minSymmetryPercent'),
        minRoomUtilizationPercent: number('minRoomUtilizationPercent'),
        maxSiteApproachSightline: number('maxSiteApproachSightline') || criteria.maxSiteApproachSightline,
      },
      shopProgression: form.namedItem('shopProgression').value,
      firstShopOffers: number('firstShopOffers'),
      firstShopPicks: number('firstShopPicks'),
      laterShopOffers: number('laterShopOffers'),
      laterShopPicks: number('laterShopPicks'),
      carryOverShopPicks: form.namedItem('carryOverShopPicks').checked,
      uniqueGadgetInitialChancePercent: number('uniqueGadgetInitialChancePercent'),
      uniqueGadgetChanceIncrementPercent: number('uniqueGadgetChanceIncrementPercent'),
      uniqueGadgetMaxChancePercent: number('uniqueGadgetMaxChancePercent'),
    };
    this.elements.customRulesForm.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      const { state } = await this.roomClient.request('room:custom-rules', { rules });
      this.updateRoomState(state);
      this.elements.customRulesDialog.close();
      this.showFeedback('Custom match rules saved.');
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.elements.customRulesForm.querySelectorAll('button').forEach((button) => { button.disabled = false; });
    }
  }

  async approveCustomTeams() {
    this.elements.customTeamApproveButton.disabled = true;
    try {
      const { state } = await this.roomClient.request('custom-series:approve-teams');
      this.updateRoomState(state);
      this.showFeedback('Team assignments approved.');
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.renderRoomControls(this.currentRoomState);
    }
  }

  async endCustomSeries() {
    this.elements.customSeriesEndButton.disabled = true;
    try {
      const { state } = await this.roomClient.request('custom-series:end');
      this.updateRoomState(state);
      this.showFeedback('Custom series ended by the host.');
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.renderRoomControls(this.currentRoomState);
    }
  }

  updateRoomState(state) {
    if (!this.currentPlayerId || !state) return;
    const previousQuickPlayRound = this.currentRoomState?.quickPlayState?.round ?? 0;
    if (state.quickPlay && state.quickPlayState?.phase === 'lobby' && state.quickPlayState.round === 0 && previousQuickPlayRound > 0) {
      this.quickPlaySeriesStats.clear();
      this.quickPlayAccumulatedMatches.clear();
    }
    if (state.quickPlay && state.match?.victory) this.accumulateQuickPlayRound(state.match);
    const wasGeneratingMap = Boolean(this.currentRoomState?.mapGenerationPending);
    this.currentRoomState = state;
    if (typeof state.name === 'string' && state.name !== this.currentRoomName) {
      this.currentRoomName = state.name;
      this.elements.roomCredentialName.textContent = state.name;
      this.elements.roomCredentialsToggle.hidden = false;
    }
    this.elements.connectedMessage.textContent = `Connected to server ${state.name}`;
    this.renderRoomControls(state);
    this.gameView.updateRoomState(state);
    this.renderWeaponAmmo(state.match?.players);
    this.renderBotTakeover(state);
    this.renderMatchTeamHud(state);
    this.renderScoreboard(state);
    if (wasGeneratingMap && !state.mapGenerationPending && this.mapGenerationFeedback) {
      this.elements.hostStatus.textContent = state.mapGenerationError
        ? `Map generation failed · ${state.mapGenerationError}`
        : `Map ready · seed ${state.seed}`;
      this.elements.hostStatus.hidden = false;
      this.mapGenerationFeedback = null;
    }
  }

  renderGameHud(hud = {}) {
    this.computationLevel = hud.computationLevel ?? this.computationLevel;
    this.elements.clientComputation.dataset.level = this.computationLevel.toLowerCase();
    this.elements.gameHudTimer.textContent = hud.timer ?? '';
    this.elements.gameHudTimer.hidden = !hud.timer;
    this.elements.gameHud.classList.toggle(
      'is-game-hud-urgent',
      isMatchTimerUrgent(this.currentRoomState?.match),
    );
    const selectedGadget = GADGET_DEFINITIONS[hud.selectedGadgetId] ?? null;
    const gadgetColor = selectedGadget ? `#${selectedGadget.colorHex.toString(16).padStart(6, '0')}` : '#343a40';
    this.elements.inventoryGadgetName.textContent = selectedGadget?.name ?? 'No gadget equipped';
    this.elements.inventoryGadgetDescription.textContent = selectedGadget?.description ?? 'Choose one during the buy phase';
    this.elements.inventoryGadgetCount.textContent = String(selectedGadget ? hud.gadgetCount ?? 0 : 0);
    this.elements.inventoryGadgetCard.style.setProperty('--gadget-color', gadgetColor);
    this.elements.inventoryGadgetCard.dataset.gadgetId = selectedGadget?.id ?? '';
    this.elements.inventoryGadgetCard.dataset.rarity = selectedGadget?.rarity ?? '';
    this.elements.inventoryGadgetIcon.style.backgroundColor = gadgetColor;
    this.elements.inventoryGadgetIcon.style.color = selectedGadget ? '#15191d' : '#aeb4b9';
    this.elements.inventoryWeaponCard.classList.toggle('is-equipped', hud.equippedSlot === 'weapon');
    this.elements.inventoryGadgetCard.classList.toggle('is-equipped', hud.equippedSlot === 'gadget');
    const switchStatus = hud.switching
      ? `Switching · ${(hud.switchRemainingMs / 1000).toFixed(1)}s`
      : null;
    this.elements.inventoryWeaponEquip.textContent = switchStatus ??
      (hud.equippedSlot === 'weapon' ? 'Equipped' : 'Left-click to equip');
    this.elements.inventoryGadgetStatus.textContent = hud.gadgetStatusText ?? getGadgetCardStatus({
      hasGadget: Boolean(selectedGadget),
      gadgetCount: hud.gadgetCount ?? 0,
      maxCharges: selectedGadget?.charges ?? 1,
      equippedSlot: hud.equippedSlot,
      switching: hud.switching,
      switchRemainingMs: hud.switchRemainingMs,
      cooldownRemainingMs: hud.gadgetCooldownRemainingMs,
    });
    const computation = typeof hud.computation === 'string' ? hud.computation : '';
    this.elements.clientComputation.textContent = computation;
    this.elements.clientComputation.hidden = !computation || !this.currentRoomState?.match;
    if (!this.currentRoomState?.match) return;
    this.logPerformanceSnapshot(hud);
    const status = this.currentRoomState.match.victory || hud.status?.startsWith('ROUND STARTING') ? '' : hud.status;
    const message = [status, hud.objective]
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' · ');
    this.elements.hostStatus.textContent = message;
    this.elements.hostStatus.hidden = !message;
  }

  logPerformanceSnapshot(hud) {
    const computationLevel = hud.computationLevel ?? this.computationLevel;
    if (computationLevel !== 'HIGH') return;
    this.lastPerformanceLogAt ??= -Infinity;
    const now = performance.now();
    if (now - this.lastPerformanceLogAt < 1_000) return;
    this.lastPerformanceLogAt = now;
    const metricOrNull = (value) => Number.isFinite(value) ? value : null;
    const phases = hud.computationPhases ?? {};
    const scene = this.gameView.scene;
    console.warn({
      type: 'game-performance',
      loggedAt: new Date().toISOString(),
      side: this.currentRoomState.hostId === scene?.playerId ? 'host' : 'client',
      matchId: this.currentRoomState.match.startedAt ?? null,
      computationLevel,
      computationMs: metricOrNull(hud.computationMs),
      frameDeltaMs: metricOrNull(hud.frameDeltaMs),
      hostFrameDirection: this.hostFrameMetricDirection,
      hostFrameIntervalMs: metricOrNull(this.smoothedHostFrameIntervalMs),
      hostFrameApplyMs: metricOrNull(this.smoothedHostFrameApplyMs),
      hostFrameRevisionGaps: this.hostFrameRevisionGaps,
      hostFrameRevision: metricOrNull(scene?.hostFrameRevision),
      heartbeatMaxRttMs: metricOrNull(this.gameView.matchClientDiagnostics?.network.maxHeartbeatRttMs),
      clientFrameMaxMs: metricOrNull(this.gameView.matchClientDiagnostics?.performance.maxMs),
      phasesMs: {
        frameOverlays: metricOrNull(phases.frameOverlays),
        overlaySmoke: metricOrNull(phases['frameOverlays.smoke']),
        overlayFlashEffects: metricOrNull(phases['frameOverlays.flashEffects']),
        overlayFlashVision: metricOrNull(phases['frameOverlays.flashVision']),
        simulation: metricOrNull(phases.simulation),
        botAI: metricOrNull(phases['simulation.botAI']),
        hostMovement: metricOrNull(phases['simulation.hostMovement']),
        vision: metricOrNull(phases.vision),
        visionInputSelection: metricOrNull(phases['vision.inputSelection']),
        visionPlayerRays: metricOrNull(phases['vision.playerRays']),
        visionMineReveal: metricOrNull(phases['vision.mineReveal']),
        visionTeamOverlay: metricOrNull(phases['vision.teamOverlay']),
        playerRendering: metricOrNull(phases.players),
        playerVisibility: metricOrNull(phases.playerVisibility),
        playerMarkers: metricOrNull(phases.playerMarkers),
        playerFlag: metricOrNull(phases.playerFlag),
        hostFramePublish: metricOrNull(phases.hostTx),
      },
    });
  }

  renderMatchTeamHud(state = this.currentRoomState) {
    const customSeries = state?.quickPlay ? null : state?.customSeriesState;
    const match = state?.match ?? (!state?.quickPlay && customSeries?.lastResult
      ? { players: customSeries.seriesScoreboard ?? customSeries.lastMatchScoreboard ?? [] }
      : null);
    if (!match) {
      this.elements.gameHudTeamA.textContent = '';
      this.elements.gameHudTeamB.textContent = '';
      this.elements.gameHudScoreA.textContent = '';
      this.elements.gameHudScoreB.textContent = '';
      this.elements.gameHudAlive.classList.remove('is-winner');
      this.elements.gameHudAlive.style.removeProperty('--winner-color');
      this.elements.gameHudAlive.style.gridColumn = '';
      this.elements.gameHudAlive.children[1].hidden = false;
      this.elements.gameHudAlive.setAttribute('aria-label', 'Players remaining');
      this.elements.gameHudTimer.textContent = '';
      this.elements.gameHudTimer.hidden = true;
      this.elements.gameHudTeamLabels.classList.add('is-hidden');
      this.elements.gameHudScoreA.parentElement.classList.add('is-hidden');
      this.elements.gameHud.hidden = true;
      return;
    }
    const squadRoles = state.quickPlay ? state.quickPlaySquadRoles : customSeries?.rolesBySquad;
    const leftSpawn = Object.entries(match.map?.spawnZones ?? {})
      .sort((left, right) => left[1].x - right[1].x)[0]?.[0] ?? 'red';
    const teamA = squadRoles?.A ?? leftSpawn;
    const teamB = squadRoles?.B ?? (teamA === 'red' ? 'blue' : 'red');
    const aliveCount = (team) => match.players?.filter((player) =>
      player.team === team && player.alive !== false && (player.health ?? 100) > 0).length ?? 0;
    const groupA = getTeamGroup(teamA);
    const groupB = getTeamGroup(teamB);
    const quickPlayState = state.quickPlayState ?? match.quickPlayState;
    const seriesComplete = state.quickPlay
      ? quickPlayState?.phase === 'series-report'
      : customSeries?.phase === 'complete';
    const showWinner = state.quickPlay
      ? Boolean(state.match?.victory && seriesComplete)
      : Boolean(seriesComplete && customSeries?.lastResult);
    const winnerTeam = state.quickPlay && quickPlayState?.phase === 'series-report'
      ? quickPlayState.winner ?? quickPlayState.lastResult?.winner
      : state.match?.victory?.winner ?? customSeries?.lastResult?.winner;
    const winnerGroup = getTeamGroup(winnerTeam);
    const isWinnerRow = showWinner && Boolean(winnerGroup);
    this.elements.gameHudAlive.classList.toggle('is-winner', isWinnerRow);
    this.elements.gameHudAlive.style.setProperty('--winner-color', winnerGroup?.accent ?? '#fff');
    this.elements.gameHudAlive.setAttribute('aria-label', isWinnerRow
      ? `${winnerGroup.label} wins` : 'Players remaining');
    this.elements.gameHudTeamA.textContent = isWinnerRow
      ? `${winnerGroup.label.toUpperCase()} TEAM WINS`
      : `${aliveCount(teamA)} ALIVE`;
    this.elements.gameHudTeamB.textContent = isWinnerRow ? '' : `${aliveCount(teamB)} ALIVE`;
    this.elements.gameHudTeamA.style.color = isWinnerRow
      ? winnerGroup.accent
      : groupA?.accent ?? '#dce6f3';
    this.elements.gameHudTeamB.style.color = groupB?.accent ?? '#dce6f3';
    this.elements.gameHudAlive.style.gridColumn = isWinnerRow ? '1 / -1' : '';
    this.elements.gameHudAlive.children[1].hidden = isWinnerRow;
    this.elements.gameHudLabelA.style.color = groupA?.accent ?? '#dce6f3';
    this.elements.gameHudLabelB.style.color = groupB?.accent ?? '#dce6f3';
    const seriesScore = state.quickPlay ? state.quickPlaySquadScore : customSeries?.score;
    const hasSeriesScore = Boolean(seriesScore);
    this.elements.gameHudScoreA.textContent = `${seriesScore?.A ?? 0}`;
    this.elements.gameHudScoreB.textContent = `${seriesScore?.B ?? 0}`;
    this.elements.gameHudScoreA.style.color = groupA?.accent ?? '#dce6f3';
    this.elements.gameHudScoreB.style.color = groupB?.accent ?? '#dce6f3';
    const scoreLabel = state.quickPlay && state.gameMode === 'quickplay' ? 'Practice score' : 'Series score';
    this.elements.gameHudScoreA.parentElement.setAttribute(
      'aria-label', scoreLabel,
    );
    this.elements.gameHudTeamLabels.classList.toggle('is-hidden', !hasSeriesScore);
    this.elements.gameHudScoreA.parentElement.classList.toggle('is-hidden', !hasSeriesScore);
    this.elements.gameHud.hidden = false;
    if (!state.match && customSeries?.lastResult) {
      this.elements.gameHudTimer.textContent = getCustomIntermissionStatus(state);
      this.elements.gameHudTimer.hidden = false;
    }
  }

  applyGameState(state) {
    const matchSnapshot = state?.match ?? state;
    if (!this.currentRoomState?.match || !matchSnapshot) return;
    this.gameView.applyGameState(state);
    const localPlayer = matchSnapshot.players?.find((player) => player.id === this.currentPlayerId);
    this.renderWeaponAmmo(matchSnapshot.players);
    const victoryChanged = !this.currentRoomState.match.victory && Boolean(matchSnapshot.victory);
    const previousQuickPlayPhase = this.currentRoomState.quickPlayState?.phase;
    if (matchSnapshot.quickPlayState) {
      this.currentRoomState.quickPlayState = matchSnapshot.quickPlayState;
      if (matchSnapshot.quickPlayState.phase === 'round-result' && previousQuickPlayPhase !== 'round-result') {
        this.currentRoomState.quickPlayMapGenerationPending = true;
      }
    }
    if (this.currentRoomState.quickPlay) {
      this.currentRoomState.quickPlaySquadScore = applyQuickPlayRoundResultToSquadScore(
        this.currentRoomState.quickPlaySquadScore,
        matchSnapshot,
        victoryChanged,
      );
    }
    const previousChoices = JSON.stringify(this.currentRoomState.postGame?.choices ?? {});
    this.currentRoomState.match = { ...this.currentRoomState.match, ...matchSnapshot };
    this.currentRoomState.postGame = matchSnapshot.postGame ?? this.currentRoomState.postGame;
    this.renderMatchTeamHud(this.currentRoomState);
    if (this.currentRoomState.quickPlay && this.currentRoomState.match.victory) {
      this.accumulateQuickPlayRound(this.currentRoomState.match);
    }
    this.renderScoreboard(this.currentRoomState);
    this.renderBotTakeover(this.currentRoomState);
    this.renderPostGameCountdown();
    if (victoryChanged || previousQuickPlayPhase !== this.currentRoomState.quickPlayState?.phase ||
      previousChoices !== JSON.stringify(this.currentRoomState.postGame?.choices ?? {})) {
      this.renderRoomControls(this.currentRoomState);
    }
  }

  async selectWeapon(weaponId) {
    const pendingKey = `weapon:${weaponId}`;
    if (!this.beginShopSelection(pendingKey)) return;
    try {
      const { state } = await this.roomClient.request('weapon:select', { weaponId });
      this.updateRoomState(state);
      playGameSound('equip-confirm', 0.1);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.finishShopSelection(pendingKey);
    }
  }

  async skipWeaponShop() {
    const pendingKey = 'skip';
    if (!this.beginShopSelection(pendingKey)) return;
    try {
      const { state } = await this.roomClient.request('weapon:skip');
      this.updateRoomState(state);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.finishShopSelection(pendingKey);
    }
  }

  async selectShopItem(offer) {
    const pendingKey = `item:${offer.kind}:${offer.id}:${offer.level}`;
    if (!this.beginShopSelection(pendingKey)) return;
    try {
      const { state } = await this.roomClient.request('item:select', {
        itemId: offer.id,
        level: offer.level,
        kind: offer.kind,
      });
      this.updateRoomState(state);
      playGameSound('equip-confirm', 0.1);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.finishShopSelection(pendingKey);
    }
  }

  async selectShopGadget(gadgetId) {
    const pendingKey = `gadget:${gadgetId}`;
    if (!this.beginShopSelection(pendingKey, gadgetId)) return;
    try {
      const { state } = await this.roomClient.request('gadget:select', { gadgetId });
      this.updateRoomState(state);
      playGameSound('equip-confirm', 0.1);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.finishShopSelection(pendingKey, gadgetId);
    }
  }

  beginShopSelection(pendingKey, gadgetId = null) {
    if (this.pendingShopSelections.has(pendingKey) ||
        (pendingKey !== 'skip' && this.pendingShopSelections.has('skip'))) return false;
    this.pendingShopSelections.add(pendingKey);
    if (gadgetId) this.pendingShopGadgetIds.add(gadgetId);
    this.renderWeaponSelection();
    return true;
  }

  finishShopSelection(pendingKey, gadgetId = null) {
    this.pendingShopSelections.delete(pendingKey);
    if (gadgetId) this.pendingShopGadgetIds.delete(gadgetId);
    this.renderWeaponSelection();
  }

  setQuickShopCategory(category, focus = false) {
    if (!['rifles', 'pistols', 'gadgets', 'unique'].includes(category)) return;
    this.quickShopCategory = category;
    this.renderWeaponSelection();
    if (focus) {
      const tab = category === 'rifles' ? this.elements.quickShopRiflesTab
        : category === 'pistols' ? this.elements.quickShopPistolsTab
          : category === 'gadgets' ? this.elements.quickShopGadgetsTab
            : this.elements.quickShopUniqueTab;
      tab.focus();
    }
  }

  getSelectedWeaponId(state = this.currentRoomState) {
    return state?.players?.find((player) => player.id === this.currentPlayerId)?.selectedWeaponId ??
      state?.match?.players?.find((player) => player.id === this.currentPlayerId)?.selectedWeaponId ??
      'assault-rifle';
  }

  renderWeaponSelection(state = this.currentRoomState) {
    if (!state || !this.currentPlayerId) {
      this.elements.weaponSelectPanel.hidden = true;
      this.renderInfoPanelOrdering(state);
      return;
    }
    const weaponId = this.getSelectedWeaponId(state);
    const definition = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === weaponId) ??
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    const match = state.match;
    const buyPhaseDisabled = !state.quickPlay && state.customGameRules?.buyPhase === 'none';
    const prePhase = Boolean(match && !match.victory && Number.isFinite(match.gameplayStartsAt) &&
      Date.now() < match.gameplayStartsAt);
    this.elements.weaponSelectPanel.hidden = !prePhase || buyPhaseDisabled;
    this.renderInfoPanelOrdering(state);
    const isLongPlay = LONG_PLAY_SHOP_MODES.has(state.gameMode) ||
      (!state.quickPlay && state.customGameRules?.buyPhase === 'progression');
    const activeCategory = ['rifles', 'pistols', 'gadgets', 'unique'].includes(this.quickShopCategory)
      ? this.quickShopCategory : 'rifles';
    this.elements.weaponSelectTitle.textContent = isLongPlay ? 'Weapon shop' : 'Loadout';
    this.elements.quickShopCategories.hidden = isLongPlay;
    for (const [category, tab] of [
      ['rifles', this.elements.quickShopRiflesTab],
      ['pistols', this.elements.quickShopPistolsTab],
      ['gadgets', this.elements.quickShopGadgetsTab],
      ['unique', this.elements.quickShopUniqueTab],
    ]) {
      const selected = activeCategory === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('is-active', selected);
    }
    this.elements.quickShopRiflesPanel.hidden = !isLongPlay && activeCategory !== 'rifles';
    this.elements.quickShopPistolsPanel.hidden = !isLongPlay && activeCategory !== 'pistols';
    this.elements.quickShopGadgetsPanel.hidden = !isLongPlay && activeCategory !== 'gadgets';
    this.elements.quickShopUniquePanel.hidden = isLongPlay || activeCategory !== 'unique';
    const localPlayer = state.players?.find((player) => player.id === this.currentPlayerId) ??
      match?.players?.find((player) => player.id === this.currentPlayerId);
    const offerIds = new Set(localPlayer?.weaponShopOfferIds ?? []);
    const itemOffers = isLongPlay ? localPlayer?.itemShopOfferIds ?? [] : [];
    const gadgetOfferIds = new Set(localPlayer?.gadgetShopOfferIds ?? []);
    const uniqueGadgetOfferIds = new Set((localPlayer?.uniqueGadgetShopOfferIds ?? [])
      .filter((id) => state.quickPlay !== true || !GADGET_DEFINITIONS[id]?.customMatchShopAvailable));
    const isAvailableInLoadoutShop = (gadget) =>
      isUniqueGadgetAvailableInLoadoutShop(gadget, state.quickPlay);
    const hasAlwaysAvailableUniqueGadget = Object.values(GADGET_DEFINITIONS)
      .some((gadget) => isUniqueGadgetDefinition(gadget) && isAvailableInLoadoutShop(gadget));
    const shopResolved = localPlayer?.weaponShopResolved === true;
    const itemShopResolved = localPlayer?.itemShopResolved === true;
    const remainingPrePhaseMs = (match?.gameplayStartsAt ?? 0) - Date.now();
    const unusedShopPick = isLongPlay && !shopResolved && (localPlayer?.shopPicksRemaining ?? 0) > 0;
    this.elements.weaponSelectPanel.classList.toggle(
      'is-shop-urgent',
      prePhase && remainingPrePhaseMs <= 5_000 && (!isLongPlay || unusedShopPick),
    );
    const headingHint = this.elements.weaponSelectPanel.querySelector('.weapon-select-heading span');
    if (isLongPlay) {
      const carryover = state.quickPlay || state.customGameRules?.carryOverShopPicks !== false;
      const savedHint = carryover ? ' · Unused picks carry over' : '';
      headingHint.textContent = shopResolved
        ? `Shop closed for this match${savedHint}`
        : `Choose up to ${localPlayer?.shopPicksRemaining ?? 1} offer${localPlayer?.shopPicksRemaining === 1 ? '' : 's'} · ${offerIds.size + itemOffers.length + gadgetOfferIds.size} available · or skip${savedHint}`;
    } else headingHint.textContent = 'Choose your weapon and one gadget before the round';
    this.elements.weaponShopSkip.hidden = !isLongPlay || !prePhase || shopResolved ||
      (offerIds.size === 0 && itemOffers.length === 0 && gadgetOfferIds.size === 0);
    const skipPending = this.pendingShopSelections.has('skip');
    this.elements.weaponShopSkip.disabled = !prePhase || this.formsBusy || skipPending ||
      this.roomClient.socket.readyState !== WebSocket.OPEN;
    for (const [weaponId, button] of this.weaponShopButtons) {
      const selected = weaponId === definition.id;
      const offered = offerIds.has(weaponId) && !shopResolved;
      button.hidden = isLongPlay && !offered;
      button.classList.toggle('is-selected', !isLongPlay && selected);
      button.setAttribute('aria-pressed', String(!isLongPlay && selected));
      button.disabled = !prePhase || this.formsBusy || this.roomClient.socket.readyState !== WebSocket.OPEN ||
        skipPending || this.pendingShopSelections.has(`weapon:${weaponId}`) ||
        (!isLongPlay && selected) || (isLongPlay && (!offered || shopResolved));
    }
    for (const [gadgetId, button] of this.gadgetShopButtons) {
      const gadget = GADGET_DEFINITIONS[gadgetId];
      const isUnique = isUniqueGadgetDefinition(gadget);
      const offered = isLongPlay ? gadgetOfferIds.has(gadgetId)
        : isUnique ? uniqueGadgetOfferIds.has(gadgetId) || isAvailableInLoadoutShop(gadget) : true;
      const options = isLongPlay || !isUnique
        ? this.elements.gadgetShopOptions : this.elements.uniqueGadgetShopOptions;
      if (button.parentElement !== options) options.append(button);
      const selected = gadgetId === localPlayer?.selectedGadgetId || this.pendingShopGadgetIds.has(gadgetId);
      button.hidden = isLongPlay ? !offered : isUnique && !offered;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !prePhase || this.formsBusy || this.roomClient.socket.readyState !== WebSocket.OPEN ||
        skipPending || this.pendingShopSelections.has(`gadget:${gadgetId}`) ||
        (isLongPlay && (!offered || shopResolved)) || (!isLongPlay && selected);
    }
    this.elements.uniqueGadgetShopEmpty.hidden = isLongPlay || uniqueGadgetOfferIds.size > 0 ||
      hasAlwaysAvailableUniqueGadget;
    const itemOfferSignature = JSON.stringify(itemOffers.map(({ kind, id, level, name, description }) =>
      ({ kind, id, level, name, description })));
    this.elements.itemShopOptions.hidden = !isLongPlay;
    if (itemOfferSignature !== this.itemShopOfferSignature) {
      this.itemShopOfferSignature = itemOfferSignature;
      this.elements.itemShopOptions.replaceChildren();
      for (const offer of itemOffers) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'weapon-shop-option item-shop-option';
        button.dataset.itemId = offer.id;
        button.dataset.itemLevel = String(offer.level);
        button.dataset.itemKind = offer.kind;
        button.dataset.sound = 'equip';
        const title = document.createElement('strong');
        title.className = 'weapon-shop-name';
        title.textContent = `${offer.name} · Level ${offer.level}`;
        const heading = document.createElement('span');
        heading.className = 'weapon-shop-heading';
        heading.append(createShopItemIcon(offer.kind === 'armor' ? 'armor' : 'item'), title);
        const description = document.createElement('span');
        description.className = 'weapon-shop-description';
        description.textContent = offer.description;
        const category = document.createElement('span');
        category.className = 'weapon-shop-stats';
        category.textContent = offer.kind === 'armor' ? 'Armor upgrade · Regens after 5s' : 'Perk';
        button.append(heading, description, category);
        button.addEventListener('click', () => this.selectShopItem(offer));
        this.elements.itemShopOptions.append(button);
      }
    }
    for (const button of this.elements.itemShopOptions.querySelectorAll('button')) {
      button.disabled = !prePhase || this.formsBusy || skipPending ||
        this.pendingShopSelections.has(`item:${button.dataset.itemKind}:${button.dataset.itemId}:${button.dataset.itemLevel}`) ||
        this.roomClient.socket.readyState !== WebSocket.OPEN || (isLongPlay ? shopResolved : itemShopResolved);
    }
    this.renderWeaponAmmo(match?.players);
  }

  renderInfoPanelOrdering(state = this.currentRoomState) {
    const match = state?.match;
    const prePhase = Boolean(match && !match.victory && Number.isFinite(match.gameplayStartsAt) &&
      Date.now() < match.gameplayStartsAt && !this.elements.weaponSelectPanel.hidden);
    const postPhase = Boolean(match?.victory ||
      (!match && !state?.quickPlay && state?.customSeriesState?.lastResult) ||
      ['round-result', 'series-report'].includes(state?.quickPlayState?.phase));
    this.elements.gameSidebar.classList.toggle('shop-first', prePhase);
    this.elements.gameSidebar.classList.toggle('scoreboard-first', postPhase);
  }

  renderWeaponAmmo(players) {
    const localPlayer = getCurrentMatchPlayer(players, this.currentPlayerId);
    const weaponId = localPlayer?.selectedWeaponId ?? this.getSelectedWeaponId();
    const definition = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === weaponId) ??
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    const predictedWeaponStats = localPlayer ? this.gameView.getPredictedWeaponStats(localPlayer.id) : null;
    const stats = predictedWeaponStats?.[definition.id] ?? localPlayer?.weaponStats?.[definition.id];
    const capacity = getEffectiveMagazineSize(definition.magazineSize, localPlayer?.inventory);
    const ammo = Math.max(0, Math.min(capacity, stats?.ammo ?? capacity));
    const typeLabel = getWeaponTypeLabel(definition);
    this.elements.inventoryWeaponCard.classList.toggle(
      'is-low-ammo',
      capacity > 0 && ammo / capacity <= 0.25 && !stats?.reloading,
    );
    this.elements.inventoryWeaponName.textContent = definition.name;
    this.elements.inventoryWeaponType.textContent = typeLabel;
    this.elements.inventoryWeaponIcon.replaceChildren(
      createWeaponIconImage(definition.id) ?? document.createTextNode('⌁'),
    );
    this.elements.inventoryWeaponTags.replaceChildren();
    for (const tag of definition.description.split('·').map((value) => value.trim()).filter(Boolean)) {
      const element = document.createElement('span');
      element.className = 'inventory-weapon-tag';
      element.setAttribute('role', 'listitem');
      element.textContent = tag;
      this.elements.inventoryWeaponTags.append(element);
    }
    this.elements.weaponAmmoCount.textContent = `${ammo} / ${capacity}`;
    this.elements.weaponAmmoIcons.setAttribute('aria-label', `${ammo} of ${capacity} rounds loaded`);
    while (this.weaponAmmoIcons.length < capacity) {
      const icon = document.createElement('span');
      icon.className = 'rifle-ammo-icon';
      icon.setAttribute('aria-hidden', 'true');
      this.elements.weaponAmmoIcons.append(icon);
      this.weaponAmmoIcons.push(icon);
    }
    this.weaponAmmoIcons.forEach((icon, index) => {
      icon.hidden = index >= capacity;
      icon.classList.toggle('is-spent', index >= ammo);
    });
    if (stats?.reloading) {
      const seconds = Math.max(0, ((stats.reloadEndsAt - Date.now()) / 1000)).toFixed(1);
      this.elements.weaponReloadStatus.textContent = definition.reloadPerRound
        ? `Loading round ${ammo + 1} · ${seconds}s · fire to interrupt`
        : `Reloading · ${Math.ceil(Number(seconds))}s`;
    } else {
      this.elements.weaponReloadStatus.textContent = '';
    }
    this.renderInventoryArmor(localPlayer);
    this.renderInventoryItems(localPlayer);
  }

  renderInventoryArmor(player) {
    const armor = player?.inventory?.armor ?? null;
    const maxArmor = Math.max(0, Math.ceil(player?.maxArmor ?? 0));
    const armorPoints = Math.max(0, Math.ceil(player?.armor ?? 0));
    const health = Math.max(0, Math.ceil(player?.health ?? 100));
    this.elements.inventoryArmorName.textContent = armor?.name ?? 'No armor equipped';
    this.elements.inventoryArmorLevel.textContent = armor ? `Level ${armor.level ?? 1}` : 'Armor slot empty';
    this.elements.inventoryHealthPoints.textContent = `${health} / 100`;
    this.elements.inventoryArmorPointsRow.hidden = maxArmor <= 0;
    this.elements.inventoryArmorPoints.textContent = `${armorPoints} / ${maxArmor}`;

    const effects = getInventoryEffects(player?.inventory);
    this.elements.inventoryArmorRegen.textContent = '';
    if (armor && maxArmor > armorPoints && effects.armorRegeneration > 0) {
      const regenStartsAt = (player?.lastDamagedAt ?? Date.now()) + effects.regenerationDelayMs;
      const waitMs = regenStartsAt - Date.now();
      this.elements.inventoryArmorRegen.textContent = waitMs > 0
        ? `Armor regenerates in ${(waitMs / 1000).toFixed(1)}s`
        : `Regenerating · ${effects.armorRegeneration} armor/s`;
    }
  }

  renderInventoryItems(playerOrInventory) {
    const player = playerOrInventory?.inventory ? playerOrInventory : null;
    const inventory = player?.inventory ?? playerOrInventory;
    const items = (inventory?.perks ?? [])
      .filter((perk) => perk && typeof perk === 'object')
      .map((perk) => ({ ...perk, category: 'Perk' }));
    this.elements.inventoryItemGrid.replaceChildren();
    for (const item of items) {
      const card = document.createElement('div');
      card.className = `inventory-item inventory-item--${item.category === 'Armor' ? 'armor' : 'perk'}`;
      card.setAttribute('role', 'listitem');
      const category = document.createElement('span');
      category.className = 'inventory-item-category';
      category.textContent = item.category;
      const name = document.createElement('strong');
      name.className = 'inventory-item-name';
      name.textContent = item.name ?? item.displayName ?? item.id ?? item.category;
      const level = document.createElement('span');
      level.className = 'inventory-item-level';
      level.textContent = `Level ${item.level ?? 1}`;
      card.append(category, name, level);
      if (item.description) {
        const description = document.createElement('span');
        description.className = 'inventory-item-description';
        description.textContent = item.description;
        card.append(description);
      }
      this.elements.inventoryItemGrid.append(card);
    }
    this.elements.inventoryItemsEmpty.hidden = items.length > 0;
  }

  renderRoomControls(state) {
    if (!state || !this.currentPlayerId) {
      delete this.elements.roomView.dataset.modeTheme;
      this.elements.startMatchButton.hidden = true;
      this.elements.customRulesButton.hidden = true;
      this.elements.customTeamApproveButton.hidden = true;
      this.elements.customSeriesEndButton.hidden = true;
      this.elements.quickPlayReadyButton.hidden = true;
      this.elements.teamPanel.hidden = true;
      this.elements.inventoryPanel.hidden = true;
      this.elements.weaponSelectPanel.hidden = true;
      this.elements.scoreboardPanel.hidden = true;
      this.elements.hostStatus.hidden = true;
      this.elements.mapSeedControls.hidden = true;
      this.elements.roomDetailsForm.hidden = true;
      this.elements.botTakeoverPanel.hidden = true;
      this.elements.gameSidebar.classList.remove('bot-controlled');
      this.elements.roomView.classList.remove('match-active');
      this.renderInfoPanelOrdering(null);
      return;
    }

    const matchActive = Boolean(state.match);
    const gameMode = state.gameMode ?? state.quickPlayState?.gameMode;
    const modeTheme = gameMode === 'longseries' ? 'long-play'
      : gameMode === 'longplay' ? 'quick-play'
        : gameMode === 'quickplay' ? 'practice' : '';
    if (modeTheme) this.elements.roomView.dataset.modeTheme = modeTheme;
    else delete this.elements.roomView.dataset.modeTheme;
    this.elements.roomView.classList.toggle('match-active', matchActive);
    this.renderPostGameCountdown(state);
    this.renderWeaponSelection(state);
    const localMatchPlayer = getCurrentMatchPlayer(state.match?.players, this.currentPlayerId);
    const controlledBot = localMatchPlayer?.isBot && localMatchPlayer.controlledById === this.currentPlayerId;
    this.elements.gameSidebar.classList.toggle('bot-controlled', Boolean(controlledBot));
    const localPlayerIsPlaying = Boolean(localMatchPlayer);
    const postGameFreeRoam = this.gameView.isPostGameFreeRoam(state.match, state);
    this.elements.inventoryPanel.hidden = !matchActive || !localPlayerIsPlaying ||
      Boolean(state.match?.victory && (!postGameFreeRoam || !localMatchPlayer?.alive || localMatchPlayer.health <= 0));
      this.renderScoreboard(state);
    this.elements.hostStatus.hidden = false;
    const isHost = state.hostId === this.currentPlayerId;
    this.elements.roomDetailsForm.hidden = !isHost || state.locked !== true;
    if (this.elements.roomDetailsName &&
        globalThis.document?.activeElement !== this.elements.roomDetailsName) {
      this.elements.roomDetailsName.value = state.name;
    }
    if (this.elements.roomDetailsPassword &&
        globalThis.document?.activeElement !== this.elements.roomDetailsPassword) {
      this.elements.roomDetailsPassword.value = this.currentRoomPassword;
    }
    this.elements.roomDetailsForm.querySelector('button[type="submit"]').disabled =
      this.formsBusy || this.roomClient.socket.readyState !== WebSocket.OPEN;
    const count = state.players.length;
    const teams = this.getTeamCounts(state.players, state.bots?.roster);
    const botCount = (state.bots?.counts?.red ?? 0) + (state.bots?.counts?.blue ?? 0);
    const seriesMode = getSeriesModeCopy(state);
    if (!matchActive) {
      this.elements.hostStatus.textContent = state.quickPlay
        ? `${seriesMode.label} · ${count} in lobby · Teams assigned evenly`
        : isHost
          ? `You’re hosting · ${count} ${count === 1 ? 'player' : 'players'}${botCount ? ` + ${botCount} bots` : ''}`
          : `Hosted by ${state.hostName} · ${count} ${count === 1 ? 'player' : 'players'}${botCount ? ` + ${botCount} bots` : ''}`;
    }
    this.elements.startMatchButton.hidden = matchActive || Boolean(state.quickPlay) || !isHost;
    this.elements.customRulesButton.hidden = matchActive || Boolean(state.quickPlay) || !isHost;
    const seriesState = state.customSeriesState;
    const teamShufflePending = Boolean(seriesState?.teamShufflePending);
    this.elements.customTeamApproveButton.hidden = matchActive || !isHost || !teamShufflePending;
    this.elements.customTeamApproveButton.disabled = this.formsBusy ||
      this.roomClient.socket.readyState !== WebSocket.OPEN;
    this.elements.customSeriesEndButton.hidden = matchActive || !isHost ||
      !seriesState || seriesState.matchNumber < 1 || seriesState.phase === 'complete';
    this.elements.customSeriesEndButton.disabled = this.formsBusy ||
      this.roomClient.socket.readyState !== WebSocket.OPEN;
    const mapGenerationPending = Boolean(state.mapGenerationPending);
    const mapReady = state.mapReady !== false;
    this.elements.startMatchButton.disabled = mapGenerationPending || !mapReady || teamShufflePending;
    this.elements.startMatchButton.textContent = mapGenerationPending
      ? 'Searching for map…' : !mapReady
        ? state.mapGenerationMode === 'host-choice' ? 'Choose a map' : 'Map unavailable'
        : seriesState?.phase === 'complete' ? 'Start new series' : 'Start match';
    if (!matchActive && seriesState?.matchNumber > 0) {
      const score = seriesState.score ?? { A: 0, B: 0 };
      const target = state.customGameRules?.winsToWin;
      const progress = target === null
        ? `Team A ${score.A}–${score.B} Team B · infinite`
        : `Team A ${score.A}–${score.B} Team B · first to ${target}`;
      this.elements.hostStatus.textContent += ` · Series ${progress}`;
      if (teamShufflePending) this.elements.hostStatus.textContent += ' · host team approval required';
      if (seriesState.phase === 'complete' && seriesState.endedByHost) {
        this.elements.hostStatus.textContent += ' · ended by host';
      }
    }
    if (matchActive && !state.quickPlay && state.match?.victory &&
        seriesState?.phase === 'postgame' && mapGenerationPending) {
      this.elements.hostStatus.textContent =
        `Searching for next map · ${state.mapGenerationCount ?? 0} generated`;
    }
    if (mapGenerationPending && !matchActive) {
      const generated = state.mapGenerationCount ?? 0;
      this.elements.hostStatus.textContent += ` · Searching for maps · ${generated} generated`;
    } else if (state.mapGenerationMode === 'host-choice' && !mapReady && isHost && !matchActive) {
      this.elements.hostStatus.textContent += ' · Choose a map before starting';
    } else if ((state.mapGenerationError || !mapReady) && isHost && !matchActive) {
      this.elements.hostStatus.textContent += ' · Map unavailable; prepare one before starting';
    }
    const quickPlayLobby = Boolean(state.quickPlay && !state.match && state.quickPlayState?.phase === 'lobby');
    const localQuickPlayReady = state.quickPlayState?.ready?.[this.currentPlayerId] === true;
    this.elements.quickPlayReadyButton.hidden = !quickPlayLobby;
    this.elements.quickPlayReadyButton.textContent = localQuickPlayReady ? 'Cancel ready' : 'Ready up';
    this.elements.quickPlayReadyButton.disabled = this.formsBusy || this.roomClient.socket.readyState !== WebSocket.OPEN;
    const seedChanged = this.displayedMapSeed !== state.seed;
    if (seedChanged || document.activeElement !== this.elements.mapSeedInput) {
      this.elements.mapSeedInput.value = String(state.seed);
    }
    this.displayedMapSeed = state.seed;
    const mapOptions = state.mapOptions ?? { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS };
    this.elements.mapRoomCount.value = String(mapOptions.minRooms === mapOptions.maxRooms ? mapOptions.minRooms : DEFAULT_MAX_ROOMS);
    this.elements.mapSeedControls.hidden = !isHost || Boolean(state.match) || Boolean(state.quickPlay);
    const mapControlsDisabled = Boolean(state.match || state.mapGenerationPending);
    this.elements.mapSeedInput.disabled = mapControlsDisabled;
    this.elements.mapRoomCount.disabled = mapControlsDisabled;
    this.elements.mapSeedForm.querySelector('button[type="submit"]').disabled = mapControlsDisabled;
    this.elements.mapSeedRandomize.disabled = mapControlsDisabled;
    this.elements.mapCompetitiveGenerate.disabled = mapControlsDisabled;
    this.renderMapMetrics(state.seed, mapOptions);
    const quickPlayResult = Boolean(state.quickPlay && state.quickPlayState?.phase === 'round-result');
    this.renderTeamPanel(state, teams, state.quickPlay ? false : isHost,
      state.quickPlay
        ? !state.match && state.quickPlayState?.phase === 'lobby'
        : !state.match || quickPlayResult);
    this.elements.teamPanel.hidden = matchActive && !quickPlayResult;
    this.renderBotTakeover(state);
    this.renderQuickPlayCountdown(state);
  }

  renderScoreboard(state = this.currentRoomState) {
    const match = state?.match;
    const customSeries = state?.quickPlay ? null : state?.customSeriesState;
    const savedMatchPlayers = customSeries?.seriesScoreboard ?? customSeries?.lastMatchScoreboard ?? [];
    const hasSavedCustomScoreboard = savedMatchPlayers.length > 0;
    this.elements.scoreboardPanel.hidden = !match && !hasSavedCustomScoreboard;
    this.renderInfoPanelOrdering(state);
    if (!match && !hasSavedCustomScoreboard) {
      this.scoreboardSignature = '';
      this.elements.scoreboardSeriesScore.hidden = true;
      this.elements.scoreboardSeriesScore.textContent = '';
      return;
    }

    const scoreboardPlayers = this.getScoreboardPlayers(state);
    const human = scoreboardPlayers.find((player) => player.id === this.currentPlayerId);
    const roomHuman = state.players?.find((player) => player.id === this.currentPlayerId);
    const ownTeam = human?.team ?? roomHuman?.team ?? 'red';
    const squadRoles = state?.quickPlay ? state.quickPlaySquadRoles : customSeries?.rolesBySquad;
    this.elements.scoreboardSeriesScore.hidden = true;
    this.elements.scoreboardSeriesScore.textContent = '';
    const teams = squadRoles
      ? ['A', 'B'].map((squadId) => squadRoles[squadId]).filter(Boolean)
      : [ownTeam, ownTeam === 'red' ? 'blue' : 'red'];
    const signature = JSON.stringify({
      matchId: match?.startedAt ?? null,
      matchFinished: Boolean(match?.victory),
      customSeriesPhase: customSeries?.phase ?? null,
      customSeriesLastResult: customSeries?.lastResult?.at ?? null,
      quickPlayRound: state?.quickPlayState?.round ?? null,
      quickPlayPhase: state?.quickPlayState?.phase ?? null,
      teams,
      squadRoles,
      players: scoreboardPlayers.map((player) => [player.id, player.team, player.name, player.isBot,
        player.squadId ?? null,
        player.alive, player.controlledById,
        player.stats?.kills ?? 0, player.stats?.assists ?? 0, player.stats?.deaths ?? 0]),
    });
    if (signature === this.scoreboardSignature) return;
    this.scoreboardSignature = signature;

    const fragment = document.createDocumentFragment();
    for (const team of teams) {
      const section = document.createElement('section');
      const teamGroup = getTeamGroup(team);
      section.className = `scoreboard-team scoreboard-team--${teamGroup.cssName}`;
      const heading = document.createElement('h3');
      const squadId = squadRoles
        ? Object.entries(squadRoles).find(([, role]) => role === team)?.[0]
        : null;
      const teamLabel = squadId ? `TEAM ${squadId}` : teamGroup.label.toUpperCase();
      heading.textContent = team === ownTeam ? `${teamLabel} · YOUR TEAM` : `${teamLabel} · OPPONENTS`;
      section.append(heading);

      const columnHeadings = document.createElement('div');
      columnHeadings.className = 'scoreboard-row scoreboard-columns';
      const playerHeading = document.createElement('span');
      playerHeading.textContent = 'PLAYER';
      columnHeadings.append(playerHeading);
      for (const [label, accessibleLabel] of [
        ['K', 'Kills'], ['A', 'Assists'], ['D', 'Deaths'],
      ]) {
        const column = document.createElement('span');
        column.textContent = label;
        column.setAttribute('aria-label', accessibleLabel);
        columnHeadings.append(column);
      }
      section.append(columnHeadings);

      const players = scoreboardPlayers.filter((player) => player.team === team)
        .sort((left, right) => {
          const leftKills = left.stats?.kills ?? 0;
          const rightKills = right.stats?.kills ?? 0;
          const leftAssists = left.stats?.assists ?? 0;
          const rightAssists = right.stats?.assists ?? 0;
          return (rightKills + rightAssists) - (leftKills + leftAssists) ||
            rightKills - leftKills || left.name.localeCompare(right.name);
        })
        .slice(0, 5);
      for (let index = 0; index < 5; index += 1) {
        const player = players[index];
        const isSelf = player && (player.id === this.currentPlayerId || player.controlledById === this.currentPlayerId);
        const row = document.createElement('div');
        row.className = `scoreboard-row${player ? '' : ' scoreboard-row--empty'}${isSelf ? ' is-self' : ''}${player && !player.alive ? ' is-dead' : ''}`;
        const name = document.createElement('span');
        name.className = 'scoreboard-player-name';
        name.textContent = player
          ? `${player.name}${player.isBot ? ' · BOT' : ''}${isSelf ? ' · YOU' : ''}${!player.alive ? ' · OUT' : ''}`
          : '—';
        row.append(name);
        for (const value of player
          ? [player.stats?.kills ?? 0, player.stats?.assists ?? 0, player.stats?.deaths ?? 0]
          : ['', '', '']) {
          const stat = document.createElement('span');
          stat.textContent = String(value);
          row.append(stat);
        }
        section.append(row);
      }
      fragment.append(section);
    }
    this.elements.scoreboardTeams.replaceChildren(fragment);
  }

  accumulateQuickPlayRound(match) {
    accumulateQuickPlayRound(this.quickPlaySeriesStats, this.quickPlayAccumulatedMatches, match);
  }

  getScoreboardPlayers(state) {
    const match = state?.match;
    if (!state?.quickPlay) return getCustomSeriesScoreboardPlayers(match, state?.customSeriesState);
    if (this.quickPlaySeriesStats.size === 0) return match?.players ?? [];
    return getQuickPlayScoreboardPlayers(match, this.quickPlaySeriesStats, this.quickPlayAccumulatedMatches);
  }

  renderBotTakeover(state = this.currentRoomState) {
    const match = state?.match;
    const human = match?.players?.find((player) => player.id === this.currentPlayerId);
    const team = human?.team ?? state?.players?.find((player) => player.id === this.currentPlayerId)?.team;
    const eligibleSpectator = Boolean(match && team &&
      (!human || human.isSpectator === true || human.alive === false || human.health <= 0));
    const availableBots = eligibleSpectator
      ? match.players.filter((player) => player.isBot && player.team === team &&
        player.isSpectator !== true && player.alive !== false && (player.health ?? 0) > 0)
      : [];
    this.elements.botTakeoverPanel.hidden = !eligibleSpectator;
    if (!eligibleSpectator) {
      this.botTakeoverButtons.clear();
      this.elements.botTakeoverOptions.replaceChildren();
      return;
    }
    if (availableBots.length === 0) {
      this.elements.botTakeoverHelp.textContent = 'No living teammate bots are available to take over.';
      this.botTakeoverButtons.clear();
      this.elements.botTakeoverOptions.replaceChildren();
      return;
    }
    const controlledBot = availableBots.find((bot) => bot.controlledById === this.currentPlayerId);
    this.elements.botTakeoverHelp.textContent = controlledBot
      ? `You are controlling ${controlledBot.name}. Your human player remains eliminated.`
      : 'You are spectating. Take control of a living bot on your team.';
    const activeBotIds = new Set(availableBots.map((bot) => bot.id));
    for (const [botId, button] of this.botTakeoverButtons) {
      if (activeBotIds.has(botId)) continue;
      button.remove();
      this.botTakeoverButtons.delete(botId);
    }
    for (const bot of availableBots) {
      let button = this.botTakeoverButtons.get(bot.id);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'bot-takeover-button';
        button.dataset.botId = bot.id;
        this.botTakeoverButtons.set(bot.id, button);
        this.elements.botTakeoverOptions.append(button);
      }
      const controlledByMe = bot.controlledById === this.currentPlayerId;
      const occupied = Boolean(bot.controlledById && !controlledByMe);
      button.textContent = controlledByMe ? `Release ${bot.name}`
        : occupied ? `${bot.name} · controlled` : `Take over ${bot.name}`;
      button.classList.toggle('is-controlled', controlledByMe);
      button.dataset.takeControl = String(!controlledByMe);
      button.disabled = this.botTakeoverBusy || occupied || this.roomClient.socket.readyState !== WebSocket.OPEN;
    }
  }

  async setBotTakeover(botId, takeControl) {
    if (this.botTakeoverBusy) return;
    this.botTakeoverBusy = true;
    const botName = this.currentRoomState?.bots?.roster?.find((bot) => bot.id === botId)?.name ??
      this.currentRoomState?.match?.players?.find((player) => player.id === botId)?.name ?? 'teammate bot';
    this.elements.botTakeoverHelp.textContent = takeControl
      ? `Requesting control of ${botName}…`
      : `Releasing ${botName}…`;
    for (const button of this.elements.botTakeoverOptions.querySelectorAll('button')) button.disabled = true;
    try {
      const { state } = await this.roomClient.request('bot:takeover', { botId, takeControl });
      const bot = state?.match?.players?.find((player) => player.id === botId);
      if (!bot || (takeControl && bot.controlledById !== this.currentPlayerId) ||
          (!takeControl && bot.controlledById === this.currentPlayerId)) {
        throw new Error('The server did not confirm the bot control change. Please try again.');
      }
      this.updateRoomState(state);
      this.showFeedback(takeControl ? `You are now controlling ${bot.name}. Use WASD and aim/fire in the map.` : `${bot.name} returned to AI control.`);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.botTakeoverBusy = false;
      this.renderBotTakeover(this.currentRoomState);
    }
  }

  renderQuickPlayCountdown(state = this.currentRoomState) {
    const quickPlayLobby = state?.quickPlay && state.quickPlayState?.phase === 'lobby' && !state.match;
    if (!quickPlayLobby || !this.elements.hostStatus || this.elements.hostStatus.hidden) return;
    const ready = state.quickPlayState?.ready ?? {};
    const readyCount = state.players.filter((player) => ready[player.id] === true).length;
    const allReady = state.players.length > 0 && readyCount === state.players.length;
    const mapGenerating = state.quickPlayMapGenerationPending === true;
    const mode = getSeriesModeCopy(state);
    const statusLabel = mapGenerating
      ? allReady
        ? 'Everyone ready · Generating map…'
        : 'Ready up when you’re ready · Generating map…'
      : allReady
        ? 'Everyone ready · starting match'
        : 'Waiting for players to ready up';
    this.elements.hostStatus.textContent = `${mode.label} · Ready ${readyCount}/${state.players.length} · ${statusLabel}`;
  }

  async toggleQuickPlayReady() {
    const state = this.currentRoomState;
    if (!state?.quickPlay || state.quickPlayState?.phase !== 'lobby' || this.formsBusy) return;
    const ready = state.quickPlayState.ready?.[this.currentPlayerId] !== true;
    this.elements.quickPlayReadyButton.disabled = true;
    try {
      const { state: updatedState } = await this.roomClient.request(getSeriesModeCopy(state).readyType, { ready });
      this.updateRoomState(updatedState);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.renderRoomControls(this.currentRoomState);
    }
  }

  renderPostGameCountdown(state = this.currentRoomState) {
    if (state?.quickPlay && state.quickPlayState) {
      const quickPlay = state.quickPlayState;
      const seconds = Math.max(0, Math.ceil(((quickPlay.phaseEndsAt ?? Date.now()) - Date.now()) / 1000));
      if (quickPlay.phase === 'countdown') {
        this.setPostGameMessage('');
        return;
      }
      if (quickPlay.phase === 'round-result') {
        const mapStatus = state.quickPlayMapGenerationPending ? ' · preparing next map' : '';
        this.setPostGameMessage(`Next round in ${seconds}s${mapStatus}`);
        return;
      }
      if (quickPlay.phase === 'series-report') {
        this.setPostGameMessage(`Returning to lobby in ${seconds}s`);
        return;
      }
    }
    if (!state?.quickPlay && !state?.match && state?.customSeriesState?.lastResult) {
      const status = getCustomIntermissionStatus(state);
      this.elements.gameHudTimer.textContent = status;
      this.elements.gameHudTimer.hidden = false;
      this.setPostGameMessage(status);
      return;
    }
    const postGame = state?.postGame ?? state?.match?.postGame;
    if (!state?.match?.victory || !Number.isFinite(postGame?.endsAt)) {
      this.setPostGameMessage('');
      return;
    }
    const remainingSeconds = Math.max(0, Math.ceil((postGame.endsAt - Date.now()) / 1000));
    this.setPostGameMessage(
      `${getPostGameCountdownLabel(state)} in ${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`);
  }

  setPostGameMessage(message) {
    if (message === this.postGameMessage) return;
    this.postGameMessage = message;
    this.renderGameHud(this.gameView.scene?.hudState ?? {});
  }

  renderRooms(rooms) {
    this.elements.roomList.replaceChildren();
    if (rooms.length === 0) {
      const emptyState = document.createElement('li');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No active rooms yet. Create one to get started.';
      this.elements.roomList.append(emptyState);
      return;
    }

    for (const room of rooms) {
      const item = document.createElement('li');
      item.className = 'room-item';
      const details = document.createElement('div');
      details.className = 'room-details';
      const name = document.createElement('strong');
      name.textContent = room.name;
      const meta = document.createElement('span');
      const roomState = room.full ? 'Full' : room.locked ? 'Password required' : 'Open';
      const modeLabel = SERIES_MODE_COPY[room.gameMode]?.label ?? 'Practice';
      const activity = room.quickPlay
        ? room.quickPlayPhase === 'series-report' ? `${modeLabel} final report`
          : room.quickPlayPhase === 'round-result' ? `${modeLabel} · Round ${room.quickPlayRound} result`
            : room.quickPlayPhase === 'playing' || room.quickPlayPhase === 'countdown'
              ? `${modeLabel} · Round ${room.quickPlayRound ?? ''}` : `${modeLabel} lobby`
        : room.inProgress ? 'Match in progress' : `Hosted by ${room.hostName}`;
      meta.textContent = room.quickPlay
        ? `${room.clients} in lobby · ${roomState} · ${activity}`
        : `${room.clients}/${room.capacity} players · ${roomState} · ${activity}`;
      details.append(name, meta);

      const joinButton = document.createElement('button');
      joinButton.type = 'button';
      joinButton.className = 'button button-secondary';
      joinButton.textContent = room.full ? 'Full' : room.locked ? 'Select' : 'Join';
      joinButton.dataset.full = String(room.full);
      joinButton.disabled = room.full || this.roomClient.socket.readyState !== WebSocket.OPEN;
      joinButton.addEventListener('click', async () => {
        if (room.locked) {
          this.elements.joinName.value = room.name;
          this.elements.joinPassword.focus();
          this.showFeedback(`Enter the password for ${room.name}, then select Join room.`);
          return;
        }

        joinButton.disabled = true;
        joinButton.textContent = 'Joining…';
        await this.connectToRoom('room:join', { name: room.name, password: '', ...this.getDisplayNamePayload() });
        if (!this.elements.lobby.hidden) {
          joinButton.textContent = 'Join';
          joinButton.disabled = room.full || this.roomClient.socket.readyState !== WebSocket.OPEN;
        }
      });
      item.append(details, joinButton);
      this.elements.roomList.append(item);
    }
  }

  setFormsBusy(busy) {
    this.formsBusy = busy;
    const connected = this.roomClient.socket.readyState === WebSocket.OPEN;
    this.elements.createForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = busy || !connected; });
    this.elements.joinForm.querySelectorAll('input, select, button').forEach((element) => { element.disabled = busy || !connected; });
    this.elements.refreshButton.disabled = busy || !connected;
    this.elements.quickPlayButton.disabled = busy || !connected;
    this.elements.longPlayButton.disabled = busy || !connected;
    this.elements.longSeriesButton.disabled = busy || !connected;
    this.elements.customRulesButton.disabled = busy || !connected;
    this.elements.seriesModePublicButton.disabled = busy || !connected;
    this.elements.seriesModePrivateButton.disabled = busy || !connected;
    this.elements.privateSeriesForm.querySelectorAll('input, button').forEach((element) => { element.disabled = busy || !connected; });
    this.elements.quickPlayReadyButton.disabled = busy || !connected;
    this.elements.displayName.disabled = busy || !connected;
    this.elements.roomList.querySelectorAll('.room-item button').forEach((button) => {
      button.disabled = busy || button.dataset.full === 'true' || !connected;
    });
  }

  getTeamCounts(players, bots = []) {
    const counts = players.reduce((result, player) => {
      const teamId = getTeamGroupId(player.team);
      if (teamId) result[teamId] += 1;
      return result;
    }, Object.fromEntries(TEAM_GROUPS.map(({ id }) => [id, 0])));
    for (const bot of bots ?? []) {
      const teamId = getTeamGroupId(bot.team);
      if (teamId) counts[teamId] += 1;
    }
    return counts;
  }

  getQuickPlaySquadCounts(players = [], bots = []) {
    const counts = { A: 0, B: 0 };
    for (const member of [...players, ...(bots ?? [])]) {
      if (member.squadId === 'A' || member.squadId === 'B') counts[member.squadId] += 1;
    }
    return counts;
  }

  getTeamDisplayLabel(state, team) {
    if (!state?.quickPlay) return team.label;
    const squadId = Object.entries(state.quickPlaySquadRoles ?? {})
      .find(([, role]) => role === team.id)?.[0];
    return squadId ? `Team ${squadId}` : 'team';
  }

  renderTeamPanel(state, counts, isHost, canEditTeams) {
    this.elements.teamPanel.hidden = false;
    this.elements.teamGroups.replaceChildren();
    const squadCounts = state.quickPlay
      ? this.getQuickPlaySquadCounts(state.players, state.bots?.roster)
      : null;
    const orderedTeams = state.quickPlay
      ? ['A', 'B'].map((squadId) => {
        const team = getTeamGroup(state.quickPlaySquadRoles?.[squadId]);
        return team ? { ...team, squadId } : null;
      }).filter(Boolean)
      : TEAM_GROUPS;
    for (const team of orderedTeams) {
      const group = document.createElement('section');
      group.className = `team-group team-group--${team.cssName}`;
      const heading = document.createElement('h3');
      const squadId = team.squadId ?? null;
      heading.textContent = squadId ? `TEAM ${squadId}` : team.label;
      const count = document.createElement('span');
      count.textContent = state.quickPlay
        ? `${squadCounts[squadId]} ${squadCounts[squadId] === 1 ? 'player' : 'players'}`
        : `${counts[team.id]}/${team.capacity}`;
      const list = document.createElement('ul');
      for (const player of state.players.filter((entry) => getTeamGroupId(entry.team) === team.id)) {
        const item = document.createElement('li');
        const quickPlayReady = state.quickPlay && state.quickPlayState?.phase === 'lobby' &&
          state.quickPlayState.ready?.[player.id] === true ? ' · READY' : '';
        const connectionStatus = player.connected === false ? ' · RECONNECTING' : '';
        item.textContent = `${player.id === this.currentPlayerId ? `${player.name} (you)` : player.name}${quickPlayReady}${connectionStatus}`;
        if (player.id === this.currentPlayerId) item.classList.add('is-self');
        if (player.connected === false) item.classList.add('is-disconnected');
        list.append(item);
      }
      for (const bot of (state.bots?.roster ?? []).filter((entry) => entry.team === team.id)) {
        const item = document.createElement('li');
        item.className = 'team-bot';
        item.textContent = `${bot.name} · bot`;
        list.append(item);
      }
      if (list.children.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'team-empty';
        empty.textContent = 'No players';
        list.append(empty);
      }
      group.append(heading, count, list);
      this.elements.teamGroups.append(group);
    }

    this.elements.teamStatus.textContent = 'Teams balanced';
    this.elements.teamHelp.textContent = state.postGame
      ? 'Everyone returns to this lobby when the countdown ends. Choose Back to rooms to leave.'
      : state.quickPlay
      ? 'When teams are even, players are randomly assigned to Team A or Team B. You can switch teams while the lobby is open; players who join during a round enter the next one.'
      : 'Players are automatically balanced between the Strike Team and Flag Team. Switch teams if the other side has room.';
    if (isHost && !state.quickPlay) {
      this.elements.teamHelp.textContent = 'Move any player between the Strike Team and Flag Team. If a team is full, select someone to swap with.';
    }
    this.elements.teamSelfActions.hidden = isHost || !canEditTeams;
    this.elements.teamSelfActions.replaceChildren();
    this.elements.teamForm.hidden = !isHost || !canEditTeams;
    this.elements.teamPlayerField.hidden = !isHost;
    if (!isHost && canEditTeams) {
      const currentPlayer = state.players.find((player) => player.id === this.currentPlayerId);
      const currentTeam = getTeamGroupId(currentPlayer?.team);
      const joinableTeams = TEAM_GROUPS.filter((entry) => entry.id !== currentTeam);
      for (const team of joinableTeams) {
        const teamLabel = this.getTeamDisplayLabel(state, team);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `button button-secondary team-join-button team-join-button--${team.cssName}`;
        button.textContent = state.quickPlay ? `Switch to ${teamLabel}` : `Join ${teamLabel}`;
        const full = counts[team.id] >= team.capacity;
        button.disabled = full;
        if (full) button.title = `${teamLabel} is full`;
        button.addEventListener('click', () => this.changeOwnTeam(team.id));
        this.elements.teamSelfActions.append(button);
      }
    }

    const previousPlayerId = this.elements.teamPlayerSelect.value;
    this.elements.teamPlayerSelect.replaceChildren();
    if (isHost && canEditTeams) {
      for (const player of state.players) {
        const option = document.createElement('option');
        option.value = player.id;
        option.textContent = `${player.name}${player.id === this.currentPlayerId ? ' (you)' : ''}`;
        this.elements.teamPlayerSelect.append(option);
      }
      this.elements.teamPlayerSelect.value = state.players.some((player) => player.id === previousPlayerId)
        ? previousPlayerId
        : this.currentPlayerId;
    }

    this.currentTeamCounts = counts;
    this.teamIsHost = isHost;
    if (isHost && canEditTeams) this.updateTeamActionOptions(true);
    this.renderBotSettings(state, isHost);
  }

  renderBotSettings(state, isHost) {
    const visible = isHost && !state.quickPlay && !state.match;
    if (!visible) return;
    const humans = this.getTeamCounts(state.players);
    const assignedBots = state.bots?.roster ?? [];
    const assignments = new Map(assignedBots.map((bot) => [bot.id, bot.team]));
    const assignedCounts = { red: 0, blue: 0 };
    for (const bot of assignedBots) assignedCounts[bot.team] += 1;
    const connected = this.roomClient.socket.readyState === WebSocket.OPEN;
    for (const [botId, buttons] of this.botAssignmentButtons) {
      const currentTeam = assignments.get(botId) ?? 'none';
      for (const team of ['red', 'blue']) {
        const button = buttons[team];
        const full = humans[team] + assignedCounts[team] - Number(currentTeam === team) >=
          TEAM_GROUPS.find((group) => group.id === team).capacity;
        const label = getTeamGroup(team).label;
        button.textContent = currentTeam === team ? `${label} ✓` : `Add ${label}`;
        button.classList.toggle('is-assigned', currentTeam === team);
        button.disabled = this.formsBusy || this.botSettingsBusy || !connected || (full && currentTeam !== team);
      }
      buttons.remove.disabled = this.formsBusy || this.botSettingsBusy || !connected || currentTeam === 'none';
    }
  }

  async assignBot(botId, team) {
    if (this.botSettingsBusy) return;
    this.botSettingsBusy = true;
    this.renderBotSettings(this.currentRoomState, true, true);
    try {
      const { state } = await this.roomClient.request('bots:set', { botId, team });
      this.updateRoomState(state);
      const bot = BOT_PERSONALITIES.find((personality) => personality.id === botId);
      this.showFeedback(team === 'none' ? `${bot.name} removed from the match.` : `${bot.name} added to ${getTeamGroup(team).label}.`);
    } catch (error) {
      this.showFeedback(error.message, true);
    } finally {
      this.botSettingsBusy = false;
      this.renderRoomControls(this.currentRoomState);
    }
  }

  updateTeamActionOptions(resetDestination = false) {
    const state = this.currentRoomState;
    if (!state || !this.currentPlayerId) return;
    const playerId = this.teamIsHost ? this.elements.teamPlayerSelect.value : this.currentPlayerId;
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) return;

    const currentTeam = getTeamGroupId(player.team);
    const destinationLabel = this.elements.teamDestinationSelect.previousElementSibling;
    if (destinationLabel) destinationLabel.textContent = state.quickPlay ? 'Join team' : 'Join group';
    for (const option of this.elements.teamDestinationSelect.options) {
      const team = getTeamGroup(option.value);
      option.textContent = state.quickPlay ? this.getTeamDisplayLabel(state, team) : team.label;
    }
    if (resetDestination) this.elements.teamDestinationSelect.value = currentTeam;
    const destination = this.elements.teamDestinationSelect.value;
    const capacity = TEAM_GROUPS.find((group) => group.id === destination).capacity;
    const full = this.currentTeamCounts[destination] >= capacity;
    const needsSwap = this.teamIsHost && destination !== currentTeam && full;

    for (const option of this.elements.teamDestinationSelect.options) {
      const optionCapacity = TEAM_GROUPS.find((group) => group.id === option.value).capacity;
      const optionFull = this.currentTeamCounts[option.value] >= optionCapacity;
      option.disabled = !this.teamIsHost && optionFull && option.value !== currentTeam;
    }

    this.elements.teamSwapField.hidden = !needsSwap;
    this.elements.teamSwapSelect.replaceChildren();
    if (needsSwap) {
      const swapCandidates = state.players.filter((entry) => entry.id !== player.id && getTeamGroupId(entry.team) === destination);
      for (const candidate of swapCandidates) {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = candidate.name;
        this.elements.teamSwapSelect.append(option);
      }
    }

    const invalidSelfFullMove = !this.teamIsHost && full && destination !== currentTeam;
    this.elements.teamSubmitButton.textContent = needsSwap ? 'Swap players'
      : this.teamIsHost ? 'Move player'
        : state.quickPlay ? `Join ${this.getTeamDisplayLabel(state, getTeamGroup(destination))}` : 'Join group';
    this.elements.teamSubmitButton.disabled = destination === currentTeam || invalidSelfFullMove || (needsSwap && this.elements.teamSwapSelect.options.length === 0);
  }

  async submitTeamChange(event) {
    event.preventDefault();
    const playerId = this.teamIsHost ? this.elements.teamPlayerSelect.value : this.currentPlayerId;
    const payload = {
      playerId,
      team: this.elements.teamDestinationSelect.value,
      swapWithPlayerId: this.elements.teamSwapField.hidden ? null : this.elements.teamSwapSelect.value,
    };
    this.elements.teamSubmitButton.disabled = true;
    try {
      const { state } = await this.roomClient.request('team:set', payload);
      this.updateRoomState(state);
      this.showFeedback('');
    } catch (error) {
      this.showFeedback(error.message, true);
      this.updateTeamActionOptions();
    }
  }

  async changeOwnTeam(team) {
    const buttons = [...this.elements.teamSelfActions.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const { state } = await this.roomClient.request('team:set', { team });
      this.updateRoomState(state);
      this.showFeedback('');
    } catch (error) {
      this.showFeedback(error.message, true);
      this.renderRoomControls(this.currentRoomState);
    }
  }

  async applyMapSeed(event) {
    event.preventDefault();
    const seed = Number(this.elements.mapSeedInput.value);
    const roomCount = Number(this.elements.mapRoomCount.value);
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) {
      this.showFeedback('Enter a whole-number seed from 1 to 4294967295.', true);
      return;
    }
    if (!Number.isSafeInteger(roomCount) || roomCount < MIN_ROOMS || roomCount > MAX_ROOMS) {
      this.showFeedback(`Choose a room count from ${MIN_ROOMS} to ${MAX_ROOMS}.`, true);
      return;
    }
    await this.changeMapSeed({ seed, roomCount });
  }

  async generateNewMapSeed() {
    await this.changeMapSeed({ random: true, randomRoomCount: true });
  }

  async generateCompetitiveMap() {
    this.mapGenerationFeedback = 'competitive';
    this.setMapGenerationBusy(true);
    this.showFeedback('Searching for a map with the competitive criteria…');
    try {
      const { state } = await this.roomClient.request('map:competitive', {}, { timeoutMs: 10_000 });
      this.updateRoomState(state);
    } catch (error) {
      this.mapGenerationFeedback = null;
      this.showFeedback(error.message, true);
    } finally {
      this.setMapGenerationBusy(false);
    }
  }

  async changeMapSeed(payload) {
    this.mapGenerationFeedback = 'seed';
    this.setMapGenerationBusy(true);
    this.showFeedback('Generating map…');
    try {
      const { state } = await this.roomClient.request('map:seed', payload);
      this.updateRoomState(state);
    } catch (error) {
      this.mapGenerationFeedback = null;
      this.showFeedback(error.message, true);
    } finally {
      this.setMapGenerationBusy(false);
    }
  }

  setMapGenerationBusy(busy) {
    const disabled = busy || Boolean(this.currentRoomState?.match || this.currentRoomState?.mapGenerationPending);
    this.elements.mapSeedInput.disabled = disabled;
    this.elements.mapRoomCount.disabled = disabled;
    this.elements.mapSeedForm.querySelector('button[type="submit"]').disabled = disabled;
    this.elements.mapSeedRandomize.disabled = disabled;
    this.elements.mapCompetitiveGenerate.disabled = disabled;
  }

  renderMapMetrics(seed, options) {
    if (this.currentRoomState?.mapGenerationMode === 'host-choice' &&
        this.currentRoomState.mapReady === false && !this.currentRoomState.mapGenerationPending) {
      this.elements.mapMetrics.textContent = 'Choose a seed, generate a random map, or search for a competitive map.';
      return;
    }
    if (this.currentRoomState?.mapGenerationPending) {
      this.elements.mapMetrics.textContent = 'Generating map…';
      return;
    }
    if (!Number.isSafeInteger(seed) || !options || !this.elements.mapMetrics) return;
    const key = `${seed}:${options.minRooms}:${options.maxRooms}`;
    let metrics = this.mapMetricsCache.get(key);
    if (!metrics) {
      try {
        metrics = generateMap(seed, undefined, undefined, options).metrics;
        this.mapMetricsCache.set(key, metrics);
      } catch {
        this.elements.mapMetrics.textContent = 'Map preview metrics unavailable.';
        return;
      }
    }
    this.elements.mapMetrics.textContent =
      `Site sightline  ${metrics.siteSightline.centerlineBlocked ? 'Blocked' : 'Open'} · ${metrics.siteSightline.baffleAdded ? 'layout baffle added' : 'room/hall walls block it'}\n` +
      `Site doorways  Strike Site ${metrics.siteDoorways.red.doorwayCount} openings / ${metrics.siteDoorways.red.graphEdgeCount} halls · ` +
      `Flag Site ${metrics.siteDoorways.blue.doorwayCount} openings / ${metrics.siteDoorways.blue.graphEdgeCount} halls\n` +
      `Useful rooms  ${metrics.roomUtilization.usedRooms}/${metrics.roomUtilization.totalRooms} ` +
      `(${Math.round(metrics.roomUtilization.percent * 100)}%) · ${metrics.roomUtilization.offRouteRooms} off-route · ` +
      `${metrics.roomUtilization.deadEndRooms} leaf dead ends · ${metrics.roomUtilization.criticalRooms} route-critical\n` +
      `Complexity  ${metrics.complexity.label} · ${metrics.complexity.routeCount}${metrics.complexity.routeCountCapped ? '+' : ''} routes · ${metrics.complexity.loopCount} loops\n` +
      `Topology  ${metrics.topology.walkableAreaPercent}% walkable · ${metrics.topology.maxSymmetryPercent}% max symmetry · ${metrics.topology.averageEccentricity} avg eccentricity\n` +
      `Visibility  ${metrics.visibility.averageVisibleDirections}/${16} open directions · max sightline ${metrics.visibility.maxSightline}\n` +
      `Aggression estimate  ${metrics.aggressiveness.label} (${metrics.aggressiveness.score.toFixed(2)}) · ` +
      `Pace estimate  ${metrics.pace.label} (${metrics.pace.score.toFixed(2)}), ~${metrics.pace.estimatedEngagementSeconds}s to engage`;
  }

  showFeedback(message, isError = false) {
    if (this.feedbackTimeout !== null) {
      window.clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
    this.elements.feedback.textContent = message;
    this.elements.feedback.classList.toggle('feedback-error', isError);
    this.elements.feedback.classList.toggle('feedback-visible', Boolean(message));
    this.elements.feedback.setAttribute('aria-hidden', String(!message));
    if (message && isError) {
      this.feedbackTimeout = window.setTimeout(() => {
        this.elements.feedback.textContent = '';
        this.elements.feedback.classList.remove('feedback-visible', 'feedback-error');
        this.elements.feedback.setAttribute('aria-hidden', 'true');
        this.feedbackTimeout = null;
      }, 5000);
    }
  }
}
