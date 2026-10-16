import { YouTubeOAuth } from './youtube-auth.js';
import { YouTubeAuthError } from './youtube-auth-store.js';
import { YOUTUBE_ANALYTICS_ERRORS, YOUTUBE_CHANNEL_ID, youtubeCount } from '../../shared/youtube-metrics.js';
import type { YouTubeAnalytics, YouTubeAnalyticsError, YouTubeRetentionVideo, YouTubeVideoMetric } from '../../shared/youtube-metrics.js';
const pacificDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
function errorCode(error: unknown): YouTubeAnalyticsError {
  return error instanceof YouTubeAuthError && YOUTUBE_ANALYTICS_ERRORS.includes(error.code as YouTubeAnalyticsError)
    ? error.code as YouTubeAnalyticsError : 'ANALYTICS_FAILED';
}
export function retentionSegment(data: Record<string, unknown>, durationSeconds: number) {
  if (!Array.isArray(data.columnHeaders) || (data.rows !== undefined && !Array.isArray(data.rows))) throw new YouTubeAuthError('INVALID_RESPONSE');
  const columns = data.columnHeaders.map(v => v?.name);
  const indices = ['elapsedVideoTimeRatio', 'audienceWatchRatio', 'totalSegmentImpressions'].map(name => columns.indexOf(name));
  if (indices.some(i => i < 0)) throw new YouTubeAuthError('INVALID_RESPONSE');
  if (durationSeconds <= 30) return null;
  const bucket = Math.floor(3000 / durationSeconds) + 1;
  const rows = (data.rows ?? []) as unknown[][];
  let found: unknown[] | undefined;
  for (const row of rows) {
    if (!Array.isArray(row) || typeof row[indices[0]] !== 'number' || !Number.isFinite(row[indices[0]])
      || Number(row[indices[0]]) <= 0 || Number(row[indices[0]]) > 1) throw new YouTubeAuthError('INVALID_RESPONSE');
    if (Math.abs(Number(row[indices[0]]) * 100 - bucket) < 1e-6) {
      if (found) throw new YouTubeAuthError('INVALID_RESPONSE');
      found = row;
    }
  }
  if (!found) return null;
  const ratio = found[indices[1]], count = found[indices[2]];
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || !youtubeCount(count)) throw new YouTubeAuthError('INVALID_RESPONSE');
  return { audienceWatchRatio: ratio, totalSegmentImpressions: count,
    segmentStartSeconds: durationSeconds * (bucket - 1) / 100, segmentEndSeconds: durationSeconds * bucket / 100 };
}
export class YouTubeAnalyticsCollector {
  constructor(private oauth = new YouTubeOAuth()) {}
  async collect(videos: YouTubeVideoMetric[], now = new Date()): Promise<YouTubeAnalytics> {
    let token: string | null;
    try { token = await this.oauth.accessToken(); }
    catch (e) { return { status: 'failed', errorCode: errorCode(e), videos: [], averageAudienceWatchRatio: null, availableVideos: 0 }; }
    if (!token) return { status: 'not_connected', videos: [], averageAudienceWatchRatio: null, availableVideos: 0 };
    const yesterday = new Date(`${pacificDate(now)}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const requestedEndDate = yesterday.toISOString().slice(0, 10);
    const result: YouTubeRetentionVideo[] = [];
    for (const video of videos) {
      const base = { videoId: video.id, requestedStartDate: pacificDate(new Date(video.publishedAt)), requestedEndDate };
      if (video.durationSeconds <= 30) { result.push({ ...base, status: 'not_applicable' }); continue; }
      if (base.requestedStartDate > requestedEndDate) { result.push({ ...base, status: 'no_data' }); continue; }
      try {
        const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
        url.search = new URLSearchParams({ ids: `channel==${YOUTUBE_CHANNEL_ID}`, startDate: base.requestedStartDate,
          endDate: requestedEndDate, dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio,totalSegmentImpressions', filters: `video==${video.id}` }).toString();
        let data: Record<string, unknown>;
        try { data = await this.oauth.json(url.href, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (error) {
          if (!(error instanceof YouTubeAuthError) || error.code !== 'REAUTH_REQUIRED') throw error;
          this.oauth.invalidate(); token = await this.oauth.accessToken();
          if (!token) throw new YouTubeAuthError('REAUTH_REQUIRED');
          data = await this.oauth.json(url.href, { headers: { Authorization: `Bearer ${token}` } });
        }
        const segment = retentionSegment(data, video.durationSeconds);
        result.push(segment ? { ...base, status: 'available', ...segment } : { ...base, status: 'no_data' });
      } catch (e) { result.push({ ...base, status: 'error', errorCode: errorCode(e) }); }
    }
    const available = result.filter(r => r.status === 'available');
    const errors = result.filter(r => r.status === 'error').length;
    return { status: errors ? errors === result.length ? 'failed' : 'partial' : 'succeeded', videos: result,
      averageAudienceWatchRatio: available.length ? available.reduce((sum, r) => sum + r.audienceWatchRatio!, 0) / available.length : null,
      availableVideos: available.length };
  }
}
