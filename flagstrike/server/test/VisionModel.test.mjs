import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createVision,
  createXrayVision,
  forgetRememberedObjectSurfaces,
  getPlayerVisionOrigin,
  getSegmentVisionIntervals,
  getVisionPolygonScanlineIntervals,
  isCircleVisible,
  isSegmentInVision,
  getNewlyRevealedWalls,
  isPointVisible,
  pointInVisionPolygon,
  revealVisionCells,
  TEAMMATE_VISION_BASE_RAY_COUNT,
  VISION_HALF_ANGLE,
  VISION_MEMORY_CELL_SIZE,
} from '../../shared/VisionModel.js';
import { getMapRayEnd } from '../../shared/ProjectileModel.js';
import { getWeaponMuzzlePosition } from '../../shared/WeaponGeometry.js';

describe('VisionModel', () => {
  it('recognizes a visible projectile segment even when both endpoints are outside the vision polygon', () => {
    const vision = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: -10 },
        { x: 20, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    const start = { x: 10, y: -20 };
    const end = { x: 10, y: 20 };
    assert.equal(isSegmentInVision(start, end, vision), true);
    assert.deepEqual(getSegmentVisionIntervals(start, end, vision), [[0.25, 0.75]]);
    assert.equal(isSegmentInVision({ x: 30, y: -20 }, { x: 30, y: 20 }, vision), false);
  });

  it('uses fine fog cells and remembers walls touched by vision rays', () => {
    assert.equal(VISION_MEMORY_CELL_SIZE, 4);
    const wall = { id: 'north-wall', shape: 'segment', x1: 50, y1: -30, x2: 50, y2: 30 };
    const vision = createVision({ x: 0, y: 0 }, 0, [wall], 200, 100);
    const exploredWalls = new Set();

    const newlyRevealed = getNewlyRevealedWalls(exploredWalls, [vision]);
    assert.ok(newlyRevealed.length > 1);
    assert.ok(newlyRevealed.every((fragment) => Math.hypot(fragment.x2 - fragment.x1, fragment.y2 - fragment.y1) <= 2));
    assert.deepEqual(getNewlyRevealedWalls(exploredWalls, [vision]), []);
  });

  it('refreshes cached wall geometry when a map object moves', () => {
    const wall = { id: 'moving-wall', shape: 'segment', x1: 50, y1: -50, x2: 50, y2: 50 };
    const before = createVision({ x: 0, y: 0 }, 0, [wall], 200, 100);
    wall.x1 = 90;
    wall.x2 = 90;
    const after = createVision({ x: 0, y: 0 }, 0, [wall], 200, 100);
    const centerRayEndpoint = (vision) => vision.points.find((point) => point.x > 0 && point.y === 0);

    assert.equal(centerRayEndpoint(before).x, 50);
    assert.equal(centerRayEndpoint(after).x, 90);
  });

  it('does not reveal wall sections hidden behind an angled joined wall', () => {
    const frontWall = { id: 'front', shape: 'segment', x1: 50, y1: -5, x2: 50, y2: 5 };
    const angledWall = { id: 'angled', shape: 'segment', x1: 50, y1: 5, x2: 90, y2: -15 };
    const vision = createVision({ x: 0, y: 0 }, 0, [frontWall, angledWall], 150, 100, 0.6);
    const angledFragments = vision.walls.filter((wall) => wall.id.startsWith('angled:visible:'));
    const fragmentCentersY = angledFragments.map((wall) => (wall.y1 + wall.y2) / 2);

    assert.ok(angledFragments.length > 0, 'exposed portions of the angled wall should be discovered');
    assert.ok(fragmentCentersY.every((centerY) => centerY < -6),
      'wall fragments inside the front wall shadow must remain hidden');
  });

  it('creates a wide cone that extends until the map wall obstructs it', () => {
    const wall = { shape: 'segment', x1: 50, y1: -30, x2: 50, y2: 30 };
    const vision = createVision({ x: 0, y: 0 }, 0, [wall], 200, 100);

    assert.equal(VISION_HALF_ANGLE, 40 * Math.PI / 180);
    assert.ok(pointInVisionPolygon({ x: 30, y: 0 }, vision));
    assert.ok(!pointInVisionPolygon({ x: 30, y: 80 }, vision));
    assert.ok(vision.points.some((point) => Math.abs(point.x - 50) < 1e-6));
    assert.ok(isPointVisible({ x: 40, y: 0 }, vision, [wall]));
    assert.ok(!isPointVisible({ x: 80, y: 0 }, vision, [wall]));
  });

  it('matches polygon point tests with scanline intervals over the fog grid', () => {
    const walls = [
      { id: 'flash-wall', shape: 'segment', x1: 150, y1: 85, x2: 150, y2: 170 },
      { id: 'flash-prop', shape: 'rect', x: 90, y: 180, width: 18, height: 34 },
    ];
    const vision = createVision({ x: 128, y: 128 }, 0, walls, 256, 256, Math.PI, 110);

    for (let y = 2; y < 256; y += VISION_MEMORY_CELL_SIZE) {
      const intervals = getVisionPolygonScanlineIntervals(vision, y);
      for (let x = 2; x < 256; x += VISION_MEMORY_CELL_SIZE) {
        const scanlineVisible = intervals.some(([left, right]) => x >= left && x < right);
        assert.equal(scanlineVisible, pointInVisionPolygon({ x, y }, vision),
          `scanline membership at (${x}, ${y}) matches polygon membership`);
      }
    }
  });

  it('lets Spy Camera vision see through walls while respecting its range and cone angle', () => {
    const wall = { id: 'camera-wall', shape: 'segment', x1: 40, y1: -20, x2: 40, y2: 20 };
    const vision = createXrayVision({ x: 0, y: 0 }, 0, 200, 100, 0.2, 100);

    assert.equal(isPointVisible({ x: 80, y: 0 }, vision, [wall]), true);
    assert.equal(isPointVisible({ x: 101, y: 0 }, vision, [wall]), false);
    assert.equal(isPointVisible({ x: 80, y: 30 }, vision, [wall]), false);
  });

  it('closes narrow vision slivers between joined straight and angled walls', () => {
    const walls = [
      { id: 'straight-wall', shape: 'segment', x1: 50, y1: -40, x2: 50, y2: 10 },
      { id: 'angled-wall', shape: 'segment', x1: 52, y1: 12, x2: 100, y2: 60 },
    ];
    const target = { x: 100, y: 21 };
    const angle = Math.atan2(target.y, target.x);
    const vision = createVision({ x: 0, y: 0 }, angle, walls, 200, 150, 0.2, 200);

    assert.equal(isPointVisible(target, vision, walls), false,
      'line of sight cannot thread the small gap between wall endpoints');
    assert.equal(pointInVisionPolygon(target, vision), false,
      'the rendered vision polygon also remains behind the joined corner');
  });

  it('preserves joined-wall visibility with distance-ordered candidates on larger maps', () => {
    const walls = [
      { id: 'front-wall', shape: 'segment', x1: 50, y1: -5, x2: 50, y2: 5 },
      { id: 'angled-wall', shape: 'segment', x1: 50, y1: 5, x2: 90, y2: -15 },
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `non-blocking-${index}`,
        shape: 'circle',
        x: 200 + index * 10,
        y: 200,
        radius: 3,
        blocksVision: false,
      })),
    ];
    const vision = createVision(
      { x: 0, y: 0 }, 0, walls, 150, 100, 0.6, 300, 0, TEAMMATE_VISION_BASE_RAY_COUNT,
    );
    const angledFragments = vision.walls.filter((wall) => wall.id.startsWith('angled-wall:visible:'));

    assert.ok(angledFragments.length > 0);
    assert.ok(angledFragments.every((fragment) => (fragment.y1 + fragment.y2) / 2 < -6));
  });

  it('keeps map order when distance-ordered rays hit overlapping walls equally', () => {
    const firstWall = { id: 'first-wall', shape: 'segment', x1: 50, y1: -30, x2: 50, y2: 30 };
    const overlappingWall = { ...firstWall, id: 'overlapping-wall' };
    const vision = createVision({ x: 0, y: 0 }, 0, [firstWall, overlappingWall], 200, 100);

    assert.ok(vision.walls.some((wall) => wall.id.startsWith('first-wall:visible:')));
    assert.equal(vision.walls.some((wall) => wall.id.startsWith('overlapping-wall:visible:')), false);
  });

  it('calculates each ray direction once without dropping joined-corner rays', () => {
    const walls = [
      { id: 'front', shape: 'segment', x1: 50, y1: -30, x2: 50, y2: 20 },
      { id: 'joined', shape: 'segment', x1: 52, y1: 22, x2: 90, y2: 60 },
    ];
    const originalSin = Math.sin;
    let sineCalls = 0;
    let sparseSineCalls;
    let sparseVision;
    let vision;
    try {
      Math.sin = (angle) => {
        sineCalls += 1;
        return originalSin(angle);
      };
      sparseVision = createVision({ x: 0, y: 0 }, 0, walls, 200, 150,
        VISION_HALF_ANGLE, 500, 0, 64);
      sparseSineCalls = sineCalls;
      sineCalls = 0;
      vision = createVision({ x: 0, y: 0 }, 0, walls, 200, 150,
        VISION_HALF_ANGLE, 500, 0, 128);
    } finally {
      Math.sin = originalSin;
    }
    assert.equal(sineCalls - sparseSineCalls, vision.points.length - sparseVision.points.length,
      'each extra ray calculates its direction once, excluding fixed geometry-angle setup');
    assert.ok(vision.points.length > 130, 'wall-vertex rays supplement the base fan');
    assert.equal(pointInVisionPolygon({ x: 100, y: 21 }, vision), false);
  });

  it('anchors vision at the leaned weapon position while using the independent vision angle', () => {
    const player = {
      x: 0,
      y: 0,
      selectedWeaponId: 'shotgun',
      weaponLean: 1,
      weaponStats: { shotgun: { aimAngle: 0 } },
    };
    const visionOrigin = getPlayerVisionOrigin(player);
    const firingAngle = Math.PI / 3;
    const firingOrigin = getPlayerVisionOrigin(player, [], firingAngle);
    const rotatedGunOrigin = getPlayerVisionOrigin({
      ...player,
      weaponStats: { shotgun: { aimAngle: Math.PI / 2 } },
    });
    const vision = createVision(visionOrigin, Math.PI / 2, [], 200, 100, 0);

    assert.deepEqual(visionOrigin, { x: 0, y: 7 });
    assert.deepEqual(firingOrigin,
      getWeaponMuzzlePosition(player, firingAngle, player.weaponLean));
    assert.ok(Math.abs(rotatedGunOrigin.x + 7) < 1e-9);
    assert.ok(Math.abs(rotatedGunOrigin.y) < 1e-9);
    assert.equal(vision.angle, Math.PI / 2,
      'the vision angle can update instantly without changing the weapon aim angle');
  });

  it('does not impose a weapon-range limit on clear player vision', () => {
    const vision = createVision({ x: 0, y: 0 }, 0, [], 10_000, 10_000, 0);

    assert.equal(vision.maximumRange, Math.hypot(10_000, 10_000) * 2);
    assert.equal(isPointVisible({ x: 8_000, y: 0 }, vision, []), true);
    assert.equal(isPointVisible({ x: 8_000, y: 0 }, {
      ...vision,
      maximumRange: 1_000,
    }, []), false, 'explicit finite-radius checks remain supported');
  });

  it('reveals a player when the visible cone reaches any part of their body circle', () => {
    const wall = { id: 'short-wall', shape: 'segment', x1: 50, y1: -30, x2: 50, y2: 4 };
    const vision = createVision({ x: 0, y: 0 }, 0, [wall], 200, 100, 0.1, 150);
    const player = { x: 100, y: 0 };

    assert.equal(isPointVisible(player, vision, [wall]), false,
      'the player center remains hidden behind the wall');
    assert.equal(isCircleVisible(player, 9, vision, [wall]), true,
      'the lower edge of the player circle is visible past the wall end');
    assert.equal(isCircleVisible({ x: 100, y: 40 }, 9, vision, [wall]), false,
      'a fully occluded player remains hidden');

    const clearVision = createVision({ x: 0, y: 0 }, 0, [], 200, 100, 0.1, 150);
    assert.equal(isCircleVisible({ x: 100, y: 11 }, 9, clearVision, []), true,
      'a circle overlapping the cone remains visible even when its center is outside');
    assert.equal(isCircleVisible({ x: 100, y: 20 }, 9, clearVision, []), false,
      'a circle completely outside the cone is rejected');
  });

  it('remembers only the prop surfaces struck by vision rays and clears them when destroyed', () => {
    const prop = {
      id: 'barrel-1', shape: 'circle', role: 'destructible-prop',
      x: 50, y: 0, radius: 12, blocksVision: true,
    };
    const blockedVision = createVision({ x: 0, y: 0 }, 0, [prop], 200, 100, 0);
    assert.equal(isPointVisible({ x: 100, y: 0 }, blockedVision, [prop]), false);
    assert.ok(blockedVision.walls.length > 0);
    assert.ok(blockedVision.walls.every((surface) => surface.objectId === prop.id && surface.role === prop.role &&
      surface.shape === 'segment' && Math.hypot(surface.x2 - surface.x1, surface.y2 - surface.y1) <= 6.01),
    'only short, ray-hit surface fragments should be remembered');
    assert.ok(blockedVision.walls.every((surface) => surface.id !== prop.id),
      'the full circle silhouette is not revealed by one sighting');

    prop.blocksVision = false;
    const openVision = createVision({ x: 0, y: 0 }, 0, [prop], 200, 100, 0);
    assert.equal(isPointVisible({ x: 100, y: 0 }, openVision, [prop]), true);
    assert.ok(openVision.points[1].x > 100, 'the updated cone extends beyond the destroyed prop');
    assert.deepEqual(openVision.walls, [], 'a destroyed prop is no longer remembered as an obstruction');
  });

  it('removes every remembered prop surface fragment when global intel reports destruction', () => {
    const remembered = new Map([
      ['box:surface:left:0', { id: 'box:surface:left:0', objectId: 'box' }],
      ['box:surface:top:1', { id: 'box:surface:top:1', objectId: 'box' }],
      ['wall:visible:4', { id: 'wall:visible:4', shape: 'segment' }],
    ]);
    const discovered = new Set(remembered.keys());

    forgetRememberedObjectSurfaces(discovered, remembered, ['box']);

    assert.deepEqual([...remembered.keys()], ['wall:visible:4']);
    assert.deepEqual([...discovered], ['wall:visible:4']);
  });

  it('retains blockers in the vision cone while ignoring off-cone geometry on large maps', () => {
    const wall = { id: 'center-wall', shape: 'segment', x1: 500, y1: 400, x2: 500, y2: 600 };
    const offConeObjects = Array.from({ length: 80 }, (_, index) => ({
      shape: 'circle', x: 1_500 + index * 140, y: 1_500, radius: 12,
    }));
    const vision = createVision({ x: 400, y: 500 }, 0, [wall, ...offConeObjects], 2_000, 2_000, 0, 800);

    assert.ok(Math.abs(vision.points[1].x - 500) < 1e-7);
    assert.ok(!isPointVisible({ x: 700, y: 500 }, vision, [wall, ...offConeObjects]));
  });

  it('matches weapon-ray range and wall clearance when creating a weapon-aligned cone', () => {
    const origin = { x: 0, y: 0 };
    const angle = 0;
    const range = 120;
    const projectileRadius = 3;
    const wall = { id: 'shot-wall', shape: 'segment', x1: 50, y1: -20, x2: 50, y2: 20 };
    const vision = createVision(origin, angle, [wall], 200, 100, 0, range, projectileRadius);
    const weaponRayEnd = getMapRayEnd(origin, angle, range, [wall], projectileRadius);

    assert.deepEqual(vision.points[1], weaponRayEnd,
      'the cone center ray has the same endpoint as the weapon ray');
    assert.equal(vision.maximumRange, range);
    assert.ok(vision.points[1].x < 50, 'projectile radius is included when the wall stops vision/aim rays');

    const unobstructed = createVision(origin, angle, [], 200, 100, 0, range, projectileRadius);
    assert.deepEqual(unobstructed.points[1], { x: range, y: 0 }, 'weapon cone range stops at actual weapon range');
  });

  it('keeps door gaps open while blocking targets behind wall segments', () => {
    const walls = [
      { shape: 'segment', x1: 50, y1: -30, x2: 50, y2: -5 },
      { shape: 'segment', x1: 50, y1: 5, x2: 50, y2: 30 },
    ];
    const vision = createVision({ x: 0, y: 0 }, 0, walls, 200, 100);

    assert.ok(isPointVisible({ x: 100, y: 0 }, vision, walls));
    assert.ok(!isPointVisible({ x: 100, y: 20 }, vision, walls));
  });

  it('shares enemy visibility when any teammate has a clear cone on the target', () => {
    const leftTeammateVision = createVision({ x: 0, y: 50 }, 0, [], 200, 100);
    const rightTeammateVision = createVision({ x: 200, y: 50 }, Math.PI, [], 200, 100);
    const enemy = { x: 100, y: 50 };

    assert.ok([leftTeammateVision, rightTeammateVision].some((vision) => isPointVisible(enemy, vision, [])));
    assert.ok(!isPointVisible({ x: 40, y: 0 }, leftTeammateVision, []));
  });

  it('reveals explored cells permanently without revealing cells outside teammate cones', () => {
    const cellSize = 10;
    const columns = 20;
    const rows = 10;
    const explored = new Uint8Array(columns * rows);
    const firstVision = createVision({ x: 100, y: 50 }, Math.PI, [], 200, 100, Math.PI / 4);
    const newlyRevealed = revealVisionCells(explored, columns, rows, cellSize, firstVision);
    const rememberedIndex = 5 * columns + 3;

    assert.ok(newlyRevealed.includes(rememberedIndex));
    assert.equal(explored[rememberedIndex], 1);
    assert.equal(explored[5 * columns + 18], 0);

    const secondVision = createVision({ x: 100, y: 50 }, 0, [], 200, 100, Math.PI / 4);
    revealVisionCells(explored, columns, rows, cellSize, secondVision);
    assert.equal(explored[rememberedIndex], 1);
    assert.equal(explored[5 * columns + 18], 1);
  });

  it('reveals partially intersected vision-edge cells without clearing cells behind blockers', () => {
    const cellSize = 5;
    const columns = 30;
    const rows = 20;
    const explored = new Uint8Array(columns * rows);
    const wall = { shape: 'segment', x1: 55, y1: 10, x2: 55, y2: 90 };
    const vision = createVision({ x: 20, y: 50 }, 0.1, [wall], 150, 100);
    const revealed = new Set(revealVisionCells(explored, columns, rows, cellSize, vision));
    let partialEdgeCells = 0;

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const center = { x: (x + 0.5) * cellSize, y: (y + 0.5) * cellSize };
        const cellIndex = y * columns + x;
        const centerVisible = pointInVisionPolygon(center, vision);
        if (centerVisible) assert.ok(revealed.has(cellIndex), 'all fully visible cell centers should be revealed');
        if (!centerVisible && revealed.has(cellIndex)) partialEdgeCells += 1;
      }
    }
    assert.ok(partialEdgeCells > 0, 'cells partially intersecting the cone edge should be cleared');
    assert.equal(explored[10 * columns + 12], 0,
      'a cell wholly behind the wall remains hidden even when adjacent vision cells are discovered');
  });
});
