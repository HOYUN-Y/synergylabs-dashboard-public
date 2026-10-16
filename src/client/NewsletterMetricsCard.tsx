import { fmt } from './format';
import { MetricCard, MetricEmpty, MetricFigure, MetricFoot, MetricSkeleton } from './MetricDetails';
import { CollectButton, MetricsCollectionControl, useMetricsCollection } from './MetricsCollectionControl';
import { Notice } from './ui';
import { useDashboardPolling } from './dashboard-state';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GhostMetricsSummary } from '../shared/metrics';
import { todayKst } from '../shared/calendar';
import { getGhostMetrics, MetricsApiError } from './metrics-api';

const day = (date: string) => date === todayKst() ? '오늘' : fmt.md(`${date}T12:00:00+09:00`);
export function NewsletterMetricsCard() {
  const [result, setResult] = useState<GhostMetricsSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  const lastSuccess = useRef(0);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const data = await getGhostMetrics(controller.signal);
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
  const collection = useMetricsCollection('ghost', refresh);
  const message = error instanceof Error ? error.message : '';
  const current = result?.current;
  const manual = (source: string | null) => source === 'manual' ? ' · 사용자 확인값' : '';
  const body = current ? <MetricFigure total={current.subscribedMembers} unit="명" label={`구독자 · 이메일 수신 중${manual(current.source)}`} delta={result!.delta} />
    : busy ? <MetricSkeleton /> : <MetricEmpty error={error} onRetry={() => void refresh()} />;
  return <MetricCard kind="newsletter" title="뉴스레터" icon="newsletter" body={body}
    foot={current && <MetricFoot collectedAt={current.collectedAt} metricDate={current.metricDate} stale={result!.stale} failed={!!error} collection={collection} onRetry={() => void refresh()} />}
    detail={{
      caption: 'Ghost · 이메일 수신 구독자', busy, onReload: () => void refresh(), foot: <CollectButton collection={collection} />,
      content: <>
        {result && current && <>
          <table className="metric-detail__table"><caption className="sr-only">최근 7일 구독자 · 한국시간</caption>
            <thead><tr><th scope="col">날짜</th><th scope="col">구독자</th><th scope="col">증감</th></tr></thead>
            <tbody>{[...result.history].reverse().map(row => <tr key={row.metricDate}>
              <td>{day(row.metricDate)}{row.source === 'manual' && <span className="caption"> · 확인값</span>}</td>
              <td className="tnum">{row.subscribedMembers === null ? <span className="metric-detail__none" data-tip="수집값 없음">—<span className="sr-only">수집값 없음</span></span> : fmt.num(row.subscribedMembers)}</td>
              <td className="tnum">{row.delta === null ? <span className="metric-detail__none" data-tip="비교할 수집값 없음">—<span className="sr-only">비교 불가</span></span> : fmt.signed(row.delta)}</td>
            </tr>)}</tbody>
          </table>
          <p className="caption">{current.source === 'manual' ? '기록' : '수집'} {fmt.when(current.collectedAt)} · 출처 {current.source === 'manual' ? '사용자 확인값' : 'Ghost Admin API'}. 증감은 두 날짜 집계값의 차이이며 신규 가입 수가 아닙니다. —는 수집값이 없는 날입니다.</p>
          {result.stale && <Notice icon="clock" attention>오늘 수집본이 없어 {day(current.metricDate)} 수집본을 보여 줍니다.</Notice>}
          {result.invalidFiles > 0 && <Notice icon="alert" attention role="status">읽을 수 없는 지표 파일 {result.invalidFiles}개를 제외했습니다.</Notice>}
        </>}
        {message && <Notice icon="alert" attention role="alert">{result ? `다시 읽지 못해 이전 결과를 보여 줍니다. ${message}` : message}</Notice>}
        <MetricsCollectionControl collection={collection} />
      </>
    }} />;
}
