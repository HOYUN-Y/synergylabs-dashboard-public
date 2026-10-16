import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { GhostSnapshot } from './ghost.js';
import { GHOST_FILTER } from '../../shared/metrics.js';
import type { GhostMetricsSummary } from '../../shared/metrics.js';
import { dateKey } from '../../shared/calendar.js';
const kstDate = (value: Date) => dateKey(value.getTime() + 9 * 3600000);

const labels = { NOT_CONFIGURED: '지표 저장 폴더가 설정되지 않았습니다.', STORAGE_FAILED: '지표 저장 폴더를 읽을 수 없습니다.',
  NO_DATA: '아직 수집된 지표가 없습니다.', INVALID_DATA: '지표 JSON의 형식을 확인해 주세요.', FORBIDDEN: '허용되지 않은 요청입니다.' };
export class MetricsError extends Error {
  constructor(public code: keyof typeof labels) { super(labels[code]); }
}
export function previousDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
function record(value: unknown, date: string): GhostSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MetricsError('INVALID_DATA');
  const v = value as Partial<GhostSnapshot>;
  if (v.siteId !== 'chatdaeri.ghost.io' || v.filter !== GHOST_FILTER) return null;
  if (v.schemaVersion !== 1 || v.service !== 'ghost' || v.status !== 'succeeded' || v.timeZone !== 'Asia/Seoul'
    || !validDate(v.metricDate) || v.metricDate !== date || typeof v.collectedAt !== 'string'
    || !Number.isFinite(Date.parse(v.collectedAt)) || typeof v.collectionId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.collectionId)
    || typeof v.subscribedMembers !== 'number' || !Number.isSafeInteger(v.subscribedMembers) || v.subscribedMembers < 0
    || (v.source !== undefined && v.source !== 'api' && v.source !== 'manual')) throw new MetricsError('INVALID_DATA');
  if (v.source !== 'manual' && kstDate(new Date(v.collectedAt)) !== date) throw new MetricsError('INVALID_DATA');
  return v as GhostSnapshot;
}
export class GhostMetricsReader {
  constructor(private directory = process.env.GHOST_METRICS_DIR ?? '') {}
  async summary(now = new Date()): Promise<GhostMetricsSummary> {
    if (!this.directory || !isAbsolute(this.directory)) throw new MetricsError('NOT_CONFIGURED');
    const root = join(this.directory, 'snapshots');
    const today = kstDate(now);
    const latest = new Map<string, GhostSnapshot>();
    let invalidFiles = 0;
    try {
      if (!(await lstat(this.directory)).isDirectory()) throw new Error();
      try { if (!(await lstat(root)).isDirectory()) throw new Error(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MetricsError('NO_DATA');
        throw error;
      }
      const dates = await readdir(root, { withFileTypes: true });
      for (const entry of dates) {
        if (!validDate(entry.name) || entry.name > today) continue;
        if (entry.isSymbolicLink()) { invalidFiles++; continue; }
        if (!entry.isDirectory()) continue;
        const folder = join(root, entry.name);
        for (const file of await readdir(folder, { withFileTypes: true })) {
          if (!file.name.endsWith('.json')) continue;
          if (!file.isFile() || file.isSymbolicLink()) { invalidFiles++; continue; }
          try {
            const path = join(folder, file.name);
            const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            let raw: string;
            try { if ((await handle.stat()).size > 65536) throw new Error(); raw = await handle.readFile('utf8'); }
            finally { await handle.close(); }
            const v = record(JSON.parse(raw), entry.name);
            if (!v) continue;
            const old = latest.get(entry.name);
            if (!old || Date.parse(v.collectedAt) > Date.parse(old.collectedAt)
              || (Date.parse(v.collectedAt) === Date.parse(old.collectedAt) && v.collectionId > old.collectionId)) latest.set(entry.name, v);
          } catch { invalidFiles++; }
        }
      }
    } catch (error) { if (error instanceof MetricsError) throw error; throw new MetricsError('STORAGE_FAILED'); }
    const date = [...latest.keys()].sort().at(-1);
    if (!date) throw new MetricsError(invalidFiles ? 'INVALID_DATA' : 'NO_DATA');
    const current = latest.get(date)!;
    const previous = latest.get(previousDate(date));
    const historyDates = [today];
    while (historyDates.length < 7) historyDates.unshift(previousDate(historyDates[0]));
    const history = historyDates.map(metricDate => {
      const value = latest.get(metricDate);
      const before = latest.get(previousDate(metricDate));
      return { metricDate, subscribedMembers: value?.subscribedMembers ?? null,
        delta: value && before ? value.subscribedMembers - before.subscribedMembers : null,
        collectedAt: value?.collectedAt ?? null, source: value ? value.source ?? 'api' : null };
    });
    return { current: { subscribedMembers: current.subscribedMembers, metricDate: date, collectedAt: current.collectedAt, source: current.source ?? 'api' },
      previous: previous ? { subscribedMembers: previous.subscribedMembers, metricDate: previous.metricDate, source: previous.source ?? 'api' } : null,
      delta: previous ? current.subscribedMembers - previous.subscribedMembers : null, history, stale: date !== today, invalidFiles };
  }
}
