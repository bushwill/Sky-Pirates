import { isIP } from 'node:net';

const PRODUCTION_ORIGINS = ['https://bushwill.ca', 'https://www.bushwill.ca'];
const DEVELOPMENT_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function createAllowedOriginSet(
  configuredOrigins = process.env.FLAGSTRIKE_ALLOWED_ORIGINS,
  isProduction = process.env.NODE_ENV === 'production',
) {
  const origins = configuredOrigins === undefined
    ? isProduction ? PRODUCTION_ORIGINS : DEVELOPMENT_ORIGINS
    : configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new Error('FLAGSTRIKE_ALLOWED_ORIGINS must contain at least one origin.');
  }

  return new Set(origins.map((origin) => {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Invalid WebSocket origin in FLAGSTRIKE_ALLOWED_ORIGINS: ${origin}`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`Invalid WebSocket origin in FLAGSTRIKE_ALLOWED_ORIGINS: ${origin}`);
    }
    return url.origin;
  }));
}

export function isAllowedWebSocketOrigin(origin, allowedOrigins) {
  if (typeof origin !== 'string') return false;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function normalizeIpAddress(address) {
  if (typeof address !== 'string') return null;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return isIP(normalized) ? normalized : null;
}

export function getClientIp(request) {
  return normalizeIpAddress(request.headers['x-real-ip']) ??
    normalizeIpAddress(request.socket.remoteAddress) ??
    'unknown';
}

export class IpRateLimiter {
  constructor(limit, windowMs, maxEntries = 4_096) {
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        !Number.isSafeInteger(windowMs) || windowMs < 1 ||
        !Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('IP rate-limit settings must be positive safe integers.');
    }
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.buckets = new Map();
  }

  consume(key, now = Date.now()) {
    if (typeof key !== 'string' || key.length === 0 || !Number.isFinite(now)) return false;
    const bucket = this.buckets.get(key);
    if (bucket && now < bucket.resetAt) {
      if (bucket.count >= this.limit) return false;
      bucket.count += 1;
      return true;
    }

    if (!bucket && this.buckets.size >= this.maxEntries) this.pruneExpired(now);
    if (!bucket && this.buckets.size >= this.maxEntries) return false;
    this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    return true;
  }

  pruneExpired(now = Date.now()) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
