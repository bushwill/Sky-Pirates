import Phaser from 'phaser';
import { constrainPositionToRadius, getPlayerMovementScale, interpolatePosition, movePositionWithCatchUp, PLAYER_RADIUS, selectSnapshotPosition, shouldHostSimulateActor, SLOW_WALK_SPEED_SCALE } from './MovementModel.js';
import { COMPETITIVE_MAP_RULES, DEFAULT_MAX_ROOMS, DEFAULT_MIN_ROOMS, generateMap, isCompetitiveMap, MAP_GENERATOR_VERSION, MAP_HEIGHT, MAP_WIDTH, MAX_MAP_SEED } from '../../../shared/MapGenerator.js';
import { DEFAULT_PROJECTILE_DEFINITIONS, getMapRayEnd, getProjectileDamageAlongSegment } from '../../../shared/ProjectileModel.js';
import { applyGadgetAreaDamage, applyHostPropDamage, applyMolotovWorldEffects, applyTrophySystemDamage, findFirstKatanaDashTarget, getHostAimAngle, getHostShotAngle, preserveDestructiblePropState, resolveHostShotCollision } from '../../../shared/HostCombatModel.js';
import { awardKillAndAssists } from '../../../shared/CombatAttribution.js';
import { applyInventoryWeaponEffects, getInventoryEffects, regeneratePlayerArmor } from '../../../shared/InventoryModel.js';
import { getMaximumRotationRadiansPerSecond, getMaximumSpreadRadians, rotateAngleTowards } from '../../../shared/WeaponAccuracy.js';
import { getWeaponAimAngle, getWeaponMuzzlePosition } from '../../../shared/WeaponGeometry.js';
import { updateWeaponLeanState } from '../../../shared/WeaponLean.js';
import { selectOwnerControlledPose } from './MovementPrediction.js';
import {
  consumePredictedShotPellet,
  shouldRenderConfirmedProjectile,
} from './ProjectilePrediction.js';
import { decayRenderCorrection, getRenderedPosition, getRenderCorrection } from './RenderCorrection.js';
import {
  createVision,
  createXrayVision,
  forgetRememberedObjectSurfaces,
  getNewlyRevealedWalls,
  getPlayerVisionOrigin,
  getSegmentVisionIntervals,
  getVisionPolygonScanlineIntervals,
  isCircleVisible,
  isPointVisible,
  pointInVisionPolygon,
  revealVisionCells,
  TEAMMATE_VISION_BASE_RAY_COUNT,
  VISION_HALF_ANGLE,
  VISION_MEMORY_CELL_SIZE,
} from '../../../shared/VisionModel.js';
import {
  HOST_FRAME_INTERVAL_MS,
  getAdaptiveUpdateProfile,
  getComputationLevel,
  getTeammateVisionInterval,
  smoothComputationTime,
} from '../../../shared/ComputationMetric.js';
import {
  formatAliveTeamCounts,
  formatQuickPlayScore,
  formatVictoryText,
  getAliveTeamCounts,
  getPostGameCountdownLabel,
} from './MatchStatus.js';
import { advanceQuickPlaySeriesResult } from './QuickPlayScore.js';
import { getNextBotActionSequence } from './BotActionSequence.js';
import {
  advanceWeaponState,
  applyWeaponAction,
  createInitialWeaponState,
  ensureWeaponState,
  getPredictedPelletAngles,
  hasPendingSemiAutoShot,
  selectOwnerWeaponStats,
} from './WeaponPrediction.js';
import { getDeathFeedbackStyle, getDeathFeedbackType } from './DeathFeedback.js';
import { ALLY_PLAYER_COLOR, ENEMY_PLAYER_COLOR } from '../../../shared/PlayerColors.js';
import { getTeamGroup } from '../../../shared/GameRules.js';
import { TEAM_SPAWN_OFFSETS } from '../../../shared/GameRules.js';
import {
  applyHostFrame,
  createHostFrame,
  preserveLiveHostGadgetState,
  preserveLiveHostPlayers,
} from '../../../shared/HostFrameSnapshot.js';
import { MAX_HOST_FRAME_EVENTS, validateHostFrame } from '../../../shared/HostFrameProtocol.js';
import {
  beginMatchReportFrame,
  completeMatchReport,
  completeMatchClientDiagnostics,
  createMatchClientDiagnostics,
  createMatchReport,
  recordMatchClientConnection,
  recordMatchClientFrame,
  recordMatchClientHeartbeat,
  recordMatchClientHostFrame,
  recordMatchClientPhase,
  recordMatchReportFrame,
  recordMatchReportHostFrame,
  recordMatchReportPhase,
  recordMatchReportWork,
  validateMatchClientDiagnostics,
  validateMatchReport,
} from '../../../shared/MatchReport.js';
import {
  advanceHostSonarProjectiles,
  createHostSonarProjectile,
  createHostGadgetEffect,
  createHostTrophyCommandProjectile,
  applyHostJammerDetonation,
  createHostKatanaDashEffect,
  createHostOrbitalStrikeImpact,
  createHostOrbitalStrikeWarning,
  createHostSpyCamera,
  findTrophyCommandClearedEffects,
} from '../../../shared/HostGadgetModel.js';
import {
  findTrophyPlacedGadgetInterceptions,
  findTrophyProjectileInterceptions,
  getOwnedActiveTrophySystem,
} from '../../../shared/TrophySystemModel.js';
import { collectFootstepAudioCues, findSonarListener, isAudioSourceVisibleToPlayer, isAudioSourceVisibleToTeam } from '../../../shared/AudioCueModel.js';
import {
  beginGadgetSwitch,
  consumeSelectedGadget,
  getEquippedSlot as getGadgetEquippedSlot,
  preservePendingGadgetState,
} from './GadgetState.js';
import { isAudioCueSupersededByVisibleEnemy } from './AudioCueIntel.js';
import {
  isHostBotCueEvent,
  isPersonalAudioCueForViewer,
  isPersonalDamageCueForViewer,
} from './JammedCuePolicy.js';
import { pruneSmokeMemory, rememberSmokeObservation } from './SmokeMemory.js';
import { getSmokeVisibleSamples } from './SmokeVisibility.js';
import { consumeFixedSteps, SIMULATION_STEP_MS } from './FixedStepClock.js';
import {
  getGadgetEffectSoundName,
  getGameSoundStartDelayMs,
  isGadgetEffectSoundAudibleToTeam,
  getManualActionSoundName,
  getReloadSoundEvents,
  getWeaponSoundName,
  playGameSound,
  playJammerStaticSound,
  playKatanaDashSound,
  playSonarCastSound,
  playSpatialGameSound,
} from './SoundEffects.js';
import {
  getFlagTransitionSound,
  getOutcomeSoundNames,
  getUrgentCustomPostGameCue,
  getUrgentTimerCue,
} from './MatchAudio.js';
import { reconcileOwnerWeaponSnapshot } from './HostFrameReconciliation.js';
import { applyOwnerMovementUpdate } from './OwnerMovementSync.js';
import { isPlayerVisibleToViewer } from './PlayerIntelVisibility.js';
import {
  acknowledgeWeaponActions,
  MAX_PENDING_WEAPON_ACTIONS,
  retryWeaponActions,
} from './OwnerActionQueue.js';
import {
  activateVineTrap,
  advanceVineTrapRecharge,
  calculateGadgetTrajectory,
  calculateKatanaDash,
  advanceOrbitalStrikeCooldown,
  advanceKatanaChargeRecharge,
  advanceSonarChargeRecharges,
  BIO_FIELD_COOLDOWN_MS,
  BIO_FIELD_ID,
  DEFAULT_GADGET_EFFECT_RADIUS,
  DEFAULT_GADGET_THROW_COLLISION_RADIUS,
  GADGET_DEFINITIONS,
  getGadgetProjectileSpeed,
  getPerChargeGadgetRechargeRemainingMs,
  getSonarRechargeRemainingMs,
  getKatanaRechargeRemainingMs,
  JAMMER_GRENADE_COOLDOWN_MS,
  JAMMER_GRENADE_ID,
  ORBITAL_STRIKE_ID,
  ORBITAL_STRIKE_RADIUS,
  PROXIMITY_MINE_BODY_RADIUS,
  PROXIMITY_MINE_ID,
  queueOrbitalStrikeRecharge,
  queueKatanaChargeRecharge,
  queuePerChargeGadgetRecharge,
  queueSonarChargeRecharge,
  advancePerChargeGadgetRecharges,
  refillGadgetCharges,
  isGadgetJammed,
  isPlayerJammed,
  refundKatanaCharge,
  SPY_CAMERA_BODY_RADIUS,
  SPY_CAMERA_ID,
  SPY_CAMERA_RANGE,
  TROPHY_SYSTEM_BODY_RADIUS,
  TROPHY_SYSTEM_ID,
  TROPHY_SYSTEM_COMMAND_COOLDOWN_MS,
  TROPHY_SYSTEM_COMMAND_EFFECT_ID,
  TROPHY_SYSTEM_COMMAND_RADIUS,
  TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS,
  TROPHY_INTERCEPT_VISUAL_DURATION_MS,
  SONAR_ID,
  KATANA_ID,
  KATANA_DASH_HIT_RADIUS,
  KATANA_DASH_MAX_DISTANCE,
  SONAR_LISTENING_RADIUS,
  FLASH_GRENADE_VISUAL_DURATION_MS,
  applyFlashBlindness,
  getGadgetMovementScale,
  getGadgetWeaponTurnScale,
  isPlayerFlashBlinded as hasFlashBlindness,
  getGadgetThrowOrigin,
  isProximityMineArmed,
  isVineTrapTargetDead,
  startVineTrapRecharge,
  VINE_TRAP_ID,
} from '../../../shared/GadgetModel.js';
import { getSpyCameraBatteryStatus } from './GadgetCardStatus.js';

const INPUT_INTERVAL_MS = 25;
const AIM_SYNC_INTERVAL_MS = 50;
const SHOT_SOUND_BASE_VOLUMES = Object.freeze({
  'gunshot-revolver': 0.25,
  'gunshot-pocket-shotgun': 0.32,
  'gunshot-marksman-rifle': 0.3,
  'gunshot-suppressed': 0.14,
  'gunshot-pistol': 0.25,
  'gunshot-shotgun': 0.32,
  'gunshot-rifle': 0.25,
  'gunshot-battle-rifle': 0.2,
  'gunshot-smg': 0.2,
  'gunshot-sniper': 0.3,
  'gunshot-heavy-sniper': 0.45,
});
const SHOT_SOUND_WEAPON_VOLUME_OVERRIDES = Object.freeze({
  'battle-pistol': 0.2,
  'heavy-sniper': 0.65,
});
const RELOAD_SOUND_BASE_VOLUMES = Object.freeze({
  'reload-magazine': 0.24,
  'reload-shotgun-shell': 0.2,
  'reload-round': 0.2,
});
const MANUAL_ACTION_SOUND_BASE_VOLUME = 0.2;
const WEAPON_DEFINITIONS_BY_ID = new Map(
  Object.values(DEFAULT_PROJECTILE_DEFINITIONS).map((weapon) => [weapon.id, weapon]),
);
const GADGET_SOUND_BASE_VOLUMES = Object.freeze({
  molotov: 0.28,
  'smoke-grenade': 0.2,
  'cryo-grenade': 0.25,
  'flash-grenade': 0.35,
  'jammer-static': 0.3,
  'mine-explosion': 0.4,
  'orbital-strike': 0.7,
  'orbital-strike-fire': 0.28,
});
const PLAYER_VISIBILITY_CACHE_INTERVAL_MS = 50;
const VISION_POSITION_EPSILON = 1;
const VISION_OVERLAY_UPDATE_INTERVAL_MS = 1000 / 30;
const VISION_MEMORY_REFRESH_INTERVAL_MS = 120;
const CONTROLLED_PLAYER_OUTLINE_COLOR = 0xffd12e;
const WEAPON_FIRE_ERROR_REASONS = new Set([
  'client-pending-action-limit',
  'client-send-failed',
  'client-shot-unacknowledged',
  'host-authority-context-rejected',
  'host-actor-or-sequence-rejected',
  'host-selected-weapon-mismatch',
  'host-stale-sequence',
]);
const GADGET_ACTION_ERROR_REASONS = new Set([
  'client-send-failed',
  'host-authority-context-rejected',
  'host-actor-or-sequence-rejected',
  'host-player-not-alive',
  'host-gameplay-not-started',
  'host-switch-rejected-no-gadget',
  'host-switch-rejected-trophy-command-jammed',
  'host-selection-rejected',
  'host-use-rejected-no-selected-gadget',
  'host-use-rejected-wrong-slot',
  'host-use-rejected-gameplay-not-started',
  'host-use-rejected-no-count',
  'host-use-rejected-invalid-target',
  'host-use-rejected-no-trajectory',
  'host-use-rejected-effect-creation',
  'host-use-rejected-trophy-command-cooldown',
  'host-use-rejected-trophy-command-target',
  'host-action-unknown',
  'host-mine-intel-send-failed',
]);
const FLAG_DEPTH = 2.97;

function sameInventoryEffects(left, right) {
  if (left === right) return true;
  if ((left?.armor?.id ?? null) !== (right?.armor?.id ?? null) ||
      (left?.armor?.level ?? null) !== (right?.armor?.level ?? null)) return false;
  const leftPerks = left?.perks ?? [];
  const rightPerks = right?.perks ?? [];
  if (leftPerks.length !== rightPerks.length) return false;
  return leftPerks.every((perk) =>
    rightPerks.some((candidate) => candidate.id === perk.id && candidate.level === perk.level));
}

function interpolateHexColor(start, end, amount) {
  const t = Math.max(0, Math.min(1, amount));
  const channel = (shift) => Math.round(((start >> shift) & 0xff) * (1 - t) + ((end >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
const GAMEPLAY_START_SAFETY_MS = 250;
const MAX_INTEL_SPANS_PER_MESSAGE = 120;

function encodeCellIndicesAsSpans(indices) {
  if (indices.length === 0) return [];
  indices.sort((left, right) => left - right);
  const spans = [];
  let start = indices[0];
  let end = start + 1;
  for (let index = 1; index < indices.length; index += 1) {
    const cell = indices[index];
    if (cell < end) continue;
    if (cell === end) {
      end += 1;
      continue;
    }
    spans.push(start, end);
    start = cell;
    end = cell + 1;
  }
  spans.push(start, end);
  return spans;
}

function traceVisionPath(context, vision) {
  const [origin, ...points] = vision?.points ?? [];
  if (!origin || points.length < 2) return false;
  context.moveTo(origin.x, origin.y);
  for (const point of points) context.lineTo(point.x, point.y);
  context.closePath();
  return true;
}

class MatchScene extends Phaser.Scene {
  constructor(roomClient, playerId) {
    super('room');
    this.roomClient = roomClient;
    this.playerId = playerId;
    this.controlledBotId = null;
    this.botControlSequence = 0;
    this.botActionSequence = 0;
    this.botReloadPendingUntil = 0;
    this.roomState = null;
    this.botUpdateHandler = null;
    this.hostFrameUpdateHandler = null;
    this.hudUpdateHandler = null;
    this.hudState = { status: '', timer: '', score: '', alive: '', objective: '', computation: '',
      computationLevel: 'LOW',
      equippedSlot: null, selectedGadgetId: null, gadgetCount: 0, switching: false,
      switchRemainingMs: 0, gadgetCooldownRemainingMs: 0, gadgetStatusText: null, placement: 'top' };
    this.lastHudTimerText = null;
    this.lastUrgentTimerTickKey = null;
    this.match = null;
    this.matchReport = null;
    this.pendingMatchReports = [];
    this.matchReportUploadPending = false;
    this.matchClientDiagnostics = null;
    this.pendingMatchClientDiagnostics = [];
    this.matchClientDiagnosticsUploadPending = false;
    this.flagSoundMatchId = null;
    this.flagSoundHolderId = undefined;
    this.playedMatchOutcomeKeys = new Set();
    this.playedSeriesOutcomeKeys = new Set();
    this.mapWidth = MAP_WIDTH;
    this.mapHeight = MAP_HEIGHT;
    this.mapObjects = [];
    this.visionObjectsMap = null;
    this.visionObjectsSmokeSnapshot = null;
    this.visionObjectsNextSmokeExpiryAt = -Infinity;
    this.visionObjectsCache = null;
    this.destructibleObjectHealthIntel = new Map();
    this.visiblePropIds = new Set();
    this.visiblePropsDirty = false;
    this.lastVisiblePropScanAt = -Infinity;
    this.players = new Map();
    this.hostMineIntelByTeam = { red: new Set(), blue: new Set() };
    this.publishedMineIntelByTeam = { red: new Set(), blue: new Set() };
    this.localKnownMineIds = new Set();
    this.lastMineIntelPublishAt = -Infinity;
    this.markers = new Map();
    this.deathFeedbacks = new Set();
    this.hitMarkerExpiresAt = 0;
    this.localKillStreak = 0;
    this.pendingSnapRemotePlayers = false;
    this.localInputSequence = 0;
    this.lastInputSequenceSent = 0;
    this.weaponActionSequence = 0;
    this.pendingWeaponActions = new Map();
    this.weaponFireDiagnosticLogAt = new Map();
    this.gadgetActionDiagnosticLogAt = new Map();
    this.pendingGadgetSequence = null;
    this.gadgetUsePendingUntil = 0;
    this.authorityInputs = new Map();
    this.hostFrameRevision = 0;
    this.hostFrameErrorLogAt = new Map();
    this.lastHostFrameAt = -Infinity;
    this.pendingHostEvents = [];
    this.hostGadgetInterceptionSequence = 0;
    this.consumedHostEventIds = new Set();
    this.recentHostEvents = new Map();
    this.hostMapGenerationKey = null;
    this.hostMapSearchToken = 0;
    this.authorityEpoch = null;
    this.simulationAccumulatorMs = 0;
    this.networkSuspended = false;
    this.lastInputAt = 0;
    this.lastInputSignature = '';
    this.lastControlFireHeld = false;
    this.fireHeld = false;
    this.firePressSequence = 0;
    this.lastSemiAutoFirePress = 0;
    this.botReloadPressed = false;
    this.predictedShotPellets = new Map();
    this.predictedProjectileVisuals = new Map();
    this.gadgetProjectileVisuals = new Map();
    this.cancelledGadgetProjectileIds = new Set();
    this.playedShotSoundKeys = new Set();
    this.playedWeaponSoundEventKeys = new Set();
    this.playedGadgetSoundIds = new Set();
    this.lastShotAt = -Infinity;
    this.hitMarkerExpiresAt = 0;
    this.lastAimSentAt = -Infinity;
    this.localAimAngle = null;
    this.localAimMatchId = null;
    this.localAimWeaponId = null;
    this.weaponLean = 0;
    this.weaponLeanState = { toggleLean: 0, currentLean: 0, qDown: false, eDown: false, qPressedAt: null, ePressedAt: null };
    this.weaponLeanMatchId = null;
    this.localVisionAngle = 0;
    this.intelMatchId = null;
    this.exploredCells = null;
    this.exploredWallObjects = new Map();
    this.pendingWallIntel = new Map();
    this.lastWallIntelSendAt = -Infinity;
    this.knownCorpseIds = new Set();
    this.corpseIntelTeam = null;
    this.currentVisions = [];
    this.flashVisuals = new Map();
    this.trophyInterceptVisuals = new Map();
    this.flashBlinded = false;
    this.smokeVisibilityCache = new Map();
    this.rememberedSmokes = new Map();
    this.visionCacheByPlayer = new Map();
    this.visionInputCacheByPlayer = new Map();
    this.spyCameraVisionCache = new Map();
    this.sonarVisionCache = new Map();
    this.audioCues = new Map();
    this.footstepCueLastAt = new Map();
    this.lastFootstepCueCheckAt = -Infinity;
    this.pings = new Map();
    this.damageIndicators = new Map();
    this.lastVisionUpdateAt = -Infinity;
    this.lastVisionMemoryAt = -Infinity;
    this.lastVisionOverlayUpdateAt = -Infinity;
    this.lastFrameOverlayUpdateAt = -Infinity;
    this.visionOverlayDirty = false;
    this.visionRefreshAtByPlayer = new Map();
    this.playerVisibilityCache = new Map();
    this.playerVisibilityRevision = 0;
    this.playerVisibilityCacheTime = -Infinity;
    this.smoothedComputationMs = null;
    this.smoothedFrameDeltaMs = null;
    this.currentUpdateTrace = null;
    this.smoothedUpdatePhases = {
      frameOverlays: null,
      simulation: null,
      vision: null,
      players: null,
      playerVisibility: null,
      playerMarkers: null,
      playerFlag: null,
      hostTx: null,
    };
    this.computationLevel = 'LOW';
    this.lastComputationLabelAt = -Infinity;
    this.aimWorldPoint = null;
    this.pointerOverGame = false;
    this.pointerNormalizedX = null;
    this.pointerNormalizedY = null;
    this.showPregameMapPreview = false;
    this.hudPlacement = 'top';
    this.aimPointerMoveHandler = (event) => this.updateAimPointerFromClient(event);
    this.aimPointerEnterHandler = (event) => {
      this.updateAimPointerFromClient(event);
    };
    this.aimPointerLeaveHandler = () => {
      this.pointerOverGame = false;
      this.pointerNormalizedX = null;
      this.pointerNormalizedY = null;
      this.game.canvas.style.cursor = '';
      this.hitMarkerGraphics?.clear();
    };
  }

  create() {
    this.cameras.main.setBackgroundColor('#0b1220');
    this.map = this.add.rectangle(0, 0, 1, 1, 0x14243a).setStrokeStyle(1, 0x29384e, 0.9);
    this.grid = this.add.graphics();
    this.mapGraphics = this.add.graphics().setDepth(1);
    this.objectGraphics = this.add.graphics().setDepth(2);
    this.propGraphics = this.add.graphics().setDepth(2.1);
    this.aimGraphics = this.add.graphics().setDepth(2.98);
    this.gadgetAimGraphics = this.add.graphics().setDepth(2.99);
    this.smokeGraphics = this.add.graphics().setDepth(3.15);
    this.audioCueGraphics = this.add.graphics().setDepth(3.1);
    this.pingGraphics = this.add.graphics().setDepth(4.8);
    this.damageIndicatorGraphics = this.add.graphics().setDepth(6.2);
    this.rememberedWallGraphics = this.add.graphics().setDepth(2.96);
    this.hitMarkerGraphics = this.add.graphics().setDepth(20);
    this.drawGrid();
    this.publishHud();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,F,Q,E,R,SHIFT');
    this.reloadKeyPending = false;
    this.reloadKeyHandler = (event) => {
      const target = event.target;
      const player = this.players.get(this.getActivePlayerId());
      if (event.code !== 'KeyR' || event.repeat || this.controlledBotId ||
          !this.match || !player?.alive || (this.match.victory && !this.isPostGameFreeRoam()) ||
          this.getEquippedSlot(player) !== 'weapon' || this.isGadgetSwitching(player) ||
          (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      this.reloadKeyPending = true;
    };
    document.addEventListener('keydown', this.reloadKeyHandler, true);
    this.botReloadKeyHandler = (event) => {
      if (!this.controlledBotId || event.code !== 'KeyR' || event.repeat) return;
      event.preventDefault();
      this.botReloadPendingUntil = Date.now() + 1_200;
    };
    document.addEventListener('keydown', this.botReloadKeyHandler, true);
    this.input.on('pointermove', (pointer) => this.updateAimPointer(pointer));
    this.input.on('pointerdown', (pointer) => this.handlePointerDown(pointer));
    this.input.on('pointerup', (pointer) => this.handlePointerUp(pointer));
    this.input.on('gameout', () => { this.fireHeld = false; });
    this.contextMenuHandler = (event) => event.preventDefault();
    this.game.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    this.game.canvas.addEventListener('pointerenter', this.aimPointerEnterHandler, { passive: true });
    this.game.canvas.addEventListener('pointermove', this.aimPointerMoveHandler, { passive: true });
    this.game.canvas.addEventListener('pointerleave', this.aimPointerLeaveHandler, { passive: true });
    this.middleClickHandler = (event) => {
      if (event.button === 1) event.preventDefault();
    };
    this.game.canvas.addEventListener('auxclick', this.middleClickHandler);
    this.resizeHandler = (gameSize) => this.layout(gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeHandler);
    this.layout(this.scale.gameSize);
    if (this.roomState) {
      const snapRemotePlayers = this.pendingSnapRemotePlayers;
      this.pendingSnapRemotePlayers = false;
      this.setRoomState(this.roomState, { snapRemotePlayers });
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeHandler);
      this.game.canvas.removeEventListener('pointerenter', this.aimPointerEnterHandler);
      this.game.canvas.removeEventListener('pointermove', this.aimPointerMoveHandler);
      this.game.canvas.removeEventListener('pointerleave', this.aimPointerLeaveHandler);
      this.game.canvas.removeEventListener('auxclick', this.middleClickHandler);
      this.game.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
      document.removeEventListener('keydown', this.reloadKeyHandler, true);
      document.removeEventListener('keydown', this.botReloadKeyHandler, true);
      this.game.canvas.style.cursor = '';
    });
  }

  publishHud(patch = {}) {
    this.hudState = { ...this.hudState, ...patch };
    this.hudUpdateHandler?.({ ...this.hudState });
  }

  updateMatchHudTimer(now = Date.now()) {
    let timer = '';
    const match = this.match;
    if (match) {
      const quickPlay = match.quickPlayState ?? this.roomState?.quickPlayState;
      const countdownSeconds = Math.max(0, Math.ceil(((match.gameplayStartsAt ?? 0) - now) / 1000));
      if (!match.victory && countdownSeconds > 0) {
        timer = `Starting in ${countdownSeconds}s`;
      } else if (match.victory && quickPlay?.phase === 'round-result') {
        if (this.roomState?.quickPlayMapGenerationPending) {
          timer = 'Generating map...';
        } else {
          const seconds = Math.max(0, Math.ceil(((quickPlay.phaseEndsAt ?? now) - now) / 1000));
          timer = `Next round in ${seconds}s`;
        }
      } else if (match.victory && quickPlay?.phase === 'series-report') {
        const seconds = Math.max(0, Math.ceil(((quickPlay.phaseEndsAt ?? now) - now) / 1000));
        timer = `Returning to lobby in ${seconds}s`;
      } else if (match.victory) {
        const endsAt = match.postGame?.endsAt ?? this.roomState?.postGame?.endsAt;
        if (Number.isFinite(endsAt)) {
          const postGameExpired = now >= endsAt;
          if (this.roomState?.quickPlay !== true && postGameExpired &&
              this.roomState?.mapGenerationPending) {
            timer = 'Generating next map...';
          } else if (this.roomState?.quickPlay !== true && postGameExpired &&
              this.roomState?.mapGenerationError) {
            timer = `Map generation failed · ${this.roomState.mapGenerationError}`;
          } else {
            const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
            timer = `${getPostGameCountdownLabel(this.roomState)} in ${seconds}s`;
          }
        }
      } else if (Number.isFinite(match.endsAt)) {
        timer = `TIME REMAINING · ${this.formatTime(Math.max(0, match.endsAt - now))}`;
      }
    }
    const urgentCue = getUrgentTimerCue(match, now) ??
      getUrgentCustomPostGameCue(match, this.roomState, now);
    const urgentTickKey = urgentCue
      ? `${match.startedAt}:${urgentCue.phase}:${urgentCue.seconds}`
      : null;
    if (urgentTickKey && urgentTickKey !== this.lastUrgentTimerTickKey) {
      playGameSound('urgent-tick', 0.22);
    }
    this.lastUrgentTimerTickKey = urgentTickKey;
    if (timer === this.lastHudTimerText) return;
    this.lastHudTimerText = timer;
    this.publishHud({ timer });
  }

  setHudUpdateHandler(handler) {
    this.hudUpdateHandler = typeof handler === 'function' ? handler : null;
    this.publishHud();
  }

  handlePointerDown(pointer) {
    if (pointer.button === 1) {
      pointer.event?.preventDefault?.();
      this.updateAimPointer(pointer);
      if (this.match && this.getLocalTeam() && this.aimWorldPoint) {
        this.roomClient.send('game:ping', {
          matchId: this.match.startedAt,
          x: this.aimWorldPoint.x,
          y: this.aimWorldPoint.y,
        });
      }
      return;
    }
    this.updateAimPointer(pointer);
    if (pointer.button === 2) {
      const player = this.players.get(this.getActivePlayerId());
      if (!player?.alive) return;
      if (this.isGadgetSwitching(player)) {
        this.logGadgetActionDiagnostic('client-action-blocked-by-switching', player, {
          action: 'use',
          actionSequence: this.weaponActionSequence + 1,
        }, {
          switchRemainingMs: Math.max(0, (player.gadgetSwitchEndsAt ?? 0) - Date.now()),
        });
        return;
      }
      if (this.getEquippedSlot(player) === 'gadget') {
        const gadgetCount = player.gadgetCounts?.[player.selectedGadgetId] ?? player.gadgetCount ?? 0;
        const now = Date.now();
        const ownedTrophy = player.selectedGadgetId === TROPHY_SYSTEM_ID
          ? this.getOwnedTrophySystem(player, now)
          : null;
        const trophyCommandReady = player.selectedGadgetId === TROPHY_SYSTEM_ID &&
          ownedTrophy && !isPlayerJammed(player, now) && !isGadgetJammed(ownedTrophy, now) &&
          now >= (player.trophyCommandReadyAt ?? 0);
        if (this.gadgetUsePendingUntil > now ||
            (gadgetCount <= 0 && !trophyCommandReady &&
              !this.isInfiniteGadgetUseEnabled()) || !this.aimWorldPoint) {
          this.logGadgetActionDiagnostic('client-use-blocked', player, {
            action: 'use',
            actionSequence: this.weaponActionSequence + 1,
          }, {
            gadgetCount,
            pendingForMs: Math.max(0, this.gadgetUsePendingUntil - Date.now()),
            hasAimTarget: Boolean(this.aimWorldPoint),
          });
          return;
        }
        if (this.controlledBotId) this.sendBotGadgetAction('use', player, this.aimWorldPoint);
        else this.sendGadgetAction('use', player, this.aimWorldPoint);
      } else {
        const gadgetCount = player.gadgetCounts?.[player.selectedGadgetId] ?? player.gadgetCount ?? 0;
        const hasPlacedTrophy = player.selectedGadgetId === TROPHY_SYSTEM_ID &&
          Boolean(this.getOwnedTrophySystem(player));
        if (!player.selectedGadgetId ||
            (gadgetCount <= 0 && !hasPlacedTrophy && !this.isInfiniteGadgetUseEnabled())) {
          this.logGadgetActionDiagnostic('client-switch-blocked-no-gadget', player, {
            action: 'switch',
            actionSequence: this.weaponActionSequence + 1,
          }, { gadgetCount });
          return;
        }
        if (this.controlledBotId) this.sendBotGadgetAction('switch', player);
        else this.sendGadgetAction('switch', player);
      }
      pointer.event?.preventDefault?.();
      return;
    }
    if (pointer.button !== 0) return;
    if (this.match && Date.now() <
        (this.match.gameplayStartsAt ?? 0) + GAMEPLAY_START_SAFETY_MS) return;
    const player = this.players.get(this.getActivePlayerId());
    if (!player?.alive || this.isGadgetSwitching(player)) return;
    if (this.getEquippedSlot(player) === 'gadget') {
      if (this.controlledBotId) this.sendBotGadgetAction('switch', player);
      else this.sendGadgetAction('switch', player);
      return;
    }
    const takeoverPanel = document.querySelector('#bot-takeover-panel');
    if (pointer.leftButtonDown() && !takeoverPanel?.contains(pointer.event?.target) && !this.fireHeld) {
      this.fireHeld = true;
      this.firePressSequence += 1;
    }
  }

  getEquippedSlot(player) {
    return getGadgetEquippedSlot(player);
  }

  getOwnedTrophySystem(player, now = Date.now()) {
    return getOwnedActiveTrophySystem(this.match?.gadgetEffects, player?.id, now);
  }

  isGadgetSwitching(player) {
    return Number.isFinite(player?.gadgetSwitchEndsAt) && Date.now() < player.gadgetSwitchEndsAt;
  }

  isInfiniteGadgetUseEnabled() {
    return this.match?.infiniteGadgetUse === true ||
      (this.roomState?.quickPlay !== true &&
        this.roomState?.customGameRules?.infiniteGadgetUse === true);
  }

  sendGadgetAction(action, player, target = null) {
    if (this.controlledBotId || !this.match || !player) return false;
    if (action === 'use' && !player.selectedGadgetId) {
      this.logGadgetActionDiagnostic('client-use-blocked-no-selected-gadget', player, { action });
      return false;
    }
    const now = Date.now();
    if (action === 'switch' && now < (this.match.gameplayStartsAt ?? 0)) {
      this.logGadgetActionDiagnostic('client-switch-blocked-gameplay-not-started', player, { action });
      return false;
    }
    const switchingToGadget = action === 'switch' && this.getEquippedSlot(player) !== 'gadget';
    const trophyForSwitch = switchingToGadget && player.selectedGadgetId === TROPHY_SYSTEM_ID
      ? this.getOwnedTrophySystem(player, now)
      : null;
    if (trophyForSwitch && (isPlayerJammed(player, now) || isGadgetJammed(trophyForSwitch, now))) {
      this.logGadgetActionDiagnostic('host-switch-rejected-trophy-command-jammed', player, { action });
      return false;
    }
    const ownedTrophy = action === 'use' && player.selectedGadgetId === TROPHY_SYSTEM_ID
      ? this.getOwnedTrophySystem(player, now)
      : null;
    if (ownedTrophy && (isPlayerJammed(player, now) || isGadgetJammed(ownedTrophy, now))) return false;
    const sequence = this.weaponActionSequence + 1;
    const isTrophyCommand = Boolean(ownedTrophy);
    const payload = {
      matchId: this.match.startedAt,
      action,
      actionSequence: sequence,
      ...(target ? { target: action === 'select' ? { gadgetId: target.gadgetId } : { x: target.x, y: target.y } } : {}),
    };
    if (!this.roomClient.send('game:gadget', payload)) {
      this.logGadgetActionDiagnostic('client-send-failed', player, payload);
      return false;
    }
    this.weaponActionSequence = sequence;
    this.logGadgetActionDiagnostic('client-action-sent', player, payload, {
      target: payload.target ?? null,
    }, 'info');
    if (this.roomState?.hostId === this.playerId) {
      this.applyAuthorityAction({ ...payload, type: 'game:gadget', actorId: player.id, localAuthority: true });
    }
    this.pendingGadgetSequence = sequence;
    if (action === 'switch' && this.roomState?.hostId !== this.playerId) {
      const now = Date.now();
      beginGadgetSwitch(player, now);
    } else if (action === 'use') {
      this.gadgetUsePendingUntil = Date.now() + 1_000;
      player.gadgetCounts ??= {};
      if (this.roomState?.hostId !== this.playerId) {
        const now = Date.now();
        const infiniteGadgetUse = this.isInfiniteGadgetUseEnabled();
        if (player.selectedGadgetId === KATANA_ID) {
          const dash = calculateKatanaDash(player, target, this.mapObjects, this.mapWidth, this.mapHeight);
          if (dash) Object.assign(player, { x: dash.end.x, y: dash.end.y, vx: 0, vy: 0 });
        }
        if (isTrophyCommand) {
          player.trophyCommandReadyAt = now +
            (infiniteGadgetUse ? 0 : TROPHY_SYSTEM_COMMAND_COOLDOWN_MS);
        } else {
          consumeSelectedGadget(player, { infiniteUse: infiniteGadgetUse });
        }
      }
      player.gadgetCount = player.gadgetCounts[player.selectedGadgetId];
      if (this.roomState?.hostId !== this.playerId && player.selectedGadgetId === KATANA_ID) {
        queueKatanaChargeRecharge(player);
      }
      if (this.roomState?.hostId !== this.playerId && player.selectedGadgetId === ORBITAL_STRIKE_ID) {
        queueOrbitalStrikeRecharge(player);
      }
      if (this.roomState?.hostId !== this.playerId && player.selectedGadgetId === SONAR_ID) {
        queueSonarChargeRecharge(player, GADGET_DEFINITIONS[SONAR_ID].cooldownMs);
      }
      if (player.gadgetCount === 0 && !isTrophyCommand) {
        player.equippedSlot = 'weapon';
        player.gadgetSwitchStartedAt = null;
        player.gadgetSwitchEndsAt = null;
        player.gadgetSwitchTargetSlot = null;
      } else if (isTrophyCommand && this.roomState?.hostId !== this.playerId) {
        player.equippedSlot = 'weapon';
        player.gadgetSwitchStartedAt = null;
        player.gadgetSwitchEndsAt = null;
        player.gadgetSwitchTargetSlot = null;
      }
    }
    return true;
  }

  selectGadget(gadgetId) {
    const player = this.players.get(this.getActivePlayerId());
    if (!player?.alive || this.isGadgetSwitching(player) || this.getEquippedSlot(player) !== 'weapon' ||
        !GADGET_DEFINITIONS[gadgetId]) return false;
    player.gadgetCounts ??= {};
    const infiniteGadgetUse = this.isInfiniteGadgetUseEnabled();
    if (!infiniteGadgetUse && (player.gadgetCounts[gadgetId] ?? 0) <= 0) return false;
    if (!this.sendGadgetAction('select', player, { gadgetId })) return false;
    if (infiniteGadgetUse) refillGadgetCharges(player, gadgetId);
    player.selectedGadgetId = gadgetId;
    player.gadgetCount = player.gadgetCounts[gadgetId];
    return true;
  }

  handlePointerUp(pointer) {
    if (pointer.button === 0 || !pointer.leftButtonDown()) this.fireHeld = false;
  }

  drawGrid() {
    this.map.setPosition(this.mapWidth / 2, this.mapHeight / 2).setSize(this.mapWidth, this.mapHeight);
    this.grid.clear();
    this.grid.lineStyle(1, 0x526783, 0.17);
    const spacing = this.mapWidth / 20;
    for (let position = 0; position <= this.mapWidth; position += spacing) {
      this.grid.lineBetween(position, 0, position, this.mapHeight);
    }
    for (let position = 0; position <= this.mapHeight; position += spacing) {
      this.grid.lineBetween(0, position, this.mapWidth, position);
    }
    this.grid.lineStyle(2, 0x94aac5, 0.22);
    this.grid.strokeRect(0, 0, this.mapWidth, this.mapHeight);
    this.drawMapFeatures();
    this.drawMapObjects();
  }

  drawMapObjects() {
    if (!this.objectGraphics) return;
    this.objectGraphics.clear();
    for (const object of this.mapObjects) {
      if (object.role === 'destructible-prop') continue;
      if (object.shape === 'rect') {
        this.objectGraphics.fillStyle(0x647a93, 0.92);
        this.objectGraphics.fillRect(
          object.x - object.width / 2,
          object.y - object.height / 2,
          object.width,
          object.height,
        );
      } else if (object.shape === 'circle') {
        this.objectGraphics.fillStyle(0x647a93, 0.92);
        this.objectGraphics.fillCircle(object.x, object.y, object.radius);
      } else if (object.shape === 'segment') {
        this.objectGraphics.lineStyle(5, 0x9aacc2, 0.95);
        this.objectGraphics.lineBetween(object.x1, object.y1, object.x2, object.y2);
      }
    }
    this.drawVisibleProps(true);
  }

  drawVisibleProps(force = false) {
    if (!this.propGraphics) return;
    const now = performance.now();
    const interval = getAdaptiveUpdateProfile(this.computationLevel).visiblePropIntervalMs;
    if (!force && now - this.lastVisiblePropScanAt < interval) {
      this.visiblePropsDirty = true;
      return;
    }
    this.lastVisiblePropScanAt = now;
    this.visiblePropsDirty = false;
    const visibleProps = this.mapObjects.filter((object) => object.role === 'destructible-prop' &&
      object.health > 0 && this.isDestructiblePropCurrentlyVisible(object));
    const nextVisibleIds = new Set(visibleProps.map((object) => object.id));
    const visibleSetChanged = nextVisibleIds.size !== this.visiblePropIds.size ||
      [...nextVisibleIds].some((id) => !this.visiblePropIds.has(id));
    if (!force && !visibleSetChanged) return;
    this.visiblePropIds = nextVisibleIds;
    this.propGraphics.clear();
    for (const object of visibleProps) {
      const damaged = object.health < (object.maxHealth ?? 300);
      if (object.propType === 'barrel') {
        this.propGraphics.fillStyle(damaged ? 0x76503c : 0x875432, 1);
        this.propGraphics.fillCircle(object.x, object.y, object.radius);
        this.propGraphics.lineStyle(2, damaged ? 0xff6459 : 0xd5a36b, 1);
        this.propGraphics.strokeCircle(object.x, object.y, object.radius);
        this.propGraphics.lineStyle(2, 0x4d3022, 0.9);
        this.propGraphics.lineBetween(object.x - object.radius * 0.65, object.y,
          object.x + object.radius * 0.65, object.y);
        if (damaged) this.propGraphics.lineBetween(object.x - 3, object.y - 5, object.x + 4, object.y + 2);
      } else {
        const left = object.x - object.width / 2;
        const top = object.y - object.height / 2;
        this.propGraphics.fillStyle(damaged ? 0x76503c : 0x806044, 1);
        this.propGraphics.fillRect(left, top, object.width, object.height);
        this.propGraphics.lineStyle(2, damaged ? 0xff6459 : 0xd5b481, 1);
        this.propGraphics.strokeRect(left, top, object.width, object.height);
        this.propGraphics.lineStyle(2, 0x4d3022, 0.9);
        this.propGraphics.lineBetween(object.x, top + 2, object.x, top + object.height - 2);
        if (damaged) this.propGraphics.lineBetween(left + 3, top + 3, left + object.width - 3, top + object.height - 3);
      }
    }
  }

  drawMapFeatures() {
    if (!this.mapGraphics) return;
    this.mapGraphics.clear();
    if (!this.mapData) return;
    for (const corridor of this.mapData.corridors ?? []) {
      for (const polygon of corridor.polygons ?? []) {
        this.fillPolygon(polygon, 0x1b2c43, 1);
      }
    }
    for (const room of this.mapData.rooms ?? []) {
      const team = getTeamGroup(room.team);
      const color = room.isSpawn ? team?.siteHex : 0x7188a4;
      this.fillPolygon(room.vertices, room.isSpawn ? color : 0x1b2c43, room.isSpawn ? 0.22 : 1);
    }
  }

  fillPolygon(points, color, alpha) {
    if (!points || points.length < 3) return;
    this.mapGraphics.fillStyle(color, alpha);
    this.mapGraphics.beginPath();
    this.mapGraphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) this.mapGraphics.lineTo(point.x, point.y);
    this.mapGraphics.closePath();
    this.mapGraphics.fillPath();
  }

  setMap(map, preservePropState = false) {
    if (!map) return;
    const changed = this.mapData?.seed !== map.seed ||
      this.mapData?.generatorVersion !== map.generatorVersion ||
      this.mapData?.metrics?.roomCount !== map.metrics?.roomCount ||
      this.mapData?.mapOptions?.minRooms !== map.mapOptions?.minRooms ||
      this.mapData?.mapOptions?.maxRooms !== map.mapOptions?.maxRooms;
    const keepPropState = preservePropState && !changed;
    if (!keepPropState) this.destructibleObjectHealthIntel.clear();
    const previousObjects = this.mapObjects;
    this.mapData = map;
    this.mapObjects = map.objects ?? [];
    if (keepPropState) preserveDestructiblePropState(previousObjects, this.mapObjects);

    const resized = map.width !== this.mapWidth || map.height !== this.mapHeight;
    if (resized || changed) {
      this.map.setVisible(true);
      this.mapWidth = map.width;
      this.mapHeight = map.height;
      this.drawGrid();
      if (resized) this.layout(this.scale.gameSize);
    }
  }

  queueHostMap(state) {
    const quickPlay = state.quickPlay === true;
    const preparingNextQuickPlayMap = quickPlay && state.match?.victory &&
      state.quickPlayState?.phase === 'round-result' && state.quickPlayMapGenerationPending;
    const preparingNextCustomMap = !quickPlay && state.match?.victory &&
      state.customSeriesState?.phase === 'postgame' && state.mapGenerationPending === true &&
      !['host', 'same'].includes(state.customGameRules?.mapMode);
    const generationPending = quickPlay
      ? state.quickPlayMapGenerationPending === true
      : state.mapGenerationPending === true;
    if (!generationPending && state.mapReady === true) {
      this.hostMapSearchToken += 1;
      this.hostMapGenerationKey = null;
      this.hostMapSubmission = null;
      return;
    }
    const canGenerate = state.hostId === this.playerId &&
      (!state.match || preparingNextQuickPlayMap || preparingNextCustomMap) &&
      this.roomState?.simulation?.mode === 'host-authoritative';
    if (!canGenerate) {
      if (this.hostMapGenerationKey !== null) {
        this.hostMapSearchToken += 1;
        this.hostMapGenerationKey = null;
      }
      return;
    }
    if (quickPlay && !state.quickPlayMapGenerationPending) return;
    if (!quickPlay && !state.mapGenerationPending && this.hostMapGenerationKey === null) return;
    const generationRevision = state.mapGenerationRevision ?? 0;
    const criteria = state.customGameRules?.mapMode === 'varied'
      ? {
        minRooms: state.customGameRules.mapCriteria.minRooms,
        maxRooms: state.customGameRules.mapCriteria.maxRooms,
        minDoorwaysPerSite: state.customGameRules.mapCriteria.minDoorwaysPerSite,
        minSymmetryPercent: state.customGameRules.mapCriteria.minSymmetryPercent,
        minRoomUtilization: state.customGameRules.mapCriteria.minRoomUtilizationPercent / 100,
        maxSiteApproachSightline: state.customGameRules.mapCriteria.maxSiteApproachSightline,
      }
      : COMPETITIVE_MAP_RULES;
    const key = quickPlay
      ? `${state.name}:quickplay:${generationRevision}:${state.quickPlayState?.round ?? 0}`
      : state.mapGenerationMode === 'competitive'
        ? `${state.name}:competitive:${generationRevision}:${JSON.stringify(criteria)}`
        : `${state.name}:seed:${generationRevision}:${state.seed}:${state.mapOptions?.minRooms}:${state.mapOptions?.maxRooms}`;
    if (this.hostMapGenerationKey === key) return;
    this.hostMapGenerationKey = key;
    const searchToken = ++this.hostMapSearchToken;
    let mapsGenerated = 0;
    let lastProgressSentAt = 0;
    const publishProgress = (force = false) => {
      if (quickPlay || searchToken !== this.hostMapSearchToken || mapsGenerated === 0) return;
      const now = Date.now();
      if (!force && now - lastProgressSentAt < 1_000) return;
      lastProgressSentAt = now;
      this.roomClient.send('game:map-progress', { generationRevision, mapsGenerated });
    };
    const submit = (map) => {
      const current = this.roomState;
      const currentRound = current?.quickPlayState?.round ?? 0;
      const requestedRound = state.quickPlayState?.round ?? 0;
      if (searchToken !== this.hostMapSearchToken || current?.name !== state.name ||
          current?.hostId !== this.playerId || current?.mapGenerationRevision !== generationRevision ||
          current?.quickPlay !== quickPlay || (quickPlay && currentRound !== requestedRound)) return;
      publishProgress(true);
      // Do not reveal the candidate during lobby/round-result preparation. The
      // accepted room state exposes it at match start, avoiding a visible flash.
      this.hostMapSubmission = { map, quickPlay, generationRevision, roomName: state.name,
        round: requestedRound, lastSentAt: Date.now() };
      this.roomClient.send('game:map-ready', { map, quickPlay, generationRevision });
    };
    if (!quickPlay && state.mapGenerationMode !== 'competitive') {
      try {
        const map = generateMap(state.seed, MAP_WIDTH, MAP_HEIGHT,
          state.mapOptions ?? { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS });
        mapsGenerated += 1;
        submit(map);
      } catch {
        this.publishHud({ status: 'Map generation failed · choose another seed' });
      }
      return;
    }
    let attempts = 0;
    const search = () => {
      if (searchToken !== this.hostMapSearchToken) return;
      for (let index = 0; index < 3; index += 1) {
        if (attempts >= 50_000) {
          this.publishHud({ status: 'Competitive map search reached its limit · try again' });
          this.hostMapGenerationKey = null;
          return;
        }
        attempts += 1;
        const seed = new Uint32Array(1);
        crypto.getRandomValues(seed);
        const roomCount = criteria.minRooms +
          (seed[0] % (criteria.maxRooms - criteria.minRooms + 1));
        const candidateSeed = (seed[0] % MAX_MAP_SEED) + 1;
        let map;
        try {
          map = generateMap(candidateSeed, MAP_WIDTH, MAP_HEIGHT, {
            minRooms: roomCount,
            maxRooms: roomCount,
            maxSiteApproachSightline: criteria.maxSiteApproachSightline,
          });
        } catch {
          continue;
        }
        mapsGenerated += 1;
        if (isCompetitiveMap(map, criteria)) {
          submit(map);
          return;
        }
      }
      publishProgress();
      window.setTimeout(search, 0);
    };
    search();
  }

  retryHostMapSubmission(now = Date.now()) {
    const submission = this.hostMapSubmission;
    const state = this.roomState;
    if (!submission || !state || now - submission.lastSentAt < 1_000) return;
    const pending = state.quickPlay
      ? state.quickPlayMapGenerationPending === true
      : state.mapGenerationPending === true;
    if (!pending || state.name !== submission.roomName || state.hostId !== this.playerId ||
        state.mapGenerationRevision !== submission.generationRevision || state.quickPlay !== submission.quickPlay ||
        (submission.quickPlay && (state.quickPlayState?.round ?? 0) !== submission.round)) {
      this.hostMapSubmission = null;
      return;
    }
    submission.lastSentAt = now;
    this.roomClient.send('game:map-ready', {
      map: submission.map,
      quickPlay: submission.quickPlay,
      generationRevision: submission.generationRevision,
    });
  }

  initializeHostMatch(snapshot) {
    if (this.roomState?.hostId !== this.playerId || !snapshot?.map ||
        snapshot.players?.some((player) => Number.isFinite(player.x))) return snapshot;
    const map = structuredClone(snapshot.map);
    const teamIndices = { red: 0, blue: 0 };
    const weaponDefinitions = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
    const players = (snapshot.players ?? []).map((manifest) => {
      const team = manifest.team === 'blue' ? 'blue' : 'red';
      const spawnRoom = map.rooms.find((room) => room.isSpawn && room.team === team);
      if (!spawnRoom) return null;
      const offset = TEAM_SPAWN_OFFSETS[teamIndices[team]++ % TEAM_SPAWN_OFFSETS.length];
      const direction = spawnRoom.x < map.width / 2 ? 1 : -1;
      const inventory = manifest.inventory ?? { armor: null, perks: [] };
      const x = spawnRoom.x + offset.x * direction;
      const y = spawnRoom.y + offset.y;
      const facingAngle = getWeaponAimAngle(
        { x, y },
        { x: map.width / 2, y: map.height / 2 },
      );
      const weaponStats = Object.fromEntries(weaponDefinitions.map((weapon) => [
        weapon.id,
        { ...createInitialWeaponState(weapon, snapshot.startedAt, inventory), aimAngle: facingAngle },
      ]));
      const armor = getInventoryEffects(inventory).armor;
      return {
        ...manifest,
        x,
        y,
        vx: 0, vy: 0,
        health: 100, armor, maxArmor: armor,
        lastDamagedAt: snapshot.startedAt,
        stats: { kills: 0, assists: 0, deaths: 0 },
        alive: true, isSpectator: false,
        weaponLean: 0, visionAngle: facingAngle,
        equippedSlot: 'weapon', gadgetSwitchStartedAt: null,
        gadgetSwitchEndsAt: null, gadgetSwitchTargetSlot: null,
        weaponStats, lastInputSequence: 0, lastWeaponActionSequence: 0,
        input: { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
      };
    }).filter(Boolean);
    const blueSpawn = map.spawnZones.blue;
    return {
      ...snapshot,
      map,
      players,
      flag: { x: blueSpawn.x + blueSpawn.width / 2, y: blueSpawn.y + blueSpawn.height / 2,
        heldBy: null, dropped: false, lastDroppedBy: null },
      smokes: [], gadgetEffects: [], destructibleObjects: [], botNoises: [],
    };
  }

  layout(gameSize) {
    const zoom = Math.min(gameSize.width / this.mapWidth, gameSize.height / this.mapHeight);
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(this.mapWidth / 2, this.mapHeight / 2);
  }

  setRoomState(state, { snapRemotePlayers = false } = {}) {
    this.roomState = state;
    if (!this.grid) {
      this.pendingSnapRemotePlayers ||= snapRemotePlayers;
      return;
    }
    this.queueHostMap(state);

    if (!state.match) {
      this.pointerOverGame = false;
      this.pointerNormalizedX = null;
      this.pointerNormalizedY = null;
      this.hudPlacement = 'top';
      this.lastHudTimerText = null;
      this.match = null;
      this.smokeVisibilityCache.clear();
      this.rememberedSmokes.clear();
      this.publishHud({ equippedSlot: null, selectedGadgetId: null, gadgetCount: 0, switching: false, switchRemainingMs: 0 });
      this.controlledBotId = null;
      this.botControlSequence = 0;
      let preview = null;
      const canSeePregameMap = state.hostId === this.playerId && !state.quickPlay;
      const generatingMap = !state.quickPlay && state.mapGenerationPending === true;
      const mapReady = state.mapReady ?? !generatingMap;
      this.showPregameMapPreview = canSeePregameMap && !generatingMap && mapReady;
      const seriesLabel = state.gameMode === 'longseries' ? 'Long Play'
        : state.gameMode === 'longplay' ? 'Quick Play' : 'Practice';
      if (canSeePregameMap && !generatingMap && mapReady && Number.isSafeInteger(state.seed)) {
        const mapOptions = state.mapOptions ?? { minRooms: DEFAULT_MIN_ROOMS, maxRooms: DEFAULT_MAX_ROOMS };
        const optionsMatch = this.mapData?.mapOptions?.minRooms === mapOptions.minRooms &&
          this.mapData?.mapOptions?.maxRooms === mapOptions.maxRooms;
        preview = this.mapData?.seed === state.seed && this.mapData.generatorVersion === MAP_GENERATOR_VERSION && optionsMatch
          ? this.mapData
          : generateMap(state.seed, MAP_WIDTH, MAP_HEIGHT, mapOptions);
      }
      if (generatingMap) {
        this.clearMapForGeneration();
      } else if (canSeePregameMap && mapReady) {
        this.setMap(preview);
        this.drawVisibleProps(true);
      } else {
        this.mapData = null;
        this.mapObjects = [];
        this.map.setVisible(false);
        this.grid.clear();
        this.drawMapFeatures();
        this.drawMapObjects();
      }
      this.lastInputSignature = '';
      this.localAimMatchId = null;
      this.localAimAngle = null;
      this.localAimWeaponId = null;
      this.weaponLean = 0;
      this.weaponLeanState = { toggleLean: 0, currentLean: 0, qDown: false, eDown: false, qPressedAt: null, ePressedAt: null };
      this.weaponLeanMatchId = null;
      this.localVisionAngle = 0;
      this.localVisionAngleMatchId = null;
      this.intelMatchId = null;
      this.exploredCells = null;
      this.currentVisions = [];
      for (const visual of this.flashVisuals.values()) visual.graphics.destroy();
      this.flashVisuals.clear();
      this.flashBlinded = false;
      this.visionCacheByPlayer.clear();
      this.visionInputCacheByPlayer.clear();
      this.spyCameraVisionCache.clear();
      this.sonarVisionCache.clear();
      this.sonarVisionCache.clear();
      this.disposeVisionTexture();
      this.audioCues?.clear();
      this.audioCueGraphics?.clear();
      this.pings.clear();
      this.pingGraphics?.clear();
      this.playerVisibilityCache.clear();
      this.lastVisionUpdateAt = -Infinity;
      this.lastVisionMemoryAt = -Infinity;
      this.lastFrameOverlayUpdateAt = -Infinity;
      this.visionRefreshAtByPlayer.clear();
      this.disposeFogTexture();
      this.rememberedWallGraphics.clear();
      this.aimWorldPoint = null;
      const status = generatingMap
        ? 'Generating map...'
        : state.mapGenerationError && canSeePregameMap
          ? 'Map generation failed · choose another seed or try again'
          : canSeePregameMap && preview
            ? `Lobby map preview · seed ${preview.seed}`
            : canSeePregameMap ? 'Waiting for the host to start a match'
              : state.quickPlay ? state.quickPlayMapGenerationPending
                ? `Generating ${seriesLabel} map…`
                : `${seriesLabel} lobby · ready up to start`
                : 'Map hidden until the host starts the match';
      this.publishHud({ status, timer: '', score: '', alive: '', objective: '', placement: 'top' });
      this.aimGraphics.clear();
      this.gadgetAimGraphics.clear();
      this.flagMarker?.icon.setVisible(false);
      this.flagMarker?.label.setVisible(false);
      this.players.clear();
      this.renderPlayers();
      return;
    }

    this.showPregameMapPreview = false;
    if (state.hostId === this.playerId) {
      const initialized = this.initializeHostMatch(state.match);
      if (initialized !== state.match) {
        state = { ...state, match: initialized };
        this.roomState = state;
      }
    }
    const newMatch = state.match.startedAt !== this.match?.startedAt;
    if (newMatch) {
      this.hudPlacement = 'top';
      this.lastHudTimerText = null;
      this.lastInputSignature = '';
      this.localInputSequence = 0;
      this.lastInputSequenceSent = 0;
      this.weaponActionSequence = 0;
      this.pendingWeaponActions.clear();
      this.pendingGadgetSequence = null;
      this.gadgetUsePendingUntil = 0;
      this.simulationAccumulatorMs = 0;
      this.hostFrameRevision = 0;
      this.lastHostFrameAt = -Infinity;
      this.lastInputAt = -Infinity;
      this.lastShotAt = -Infinity;
      this.fireHeld = false;
      this.predictedShotPellets.clear();
      this.playedShotSoundKeys.clear();
      this.playedGadgetSoundIds.clear();
      for (const { tracer, tween } of this.predictedProjectileVisuals.values()) {
        tween.stop();
        tracer.destroy();
      }
      this.predictedProjectileVisuals.clear();
      for (const { tracer, tween } of this.gadgetProjectileVisuals.values()) {
        tween.stop();
        tracer.destroy();
      }
      this.gadgetProjectileVisuals.clear();
      this.cancelledGadgetProjectileIds.clear();
      this.players.clear();
      this.audioCues.clear();
      this.footstepCueLastAt.clear();
      this.lastFootstepCueCheckAt = -Infinity;
      this.audioCueGraphics.clear();
      this.pings.clear();
      this.pingGraphics.clear();
      this.playerVisibilityCache.clear();
      this.lastVisionUpdateAt = -Infinity;
      this.lastVisionMemoryAt = -Infinity;
      this.visionRefreshAtByPlayer.clear();
      this.publishHud({ objective: '', placement: 'top' });
      this.match = null;
      if (state.quickPlay && !state.match.map) {
        this.mapData = null;
        this.mapObjects = [];
        this.map?.setVisible(false);
        this.grid?.clear();
        this.drawMapFeatures();
        this.drawMapObjects();
      }
    }
    if (state.quickPlay && state.match.quickPlayState?.phase === 'round-result' &&
        state.quickPlayMapGenerationPending === undefined) {
      state.quickPlayMapGenerationPending = true;
    }
    this.applySnapshot(state.match, { snapRemotePlayers: snapRemotePlayers || newMatch });
  }

  clearMapForGeneration() {
    this.mapData = null;
    this.mapObjects = [];
    this.map.setVisible(true).setPosition(this.mapWidth / 2, this.mapHeight / 2).setSize(this.mapWidth, this.mapHeight);
    this.drawGrid();
    this.mapGraphics.clear();
    this.objectGraphics.clear();
    this.drawMapFeatures();
    this.drawMapObjects();
  }

  applySnapshot(snapshot, { snapRemotePlayers = false } = {}) {
    const authority = this.roomState?.simulation;
    const isLiveHostAuthorityMatch = !this.applyingHostFrame &&
      authority?.mode === 'host-authoritative' &&
      authority.authorityId === this.playerId &&
      this.authorityEpoch === authority.epoch &&
      this.match?.startedAt === snapshot.startedAt &&
      this.match?.quickPlayState?.round === snapshot.quickPlayState?.round;
    const preserveLiveHostState = isLiveHostAuthorityMatch &&
      Date.now() >= (snapshot.gameplayStartsAt ?? 0) + GAMEPLAY_START_SAFETY_MS;
    if (isLiveHostAuthorityMatch) snapshot = preserveLiveHostGadgetState(snapshot, this.match);
    if (preserveLiveHostState) {
      snapshot = {
        ...snapshot,
        players: preserveLiveHostPlayers(snapshot.players, [...this.players.values()]),
      };
    }
    const previousMatchId = this.match?.startedAt;
    const isNewMatch = previousMatchId !== snapshot.startedAt;
    const previousSoundEffectIds = new Set([
      ...(this.match?.smokes ?? []),
      ...(this.match?.gadgetEffects ?? []),
    ].map((effect) => effect.id));
    const newlyActivatedSoundEffects = isNewMatch ? [] : [
      ...(snapshot.smokes ?? []),
      ...(snapshot.gadgetEffects ?? []),
    ].filter((effect) => typeof effect?.id === 'string' && !previousSoundEffectIds.has(effect.id));
    const isTeamPrivateEffect = (effect) =>
      effect.triggerOnEnemyProximity === true || effect.type === 'sonar-projectile';
    const retainedMines = isNewMatch ? [] : (this.match?.gadgetEffects ?? []).filter((effect) =>
      isTeamPrivateEffect(effect) &&
      (this.roomState?.hostId === this.playerId || this.localKnownMineIds.has(effect.id)));
    const publicEffects = (snapshot.gadgetEffects ?? []).filter((effect) =>
      !isTeamPrivateEffect(effect));
    const publicEffectIds = new Set(publicEffects.map((effect) => effect.id));
    this.match = {
      ...this.match,
      ...snapshot,
      gadgetEffects: [
        ...publicEffects,
        ...retainedMines.filter((effect) => !publicEffectIds.has(effect.id)),
      ],
    };
    if (isNewMatch) {
      this.destructibleObjectHealthIntel.clear();
      this.localKillStreak = 0;
      this.damageIndicators.clear();
      for (const feedback of this.deathFeedbacks) {
        this.tweens.killTweensOf(feedback);
        feedback.destroy();
      }
      this.deathFeedbacks.clear();
    }
    if (this.authorityEpoch !== authority?.epoch || previousMatchId !== snapshot.startedAt) {
      this.authorityEpoch = authority?.epoch ?? null;
      this.hostFrameRevision = 0;
      this.lastHostFrameAt = -Infinity;
      this.authorityInputs.clear();
      this.hostMineIntelByTeam = { red: new Set(), blue: new Set() };
      this.publishedMineIntelByTeam = { red: new Set(), blue: new Set() };
      this.localKnownMineIds.clear();
      this.lastMineIntelPublishAt = -Infinity;
      this.pendingHostEvents.length = 0;
      this.hostGadgetInterceptionSequence = 0;
      this.consumedHostEventIds.clear();
      this.recentHostEvents.clear();
      this.trophyInterceptVisuals.clear();
    }
    for (const player of snapshot.players) {
      if (player.isBot && !player.controlledById && !this.authorityInputs.has(player.id)) {
        this.authorityInputs.set(player.id, {
          input: player.input ?? { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 },
          sequence: player.lastInputSequence ?? 0,
          acceptedSequence: player.lastInputSequence ?? 0,
          receivedAt: Date.now(),
        });
      }
    }
    for (const playerId of this.authorityInputs.keys()) {
      if (!snapshot.players.some((player) => player.id === playerId)) this.authorityInputs.delete(playerId);
    }
    const previousActivePlayerId = this.getActivePlayerId();
    const controlledBot = snapshot.players.find((player) => player.isBot && player.controlledById === this.playerId);
    const nextControlledBotId = controlledBot?.id ?? null;
    const localControlChanged = nextControlledBotId !== this.controlledBotId;
    if (localControlChanged) {
      const nextLocalPlayer = controlledBot ?? snapshot.players.find((player) => player.id === this.playerId);
      const nextWeaponId = nextLocalPlayer?.selectedWeaponId ?? 'assault-rifle';
      const nextWeaponState = nextLocalPlayer?.weaponStats?.[nextWeaponId];
      this.pendingWeaponActions.clear();
      this.controlledBotId = nextControlledBotId;
      this.botControlSequence = controlledBot?.lastInputSequence ?? 0;
      this.botActionSequence = controlledBot?.lastWeaponActionSequence ?? 0;
      this.lastInputSignature = '';
      this.lastInputAt = -Infinity;
      this.lastControlFireHeld = false;
      this.botReloadPendingUntil = 0;
      this.fireHeld = false;
      this.aimWorldPoint = null;
      this.localAimMatchId = snapshot.startedAt;
      this.localAimWeaponId = nextLocalPlayer?.selectedWeaponId ?? null;
      this.localAimAngle = nextWeaponState?.aimAngle ?? null;
      this.localVisionAngle = nextLocalPlayer?.visionAngle ?? nextWeaponState?.aimAngle ?? 0;
      this.localVisionAngleMatchId = snapshot.startedAt;
      this.weaponLean = nextLocalPlayer?.weaponLean ?? 0;
      this.weaponLeanState.toggleLean = this.weaponLean;
      this.weaponLeanState.currentLean = this.weaponLean;
      if (nextLocalPlayer) {
        this.visionCacheByPlayer.delete(nextLocalPlayer.id);
        this.visionInputCacheByPlayer.delete(nextLocalPlayer.id);
        this.visionRefreshAtByPlayer.delete(nextLocalPlayer.id);
        this.visionOverlayDirty = true;
        this.lastVisionOverlayUpdateAt = -Infinity;
      }
    }
    const activePlayerId = this.getActivePlayerId();
    const ownsSimulation = this.roomState?.simulation?.mode === 'host-authoritative' &&
      this.roomState.simulation.authorityId === this.playerId;
    this.setMap(snapshot.map ?? this.mapData, !isNewMatch);
    this.applyDestructibleObjectState(snapshot.destructibleObjects);
    this.ensureIntelState(snapshot.startedAt);
    const localHuman = snapshot.players.find((player) => player.id === this.playerId);
    const localPlayerIsPlaying = snapshot.players.some((player) => player.id === activePlayerId);
    const localPlayer = snapshot.players.find((player) => player.id === activePlayerId);
    if (localControlChanged || (localPlayer && (localPlayer.alive === false || (localPlayer.health ?? 100) <= 0))) {
      this.localKillStreak = 0;
    }
    const victory = snapshot.victory;
    const quickPlay = snapshot.quickPlayState;
    const countdownSeconds = Math.max(0, Math.ceil(((snapshot.gameplayStartsAt ?? 0) - Date.now()) / 1000));
    const victoryText = formatVictoryText(victory, quickPlay);
    const statusText = victory
        ? victoryText
        : countdownSeconds > 0
          ? `ROUND STARTING · ${countdownSeconds}`
        : this.controlledBotId
          ? `CONTROLLING ${localPlayer?.name ?? 'BOT'} · WASD MOVE · CLICK TO FIRE`
          : localHuman && !localHuman.alive
            ? 'YOU ARE ELIMINATED · SPECTATING MATCH'
          : !localPlayerIsPlaying ? 'SPECTATING · JOINED AFTER MATCH START' : '';
    const aliveCounts = getAliveTeamCounts(snapshot.players);
    const quickPlayScoreLabels = formatQuickPlayScore(quickPlay?.score);
    this.publishHud({
      status: statusText,
      score: quickPlay ? `${quickPlayScoreLabels.red} — ${quickPlayScoreLabels.blue}` : '',
      alive: formatAliveTeamCounts(aliveCounts),
      objective: victory ? '' : this.hudState.objective,
    });
    this.updateMatchHudTimer();
    const activeIds = new Set();

    for (const player of snapshot.players) {
      activeIds.add(player.id);
      const previous = this.players.get(player.id);
      const isLocalPlayer = player.id === activePlayerId;
      let position;
      let velocityX;
      let velocityY;
      if (isLocalPlayer) {
        // Host frames reconcile shared state; the owner keeps simulating its own pose.
        const pose = selectOwnerControlledPose(previous, player, localControlChanged);
        position = { x: pose.x, y: pose.y };
        velocityX = pose.vx;
        velocityY = pose.vy;
      } else {
        position = selectSnapshotPosition(previous, player, !snapRemotePlayers);
        velocityX = player.vx ?? previous?.vx ?? 0;
        velocityY = player.vy ?? previous?.vy ?? 0;
      }
      const renderCorrection = isLocalPlayer
        ? getRenderCorrection(previous, position, true)
        : null;
      if (isLocalPlayer && this.weaponLeanMatchId !== snapshot.startedAt) {
        this.weaponLeanMatchId = snapshot.startedAt;
        this.weaponLean = player.weaponLean ?? 0;
        this.weaponLeanState.toggleLean = this.weaponLean;
        this.weaponLeanState.currentLean = this.weaponLean;
      }
      if (isLocalPlayer && this.localVisionAngleMatchId !== snapshot.startedAt) {
        this.localVisionAngleMatchId = snapshot.startedAt;
        this.localVisionAngle = player.visionAngle ?? player.weaponStats?.[player.selectedWeaponId ?? 'assault-rifle']?.aimAngle ?? 0;
      }
      const acknowledgedAction = player.lastWeaponActionSequence ?? 0;
      if (isLocalPlayer) {
        this.localInputSequence = Math.max(this.localInputSequence, player.lastInputSequence ?? 0);
        this.lastInputSequenceSent = Math.max(this.lastInputSequenceSent, player.lastInputSequence ?? 0);
        if (this.controlledBotId) this.botControlSequence = Math.max(this.botControlSequence, player.lastInputSequence ?? 0);
        if (this.controlledBotId) this.botActionSequence = Math.max(this.botActionSequence, acknowledgedAction);
        this.weaponActionSequence = Math.max(this.weaponActionSequence, acknowledgedAction);
        acknowledgeWeaponActions(this.pendingWeaponActions, acknowledgedAction);
        if (this.pendingGadgetSequence !== null && acknowledgedAction >= this.pendingGadgetSequence) {
          this.pendingGadgetSequence = null;
          this.gadgetUsePendingUntil = 0;
        }
      }
      const gadgetState = isLocalPlayer
        ? preservePendingGadgetState(previous, player, this.pendingGadgetSequence, acknowledgedAction)
        : player;
      let weaponStats;
      if (isLocalPlayer && this.applyingHostFrame) {
        const pendingActions = [...this.pendingWeaponActions.values()].map(({ action }) => action);
        weaponStats = reconcileOwnerWeaponSnapshot({
          ...player,
          inventory: player.inventory ?? previous?.inventory,
          weaponStats: player.weaponStats ?? previous?.weaponStats,
        }, pendingActions, Date.now()).stats;
      } else if (isLocalPlayer) {
        weaponStats = selectOwnerWeaponStats(previous?.weaponStats, player.weaponStats,
          localControlChanged || !previous || !sameInventoryEffects(previous?.inventory, player.inventory));
      } else {
        weaponStats = player.weaponStats ?? previous?.weaponStats ?? {};
      }
      this.players.set(player.id, {
        id: player.id,
        name: player.name,
        team: player.team,
        isBot: player.isBot === true,
        controlledById: player.controlledById ?? null,
        controlRevision: player.controlRevision ?? 0,
        loadoutRevision: player.loadoutRevision ?? previous?.loadoutRevision ?? 0,
        selectedWeaponId: player.selectedWeaponId ?? previous?.selectedWeaponId ?? 'assault-rifle',
        selectedGadgetId: gadgetState.selectedGadgetId !== undefined
          ? gadgetState.selectedGadgetId : previous?.selectedGadgetId ?? null,
        gadgetCounts: gadgetState.gadgetCounts ?? previous?.gadgetCounts ?? {},
        gadgetCount: gadgetState.gadgetCount ?? previous?.gadgetCount ?? 0,
        trophyCommandReadyAt: player.trophyCommandReadyAt ?? 0,
        vineTrapRechargeAt: gadgetState.vineTrapRechargeAt !== undefined
          ? gadgetState.vineTrapRechargeAt : previous?.vineTrapRechargeAt ?? null,
        gadgetChargeRechargeRemainingMs: gadgetState.gadgetChargeRechargeRemainingMs ??
          previous?.gadgetChargeRechargeRemainingMs ?? {},
        orbitalStrikeCooldownRemainingMs: gadgetState.orbitalStrikeCooldownRemainingMs ??
          previous?.orbitalStrikeCooldownRemainingMs ?? 0,
        equippedSlot: gadgetState.equippedSlot ?? previous?.equippedSlot ?? 'weapon',
        gadgetSwitchStartedAt: gadgetState.gadgetSwitchStartedAt ?? null,
        gadgetSwitchEndsAt: gadgetState.gadgetSwitchEndsAt ?? null,
        gadgetSwitchTargetSlot: gadgetState.gadgetSwitchTargetSlot ?? null,
        x: position.x,
        y: position.y,
        renderOffsetX: renderCorrection?.x ?? previous?.renderOffsetX ?? 0,
        renderOffsetY: renderCorrection?.y ?? previous?.renderOffsetY ?? 0,
        vx: velocityX,
        vy: velocityY,
        health: player.health ?? 100,
        alive: player.alive !== false && (player.health ?? 100) > 0,
        flashUntil: player.flashUntil ?? previous?.flashUntil ?? 0,
        jammedUntil: player.jammedUntil ?? previous?.jammedUntil ?? 0,
        deathAttribution: player.deathAttribution ?? previous?.deathAttribution ?? null,
        weaponLean: isLocalPlayer ? this.weaponLean : player.weaponLean ?? previous?.weaponLean ?? 0,
        visionAngle: isLocalPlayer ? this.localVisionAngle : player.visionAngle ?? previous?.visionAngle ?? 0,
        weaponStats,
        stats: player.stats ?? previous?.stats ?? { kills: 0, assists: 0, deaths: 0 },
        inventory: player.inventory ?? previous?.inventory ?? { armor: null, perks: [] },
        armor: player.armor ?? previous?.armor ?? 0,
        maxArmor: player.maxArmor ?? previous?.maxArmor ?? 0,
        lastDamagedAt: player.lastDamagedAt ?? previous?.lastDamagedAt ?? snapshot.startedAt,
        targetX: player.x,
        targetY: player.y,
        input: player.input ?? previous?.input ?? { up: false, down: false, left: false, right: false },
        inputSequence: player.lastInputSequence ?? previous?.inputSequence ?? 0,
        lastInputSequence: player.lastInputSequence ?? previous?.lastInputSequence ?? 0,
        lastWeaponActionSequence: player.lastWeaponActionSequence ?? previous?.lastWeaponActionSequence ?? 0,
      });
      const updatedPlayer = this.players.get(player.id);
      if (!isNewMatch && previous?.alive && !updatedPlayer.alive && player.id === previousActivePlayerId) {
        this.showLocalDeathExplosion(updatedPlayer);
      }
      if (!isNewMatch && previous?.weaponStats) {
        for (const [weaponId, state] of Object.entries(weaponStats ?? {})) {
          const weapon = WEAPON_DEFINITIONS_BY_ID.get(weaponId);
          if (weapon) {
            this.playReloadSoundEvents(updatedPlayer, weapon, previous.weaponStats[weaponId], state);
          }
        }
      }
      const viewerTeam = localPlayer?.team ?? localHuman?.team;
      const isEnemy = player.team === 'red' || player.team === 'blue';
      const viewerContributed = getDeathFeedbackType(player.deathAttribution, activePlayerId) !== 'other';
      if (!isNewMatch && previous?.alive && !updatedPlayer.alive && isEnemy && player.team !== viewerTeam &&
          (viewerContributed || this.isPlayerVisible(updatedPlayer))) {
        this.showDeathFeedback(updatedPlayer, player.deathAttribution);
      }
      if (!updatedPlayer.alive && isEnemy && player.team !== viewerTeam && this.isPlayerVisible(updatedPlayer) &&
          !this.knownCorpseIds.has(player.id)) {
        this.knownCorpseIds.add(player.id);
        this.roomClient.send('game:corpse:discover', { matchId: snapshot.startedAt, playerId: player.id });
      }
        if (isLocalPlayer && (localControlChanged || !previous ||
            this.localAimMatchId !== snapshot.startedAt || this.localAimWeaponId !== player.selectedWeaponId)) {
          this.localAimMatchId = snapshot.startedAt;
          this.localAimWeaponId = player.selectedWeaponId ?? 'assault-rifle';
          this.localAimAngle = weaponStats?.[this.localAimWeaponId]?.aimAngle ?? 0;
          this.lastAimSentAt = -Infinity;
        }
    }

    for (const id of this.players.keys()) {
      if (!activeIds.has(id)) this.players.delete(id);
    }
    this.syncFlagSoundState(this.match.flag);
    this.playOutcomeSounds(this.match.victory, this.match.quickPlayState ?? this.roomState?.quickPlayState);
    for (const effect of newlyActivatedSoundEffects) this.playGadgetEffectSound(effect);
    this.updateGadgetHud(this.players.get(activePlayerId));
    if (!this.applyingHostFrame) {
      this.playerVisibilityCache.clear();
      this.renderPlayers();
    }
  }

  applyDestructibleObjectState(states) {
    if (Array.isArray(states)) {
      for (const { id, health } of states) {
        if (typeof id === 'string' && Number.isFinite(health)) {
          this.destructibleObjectHealthIntel.set(id, health);
        }
      }
    }
    if (this.mapObjects.length === 0 || this.destructibleObjectHealthIntel.size === 0) return;
    let changed = false;
    const destroyedIds = [];
    for (const object of this.mapObjects) {
      if (object.role !== 'destructible-prop' || !this.destructibleObjectHealthIntel.has(object.id)) continue;
      const health = this.destructibleObjectHealthIntel.get(object.id);
      const wasDestroyed = object.health <= 0;
      const previousHealth = object.health;
      object.health = Math.max(0, Math.min(object.maxHealth ?? 300, health));
      const destroyed = object.health === 0;
      object.blocksMovement = !destroyed;
      object.blocksProjectiles = !destroyed;
      object.blocksVision = !destroyed;
      changed ||= previousHealth !== object.health;
      for (const vision of this.visionCacheByPlayer.values()) {
        for (const wall of vision.walls) {
          if (wall.objectId === object.id && wall.health !== object.health) {
            wall.health = object.health;
            changed = true;
          }
        }
      }
      if (!wasDestroyed && destroyed) destroyedIds.push(object.id);
    }
    for (const [fragmentId, fragment] of this.exploredWallObjects) {
      const health = this.destructibleObjectHealthIntel.get(fragment.objectId);
      if (health !== undefined && fragment.health !== health) {
        this.exploredWallObjects.set(fragmentId, { ...fragment, health });
        changed = true;
      }
    }
    if (changed) this.drawVisibleProps(true);
    if (changed && this.rememberedWallGraphics) {
      this.rememberedWallGraphics.clear();
      this.drawRememberedWalls([...this.exploredWallObjects.values()]);
    }
    if (destroyedIds.length > 0) this.invalidateVisionForDestroyedProps(destroyedIds);
  }

  isDestructiblePropCurrentlyVisible(object) {
    if (this.showPregameMapPreview || this.isPostGameFreeRoam()) return true;
    return this.currentVisions.some((vision) => {
      const dx = vision.origin.x - object.x;
      const dy = vision.origin.y - object.y;
      const distance = Math.hypot(dx, dy) || 1;
      const unitX = dx / distance;
      const unitY = dy / distance;
      let surfaceDistance;
      if (object.shape === 'circle') {
        surfaceDistance = object.radius;
      } else {
        surfaceDistance = Math.min(
          object.width / 2 / Math.max(Math.abs(unitX), 1e-9),
          object.height / 2 / Math.max(Math.abs(unitY), 1e-9),
        );
      }
      const surface = {
        x: object.x + unitX * surfaceDistance,
        y: object.y + unitY * surfaceDistance,
      };
      return pointInVisionPolygon(surface, vision);
    });
  }

  invalidateVisionForDestroyedProps(ids) {
    forgetRememberedObjectSurfaces(this.exploredWallIds, this.exploredWallObjects, ids);
    this.visionCacheByPlayer.clear();
    this.visionInputCacheByPlayer.clear();
    this.visionRefreshAtByPlayer.clear();
    this.currentVisions = [];
    this.playerVisibilityCache.clear();
    this.lastVisionUpdateAt = -Infinity;
    this.lastVisionMemoryAt = -Infinity;
    this.clearVisionOverlay();
    this.rememberedWallGraphics?.clear();
    this.drawRememberedWalls([...this.exploredWallObjects.values()]);
    this.drawVisibleProps(true);
  }

  showLocalDeathExplosion(player) {
    const position = getRenderedPosition(player);
    const feedback = this.add.graphics().setPosition(position.x, position.y).setDepth(7);
    feedback.lineStyle(3, 0xff394d, 1).strokeCircle(0, 0, 9);
    feedback.fillStyle(0xff394d, 0.65).fillCircle(0, 0, 6);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      feedback.lineBetween(Math.cos(angle) * 12, Math.sin(angle) * 12,
        Math.cos(angle) * 19, Math.sin(angle) * 19);
    }
    this.deathFeedbacks.add(feedback);
    this.tweens.add({
      targets: feedback,
      scale: 1.8,
      alpha: 0,
      duration: 450,
      ease: 'Cubic.Out',
      onComplete: () => {
        this.deathFeedbacks.delete(feedback);
        feedback.destroy();
      },
    });
  }

  showDeathFeedback(player, attribution) {
    const feedbackType = getDeathFeedbackType(attribution, this.getActivePlayerId());
    if (feedbackType === 'kill') this.localKillStreak += 1;
    const style = getDeathFeedbackStyle(feedbackType, this.localKillStreak);
    const colors = { kill: 0xff394d, assist: 0xffd43b, other: 0x111318 };
    const position = getRenderedPosition(player);
    const feedback = this.add.graphics().setPosition(position.x, position.y).setDepth(7).setAlpha(0).setScale(0.45);
    const radius = style.radius;
    const drawCross = () => feedback
      .lineBetween(-radius, -radius, radius, radius)
      .lineBetween(-radius, radius, radius, -radius);
    feedback.lineStyle(style.lineWidth + 7, colors[feedbackType], style.glowAlpha);
    drawCross();
    feedback.lineStyle(style.lineWidth + 2, 0xf8fafc, 0.95);
    drawCross();
    feedback.lineStyle(style.lineWidth, colors[feedbackType], 1);
    drawCross();
    this.deathFeedbacks.add(feedback);
    if (style.vibration > 0) {
      this.tweens.add({
        targets: feedback,
        x: position.x + style.vibration,
        y: position.y - style.vibration,
        duration: 32,
        yoyo: true,
        repeat: style.vibrationCount,
        ease: 'Sine.easeInOut',
      });
    }
    this.tweens.add({
      targets: feedback,
      alpha: 1,
      scale: style.scale,
      duration: 150,
      ease: 'Back.Out',
      onComplete: () => this.tweens.add({
        targets: feedback,
        y: feedback.y - 8,
        alpha: 0,
        duration: 550,
        delay: 200,
        onComplete: () => {
          this.deathFeedbacks.delete(feedback);
          feedback.destroy();
        },
      }),
    });
  }

  applyAuthorityInput({ matchId, playerId, sequence, input, playerPose, sourceClientId } = {}) {
    if (!playerId || matchId !== this.match?.startedAt || !Number.isSafeInteger(sequence) ||
        !input || sourceClientId !== playerId) return;
    const player = this.players.get(playerId);
    if (!player || player.id === this.getActivePlayerId() || player.isBot || !player.alive) return;
    const dropPressed = input.drop && !player.input?.drop;
    if (!applyOwnerMovementUpdate(player, { sequence, input, playerPose }, {
      width: this.mapWidth, height: this.mapHeight,
    })) return;
    const tether = (this.match.gadgetEffects ?? []).find((effect) =>
      effect.type === VINE_TRAP_ID && effect.latchedEnemyId === player.id && effect.activeUntil > Date.now());
    Object.assign(player, constrainPositionToRadius(
      player, tether, tether?.triggerRadius ?? tether?.radius,
    ));
    if (dropPressed) this.dropHostFlag(player);
    if (this.match.flag?.heldBy === player.id) {
      this.match.flag.x = player.x;
      this.match.flag.y = player.y;
    }
  }

  applyAuthorityAction(action = {}) {
    const isFire = action.type === 'game:fire';
    const isGadget = action.type === 'game:gadget';
    if (this.roomState?.hostId !== this.playerId || action.matchId !== this.match?.startedAt ||
        (action.actorId === this.playerId && action.localAuthority !== true)) {
      if (isFire) {
        this.logWeaponFireDiagnostic('host-authority-context-rejected', {
          actorId: action.actorId,
          weaponId: action.weaponId,
          sequence: action.actionSequence,
          actionMatchId: action.matchId,
        });
      } else if (isGadget) {
        this.logGadgetActionDiagnostic('host-authority-context-rejected', null, action, {
          actionMatchId: action.matchId,
        });
      }
      return;
    }
    const player = this.players.get(action.actorId);
    if (!player || !Number.isSafeInteger(action.actionSequence) ||
        action.actionSequence <= (player.lastWeaponActionSequence ?? 0)) {
      if (isFire) {
        this.logWeaponFireDiagnostic('host-actor-or-sequence-rejected', {
          actorId: action.actorId,
          weaponId: action.weaponId,
          sequence: action.actionSequence,
          actorFound: Boolean(player),
          lastAcceptedSequence: player?.lastWeaponActionSequence ?? 0,
        });
      } else if (isGadget) {
        this.logGadgetActionDiagnostic('host-actor-or-sequence-rejected', player, action, {
          actorFound: Boolean(player),
          lastAcceptedSequence: player?.lastWeaponActionSequence ?? 0,
        });
      }
      return;
    }
    if (!player.alive) {
      if (isFire) {
        this.logWeaponFireDiagnostic('host-player-not-alive', {
          actorId: player.id,
          weaponId: action.weaponId,
          sequence: action.actionSequence,
        });
      } else if (isGadget) {
        this.logGadgetActionDiagnostic('host-player-not-alive', player, action);
      }
      player.lastWeaponActionSequence = action.actionSequence;
      return;
    }
    const now = Date.now();
    if (now < (this.match.gameplayStartsAt ?? 0) &&
        (action.type === 'game:fire' || action.type === 'game:reload' ||
          (action.type === 'game:gadget' && action.action === 'use'))) {
      if (isFire) {
        this.logWeaponFireDiagnostic('host-gameplay-not-started', {
          actorId: player.id,
          weaponId: action.weaponId,
          sequence: action.actionSequence,
          startsInMs: this.match.gameplayStartsAt - now,
        });
      } else if (isGadget) {
        this.logGadgetActionDiagnostic('host-gameplay-not-started', player, action, {
          startsInMs: this.match.gameplayStartsAt - now,
        });
      }
      player.lastWeaponActionSequence = action.actionSequence;
      return;
    }
    const weapon = this.getSelectedWeapon(player);
    const weaponState = ensureWeaponState(player.weaponStats?.[weapon.id], weapon, now, player.inventory);
    if (action.type === 'game:aim') {
      if (action.type !== `game:${weapon.id}` && action.direction && Number.isFinite(action.direction.x) && Number.isFinite(action.direction.y)) {
        weaponState.aimAngle = getHostAimAngle(action.direction, weaponState.aimAngle ?? 0);
        weaponState.aimUpdatedAt = now;
        player.weaponStats = { ...player.weaponStats, [weapon.id]: weaponState };
        if (Number.isFinite(action.visionAngle)) player.visionAngle = action.visionAngle;
      }
      player.lastWeaponActionSequence = action.actionSequence;
      return;
    }
    if (action.type === 'game:fire') {
      this.resolveHostFire(player, weapon, action);
      player.lastWeaponActionSequence = Math.max(
        player.lastWeaponActionSequence ?? 0, action.actionSequence,
      );
      return;
    }
    if (action.type === 'game:reload') {
      const result = applyWeaponAction(weaponState, weapon, {
        kind: 'reload', sequence: action.actionSequence, at: now,
      }, Math.hypot(player.vx ?? 0, player.vy ?? 0));
      if (result.accepted) {
        this.playReloadSoundEvents(player, weapon, weaponState, result.state);
        player.weaponStats = { ...player.weaponStats, [weapon.id]: result.state };
      }
      player.lastWeaponActionSequence = action.actionSequence;
      return;
    }
    if (action.type === 'game:gadget') {
      this.resolveHostGadget(player, action);
      player.lastWeaponActionSequence = action.actionSequence;
    }
  }

  applyAuthorityBots({ matchId, commands, sourceClientId } = {}) {
    if (this.roomState?.hostId !== this.playerId || matchId !== this.match?.startedAt || !Array.isArray(commands)) return;
    for (const command of commands) {
      const player = this.players.get(command?.botId);
      if (!player || !player.isBot || !Number.isSafeInteger(command.sequence) ||
          command.sequence <= (player.inputSequence ?? 0) || !command.input ||
          command.controlRevision !== player.controlRevision) continue;
      const hostControlsBot = sourceClientId === this.playerId && player.controlledById == null;
      const playerControlsBot = sourceClientId && player.controlledById === sourceClientId;
      if (!hostControlsBot && !playerControlsBot) continue;
      const dropPressed = command.input.drop && !player.input?.drop;
      if (playerControlsBot && !applyOwnerMovementUpdate(player, {
        sequence: command.sequence,
        input: command.input,
        playerPose: command.playerPose,
      }, { width: this.mapWidth, height: this.mapHeight }, {
        preservePose: sourceClientId === this.playerId && player.controlledById === this.playerId,
      })) continue;
      const tether = (this.match.gadgetEffects ?? []).find((effect) =>
        effect.type === VINE_TRAP_ID && effect.latchedEnemyId === player.id && effect.activeUntil > Date.now());
      Object.assign(player, constrainPositionToRadius(
        player, tether, tether?.triggerRadius ?? tether?.radius,
      ));
      if (playerControlsBot && dropPressed) this.dropHostFlag(player);
      player.inputSequence = command.sequence;
      player.input = command.input;
      player.weaponLean = command.input.weaponLean ?? player.weaponLean ?? 0;
      player.visionAngle = command.input.visionAngle ?? player.visionAngle ?? 0;
      if (hostControlsBot) {
        this.authorityInputs.set(player.id, {
          input: command.input,
          sequence: command.sequence,
          acceptedSequence: command.sequence,
          receivedAt: Date.now(),
        });
      }
      if (command.weaponId && Object.values(DEFAULT_PROJECTILE_DEFINITIONS).some((weapon) => weapon.id === command.weaponId)) {
        player.selectedWeaponId = command.weaponId;
      }
      const selectedWeapon = this.getSelectedWeapon(player);
      const weaponStats = player.weaponStats?.[selectedWeapon.id];
      if (hostControlsBot && command.direction && weaponStats &&
          Number.isFinite(command.direction.x) && Number.isFinite(command.direction.y) &&
          Math.hypot(command.direction.x, command.direction.y) > 1e-9) {
        const now = Date.now();
        const targetAngle = Math.atan2(command.direction.y, command.direction.x);
        const elapsedSeconds = Math.max(0, (now - (weaponStats.aimUpdatedAt ?? now)) / 1000);
        weaponStats.aimAngle = rotateAngleTowards(
          weaponStats.aimAngle ?? 0,
          targetAngle,
          getMaximumRotationRadiansPerSecond(selectedWeapon.rotationTimeMs) * elapsedSeconds *
            getGadgetWeaponTurnScale(player, this.match.gadgetEffects, now),
        );
        weaponStats.aimUpdatedAt = now;
      }
      if (command.fire) {
        const angle = command.direction && Number.isFinite(command.direction.x) && Number.isFinite(command.direction.y)
          ? Math.atan2(command.direction.y, command.direction.x)
          : weaponStats?.aimAngle ?? 0;
        const actionSequence = Number.isSafeInteger(command.actionSequence)
          ? command.actionSequence : (player.lastWeaponActionSequence ?? 0) + 1;
        this.resolveHostFire(player, selectedWeapon, {
          matchId, actorId: player.id, actionSequence,
          direction: { x: Math.cos(angle), y: Math.sin(angle) },
          shotAngle: command.shotAngle,
        });
      }
      if (command.reload) {
        this.applyAuthorityAction({ matchId, actorId: player.id,
          actionSequence: Number.isSafeInteger(command.actionSequence)
            ? command.actionSequence : (player.lastWeaponActionSequence ?? 0) + 1,
          type: 'game:reload' });
      }
      if (command.gadgetAction && Number.isSafeInteger(command.gadgetAction.actionSequence)) {
        this.applyAuthorityAction({
          ...command.gadgetAction,
          matchId,
          actorId: player.id,
          type: 'game:gadget',
        });
      }
    }
  }

  resolveHostFire(player, weapon, action) {
    const now = Date.now();
    const postGameFreeRoam = this.isPostGameFreeRoam();
    const reject = (reason, details = {}) => {
      if (!player?.isBot) {
        this.logWeaponFireDiagnostic(reason, {
          actorId: player?.id ?? action.actorId,
          weaponId: action.weaponId ?? weapon?.id,
          selectedWeaponId: player?.selectedWeaponId,
          sequence: action.actionSequence,
          ...details,
        });
      }
      return false;
    };
    if (!player?.alive || player.health <= 0) return reject('host-player-not-alive');
    if ((!postGameFreeRoam) &&
        (this.match.victory || now >= this.match.endsAt || now < this.match.gameplayStartsAt)) {
      return reject('host-match-not-fireable', {
        victory: Boolean(this.match.victory),
        matchEndsInMs: this.match.endsAt - now,
        gameplayStartsInMs: this.match.gameplayStartsAt - now,
      });
    }
    const equippedSlot = this.getEquippedSlot(player);
    if (equippedSlot !== 'weapon') return reject('host-weapon-slot-not-equipped', { equippedSlot });
    if (this.isGadgetSwitching(player)) return reject('host-gadget-switch-in-progress');
    const sequence = action.actionSequence;
    const state = ensureWeaponState(player.weaponStats?.[weapon.id], weapon, now, player.inventory);
    if (action.weaponId && action.weaponId !== weapon.id) {
      return reject('host-selected-weapon-mismatch', { hostWeaponId: weapon.id });
    }
    if (sequence <= (player.lastWeaponActionSequence ?? 0)) {
      return reject('host-stale-sequence', {
        lastAcceptedSequence: player.lastWeaponActionSequence ?? 0,
      });
    }
    const aimAngle = getHostAimAngle(action.direction, state.aimAngle ?? 0);
    state.aimAngle = aimAngle;
    state.aimUpdatedAt = now;
    const predicted = applyWeaponAction(state, weapon, {
      kind: 'fire', sequence, at: now, direction: { x: Math.cos(aimAngle), y: Math.sin(aimAngle) },
    }, Math.hypot(player.vx ?? 0, player.vy ?? 0));
    if (!predicted.accepted) {
      const stateReason = state.reloading ? 'reloading'
        : weapon.magazineSize && (state.ammo ?? 0) <= 0 ? 'empty-ammo'
          : state.manualActionEndsAt && now < state.manualActionEndsAt ? 'manual-action'
            : now < (state.cooldownEndsAt ?? 0) ? 'cooldown' : 'weapon-state';
      return reject('host-weapon-state-rejected', {
        stateReason,
        ammo: state.ammo ?? null,
        reloading: Boolean(state.reloading),
        cooldownRemainingMs: Math.max(0, (state.cooldownEndsAt ?? 0) - now),
        manualActionRemainingMs: Math.max(0, (state.manualActionEndsAt ?? 0) - now),
      });
    }
    player.weaponStats = { ...player.weaponStats, [weapon.id]: predicted.state };
    this.playReloadSoundEvents(player, weapon, state, predicted.state);
    player.lastWeaponActionSequence = sequence;
    if (!player.isBot) {
      this.logWeaponFireDiagnostic('host-shot-accepted', {
        actorId: player.id,
        weaponId: weapon.id,
        sequence,
        ammo: predicted.state.ammo ?? null,
      }, 'info');
    }
    const shotBaseAngle = getHostShotAngle(
      action.direction,
      action.shotAngle,
      weapon.accuracy.maxSpreadDegrees * Math.PI / 180,
      predicted.state.predictedShotAngle ?? aimAngle,
    );
    const angles = getPredictedPelletAngles(shotBaseAngle, weapon, sequence);
    const origin = getWeaponMuzzlePosition(player, aimAngle, player.weaponLean ?? 0, this.mapObjects);
    if (!weapon.suppressed) {
      for (const audioCue of this.createHostShotAudioCues(player, origin, now)) {
        const event = {
          id: audioCue.id,
          type: 'audio-cue',
          audienceTeam: audioCue.team,
          ...(audioCue.audiencePlayerId ? { audiencePlayerId: audioCue.audiencePlayerId } : {}),
          data: audioCue,
        };
        this.pendingHostEvents.push(event);
        this.applyHostEvent(event);
      }
    }
    for (let pelletIndex = 0; pelletIndex < angles.length; pelletIndex += 1) {
      const angle = angles[pelletIndex];
      const collision = resolveHostShotCollision({
        start: origin,
        angle,
        range: weapon.range,
        mapObjects: this.mapObjects,
        players: [...this.players.values()],
        gadgetEffects: this.match.gadgetEffects ?? [],
        ownerId: player.id,
        ownerTeam: player.team,
        friendlyFire: weapon.friendlyFire,
        radius: weapon.radius,
        now: Date.now(),
      });
      const firstPlayer = collision.kind === 'player' ? collision.target : null;
      const firstGadget = collision.kind === 'gadget' ? collision.target : null;
      const hitObject = collision.kind === 'object' ? collision.target : null;
      const playerWins = collision.kind === 'player';
      const gadgetWins = collision.kind === 'gadget';
      const objectWins = collision.kind === 'object';
      const finalImpact = collision.end;
      if (playerWins) {
        const damage = getProjectileDamageAlongSegment(weapon, origin, collision.mapTrace.end, firstPlayer, PLAYER_RADIUS);
        this.applyHostDamage(firstPlayer, damage, player.id, { weaponId: weapon.id, at: Date.now() });
      }
      if (objectWins && hitObject?.role === 'destructible-prop' && Number.isFinite(hitObject.health)) {
        const propDamage = applyHostPropDamage(hitObject, weapon.damage ?? weapon.baseDamage ?? 0);
        if (propDamage.destroyed) this.invalidateVisionForDestroyedProps([hitObject.id]);
        this.match.destructibleObjects ??= [];
        const previous = this.match.destructibleObjects.find((object) => object.id === hitObject.id);
        const state = { id: hitObject.id, health: propDamage.health };
        if (previous) Object.assign(previous, state);
        else this.match.destructibleObjects.push(state);
        if (propDamage.applied) {
          const id = `prop:${hitObject.id}:${player.id}:${sequence}:${pelletIndex}`.slice(0, 96);
          this.pendingHostEvents.push({
            id,
            type: 'prop-damage',
            data: { id, objectId: hitObject.id, health: propDamage.health },
          });
        }
        this.drawVisibleProps(true);
      }
      if (gadgetWins) {
        const destroyed = firstGadget.type === TROPHY_SYSTEM_ID
          ? applyTrophySystemDamage(firstGadget, weapon.damage ?? weapon.baseDamage ?? 0).destroyed
          : true;
        if (destroyed) {
          this.match.gadgetEffects = (this.match.gadgetEffects ?? []).filter((effect) => effect.id !== firstGadget.id);
          if (firstGadget.triggerOnEnemyProximity === true) this.lastMineIntelPublishAt = -Infinity;
        }
      }
      const event = {
        id: `${this.match.startedAt}:${player.id}:${sequence}:${pelletIndex}`.slice(0, 96),
        type: 'projectile',
        data: {
          id: `${this.match.startedAt}:${player.id}:${sequence}:${pelletIndex}`.slice(0, 96),
          ownerId: player.id, ownerActionSequence: sequence, pelletIndex,
          start: origin, end: finalImpact, speed: weapon.projectileSpeed ?? weapon.speed ?? 20_000,
          hitType: collision.kind,
          hitEnemy: playerWins && firstPlayer.team !== player.team,
          objectId: objectWins ? hitObject.id : undefined,
        },
      };
      this.pendingHostEvents.push(event);
      this.applyHostEvent(event);
    }
    this.checkHostOutcome(now);
    return true;
  }

  createHostShotAudioCues(shooter, source, now) {
    const match = this.match;
    const players = [...this.players.values()];
    const visionObjects = this.getVisionObjects();
    let listener = null;
    let closestDistanceSquared = Infinity;
    for (const player of players) {
      if (!player.alive || player.health <= 0 || player.team === shooter.team ||
          isPlayerJammed(player, now) || hasFlashBlindness(player, now)) continue;
      const dx = player.x - source.x;
      const dy = player.y - source.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < closestDistanceSquared) {
        closestDistanceSquared = distanceSquared;
        listener = player;
      }
    }
    const sonarListener = findSonarListener(players, source, shooter.team, match.gadgetEffects, now);
    const cues = [];
    const addTeamCue = (listenerTeam, distanceSquared, listener, sonar) => {
      const visible = !sonar && isAudioSourceVisibleToTeam(
        players,
        listenerTeam,
        source,
        visionObjects,
        undefined,
        now,
      );
      match.hostAudioCueLastAt ??= { red: -Infinity, blue: -Infinity };
      if (visible || now - match.hostAudioCueLastAt[listenerTeam] < 600) return;
      match.hostAudioCueLastAt[listenerTeam] = now;
      const distance = Math.sqrt(distanceSquared);
      const radius = Math.min(320, Math.max(42, 30 + distance * 0.24));
      const angle = Math.random() * Math.PI * 2;
      const offset = radius * (0.3 + Math.random() * 0.45);
      cues.push({
        id: `${match.startedAt}:shot:${shooter.id}:${listenerTeam}:${now}`.slice(0, 96),
        kind: 'gunshot',
        team: listenerTeam,
        ...(sonar
          ? { heardById: sonar.ownerId, sonarId: sonar.sonarId }
          : listener ? { heardById: listener.id } : {}),
        x: source.x + Math.cos(angle) * offset,
        y: source.y + Math.sin(angle) * offset,
        radius,
        expiresAt: now + 2_400,
      });
    };
    if (listener || sonarListener) {
      const useSonar = sonarListener &&
        (!listener || sonarListener.distanceSquared < closestDistanceSquared);
      addTeamCue(
        useSonar ? sonarListener.team : listener.team,
        useSonar ? sonarListener.distanceSquared : closestDistanceSquared,
        useSonar ? null : listener,
        useSonar ? sonarListener : null,
      );
    }

    if (isPlayerJammed(shooter, now)) {
      let teammate = null;
      let teammateDistanceSquared = Infinity;
      for (const player of players) {
        if (!player.alive || player.health <= 0 || player.team !== shooter.team ||
            isPlayerJammed(player, now) || hasFlashBlindness(player, now)) continue;
        const dx = player.x - source.x;
        const dy = player.y - source.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < teammateDistanceSquared) {
          teammate = player;
          teammateDistanceSquared = distanceSquared;
        }
      }
      if (teammate) addTeamCue(shooter.team, teammateDistanceSquared, teammate, null);
    }

    match.hostPrivateAudioCueLastAt ??= {};
    for (const jammedListener of players) {
      if (!jammedListener.alive || jammedListener.health <= 0 ||
          (jammedListener.team === shooter.team && !isPlayerJammed(shooter, now)) ||
          !isPlayerJammed(jammedListener, now) ||
          hasFlashBlindness(jammedListener, now) ||
          isAudioSourceVisibleToPlayer(jammedListener, source, visionObjects, undefined, now)) continue;
      const key = `${shooter.id}:${jammedListener.id}`;
      if (now - (match.hostPrivateAudioCueLastAt[key] ?? -Infinity) < 600) continue;
      match.hostPrivateAudioCueLastAt[key] = now;
      const distance = Math.hypot(jammedListener.x - source.x, jammedListener.y - source.y);
      const radius = Math.min(320, Math.max(42, 30 + distance * 0.24));
      const angle = Math.random() * Math.PI * 2;
      const offset = radius * (0.3 + Math.random() * 0.45);
      cues.push({
        id: `${match.startedAt}:shot:${shooter.id}:${jammedListener.id}:${now}`.slice(0, 96),
        kind: 'gunshot',
        team: jammedListener.team,
        heardById: jammedListener.id,
        audiencePlayerId: jammedListener.controlledById ?? jammedListener.id,
        x: source.x + Math.cos(angle) * offset,
        y: source.y + Math.sin(angle) * offset,
        radius,
        expiresAt: now + 2_400,
      });
    }

    match.botNoises ??= [];
    match.botNoises.push(...cues.map((cue) => ({ ...cue })));
    if (match.botNoises.length > 32) match.botNoises.splice(0, match.botNoises.length - 32);
    return cues;
  }

  collectHostFootstepAudioCues(now) {
    if (now - this.lastFootstepCueCheckAt < 100) return;
    this.lastFootstepCueCheckAt = now;
    const match = {
      ...this.match,
      players: [...this.players.values()],
      map: { ...this.match.map, objects: this.mapObjects },
    };
    const cues = collectFootstepAudioCues(match, now, {
      lastCueAt: this.footstepCueLastAt,
      mapObjects: this.mapObjects,
    });
    for (const cue of cues) {
      this.match.botNoises ??= [];
      this.match.botNoises.push({ ...cue });
      if (this.match.botNoises.length > 32) this.match.botNoises.splice(0, this.match.botNoises.length - 32);
      this.pendingHostEvents.push({
        id: cue.id,
        type: 'audio-cue',
        audienceTeam: cue.team,
        ...(cue.audiencePlayerId ? { audiencePlayerId: cue.audiencePlayerId } : {}),
        data: cue,
      });
    }
  }

  applyHostDamage(victim, damage, attackerId, {
    weaponId = null, gadgetId = null, sourcePosition = null, at = Date.now(),
  } = {}) {
    if (!victim?.alive || victim.health <= 0 || !Number.isFinite(damage) || damage <= 0) return 0;
    const armorDamage = Math.min(Math.max(0, victim.armor ?? 0), damage);
    victim.armor = Math.max(0, (victim.armor ?? 0) - armorDamage);
    const healthBefore = victim.health;
    victim.health = Math.max(0, healthBefore - (damage - armorDamage));
    const dealt = armorDamage + healthBefore - victim.health;
    if (dealt <= 0) return 0;
    victim.lastDamagedAt = at;
    this.match.damageContributions ??= {};
    const contributions = this.match.damageContributions[victim.id] ??= {};
    contributions[attackerId] = (contributions[attackerId] ?? 0) + dealt;
    const attacker = this.players.get(attackerId);
    const damageSource = Number.isFinite(sourcePosition?.x) && Number.isFinite(sourcePosition?.y)
      ? sourcePosition
      : attacker;
    this.match.hostDamageCueLastAt ??= {};
    const shouldCueDamage = at - (this.match.hostDamageCueLastAt[victim.id] ?? -Infinity) >= 250;
    if (attacker && attacker.team !== victim.team && damageSource && shouldCueDamage) {
      this.match.hostDamageCueLastAt[victim.id] = at;
      const personal = isPlayerJammed(victim, at);
      const audiencePlayerId = victim.controlledById ?? victim.id;
      const id = `damage:${victim.id}:${at}:${this.pendingHostEvents.length}`.slice(0, 96);
      const cue = {
        id,
        victimId: victim.id,
        team: victim.team,
        bearing: Math.atan2(damageSource.y - victim.y, damageSource.x - victim.x),
        expiresAt: at + 1_200,
        ...(personal ? { audiencePlayerId } : {}),
      };
      this.pendingHostEvents.push({
        id,
        type: 'damage-cue',
        audienceTeam: victim.team,
        ...(personal ? { audiencePlayerId } : {}),
        data: cue,
      });
    }
    const feedbackPlayerId = attacker?.controlledById ?? attackerId;
    if (attacker && attacker.team !== victim.team && this.players.has(feedbackPlayerId)) {
      const id = `hit:${victim.id}:${at}:${this.pendingHostEvents.length}`.slice(0, 96);
      this.pendingHostEvents.push({
        id,
        type: 'hit-marker',
        audiencePlayerId: feedbackPlayerId,
        data: { id, durationMs: 250 },
      });
    }
    if (victim.health > 0) return dealt;

    const attribution = awardKillAndAssists(
      this.players.values(), victim, attackerId, contributions,
    );
    if (victim.id === this.getActivePlayerId()) this.showLocalDeathExplosion(victim);
    victim.alive = false;
    victim.isSpectator = true;
    victim.health = 0;
    victim.vx = 0;
    victim.vy = 0;
    victim.weaponLean = 0;
    victim.input = { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 };
    victim.stats ??= { kills: 0, assists: 0, deaths: 0 };
    victim.stats.deaths = (victim.stats.deaths ?? 0) + 1;
    victim.deathAttribution = {
      killerId: attribution.killerId,
      assisterIds: attribution.assisterIds,
      weaponId,
      gadgetId,
      at,
    };
    delete this.match.damageContributions[victim.id];
    if (victim.isBot && victim.controlledById) {
      victim.controlledById = null;
      victim.controlRevision = (victim.controlRevision ?? 0) + 1;
    }
    for (const bot of this.match.players) {
      if (!bot.isBot || bot.controlledById !== victim.id) continue;
      bot.controlledById = null;
      bot.controlRevision = (bot.controlRevision ?? 0) + 1;
      bot.input = { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 };
    }
    if (this.match.flag?.heldBy === victim.id) this.dropHostFlag(victim);
    if (this.roomState?.hostId === this.playerId && victim.team !== this.getLocalTeam() &&
        (getDeathFeedbackType(victim.deathAttribution, this.getActivePlayerId()) !== 'other' ||
          this.isPlayerVisible(victim))) {
      this.showDeathFeedback(victim, victim.deathAttribution);
    }
    return dealt;
  }

  resolveHostGadget(player, action) {
    const now = Date.now();
    const infiniteGadgetUse = this.isInfiniteGadgetUseEnabled();
    const equippedSlot = this.getEquippedSlot(player);
    if (action.action === 'switch') {
      if (now < (this.match.gameplayStartsAt ?? 0)) {
        this.logGadgetActionDiagnostic('host-switch-rejected-gameplay-not-started', player, action, {
          startsInMs: this.match.gameplayStartsAt - now,
        });
        return;
      }
      const targetSlot = equippedSlot === 'weapon' ? 'gadget' : 'weapon';
      const placedTrophy = player.selectedGadgetId === TROPHY_SYSTEM_ID
        ? this.getOwnedTrophySystem(player, now)
        : null;
      const trophyCommandJammed = targetSlot === 'gadget' && placedTrophy &&
        (isPlayerJammed(player, now) || isGadgetJammed(placedTrophy, now));
      const hasPlacedTrophy = Boolean(placedTrophy);
      if (trophyCommandJammed) {
        this.logGadgetActionDiagnostic('host-switch-rejected-trophy-command-jammed', player, action);
      } else if (targetSlot === 'gadget' &&
          (player.gadgetCounts?.[player.selectedGadgetId] ?? player.gadgetCount ?? 0) <= 0 &&
          !hasPlacedTrophy && !infiniteGadgetUse) {
        this.logGadgetActionDiagnostic('host-switch-rejected-no-gadget', player, action, { equippedSlot });
      } else {
        const target = beginGadgetSwitch(player, now);
        this.logGadgetActionDiagnostic('host-switch-accepted', player, action, { targetSlot: target }, 'info');
      }
    } else if (action.action === 'select') {
      const selected = action.target?.gadgetId;
      const selectedDefinition = GADGET_DEFINITIONS[selected];
      if (selectedDefinition && equippedSlot === 'weapon' &&
          ((player.gadgetCounts?.[selected] ?? 0) > 0 || infiniteGadgetUse)) {
        if (infiniteGadgetUse) refillGadgetCharges(player, selected);
        player.selectedGadgetId = selected;
        this.logGadgetActionDiagnostic('host-selection-accepted', player, action, { selectedGadgetId: selected }, 'info');
      } else {
        this.logGadgetActionDiagnostic('host-selection-rejected', player, action, {
          requestedGadgetId: selected ?? null,
          equippedSlot,
          availableCount: player.gadgetCounts?.[selected] ?? 0,
        });
      }
    } else if (action.action === 'use') {
      const gadgetId = player.selectedGadgetId;
      const gadgetCount = player.gadgetCounts?.[gadgetId] ?? player.gadgetCount ?? 0;
      const targetValid = Number.isFinite(action.target?.x) && Number.isFinite(action.target?.y);
      const definition = GADGET_DEFINITIONS[gadgetId];
      const ownedTrophy = gadgetId === TROPHY_SYSTEM_ID
        ? this.getOwnedTrophySystem(player, now)
        : null;
      if (!definition) {
        this.logGadgetActionDiagnostic('host-use-rejected-no-selected-gadget', player, action, { equippedSlot });
      } else if (equippedSlot !== 'gadget') {
        this.logGadgetActionDiagnostic('host-use-rejected-wrong-slot', player, action, { equippedSlot });
      } else if (now < (this.match.gameplayStartsAt ?? 0)) {
        this.logGadgetActionDiagnostic('host-use-rejected-gameplay-not-started', player, action, {
          startsInMs: this.match.gameplayStartsAt - now,
        });
      } else if (gadgetCount <= 0 && !ownedTrophy && !infiniteGadgetUse) {
        this.logGadgetActionDiagnostic('host-use-rejected-no-count', player, action, { gadgetCount });
      } else if (!targetValid) {
        this.logGadgetActionDiagnostic('host-use-rejected-invalid-target', player, action, { target: action.target ?? null });
      } else if (gadgetId === TROPHY_SYSTEM_ID && ownedTrophy) {
        if (!infiniteGadgetUse && now < (player.trophyCommandReadyAt ?? 0)) {
          this.logGadgetActionDiagnostic('host-use-rejected-trophy-command-cooldown', player, action, {
            cooldownRemainingMs: Math.max(0, (player.trophyCommandReadyAt ?? 0) - now),
          });
        } else {
          const created = createHostTrophyCommandProjectile({
            id: `${this.match.startedAt}:${player.id}:${action.actionSequence}`,
            player,
            trophy: ownedTrophy,
            target: action.target,
            mapObjects: this.mapObjects,
            now,
            matchEndsAt: this.match.endsAt,
            mapWidth: this.mapWidth,
            mapHeight: this.mapHeight,
          });
          if (!created) {
            this.logGadgetActionDiagnostic('host-use-rejected-trophy-command-target', player, action, {
              gadgetId,
              target: action.target,
            });
          } else {
            this.match.pendingGadgetEffects ??= [];
            this.match.pendingGadgetEffects.push(created);
            player.trophyCommandReadyAt = now +
              (infiniteGadgetUse ? 0 : TROPHY_SYSTEM_COMMAND_COOLDOWN_MS);
            player.equippedSlot = 'weapon';
            player.gadgetSwitchStartedAt = null;
            player.gadgetSwitchEndsAt = null;
            player.gadgetSwitchTargetSlot = null;
            this.pendingHostEvents.push({
              id: created.effect.id,
              type: 'gadget',
              data: {
                trajectory: created.trajectoryPreview,
                ownerId: player.id,
                gadgetId: TROPHY_SYSTEM_ID,
              },
            });
            this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
              gadgetId,
              endpoint: created.effect,
              effectId: created.effect.id,
              commandCooldownMs: TROPHY_SYSTEM_COMMAND_COOLDOWN_MS,
            }, 'info');
          }
        }
      } else if (gadgetId === KATANA_ID) {
        const dash = calculateKatanaDash(player, action.target, this.mapObjects, this.mapWidth, this.mapHeight);
        if (!dash) {
          this.logGadgetActionDiagnostic('host-use-rejected-no-trajectory', player, action, { gadgetId });
        } else {
          const hit = findFirstKatanaDashTarget({
            start: dash.start,
            end: dash.end,
            players: this.players.values(),
            ownerId: player.id,
            ownerTeam: player.team,
            hitRadius: definition.hitRadius ?? KATANA_DASH_HIT_RADIUS,
          });
          const effect = createHostKatanaDashEffect({
            id: `${this.match.startedAt}:${player.id}:${action.actionSequence}:katana`,
            player,
            dash,
            now,
          });
          if (!effect) {
            this.logGadgetActionDiagnostic('host-use-rejected-invalid-effect', player, action, { gadgetId });
          } else {
            Object.assign(player, { x: dash.end.x, y: dash.end.y, vx: 0, vy: 0 });
            this.match.gadgetEffects ??= [];
            this.match.gadgetEffects.push(effect);
            this.playGadgetEffectSound(effect);
            if (hit) {
              this.applyHostDamage(hit.player, hit.player.health + (hit.player.armor ?? 0), player.id, {
                gadgetId,
                sourcePosition: dash.start,
                at: now,
              });
            }
            const killed = Boolean(hit && (hit.player.alive === false || hit.player.health <= 0));
            consumeSelectedGadget(player, {
              keepEquippedWhenEmpty: killed,
              infiniteUse: infiniteGadgetUse,
            });
            if (killed) {
              refundKatanaCharge(player);
            } else {
              queueKatanaChargeRecharge(player, definition.cooldownMs);
            }
            this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
              gadgetId,
              endpoint: dash.end,
              hitPlayerId: hit?.player.id ?? null,
              effectId: effect.id,
            }, 'info');
          }
        }
      } else if (gadgetId === ORBITAL_STRIKE_ID) {
        const inMap = action.target.x >= 0 && action.target.x <= this.mapWidth &&
          action.target.y >= 0 && action.target.y <= this.mapHeight;
        const warning = inMap ? createHostOrbitalStrikeWarning({
          id: `${this.match.startedAt}:${player.id}:${action.actionSequence}`,
          definition,
          player,
          target: action.target,
          now,
        }) : null;
        if (!warning) {
          this.logGadgetActionDiagnostic('host-use-rejected-invalid-target', player, action, {
            gadgetId,
            target: action.target,
          });
        } else {
          this.match.pendingGadgetEffects ??= [];
          this.match.pendingGadgetEffects.push({
            effect: warning,
            landedAt: now,
            detonatesAt: warning.strikeAt,
          });
          consumeSelectedGadget(player, { infiniteUse: infiniteGadgetUse });
          queueOrbitalStrikeRecharge(player, warning.cooldownMs);
          this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
            gadgetId,
            endpoint: action.target,
            effectId: warning.id,
          }, 'info');
        }
      } else if (gadgetId === SPY_CAMERA_ID) {
        const angle = getHostAimAngle({
          x: action.target.x - player.x,
          y: action.target.y - player.y,
        }, player.visionAngle ?? 0);
        const camera = createHostSpyCamera({
          id: `${this.match.startedAt}:${player.id}:${action.actionSequence}`,
          definition,
          player,
          angle,
          now,
        });
        if (!camera) {
          this.logGadgetActionDiagnostic('host-use-rejected-effect-creation', player, action, { gadgetId });
        } else {
          this.match.gadgetEffects ??= [];
          this.match.gadgetEffects.push(camera);
          consumeSelectedGadget(player, { infiniteUse: infiniteGadgetUse });
          this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
            gadgetId,
            endpoint: { x: player.x, y: player.y },
            effectId: camera.id,
          }, 'info');
        }
      } else if (gadgetId === SONAR_ID) {
        const origin = getGadgetThrowOrigin(player, action.target, this.mapObjects);
        const dx = origin ? action.target.x - origin.x : 0;
        const dy = origin ? action.target.y - origin.y : 0;
        const distance = Math.hypot(dx, dy);
        const sonarTarget = origin && distance > 1e-6 ? {
          x: origin.x + dx / distance * definition.projectileRange,
          y: origin.y + dy / distance * definition.projectileRange,
        } : null;
        const trajectory = sonarTarget && calculateGadgetTrajectory(
          origin, sonarTarget, this.mapObjects, {
            maximumRange: definition.projectileRange,
            collisionRadius: definition.throwCollisionRadius,
            maximumBounces: Infinity,
            includeBounceEpsilon: true,
          },
        );
        const sonar = trajectory && createHostSonarProjectile({
          id: `${this.match.startedAt}:${player.id}:${action.actionSequence}`,
          definition,
          player,
          trajectory,
          now,
        });
        if (!sonar) {
          this.logGadgetActionDiagnostic('host-use-rejected-effect-creation', player, action, { gadgetId });
        } else {
          this.match.gadgetEffects ??= [];
          this.match.gadgetEffects.push(sonar);
          queueSonarChargeRecharge(player, definition.cooldownMs);
          consumeSelectedGadget(player, { infiniteUse: infiniteGadgetUse });
          this.lastMineIntelPublishAt = -Infinity;
          this.playGadgetEffectSound(sonar);
          this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
            gadgetId,
            endpoint: { x: sonar.x, y: sonar.y },
            effectId: sonar.id,
          }, 'info');
        }
      } else {
        const origin = getGadgetThrowOrigin(player, action.target, this.mapObjects);
        const trajectory = calculateGadgetTrajectory(origin, action.target, this.mapObjects, {
          maximumRange: definition.throwRange,
          collisionRadius: definition.throwCollisionRadius,
          maximumBounces: definition.maxBounces,
        });
        if (!trajectory) {
          this.logGadgetActionDiagnostic('host-use-rejected-no-trajectory', player, action, {
            gadgetId,
            target: action.target,
          });
        } else {
          const created = createHostGadgetEffect({
            id: `${this.match.startedAt}:${player.id}:${action.actionSequence}`,
            definition,
            player,
            trajectory,
            now,
            matchEndsAt: this.match.endsAt,
          });
          if (!created) {
            this.logGadgetActionDiagnostic('host-use-rejected-effect-creation', player, action, { gadgetId });
          } else {
            const { effect, landedAt, detonatesAt, trajectory: projectilePath, projectileSpeed } = created;
            this.match.pendingGadgetEffects ??= [];
            this.match.pendingGadgetEffects.push({
              effect,
              landedAt,
              detonatesAt,
              trajectory: projectilePath,
              projectileSpeed,
            });
            consumeSelectedGadget(player, { infiniteUse: infiniteGadgetUse });
            if (Number.isFinite(definition.cooldownMs) && Number.isSafeInteger(definition.charges)) {
              queuePerChargeGadgetRecharge(player, gadgetId, definition.cooldownMs, definition.charges);
            }
            this.pendingHostEvents.push({
              id: effect.id,
              type: 'gadget',
              data: { trajectory, ownerId: player.id, gadgetId: definition.id },
            });
            this.logGadgetActionDiagnostic('host-use-accepted', player, action, {
              gadgetId,
              endpoint: trajectory.endpoint,
              effectId: effect.id,
            }, 'info');
          }
        }
      }
    } else {
      this.logGadgetActionDiagnostic('host-action-unknown', player, action);
    }
    player.lastWeaponActionSequence = action.actionSequence;
  }

  dropHostFlag(player) {
    if (!this.match?.flag || this.match.flag.heldBy !== player.id) return false;
    Object.assign(this.match.flag, { heldBy: null, x: player.x, y: player.y, dropped: true, lastDroppedBy: player.id });
    this.syncFlagSoundState(this.match.flag);
    return true;
  }

  checkHostOutcome(now) {
    const match = this.match;
    if (!match || match.victory) return;
    const alive = { red: 0, blue: 0 };
    for (const player of this.players.values()) if (player.alive && player.health > 0) alive[player.team] += 1;
    let winner = null;
    let reason = null;
    const flag = match.flag;
    if (flag?.heldBy) {
      const carrier = this.players.get(flag.heldBy);
      const home = match.map.spawnZones.red;
      if (carrier?.team === 'red' && carrier.x >= home.x && carrier.x <= home.x + home.width &&
          carrier.y >= home.y && carrier.y <= home.y + home.height) {
        winner = 'red'; reason = 'capture';
        Object.assign(flag, { heldBy: null, x: home.x + home.width / 2, y: home.y + home.height / 2,
          dropped: false, lastDroppedBy: null });
      }
    }
    if (!winner && alive.red === 0) { winner = 'blue'; reason = 'elimination'; }
    else if (!winner && alive.blue === 0) { winner = 'red'; reason = 'elimination'; }
    else if (!winner && now >= match.endsAt) { winner = 'blue'; reason = 'time'; }
    if (!winner) return;
    let quickPlayProgression = null;
    if (match.quickPlayState) {
      const series = match.quickPlayState;
      quickPlayProgression = advanceQuickPlaySeriesResult({
        series,
        rolesBySquad: this.roomState.quickPlaySquadRoles ?? series.rolesBySquad,
        squadScore: this.roomState.quickPlaySquadScore ?? series.squadScore,
        sidesSwapped: this.roomState.quickPlaySidesSwapped ?? series.sidesSwapped,
        mapGenerationRevision: this.roomState.mapGenerationRevision ?? series.mapGenerationRevision,
      }, winner, reason, now);
      if (!quickPlayProgression) {
        console.error('Unable to record series result: host series state is invalid.');
        return;
      }
    }
    match.victory = { winner, reason, at: now };
    if (quickPlayProgression) {
      match.quickPlayState = quickPlayProgression.state;
      Object.assign(this.roomState, {
        quickPlayState: quickPlayProgression.state,
        quickPlaySquadRoles: quickPlayProgression.rolesBySquad,
        quickPlaySquadScore: quickPlayProgression.squadScore,
        quickPlaySidesSwapped: quickPlayProgression.sidesSwapped,
        mapGenerationRevision: quickPlayProgression.mapGenerationRevision,
        quickPlayMapGenerationPending: quickPlayProgression.state.phase === 'round-result',
      });
    } else {
      match.postGame = { endsAt: now + 15_000, choices: {} };
    }
    this.playOutcomeSounds(match.victory, match.quickPlayState);
  }

  publishHostFrame(now = Date.now()) {
    if (this.roomState?.hostId !== this.playerId || !this.match) return;
    if (now - this.lastHostFrameAt < HOST_FRAME_INTERVAL_MS) return;
    this.lastHostFrameAt = now;
    const playersById = new Map((this.match.players ?? []).map((player) => [player.id, player]));
    for (const player of this.players.values()) playersById.set(player.id, player);
    if (!playersById.has(this.playerId)) {
      console.error('Unable to publish host frame: the host actor is missing from the match state.');
      return;
    }
    this.match.players = [...playersById.values()].map((player) => ({ ...player }));
    this.match.updatedAt = now;
    let events = this.pendingHostEvents.slice(0, MAX_HOST_FRAME_EVENTS);
    let queuedEventCount = events.length;
    const queuedEventIds = new Set(events.map((event) => event.id));
    for (const [id, recent] of this.recentHostEvents) {
      if (recent.expiresAt <= now) {
        this.recentHostEvents.delete(id);
      } else if (!queuedEventIds.has(id) && events.length < MAX_HOST_FRAME_EVENTS) {
        events.push(recent.event);
      }
    }
    const revision = this.hostFrameRevision + 1;
    const createFrame = () => createHostFrame({
      match: this.match,
      authorityEpoch: this.roomState.simulation?.epoch,
      revision,
      simulationTimeMs: Math.max(0, now - this.match.startedAt),
      events,
      includeMap: revision === 1,
    });
    let frame = createFrame();
    let validation = frame ? validateHostFrame(frame) : { valid: false, reason: 'Host frame could not be created.' };
    while (frame && !validation.valid && events.length > 0) {
      events = events.slice(0, -1);
      queuedEventCount = Math.min(queuedEventCount, events.length);
      frame = createFrame();
      validation = validateHostFrame(frame);
    }
    if (!frame || !validation.valid) {
      this.logHostFrameError('publish-validation-failed', { reason: validation.reason });
      return;
    }
    const sent = this.roomClient.send('game:host-frame', frame);
    if (!sent) {
      const reason = this.roomClient.lastSendFailureReason;
      if (reason !== 'backpressure' && reason !== 'socket-not-open') {
        this.logHostFrameError('publish-send-failed', {
          revision,
          actors: frame.actors.length,
          reason: reason ?? 'unknown',
        });
      }
      return;
    }
    recordMatchReportHostFrame(this.matchReport, {
      monotonicNow: performance.now(),
      bufferedBytes: this.roomClient.getBufferedAmount(),
    });
    this.pendingHostEvents.splice(0, queuedEventCount);
    for (const event of events.slice(0, queuedEventCount)) {
      const replayMs = event.type === 'projectile' ? 500
        : event.type === 'prop-damage' ? 1_500
          : ['audio-cue', 'damage-cue'].includes(event.type)
            ? Math.max(0, (event.data?.expiresAt ?? now) - now)
            : 0;
      if (replayMs > 0) {
        this.recentHostEvents.set(event.id, { event, expiresAt: now + replayMs });
      }
    }
    this.hostFrameRevision = revision;
    for (const event of events) this.applyHostEvent(event);
    this.hostFrameUpdateHandler?.(this.match);
  }

  logHostFrameError(reason, details = {}) {
    const now = Date.now();
    if (now - (this.hostFrameErrorLogAt.get(reason) ?? -Infinity) < 5_000) return;
    this.hostFrameErrorLogAt.set(reason, now);
    console.error(`[host-frame] ${reason}`, details);
  }

  applyHostFrame(frame) {
    const simulation = this.roomState?.simulation;
    const validation = validateHostFrame(frame);
    const rejectionReason = simulation?.mode !== 'host-authoritative' ? 'not-host-authoritative'
      : simulation.authorityId === this.playerId ? 'local-client-is-authority'
        : frame?.authorityEpoch !== simulation.epoch ? 'authority-epoch-mismatch'
          : frame?.matchId !== this.match?.startedAt ? 'match-id-mismatch'
            : !validation.valid ? validation.reason
              : frame.revision <= (this.hostFrameRevision ?? 0) ? 'stale-revision' : null;
    if (rejectionReason) {
      this.logHostFrameError('frame-rejected', {
          reason: rejectionReason,
          revision: frame?.revision ?? null,
          actors: frame?.actors?.length ?? null,
          localActors: this.match?.players?.length ?? null,
          localRevision: this.hostFrameRevision,
      });
      return null;
    }
    const next = applyHostFrame(frame, this.match);
    if (!next) {
      this.logHostFrameError('frame-application-failed', { revision: frame.revision });
      return null;
    }
    this.hostFrameRevision = frame.revision;
    this.match = next;
    this.applyingHostFrame = true;
    this.applySnapshot(next);
    this.applyingHostFrame = false;
    return next;
  }

  applyHostEvent(event) {
    const forwardedToBotController = isHostBotCueEvent(
      event, this.roomState?.hostId, this.playerId,
    );
    if (forwardedToBotController) {
      if (event.type === 'audio-cue') this.audioCueHandler?.(event.data);
      else this.damageCueHandler?.(event.data);
    }
    if (!event || (event.audienceTeam && event.audienceTeam !== this.getLocalTeam()) ||
        (event.audiencePlayerId && event.audiencePlayerId !== this.playerId)) return;
    const activePlayerId = this.getActivePlayerId();
    const personalAudioCue = event.type === 'audio-cue' &&
      event.audiencePlayerId === this.playerId &&
      isPersonalAudioCueForViewer(event.data, activePlayerId, this.playerId);
    const personalDamageCue = event.type === 'damage-cue' &&
      event.audiencePlayerId === this.playerId &&
      isPersonalDamageCueForViewer(event.data, activePlayerId, this.playerId);
    if (this.isActivePlayerJammed() && event.audienceTeam === this.getLocalTeam() &&
        ['audio-cue', 'damage-cue'].includes(event.type) &&
        !personalAudioCue && !personalDamageCue) return;
    if (typeof event.id === 'string') {
      if (this.consumedHostEventIds.has(event.id)) return;
      this.consumedHostEventIds.add(event.id);
      if (this.consumedHostEventIds.size > 1_024) {
        this.consumedHostEventIds.delete(this.consumedHostEventIds.values().next().value);
      }
    }
    if (event.type === 'projectile') {
      this.showProjectile(event.data);
    } else if (event.type === 'gadget') {
      this.applyGadgetEvent(event.data, event.id);
    } else if (event.type === 'gadget-intercepted') {
      this.cancelGadgetProjectileVisual(event.data?.projectileId);
      if (typeof event.id === 'string' &&
          [event.data?.x, event.data?.y].every(Number.isFinite)) {
        this.trophyInterceptVisuals.set(event.id, {
          projectileId: event.data.projectileId,
          x: event.data.x,
          y: event.data.y,
          trophyX: event.data.trophyX,
          trophyY: event.data.trophyY,
          trophyTeam: event.data.trophyTeam,
          startedAt: Date.now(),
          expiresAt: Date.now() + TROPHY_INTERCEPT_VISUAL_DURATION_MS,
        });
        this.drawSmokeClouds();
      }
    } else if (event.type === 'audio-cue') {
      this.applyAudioCue(event.data);
      if (!forwardedToBotController) this.audioCueHandler?.(event.data);
    } else if (event.type === 'damage-cue') {
      this.applyDamageCue(event.data);
      if (!forwardedToBotController) this.damageCueHandler?.(event.data);
    } else if (event.type === 'hit-marker') {
      if (event.data?.id && Number.isFinite(event.data.durationMs)) {
        this.hitMarkerExpiresAt = Math.max(this.hitMarkerExpiresAt,
          Date.now() + Math.min(500, Math.max(0, event.data.durationMs)));
      }
    } else if (event.type === 'prop-damage') {
      if (typeof event.data?.objectId === 'string' && Number.isFinite(event.data.health)) {
        this.applyDestructibleObjectState([{ id: event.data.objectId, health: event.data.health }]);
      }
    }
  }

  advanceHostMovement(deltaSeconds) {
    const now = Date.now();
    const droppedFlagThisFrame = new Set();
    for (const player of this.players.values()) {
      advanceOrbitalStrikeCooldown(player, deltaSeconds * 1000);
      advanceKatanaChargeRecharge(player, deltaSeconds * 1000);
      advanceSonarChargeRecharges(player, deltaSeconds * 1000);
      advancePerChargeGadgetRecharges(player, JAMMER_GRENADE_ID, deltaSeconds * 1000, {
        cooldownMs: JAMMER_GRENADE_COOLDOWN_MS,
        maximumCharges: 1,
      });
      advancePerChargeGadgetRecharges(player, BIO_FIELD_ID, deltaSeconds * 1000, {
        cooldownMs: BIO_FIELD_COOLDOWN_MS,
        maximumCharges: GADGET_DEFINITIONS[BIO_FIELD_ID].charges,
      });
      advanceVineTrapRecharge(player, now);
      if (player.alive && player.health > 0) regeneratePlayerArmor(player, deltaSeconds, now);
    }
    for (const player of this.players.values()) {
      if (!shouldHostSimulateActor(player, this.getActivePlayerId())) continue;
      const entry = this.authorityInputs.get(player.id);
      const input = entry && now - entry.receivedAt <= 250
        ? entry.input
        : { up: false, down: false, left: false, right: false, drop: false, weaponLean: 0 };
      const dropPressed = input.drop && !player.input?.drop;
      player.input = input;
      player.weaponLean = input.weaponLean ?? player.weaponLean ?? 0;
      player.visionAngle = input.visionAngle ?? player.visionAngle ?? 0;
      const weapon = this.getSelectedWeapon(player);
      const gadgetMovementScale = getGadgetMovementScale(player, this.match.gadgetEffects, now);
      const movementScale = getPlayerMovementScale(
        !this.isPostGameFreeRoam() && this.match.flag?.heldBy === player.id,
        weapon.movementScale,
        getInventoryEffects(player.inventory).movementBonus,
      ) * gadgetMovementScale;
      const nextPosition = movePositionWithCatchUp(
        player,
        input,
        deltaSeconds,
        this.mapWidth,
        this.mapHeight,
        this.mapObjects,
        movementScale,
        gadgetMovementScale > 1 ? movementScale : 1.15,
      );
      const tether = (this.match.gadgetEffects ?? []).find((effect) =>
        effect.type === VINE_TRAP_ID && effect.latchedEnemyId === player.id && effect.activeUntil > now);
      Object.assign(player, constrainPositionToRadius(
        nextPosition, tether, tether?.triggerRadius ?? tether?.radius,
      ));
      if (dropPressed && this.dropHostFlag(player)) droppedFlagThisFrame.add(player.id);
      if (this.match.flag?.heldBy === player.id) {
        this.match.flag.x = player.x;
        this.match.flag.y = player.y;
      }
      if (entry) {
        entry.acceptedSequence = entry.sequence;
        player.lastInputSequence = entry.sequence;
        player.inputSequence = entry.sequence;
      }
    }
    const pendingEffects = this.match.pendingGadgetEffects ?? [];
    const tickStartedAt = now - Math.min(deltaSeconds * 1000, 100);
    const interceptions = findTrophyProjectileInterceptions(
      pendingEffects, this.match.gadgetEffects ?? [], this.getVisionObjects(), tickStartedAt, now,
    );
    const interceptedEffectIds = new Set(interceptions.map((interception) => interception.effectId));
    for (const interception of interceptions) {
      const event = {
        id: `${this.match.startedAt}:gadget-intercept:${++this.hostGadgetInterceptionSequence}`.slice(0, 96),
        type: 'gadget-intercepted',
        data: {
          projectileId: interception.effectId,
          gadgetId: interception.gadgetId,
          trophyId: interception.trophyId,
          trophyX: interception.trophyPosition.x,
          trophyY: interception.trophyPosition.y,
          trophyTeam: interception.team,
          x: interception.position.x,
          y: interception.position.y,
        },
      };
      this.pendingHostEvents.push(event);
    }
    const pendingGadgets = [];
    for (const pending of pendingEffects) {
      if (interceptedEffectIds.has(pending.effect?.id)) continue;
      if (pending.effect?.type === 'orbital-strike-warning') {
        if (pending.detonatesAt > now) {
          pendingGadgets.push(pending);
        } else {
          this.resolveHostOrbitalStrike(pending.effect, now);
        }
        continue;
      }
      if (pending.detonatesAt > now) {
        pendingGadgets.push(pending);
        continue;
      }
      if (pending.effect.expiresAt <= now) continue;
      const effect = {
        ...pending.effect,
        startedAt: pending.detonatesAt,
        ...(pending.effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID
          ? { expiresAt: pending.detonatesAt + TROPHY_SYSTEM_COMMAND_VISUAL_DURATION_MS }
          : {}),
      };
      if (effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID) {
        const cleared = findTrophyCommandClearedEffects({
          pulse: effect,
          gadgetEffects: this.match.gadgetEffects,
          smokes: this.match.smokes,
          visionObjects: [
            ...this.mapObjects,
            ...(this.match.smokes ?? []).filter((smoke) => smoke.expiresAt > effect.startedAt),
          ],
          now: effect.startedAt,
        });
        this.match.gadgetEffects = (this.match.gadgetEffects ?? []).filter((candidate) =>
          !cleared.gadgetEffectIds.has(candidate.id));
        this.match.smokes = (this.match.smokes ?? []).filter((candidate) =>
          !cleared.smokeIds.has(candidate.id));
      }
      if (effect.type === 'smoke') this.match.smokes.push(effect);
      else this.match.gadgetEffects.push(effect);
      this.playGadgetEffectSound(effect);
      if (effect.type === 'flash') {
        const visionObjects = [
          ...this.mapObjects,
          ...(this.match.smokes ?? []).filter((smoke) => smoke.expiresAt > effect.startedAt),
        ];
        applyFlashBlindness(effect, [...this.players.values()], visionObjects, this.match.gadgetEffects);
      } else if (effect.type === 'jammer') {
        applyHostJammerDetonation({
          jammer: effect,
          players: this.players.values(),
          gadgetEffects: this.match.gadgetEffects,
          now: effect.startedAt ?? now,
        });
      }
    }
    this.match.pendingGadgetEffects = pendingGadgets;
    this.publishHostMineIntel(now);
    this.applyHostGadgetEffects(now, deltaSeconds);
    const flag = this.match.flag;
    if (flag?.lastDroppedBy) {
      const dropper = this.players.get(flag.lastDroppedBy);
      if (!dropper || Math.hypot(dropper.x - flag.x, dropper.y - flag.y) > 26) {
        flag.lastDroppedBy = null;
      }
    }
    if (flag && !flag.heldBy) {
      const carrier = [...this.players.values()].find((player) => player.alive && player.team === 'red' &&
        player.id !== flag.lastDroppedBy && !droppedFlagThisFrame.has(player.id) &&
        Math.hypot(player.x - flag.x, player.y - flag.y) <= 26);
      if (carrier) {
        Object.assign(flag, { heldBy: carrier.id, dropped: false, lastDroppedBy: null, x: carrier.x, y: carrier.y });
        this.syncFlagSoundState(flag);
      }
    }
    this.match.smokes = (this.match.smokes ?? []).filter((effect) => effect.expiresAt > now);
    this.match.gadgetEffects = (this.match.gadgetEffects ?? []).filter((effect) => effect.expiresAt > now);
    for (const player of this.players.values()) {
      const weapon = this.getSelectedWeapon(player);
      const state = player.weaponStats?.[weapon.id];
      if (state) {
        const advanced = advanceWeaponState(state, weapon, now,
          Math.hypot(player.vx ?? 0, player.vy ?? 0));
        this.playReloadSoundEvents(player, weapon, state, advanced);
        player.weaponStats[weapon.id] = advanced;
      }
    }
    this.checkHostOutcome(now);
  }

  resolveHostOrbitalStrike(warning, now) {
    const impact = createHostOrbitalStrikeImpact(warning, now);
    if (!impact) return;
    const blastDamage = applyGadgetAreaDamage(
      this.match.gadgetEffects, this.mapObjects, warning, warning.radius,
      warning.explosionDamage, warning.id, now,
    );
    if (blastDamage.removedEffectIds.size > 0) {
      if ((this.match.gadgetEffects ?? []).some((effect) =>
        blastDamage.removedEffectIds.has(effect.id) && effect.triggerOnEnemyProximity === true)) {
        this.lastMineIntelPublishAt = -Infinity;
      }
      this.match.gadgetEffects = (this.match.gadgetEffects ?? [])
        .filter((effect) => !blastDamage.removedEffectIds.has(effect.id));
    }
    for (const { object, health, destroyed } of blastDamage.damagedProps) {
      if (destroyed) this.invalidateVisionForDestroyedProps([object.id]);
      this.match.destructibleObjects ??= [];
      const previous = this.match.destructibleObjects.find((entry) => entry.id === object.id);
      const state = { id: object.id, health };
      if (previous) Object.assign(previous, state);
      else this.match.destructibleObjects.push(state);
      this.pendingHostEvents.push({
        id: `orbital-prop:${object.id}:${warning.id}:${now}`.slice(0, 96),
        type: 'prop-damage',
        data: { objectId: object.id, health },
      });
    }
    if (blastDamage.damagedProps.length > 0) this.drawVisibleProps(true);
    for (const player of this.players.values()) {
      if (Math.hypot(player.x - warning.x, player.y - warning.y) > warning.radius) continue;
      this.applyHostDamage(player, warning.explosionDamage, warning.ownerId, {
        gadgetId: warning.gadgetId,
        sourcePosition: { x: warning.x, y: warning.y },
        at: now,
      });
    }
    this.match.gadgetEffects.push(impact.explosion, impact.fire);
    this.playGadgetEffectSound(impact.explosion);
    this.playGadgetEffectSound(impact.fire);
  }

  publishHostMineIntel(now = Date.now(), force = false) {
    if ((!force && now - this.lastMineIntelPublishAt < 300) || this.roomState?.hostId !== this.playerId) return;
    this.lastMineIntelPublishAt = now;
    const mines = (this.match.gadgetEffects ?? []).filter((effect) =>
      effect.triggerOnEnemyProximity === true && effect.expiresAt > now);
    const visionObjects = this.getVisionObjects();
    for (const team of ['red', 'blue']) {
      const sonars = (this.match.gadgetEffects ?? []).filter((effect) =>
        effect.type === 'sonar-projectile' && effect.team === team &&
        effect.expiresAt > now && !isGadgetJammed(effect, now) &&
        this.players.get(effect.ownerId)?.alive &&
        (this.players.get(effect.ownerId)?.health ?? 100) > 0);
      const knownMines = mines.filter((mine) => {
        if (mine.team === team && isGadgetJammed(mine, now)) return false;
        if (mine.team === team) return true;
        return [...this.players.values()].some((observer) => {
          if (!observer.alive || observer.health <= 0 || observer.team !== team ||
              isPlayerJammed(observer, now) || this.isPlayerFlashBlinded(observer, now)) return false;
          if (mine.latchedEnemyId === observer.id) return true;
          const weapon = this.getSelectedWeapon(observer);
          const angle = observer.visionAngle ?? observer.weaponStats?.[weapon.id]?.aimAngle ?? 0;
          const origin = getPlayerVisionOrigin(observer, this.mapObjects);
          return isPointVisible(mine, {
            origin,
            angle,
            halfAngle: VISION_HALF_ANGLE,
          }, visionObjects);
        });
      });
      const known = [...sonars, ...knownMines].map((mine) => structuredClone(mine));
      const nextIds = new Set(known.map((mine) => mine.id));
      const previousIds = this.publishedMineIntelByTeam[team];
      const addedIds = [...nextIds].filter((id) => !previousIds.has(id));
      const removedIds = [...previousIds].filter((id) => !nextIds.has(id));
      if (addedIds.length > 0 || removedIds.length > 0) {
        this.logGadgetActionDiagnostic('host-mine-intel-changed', null, {
          action: `mine-intel-${team}`,
        }, {
          gadgetId: PROXIMITY_MINE_ID,
          team,
          mineCount: known.length,
          addedIds,
          removedIds,
        }, 'info');
      }
      this.publishedMineIntelByTeam[team] = nextIds;
      if (!this.roomClient.send('game:intel:mines', { matchId: this.match.startedAt, team, mines: known })) {
        this.logGadgetActionDiagnostic('host-mine-intel-send-failed', null, {
          action: `mine-intel-${team}`,
        }, { team, mineCount: known.length });
      }
    }
  }

  applyTeamMineIntel({ matchId, team, mines } = {}) {
    if (this.isActivePlayerJammed() || matchId !== this.match?.startedAt ||
        team !== this.getLocalTeam() || !Array.isArray(mines)) return;
    const nextIds = new Set(mines.map((mine) => mine.id));
    const addedIds = [...nextIds].filter((id) => !this.localKnownMineIds.has(id));
    const removedIds = [...this.localKnownMineIds].filter((id) => !nextIds.has(id));
    if (addedIds.length > 0 || removedIds.length > 0) {
      this.logGadgetActionDiagnostic('client-mine-intel-changed', null, {
        action: 'mine-intel-received',
      }, {
        gadgetId: PROXIMITY_MINE_ID,
        team,
        mineCount: mines.length,
        addedIds,
        removedIds,
      }, 'info');
    }
    this.localKnownMineIds = nextIds;
    if (this.roomState?.hostId === this.playerId) {
      this.drawSmokeClouds();
      return;
    }
    const addedSonars = mines.filter((effect) =>
      effect.type === 'sonar-projectile' && addedIds.includes(effect.id));
    this.match.gadgetEffects = [
      ...(this.match.gadgetEffects ?? []).filter((effect) =>
        effect.triggerOnEnemyProximity !== true && effect.type !== 'sonar-projectile'),
      ...mines.map((mine) => structuredClone(mine)),
    ];
    for (const sonar of addedSonars) this.playGadgetEffectSound(sonar);
    this.drawSmokeClouds();
  }

  applyHostGadgetEffects(now, deltaSeconds) {
    const currentEffects = this.match.gadgetEffects ?? [];
    const removedSonarIds = advanceHostSonarProjectiles(
      currentEffects, this.players, Math.max(0, deltaSeconds * 1000), now,
    );
    if (removedSonarIds.size > 0) {
      this.match.gadgetEffects = currentEffects.filter((effect) => !removedSonarIds.has(effect.id));
      this.lastMineIntelPublishAt = -Infinity;
    }
    let effects = this.match.gadgetEffects ?? [];
    const visionObjects = this.getVisionObjects();
    const trophyRemovedIds = findTrophyPlacedGadgetInterceptions(
      effects, effects, visionObjects, now,
    );
    if (trophyRemovedIds.size > 0) {
      if (effects.some((effect) =>
        trophyRemovedIds.has(effect.id) && effect.triggerOnEnemyProximity === true)) {
        this.lastMineIntelPublishAt = -Infinity;
      }
      effects = effects.filter((effect) => !trophyRemovedIds.has(effect.id));
      this.match.gadgetEffects = effects;
    }
    const triggeredMines = new Set();
    const explosions = [];
    for (const player of this.players.values()) advanceVineTrapRecharge(player, now);
    const tickStartedAt = now - Math.min(deltaSeconds * 1000, 100);
    const { removedEffectIds, burns, damagedProps } = applyMolotovWorldEffects(
      effects, this.mapObjects, tickStartedAt, now,
    );
    for (const { molotov, damage } of burns) {
      for (const player of this.players.values()) {
        if (Math.hypot(player.x - molotov.x, player.y - molotov.y) <= (molotov.radius ?? 0)) {
          this.applyHostDamage(player, damage, molotov.ownerId, {
            gadgetId: molotov.gadgetId,
            sourcePosition: { x: molotov.x, y: molotov.y },
            at: now,
          });
        }
      }
    }
    for (const { molotovId, object, health, destroyed } of damagedProps) {
      if (destroyed) this.invalidateVisionForDestroyedProps([object.id]);
      this.match.destructibleObjects ??= [];
      const previous = this.match.destructibleObjects.find((entry) => entry.id === object.id);
      const state = { id: object.id, health };
      if (previous) Object.assign(previous, state);
      else this.match.destructibleObjects.push(state);
      const id = `molotov-prop:${object.id}:${molotovId}:${now}:${this.pendingHostEvents.length}`.slice(0, 96);
      this.pendingHostEvents.push({
        id,
        type: 'prop-damage',
        data: { id, objectId: object.id, health },
      });
    }
    if (damagedProps.length) this.drawVisibleProps(true);

    let activeEffects = effects.filter((effect) => !removedEffectIds.has(effect.id));
    const completedVineTrapIds = new Set();
    for (const effect of activeEffects) {
      if (effect.type !== VINE_TRAP_ID || !effect.latchedEnemyId) continue;
      const targetDied = isVineTrapTargetDead(effect, this.players);
      if (!targetDied && effect.activeUntil > now) continue;
      const owner = this.players.get(effect.ownerId);
      if (this.isInfiniteGadgetUseEnabled()) {
        if (owner) owner.vineTrapRechargeAt = null;
      } else {
        startVineTrapRecharge(
          owner, targetDied ? now : effect.activeUntil ?? now,
          effect.rechargeDurationMs,
        );
      }
      completedVineTrapIds.add(effect.id);
    }
    if (completedVineTrapIds.size) {
      activeEffects = activeEffects.filter((effect) => !completedVineTrapIds.has(effect.id));
      this.lastMineIntelPublishAt = -Infinity;
    }
    if (removedEffectIds.size) {
      if (effects.some((effect) =>
        removedEffectIds.has(effect.id) && effect.triggerOnEnemyProximity === true)) {
        this.lastMineIntelPublishAt = -Infinity;
      }
    }
    this.match.gadgetEffects = activeEffects;
    for (const effect of activeEffects) {
      if (!effect.triggerOnEnemyProximity || effect.expiresAt <= now) continue;
      if (effect.type === VINE_TRAP_ID && effect.latchedEnemyId) continue;
      effect.armed = isProximityMineArmed(effect, now);
      if (!effect.armed) continue;
      const radius = effect.triggerRadius ?? effect.radius;
      const canSeeMine = (player) => isPointVisible({ x: player.x, y: player.y }, {
        origin: { x: effect.x, y: effect.y },
        angle: 0,
        halfAngle: Math.PI,
        maximumRange: radius,
      }, visionObjects);
      const detectedEnemy = [...this.players.values()].find((player) => player.alive && player.health > 0 &&
        player.team !== effect.team && Math.hypot(player.x - effect.x, player.y - effect.y) <= radius && canSeeMine(player));
      if (!detectedEnemy) continue;
      if (effect.type === VINE_TRAP_ID) {
        if (activateVineTrap(effect, detectedEnemy, now)) this.lastMineIntelPublishAt = -Infinity;
        continue;
      }
      triggeredMines.add(effect.id);
      const blastDamage = applyGadgetAreaDamage(
        activeEffects, this.mapObjects, effect, radius,
        effect.explosionDamage ?? 150, effect.id, now,
      );
      for (const id of blastDamage.removedEffectIds) triggeredMines.add(id);
      for (const { object, health, destroyed } of blastDamage.damagedProps) {
        if (destroyed) this.invalidateVisionForDestroyedProps([object.id]);
        this.match.destructibleObjects ??= [];
        const previous = this.match.destructibleObjects.find((entry) => entry.id === object.id);
        const state = { id: object.id, health };
        if (previous) Object.assign(previous, state);
        else this.match.destructibleObjects.push(state);
        this.pendingHostEvents.push({
          id: `mine-prop:${object.id}:${effect.id}:${now}`.slice(0, 96),
          type: 'prop-damage',
          data: { objectId: object.id, health },
        });
      }
      if (blastDamage.damagedProps.length > 0) this.drawVisibleProps(true);
      for (const player of this.players.values()) {
        if (Math.hypot(player.x - effect.x, player.y - effect.y) <= radius && canSeeMine(player)) {
          this.applyHostDamage(player, effect.explosionDamage ?? 150, effect.ownerId,
            {
              gadgetId: effect.gadgetId,
              sourcePosition: { x: effect.x, y: effect.y },
              at: now,
            });
        }
      }
      explosions.push({
        id: `${effect.id}:explosion`.slice(0, 96),
        shape: 'circle',
        type: 'mine-explosion',
        gadgetId: effect.gadgetId,
        x: effect.x,
        y: effect.y,
        radius,
        ownerId: effect.ownerId,
        team: effect.team,
        startedAt: now,
        expiresAt: now + 500,
        blocksMovement: false,
        blocksProjectiles: false,
        blocksVision: false,
      });
    }
    if (triggeredMines.size) {
      activeEffects = activeEffects.filter((effect) => !triggeredMines.has(effect.id));
      this.match.gadgetEffects = [...activeEffects, ...explosions];
      for (const explosion of explosions) this.playGadgetEffectSound(explosion);
      this.lastMineIntelPublishAt = -Infinity;
    }
  }

  readLocalInput() {
    return {
      up: this.keys.W.isDown || this.keys.UP.isDown,
      down: this.keys.S.isDown || this.keys.DOWN.isDown,
      left: this.keys.A.isDown || this.keys.LEFT.isDown,
      right: this.keys.D.isDown || this.keys.RIGHT.isDown,
      drop: this.keys.F.isDown,
      weaponLean: this.weaponLean,
      visionAngle: this.localVisionAngle,
      speedScale: this.keys.SHIFT.isDown ? SLOW_WALK_SPEED_SCALE : 1,
    };
  }

  getActivePlayerId() {
    return this.controlledBotId ?? this.playerId;
  }

  suspendNetworkActivity() {
    this.networkSuspended = true;
    this.fireHeld = false;
  }

  resumeNetworkActivity() {
    this.networkSuspended = false;
  }

  getSelectedWeapon(player = this.players.get(this.getActivePlayerId())) {
    const selectedId = player?.selectedWeaponId ?? 'assault-rifle';
    const definition = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).find((weapon) => weapon.id === selectedId) ??
      DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    return applyInventoryWeaponEffects(definition, player?.inventory);
  }

  update(time, delta) {
    this.smoothedFrameDeltaMs = smoothComputationTime(
      this.smoothedFrameDeltaMs,
      Number.isFinite(delta) ? Math.max(0, delta) : 0,
    );
    const startedAt = performance.now();
    const report = this.prepareMatchReportFrame(startedAt);
    const clientDiagnostics = this.prepareMatchClientDiagnostics(startedAt);
    const updateTrace = report ? {
      phaseDurations: {},
      botProfile: { decisionCount: 0, totalDecisionMs: 0, slowestDecisions: [] },
    } : null;
    this.currentUpdateTrace = updateTrace;
    try {
      this.updateFrame(time, delta);
    } finally {
      this.currentUpdateTrace = null;
      const completedAt = performance.now();
      const elapsedMs = completedAt - startedAt;
      this.recordComputationTime(elapsedMs, time);
      if (clientDiagnostics) {
        recordMatchClientFrame(clientDiagnostics, elapsedMs, {
          frameDeltaMs: delta,
          monotonicNow: completedAt,
        });
      }
      if (report) {
        const players = this.match?.victory && !report.completed
          ? this.getMatchReportPlayers()
          : this.players.values();
        recordMatchReportFrame(report, elapsedMs, {
          match: this.match,
          players,
          monotonicNow: completedAt,
          frameDeltaMs: delta,
          phaseDurations: updateTrace.phaseDurations,
          botProfile: updateTrace.botProfile,
        });
        if (completeMatchReport(report, this.match, players, { monotonicNow: completedAt })) {
          const validation = validateMatchReport(report, report.matchId);
          if (!report.storageEligible || !validation.valid) {
            console.error('[match-report] report cannot be uploaded', {
              matchId: report.matchId,
              reason: validation.reason ?? 'Report exceeded the supported size.',
            });
          } else {
            this.pendingMatchReports.push({ report, attempts: 0, retryAt: 0 });
          }
        }
      }
      if (clientDiagnostics && this.match?.victory) {
        this.finalizeMatchClientDiagnostics(this.match);
      }
      this.submitPendingMatchReport();
      this.submitPendingMatchClientDiagnostics();
    }
  }

  getMatchReportPlayers() {
    const players = new Map((this.match?.players ?? []).map((player) => [player.id, player]));
    for (const player of this.players.values()) players.set(player.id, player);
    return [...players.values()];
  }

  prepareMatchReportFrame(monotonicNow) {
    if (!this.match || this.roomState?.hostId !== this.playerId ||
        !Number.isFinite(this.match.startedAt)) return null;
    if (this.matchReport?.matchId !== this.match.startedAt) {
      this.matchReport = createMatchReport(this.match, {
        hostId: this.playerId,
        gameMode: this.roomState.gameMode ?? null,
        roomName: this.roomState.roomName ?? this.roomState.name ?? null,
        players: this.getMatchReportPlayers(),
        monotonicNow,
      });
    }
    beginMatchReportFrame(this.matchReport, monotonicNow);
    return this.matchReport;
  }

  prepareMatchClientDiagnostics(monotonicNow) {
    if (!this.match || !Number.isFinite(this.match.startedAt) ||
        typeof this.playerId !== 'string' || this.playerId.length < 1) return null;
    if (this.matchClientDiagnostics?.matchId !== this.match.startedAt) {
      this.matchClientDiagnostics = createMatchClientDiagnostics(this.match, {
        playerId: this.playerId,
        hostId: this.roomState?.hostId ?? null,
        gameMode: this.roomState?.gameMode ?? null,
        roomName: this.roomState?.roomName ?? this.roomState?.name ?? null,
        monotonicNow,
      });
    }
    return this.matchClientDiagnostics;
  }

  finalizeMatchClientDiagnostics(match, now = Date.now()) {
    const diagnostics = this.matchClientDiagnostics;
    if (!completeMatchClientDiagnostics(diagnostics, match, { now })) return;
    const validation = validateMatchClientDiagnostics(diagnostics, diagnostics.matchId);
    if (!validation.valid) {
      console.error('[match-client-diagnostics] report cannot be uploaded', {
        matchId: diagnostics.matchId,
        playerId: diagnostics.playerId,
        reason: validation.reason,
      });
      return;
    }
    this.pendingMatchClientDiagnostics.push({ diagnostics, attempts: 0, retryAt: 0 });
    this.submitPendingMatchClientDiagnostics();
  }

  submitPendingMatchReport() {
    const pending = this.pendingMatchReports[0];
    if (!pending || this.matchReportUploadPending ||
        this.roomState?.hostId !== this.playerId ||
        Date.now() < pending.retryAt ||
        typeof this.roomClient?.request !== 'function') return;
    this.matchReportUploadPending = true;
    this.roomClient.request('match:report', { report: pending.report })
      .then((result) => {
        if (this.pendingMatchReports[0] === pending) this.pendingMatchReports.shift();
        console.info('[match-report] stored', {
          matchId: pending.report.matchId,
          reportId: result?.reportId ?? null,
          stored: result?.stored ?? false,
        });
      })
      .catch((error) => {
        pending.attempts += 1;
        pending.retryAt = Date.now() + Math.min(30_000, 1_000 * (2 ** Math.min(pending.attempts, 5)));
        console.error('[match-report] upload failed; will retry', {
          matchId: pending.report.matchId,
          attempts: pending.attempts,
          message: error instanceof Error ? error.message : 'Unknown upload error.',
        });
      })
      .finally(() => {
        this.matchReportUploadPending = false;
      });
  }

  submitPendingMatchClientDiagnostics() {
    const pending = this.pendingMatchClientDiagnostics[0];
    if (!pending || this.matchClientDiagnosticsUploadPending ||
        typeof this.roomClient?.request !== 'function' ||
        Date.now() < pending.retryAt) return;
    this.matchClientDiagnosticsUploadPending = true;
    this.roomClient.request('match:client-report', { diagnostics: pending.diagnostics })
      .then((result) => {
        if (this.pendingMatchClientDiagnostics[0] === pending) {
          this.pendingMatchClientDiagnostics.shift();
        }
        console.info('[match-client-diagnostics] stored', {
          matchId: pending.diagnostics.matchId,
          playerId: pending.diagnostics.playerId,
          reportId: result?.reportId ?? null,
          clientCount: result?.clientCount ?? null,
        });
      })
      .catch((error) => {
        pending.attempts += 1;
        pending.retryAt = Date.now() + Math.min(30_000, 1_000 * (2 ** Math.min(pending.attempts, 5)));
        console.error('[match-client-diagnostics] upload failed; will retry', {
          matchId: pending.diagnostics.matchId,
          playerId: pending.diagnostics.playerId,
          attempts: pending.attempts,
          message: error instanceof Error ? error.message : 'Unknown error.',
        });
      })
      .finally(() => {
        this.matchClientDiagnosticsUploadPending = false;
      });
  }

  isPostGameFreeRoam(match = this.match, roomState = this.roomState) {
    if (!match?.victory) return false;
    const now = Date.now();
    const quickPlay = match.quickPlayState ?? roomState?.quickPlayState;
    if (quickPlay) {
      if (quickPlay.phase === 'round-result') {
        return now < quickPlay.phaseEndsAt || roomState?.quickPlayMapGenerationPending === true;
      }
      return quickPlay.phase === 'series-report' && now < quickPlay.phaseEndsAt;
    }
    return Boolean(match.postGame && now < match.postGame.endsAt);
  }

  updateFrame(time, delta) {
    if (this.networkSuspended) return;
    this.retryPendingWeaponActions(Date.now());
    this.retryHostMapSubmission(Date.now());
    const frameOverlaysStartedAt = performance.now();
    const updateProfile = getAdaptiveUpdateProfile(this.computationLevel);
    if (frameOverlaysStartedAt - this.lastFrameOverlayUpdateAt >= updateProfile.frameOverlayIntervalMs) {
      this.lastFrameOverlayUpdateAt = frameOverlaysStartedAt;
      this.measureUpdatePhase('frameOverlays.hitMarker', () => this.drawHitMarkerAtAimPoint());
      this.measureUpdatePhase('frameOverlays.audioCues', () => this.drawAudioCues());
      this.measureUpdatePhase('frameOverlays.pings', () => this.drawPings());
      this.measureUpdatePhase('frameOverlays.damageIndicators', () => this.drawDamageIndicators());
      this.measureUpdatePhase('frameOverlays.smoke', () => this.drawSmokeClouds());
      this.measureUpdatePhase('frameOverlays.flashEffects', () => this.drawFlashEffects());
    }
    this.recordUpdatePhase('frameOverlays', frameOverlaysStartedAt);
    if (!this.match) return;
    this.updateMatchHudTimer();
    const postGameFreeRoam = this.isPostGameFreeRoam();
    if (this.match.victory && !postGameFreeRoam) {
      this.aimGraphics.clear();
      this.gadgetAimGraphics.clear();
      if (this.roomState?.hostId === this.playerId) this.publishHostFrameMeasured();
      return;
    }
    const countdownRemaining = postGameFreeRoam ? 0
      : (this.match.gameplayStartsAt ?? 0) + GAMEPLAY_START_SAFETY_MS - Date.now();
    if (countdownRemaining > 0) {
      const seconds = Math.ceil(countdownRemaining / 1000);
      this.fireHeld = false;
      this.lastControlFireHeld = false;
      this.lastSemiAutoFirePress = this.firePressSequence;
      this.publishHud({ status: `ROUND STARTING · ${seconds}` });
      this.aimGraphics.clear();
      this.gadgetAimGraphics.clear();
      const localPlayer = this.players.get(this.getActivePlayerId());
      if (localPlayer?.alive) {
        this.updateGadgetHud(localPlayer);
        this.updateLocalAim(time, delta, localPlayer);
        localPlayer.visionAngle = this.localVisionAngle;
      }
      let phaseStartedAt = performance.now();
      this.updateGlobalIntel();
      this.recordUpdatePhase('vision', phaseStartedAt);
      if (this.roomState?.hostId === this.playerId) this.publishHostFrameMeasured();
      phaseStartedAt = performance.now();
      this.renderPlayers();
      this.recordUpdatePhase('players', phaseStartedAt);
      return;
    }
    const activePlayerId = this.getActivePlayerId();
    const localPlayer = this.players.get(activePlayerId);
    const simulation = this.roomState?.simulation;
    const isMovementAuthority = simulation?.mode === 'host-authoritative' &&
      simulation.authorityId === this.playerId;
    if (this.hudState.status.startsWith('ROUND STARTING')) this.publishHud({ status: '' });
    this.weaponLeanState = updateWeaponLeanState(this.weaponLeanState, {
      qDown: this.keys.Q.isDown,
      eDown: this.keys.E.isDown,
    }, time);
    this.weaponLean = this.weaponLeanState.currentLean;
    const input = this.readLocalInput();
    if (postGameFreeRoam) input.drop = false;
    if (localPlayer?.alive && (!this.match.victory || postGameFreeRoam)) {
      this.updateLocalAim(time, delta, localPlayer);
    }
    input.visionAngle = this.localVisionAngle;
    input.aimAngle = this.localAimAngle ??
      localPlayer?.weaponStats?.[localPlayer.selectedWeaponId ?? 'assault-rifle']?.aimAngle ?? 0;
    let signature = `${Number(input.up)}${Number(input.down)}${Number(input.left)}${Number(input.right)}${Number(input.drop)}${input.weaponLean}${input.speedScale}`;
    const elapsedMs = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    const fixedSteps = consumeFixedSteps(this.simulationAccumulatorMs, elapsedMs);
    this.simulationAccumulatorMs = fixedSteps.accumulatorMs;
    let phaseStartedAt = performance.now();
    // Keep a slow AI pass from running again during catch-up steps in this frame.
    let botUpdateInvokedThisFrame = false;
    for (let step = 0; step < fixedSteps.steps; step += 1) {
      if (isMovementAuthority) {
        const hostMovementStartedAt = performance.now();
        this.advanceHostMovement(SIMULATION_STEP_MS / 1000);
        this.recordUpdatePhase('simulation.hostMovement', hostMovementStartedAt);
        if (this.botUpdateHandler && !botUpdateInvokedThisFrame) {
          botUpdateInvokedThisFrame = true;
          const botUpdateStartedAt = performance.now();
          this.recordBotUpdateProfile(this.botUpdateHandler());
          this.recordUpdatePhase('simulation.botAI', botUpdateStartedAt);
        }
      }
    }
    recordMatchReportWork(this.matchReport, 'simulation.fixedSteps', fixedSteps.steps);

    const localSimulationStartedAt = performance.now();
    if (localPlayer?.alive) {
      const selectedWeapon = this.getSelectedWeapon(localPlayer);
      const localWeaponState = localPlayer.weaponStats?.[selectedWeapon.id];
      if (localWeaponState) {
        const advanced = advanceWeaponState(
          localWeaponState, selectedWeapon, Date.now(), Math.hypot(localPlayer.vx ?? 0, localPlayer.vy ?? 0),
        );
        this.playReloadSoundEvents(localPlayer, selectedWeapon, localWeaponState, advanced);
        localPlayer.weaponStats[selectedWeapon.id] = advanced;
      }
      localPlayer.input = input;
      localPlayer.weaponLean = this.weaponLean;
      localPlayer.visionAngle = this.localVisionAngle;
      const weapon = this.getSelectedWeapon(localPlayer);
      const gadgetMovementScale = getGadgetMovementScale(localPlayer, this.match.gadgetEffects);
      const movementScale = getPlayerMovementScale(
        !postGameFreeRoam && this.match.flag?.heldBy === localPlayer.id,
        weapon.movementScale,
        getInventoryEffects(localPlayer.inventory).movementBonus,
      ) * gadgetMovementScale;
      const inputChanged = signature !== this.lastInputSignature;
      const shouldSendOwnerState = !this.controlledBotId && !isMovementAuthority &&
        (time - this.lastInputAt >= INPUT_INTERVAL_MS || inputChanged);
      if (shouldSendOwnerState) this.lastInputAt = time;
      this.lastInputSignature = signature;
      if (!this.controlledBotId) {
        localPlayer.lastInputSequence = Math.max(
          localPlayer.lastInputSequence ?? 0, this.lastInputSequenceSent ?? 0,
        );
        localPlayer.inputSequence = localPlayer.lastInputSequence;
      }
      for (let step = 0; step < fixedSteps.steps; step += 1) {
        const now = Date.now();
        const nextPosition = movePositionWithCatchUp(
          localPlayer,
          input,
          SIMULATION_STEP_MS / 1000,
          this.mapWidth,
          this.mapHeight,
          this.mapObjects,
          movementScale,
          gadgetMovementScale > 1 ? movementScale : 1.15,
        );
        const tether = (this.match.gadgetEffects ?? []).find((effect) =>
          effect.type === VINE_TRAP_ID && effect.latchedEnemyId === localPlayer.id && effect.activeUntil > now);
        Object.assign(localPlayer, constrainPositionToRadius(
          nextPosition, tether, tether?.triggerRadius ?? tether?.radius,
        ));
      }
      if (shouldSendOwnerState) {
        const sequence = this.localInputSequence + 1;
        const sent = this.roomClient.send('game:input', {
          matchId: this.match.startedAt,
          sequence,
          input,
          playerPose: {
            id: localPlayer.id,
            x: localPlayer.x,
            y: localPlayer.y,
            vx: localPlayer.vx ?? 0,
            vy: localPlayer.vy ?? 0,
          },
        });
        if (sent) {
          this.localInputSequence = sequence;
          this.lastInputSequenceSent = sequence;
          localPlayer.lastInputSequence = sequence;
          localPlayer.inputSequence = sequence;
        }
      }
      if (isMovementAuthority && Phaser.Input.Keyboard.JustDown(this.keys.F)) this.dropHostFlag(localPlayer);
      if (isMovementAuthority && this.match.flag?.heldBy === localPlayer.id) {
        this.match.flag.x = localPlayer.x;
        this.match.flag.y = localPlayer.y;
      }
      if (!this.match.victory || postGameFreeRoam) {
        this.updateGadgetHud(localPlayer);
        localPlayer.visionAngle = this.localVisionAngle;
        const keyboardReloadPressed = Phaser.Input.Keyboard.JustDown(this.keys.R);
        if (this.controlledBotId) {
          this.reloadKeyPending = false;
          const botWeapon = this.getSelectedWeapon(localPlayer);
          const botWeaponState = localPlayer.weaponStats?.[botWeapon.id];
          if (botWeaponState?.reloading) this.botReloadPendingUntil = 0;
          const reloadPressed = Date.now() < this.botReloadPendingUntil;
          const semiAutoShotPending = hasPendingSemiAutoShot(
            botWeapon, this.firePressSequence, this.lastSemiAutoFirePress,
          );
          const fireChanged = this.fireHeld !== this.lastControlFireHeld;
          const aimSyncDue = time - this.lastAimSentAt >= AIM_SYNC_INTERVAL_MS;
          if (inputChanged || fireChanged || aimSyncDue || time - this.lastInputAt >= INPUT_INTERVAL_MS ||
              reloadPressed || semiAutoShotPending) {
            if (this.sendBotControl(time, input, localPlayer, reloadPressed)) {
              this.lastInputAt = time;
              this.lastInputSignature = signature;
              this.lastControlFireHeld = this.fireHeld;
              this.lastAimSentAt = time;
            }
          }
        } else {
          const reloadPressed = this.reloadKeyPending || keyboardReloadPressed;
          this.reloadKeyPending = false;
          if (this.getEquippedSlot(localPlayer) === 'weapon' &&
              !this.isGadgetSwitching(localPlayer) && reloadPressed) {
            this.sendWeaponAction('game:reload', 'reload', {}, this.getSelectedWeapon(localPlayer), localPlayer);
          }
        }
        if (!this.controlledBotId) this.fireRifle(time, localPlayer);
        this.drawAimGuides(localPlayer);
      } else {
        this.aimGraphics.clear();
      }
    } else {
      this.aimGraphics.clear();
    }
    this.recordUpdatePhase('simulation.localPlayer', localSimulationStartedAt);

    const remoteSimulationStartedAt = performance.now();
    for (const player of this.players.values()) {
      if (player.id === activePlayerId) continue;
      if (isMovementAuthority) {
        const correction = decayRenderCorrection(
          { x: player.renderOffsetX ?? 0, y: player.renderOffsetY ?? 0 }, delta, 55,
        );
        player.renderOffsetX = correction.x;
        player.renderOffsetY = correction.y;
        continue;
      }
      // Remote positions come from host-produced frames; local collision
      // geometry must not reject or redirect snapshot corrections.
      Object.assign(player, interpolatePosition(player, { x: player.targetX, y: player.targetY }, delta, 25));
    }
    this.recordUpdatePhase('simulation.remotePlayers', remoteSimulationStartedAt);
    this.recordUpdatePhase('simulation', phaseStartedAt);

    phaseStartedAt = performance.now();
    this.updateGlobalIntel();
    this.recordUpdatePhase('vision', phaseStartedAt);
    if (isMovementAuthority) {
      this.collectHostFootstepAudioCues(Date.now());
      this.publishHostFrameMeasured();
    }
    phaseStartedAt = performance.now();
    this.renderPlayers();
    this.recordUpdatePhase('players', phaseStartedAt);
  }

  recordComputationTime(elapsedMs, gameTime) {
    this.smoothedComputationMs = smoothComputationTime(this.smoothedComputationMs, elapsedMs);
    this.computationLevel = getComputationLevel(this.smoothedComputationMs);
    if (gameTime - this.lastComputationLabelAt < 250) return;
    this.lastComputationLabelAt = gameTime;
    this.publishHud({
      computation: `CLIENT COMPUTE ${this.computationLevel}`,
      computationLevel: this.computationLevel,
      computationMs: this.smoothedComputationMs,
      frameDeltaMs: this.smoothedFrameDeltaMs,
      computationPhases: { ...this.smoothedUpdatePhases },
    });
  }

  recordUpdatePhase(phase, startedAt) {
    const durationMs = performance.now() - startedAt;
    if (this.currentUpdateTrace) {
      this.currentUpdateTrace.phaseDurations[phase] =
        (this.currentUpdateTrace.phaseDurations[phase] ?? 0) + durationMs;
    }
    this.smoothedUpdatePhases[phase] = smoothComputationTime(
      this.smoothedUpdatePhases[phase],
      durationMs,
      0.2,
    );
    recordMatchReportPhase(this.matchReport, phase, durationMs);
    recordMatchClientPhase(this.matchClientDiagnostics, phase, durationMs);
  }

  recordBotUpdateProfile(profile) {
    if (!this.currentUpdateTrace || !profile ||
        !Number.isSafeInteger(profile.decisionCount) || profile.decisionCount < 0 ||
        !Number.isFinite(profile.totalDecisionMs) || profile.totalDecisionMs < 0 ||
        !Array.isArray(profile.slowestDecisions)) return;
    const botProfile = this.currentUpdateTrace.botProfile;
    botProfile.decisionCount += profile.decisionCount;
    botProfile.totalDecisionMs += profile.totalDecisionMs;
    botProfile.slowestDecisions = [...botProfile.slowestDecisions, ...profile.slowestDecisions]
      .filter((decision) => typeof decision?.botId === 'string' &&
        Number.isFinite(decision.durationMs) && decision.durationMs >= 0)
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 8);
  }

  measureUpdatePhase(phase, callback) {
    const startedAt = performance.now();
    try {
      return callback();
    } finally {
      this.recordUpdatePhase(phase, startedAt);
    }
  }

  recordClientHostFrameActivity(metrics) {
    recordMatchClientHostFrame(this.matchClientDiagnostics, metrics);
  }

  recordClientHeartbeat(metrics) {
    recordMatchClientHeartbeat(this.matchClientDiagnostics, metrics);
  }

  recordClientConnectionState(state) {
    recordMatchClientConnection(this.matchClientDiagnostics, state);
  }

  publishHostFrameMeasured() {
    const previousRevision = this.hostFrameRevision;
    const startedAt = performance.now();
    this.publishHostFrame();
    if (this.hostFrameRevision !== previousRevision) {
      this.recordUpdatePhase('hostTx', startedAt);
    }
  }

  updateGadgetHud(player) {
    const equippedSlot = player?.alive ? this.getEquippedSlot(player) : null;
    const selectedGadgetId = player?.selectedGadgetId ?? null;
    const now = Date.now();
    const storedGadgetCount = selectedGadgetId
      ? player?.gadgetCounts?.[selectedGadgetId] ?? player?.gadgetCount ?? 0 : 0;
    const ownedTrophy = selectedGadgetId === TROPHY_SYSTEM_ID
      ? this.getOwnedTrophySystem(player, now)
      : null;
    const ownedSpyCamera = selectedGadgetId === SPY_CAMERA_ID
      ? (this.match?.gadgetEffects ?? []).find((effect) =>
        effect.type === SPY_CAMERA_ID && effect.ownerId === player?.id &&
        effect.startedAt <= now && effect.expiresAt > now && (effect.health ?? 1) > 0)
      : null;
    const trophyCommandJammed = Boolean(ownedTrophy &&
      (isPlayerJammed(player, now) || isGadgetJammed(ownedTrophy, now)));
    const gadgetCount = ownedTrophy
      ? !trophyCommandJammed && now >= (player?.trophyCommandReadyAt ?? 0) ? 1 : 0
      : storedGadgetCount;
    const gadgetStatusText = selectedGadgetId === TROPHY_SYSTEM_ID &&
      storedGadgetCount <= 0 && !ownedTrophy
      ? 'Trophy system destroyed'
      : trophyCommandJammed
        ? 'Trophy system jammed'
        : getSpyCameraBatteryStatus(ownedSpyCamera, now);
    const switching = Boolean(player?.alive && this.isGadgetSwitching(player));
    const switchRemainingMs = switching
      ? Math.ceil(Math.max(0, player.gadgetSwitchEndsAt - Date.now()) / 100) * 100
      : 0;
    const gadgetCooldownRemainingMs = selectedGadgetId === TROPHY_SYSTEM_ID && ownedTrophy
      ? Math.ceil(Math.max(0, (player?.trophyCommandReadyAt ?? 0) - now) / 100) * 100
      : selectedGadgetId === ORBITAL_STRIKE_ID
      ? Math.ceil(Math.max(0, player?.orbitalStrikeCooldownRemainingMs ?? 0) / 100) * 100
      : selectedGadgetId === VINE_TRAP_ID
        ? Math.ceil(Math.max(0, (player?.vineTrapRechargeAt ?? 0) - Date.now()) / 100) * 100
        : selectedGadgetId === SONAR_ID
          ? Math.ceil(getSonarRechargeRemainingMs(player) / 100) * 100
          : selectedGadgetId === KATANA_ID
            ? Math.ceil(getKatanaRechargeRemainingMs(player) / 100) * 100
            : selectedGadgetId === JAMMER_GRENADE_ID
              ? Math.ceil(getPerChargeGadgetRechargeRemainingMs(player, JAMMER_GRENADE_ID) / 100) * 100
              : selectedGadgetId === BIO_FIELD_ID
                ? Math.ceil(getPerChargeGadgetRechargeRemainingMs(player, BIO_FIELD_ID) / 100) * 100
                : 0;
    if (equippedSlot !== this.hudState.equippedSlot || selectedGadgetId !== this.hudState.selectedGadgetId ||
        gadgetCount !== this.hudState.gadgetCount || switching !== this.hudState.switching ||
        switchRemainingMs !== this.hudState.switchRemainingMs ||
        gadgetCooldownRemainingMs !== this.hudState.gadgetCooldownRemainingMs ||
        gadgetStatusText !== this.hudState.gadgetStatusText) {
      this.publishHud({
        equippedSlot,
        selectedGadgetId,
        gadgetCount,
        switching,
        switchRemainingMs,
        gadgetCooldownRemainingMs,
        gadgetStatusText,
      });
    }
  }

  updateLocalAim(time, delta, localPlayer) {
    const pointer = this.input.activePointer;
    if (!this.aimWorldPoint && pointer) this.updateAimPointer(pointer);
    const aimPoint = this.aimWorldPoint;
    if (!aimPoint || !Number.isFinite(aimPoint.x) || !Number.isFinite(aimPoint.y) ||
      !Number.isFinite(localPlayer.x) || !Number.isFinite(localPlayer.y)) return;
    const targetAngle = getWeaponAimAngle(localPlayer, aimPoint, localPlayer.weaponLean, this.mapObjects);
    if (!Number.isFinite(targetAngle)) return;
    const weapon = this.getSelectedWeapon(localPlayer);
    if (!Number.isFinite(this.localAimAngle)) {
      const authoritativeAngle = localPlayer.weaponStats?.[weapon.id]?.aimAngle;
      this.localAimAngle = Number.isFinite(authoritativeAngle) ? authoritativeAngle : 0;
    }
    const elapsedSeconds = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 100) / 1000 : 0;
    this.localAimAngle = rotateAngleTowards(
      this.localAimAngle,
      targetAngle,
      getMaximumRotationRadiansPerSecond(weapon.rotationTimeMs) * elapsedSeconds *
        getGadgetWeaponTurnScale(localPlayer, this.match?.gadgetEffects),
    );
    this.localVisionAngle = targetAngle;
    const currentWeaponState = localPlayer.weaponStats?.[weapon.id];
    if (currentWeaponState) {
      currentWeaponState.aimAngle = this.localAimAngle;
      currentWeaponState.aimUpdatedAt = Date.now();
    }

  }

  sendWeaponAction(messageType, kind, payload, weapon, player) {
    const isRemoteOwner = this.roomState?.hostId !== this.playerId;
    if (isRemoteOwner && kind !== 'reload' && this.pendingWeaponActions.size >= MAX_PENDING_WEAPON_ACTIONS) {
      if (kind === 'fire') {
        this.logWeaponFireDiagnostic('client-pending-action-limit', {
          actorId: player.id,
          weaponId: weapon.id,
          pendingCount: this.pendingWeaponActions.size,
        });
      }
      return false;
    }
    const sequence = this.weaponActionSequence + 1;
    const action = { ...payload, sequence, kind, weaponId: weapon.id, at: Date.now() };
    const authoritativeOrPredicted = ensureWeaponState(
      player.weaponStats?.[weapon.id], weapon, action.at, player.inventory);
    const previous = isRemoteOwner && kind === 'fire'
      ? { ...authoritativeOrPredicted, cooldownEndsAt: 0 }
      : authoritativeOrPredicted;
    const result = applyWeaponAction(previous, weapon, action, Math.hypot(player.vx ?? 0, player.vy ?? 0));
    if (!result.accepted && kind !== 'reload') {
      if (kind === 'fire') {
        this.logWeaponFireDiagnostic('client-weapon-state-rejected', {
          actorId: player.id,
          weaponId: weapon.id,
          sequence,
          ammo: previous.ammo ?? null,
          reloading: Boolean(previous.reloading),
          cooldownRemainingMs: Math.max(0, (previous.cooldownEndsAt ?? 0) - action.at),
          manualActionRemainingMs: Math.max(0, (previous.manualActionEndsAt ?? 0) - action.at),
        });
      }
      return false;
    }
    const messagePayload = {
      ...payload,
      matchId: this.match?.startedAt,
      type: weapon.id,
      weaponId: weapon.id,
      actionSequence: sequence,
    };
    if (kind === 'fire') {
      messagePayload.shotAngle = result.state.predictedShotAngle;
      messagePayload.shotAngles = getPredictedPelletAngles(result.state.predictedShotAngle, weapon, sequence);
    }
    if (kind === 'fire') {
      messagePayload.weaponLean = player.weaponLean ?? this.weaponLean;
      messagePayload.playerPose = { x: player.x, y: player.y, vx: player.vx, vy: player.vy };
    }
    if (!this.roomClient.send(messageType, messagePayload)) {
      if (kind === 'fire') {
        this.logWeaponFireDiagnostic('client-send-failed', {
          actorId: player.id,
          weaponId: weapon.id,
          sequence,
        });
      }
      return false;
    }
    this.weaponActionSequence = sequence;
    if (isRemoteOwner) {
      this.pendingWeaponActions.set(sequence, {
        messageType,
        payload: messagePayload,
        action,
        sentAt: Date.now(),
        firstSentAt: Date.now(),
        attempts: 1,
        timeoutLogged: false,
      });
    }
    if (kind === 'fire') {
      this.logWeaponFireDiagnostic('client-shot-sent', {
        actorId: player.id,
        weaponId: weapon.id,
        sequence,
      }, 'info');
    }
    const isHostAuthority = this.roomState?.hostId === this.playerId;
    const hostFireAccepted = isHostAuthority && kind === 'fire'
      ? this.resolveHostFire(player, weapon, { ...messagePayload, actorId: player.id })
      : false;
    if (isHostAuthority && kind !== 'fire' && (kind === 'reload' || kind === 'aim')) {
      this.applyAuthorityAction({ ...messagePayload, type: messageType, actorId: player.id, localAuthority: true });
    }
    if (isHostAuthority && kind === 'fire' && !hostFireAccepted) {
      player.lastWeaponActionSequence = Math.max(player.lastWeaponActionSequence ?? 0, sequence);
    }
    if (result.accepted && (!isHostAuthority || kind !== 'fire')) {
      player.weaponStats = { ...player.weaponStats, [weapon.id]: result.state };
    }
    if (isRemoteOwner && result.accepted) {
      this.playReloadSoundEvents(player, weapon, authoritativeOrPredicted, result.state);
    }
    if (kind === 'fire') {
      this.lastShotAt = this.game?.loop?.time ?? this.lastShotAt;
      if (isRemoteOwner) {
        this.showPredictedShot(player, weapon, sequence, result.state.predictedShotAngle,
          messagePayload.shotAngles);
      }
    }
    return true;
  }

  retryPendingWeaponActions(now) {
    if (this.roomState?.hostId === this.playerId || !this.match) return;
    for (const [sequence, pending] of this.pendingWeaponActions) {
      if (pending.timeoutLogged || now - pending.firstSentAt < 1_000) continue;
      pending.timeoutLogged = true;
      this.logWeaponFireDiagnostic('client-shot-unacknowledged', {
        actorId: this.getActivePlayerId(),
        weaponId: pending.action.weaponId,
        sequence,
        attempts: pending.attempts,
        ageMs: now - pending.firstSentAt,
      });
    }
    retryWeaponActions(this.pendingWeaponActions, now,
      (messageType, payload) => this.roomClient.send(messageType, payload));
  }

  logWeaponFireDiagnostic(reason, details = {}) {
    if (!WEAPON_FIRE_ERROR_REASONS.has(reason)) return;
    const now = Date.now();
    const actorId = details.actorId ?? this.playerId;
    const weaponId = details.weaponId ?? 'unknown';
    const key = `${actorId}:${weaponId}:${reason}`;
    if (now - (this.weaponFireDiagnosticLogAt.get(key) ?? -Infinity) < 1_000) return;
    this.weaponFireDiagnosticLogAt.set(key, now);
    console.error('[weapon-fire]', {
      side: this.roomState?.hostId === this.playerId ? 'host' : 'client',
      reason,
      actorId,
      weaponId,
      hostId: this.roomState?.hostId ?? null,
      matchId: this.match?.startedAt ?? null,
      ...details,
    });
  }

  logGadgetActionDiagnostic(reason, player, action = {}, details = {}) {
    if (!GADGET_ACTION_ERROR_REASONS.has(reason)) return;
    const now = Date.now();
    const actorId = action.actorId ?? player?.id ?? this.playerId;
    const gadgetId = player?.selectedGadgetId ?? action.target?.gadgetId ?? 'unknown';
    const key = `${actorId}:${gadgetId}:${action.action ?? 'unknown'}:${reason}`;
    if (now - (this.gadgetActionDiagnosticLogAt.get(key) ?? -Infinity) < 1_000) return;
    this.gadgetActionDiagnosticLogAt.set(key, now);
    console.error('[gadget-action]', {
      side: this.roomState?.hostId === this.playerId ? 'host' : 'client',
      reason,
      actorId,
      gadgetId,
      action: action.action ?? null,
      sequence: action.actionSequence ?? null,
      equippedSlot: player?.equippedSlot ?? null,
      gadgetCount: player?.gadgetCounts?.[gadgetId] ?? player?.gadgetCount ?? null,
      hostId: this.roomState?.hostId ?? null,
      matchId: this.match?.startedAt ?? null,
      ...details,
    });
  }

  getPredictedWeaponStats(playerId) {
    return this.players.get(playerId)?.weaponStats ?? null;
  }

  getRoomStateForSimulation(fallback = null) {
    const scene = this.scene;
    if (!scene?.match || scene.roomState?.hostId !== scene.playerId) return fallback;
    const match = { ...scene.match, players: [...scene.players.values()] };
    return {
      ...(scene.roomState ?? fallback ?? {}),
      match,
    };
  }

  sendBotControl(time, input, bot, reloadPressed) {
    if (!bot || !this.controlledBotId) return false;
    if (!Number.isFinite(this.localAimAngle)) {
      this.localAimAngle = bot.weaponStats?.[bot.selectedWeaponId ?? 'assault-rifle']?.aimAngle ?? 0;
    }
    const sequence = Math.max(this.botControlSequence, bot.inputSequence ?? 0) + 1;
    const weapon = this.getSelectedWeapon(bot);
    const pendingSemiAutoShot = hasPendingSemiAutoShot(
      weapon, this.firePressSequence, this.lastSemiAutoFirePress,
    );
    const fireRequested = weapon.semiAuto ? pendingSemiAutoShot : this.fireHeld;
    const weaponState = bot.weaponStats?.[weapon.id] ?? {
      accuracy: weapon.accuracy.startingAccuracy,
      effectiveAccuracy: weapon.accuracy.startingAccuracy,
      ammo: weapon.magazineSize ?? null,
      aimAngle: this.localAimAngle,
      aimUpdatedAt: Date.now(),
      reloading: false,
      shotsFired: 0,
    };
    weaponState.aimAngle = this.localAimAngle;
    weaponState.aimUpdatedAt = Date.now();
    const kind = reloadPressed ? 'reload' : fireRequested ? 'fire' : null;
    const action = kind ? {
      kind,
      sequence: getNextBotActionSequence(this.botActionSequence, bot.lastWeaponActionSequence),
      weaponId: weapon.id,
      at: Date.now(),
      direction: { x: Math.cos(this.localAimAngle), y: Math.sin(this.localAimAngle) },
    } : null;
    const actionSequence = action?.sequence;
    const predicted = action
      ? applyWeaponAction(weaponState, weapon, action, Math.hypot(bot.vx ?? 0, bot.vy ?? 0))
      : null;
    const shouldReload = Boolean(reloadPressed);
    const shouldFire = Boolean(!reloadPressed && fireRequested && predicted?.accepted);
    const fireCommand = Boolean(!reloadPressed && fireRequested &&
      (!weapon.semiAuto || predicted?.accepted));
    const command = {
      botId: bot.id,
      sequence,
      controlRevision: bot.controlRevision ?? 0,
      weaponId: weapon.id,
      input: {
        ...input,
        aimAngle: this.localAimAngle,
        visionAngle: this.localVisionAngle,
      },
      direction: { x: Math.cos(this.localAimAngle), y: Math.sin(this.localAimAngle) },
      fire: fireCommand,
      reload: shouldReload,
      ...(fireCommand || shouldReload ? { actionSequence } : {}),
      playerPose: { id: bot.id, x: bot.x, y: bot.y, vx: bot.vx, vy: bot.vy },
      ...(fireCommand ? {
        shotAngle: predicted?.state?.predictedShotAngle ?? weaponState.predictedShotAngle ?? this.localAimAngle,
        shotAngles: getPredictedPelletAngles(
          predicted?.state?.predictedShotAngle ?? weaponState.predictedShotAngle ?? this.localAimAngle,
          weapon,
          actionSequence,
        ),
      } : {}),
    };
    if (predicted && !predicted.accepted && pendingSemiAutoShot) {
      this.lastSemiAutoFirePress = this.firePressSequence;
    }
    if (this.roomState?.hostId === this.playerId) {
      this.applyAuthorityBots({
        matchId: this.match.startedAt,
        commands: [command],
        sourceClientId: this.playerId,
      });
      this.botControlSequence = sequence;
      this.botActionSequence = Math.max(this.botActionSequence, bot.lastWeaponActionSequence ?? 0);
      if (shouldReload) this.botReloadPendingUntil = 0;
      if (pendingSemiAutoShot && (shouldFire || shouldReload)) {
        this.lastSemiAutoFirePress = this.firePressSequence;
      }
      return true;
    }
    if (!this.roomClient.send('game:bots', { matchId: this.match.startedAt, commands: [command] })) return false;
    this.botControlSequence = sequence;
    if (fireCommand || shouldReload) this.botActionSequence = actionSequence;
    if (predicted?.accepted) {
      bot.weaponStats = { ...bot.weaponStats, [weapon.id]: predicted.state };
      if (shouldFire) this.showPredictedShot(bot, weapon, sequence, predicted.state.predictedShotAngle,
        command.shotAngles);
    }
    if (shouldReload) this.botReloadPendingUntil = 0;
    if (pendingSemiAutoShot && (shouldFire || shouldReload)) {
      this.lastSemiAutoFirePress = this.firePressSequence;
    }
    return true;
  }

  sendBotGadgetAction(action, bot, target = null) {
    if (!bot || !this.controlledBotId || !this.match) return false;
    const now = Date.now();
    if (action === 'switch' && now < (this.match.gameplayStartsAt ?? 0)) {
      this.logGadgetActionDiagnostic('client-switch-blocked-gameplay-not-started', bot, { action });
      return false;
    }
    const switchingToGadget = action === 'switch' && this.getEquippedSlot(bot) !== 'gadget';
    const trophyForSwitch = switchingToGadget && bot.selectedGadgetId === TROPHY_SYSTEM_ID
      ? this.getOwnedTrophySystem(bot, now)
      : null;
    if (trophyForSwitch && (isPlayerJammed(bot, now) || isGadgetJammed(trophyForSwitch, now))) {
      this.logGadgetActionDiagnostic('host-switch-rejected-trophy-command-jammed', bot, { action });
      return false;
    }
    const isTrophyCommand = action === 'use' && bot.selectedGadgetId === TROPHY_SYSTEM_ID &&
      Boolean(this.getOwnedTrophySystem(bot));
    const sequence = Math.max(this.botControlSequence, bot.inputSequence ?? 0) + 1;
    const actionSequence = getNextBotActionSequence(this.botActionSequence, bot.lastWeaponActionSequence);
    const command = {
      botId: bot.id,
      sequence,
      controlRevision: bot.controlRevision ?? 0,
      input: {
        ...this.readLocalInput(),
        aimAngle: this.localAimAngle ?? 0,
        visionAngle: this.localVisionAngle,
      },
      direction: { x: Math.cos(this.localAimAngle ?? 0), y: Math.sin(this.localAimAngle ?? 0) },
      fire: false,
      reload: false,
      playerPose: { id: bot.id, x: bot.x, y: bot.y, vx: bot.vx ?? 0, vy: bot.vy ?? 0 },
      gadgetAction: {
        action,
        actionSequence,
        ...(target ? { target: { x: target.x, y: target.y } } : {}),
      },
    };
    if (this.roomState?.hostId === this.playerId) {
      this.applyAuthorityBots({
        matchId: this.match.startedAt,
        commands: [command],
        sourceClientId: this.playerId,
      });
      this.botControlSequence = sequence;
      this.botActionSequence = Math.max(this.botActionSequence, bot.lastWeaponActionSequence ?? 0);
      if (action === 'use') this.gadgetUsePendingUntil = Date.now() + 1_000;
      return true;
    }
    if (!this.roomClient.send('game:bots', { matchId: this.match.startedAt, commands: [command] })) return false;
    this.botControlSequence = sequence;
    this.botActionSequence = actionSequence;
    this.pendingGadgetSequence = actionSequence;
    if (action === 'switch') beginGadgetSwitch(bot, Date.now());
    else {
      this.gadgetUsePendingUntil = Date.now() + 1_000;
      const isKatana = bot.selectedGadgetId === KATANA_ID;
      if (isKatana) {
        const dash = calculateKatanaDash(bot, target, this.mapObjects, this.mapWidth, this.mapHeight);
        if (dash) Object.assign(bot, { x: dash.end.x, y: dash.end.y, vx: 0, vy: 0 });
      }
      if (isTrophyCommand) {
        const infiniteGadgetUse = this.isInfiniteGadgetUseEnabled();
        bot.trophyCommandReadyAt = Date.now() +
          (infiniteGadgetUse ? 0 : TROPHY_SYSTEM_COMMAND_COOLDOWN_MS);
        bot.equippedSlot = 'weapon';
        bot.gadgetSwitchStartedAt = null;
        bot.gadgetSwitchEndsAt = null;
        bot.gadgetSwitchTargetSlot = null;
      } else {
        consumeSelectedGadget(bot, { infiniteUse: this.isInfiniteGadgetUseEnabled() });
      }
      if (isKatana && !this.isInfiniteGadgetUseEnabled()) queueKatanaChargeRecharge(bot);
    }
    return true;
  }

  showPredictedShot(player, weapon, sequence, shotAngle, shotAngles) {
    if (!Number.isSafeInteger(sequence) || !Number.isFinite(shotAngle) || !Array.isArray(shotAngles)) return;
    const key = `${player.id}:${sequence}`;
    this.predictedShotPellets.set(key, shotAngles.length);
    const baseAngle = this.localAimAngle ?? shotAngle;
    const origin = getWeaponMuzzlePosition(
      player, baseAngle, player.weaponLean, this.mapObjects,
    );
    for (let index = 0; index < shotAngles.length; index += 1) {
      const angle = shotAngles[index];
      const end = this.getAimRayEnd(origin, angle, weapon.range, weapon.radius);
      this.showProjectile({
        id: `predicted-${key}-${index}`,
        ownerId: player.id,
        ownerActionSequence: sequence,
        pelletIndex: index,
        predicted: true,
        start: origin,
        end,
        type: weapon.id,
        aimAngle: baseAngle,
        speed: weapon.speed,
      });
    }
    if (this.predictedShotPellets.size > 256) {
      this.predictedShotPellets.delete(this.predictedShotPellets.keys().next().value);
    }
  }

  ensureIntelState(matchId) {
    if (this.intelMatchId === matchId && this.exploredCells) return;
    this.intelMatchId = matchId;
    this.intelColumns = Math.ceil(this.mapWidth / VISION_MEMORY_CELL_SIZE);
    this.intelRows = Math.ceil(this.mapHeight / VISION_MEMORY_CELL_SIZE);
    this.exploredCells = new Uint8Array(this.intelColumns * this.intelRows);
    this.exploredWallIds = new Set();
    this.knownCorpseIds.clear();
    this.corpseIntelTeam = null;
    this.currentVisions = [];
    this.smokeVisibilityCache.clear();
    this.rememberedSmokes.clear();
    this.visionCacheByPlayer.clear();
    this.visionInputCacheByPlayer.clear();
    this.spyCameraVisionCache.clear();
    this.sonarVisionCache.clear();
    this.exploredWallObjects.clear();
    this.pendingWallIntel.clear();
    this.lastWallIntelSendAt = -Infinity;
    this.postGameIntelRevealed = false;
    this.playerVisibilityCache.clear();
    this.lastVisionUpdateAt = -Infinity;
    this.lastVisionMemoryAt = -Infinity;
    this.visionRefreshAtByPlayer.clear();
    this.rememberedWallGraphics?.clear();
    this.initializeFogTexture(matchId);
    this.initializeVisionTexture(matchId);
    this.roomClient.send('game:intel:sync');
  }

  updateGlobalIntel() {
    const localTeam = this.getLocalTeam();
    if (!this.match || !this.exploredCells) return;
    if (this.isPostGameFreeRoam()) {
      if (this.postGameIntelRevealed) return;
      this.postGameIntelRevealed = true;
      this.exploredCells.fill(1);
      this.currentVisions = [];
      this.visionCacheByPlayer.clear();
      this.visionInputCacheByPlayer.clear();
      this.spyCameraVisionCache.clear();
      this.playerVisibilityCache.clear();
      this.playerVisibilityCacheTime = performance.now();
      this.clearVisionOverlay();
      this.drawVisibleProps(true);
      // Hide the overlay rather than clearing and re-uploading its 1500×1000 canvas.
      this.fogImage?.setVisible(false);
      return;
    }
    if (this.match.victory) return;
    const now = performance.now();
    const flashNow = Date.now();
    if (!localTeam) {
      this.currentVisions = [];
      this.smokeVisibilityCache.clear();
      this.rememberedSmokes.clear();
      this.visionCacheByPlayer.clear();
      this.visionInputCacheByPlayer.clear();
      this.spyCameraVisionCache.clear();
      this.visionRefreshAtByPlayer.clear();
      this.clearVisionOverlay();
      this.drawVisibleProps(true);
      return;
    }

    let visionPhaseStartedAt = performance.now();
    this.publishPendingWallIntel(flashNow);
    const visionObjects = this.getVisionObjects();
    const activePlayerId = this.getActivePlayerId();
    const activePlayer = this.players.get(activePlayerId);
    const activePlayerJammed = isPlayerJammed(activePlayer, flashNow);
    const liveVisionPlayers = [...this.players.values()].filter((player) =>
      player.alive && player.team === localTeam && Number.isFinite(player.x) && Number.isFinite(player.y));
    const distanceFromActivePlayer = (player) => activePlayer
      ? Math.hypot(player.x - activePlayer.x, player.y - activePlayer.y)
      : Infinity;
    const orderedTeammates = liveVisionPlayers
      .filter((player) => player.id !== activePlayerId && !activePlayerJammed &&
        !isPlayerJammed(player, flashNow))
      .sort((left, right) => distanceFromActivePlayer(left) - distanceFromActivePlayer(right) ||
        left.id.localeCompare(right.id));
    const teammateRanks = new Map(orderedTeammates.map((player, rank) => [player.id, rank]));
    const orderedVisionPlayers = [
      ...liveVisionPlayers.filter((player) => player.id === activePlayerId),
      ...orderedTeammates,
    ];
    this.recordUpdatePhase('vision.inputSelection', visionPhaseStartedAt);
    recordMatchReportWork(this.matchReport, 'vision.livePlayers', liveVisionPlayers.length);
    recordMatchReportWork(this.matchReport, 'vision.mapObjects', visionObjects.length);
    recordMatchReportWork(this.matchReport, 'vision.gadgetEffects', this.match.gadgetEffects?.length ?? 0);
    const updateProfile = getAdaptiveUpdateProfile(this.computationLevel);
    let teammateVisionUpdates = 0;
    let playerVisionRefreshes = 0;
    let visionChanged = false;
    const activePlayerBlinded = this.isPlayerFlashBlinded(activePlayer, flashNow);
    const flashBlindChanged = activePlayerBlinded !== this.flashBlinded;
    this.flashBlinded = activePlayerBlinded;
    const liveTeammateIds = new Set();
    visionPhaseStartedAt = performance.now();
    for (const player of orderedVisionPlayers) {
      liveTeammateIds.add(player.id);
      if (this.isPlayerFlashBlinded(player, flashNow)) {
        const hadVision = this.visionCacheByPlayer.delete(player.id);
        this.visionInputCacheByPlayer.delete(player.id);
        this.visionRefreshAtByPlayer.delete(player.id);
        if (hadVision) visionChanged = true;
        continue;
      }
      const isControlledPlayer = player.id === activePlayerId;
      const refreshInterval = isControlledPlayer
        ? updateProfile.controlledVisionIntervalMs
        : getTeammateVisionInterval(this.computationLevel, teammateRanks.get(player.id));
      const weapon = this.getSelectedWeapon(player);
      const weaponStats = player.weaponStats?.[weapon.id];
      const angle = isControlledPlayer && Number.isFinite(this.localVisionAngle)
        ? this.localVisionAngle
        : player.visionAngle ?? weaponStats?.aimAngle ?? 0;
      const firingAngle = isControlledPlayer && Number.isFinite(this.localAimAngle)
        ? this.localAimAngle
        : weaponStats?.aimAngle ?? angle;
      if (isControlledPlayer) {
        this.localVisionAngle = angle;
        player.visionAngle = angle;
      }
      const previousVision = this.visionCacheByPlayer.get(player.id);
      const previousInput = this.visionInputCacheByPlayer.get(player.id);
      const angleChanged = !previousInput ||
        Math.abs(Math.atan2(Math.sin(angle - previousInput.angle), Math.cos(angle - previousInput.angle))) > 1e-4;
      const positionChanged = !previousInput ||
        !Number.isFinite(previousInput.x) || !Number.isFinite(previousInput.y) ||
        Math.hypot(player.x - previousInput.x, player.y - previousInput.y) >= VISION_POSITION_EPSILON;
      const weaponId = player.selectedWeaponId ?? 'assault-rifle';
      const weaponLean = player.weaponLean ?? 0;
      const visionObjectsChanged = !previousInput || previousInput.objects !== visionObjects;
      const visionInputChanged = !previousVision || positionChanged || angleChanged ||
        previousInput.weaponId !== weaponId || previousInput.weaponLean !== weaponLean ||
        previousInput.firingAngle !== firingAngle ||
        visionObjectsChanged;
      const previousRefreshAt = this.visionRefreshAtByPlayer.get(player.id) ?? -Infinity;
      if (!visionInputChanged) continue;
      if (now - previousRefreshAt < refreshInterval &&
          !visionObjectsChanged) continue;
      if (!isControlledPlayer &&
          teammateVisionUpdates >= updateProfile.maxTeammateVisionUpdatesPerFrame) continue;

      this.visionRefreshAtByPlayer.set(player.id, now);
      const playerVisionStartedAt = performance.now();
      const origin = getPlayerVisionOrigin(player, this.mapObjects, firingAngle);
      this.visionCacheByPlayer.set(player.id, createVision(
        origin,
        angle,
        visionObjects,
        this.mapWidth,
        this.mapHeight,
        VISION_HALF_ANGLE,
        undefined,
        0,
        isControlledPlayer ? undefined : TEAMMATE_VISION_BASE_RAY_COUNT,
      ));
      this.recordUpdatePhase('vision.playerRays', playerVisionStartedAt);
      this.visionInputCacheByPlayer.set(player.id, {
        x: player.x,
        y: player.y,
        angle,
        firingAngle,
        weaponId,
        weaponLean,
        objects: visionObjects,
      });
      playerVisionRefreshes += 1;
      if (!isControlledPlayer) teammateVisionUpdates += 1;
      visionChanged = true;
    }
    for (const playerId of this.visionCacheByPlayer.keys()) {
      if (!liveTeammateIds.has(playerId)) {
        this.visionCacheByPlayer.delete(playerId);
        this.visionInputCacheByPlayer.delete(playerId);
        this.visionRefreshAtByPlayer.delete(playerId);
        visionChanged = true;
      }
    }
    this.recordUpdatePhase('vision.playerCache', visionPhaseStartedAt);
    recordMatchReportWork(this.matchReport, 'vision.playerVisionRefreshes', playerVisionRefreshes);
    const activeSpyCameraIds = new Set();
    const spyCameraVisions = [];
    visionPhaseStartedAt = performance.now();
    for (const camera of this.match.gadgetEffects ?? []) {
      if (camera.type !== SPY_CAMERA_ID || camera.team !== localTeam ||
          activePlayerJammed || isGadgetJammed(camera, flashNow) ||
          (Number.isFinite(camera.disabledUntil) && camera.disabledUntil > flashNow) ||
          camera.startedAt > flashNow || camera.expiresAt <= flashNow || camera.health <= 0) continue;
      const angle = Number.isFinite(camera.angle) ? camera.angle : 0;
      const range = camera.visionRange ?? 300;
      const halfAngle = camera.visionHalfAngle ?? VISION_HALF_ANGLE;
      if (![camera.x, camera.y, range, halfAngle].every(Number.isFinite) || range <= 0 || halfAngle < 0) continue;
      activeSpyCameraIds.add(camera.id);
      const inputKey = `${camera.team}:${camera.x}:${camera.y}:${angle}:${range}:${halfAngle}`;
      let cached = this.spyCameraVisionCache.get(camera.id);
      if (cached?.inputKey !== inputKey) {
        const cameraVisionStartedAt = performance.now();
        cached = {
          inputKey,
          vision: createXrayVision(
            { x: camera.x, y: camera.y },
            angle,
            this.mapWidth,
            this.mapHeight,
            halfAngle,
            range,
          ),
        };
        this.recordUpdatePhase('vision.spyCameraRays', cameraVisionStartedAt);
        this.spyCameraVisionCache.set(camera.id, cached);
        visionChanged = true;
      }
      spyCameraVisions.push(cached.vision);
    }
    this.recordUpdatePhase('vision.spyCameraScan', visionPhaseStartedAt);
    let sonarIntelChanged = false;
    const activeSonarIds = new Set();
    const sonarVisions = [];
    visionPhaseStartedAt = performance.now();
    for (const sonar of this.match.gadgetEffects ?? []) {
      if (sonar.type !== 'sonar-projectile' || sonar.team !== localTeam ||
          activePlayerJammed || isGadgetJammed(sonar, flashNow) ||
          sonar.startedAt > flashNow || sonar.expiresAt <= flashNow ||
          !this.players.get(sonar.ownerId)?.alive || isPlayerJammed(this.players.get(sonar.ownerId), flashNow) ||
          (this.players.get(sonar.ownerId)?.health ?? 100) <= 0) continue;
      activeSonarIds.add(sonar.id);
      const cached = this.sonarVisionCache.get(sonar.id);
      if (!cached || cached.objects !== visionObjects ||
          Math.hypot(sonar.x - cached.x, sonar.y - cached.y) >= 8) {
        const sonarVisionStartedAt = performance.now();
        const vision = createVision(
          { x: sonar.x, y: sonar.y },
          0,
          visionObjects,
          this.mapWidth,
          this.mapHeight,
          Math.PI,
          sonar.listeningRadius ?? SONAR_LISTENING_RADIUS,
        );
        this.recordUpdatePhase('vision.sonarRays', sonarVisionStartedAt);
        this.sonarVisionCache.set(sonar.id, {
          x: sonar.x,
          y: sonar.y,
          objects: visionObjects,
          vision,
        });
        sonarIntelChanged = true;
      }
      sonarVisions.push(this.sonarVisionCache.get(sonar.id).vision);
    }
    this.recordUpdatePhase('vision.sonarScan', visionPhaseStartedAt);
    for (const sonarId of this.sonarVisionCache.keys()) {
      if (activeSonarIds.has(sonarId)) continue;
      this.sonarVisionCache.delete(sonarId);
      sonarIntelChanged = true;
    }
    for (const cameraId of this.spyCameraVisionCache.keys()) {
      if (activeSpyCameraIds.has(cameraId)) continue;
      this.spyCameraVisionCache.delete(cameraId);
      visionChanged = true;
    }
    const visions = [...this.visionCacheByPlayer.values(), ...spyCameraVisions];
    const activeVisions = visions;
    this.currentVisions = activeVisions;
    visionPhaseStartedAt = performance.now();
    this.revealVisibleMines(localTeam, activeVisions, visionObjects, flashNow);
    this.recordUpdatePhase('vision.mineReveal', visionPhaseStartedAt);
    if (visionChanged || flashBlindChanged) {
      this.visionOverlayDirty = true;
      this.playerVisibilityRevision += 1;
      this.playerVisibilityCache.clear();
      this.playerVisibilityCacheTime = now;
    }
    visionPhaseStartedAt = performance.now();
    const updatedVisionOverlay = this.visionOverlayDirty &&
      now - this.lastVisionOverlayUpdateAt >= VISION_OVERLAY_UPDATE_INTERVAL_MS &&
      this.drawTeamVision(activeVisions);
    this.recordUpdatePhase('vision.teamOverlay', visionPhaseStartedAt);
    if (updatedVisionOverlay) {
      this.lastVisionOverlayUpdateAt = now;
      this.visionOverlayDirty = false;
    }
    if (visionChanged) this.visiblePropsDirty = true;
    if (this.visiblePropsDirty) this.drawVisibleProps();
    if (!visionChanged && !flashBlindChanged && !sonarIntelChanged) return;
    this.lastVisionUpdateAt = now;
    if (now - this.lastVisionMemoryAt >= VISION_MEMORY_REFRESH_INTERVAL_MS) {
      this.lastVisionMemoryAt = now;
      const newlyExploredCells = [];
      const intelVisions = [...activeVisions, ...sonarVisions];
      for (const vision of intelVisions) {
        newlyExploredCells.push(...revealVisionCells(
          this.exploredCells,
          this.intelColumns,
          this.intelRows,
          VISION_MEMORY_CELL_SIZE,
          vision,
        ));
      }
      if (newlyExploredCells.length > 0) this.revealFogCells(newlyExploredCells);
      if (newlyExploredCells.length > 0) {
        const spans = encodeCellIndicesAsSpans(newlyExploredCells);
        for (let offset = 0; offset < spans.length; offset += MAX_INTEL_SPANS_PER_MESSAGE * 2) {
          this.roomClient.send('game:intel:reveal', {
            matchId: this.match.startedAt,
            spans: spans.slice(offset, offset + MAX_INTEL_SPANS_PER_MESSAGE * 2),
          });
        }
      }
      const newlyRevealedWalls = getNewlyRevealedWalls(this.exploredWallIds, intelVisions);
      if (newlyRevealedWalls.length > 0) {
        for (const wall of newlyRevealedWalls) {
          this.exploredWallObjects.set(wall.id, wall);
          this.pendingWallIntel.set(wall.id, wall);
        }
        this.drawRememberedWalls(newlyRevealedWalls);
        this.publishPendingWallIntel(flashNow);
      }
    }
    this.renderObjectiveStatus();
  }

  revealVisibleMines(team, visions, visionObjects, now = Date.now()) {
    if (this.roomState?.hostId !== this.playerId || this.isActivePlayerJammed(now) ||
        !['red', 'blue'].includes(team)) return;
    const mines = (this.match?.gadgetEffects ?? []).filter((effect) =>
      effect.triggerOnEnemyProximity === true);
    const knownIds = this.hostMineIntelByTeam[team];
    const visibleIds = new Set();
    for (const mine of mines) {
      if (mine.team === team && isGadgetJammed(mine, now)) continue;
      const latchedPlayer = this.players.get(mine.latchedEnemyId);
      if (mine.team === team ||
          (latchedPlayer?.team === team && !isPlayerJammed(latchedPlayer, now)) ||
          visions.some((vision) => isPointVisible(mine, vision, visionObjects))) {
        visibleIds.add(mine.id);
      }
    }
    const changed = knownIds.size !== visibleIds.size ||
      [...knownIds].some((id) => !visibleIds.has(id));
    knownIds.clear();
    for (const id of visibleIds) knownIds.add(id);
    if (changed) this.publishHostMineIntel(now, true);
  }

  initializeFogTexture(matchId) {
    this.disposeFogTexture();
    const textureKey = `flagstrike-fog-${matchId}`;
    this.fogTexture = this.textures.createCanvas(textureKey, this.mapWidth, this.mapHeight);
    this.fogTextureKey = textureKey;
    const context = this.fogTexture.getContext();
    context.fillStyle = 'rgba(3, 7, 13, 1)';
    context.fillRect(0, 0, this.mapWidth, this.mapHeight);
    this.fogTexture.refresh();
    this.fogImage?.destroy();
    this.fogImage = this.add.image(0, 0, textureKey).setOrigin(0).setDepth(2.9);
  }

  initializeVisionTexture(matchId) {
    this.disposeVisionTexture();
    const textureKey = `flagstrike-vision-${matchId}`;
    this.visionTexture = this.textures.createCanvas(textureKey, this.mapWidth, this.mapHeight);
    this.visionTextureKey = textureKey;
    this.visionImage = this.add.image(0, 0, textureKey).setOrigin(0).setDepth(2.94).setVisible(false);
  }

  disposeVisionTexture() {
    this.visionImage?.destroy();
    this.visionImage = null;
    if (this.visionTextureKey && this.textures.exists(this.visionTextureKey)) {
      this.textures.remove(this.visionTextureKey);
    }
    this.visionTexture = null;
    this.visionTextureKey = null;
  }

  clearVisionOverlay() {
    const context = this.visionTexture?.getContext();
    if (!context) return;
    context.clearRect(0, 0, this.mapWidth, this.mapHeight);
    this.visionTexture.refresh();
    this.visionImage?.setVisible(false);
    this.lastVisionOverlayUpdateAt = -Infinity;
    this.visionOverlayDirty = false;
  }

  disposeFogTexture() {
    this.fogImage?.destroy();
    this.fogImage = null;
    if (this.fogTextureKey && this.textures.exists(this.fogTextureKey)) {
      this.textures.remove(this.fogTextureKey);
    }
    this.fogTexture = null;
    this.fogTextureKey = null;
  }

  revealFogCells(cellIndices) {
    if (!this.fogTexture) return;
    const context = this.fogTexture.getContext();
    for (const index of cellIndices) {
      const x = (index % this.intelColumns) * VISION_MEMORY_CELL_SIZE;
      const y = Math.floor(index / this.intelColumns) * VISION_MEMORY_CELL_SIZE;
      context.clearRect(x, y, VISION_MEMORY_CELL_SIZE, VISION_MEMORY_CELL_SIZE);
    }
    this.fogTexture.refresh();
  }

  applyTeamIntel({ team, spans } = {}) {
    const localTeam = this.getLocalTeam();
    if (this.isActivePlayerJammed() || !this.exploredCells || team !== localTeam ||
        !Array.isArray(spans) || spans.length % 2 !== 0) return;
    let changed = false;
    const context = this.fogTexture?.getContext();
    for (let range = 0; range < spans.length; range += 2) {
      const start = Math.max(0, Math.min(this.exploredCells.length, spans[range]));
      const end = Math.max(start, Math.min(this.exploredCells.length, spans[range + 1]));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) continue;
      this.exploredCells.fill(1, start, end);
      changed = true;
      if (!context) continue;
      for (let index = start; index < end;) {
        const row = Math.floor(index / this.intelColumns);
        const rowEnd = Math.min(end, (row + 1) * this.intelColumns);
        const x = index % this.intelColumns;
        context.clearRect(x * VISION_MEMORY_CELL_SIZE, row * VISION_MEMORY_CELL_SIZE,
          (rowEnd - index) * VISION_MEMORY_CELL_SIZE, VISION_MEMORY_CELL_SIZE);
        index = rowEnd;
      }
    }
    if (changed) {
      this.fogTexture?.refresh();
      this.renderPlayers();
    }
  }

  applyTeamWalls({ matchId, team, walls } = {}) {
    if (this.isActivePlayerJammed() || matchId !== this.match?.startedAt ||
        team !== this.getLocalTeam() || !Array.isArray(walls)) return;
    const newlyKnownWalls = [];
    for (const wall of walls) {
      if (!wall || typeof wall.id !== 'string' || wall.shape !== 'segment' ||
          ![wall.x1, wall.y1, wall.x2, wall.y2].every(Number.isFinite) ||
          !this.mapObjects.some((object) => object.id === wall.objectId) ||
          this.exploredWallIds.has(wall.id)) continue;
      this.exploredWallIds.add(wall.id);
      this.exploredWallObjects.set(wall.id, wall);
      this.pendingWallIntel.delete(wall.id);
      newlyKnownWalls.push(wall);
    }
    if (newlyKnownWalls.length > 0) this.drawRememberedWalls(newlyKnownWalls);
  }

  publishPendingWallIntel(now = Date.now()) {
    if (!this.match || this.isActivePlayerJammed(now) || !this.pendingWallIntel.size ||
        now - this.lastWallIntelSendAt < 50) return;
    const walls = [...this.pendingWallIntel.values()].slice(0, 128);
    if (!this.roomClient.send('game:intel:walls', { matchId: this.match.startedAt, walls })) return;
    for (const wall of walls) this.pendingWallIntel.delete(wall.id);
    this.lastWallIntelSendAt = now;
  }

  applyTeamCorpses({ team, ids, snapshot = false } = {}) {
    const localTeam = this.getLocalTeam();
    if (this.isActivePlayerJammed() || !localTeam || team !== localTeam || !Array.isArray(ids)) return;
    if (this.corpseIntelTeam !== localTeam) {
      this.knownCorpseIds.clear();
      this.corpseIntelTeam = localTeam;
    }
    if (snapshot) this.knownCorpseIds.clear();
    for (const id of ids) {
      if (typeof id === 'string' && id.length > 0) this.knownCorpseIds.add(id);
    }
    this.renderPlayers();
  }

  drawRememberedWalls(walls) {
    if (!this.rememberedWallGraphics) return;
    for (const wall of walls) {
      if (wall.shape === 'segment') {
        const damage = wall.role === 'destructible-prop'
          ? 1 - Math.max(0, wall.health ?? wall.maxHealth ?? 300) / (wall.maxHealth ?? 300)
          : 0;
        const color = wall.role === 'destructible-prop'
          ? interpolateHexColor(0xd5b481, 0xff263f, damage)
          : 0x9aacc2;
        this.rememberedWallGraphics.lineStyle(wall.role === 'destructible-prop' ? 3 : 5, color, 1)
          .lineBetween(wall.x1, wall.y1, wall.x2, wall.y2);
      } else if (wall.shape === 'rect') {
        if (wall.role === 'destructible-prop') {
          const damaged = wall.health < (wall.maxHealth ?? 300);
          this.rememberedWallGraphics.fillStyle(damaged ? 0x76503c : 0x806044, 1)
            .fillRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
          this.rememberedWallGraphics.lineStyle(3, damaged ? 0xff394d : 0xd5b481, 1)
            .strokeRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
        } else {
          this.rememberedWallGraphics.fillStyle(0x647a93, 0.92)
            .fillRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
        }
      } else if (wall.shape === 'circle') {
        if (wall.role === 'destructible-prop') {
          const damaged = wall.health < (wall.maxHealth ?? 300);
          this.rememberedWallGraphics.fillStyle(damaged ? 0x76503c : 0x875432, 1)
            .fillCircle(wall.x, wall.y, wall.radius);
          this.rememberedWallGraphics.lineStyle(3, damaged ? 0xff394d : 0xd5a36b, 1)
            .strokeCircle(wall.x, wall.y, wall.radius);
        } else {
          this.rememberedWallGraphics.fillStyle(0x647a93, 0.92).fillCircle(wall.x, wall.y, wall.radius);
        }
      }
    }
  }

  drawTeamVision(visions) {
    const context = this.visionTexture?.getContext();
    if (!context) return false;
    context.clearRect(0, 0, this.mapWidth, this.mapHeight);

    const activeVision = this.visionCacheByPlayer.get(this.getActivePlayerId());
    context.fillStyle = 'rgba(114, 207, 255, 0.11)';
    context.beginPath();
    let hasTeammateVision = false;
    for (const vision of visions) {
      if (vision === activeVision || !traceVisionPath(context, vision)) continue;
      hasTeammateVision = true;
    }
    if (hasTeammateVision) context.fill();

    // Clear teammate tint beneath the controlled player's cone before painting
    // it more strongly, so overlap never compounds the transparency.
    if (activeVision) {
      context.beginPath();
      if (traceVisionPath(context, activeVision)) {
        context.save();
        context.clip();
        context.clearRect(0, 0, this.mapWidth, this.mapHeight);
        context.beginPath();
        traceVisionPath(context, activeVision);
        context.fillStyle = 'rgba(114, 207, 255, 0.24)';
        context.fill();
        context.restore();
      }
    }

    this.visionTexture.refresh();
    this.visionImage?.setVisible(visions.length > 0);
    return true;
  }

  isPlayerVisible(player, visionObjects) {
    const localTeam = this.getLocalTeam();
    const activePlayerId = this.getActivePlayerId();
    const viewerJammed = this.isActivePlayerJammed();
    const jammedTeammate = player.team === localTeam && isPlayerJammed(player, Date.now());
    const cached = this.playerVisibilityCache.get(player.id);
    const now = performance.now();
    const dx = cached ? player.x - cached.x : Infinity;
    const dy = cached ? player.y - cached.y : Infinity;
    if (cached && now - cached.checkedAt < PLAYER_VISIBILITY_CACHE_INTERVAL_MS &&
        dx * dx + dy * dy <= PLAYER_RADIUS * PLAYER_RADIUS &&
        cached.team === player.team && cached.localTeam === localTeam &&
        cached.viewerJammed === viewerJammed &&
        cached.jammedTeammate === jammedTeammate &&
        cached.visionRevision === this.playerVisibilityRevision) {
      return cached.visible;
    }
    const visible = isPlayerVisibleToViewer({
      player,
      viewerTeam: localTeam,
      activePlayerId,
      viewerJammed,
      jammedTeammate,
      visions: this.currentVisions,
      visionObjects: visionObjects ?? this.getVisionObjects(),
      playerRadius: PLAYER_RADIUS,
      postGameFreeRoam: this.isPostGameFreeRoam(),
    });
    this.playerVisibilityCache.set(player.id, {
      x: player.x,
      y: player.y,
      team: player.team,
      localTeam,
      viewerJammed,
      jammedTeammate,
      visionRevision: this.playerVisibilityRevision,
      visible,
      checkedAt: now,
    });
    return visible;
  }

  getLocalTeam() {
    return this.players.get(this.playerId)?.team ??
      this.roomState?.players?.find((player) => player.id === this.playerId)?.team ?? null;
  }

  isPositionExplored(position) {
    if (!this.exploredCells || position.x < 0 || position.y < 0 ||
        position.x >= this.mapWidth || position.y >= this.mapHeight) return false;
    const x = Math.floor(position.x / VISION_MEMORY_CELL_SIZE);
    const y = Math.floor(position.y / VISION_MEMORY_CELL_SIZE);
    return Boolean(this.exploredCells[y * this.intelColumns + x]);
  }

  renderObjectiveStatus() {
    const match = this.match;
    const flag = match?.flag;
    if (!flag || match.victory) {
      this.publishHud({ objective: '' });
      return;
    }
    const holder = this.players.get(flag.heldBy);
    const localPlayer = this.players.get(this.getActivePlayerId());
    const isStrikeTeam = localPlayer?.team === 'red';
    const text = holder?.id === this.getActivePlayerId()
      ? 'YOU CARRY THE FLAG · PRESS F TO DROP · RETURN TO STRIKE SITE'
      : holder && !this.isPlayerVisible(holder)
        ? 'FLAG CARRIED · ENEMY POSITION UNKNOWN'
        : holder
          ? isStrikeTeam
            ? `FLAG CARRIED BY ${holder.name.toUpperCase()} · STRIKE TEAM: RETURN TO STRIKE SITE`
            : `FLAG CARRIED BY ${holder.name.toUpperCase()} · FLAG TEAM: STOP THE CAPTURE`
          : flag.dropped
            ? this.isPositionExplored(flag)
              ? `FLAG DROPPED · ${isStrikeTeam ? 'STRIKE TEAM: RECOVER IT' : 'FLAG TEAM: DEFEND IT'}`
              : 'FLAG DROPPED · LOCATION UNKNOWN'
            : 'FLAG AT FLAG SITE · STRIKE TEAM: CAPTURE AND RETURN IT';
    let objective = text;
    if (localPlayer?.team === 'blue' && holder?.team === 'red' && !this.isPlayerVisible(holder)) {
      objective = 'ENEMY CARRIED THE FLAG · POSITION UNKNOWN';
    }
    this.publishHud({ objective });
  }

  updateAimPointer(pointer) {
    if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) || !this.cameras?.main) return;
    this.pointerNormalizedX = Math.max(0, Math.min(1, pointer.x / Math.max(this.scale.gameSize.width, 1)));
    this.pointerNormalizedY = Math.max(0, Math.min(1, pointer.y / Math.max(this.scale.gameSize.height, 1)));
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (Number.isFinite(worldPoint.x) && Number.isFinite(worldPoint.y)) {
      this.aimWorldPoint = { x: worldPoint.x, y: worldPoint.y };
      this.pointerOverGame = true;
    }
  }

  updateAimPointerFromClient(event) {
    const canvas = this.game?.canvas;
    if (!canvas || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const gameWidth = this.scale.gameSize.width;
    const gameHeight = this.scale.gameSize.height;
    const screenX = Math.max(0, Math.min(gameWidth, (event.clientX - bounds.left) * gameWidth / bounds.width));
    const screenY = Math.max(0, Math.min(gameHeight, (event.clientY - bounds.top) * gameHeight / bounds.height));
    this.pointerNormalizedX = screenX / Math.max(gameWidth, 1);
    this.pointerNormalizedY = screenY / Math.max(gameHeight, 1);
    const worldPoint = this.cameras.main.getWorldPoint(screenX, screenY);
    if (Number.isFinite(worldPoint.x) && Number.isFinite(worldPoint.y)) {
      this.aimWorldPoint = { x: worldPoint.x, y: worldPoint.y };
      this.pointerOverGame = true;
    }
  }

  drawHitMarkerAtAimPoint() {
    const graphics = this.hitMarkerGraphics;
    if (!graphics) return;
    graphics.clear();
    const player = this.players.get(this.getActivePlayerId());
    if (this.isGadgetSwitching(player)) return;
    if (!this.pointerOverGame || !this.aimWorldPoint) return;

    const zoom = Math.max(this.cameras.main.zoom, 0.001);
    const unit = 1 / zoom;
    const { x, y } = this.aimWorldPoint;
    const hitMarkerRemaining = this.hitMarkerExpiresAt - Date.now();
    if (hitMarkerRemaining <= 0) return;
    const size = 4.5 * unit;
    const gap = 2 * unit;
    const alpha = Math.min(1, hitMarkerRemaining / 80);
    graphics.lineStyle(1.75 * unit, 0xffffff, alpha);
    graphics.lineBetween(x - size, y - size, x - gap, y - gap);
    graphics.lineBetween(x + size, y - size, x + gap, y - gap);
    graphics.lineBetween(x - size, y + size, x - gap, y + gap);
    graphics.lineBetween(x + size, y + size, x + gap, y + gap);
  }

  fireRifle(time, localPlayer) {
    const equippedSlot = this.getEquippedSlot(localPlayer);
    if (equippedSlot !== 'weapon' || this.isGadgetSwitching(localPlayer)) {
      if (this.fireHeld) {
        this.logWeaponFireDiagnostic('client-fire-blocked-by-slot-or-switch', {
          actorId: localPlayer.id,
          weaponId: localPlayer.selectedWeaponId,
          equippedSlot,
          gadgetSwitching: this.isGadgetSwitching(localPlayer),
        });
      }
      return;
    }
    const weapon = this.getSelectedWeapon(localPlayer);
    const weaponState = localPlayer.weaponStats?.[weapon.id];
    const pendingSemiAutoShot = hasPendingSemiAutoShot(
      weapon, this.firePressSequence, this.lastSemiAutoFirePress,
    );
    if (!this.fireHeld && !pendingSemiAutoShot && !(weaponState?.burstShotsRemaining > 0)) return;
    if (weapon.semiAuto && !pendingSemiAutoShot) return;
    const canInterruptShellReload = Boolean(weapon.reloadPerRound && weaponState?.reloading && weaponState.ammo > 0);
    if ((weaponState?.reloading && !canInterruptShellReload) || weaponState?.ammo === 0 ||
        (weaponState?.manualActionEndsAt && Date.now() < weaponState.manualActionEndsAt)) {
      this.logWeaponFireDiagnostic('client-fire-blocked-by-weapon-state', {
        actorId: localPlayer.id,
        weaponId: weapon.id,
        ammo: weaponState?.ammo ?? null,
        reloading: Boolean(weaponState?.reloading),
        manualActionRemainingMs: Math.max(0, (weaponState?.manualActionEndsAt ?? 0) - Date.now()),
      });
      if (pendingSemiAutoShot) this.lastSemiAutoFirePress = this.firePressSequence;
      return;
    }
    const isRemoteOwner = this.roomState?.hostId !== this.playerId;
    const cooldownActive = time - this.lastShotAt < weapon.cooldownMs ||
      (!isRemoteOwner && Date.now() < (weaponState?.cooldownEndsAt ?? 0));
    if (cooldownActive) {
      if (isRemoteOwner && this.fireHeld) {
        this.logWeaponFireDiagnostic('client-fire-blocked-by-cooldown', {
          actorId: localPlayer.id,
          weaponId: weapon.id,
          localCooldownRemainingMs: Math.max(0, weapon.cooldownMs - (time - this.lastShotAt)),
          hostCooldownRemainingMs: Math.max(0, (weaponState?.cooldownEndsAt ?? 0) - Date.now()),
        }, 'info');
      }
      if (pendingSemiAutoShot) this.lastSemiAutoFirePress = this.firePressSequence;
      return;
    }
    if (!Number.isFinite(this.localAimAngle)) {
      const authoritativeAngle = weaponState?.aimAngle;
      this.localAimAngle = Number.isFinite(authoritativeAngle) ? authoritativeAngle : 0;
    }
    const direction = { x: Math.cos(this.localAimAngle), y: Math.sin(this.localAimAngle) };
    if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return;
    if (this.sendWeaponAction('game:fire', 'fire', { direction }, weapon, localPlayer)) {
      if (pendingSemiAutoShot) this.lastSemiAutoFirePress = this.firePressSequence;
      this.lastShotAt = time;
    }
  }

  drawAimGuides(localPlayer) {
    this.aimGraphics.clear();
    this.gadgetAimGraphics.clear();
    if (!localPlayer?.alive ||
        !Number.isFinite(localPlayer.x) || !Number.isFinite(localPlayer.y)) return;
    if (this.isGadgetSwitching(localPlayer)) return;
    if (!this.aimWorldPoint && this.input.activePointer) this.updateAimPointer(this.input.activePointer);
    if (!this.aimWorldPoint) return;
    if (this.getEquippedSlot(localPlayer) === 'gadget') {
      this.drawSmokeTrajectory(localPlayer);
      return;
    }
    const weapon = this.getSelectedWeapon(localPlayer);
    const stats = localPlayer.weaponStats?.[weapon.id];
    const canInterruptShellReload = Boolean(weapon.reloadPerRound && stats?.reloading && stats.ammo > 0);
    if ((stats?.reloading && !canInterruptShellReload) || stats?.ammo === 0) return;
    const baseAngle = this.localAimAngle;
    if (!Number.isFinite(baseAngle)) return;
    const accuracy = stats?.effectiveAccuracy ?? stats?.accuracy ??
      weapon.accuracy.startingAccuracy ?? weapon.accuracy.maxAccuracy ?? 1;
    const halfSpread = getMaximumSpreadRadians(accuracy, weapon.accuracy.maxSpreadDegrees) +
      (weapon.pelletSpreadDegrees ?? 0) * Math.PI / 180;
    const origin = getWeaponMuzzlePosition(localPlayer, baseAngle, localPlayer.weaponLean, this.mapObjects);
    const leftEnd = this.getAimRayEnd(origin, baseAngle - halfSpread, weapon.range, weapon.radius);
    const rightEnd = this.getAimRayEnd(origin, baseAngle + halfSpread, weapon.range, weapon.radius);
    const laserEnd = this.getAimRayEnd(origin, baseAngle, weapon.range, weapon.radius);

    if (halfSpread > 0) {
      this.aimGraphics.lineStyle(2, 0xffffff, 0.72);
      this.aimGraphics.lineBetween(origin.x, origin.y, leftEnd.x, leftEnd.y);
      this.aimGraphics.lineBetween(origin.x, origin.y, rightEnd.x, rightEnd.y);
    }
    const ammoRatio = Number.isFinite(stats?.ammo) && Number.isFinite(weapon.magazineSize) &&
      weapon.magazineSize > 0
      ? Math.max(0, Math.min(1, stats.ammo / weapon.magazineSize))
      : 1;
    const aimColor = ammoRatio >= 0.5
      ? interpolateHexColor(0xffd34a, 0xbaffea, (ammoRatio - 0.5) * 2)
      : interpolateHexColor(0xff5d68, 0xffd34a, ammoRatio * 2);
    this.aimGraphics.lineStyle(2.5, aimColor, 0.95);
    this.aimGraphics.lineBetween(origin.x, origin.y, laserEnd.x, laserEnd.y);
  }

  drawSmokeTrajectory(player) {
    const gadget = GADGET_DEFINITIONS[player.selectedGadgetId];
    if (gadget?.id === TROPHY_SYSTEM_ID) {
      const trophy = this.getOwnedTrophySystem(player);
      if (trophy) {
        const target = this.aimWorldPoint;
        if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
        const inMap = target.x >= 0 && target.x <= this.mapWidth &&
          target.y >= 0 && target.y <= this.mapHeight;
        const trajectory = inMap ? calculateGadgetTrajectory(
          { x: trophy.x, y: trophy.y },
          target,
          this.mapObjects.filter((object) => object?.blocksVision !== true),
          {
            maximumRange: Math.hypot(this.mapWidth, this.mapHeight),
            collisionRadius: DEFAULT_GADGET_THROW_COLLISION_RADIUS,
            maximumBounces: 0,
          },
        ) : null;
        const endpoint = trajectory?.endpoint ?? target;
        const color = trajectory ? gadget.colorHex ?? 0xe7b851 : 0xff5d68;
        const graphics = this.gadgetAimGraphics;
        graphics.lineStyle(2, color, 0.9)
          .lineBetween(trophy.x, trophy.y, endpoint.x, endpoint.y);
        graphics.fillStyle(color, 0.14)
          .fillCircle(endpoint.x, endpoint.y, TROPHY_SYSTEM_COMMAND_RADIUS);
        graphics.lineStyle(2, color, 0.88)
          .strokeCircle(endpoint.x, endpoint.y, TROPHY_SYSTEM_COMMAND_RADIUS);
        graphics.lineStyle(1.5, 0xffffff, 0.95)
          .lineBetween(endpoint.x - 8, endpoint.y, endpoint.x + 8, endpoint.y)
          .lineBetween(endpoint.x, endpoint.y - 8, endpoint.x, endpoint.y + 8);
        return;
      }
    }
    if ((player.gadgetCount ?? 0) <= 0) return;
    if (gadget?.id === KATANA_ID) {
      const dash = calculateKatanaDash(
        player, this.aimWorldPoint, this.mapObjects, this.mapWidth, this.mapHeight,
      );
      if (!dash) return;
      const graphics = this.gadgetAimGraphics;
      const color = gadget.colorHex ?? 0xe9d28a;
      const hitRadius = gadget.hitRadius ?? KATANA_DASH_HIT_RADIUS;
      graphics.lineStyle(hitRadius * 2, color, 0.14).lineBetween(
        dash.start.x, dash.start.y, dash.end.x, dash.end.y,
      );
      graphics.fillStyle(color, 0.12)
        .fillCircle(dash.start.x, dash.start.y, hitRadius)
        .fillCircle(dash.end.x, dash.end.y, hitRadius);
      graphics.lineStyle(1.5, color, 0.92).strokeCircle(dash.end.x, dash.end.y, hitRadius);
      graphics.lineStyle(2, 0xfff7d7, 0.95)
        .lineBetween(dash.start.x, dash.start.y, dash.end.x, dash.end.y);
      return;
    }
    if (gadget?.id === SPY_CAMERA_ID) {
      const target = this.aimWorldPoint;
      if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
      const angle = getHostAimAngle({
        x: target.x - player.x,
        y: target.y - player.y,
      }, player.visionAngle ?? 0);
      const graphics = this.gadgetAimGraphics;
      const color = gadget.colorHex ?? 0x55c9ff;
      const range = gadget.visionRange ?? SPY_CAMERA_RANGE;
      const halfAngle = gadget.visionHalfAngle ?? VISION_HALF_ANGLE;
      graphics.beginPath().moveTo(player.x, player.y);
      const arcSteps = 32;
      for (let step = 0; step <= arcSteps; step += 1) {
        const arcAngle = angle - halfAngle + (halfAngle * 2 * step) / arcSteps;
        graphics.lineTo(
          player.x + Math.cos(arcAngle) * range,
          player.y + Math.sin(arcAngle) * range,
        );
      }
      graphics.closePath();
      graphics.fillStyle(color, 0.14).fillPath();
      graphics.lineStyle(1.5, color, 0.8).strokePath();
      return;
    }
    if (gadget?.id === ORBITAL_STRIKE_ID) {
      const target = this.aimWorldPoint;
      if (!target || target.x < 0 || target.x > this.mapWidth || target.y < 0 || target.y > this.mapHeight) return;
      const pulse = 0.78 + (Math.sin(Date.now() / 100) + 1) * 0.11;
      const graphics = this.gadgetAimGraphics;
      graphics.fillStyle(0xff684d, 0.12).fillCircle(target.x, target.y, ORBITAL_STRIKE_RADIUS);
      graphics.lineStyle(2.5, 0xff684d, pulse).strokeCircle(target.x, target.y, ORBITAL_STRIKE_RADIUS);
      graphics.lineStyle(1.5, 0xffe0b2, 0.95)
        .lineBetween(target.x - 8, target.y, target.x + 8, target.y)
        .lineBetween(target.x, target.y - 8, target.x, target.y + 8);
      return;
    }
    const throwOrigin = getGadgetThrowOrigin(player, this.aimWorldPoint, this.mapObjects);
    if (!throwOrigin) return;
    const trajectory = calculateGadgetTrajectory(throwOrigin, this.aimWorldPoint, this.mapObjects, {
      maximumRange: gadget?.throwRange,
      collisionRadius: gadget?.throwCollisionRadius,
      maximumBounces: gadget?.maxBounces,
    });
    if (!trajectory) return;
    if (!this.isPositionExplored(trajectory.points[0])) return;
    const knownPoints = [trajectory.points[0]];
    let endpointKnown = true;
    for (let index = 1; index < trajectory.points.length; index += 1) {
      const start = trajectory.points[index - 1];
      const end = trajectory.points[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(1, Math.ceil(length));
      let stoppedAtUnknown = false;
      for (let step = 1; step <= steps; step += 1) {
        const fraction = step / steps;
        const point = {
          x: start.x + (end.x - start.x) * fraction,
          y: start.y + (end.y - start.y) * fraction,
        };
        if (!this.isPositionExplored(point)) {
          const lastKnownFraction = (step - 1) / steps;
          if (lastKnownFraction > 0) {
            knownPoints.push({
              x: start.x + (end.x - start.x) * lastKnownFraction,
              y: start.y + (end.y - start.y) * lastKnownFraction,
            });
          }
          endpointKnown = false;
          stoppedAtUnknown = true;
          break;
        }
      }
      if (stoppedAtUnknown) break;
      knownPoints.push(end);
    }
    const radius = gadget?.triggerRadius ?? gadget?.effectRadius ?? DEFAULT_GADGET_EFFECT_RADIUS;
    const graphics = this.gadgetAimGraphics;
    graphics.lineStyle(2, 0x9de9ef, 0.95);
    for (let index = 1; index < knownPoints.length; index += 1) {
      const start = knownPoints[index - 1];
      const end = knownPoints[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const steps = Math.max(1, Math.ceil(length / 18));
      for (let step = 0; step < steps; step += 2) {
        const from = step / steps;
        const to = Math.min(1, (step + 1) / steps);
        graphics.lineBetween(
          start.x + (end.x - start.x) * from,
          start.y + (end.y - start.y) * from,
          start.x + (end.x - start.x) * to,
          start.y + (end.y - start.y) * to,
        );
      }
    }
    if (!endpointKnown || !this.isPositionExplored(trajectory.endpoint)) return;
    graphics.lineStyle(1.5, 0x9de9ef, 0.58).strokeCircle(
      trajectory.endpoint.x, trajectory.endpoint.y, radius,
    );
    graphics.fillStyle(0x9de9ef, 0.16).fillCircle(
      trajectory.endpoint.x, trajectory.endpoint.y, radius,
    );
    graphics.fillStyle(0xffffff, 0.95).fillCircle(trajectory.endpoint.x, trajectory.endpoint.y, 3.5);
  }

  drawSmokeClouds() {
    const graphics = this.smokeGraphics;
    if (!graphics) return;
    graphics.clear();
    const smokes = (this.match?.smokes ?? []).filter((smoke) => smoke.expiresAt > Date.now());
    const now = Date.now();
    const visionNow = performance.now();
    const postGameFreeRoam = this.isPostGameFreeRoam();
    const visibilityRefreshInterval = getAdaptiveUpdateProfile(this.computationLevel).smokeVisibilityIntervalMs;
    const visionObjects = this.getVisionObjects();
    const effects = (this.match?.gadgetEffects ?? []).filter((effect) => effect.expiresAt > now);
    recordMatchReportWork(this.matchReport, 'frameOverlays.activeSmokes', smokes.length);
    recordMatchReportWork(this.matchReport, 'frameOverlays.activeGadgetEffects', effects.length);
    const activeSmokeIds = new Set([...smokes, ...effects].map((effect) => effect.id));
    const isDirectlyVisible = (target) => postGameFreeRoam ||
      this.currentVisions.some((vision) => isPointVisible(target, vision, visionObjects));
    const drawTrophyInterceptVisual = (impact) => {
      const progress = (now - impact.startedAt) /
        Math.max(1, (impact.expiresAt ?? impact.startedAt + TROPHY_INTERCEPT_VISUAL_DURATION_MS) - impact.startedAt);
      if (progress < 0 || progress >= 1) return;
      const hasTrailOrigin = Number.isFinite(impact.trophyX) && Number.isFinite(impact.trophyY);
      const start = hasTrailOrigin
        ? { x: impact.trophyX, y: impact.trophyY }
        : { x: impact.x, y: impact.y };
      const end = { x: impact.x, y: impact.y };
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const segmentCount = hasTrailOrigin ? Math.max(1, Math.ceil(distance / 10)) : 0;
      const visibleSegments = [];
      for (let index = 0; index < segmentCount; index += 1) {
        const from = index / segmentCount;
        const to = (index + 1) / segmentCount;
        const midpoint = (from + to) / 2;
        const sample = {
          x: start.x + (end.x - start.x) * midpoint,
          y: start.y + (end.y - start.y) * midpoint,
        };
        if (!isDirectlyVisible(sample)) continue;
        visibleSegments.push({
          x1: start.x + (end.x - start.x) * from,
          y1: start.y + (end.y - start.y) * from,
          x2: start.x + (end.x - start.x) * to,
          y2: start.y + (end.y - start.y) * to,
        });
      }
      const impactVisible = isDirectlyVisible(end);
      if (!visibleSegments.length && !impactVisible &&
          (!hasTrailOrigin || !isDirectlyVisible(start))) return;

      const alpha = (1 - progress) ** 2;
      const beamColor = impact.trophyTeam === this.getLocalTeam()
        ? ALLY_PLAYER_COLOR : ENEMY_PLAYER_COLOR;
      for (const segment of visibleSegments) {
        graphics.lineStyle(10, beamColor, 0.14 * alpha)
          .lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
        graphics.lineStyle(3, beamColor, 0.78 * alpha)
          .lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
        graphics.lineStyle(1.25, 0xffffff, 0.92 * alpha)
          .lineBetween(segment.x1, segment.y1, segment.x2, segment.y2);
      }
      if (!impactVisible) return;
      const radius = 3 + progress * 17;
      graphics.lineStyle(2.5, 0xfff1bd, alpha).strokeCircle(end.x, end.y, radius);
      graphics.lineStyle(1.25, 0xffd36b, alpha * 0.9)
        .strokeCircle(end.x, end.y, radius * 0.55);
      graphics.lineStyle(1.5, 0xffffff, alpha);
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = (ray / 8) * Math.PI * 2;
        graphics.lineBetween(
          end.x + Math.cos(angle) * radius * 0.65,
          end.y + Math.sin(angle) * radius * 0.65,
          end.x + Math.cos(angle) * (radius + 5),
          end.y + Math.sin(angle) * (radius + 5),
        );
      }
      graphics.fillStyle(0xffffff, alpha).fillCircle(end.x, end.y, 2.5 * (1 - progress));
    };
    for (const smoke of smokes) {
      const sampleCount = 128;
      const visibilityKey = `${Number(postGameFreeRoam)}:${smoke.x}:${smoke.y}:${smoke.radius}`;
      let cachedVisibility = this.smokeVisibilityCache.get(smoke.id);
      if (cachedVisibility?.key !== visibilityKey ||
          visionNow - (cachedVisibility.updatedAt ?? -Infinity) >= visibilityRefreshInterval) {
        const visible = getSmokeVisibleSamples(smoke, this.currentVisions, sampleCount,
          (point, vision) => isPointVisible(point, vision, visionObjects),
          postGameFreeRoam || smoke.ownerId === this.getActivePlayerId());
        cachedVisibility = { key: visibilityKey, updatedAt: visionNow, visible };
        this.smokeVisibilityCache.set(smoke.id, cachedVisibility);
      }
      const { visible } = cachedVisibility;
      const memory = rememberSmokeObservation(this.rememberedSmokes, smoke, visible, now);
      if (!memory) continue;
      if (memory.known) {
        graphics.fillStyle(0x85898d, 0.78).fillCircle(memory.smoke.x, memory.smoke.y, memory.smoke.radius);
        graphics.lineStyle(3, memory.smoke.team === this.getLocalTeam() ? ALLY_PLAYER_COLOR : ENEMY_PLAYER_COLOR, 0.95)
          .strokeCircle(memory.smoke.x, memory.smoke.y, memory.smoke.radius);
      }
    }
    for (const effect of effects) {
      if (effect.type === 'trophy-intercept-visual') {
        drawTrophyInterceptVisual(effect);
        continue;
      }
      if (effect.type === 'flash') continue;
      const needsVisibilityMemory = effect.triggerOnEnemyProximity !== true &&
        effect.type !== SPY_CAMERA_ID && effect.type !== TROPHY_SYSTEM_ID &&
        effect.type !== 'sonar-projectile' &&
        effect.type !== 'katana-dash';
      let memory = null;
      if (needsVisibilityMemory) {
        const sampleCount = 128;
        const visibilityKey = `${Number(postGameFreeRoam)}:${effect.x}:${effect.y}:${effect.radius}`;
        let cachedVisibility = this.smokeVisibilityCache.get(effect.id);
        if (cachedVisibility?.key !== visibilityKey ||
            visionNow - (cachedVisibility.updatedAt ?? -Infinity) >= visibilityRefreshInterval) {
          cachedVisibility = {
            key: visibilityKey,
            updatedAt: visionNow,
            visible: getSmokeVisibleSamples(effect, this.currentVisions, sampleCount,
              (point, vision) => isPointVisible(point, vision, visionObjects),
              postGameFreeRoam || effect.ownerId === this.getActivePlayerId()),
          };
          this.smokeVisibilityCache.set(effect.id, cachedVisibility);
        }
        memory = rememberSmokeObservation(
          this.rememberedSmokes, effect, cachedVisibility.visible, now,
        );
      }
      const localTeam = this.getLocalTeam();
      const directlyVisible = isDirectlyVisible(effect);
      const gadgetJammed = isGadgetJammed(effect, now);
      const isKnownMine = effect.triggerOnEnemyProximity === true &&
        (directlyVisible || (!gadgetJammed &&
          ((!this.isActivePlayerJammed(now) && effect.team === localTeam) ||
            (!this.isActivePlayerJammed(now) && (this.roomState?.hostId === this.playerId
              ? this.hostMineIntelByTeam[localTeam]?.has(effect.id)
              : this.localKnownMineIds.has(effect.id))))));
      const isKnownSpyCamera = effect.type === SPY_CAMERA_ID &&
        (directlyVisible || (!this.isActivePlayerJammed(now) && !gadgetJammed && effect.team === localTeam));
      const isKnownTrophySystem = effect.type === TROPHY_SYSTEM_ID &&
        (directlyVisible || (!this.isActivePlayerJammed(now) && !gadgetJammed && effect.team === localTeam));
      const isKnownSonar = effect.type === 'sonar-projectile' &&
        !this.isActivePlayerJammed(now) && !gadgetJammed &&
        effect.team === localTeam && this.localKnownMineIds.has(effect.id) &&
        this.players.get(effect.ownerId)?.alive;
      const isKnownKatanaDash = effect.type === 'katana-dash' &&
        (postGameFreeRoam || effect.ownerId === this.getActivePlayerId() ||
          effect.team === localTeam || this.currentVisions.some((vision) =>
          isPointVisible(effect, vision, visionObjects)));
      if (!memory?.known && !isKnownMine && !isKnownSpyCamera && !isKnownTrophySystem &&
          !isKnownSonar && !isKnownKatanaDash) continue;
      const rememberedEffect = isKnownMine || isKnownSpyCamera || isKnownTrophySystem ||
        isKnownSonar || isKnownKatanaDash
        ? effect : memory.smoke;
      const color = GADGET_DEFINITIONS[effect.gadgetId]?.colorHex ?? 0x85898d;
      const teamColor = rememberedEffect.team === this.getLocalTeam() ? ALLY_PLAYER_COLOR : ENEMY_PLAYER_COLOR;
      if (effect.type === 'katana-dash') {
        const progress = Math.max(0, Math.min(1,
          (now - effect.startedAt) / Math.max(1, effect.expiresAt - effect.startedAt)));
        const alpha = 1 - progress;
        graphics.lineStyle(18, 0xffffff, 0.12 * alpha)
          .lineBetween(effect.startX, effect.startY, effect.endX, effect.endY);
        graphics.lineStyle(9, 0xffffff, 0.3 * alpha)
          .lineBetween(effect.startX, effect.startY, effect.endX, effect.endY);
        graphics.lineStyle(3, 0xffffff, 0.96 * alpha)
          .lineBetween(effect.startX, effect.startY, effect.endX, effect.endY);
        graphics.lineStyle(4, 0xffffff, 0.88 * alpha);
        graphics.beginPath();
        graphics.arc(effect.endX, effect.endY, KATANA_DASH_HIT_RADIUS * 0.65,
          effect.angle - Math.PI * 0.68, effect.angle + Math.PI * 0.68, false);
        graphics.strokePath();
        graphics.lineStyle(2, teamColor, alpha)
          .strokeCircle(effect.endX, effect.endY, KATANA_DASH_HIT_RADIUS);
        continue;
      }
      if (effect.type === TROPHY_SYSTEM_COMMAND_EFFECT_ID) {
        const progress = Math.max(0, Math.min(1,
          (now - effect.startedAt) / Math.max(1, effect.expiresAt - effect.startedAt)));
        const pulseRadius = effect.radius * (0.25 + 0.75 * progress);
        const alpha = 1 - progress;
        graphics.fillStyle(color, 0.18 * alpha)
          .fillCircle(rememberedEffect.x, rememberedEffect.y, pulseRadius);
        graphics.lineStyle(3, color, 0.9 * alpha)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, pulseRadius);
        graphics.lineStyle(1.5, 0xffffff, 0.85 * alpha)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, pulseRadius * 0.78);
        continue;
      }
      if (effect.type === 'jammer') {
        let seed = 2166136261;
        for (let index = 0; index < effect.id.length; index += 1) {
          seed = Math.imul(seed ^ effect.id.charCodeAt(index), 16777619);
        }
        seed ^= Math.floor((now - (effect.startedAt ?? now)) / 50);
        const random = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 0x1_0000_0000;
        };
        const centerX = rememberedEffect.x;
        const centerY = rememberedEffect.y;
        const radius = rememberedEffect.radius;
        graphics.fillStyle(0xb178ff, 0.24).fillCircle(
          centerX, centerY, radius,
        );
        graphics.fillStyle(0xf0e4ff, 0.34);
        for (let index = 0; index < 48; index += 1) {
          const angle = random() * Math.PI * 2;
          const distance = Math.sqrt(random()) * radius;
          const size = 1 + random() * 2;
          graphics.fillRect(
            centerX + Math.cos(angle) * distance,
            centerY + Math.sin(angle) * distance,
            size,
            size,
          );
        }
        graphics.fillStyle(0x341750, 0.3);
        for (let index = 0; index < 32; index += 1) {
          const angle = random() * Math.PI * 2;
          const distance = Math.sqrt(random()) * radius;
          const size = 1 + random() * 2;
          graphics.fillRect(
            centerX + Math.cos(angle) * distance,
            centerY + Math.sin(angle) * distance,
            size,
            size,
          );
        }
        graphics.lineStyle(1, 0xd8c2ff, 0.22);
        for (let index = 0; index < 6; index += 1) {
          const y = (random() * 2 - 1) * radius;
          const chord = Math.sqrt(Math.max(0, radius * radius - y * y));
          const startX = (random() * 2 - 1) * chord;
          const endX = Math.min(chord, startX + 8 + random() * 36);
          graphics.lineBetween(centerX + startX, centerY + y, centerX + endX, centerY + y);
        }
        continue;
      }
      if (effect.type === 'sonar-projectile') {
        const pulse = (Math.sin(now / 85) + 1) / 2;
        graphics.lineStyle(1.5, 0x73f4ff, 0.25 + pulse * 0.35)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, 8 + pulse * 3);
        graphics.fillStyle(0x133c50, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, 4);
        graphics.lineStyle(1.5, 0x8df6ff, 0.98).strokeCircle(rememberedEffect.x, rememberedEffect.y, 4);
        graphics.fillStyle(0xd8fdff, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, 1.5);
        continue;
      }
      if (effect.type === VINE_TRAP_ID) {
        const vineRadius = effect.triggerRadius ?? effect.radius ?? PROXIMITY_MINE_BODY_RADIUS;
        const pulse = (Math.sin(now / 170) + 1) / 2;
        if (effect.latchedEnemyId) {
          graphics.fillStyle(color, 0.08 + pulse * 0.05)
            .fillCircle(rememberedEffect.x, rememberedEffect.y, vineRadius);
          graphics.lineStyle(2, color, 0.55 + pulse * 0.3)
            .strokeCircle(rememberedEffect.x, rememberedEffect.y, vineRadius);
          const latchedPlayer = this.players.get(effect.latchedEnemyId);
          const canSeeLatchedPlayer = latchedPlayer && (postGameFreeRoam ||
            this.currentVisions.some((vision) => isPointVisible(latchedPlayer, vision, visionObjects)));
          if (canSeeLatchedPlayer) {
            graphics.lineStyle(4, 0x347c32, 0.9)
              .lineBetween(rememberedEffect.x, rememberedEffect.y, latchedPlayer.x, latchedPlayer.y);
            graphics.lineStyle(1.5, 0xa4e66e, 0.95)
              .lineBetween(rememberedEffect.x, rememberedEffect.y, latchedPlayer.x, latchedPlayer.y);
          }
        }
        graphics.fillStyle(0x244b24, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, 4);
        for (let index = 0; index < 5; index += 1) {
          const angle = index * Math.PI * 2 / 5 - Math.PI / 2;
          const branchX = rememberedEffect.x + Math.cos(angle) * 9;
          const branchY = rememberedEffect.y + Math.sin(angle) * 9;
          const leafX = rememberedEffect.x + Math.cos(angle + 0.45) * 6;
          const leafY = rememberedEffect.y + Math.sin(angle + 0.45) * 6;
          graphics.lineStyle(2, 0x397d35, 0.98)
            .lineBetween(rememberedEffect.x, rememberedEffect.y, branchX, branchY);
          graphics.fillStyle(0x78c850, 0.98).fillCircle(branchX, branchY, 2.5);
          graphics.fillStyle(0x56a943, 0.96).fillCircle(leafX, leafY, 2);
        }
        graphics.lineStyle(1.5, teamColor, 0.95)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, 6);
        continue;
      }
      if (effect.type === BIO_FIELD_ID) {
        const radius = effect.radius ?? DEFAULT_GADGET_EFFECT_RADIUS;
        const progress = Math.max(0, Math.min(1,
          (now - effect.startedAt) / Math.max(1, effect.expiresAt - effect.startedAt)));
        const pulse = (Math.sin(now / 170) + 1) / 2;
        graphics.fillStyle(color, 0.14 + pulse * 0.06).fillCircle(
          rememberedEffect.x, rememberedEffect.y, radius,
        );
        graphics.lineStyle(3, teamColor, 0.9).strokeCircle(
          rememberedEffect.x, rememberedEffect.y, radius,
        );
        graphics.lineStyle(1.5, color, 0.38 + pulse * 0.24)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, radius * (0.62 + pulse * 0.05));
        graphics.lineStyle(1.5, color, 0.45 * (1 - progress * 0.35));
        for (let spoke = 0; spoke < 6; spoke += 1) {
          const angle = spoke * Math.PI / 3 + now / 1_800;
          const inner = radius * 0.78;
          graphics.lineBetween(
            rememberedEffect.x + Math.cos(angle) * inner,
            rememberedEffect.y + Math.sin(angle) * inner,
            rememberedEffect.x + Math.cos(angle + 0.1) * radius,
            rememberedEffect.y + Math.sin(angle + 0.1) * radius,
          );
        }
        graphics.fillStyle(color, 0.72).fillCircle(rememberedEffect.x, rememberedEffect.y, 3);
        continue;
      }
      if (effect.type === SPY_CAMERA_ID) {
        const radius = effect.radius ?? SPY_CAMERA_BODY_RADIUS;
        const disabled = Number.isFinite(effect.disabledUntil) && effect.disabledUntil > now;
        const lensX = rememberedEffect.x + Math.cos(effect.angle ?? 0) * radius * 0.55;
        const lensY = rememberedEffect.y + Math.sin(effect.angle ?? 0) * radius * 0.55;
        graphics.fillStyle(0x17232d, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(1.5, disabled ? 0x89919a : teamColor, 0.98)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(1.5, disabled ? 0x89919a : color, 0.95)
          .lineBetween(rememberedEffect.x, rememberedEffect.y, lensX, lensY);
        graphics.fillStyle(disabled ? 0x89919a : color, 0.98)
          .fillCircle(lensX, lensY, Math.max(1.5, radius * 0.28));
        continue;
      }
      if (effect.type === TROPHY_SYSTEM_ID) {
        const radius = effect.radius ?? TROPHY_SYSTEM_BODY_RADIUS;
        const pulse = (Math.sin(now / 190) + 1) / 2;
        graphics.lineStyle(1.5, color, 0.18 + pulse * 0.22)
          .strokeCircle(rememberedEffect.x, rememberedEffect.y, radius + 4 + pulse * 2);
        graphics.fillStyle(0x28251d, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(1.5, teamColor, 0.98).strokeCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(2, color, 0.98)
          .lineBetween(rememberedEffect.x - radius * 0.55, rememberedEffect.y,
            rememberedEffect.x + radius * 0.55, rememberedEffect.y)
          .lineBetween(rememberedEffect.x, rememberedEffect.y - radius * 0.55,
            rememberedEffect.x, rememberedEffect.y + radius * 0.55);
        graphics.fillStyle(0xffe09a, 0.98).fillCircle(rememberedEffect.x, rememberedEffect.y, 2);
        continue;
      }
      if (effect.type === 'mine-explosion') {
        const progress = Math.max(0, Math.min(1, (now - effect.startedAt) / Math.max(1, effect.expiresAt - effect.startedAt)));
        const radius = effect.radius * (0.3 + 0.7 * progress);
        const alpha = 1 - progress;
        graphics.fillStyle(color, 0.34 * alpha).fillCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(4, teamColor, alpha).strokeCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.fillStyle(0xfff1c2, alpha).fillCircle(rememberedEffect.x, rememberedEffect.y, 6 * alpha);
        continue;
      }
      if (effect.type === 'orbital-strike-explosion') {
        const progress = Math.max(0, Math.min(1,
          (now - effect.startedAt) / Math.max(1, effect.expiresAt - effect.startedAt)));
        const radius = effect.radius * (0.2 + 0.8 * progress);
        const alpha = 1 - progress;
        graphics.fillStyle(color, 0.42 * alpha).fillCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.lineStyle(4, 0xffd7a3, alpha).strokeCircle(rememberedEffect.x, rememberedEffect.y, radius);
        graphics.fillStyle(0xffffff, alpha).fillCircle(rememberedEffect.x, rememberedEffect.y, 8 * alpha);
        continue;
      }
      if (effect.type === 'mine') {
        const armed = isProximityMineArmed(effect, now);
        if (armed) {
          const pulse = (Math.sin(now / 180) + 1) / 2;
          graphics.fillStyle(0xf04b42, 0.12 + pulse * 0.1).fillCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS * (1.875 + pulse * 0.375),
          );
          graphics.fillStyle(0x5b1718, 0.98).fillCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS,
          );
          graphics.lineStyle(1.5, teamColor, 0.98).strokeCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS,
          );
          graphics.fillStyle(0xff776d, 0.95).fillCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS * 0.375,
          );
        } else {
          graphics.fillStyle(0x20242a, 0.96).fillCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS,
          );
          graphics.lineStyle(1.5, teamColor, 0.98).strokeCircle(
            rememberedEffect.x, rememberedEffect.y, PROXIMITY_MINE_BODY_RADIUS,
          );
          graphics.lineStyle(1, 0x9ba2aa, 0.8)
            .lineBetween(
              rememberedEffect.x - PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.y - PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.x + PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.y + PROXIMITY_MINE_BODY_RADIUS * 0.625,
            )
            .lineBetween(
              rememberedEffect.x + PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.y - PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.x - PROXIMITY_MINE_BODY_RADIUS * 0.625,
              rememberedEffect.y + PROXIMITY_MINE_BODY_RADIUS * 0.625,
            );
        }
        continue;
      }
      graphics.fillStyle(color, 0.62).fillCircle(rememberedEffect.x, rememberedEffect.y, rememberedEffect.radius);
      graphics.lineStyle(3, teamColor, 0.95)
        .strokeCircle(rememberedEffect.x, rememberedEffect.y, rememberedEffect.radius);
    }
    for (const pending of this.match?.pendingGadgetEffects ?? []) {
      const effect = pending.effect;
      if (effect?.type === 'orbital-strike-warning' && pending.detonatesAt > now) {
        const pulse = 0.58 + (Math.sin(now / 85) + 1) * 0.18;
        graphics.fillStyle(0xff3d2e, 0.12).fillCircle(effect.x, effect.y, effect.radius);
        graphics.lineStyle(3, 0xff4b38, pulse).strokeCircle(effect.x, effect.y, effect.radius);
        graphics.lineStyle(1.5, 0xffe0b2, pulse)
          .lineBetween(effect.x - 8, effect.y, effect.x + 8, effect.y)
          .lineBetween(effect.x, effect.y - 8, effect.x, effect.y + 8);
        continue;
      }
      if (effect?.type !== 'flash' || pending.landedAt > now || pending.detonatesAt <= now) continue;
      const visible = postGameFreeRoam || effect.ownerId === this.getActivePlayerId() ||
        this.currentVisions.some((vision) => isPointVisible(effect, vision, visionObjects));
      if (!visible) continue;
      const pulse = 0.75 + (Math.sin(now / 90) + 1) * 0.125;
      const teamColor = effect.team === this.getLocalTeam() ? ALLY_PLAYER_COLOR : ENEMY_PLAYER_COLOR;
      graphics.fillStyle(0x20242a, 0.98).fillCircle(effect.x, effect.y, 7);
      graphics.lineStyle(1.5, teamColor, 0.98).strokeCircle(effect.x, effect.y, 7);
      graphics.fillStyle(0xffee9b, pulse).fillCircle(effect.x, effect.y, 2.5);
      graphics.lineStyle(1, 0xf4f7ff, 0.85)
        .lineBetween(effect.x - 3.5, effect.y, effect.x + 3.5, effect.y)
        .lineBetween(effect.x, effect.y - 3.5, effect.x, effect.y + 3.5);
    }
    const snapshotInterceptionIds = new Set(effects
      .filter((effect) => effect.type === 'trophy-intercept-visual')
      .map((effect) => effect.projectileId));
    for (const [id, impact] of this.trophyInterceptVisuals) {
      const progress = (now - impact.startedAt) / TROPHY_INTERCEPT_VISUAL_DURATION_MS;
      if (progress >= 1) {
        this.trophyInterceptVisuals.delete(id);
        continue;
      }
      if (snapshotInterceptionIds.has(impact.projectileId)) continue;
      drawTrophyInterceptVisual(impact);
    }
    pruneSmokeMemory(this.smokeVisibilityCache, activeSmokeIds);
    pruneSmokeMemory(this.rememberedSmokes, activeSmokeIds);
  }

  isPlayerFlashBlinded(player, now = Date.now()) {
    if (!player || player.alive === false || (player.health ?? 100) <= 0) return false;
    return hasFlashBlindness(player, now);
  }

  isActivePlayerJammed(now = Date.now()) {
    return isPlayerJammed(this.players.get(this.getActivePlayerId()), now);
  }

  drawFlashEffects() {
    if (!this.match || !this.exploredCells || !this.add) return;
    const now = Date.now();
    const activeVisualIds = new Set();
    const visionObjects = this.getVisionObjects();
    const cellSize = VISION_MEMORY_CELL_SIZE;
    const gadgetEffects = this.match.gadgetEffects ?? [];
    recordMatchReportWork(this.matchReport, 'frameOverlays.gadgetEffects', gadgetEffects.length);
    for (const effect of gadgetEffects) {
      if (effect.type !== 'flash' || effect.startedAt > now) continue;
      const elapsed = now - effect.startedAt;
      if (elapsed >= FLASH_GRENADE_VISUAL_DURATION_MS) continue;
      activeVisualIds.add(effect.id);
      let visual = this.flashVisuals.get(effect.id);
      if (!visual) {
        const flashVisionStartedAt = performance.now();
        const vision = createVision(
          { x: effect.x, y: effect.y },
          0,
          visionObjects,
          this.mapWidth,
          this.mapHeight,
          Math.PI,
          effect.radius,
        );
        this.recordUpdatePhase('frameOverlays.flashVision', flashVisionStartedAt);
        const graphics = this.add.graphics().setDepth(8);
        graphics.fillStyle(0xffffff, 0.95);
        const minCellX = Math.max(0, Math.floor((effect.x - effect.radius) / cellSize));
        const maxCellX = Math.min(this.intelColumns - 1, Math.floor((effect.x + effect.radius) / cellSize));
        const minCellY = Math.max(0, Math.floor((effect.y - effect.radius) / cellSize));
        const maxCellY = Math.min(this.intelRows - 1, Math.floor((effect.y + effect.radius) / cellSize));
        for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
          const centerY = (cellY + 0.5) * cellSize;
          const intervals = getVisionPolygonScanlineIntervals(vision, centerY);
          for (const [left, right] of intervals) {
            const startCellX = Math.max(minCellX, Math.ceil(left / cellSize - 0.5));
            const endCellX = Math.min(maxCellX + 1, Math.ceil(right / cellSize - 0.5));
            let runStart = -1;
            for (let cellX = startCellX; cellX < endCellX; cellX += 1) {
              const isExplored = this.exploredCells[cellY * this.intelColumns + cellX] !== 0;
              if (isExplored && runStart < 0) {
                runStart = cellX;
              } else if (!isExplored && runStart >= 0) {
                graphics.fillRect(
                  runStart * cellSize, cellY * cellSize,
                  (cellX - runStart) * cellSize, cellSize,
                );
                runStart = -1;
              }
            }
            if (runStart >= 0) {
              graphics.fillRect(
                runStart * cellSize, cellY * cellSize,
                (endCellX - runStart) * cellSize, cellSize,
              );
            }
          }
        }
        visual = { graphics };
        this.flashVisuals.set(effect.id, visual);
      }
      const progress = Math.max(0, Math.min(1, elapsed / FLASH_GRENADE_VISUAL_DURATION_MS));
      visual.graphics.setAlpha((1 - progress) ** 2);
    }
    recordMatchReportWork(this.matchReport, 'frameOverlays.activeFlashEffects', activeVisualIds.size);
    for (const [id, visual] of this.flashVisuals) {
      if (activeVisualIds.has(id)) continue;
      visual.graphics.destroy();
      this.flashVisuals.delete(id);
    }
  }

  getVisionObjects() {
    const smokeList = this.match?.smokes;
    const smokeCount = smokeList?.length ?? 0;
    const now = Date.now();
    const previousSmokeSnapshot = this.visionObjectsSmokeSnapshot;
    let smokeChanged = this.visionObjectsMap !== this.mapObjects ||
      !previousSmokeSnapshot || previousSmokeSnapshot.length !== smokeCount ||
      now >= this.visionObjectsNextSmokeExpiryAt;
    for (let index = 0; !smokeChanged && index < smokeCount; index += 1) {
      const smoke = smokeList[index];
      const previousSmoke = previousSmokeSnapshot[index];
      smokeChanged = !Object.is(previousSmoke.id, smoke.id) ||
        !Object.is(previousSmoke.x, smoke.x) || !Object.is(previousSmoke.y, smoke.y) ||
        !Object.is(previousSmoke.radius, smoke.radius) ||
        !Object.is(previousSmoke.expiresAt, smoke.expiresAt);
    }
    if (!smokeChanged) {
      return this.visionObjectsCache;
    }
    const activeSmoke = [];
    const smokeSnapshot = [];
    let nextSmokeExpiryAt = Infinity;
    for (let index = 0; index < smokeCount; index += 1) {
      const smoke = smokeList[index];
      smokeSnapshot.push({
        id: smoke.id,
        x: smoke.x,
        y: smoke.y,
        radius: smoke.radius,
        expiresAt: smoke.expiresAt,
      });
      if (smoke.expiresAt > now) {
        activeSmoke.push(smoke);
        nextSmokeExpiryAt = Math.min(nextSmokeExpiryAt, smoke.expiresAt);
      }
    }
    this.visionObjectsMap = this.mapObjects;
    this.visionObjectsSmokeSnapshot = smokeSnapshot;
    this.visionObjectsNextSmokeExpiryAt = nextSmokeExpiryAt;
    this.visionObjectsCache = activeSmoke.length ? [...this.mapObjects, ...activeSmoke] : this.mapObjects;
    return this.visionObjectsCache;
  }

  getAimRayEnd(origin, angle, range, projectileRadius) {
    return getMapRayEnd(origin, angle, range, this.mapObjects, projectileRadius);
  }

  showProjectile(projectile) {
    if (!this.add || !projectile?.start || !projectile?.end) return;
    if (![projectile.start.x, projectile.start.y, projectile.end.x, projectile.end.y].every(Number.isFinite)) {
      console.error(`Unable to render projectile ${projectile.id ?? 'without an id'}: its trajectory is not finite.`);
      return;
    }
    const destructibleHit = typeof projectile.objectId === 'string';
    const localTeam = this.getLocalTeam();
    const isLocalShot = projectile.ownerId === this.getActivePlayerId();
    const matchedPrediction = !projectile.predicted && isLocalShot &&
      consumePredictedShotPellet(this.predictedShotPellets, projectile);
    const predictionKey = Number.isSafeInteger(projectile.ownerActionSequence)
      ? `${projectile.ownerId}:${projectile.ownerActionSequence}:${projectile.pelletIndex ?? 0}` : null;
    let predictedVisualActive = false;
    if (matchedPrediction && predictionKey) {
      const predicted = this.predictedProjectileVisuals.get(predictionKey);
      if (predicted) {
        predictedVisualActive = true;
        predicted.tween.stop();
        predicted.tracer.destroy();
        this.predictedProjectileVisuals.delete(predictionKey);
      }
    }
    const shooter = this.players.get(projectile.ownerId);
    const shotStart = isLocalShot && !matchedPrediction && shooter && Number.isFinite(projectile.aimAngle)
      ? getWeaponMuzzlePosition(getRenderedPosition(shooter), projectile.aimAngle, shooter.weaponLean, this.mapObjects)
      : projectile.start;
    const visibleIntervals = localTeam
      ? this.getVisibleProjectileIntervals(shotStart, projectile.end)
      : [[0, 1]];
    this.playShotSound(projectile);
    if (visibleIntervals.length === 0) return;
    if (!shouldRenderConfirmedProjectile(matchedPrediction, predictedVisualActive)) {
      const visibleImpact = !localTeam || visibleIntervals.some(([, end]) => end >= 1 - 1e-6);
      if (projectile.hitType && visibleImpact) {
        if (destructibleHit) this.showObjectHit(projectile.end);
        else this.showImpact(projectile.end, projectile.hitEnemy === true);
      }
      return;
    }
    const tracer = this.add.graphics().setDepth(6);
    const dx = projectile.end.x - shotStart.x;
    const dy = projectile.end.y - shotStart.y;
    const distance = Math.hypot(dx, dy);
    const duration = Math.max(80, Math.min(100, distance / Math.max(projectile.speed ?? 20_000, 1) * 1000));
    const tween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      onUpdate: (tween) => {
        const progress = tween.getValue();
        tracer.clear();
        tracer.lineStyle(3, 0xffe89a, 0.95);
        tracer.fillStyle(0xffffff, 1);
        for (const [visibleStart, visibleEnd] of visibleIntervals) {
          if (progress <= visibleStart) continue;
          const endT = Math.min(progress, visibleEnd);
          const segmentStart = {
            x: shotStart.x + dx * visibleStart,
            y: shotStart.y + dy * visibleStart,
          };
          const segmentEnd = {
            x: shotStart.x + dx * endT,
            y: shotStart.y + dy * endT,
          };
          tracer.lineBetween(segmentStart.x, segmentStart.y, segmentEnd.x, segmentEnd.y);
          tracer.fillCircle(segmentEnd.x, segmentEnd.y, 2.5);
        }
      },
      onComplete: () => {
        tracer.destroy();
        const visibleImpact = !localTeam || visibleIntervals.some(([, end]) => end >= 1 - 1e-6);
        if (projectile.hitType && visibleImpact) {
          if (destructibleHit) this.showObjectHit(projectile.end);
          else this.showImpact(projectile.end, projectile.hitEnemy === true);
        }
        if (projectile.predicted && predictionKey &&
            this.predictedProjectileVisuals.get(predictionKey)?.tween === tween) {
          this.predictedProjectileVisuals.delete(predictionKey);
        }
      },
    });
    if (projectile.predicted && predictionKey) {
      this.predictedProjectileVisuals.set(predictionKey, { tracer, tween });
    }
  }

  playShotSound(projectile) {
    if (typeof projectile.ownerId !== 'string' || (!Number.isSafeInteger(projectile.ownerActionSequence) &&
        projectile.pelletIndex > 0)) return;
    const shotKey = Number.isSafeInteger(projectile.ownerActionSequence)
      ? `${projectile.ownerId}:${projectile.ownerActionSequence}`
      : projectile.id;
    if (typeof shotKey !== 'string' || this.playedShotSoundKeys.has(shotKey)) return;
    this.playedShotSoundKeys.add(shotKey);
    if (this.playedShotSoundKeys.size > 512) {
      this.playedShotSoundKeys.delete(this.playedShotSoundKeys.values().next().value);
    }
    const weaponId = projectile.type ?? this.players.get(projectile.ownerId)?.selectedWeaponId;
    const soundName = getWeaponSoundName(weaponId);
    const baseVolume = SHOT_SOUND_WEAPON_VOLUME_OVERRIDES[weaponId] ??
      SHOT_SOUND_BASE_VOLUMES[soundName];
    const listener = this.players.get(this.getActivePlayerId());
    if (listener) playSpatialGameSound(soundName, baseVolume, projectile.start, listener);
    else if (projectile.ownerId === this.getActivePlayerId()) playGameSound(soundName, baseVolume);
    const weapon = WEAPON_DEFINITIONS_BY_ID.get(weaponId);
    if (weapon?.manualActionDurationMs && Number.isFinite(projectile.start?.x) &&
        Number.isFinite(projectile.start?.y)) {
      const source = { id: projectile.ownerId, x: projectile.start.x, y: projectile.start.y };
      const weaponState = this.players.get(projectile.ownerId)?.weaponStats?.[weaponId];
      this.scheduleManualActionSound(
        this.players.get(projectile.ownerId) ?? source,
        weapon,
        weaponState,
        source,
      );
    }
  }

  playGadgetEffectSound(effect) {
    if (!isGadgetEffectSoundAudibleToTeam(effect, this.getLocalTeam())) return;
    if (effect?.type === 'katana-dash') {
      if (typeof effect.id !== 'string' || this.playedGadgetSoundIds.has(effect.id)) return;
      this.playedGadgetSoundIds.add(effect.id);
      if (this.playedGadgetSoundIds.size > 512) {
        this.playedGadgetSoundIds.delete(this.playedGadgetSoundIds.values().next().value);
      }
      const listener = this.players.get(this.getActivePlayerId());
      if (listener) playKatanaDashSound(effect, listener);
      return;
    }
    if (effect?.type === 'sonar-projectile') {
      if (typeof effect.id !== 'string' || this.playedGadgetSoundIds.has(effect.id)) return;
      this.playedGadgetSoundIds.add(effect.id);
      if (this.playedGadgetSoundIds.size > 512) {
        this.playedGadgetSoundIds.delete(this.playedGadgetSoundIds.values().next().value);
      }
      const listener = this.players.get(this.getActivePlayerId());
      if (listener) playSonarCastSound(effect, listener);
      return;
    }
    const soundName = getGadgetEffectSoundName(effect);
    if (!soundName || typeof effect.id !== 'string' || this.playedGadgetSoundIds.has(effect.id)) return;
    this.playedGadgetSoundIds.add(effect.id);
    if (this.playedGadgetSoundIds.size > 512) {
      this.playedGadgetSoundIds.delete(this.playedGadgetSoundIds.values().next().value);
    }
    const listener = this.players.get(this.getActivePlayerId());
    if (listener) {
      if (effect.type === 'jammer') {
        playJammerStaticSound(effect, listener, GADGET_SOUND_BASE_VOLUMES[soundName]);
      } else {
        playSpatialGameSound(soundName, GADGET_SOUND_BASE_VOLUMES[soundName], effect, listener);
      }
    }
  }

  playReloadSoundEvents(player, weapon, previousState, nextState) {
    if (Number.isFinite(nextState?.manualActionEndsAt) &&
        nextState.manualActionStartedAt !== previousState?.manualActionStartedAt) {
      this.scheduleManualActionSound(player, weapon, nextState);
    }
    for (const event of getReloadSoundEvents(weapon, previousState, nextState)) {
      const eventKey = `${this.match?.startedAt}:${player.id}:${weapon.id}:${event.eventKey}`;
      if (this.playedWeaponSoundEventKeys.has(eventKey)) continue;
      this.playedWeaponSoundEventKeys.add(eventKey);
      if (this.playedWeaponSoundEventKeys.size > 512) {
        this.playedWeaponSoundEventKeys.delete(this.playedWeaponSoundEventKeys.values().next().value);
      }
      this.scheduleWeaponMechanicalSound(
        event.soundName,
        player,
        RELOAD_SOUND_BASE_VOLUMES[event.soundName],
        event.actionStartedAt,
        event.actionDurationMs,
      );
    }
  }

  scheduleManualActionSound(player, weapon, state, source = player) {
    const actionSoundName = getManualActionSoundName(weapon?.id);
    if (!actionSoundName || !Number.isFinite(state?.manualActionStartedAt) ||
        !Number.isFinite(weapon?.manualActionDurationMs)) return;
    const eventKey = `${this.match?.startedAt}:${player.id}:${weapon.id}:manual:${state.manualActionStartedAt}`;
    if (this.playedWeaponSoundEventKeys.has(eventKey)) return;
    this.playedWeaponSoundEventKeys.add(eventKey);
    if (this.playedWeaponSoundEventKeys.size > 512) {
      this.playedWeaponSoundEventKeys.delete(this.playedWeaponSoundEventKeys.values().next().value);
    }
    this.scheduleWeaponMechanicalSound(
      actionSoundName,
      source,
      MANUAL_ACTION_SOUND_BASE_VOLUME,
      state.manualActionStartedAt,
      weapon.manualActionDurationMs,
    );
  }

  scheduleWeaponMechanicalSound(soundName, source, volume, actionStartedAt, actionDurationMs) {
    const delayMs = Math.max(
      0,
      getGameSoundStartDelayMs(soundName, actionDurationMs) -
        (Number.isFinite(actionStartedAt) ? Math.max(0, Date.now() - actionStartedAt) : 0),
    );
    if (delayMs === 0) {
      this.playWeaponMechanicalSound(soundName, source, volume);
      return;
    }
    setTimeout(() => this.playWeaponMechanicalSound(soundName, source, volume), delayMs);
  }

  playWeaponMechanicalSound(soundName, source, volume) {
    const listener = this.players.get(this.getActivePlayerId());
    if (listener) playSpatialGameSound(soundName, volume, source, listener);
    else if (source?.id === this.getActivePlayerId()) playGameSound(soundName, volume);
  }

  syncFlagSoundState(flag) {
    const matchId = this.match?.startedAt;
    if (matchId === undefined || matchId === null) return;
    if (this.flagSoundMatchId !== matchId) {
      this.flagSoundMatchId = matchId;
      this.flagSoundHolderId = flag?.heldBy ?? null;
      return;
    }
    const soundName = getFlagTransitionSound(this.flagSoundHolderId, flag);
    this.flagSoundHolderId = flag?.heldBy ?? null;
    if (!soundName) return;
    const listener = this.players.get(this.getActivePlayerId());
    if (listener) {
      const volume = soundName === 'flag-pickup' ? 0.28 : 0.32;
      playSpatialGameSound(soundName, volume, flag, listener);
    }
  }

  playOutcomeSounds(victory, quickPlayState) {
    const sounds = getOutcomeSoundNames(victory, quickPlayState, this.getLocalTeam());
    if (!sounds || !this.match) return;
    const resultKey = `${this.match.startedAt}:${victory.at ?? `${victory.winner}:${victory.reason ?? ''}`}`;
    if (!this.playedMatchOutcomeKeys.has(resultKey)) {
      this.playedMatchOutcomeKeys.add(resultKey);
      if (this.playedMatchOutcomeKeys.size > 512) {
        this.playedMatchOutcomeKeys.delete(this.playedMatchOutcomeKeys.values().next().value);
      }
      playGameSound(sounds.match, 0.36);
    }
    if (sounds.game && !this.playedSeriesOutcomeKeys.has(resultKey)) {
      this.playedSeriesOutcomeKeys.add(resultKey);
      if (this.playedSeriesOutcomeKeys.size > 512) {
        this.playedSeriesOutcomeKeys.delete(this.playedSeriesOutcomeKeys.values().next().value);
      }
      setTimeout(() => playGameSound(sounds.game, 0.42), 650);
    }
  }

  applyGadgetEvent(event, projectileId) {
    const points = event?.trajectory?.points;
    const ownerId = event?.ownerId ?? event?.smoke?.ownerId;
    const gadgetId = event?.gadgetId ?? event?.smoke?.gadgetId;
    if (!Array.isArray(points) || points.length < 2 ||
        typeof ownerId !== 'string' || typeof gadgetId !== 'string' ||
        points.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) return;
    if (typeof projectileId === 'string' && this.cancelledGadgetProjectileIds.has(projectileId)) return;
    const lengths = [];
    const visibleIntervals = [];
    let totalLength = 0;
    const localTeam = this.getLocalTeam();
    const isLocalThrow = ownerId === this.getActivePlayerId();
    for (let index = 1; index < points.length; index += 1) {
      const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      lengths.push(length);
      totalLength += length;
      visibleIntervals.push(!localTeam || isLocalThrow
        ? [[0, 1]]
        : this.getVisibleProjectileIntervals(points[index - 1], points[index]));
    }
    if (localTeam && !isLocalThrow && visibleIntervals.every((intervals) => intervals.length === 0)) return;
    const tracer = this.add.graphics().setDepth(6.4);
    let tween;
    tween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: Math.max(16, totalLength /
        getGadgetProjectileSpeed(GADGET_DEFINITIONS[gadgetId]) * 1000),
      onUpdate: (tween) => {
        let remaining = totalLength * tween.getValue();
        tracer.clear();
        tracer.lineStyle(4, 0xb6f4f4, 0.88);
        let grenadePosition = points[0];
        let grenadeVisible = false;
        for (let index = 0; index < lengths.length; index += 1) {
          const start = points[index];
          const end = points[index + 1];
          const length = lengths[index];
          const fraction = length > 0 ? Math.min(1, remaining / length) : 1;
          for (const [visibleStart, visibleEnd] of visibleIntervals[index]) {
            const endT = Math.min(visibleEnd, fraction);
            if (endT > visibleStart) {
              tracer.lineBetween(
                start.x + (end.x - start.x) * visibleStart,
                start.y + (end.y - start.y) * visibleStart,
                start.x + (end.x - start.x) * endT,
                start.y + (end.y - start.y) * endT,
              );
            }
          }
          if (remaining <= length) {
            grenadePosition = {
              x: start.x + (end.x - start.x) * fraction,
              y: start.y + (end.y - start.y) * fraction,
            };
            grenadeVisible = !localTeam || isLocalThrow ||
              visibleIntervals[index].some(([visibleStart, visibleEnd]) =>
                fraction >= visibleStart && fraction <= visibleEnd);
          }
          remaining = Math.max(0, remaining - length);
        }
        if (grenadeVisible) tracer.fillStyle(0xffffff, 0.95).fillCircle(grenadePosition.x, grenadePosition.y, 4);
      },
      onComplete: () => {
        tracer.destroy();
        if (this.gadgetProjectileVisuals.get(projectileId)?.tween === tween) {
          this.gadgetProjectileVisuals.delete(projectileId);
        }
      },
    });
    if (typeof projectileId === 'string') this.gadgetProjectileVisuals.set(projectileId, { tracer, tween });
  }

  cancelGadgetProjectileVisual(projectileId) {
    if (typeof projectileId !== 'string') return;
    this.cancelledGadgetProjectileIds.add(projectileId);
    if (this.cancelledGadgetProjectileIds.size > 1_024) {
      this.cancelledGadgetProjectileIds.delete(this.cancelledGadgetProjectileIds.values().next().value);
    }
    const visual = this.gadgetProjectileVisuals.get(projectileId);
    if (!visual) return;
    this.gadgetProjectileVisuals.delete(projectileId);
    visual.tween.stop();
    visual.tracer.destroy();
  }

  getVisibleProjectileIntervals(start, end) {
    if (this.isPostGameFreeRoam()) return [[0, 1]];
    const intervals = [];
    for (const vision of this.currentVisions) {
      intervals.push(...getSegmentVisionIntervals(start, end, vision));
    }
    if (intervals.length < 2) return intervals;
    intervals.sort((left, right) => left[0] - right[0]);
    const merged = [intervals[0].slice()];
    for (let index = 1; index < intervals.length; index += 1) {
      const [startT, endT] = intervals[index];
      const previous = merged[merged.length - 1];
      if (startT <= previous[1] + 1e-9) previous[1] = Math.max(previous[1], endT);
      else merged.push([startT, endT]);
    }
    return merged;
  }

  applyAudioCue(cue) {
    if (!cue || typeof cue.id !== 'string' || !Number.isFinite(cue.x) || !Number.isFinite(cue.y) ||
        !Number.isFinite(cue.radius) || cue.radius <= 0 || !Number.isFinite(cue.expiresAt)) return;
    const localTeam = this.getLocalTeam();
    const activePlayerId = this.getActivePlayerId();
    const personalCue = isPersonalAudioCueForViewer(cue, activePlayerId, this.playerId);
    if ((this.isActivePlayerJammed() && !personalCue) || !localTeam || cue.team !== localTeam) return;
    if (cue.sonarId && cue.heardById !== this.getActivePlayerId()) return;
    this.audioCues ??= new Map();
    this.audioCues.set(cue.id, {
      kind: cue.kind ?? 'gunshot',
      x: cue.x,
      y: cue.y,
      radius: cue.radius,
      expiresAt: cue.expiresAt,
      heardById: cue.heardById,
    });
  }

  applyPing(ping) {
    if (this.isActivePlayerJammed() || !ping || typeof ping.id !== 'string' ||
        ping.team !== this.getLocalTeam() ||
        !Number.isFinite(ping.x) || !Number.isFinite(ping.y) || !Number.isFinite(ping.expiresAt) ||
        ping.expiresAt <= Date.now()) return;
    this.pings.set(ping.id, { x: ping.x, y: ping.y, expiresAt: ping.expiresAt });
  }

  applyDamageCue(cue) {
    if (!cue || typeof cue.id !== 'string' || typeof cue.victimId !== 'string' ||
        (this.isActivePlayerJammed() &&
          !isPersonalDamageCueForViewer(cue, this.getActivePlayerId(), this.playerId)) ||
        cue.team !== this.getLocalTeam() || !Number.isFinite(cue.bearing) ||
        !Number.isFinite(cue.expiresAt) || cue.expiresAt <= Date.now()) return;
    const victim = this.players.get(cue.victimId);
    if (!victim || victim.team !== cue.team) return;
    this.damageIndicators.set(cue.victimId, {
      bearing: cue.bearing,
      expiresAt: cue.expiresAt,
    });
  }

  drawDamageIndicators() {
    const graphics = this.damageIndicatorGraphics;
    if (!graphics) return;
    graphics.clear();
    const now = Date.now();
    const activePlayerId = this.getActivePlayerId();
    const activePlayerJammed = this.isActivePlayerJammed(now);
    for (const [playerId, indicator] of this.damageIndicators) {
      if (activePlayerJammed && playerId !== activePlayerId) {
        this.damageIndicators.delete(playerId);
        continue;
      }
      const player = this.players.get(playerId);
      if (!player || indicator.expiresAt <= now) {
        this.damageIndicators.delete(playerId);
        continue;
      }
      const rendered = getRenderedPosition(player);
      const fade = Math.min(1, (indicator.expiresAt - now) / 350);
      const directionX = Math.cos(indicator.bearing);
      const directionY = Math.sin(indicator.bearing);
      const perpendicularX = -directionY;
      const perpendicularY = directionX;
      const tipRadius = PLAYER_RADIUS + 18;
      const tailRadius = PLAYER_RADIUS + 7;
      const tip = { x: rendered.x + directionX * tipRadius, y: rendered.y + directionY * tipRadius };
      const tail = { x: rendered.x + directionX * tailRadius, y: rendered.y + directionY * tailRadius };
      const headBase = { x: rendered.x + directionX * (tipRadius - 8), y: rendered.y + directionY * (tipRadius - 8) };
      const headLeft = { x: headBase.x + perpendicularX * 5, y: headBase.y + perpendicularY * 5 };
      const headRight = { x: headBase.x - perpendicularX * 5, y: headBase.y - perpendicularY * 5 };
      graphics.lineStyle(5, 0x32120c, 0.75 * fade).lineBetween(tail.x, tail.y, tip.x, tip.y);
      graphics.lineStyle(3, 0xff654d, fade)
        .lineBetween(tail.x, tail.y, tip.x, tip.y)
        .lineBetween(tip.x, tip.y, headLeft.x, headLeft.y)
        .lineBetween(tip.x, tip.y, headRight.x, headRight.y);
    }
  }

  drawPings() {
    const graphics = this.pingGraphics;
    if (!graphics) return;
    graphics.clear();
    if (this.isActivePlayerJammed()) {
      this.pings.clear();
      return;
    }
    if (!this.match || !this.pings.size) {
      this.pings.clear();
      return;
    }
    const now = Date.now();
    const pulse = 0.78 + Math.sin(now / 120) * 0.22;
    for (const [id, ping] of this.pings) {
      if (ping.expiresAt <= now) {
        this.pings.delete(id);
        continue;
      }
      const remaining = Math.min(1, (ping.expiresAt - now) / 450);
      const alpha = Math.min(pulse, remaining);
      const radius = 15 + pulse * 4;
      graphics.lineStyle(2.5, 0xffd12e, alpha).strokeCircle(ping.x, ping.y, radius);
      graphics.lineStyle(2, 0xffe36a, alpha)
        .lineBetween(ping.x - 6, ping.y, ping.x + 6, ping.y)
        .lineBetween(ping.x, ping.y - 6, ping.x, ping.y + 6);
      graphics.fillStyle(0xffd12e, alpha).fillCircle(ping.x, ping.y, 3);
    }
  }

  drawAudioCues() {
    const graphics = this.audioCueGraphics;
    if (!graphics) return;
    graphics.clear();
    if (!this.audioCues?.size) return;
    const now = Date.now();
    const localTeam = this.getLocalTeam();
    const activePlayerId = this.getActivePlayerId();
    const activePlayerJammed = this.isActivePlayerJammed(now);
    const players = [...this.players.values()];
    const playerVisibility = new Map();
    const isPlayerVisible = (player) => {
      if (!playerVisibility.has(player.id)) {
        playerVisibility.set(player.id, this.isPlayerVisible(player));
      }
      return playerVisibility.get(player.id);
    };
    for (const [id, cue] of this.audioCues) {
      const remaining = cue.expiresAt - now;
      if (remaining <= 0) {
        this.audioCues.delete(id);
        continue;
      }
      if (activePlayerJammed && cue.heardById !== activePlayerId) {
        this.audioCues.delete(id);
        continue;
      }
      if (isAudioCueSupersededByVisibleEnemy(cue, localTeam, players, isPlayerVisible)) {
        this.audioCues.delete(id);
        continue;
      }
      const fade = Math.min(1, remaining / 600);
      const footstep = cue.kind === 'footstep';
      const color = footstep ? 0xff4f5e : 0xffd477;
      const centerColor = footstep ? 0xffa0a8 : 0xffe6a5;
      graphics.lineStyle(footstep ? 1.5 : 1.25, color, (footstep ? 0.7 : 0.48) * fade)
        .strokeCircle(cue.x, cue.y, cue.radius);
      graphics.lineStyle(1, centerColor, 0.58 * fade)
        .lineBetween(cue.x - 4, cue.y, cue.x + 4, cue.y)
        .lineBetween(cue.x, cue.y - 4, cue.x, cue.y + 4);
    }
  }

  showImpact(position, hitEnemy) {
    const flash = this.add.circle(position.x, position.y, hitEnemy ? 8 : 5, hitEnemy ? 0xff766e : 0xffe89a, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(7);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.8,
      duration: 100,
      onComplete: () => flash.destroy(),
    });
  }

  showObjectHit(position) {
    const flash = this.add.circle(position.x, position.y, 8, 0xffe89a, 0.95)
      .setStrokeStyle(3, 0xffffff, 1)
      .setDepth(7);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.8,
      duration: 150,
      onComplete: () => flash.destroy(),
    });
  }

  formatTime(milliseconds) {
    const seconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  renderPlayers() {
    let phaseStartedAt = performance.now();
    const visionObjects = this.getVisionObjects();
    const visiblePlayers = [...this.players.values()].filter((player) =>
      player.id === this.getActivePlayerId() || this.isPlayerVisible(player, visionObjects) ||
      (!player.alive && this.knownCorpseIds.has(player.id)));
    const activeIds = new Set(visiblePlayers.map((player) => player.id));
    const viewerTeam = this.players.get(this.playerId)?.team ??
      this.roomState?.players?.find((player) => player.id === this.playerId)?.team;
    this.recordUpdatePhase('playerVisibility', phaseStartedAt);

    phaseStartedAt = performance.now();
    for (const [id, marker] of this.markers) {
      if (!activeIds.has(id)) {
        marker.circle.destroy();
        marker.controlledOutline.destroy();
        marker.gun.destroy();
        marker.healthBackground.destroy();
        marker.healthFill.destroy();
        marker.armorBackground.destroy();
        marker.armorFill.destroy();
        marker.label.destroy();
        marker.reloadGraphics.destroy();
        this.markers.delete(id);
      }
    }

    for (const player of visiblePlayers) {
      const rendered = getRenderedPosition(player);
      const isLocalPlayer = player.id === this.getActivePlayerId();
      let marker = this.markers.get(player.id);
      if (!marker) {
        marker = {
          circle: this.add.circle(0, 0, PLAYER_RADIUS, ALLY_PLAYER_COLOR)
            .setStrokeStyle(1.5, ALLY_PLAYER_COLOR)
            .setDepth(3),
          controlledOutline: this.add.circle(0, 0, PLAYER_RADIUS + 1, 0xffffff, 0)
            .setStrokeStyle(1.5, CONTROLLED_PLAYER_OUTLINE_COLOR)
            .setDepth(3.2),
          gun: this.add.graphics().setDepth(3.25),
          healthBackground: this.add.rectangle(0, 0, 38, 5, 0x101722)
            .setStrokeStyle(1, 0x718198)
            .setDepth(3.5),
          healthFill: this.add.rectangle(0, 0, 38, 5, 0x54d693)
            .setOrigin(0, 0.5)
            .setDepth(3.6),
          armorBackground: this.add.rectangle(0, 0, 38, 3, 0x101722)
            .setStrokeStyle(1, 0x527b9c)
            .setDepth(3.5),
          armorFill: this.add.rectangle(0, 0, 38, 3, 0x54b8ff)
            .setOrigin(0, 0.5)
            .setDepth(3.6),
          label: this.add.text(0, 0, '', {
            color: '#f5f8fc',
            fontFamily: 'system-ui, sans-serif',
            fontSize: '18px',
            stroke: '#0b1220',
            strokeThickness: 4,
          }).setOrigin(0.5, 0).setDepth(4),
          reloadGraphics: this.add.graphics().setDepth(5.5),
          gunWeaponId: null,
          fillColor: null,
          playerName: null,
          health: null,
          armor: null,
          maxArmor: null,
        };
        this.markers.set(player.id, marker);
      }
      marker.circle.setPosition(rendered.x, rendered.y);
      marker.controlledOutline
        .setPosition(rendered.x, rendered.y)
        .setVisible(isLocalPlayer && player.alive)
        .setAlpha(player.alive ? 1 : 0.28);
      const fillColor = player.team === viewerTeam ? ALLY_PLAYER_COLOR : ENEMY_PLAYER_COLOR;
      if (marker.fillColor !== fillColor) {
        marker.fillColor = fillColor;
        marker.circle.setFillStyle(fillColor, 1);
        marker.circle.setStrokeStyle(1.5, fillColor);
      }
      marker.circle.setAlpha(player.alive ? 1 : 0.28);
      const weapon = this.getSelectedWeapon(player);
      const aimAngle = isLocalPlayer && Number.isFinite(this.localAimAngle)
        ? this.localAimAngle
        : player.weaponStats?.[weapon.id]?.aimAngle ?? 0;
      const barrelLength = weapon.weaponClass === 'sniper' ? 24
        : weapon.weaponClass === 'machine-gun' ? 22
        : weapon.id === 'smg' ? 11
          : weapon.weaponClass === 'pistol' || ['classic-pistol', 'battle-pistol', 'revolver'].includes(weapon.id) ? 8 : 18;
      const holdsGadget = this.getEquippedSlot(player) === 'gadget';
      const heldItemKey = holdsGadget ? 'gadget' : `weapon:${weapon.id}`;
      if (marker.gunWeaponId !== heldItemKey) {
        marker.gun.clear();
        if (holdsGadget) {
          marker.gun.fillStyle(0x111820, 1).fillEllipse(5, 0, 12, 10);
          marker.gun.fillStyle(0x647781, 1).fillEllipse(5, 0, 9, 7);
          marker.gun.fillStyle(0xdce7ef, 0.95).fillRect(2, -2, 1.5, 4);
          marker.gun.lineStyle(1.3, 0x111820, 1).lineBetween(8.5, -3, 8.5, 3);
          marker.gun.lineStyle(1.2, 0xaec2d2, 1).lineBetween(10, -2, 10, 2);
        } else {
          marker.gun.lineStyle(5, 0x111820, 1).lineBetween(-6, 0, 5, 0);
          marker.gun.lineStyle(2.8, 0xdce7ef, 1).lineBetween(-6, 0, 5, 0);
          marker.gun.lineStyle(4.5, 0x111820, 1).lineBetween(3, 0, barrelLength, 0);
          marker.gun.lineStyle(2, 0xaec2d2, 1).lineBetween(3, 0, barrelLength, 0);
          marker.gun.lineStyle(4, 0x111820, 1).lineBetween(barrelLength, -2.5, barrelLength, 2.5);
          marker.gun.fillStyle(0xffffff, 1).fillCircle(0, 0, 1.25);
        }
        marker.gunWeaponId = heldItemKey;
      }
      const gunCenter = getWeaponMuzzlePosition(rendered, aimAngle, player.weaponLean, this.mapObjects);
      marker.gun.setPosition(gunCenter.x, gunCenter.y).setRotation(aimAngle);
      marker.gun.setAlpha(player.alive ? 1 : 0.28);
      marker.healthBackground
        .setPosition(rendered.x, rendered.y - PLAYER_RADIUS - 8)
        .setAlpha(1)
        .setVisible(player.alive);
      marker.healthFill
        .setPosition(rendered.x - 19, rendered.y - PLAYER_RADIUS - 8)
        .setAlpha(1)
        .setVisible(player.alive);
      if (marker.health !== player.health) {
        marker.health = player.health;
        marker.healthFill.setSize(38 * Math.max(0, Math.min(1, player.health / 100)), 5);
      }
      const maxArmor = Math.max(0, player.maxArmor ?? 0);
      const armor = Math.max(0, player.armor ?? 0);
      const hasArmor = maxArmor > 0;
      marker.armorBackground
        .setPosition(rendered.x, rendered.y - PLAYER_RADIUS - 12)
        .setAlpha(1)
        .setVisible(player.alive && hasArmor);
      marker.armorFill
        .setPosition(rendered.x - 19, rendered.y - PLAYER_RADIUS - 12)
        .setAlpha(1)
        .setVisible(player.alive && hasArmor);
      if (marker.armor !== armor || marker.maxArmor !== maxArmor) {
        marker.armor = armor;
        marker.maxArmor = maxArmor;
        marker.armorFill.setSize(38 * (hasArmor ? Math.max(0, Math.min(1, armor / maxArmor)) : 0), 3);
      }
      marker.label
        .setPosition(rendered.x, rendered.y + PLAYER_RADIUS + 5)
        .setVisible(player.alive || this.isPointerOverCorpse(rendered));
      if (marker.playerName !== player.name) {
        marker.playerName = player.name;
        marker.label.setText(player.name);
      }
      this.renderReloadArc(player, marker, weapon);
    }
    this.recordUpdatePhase('playerMarkers', phaseStartedAt);

    phaseStartedAt = performance.now();
    this.renderFlag();
    this.recordUpdatePhase('playerFlag', phaseStartedAt);
  }

  isPointerOverCorpse(position) {
    if (!this.pointerOverGame || !this.aimWorldPoint) return false;
    const hoverRadius = PLAYER_RADIUS + 5;
    const dx = this.aimWorldPoint.x - position.x;
    const dy = this.aimWorldPoint.y - position.y;
    return dx * dx + dy * dy <= hoverRadius * hoverRadius;
  }

  renderReloadArc(player, marker, weapon = this.getSelectedWeapon(player)) {
    const localPlayer = this.players.get(this.getActivePlayerId());
    const graphics = marker.reloadGraphics;
    if (!player.alive || player.team !== localPlayer?.team) {
      if (marker.reloadArcActive) graphics.clear();
      marker.reloadArcActive = false;
      return;
    }
    const weaponState = player.weaponStats?.[weapon.id];
    const now = Date.now();
    const reloadActive = weaponState?.reloading &&
      Number.isFinite(weaponState.reloadStartedAt) && Number.isFinite(weaponState.reloadEndsAt) &&
      weaponState.reloadStartedAt <= now && weaponState.reloadEndsAt > now;
    const manualActionActive = Number.isFinite(weaponState?.manualActionStartedAt) &&
      Number.isFinite(weaponState?.manualActionEndsAt) &&
      weaponState.manualActionStartedAt <= now && weaponState.manualActionEndsAt > now;
    const gadgetSwitchActive = Number.isFinite(player.gadgetSwitchStartedAt) &&
      Number.isFinite(player.gadgetSwitchEndsAt) &&
      player.gadgetSwitchStartedAt <= now && player.gadgetSwitchEndsAt > now;
    if (!reloadActive && !manualActionActive && !gadgetSwitchActive) {
      if (marker.reloadArcActive) graphics.clear();
      marker.reloadArcActive = false;
      return;
    }
    graphics.clear();
    marker.reloadArcActive = true;
    const quarterTurn = Math.PI / 2;
    const radius = PLAYER_RADIUS + 8;
    const rendered = getRenderedPosition(player);
    const drawActionArc = (startedAt, endsAt, startAngle, color) => {
      if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || startedAt > now || endsAt <= now) return;
      const duration = Math.max(1, endsAt - startedAt);
      const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
      graphics.lineStyle(1.5, color, 0.2);
      graphics.beginPath();
      graphics.arc(rendered.x, rendered.y, radius, startAngle, startAngle + quarterTurn, false);
      graphics.strokePath();
      if (progress <= 0) return;
      graphics.lineStyle(2.5, color, 0.95);
      graphics.beginPath();
      graphics.arc(rendered.x, rendered.y, radius, startAngle, startAngle + quarterTurn * progress, false);
      graphics.strokePath();
    };
    if (reloadActive) {
      drawActionArc(weaponState.reloadStartedAt, weaponState.reloadEndsAt, Math.PI / 2, 0xffd091);
    }
    if (manualActionActive) {
      drawActionArc(weaponState.manualActionStartedAt, weaponState.manualActionEndsAt, 0, 0x54d693);
    }
    if (gadgetSwitchActive) {
      drawActionArc(player.gadgetSwitchStartedAt, player.gadgetSwitchEndsAt, Math.PI, 0x54d693);
    }
  }

  renderFlag() {
    const flag = this.match?.flag;
    if (!flag) {
      this.flagMarker?.icon.setVisible(false);
      this.flagMarker?.label.setVisible(false);
      this.carriedFlagMarker?.setVisible(false);
      return;
    }
    if (!this.flagMarker) {
      this.flagMarker = {
        icon: this.add.circle(0, 0, 10, 0xf3c75f).setStrokeStyle(2, 0xfff0b0).setDepth(FLAG_DEPTH),
        label: this.add.text(0, 0, 'FLAG', {
          color: '#fff0b0',
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          stroke: '#241b0b',
          strokeThickness: 4,
        }).setOrigin(0.5, 1).setDepth(FLAG_DEPTH),
      };
    }
    const carrier = flag.heldBy ? this.players.get(flag.heldBy) : null;
    if (carrier) {
      if (!this.isPlayerVisible(carrier)) {
        this.flagMarker?.icon.setVisible(false);
        this.flagMarker?.label.setVisible(false);
        this.carriedFlagMarker?.setVisible(false);
        return;
      }
      this.flagMarker.icon.setVisible(false);
      this.flagMarker.label.setVisible(false);
      if (!this.carriedFlagMarker) this.carriedFlagMarker = this.add.graphics().setDepth(FLAG_DEPTH);
      const poleX = carrier.x;
      const poleBottom = carrier.y - PLAYER_RADIUS - 3;
      const poleTop = poleBottom - 17;
      this.carriedFlagMarker.clear();
      this.carriedFlagMarker.lineStyle(2, 0xfff0b0, 1).lineBetween(poleX, poleBottom, poleX, poleTop);
      this.carriedFlagMarker.fillStyle(0xf3c75f, 1).fillTriangle(
        poleX, poleTop, poleX + 11, poleTop + 3, poleX, poleTop + 8,
      );
      this.carriedFlagMarker.setVisible(true);
      this.flagMarker.label.setPosition(poleX, poleTop - 2).setVisible(true);
      return;
    }
    this.carriedFlagMarker?.setVisible(false);
    if (!this.isPositionExplored(flag)) {
      this.flagMarker?.icon.setVisible(false);
      this.flagMarker?.label.setVisible(false);
      return;
    }
    this.flagMarker.icon.setPosition(flag.x, flag.y).setVisible(true);
    this.flagMarker.label.setPosition(flag.x, flag.y - 13).setVisible(true);
  }
}

export class GameView {
  constructor(container, roomClient) {
    this.container = container;
    this.roomClient = roomClient;
    this.game = null;
    this.scene = null;
    this.botUpdateHandler = null;
    this.hostFrameUpdateHandler = null;
    this.hudUpdateHandler = null;
  }

  show(state, playerId, options = {}) {
    this.container.hidden = false;
    if (!this.game) {
      this.scene = new MatchScene(this.roomClient, playerId);
      this.scene.botUpdateHandler = this.botUpdateHandler;
      this.scene.hostFrameUpdateHandler = this.hostFrameUpdateHandler;
      this.scene.damageCueHandler = this.damageCueHandler;
      this.scene.audioCueHandler = this.audioCueHandler;
      this.scene.hudUpdateHandler = this.hudUpdateHandler;
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: this.container,
        backgroundColor: '#0b1220',
        scene: this.scene,
        scale: {
          mode: Phaser.Scale.RESIZE,
          width: this.container.clientWidth || 800,
          height: this.container.clientHeight || 800,
        },
        render: { antialias: true, pixelArt: false },
      });
    }
    this.updateRoomState(state, options);
  }

  updateRoomState(state, options = {}) {
    this.roomState = state;
    this.scene?.setRoomState(state, options);
  }

  setBotUpdateHandler(handler) {
    this.botUpdateHandler = typeof handler === 'function' ? handler : null;
    if (this.scene) this.scene.botUpdateHandler = this.botUpdateHandler;
  }

  setHostFrameUpdateHandler(handler) {
    this.hostFrameUpdateHandler = typeof handler === 'function' ? handler : null;
    if (this.scene) this.scene.hostFrameUpdateHandler = this.hostFrameUpdateHandler;
  }

  setDamageCueHandler(handler) {
    this.damageCueHandler = typeof handler === 'function' ? handler : null;
    if (this.scene) this.scene.damageCueHandler = this.damageCueHandler;
  }

  setAudioCueHandler(handler) {
    this.audioCueHandler = typeof handler === 'function' ? handler : null;
    if (this.scene) this.scene.audioCueHandler = this.audioCueHandler;
  }

  setHudUpdateHandler(handler) {
    this.hudUpdateHandler = typeof handler === 'function' ? handler : null;
    this.scene?.setHudUpdateHandler(this.hudUpdateHandler);
  }

  applyGameState(state) {
    this.scene?.applySnapshot(state.match ?? state);
  }

  applyHostFrame(frame) {
    return this.scene?.applyHostFrame(frame) ?? null;
  }

  applyAuthorityAction(action) {
    this.scene?.applyAuthorityAction(action);
  }

  applyAuthorityBots(message) {
    this.scene?.applyAuthorityBots(message);
  }

  applyHostEvent(event) {
    this.scene?.applyHostEvent(event);
  }

  applyAuthorityInput(input) {
    this.scene?.applyAuthorityInput(input);
  }

  suspendNetworkActivity() {
    this.scene?.suspendNetworkActivity();
  }

  resumeNetworkActivity() {
    this.scene?.resumeNetworkActivity();
  }

  getPredictedWeaponStats(playerId) {
    return this.scene?.getPredictedWeaponStats(playerId) ?? null;
  }

  getRoomStateForSimulation(fallback = null) {
    return this.scene?.getRoomStateForSimulation(fallback) ?? fallback;
  }

  isPostGameFreeRoam(match = this.scene?.match, roomState = this.roomState) {
    return this.scene?.isPostGameFreeRoam(match, roomState) ?? false;
  }

  applyProjectile(projectile) {
    this.scene?.showProjectile(projectile);
  }

  applyGadgetEvent(event) {
    this.scene?.applyGadgetEvent(event);
  }

  selectGadget(gadgetId) {
    return this.scene?.selectGadget(gadgetId) ?? false;
  }

  applyAudioCue(cue) {
    this.scene?.applyAudioCue(cue);
  }

  applyDamageCue(cue) {
    this.scene?.applyDamageCue(cue);
  }

  applyPing(ping) {
    this.scene?.applyPing(ping);
  }

  applyTeamIntel(intel) {
    this.scene?.applyTeamIntel(intel);
  }

  applyTeamWalls(intel) {
    this.scene?.applyTeamWalls(intel);
  }

  applyTeamCorpses(corpses) {
    this.scene?.applyTeamCorpses(corpses);
  }

  applyTeamMineIntel(intel) {
    this.scene?.applyTeamMineIntel(intel);
  }

  hide() {
    this.container.hidden = true;
    const hud = this.container.querySelector('#game-hud');
    if (hud) {
      hud.hidden = true;
      const timer = hud.querySelector('#game-hud-timer');
      if (timer) {
        timer.textContent = '';
        timer.hidden = true;
      }
    }
    if (this.scene) {
      this.scene.hostMapSearchToken += 1;
      this.scene.hostMapGenerationKey = null;
      this.scene.hostMapSubmission = null;
    }
    this.game?.destroy(true);
    this.game = null;
    this.scene = null;
    this.roomState = null;
  }
}
