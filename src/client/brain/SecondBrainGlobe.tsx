// 메인 화면 가운데 세컨드 브레인: 작업 공간 전체 지도(GET /api/brain/graph?all=1)를 받아 가운데 구체(OrbGlobe)와 크게 연 구체(BrainCard)를 잇는다.
// 스킬 · 루틴 목록과 실행 기록은 실행 중 표시 · 자주 쓰는 목록 · 실행 단추에 쓴다
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { automationApi } from '../automation-api';
import { useDashboardPolling } from '../dashboard-state';
import { fmt } from '../format';
import { Icon } from '../Icon';
import { useSettingsRefresh } from '../settings-state';
import { EmptyState, Skel, toast } from '../ui';
import { createBrainLoader } from './loader';
import { BrainCard } from './BrainCard';
import { BrainController } from './controller';
import { buildModel } from './model';
import { OrbGlobe } from './OrbGlobe';

function Shell({ meta, children }: { meta?: string; children: ReactNode }) {
  return <section className="card orb dash__center" aria-labelledby="orb-title">
    <header className="card__head"><h2 className="card__title" id="orb-title"><Icon name="brain" />세컨드 브레인</h2>{meta && <span className="card__meta">{meta}</span>}</header>
    <div className="orb__stage orb__stage--status">{children}</div>
  </section>;
}

export function SecondBrainGlobe() {
  const [brain, setBrain] = useState<BrainController | null>(null);
  const [error, setError] = useState('');
  const [loader] = useState(() => createBrainLoader({
    loading() { setBrain(null); setError(''); },
    // 모델은 최신 응답을 받은 뒤 한 번만 계산한다.
    ready(graph) { setBrain(new BrainController(buildModel(graph))); },
    error: setError
  }));
  useSettingsRefresh('workspace', () => { void loader.reload(); });
  useEffect(() => {
    void loader.reload(false);
    return () => loader.cancel();
  }, [loader]);
  const signal = loader.signal;
  const poll = useCallback(() => {
    if (!brain || !loader.isCurrent(signal)) return;
    Promise.all([automationApi.catalog(signal), automationApi.history(signal)])
      .then(([catalog, history]) => { if (loader.isCurrent(signal)) brain.setAutomation(catalog.items, history.runs); },
        () => { /* 실행 정보 없이도 지도는 쓴다 */ });
  }, [brain, loader, signal]);
  useDashboardPolling(poll, 5000);
  useEffect(() => {
    if (!brain) return;
    brain.onRunSkill = targetId => {
      if (!loader.isCurrent(signal)) return;
      automationApi.startSaved(targetId).then(run => { if (loader.isCurrent(signal)) { toast(`‘${run.name}’ 실행을 시작했습니다`, 'play'); poll(); } },
        e => { if (loader.isCurrent(signal)) toast(e instanceof Error ? e.message : '스킬을 실행하지 못했습니다.', 'alert'); });
    };
    return () => { brain.onRunSkill = () => {}; };
  }, [brain, poll, loader, signal]);

  if (!brain) return error
    ? <Shell><EmptyState icon="alert" title="세컨드 브레인을 읽지 못했습니다" text={error} role="alert"
      action={<button type="button" className="btn btn--line btn--sm" onClick={() => { void loader.reload(); }}><Icon name="refresh" />다시 시도</button>} /></Shell>
    : <Shell><div className="orb__loading" role="status"><Skel width={150} height={150} style={{ borderRadius: '50%' }} /><p className="caption">작업 공간 지도를 만들고 있습니다</p></div></Shell>;
  const { m } = brain, key = m.graph.scannedAt;
  const router = m.graph.routerId ? m.byId.get(m.graph.routerId)?.name : null;
  const meta = `${router ?? '작업 공간'} 기준 · ${m.shownGroups.map(g => `${g.name} ${fmt.num(m.counts[g.id] ?? 0)}`).join(' · ')}`;
  return <>
    <OrbGlobe key={key} controller={brain} meta={meta} />
    {createPortal(<BrainCard key={key} controller={brain} />, document.body)}
  </>;
}
