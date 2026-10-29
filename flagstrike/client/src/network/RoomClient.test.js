import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { RoomClient } from './RoomClient.js';

const originalWindow = globalThis.window;
const originalWebSocket = globalThis.WebSocket;

class MockWebSocket {
  static OPEN = 1;

  constructor() {
    this.readyState = MockWebSocket.OPEN;
    this.bufferedAmount = 0;
    this.sent = [];
    this.listeners = new Map();
    MockWebSocket.instance = this;
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }
}

before(() => {
  globalThis.WebSocket = MockWebSocket;
  globalThis.window = {
    location: { protocol: 'http:', host: 'localhost' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
});

after(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.window = originalWindow;
});

describe('RoomClient request queue', () => {
  it('reports outgoing websocket backpressure', () => {
    const client = new RoomClient();
    const socket = MockWebSocket.instance;
    socket.bufferedAmount = 24 * 1024;

    assert.equal(client.getBufferedAmount(), 24 * 1024);
  });

  it('sends UI actions one at a time and dispatches the next after a response', async () => {
    const client = new RoomClient();
    const socket = MockWebSocket.instance;
    const takeover = client.request('bot:takeover', { botId: 'bot-1', takeControl: true });
    const equip = client.request('gadget:select', { gadgetId: 'sonar' });

    assert.equal(socket.sent.length, 1);
    assert.equal(socket.sent[0].type, 'bot:takeover');

    client.handleMessage(JSON.stringify({
      type: 'response',
      requestId: socket.sent[0].requestId,
      ok: true,
      data: { state: { match: { players: [] } } },
    }));
    assert.equal(socket.sent.length, 2);
    assert.equal(socket.sent[1].type, 'gadget:select');

    client.handleMessage(JSON.stringify({
      type: 'response',
      requestId: socket.sent[1].requestId,
      ok: true,
      data: { state: { match: { players: [] } } },
    }));
    await Promise.all([takeover, equip]);
    assert.equal(client.activeRequestId, null);
    assert.equal(client.requestQueue.length, 0);
  });

  it('emits round-trip timing for acknowledged heartbeat samples', () => {
    const client = new RoomClient();
    const samples = [];
    client.on('heartbeat', (sample) => samples.push(sample));
    client.pendingHeartbeatTimes.set(123, performance.now() - 10);

    client.handleMessage(JSON.stringify({ type: 'net:heartbeat', timestamp: 123 }));

    assert.equal(samples.length, 1);
    assert.equal(samples[0].timestamp, 123);
    assert.ok(samples[0].rttMs >= 0);
    assert.equal(client.pendingHeartbeatTimes.has(123), false);
  });
});
