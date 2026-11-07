import {
  BOT_TEAM_DAMAGE_RESPONSE_RANGE,
  BOT_TEAM_INTEL_RESPONDER_COUNT,
  BOT_TEAM_SIGHTING_RESPONSE_RANGE,
  createBotBrain,
  decideBotAction,
} from '../../../shared/BotAI.js';
import {
  GADGET_SWITCH_DURATION_MS,
  isGadgetJammed,
  isPlayerFlashBlinded,
  isPlayerJammed,
  SPY_CAMERA_ID,
} from '../../../shared/GadgetModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { getPlayerVisionOrigin, isPointVisible, VISION_HALF_ANGLE } from '../../../shared/VisionModel.js';
import { getBotMapStrategy } from '../../../shared/BotMapStrategy.js';

const BOT_COMMAND_INTERVAL_MS = 45;
const BOT_COMBAT_THINK_INTERVAL_MS = 60;
const GAMEPLAY_START_SAFETY_MS = 250;
const TEAM_VISIBILITY_INTERVAL_MS = 120;
const REPLAN_STAGGER_MS = 120;
const TEAM_SIGHTING_MEMORY_MS = 6_000;
const TEAM_INCIDENT_MEMORY_MS = 8_000;
const TEAM_PING_BOT_MEMORY_MS = 6_000;
const TEAMMATE_THREAT_RADIUS = 420;
const GADGET_ACTION_ACK_TIMEOUT_MS = GADGET_SWITCH_DURATION_MS + 2_000;
const BOT_DECISION_PROFILE_SAMPLE_LIMIT = 8;
const BOT_WEAPONS = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
const BOT_WEAPONS_BY_ID = new Map(BOT_WEAPONS.map((weapon) => [weapon.id, weapon]));

function recordSlowBotDecision(profile, botId, durationMs) {
  const sample = { botId, durationMs };
  if (profile.slowestDecisions.length < BOT_DECISION_PROFILE_SAMPLE_LIMIT) {
    profile.slowestDecisions.push(sample);
  } else {
    let shortestIndex = 0;
    for (let index = 1; index < profile.slowestDecisions.length; index += 1) {
      if (profile.slowestDecisions[index].durationMs <
          profile.slowestDecisions[shortestIndex].durationMs) shortestIndex = index;
    }
    if (durationMs <= profile.slowestDecisions[shortestIndex].durationMs) return;
    profile.slowestDecisions[shortestIndex] = sample;
  }
  profile.slowestDecisions.sort((left, right) => right.durationMs - left.durationMs);
}

function createBotWorldSnapshot(match) {
  const players = match.players ?? [];
  const playersById = new Map();
  const livingPlayers = [];
  const livingPlayersByTeam = new Map();
  for (const player of players) {
    playersById.set(player.id, player);
    if (!(player.alive && player.health > 0)) continue;
    livingPlayers.push(player);
    if (!livingPlayersByTeam.has(player.team)) livingPlayersByTeam.set(player.team, []);
    livingPlayersByTeam.get(player.team).push(player);
  }
  return { playersById, livingPlayers, livingPlayersByTeam };
}

export function resolveBotFireCommand(brain, decision, now) {
  const weapon = Object.values(DEFAULT_PROJECTILE_DEFINITIONS)
    .find((definition) => definition.id === decision.weaponId);
  if (weapon?.burstCount) {
    brain.burstCadence ??= {};
    const cadence = brain.burstCadence[weapon.id] ??= { holdUntil: -Infinity, nextBurstAt: -Infinity };
    if (now < cadence.holdUntil) return true;
    if (!decision.fire || now < cadence.nextBurstAt) return false;
    const burstDuration = weapon.burstShotIntervalMs * (weapon.burstCount - 1);
    cadence.holdUntil = now + burstDuration + BOT_COMMAND_INTERVAL_MS;
    cadence.nextBurstAt = now + burstDuration + weapon.burstDelayMs;
    return true;
  }
  if (!weapon?.semiAuto) {
    brain.semiAutoNeedsRelease = false;
    return decision.fire;
  }
  if (brain.semiAutoNeedsRelease) {
    brain.semiAutoNeedsRelease = false;
    return false;
  }
  if (!decision.fire || now < (brain.nextSemiAutoShotAt ?? -Infinity)) return false;
  brain.semiAutoNeedsRelease = true;
  const weaponDelay = Math.max(
    weapon.botFireIntervalMs ?? weapon.cooldownMs,
    weapon.cooldownMs,
    weapon.manualActionDurationMs ?? 0,
  );
  brain.nextSemiAutoShotAt = now + weaponDelay;
  return true;
}

