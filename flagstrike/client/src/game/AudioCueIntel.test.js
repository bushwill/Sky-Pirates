import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectFootstepAudioCues } from '../../../shared/AudioCueModel.js';
import { PLAYER_RADIUS } from './MovementModel.js';
import { isAudioCueSupersededByVisibleEnemy } from './AudioCueIntel.js';

describe('audio cue display intel', () => {
  it('hides an uncertainty marker when a teammate visually identifies an enemy inside it', () => {
    const cue = { x: 100, y: 100, radius: 20 };
    const enemy = { x: 100 + 20 + PLAYER_RADIUS - 1, y: 100, team: 'blue', health: 100, alive: true };
    assert.equal(isAudioCueSupersededByVisibleEnemy(cue, 'red', [enemy], () => true), true);
  });

  it('keeps the marker when the enemy is unseen, allied, dead, or outside the uncertainty area', () => {
    const cue = { x: 100, y: 100, radius: 20 };
    const unseenEnemy = { x: 100, y: 100, team: 'blue', health: 100, alive: true };
    const allied = { x: 100, y: 100, team: 'red', health: 100, alive: true };
    const deadEnemy = { x: 100, y: 100, team: 'blue', health: 0, alive: false };
    const distantEnemy = { x: 150, y: 100, team: 'blue', health: 100, alive: true };
    assert.equal(isAudioCueSupersededByVisibleEnemy(cue, 'red', [unseenEnemy], () => false), false);
    assert.equal(isAudioCueSupersededByVisibleEnemy(cue, 'red', [allied, deadEnemy, distantEnemy], () => true), false);
  });

  it('creates updated footstep intel for the whole nearest-hearer team', () => {
    const source = {
      id: 'enemy-runner', team: 'blue', x: 300, y: 300, vx: 60, vy: 0,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const closestListener = {
      id: 'red-listener', team: 'red', x: 400, y: 300, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const otherListener = {
      ...closestListener, id: 'red-teammate', x: 500, y: 300,
    };
    const match = {
      startedAt: 1,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, closestListener, otherListener],
      smokes: [],
    };
    const lastCueAt = new Map();
    const first = collectFootstepAudioCues(match, 1_000, { lastCueAt, random: () => 0 });

    assert.equal(first.length, 1);
    assert.equal(first[0].team, 'red');
    assert.equal(first[0].heardById, closestListener.id);
    assert.equal(first[0].kind, 'footstep');
    assert.equal('botId' in first[0], false);
    assert.ok(Math.hypot(first[0].x - source.x, first[0].y - source.y) <= first[0].radius);
    assert.deepEqual(collectFootstepAudioCues(match, 1_100, { lastCueAt, random: () => 0 }), [],
      'the same source/team cue is rate-limited');
    const updated = collectFootstepAudioCues(match, 1_500, { lastCueAt, random: () => 0 });
    assert.equal(updated.length, 1);
    assert.notEqual(updated[0].id, first[0].id);
    assert.equal(updated[0].expiresAt, 2_150);
  });

  it('shares team audio with an unjammed listener and keeps jammed listeners personal', () => {
    const source = {
      id: 'enemy-runner', team: 'blue', x: 300, y: 300, vx: 60, vy: 0,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const jammedListener = {
      id: 'jammed-listener', team: 'red', x: 350, y: 300, jammedUntil: 2_000,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const availableListener = {
      ...jammedListener, id: 'available-listener', x: 390, y: 300, jammedUntil: 0,
    };
    const cues = collectFootstepAudioCues({
      startedAt: 2,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, jammedListener, availableListener],
      smokes: [],
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });
    assert.equal(cues.length, 2);
    assert.equal(cues[0].heardById, availableListener.id);
    assert.equal(cues[0].audiencePlayerId, undefined);
    assert.equal(cues[1].heardById, jammedListener.id);
    assert.equal(cues[1].audiencePlayerId, jammedListener.id);
  });

  it('keeps audio intel local when every potential listener is jammed', () => {
    const source = {
      id: 'enemy-runner', team: 'blue', x: 300, y: 300, vx: 60, vy: 0,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const listener = {
      id: 'jammed-listener', team: 'red', x: 350, y: 300, jammedUntil: 2_000,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const cues = collectFootstepAudioCues({
      startedAt: 2,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, listener],
      smokes: [],
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });
    assert.equal(cues.length, 1);
    assert.equal(cues[0].heardById, listener.id);
    assert.equal(cues[0].audiencePlayerId, listener.id);
  });

  it('lets teammates hear an unseen jammed runner without revealing the source', () => {
    const source = {
      id: 'jammed-runner', team: 'red', x: 300, y: 300, vx: 60, vy: 0,
      jammedUntil: 2_000, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const listener = {
      id: 'red-listener', team: 'red', x: 350, y: 300, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const cues = collectFootstepAudioCues({
      startedAt: 3,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, listener],
      smokes: [],
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });

    assert.equal(cues.length, 1);
    assert.equal(cues[0].kind, 'footstep');
    assert.equal(cues[0].team, listener.team);
    assert.equal(cues[0].heardById, listener.id);
    assert.equal(cues[0].audiencePlayerId, undefined);
    assert.equal(cues[0].sourceId, undefined);
    assert.ok(Math.hypot(cues[0].x - source.x, cues[0].y - source.y) <= cues[0].radius);
  });

  it('keeps a jammed listener’s cue for an unseen jammed teammate personal', () => {
    const source = {
      id: 'jammed-runner', team: 'red', x: 300, y: 300, vx: 60, vy: 0,
      jammedUntil: 2_000, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const listener = {
      id: 'jammed-listener', team: 'red', x: 350, y: 300, jammedUntil: 2_000,
      health: 100, alive: true, selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const cues = collectFootstepAudioCues({
      startedAt: 4,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, listener],
      smokes: [],
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });

    assert.equal(cues.length, 1);
    assert.equal(cues[0].team, listener.team);
    assert.equal(cues[0].heardById, listener.id);
    assert.equal(cues[0].audiencePlayerId, listener.id);
  });

  it('does not emit redundant teammate footsteps when an unjammed teammate can see the source', () => {
    const source = {
      id: 'jammed-runner', team: 'red', x: 300, y: 300, vx: 60, vy: 0,
      jammedUntil: 2_000, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: 0,
    };
    const listener = {
      id: 'red-listener', team: 'red', x: 390, y: 300, health: 100, alive: true,
      selectedWeaponId: 'assault-rifle', visionAngle: Math.PI,
    };
    const cues = collectFootstepAudioCues({
      startedAt: 5,
      map: { objects: [] },
      flag: { heldBy: null },
      players: [source, listener],
      smokes: [],
    }, 1_000, { lastCueAt: new Map(), random: () => 0 });

    assert.deepEqual(cues, []);
  });
});
