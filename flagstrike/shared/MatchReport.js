export const MATCH_REPORT_SCHEMA_VERSION = 2;
export const MATCH_CLIENT_DIAGNOSTICS_SCHEMA_VERSION = 1;
export const MAX_MATCH_REPORT_BYTES = 512 * 1024;
export const MAX_MATCH_REPORT_ACTORS = 64;
export const MAX_MATCH_REPORT_SAMPLES = 3_600;
export const MATCH_REPORT_SAMPLE_INTERVAL_MS = 1_000;

const MAX_MATCH_REPORT_HISTORY = 512;
const MAX_MATCH_REPORT_TOTAL_LOCATIONS = 12_000;
const MAX_MATCH_REPORT_TIMELINE_SAMPLES = 256;
const MAX_MATCH_REPORT_FRAME_SAMPLES = 128;
const MAX_MATCH_REPORT_BOT_DECISION_SAMPLES = 8;
const MAX_MATCH_CLIENT_DIAGNOSTICS_BYTES = 32 * 1024;
const SLOW_FRAME_THRESHOLDS_MS = [16, 33, 50];
const MATCH_REPORT_WORK_METRICS = new Set([
  'simulation.fixedSteps',
  'vision.livePlayers',
  'vision.mapObjects',
  'vision.gadgetEffects',
  'vision.playerVisionRefreshes',
  'frameOverlays.activeSmokes',
  'frameOverlays.activeGadgetEffects',
  'frameOverlays.gadgetEffects',
  'frameOverlays.activeFlashEffects',
]);

function isValidWorkMetrics(work) {
  return work && typeof work === 'object' && !Array.isArray(work) &&
    Object.keys(work).length <= MATCH_REPORT_WORK_METRICS.size &&
    Object.entries(work).every(([name, metric]) =>
      MATCH_REPORT_WORK_METRICS.has(name) &&
      Number.isSafeInteger(metric?.samples) && metric.samples >= 0 &&
      Number.isFinite(metric.total) && metric.total >= 0 &&
      Number.isFinite(metric.max) && metric.max >= 0);
}

function isValidPhaseMetrics(phases) {
  return phases && typeof phases === 'object' && !Array.isArray(phases) &&
    Object.keys(phases).length <= 32 &&
    Object.entries(phases).every(([name, metric]) =>
      name.length <= 64 && Number.isSafeInteger(metric?.count) && metric.count >= 0 &&
      Number.isFinite(metric.totalMs) && metric.totalMs >= 0 &&
      Number.isFinite(metric.maxMs) && metric.maxMs >= 0);
}

function isValidFrameSample(sample) {
  return sample && Number.isSafeInteger(sample.atMs) && sample.atMs >= 0 &&
    Number.isFinite(sample.frameMs) && sample.frameMs >= 33 &&
    (sample.frameDeltaMs === null ||
      (Number.isFinite(sample.frameDeltaMs) && sample.frameDeltaMs >= 0)) &&
    Number.isSafeInteger(sample.botDecisionCount) && sample.botDecisionCount >= 0 &&
    Number.isFinite(sample.botDecisionMs) && sample.botDecisionMs >= 0 &&
    sample.phases && typeof sample.phases === 'object' && !Array.isArray(sample.phases) &&
    Object.keys(sample.phases).length <= 32 &&
    Object.entries(sample.phases).every(([name, durationMs]) =>
      name.length <= 64 && Number.isFinite(durationMs) && durationMs >= 0) &&
    Array.isArray(sample.botDecisions) &&
    sample.botDecisions.length <= MAX_MATCH_REPORT_BOT_DECISION_SAMPLES &&
    sample.botDecisions.every((decision) =>
      decision && typeof decision.botId === 'string' && decision.botId.length <= 96 &&
      Number.isFinite(decision.durationMs) && decision.durationMs >= 0);
}

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function getActorSnapshot(player) {
  const weaponStats = {};
  for (const [weaponId, state] of Object.entries(player.weaponStats ?? {})) {
    weaponStats[weaponId] = {
      ammo: state.ammo ?? null,
      reserveAmmo: state.reserveAmmo ?? null,
      shotsFired: state.shotsFired ?? null,
      reloading: state.reloading === true,
    };
  }
  return {
    selectedWeaponId: player.selectedWeaponId ?? null,
    selectedGadgetId: player.selectedGadgetId ?? null,
    gadgetCounts: copy(player.gadgetCounts ?? {}),
    inventory: copy(player.inventory ?? null),
    inventoryWeaponIds: copy(player.inventoryWeaponIds ?? []),
    weaponShopOfferIds: copy(player.weaponShopOfferIds ?? []),
    gadgetShopOfferIds: copy(player.gadgetShopOfferIds ?? []),
    itemShopOfferIds: copy(player.itemShopOfferIds ?? []),
    uniqueGadgetShopOfferIds: copy(player.uniqueGadgetShopOfferIds ?? []),
    shopPicksRemaining: player.shopPicksRemaining ?? 0,
    stats: copy(player.stats ?? { kills: 0, assists: 0, deaths: 0 }),
    weaponStats,
  };
}

function getLoadoutSignature(snapshot) {
  return JSON.stringify({
    selectedWeaponId: snapshot.selectedWeaponId,
    selectedGadgetId: snapshot.selectedGadgetId,
    gadgetCounts: snapshot.gadgetCounts,
    inventory: snapshot.inventory,
    inventoryWeaponIds: snapshot.inventoryWeaponIds,
    weaponShopOfferIds: snapshot.weaponShopOfferIds,
    gadgetShopOfferIds: snapshot.gadgetShopOfferIds,
    itemShopOfferIds: snapshot.itemShopOfferIds,
    uniqueGadgetShopOfferIds: snapshot.uniqueGadgetShopOfferIds,
    shopPicksRemaining: snapshot.shopPicksRemaining,
  });
}

