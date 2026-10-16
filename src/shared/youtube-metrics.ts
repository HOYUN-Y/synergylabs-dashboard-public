export const YOUTUBE_CHANNEL_ID = 'UC5rNmuHOcD26NadZ3KguS2g';
export const YOUTUBE_UPLOAD_YEAR = 2026;
export const YOUTUBE_ANALYTICS_ERRORS = ['REAUTH_REQUIRED', 'SERVICE_UNAVAILABLE', 'NETWORK', 'INVALID_RESPONSE', 'ACCESS_DENIED', 'RATE_LIMIT',
  'AUTH_FAILED', 'KEYCHAIN_FAILED', 'STORAGE_FAILED', 'WRONG_CHANNEL', 'CONFIG_CHANGED', 'ANALYTICS_FAILED'] as const;
export type YouTubeAnalyticsError = typeof YOUTUBE_ANALYTICS_ERRORS[number];
export interface YouTubeRetentionVideo {
  videoId: string;
  status: 'available' | 'no_data' | 'not_applicable' | 'error';
  requestedStartDate: string;
  requestedEndDate: string;
  audienceWatchRatio?: number;
  totalSegmentImpressions?: number;
  segmentStartSeconds?: number;
  segmentEndSeconds?: number;
  errorCode?: YouTubeAnalyticsError;
}
export interface YouTubeAnalytics {
  status: 'not_connected' | 'succeeded' | 'partial' | 'failed';
  videos: YouTubeRetentionVideo[];
  averageAudienceWatchRatio: number | null;
  availableVideos: number;
  errorCode?: YouTubeAnalyticsError;
}
export interface YouTubeVideoMetric {
  id: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
}
export interface YouTubeSnapshot {
  schemaVersion: 1;
  service: 'youtube';
  channelId: string;
  uploadYear: number;
  selection: 'public-videos-tab';
  timeZone: 'Asia/Seoul';
  metricDate: string;
  collectedAt: string;
  collectorId: 'primary-mac';
  collectionId: string;
  status: 'succeeded';
  videos: YouTubeVideoMetric[];
  totalViews: number;
  totalLikes: number;
  analytics?: YouTubeAnalytics;
}
export interface YouTubeMetricsSummary {
  current: YouTubeSnapshot;
  previous: Pick<YouTubeSnapshot, 'metricDate' | 'collectedAt' | 'totalViews' | 'totalLikes'> | null;
  delta: { views: number; likes: number } | null;
  stale: boolean;
  invalidFiles: number;
}
export const youtubeDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const youtubeCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isYouTubeSnapshot(value: unknown): value is YouTubeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as YouTubeSnapshot;
  if (v.schemaVersion !== 1 || v.service !== 'youtube' || v.channelId !== YOUTUBE_CHANNEL_ID
    || v.uploadYear !== YOUTUBE_UPLOAD_YEAR || v.selection !== 'public-videos-tab' || v.timeZone !== 'Asia/Seoul'
    || v.collectorId !== 'primary-mac' || v.status !== 'succeeded' || typeof v.collectedAt !== 'string'
    || !Number.isFinite(Date.parse(v.collectedAt)) || v.metricDate !== youtubeDate(new Date(v.collectedAt))
    || typeof v.collectionId !== 'string' || !/^[a-f0-9-]{36}$/.test(v.collectionId)
    || !Array.isArray(v.videos) || !youtubeCount(v.totalViews) || !youtubeCount(v.totalLikes)) return false;
  const ids = new Set<string>();
  for (const video of v.videos) {
    if (!video || typeof video.id !== 'string' || !/^[\w-]{11}$/.test(video.id) || ids.has(video.id)
      || typeof video.title !== 'string' || !video.title || video.title.length > 1000
      || typeof video.publishedAt !== 'string' || !Number.isFinite(Date.parse(video.publishedAt))
      || !youtubeDate(new Date(video.publishedAt)).startsWith(`${v.uploadYear}-`)
      || !youtubeCount(video.durationSeconds) || !video.durationSeconds || !youtubeCount(video.views) || !youtubeCount(video.likes)) return false;
    ids.add(video.id);
  }
  return (v.analytics === undefined || isYouTubeAnalytics(v.analytics, v.videos))
    && v.totalViews === v.videos.reduce((sum, video) => sum + video.views, 0)
    && v.totalLikes === v.videos.reduce((sum, video) => sum + video.likes, 0);
}
export function isYouTubeAnalytics(a: YouTubeAnalytics, videos: YouTubeVideoMetric[]) {
  if (!a || !['not_connected', 'succeeded', 'partial', 'failed'].includes(a.status) || !Array.isArray(a.videos)
    || !youtubeCount(a.availableVideos) || (a.errorCode !== undefined && !YOUTUBE_ANALYTICS_ERRORS.includes(a.errorCode))) return false;
  const ids = new Set<string>();
  const available: number[] = [];
  let errors = 0;
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  for (const r of a.videos) {
    const video = videos.find(v => v.id === r?.videoId);
    if (!r || !video || ids.has(r.videoId) || !['available', 'no_data', 'not_applicable', 'error'].includes(r.status)
      || !date(r.requestedStartDate) || !date(r.requestedEndDate)) return false;
    ids.add(r.videoId);
    if (r.status === 'available') {
      if (typeof r.audienceWatchRatio !== 'number' || !Number.isFinite(r.audienceWatchRatio) || r.audienceWatchRatio < 0
        || !youtubeCount(r.totalSegmentImpressions) || typeof r.segmentStartSeconds !== 'number' || typeof r.segmentEndSeconds !== 'number'
        || !Number.isFinite(r.segmentStartSeconds) || !Number.isFinite(r.segmentEndSeconds)
        || r.segmentStartSeconds < 0 || r.segmentStartSeconds > 30 || r.segmentEndSeconds <= 30 || r.segmentEndSeconds > video.durationSeconds
        || r.requestedStartDate > r.requestedEndDate) return false;
      available.push(r.audienceWatchRatio);
    }
    if (r.status === 'error') {
      if (!r.errorCode || !YOUTUBE_ANALYTICS_ERRORS.includes(r.errorCode)) return false;
      errors++;
    } else if (r.errorCode !== undefined) return false;
  }
  const mean = available.length ? available.reduce((sum, ratio) => sum + ratio, 0) / available.length : null;
  if (a.availableVideos !== available.length || a.averageAudienceWatchRatio !== mean) return false;
  if (a.status === 'not_connected') return !a.videos.length && !a.errorCode;
  if (a.status === 'failed' && !a.videos.length) return !!a.errorCode;
  return a.videos.length === videos.length && (a.status === 'succeeded' ? errors === 0
    : a.status === 'failed' ? errors === videos.length && errors > 0 : errors > 0 && errors < videos.length);
}
export function publicYouTubeAnalytics(a: YouTubeAnalytics): YouTubeAnalytics {
  return { status: a.status, averageAudienceWatchRatio: a.averageAudienceWatchRatio, availableVideos: a.availableVideos,
    ...(a.errorCode ? { errorCode: a.errorCode } : {}), videos: a.videos.map(r => ({ videoId: r.videoId, status: r.status,
      requestedStartDate: r.requestedStartDate, requestedEndDate: r.requestedEndDate,
      ...(r.status === 'available' ? { audienceWatchRatio: r.audienceWatchRatio, totalSegmentImpressions: r.totalSegmentImpressions,
        segmentStartSeconds: r.segmentStartSeconds, segmentEndSeconds: r.segmentEndSeconds } : {}),
      ...(r.errorCode ? { errorCode: r.errorCode } : {}) })) };
}
