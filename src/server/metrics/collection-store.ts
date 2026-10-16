import { mkdir, open, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CollectionState, MetricService } from '../../shared/metrics-collection.js';

export const collectionDirectory = () => join(homedir(), 'Library', 'Application Support', 'SynergyLabs Dashboard', 'metrics-collection');
export class CollectionError extends Error {
  constructor(public code: string) { super(code); }
}
export const collectionAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
export class CollectionStore {
  constructor(public directory = collectionDirectory()) {}
  async prepare() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  async read(service: MetricService): Promise<CollectionState> {
    try {
      const handle = await open(join(this.directory, `${service}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      let value;
      try {
        if ((await handle.stat()).size > 8192) throw new Error();
        value = JSON.parse(await handle.readFile('utf8')) as CollectionState;
      } finally { await handle.close(); }
      const a = value.lastAttempt;
      if ((value.lastSuccessAt !== null && !Number.isFinite(Date.parse(value.lastSuccessAt))) || (a !== null && (!a || a.service !== service
        || !/^[\da-f-]{36}$/.test(a.id) || !['running', 'succeeded', 'partial', 'failed'].includes(a.status)
        || !['manual', 'scheduled'].includes(a.trigger) || !Number.isFinite(Date.parse(a.startedAt))
        || (a.finishedAt !== null && !Number.isFinite(Date.parse(a.finishedAt)))
        || !Number.isSafeInteger(a.pid) || a.pid <= 0 || typeof a.retryable !== 'boolean' || typeof a.snapshotSaved !== 'boolean'
        || (a.errorCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(a.errorCode))))) throw new Error();
      return { lastAttempt: a ? { id: a.id, service, trigger: a.trigger, status: a.status, startedAt: a.startedAt, finishedAt: a.finishedAt,
        errorCode: a.errorCode, retryable: a.retryable, snapshotSaved: a.snapshotSaved, pid: a.pid } : null, lastSuccessAt: value.lastSuccessAt };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { lastAttempt: null, lastSuccessAt: null };
      throw new CollectionError('STORAGE_FAILED');
    }
  }
  async write(service: MetricService, state: CollectionState) {
    await this.prepare();
    const temp = join(this.directory, `${service}.${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); await rename(temp, join(this.directory, `${service}.json`)); }
    finally { await unlink(temp).catch(() => {}); }
  }
}
export function recoverState(state: CollectionState): CollectionState {
  if (state.lastAttempt?.status !== 'running' || collectionAlive(state.lastAttempt.pid)) return state;
  return { ...state, lastAttempt: { ...state.lastAttempt, status: 'failed', finishedAt: null, errorCode: 'INTERRUPTED', retryable: true } };
}
const date = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export function due(state: CollectionState, now = new Date()) {
  const today = date(now), dayStart = Date.parse(`${today}T09:00:00+09:00`);
  if (now.getTime() < dayStart || state.lastAttempt?.status === 'running') return false;
  const a = state.lastAttempt;
  if (state.lastSuccessAt && Date.parse(state.lastSuccessAt) >= dayStart && (!a || Date.parse(state.lastSuccessAt) >= Date.parse(a.startedAt))) return false;
  if (!a || Date.parse(a.startedAt) < dayStart) return true;
  return a.retryable && now.getTime() >= (Math.floor(Date.parse(a.finishedAt ?? a.startedAt) / 3600000) + 1) * 3600000;
}
export function nextRetry(state: CollectionState, now = new Date()): string | null {
  const a = state.lastAttempt;
  if (!a || !a.retryable || a.status === 'running' || date(new Date(a.finishedAt ?? a.startedAt)) !== date(now)) return null;
  const time = (Math.floor(Date.parse(a.finishedAt ?? a.startedAt) / 3600000) + 1) * 3600000;
  return date(new Date(time)) === date(now) ? new Date(time).toISOString() : null;
}
export function safeCollectionCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(?:NOT_CONFIGURED|INVALID_API_URL|INVALID_ADMIN_KEY|INVALID_OUTPUT_DIRECTORY|STORAGE_FAILED|SERVICE_UNAVAILABLE|NETWORK|TIMEOUT|AUTH_FAILED|REAUTH_REQUIRED|ACCESS_DENIED|RATE_LIMIT|KEYCHAIN_FAILED|WRONG_CHANNEL|CONFIG_CHANGED|INVALID_RESPONSE|INVALID_INVENTORY|INVENTORY_FAILED|INVENTORY_CHANGED|ANALYTICS_FAILED|NOT_CONNECTED|INTERRUPTED|HTTP_\d{3})$/.test(code) ? code : 'EXECUTION_FAILED';
}
export const retryableCollectionCode = (code: string) => ['SERVICE_UNAVAILABLE', 'NETWORK', 'TIMEOUT', 'STORAGE_FAILED', 'RATE_LIMIT', 'INVENTORY_FAILED', 'INVENTORY_CHANGED', 'INTERRUPTED'].includes(code) || /^HTTP_(?:429|5\d\d)$/.test(code);