function createActorRecord(player, elapsedMs) {
  const snapshot = getActorSnapshot(player);
  const actor = {
    id: player.id,
    name: player.name ?? null,
    team: player.team,
    isBot: player.isBot === true,
    initial: snapshot,
    final: snapshot,
    loadoutHistory: [],
    gadgetUses: [],
    deaths: [],
    locationSamples: [],
  };
  Object.defineProperties(actor, {
    _loadoutSignature: { value: getLoadoutSignature(snapshot), writable: true },
    _previousGadgetCounts: { value: copy(snapshot.gadgetCounts), writable: true },
    _lastDeathAt: { value: player.deathAttribution?.at ?? null, writable: true },
  });
  if (actor.isBot && Number.isFinite(player.x) && Number.isFinite(player.y)) {
    actor.locationSamples.push([
      Math.max(0, Math.round(elapsedMs)),
      Math.round(player.x),
      Math.round(player.y),
      player.alive === false ? 0 : 1,
    ]);
  }
  return actor;
}

function addActorDeath(report, actor, player, elapsedMs) {
  const attribution = player.deathAttribution;
  if (!attribution || attribution.at === actor._lastDeathAt) return;
  actor._lastDeathAt = attribution.at ?? null;
  const death = {
    atMs: Math.max(0, Math.round(elapsedMs)),
    killerId: attribution.killerId ?? null,
    assisterIds: copy(attribution.assisterIds ?? []),
    weaponId: attribution.weaponId ?? null,
    gadgetId: attribution.gadgetId ?? null,
  };
  actor.deaths.push(death);
  if (actor.deaths.length > MAX_MATCH_REPORT_HISTORY) actor.deaths.shift();
  if (!death.killerId || !death.weaponId || death.gadgetId) return;
  const weaponKills = report.combat.weaponKills[death.killerId] ??= {};
  weaponKills[death.weaponId] = (weaponKills[death.weaponId] ?? 0) + 1;
}

function updateActorRecord(report, actor, player, elapsedMs, addLocation) {
  const snapshot = getActorSnapshot(player);
  actor.final = snapshot;
  const signature = getLoadoutSignature(snapshot);
  if (signature !== actor._loadoutSignature) {
    const previousCounts = actor._previousGadgetCounts ?? {};
    for (const gadgetId of new Set([
      ...Object.keys(previousCounts),
      ...Object.keys(snapshot.gadgetCounts),
    ])) {
      const usedCount = Math.max(0,
        (previousCounts[gadgetId] ?? 0) - (snapshot.gadgetCounts[gadgetId] ?? 0));
      if (usedCount > 0) {
        const use = { atMs: Math.max(0, Math.round(elapsedMs)), gadgetId, count: usedCount };
        actor.gadgetUses.push(use);
      }
    }
    const change = {
      atMs: Math.max(0, Math.round(elapsedMs)),
      selectedWeaponId: snapshot.selectedWeaponId,
      selectedGadgetId: snapshot.selectedGadgetId,
      gadgetCounts: copy(snapshot.gadgetCounts),
      inventory: copy(snapshot.inventory),
      inventoryWeaponIds: copy(snapshot.inventoryWeaponIds),
    };
    actor.loadoutHistory.push(change);
    if (actor.loadoutHistory.length > MAX_MATCH_REPORT_HISTORY) actor.loadoutHistory.shift();
    actor._loadoutSignature = signature;
    actor._previousGadgetCounts = copy(snapshot.gadgetCounts);
  }
  addActorDeath(report, actor, player, elapsedMs);
  const sampleAt = Math.max(0, Math.round(elapsedMs));
  if (addLocation && report._locationSampleCount < MAX_MATCH_REPORT_TOTAL_LOCATIONS &&
      actor.isBot && Number.isFinite(player.x) && Number.isFinite(player.y) &&
      actor.locationSamples.at(-1)?.[0] !== sampleAt &&
      actor.locationSamples.length < MAX_MATCH_REPORT_SAMPLES) {
    actor.locationSamples.push([
      sampleAt,
      Math.round(player.x),
      Math.round(player.y),
      player.alive === false ? 0 : 1,
    ]);
    report._locationSampleCount += 1;
  }
}

function sampleActors(report, players, elapsedMs, addLocation) {
  for (const player of players) {
    if (!player?.id) continue;
    let actor = report._actorsById.get(player.id);
    if (!actor && report.actors.length < MAX_MATCH_REPORT_ACTORS) {
      actor = createActorRecord(player, elapsedMs);
      report._actorsById.set(player.id, actor);
      report.actors.push(actor);
      report._locationSampleCount += actor.locationSamples.length;
    }
    if (actor) updateActorRecord(report, actor, player, elapsedMs, addLocation);
  }
}

function flushPerformanceBucket(report) {
  const bucket = report._activePerformanceBucket;
  if (!bucket) return;
  if (report.performance.buckets.length < MAX_MATCH_REPORT_SAMPLES) {
    report.performance.buckets.push(bucket);
  }
  report._activePerformanceBucket = null;
}

