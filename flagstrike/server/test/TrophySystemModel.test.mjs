import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  JAMMER_GRENADE_ID,
  BIO_FIELD_ID,
  KATANA_ID,
  SMOKE_GRENADE_ID,
  SONAR_ID,
  TROPHY_SYSTEM_ID,
} from '../../shared/GadgetModel.js';
import {
  findTrophyPlacedGadgetInterceptions,
  findTrophyProjectileInterceptions,
} from '../../shared/TrophySystemModel.js';

const redTrophy = {
  id: 'red-trophy',
  type: TROPHY_SYSTEM_ID,
  team: 'red',
  x: 50,
  y: 0,
  startedAt: 0,
  expiresAt: 60_000,
  health: 200,
};

describe('Trophy System model', () => {
  it('intercepts eligible enemy projectiles crossing its line of sight', () => {
    const pending = {
      effect: {
        id: 'smoke-projectile',
        gadgetId: SMOKE_GRENADE_ID,
        team: 'blue',
        thrownAt: 0,
      },
      landedAt: 1_000,
      projectileSpeed: 100,
      trajectory: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };

    const intercepted = findTrophyProjectileInterceptions(
      [pending], [redTrophy], [], 400, 600,
    );
    assert.equal(intercepted.length, 1);
    assert.equal(intercepted[0].effectId, pending.effect.id);
    assert.equal(intercepted[0].trophyId, redTrophy.id);
    assert.equal(intercepted[0].position.x, 40,
      'it intercepts at the first simulation sample when the Trophy already has line of sight');

    assert.deepEqual(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, team: 'red' } }], [redTrophy], [], 400, 600,
    ), [], 'friendly projectiles are not intercepted');
    assert.deepEqual(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, team: undefined } }], [redTrophy], [], 400, 600,
    ), [], 'projectiles without a valid enemy team are not intercepted');
    assert.deepEqual(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, team: 'spectator' } }], [redTrophy], [], 400, 600,
    ), [], 'non-team projectiles are not intercepted');
    assert.equal(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, gadgetId: SONAR_ID } }], [redTrophy], [], 400, 600,
    ).length, 1, 'Sonar projectiles are intercepted');
    assert.equal(findTrophyProjectileInterceptions(
      [pending, { ...pending, effect: { ...pending.effect, id: 'second-projectile' } }],
      [redTrophy], [], 400, 600,
    ).length, 2, 'the Trophy has no interception cooldown');
    assert.deepEqual(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, gadgetId: KATANA_ID } }], [redTrophy], [], 400, 600,
    ), [], 'Katana is not intercepted');
    assert.equal(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, id: 'jammer-projectile', gadgetId: JAMMER_GRENADE_ID } }],
      [redTrophy], [], 400, 600,
    ).length, 1, 'Jammer Grenades are intercepted before they detonate');
    assert.equal(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, id: 'bio-field-projectile', gadgetId: BIO_FIELD_ID } }],
      [redTrophy], [], 400, 600,
    ).length, 1, 'Bio Field projectiles are intercepted before they land');
    assert.equal(findTrophyProjectileInterceptions(
      [{ ...pending, effect: { ...pending.effect, id: 'trophy-command', gadgetId: TROPHY_SYSTEM_ID } }],
      [redTrophy], [], 400, 600,
    ).length, 1, 'an opposing Trophy can intercept a command projectile');
  });

  it('does not intercept projectiles behind walls or after the Trophy expires', () => {
    const pending = {
      effect: { id: 'flash-projectile', gadgetId: 'flash-grenade', team: 'blue', thrownAt: 0 },
      landedAt: 1_000,
      projectileSpeed: 100,
      trajectory: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    };
    const wall = { shape: 'segment', x1: 75, y1: -20, x2: 75, y2: 20, blocksVision: true };
    assert.deepEqual(findTrophyProjectileInterceptions(
      [pending], [{ ...redTrophy, x: 90 }], [wall], 400, 600,
    ), []);
    assert.deepEqual(findTrophyProjectileInterceptions(
      [pending], [{ ...redTrophy, expiresAt: 350 }], [], 400, 600,
    ), []);
  });

  it('destroys enemy Spy Cameras, mines, Vine Traps, and Trophy Systems in sight', () => {
    const devices = [
      { id: 'camera', type: 'spy-camera', team: 'blue', x: 60, y: 0, expiresAt: 10_000 },
      { id: 'mine', type: 'mine', team: 'blue', x: 70, y: 0, expiresAt: 10_000 },
      { id: 'vine', type: 'vine-trap', team: 'blue', x: 80, y: 0, expiresAt: 10_000 },
      { id: 'trophy', type: TROPHY_SYSTEM_ID, team: 'blue', x: 90, y: 0, expiresAt: 10_000 },
      { id: 'sonar', type: 'sonar-projectile', team: 'blue', x: 65, y: 0, expiresAt: 10_000 },
      { id: 'friendly', type: 'mine', team: 'red', x: 55, y: 0, expiresAt: 10_000 },
      { id: 'fire', type: 'molotov', team: 'blue', x: 55, y: 0, expiresAt: 10_000 },
    ];
    assert.deepEqual(
      [...findTrophyPlacedGadgetInterceptions(devices, [redTrophy], [], 1_000)].sort(),
      ['camera', 'mine', 'sonar', 'trophy', 'vine'],
    );

    const wall = { shape: 'segment', x1: 75, y1: -20, x2: 75, y2: 20, blocksVision: true };
    assert.deepEqual(
      [...findTrophyPlacedGadgetInterceptions(devices, [redTrophy], [wall], 1_000)].sort(),
      ['camera', 'mine', 'sonar'],
    );
  });
});