/** Runs all bot perception and planning on the current room host's browser. */
export class BotController {
  constructor(roomClient) {
    this.roomClient = roomClient;
    this.brains = new Map();
    this.sequences = new Map();
    this.matchStartedAt = null;
    this.lastSentAt = -Infinity;
    this.lastAttemptAt = -Infinity;
    this.lastVisibilityAt = -Infinity;
    this.teamStateSignature = null;
    this.replanSequence = 0;
    this.damageCues = new Map();
    this.teamSightings = new Map();
    this.teamIncidents = new Map();
    this.teamPings = new Map();
    this.jammedPlayerTeams = new Map();
    this.previousPlayers = new Map();
    this.seenBotAudioCueIds = new Set();
    this.visionObjectsMap = null;
    this.visionObjectsSmokeSignature = null;
    this.visionObjectsCache = null;
  }

  update(roomStateSource, localPlayerId) {
    const now = Date.now();
    if (now - this.lastAttemptAt < BOT_COMMAND_INTERVAL_MS) return;
    const roomState = typeof roomStateSource === 'function' ? roomStateSource() : roomStateSource;
    const match = roomState?.match;
    if (!match || roomState.hostId !== localPlayerId || match.victory ||
      Date.now() < match.gameplayStartsAt + GAMEPLAY_START_SAFETY_MS) return;
    if (this.matchStartedAt !== match.startedAt) {
      this.matchStartedAt = match.startedAt;
      this.brains.clear();
      this.sequences.clear();
      this.lastSentAt = -Infinity;
      this.lastAttemptAt = -Infinity;
      this.lastVisibilityAt = -Infinity;
      this.teamStateSignature = null;
      this.replanSequence = 0;
      this.teamSightings.clear();
      this.teamPings.clear();
      this.jammedPlayerTeams.clear();
      for (const [incidentId, incident] of this.teamIncidents) {
        if (incident.kind === 'death') this.teamIncidents.delete(incidentId);
      }
      this.previousPlayers.clear();
      this.seenBotAudioCueIds.clear();
      this.visionObjectsMap = null;
      this.visionObjectsSmokeSignature = null;
      this.visionObjectsCache = null;
    }
    this.lastAttemptAt = now;
    const worldState = createBotWorldSnapshot(match);
    this.updatePingResponders(now, worldState);
    const mapStrategy = getBotMapStrategy(match.map);
    const profile = { decisionCount: 0, totalDecisionMs: 0, slowestDecisions: [] };
    for (const [victimId, cue] of this.damageCues) {
      if (cue.expiresAt <= now) this.damageCues.delete(victimId);
    }
    for (const [enemyId, sighting] of this.teamSightings) {
      if (sighting.expiresAt <= now) this.teamSightings.delete(enemyId);
    }
    for (const [incidentId, incident] of this.teamIncidents) {
      if (incident.expiresAt <= now) this.teamIncidents.delete(incidentId);
    }
    const visionObjects = this.getVisionObjects(match, now);
    this.updateTeamIntel(match, now, visionObjects, worldState);
    for (const incident of this.teamIncidents.values()) {
      if (incident.kind !== 'damage' || incident.responseScheduled ||
          !Number.isFinite(incident.x) || !Number.isFinite(incident.y)) continue;
      this.prioritizeNearbyBotReplans(
        now,
        incident.team,
        incident,
        BOT_TEAM_DAMAGE_RESPONSE_RANGE,
        BOT_TEAM_INTEL_RESPONDER_COUNT,
        worldState,
        incident.victimId,
      );
      incident.responseScheduled = true;
    }
    for (const cue of match.botNoises ?? []) {
      if (typeof cue.id !== 'string' || !['red', 'blue'].includes(cue.team) || cue.expiresAt <= now ||
          this.seenBotAudioCueIds.has(cue.id)) continue;
      this.seenBotAudioCueIds.add(cue.id);
      const firstHearerBrain = this.brains.get(cue.heardById);
      if (cue.audiencePlayerId) {
        if (firstHearerBrain?.botTeam === cue.team) {
          firstHearerBrain.decision = null;
          firstHearerBrain.nextThinkAt = now;
        }
      } else {
        this.scheduleBotReplans(now, cue.team);
        this.prioritizeNearbyBotReplans(
          now,
          cue.team,
          cue,
          (cue.radius ?? 180) + 300,
          BOT_TEAM_INTEL_RESPONDER_COUNT,
          worldState,
        );
      }
      if (!cue.audiencePlayerId && firstHearerBrain?.botTeam === cue.team) {
        firstHearerBrain.decision = null;
        firstHearerBrain.nextThinkAt = now;
      }
    }
    if (this.seenBotAudioCueIds.size > 256) {
      const activeCueIds = new Set((match.botNoises ?? []).map((cue) => cue.id));
      this.seenBotAudioCueIds = new Set([...this.seenBotAudioCueIds].filter((id) => activeCueIds.has(id)));
    }
    const jammedPlayerTeams = new Map(match.players
      .filter((player) => isPlayerJammed(player, now))
      .map((player) => [player.id, player.team]));
    const teamsWithJamChanges = new Set();
    const playersWithJamChanges = new Set();
    for (const [playerId, team] of jammedPlayerTeams) {
      if (this.jammedPlayerTeams.get(playerId) !== team) {
        teamsWithJamChanges.add(team);
        playersWithJamChanges.add(playerId);
      }
    }
    for (const [playerId, team] of this.jammedPlayerTeams) {
      if (!jammedPlayerTeams.has(playerId)) {
        teamsWithJamChanges.add(team);
        playersWithJamChanges.add(playerId);
      }
    }
    this.jammedPlayerTeams = jammedPlayerTeams;
    const teamStateSignature = JSON.stringify({
      livingPlayers: worldState.livingPlayers.map((player) => player.id).sort(),
      jammedPlayers: [...jammedPlayerTeams.keys()].sort(),
      flagHolder: match.flag?.heldBy ?? null,
      flagDropped: match.flag?.dropped === true,
      visionSmokes: (match.smokes ?? []).filter((smoke) => smoke.expiresAt > now)
        .map(({ id, x, y, radius }) => [id, x, y, radius]).sort((left, right) => left[0].localeCompare(right[0])),
    });
    if (this.teamStateSignature !== null && teamStateSignature !== this.teamStateSignature) {
      this.scheduleBotReplans(now);
    }
    for (const team of teamsWithJamChanges) {
      this.scheduleBotReplans(now, team);
    }
    for (const playerId of playersWithJamChanges) {
      const brain = this.brains.get(playerId);
      if (brain) {
        brain.decision = null;
        brain.nextThinkAt = now;
      }
    }
    this.teamStateSignature = teamStateSignature;
    const botProfiles = roomState.quickPlay && roomState.bots?.catalog?.length
      ? roomState.bots.catalog
      : roomState.bots?.roster ?? [];
    const roster = new Map(botProfiles.map((bot) => [bot.id, bot]));
    const teamIntelByTeam = new Map();
    const teamSlots = new Map();
    for (const team of ['red', 'blue']) {
      const teamBots = (worldState.livingPlayersByTeam.get(team) ?? [])
        .filter((player) => player.isBot)
        .sort((left, right) => left.id.localeCompare(right.id));
      teamBots.forEach((bot, index) => teamSlots.set(bot.id, { roleIndex: index, roleCount: teamBots.length }));
    }
    const commands = [];
    const pendingGadgetActions = [];
    for (const bot of match.players) {
      if (!bot.isBot || !bot.alive || bot.health <= 0 || bot.controlledById) continue;
      const personality = roster.get(bot.id);
      if (!personality) continue;
      let brain = this.brains.get(bot.id);
      if (!brain) {
        brain = createBotBrain(bot.id, now);
        brain.botTeam = bot.team;
        this.brains.set(bot.id, brain);
      }
      const selectedWeaponId = bot.selectedWeaponId ?? brain.loadoutWeaponId ??
        DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.id;
      if (brain.matchWeaponId !== selectedWeaponId) {
        brain.matchWeaponId = selectedWeaponId;
        brain.decision = null;
        brain.nextThinkAt = now;
        brain.semiAutoNeedsRelease = false;
        brain.nextSemiAutoShotAt = -Infinity;
        brain.burstCadence = {};
      }
      const damageCue = this.damageCues.get(bot.id);
      const personalDamageCue = damageCue?.audiencePlayerId === bot.id;
      if ((!isPlayerJammed(bot, now) || personalDamageCue) &&
          damageCue?.expiresAt > now && damageCue.team === bot.team) {
        brain.incomingDamageCue = damageCue;
      } else {
        brain.incomingDamageCue = null;
        this.damageCues.delete(bot.id);
      }
      if (brain.pendingGadgetAction &&
          ((bot.lastWeaponActionSequence ?? 0) >= brain.pendingGadgetAction.actionSequence ||
            now - brain.pendingGadgetAction.sentAt >= GADGET_ACTION_ACK_TIMEOUT_MS)) {
        brain.lastGadgetActionSequence = Math.max(
          brain.lastGadgetActionSequence ?? 0,
          brain.pendingGadgetAction.actionSequence,
        );
        brain.pendingGadgetAction = null;
        brain.decision = null;
        brain.nextThinkAt = now;
      }
      if (!brain.decision || (!brain.pendingGadgetAction && now >= brain.nextThinkAt)) {
        if (!teamIntelByTeam.has(bot.team)) {
          teamIntelByTeam.set(bot.team, this.getTeamIntel(bot.team, match, now, worldState));
        }
        const botMatch = isPlayerJammed(bot, now) ? {
          ...match,
          gadgetEffects: (match.gadgetEffects ?? []).filter((effect) => {
            const weaponId = bot.selectedWeaponId ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.id;
            const weapon = BOT_WEAPONS_BY_ID.get(weaponId) ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
            const angle = bot.visionAngle ?? bot.weaponStats?.[weapon.id]?.aimAngle ?? 0;
            const origin = getPlayerVisionOrigin(bot, match.map.objects);
            return isPointVisible(effect, { origin, angle, halfAngle: VISION_HALF_ANGLE }, visionObjects);
          }),
          botNoises: (match.botNoises ?? []).filter((cue) =>
            cue.audiencePlayerId === bot.id && cue.expiresAt > now),
        } : match;
        const decisionStartedAt = performance.now();
        brain.decision = decideBotAction({ ...bot, botBrain: brain }, botMatch, personality.parameters, now, {
          ...teamSlots.get(bot.id),
          teammateTacticalPositions: (worldState.livingPlayersByTeam.get(bot.team) ?? [])
            .filter((teammate) => teammate.id !== bot.id)
            .map((teammate) => {
              const teammateBrain = this.brains.get(teammate.id);
              return {
                id: teammate.id,
                defensePost: teammateBrain?.defensePost,
                defenseWatchTarget: teammateBrain?.defenseWatchTarget,
                coverPoint: teammateBrain?.tacticalCoverCache?.point,
              };
            }),
          damageCue: brain.incomingDamageCue,
          worldState,
          mapStrategy,
          teamIntel: isPlayerJammed(bot, now)
            ? {
              sightings: [],
              incidents: [],
              audioCues: botMatch.botNoises,
              pings: [],
            }
            : teamIntelByTeam.get(bot.team),
          visionObjects,
        });
        const decisionDurationMs = performance.now() - decisionStartedAt;
        profile.decisionCount += 1;
        profile.totalDecisionMs += decisionDurationMs;
        recordSlowBotDecision(profile, bot.id, decisionDurationMs);
        const combatDelay = BOT_COMBAT_THINK_INTERVAL_MS + hashString(bot.id) % 21;
        brain.nextThinkAt = now + Math.max(50, Math.min(
          brain.decision.thinkingTimeMs,
          brain.decision.enemyId ? combatDelay : Infinity,
        ));
      }
      const sequence = Math.max(this.sequences.get(bot.id) ?? 0, bot.inputSequence ?? 0,
        bot.lastInputSequence ?? 0) + 1;
      this.sequences.set(bot.id, sequence);
      const gadgetAction = !brain.pendingGadgetAction && brain.decision.gadgetAction
        ? {
          ...brain.decision.gadgetAction,
          actionSequence: Math.max(brain.lastGadgetActionSequence ?? 0,
            bot.lastWeaponActionSequence ?? 0) + 1,
        }
        : null;
      const actionPending = Boolean(brain.pendingGadgetAction || gadgetAction);
      const fire = actionPending ? false : resolveBotFireCommand(brain, brain.decision, now);
      commands.push({
        botId: bot.id,
        sequence,
        controlRevision: bot.controlRevision ?? 0,
        input: brain.decision.input,
        direction: brain.decision.direction,
        fire,
        reload: !actionPending && brain.decision.reload && !fire,
        weaponId: brain.decision.weaponId,
        ...(gadgetAction ? { gadgetAction } : {}),
      });
      if (gadgetAction) pendingGadgetActions.push({ brain, actionSequence: gadgetAction.actionSequence });
    }
    if (commands.length && this.roomClient.send('game:bots', { matchId: match.startedAt, commands })) {
      this.lastSentAt = now;
      for (const { brain, actionSequence } of pendingGadgetActions) {
        brain.pendingGadgetAction = { actionSequence, sentAt: now };
      }
    }
    return profile;
  }

