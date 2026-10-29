import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { RoomManager } from '../RoomManager.mjs';
import { createHostFrame } from '../../shared/HostFrameSnapshot.js';

const fixtureMap = {
  seed: 17,
  generatorVersion: 1,
  width: 1_500,
  height: 1_000,
  mapOptions: { minRooms: 1, maxRooms: 1 },
  rooms: [],
  objects: [],
  spawnZones: {
    red: { x: 0, y: 0, width: 200, height: 200 },
    blue: { x: 1_300, y: 800, width: 200, height: 200 },
  },
};

describe('data-only runtime authority', () => {
  it('stores host-authored gameplay frames as the live match source without resolving them', async () => {
    let now = 10_000;
    const manager = new RoomManager({ simulationMode: 'host-authoritative', now: () => now, randomTeam: () => 0 });
    const host = { id: 'host-1', room: null };
    await manager.createAndJoin(host, { name: 'Opaque Host Match', displayName: 'Host' });
    manager.acceptHostMap(host, { map: fixtureMap, generationRevision: host.room.mapGenerationRevision });
    const state = manager.startMatch(host);
    const metadata = state.match;
    const match = {
      ...metadata,
      players: metadata.players.map((player) => ({
        ...player, x: 123, y: 234, vx: 0, vy: 0, health: 73, alive: true,
        weaponStats: { 'assault-rifle': { ammo: 8, aimAngle: 0.5 } },
      })),
      flag: { x: 456, y: 321, heldBy: null, dropped: false, lastDroppedBy: null },
      smokes: [],
      gadgetEffects: [],
      victory: { winner: 'red', reason: 'capture', at: now },
      postGame: { endsAt: now + 15_000, choices: {} },
      quickPlayState: null,
      destructibleObjects: [],
    };
    const frame = createHostFrame({
      match,
      authorityEpoch: state.simulation.epoch,
      revision: 1,
      simulationTimeMs: now - match.startedAt,
    });

    assert.equal(manager.acceptHostFrame(host, frame).accepted, true);
    const live = manager.toRoomState(host.room).match;
    assert.equal(live.players[0].x, 123);
    assert.equal(live.players[0].health, 73);
    assert.deepEqual(live.victory, match.victory);
    assert.deepEqual(live.flag, match.flag);
    assert.equal(host.room.latestHostFrame.revision, 1);
    now += 50;
  });

  it('does not expose team-private cues through persisted room-state frames', async () => {
    const manager = new RoomManager({ simulationMode: 'host-authoritative' });
    const host = { id: 'private-frame-host', room: null };
    await manager.createAndJoin(host, { name: 'Private Frame Events' });
    manager.acceptHostMap(host, { map: fixtureMap, generationRevision: host.room.mapGenerationRevision });
    const state = manager.startMatch(host);
    const match = {
      ...state.match,
      flag: { x: 1_400, y: 900, heldBy: null, dropped: false, lastDroppedBy: null },
      players: state.match.players.map((player) => ({
        ...player, x: 150, y: 150, vx: 0, vy: 0, health: 100, alive: true,
      })),
    };
    const frame = createHostFrame({
      match,
      authorityEpoch: state.simulation.epoch,
      revision: 1,
      simulationTimeMs: 0,
      events: [
        { id: 'public-projectile', type: 'projectile', data: { id: 'shot' } },
        { id: 'private-damage', type: 'damage-cue', audienceTeam: 'blue', data: { id: 'cue' } },
      ],
    });
    manager.acceptHostFrame(host, frame);
    assert.deepEqual(host.room.latestHostFrame.events.map((event) => event.id), ['public-projectile']);
    assert.deepEqual(manager.toRoomState(host.room).authorityFrame.events.map((event) => event.id), ['public-projectile']);
  });

  it('preserves host-authoritative pregame shop purchases across stale frames', async () => {
    let now = 20_000;
    const manager = new RoomManager({ simulationMode: 'host-authoritative', now: () => now, random: () => 0 });
    const host = { id: 'shop-host', room: null };
    manager.longPlay(host, { displayName: 'Shop Host' });
    const room = host.room;
    manager.acceptHostMap(host, {
      map: fixtureMap,
      quickPlay: true,
      generationRevision: room.mapGenerationRevision,
    });
    const started = manager.setQuickPlayReady(host, { ready: true });
    assert.equal(started.started, true);
    const beforePurchase = manager.toRoomState(room).match;
    beforePurchase.players = beforePurchase.players.map((player, index) => ({
      ...player, x: 120 + index * 30, y: 140, vx: 0, vy: 0,
    }));
    beforePurchase.flag = {
      x: fixtureMap.spawnZones.blue.x + fixtureMap.spawnZones.blue.width / 2,
      y: fixtureMap.spawnZones.blue.y + fixtureMap.spawnZones.blue.height / 2,
      heldBy: null,
      dropped: false,
      lastDroppedBy: null,
    };
    const staleFrame = createHostFrame({
      match: beforePurchase,
      authorityEpoch: room.authorityEpoch,
      revision: 1,
      simulationTimeMs: 0,
    });
    assert.equal(manager.acceptHostFrame(host, staleFrame).accepted, true);

    const player = room.match.players.find((entry) => entry.id === host.id);
    const weaponId = player.weaponShopOfferIds[0];
    manager.selectWeapon(host, { weaponId });
    const item = player.itemShopOfferIds[0];
    manager.selectShopItem(host, { itemId: item.id, level: item.level, kind: item.kind });
    assert.equal(player.shopPicksRemaining, 0);
    const loadoutRevision = player.loadoutRevision;

    now = room.match.gameplayStartsAt + 1;
    const nextStaleFrame = {
      ...staleFrame,
      revision: 2,
      tick: 2,
      simulationTimeMs: room.match.gameplayStartsAt - room.match.startedAt + 1,
    };
    const accepted = manager.acceptHostFrame(host, nextStaleFrame);
    assert.equal(accepted.accepted, true);
    assert.equal(
      accepted.actors.find((actor) => actor.id === host.id).state.loadoutRevision,
      loadoutRevision,
    );
    const livePlayer = manager.toRoomState(room).match.players.find((entry) => entry.id === host.id);
    assert.equal(livePlayer.selectedWeaponId, weaponId);
    assert.deepEqual(livePlayer.inventory, host.inventory);
    assert.equal(livePlayer.shopPicksRemaining, 0);
    assert.equal(livePlayer.weaponShopResolved, true);
    now += 50;
  });

  it('preserves a unique gadget equip when a stale host frame arrives after countdown', async () => {
    let now = 25_000;
    const manager = new RoomManager({
      simulationMode: 'host-authoritative',
      now: () => now,
      random: () => 0,
    });
    const host = { id: 'unique-shop-host', room: null };
    await manager.createAndJoin(host, { name: 'Unique Gadget Shop' });
    manager.acceptHostMap(host, {
      map: fixtureMap,
      generationRevision: host.room.mapGenerationRevision,
    });
    const started = manager.startMatch(host);
    const room = host.room;
    const frameMatch = {
      ...started.match,
      players: started.match.players.map((player, index) => ({
        ...player,
        x: 120 + index * 30,
        y: 140,
        vx: 0,
        vy: 0,
      })),
    };
    const staleFrame = createHostFrame({
      match: frameMatch,
      authorityEpoch: room.authorityEpoch,
      revision: 1,
      simulationTimeMs: 0,
    });
    assert.equal(manager.acceptHostFrame(host, staleFrame).accepted, true);

    const player = room.match.players.find((entry) => entry.id === host.id);
    const gadgetId = host.uniqueGadgetShopOfferIds[0];
    assert.ok(gadgetId, 'the deterministic shop should offer a unique gadget');
    manager.selectGadget(host, { gadgetId });
    const loadoutRevision = player.loadoutRevision;

    now = room.match.gameplayStartsAt + 1;
    const lateStaleFrame = {
      ...staleFrame,
      revision: 2,
      tick: 2,
      simulationTimeMs: room.match.gameplayStartsAt - room.match.startedAt + 1,
    };
    const accepted = manager.acceptHostFrame(host, lateStaleFrame);
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.actors.find((actor) => actor.id === host.id).state.selectedGadgetId, gadgetId);
    assert.equal(accepted.actors.find((actor) => actor.id === host.id).state.loadoutRevision, loadoutRevision);
    assert.equal(manager.toRoomState(room).match.players.find((entry) => entry.id === host.id).selectedGadgetId, gadgetId);
  });

  it('does not offer or accept armor and perk purchases during custom and Practice countdowns', async () => {
    let now = 30_000;
    const manager = new RoomManager({ simulationMode: 'host-authoritative', now: () => now, random: () => 0 });

    const customHost = { id: 'custom-item-host', room: null };
    await manager.createAndJoin(customHost, { name: 'Custom Item Phase' });
    manager.acceptHostMap(customHost, {
      map: fixtureMap,
      generationRevision: customHost.room.mapGenerationRevision,
    });
    manager.startMatch(customHost);

    const quickHost = { id: 'quick-item-host', room: null };
    manager.quickPlay(quickHost, { displayName: 'Quick Item Host' });
    manager.acceptHostMap(quickHost, {
      map: fixtureMap,
      quickPlay: true,
      generationRevision: quickHost.room.mapGenerationRevision,
    });
    manager.setQuickPlayReady(quickHost, { ready: true });

    for (const host of [customHost, quickHost]) {
      const player = host.room.match.players.find((entry) => entry.id === host.id);
      assert.deepEqual(player.itemShopOfferIds, []);
      assert.equal(player.shopPicksRemaining, 0);
      assert.equal(player.itemShopResolved, true);
      assert.throws(() => manager.selectShopItem(host, {
        itemId: 'armor', level: 1, kind: 'armor',
      }), /only available in Quick Play or Long Play/);
    }
    now += 50;
  });

  it('keeps the deployed WebSocket routes and ticker free of server gameplay calculations', async () => {
    const runtime = await readFile(new URL('../server.js', import.meta.url), 'utf8');
    for (const forbidden of [
      'roomManager.advanceGames(',
      'roomManager.fireProjectile(',
      'roomManager.applyGadgetAction(',
      'roomManager.updateGameInput(',
      'roomManager.updateGameAim(',
      'roomManager.applyBotCommands(',
      'roomManager.revealTeamIntel(',
    ]) assert.equal(runtime.includes(forbidden), false, `runtime must not call ${forbidden}`);
    assert.match(runtime, /new RoomManager\(\{ simulationMode: 'host-authoritative' \}\)/);
    assert.match(runtime, /roomManager\.acceptHostFrame\(client, payload\)/);
    assert.doesNotMatch(runtime, /validateOwnerMovementUpdate|MAX_PLAYER_SPEED|PLAYER_RADIUS/,
      'movement payloads are routed without server-side gameplay validation');
    assert.match(runtime, /type: 'game:authority-input'/,
      'owner movement state is forwarded to the elected host client');
    assert.doesNotMatch(runtime, /game:player-state|authority-player-motion/,
      'owner movement uses one sequenced state route, not a second pose stream');
  });
});
