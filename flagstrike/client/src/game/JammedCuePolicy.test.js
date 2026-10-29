import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPersonalAudioCueForViewer,
  isPersonalDamageCueForViewer,
} from './JammedCuePolicy.js';

describe('jammed cue access', () => {
  it('allows only audio heard by the active player through a personal channel', () => {
    const cue = { heardById: 'player', audiencePlayerId: 'client' };
    assert.equal(isPersonalAudioCueForViewer(cue, 'player', 'client'), true);
    assert.equal(isPersonalAudioCueForViewer({ ...cue, heardById: 'teammate' }, 'player', 'client'), false);
    assert.equal(isPersonalAudioCueForViewer({ ...cue, audiencePlayerId: 'other-client' }, 'player', 'client'), false);
  });

  it('allows damage direction feedback only for the active player', () => {
    const cue = { victimId: 'player', audiencePlayerId: 'client' };
    assert.equal(isPersonalDamageCueForViewer(cue, 'player', 'client'), true);
    assert.equal(isPersonalDamageCueForViewer({ ...cue, victimId: 'teammate' }, 'player', 'client'), false);
    assert.equal(isPersonalDamageCueForViewer({ ...cue, audiencePlayerId: 'other-client' }, 'player', 'client'), false);
  });
});
