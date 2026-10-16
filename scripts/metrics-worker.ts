import { collectGhostMetrics } from '../src/server/metrics/ghost.js';
import { collectYouTubeMetrics } from '../src/server/metrics/youtube.js';
import { YouTubeAnalyticsCollector } from '../src/server/metrics/youtube-analytics.js';
import { CollectionError, CollectionStore, retryableCollectionCode, safeCollectionCode } from '../src/server/metrics/collection-store.js';
import { isMetricService } from '../src/shared/metrics-collection.js';
import type { CollectionAttempt } from '../src/shared/metrics-collection.js';
import { relative } from 'node:path';

const [service, trigger, id, directory, timeout] = process.argv.slice(2);
if (!isMetricService(service) || !['manual', 'scheduled'].includes(trigger) || !/^[a-f0-9-]{36}$/.test(id ?? '') || !directory || !Number.isSafeInteger(Number(timeout)) || Number(timeout) <= 0) process.exit(1);
const store = new CollectionStore(directory);
try {
  const previous = await store.read(service);
  let attempt: CollectionAttempt = { id, service, trigger: trigger as CollectionAttempt['trigger'], status: 'running', startedAt: new Date().toISOString(), finishedAt: null, errorCode: null, retryable: false, snapshotSaved: false, pid: process.pid };
  await store.write(service, { ...previous, lastAttempt: attempt });
  console.info(JSON.stringify({ started: id }));
  let settled = false;
  let cancelTimer: ReturnType<typeof setInterval> | undefined;
  const finish = async (result: CollectionAttempt) => {
    if (settled) return;
    settled = true;
    clearInterval(cancelTimer);
    await store.write(service, { lastAttempt: result, lastSuccessAt: result.status === 'succeeded' ? result.finishedAt : previous.lastSuccessAt });
    console.info(JSON.stringify({ finished: result }));
  };
  // lockf가 잠금을 유지하는 동안 종료 상태를 저장한 다음 나간다.
  // 그룹에 먼저 SIGTERM을 보내면 잠금이 먼저 풀려 새 실행의 상태를 덮을 수 있다.
  let checkingCancel = false;
  if (service === 'youtube') cancelTimer = setInterval(() => {
    if (settled || checkingCancel) return;
    checkingCancel = true;
    void (async () => {
      if (!await store.cancelRequested(id) || settled) return;
      await finish({ ...attempt, status: 'cancelled', errorCode: 'CANCELLED', retryable: false, finishedAt: new Date().toISOString() });
      process.exit(1);
    })().catch(() => { process.exitCode = 1; }).finally(() => { checkingCancel = false; });
  }, 100);
  const timer = setTimeout(() => {
    void finish({ ...attempt, status: 'failed', errorCode: 'TIMEOUT', retryable: true, finishedAt: new Date().toISOString() })
      .finally(() => process.exit(1));
  }, Number(timeout));
  try {
    if (service === 'ghost' ? !process.env.GHOST_ADMIN_API_URL || !process.env.GHOST_ADMIN_API_KEY || !process.env.GHOST_METRICS_DIR : !process.env.YOUTUBE_DATA_API_KEY || !process.env.YOUTUBE_METRICS_DIR) throw new CollectionError('NOT_CONFIGURED');
    if (service === 'ghost') {
      await collectGhostMetrics({ apiUrl: process.env.GHOST_ADMIN_API_URL ?? '', adminKey: process.env.GHOST_ADMIN_API_KEY ?? '', outputDirectory: process.env.GHOST_METRICS_DIR ?? '' });
      attempt.snapshotSaved = true;
    } else {
      const { snapshot, file } = await collectYouTubeMetrics({ apiKey: process.env.YOUTUBE_DATA_API_KEY ?? '', outputDirectory: process.env.YOUTUBE_METRICS_DIR ?? '', analytics: new YouTubeAnalyticsCollector() });
      attempt.snapshotSaved = true;
      attempt.snapshotFile = relative(process.env.YOUTUBE_METRICS_DIR!, file);
      const analytics = snapshot.analytics!;
      if (analytics.status !== 'succeeded') {
        const codes = [analytics.errorCode, ...analytics.videos.map(v => v.errorCode)].filter((v): v is NonNullable<typeof v> => !!v);
        const code = analytics.status === 'not_connected' ? 'NOT_CONNECTED' : codes.find(c => !retryableCollectionCode(c)) ?? codes[0] ?? 'ANALYTICS_FAILED';
        attempt.errorCode = code; attempt.retryable = retryableCollectionCode(code);
      }
    }
    attempt.status = attempt.errorCode ? 'partial' : 'succeeded';
  } catch (error) { const code = safeCollectionCode(error); attempt.status = 'failed'; attempt.errorCode = code; attempt.retryable = retryableCollectionCode(code); }
  attempt = { ...attempt, finishedAt: new Date().toISOString() };
  clearTimeout(timer);
  await finish(attempt);
  process.exitCode = attempt.status === 'succeeded' ? 0 : 1;
} catch { process.exitCode = 1; }