  acceptDamageCue(cue) {
    if (!cue || typeof cue.victimId !== 'string' || !['red', 'blue'].includes(cue.team) ||
        !Number.isFinite(cue.bearing) || !Number.isFinite(cue.expiresAt) || cue.expiresAt <= Date.now()) return;
    this.damageCues.set(cue.victimId, {
      id: cue.id ?? `${cue.victimId}:${cue.expiresAt}`,
      victimId: cue.victimId,
      team: cue.team,
      bearing: cue.bearing,
      expiresAt: cue.expiresAt,
      audiencePlayerId: cue.audiencePlayerId ?? null,
    });
    const now = Date.now();
    if (cue.audiencePlayerId) {
      const brain = this.brains.get(cue.victimId);
      if (brain?.botTeam === cue.team) {
        brain.decision = null;
        brain.nextThinkAt = now;
      }
      return;
    }
    this.teamIncidents.set(`damage:${cue.id ?? `${cue.victimId}:${cue.expiresAt}`}`, {
      id: `damage:${cue.id ?? `${cue.victimId}:${cue.expiresAt}`}`,
      kind: 'damage',
      victimId: cue.victimId,
      team: cue.team,
      bearing: cue.bearing,
      observedAt: now,
      expiresAt: Math.min(cue.expiresAt, now + TEAM_INCIDENT_MEMORY_MS),
    });
    this.scheduleBotReplans(now, cue.team, cue.victimId);
    const victim = this.previousPlayers.get(cue.victimId);
    this.prioritizeNearbyBotReplans(
      now,
      cue.team,
      victim,
      BOT_TEAM_DAMAGE_RESPONSE_RANGE,
      BOT_TEAM_INTEL_RESPONDER_COUNT,
      null,
      cue.victimId,
    );
  }

