import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { YOUTUBE_CHANNEL_ID, YOUTUBE_UPLOAD_YEAR, youtubeDate, youtubeCount, isYouTubeSnapshot } from '../../shared/youtube-metrics.js';
import type { YouTubeSnapshot, YouTubeVideoMetric, YouTubeAnalytics } from '../../shared/youtube-metrics.js';

export class YouTubeMetricsError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export async function listYouTubeVideos(): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)('yt-dlp', ['--ignore-config', '--no-cache-dir', '--abort-on-error',
      '--flat-playlist', '--skip-download', '--dump-single-json', `https://www.youtube.com/channel/${YOUTUBE_CHANNEL_ID}/videos`],
    { timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' } });
    const data = JSON.parse(stdout);
    if (!Array.isArray(data.entries)) throw new Error();
    return data.entries.map((v: { id?: unknown }) => v?.id);
  } catch { throw new YouTubeMetricsError('INVENTORY_FAILED'); }
}
function inventory(ids: string[]) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[\w-]{11}$/.test(id))
    || new Set(ids).size !== ids.length) throw new YouTubeMetricsError('INVALID_INVENTORY');
  return [...ids].sort();
}
function count(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !youtubeCount(Number(value))) throw new YouTubeMetricsError('INVALID_RESPONSE');
  return Number(value);
}
function duration(value: unknown) {
  const match = typeof value === 'string' ? /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value) : null;
  if (!match) throw new YouTubeMetricsError('INVALID_RESPONSE');
  const seconds = Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0);
  if (!youtubeCount(seconds) || !seconds) throw new YouTubeMetricsError('INVALID_RESPONSE');
  return seconds;
}
export async function collectYouTubeMetrics(config: { apiKey: string; outputDirectory: string; analytics?: { collect(videos: YouTubeVideoMetric[]): Promise<YouTubeAnalytics> } },
  fetcher: typeof fetch = fetch, listVideos: () => Promise<string[]> = listYouTubeVideos) {
  if (!config.apiKey.trim()) throw new YouTubeMetricsError('NOT_CONFIGURED');
  if (!isAbsolute(config.outputDirectory)) throw new YouTubeMetricsError('INVALID_OUTPUT_DIRECTORY');
  try { if (!(await stat(config.outputDirectory)).isDirectory()) throw new Error(); }
  catch { throw new YouTubeMetricsError('STORAGE_FAILED'); }
  const ids = inventory(await listVideos());
  const videos: YouTubeVideoMetric[] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({ key: config.apiKey, part: 'snippet,statistics,contentDetails,status', id: chunk.join(',') }).toString();
    let response: Response;
    try { response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new YouTubeMetricsError('NETWORK'); }
    if (!response.ok) throw new YouTubeMetricsError(`HTTP_${response.status}`);
    try {
      const data = await response.json() as { items?: unknown } | null;
      if (!data || !Array.isArray(data.items) || data.items.length !== chunk.length) throw new Error();
      const seen = new Set<string>();
      for (const item of data.items) {
        if (!chunk.includes(item.id) || seen.has(item.id) || item.snippet?.channelId !== YOUTUBE_CHANNEL_ID
          || item.status?.privacyStatus !== 'public') throw new Error();
        seen.add(item.id);
        const publishedAt = item.snippet.publishedAt;
        if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) throw new Error();
        if (!youtubeDate(new Date(publishedAt)).startsWith(`${YOUTUBE_UPLOAD_YEAR}-`)) continue;
        videos.push({ id: item.id, title: item.snippet.title, publishedAt, durationSeconds: duration(item.contentDetails?.duration),
          views: count(item.statistics?.viewCount), likes: count(item.statistics?.likeCount) });
      }
    } catch { throw new YouTubeMetricsError('INVALID_RESPONSE'); }
  }
  // 수집 중 공개 목록이 바뀌면 불완전한 합계를 저장하지 않는다.
  if (JSON.stringify(ids) !== JSON.stringify(inventory(await listVideos()))) throw new YouTubeMetricsError('INVENTORY_CHANGED');
  videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const now = new Date();
  const snapshot: YouTubeSnapshot = { schemaVersion: 1, service: 'youtube', channelId: YOUTUBE_CHANNEL_ID,
    uploadYear: YOUTUBE_UPLOAD_YEAR, selection: 'public-videos-tab', timeZone: 'Asia/Seoul', metricDate: youtubeDate(now),
    collectedAt: now.toISOString(), collectorId: 'primary-mac', collectionId: randomUUID(), status: 'succeeded', videos,
    totalViews: videos.reduce((sum, v) => sum + v.views, 0), totalLikes: videos.reduce((sum, v) => sum + v.likes, 0) };
  if (config.analytics) snapshot.analytics = await config.analytics.collect(videos);
  if (!isYouTubeSnapshot(snapshot)) throw new YouTubeMetricsError('INVALID_RESPONSE');
  const directory = join(config.outputDirectory, 'snapshots', snapshot.metricDate);
  const file = join(directory, `primary-mac_${snapshot.collectedAt.replace(/[:.]/g, '-')}_${snapshot.collectionId}.json`);
  const temporary = `${file}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } catch { throw new YouTubeMetricsError('STORAGE_FAILED'); }
  finally { await unlink(temporary).catch(() => {}); }
  return { snapshot, file };
}
