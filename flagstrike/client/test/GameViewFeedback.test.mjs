import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, it } from 'node:test';

// Keep gameplay and snapshot code real; replace only the browser-only Phaser engine.
const phaserStub = 'data:text/javascript,' + encodeURIComponent(`
  export default { Scene: class {}, Game: class {}, Scale: { RESIZE: 0 }, AUTO: 0 };
`);
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'phaser') return { url: ${JSON.stringify(phaserStub)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`));
const { GameView } = await import('../src/game/GameView.js');

function createScene() {
  const sent = [];
  const view = new GameView({}, { send: (...args) => sent.push(args) });
  view.updateRoomState = () => {};
  view.show({}, 'local');
  const scene = view.scene;
  const drawings = [];
  const tweens = [];
  scene.add = {
    graphics() {
      const graphic = { calls: [], destroyed: false };
      for (const name of ['setPosition', 'setDepth', 'lineStyle', 'strokeCircle', 'fillStyle',
        'fillCircle', 'lineBetween', 'clear']) {
        graphic[name] = (...args) => {
          graphic.calls.push([name, ...args]);
          return graphic;
        };
      }
      graphic.destroy = () => { graphic.destroyed = true; };
      drawings.push(graphic);
      return graphic;
    },
  };
  scene.tweens = { add: (tween) => tweens.push(tween), killTweensOf() {} };
  for (const method of ['setMap', 'applyDestructibleObjectState', 'ensureIntelState',
    'syncFlagSoundState', 'playOutcomeSounds', 'updateGadgetHud', 'renderPlayers',
    'publishHud', 'updateMatchHudTimer', 'playReloadSoundEvents', 'showDeathFeedback']) {
    scene[method] = () => {};
  }
  scene.isPlayerVisible = () => false;
  scene.roomState = {
    hostId: 'remote', players: [{ id: 'local', team: 'red' }],
    simulation: { mode: 'host-authoritative', authorityId: 'remote', epoch: 1 },
  };
  return { scene, drawings, tweens, sent };
}

function player(id, extra = {}) {
  return { id, team: 'red', x: 100, y: 100, vx: 0, vy: 0, alive: true, health: 100,
    armor: 0, weaponStats: {}, ...extra };
}

function snapshot(players, extra = {}) {
  return { startedAt: 1_000, gameplayStartsAt: 1_000, players, ...extra };
}

describe('local gameplay feedback', () => {
  it('plays one red expanding burst on local death and cleans it up', () => {
    const { scene, drawings, tweens, sent } = createScene();
    scene.applySnapshot(snapshot([player('local')]));
    const dead = snapshot([player('local', { alive: false, health: 0 })]);
    scene.applySnapshot(dead);
    scene.applySnapshot(dead);
    assert.equal(drawings.length, 1);
    assert.equal(tweens.length, 1);
    assert.ok(drawings[0].calls.some(([name, width, color]) => name === 'lineStyle' && color === 0xff394d));
    assert.equal(drawings[0].calls.filter(([name]) => name === 'lineBetween').length, 8);
    assert.equal(tweens[0].scale, 1.8);
    assert.equal(tweens[0].alpha, 0);
    assert.equal(tweens[0].duration, 450);
    assert.equal(sent.length, 0, 'the burst is not networked');
    tweens[0].onComplete();
    assert.equal(drawings[0].destroyed, true);
    assert.equal(scene.deathFeedbacks.size, 0);
  });

  it('colors the center aim line by the remaining magazine fraction', () => {
    const { scene } = createScene();
    const aimGraphics = {
      calls: [],
      clear() {},
      lineStyle(...args) { this.calls.push(args); return this; },
      lineBetween() { return this; },
    };
    scene.aimGraphics = aimGraphics;
    scene.gadgetAimGraphics = { clear() {} };
    scene.mapObjects = [];
    scene.aimWorldPoint = { x: 200, y: 100 };
    scene.localAimAngle = 0;
    scene.getAimRayEnd = (origin, angle) => ({
      x: origin.x + Math.cos(angle) * 100,
      y: origin.y + Math.sin(angle) * 100,
    });
    const centerLineColor = (ammo) => {
      aimGraphics.calls = [];
      scene.drawAimGuides(player('local', {
        selectedWeaponId: 'assault-rifle',
        weaponStats: { 'assault-rifle': { ammo, effectiveAccuracy: 1 } },
      }));
      return aimGraphics.calls.find(([width]) => width === 2.5)?.[1];
    };

    const fullAmmoColor = centerLineColor(30);
    const halfAmmoColor = centerLineColor(15);
    const lowAmmoColor = centerLineColor(1);

    assert.equal(fullAmmoColor, 0xbaffea);
    assert.equal(halfAmmoColor, 0xffd34a);
    assert.ok(((lowAmmoColor >> 16) & 0xff) > ((lowAmmoColor >> 8) & 0xff),
      'low ammo shifts the center line toward red');
  });

  it('detects a controlled bot death even when the same snapshot releases control', () => {
    const { scene, drawings } = createScene();
    const human = player('local', { alive: false, health: 0 });
    scene.applySnapshot(snapshot([human, player('bot', { isBot: true, controlledById: 'local' })]));
    assert.equal(scene.getActivePlayerId(), 'bot');
    scene.applySnapshot(snapshot([human, player('bot', {
      isBot: true, controlledById: null, alive: false, health: 0,
    })]));
    assert.equal(scene.getActivePlayerId(), 'local');
    assert.equal(drawings.length, 1);
  });

  it('does not burst for others, already-dead join snapshots, or a new match', () => {
    const { scene, drawings } = createScene();
    scene.applySnapshot(snapshot([player('local'), player('ally'),
      player('enemy', { team: 'blue' }), player('bot', { isBot: true, controlledById: 'ally' })]));
    scene.applySnapshot(snapshot([player('local'), player('ally', { alive: false, health: 0 }),
      player('enemy', { team: 'blue', alive: false, health: 0 }),
      player('bot', { isBot: true, controlledById: null, alive: false, health: 0 })]));
    assert.equal(drawings.length, 0);
    scene.applySnapshot(snapshot([player('local', { alive: false, health: 0 })], { startedAt: 2_000 }));
    assert.equal(drawings.length, 0);
  });

  for (const controlBot of [false, true]) {
    it(`plays host-local lethal feedback once for a controlled ${controlBot ? 'bot' : 'human'}`, () => {
      const { scene, drawings, sent } = createScene();
      const victim = player(controlBot ? 'bot' : 'local',
        controlBot ? { isBot: true, controlledById: 'local' } : {});
      scene.players.set(victim.id, victim);
      scene.controlledBotId = controlBot ? victim.id : null;
      scene.match = snapshot([victim]);
      scene.applyHostDamage(victim, 150, 'attacker');
      scene.applyHostDamage(victim, 150, 'attacker');
      assert.equal(victim.alive, false);
      assert.equal(drawings.length, 1);
      assert.equal(sent.length, 0);
      if (controlBot) assert.equal(victim.controlledById, null);
    });
  }

  it('sends, receives, and draws pings in prephase and postphase without exposing enemy pings', () => {
    const { scene, sent } = createScene();
    scene.isActivePlayerJammed = () => false;
    scene.getLocalTeam = () => 'red';
    scene.updateAimPointer = () => { scene.aimWorldPoint = { x: 120, y: 130 }; };
    scene.pingGraphics = scene.add.graphics();
    for (const phase of [
      { gameplayStartsAt: Date.now() + 15_000 },
      { victory: { winner: 'red' }, endsAt: Date.now() - 1 },
    ]) {
      scene.match = snapshot([], phase);
      scene.handlePointerDown({ button: 1 });
      assert.equal(sent.at(-1)[0], 'game:ping');
      const ping = { id: 'ping', team: 'red', x: 120, y: 130, expiresAt: Date.now() + 3_000 };
      scene.applyPing(ping);
      scene.applyPing({ ...ping, id: 'enemy-ping', team: 'blue' });
      scene.drawPings();
      assert.equal(scene.pings.size, 1);
      assert.ok(scene.pingGraphics.calls.some(([name]) => name === 'strokeCircle'));
      scene.pings.set('ping', { ...ping, expiresAt: Date.now() - 1 });
      scene.drawPings();
      assert.equal(scene.pings.size, 0);
    }
  });
});