  getVisionObjects(match, now) {
    const smokes = (match.smokes ?? []).filter((smoke) => smoke.expiresAt > now);
    const smokeSignature = JSON.stringify(smokes.map(({ id, x, y, radius, expiresAt }) =>
      [id, x, y, radius, expiresAt]));
    if (this.visionObjectsMap !== match.map.objects || this.visionObjectsSmokeSignature !== smokeSignature) {
      this.visionObjectsMap = match.map.objects;
      this.visionObjectsSmokeSignature = smokeSignature;
      this.visionObjectsCache = smokes.length ? [...match.map.objects, ...smokes] : match.map.objects;
    }
    return this.visionObjectsCache;
  }

  acceptAudioCue(cue) {
    if (!cue || typeof cue.id !== 'string' || !['red', 'blue'].includes(cue.team) ||
        !Number.isFinite(cue.x) || !Number.isFinite(cue.y) ||
        !Number.isFinite(cue.expiresAt) || cue.expiresAt <= Date.now()) return;
    if (cue.audiencePlayerId) {
      const brain = this.brains.get(cue.heardById);
      if (brain?.botTeam === cue.team) {
        brain.decision = null;
        brain.nextThinkAt = Date.now();
      }
      return;
    }
    this.teamIncidents.set(`noise:${cue.id}`, {
      id: `noise:${cue.id}`,
      kind: 'audio',
      audioKind: cue.kind ?? 'gunshot',
      team: cue.team,
      x: cue.x,
      y: cue.y,
      radius: cue.radius,
      expiresAt: Math.min(cue.expiresAt, Date.now() + TEAM_INCIDENT_MEMORY_MS),
    });
    const now = Date.now();
    this.scheduleBotReplans(now, cue.team);
    this.prioritizeNearbyBotReplans(
      now,
      cue.team,
      cue,
      (cue.radius ?? 180) + 300,
      BOT_TEAM_INTEL_RESPONDER_COUNT,
    );
  }

