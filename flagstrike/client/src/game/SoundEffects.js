import { ORBITAL_STRIKE_ID } from '../../../shared/GadgetModel.js';

const SOUND_SOURCES = Object.freeze({
  'ui-click': [new URL('../assets/audio/ui-click.ogg', import.meta.url).href],
  'equip-confirm': [new URL('../assets/audio/equip-tactical.wav', import.meta.url).href],
  'reload-magazine': [new URL('../assets/audio/reload-magazine.ogg', import.meta.url).href],
  'reload-shotgun-shell': [new URL('../assets/audio/reload-shotgun-shell.wav', import.meta.url).href],
  'reload-round': [new URL('../assets/audio/reload-round.ogg', import.meta.url).href],
  'action-shotgun-pump': [new URL('../assets/audio/action-shotgun-pump.ogg', import.meta.url).href],
  'gunshot-pocket-shotgun': [new URL('../assets/audio/gunshot-pocket-shotgun.wav', import.meta.url).href],
  'action-revolver-hammer': [new URL('../assets/audio/action-revolver-hammer.wav', import.meta.url).href],
  'action-bolt': [new URL('../assets/audio/action-bolt.wav', import.meta.url).href],
  'action-lever': [new URL('../assets/audio/action-lever.wav', import.meta.url).href],
  'gunshot-revolver': [new URL('../assets/audio/gunshot-revolver.wav', import.meta.url).href],
  'gunshot-smg': [new URL('../assets/audio/gunshot-smg.wav', import.meta.url).href],
  'gunshot-suppressed': [new URL('../assets/audio/gunshot-suppressed.ogg', import.meta.url).href],
  'gunshot-marksman-rifle': [new URL('../assets/audio/gunshot-marksman-rifle.wav', import.meta.url).href],
  'gunshot-pistol': [new URL('../assets/audio/gunshot-pistol.wav', import.meta.url).href],
  'gunshot-shotgun': [new URL('../assets/audio/gunshot-shotgun.wav', import.meta.url).href],
  'gunshot-rifle': [new URL('../assets/audio/gunshot-rifle.wav', import.meta.url).href],
  'gunshot-battle-rifle': [new URL('../assets/audio/gunshot-battle-rifle.wav', import.meta.url).href],
  'gunshot-sniper': [new URL('../assets/audio/gunshot-sniper.wav', import.meta.url).href],
  'gunshot-heavy-sniper': [new URL('../assets/audio/gunshot-heavy-sniper.wav', import.meta.url).href],
  molotov: [new URL('../assets/audio/molotov-ignite.wav', import.meta.url).href],
  'smoke-grenade': [new URL('../assets/audio/smoke-deploy.wav', import.meta.url).href],
  'cryo-grenade': [new URL('../assets/audio/cryo-freeze.wav', import.meta.url).href],
  'flash-grenade': [new URL('../assets/audio/flashbang.wav', import.meta.url).href],
  'mine-explosion': [new URL('../assets/audio/mine-explosion.mp3', import.meta.url).href],
  'orbital-strike': [new URL('../assets/audio/mine-explosion.mp3', import.meta.url).href],
  'orbital-strike-fire': [new URL('../assets/audio/orbital-strike-fire.wav', import.meta.url).href],
  'urgent-tick': [
    new URL('../assets/audio/urgent-tick-1.wav', import.meta.url).href,
    new URL('../assets/audio/urgent-tick-2.wav', import.meta.url).href,
    new URL('../assets/audio/urgent-tick-3.wav', import.meta.url).href,
    new URL('../assets/audio/urgent-tick-4.wav', import.meta.url).href,
  ],
  'match-win': [new URL('../assets/audio/match-win.ogg', import.meta.url).href],
  'match-loss': [new URL('../assets/audio/match-loss.ogg', import.meta.url).href],
  'game-win': [new URL('../assets/audio/game-win.ogg', import.meta.url).href],
  'game-loss': [new URL('../assets/audio/game-loss.ogg', import.meta.url).href],
  'flag-pickup': [new URL('../assets/audio/flag-pickup.ogg', import.meta.url).href],
  'flag-drop': [new URL('../assets/audio/flag-drop.ogg', import.meta.url).href],
});
const GADGET_EFFECT_SOUND_NAMES = Object.freeze({
  molotov: 'molotov',
  smoke: 'smoke-grenade',
  cryo: 'cryo-grenade',
  flash: 'flash-grenade',
  jammer: 'jammer-static',
  'mine-explosion': 'mine-explosion',
  'orbital-strike-explosion': 'orbital-strike',
});
const TIMED_SOUND_DURATIONS_MS = Object.freeze({
  'reload-magazine': 2000,
  'reload-shotgun-shell': 450,
  'reload-round': 1000,
  'action-shotgun-pump': 1000,
  'action-revolver-hammer': 450,
  'action-bolt': 450,
  'action-lever': 550,
});
const WEAPON_SOUND_NAMES = Object.freeze({
  'classic-pistol': 'gunshot-pistol',
  'battle-pistol': 'gunshot-pistol',
  revolver: 'gunshot-revolver',
  'machine-pistol': 'gunshot-pistol',
  'pocket-shotgun': 'gunshot-pocket-shotgun',
  'assault-rifle': 'gunshot-battle-rifle',
  'battle-rifle': 'gunshot-battle-rifle',
  smg: 'gunshot-pistol',
  'suppressed-smg': 'gunshot-suppressed',
  'machine-gun': 'gunshot-smg',
  sniper: 'gunshot-sniper',
  'marksman-rifle': 'gunshot-marksman-rifle',
  'heavy-sniper': 'gunshot-sniper',
  shotgun: 'gunshot-pocket-shotgun',
});
const MANUAL_ACTION_SOUND_NAMES = Object.freeze({
  shotgun: 'action-shotgun-pump',
  revolver: 'action-revolver-hammer',
  sniper: 'action-bolt',
  'heavy-sniper': 'action-bolt',
  'marksman-rifle': 'action-lever',
});
const MAX_CONCURRENT_INSTANCES_PER_SOUND = 16;
const soundPools = new Map();
let sonarAudioContext = null;
let jammerAudioContext = null;
let katanaAudioContext = null;