function mergePerformanceBuckets(first, second) {
  const phases = { ...first.phases };
  for (const [phase, metric] of Object.entries(second.phases)) {
    const previous = phases[phase] ?? { count: 0, totalMs: 0, maxMs: 0 };
    phases[phase] = {
      count: previous.count + metric.count,
      totalMs: previous.totalMs + metric.totalMs,
      maxMs: Math.max(previous.maxMs, metric.maxMs),
    };
  }
  const work = { ...first.work };
  for (const [name, metric] of Object.entries(second.work)) {
    const previous = work[name] ?? { samples: 0, total: 0, max: 0 };
    work[name] = {
      samples: previous.samples + metric.samples,
      total: previous.total + metric.total,
      max: Math.max(previous.max, metric.max),
    };
  }
  return {
    second: first.second,
    frames: first.frames + second.frames,
    totalMs: first.totalMs + second.totalMs,
    maxMs: Math.max(first.maxMs, second.maxMs),
    slowFrames: first.slowFrames.map((count, index) => count + second.slowFrames[index]),
    phases,
    work,
  };
}

function compactMatchReport(report) {
  const byteLength = () => new TextEncoder().encode(JSON.stringify(report)).byteLength;
  while (byteLength() > MAX_MATCH_REPORT_BYTES) {
    let compacted = false;
    for (const actor of report.actors) {
      if (actor.locationSamples.length <= 2) continue;
      actor.locationSamples = actor.locationSamples.filter((_, index, samples) =>
        index === 0 || index === samples.length - 1 || index % 2 === 0);
      compacted = true;
    }
    if (!compacted && report.performance.buckets.length > 1) {
      const merged = [];
      for (let index = 0; index < report.performance.buckets.length; index += 2) {
        const first = report.performance.buckets[index];
        const second = report.performance.buckets[index + 1];
        merged.push(second ? mergePerformanceBuckets(first, second) : first);
      }
      report.performance.buckets = merged;
      compacted = true;
    }
    if (!compacted && report.network.frameIntervalSpikes.length > 2) {
      report.network.frameIntervalSpikes = report.network.frameIntervalSpikes.filter((_, index, samples) =>
        index === 0 || index === samples.length - 1 || index % 2 === 0);
      compacted = true;
    }
    if (!compacted) {
      for (const actor of report.actors) {
        for (const history of [actor.loadoutHistory, actor.gadgetUses, actor.deaths]) {
          if (history.length <= 2) continue;
          history.splice(0, history.length, ...history.filter((_, index, entries) =>
            index === entries.length - 1 || index % 2 === 0));
          compacted = true;
        }
      }
    }
    if (!compacted) return false;
  }
  return true;
}

function ensurePerformanceBucket(report, monotonicNow) {
  const elapsedMs = Math.max(0,
    report._captureOffsetMs + monotonicNow - report._captureStartedAt);
  const second = Math.floor(elapsedMs / 1_000);
  if (report._activePerformanceBucket?.second === second) return report._activePerformanceBucket;
  flushPerformanceBucket(report);
  report._activePerformanceBucket = {
    second,
    frames: 0,
    totalMs: 0,
    maxMs: 0,
    slowFrames: [0, 0, 0],
    phases: {},
    work: {},
  };
  return report._activePerformanceBucket;
}

export function createMatchReport(match, {
  hostId,
  gameMode = null,
  roomName = null,
  players = match?.players ?? [],
  now = Date.now(),
  monotonicNow = performance.now(),
} = {}) {
  if (!match || !Number.isFinite(match.startedAt) || typeof hostId !== 'string' ||
      !Number.isFinite(now) || !Number.isFinite(monotonicNow)) {
    throw new TypeError('A match, host, and valid capture timestamps are required.');
  }
  const map = match.map ?? {};
  const report = {
    schemaVersion: MATCH_REPORT_SCHEMA_VERSION,
    reportId: `${hostId}:${match.startedAt}`,
    matchId: match.startedAt,
    hostId,
    roomName,
    gameMode,
    startedAt: match.startedAt,
    capturedAt: new Date(now).toISOString(),
    map: {
      seed: map.seed ?? null,
      fingerprint: map.fingerprint ?? null,
      width: map.width ?? null,
      height: map.height ?? null,
      roomCount: map.metrics?.roomCount ?? map.rooms?.length ?? null,
      objectCount: map.objects?.length ?? 0,
      complexity: copy(map.metrics?.complexity ?? null),
    },
    actors: [],
    combat: { weaponKills: {} },
    performance: {
      frames: 0,
      totalMs: 0,
      maxMs: 0,
      slowFrames: [0, 0, 0],
      frameSamples: [],
      buckets: [],
      phases: {},
      work: {},
    },
    network: {
      hostFramesSent: 0,
      maxFrameIntervalMs: 0,
      frameIntervalsOver100Ms: 0,
      frameIntervalsOver50Ms: 0,
      frameIntervalSpikes: [],
      maxBufferedBytes: 0,
    },
    result: null,
    completedAt: null,
    durationMs: null,
  };
  Object.defineProperties(report, {
    _captureStartedAt: { value: monotonicNow },
    _captureOffsetMs: { value: Math.max(0, now - match.startedAt) },
    _lastActorSampleAt: { value: Math.max(0, now - match.startedAt), writable: true },
    _actorsById: { value: new Map() },
    _activePerformanceBucket: { value: null, writable: true },
    _lastHostFrameAt: { value: null, writable: true },
    _locationSampleCount: { value: 0, writable: true },
  });
  for (const player of players) {
    if (!player?.id || report._actorsById.has(player.id) ||
        report.actors.length >= MAX_MATCH_REPORT_ACTORS) continue;
    const actor = createActorRecord(player, report._captureOffsetMs);
    report._actorsById.set(player.id, actor);
    report.actors.push(actor);
    report._locationSampleCount += actor.locationSamples.length;
  }
  return report;
}

export function beginMatchReportFrame(report, monotonicNow = performance.now()) {
  if (!report || report.completed) return;
  ensurePerformanceBucket(report, monotonicNow);
}