  acceptPing(ping) {
    const now = Date.now();
    if (!ping || typeof ping.id !== 'string' || !['red', 'blue'].includes(ping.team) ||
        !Number.isFinite(ping.x) || !Number.isFinite(ping.y) ||
        !Number.isFinite(ping.expiresAt) || ping.expiresAt <= now) return;
    const previous = this.teamPings.get(ping.id);
    this.teamPings.set(ping.id, {
      id: ping.id,
      team: ping.team,
      x: ping.x,
      y: ping.y,
      createdAt: previous?.createdAt ?? now,
      expiresAt: Math.max(ping.expiresAt, now + TEAM_PING_BOT_MEMORY_MS),
      responderId: previous?.responderId ?? null,
    });
    this.scheduleBotReplans(now, ping.team);
  }

  updatePingResponders(now, worldState) {
    const expiredTeams = new Set();
    for (const [id, ping] of this.teamPings) {
      if (ping.expiresAt <= now) {
        expiredTeams.add(ping.team);
        this.teamPings.delete(id);
      }
    }

    const livingBots = new Map();
    for (const [team, players] of worldState.livingPlayersByTeam) {
      livingBots.set(team, players.filter((player) =>
        player.isBot && !player.controlledById && !isPlayerJammed(player, now)));
    }
    for (const ping of this.teamPings.values()) {
      const responder = worldState.playersById.get(ping.responderId);
      if (responder?.team !== ping.team || !responder.isBot || !responder.alive ||
          responder.health <= 0 || responder.controlledById || isPlayerJammed(responder, now)) {
        ping.responderId = null;
      }
    }

    const assignedByTeam = new Map();
    for (const ping of this.teamPings.values()) {
      if (!ping.responderId) continue;
      const assigned = assignedByTeam.get(ping.team) ?? new Set();
      assigned.add(ping.responderId);
      assignedByTeam.set(ping.team, assigned);
    }
    for (const ping of this.teamPings.values()) {
      if (ping.responderId) continue;
      const candidates = livingBots.get(ping.team) ?? [];
      const assigned = assignedByTeam.get(ping.team) ?? new Set();
      const available = candidates.filter((bot) => !assigned.has(bot.id));
      const responder = [...(available.length ? available : candidates)]
        .sort((left, right) =>
          Math.hypot(left.x - ping.x, left.y - ping.y) -
            Math.hypot(right.x - ping.x, right.y - ping.y) ||
          left.id.localeCompare(right.id))[0];
      if (!responder) continue;
      ping.responderId = responder.id;
      assigned.add(responder.id);
      assignedByTeam.set(ping.team, assigned);
      const brain = this.brains.get(responder.id);
      if (brain) {
        brain.decision = null;
        brain.nextThinkAt = now;
      }
    }
    for (const team of expiredTeams) this.scheduleBotReplans(now, team);
  }

