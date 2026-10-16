import { lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isYouTubeSnapshot, youtubeDate, publicYouTubeAnalytics } from '../../shared/youtube-metrics.js';
import type { YouTubeSnapshot, YouTubeMetricsSummary } from '../../shared/youtube-metrics.js';
import { MetricsError, previousDate } from './reader.js';

export class YouTubeMetricsReader {
  constructor(private directory = process.env.YOUTUBE_METRICS_DIR ?? '') {}
  async summary(now = new Date()): Promise<YouTubeMetricsSummary> {
    if (!this.directory || !isAbsolute(this.directory)) throw new MetricsError('NOT_CONFIGURED');
    const today = youtubeDate(now);
    const root = join(this.directory, 'snapshots');
    let current: YouTubeSnapshot | null = null;
    const latest = new Map<string, YouTubeSnapshot>();
    let invalidFiles = 0;
    try {
      if (!(await lstat(this.directory)).isDirectory()) throw new Error();
      try { if (!(await lstat(root)).isDirectory()) throw new Error(); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MetricsError('NO_DATA');
        throw error;
      }
      for (const date of await readdir(root, { withFileTypes: true })) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date.name) || date.name > today) continue;
        if (date.isSymbolicLink()) { invalidFiles++; continue; }
        if (!date.isDirectory()) continue;
        for (const file of await readdir(join(root, date.name), { withFileTypes: true })) {
          if (!file.name.endsWith('.json')) continue;
          if (!file.isFile() || file.isSymbolicLink()) { invalidFiles++; continue; }
          try {
            const handle = await open(join(root, date.name, file.name), constants.O_RDONLY | constants.O_NOFOLLOW);
            let raw: string;
            try { if ((await handle.stat()).size > 1024 * 1024) throw new Error(); raw = await handle.readFile('utf8'); }
            finally { await handle.close(); }
            const value: unknown = JSON.parse(raw);
            if (!isYouTubeSnapshot(value) || value.metricDate !== date.name || Date.parse(value.collectedAt) > now.getTime()) throw new Error();
            const previous = latest.get(value.metricDate);
            if (!previous || Date.parse(value.collectedAt) > Date.parse(previous.collectedAt)
              || (Date.parse(value.collectedAt) === Date.parse(previous.collectedAt) && value.collectionId > previous.collectionId)) latest.set(value.metricDate, value);
            if (!current || Date.parse(value.collectedAt) > Date.parse(current.collectedAt)
              || (Date.parse(value.collectedAt) === Date.parse(current.collectedAt) && value.collectionId > current.collectionId)) current = value;
          } catch { invalidFiles++; }
        }
      }
    } catch (error) { if (error instanceof MetricsError) throw error; throw new MetricsError('STORAGE_FAILED'); }
    if (!current) throw new MetricsError(invalidFiles ? 'INVALID_DATA' : 'NO_DATA');
    const before = latest.get(previousDate(current.metricDate));
    const previous = before ? { metricDate: before.metricDate, collectedAt: before.collectedAt,
      totalViews: before.totalViews, totalLikes: before.totalLikes } : null;
    const delta = before ? { views: current.totalViews - before.totalViews, likes: current.totalLikes - before.totalLikes } : null;
    // 파일에 추가 필드가 섞여 있어도 공개 지표만 반환한다.
    const { schemaVersion, service, channelId, uploadYear, selection, timeZone, metricDate, collectedAt,
      collectorId, collectionId, status, totalViews, totalLikes } = current;
    return { current: { schemaVersion, service, channelId, uploadYear, selection, timeZone, metricDate, collectedAt,
      collectorId, collectionId, status, totalViews, totalLikes, ...(current.analytics ? { analytics: publicYouTubeAnalytics(current.analytics) } : {}),
      videos: current.videos.map(({ id, title, publishedAt, durationSeconds, views, likes }) =>
        ({ id, title, publishedAt, durationSeconds, views, likes })) }, previous, delta, stale: current.metricDate !== today, invalidFiles };
  }
}
