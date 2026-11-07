import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager, RoomManagerError } from './RoomManager.mjs';
import { MatchReportStore } from './MatchReportStore.mjs';
import {
  createAllowedOriginSet,
  getClientIp,
  IpRateLimiter,
  isAllowedWebSocketOrigin,
} from './WebSocketProtection.mjs';
import { MAX_HOST_FRAME_BYTES } from '../shared/HostFrameProtocol.js';
import { isPlayerJammed } from '../shared/GadgetModel.js';

function getPositiveIntegerEnvironmentVariable(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const port = Number(process.env.PORT ?? 3000);
const MAX_WEBSOCKET_CLIENTS = getPositiveIntegerEnvironmentVariable('FLAGSTRIKE_MAX_WEBSOCKET_CLIENTS', 128);
const MAX_WEBSOCKET_CLIENTS_PER_IP = getPositiveIntegerEnvironmentVariable('FLAGSTRIKE_MAX_WEBSOCKET_CLIENTS_PER_IP', 16);
const roomManager = new RoomManager({ simulationMode: 'host-authoritative' });
const matchReportStore = new MatchReportStore();
const disconnectedClients = new Set();
const allowedWebSocketOrigins = createAllowedOriginSet();
const activeConnectionsByIp = new Map();
const requestRateLimiter = new IpRateLimiter(120, 60_000);
const roomAllocationRateLimiter = new IpRateLimiter(20, 10 * 60_000);
const ROOM_ALLOCATION_REQUEST_TYPES = new Set([
  'room:create', 'series:private:create', 'quickplay:join', 'longplay:join', 'longseries:join',
]);
const MATCH_SCOPED_GAMEPLAY_TYPES = new Set([
  'game:input', 'game:bots', 'game:aim', 'game:fire', 'game:reload', 'game:gadget',
  'game:host-frame', 'game:intel:reveal', 'game:corpse:discover', 'game:ping',
  'game:intel:mines', 'game:intel:walls',
]);
const server = createServer((request, response) => {
  if (request.url === '/api/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', app: 'flagstrike' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not found' }));
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_HOST_FRAME_BYTES + 16 * 1024 });

function send(socket, message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function rejectWebSocketUpgrade(socket, status, reason, message) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n` +
    'Connection: close\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

server.on('upgrade', (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    rejectWebSocketUpgrade(socket, 400, 'Bad Request', 'Invalid WebSocket request.');
    return;
  }
  if (pathname !== '/ws/') {
    rejectWebSocketUpgrade(socket, 404, 'Not Found', 'Not found.');
    return;
  }

  const clientIp = getClientIp(request);
  if (!isAllowedWebSocketOrigin(request.headers.origin, allowedWebSocketOrigins)) {
    rejectWebSocketUpgrade(socket, 403, 'Forbidden', 'WebSocket origin is not allowed.');
    return;
  }
  if (webSockets.clients.size >= MAX_WEBSOCKET_CLIENTS) {
    rejectWebSocketUpgrade(socket, 503, 'Service Unavailable', 'The server is at capacity.');
    return;
  }
  if ((activeConnectionsByIp.get(clientIp) ?? 0) >= MAX_WEBSOCKET_CLIENTS_PER_IP) {
    rejectWebSocketUpgrade(socket, 429, 'Too Many Requests', 'Too many connections from this address.');
    return;
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.clientIp = clientIp;
    activeConnectionsByIp.set(clientIp, (activeConnectionsByIp.get(clientIp) ?? 0) + 1);
    webSockets.emit('connection', webSocket, request);
  });
});

function logHostFrameRejection(client, reason, payload) {
  if (Date.now() - (client.lastHostFrameRejectionAt ?? 0) < 1_000) return;
  client.lastHostFrameRejectionAt = Date.now();
  console.error('[host-frame] rejected by server', {
    reason,
    revision: payload?.revision ?? null,
    actors: payload?.actors?.length ?? null,
    matchId: payload?.matchId ?? null,
    roomMatchId: client.room?.match?.startedAt ?? null,
    authorityEpoch: payload?.authorityEpoch ?? null,
    roomAuthorityEpoch: client.room?.authorityEpoch ?? null,
  });
}

function isClientJammed(client, now = Date.now()) {
  const room = client.room;
  if (!room) return false;
  const framePlayers = room.latestHostFrame?.matchId === room.match?.startedAt
    ? room.latestHostFrame.actors.map(({ id, state }) => ({ ...state, id }))
    : [];
  const player = framePlayers.find((entry) => entry.id === client.id) ??
    framePlayers.find((entry) => entry.controlledById === client.id) ??
    room.match?.players.find((entry) => entry.id === client.id) ??
    room.match?.players.find((entry) => entry.controlledById === client.id);
  return isPlayerJammed(player, now);
}

function publishRooms() {
  const message = JSON.stringify({ type: 'rooms:updated', rooms: roomManager.listRooms() });
  for (const socket of webSockets.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function sendRoomUpdate(room) {
  if (!room) return;
  const message = { type: 'room:state', state: roomManager.toRoomState(room) };
  for (const client of room.clients) send(client.socket, message);
}

function processDeparture(departure) {
  if (!departure) return;
  if (departure.room) sendRoomUpdate(departure.room);
  publishRooms();
}

function routeGameplayMessage(client, message) {
  const { type, payload } = message;
  if (!client.room) return;
  const room = client.room;
  if (MATCH_SCOPED_GAMEPLAY_TYPES.has(type) && payload.matchId !== room.match?.startedAt) {
    if (type === 'game:host-frame') logHostFrameRejection(client, 'match-id-mismatch', payload);
    return;
  }
  try {
    if (type === 'game:host-frame') {
      if (Date.now() - (client.lastHostFrameAt ?? 0) < 20) {
        logHostFrameRejection(client, 'rate-limited', payload);
        return;
      }
      client.lastHostFrameAt = Date.now();
      const result = roomManager.acceptHostFrame(client, payload);
      if (!result.accepted) {
        logHostFrameRejection(client, result.reason ?? 'not-accepted', payload);
        return;
      }
      for (const member of room.clients) {
        if (member.id === client.id || member.connected === false || member.socket?.readyState !== WebSocket.OPEN) continue;
        if (member.socket.bufferedAmount >= 32 * 1024) continue;
        const memberJammed = isClientJammed(member);
        const events = payload.events.filter((event) => {
          const personalAudioCue = event.type === 'audio-cue' &&
            (event.data?.heardById === member.id || payload.actors.some((actor) =>
              actor.id === event.data?.heardById && actor.state.controlledById === member.id));
          const personalDamageCue = event.type === 'damage-cue' &&
            (event.data?.victimId === member.id || payload.actors.some((actor) =>
              actor.id === event.data?.victimId && actor.state.controlledById === member.id));
          const isPersonalCue = event.audiencePlayerId === member.id &&
            (personalAudioCue || personalDamageCue);
          return (!event.audienceTeam || event.audienceTeam === member.team) &&
            (!event.audiencePlayerId || event.audiencePlayerId === member.id) &&
            !(memberJammed && ['audio-cue', 'damage-cue'].includes(event.type) && !isPersonalCue);
        });
        member.socket.send(JSON.stringify({
          type: 'game:host-frame',
          frame: { ...payload, actors: result.actors, events },
        }));
      }
      if (result.quickPlayResultChanged) {
        sendRoomUpdate(room);
        publishRooms();
      } else if (result.matchLifecycleChanged) {
        sendRoomUpdate(room);
        publishRooms();
      }
      return;
    }
    if (type === 'game:map-ready') {
      const result = roomManager.acceptHostMap(client, payload);
      if (!result.accepted) return;
      sendRoomUpdate(room);
      publishRooms();
      return;
    }
    if (type === 'game:map-progress') {
      if (roomManager.updateHostMapGenerationProgress(client, payload)) sendRoomUpdate(room);
      return;
    }
    const host = [...room.clients].find((member) => member.id === room.hostId && member.connected !== false);
    if (!host || payload.matchId !== room.match?.startedAt) return;
    const interval = type === 'game:input' || type === 'game:bots' ? 20 : 30;
    const rateKey = type === 'game:intel:mines'
      ? `lastRelay:${type}:${payload.team}`
      : `lastRelay:${type}`;
    if (Date.now() - (client[rateKey] ?? 0) < interval) return;
    client[rateKey] = Date.now();
    if (type === 'game:input') {
      if (host.socket.bufferedAmount >= 64 * 1024) return;
      send(host.socket, { type: 'game:authority-input', input: { ...payload, playerId: client.id, sourceClientId: client.id } });
      return;
    }
    if (type === 'game:bots') {
      if (host.socket.bufferedAmount >= 64 * 1024) return;
      send(host.socket, {
        type: 'game:authority-bots',
        commands: payload.commands,
        matchId: payload.matchId,
        sourceClientId: client.id,
      });
      return;
    }
    if (['game:aim', 'game:fire', 'game:reload', 'game:gadget'].includes(type)) {
      if (client.id !== room.hostId) {
        send(host.socket, { type: 'game:authority-action', action: { ...payload, type, actorId: client.id } });
      }
      return;
    }
    if (type === 'game:intel:mines') {
      if (client.id !== room.hostId || !['red', 'blue'].includes(payload.team) ||
          !Array.isArray(payload.mines) || payload.mines.length > 64 || payload.mines.some((mine) =>
            !mine || typeof mine.id !== 'string' || !Number.isFinite(mine.x) || !Number.isFinite(mine.y) ||
            mine.team !== 'red' && mine.team !== 'blue')) return;
      const packet = JSON.stringify({ type: 'game:team-mines', matchId: payload.matchId,
        team: payload.team, mines: payload.mines });
      for (const member of room.clients) {
        if (member.team === payload.team && !isClientJammed(member) &&
            member.connected !== false && member.socket?.readyState === WebSocket.OPEN &&
            member.socket.bufferedAmount < 64 * 1024) member.socket.send(packet);
      }
      return;
    }
    if (type === 'game:intel:walls') {
      if (isClientJammed(client)) return;
      if (!Array.isArray(payload.walls) || payload.walls.length > 256 ||
          payload.walls.some((wall) => !wall || typeof wall.id !== 'string' ||
            wall.id.length > 192 || wall.shape !== 'segment' ||
            ![wall.x1, wall.y1, wall.x2, wall.y2].every(Number.isFinite))) return;
      const packet = JSON.stringify({
        type: 'game:team-walls',
        matchId: payload.matchId,
        team: client.team,
        walls: payload.walls,
      });
      for (const member of room.clients) {
        if (member !== client && member.team === client.team && !isClientJammed(member) &&
            member.connected !== false &&
            member.socket?.readyState === WebSocket.OPEN && member.socket.bufferedAmount < 64 * 1024) {
          member.socket.send(packet);
        }
      }
      return;
    }
    // Team-private exploration is relayed, never calculated or retained here.
    if (type === 'game:intel:reveal') {
      if (isClientJammed(client)) return;
      const packet = JSON.stringify({ type: 'game:intel', team: client.team, spans: payload.spans ?? [] });
      for (const member of room.clients) {
        if (member !== client && member.team === client.team && !isClientJammed(member) &&
            member.connected !== false &&
            member.socket?.readyState === WebSocket.OPEN && member.socket.bufferedAmount < 64 * 1024) member.socket.send(packet);
      }
      return;
    }
    if (type === 'game:corpse:discover') {
      if (isClientJammed(client)) return;
      if (typeof payload.playerId !== 'string') return;
      const packet = JSON.stringify({ type: 'game:corpses', team: client.team, ids: [payload.playerId] });
      for (const member of room.clients) {
        if (member !== client && member.team === client.team && !isClientJammed(member) &&
            member.connected !== false && member.socket?.readyState === WebSocket.OPEN) member.socket.send(packet);
      }
      return;
    }
    if (type === 'game:ping') {
      if (isClientJammed(client)) return;
      if (Date.now() - (client.lastPingAt ?? 0) < 500 ||
          !Number.isFinite(payload.x) || !Number.isFinite(payload.y) ||
          payload.x < 0 || payload.y < 0 || payload.x > room.match.map.width || payload.y > room.match.map.height) return;
      client.lastPingAt = Date.now();
      const ping = {
        id: `${client.id}:${client.lastPingAt}`,
        team: client.team,
        x: payload.x,
        y: payload.y,
        expiresAt: client.lastPingAt + 2_500,
      };
      const packet = JSON.stringify({ type: 'game:ping', ping });
      for (const member of room.clients) {
        if (member.team === client.team && !isClientJammed(member) && member.connected !== false &&
            member.socket?.readyState === WebSocket.OPEN && member.socket.bufferedAmount < 64 * 1024) {
          member.socket.send(packet);
        }
      }
      return;
    }
    send(client.socket, { type: 'server:error', message: 'Unknown gameplay message.' });
  } catch (error) {
    if (type === 'game:host-frame') {
      logHostFrameRejection(client, error instanceof Error ? error.message : 'unknown error', payload);
    }
    send(client.socket, {
      type: 'server:error',
      message: error instanceof Error ? error.message : 'The gameplay message could not be routed.',
    });
  }
}

async function handleRequest(client, message) {
  const { socket } = client;
  const { requestId, type, payload = {} } = message;

  try {
    let data;
    switch (type) {
      case 'rooms:list':
        data = { rooms: roomManager.listRooms() };
        break;
      case 'room:create':
        data = await roomManager.createAndJoin(client, payload);
        {
          const createdRoom = client.room;
          void createdRoom.customMapPromise?.then(() => {
            if (roomManager.rooms.get(createdRoom.key) === createdRoom) {
              sendRoomUpdate(createdRoom);
              publishRooms();
            }
          });
        }
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'series:private:create':
        data = await roomManager.createPrivateSeries(client, payload);
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'room:join':
        data = await roomManager.join(client, payload);
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'room:details':
        data = { state: await roomManager.setRoomDetails(client, payload) };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      case 'quickplay:join':
        data = roomManager.quickPlay(client, payload);
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'longplay:join':
        data = roomManager.longPlay(client, payload);
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'longseries:join':
        data = roomManager.longSeries(client, payload);
        processDeparture(data.departure);
        publishRooms();
        sendRoomUpdate(client.room);
        break;
      case 'quickplay:ready':
      case 'longplay:ready':
      case 'longseries:ready':
        data = roomManager.setQuickPlayReady(client, payload);
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      case 'team:set':
        data = { state: roomManager.setPlayerTeam(client, payload) };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      case 'bots:set':
        data = { state: roomManager.setBotTeam(client, payload) };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      case 'room:custom-rules':
        data = { state: roomManager.setCustomGameRules(client, payload.rules) };
        sendRoomUpdate(client.room);
        break;
      case 'custom-series:approve-teams':
        data = { state: roomManager.approveCustomTeamShuffle(client) };
        sendRoomUpdate(client.room);
        break;
      case 'custom-series:end':
        data = { state: roomManager.endCustomSeries(client) };
        sendRoomUpdate(client.room);
        break;
      case 'bot:takeover':
        data = { state: roomManager.setBotController(client, payload) };
        sendRoomUpdate(client.room);
        break;
      case 'weapon:select':
        data = { state: roomManager.selectWeapon(client, payload) };
        sendRoomUpdate(client.room);
        break;
      case 'weapon:skip':
        data = { state: roomManager.skipWeaponShop(client) };
        sendRoomUpdate(client.room);
        break;
      case 'gadget:select':
        data = { state: roomManager.selectGadget(client, payload) };
        sendRoomUpdate(client.room);
        break;
      case 'item:select':
        data = { state: roomManager.selectShopItem(client, payload) };
        sendRoomUpdate(client.room);
        break;
      case 'map:seed':
        data = { state: roomManager.setMapSeed(client, payload) };
        sendRoomUpdate(client.room);
        {
          const room = client.room;
          void room.customMapPromise?.then(() => {
            if (roomManager.rooms.get(room.key) === room) {
              sendRoomUpdate(room);
              publishRooms();
            }
          });
        }
        break;
      case 'map:competitive': {
        const generation = roomManager.beginCompetitiveMapGeneration(client);
        data = { state: generation.state };
        sendRoomUpdate(client.room);
        const room = client.room;
        void generation.promise.then(() => {
          if (roomManager.rooms.get(room.key) === room) {
            sendRoomUpdate(room);
            publishRooms();
          }
        }).catch(() => {
          if (roomManager.rooms.get(room.key) === room) sendRoomUpdate(room);
        });
        break;
      }
      case 'session:resume': {
        const resumed = roomManager.resumeSession(client, payload.sessionToken);
        if (!resumed) throw new RoomManagerError('Your room session expired. Rejoin the room to continue.');
        disconnectedClients.delete(resumed.replacedClient);
        data = { state: resumed.state, playerId: resumed.playerId, sessionToken: resumed.sessionToken };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      }
      case 'room:leave': {
        const departure = roomManager.leave(client);
        data = { roomName: departure?.roomName ?? null };
        processDeparture(departure);
        break;
      }
      case 'match:start': {
        const room = client.room;
        if (room?.simulationMode !== 'host-authoritative' && room?.mapGenerationPending && room.hostId === client.id) {
          roomManager.requestCustomMapFallback(room);
        }
        if (room?.customMapPromise && room.hostId === client.id) await room.customMapPromise;
        data = { state: roomManager.startMatch(client) };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      }
      case 'match:report': {
        const room = client.room;
        const report = payload.report;
        if (!room || client.id !== room.hostId) {
          throw new RoomManagerError('Only the current match host can submit a report.');
        }
        if (!room.match || room.match.startedAt !== report?.matchId || !room.match.victory) {
          throw new RoomManagerError('A report can only be stored after its match result is final.');
        }
        if (report.result?.victory?.winner !== room.match.victory.winner ||
            report.result?.victory?.reason !== room.match.victory.reason) {
          throw new RoomManagerError('The report result does not match the final match result.');
        }
        data = await matchReportStore.record({
          roomKey: room.key,
          hostId: client.id,
          report,
        });
        break;
      }
      case 'match:client-report': {
        const room = client.room;
        const diagnostics = payload.diagnostics;
        if (!room || !room.clients.has(client) || diagnostics?.playerId !== client.id) {
          throw new RoomManagerError('Client diagnostics must be submitted by the reporting room member.');
        }
        if (!room.match || room.match.startedAt !== diagnostics?.matchId || !room.match.victory) {
          throw new RoomManagerError('Client diagnostics can only be stored after the match result is final.');
        }
        data = await matchReportStore.recordClientDiagnostics({
          roomKey: room.key,
          matchId: diagnostics.matchId,
          playerId: client.id,
          diagnostics,
        });
        break;
      }
      case 'match:finish':
        data = { state: roomManager.finishMatch(client) };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      case 'postgame:stay':
        data = { state: roomManager.choosePostGame(client, 'stay') };
        sendRoomUpdate(client.room);
        publishRooms();
        break;
      default:
        throw new RoomManagerError('Unknown room action.');
    }

    send(socket, { type: 'response', requestId, ok: true, data });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'The request could not be completed.';
    send(socket, { type: 'response', requestId, ok: false, error: messageText });
  }
}

webSockets.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('error', () => { socket.isAlive = false; });
  const client = { socket, room: null, connected: true, ip: socket.clientIp };
  let processingRequest = false;

  socket.on('message', (rawMessage, isBinary) => {
    if (isBinary) {
      send(socket, { type: 'server:error', message: 'Only JSON text messages are supported.' });
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage.toString());
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.type !== 'string' ||
        (message.payload !== undefined && (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)))
      ) {
        throw new Error('Invalid request format.');
      }
    } catch {
      send(socket, { type: 'server:error', message: 'Invalid request. Send a JSON object with a requestId and action type.' });
      return;
    }

    if (message.type.startsWith('game:')) {
      routeGameplayMessage(client, message);
      return;
    }

    if (message.type === 'net:heartbeat') {
      send(socket, { type: 'net:heartbeat', timestamp: message.payload?.timestamp });
      return;
    }

    if (typeof message.requestId !== 'string' || message.requestId.length > 64) {
      send(socket, { type: 'server:error', message: 'Requests require a valid request ID.' });
      return;
    }

    if (processingRequest) {
      send(socket, {
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: 'Please wait for your current request to finish, then try again.',
      });
      return;
    }
    if (!requestRateLimiter.consume(client.ip)) {
      send(socket, {
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: 'Too many requests. Please wait a minute and try again.',
      });
      return;
    }
    if (ROOM_ALLOCATION_REQUEST_TYPES.has(message.type) &&
        !roomAllocationRateLimiter.consume(client.ip)) {
      send(socket, {
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: 'Too many room attempts. Please wait a few minutes and try again.',
      });
      return;
    }

    processingRequest = true;
    void handleRequest(client, message)
      .catch(() => {
        send(socket, {
          type: 'response',
          requestId: message.requestId,
          ok: false,
          error: 'The request could not be completed.',
        });
      })
      .finally(() => {
        processingRequest = false;
      });
  });

  socket.on('close', () => {
    const remainingConnections = (activeConnectionsByIp.get(client.ip) ?? 1) - 1;
    if (remainingConnections > 0) activeConnectionsByIp.set(client.ip, remainingConnections);
    else activeConnectionsByIp.delete(client.ip);
    const room = client.room;
    roomManager.markDisconnected(client);
    if (client.room?.clients.has(client)) {
      disconnectedClients.add(client);
      sendRoomUpdate(room);
      publishRooms();
    }
  });
});

// Room lifecycle cleanup only. Gameplay frames and outcomes are produced by
// the elected browser host and never advanced from this server timer.
const SESSION_CLEANUP_INTERVAL_MS = 1_000;
let lastRateLimitCleanupAt = 0;
const sessionCleanup = setInterval(() => {
  const now = Date.now();
  if (now - lastRateLimitCleanupAt >= 60_000) {
    requestRateLimiter.pruneExpired(now);
    roomAllocationRateLimiter.pruneExpired(now);
    lastRateLimitCleanupAt = now;
  }
  for (const room of roomManager.advanceLobbyLifecycle(now)) {
    sendRoomUpdate(room);
    publishRooms();
  }
  for (const client of disconnectedClients) {
    if (now - client.disconnectedAt < 15_000) continue;
    disconnectedClients.delete(client);
    processDeparture(roomManager.expireDisconnected(client));
  }
}, SESSION_CLEANUP_INTERVAL_MS);
sessionCleanup.unref();

const HEARTBEAT_INTERVAL_MS = 20_000;
const heartbeat = setInterval(() => {
  for (const socket of webSockets.clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    try {
      socket.ping();
    } catch {
      socket.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref();

server.listen(port, '0.0.0.0');