  scheduleBotReplans(now, team = null, immediateBotId = null) {
    const sequence = ++this.replanSequence;
    for (const brain of this.brains.values()) {
      if (team && brain.botTeam !== team) continue;
      if (brain.id === immediateBotId) {
        brain.decision = null;
        brain.nextThinkAt = now;
        continue;
      }
      // Keep issuing each bot's current movement command while spreading the
      // costly replans across subsequent host updates.
      brain.nextThinkAt = now + (hashString(`${brain.id}:${sequence}`) % REPLAN_STAGGER_MS) + 1;
    }
  }

  prioritizeNearbyBotReplans(now, team, target, maximumRange, responderLimit,
    worldState = null, excludedBotId = null) {
    if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return;
    const positions = [];
    for (const brain of this.brains.values()) {
      if (brain.botTeam !== team || brain.id === excludedBotId) continue;
      const player = worldState?.playersById?.get(brain.id) ?? this.previousPlayers.get(brain.id);
      if (!player || player.team !== team || !player.alive || player.health <= 0 ||
          player.controlledById) continue;
      const distance = Math.hypot(player.x - target.x, player.y - target.y);
      if (distance <= maximumRange) positions.push({ brain, distance });
    }
    positions.sort((left, right) =>
      left.distance - right.distance || left.brain.id.localeCompare(right.brain.id));
    for (const { brain } of positions.slice(0, responderLimit)) {
      brain.decision = null;
      brain.nextThinkAt = now;
    }
  }