export function recordMatchReportPhase(report, phase, durationMs) {
  if (!report || report.completed || typeof phase !== 'string' ||
      !Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = report._activePerformanceBucket;
  if (!bucket) return;
  const metric = bucket.phases[phase] ??= { count: 0, totalMs: 0, maxMs: 0 };
  metric.count += 1;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
  const overall = report.performance.phases[phase] ??= { count: 0, totalMs: 0, maxMs: 0 };
  overall.count += 1;
  overall.totalMs += durationMs;
  overall.maxMs = Math.max(overall.maxMs, durationMs);
}

export function recordMatchReportWork(report, name, value) {
  if (!report || report.completed || typeof name !== 'string' ||
      !MATCH_REPORT_WORK_METRICS.has(name) ||
      !Number.isFinite(value) || value < 0) return;
  const bucket = report._activePerformanceBucket;
  if (!bucket) return;
  const update = (metrics) => {
    const metric = metrics[name] ??= { samples: 0, total: 0, max: 0 };
    metric.samples += 1;
    metric.total += value;
    metric.max = Math.max(metric.max, value);
  };
  update(bucket.work);
  update(report.performance.work);
}

export function recordMatchReportFrame(report, frameMs, {
  match,
  players = match?.players ?? [],
  monotonicNow = performance.now(),
  frameDeltaMs = null,
  phaseDurations = {},
  botProfile = null,
} = {}) {
  if (!report || report.completed || !Number.isFinite(frameMs) || frameMs < 0) return;
  const bucket = ensurePerformanceBucket(report, monotonicNow);
  report.performance.frames += 1;
  report.performance.totalMs += frameMs;
  report.performance.maxMs = Math.max(report.performance.maxMs, frameMs);
  bucket.frames += 1;
  bucket.totalMs += frameMs;
  bucket.maxMs = Math.max(bucket.maxMs, frameMs);
  SLOW_FRAME_THRESHOLDS_MS.forEach((threshold, index) => {
    if (frameMs >= threshold) {
      report.performance.slowFrames[index] += 1;
      bucket.slowFrames[index] += 1;
    }
  });
  const elapsedMs = Math.max(0,
    report._captureOffsetMs + monotonicNow - report._captureStartedAt);
  if (frameMs >= SLOW_FRAME_THRESHOLDS_MS[1]) {
    const frameSamples = report.performance.frameSamples;
    const sample = {
      atMs: Math.max(0, Math.round(elapsedMs)),
      frameMs: Math.round(frameMs * 10) / 10,
      frameDeltaMs: Number.isFinite(frameDeltaMs)
        ? Math.round(Math.max(0, frameDeltaMs) * 10) / 10
        : null,
      phases: Object.fromEntries(Object.entries(phaseDurations)
        .filter(([, duration]) => Number.isFinite(duration) && duration >= 0)
        .map(([phase, duration]) => [phase, Math.round(duration * 10) / 10])),
      botDecisionCount: Number.isSafeInteger(botProfile?.decisionCount)
        ? Math.max(0, botProfile.decisionCount)
        : 0,
      botDecisionMs: Number.isFinite(botProfile?.totalDecisionMs)
        ? Math.round(Math.max(0, botProfile.totalDecisionMs) * 10) / 10
        : 0,
      botDecisions: (botProfile?.slowestDecisions ?? [])
        .filter((decision) => typeof decision?.botId === 'string' &&
          Number.isFinite(decision.durationMs) && decision.durationMs >= 0)
        .sort((left, right) => right.durationMs - left.durationMs)
        .slice(0, MAX_MATCH_REPORT_BOT_DECISION_SAMPLES)
        .map(({ botId, durationMs }) => ({
          botId,
          durationMs: Math.round(durationMs * 10) / 10,
        })),
    };
    if (frameSamples.length < MAX_MATCH_REPORT_FRAME_SAMPLES) {
      frameSamples.push(sample);
    } else {
      let shortestIndex = 0;
      for (let index = 1; index < frameSamples.length; index += 1) {
        if (frameSamples[index].frameMs < frameSamples[shortestIndex].frameMs) shortestIndex = index;
      }
      if (sample.frameMs > frameSamples[shortestIndex].frameMs) {
        frameSamples[shortestIndex] = sample;
      }
    }
    frameSamples.sort((left, right) => right.frameMs - left.frameMs);
  }
  const shouldSample = elapsedMs - report._lastActorSampleAt >= MATCH_REPORT_SAMPLE_INTERVAL_MS;
  if (shouldSample || match?.victory) {
    sampleActors(report, players, elapsedMs, shouldSample || Boolean(match?.victory));
    if (shouldSample) report._lastActorSampleAt = elapsedMs;
  }
}

export function recordMatchReportHostFrame(report, {
  monotonicNow = performance.now(),
  bufferedBytes = 0,
} = {}) {
  if (!report || report.completed) return;
  report.network.hostFramesSent += 1;
  report.network.maxBufferedBytes = Math.max(report.network.maxBufferedBytes,
    Number.isFinite(bufferedBytes) ? bufferedBytes : 0);
  if (Number.isFinite(report._lastHostFrameAt)) {
    const intervalMs = Math.max(0, monotonicNow - report._lastHostFrameAt);
    report.network.maxFrameIntervalMs = Math.max(report.network.maxFrameIntervalMs, intervalMs);
    if (intervalMs > 100) report.network.frameIntervalsOver100Ms += 1;
    if (intervalMs >= 50) {
      report.network.frameIntervalsOver50Ms += 1;
      if (report.network.frameIntervalSpikes.length < MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
        const elapsedMs = Math.max(0,
          report._captureOffsetMs + monotonicNow - report._captureStartedAt);
        report.network.frameIntervalSpikes.push({
          atMs: Math.round(elapsedMs),
          intervalMs: Math.round(intervalMs * 10) / 10,
          bufferedBytes: Number.isFinite(bufferedBytes) ? Math.max(0, Math.round(bufferedBytes)) : 0,
        });
      }
    }
  }
  report._lastHostFrameAt = monotonicNow;
}

export function completeMatchReport(report, match, players, {
  now = Date.now(),
  monotonicNow = performance.now(),
} = {}) {
  if (!report || report.completed || report.matchId !== match?.startedAt ||
      !match?.victory || !Number.isFinite(now) || !Number.isFinite(monotonicNow)) return false;
  const elapsedMs = Math.max(0,
    report._captureOffsetMs + monotonicNow - report._captureStartedAt);
  sampleActors(report, players, elapsedMs, true);
  flushPerformanceBucket(report);
  report.result = {
    victory: copy(match.victory),
    round: match.quickPlayState?.round ?? null,
    score: copy(match.quickPlayState?.score ?? null),
  };
  report.completedAt = new Date(now).toISOString();
  report.durationMs = Math.max(0, now - match.startedAt);
  report.performance.averageMs = report.performance.frames > 0
    ? report.performance.totalMs / report.performance.frames : 0;
  for (const actor of report.actors) {
    actor.won = actor.team === match.victory.winner;
  }
  report.completed = true;
  report.storageEligible = compactMatchReport(report);
  return true;
}

export function createMatchClientDiagnostics(match, {
  playerId,
  hostId = null,
  gameMode = null,
  roomName = null,
  now = Date.now(),
  monotonicNow = performance.now(),
} = {}) {
  if (!match || !Number.isFinite(match.startedAt) ||
      typeof playerId !== 'string' || playerId.length < 1 ||
      !Number.isFinite(now) || !Number.isFinite(monotonicNow)) {
    throw new TypeError('A match, player, and valid capture timestamps are required.');
  }
  const diagnostics = {
    schemaVersion: MATCH_CLIENT_DIAGNOSTICS_SCHEMA_VERSION,
    matchId: match.startedAt,
    playerId,
    hostId,
    gameMode,
    roomName,
    startedAt: match.startedAt,
    capturedAt: new Date(now).toISOString(),
    completedAt: null,
    durationMs: null,
    completed: false,
    performance: {
      frames: 0,
      totalMs: 0,
      maxMs: 0,
      slowFrames: [0, 0, 0],
      frameSpikes: [],
      phases: {},
      frameDelta: {
        samples: 0,
        totalMs: 0,
        maxMs: 0,
        averageMs: 0,
        slowFrames: [0, 0, 0],
        spikes: [],
      },
    },
    hostFrames: {
      sent: 0,
      received: 0,
      applied: 0,
      rejected: 0,
      revisionGaps: 0,
      intervalSamples: 0,
      totalIntervalMs: 0,
      maxIntervalMs: 0,
      averageIntervalMs: 0,
      intervalsOver50Ms: 0,
      intervalsOver100Ms: 0,
      intervalSpikes: [],
      applySamples: 0,
      totalApplyMs: 0,
      maxApplyMs: 0,
      averageApplyMs: 0,
    },
    network: {
      heartbeatSamples: 0,
      totalHeartbeatRttMs: 0,
      maxHeartbeatRttMs: 0,
      averageHeartbeatRttMs: 0,
      heartbeatsOver100Ms: 0,
      heartbeatsOver250Ms: 0,
      heartbeatRttSamples: [],
      reconnects: 0,
    },
  };
  Object.defineProperties(diagnostics, {
    _captureStartedAt: { value: monotonicNow },
    _lastHostFrameAtByDirection: { value: { TX: null, RX: null } },
    _lastHostFrameRevision: { value: null, writable: true },
    _lastConnectionState: { value: null, writable: true },
  });
  return diagnostics;
}

export function recordMatchClientFrame(diagnostics, frameMs, {
  frameDeltaMs = null,
  monotonicNow = performance.now(),
} = {}) {
  if (!diagnostics || diagnostics.completed || !Number.isFinite(frameMs) || frameMs < 0 ||
      !Number.isFinite(monotonicNow)) return;
  const performanceMetrics = diagnostics.performance;
  performanceMetrics.frames += 1;
  performanceMetrics.totalMs += frameMs;
  performanceMetrics.maxMs = Math.max(performanceMetrics.maxMs, frameMs);
  SLOW_FRAME_THRESHOLDS_MS.forEach((threshold, index) => {
    if (frameMs >= threshold) performanceMetrics.slowFrames[index] += 1;
  });
  if (frameMs >= SLOW_FRAME_THRESHOLDS_MS[0] &&
      performanceMetrics.frameSpikes.length < MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
    performanceMetrics.frameSpikes.push({
      atMs: Math.max(0, Math.round(monotonicNow - diagnostics._captureStartedAt)),
      frameMs: Math.round(frameMs * 10) / 10,
    });
  }
  if (Number.isFinite(frameDeltaMs) && frameDeltaMs >= 0) {
    const frameDelta = performanceMetrics.frameDelta;
    frameDelta.samples += 1;
    frameDelta.totalMs += frameDeltaMs;
    frameDelta.maxMs = Math.max(frameDelta.maxMs, frameDeltaMs);
    SLOW_FRAME_THRESHOLDS_MS.forEach((threshold, index) => {
      if (frameDeltaMs >= threshold) frameDelta.slowFrames[index] += 1;
    });
    if (frameDeltaMs >= SLOW_FRAME_THRESHOLDS_MS[0] &&
        frameDelta.spikes.length < MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
      frameDelta.spikes.push({
        atMs: Math.max(0, Math.round(monotonicNow - diagnostics._captureStartedAt)),
        deltaMs: Math.round(frameDeltaMs * 10) / 10,
      });
    }
  }
}

export function recordMatchClientPhase(diagnostics, phase, durationMs) {
  if (!diagnostics || diagnostics.completed || typeof phase !== 'string' ||
      !Number.isFinite(durationMs) || durationMs < 0) return;
  const metric = diagnostics.performance.phases[phase] ??=
    { count: 0, totalMs: 0, maxMs: 0 };
  metric.count += 1;
  metric.totalMs += durationMs;
  metric.maxMs = Math.max(metric.maxMs, durationMs);
}

export function recordMatchClientHostFrame(diagnostics, {
  direction,
  monotonicNow = performance.now(),
  revision = null,
  applyMs = null,
  applied = false,
} = {}) {
  if (!diagnostics || diagnostics.completed || !['TX', 'RX'].includes(direction) ||
      !Number.isFinite(monotonicNow)) return;
  const metrics = diagnostics.hostFrames;
  const previousAt = diagnostics._lastHostFrameAtByDirection[direction];
  if (direction === 'TX') {
    metrics.sent += 1;
  } else {
    metrics.received += 1;
    if (applied) metrics.applied += 1;
    else metrics.rejected += 1;
    if (Number.isInteger(revision)) {
      if (Number.isInteger(diagnostics._lastHostFrameRevision) &&
          revision > diagnostics._lastHostFrameRevision + 1) {
        metrics.revisionGaps += revision - diagnostics._lastHostFrameRevision - 1;
      }
      if (!Number.isInteger(diagnostics._lastHostFrameRevision) ||
          revision > diagnostics._lastHostFrameRevision) {
        diagnostics._lastHostFrameRevision = revision;
      }
    }
    if (Number.isFinite(applyMs) && applyMs >= 0) {
      metrics.applySamples += 1;
      metrics.totalApplyMs += applyMs;
      metrics.maxApplyMs = Math.max(metrics.maxApplyMs, applyMs);
    }
  }
  if (Number.isFinite(previousAt)) {
    const intervalMs = Math.max(0, monotonicNow - previousAt);
    metrics.intervalSamples += 1;
    metrics.totalIntervalMs += intervalMs;
    metrics.maxIntervalMs = Math.max(metrics.maxIntervalMs, intervalMs);
    if (intervalMs >= 50) {
      metrics.intervalsOver50Ms += 1;
      if (intervalMs > 100) metrics.intervalsOver100Ms += 1;
      if (metrics.intervalSpikes.length < MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
        metrics.intervalSpikes.push({
          atMs: Math.max(0, Math.round(monotonicNow - diagnostics._captureStartedAt)),
          intervalMs: Math.round(intervalMs * 10) / 10,
        });
      }
    }
  }
  diagnostics._lastHostFrameAtByDirection[direction] = monotonicNow;
}

export function recordMatchClientHeartbeat(diagnostics, {
  rttMs,
  monotonicNow = performance.now(),
} = {}) {
  if (!diagnostics || diagnostics.completed || !Number.isFinite(rttMs) || rttMs < 0 ||
      !Number.isFinite(monotonicNow)) return;
  const metrics = diagnostics.network;
  metrics.heartbeatSamples += 1;
  metrics.totalHeartbeatRttMs += rttMs;
  metrics.maxHeartbeatRttMs = Math.max(metrics.maxHeartbeatRttMs, rttMs);
  if (rttMs > 100) metrics.heartbeatsOver100Ms += 1;
  if (rttMs > 250) metrics.heartbeatsOver250Ms += 1;
  if (metrics.heartbeatRttSamples.length < MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
    metrics.heartbeatRttSamples.push({
      atMs: Math.max(0, Math.round(monotonicNow - diagnostics._captureStartedAt)),
      rttMs: Math.round(rttMs * 10) / 10,
    });
  }
}

export function recordMatchClientConnection(diagnostics, state) {
  if (!diagnostics || diagnostics.completed || typeof state !== 'string') return;
  if (state === 'reconnecting' && diagnostics._lastConnectionState !== 'reconnecting') {
    diagnostics.network.reconnects += 1;
  }
  diagnostics._lastConnectionState = state;
}

export function completeMatchClientDiagnostics(diagnostics, match, {
  now = Date.now(),
} = {}) {
  if (!diagnostics || diagnostics.completed || diagnostics.matchId !== match?.startedAt ||
      !match?.victory || !Number.isFinite(now)) return false;
  diagnostics.completedAt = new Date(now).toISOString();
  diagnostics.durationMs = Math.max(0, now - diagnostics.startedAt);
  diagnostics.performance.averageMs = diagnostics.performance.frames > 0
    ? diagnostics.performance.totalMs / diagnostics.performance.frames : 0;
  const frameDelta = diagnostics.performance.frameDelta;
  frameDelta.averageMs = frameDelta.samples > 0 ? frameDelta.totalMs / frameDelta.samples : 0;
  const hostFrames = diagnostics.hostFrames;
  hostFrames.averageIntervalMs = hostFrames.intervalSamples > 0
    ? hostFrames.totalIntervalMs / hostFrames.intervalSamples : 0;
  hostFrames.averageApplyMs = hostFrames.applySamples > 0
    ? hostFrames.totalApplyMs / hostFrames.applySamples : 0;
  const network = diagnostics.network;
  network.averageHeartbeatRttMs = network.heartbeatSamples > 0
    ? network.totalHeartbeatRttMs / network.heartbeatSamples : 0;
  diagnostics.completed = true;
  return true;
}

export function validateMatchClientDiagnostics(diagnostics, expectedMatchId = diagnostics?.matchId) {
  const invalid = (reason) => ({ valid: false, reason });
  const performanceMetrics = diagnostics?.performance;
  const frameDelta = performanceMetrics?.frameDelta;
  const hostFrames = diagnostics?.hostFrames;
  const network = diagnostics?.network;
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics) ||
      diagnostics.schemaVersion !== MATCH_CLIENT_DIAGNOSTICS_SCHEMA_VERSION ||
      diagnostics.matchId !== expectedMatchId || !Number.isFinite(diagnostics.matchId) ||
      typeof diagnostics.playerId !== 'string' || diagnostics.playerId.length < 1 ||
      diagnostics.playerId.length > 96 || diagnostics.completed !== true ||
      !Number.isSafeInteger(performanceMetrics?.frames) || performanceMetrics.frames < 0 ||
      !Number.isFinite(performanceMetrics.totalMs) || performanceMetrics.totalMs < 0 ||
      !Number.isFinite(performanceMetrics.maxMs) || performanceMetrics.maxMs < 0 ||
      !Number.isFinite(performanceMetrics.averageMs) || performanceMetrics.averageMs < 0 ||
      !Array.isArray(performanceMetrics.slowFrames) ||
      performanceMetrics.slowFrames.length !== SLOW_FRAME_THRESHOLDS_MS.length ||
      !Array.isArray(performanceMetrics.frameSpikes) ||
      performanceMetrics.frameSpikes.length > MAX_MATCH_REPORT_TIMELINE_SAMPLES ||
      !frameDelta || !Number.isSafeInteger(frameDelta.samples) || frameDelta.samples < 0 ||
      !Number.isFinite(frameDelta.totalMs) || frameDelta.totalMs < 0 ||
      !Number.isFinite(frameDelta.maxMs) || frameDelta.maxMs < 0 ||
      !Number.isFinite(frameDelta.averageMs) || frameDelta.averageMs < 0 ||
      !Array.isArray(frameDelta.slowFrames) ||
      frameDelta.slowFrames.length !== SLOW_FRAME_THRESHOLDS_MS.length ||
      !Array.isArray(frameDelta.spikes) ||
      frameDelta.spikes.length > MAX_MATCH_REPORT_TIMELINE_SAMPLES ||
      !isValidPhaseMetrics(performanceMetrics.phases) ||
      !hostFrames || !Array.isArray(hostFrames.intervalSpikes) ||
      hostFrames.intervalSpikes.length > MAX_MATCH_REPORT_TIMELINE_SAMPLES ||
      !network || !Array.isArray(network.heartbeatRttSamples) ||
      network.heartbeatRttSamples.length > MAX_MATCH_REPORT_TIMELINE_SAMPLES) {
    return invalid('Client diagnostics metadata or collection limits are invalid.');
  }
  for (const count of [...performanceMetrics.slowFrames, ...frameDelta.slowFrames]) {
    if (!Number.isSafeInteger(count) || count < 0) {
      return invalid('Client diagnostics contain invalid slow-frame counts.');
    }
  }
  for (const key of [
    'sent', 'received', 'applied', 'rejected', 'revisionGaps', 'intervalSamples',
    'intervalsOver50Ms', 'intervalsOver100Ms', 'applySamples',
  ]) {
    if (!Number.isSafeInteger(hostFrames[key]) || hostFrames[key] < 0) {
      return invalid('Client diagnostics contain invalid host-frame counts.');
    }
  }
  for (const key of [
    'totalIntervalMs', 'maxIntervalMs', 'averageIntervalMs',
    'totalApplyMs', 'maxApplyMs', 'averageApplyMs',
  ]) {
    if (!Number.isFinite(hostFrames[key]) || hostFrames[key] < 0) {
      return invalid('Client diagnostics contain invalid host-frame timings.');
    }
  }
  for (const key of [
    'heartbeatSamples', 'heartbeatsOver100Ms', 'heartbeatsOver250Ms', 'reconnects',
  ]) {
    if (!Number.isSafeInteger(network[key]) || network[key] < 0) {
      return invalid('Client diagnostics contain invalid network counts.');
    }
  }
  for (const key of ['totalHeartbeatRttMs', 'maxHeartbeatRttMs', 'averageHeartbeatRttMs']) {
    if (!Number.isFinite(network[key]) || network[key] < 0) {
      return invalid('Client diagnostics contain invalid heartbeat timings.');
    }
  }
  for (const spike of diagnostics.performance.frameSpikes) {
    if (!spike || !Number.isSafeInteger(spike.atMs) || spike.atMs < 0 ||
        !Number.isFinite(spike.frameMs) || spike.frameMs < SLOW_FRAME_THRESHOLDS_MS[0]) {
      return invalid('Client diagnostics contain an invalid frame spike.');
    }
    for (const spike of diagnostics.performance.frameDelta.spikes) {
      if (!spike || !Number.isSafeInteger(spike.atMs) || spike.atMs < 0 ||
          !Number.isFinite(spike.deltaMs) || spike.deltaMs < SLOW_FRAME_THRESHOLDS_MS[0]) {
        return invalid('Client diagnostics contain an invalid frame-delta sample.');
      }
    }
  }
  for (const spike of diagnostics.hostFrames.intervalSpikes) {
    if (!spike || !Number.isSafeInteger(spike.atMs) || spike.atMs < 0 ||
        !Number.isFinite(spike.intervalMs) || spike.intervalMs < 50) {
      return invalid('Client diagnostics contain an invalid host-frame interval.');
    }
  }
  for (const sample of diagnostics.network.heartbeatRttSamples) {
    if (!sample || !Number.isSafeInteger(sample.atMs) || sample.atMs < 0 ||
        !Number.isFinite(sample.rttMs) || sample.rttMs < 0) {
      return invalid('Client diagnostics contain an invalid heartbeat sample.');
    }
  }
  let serialized;
  try {
    serialized = JSON.stringify(diagnostics);
  } catch {
    return invalid('Client diagnostics are not serializable.');
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_MATCH_CLIENT_DIAGNOSTICS_BYTES) {
    return invalid('Client diagnostics exceed the maximum stored size.');
  }
  return { valid: true, byteLength };
}

