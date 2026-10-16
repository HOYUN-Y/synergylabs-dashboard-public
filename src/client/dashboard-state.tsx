import { createContext, useContext, useEffect } from 'react';
import type { RefObject } from 'react';
import { startDashboardPolling } from './dashboard-polling';
import { Skel } from './ui';

export const DashboardVisible = createContext(true);

export function useDashboardPolling(refresh: () => void, interval: number, lastSuccess?: RefObject<number>) {
  const visible = useContext(DashboardVisible);
  useEffect(() => {
    if (visible) return startDashboardPolling(refresh, interval, lastSuccess);
  }, [visible, refresh, interval, lastSuccess]);
  return visible;
}

/** 카드 머리의 상태 칩: 정상일 때는 표시하지 않고 미연결 · 갱신 필요 · 조회 실패일 때만 나타난다(시안 .state-chip) */
export function CardStatus({ label, quiet, tip }: { label: string | null; quiet?: boolean; tip?: string }) {
  return label ? <span className={`state-chip${quiet ? ' state-chip--quiet' : ''}`} data-tip={tip || undefined}>{label}</span> : null;
}

/** 불러오는 중: 회색 막대가 천천히 깜박인다 */
export function CardSkeleton({ label = '자료 조회 중', rows = 2 }: { label?: string; rows?: number }) {
  return <div className="card-skel" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, i) => <div key={i}><Skel width="36%" /><Skel width="82%" /></div>)}
  </div>;
}
