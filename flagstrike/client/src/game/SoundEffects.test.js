import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getWeaponSoundName, isGadgetEffectSoundAudibleToTeam, playKatanaDashSound } from './SoundEffects.js';

describe('Katana dash sound', () => {
  it('synthesizes a spatialized noise-and-tone slash', () => {
    const startedNodes = [];
    const param = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    };
    const node = (name) => ({
      connect() {},
      start() { startedNodes.push(name); },
      stop() {},
      frequency: { ...param },
      gain: { ...param },
      Q: { value: 0 },
    });
    class FakeAudioContext {
      state = 'running';
      currentTime = 1;
      sampleRate = 100;
      destination = {};

      createBuffer(_channels, length) {
        return { getChannelData: () => new Float32Array(length) };
      }

      createBufferSource() { return node('noise'); }
      createBiquadFilter() { return node('filter'); }
      createGain() { return node('gain'); }
      createOscillator() { return node('tone'); }
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
    try {
      assert.equal(playKatanaDashSound({ x: 10, y: 20 }, { x: 10, y: 20 }), true);
      assert.deepEqual(startedNodes, ['noise', 'tone']);
      assert.equal(playKatanaDashSound({ x: NaN, y: 20 }, { x: 10, y: 20 }), false);
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'AudioContext', originalDescriptor);
      else delete globalThis.AudioContext;
    }
  });
});

describe('team-scoped gadget sounds', () => {
  it('allows Sonar audio only for the Sonar owner team', () => {
    const redSonar = { type: 'sonar-projectile', team: 'red' };
    assert.equal(isGadgetEffectSoundAudibleToTeam(redSonar, 'red'), true);
    assert.equal(isGadgetEffectSoundAudibleToTeam(redSonar, 'blue'), false);
    assert.equal(isGadgetEffectSoundAudibleToTeam(redSonar, null), false);
  });

  it('keeps other gadget sound routing unchanged', () => {
    assert.equal(isGadgetEffectSoundAudibleToTeam({ type: 'smoke' }, 'blue'), true);
  });
});

describe('weapon sounds', () => {
  it('uses a distinct suppressed recording for the suppressed SMG', () => {
    assert.equal(getWeaponSoundName('suppressed-smg'), 'gunshot-suppressed');
  });
});
