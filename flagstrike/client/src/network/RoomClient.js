const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 4_000;
const HEARTBEAT_TIMEOUT_MS = 12_000;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_BUFFERED_REALTIME_STATE_BYTES = 64 * 1024;
const REALTIME_STATE_TYPES = new Set(['game:input', 'game:bots', 'game:host-frame']);
const MAX_RECONNECT_DELAY_MS = 8_000;
const MAX_RELIABLE_OUTBOX_MESSAGES = 512;
const RELIABLE_OUTBOX_INTERVAL_MS = 25;
const SESSION_TOKEN_KEY = 'flagstrike.session-token';

export class RoomClient {
  constructor() {
    this.listeners = new Map();
    this.pendingRequests = new Map();
    this.requestQueue = [];
    this.activeRequestId = null;
    this.nextRequestId = 1;
    this.retryDelay = 250;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.lastHeartbeatAckAt = 0;
    this.pendingHeartbeatTimes = new Map();
    this.hasConnected = false;
    this.connectionReady = false;
    this.lastSendFailureReason = null;
    this.reliableOutbox = [];
    this.outboxTimer = null;
    this.sessionToken = window.sessionStorage.getItem(SESSION_TOKEN_KEY);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/flagstrike/ws/`;
    this.connect();
  }

  on(eventName, listener) {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return () => listeners.delete(listener);
  }

  emit(eventName, value) {
    for (const listener of this.listeners.get(eventName) ?? []) listener(value);
  }

  connect() {
    this.emit('connection', this.hasConnected ? 'reconnecting' : 'connecting');
    this.connectionReady = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.hasConnected = true;
      this.lastHeartbeatAckAt = Date.now();
      this.startHeartbeat(socket);
      if (this.sessionToken) {
        const resumeSocket = socket;
        this.request('session:resume', { sessionToken: this.sessionToken })
          .then((data) => {
            if (data.sessionToken) this.setSessionToken(data.sessionToken);
            this.markConnectionReady();
            this.emit('sessionResumed', data);
            this.emit('connection', 'connected');
          })
          .catch((error) => {
            if (resumeSocket !== this.socket || resumeSocket.readyState !== WebSocket.OPEN) return;
            if (error.message.toLowerCase().includes('too long to respond')) {
              resumeSocket.close();
              return;
            }
            this.setSessionToken(null);
            this.clearReliableOutbox();
            this.emit('sessionExpired', error.message.includes('session expired')
              ? error.message
              : 'Unable to restore your room session. Please rejoin the room.');
            this.markConnectionReady();
            this.emit('connection', 'connected');
          });
      } else {
        this.markConnectionReady();
        this.emit('connection', 'connected');
      }
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.connectionReady = false;
      this.pendingHeartbeatTimes.clear();
      this.stopHeartbeat();
      this.rejectPendingRequests(new Error('Connection to the server was interrupted.'));
      this.emit('connection', 'reconnecting');
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      this.emit('error', 'Connection interrupted. Reconnecting…');
    });
    socket.addEventListener('message', (event) => {
      if (socket === this.socket) this.handleMessage(event.data);
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(this.retryDelay * jitter);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  startHeartbeat(socket) {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastHeartbeatAckAt > HEARTBEAT_TIMEOUT_MS) {
        socket.close();
        return;
      }
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
      const timestamp = Date.now();
      this.pendingHeartbeatTimes.set(timestamp, performance.now());
      while (this.pendingHeartbeatTimes.size > 8) {
        this.pendingHeartbeatTimes.delete(this.pendingHeartbeatTimes.keys().next().value);
      }
      socket.send(JSON.stringify({ type: 'net:heartbeat', payload: { timestamp } }));
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  markConnectionReady() {
    this.connectionReady = true;
    this.retryDelay = 250;
    this.flushReliableOutbox();
  }

  scheduleOutboxFlush(delay = RELIABLE_OUTBOX_INTERVAL_MS) {
    if (this.outboxTimer !== null || this.reliableOutbox.length === 0) return;
    this.outboxTimer = window.setTimeout(() => {
      this.outboxTimer = null;
      this.flushReliableOutbox();
    }, delay);
  }

  clearReliableOutbox() {
    this.reliableOutbox.length = 0;
    if (this.outboxTimer !== null) window.clearTimeout(this.outboxTimer);
    this.outboxTimer = null;
  }

  flushReliableOutbox() {
    if (this.reliableOutbox.length === 0) return;
    if (!this.connectionReady || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.scheduleOutboxFlush();
      return;
    }
    const entry = this.reliableOutbox.shift();
    try {
      this.socket.send(entry.message);
    } catch {
      this.reliableOutbox.unshift(entry);
      this.scheduleOutboxFlush();
      return;
    }
    this.scheduleOutboxFlush();
  }

  setSessionToken(token) {
    this.sessionToken = typeof token === 'string' && token.length > 0 ? token : null;
    if (this.sessionToken) window.sessionStorage.setItem(SESSION_TOKEN_KEY, this.sessionToken);
    else window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  }

  request(type, payload = {}, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected to the server.'));
    }

    const requestId = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ requestId, type, payload, timeoutMs, resolve, reject });
      this.flushRequestQueue();
    });
  }

  flushRequestQueue() {
    if (this.activeRequestId || this.requestQueue.length === 0 ||
        !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const request = this.requestQueue.shift();
    const timeout = window.setTimeout(() => {
      this.pendingRequests.delete(request.requestId);
      if (this.activeRequestId === request.requestId) this.activeRequestId = null;
      request.reject(new Error('The server took too long to respond. Please try again.'));
      this.flushRequestQueue();
    }, request.timeoutMs);
    this.activeRequestId = request.requestId;
    this.pendingRequests.set(request.requestId, { ...request, timeout });
    try {
      this.socket.send(JSON.stringify({
        requestId: request.requestId,
        type: request.type,
        payload: request.payload,
      }));
    } catch (error) {
      window.clearTimeout(timeout);
      this.pendingRequests.delete(request.requestId);
      this.activeRequestId = null;
      request.reject(error instanceof Error ? error : new Error('Unable to send request.'));
      this.flushRequestQueue();
    }
  }

  getBufferedAmount() {
    return this.socket?.bufferedAmount ?? 0;
  }

  send(type, payload = {}) {
    this.lastSendFailureReason = null;
    if (type === 'game:intel:reveal') {
      if (!payload || typeof payload.matchId !== 'number') return false;
      if (this.reliableOutbox.some((entry) => entry.matchId !== payload.matchId)) {
        this.reliableOutbox = this.reliableOutbox.filter((entry) => entry.matchId === payload.matchId);
      }
      if (this.reliableOutbox.length >= MAX_RELIABLE_OUTBOX_MESSAGES) return false;
      this.reliableOutbox.push({ matchId: payload.matchId, message: JSON.stringify({ type, payload }) });
      this.flushReliableOutbox();
      this.scheduleOutboxFlush(0);
      return true;
    }
    const isRealtimeState = REALTIME_STATE_TYPES.has(type);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.lastSendFailureReason = 'socket-not-open';
      return false;
    }
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES ||
        (isRealtimeState && this.socket.bufferedAmount > MAX_BUFFERED_REALTIME_STATE_BYTES)) {
      this.lastSendFailureReason = 'backpressure';
      return false;
    }
    try {
      this.socket.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      this.lastSendFailureReason = 'socket-send-failed';
      return false;
    }
  }

  handleMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.emit('error', 'The server sent an unreadable response.');
      return;
    }

    if (message.type === 'net:heartbeat') {
      this.lastHeartbeatAckAt = Date.now();
      const sentAt = this.pendingHeartbeatTimes.get(message.timestamp);
      if (Number.isFinite(sentAt)) {
        this.pendingHeartbeatTimes.delete(message.timestamp);
        this.emit('heartbeat', {
          timestamp: message.timestamp,
          rttMs: Math.max(0, performance.now() - sentAt),
        });
      }
      return;
    }

    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.requestId);
      if (this.activeRequestId === message.requestId) this.activeRequestId = null;
      if (message.ok) {
        if (message.data?.sessionToken) this.setSessionToken(message.data.sessionToken);
        pending.resolve(message.data);
      } else {
        pending.reject(new Error(message.error || 'The request could not be completed.'));
      }
      this.flushRequestQueue();
      return;
    }

    if (message.type === 'rooms:updated') this.emit('rooms', message.rooms);
    else if (message.type === 'room:state') this.emit('roomState', message.state);
    else if (message.type === 'game:state') this.emit('gameState', message.state);
    else if (message.type === 'game:authority-input') this.emit('authorityInput', message.input);
    else if (message.type === 'game:authority-action') this.emit('authorityAction', message.action);
    else if (message.type === 'game:authority-bots') this.emit('authorityBots', message);
    else if (message.type === 'game:host-frame') this.emit('hostFrame', message.frame);
    else if (message.type === 'game:projectile') this.emit('projectile', message.projectile);
    else if (message.type === 'game:gadget-used') this.emit('gadgetUsed', message.event);
    else if (message.type === 'game:audio-cue') this.emit('audioCue', message.cue);
    else if (message.type === 'game:damage-cue') this.emit('damageCue', message.cue);
    else if (message.type === 'game:ping') this.emit('gamePing', message.ping);
    else if (message.type === 'game:intel') this.emit('gameIntel', message);
    else if (message.type === 'game:team-mines') this.emit('teamMines', message);
    else if (message.type === 'game:team-walls') this.emit('teamWalls', message);
    else if (message.type === 'game:corpses') this.emit('gameCorpses', message);
    else if (message.type === 'room:postgame-expired') this.emit('postGameExpired', message.message);
    else if (message.type === 'server:error') this.emit('error', message.message);
  }

  rejectPendingRequests(error) {
    for (const [requestId, pending] of this.pendingRequests) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(requestId);
    }
    this.activeRequestId = null;
    for (const request of this.requestQueue.splice(0)) request.reject(error);
  }
}