import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getFlagTransitionSound,
  getOutcomeSoundNames,
  getUrgentCustomPostGameCue,
  getUrgentTimerCue,
} from '../src/game/MatchAudio.js';

describe('match audio cues', () => {
  it('starts urgent pre-phase ticks at five seconds and stops at zero', () => {
    const match = { gameplayStartsAt: 10_000, endsAt: 610_000 };
    assert.equal(getUrgentTimerCue(match, 4_000), null);
    assert.deepEqual(getUrgentTimerCue(match, 5_000), { phase: 'prephase', seconds: 5 });
    assert.deepEqual(getUrgentTimerCue(match, 9_000), { phase: 'prephase', seconds: 1 });
    assert.equal(getUrgentTimerCue(match, 10_000), null);
  });

  it('starts urgent game-phase ticks at fifteen seconds and stops at zero', () => {
    const match = { gameplayStartsAt: 0, endsAt: 20_000 };
    assert.equal(getUrgentTimerCue(match, 4_000), null);
    assert.deepEqual(getUrgentTimerCue(match, 5_000), { phase: 'game', seconds: 15 });
    assert.deepEqual(getUrgentTimerCue(match, 19_000), { phase: 'game', seconds: 1 });
    assert.equal(getUrgentTimerCue(match, 20_000), null);
  });

  it('does not tick when the match has ended', () => {
    assert.equal(getUrgentTimerCue({
      gameplayStartsAt: 0,
      endsAt: 5_000,
      victory: { winner: 'red' },
    }, 4_000), null);
  });

    it('ticks through the last five seconds of a custom post-phase only', () => {
      const match = {
        victory: { winner: 'red' },
        postGame: { endsAt: 10_000 },
      };
      assert.equal(getUrgentCustomPostGameCue(match, { quickPlay: false }, 4_000), null);
      assert.deepEqual(getUrgentCustomPostGameCue(match, { quickPlay: false }, 5_000),
        { phase: 'postgame', seconds: 5 });
      assert.deepEqual(getUrgentCustomPostGameCue(match, { quickPlay: false }, 9_000),
        { phase: 'postgame', seconds: 1 });
      assert.equal(getUrgentCustomPostGameCue(match, { quickPlay: false }, 10_000), null);
      assert.equal(getUrgentCustomPostGameCue(match, { quickPlay: true }, 5_000), null);
    });

    it('distinguishes flag pickups, drops, and returns without a drop sound', () => {
    assert.equal(getFlagTransitionSound(undefined, { heldBy: 'red-1' }), null);
    assert.equal(getFlagTransitionSound(null, { heldBy: 'red-1' }), 'flag-pickup');
    assert.equal(getFlagTransitionSound('red-1', { heldBy: 'red-2' }), 'flag-pickup');
    assert.equal(getFlagTransitionSound('red-1', { heldBy: null, dropped: true }), 'flag-drop');
    assert.equal(getFlagTransitionSound('red-1', { heldBy: null, dropped: false }), null);
    assert.equal(getFlagTransitionSound(null, { heldBy: null, dropped: true }), null);
  });

  it('selects local match and series outcomes', () => {
    const victory = { winner: 'red' };
    assert.deepEqual(getOutcomeSoundNames(victory, { phase: 'round-result' }, 'red'), {
      match: 'match-win',
      game: null,
    });
    assert.deepEqual(getOutcomeSoundNames(victory, { phase: 'series-report' }, 'blue'), {
      match: 'match-loss',
      game: 'game-loss',
    });
    assert.equal(getOutcomeSoundNames(victory, null, null), null);
  });
});
