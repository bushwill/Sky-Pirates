import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getDistanceAttenuation,
  getGadgetEffectSoundName,
  getGameSoundStartDelayMs,
  getManualActionSoundName,
  getReloadSoundEvents,
  getWeaponSoundName,
  playJammerStaticSound,
  playGameSound,
  playSpatialGameSound,
} from '../src/game/SoundEffects.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../shared/ProjectileModel.js';

describe('game sound effects', () => {
  it('plays supported effects through pooled audio instances', () => {
    const instances = [];
    globalThis.Audio = class MockAudio {
      constructor(source) {
        this.source = source;
        this.paused = true;
        this.ended = false;
        this.playCount = 0;
        instances.push(this);
      }

      play() {
        this.paused = false;
        this.playCount += 1;
        return Promise.resolve();
      }
    };

    assert.equal(playGameSound('ui-click', 0.2), true);
    assert.equal(playGameSound('ui-click', 0.2), true);
    assert.equal(instances.length, 2, 'overlapping clicks use separate audio instances');
    assert.ok(instances.every((instance) => instance.source.endsWith('ui-click.ogg')));
    assert.ok(instances.every((instance) => instance.volume === 0.2));
  });

  it('rejects unknown effect names rather than silently ignoring them', () => {
    assert.throws(() => playGameSound('missing-effect'), /Unknown game sound/);
  });

  it('registers equipment, reload, action, timer, outcome, and flag sounds', () => {
    const instances = [];
    globalThis.Audio = class MockAudio {
      constructor(source) {
        this.source = source;
        this.paused = true;
        this.ended = false;
        instances.push(this);
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }
    };

    const soundNames = [
      'equip-confirm',
      'reload-magazine',
      'reload-shotgun-shell',
      'reload-round',
      'action-shotgun-pump',
      'action-revolver-hammer',
      'action-bolt',
      'action-lever',
      'urgent-tick',
      'match-win',
      'match-loss',
      'game-win',
      'game-loss',
      'flag-pickup',
      'flag-drop',
    ];
    for (const soundName of soundNames) assert.equal(playGameSound(soundName), true);

    assert.equal(instances.length, soundNames.length);
    for (const soundName of soundNames.filter((name) => name !== 'equip-confirm')) {
      assert.ok(instances.some((instance) => instance.source.includes(soundName)));
    }
    assert.ok(instances.some((instance) => instance.source.endsWith('equip-tactical.wav')));
  });

  it('plays Orbital Strike fire without the Molotov glass-break sound', () => {
    assert.equal(getGadgetEffectSoundName({ type: 'molotov', gadgetId: 'orbital-strike' }),
      'orbital-strike-fire');
    assert.equal(getGadgetEffectSoundName({ type: 'molotov', gadgetId: 'molotov' }), 'molotov');
    assert.equal(getGadgetEffectSoundName({ type: 'orbital-strike-explosion' }), 'orbital-strike');
  });

  it('maps Jammer detonation to a generated static burst', () => {
    assert.equal(getGadgetEffectSoundName({ type: 'jammer' }), 'jammer-static');

    const startedNodes = [];
    let noiseSamples;
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
        noiseSamples = new Float32Array(length);
        return { getChannelData: () => noiseSamples };
      }

      createBufferSource() { return node('noise'); }
      createBiquadFilter() { return node('filter'); }
      createGain() { return node('gain'); }
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
    try {
      assert.equal(playJammerStaticSound({ x: 10, y: 20 }, { x: 10, y: 20 }), true);
      assert.deepEqual(startedNodes, ['noise']);
      assert.ok(noiseSamples.some((sample) => sample !== 0), 'the burst contains generated noise');
      assert.equal(playJammerStaticSound({ x: NaN, y: 20 }, { x: 10, y: 20 }), false);
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, 'AudioContext', originalDescriptor);
      else delete globalThis.AudioContext;
    }
  });

  it('registers the short replacement gadget sounds', () => {
    const instances = [];
    globalThis.Audio = class MockAudio {
      constructor(source) {
        this.source = source;
        this.paused = true;
        this.ended = false;
        instances.push(this);
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }
    };

    const sources = new Map([
      ['molotov', 'molotov-ignite.wav'],
      ['smoke-grenade', 'smoke-deploy.wav'],
      ['cryo-grenade', 'cryo-freeze.wav'],
      ['flash-grenade', 'flashbang.wav'],
      ['orbital-strike', 'mine-explosion.mp3'],
      ['orbital-strike-fire', 'orbital-strike-fire.wav'],
    ]);
    for (const [soundName, source] of sources) {
      assert.equal(playGameSound(soundName), true);
      assert.ok(instances.some((instance) => instance.source.endsWith(source)));
    }
  });

  it('attenuates spatial sounds continuously with distance', () => {
    const instances = [];
    globalThis.Audio = class MockAudio {
      constructor(source) {
        this.source = source;
        this.paused = true;
        this.ended = false;
        instances.push(this);
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }
    };

    assert.equal(getDistanceAttenuation(0), 1);
    assert.equal(getDistanceAttenuation(500), 0.5);
    assert.ok(getDistanceAttenuation(1500) > 0, 'distant gunfire remains audible across the map');
    assert.equal(playSpatialGameSound('gunshot-rifle', 0.4, { x: 500, y: 0 }, { x: 0, y: 0 }), true);
    assert.equal(instances[0].volume, 0.2);
    assert.equal(playSpatialGameSound('gunshot-rifle', 0.4, { x: NaN, y: 0 }, { x: 0, y: 0 }), false);
  });

  it('maps requested weapon groups to the correct shot recordings', () => {
    const weaponIds = Object.values(DEFAULT_PROJECTILE_DEFINITIONS).map(({ id }) => id);
    const soundNames = weaponIds.map(getWeaponSoundName);
    for (const soundName of new Set(soundNames)) assert.equal(playGameSound(soundName), true);

    assert.equal(getWeaponSoundName('shotgun'), 'gunshot-pocket-shotgun');
    assert.equal(getWeaponSoundName('pocket-shotgun'), 'gunshot-pocket-shotgun');
    assert.equal(getWeaponSoundName('classic-pistol'), 'gunshot-pistol');
    assert.equal(getWeaponSoundName('battle-pistol'), 'gunshot-pistol');
    assert.equal(getWeaponSoundName('revolver'), 'gunshot-revolver');
    assert.equal(getWeaponSoundName('machine-pistol'), 'gunshot-pistol');
    assert.equal(getWeaponSoundName('battle-rifle'), 'gunshot-battle-rifle');
    assert.equal(getWeaponSoundName('smg'), 'gunshot-pistol');
    assert.equal(getWeaponSoundName('suppressed-smg'), 'gunshot-suppressed');
    assert.equal(getWeaponSoundName('machine-gun'), 'gunshot-smg');
    assert.equal(getWeaponSoundName('assault-rifle'), 'gunshot-battle-rifle');
    assert.equal(getWeaponSoundName('sniper'), 'gunshot-sniper');
    assert.equal(getWeaponSoundName('marksman-rifle'), 'gunshot-marksman-rifle');
    assert.equal(getWeaponSoundName('heavy-sniper'), 'gunshot-sniper');
    assert.equal(getWeaponSoundName('unknown-weapon'), 'gunshot-rifle');
  });

  it('maps manual-action weapons to their mechanical sounds', () => {
    assert.equal(getManualActionSoundName('shotgun'), 'action-shotgun-pump');
    assert.equal(getManualActionSoundName('revolver'), 'action-revolver-hammer');
    assert.equal(getManualActionSoundName('sniper'), 'action-bolt');
    assert.equal(getManualActionSoundName('heavy-sniper'), 'action-bolt');
    assert.equal(getManualActionSoundName('marksman-rifle'), 'action-lever');
    assert.equal(getManualActionSoundName('assault-rifle'), null);
  });

  it('distinguishes magazine reloads from per-round insertions', () => {
    const magazine = { id: 'assault-rifle', reloadDurationMs: 3000 };
    const beforeMagazineReload = { ammo: 10, reloading: false };
    const duringMagazineReload = { ammo: 10, reloading: true, reloadStartedAt: 1000 };
    assert.deepEqual(getReloadSoundEvents(magazine, beforeMagazineReload, duringMagazineReload), [{
      soundName: 'reload-magazine',
      eventKey: 'magazine:1000',
      actionStartedAt: 1000,
      actionDurationMs: 3000,
    }]);
    assert.deepEqual(getReloadSoundEvents(magazine, duringMagazineReload, duringMagazineReload), []);

    const beforeShell = { ammo: 2, reloading: true, reloadStartedAt: 1000, reloadEndsAt: 2000 };
    const afterShell = {
      ammo: 3,
      reloading: true,
      reloadStartedAt: 2000,
      reloadEndsAt: 2900,
      reloadRoundsInserted: 1,
    };
    assert.deepEqual(getReloadSoundEvents({
      id: 'shotgun',
      reloadPerRound: true,
      reloadIntervalMs: [1000, 900, 800],
    }, { ammo: 2, reloading: false }, {
      ammo: 2,
      reloading: true,
      reloadStartedAt: 1000,
      reloadEndsAt: 2000,
      reloadRoundsInserted: 0,
    }), [{
      soundName: 'reload-shotgun-shell',
      eventKey: 'round:1000:3',
      actionStartedAt: 1000,
      actionDurationMs: 1000,
    }]);
    assert.deepEqual(getReloadSoundEvents({
      id: 'shotgun',
      reloadPerRound: true,
      reloadIntervalMs: [1000, 900, 800],
    }, beforeShell, afterShell), [{
      soundName: 'reload-shotgun-shell',
      eventKey: 'round:2000:4',
      actionStartedAt: 2000,
      actionDurationMs: 900,
    }]);
    assert.deepEqual(getReloadSoundEvents({
      id: 'marksman-rifle',
      reloadPerRound: true,
    }, beforeShell, afterShell), [{
      soundName: 'reload-round',
      eventKey: 'round:2000:4',
      actionStartedAt: 2000,
      actionDurationMs: 900,
    }]);
    assert.deepEqual(getReloadSoundEvents({
      id: 'shotgun',
      reloadPerRound: true,
      reloadIntervalMs: [1000, 900, 800],
    }, beforeShell, { ammo: 2, reloading: false }), []);
  });

  it('starts timed mechanical sounds in the final portion of their action', () => {
    assert.equal(getGameSoundStartDelayMs('action-revolver-hammer', 500), 50);
    assert.equal(getGameSoundStartDelayMs('reload-magazine', 3000), 1000);
    assert.equal(getGameSoundStartDelayMs('reload-magazine', 1000), 0);
    assert.throws(() => getGameSoundStartDelayMs('gunshot-rifle', 500), /No duration is registered/);
  });
});
