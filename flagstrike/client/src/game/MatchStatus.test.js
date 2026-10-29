import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAliveTeamCounts, formatQuickPlayScore, formatQuickPlaySeriesScore, formatVictoryText, getAliveTeamCounts } from './MatchStatus.js';

describe('match status formatting', () => {
  it('counts only living players with positive health for each team', () => {
    const counts = getAliveTeamCounts([
      { team: 'red', alive: true, health: 100 },
      { team: 'red', alive: false, health: 0 },
      { team: 'blue', alive: true, health: 1 },
      { team: 'blue', alive: true, health: 0 },
      { team: 'spectator', alive: true, health: 100 },
    ]);
    assert.deepEqual(counts, { red: 1, blue: 1 });
    assert.equal(formatAliveTeamCounts(counts), 'STRIKE 1  —  1 FLAG');
  });

  it('does not format a winner before a match has ended', () => {
    assert.equal(formatVictoryText(null, null), '');
    assert.equal(formatVictoryText(null, { phase: 'countdown', score: { red: 0, blue: 0 } }), '');
  });

  it('formats the Quick Play team series score with safe defaults', () => {
    assert.deepEqual(formatQuickPlayScore({ red: 2, blue: 1 }), { red: 'STRIKE 2', blue: '1 FLAG' });
    assert.deepEqual(formatQuickPlayScore(null), { red: 'STRIKE 0', blue: '0 FLAG' });
    assert.equal(formatQuickPlaySeriesScore({ red: 2, blue: 1 }), 'STRIKE 2–1 FLAG');
  });

  it('formats a custom-match winner and reason', () => {
    assert.equal(formatVictoryText({ winner: 'red', reason: 'capture' }, null), 'STRIKE TEAM WINS\nFLAG CAPTURED');
  });

  it('uses the completed round role and score for Quick Play result winners', () => {
    assert.equal(formatVictoryText({ winner: 'red', reason: 'capture' }, {
      gameMode: 'longplay',
      phase: 'round-result',
      round: 1,
      lastResult: { winner: 'red', score: { red: 1, blue: 0 } },
      score: { red: 0, blue: 1 },
    }), 'ROUND 1 · STRIKE TEAM WINS\nFLAG CAPTURED\nSERIES STRIKE 1–0 FLAG');
    assert.equal(formatVictoryText({ winner: 'blue', reason: 'elimination' }, {
      gameMode: 'longplay',
      phase: 'round-result',
      round: 2,
      lastResult: { winner: 'blue', score: { red: 0, blue: 2 } },
      score: { red: 2, blue: 0 },
    }), 'ROUND 2 · FLAG TEAM WINS\nTEAM ELIMINATED\nSERIES STRIKE 0–2 FLAG');
  });

  it('labels the endless Practice round score without implying a series limit', () => {
    assert.equal(formatVictoryText({ winner: 'red', reason: 'capture' }, {
      gameMode: 'quickplay',
      phase: 'round-result',
      round: 3,
      lastResult: { winner: 'red', score: { red: 2, blue: 1 } },
    }), 'ROUND 3 · STRIKE TEAM WINS\nFLAG CAPTURED\nPRACTICE SCORE STRIKE 2–1 FLAG');
  });

  it('formats Quick Play round and series results when winner fields are absent', () => {
    assert.equal(formatVictoryText({ winner: null, reason: 'elimination' }, {
      gameMode: 'longplay',
      phase: 'round-result',
      round: 2,
      score: { red: 1, blue: 1 },
    }), 'ROUND 2 · UNKNOWN WINS\nTEAM ELIMINATED\nSERIES STRIKE 1–1 FLAG');
    assert.equal(formatVictoryText({ winner: 'blue' }, {
      phase: 'series-report',
      winner: null,
      lastResult: { winner: 'blue', score: { red: 1, blue: 2 } },
      score: { red: 1, blue: 2 },
    }), 'PRACTICE WINNER\nFLAG TEAM · STRIKE 1–2 FLAG');
  });

  it('labels Long Play round and series results correctly', () => {
    assert.equal(formatVictoryText({ winner: 'blue', reason: 'capture' }, {
      gameMode: 'longplay',
      phase: 'round-result',
      round: 6,
      lastResult: { winner: 'blue', score: { red: 3, blue: 3 } },
    }), 'ROUND 6 · FLAG TEAM WINS\nFLAG CAPTURED\nSERIES STRIKE 3–3 FLAG');
    assert.equal(formatVictoryText({ winner: 'blue' }, {
      gameMode: 'longplay',
      phase: 'series-report',
      winner: 'blue',
      lastResult: { winner: 'blue', score: { red: 3, blue: 4 } },
    }), 'QUICK PLAY WINNER\nFLAG TEAM · STRIKE 3–4 FLAG');
    assert.equal(formatVictoryText({ winner: 'red' }, {
      gameMode: 'longseries',
      phase: 'series-report',
      winner: 'red',
      lastResult: { winner: 'red', score: { red: 10, blue: 8 } },
    }), 'LONG PLAY WINNER\nSTRIKE TEAM · STRIKE 10–8 FLAG');
  });
});
