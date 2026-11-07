import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  accumulateQuickPlayRound,
  advanceQuickPlaySeriesResult,
  applyQuickPlayRoundResultToSquadScore,
  getCustomSeriesScoreboardPlayers,
  getQuickPlayScoreboardPlayers,
} from './QuickPlayScore.js';

function makeRound(startedAt, stats) {
  return {
    startedAt,
    players: [{
      id: 'player-1',
      name: 'Player',
      team: 'red',
      alive: true,
      stats,
    }],
  };
}

describe('Quick Play series scoreboard', () => {
  it('adds player performance across rounds exactly once', () => {
    const totals = new Map();
    const accumulated = new Map();
    const firstRound = makeRound(100, { kills: 2, assists: 1, deaths: 1 });
    const secondRound = makeRound(200, { kills: 3, assists: 0, deaths: 2 });

    assert.equal(accumulateQuickPlayRound(totals, accumulated, firstRound), true);
    assert.equal(accumulateQuickPlayRound(totals, accumulated, firstRound), false);
    assert.deepEqual(getQuickPlayScoreboardPlayers(secondRound, totals, accumulated)[0].stats,
      { kills: 5, assists: 1, deaths: 3 });

    accumulateQuickPlayRound(totals, accumulated, secondRound);
    assert.deepEqual(getQuickPlayScoreboardPlayers(secondRound, totals, accumulated)[0].stats,
      { kills: 5, assists: 1, deaths: 3 }, 'the completed current round is not double-counted');
  });

  describe('custom-series scoreboard', () => {
    it('accumulates player stats across matches without double-counting a completed match', () => {
      const series = {
        rolesBySquad: { A: 'blue', B: 'red' },
        seriesScoreboard: [{
          id: 'player-1',
          name: 'Player',
          squadId: 'A',
          team: 'red',
          stats: { kills: 2, assists: 1, deaths: 1 },
        }],
        lastResult: { at: 200 },
      };
      const match = {
        victory: { at: 200 },
        players: [{
          id: 'player-1',
          name: 'Player',
          squadId: 'A',
          team: 'red',
          stats: { kills: 3, assists: 2, deaths: 2 },
        }],
      };

      assert.deepEqual(getCustomSeriesScoreboardPlayers(match, series)[0].stats,
        { kills: 2, assists: 1, deaths: 1 });
      assert.equal(getCustomSeriesScoreboardPlayers(match, series)[0].team, 'blue');
      assert.equal(getCustomSeriesScoreboardPlayers(null, series)[0].team, 'blue');

      const nextMatch = {
        players: [{
          id: 'player-1',
          name: 'Player',
          squadId: 'A',
          team: 'blue',
          stats: { kills: 1, assists: 0, deaths: 2 },
        }],
      };
      assert.deepEqual(getCustomSeriesScoreboardPlayers(nextMatch, series)[0].stats,
        { kills: 3, assists: 1, deaths: 3 });
    });
  });

  it('reconciles new post-victory stats from later snapshots of the same match exactly once', () => {
    const totals = new Map();
    const accumulated = new Map();
    const victorySnapshot = makeRound(100, { kills: 2, assists: 1, deaths: 1 });
    assert.equal(accumulateQuickPlayRound(totals, accumulated, victorySnapshot), true);
    assert.deepEqual(getQuickPlayScoreboardPlayers(victorySnapshot, totals, accumulated)[0].stats,
      { kills: 2, assists: 1, deaths: 1 });

    const postPhaseSnapshot = makeRound(100, { kills: 3, assists: 2, deaths: 2 });
    assert.equal(accumulateQuickPlayRound(totals, accumulated, postPhaseSnapshot), true);
    assert.deepEqual(getQuickPlayScoreboardPlayers(postPhaseSnapshot, totals, accumulated)[0].stats,
      { kills: 3, assists: 2, deaths: 2 }, 'post-phase deltas are reflected in the series totals');
    assert.equal(accumulateQuickPlayRound(totals, accumulated, postPhaseSnapshot), false,
      'repeated copies of the same snapshot do not double count');
    assert.deepEqual(getQuickPlayScoreboardPlayers(postPhaseSnapshot, totals, accumulated)[0].stats,
      { kills: 3, assists: 2, deaths: 2 });
  });

  it('updates the squad score as soon as the victory snapshot arrives, without repeating it', () => {
    const score = { A: 1, B: 0 };
    const match = { quickPlayState: { lastResult: { winnerSquadId: 'B' } } };
    assert.deepEqual(applyQuickPlayRoundResultToSquadScore(score, match, true), { A: 1, B: 1 });
    assert.deepEqual(applyQuickPlayRoundResultToSquadScore({ A: 1, B: 1 }, match, false), { A: 1, B: 1 });
  });

  it('computes finite series result bookkeeping from stable squad identities', () => {
    const initial = {
      series: { winsToWin: 2, roleSwapEvery: 1, round: 1, phase: 'playing' },
      rolesBySquad: { A: 'red', B: 'blue' },
      squadScore: { A: 0, B: 0 },
      sidesSwapped: false,
      mapGenerationRevision: 7,
    };
    const first = advanceQuickPlaySeriesResult(initial, 'red', 'capture', 10_000);
    assert.deepEqual(first.squadScore, { A: 1, B: 0 });
    assert.deepEqual(first.rolesBySquad, { A: 'blue', B: 'red' });
    assert.deepEqual(first.state.score, { red: 1, blue: 0 });
    assert.deepEqual(first.state.nextRoundScore, { blue: 1, red: 0 });
    assert.equal(first.state.phase, 'round-result');
    assert.equal(first.state.phaseEndsAt, 15_000);
    assert.equal(first.sidesSwapped, true);
    assert.equal(first.mapGenerationRevision, 8);

    const second = advanceQuickPlaySeriesResult({
      ...initial,
      series: { ...first.state, round: 2, phase: 'playing' },
      rolesBySquad: first.rolesBySquad,
      squadScore: first.squadScore,
      sidesSwapped: first.sidesSwapped,
      mapGenerationRevision: first.mapGenerationRevision,
    }, 'red', 'elimination', 20_000);
    assert.deepEqual(second.squadScore, { A: 1, B: 1 });
    assert.deepEqual(second.rolesBySquad, { A: 'red', B: 'blue' });
    assert.deepEqual(second.state.score, { blue: 1, red: 1 });
    assert.equal(second.mapGenerationRevision, 9);

    const final = advanceQuickPlaySeriesResult({
      ...initial,
      series: { ...second.state, round: 3, phase: 'playing' },
      rolesBySquad: second.rolesBySquad,
      squadScore: second.squadScore,
      sidesSwapped: second.sidesSwapped,
      mapGenerationRevision: second.mapGenerationRevision,
    }, 'red', 'elimination', 30_000);
    assert.deepEqual(final.squadScore, { A: 2, B: 1 });
    assert.equal(final.state.winnerSquadId, 'A');
    assert.equal(final.state.winner, 'red');
    assert.equal(final.state.phase, 'series-report');
    assert.equal(final.state.phaseEndsAt, 38_000);
    assert.equal(final.mapGenerationRevision, 9, 'the final series report does not request another map');
  });

  it('keeps Practice in round-result indefinitely without a series win target', () => {
    const result = advanceQuickPlaySeriesResult({
      series: { gameMode: 'quickplay', winsToWin: null, roleSwapEvery: 1, round: 3, phase: 'playing' },
      rolesBySquad: { A: 'red', B: 'blue' },
      squadScore: { A: 2, B: 1 },
      sidesSwapped: false,
      mapGenerationRevision: 9,
    }, 'red', 'capture', 30_000);

    assert.deepEqual(result.squadScore, { A: 3, B: 1 });
    assert.equal(result.state.phase, 'round-result');
    assert.equal(result.state.winner, null);
    assert.equal(result.state.winnerSquadId, null);
    assert.equal(result.state.mapGenerationRevision, 10);
  });

  it('swaps Long Play sides every five rounds and ends at ten wins', () => {
    let series = {
      gameMode: 'longseries',
      winsToWin: 10,
      roleSwapEvery: 5,
      round: 1,
      phase: 'playing',
    };
    let rolesBySquad = { A: 'red', B: 'blue' };
    let squadScore = { A: 0, B: 0 };
    let sidesSwapped = false;
    let mapGenerationRevision = 1;
    let result;

    for (let round = 1; round <= 10; round += 1) {
      result = advanceQuickPlaySeriesResult({
        series: { ...series, round, phase: 'playing' },
        rolesBySquad,
        squadScore,
        sidesSwapped,
        mapGenerationRevision,
      }, rolesBySquad.A, 'capture', round * 10_000);
      assert.ok(result, `round ${round} should produce a valid Long Play result`);
      if (round === 4) {
        assert.deepEqual(result.rolesBySquad, { A: 'red', B: 'blue' });
      }
      if (round === 5) {
        assert.deepEqual(result.rolesBySquad, { A: 'blue', B: 'red' });
      }
      ({ state: series, rolesBySquad, squadScore, sidesSwapped, mapGenerationRevision } = result);
    }

    assert.equal(series.phase, 'series-report');
    assert.equal(series.winsToWin, 10);
    assert.equal(series.winnerSquadId, 'A');
    assert.deepEqual(squadScore, { A: 10, B: 0 });
  });

  it('shows only the current match roster while retaining historical totals for returning players', () => {
    const totals = new Map();
    const accumulated = new Map();
    accumulateQuickPlayRound(totals, accumulated, makeRound(100, { kills: 1, assists: 2, deaths: 0 }));
    const currentRound = {
      startedAt: 200,
      players: [
        { id: 'new-player', name: 'New player', team: 'blue', squadId: 'A', isBot: false, stats: { kills: 0, assists: 0, deaths: 0 } },
        { id: 'bot-1', name: 'Bot 1', team: 'red', squadId: 'B', isBot: true, stats: { kills: 2, assists: 1, deaths: 0 } },
      ],
    };
    assert.deepEqual(getQuickPlayScoreboardPlayers(currentRound, totals, accumulated).map((player) => player.id),
      ['new-player', 'bot-1'], 'departed players do not remain in current scoreboard slots');
    assert.equal(getQuickPlayScoreboardPlayers(currentRound, totals, accumulated)[0].team, 'blue');
    assert.equal(getQuickPlayScoreboardPlayers(currentRound, totals, accumulated)[1].isBot, true);

    const returningRound = makeRound(300, { kills: 2, assists: 0, deaths: 1 });
    const returning = getQuickPlayScoreboardPlayers(returningRound, totals, accumulated)[0];
    assert.deepEqual(returning.stats, { kills: 3, assists: 2, deaths: 1 },
      'historical totals are restored if a participant returns to the roster');
  });
});
