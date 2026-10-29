import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
} from '../../shared/MatchReport.js';
import { MAX_MATCH_REPORT_BYTES } from '../../shared/MatchReport.js';

function createPlayers() {
  return [
    {
      id: 'bot-killer',
      name: 'Bot Killer',
      isBot: true,
      team: 'red',
      x: 100,
      y: 200,
      alive: true,
      selectedWeaponId: 'assault-rifle',
      selectedGadgetId: 'smoke-grenade',
      gadgetCounts: { 'smoke-grenade': 1 },
      inventory: { armor: { id: 'armor', level: 1 }, perks: [] },
      inventoryWeaponIds: ['assault-rifle'],
      stats: { kills: 0, assists: 0, deaths: 0 },
      weaponStats: { 'assault-rifle': { ammo: 20, reserveAmmo: 80, shotsFired: 4 } },
    },
    {
      id: 'bot-victim',
      name: 'Bot Victim',
      isBot: true,
      team: 'blue',
      x: 300,
      y: 200,
      alive: true,
      selectedWeaponId: 'revolver',
      selectedGadgetId: 'cryo-grenade',
      gadgetCounts: { 'cryo-grenade': 1 },
      inventory: { armor: null, perks: [] },
      stats: { kills: 0, assists: 0, deaths: 0 },
    },
  ];
}

function createMatch(players = createPlayers()) {
  return {
    startedAt: 1_000,
    gameplayStartsAt: 1_000,
    endsAt: 121_000,
    map: {
      seed: 123,
      fingerprint: 'map-fingerprint',
      width: 1_000,
      height: 700,
      rooms: [{ id: 'room-a' }],
      objects: [],
      metrics: { complexity: { roomCount: 1 } },
    },
    players,
    quickPlayState: { round: 2, score: { red: 1, blue: 0 } },
    victory: null,
  };
}