  updateTeamIntel(match, now, visionObjects = this.getVisionObjects(match, now),
    worldState = createBotWorldSnapshot(match)) {
    const livePlayers = worldState.livingPlayers;
    const playersById = worldState.playersById;
    if (now - this.lastVisibilityAt >= TEAM_VISIBILITY_INTERVAL_MS) {
      this.lastVisibilityAt = now;
      const teamsWithSightings = new Map();
      for (const team of ['red', 'blue']) {
        const sources = this.getTeamVisionSources(team, match, now, worldState);
        for (const source of sources) {
          for (const enemy of livePlayers) {
            if (enemy.team === team || !isPointVisible(enemy, source, source.xray ? [] : visionObjects)) continue;
            const key = `${team}:${enemy.id}`;
            const previous = this.teamSightings.get(key);
            const moved = !previous || Math.hypot(enemy.x - previous.x, enemy.y - previous.y) >= 72;
            const staleReport = !previous || now - (previous.observedAt ?? -Infinity) >= 1_200;
            const shouldReplan = !previous || staleReport ||
              (moved && now - (previous.lastReplanAt ?? -Infinity) >= 350);
            this.teamSightings.set(key, {
              id: key,
              team,
              enemyId: enemy.id,
              x: enemy.x,
              y: enemy.y,
              vx: enemy.vx ?? 0,
              vy: enemy.vy ?? 0,
              sourceType: source.sourceType,
              observerId: source.observerId,
              cameraId: source.cameraId,
              observedAt: now,
              expiresAt: now + TEAM_SIGHTING_MEMORY_MS,
              lastReplanAt: shouldReplan ? now : previous.lastReplanAt,
            });
            if (shouldReplan) {
              let nearestAllyDistance = Infinity;
              for (const ally of livePlayers) {
                if (ally.team === team) {
                  nearestAllyDistance = Math.min(nearestAllyDistance,
                    Math.hypot(ally.x - enemy.x, ally.y - enemy.y));
                }
              }
              const isUrgent = nearestAllyDistance <= TEAMMATE_THREAT_RADIUS;
              const previous = teamsWithSightings.get(team);
              if (!previous || (isUrgent &&
                  (!previous.urgent || nearestAllyDistance < previous.allyDistance))) {
                teamsWithSightings.set(team, {
                  urgent: isUrgent,
                  allyDistance: nearestAllyDistance,
                  position: { x: enemy.x, y: enemy.y },
                });
              }
            }
          }
        }
      }
      for (const [team, response] of teamsWithSightings) {
        this.scheduleBotReplans(now, team);
        if (response.urgent) {
          this.prioritizeNearbyBotReplans(
            now,
            team,
            response.position,
            BOT_TEAM_SIGHTING_RESPONSE_RANGE,
            BOT_TEAM_INTEL_RESPONDER_COUNT,
            worldState,
          );
        }
      }
    }

    const teamsWithDeaths = new Set();
    for (const [playerId, player] of this.previousPlayers) {
      const current = playersById.get(playerId);
      if (player.alive && (!current || !current.alive || current.health <= 0)) {
        const dead = current ?? player;
        const id = `death:${playerId}:${now}`;
        this.teamIncidents.set(id, {
          id,
          kind: 'death',
          victimId: playerId,
          team: player.team,
          x: dead.x,
          y: dead.y,
          expiresAt: now + TEAM_INCIDENT_MEMORY_MS,
        });
        teamsWithDeaths.add(player.team);
      }
    }
    for (const team of teamsWithDeaths) this.scheduleBotReplans(now, team);
    const nextPreviousPlayers = new Map();
    for (const player of match.players) nextPreviousPlayers.set(player.id, {
      team: player.team,
      alive: player.alive && player.health > 0,
      health: player.health,
      x: player.x,
      y: player.y,
      controlledById: player.controlledById ?? null,
    });
    this.previousPlayers = nextPreviousPlayers;

    for (const cue of this.damageCues.values()) {
      if (cue.expiresAt <= now) continue;
      const victim = playersById.get(cue.victimId);
      if (!victim || victim.team !== cue.team || isPlayerJammed(victim, now)) continue;
      const id = `damage:${cue.id}`;
      const incident = this.teamIncidents.get(id);
      if (incident) {
        incident.x = victim.x;
        incident.y = victim.y;
      }
    }
  }

