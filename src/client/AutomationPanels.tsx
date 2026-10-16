import { Icon } from './Icon';
import { fmt } from './format';
import { CardSkeleton, CardStatus, useDashboardPolling } from './dashboard-state';
import { updateLocation, useSettingsRefresh } from './settings-state';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AutomationCatalog, AutomationRun, AutomationItem } from '../shared/automation';
import { isActive, runLabels, skillPage } from '../shared/automation';
import { automationApi } from './automation-api';
import { openSkillConversation } from './SkillConversation';
import { SkillExecutionSettings } from './SkillExecutionSettings';
import { RunHistory } from './RunParts';
import { useMetricsCollection } from './MetricsCollectionControl';
import { Elapsed, EmptyState, IconButton, Skel, closeOnBackdrop, scrollHint, toast } from './ui';

const message = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
const openSkillSettings = (id: string) => updateLocation({ settings: 'skills', skill: id });
function YouTubeSchedule() {
  const collected = useCallback(async () => {}, []);
  const { status, current, pollError } = useMetricsCollection('youtube', collected);
  return <p className="routine__state">{pollError || (!status ? '예약 확인 중' : status.schedule.registered ? '이 Mac · 매일 09:00 KST' : '이 Mac에 예약 없음')}
    {current?.nextRetryAt && ` · 재시도 ${fmt.at(current.nextRetryAt)}`}</p>;
}
/** 결과 보기: 대화가 있으면 대화 서랍, 없으면 실행 결과 창 */
const openResult = (run: AutomationRun) => run.conversationId ? openSkillConversation(run.conversationId) : updateLocation({ run: run.id });

/** 스킬 타일(시안 cards.tile): 위 — 이름(두 줄까지), 아래 — 실행 버튼과 상태. 설정은 올렸을 때만 오른쪽 위 */
function SkillTile({ item, run, blocked, onStart, onCancel, onSettings }: {
  item: AutomationItem; run: AutomationRun | undefined; blocked: boolean;
  onStart: (id: string) => void; onCancel: (id: string) => void; onSettings: (item: AutomationItem, anchor: HTMLElement) => void;
}) {
  // 모든 스킬은 입력 없이 시작하고, 필요한 내용은 '답변 필요' → 대화 서랍에서 받는다
  const state = run?.status ?? (item.ready ? 'idle' : 'unconfigured');
  let play;
  let line;
  switch (state) {
    case 'running': case 'queued':
      play = <IconButton icon="stop" label={`${item.name} 중지`} tip="중지" variant="solid" className="tile__play" disabled={blocked} onClick={() => onCancel(run!.id)} />;
      line = <><span>{runLabels[state]}</span>{state === 'running' && run!.startedAt && <Elapsed since={run!.startedAt} />}</>;
      break;
    case 'cancelling':
      play = <IconButton icon="stop" label={`${item.name} 취소 중`} tip="취소 중" variant="solid" className="tile__play" disabled />;
      line = <span>취소 중…</span>;
      break;
    case 'waiting_input':
      play = <IconButton icon="message" label={`${item.name} 답변하기`} tip="답변하기" variant="accent" className="tile__play" onClick={() => openResult(run!)} />;
      line = <><span className="dot dot--attention" aria-hidden="true" /><span>답변 필요</span></>;
      break;
    case 'needs_input':
      play = <IconButton icon="message" label={`${item.name} 대화 열기`} tip="대화 열기" variant="line" className="tile__play" onClick={() => run!.conversationId ? openResult(run!) : onStart(item.id)} />;
      line = <span>추가 작업 필요</span>;
      break;
    case 'unconfigured':
      play = <IconButton icon="play" label={`${item.name} 실행 설정`} tip={item.reason ?? '실행할 수 없습니다'} variant="line" className="tile__play" onClick={() => openSkillSettings(item.id)} />;
      line = <span>실행 불가</span>;
      break;
    default:
      play = <IconButton icon="play" label={`${item.name} 실행`} tip="실행" variant="solid" className="tile__play" disabled={blocked} onClick={() => onStart(item.id)} />;
      line = state === 'succeeded' ? <><Icon name="check" /><button type="button" data-tip="결과 보기" onClick={() => openResult(run!)}>완료 · {fmt.when(run!.finishedAt ?? run!.createdAt)}</button></>
        : state === 'failed' ? <><Icon name="alert" /><button type="button" data-tip="오류 보기" onClick={() => openResult(run!)}>실패</button></>
          : state === 'cancelled' || state === 'interrupted' ? <button type="button" data-tip="실행 결과 보기" onClick={() => openResult(run!)}>{runLabels[state]}</button>
            : <span>준비됨</span>;
  }
  const busy = state === 'running' || state === 'queued' || state === 'cancelling';
  return <article className="tile" data-state={state}>
    <a className="tile__name" href={`#/?settings=skills&skill=${encodeURIComponent(item.id)}`} title={item.description} onClick={event => { event.preventDefault(); openSkillSettings(item.id); }}>{item.name}</a>
    <div className="tile__row">{play}<p className="tile__state" aria-live="polite">{line}</p></div>
    <IconButton icon="sliders" label={`${item.name} 실행 설정`} tip="실행 도구 · 모델 · effort" size="sm" className="tile__gear" aria-haspopup="dialog" onClick={event => onSettings(item, event.currentTarget)} />
    {busy && <span className="bar bar--busy tile__bar" aria-hidden="true"><i /></span>}
  </article>;
}

