import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { fmt } from './format';
import { EmptyState, IconButton, Popover, Skel } from './ui';
import { MetricsApiError } from './metrics-api';
import type { MetricsCollection } from './MetricsCollectionControl';

/** 지표 카드 틀(시안 cards.metricCard): 제목 · 자세히(올렸을 때) · 본문 · 아래 줄. 자세히는 카드 오른쪽에 붙는 팝오버 */
export function MetricCard({ kind, title, icon, body, foot, detail }: {
  kind: 'youtube' | 'newsletter'; title: string; icon: string; body: ReactNode; foot: ReactNode;
  detail: { caption: string; content: ReactNode; foot: ReactNode; busy: boolean; onReload: () => void };
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = `metric-${kind}`;
  const close = (restore: boolean) => { setOpen(false); if (restore) button.current?.focus(); };
  return <section className="card metric" aria-labelledby={titleId}>
    <header className="card__head">
      <h2 className="card__title" id={titleId}><Icon name={icon} />{title}</h2>
      <div className="card__tools"><IconButton ref={button} icon="arrow-up-right" label={`${title} 지표 자세히`} tip="자세히 · 수집" size="sm" className="reveal" aria-haspopup="dialog" onClick={() => setOpen(value => !value)} /></div>
    </header>
    <div className="card__body metric__body">{body}</div>
    {foot}
    {open && button.current && <Popover anchor={button.current} label={`${title} 지표 자세히`} placement="right-start" className="popover--metric metric-detail" onClose={close}>
      <div className="popover__head">
        <h2>{title} 지표</h2><span className="caption">{detail.caption}</span>
        <IconButton icon="refresh" label={`${title} 지표 다시 읽기`} tip="다시 읽기" size="sm" busy={detail.busy} disabled={detail.busy} onClick={detail.onReload} />
      </div>
      <div className="popover__body">{detail.content}</div>
      <div className="popover__foot">{detail.foot}</div>
    </Popover>}
  </section>;
}

/** 큰 숫자 · 설명 · 전일 대비. 감소도 빨간색 없이 화살표로만 구분한다 */
export function MetricFigure({ total, unit, label, delta }: { total: number; unit: string; label: string; delta: number | null }) {
  return <div className="metric__figure">
    <p className="metric__value figure">{fmt.num(total)}<small>{unit}</small></p>
    <p className="metric__label caption">{label}</p>
    <p className="metric__delta">
      {delta === null ? <span className="delta delta--none">전일 비교 불가</span>
        : delta === 0 ? <span className="delta delta--none">변동 없음</span>
          : <span className="delta" aria-label={`전일 대비 ${fmt.signed(delta)}${unit}`}><Icon name={delta > 0 ? 'arrow-up' : 'arrow-down'} />{fmt.num(Math.abs(delta))}</span>}
      {delta !== null && delta !== 0 && <span className="caption" aria-hidden="true">전일 대비</span>}
    </p>
  </div>;
}

export function MetricSkeleton() {
  return <div className="metric__skel" role="status" aria-label="지표를 불러오는 중"><Skel width="70%" height={28} /><Skel width="85%" /><Skel width="48%" height={20} /></div>;
}

/** 자료가 없을 때: 미설정 · 아직 수집 없음 · 읽기 실패 */
export function MetricEmpty({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const code = error instanceof MetricsApiError ? error.code : '';
  if (code === 'NOT_CONFIGURED') return <EmptyState icon="folder" title="지표 폴더 미설정" text="서버의 지표 저장 경로를 설정하면 표시됩니다." />;
  if (code === 'NO_DATA') return <EmptyState icon="clock" title="아직 수집한 지표가 없습니다" text="자세히에서 지금 수집하거나 오전 9시 자동 수집을 기다려 주세요." />;
  return <EmptyState icon="alert" title="지표를 읽지 못했습니다" text={error instanceof Error ? error.message : '저장된 지표 파일을 확인해 주세요.'} role="alert"
    action={<button type="button" className="btn btn--line btn--sm" onClick={onRetry}><Icon name="refresh" />다시 시도</button>} />;
}

/** 카드 아래 줄: 수집 시각 · 수집 중 · 갱신 필요(오늘 수집본 없음) · 이전 결과(조회 실패) */
export function MetricFoot({ collectedAt, metricDate, stale, failed, collection, onRetry }: {
  collectedAt: string; metricDate: string; stale: boolean; failed: boolean; collection: MetricsCollection; onRetry: () => void;
}) {
  if (collection.running) return <p className="card__foot"><span className="dot dot--live" aria-hidden="true" /><span role="status">지표 수집 중…</span></p>;
  if (failed) return <p className="card__foot"><span className="dot dot--attention" aria-hidden="true" /><span title={`조회 실패 · ${fmt.when(collectedAt)} 수집 결과`}>이전 결과</span>
    <button type="button" className="btn btn--ghost btn--sm metric__retry" onClick={onRetry}>다시 시도</button></p>;
  if (stale) return <p className="card__foot"><span className="dot dot--attention" aria-hidden="true" /><span>갱신 필요 · {fmt.md(`${metricDate}T12:00:00+09:00`)} 기준</span></p>;
  return <p className="card__foot"><span>수집 {fmt.when(collectedAt)}</span></p>;
}
