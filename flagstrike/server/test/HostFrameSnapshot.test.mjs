import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyHostFrame,
  createHostFrame,
  preserveLiveHostGadgetState,
  preserveLiveHostPlayers,
} from '../../shared/HostFrameSnapshot.js';
import { validateHostFrame } from '../../shared/HostFrameProtocol.js';

function createMatch() {
  return {
    startedAt: 100,
    gameplayStartsAt: 200,
    endsAt: 180_200,
    updatedAt: 300,
    map: { width: 1000, height: 1000, objects: [
      { id: 'wall' },
      { id: 'prop', role: 'destructible-prop', health: 10, maxHealth: 300 },
      { id: 'destroyed-prop', role: 'destructible-prop', health: 0, maxHealth: 300,
        blocksMovement: false, blocksProjectiles: false, blocksVision: false },
    ] },
    players: [{
      id: 'player-1',
      name: 'Player One',
      x: 50,
      y: 70,
      health: 100,
      selectedWeaponId: 'assault-rifle',
      weaponStats: {
        'assault-rifle': { ammo: 29, aimAngle: 0.5 },
        sniper: { ammo: 4, aimAngle: 1.2 },
      },
      lastInputSequence: 3,
      lastWeaponActionSequence: 4,
      botBrain: { secret: true },
    }],
    flag: { x: 80, y: 90, heldBy: null, dropped: false },
    smokes: [],
    gadgetEffects: [
      { id: 'visible-smoke', type: 'smoke', x: 20, y: 30 },
      { id: 'private-mine', type: 'mine', x: 40, y: 50 },
      { id: 'private-vine-trap', type: 'vine-trap', triggerOnEnemyProximity: true, x: 60, y: 70 },
    ],
    victory: null,
    postGame: null,
    quickPlayState: null,
    destructibleObjects: [{ id: 'prop', health: 10 }],
    botNoises: [{ id: 'noise' }],
  };
}

