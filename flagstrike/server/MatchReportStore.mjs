import { createHash, randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  MAX_MATCH_REPORT_BYTES,
  validateMatchClientDiagnostics,
  validateMatchReport,
} from '../shared/MatchReport.js';

const MAX_MATCH_CLIENT_REPORTS = 64;

export class MatchReportStore {
  constructor(directoryPath = process.env.MATCH_REPORT_STORE_DIR ?? './data/match-reports') {
    this.directoryPath = resolve(directoryPath);
    this.pendingWrites = Promise.resolve();
  }

  record({ roomKey, hostId, report }) {
    const operation = this.pendingWrites.then(() => this.recordSerialized({ roomKey, hostId, report }));
    this.pendingWrites = operation.catch(() => {});
    return operation;
  }

  recordClientDiagnostics({ roomKey, matchId, playerId, diagnostics }) {
    const operation = this.pendingWrites.then(() =>
      this.recordClientDiagnosticsSerialized({ roomKey, matchId, playerId, diagnostics }));
    this.pendingWrites = operation.catch(() => {});
    return operation;
  }

  async recordSerialized({ roomKey, hostId, report }) {
    if (typeof roomKey !== 'string' || roomKey.length < 1 ||
        typeof hostId !== 'string' || hostId.length < 1 || report?.hostId !== hostId) {
      throw new TypeError('Match report room or host identity is invalid.');
    }
    const validation = validateMatchReport(report, report.matchId);
    if (!validation.valid) throw new TypeError(validation.reason);

    const reportId = createHash('sha256')
      .update(`${roomKey}:${report.matchId}`)
      .digest('hex');
    const filePath = join(this.directoryPath, `${reportId}.json`);
    try {
      await access(filePath);
      return { reportId, stored: false, byteLength: validation.byteLength };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await mkdir(this.directoryPath, { recursive: true });
    const temporaryPath = join(this.directoryPath, `.${reportId}.${randomUUID()}.tmp`);
    const record = {
      reportId,
      roomKey,
      hostId,
      receivedAt: new Date().toISOString(),
      report,
    };
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, 'utf8');
      try {
        await link(temporaryPath, filePath);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return { reportId, stored: false, byteLength: validation.byteLength };
      }
      return { reportId, stored: true, byteLength: validation.byteLength };
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async recordClientDiagnosticsSerialized({ roomKey, matchId, playerId, diagnostics }) {
    if (typeof roomKey !== 'string' || roomKey.length < 1 ||
        typeof playerId !== 'string' || playerId.length < 1 ||
        diagnostics?.playerId !== playerId || diagnostics?.matchId !== matchId) {
      throw new TypeError('Client diagnostics room, match, or player identity is invalid.');
    }
    const validation = validateMatchClientDiagnostics(diagnostics, matchId);
    if (!validation.valid) throw new TypeError(validation.reason);

    const reportId = createHash('sha256')
      .update(`${roomKey}:${matchId}`)
      .digest('hex');
    const directory = join(this.directoryPath, 'client-diagnostics');
    const filePath = join(directory, `${reportId}.json`);
    let record = {
      reportId,
      roomKey,
      matchId,
      updatedAt: new Date().toISOString(),
      clients: {},
    };
    try {
      record = JSON.parse(await readFile(filePath, 'utf8'));
      if (record.reportId !== reportId || record.roomKey !== roomKey ||
          record.matchId !== matchId || !record.clients || typeof record.clients !== 'object' ||
          Array.isArray(record.clients)) {
        throw new TypeError('Stored client diagnostics do not match the requested match.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    record.clients = Object.assign(Object.create(null), record.clients);
    if (Object.hasOwn(record.clients, playerId)) {
      return {
        reportId,
        stored: false,
        clientCount: Object.keys(record.clients).length,
        byteLength: validation.byteLength,
      };
    }
    if (Object.keys(record.clients).length >= MAX_MATCH_CLIENT_REPORTS) {
      throw new TypeError('The match already contains the maximum number of client diagnostics.');
    }
    record.clients[playerId] = diagnostics;
    record.updatedAt = new Date().toISOString();
    const serialized = `${JSON.stringify(record)}\n`;
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength > MAX_MATCH_REPORT_BYTES) {
      throw new TypeError('Match client diagnostics exceed the maximum stored size.');
    }

    await mkdir(directory, { recursive: true });
    const temporaryPath = join(directory, `.${reportId}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, serialized, 'utf8');
      await rename(temporaryPath, filePath);
      return {
        reportId,
        stored: true,
        clientCount: Object.keys(record.clients).length,
        byteLength,
      };
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}