/** 루틴 실행 기록: 카드의 기록 버튼으로 연다. 항목을 누르면 실행 결과 창이 위에 열린다 */
function RoutineHistory({ runs, onClose }: { runs: AutomationRun[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="dialog dialog--history" aria-labelledby="routine-history-title" onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => closeOnBackdrop(event, onClose)}>
    <header className="dialog__head"><h2 id="routine-history-title">루틴 실행 기록</h2><IconButton icon="x" label="닫기" tip="닫기 (Esc)" onClick={onClose} /></header>
    <div className="dialog__body"><RunHistory runs={runs} showName /></div>
  </dialog>;
}

export function AutomationPanels() {
  const [settings, setSettings] = useState<{ item: AutomationItem; anchor: HTMLElement } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [runError, setRunError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = runs.some(run => isActive(run.status));
  const catalogRequest = useRef<AbortController | null>(null);
  const runsRequest = useRef<AbortController | null>(null);
  const catalogDirty = useRef(true);
  const refreshRuns = useCallback(async () => {
    if (runsRequest.current) return;
    const controller = new AbortController(); runsRequest.current = controller;
    try {
      const [history, latest] = await Promise.all([automationApi.history(controller.signal), automationApi.latest(controller.signal)]);
      if (!controller.signal.aborted) { setRuns([...new Map([...history.runs, ...latest.runs].map(run => [run.id, run])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); setRunError(''); }
    }
    catch (error) { if (!controller.signal.aborted) setRunError(message(error)); }
    finally { if (runsRequest.current === controller) runsRequest.current = null; }
  }, []);
  const refresh = useCallback(async (force = false) => {
    catalogRequest.current?.abort();
    const controller = new AbortController(); catalogRequest.current = controller;
    catalogDirty.current = false; setLoading(true);
    await Promise.all([
      automationApi.catalog(controller.signal, force).then(value => { if (!controller.signal.aborted) { setCatalog(value); setCatalogError(''); } })
        .catch(error => { if (!controller.signal.aborted) setCatalogError(message(error)); }),
      refreshRuns()
    ]);
    if (catalogRequest.current === controller) { catalogRequest.current = null; setLoading(false); }
  }, [refreshRuns]);
  const poll = useCallback(() => { if (catalogDirty.current) void refresh(); else void refreshRuns(); }, [refresh, refreshRuns]);
  const visible = useDashboardPolling(poll, active ? 2000 : 10000);
  const invalidate = () => {
    catalogRequest.current?.abort(); catalogRequest.current = null;
    runsRequest.current?.abort(); runsRequest.current = null;
    catalogDirty.current = true; setCatalog(null); setCatalogError(''); setLoading(true);
    if (visible && !document.hidden) void refresh();
  };
  useSettingsRefresh('workspace', invalidate);
  useSettingsRefresh('skills', invalidate);
  useEffect(() => () => {
    catalogRequest.current?.abort(); catalogRequest.current = null;
    runsRequest.current?.abort(); runsRequest.current = null;
    catalogDirty.current = true;
  }, []);
  const start = async (id: string, saved = false) => {
    setBusy(true);
    try {
      const run = await (saved ? automationApi.startSaved(id) : automationApi.start(id));
      setRuns(old => [run, ...old.filter(item => item.id !== run.id)]);
      await refreshRuns();
    } catch (error) { toast(message(error), 'alert'); }
    finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    setBusy(true);
    try {
      const updated = await automationApi.cancel(id);
      setRuns(old => old.map(run => run.id === id ? updated : run));
    } catch (error) { toast(message(error), 'alert'); }
    finally { setBusy(false); }
  };
  // 스킬 묶음: 4개씩 한 쪽, 좌우로 넘긴다(점 · 화살표 · 트랙패드 밀기)
  const first = skillPage(catalog?.items ?? [], query, 0);
  const pages = Array.from({ length: first.pages }, (_, index) => skillPage(catalog?.items ?? [], query, index).items);
  const current = Math.min(page, first.pages - 1);
  const go = (index: number, instant = false) => {
    const next = Math.max(0, Math.min(index, first.pages - 1)); setPage(next);
    track.current?.scrollTo({ left: next * track.current.clientWidth, behavior: instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  // 창 크기가 바뀌거나 쪽 수가 줄어도 보던 쪽에 맞춘다
  useLayoutEffect(() => {
    const element = track.current; if (!element) return;
    const align = () => { element.scrollLeft = current * element.clientWidth; };
    const observer = new ResizeObserver(align); observer.observe(element);
    return () => observer.disconnect();
  }, [current]);
  const scrollTimer = useRef(0);
  const onScroll = () => {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => { const element = track.current; if (element) setPage(Math.round(element.scrollLeft / Math.max(1, element.clientWidth))); }, 60);
  };
  const setSearch = (value: string) => { setQuery(value); setPage(0); if (track.current) track.current.scrollLeft = 0; };
  const skills = catalog?.items.filter(item => item.kind === 'skill') ?? [];
  const routines = catalog?.items.filter(item => item.kind === 'routine') ?? [];
  const routineRuns = runs.filter(run => run.kind === 'routine');
  const blocked = busy || loading || !!catalogError || !!runError;
  return <>
    {settings && <SkillExecutionSettings key={settings.item.id} item={settings.item} anchor={settings.anchor} onClose={restore => { const anchor = settings.anchor; setSettings(null); if (restore && anchor.isConnected) anchor.focus(); }} onSaved={() => { void refresh(); }} />}
    {historyOpen && <RoutineHistory runs={routineRuns} onClose={() => setHistoryOpen(false)} />}
    <section className="card skills" aria-labelledby="skills-heading" aria-busy={loading}>
      <header className="card__head">
        <h2 className="card__title" id="skills-heading"><Icon name="skill" />스킬</h2>
        {catalog && <span className="card__meta">{query.trim() ? `${first.total} / ${skills.length}` : skills.length}</span>}
        {!!catalog?.warnings.length && <a className="state-chip state-chip--quiet" href="#/?settings=skills" onClick={event => { event.preventDefault(); updateLocation({ settings: 'skills' }); }} data-tip={catalog.warnings.join(' · ')}>목록 확인 필요</a>}
        <CardStatus label={(catalogError || runError) && catalog ? '조회 실패' : null} tip={catalogError || runError} />
        {!!skills.length && <label className="search skills__search"><Icon name="search" />
          <input ref={search} className="input" type="search" placeholder="스킬 검색" aria-label="스킬 검색" autoComplete="off" spellCheck={false} value={query}
            onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && query) { event.stopPropagation(); setSearch(''); } }} />
          <IconButton icon="x" label="검색어 지우기" tip={null} size="sm" className="search__clear" onClick={() => { setSearch(''); search.current?.focus(); }} />
          {/* 검색 칸이 비어 있을 때 같은 자리에 목록 새로고침(올렸을 때만). 시안의 검색 칸 너비를 유지한다 */}
          <IconButton icon="refresh" label="스킬 목록 새로고침" size="sm" className="search__tool reveal" busy={loading} disabled={loading} onClick={() => void refresh(true)} />
        </label>}
        {!skills.length && <div className="card__tools"><IconButton icon="refresh" label="스킬 목록 새로고침" size="sm" busy={loading} disabled={loading} onClick={() => void refresh(true)} /></div>}
      </header>
      {loading && !catalog ? <div className="skills__deck"><div className="skills__page" role="status" aria-label="스킬 목록을 불러오는 중">{[0, 1, 2, 3].map(i => <Skel key={i} width="100%" height={78} style={{ borderRadius: 8 }} />)}</div></div>
        : catalogError && !catalog ? <div className="skills__empty"><EmptyState icon="folder" title="스킬 목록을 읽지 못했습니다" text={catalogError} role="alert"
          action={<button type="button" className="btn btn--line btn--sm" onClick={() => updateLocation({ settings: 'workspace' })}><Icon name="settings" />작업 공간 설정</button>} /></div>
          : !skills.length ? <div className="skills__empty"><EmptyState icon="skill" title="등록된 스킬이 없습니다" text="작업 공간의 스킬/ 폴더에 SKILL.md를 추가하면 표시됩니다." /></div>
            : <>
              <div className="skills__deck">
                <IconButton icon="chevron-left" label="이전 스킬" size="sm" className="skills__nav skills__nav--prev" disabled={current <= 0} onClick={() => go(current - 1)} />
                <div className="skills__track" ref={track} aria-label="스킬 목록" onScroll={onScroll}
                  onKeyDown={event => {
                    if ((event.target as HTMLElement).closest('input')) return;
                    if (event.key === 'PageDown' || (event.key === 'ArrowRight' && event.altKey)) { event.preventDefault(); go(current + 1); }
                    if (event.key === 'PageUp' || (event.key === 'ArrowLeft' && event.altKey)) { event.preventDefault(); go(current - 1); }
                  }}>
                  {first.total === 0 ? <div className="skills__page skills__empty"><div><p>‘{query.trim()}’와 맞는 스킬이 없습니다.</p><button type="button" className="btn btn--ghost btn--sm" onClick={() => { setSearch(''); search.current?.focus(); }}>검색어 지우기</button></div></div>
                    : pages.map((items, index) => <div key={index} className="skills__page" role="group" aria-label={`${index + 1} / ${pages.length} 페이지`}>
                      {items.map(item => <SkillTile key={item.id} item={item} run={runs.find(run => run.targetId === item.id)} blocked={blocked}
                        onStart={id => void start(id, true)} onCancel={id => void cancel(id)} onSettings={(item, anchor) => setSettings(old => old?.item.id === item.id ? null : { item, anchor })} />)}
                    </div>)}
                </div>
                <IconButton icon="chevron-right" label="다음 스킬" size="sm" className="skills__nav skills__nav--next" disabled={current >= pages.length - 1} onClick={() => go(current + 1)} />
              </div>
              <div className="skills__dots" role="tablist" aria-label="스킬 페이지">{pages.length > 1 && pages.map((_, index) => <button key={index} type="button" role="tab" aria-label={`${index + 1} / ${pages.length} 페이지`}
                aria-selected={index === current} tabIndex={index === current ? 0 : -1} onClick={() => go(index)}
                onKeyDown={event => {
                  const next = event.key === 'ArrowRight' ? current + 1 : event.key === 'ArrowLeft' ? current - 1 : null;
                  if (next === null) return;
                  event.preventDefault(); go(next); (event.currentTarget.parentElement?.children[Math.max(0, Math.min(next, pages.length - 1))] as HTMLElement | undefined)?.focus();
                }} />)}</div>
            </>}
    </section>
    <section className="card routines" aria-labelledby="routines-heading" aria-busy={loading}>
      <header className="card__head">
        <h2 className="card__title" id="routines-heading"><Icon name="routine" />루틴</h2>
        <span className="card__meta" data-tip="실행 기록과 예약 상태는 이 Mac 기준입니다">이 Mac의 실행 기록</span>
        <CardStatus label={(catalogError || runError) && catalog ? '조회 실패' : null} tip={catalogError || runError} />
        <div className="card__tools"><IconButton icon="history" label="루틴 실행 기록" tip="실행 기록" size="sm" className="reveal" aria-haspopup="dialog" onClick={() => setHistoryOpen(true)} /></div>
      </header>
      {loading && !catalog ? <CardSkeleton label="루틴을 불러오는 중" rows={2} />
        : catalogError && !catalog ? <EmptyState icon="alert" title="루틴 목록을 읽지 못했습니다" text={catalogError} role="alert" />
          : !routines.length ? <EmptyState icon="clock" title="등록된 루틴이 없습니다" text="작업 공간의 루틴/ 폴더에 routine.json을 추가하면 표시됩니다." />
            : <ul className="routines__list" ref={scrollHint} aria-label="루틴 목록">{routines.map(item => {
              const run = runs.find(run => run.targetId === item.id);
              const running = !!run && isActive(run.status);
              return <li className="routine" key={item.id} data-state={run ? run.status : 'idle'}>
                <div>
                  <p className="routine__name" title={item.description}>{item.name}</p>
                  {item.metricsService === 'youtube' && <YouTubeSchedule />}
                  <p className="routine__state" aria-live="polite">{!item.ready ? <span>{item.reason ?? '실행 불가'}</span>
                    : running ? <><span>{runLabels[run.status]}</span>{run.startedAt && <Elapsed since={run.startedAt} />}</>
                      : run ? <><span>최근 {fmt.when(run.finishedAt ?? run.createdAt)} ·</span><button type="button" data-tip="실행 결과 보기" onClick={() => updateLocation({ run: run.id })}>{runLabels[run.status]}</button></>
                        : <span>아직 실행하지 않았습니다</span>}</p>
                </div>
                {running ? <IconButton icon="stop" label={`${item.name} 중지`} tip="중지" variant="solid" size="sm" disabled={busy || run.status === 'cancelling'} onClick={() => void cancel(run.id)} />
                  : <IconButton icon="play" label={`${item.name} 실행`} tip="실행" variant="line" size="sm" disabled={blocked || !item.ready} onClick={() => void start(item.id)} />}
                {running && <span className="bar bar--busy" aria-hidden="true"><i /></span>}
              </li>;
            })}</ul>}
    </section>
  </>;
}