export function playSonarCastSound(source, listener) {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextConstructor || ![source?.x, source?.y, listener?.x, listener?.y].every(Number.isFinite)) {
    return false;
  }
  sonarAudioContext ??= new AudioContextConstructor();
  const context = sonarAudioContext;
  if (context.state === 'suspended') {
    void context.resume().catch((error) => {
      if (error?.name !== 'NotAllowedError') {
        console.error('Unable to resume sonar audio playback.', error);
      }
    });
  }
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const volume = 0.2 * getDistanceAttenuation(distance);
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(420, now);
  oscillator.frequency.exponentialRampToValueAtTime(1_200, now + 0.16);
  oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.36);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.41);
  return true;
}

export function playJammerStaticSound(source, listener, baseVolume = 0.3) {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextConstructor || ![source?.x, source?.y, listener?.x, listener?.y].every(Number.isFinite)) {
    return false;
  }
  jammerAudioContext ??= new AudioContextConstructor();
  const context = jammerAudioContext;
  if (context.state === 'suspended') {
    void context.resume().catch((error) => {
      if (error?.name !== 'NotAllowedError') {
        console.error('Unable to resume Jammer audio playback.', error);
      }
    });
  }

  const now = context.currentTime;
  const duration = 0.55;
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const noiseBuffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const noiseSamples = noiseBuffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    const fadeIn = Math.min(1, progress * 90);
    const fadeOut = Math.min(1, (1 - progress) * 12);
    noiseSamples[index] = (Math.random() * 2 - 1) * fadeIn * fadeOut;
  }

  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const volume = baseVolume * getDistanceAttenuation(distance);
  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(4_800, now);
  filter.frequency.exponentialRampToValueAtTime(1_100, now + duration);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  noise.start(now);
  noise.stop(now + duration);
  return true;
}

export function playKatanaDashSound(source, listener) {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextConstructor || ![source?.x, source?.y, listener?.x, listener?.y].every(Number.isFinite)) {
    return false;
  }
  katanaAudioContext ??= new AudioContextConstructor();
  const context = katanaAudioContext;
  if (context.state === 'suspended') {
    void context.resume().catch((error) => {
      if (error?.name !== 'NotAllowedError') {
        console.error('Unable to resume Katana audio playback.', error);
      }
    });
  }

  const now = context.currentTime;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const volume = 0.32 * getDistanceAttenuation(distance);
  const sampleCount = Math.max(1, Math.floor(context.sampleRate * 0.28));
  const noiseBuffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const noiseSamples = noiseBuffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = 1 - index / sampleCount;
    noiseSamples[index] = (Math.random() * 2 - 1) * fade * fade;
  }

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(2_800, now);
  filter.frequency.exponentialRampToValueAtTime(420, now + 0.26);
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.018);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(context.destination);
  noise.start(now);
  noise.stop(now + 0.29);

  const tone = context.createOscillator();
  const toneGain = context.createGain();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(760, now);
  tone.frequency.exponentialRampToValueAtTime(160, now + 0.2);
  toneGain.gain.setValueAtTime(0.0001, now);
  toneGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.18), now + 0.012);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  tone.connect(toneGain);
  toneGain.connect(context.destination);
  tone.start(now);
  tone.stop(now + 0.23);
  return true;
}

export function getWeaponSoundName(weaponId) {
  return WEAPON_SOUND_NAMES[weaponId] ?? 'gunshot-rifle';
}