export function validateMatchReport(report, expectedMatchId = report?.matchId) {
  const invalid = (reason) => ({ valid: false, reason });
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.schemaVersion !== MATCH_REPORT_SCHEMA_VERSION ||
      report.matchId !== expectedMatchId || !Number.isFinite(report.matchId) ||
      typeof report.hostId !== 'string' || report.hostId.length < 1 || report.hostId.length > 96 ||
      report.completed !== true || !Array.isArray(report.actors) ||
      report.actors.length > MAX_MATCH_REPORT_ACTORS ||
      !report.result?.victory || !['red', 'blue'].includes(report.result.victory.winner) ||
      !report.performance || !Number.isSafeInteger(report.performance.frames) ||
      report.performance.frames < 0 || !Array.isArray(report.performance.buckets) ||
      report.performance.buckets.length > MAX_MATCH_REPORT_SAMPLES ||
      !Number.isFinite(report.performance.totalMs) || report.performance.totalMs < 0 ||
      !Number.isFinite(report.performance.maxMs) || report.performance.maxMs < 0 ||
      !Number.isFinite(report.performance.averageMs) || report.performance.averageMs < 0 ||
      (report.performance.frameSamples !== undefined &&
        (!Array.isArray(report.performance.frameSamples) ||
          report.performance.frameSamples.length > MAX_MATCH_REPORT_FRAME_SAMPLES ||
          !report.performance.frameSamples.every(isValidFrameSample))) ||
      !isValidPhaseMetrics(report.performance.phases)) {
    return invalid('Match report metadata or collection limits are invalid.');
  }
  if (!report.network || !Array.isArray(report.network.frameIntervalSpikes) ||
      report.network.frameIntervalSpikes.length > MAX_MATCH_REPORT_TIMELINE_SAMPLES ||
      !isValidWorkMetrics(report.performance.work) ||
      !Number.isSafeInteger(report.network.hostFramesSent) || report.network.hostFramesSent < 0 ||
      !Number.isSafeInteger(report.network.frameIntervalsOver50Ms) ||
      report.network.frameIntervalsOver50Ms < 0 ||
      !Number.isSafeInteger(report.network.frameIntervalsOver100Ms) ||
      report.network.frameIntervalsOver100Ms < 0 ||
      !Number.isFinite(report.network.maxFrameIntervalMs) || report.network.maxFrameIntervalMs < 0 ||
      !Number.isFinite(report.network.maxBufferedBytes) || report.network.maxBufferedBytes < 0) {
    return invalid('Match report contains invalid performance or network metrics.');
  }
  for (const bucket of report.performance.buckets) {
    if (!bucket || !Number.isSafeInteger(bucket.frames) || bucket.frames < 0 ||
        !Number.isFinite(bucket.totalMs) || bucket.totalMs < 0 ||
        !Number.isFinite(bucket.maxMs) || bucket.maxMs < 0 ||
        !Array.isArray(bucket.slowFrames) ||
        bucket.slowFrames.length !== SLOW_FRAME_THRESHOLDS_MS.length ||
        bucket.slowFrames.some((count) => !Number.isSafeInteger(count) || count < 0) ||
        !isValidPhaseMetrics(bucket.phases) ||
        !isValidWorkMetrics(bucket.work ?? {})) {
      return invalid('Match report contains invalid performance work metrics.');
    }
  }
  for (const spike of report.network.frameIntervalSpikes) {
    if (!spike || !Number.isSafeInteger(spike.atMs) || spike.atMs < 0 ||
        !Number.isFinite(spike.intervalMs) || spike.intervalMs < 50 ||
        !Number.isSafeInteger(spike.bufferedBytes) || spike.bufferedBytes < 0) {
      return invalid('Match report contains an invalid host-frame interval sample.');
    }
  }
  const actorIds = new Set();
  for (const actor of report.actors) {
    if (!actor || typeof actor.id !== 'string' || actor.id.length < 1 || actor.id.length > 96 ||
        !['red', 'blue'].includes(actor.team) || typeof actor.isBot !== 'boolean' ||
        actorIds.has(actor.id) || !Array.isArray(actor.locationSamples) ||
        actor.locationSamples.length > MAX_MATCH_REPORT_SAMPLES ||
        !Array.isArray(actor.loadoutHistory) || actor.loadoutHistory.length > MAX_MATCH_REPORT_HISTORY ||
        !Array.isArray(actor.gadgetUses) || actor.gadgetUses.length > MAX_MATCH_REPORT_HISTORY ||
        !Array.isArray(actor.deaths) || actor.deaths.length > MAX_MATCH_REPORT_HISTORY) {
      return invalid('Match report contains an invalid actor record.');
    }
    actorIds.add(actor.id);
  }
  let serialized;
  try {
    serialized = JSON.stringify(report);
  } catch {
    return invalid('Match report is not serializable.');
  }
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_MATCH_REPORT_BYTES) {
    return invalid('Match report exceeds the maximum stored size.');
  }
  return { valid: true, byteLength };
}
