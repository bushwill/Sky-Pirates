import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decayRenderCorrection, getRenderedPosition, getRenderCorrection } from './RenderCorrection.js';

describe('movement render correction', () => {
  it('preserves displayed continuity while simulation is reconciled to the server', () => {
    const previous = { x: 104, y: 200, renderOffsetX: -1, renderOffsetY: 2 };
    const corrected = { x: 100, y: 198 };
    const offset = getRenderCorrection(previous, corrected);
    assert.deepEqual(offset, { x: 3, y: 4 });
    assert.deepEqual({ x: corrected.x + offset.x, y: corrected.y + offset.y }, getRenderedPosition(previous));
  });

  it('smoothly decays small corrections and snaps only lifecycle-sized errors', () => {
    const first = decayRenderCorrection({ x: 20, y: 0 }, 16);
    assert.ok(first.x < 20 && first.x > 0);
    assert.deepEqual(getRenderCorrection({ x: 500, y: 0 }, { x: 300, y: 0 }), { x: 0, y: 0 });
    assert.deepEqual(getRenderCorrection({ x: 500, y: 0 }, { x: 300, y: 0 }, true), { x: 0, y: 0 });
  });

  it('clears stale render offsets when local control transfers to another actor', () => {
    const previous = { x: 500, y: 300, renderOffsetX: 18, renderOffsetY: -12 };
    const authoritativePosition = { x: 240, y: 180 };
    const offset = getRenderCorrection(previous, authoritativePosition, true);
    const renderedPosition = getRenderedPosition({ ...authoritativePosition, renderOffsetX: offset.x, renderOffsetY: offset.y });

    assert.deepEqual(offset, { x: 0, y: 0 });
    assert.deepEqual(renderedPosition, authoritativePosition);
  });
});