  getTeamIntel(team, match, now, worldState = createBotWorldSnapshot(match)) {
    const playersById = worldState.playersById;
    const opposingTeam = team === 'red' ? 'blue' : team === 'blue' ? 'red' : null;
    const livingEnemies = opposingTeam
      ? worldState.livingPlayersByTeam.get(opposingTeam) ?? []
      : worldState.livingPlayers.filter((player) => player.team !== team);
    const livingEnemyIds = new Set(livingEnemies.map((player) => player.id));
    const sightings = [...this.teamSightings.values()]
      .filter((sighting) => sighting.team === team && sighting.expiresAt > now &&
        livingEnemyIds.has(sighting.enemyId) &&
        (!sighting.observerId || !isPlayerJammed(playersById.get(sighting.observerId), now)));
    const incidents = [...this.teamIncidents.values()]
      .filter((incident) => incident.team === team && incident.expiresAt > now && Number.isFinite(incident.x) &&
        Number.isFinite(incident.y));
    const audioCues = (match.botNoises ?? []).filter((cue) => !cue.audiencePlayerId &&
      cue.team === team && cue.expiresAt > now &&
      Number.isFinite(cue.x) && Number.isFinite(cue.y) &&
      !isPlayerJammed(playersById.get(cue.heardById), now));
    const visionSources = this.getTeamVisionSources(team, match, now, worldState);
    const pings = [...this.teamPings.values()]
      .filter((ping) => ping.team === team && ping.expiresAt > now)
      .map((ping) => ({ ...ping }));
    return { sightings, incidents, audioCues, visionSources, pings };
  }

  getTeamVisionSources(team, match, now, worldState = createBotWorldSnapshot(match)) {
    const mapObjects = match.map?.objects ?? [];
    const mapRange = Math.hypot(match.map?.width ?? 0, match.map?.height ?? 0) * 2;
    const sources = [];
    const observers = worldState.livingPlayersByTeam.get(team) ??
      worldState.livingPlayers.filter((player) => player.team === team);
    for (const observer of observers) {
      if (isPlayerJammed(observer, now) || isPlayerFlashBlinded(observer, now)) continue;
      const weaponId = observer.selectedWeaponId ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle.id;
      const weapon = BOT_WEAPONS_BY_ID.get(weaponId) ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
      sources.push({
        origin: getPlayerVisionOrigin(observer, mapObjects),
        angle: observer.visionAngle ?? observer.weaponStats?.[weapon.id]?.aimAngle ?? 0,
        halfAngle: VISION_HALF_ANGLE,
        maximumRange: mapRange,
        sourceType: 'player',
        observerId: observer.id,
      });
    }
    for (const camera of match.gadgetEffects ?? []) {
      if (camera.type !== SPY_CAMERA_ID || camera.team !== team ||
          camera.startedAt > now || camera.expiresAt <= now || camera.health <= 0 ||
          (Number.isFinite(camera.disabledUntil) && camera.disabledUntil > now) ||
          isGadgetJammed(camera, now)) continue;
      sources.push({
        origin: { x: camera.x, y: camera.y },
        angle: camera.angle ?? 0,
        halfAngle: camera.visionHalfAngle ?? VISION_HALF_ANGLE,
        maximumRange: camera.visionRange ?? 300,
        sourceType: 'spy-camera',
        cameraId: camera.id,
        xray: true,
      });
    }
    return sources;
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}
