import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getWeaponAimAngle,
  getWeaponMuzzlePosition,
  WEAPON_COLLISION_RADIUS,
  WEAPON_LEAN_SIDE_OFFSET,
} from '../../shared/WeaponGeometry.js';

describe('WeaponGeometry', () => {
  it('uses player center when upright and moves the gun center to the selected side when leaning', () => {
    const player = { x: 100, y: 200 };
    assert.deepEqual(getWeaponMuzzlePosition(player, 0, 0), player);
    assert.deepEqual(getWeaponMuzzlePosition(player, 0, -1), {
      x: 100,
      y: 200 - WEAPON_LEAN_SIDE_OFFSET,
    });
    assert.deepEqual(getWeaponMuzzlePosition(player, 0, 1), {
      x: 100,
      y: 200 + WEAPON_LEAN_SIDE_OFFSET,
    });
  });

  it('stops the leaned gun center at colliding wall geometry', () => {
    const player = { x: 100, y: 200 };
    const wall = [{ shape: 'segment', x1: 90, y1: 204, x2: 110, y2: 204 }];
    const leanedOrigin = getWeaponMuzzlePosition(player, 0, 1, wall);

    assert.ok(leanedOrigin.y <= 204 - WEAPON_COLLISION_RADIUS + 1e-7);
    assert.ok(leanedOrigin.y > player.y);
  });

  it('aims from the muzzle toward the mouse target for either lean', () => {
    const player = { x: 130, y: 240 };
    const target = { x: 650, y: 410 };
    for (const lean of [-1, 0, 1]) {
      const angle = getWeaponAimAngle(player, target, lean);
      const muzzle = getWeaponMuzzlePosition(player, angle, lean);
      const cross = Math.cos(angle) * (target.y - muzzle.y) - Math.sin(angle) * (target.x - muzzle.x);
      assert.ok(Math.abs(cross) < 1e-6);
    }
  });

  it('faces a right-side spawn toward the map center instead of off-map east', () => {
    const angle = getWeaponAimAngle(
      { x: 1_250, y: 750 },
      { x: 750, y: 750 },
    );

    assert.ok(Math.cos(angle) < 0);
    assert.ok(Math.abs(Math.sin(angle)) < 1e-9);
  });
});