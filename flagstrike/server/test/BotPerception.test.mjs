import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectBotPerception } from '../../shared/BotPerception.js';
import { isPointVisible } from '../../shared/VisionModel.js';

describe('bot perception', () => {
  it('limits visible enemies to the bot vision field', () => {
    const bot = { id: 'observer', team: 'red', x: 100, y: 100, visionAngle: 0 };
    const match = { map: { objects: [] }, gadgetEffects: [] };
    const enemies = [
      { id: 'in-front', team: 'blue', x: 220, y: 100 },
      { id: 'behind', team: 'blue', x: 20, y: 100 },
    ];

    const perception = collectBotPerception(bot, match, {}, enemies, 1_000, []);

    assert.deepEqual(perception.visibleEnemies.map(({ id }) => id), ['in-front']);
    assert.deepEqual(perception.visibleEnemyMines, []);
    assert.deepEqual(perception.visibleEnemyDeployables, []);
  });

  it('detects an enemy when its body edge is visible but its center is behind cover', () => {
    const bot = { id: 'observer', team: 'red', x: 100, y: 100, visionAngle: 0 };
    const wall = { shape: 'segment', x1: 160, y1: 99.5, x2: 160, y2: 100.5 };
    const match = { map: { objects: [wall] }, gadgetEffects: [] };
    const enemy = { id: 'edge-visible', team: 'blue', x: 220, y: 100 };
    const perception = collectBotPerception(bot, match, {}, [enemy], 1_000, [wall]);

    assert.equal(isPointVisible(enemy, perception.vision, [wall]), false,
      'the center point is occluded');
    assert.deepEqual(perception.visibleEnemies.map(({ id }) => id), [enemy.id],
      'the visible portion of the player body remains targetable');
  });

  it('does not treat enemies or deployables as visible while the bot is flash-blinded', () => {
    const bot = { id: 'observer', team: 'red', x: 100, y: 100, visionAngle: 0, flashUntil: 2_000 };
    const match = {
      map: { objects: [] },
      gadgetEffects: [{
        id: 'enemy-camera',
        type: 'spy-camera',
        team: 'blue',
        x: 220,
        y: 100,
        health: 100,
        expiresAt: 5_000,
      }],
    };
    const enemies = [{ id: 'in-front', team: 'blue', x: 220, y: 100 }];

    const perception = collectBotPerception(bot, match, {}, enemies, 1_000, []);

    assert.deepEqual(perception.visibleEnemies, []);
    assert.deepEqual(perception.visibleEnemyMines, []);
    assert.deepEqual(perception.visibleEnemyDeployables, []);
  });
});
