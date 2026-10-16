import { useCallback, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fmt } from './format';
import { Notice } from './ui';
import { useDashboardPolling } from './dashboard-state';
import { getCollectionStatus, startMetricsCollection } from './metrics-api';
import type { CollectionStatus, MetricService } from '../shared/metrics-collection';

/** 수집 상태 조회는 카드가 맡는다. 지표 상세(팝오버)를 닫아도 수집이 끝나면 카드가 다시 읽는다. */
export function useMetricsCollection(service: MetricService, onCollected: () => Promise<void>) {
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const previous = useRef<string | null>(null);
  const polling = useRef(false);
  const current = status?.services[service];
  const running = pending || current?.lastAttempt?.status === 'running';
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const value = await getCollectionStatus();
      const attempt = value.services[service].lastAttempt;
      const key = attempt ? `${attempt.id}:${attempt.status}` : '';
      if (previous.current !== null && key !== previous.current && attempt && attempt.status !== 'running') await onCollected();
      previous.current = key; setStatus(value); setPollError('');
    } catch { setPollError('수집 상태를 확인하지 못했습니다.'); }
    finally { polling.current = false; }
  }, [service, onCollected]);
  useDashboardPolling(poll, running ? 2000 : 60000);
  const start = async () => {
    setPending(true); setError('');
    try { await startMetricsCollection(service); await poll(); }
    catch (e) { setError(e instanceof Error ? e.message : '수집을 시작하지 못했습니다.'); await poll(); }
    finally { setPending(false); }
  };
  return { status, current, attempt: current?.lastAttempt ?? null, running, error, pollError, start };
}
export type MetricsCollection = ReturnType<typeof useMetricsCollection>;

const reauthCodes = ['REAUTH_REQUIRED', 'NOT_CONNECTED', 'AUTH_FAILED'];
/** 지표 상세의 수집 구역: 자동 수집 예약 · 최근 수집 결과 · 재시도 예정 · 안내. '지금 수집' 버튼은 CollectButton */
export function MetricsCollectionControl({ collection }: { collection: MetricsCollection }) {
  const { status, current, attempt, running, error, pollError } = collection;
  const failed = !running && (attempt?.status === 'failed' || attempt?.status === 'partial');
  return <section className="metric-collect" aria-label="지표 수집">
    <dl className="metric-collect__facts">
      <div><dt><Icon name="clock" className="i--xs" />자동 수집</dt><dd>{status ? status.schedule.registered ? '매일 09:00 KST' : '이 Mac에 예약 없음' : '확인 중'}</dd></div>
      <div><dt><Icon name={running ? 'refresh' : failed ? 'alert' : 'check'} className="i--xs" />최근 수집</dt>
        <dd role="status">{running ? '수집 중…' : attempt ? attempt.status === 'succeeded' ? `${fmt.when(attempt.finishedAt ?? attempt.startedAt)} 성공` : `${fmt.when(attempt.finishedAt ?? attempt.startedAt)} ${attempt.status === 'cancelled' ? '취소됨' : attempt.snapshotSaved ? '일부 실패' : '실패'}` : current?.lastSuccessAt ? `${fmt.when(current.lastSuccessAt)} 성공` : '기록 없음'}</dd></div>
      {current?.nextRetryAt && <div><dt><Icon name="restart" className="i--xs" />재시도 예정</dt><dd>{fmt.at(current.nextRetryAt)}</dd></div>}
    </dl>
    {running && <span className="bar bar--busy metric-collect__bar" aria-hidden="true"><i /></span>}
    {failed && attempt && <Notice icon="alert" attention role="status">
      {attempt.snapshotSaved ? '공개 지표는 저장했고 일부 수집이 실패했습니다' : '최근 수집이 실패했습니다'} <span className="mono">({attempt.errorCode})</span>
      {attempt.errorCode && reauthCodes.includes(attempt.errorCode) && ' 수집 Mac에서 재인증한 뒤 지금 수집을 눌러 주세요.'}
    </Notice>}
    {current?.available === false && <Notice icon="info">이 Mac은 수집 담당이 아닙니다. 수집 담당 Mac에서 실행해 주세요.</Notice>}
    {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    {pollError && <Notice icon="alert" attention role="alert">{pollError}</Notice>}
  </section>;
}

export function CollectButton({ collection }: { collection: MetricsCollection }) {
  const { running, current, start } = collection;
  return <button type="button" className={`btn btn--line btn--sm${running ? ' is-busy' : ''}`} disabled={running || !current?.available} onClick={() => void start()}>
    <Icon name="refresh" />{running ? '수집 중…' : '지금 수집'}
  </button>;
}
