import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyAccuracyRecoil,
  getEffectiveAccuracy,
  getGaussianSpreadRadians,
  getMaximumRotationRadiansPerSecond,
  recoverAccuracy,
  rotateAngleTowards,
  validateAccuracySettings,
} from '../../shared/WeaponAccuracy.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../shared/ProjectileModel.js';

describe('WeaponAccuracy', () => {
  it('starts with perfect still accuracy and applies recoil per shot', () => {
    const spread = getGaussianSpreadRadians(1, 16, () => 0.5);
    assert.equal(spread, 0);
    assert.equal(applyAccuracyRecoil(1, 0.08), 0.92);
    assert.equal(applyAccuracyRecoil(0.04, 0.08), 0);
  });

  it('adds speed-based penalties, caps them, and recovers accuracy over time', () => {
    assert.equal(getEffectiveAccuracy(1, 0, 100, 0.35), 1);
    assert.equal(getEffectiveAccuracy(1, 50, 100, 0.35), 0.825);
    assert.equal(getEffectiveAccuracy(0.1, 200, 100, 0.35), 0);
    assert.equal(recoverAccuracy(0.5, 1, 0.45), 0.95);
    assert.equal(recoverAccuracy(0.95, 1, 0.45), 1);
  });

  it('samples a centered bell-curve spread inside each weapon spread bound', () => {
    const maximumSpread = 16 * Math.PI / 180;
    const centerSamples = [0.5, 0.25];
    const tailSamples = [Number.EPSILON, 0.5];
    const centerSpread = getGaussianSpreadRadians(0, 16, () => centerSamples.shift());
    const tailSpread = getGaussianSpreadRadians(0, 16, () => tailSamples.shift());

    assert.ok(Math.abs(centerSpread) < 1e-12);
    assert.ok(Math.abs(tailSpread) > Math.abs(centerSpread));
    assert.ok(Math.abs(tailSpread) <= maximumSpread);
    assert.equal(getGaussianSpreadRadians(0.5, 0, () => 0), 0);
  });

  it('validates tunable per-weapon accuracy settings', () => {
    assert.equal(validateAccuracySettings({ recoilPerShot: 0.2 }).recoilPerShot, 0.2);
    assert.throws(() => validateAccuracySettings({ maxSpreadDegrees: -1 }), /non-negative/);
    assert.throws(() => validateAccuracySettings({ recoilPerShot: 2 }), /must not exceed 1/);
  });

  it('limits weapon turning to the configured fastest rotation rate', () => {
    for (const weapon of Object.values(DEFAULT_PROJECTILE_DEFINITIONS)) {
      const maxRotationRate = getMaximumRotationRadiansPerSecond(weapon.rotationTimeMs);
      const elapsedSeconds = weapon.rotationTimeMs / 2_000;
      const halfwayTurn = rotateAngleTowards(0, Math.PI, maxRotationRate * elapsedSeconds);
      assert.ok(Math.abs(halfwayTurn - Math.PI / 2) < 1e-9,
        `${weapon.id} turns at its configured rotation rate`);
    }
    const acrossZero = rotateAngleTowards(Math.PI - 0.1, -Math.PI + 0.1, 0.15);
    assert.ok(Math.abs(Math.atan2(Math.sin(acrossZero - Math.PI), Math.cos(acrossZero - Math.PI))) < 0.1);
  });
});
