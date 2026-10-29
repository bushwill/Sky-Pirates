import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { awardKillAndAssists } from '../../shared/CombatAttribution.js';

describe('combat attribution', () => {
  it('credits the lethal attacker and every teammate who damaged the victim', () => {
    const killer = { id: 'molotov-owner', team: 'red' };
    const assister = { id: 'mine-owner', team: 'red' };
    const enemy = { id: 'enemy', team: 'blue' };
    const opponents = { id: 'opponent', team: 'blue' };

    const result = awardKillAndAssists(
      [killer, assister, enemy, opponents],
      enemy,
      killer.id,
      { [killer.id]: 70, [assister.id]: 30, [opponents.id]: 20, spectator: 0 },
    );

    assert.deepEqual(result, { killerId: killer.id, assisterIds: [assister.id] });
    assert.deepEqual(killer.stats, { kills: 1, assists: 0, deaths: 0 });
    assert.deepEqual(assister.stats, { kills: 0, assists: 1, deaths: 0 });
    assert.equal(opponents.stats, undefined);
  });

  it('does not award a kill or assists when the lethal damage has no enemy attacker', () => {
    const assister = { id: 'assister', team: 'red' };
    const enemy = { id: 'enemy', team: 'blue' };

    const result = awardKillAndAssists([assister, enemy], enemy, null, { [assister.id]: 50 });

    assert.deepEqual(result, { killerId: null, assisterIds: [] });
    assert.equal(assister.stats, undefined);
  });
});
