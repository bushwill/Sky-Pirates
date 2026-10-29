import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPlayerVisibleToViewer } from './PlayerIntelVisibility.js';

const player = { id: 'jammed-player', team: 'red', x: 100, y: 0 };
const teammateVision = {
  origin: { x: 0, y: 0 },
  angle: 0,
  halfAngle: 0.3,
};

function isVisible(overrides = {}) {
  return isPlayerVisibleToViewer({
    player,
    viewerTeam: 'red',
    activePlayerId: 'viewer',
    jammedTeammate: true,
    visions: [],
    visionObjects: [],
    playerRadius: 10,
    ...overrides,
  });
}

describe('jammed teammate visibility', () => {
  it('hides a jammed teammate unless any friendly vision can see them', () => {
    assert.equal(isVisible(), false);
    assert.equal(isVisible({ visions: [teammateVision] }), true);
  });

  it('keeps the jammed teammate hidden when a wall blocks every friendly view', () => {
    assert.equal(isVisible({
      visions: [teammateVision],
      visionObjects: [{
        shape: 'segment',
        x1: 50,
        y1: -30,
        x2: 50,
        y2: 30,
        blocksVision: true,
      }],
    }), false);
  });

  it('continues showing unjammed and locally controlled teammates through global intel', () => {
    assert.equal(isVisible({ jammedTeammate: false }), true);
    assert.equal(isVisible({ activePlayerId: player.id }), true);
  });

  it('hides all teammate positions from a jammed viewer unless local vision sees them', () => {
    assert.equal(isVisible({ jammedTeammate: false, viewerJammed: true }), false);
    assert.equal(isVisible({
      jammedTeammate: false,
      viewerJammed: true,
      visions: [teammateVision],
    }), true);
    assert.equal(isVisible({
      jammedTeammate: false,
      viewerJammed: true,
      activePlayerId: player.id,
    }), true, 'the controlled player remains visible to themselves');
  });
});