describe('host frame snapshot helpers', () => {
  it('builds a bounded full actor/objective snapshot without private mine intel or AI internals', () => {
    const match = createMatch();
    Object.assign(match.players[0], { isBot: true, armor: 15, maxArmor: 25 });
    const frame = createHostFrame({ match, authorityEpoch: 2, revision: 8, simulationTimeMs: 200 });
    assert.equal(validateHostFrame(frame).valid, true);
    assert.equal(frame.actors[0].state.id, 'player-1');
    assert.equal(frame.actors[0].state.armor, 15);
    assert.equal(frame.actors[0].state.maxArmor, 25);
    assert.equal(frame.actors[0].state.botBrain, undefined);
    assert.deepEqual(Object.keys(frame.actors[0].state.weaponStats), ['assault-rifle']);
    assert.deepEqual(frame.objectives, [{
      id: 'flag', state: { x: 80, y: 90, heldBy: null, dropped: false },
    }]);
    assert.deepEqual(frame.snapshot.gadgetEffects.map((effect) => effect.id), ['visible-smoke']);
    assert.deepEqual(frame.acknowledgements, [{ id: 'player-1', inputSequence: 3, actionSequence: 4 }]);
  });

  it('merges host state while preserving recipient-local map, mine intel, noises, and destructible intel', () => {
    const current = createMatch();
    const frame = createHostFrame({ match: current, authorityEpoch: 2, revision: 8, simulationTimeMs: 200 });
    frame.actors[0].state.x = 500;
    frame.snapshot.gadgetEffects[0].x = 200;
    const merged = applyHostFrame(frame, current);

    assert.equal(merged.players[0].x, 500);
    assert.equal(merged.players[0].weaponStats.sniper.ammo, 4,
      'unselected weapon detail from the recipient snapshot is retained');
    assert.equal(merged.map, current.map);
    assert.equal(merged.gadgetEffects.find((effect) => effect.id === 'visible-smoke').x, 200);
    assert.ok(merged.gadgetEffects.some((effect) => effect.id === 'private-mine'));
    assert.ok(merged.gadgetEffects.some((effect) => effect.id === 'private-vine-trap'));
    assert.equal(merged.botNoises, current.botNoises);
    assert.deepEqual(merged.destructibleObjects, current.destructibleObjects);
  });

  it('preserves live host gadget effects against a stale room-state snapshot', () => {
    const snapshot = { smokes: [], gadgetEffects: [], pendingGadgetEffects: [] };
    const liveMatch = {
      smokes: [{ id: 'smoke-1' }],
      gadgetEffects: [{ id: 'cryo-1' }],
      pendingGadgetEffects: [{ effect: { id: 'molotov-1' }, detonatesAt: 500 }],
    };

    assert.deepEqual(preserveLiveHostGadgetState(snapshot, liveMatch), {
      ...snapshot,
      ...liveMatch,
    });
  });

  it('rejects frames for another match when merging', () => {
    const current = createMatch();
    const frame = createHostFrame({ match: current, authorityEpoch: 2, revision: 8, simulationTimeMs: 200 });
    frame.matchId += 1;
    assert.equal(applyHostFrame(frame, current), null);
  });

  it('keeps live host actor health while accepting server-side takeover changes', () => {
    const snapshotPlayers = [{
      id: 'bot-1',
      name: 'Bot',
      team: 'red',
      isBot: true,
      x: 100,
      y: 120,
      health: 100,
      armor: 0,
      alive: true,
      controlledById: 'player-1',
      controlRevision: 2,
      input: { up: false },
      lastInputSequence: 3,
    }, {
      id: 'bot-2',
      name: 'New Bot',
      team: 'blue',
      isBot: true,
      health: 100,
    }];
    const livePlayers = [{
      ...snapshotPlayers[0],
      x: 220,
      health: 55,
      armor: 20,
      input: { up: true },
      lastInputSequence: 17,
    }];

    const [preserved, added] = preserveLiveHostPlayers(snapshotPlayers, livePlayers);

    assert.equal(preserved.x, 220);
    assert.equal(preserved.health, 55);
    assert.equal(preserved.armor, 20);
    assert.equal(preserved.controlledById, 'player-1');
    assert.equal(preserved.controlRevision, 2);
    assert.equal(preserved.lastInputSequence, 17);
    assert.equal(added.id, 'bot-2');
  });

  it('applies a newer server loadout while preserving live host gameplay state', () => {
    const snapshotPlayers = [{
      id: 'player-1',
      selectedWeaponId: 'shotgun',
      selectedGadgetId: 'unique-gadget',
      loadoutRevision: 2,
      inventory: [{ id: 'armor', level: 1 }],
      weaponStats: { shotgun: { ammo: 6, maxAmmo: 6 } },
      armor: 50,
      maxArmor: 50,
      x: 20,
      health: 100,
    }];
    const livePlayers = [{
      ...snapshotPlayers[0],
      selectedWeaponId: 'assault-rifle',
      selectedGadgetId: 'smoke',
      loadoutRevision: 1,
      inventory: [],
      weaponStats: { 'assault-rifle': { ammo: 20, maxAmmo: 30 } },
      armor: 25,
      maxArmor: 25,
      x: 300,
      health: 60,
    }];

    const [preserved] = preserveLiveHostPlayers(snapshotPlayers, livePlayers);

    assert.equal(preserved.selectedWeaponId, 'shotgun');
    assert.equal(preserved.selectedGadgetId, 'unique-gadget');
    assert.equal(preserved.loadoutRevision, 2);
    assert.deepEqual(preserved.inventory, [{ id: 'armor', level: 1 }]);
    assert.deepEqual(preserved.weaponStats, { shotgun: { ammo: 6, maxAmmo: 6 } });
    assert.equal(preserved.armor, 50);
    assert.equal(preserved.maxArmor, 50);
    assert.equal(preserved.x, 300);
    assert.equal(preserved.health, 60);
  });

  it('does not restore a spent gadget from a stale snapshot with the same loadout revision', () => {
    const snapshotPlayers = [{
      id: 'player-1',
      loadoutRevision: 2,
      selectedGadgetId: 'smoke-grenade',
      gadgetCount: 1,
      gadgetCounts: { 'smoke-grenade': 1 },
      x: 20,
    }];
    const livePlayers = [{
      ...snapshotPlayers[0],
      gadgetCount: 0,
      gadgetCounts: { 'smoke-grenade': 0 },
      x: 40,
    }];

    const [preserved] = preserveLiveHostPlayers(snapshotPlayers, livePlayers);

    assert.equal(preserved.gadgetCount, 0);
    assert.equal(preserved.gadgetCounts['smoke-grenade'], 0);
    assert.equal(preserved.x, 40);
  });

  it('keeps partial prop damage private but relays destroyed collision state', () => {
    const match = createMatch();
    match.destructibleObjects = [
      { id: 'prop', health: 10 },
      { id: 'destroyed-prop', health: 0 },
    ];
    const frame = createHostFrame({ match, authorityEpoch: 2, revision: 8, simulationTimeMs: 200 });
    assert.deepEqual(frame.snapshot.destructibleObjects, [{ id: 'destroyed-prop', health: 0 }]);
    assert.equal(frame.snapshot.map.objects.find((object) => object.id === 'prop').health, 300);
    assert.equal(frame.snapshot.map.objects.find((object) => object.id === 'destroyed-prop').health, 0);

    const recipient = createMatch();
    recipient.destructibleObjects = [{ id: 'prop', health: 80 }];
    const merged = applyHostFrame(frame, recipient);
    assert.deepEqual(merged.destructibleObjects, [
      { id: 'prop', health: 80 },
      { id: 'destroyed-prop', health: 0 },
    ]);
  });

  it('relays visible mine trajectories while keeping mine effect data team-scoped', () => {
    const match = createMatch();
    const frame = createHostFrame({
      match,
      authorityEpoch: 2,
      revision: 8,
      simulationTimeMs: 200,
      events: [
        { id: 'hidden-mine', type: 'gadget', data: { trajectory: {}, smoke: { type: 'mine' } } },
        { id: 'team-mine', type: 'gadget', audienceTeam: 'red', data: { trajectory: {}, smoke: { type: 'mine' } } },
        { id: 'hidden-vine-trap', type: 'gadget',
          data: { trajectory: {}, smoke: { type: 'vine-trap', triggerOnEnemyProximity: true } } },
        { id: 'team-vine-trap', type: 'gadget', audienceTeam: 'blue',
          data: { trajectory: {}, smoke: { type: 'vine-trap', triggerOnEnemyProximity: true } } },
        { id: 'visible-trajectory', type: 'gadget', data: { trajectory: {}, ownerId: 'owner', gadgetId: 'proximity-mine' } },
      ],
    });
    assert.deepEqual(frame.events.map((event) => event.id), [
      'team-mine', 'team-vine-trap', 'visible-trajectory',
    ]);
  });
});
