import type { GhostMetricsSummary, GhostMetricsHistoryEntry } from '../shared/metrics';
import { isYouTubeSnapshot, youtubeCount, youtubeDate } from '../shared/youtube-metrics';
import type { YouTubeMetricsSummary } from '../shared/youtube-metrics';
export class MetricsApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function previousDate(value: string) {
  return new Date(Date.parse(`${value}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}
function validHistory(value: unknown): value is GhostMetricsHistoryEntry[] {
  if (!Array.isArray(value) || value.length !== 7) return false;
  return value.every((row, index) => {
    if (!row || !validDate(row.metricDate)
      || (index > 0 && previousDate(row.metricDate) !== value[index - 1]?.metricDate)) return false;
    if (row.subscribedMembers === null) return row.delta === null && row.collectedAt === null && row.source === null;
    if (!youtubeCount(row.subscribedMembers) || !['api', 'manual'].includes(row.source)
      || typeof row.collectedAt !== 'string' || !Number.isFinite(Date.parse(row.collectedAt))
      || (row.delta !== null && !Number.isSafeInteger(row.delta))) return false;
    if (index === 0) return true; // 첫 행의 전날은 응답 범위 밖이다.
    const before = value[index - 1].subscribedMembers;
    return row.delta === (before === null ? null : row.subscribedMembers - before);
  });
}
function validYouTubeComparison(value: YouTubeMetricsSummary) {
  const { previous, delta, current } = value;
  if (previous === null) return delta === null;
  return !!previous && validDate(previous.metricDate) && previous.metricDate === previousDate(current.metricDate)
    && typeof previous.collectedAt === 'string' && Number.isFinite(Date.parse(previous.collectedAt))
    && youtubeDate(new Date(previous.collectedAt)) === previous.metricDate
    && youtubeCount(previous.totalViews) && youtubeCount(previous.totalLikes)
    && !!delta && delta.views === current.totalViews - previous.totalViews && delta.likes === current.totalLikes - previous.totalLikes;
}
export async function getYouTubeMetrics(signal?: AbortSignal): Promise<YouTubeMetricsSummary> {
  let response: Response;
  try {
    response = await fetch('/api/metrics/youtube', { cache: 'no-store', headers: { 'X-Dashboard-Request': '1' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  } catch { throw new MetricsApiError('NETWORK', '지표 서버에 연결하지 못했거나 응답 시간이 초과되었습니다.'); }
  let data;
  try { data = await response.json(); } catch { throw new MetricsApiError('INVALID_DATA', '지표 응답 형식을 확인해 주세요.'); }
  if (!response.ok) throw new MetricsApiError(data?.error ?? 'UNKNOWN', data?.message ?? '지표를 읽지 못했습니다.');
  if (!isYouTubeSnapshot(data?.current) || typeof data.stale !== 'boolean' || !Number.isSafeInteger(data.invalidFiles) || data.invalidFiles < 0
    || !validYouTubeComparison(data)) {
    throw new MetricsApiError('INVALID_DATA', '지표 응답 형식을 확인해 주세요.');
  }
  return data as YouTubeMetricsSummary;
}
export async function getGhostMetrics(signal?: AbortSignal): Promise<GhostMetricsSummary> {
  let response: Response;
  try {
    response = await fetch('/api/metrics/ghost', { cache: 'no-store', headers: { 'X-Dashboard-Request': '1' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  } catch { throw new MetricsApiError('NETWORK', '지표 서버에 연결하지 못했거나 응답 시간이 초과되었습니다.'); }
  let data;
  try { data = await response.json(); } catch { throw new MetricsApiError('INVALID_DATA', '지표 응답 형식을 확인해 주세요.'); }
  if (!response.ok) throw new MetricsApiError(data?.error ?? 'UNKNOWN', data?.message ?? '지표를 읽지 못했습니다.');
  if (!data?.current || !Number.isSafeInteger(data.current.subscribedMembers) || data.current.subscribedMembers < 0
    || typeof data.current.metricDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.current.metricDate)
    || typeof data.current.collectedAt !== 'string' || !Number.isFinite(Date.parse(data.current.collectedAt))
    || !['api', 'manual'].includes(data.current.source) || typeof data.stale !== 'boolean'
    || !Number.isSafeInteger(data.invalidFiles) || data.invalidFiles < 0
    || !validHistory(data.history)
    || (data.previous === null ? data.delta !== null : !data.previous || !Number.isSafeInteger(data.previous.subscribedMembers)
      || data.previous.subscribedMembers < 0 || typeof data.previous.metricDate !== 'string' || !['api', 'manual'].includes(data.previous.source)
      || data.delta !== data.current.subscribedMembers - data.previous.subscribedMembers)) {
    throw new MetricsApiError('INVALID_DATA', '지표 응답 형식을 확인해 주세요.');
  }
  return data as GhostMetricsSummary;
}

export async function getCollectionStatus(): Promise<import('../shared/metrics-collection').CollectionStatus> {
  const response = await fetch('/api/metrics/collection', { cache: 'no-store', headers: { 'X-Dashboard-Request': '1' }, signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok || !value?.schedule || typeof value.schedule.registered !== 'boolean'
    || !value.services || !['ghost', 'youtube'].every(s => typeof value.services[s]?.available === 'boolean')) throw new MetricsApiError('INVALID_DATA', '수집 상태를 확인하지 못했습니다.');
  return value;
}
export async function startMetricsCollection(service: import('../shared/metrics-collection').MetricService) {
  const response = await fetch(`/api/metrics/${service}/collect`, { method: 'POST', cache: 'no-store', headers: { 'X-Dashboard-Request': '1' }, signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new MetricsApiError(data.error ?? 'UNKNOWN', data.message ?? '수집을 시작하지 못했습니다.');
  if (response.status !== 202 || typeof data.id !== 'string') throw new MetricsApiError('INVALID_DATA', '수집 응답을 확인해 주세요.');
  return data.id as string;
}
