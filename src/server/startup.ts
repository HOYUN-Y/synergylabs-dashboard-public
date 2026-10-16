import type { StartupItem, StartupKey, StartupStatus } from '../shared/startup.js';

const needsConnection = new Set(['AUTH_SETTINGS_INVALID', 'AUTH_CLIENT_INVALID', 'NOT_CONFIGURED', 'NOT_CONNECTED', 'NO_CALENDAR', 'REAUTH_REQUIRED', 'AUTH_FAILED',
  'GWS_AUTH_REQUIRED', 'GWS_PERMISSION', 'GWS_API_DISABLED', 'GWS_NOT_FOUND', 'ACCESS_DENIED', 'API_DISABLED', 'ACCOUNT_CHANGED']);
interface Entry { state: StartupItem; flight?: Promise<unknown>; value?: unknown; error?: unknown; at: number }

// 초기 조회와 첫 화면의 API 조회가 같은 요청·결과를 사용한다. 원문은 메모리에만 둔다.
export class StartupService {
  private startedAt: number | null = null;
  private entries = new Map<StartupKey, Entry>();
  constructor(private loaders: Record<StartupKey, () => Promise<unknown>>, private now = Date.now, private waitMs = 30000) {}
  start() {
    if (this.startedAt !== null) return;
    this.startedAt = this.now();
    for (const key of Object.keys(this.loaders) as StartupKey[]) void this.read(key).catch(() => {});
  }
  read(key: StartupKey, force = false): Promise<unknown> {
    if (this.startedAt === null) return this.loaders[key]();
    const existing = this.entries.get(key);
    if (existing?.flight) return existing.flight;
    if (!force && existing && this.now() - existing.at < 300000) {
      return existing.error ? Promise.reject(existing.error) : Promise.resolve(existing.value);
    }
    const entry: Entry = { state: { state: 'pending', message: '준비 중입니다.' }, at: this.now() };
    this.entries.set(key, entry);
    entry.flight = Promise.resolve().then(this.loaders[key]).then(value => {
      if (this.entries.get(key) !== entry) throw Object.assign(new Error('설정이 변경되었습니다. 다시 조회해 주세요.'), { code: 'CONFIG_CHANGED' });
      entry.value = value; entry.state = { state: 'ready', message: '준비했습니다.', finishedAt: new Date(this.now()).toISOString() };
      return value;
    }, error => {
      entry.error = error;
      entry.state = { state: needsConnection.has(error?.code) ? 'connection_required' : 'error',
        message: typeof error?.code === 'string' && error instanceof Error ? error.message : '자료를 확인하지 못했습니다. 설정 경로와 접근 권한을 확인해 주세요.', finishedAt: new Date(this.now()).toISOString() };
      throw error;
    }).finally(() => { entry.flight = undefined; entry.at = this.now(); });
    return entry.flight;
  }
  invalidate(keys: StartupKey[]) {
    for (const key of keys) {
      this.entries.delete(key);
      if (this.startedAt !== null) void this.read(key).catch(() => {});
    }
  }
  status(): StartupStatus {
    const items = Object.fromEntries([...this.entries].map(([key, entry]) => [key, entry.state]));
    const waiting = [...this.entries.values()].some(entry => entry.state.state === 'pending');
    const timedOut = this.startedAt !== null && waiting && this.now() - this.startedAt >= this.waitMs;
    return { startedAt: this.startedAt === null ? null : new Date(this.startedAt).toISOString(),
      waiting, timedOut, openReady: this.startedAt !== null && (!waiting || timedOut), items };
  }
}
