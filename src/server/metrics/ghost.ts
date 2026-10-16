import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { MetricSource } from '../../shared/metrics.js';

export class GhostMetricsError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export interface GhostMetricsConfig { apiUrl: string; adminKey: string; outputDirectory: string }
export interface GhostSnapshot {
  schemaVersion: 1;
  service: 'ghost';
  siteId: string;
  filter: 'subscribed:true+email_disabled:false';
  metricDate: string;
  timeZone: 'Asia/Seoul';
  collectedAt: string;
  collectorId: 'primary-mac';
  collectionId: string;
  status: 'succeeded';
  subscribedMembers: number;
  source?: MetricSource;
  sourceNote?: string;
}

export async function collectGhostMetrics(config: GhostMetricsConfig, fetcher: typeof fetch = fetch) {
  let base: URL;
  try {
    base = new URL(config.apiUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
      || !['/', '/ghost/api/admin', '/ghost/api/admin/'].includes(base.pathname)) throw new Error();
  } catch { throw new GhostMetricsError('INVALID_API_URL'); }
  if (!isAbsolute(config.outputDirectory)) throw new GhostMetricsError('INVALID_OUTPUT_DIRECTORY');
  try { if (!(await stat(config.outputDirectory)).isDirectory()) throw new Error(); }
  catch { throw new GhostMetricsError('STORAGE_FAILED'); }
  const parts = config.adminKey.split(':');
  if (parts.length !== 2 || !/^[a-f0-9]+$/i.test(parts[0]) || !/^[a-f0-9]+$/i.test(parts[1]) || parts[1].length % 2) {
    throw new GhostMetricsError('INVALID_ADMIN_KEY');
  }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: 'HS256', typ: 'JWT', kid: parts[0] })}.${encode({ iat: now, exp: now + 300, aud: '/admin/' })}`;
  const signature = createHmac('sha256', Buffer.from(parts[1], 'hex')).update(payload).digest('base64url');
  const url = new URL('/ghost/api/admin/members/', base.origin);
  // Ghost의 Total subscribers와 동일하게 이메일 발송이 비활성화된 회원을 제외한다.
  url.search = new URLSearchParams({ filter: 'subscribed:true+email_disabled:false', limit: '1', fields: 'id' }).toString();
  const signal = AbortSignal.timeout(20000);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Ghost ${payload}.${signature}`, 'Accept-Version': 'v5.0' },
      redirect: 'error', signal });
  } catch { throw new GhostMetricsError(signal.aborted ? 'TIMEOUT' : 'NETWORK'); }
  if (!response.ok) throw new GhostMetricsError(response.status === 401 || response.status === 403 ? 'AUTH_FAILED' : `HTTP_${response.status}`);
  let total: number;
  try {
    const data = await response.json() as { members?: unknown; meta?: { pagination?: { total?: unknown } } } | null;
    const count = data?.meta?.pagination?.total;
    if (!Array.isArray(data?.members) || data.members.length > 1 || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
      || (count === 0 ? data.members.length !== 0 : data.members.length !== 1)) throw new Error();
    total = count;
  } catch { throw new GhostMetricsError(signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE'); }
  const collected = new Date();
  const metricDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(collected);
  // 회원 API는 fields 지정에도 추가 정보를 반환하므로 집계 필드만 새 객체에 넣는다.
  const snapshot: GhostSnapshot = { schemaVersion: 1, service: 'ghost', siteId: base.hostname, filter: 'subscribed:true+email_disabled:false',
    metricDate, timeZone: 'Asia/Seoul', collectedAt: collected.toISOString(), collectorId: 'primary-mac',
    collectionId: randomUUID(), status: 'succeeded', subscribedMembers: total, source: 'api' };
  const directory = join(config.outputDirectory, 'snapshots', metricDate);
  const file = join(directory, `primary-mac_${snapshot.collectedAt.replace(/[:.]/g, '-')}_${snapshot.collectionId}.json`);
  const temporary = `${file}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } catch { throw new GhostMetricsError('STORAGE_FAILED'); }
  finally { await unlink(temporary).catch(() => {}); }
  return { snapshot, file };
}
