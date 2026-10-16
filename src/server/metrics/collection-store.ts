import { mkdir, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { appDataDirectory, privateDirectory, openRegular } from '../platform/storage.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CollectionAttempt, CollectionState, MetricService } from '../../shared/metrics-collection.js';

export const collectionDirectory = () => join(appDataDirectory(), 'metrics-collection');
export class CollectionError extends Error {
  constructor(public code: string) { super(code); }
}
export const collectionAlive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};
export class CollectionStore {
  constructor(public directory = collectionDirectory()) {}
  async prepare() { await privateDirectory(this.directory); }
  private async json(file: string): Promise<unknown> {
    const handle = await openRegular(file);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 8192) throw new CollectionError('STORAGE_FAILED');
      return JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
  }
  private state(value: CollectionState, service: MetricService): CollectionState {
    const a = value.lastAttempt;
    if ((value.lastSuccessAt !== null && !Number.isFinite(Date.parse(value.lastSuccessAt))) || (a !== null && (!a || a.service !== service
      || !/^[\da-f-]{36}$/.test(a.id) || !['running', 'succeeded', 'partial', 'failed', 'cancelled'].includes(a.status)
      || !['manual', 'scheduled'].includes(a.trigger) || !Number.isFinite(Date.parse(a.startedAt))
      || (a.finishedAt !== null && !Number.isFinite(Date.parse(a.finishedAt)))
      || !Number.isSafeInteger(a.pid) || a.pid <= 0 || typeof a.retryable !== 'boolean' || typeof a.snapshotSaved !== 'boolean'
      || (a.errorCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(a.errorCode))
      || (a.snapshotFile !== undefined && (typeof a.snapshotFile !== 'string' || !/^snapshots\/\d{4}-\d{2}-\d{2}\/primary-mac_[\da-zA-Z_-]+\.json$/.test(a.snapshotFile)))))) throw new CollectionError('STORAGE_FAILED');
    return { lastAttempt: a ? { id: a.id, service, trigger: a.trigger, status: a.status, startedAt: a.startedAt, finishedAt: a.finishedAt,
      errorCode: a.errorCode, retryable: a.retryable, snapshotSaved: a.snapshotSaved, pid: a.pid,
      ...(a.snapshotFile ? { snapshotFile: a.snapshotFile } : {}) } : null, lastSuccessAt: value.lastSuccessAt };
  }
  async read(service: MetricService): Promise<CollectionState> {
    try {
      const state = this.state(await this.json(join(this.directory, `${service}.json`)) as CollectionState, service);
      if (service === 'youtube' && state.lastAttempt) state.lastAttempt = await this.attempt(state.lastAttempt.id) ?? state.lastAttempt;
      if (service === 'youtube' && state.lastAttempt) state.lastAttempt = await this.recover(state.lastAttempt);
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { lastAttempt: null, lastSuccessAt: null };
      throw new CollectionError('STORAGE_FAILED');
    }
  }
  async write(service: MetricService, state: CollectionState) {
    await this.prepare();
    if (service === 'youtube') {
      // 첫 갱신 전에 구형 최근 기록을 보존한다. 과거 알림은 새로 발행하지 않는다.
      const previous = (await this.read(service)).lastAttempt;
      if (previous && !(await this.attempt(previous.id))) {
        await this.saveAttempt(previous);
        await this.markRead(previous.id);
      }
      if (state.lastAttempt) await this.saveAttempt(state.lastAttempt);
    }
    const temp = join(this.directory, `${service}.${randomUUID()}.tmp`);
    try { await writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); await rename(temp, join(this.directory, `${service}.json`)); }
    finally { await unlink(temp).catch(() => {}); }
  }
  private file(id: string, suffix = 'json') {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new CollectionError('INVALID_INPUT');
    return join(this.directory, 'youtube-runs', `${id}.${suffix}`);
  }
  private async atomic(file: string, value: unknown) {
    await mkdir(join(this.directory, 'youtube-runs'), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async saveAttempt(attempt: CollectionAttempt) {
    const safe = this.state({ lastAttempt: attempt, lastSuccessAt: null }, 'youtube').lastAttempt;
    await this.atomic(this.file(attempt.id), safe);
  }
  async attempt(id: string): Promise<CollectionAttempt | null> {
    try {
      const a = this.state({ lastAttempt: await this.json(this.file(id)) as CollectionAttempt, lastSuccessAt: null }, 'youtube').lastAttempt;
      if (a?.id !== id) throw new CollectionError('STORAGE_FAILED');
      return a;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async history() {
    const names = await readdir(join(this.directory, 'youtube-runs')).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return []; throw e;
    });
    const attempts = (await Promise.all(names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => this.attempt(n.slice(0, -5)))))
      .filter((a): a is CollectionAttempt => !!a);
    const latest = (await this.read('youtube')).lastAttempt;
    const legacy = latest && !attempts.some(a => a.id === latest.id) ? latest : null;
    if (legacy) attempts.push(legacy);
    return Promise.all(attempts.map(async a => ({ attempt: await this.recover(a),
      readAt: legacy?.id === a.id ? a.finishedAt ?? a.startedAt : await this.readAt(a.id), cancelling: a.status === 'running' && await this.cancelRequested(a.id) })));
  }
  private async recover(attempt: CollectionAttempt) {
    const recovered = recoverState({ lastAttempt: attempt, lastSuccessAt: null }).lastAttempt!;
    return recovered.errorCode === 'INTERRUPTED' && await this.cancelRequested(attempt.id)
      ? { ...recovered, status: 'cancelled' as const, errorCode: 'CANCELLED', retryable: false } : recovered;
  }
  async readAt(id: string): Promise<string | null> {
    try { const value = await this.json(this.file(id, 'read')); if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new CollectionError('STORAGE_FAILED'); return value; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async markRead(id: string) {
    const time = await this.readAt(id) ?? new Date().toISOString();
    await this.atomic(this.file(id, 'read'), time); return time;
  }
  async requestCancel(id: string) { await this.atomic(this.file(id, 'cancel'), id); }
  async cancelRequested(id: string) {
    try { return await this.json(this.file(id, 'cancel')) === id; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
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
  if (a?.status === 'cancelled' && date(new Date(a.startedAt)) === today) return false;
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
