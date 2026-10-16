import { Icon } from './Icon';
import { fmt } from './format';
import { MetricCard, MetricEmpty, MetricFigure, MetricFoot, MetricSkeleton } from './MetricDetails';
import { CollectButton, MetricsCollectionControl, useMetricsCollection } from './MetricsCollectionControl';
import { Notice } from './ui';
import { useDashboardPolling } from './dashboard-state';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { YouTubeMetricsSummary, YouTubeRetentionVideo } from '../shared/youtube-metrics';
import { getYouTubeMetrics, MetricsApiError } from './metrics-api';

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
function retentionText(retention: YouTubeRetentionVideo | undefined) {
  if (!retention) return { value: '—', detail: '유지율 수집본 없음' };
  if (retention.status === 'available') return { value: percent(retention.audienceWatchRatio!),
    detail: `30초 부근 ${percent(retention.audienceWatchRatio!)} · 구간 조회 ${fmt.num(retention.totalSegmentImpressions!)}회 · ${retention.segmentStartSeconds!.toFixed(2)}~${retention.segmentEndSeconds!.toFixed(2)}초` };
  return { value: '—', detail: retention.status === 'no_data' ? '30초 구간 데이터 없음' : retention.status === 'not_applicable' ? '30초 이하 영상 · 평균에서 제외' : '유지율 조회 실패' };
}

export function YouTubeMetricsCard() {
  const [result, setResult] = useState<YouTubeMetricsSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  const lastSuccess = useRef(0);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const data = await getYouTubeMetrics(controller.signal);
      if (!controller.signal.aborted) { setResult(data); lastSuccess.current = Date.now(); }
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof MetricsApiError && ['NOT_CONFIGURED', 'NO_DATA', 'INVALID_DATA'].includes(e.code)) setResult(null);
        setError(e);
      }
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }, []);
  useDashboardPolling(refresh, 300000, lastSuccess);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const collection = useMetricsCollection('youtube', refresh);
  const [facet, setFacet] = useState<'views' | 'likes'>('views');
  const message = error instanceof Error ? error.message : '';
  const current = result?.current;
  const analytics = current?.analytics;
  const authRequired = analytics?.errorCode === 'REAUTH_REQUIRED' || analytics?.videos.some(v => v.errorCode === 'REAUTH_REQUIRED');
  const scope = current ? `${current.uploadYear} 롱폼 ${current.videos.length}편` : '';
  const facets = current ? {
    views: { total: current.totalViews, unit: '회', label: `조회수 합계 · ${scope}`, delta: result!.delta?.views ?? null },
    likes: { total: current.totalLikes, unit: '개', label: `좋아요 합계 · ${scope}`, delta: result!.delta?.likes ?? null }
  } : null;
  const next = facet === 'views' ? '좋아요' : '조회수';
  const period = analytics?.videos.find(v => v.requestedStartDate);
  const body = facets ? <button type="button" className="metric__switch" data-tip={`${next} 보기`} data-tip-delay="300" onClick={() => setFacet(facet === 'views' ? 'likes' : 'views')}>
    <MetricFigure {...facets[facet]} />
    <span className="metric__dots" aria-hidden="true"><i className={facet === 'views' ? 'is-on' : undefined} /><i className={facet === 'likes' ? 'is-on' : undefined} /></span>
    <span className="sr-only">눌러서 {next} 보기</span>
  </button> : busy ? <MetricSkeleton /> : <MetricEmpty error={error} onRetry={() => void refresh()} />;
  return <MetricCard kind="youtube" title="유튜브" icon="youtube" body={body}
    foot={current && <MetricFoot collectedAt={current.collectedAt} metricDate={current.metricDate} stale={result!.stale} failed={!!error} collection={collection} onRetry={() => void refresh()} />}
    detail={{
      caption: current ? `${current.uploadYear} 롱폼 · 누적` : '공개 롱폼 · 누적', busy, onReload: () => void refresh(),
      foot: <><a className="btn btn--ghost btn--sm" href="https://studio.youtube.com/" target="_blank" rel="noreferrer">YouTube Studio<Icon name="arrow-up-right" /></a><CollectButton collection={collection} /></>,
      content: <>
        {current && <>
          <dl className="metric-detail__facts">
            <div><dt>조회수</dt><dd>{fmt.num(current.totalViews)}</dd></div>
            <div><dt>좋아요</dt><dd>{fmt.num(current.totalLikes)}</dd></div>
            <div><dt>30초 유지율</dt><dd>{analytics?.averageAudienceWatchRatio == null ? '—' : percent(analytics.averageAudienceWatchRatio)}</dd></div>
          </dl>
          {current.videos.length === 0 ? <p className="caption">해당 연도의 공개 롱폼이 없습니다.</p>
            : <table className="metric-detail__table"><caption className="sr-only">영상별 지표</caption>
              <thead><tr><th scope="col">영상</th><th scope="col">조회</th><th scope="col">30초</th></tr></thead>
              <tbody>{current.videos.map(video => {
                const retention = retentionText(analytics?.videos.find(v => v.videoId === video.id));
                return <tr key={video.id}>
                  <td className="ellipsis"><a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" title={`${video.title} · 좋아요 ${fmt.num(video.likes)}개`}>{video.title}</a></td>
                  <td className="tnum">{fmt.num(video.views)}</td>
                  <td className="tnum" data-tip={retention.detail}>{retention.value}{retention.value === '—' && <span className="sr-only">{retention.detail}</span>}</td>
                </tr>;
              })}</tbody></table>}
          {!analytics ? <p className="caption">이 수집본에는 30초 유지율이 없습니다.</p> : <>
            {analytics.status === 'not_connected' && <Notice icon="plug">30초 유지율을 모으려면 이 Mac에서 YouTube 최초 인증이 필요합니다.</Notice>}
            {(analytics.status === 'failed' || analytics.status === 'partial') && <Notice icon="alert" attention role="status">{authRequired ? 'YouTube 재인증이 필요합니다.' : '일부 유지율을 조회하지 못했습니다.'} 공개 조회수·좋아요는 정상 수집값입니다.</Notice>}
            {analytics.status === 'succeeded' && analytics.averageAudienceWatchRatio === null && <p className="caption">아직 제공된 30초 구간 데이터가 없습니다.</p>}
            <p className="caption">30초 유지율은 영상별 단순 평균({analytics.availableVideos}/{current.videos.length}편, 업로드 이후 누적)이며 반복 재생을 포함합니다.{period && ` 분석 기간 ${period.requestedStartDate}~${period.requestedEndDate}(미국 태평양 기준).`} Analytics 처리 지연이 있을 수 있습니다.</p>
          </>}
          {result!.stale && <Notice icon="clock" attention>오늘 수집본이 없어 {fmt.md(`${current.metricDate}T12:00:00+09:00`)} 수집본을 보여 줍니다.</Notice>}
          {result!.invalidFiles > 0 && <Notice icon="alert" attention role="status">읽을 수 없는 지표 파일 {result!.invalidFiles}개를 제외했습니다.</Notice>}
        </>}
        {message && <Notice icon="alert" attention role="alert">{result ? `다시 읽지 못해 이전 결과를 보여 줍니다. ${message}` : message}</Notice>}
        <MetricsCollectionControl collection={collection} />
      </>
    }} />;
}