export function getManualActionSoundName(weaponId) {
  return MANUAL_ACTION_SOUND_NAMES[weaponId] ?? null;
}

export function getGadgetEffectSoundName(effect) {
  if (effect?.type === 'molotov' && effect.gadgetId === ORBITAL_STRIKE_ID) return 'orbital-strike-fire';
  return GADGET_EFFECT_SOUND_NAMES[effect?.type] ?? null;
}

export function isGadgetEffectSoundAudibleToTeam(effect, team) {
  return effect?.type !== 'sonar-projectile' ||
    (['red', 'blue'].includes(team) && effect.team === team);
}

export function getGameSoundStartDelayMs(soundName, actionDurationMs) {
  const soundDurationMs = TIMED_SOUND_DURATIONS_MS[soundName];
  if (!Number.isFinite(soundDurationMs)) {
    throw new RangeError(`No duration is registered for timed game sound: ${soundName}`);
  }
  if (!Number.isFinite(actionDurationMs) || actionDurationMs < 0) {
    throw new RangeError(`Invalid action duration for timed game sound: ${actionDurationMs}`);
  }
  return Math.max(0, actionDurationMs - soundDurationMs);
}

export function getReloadSoundEvents(weapon, previousState, nextState) {
  if (!weapon || !previousState || !nextState) return [];
  const soundName = weapon.reloadPerRound
    ? weapon.id === 'shotgun' ? 'reload-shotgun-shell' : 'reload-round'
    : weapon.reloadDurationMs ? 'reload-magazine' : null;
  if (!soundName) return [];

  if (weapon.reloadPerRound) {
    const reloadStarted = !previousState.reloading && nextState.reloading;
    const nextRoundStarted = previousState.reloading && nextState.reloading &&
      Number.isFinite(nextState.reloadStartedAt) &&
      nextState.reloadStartedAt !== previousState.reloadStartedAt;
    if (!reloadStarted && !nextRoundStarted) return [];

    const actionDurationMs = Number.isFinite(nextState.reloadStartedAt) &&
      Number.isFinite(nextState.reloadEndsAt)
      ? Math.max(0, nextState.reloadEndsAt - nextState.reloadStartedAt)
      : weapon.reloadIntervalMs[0];
    const actionStartedAt = Number.isFinite(nextState.reloadStartedAt)
      ? nextState.reloadStartedAt
      : Date.now();
    return [{
      soundName,
      eventKey: `round:${actionStartedAt}:${(nextState.ammo ?? 0) + 1}`,
      actionStartedAt,
      actionDurationMs,
    }];
  }

  if (!previousState.reloading && nextState.reloading) {
    const actionDurationMs = Number.isFinite(nextState.reloadStartedAt) &&
      Number.isFinite(nextState.reloadEndsAt)
      ? Math.max(0, nextState.reloadEndsAt - nextState.reloadStartedAt)
      : weapon.reloadDurationMs;
    const actionStartedAt = Number.isFinite(nextState.reloadStartedAt)
      ? nextState.reloadStartedAt
      : Number.isFinite(nextState.reloadEndsAt)
        ? nextState.reloadEndsAt - actionDurationMs
        : Date.now();
    return [{
      soundName,
      eventKey: `magazine:${nextState.reloadStartedAt ?? 'unknown'}`,
      actionStartedAt,
      actionDurationMs,
    }];
  }
  return [];
}

export function getDistanceAttenuation(distance) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return 1 / (1 + distance / 500);
}

export function playSpatialGameSound(soundName, baseVolume, source, listener) {
  if (![source?.x, source?.y, listener?.x, listener?.y].every(Number.isFinite)) return false;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  return playGameSound(soundName, baseVolume * getDistanceAttenuation(distance));
}

export function playGameSound(soundName, volume = 1) {
  const sources = SOUND_SOURCES[soundName];
  if (!sources) throw new RangeError(`Unknown game sound: ${soundName}`);
  if (typeof Audio === 'undefined') return false;

  let pool = soundPools.get(soundName);
  if (!pool) {
    pool = [];
    soundPools.set(soundName, pool);
  }
  let audio = pool.find((instance) => instance.paused || instance.ended);
  if (!audio && pool.length < MAX_CONCURRENT_INSTANCES_PER_SOUND) {
    const source = sources[Math.floor(Math.random() * sources.length)];
    audio = new Audio(source);
    audio.preload = 'auto';
    pool.push(audio);
  }
  if (!audio) return false;

  audio.currentTime = 0;
  audio.volume = Math.max(0, Math.min(1, volume));
  try {
    const playback = audio.play();
    playback?.catch((error) => {
      if (error?.name !== 'NotAllowedError') {
        console.error(`Unable to play game sound "${soundName}".`, error);
      }
    });
  } catch (error) {
    console.error(`Unable to play game sound "${soundName}".`, error);
    return false;
  }
  return true;
}
