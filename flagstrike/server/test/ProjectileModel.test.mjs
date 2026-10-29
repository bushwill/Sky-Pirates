import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_PROJECTILE_DEFINITIONS, getDamageFalloffMultiplier, getProjectileDamage, getProjectileDamageAlongSegment, segmentCircleEntryT, segmentCircleEntryTCoordinates, segmentMapObjectBoundsOverlap, segmentMapObjectEntryT, traceMapRay, validateProjectileDefinition } from '../../shared/ProjectileModel.js';
import { getMaximumRotationRadiansPerSecond, rotateAngleTowards } from '../../shared/WeaponAccuracy.js';

const standardBullet = validateProjectileDefinition({
  id: 'test-round',
  damage: 40,
  radius: 2,
  centerDamageMultiplier: 1,
  edgeDamageMultiplier: 0.01,
  speed: 500,
  range: 1000,
  cooldownMs: 0,
});

describe('ProjectileModel', () => {
  it('provides a usable rotation time for the client weapon aim update', () => {
    const rifle = DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
    const maximumRotationRate = getMaximumRotationRadiansPerSecond(rifle.rotationTimeMs);

    assert.ok(rifle.rotationTimeMs > 0);
    assert.ok(Number.isFinite(maximumRotationRate));
    assert.ok(rotateAngleTowards(0, Math.PI / 2, maximumRotationRate * 0.016) > 0);
  });

  it('provides valid definitions for every selectable weapon and preserves weapon-class behavior', () => {
    const weapons = Object.values(DEFAULT_PROJECTILE_DEFINITIONS);
    assert.ok(weapons.length > 0);
    for (const weapon of weapons) {
      assert.doesNotThrow(() => validateProjectileDefinition(weapon), `${weapon.id} definition validates`);
      assert.equal(weapon.radius, 0.1, `${weapon.id} uses the shared small projectile radius`);
      assert.ok(Number.isFinite(weapon.botAppeal) && weapon.botAppeal >= 0,
        `${weapon.id} has a non-negative bot appeal weight`);
      assert.ok(weapon.movementScale > 0 && weapon.movementScale <= 1);
      assert.ok(weapon.rotationTimeMs > 0);
      assert.ok(weapon.magazineSize === undefined || weapon.magazineSize > 0);
      assert.ok(weapon.accuracy.maxSpreadDegrees >= 0);
      assert.ok(weapon.accuracy.recoilPerShot >= 0);
      assert.ok(weapon.accuracy.recoveryPerSecond >= 0);
      assert.ok(weapon.accuracy.movementPenaltyAtMaxSpeed >= 0);
      assert.equal(weapon.friendlyFire, false, `${weapon.id} cannot damage teammates`);
    }
    for (const weapon of weapons.filter((entry) => entry.semiAuto)) {
      assert.ok(weapon.botFireIntervalMs >= Math.max(weapon.cooldownMs, weapon.manualActionDurationMs ?? 0),
        `${weapon.id} keeps bot firing paced at or slower than its configured action timing`);
    }

    const pistols = ['classic-pistol', 'battle-pistol', 'revolver', 'machine-pistol', 'pocket-shotgun']
      .map((id) => weapons.find((weapon) => weapon.id === id));
    assert.ok(pistols.every(Boolean), 'all pistol definitions remain selectable');
    assert.ok(weapons.find((weapon) => weapon.id === 'battle-pistol').burstCount >= 2);
    assert.equal(weapons.find((weapon) => weapon.id === 'classic-pistol').semiAuto, true);
    assert.ok(weapons.find((weapon) => weapon.id === 'revolver').reloadPerRound);
    assert.equal(DEFAULT_PROJECTILE_DEFINITIONS.machinePistol.weaponClass, 'pistol');
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.machinePistol.shopValue >= 0);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.machinePistol.damage > 0);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.machinePistol.magazineSize > 0);
    assert.equal(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.weaponClass, 'pistol');
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.shopValue >= 0);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.pelletCount > 1);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.damage > 0);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.magazineSize > 0);
    assert.ok(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.reloadDurationMs > 0);
    assert.equal(DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun.semiAuto, true);
    const pumpShotgun = DEFAULT_PROJECTILE_DEFINITIONS.shotgun;
    assert.ok(pumpShotgun.manualActionDurationMs > 0, 'the pump shotgun has a configured action cycle');
    assert.ok(pumpShotgun.botFireIntervalMs >=
      Math.max(pumpShotgun.cooldownMs, pumpShotgun.manualActionDurationMs),
    'shotgun bot firing respects both cooldown and pump-action timing');
    for (const weapon of [DEFAULT_PROJECTILE_DEFINITIONS.machinePistol, DEFAULT_PROJECTILE_DEFINITIONS.pocketShotgun]) {
      assert.ok(weapon.damageFalloffStartRange > 0 &&
        weapon.damageFalloffEndRange > weapon.damageFalloffStartRange,
      `${weapon.id} has a valid independent falloff range`);
    }

    const marksman = DEFAULT_PROJECTILE_DEFINITIONS.marksmanRifle;
    const heavySniper = DEFAULT_PROJECTILE_DEFINITIONS.heavySniper;
    const battleRifle = DEFAULT_PROJECTILE_DEFINITIONS.battleRifle;
    const machineGun = DEFAULT_PROJECTILE_DEFINITIONS.machineGun;
    assert.equal(marksman.weaponClass, 'sniper');
    assert.ok(marksman.shopValue >= 0);
    assert.ok(marksman.damage > 0);
    assert.ok(marksman.magazineSize > 0);
    assert.equal(marksman.reloadPerRound, true);
    assert.ok(marksman.manualActionDurationMs > 0, 'the lever action has a configured cycle time');
    assert.ok(marksman.reloadIntervalMs.every((interval) => interval > 0));
    assert.equal(heavySniper.weaponClass, 'sniper');
    assert.ok(heavySniper.shopValue >= 0);
    assert.ok(heavySniper.damage > 0);
    assert.ok(heavySniper.magazineSize > 0);
    assert.ok(heavySniper.manualActionDurationMs > 0);
    assert.ok(heavySniper.reloadDurationMs > 0);
    assert.equal(battleRifle.weaponClass, 'rifle');
    assert.ok(battleRifle.shopValue >= 0);
    assert.ok(battleRifle.damage > 0);
    assert.ok(battleRifle.magazineSize > 0);
    assert.equal(battleRifle.semiAuto, true);
    assert.equal(machineGun.weaponClass, 'machine-gun');
    assert.ok(machineGun.shopValue >= 0);
    assert.ok(machineGun.damage > 0);
    assert.ok(machineGun.magazineSize > 0);
    assert.ok(machineGun.reloadDurationMs > 0);
    assert.ok(machineGun.cooldownMs > 0);
    assert.ok(machineGun.movementScale > 0 && machineGun.movementScale < 1);
    assert.ok(machineGun.accuracy.maxAccuracy >= 0 && machineGun.accuracy.maxAccuracy <= 1);
  });

  it('calculates falloff and hit damage from each weapon definition', () => {
    for (const weapon of Object.values(DEFAULT_PROJECTILE_DEFINITIONS)) {
      const { damageFalloffStartRange: start, damageFalloffEndRange: end } = weapon;
      const minimum = weapon.minimumDamageMultiplier ?? 0.5;
      const middle = Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : 0;
      const expectedAt = (distance) => !Number.isFinite(start) || !Number.isFinite(end) || distance <= start
        ? 1
        : Math.max(minimum, 1 - ((distance - start) / (end - start)) * (1 - minimum));

      assert.equal(getDamageFalloffMultiplier(weapon, Number.isFinite(start) ? start : 0), 1,
        `${weapon.id} starts at full damage`);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        assert.equal(getDamageFalloffMultiplier(weapon, middle), expectedAt(middle));
        assert.equal(getDamageFalloffMultiplier(weapon, end), minimum);
        assert.equal(getDamageFalloffMultiplier(weapon, end * 2), minimum);
        assert.equal(getProjectileDamage(weapon, 0, 9, end),
          weapon.damage * weapon.centerDamageMultiplier * minimum);
      }
    }
  });

  it('calculates hit damage from perpendicular distance to the projectile segment', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1_000, y: 0 };
    assert.equal(getProjectileDamageAlongSegment(standardBullet, start, end, { x: 50, y: 0 }, 9), 40);
    assert.equal(getProjectileDamageAlongSegment(standardBullet, start, end, { x: 900, y: 0 }, 9), 40,
      'a distant center hit is not mistaken for a miss based on shooter distance');
    assert.ok(Math.abs(getProjectileDamageAlongSegment(standardBullet, start, end, { x: 900, y: 9 }, 9) - 0.4) < 1e-12,
      'grazing a body edge deals configured edge damage');
  });

  it('scales damage from configurable center damage to configurable edge damage', () => {
    assert.equal(getProjectileDamage(standardBullet, 0, 9), 40);
    assert.ok(Math.abs(getProjectileDamage(standardBullet, 9, 9) - 0.4) < 1e-12);
    assert.ok(Math.abs(getProjectileDamage(standardBullet, 4.5, 9) - 20.2) < 1e-12);
    assert.ok(Math.abs(getProjectileDamage(standardBullet, 11, 9) - 0.4) < 1e-12,
      'projectile radius extends collision but side hits still deal only edge damage');
    assert.equal(getProjectileDamage(standardBullet, 11.01, 9), 0);

    for (const weapon of Object.values(DEFAULT_PROJECTILE_DEFINITIONS)) {
      const expectedCenter = weapon.damage * weapon.centerDamageMultiplier;
      const expectedEdge = weapon.damage * weapon.edgeDamageMultiplier;
      assert.ok(Math.abs(getProjectileDamage(weapon, 0, 9) - expectedCenter) < 1e-12,
        `${weapon.id} uses configured center damage`);
      assert.ok(Math.abs(getProjectileDamage(weapon, 9, 9) - expectedEdge) < 1e-12,
        `${weapon.id} uses configured edge damage`);
    }

    const lowDamage = validateProjectileDefinition({
      ...standardBullet,
      damage: 20,
      centerDamageMultiplier: 0.8,
      edgeDamageMultiplier: 0.05,
    });
    assert.equal(getProjectileDamage(lowDamage, 0, 9), 16);
    assert.equal(getProjectileDamage(lowDamage, 11, 9), 1);
  });

  it('validates projectile values and supports omitted default falloff percentages', () => {
    const plainWeapon = validateProjectileDefinition({ id: 'plain', damage: 10, speed: 1, radius: 0, range: 5, cooldownMs: 0 });
    assert.equal(plainWeapon.edgeDamageMultiplier, 0.01);
    assert.equal(plainWeapon.weight, 1);
    assert.equal(plainWeapon.rotationTimeMs, 100);
    assert.equal(plainWeapon.botAppeal, 1, 'custom definitions default to a neutral bot appeal');
    assert.equal(validateProjectileDefinition({ id: 'heavy', damage: 10, speed: 1, radius: 0, range: 5, cooldownMs: 0, weight: 8 }).rotationTimeMs, 800);
    assert.throws(() => validateProjectileDefinition({ id: 'bad', damage: 0, speed: 1, radius: 1, range: 5, cooldownMs: 0 }), /positive damage/);
    assert.throws(() => validateProjectileDefinition({ id: 'bad', damage: 1, speed: 1, radius: 1, range: 5, cooldownMs: 0, edgeDamageMultiplier: 2 }), /between 0 and 1/);
    assert.throws(() => validateProjectileDefinition({ id: 'bad', damage: 1, speed: 1, radius: 1, range: 5, cooldownMs: 0, magazineSize: 30.5 }), /positive integer/);
    assert.throws(() => validateProjectileDefinition({ id: 'bad', damage: 1, speed: 1, radius: 1, range: 5, cooldownMs: 0, botAppeal: -1 }), /botAppeal must be a non-negative number/);
  });

  it('sweeps projectile paths against blocking circles, rectangles, and walls', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    assert.equal(segmentMapObjectEntryT(start, end, { shape: 'circle', x: 50, y: 0, radius: 5 }, 2), 0.43);
    assert.equal(segmentMapObjectEntryT(start, end, { shape: 'rect', x: 50, y: 0, width: 10, height: 10 }, 2), 0.43);
    assert.equal(segmentMapObjectEntryT(start, end, { shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20 }, 2), 0.48);
    assert.equal(segmentMapObjectEntryT(start, end, { shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20, blocksProjectiles: false }, 2), null);
  });

  it('keeps scalar circle intersections and object bounds conservative for collision candidates', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const circle = { shape: 'circle', x: 50, y: 0, radius: 5 };
    const rect = { shape: 'rect', x: 50, y: 0, width: 10, height: 10 };
    const wall = { shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20 };

    assert.equal(segmentCircleEntryTCoordinates(0, 0, 100, 0, 50, 0, 7),
      segmentCircleEntryT(start, end, { x: 50, y: 0 }, 7));
    assert.equal(segmentMapObjectBoundsOverlap(start, end, circle, 2), true);
    assert.equal(segmentMapObjectBoundsOverlap(start, end, rect, 2), true);
    assert.equal(segmentMapObjectBoundsOverlap(start, end, wall, 2), true);
    assert.equal(segmentMapObjectBoundsOverlap(start, end, { shape: 'circle', x: 50, y: 30, radius: 2 }, 2), false);
    assert.equal(segmentMapObjectBoundsOverlap(start, end, { shape: 'rect', x: 50, y: 30, width: 2, height: 2 }, 2), false);
    assert.equal(segmentMapObjectBoundsOverlap(start, end, { shape: 'segment', x1: 50, y1: 30, x2: 70, y2: 35 }, 2), false);
  });

  it('uses projectile radius consistently for wall obstruction from either direction and near misses', () => {
    const wall = { shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20 };
    assert.equal(segmentMapObjectEntryT({ x: 0, y: 0 }, { x: 100, y: 0 }, wall, 2), 0.48);
    assert.equal(segmentMapObjectEntryT({ x: 100, y: 0 }, { x: 0, y: 0 }, wall, 2), 0.48);
    assert.notEqual(segmentMapObjectEntryT({ x: 51.5, y: -30 }, { x: 51.5, y: 30 }, wall, 2), null);
    assert.equal(segmentMapObjectEntryT({ x: 52.01, y: -30 }, { x: 52.01, y: 30 }, wall, 2), null);
  });

  it('uses indexed candidates without changing the nearest map-ray hit', () => {
    const wall = { id: 'near-wall', shape: 'segment', x1: 500, y1: 400, x2: 500, y2: 600 };
    const objects = [wall, ...Array.from({ length: 80 }, (_, index) => ({
      shape: 'circle', x: 1_500 + index * 140, y: 1_500, radius: 12,
    }))];
    const result = traceMapRay({ x: 400, y: 500 }, 0, 800, objects);

    assert.equal(result.firstObject, wall);
    assert.ok(Math.abs(result.end.x - 500) < 1e-7);
  });

  it('keeps diagonal and reverse rays equivalent to a full geometry scan', () => {
    const origin = { x: 700, y: 700 };
    const objects = Array.from({ length: 80 }, (_, index) => ({
      shape: 'circle', x: -2_000 - index * 120, y: 2_000, radius: 10,
    }));
    for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, Math.PI, -Math.PI / 3]) {
      const center = { x: origin.x + Math.cos(angle) * 260, y: origin.y + Math.sin(angle) * 260 };
      const tangent = { x: -Math.sin(angle) * 40, y: Math.cos(angle) * 40 };
      const wall = {
        shape: 'segment',
        x1: center.x - tangent.x,
        y1: center.y - tangent.y,
        x2: center.x + tangent.x,
        y2: center.y + tangent.y,
      };
      const rayObjects = [wall, ...objects];
      const actual = traceMapRay(origin, angle, 900, rayObjects, 2);
      let expectedT = 1;
      let expectedObject = null;
      const end = { x: origin.x + Math.cos(angle) * 900, y: origin.y + Math.sin(angle) * 900 };
      for (const object of rayObjects) {
        if (!segmentMapObjectBoundsOverlap(origin, end, object, 2)) continue;
        const hitT = segmentMapObjectEntryT(origin, end, object, 2);
        if (hitT !== null && hitT < expectedT) {
          expectedT = hitT;
          expectedObject = object;
        }
      }
      assert.equal(actual.firstObject, expectedObject, `angle ${angle} keeps the nearest hit`);
      assert.ok(Math.hypot(actual.end.x - (origin.x + (end.x - origin.x) * expectedT),
        actual.end.y - (origin.y + (end.y - origin.y) * expectedT)) < 1e-7);
    }
  });
});
