import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  completeMatchClientDiagnostics,
  completeMatchReport,
  createMatchClientDiagnostics,
  createMatchReport,
} from '../../shared/MatchReport.js';
import { MatchReportStore } from '../MatchReportStore.mjs';

describe('MatchReportStore', () => {
  it('persists a completed match once and treats retries as idempotent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flagstrike-match-reports-'));
    try {
      const store = new MatchReportStore(directory);
      const match = {
        startedAt: 10_000,
        map: { seed: 4, width: 1_000, height: 700, rooms: [], objects: [] },
        players: [{
          id: 'bot-1', isBot: true, team: 'red', x: 100, y: 100,
          stats: { kills: 0, assists: 0, deaths: 0 },
        }],
        victory: { winner: 'red', reason: 'capture', at: 20_000 },
      };
      const report = createMatchReport(match, {
        hostId: 'host-1',
        players: match.players,
        now: 10_000,
        monotonicNow: 0,
      });
      completeMatchReport(report, match, match.players, { now: 20_000, monotonicNow: 10_000 });

      const first = await store.record({ roomKey: 'room-1', hostId: 'host-1', report });
      const second = await store.record({ roomKey: 'room-1', hostId: 'host-1', report });
      assert.equal(first.stored, true);
      assert.equal(second.stored, false);
      const files = await readdir(directory);
      assert.equal(files.length, 1);
      const saved = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
      assert.equal(saved.reportId, first.reportId);
      assert.equal(saved.report.matchId, match.startedAt);
      assert.equal(saved.report.result.victory.winner, 'red');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects reports whose host identity does not match the submitter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flagstrike-match-reports-'));
    try {
      const store = new MatchReportStore(directory);
      const match = {
        startedAt: 10_000,
        map: { seed: 4, width: 1_000, height: 700, rooms: [], objects: [] },
        players: [],
        victory: { winner: 'red', reason: 'capture', at: 20_000 },
      };
      const report = createMatchReport(match, { hostId: 'real-host', now: 10_000, monotonicNow: 0 });
      completeMatchReport(report, match, [], { now: 20_000, monotonicNow: 10_000 });
      await assert.rejects(
        store.record({ roomKey: 'room-1', hostId: 'other-host', report }),
        /identity is invalid/,
      );
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stores bounded client diagnostics together by match and player', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flagstrike-client-diagnostics-'));
    try {
      const store = new MatchReportStore(directory);
      const match = {
        startedAt: 10_000,
        map: { seed: 4, width: 1_000, height: 700, rooms: [], objects: [] },
        players: [],
        victory: { winner: 'red', reason: 'capture', at: 20_000 },
      };
      const diagnostics = ['client-1', 'client-2'].map((playerId) => {
        const clientReport = createMatchClientDiagnostics(match, {
          playerId,
          hostId: 'host-1',
          now: 10_000,
          monotonicNow: 0,
        });
        completeMatchClientDiagnostics(clientReport, match, { now: 20_000 });
        return clientReport;
      });

      const first = await store.recordClientDiagnostics({
        roomKey: 'room-1',
        matchId: match.startedAt,
        playerId: 'client-1',
        diagnostics: diagnostics[0],
      });
      const second = await store.recordClientDiagnostics({
        roomKey: 'room-1',
        matchId: match.startedAt,
        playerId: 'client-2',
        diagnostics: diagnostics[1],
      });
      const retry = await store.recordClientDiagnostics({
        roomKey: 'room-1',
        matchId: match.startedAt,
        playerId: 'client-2',
        diagnostics: diagnostics[1],
      });
      assert.equal(first.clientCount, 1);
      assert.equal(second.clientCount, 2);
      assert.equal(retry.stored, false);
      assert.equal(retry.clientCount, 2);

      const saved = JSON.parse(await readFile(
        join(directory, 'client-diagnostics', `${first.reportId}.json`),
        'utf8',
      ));
      assert.deepEqual(Object.keys(saved.clients).sort(), ['client-1', 'client-2']);
      assert.equal(saved.clients['client-2'].matchId, match.startedAt);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