describe('MatchReport', () => {
  it('records bot loadouts, uses, deaths, locations, and per-frame compute phases', () => {
    const players = createPlayers();
    const match = createMatch(players);
    const report = createMatchReport(match, {
      hostId: 'host-id',
      gameMode: 'longplay',
      roomName: 'diagnostics',
      players,
      now: 1_000,
      monotonicNow: 0,
    });

    beginMatchReportFrame(report, 0);
    recordMatchReportPhase(report, 'simulation', 5);
    recordMatchReportWork(report, 'vision.livePlayers', 3);
    recordMatchReportFrame(report, 20, { match, players, monotonicNow: 0 });

    players[0].x = 125;
    players[0].gadgetCounts['smoke-grenade'] = 0;
    players[0].inventory.perks.push({ id: 'reload-training', level: 1 });
    players[1].alive = false;
    players[1].stats.deaths = 1;
    players[1].deathAttribution = {
      killerId: 'bot-killer',
      assisterIds: [],
      weaponId: 'assault-rifle',
      gadgetId: null,
      at: 2_000,
    };

    beginMatchReportFrame(report, 1_000);
    recordMatchReportPhase(report, 'vision', 7);
    recordMatchReportFrame(report, 40, { match, players, monotonicNow: 1_000 });

    const killer = report.actors.find((actor) => actor.id === 'bot-killer');
    assert.deepEqual(killer.locationSamples, [[0, 100, 200, 1], [1_000, 125, 200, 1]]);
    assert.equal(killer.gadgetUses[0].gadgetId, 'smoke-grenade');
    assert.equal(killer.loadoutHistory.length, 1);
    assert.equal(killer.loadoutHistory[0].inventory.perks[0].id, 'reload-training');
    assert.deepEqual(report.combat.weaponKills['bot-killer'], { 'assault-rifle': 1 });
    assert.equal(report.actors.find((actor) => actor.id === 'bot-victim').deaths[0].weaponId,
      'assault-rifle');
    assert.equal(report.performance.frames, 2);
    assert.deepEqual(report.performance.slowFrames, [2, 1, 0]);
    assert.equal(report.performance.buckets.length, 1);
    assert.equal(report.performance.buckets[0].phases.simulation.maxMs, 5);
    assert.equal(report.performance.buckets[0].work['vision.livePlayers'].max, 3);
    assert.equal(report.performance.work['vision.livePlayers'].total, 3);
    assert.equal(report._activePerformanceBucket.phases.vision.maxMs, 7);

    recordMatchReportHostFrame(report, { monotonicNow: 0, bufferedBytes: 512 });
    recordMatchReportHostFrame(report, { monotonicNow: 125, bufferedBytes: 1_024 });
    assert.equal(report.network.hostFramesSent, 2);
    assert.equal(report.network.maxFrameIntervalMs, 125);
    assert.equal(report.network.frameIntervalsOver100Ms, 1);
    assert.equal(report.network.frameIntervalsOver50Ms, 1);
    assert.deepEqual(report.network.frameIntervalSpikes, [{
      atMs: 125,
      intervalMs: 125,
      bufferedBytes: 1_024,
    }]);
    assert.equal(report.network.maxBufferedBytes, 1_024);

    match.victory = { winner: 'red', reason: 'elimination', at: 3_000 };
    assert.equal(completeMatchReport(report, match, players, { now: 3_000, monotonicNow: 2_000 }), true);
    assert.equal(report.performance.buckets.length, 2);
    assert.equal(report.performance.buckets[1].phases.vision.maxMs, 7);
    assert.equal(report.result.round, 2);
    assert.equal(killer.won, true);
    assert.equal(report.storageEligible, true);
    assert.equal(validateMatchReport(report, match.startedAt).valid, true);
  });

  it('records client frame, host-frame, heartbeat, and reconnect diagnostics', () => {
    const match = createMatch();
    const diagnostics = createMatchClientDiagnostics(match, {
      playerId: 'player-1',
      hostId: 'host-id',
      now: 1_000,
      monotonicNow: 0,
    });

    recordMatchClientFrame(diagnostics, 20, { frameDeltaMs: 40, monotonicNow: 100 });
    recordMatchClientPhase(diagnostics, 'vision.playerRays', 5);
    recordMatchClientHostFrame(diagnostics, {
      direction: 'RX', monotonicNow: 0, revision: 1, applyMs: 2, applied: true,
    });
    recordMatchClientHostFrame(diagnostics, {
      direction: 'RX', monotonicNow: 125, revision: 3, applyMs: 4, applied: true,
    });
    recordMatchClientHeartbeat(diagnostics, { rttMs: 110, monotonicNow: 500 });
    recordMatchClientConnection(diagnostics, 'reconnecting');
    recordMatchClientConnection(diagnostics, 'connected');

    match.victory = { winner: 'red', reason: 'capture', at: 2_000 };
    assert.equal(completeMatchClientDiagnostics(diagnostics, match, { now: 2_000 }), true);
    assert.equal(diagnostics.performance.maxMs, 20);
    assert.deepEqual(diagnostics.performance.slowFrames, [1, 0, 0]);
    assert.equal(diagnostics.performance.frameDelta.maxMs, 40);
    assert.equal(diagnostics.hostFrames.revisionGaps, 1);
    assert.equal(diagnostics.hostFrames.intervalsOver100Ms, 1);
    assert.equal(diagnostics.hostFrames.maxApplyMs, 4);
    assert.equal(diagnostics.network.maxHeartbeatRttMs, 110);
    assert.equal(diagnostics.network.reconnects, 1);
    assert.equal(validateMatchClientDiagnostics(diagnostics, match.startedAt).valid, true);
  });

  it('keeps bounded, phase-correlated samples for the slowest host frames', () => {
    const match = createMatch();
    const report = createMatchReport(match, {
      hostId: 'host-id',
      players: match.players,
      now: 1_000,
      monotonicNow: 0,
    });

    for (let index = 0; index < 130; index += 1) {
      const frameMs = index === 42 ? 250 : 40 + (index % 10);
      beginMatchReportFrame(report, index * 16);
      recordMatchReportFrame(report, frameMs, {
        match,
        monotonicNow: index * 16,
        frameDeltaMs: 16,
        phaseDurations: { simulation: frameMs - 3, 'simulation.botAI': 3 },
        botProfile: {
          decisionCount: 2,
          totalDecisionMs: 2.5,
          slowestDecisions: [{ botId: 'bot-1', durationMs: 2 }],
        },
      });
    }

    assert.equal(report.performance.frameSamples.length, 128);
    assert.equal(report.performance.frameSamples[0].frameMs, 250);
    assert.deepEqual(report.performance.frameSamples[0].phases, {
      simulation: 247,
      'simulation.botAI': 3,
    });
    assert.equal(report.performance.frameSamples[0].botDecisionCount, 2);
    assert.deepEqual(report.performance.frameSamples[0].botDecisions, [
      { botId: 'bot-1', durationMs: 2 },
    ]);

    match.victory = { winner: 'red', reason: 'time', at: 4_000 };
    completeMatchReport(report, match, match.players, { now: 4_000, monotonicNow: 3_000 });
    assert.equal(validateMatchReport(report, match.startedAt).valid, true);
  });

  it('rejects invalid and oversized reports before storage', () => {
    const match = createMatch();
    match.victory = { winner: 'red', reason: 'time', at: 2_000 };
    const report = createMatchReport(match, {
      hostId: 'host-id',
      players: match.players,
      now: 1_000,
      monotonicNow: 0,
    });
    completeMatchReport(report, match, match.players, { now: 2_000, monotonicNow: 1_000 });
    assert.equal(validateMatchReport(report, 42).valid, false);

    report.unexpectedPadding = 'x'.repeat(MAX_MATCH_REPORT_BYTES);
    const validation = validateMatchReport(report, match.startedAt);
    assert.equal(validation.valid, false);
    assert.match(validation.reason, /maximum stored size/);
  });
});
