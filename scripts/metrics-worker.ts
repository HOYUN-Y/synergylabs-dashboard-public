import { collectGhostMetrics } from '../src/server/metrics/ghost.js';
import { collectYouTubeMetrics } from '../src/server/metrics/youtube.js';
import { YouTubeAnalyticsCollector } from '../src/server/metrics/youtube-analytics.js';
import { CollectionError, CollectionStore, retryableCollectionCode, safeCollectionCode } from '../src/server/metrics/collection-store.js';
import { isMetricService } from '../src/shared/metrics-collection.js';
import type { CollectionAttempt } from '../src/shared/metrics-collection.js';

const [service, trigger, id, directory, timeout] = process.argv.slice(2);
if (!isMetricService(service) || !['manual', 'scheduled'].includes(trigger) || !/^[a-f0-9-]{36}$/.test(id ?? '') || !directory || !Number.isSafeInteger(Number(timeout)) || Number(timeout) <= 0) process.exit(1);
const store = new CollectionStore(directory);
try {
  const previous = await store.read(service);
  let attempt: CollectionAttempt = { id, service, trigger: trigger as CollectionAttempt['trigger'], status: 'running', startedAt: new Date().toISOString(), finishedAt: null, errorCode: null, retryable: false, snapshotSaved: false, pid: process.pid };
  await store.write(service, { ...previous, lastAttempt: attempt });
  console.info(JSON.stringify({ started: id }));
  let settled = false;
  const finish = async (result: CollectionAttempt) => {
    if (settled) return;
    settled = true;
    await store.write(service, { lastAttempt: result, lastSuccessAt: result.status === 'succeeded' ? result.finishedAt : previous.lastSuccessAt });
    console.info(JSON.stringify({ finished: result }));
  };
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
      const { snapshot } = await collectYouTubeMetrics({ apiKey: process.env.YOUTUBE_DATA_API_KEY ?? '', outputDirectory: process.env.YOUTUBE_METRICS_DIR ?? '', analytics: new YouTubeAnalyticsCollector() });
      attempt.snapshotSaved = true;
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
