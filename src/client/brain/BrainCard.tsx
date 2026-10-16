// 크게 연 세컨드 브레인 — 시안 js/brain-globe.js의 카드(머리줄 · 찾기 · 분야 · 범례 · 자주 쓰는 목록 · 조작 단추 · 패널 · 목록 보기 · 미리보기)를 React로 옮겼다.
// 카드 틀(열기 · 닫기 전환, 크기 재기, 바깥 inert)은 시안처럼 요소를 직접 다루고, 안쪽 내용은 컨트롤러 상태로 그린다.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { BrainSearch, GraphNode } from '../../shared/brain';
import { mergeSearchResults } from '../../shared/brain-search';
import { brainApi } from './api';
import { DashboardVisible } from '../dashboard-state';
import { fmt } from '../format';
import { Icon } from '../Icon';
import { IconButton, Notice, closeOnBackdrop } from '../ui';
import type { BrainController } from './controller';
import { createGlobe } from './globe-renderer.js';
import type { Insets } from './globe-renderer.js';
import { SHAPES, isTucked, mountGlobeSymbols } from './model';

/** 메인 화면 구체 = 열린 구체의 70% 크기 · 같은 자리(열면 1/0.7배로 커진다) */
export const ORB_RATIO = 0.7;
// 제자리에서 열 때의 구체가 남은 자리 한가운데에 둘 때 크기의 이 비율보다 작으면(좁은 창) 그 크기만큼 비켜 연다
const SHIFT_BELOW = 0.7;
const MOBILE = '(max-width: 719px)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const vars = (values: Record<string, string>) => values as CSSProperties;

/** 도형 글리프: 분야 = 색, 종류 = 모양(스킬 마름모 · 문서 원 · 에셋 사각 · 루틴 삼각), 폴더 = 테두리만. 고리의 스킬 · 루틴은 아이콘 배지 */
function Glyph({ c, n }: { c: BrainController; n: GraphNode }) {
  if (c.m.unitIds.has(n.id)) return <span className="bg-glyph bg-glyph--icon" style={vars({ '--c': c.m.colorOf(n.group) })} aria-hidden="true"><Icon name={n.group === 'skills' ? 'skill' : 'routine'} /></span>;
  const core = n.id === c.m.graph.centerId;
  return <span className={['bg-glyph', n.kind === 'folder' && 'bg-glyph--hollow', core && 'bg-glyph--core'].filter(Boolean).join(' ')} data-shape={SHAPES[n.ring] || 'circle'}
    style={vars({ '--c': core ? 'var(--accent)' : c.m.colorOf(n.group) })} aria-hidden="true" />;
}
const Shape = ({ shape, hollow }: { shape: string; hollow?: boolean }) =>
  <span className={hollow ? 'bg-glyph bg-glyph--hollow' : 'bg-glyph'} data-shape={shape} style={vars({ '--c': 'var(--charcoal)' })} aria-hidden="true" />;
const IconBadge = ({ name }: { name: string }) => <span className="bg-glyph bg-glyph--icon" style={vars({ '--c': 'var(--charcoal)' })} aria-hidden="true"><Icon name={name} /></span>;

/* ── 빠른 결과를 유지하며 자동 본문 검색을 덧붙인다 ── */
function Search({ c, onClose }: { c: BrainController; onClose(restoreFocus: boolean): void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [body, setBody] = useState<BrainSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const quick = useMemo(() => c.search(query), [c, query]);
  const found = useMemo(() => mergeSearchResults(quick.results.map(r => ({ ...r, ancestors: [] })),
    body?.results.filter(r => c.m.byId.has(r.node.id)) ?? []), [quick, body, c]);
  const needsRefresh = body?.results.some(r => !c.m.byId.has(r.node.id));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { list.current?.querySelector(`#bg-opt-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const version = generation.current;
    const current = () => !controller.signal.aborted && version === generation.current;
    let indicator: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      indicator = setTimeout(() => { if (current()) setLoading(true); }, 200);
      brainApi.searchBody(query, controller.signal).then(result => {
        if (current()) setBody(result);
      }).catch(() => {
        if (current()) setError(true);
      }).finally(() => {
        clearTimeout(indicator);
        if (current()) setLoading(false);
      });
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(indicator); };
  }, [c, query]);
  const choose = (n: GraphNode) => {
    onClose(false);
    if (c.view === 'table') c.setView('globe');
    c.select(n.id);
    requestAnimationFrame(() => document.getElementById('bg-panel-title')?.focus({ preventScroll: true }));
  };
  const shown = !!query.trim();
  return <>
    <label className="search brain__search"><Icon name="search" />
      <input ref={input} className="input" type="search" placeholder="제목 · 설명 · 본문 찾기" aria-label="세컨드 브레인에서 찾기" autoComplete="off" spellCheck={false} maxLength={200}
        role="combobox" aria-expanded={shown} aria-controls="bg-results" aria-autocomplete="list" aria-activedescendant={shown && found.length ? `bg-opt-${active}` : undefined}
        value={query} onChange={event => { generation.current++; setQuery(event.target.value); setActive(0); setBody(null); setLoading(false); setError(false); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && found.length) { event.preventDefault(); setActive((active + 1) % found.length); }
          else if (event.key === 'ArrowUp' && found.length) { event.preventDefault(); setActive((active - 1 + found.length) % found.length); }
          else if (event.key === 'Enter') { event.preventDefault(); if (found[active]) choose(found[active].node); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
        }} />
    </label>
    {shown && <div className="bg-results">
      <ul ref={list} className="bg-results__list" id="bg-results" role="listbox" aria-label="찾은 항목">
        {found.map(({ node: n, match }, i) => <li key={n.id} id={`bg-opt-${i}`} role="option" className="bg-result" aria-selected={i === active}
          onPointerDown={event => event.preventDefault()} onClick={() => choose(n)}>
          <Glyph c={c} n={n} /><span className="bg-result__name">{n.name}</span>
          <span className="bg-result__path">{n.path}</span>
          {c.visible.has(n.id) ? null : <span className="bg-result__tag">{c.m.orbital.has(n.id) ? '고리' : '접힘'}</span>}
          {match?.excerpt && <span className="bg-result__excerpt" title={match.sourcePath}>
            <strong>{match.kind === 'body' ? (match.sourcePath ? '안내 · 본문' : '본문') : '안내'}</strong> {match.excerpt}
          </span>}
        </li>)}
      </ul>
      <div className="bg-results__status" role="status" aria-live="polite">
        {!found.length && <p>{body && !body.partial ? '찾은 항목이 없습니다.' : '빠른 검색 결과가 없습니다.'}</p>}
        {loading && <p><span className="bg-search-spinner" aria-hidden="true" />문서 본문을 검색하고 있습니다…</p>}
        {error && <p>본문 검색을 완료하지 못했습니다. 빠른 검색 결과는 계속 사용할 수 있습니다. 검색어를 다시 입력해 재시도해 주세요.</p>}
        {body?.partial && <p>일부 자료는 검색하지 못했습니다{body.skippedFiles ? ` (${body.skippedFiles}개)` : ''}. 크기 제한·접근 권한·스캔 범위를 확인해 주세요.</p>}
        {needsRefresh && <p>새 자료가 있습니다. 지도를 새로고침하면 선택할 수 있습니다.</p>}
        {(quick.truncated || body?.truncated) && <p>검색 단계별 최대 100개를 표시합니다. 검색어를 더 구체적으로 입력해 주세요.</p>}
        {body && <p>{body.partial ? '본문 일부 검색 완료' : '본문 검색 완료'} · {body.searchedFiles ?? 0}개 문서 확인</p>}
      </div>
    </div>}
  </>;
}

/* ── 고른 항목 패널 ── */
function RelList({ c, title, ids, more }: { c: BrainController; title: string; ids: string[]; more?: (n: GraphNode) => string }) {
  if (!ids.length) return null;
  const limit = 12;
  return <>
    <p className="brain__sub">{title} {fmt.num(ids.length)}</p>
    <div className="brain__links">
      {ids.slice(0, limit).map(id => { const x = c.m.byId.get(id)!; return <button key={id} type="button" style={vars({ '--c': c.m.colorOf(x.group) })} onClick={() => c.select(x.id)}>
        <Glyph c={c} n={x} /><span className="ellipsis">{x.name}</span><span className="kind">{more ? more(x) : c.m.groupName(x.group)}</span>
      </button>; })}
      {ids.length > limit && <p className="bg-more">외 {fmt.num(ids.length - limit)}개</p>}
    </div>
  </>;
}
// 패널 본문: 자르지 않고 담아 칸 안에서 스크롤한다(2026-10-16 — 앞 10줄 · 420자만 보여 끝까지 읽을 수 없었다)
function excerpt(text: string) {
  return text.replace(/\r/g, '');
}
function Panel({ c, n, panel, onPreview, onClose }: { c: BrainController; n: GraphNode | null; panel: RefObject<HTMLElement | null>; onPreview(n: GraphNode): void; onClose(): void }) {
  if (!n) return <aside ref={panel} className="brain__panel bg-panel" hidden aria-label="선택한 항목" />;
  const { m } = c, router = n.id === m.graph.centerId, item = c.automationOf(n);
  const outIds = [...new Set(m.out.get(n.id) ?? [])], inIds = [...new Set(m.inc.get(n.id) ?? [])];
  const folded = c.isFolded(n), preview = c.previews.get(n.id), tuck = c.tuckFact(n);
  const skill = item?.kind === 'skill' ? item : undefined, routine = item?.kind === 'routine' ? item : undefined;
  const runnable = skill && c.isAutomationRoot(n, skill), live = !!skill && c.live.has(skill.id);
  const parent = n.parentId ? m.byId.get(n.parentId) : undefined;
  return <aside ref={panel} className="brain__panel bg-panel" aria-label="선택한 항목" aria-labelledby="bg-panel-title" style={vars({ '--c': router ? 'var(--accent)' : m.colorOf(n.group) })}>
    <div className="brain__panel-head">
      <span className="badge badge--line brain__badge">{router ? '라우터' : `${m.groupName(n.group)} · ${c.kindOf(n)}`}</span><span style={{ flex: 1 }} />
      <IconButton icon="x" label="패널 닫기" size="sm" onClick={onClose} />
    </div>
    <div className="brain__panel-body">
      <h3 id="bg-panel-title" tabIndex={-1}>{n.name}</h3>
      <p className="brain__path mono">{router ? `${m.graph.root}/${n.path}` : n.path}</p>
      <dl className="brain__facts">
        {n.modifiedAt && <><dt>수정</dt><dd>{fmt.when(n.modifiedAt)}</dd></>}
        {(n.kind === 'file' || outIds.length > 0 || inIds.length > 0) && <><dt>링크</dt><dd>나감 {fmt.num(outIds.length)} · 들어옴 {fmt.num(inIds.length)}</dd></>}
        {n.kind === 'folder' && <><dt>하위</dt><dd>{fmt.num(n.childCount)}개 · {folded ? '접힘' : '펼침'}</dd></>}
        {tuck && <><dt>이미지 · 데이터</dt><dd>{tuck}</dd></>}
        {skill && <><dt>{m.groupName('skills')}</dt><dd>{live ? '실행 중' : skill.ready ? '실행할 수 있음' : `실행 불가 · ${skill.reason ?? '설정을 확인해 주세요'}`}</dd></>}
        {routine && <><dt>{m.groupName('routines')}</dt><dd>{routine.name} · 실행은 루틴 카드에서</dd></>}
        {m.orbital.has(n.id) && <><dt>자리</dt><dd>{m.unitOf.get(n.id) ? `${m.groupName(n.group)} 고리` : `${m.groupName(n.group)} 고리 전체`}</dd></>}
      </dl>
      <div className="brain__actions">
        {runnable && <IconButton icon="play" label={`${skill.name} 실행`} tip={live ? '실행 중' : '실행'} variant="solid" size="sm" disabled={!skill.ready || live} onClick={() => c.onRunSkill(skill.id)} />}
        {n.capabilities.preview && <IconButton icon="eye" label="전체 미리보기" variant="line" size="sm" onClick={() => onPreview(n)} />}
        <IconButton icon="copy" label="경로 복사" variant="line" size="sm" onClick={() => c.copyPath(n)} />
        {n.capabilities.reveal && <IconButton icon="external" label="파일 위치 보기" variant="line" size="sm" onClick={() => c.reveal(n)} />}
      </div>
      {/* 펼치기 · 접기는 접어 둔 파일(이미지 · 데이터)이 아닌 하위가 있을 때만 */}
      {n.kind === 'folder' && n.parentId !== null && !m.orbital.has(n.id) && (m.kids.get(n.id) ?? []).some(child => !isTucked(child)) &&
        <button type="button" className="btn btn--line btn--sm bg-fold" onClick={() => c.toggleFold(n.id)}>
          <Icon name={folded ? 'unfold' : 'fold'} />{folded ? `하위 ${fmt.num(c.unfoldCount(n))}개 펼치기` : '접기'}</button>}
      {n.capabilities.preview && (preview?.content !== undefined ? <div className="brain__preview bg-excerpt" tabIndex={0} role="region" aria-label="본문 미리보기">{excerpt(preview.content)}</div>
        : preview?.error ? <p className="bg-offline">{preview.error}</p> : <p className="bg-offline" role="status">미리보기를 불러오는 중입니다.</p>)}
      <div className="bg-depth-row"><span className="brain__sub">이웃 범위</span>
        <div className="seg seg--sm bg-depth" role="radiogroup" aria-label="이웃 범위">
          {[1, 2, 3].map(d => <button key={d} type="button" role="radio" aria-checked={c.depth === d} onClick={() => c.setDepth(d)}>{d}단계</button>)}
        </div>
      </div>
      <RelList c={c} title="나가는 링크" ids={outIds} />
      <RelList c={c} title="들어오는 링크" ids={inIds} />
      {n.kind === 'folder' && <RelList c={c} title="하위 항목" ids={(m.kids.get(n.id) ?? []).map(x => x.id)} more={x => (x.kind === 'folder' ? `폴더 · ${x.childCount}` : c.kindOf(x))} />}
      {!router && parent && parent.parentId !== null && <RelList c={c} title="상위 폴더" ids={[parent.id]} more={() => '폴더'} />}
    </div>
  </aside>;
}

/* ── 목록 보기: 구체와 같은 데이터. 키보드로 모든 항목을 고를 수 있다 ── */
function Table({ c }: { c: BrainController }) {
  const rows = useMemo(() => c.m.graph.nodes.filter(n => n.parentId !== null)
    .sort((a, b) => (a.id === c.m.graph.centerId ? -1 : b.id === c.m.graph.centerId ? 1 : a.path.localeCompare(b.path, 'ko'))), [c]);
  const pick = (n: GraphNode) => c.select(n.id, { rotate: false });
  return <div className="bg-table">
    <table className="bg-tbl">
      <caption className="sr-only">작업 공간 전체 항목</caption>
      <thead><tr>{['이름', '분야', '종류', '경로', '나감', '들어옴', '수정'].map((t, i) => <th key={t} scope="col" className={i === 4 || i === 5 ? 'num' : undefined}>{t}</th>)}</tr></thead>
      <tbody>{rows.map(n => <tr key={n.id} tabIndex={0} aria-selected={n.id === c.selected} onClick={() => pick(n)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(n); } }}>
        <td><span className="bg-table__name"><Glyph c={c} n={n} /><span>{n.name}</span></span></td>
        <td className="bg-table__muted">{n.id === c.m.graph.centerId ? '라우터' : c.m.groupName(n.group)}</td>
        <td className="bg-table__muted">{c.kindOf(n)}</td>
        <td className="bg-table__path mono">{n.path}</td>
        <td className="num">{fmt.num(new Set(c.m.out.get(n.id) ?? []).size)}</td>
        <td className="num">{fmt.num(new Set(c.m.inc.get(n.id) ?? []).size)}</td>
        <td className="bg-table__muted">{n.modifiedAt ? fmt.when(n.modifiedAt) : '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/* ── 전체 미리보기 ── */
function PreviewDialog({ c, n, onClose }: { c: BrainController; n: GraphNode; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const p = c.previews.get(n.id);
  return <dialog ref={dialog} className="dialog bg-preview-dialog" aria-labelledby="bg-preview-title" onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => closeOnBackdrop(event, onClose)}>
    <header className="dialog__head"><h2 id="bg-preview-title">{n.name}</h2><IconButton icon="x" label="닫기" tip="닫기 (Esc)" onClick={onClose} /></header>
    <div className="dialog__body bg-preview">
      <p className="bg-preview__meta mono">{[n.path, p?.size !== undefined && `${fmt.num(p.size)}바이트`, n.modifiedAt && fmt.when(n.modifiedAt)].filter(Boolean).join(' · ')}</p>
      {p?.content !== undefined ? <pre className="bg-preview__text">{p.content}</pre>
        : p?.error ? <Notice icon="alert" attention role="alert">{p.error}</Notice> : <p className="caption" role="status">미리보기를 불러오는 중입니다.</p>}
    </div>
  </dialog>;
}

export function BrainCard({ controller: c }: { controller: BrainController }) {
  useSyncExternalStore(c.subscribe, c.getVersion);
  const card = useRef<HTMLElement>(null), scrim = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const side = useRef<HTMLDivElement>(null), favs = useRef<HTMLElement>(null), panel = useRef<HTMLElement>(null), hover = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null), searchButton = useRef<HTMLButtonElement>(null);
  const [drawerTop, setDrawerTop] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [previewing, setPreviewing] = useState<GraphNode | null>(null);
  const searchingNow = useRef(false);
  const relayout = useRef<() => void>(() => {});
  useEffect(() => { searchingNow.current = searching; }, [searching]);

  useEffect(() => {
    const el = canvas.current!, cardEl = card.current!, scrimEl = scrim.current!, stageEl = stage.current!;
    mountGlobeSymbols();
    const mobile = matchMedia(MOBILE);
    let closing = false, inerted: HTMLElement[] = [], lastFocus: Element | null = null, measured: { key: string; box: ReturnType<typeof measure> } = { key: '', box: null };
    const globe = createGlobe(el, {
      // 별자리 점({ id, ghost })도 올리고 누를 수 있다 — 누르면 그 노드를 고르고 상위 폴더를 펼친다
      onHover: item => c.setHover(item),
      onClick: item => { if (item) c.select(item.id); else if (c.selected) c.clearSelection(); },
      onDoubleClick: item => { const n = item.node ?? c.m.byId.get(item.id); if (n && n.kind === 'folder' && n.parentId !== null && !c.m.orbital.has(n.id)) c.toggleFold(n.id); },
      onFrame: () => placeHover()
    });
    c.attach(globe);

    /* 배치: 넓은 화면은 왼쪽 분야 목록과 오른쪽 자주 쓰는 목록(패널이 열리면 패널) 사이, 좁은 화면은 분야 한 줄 아래 · 아래 띠 위.
       메인 화면 구체와 같은 자리에 그 1/0.7배 크기로 두고, 들어가지 않으면 렌더러가 남은 자리 한가운데 쪽으로 필요한 만큼만 비킨다 */
    function stageInsets(withPanel: boolean): Insets {
      const sideEl = side.current!, favEl = favs.current!, panelEl = panel.current!;
      if (mobile.matches) return { left: 0, right: 0, top: sideEl.offsetHeight + 12, bottom: 56 };
      const right = withPanel && !panelEl.hidden ? stageEl.clientWidth - panelEl.offsetLeft + 16 : stageEl.clientWidth - favEl.offsetLeft + 16;
      return { left: sideEl.offsetLeft + sideEl.offsetWidth + 16, right, top: 8, bottom: 44 };
    }
    // 메인 화면 구체의 원(이 캔버스 좌표)과 돌아간 각도
    function orbCircle() {
      const v = c.orb?.view(), r = el.getBoundingClientRect();
      if (!v || !r.width) return null;
      return { cx: v.cx - r.left, cy: v.cy - r.top, r: v.r, yaw: v.yaw, pitch: v.pitch, phases: v.phases, solid: true };
    }
    function insets() {
      const o = orbCircle();
      globe.setAnchor(o ? { x: o.cx, y: o.cy, r: o.r / ORB_RATIO } : null);
      globe.setInsets(stageInsets(true));
      // 좁은 화면: 구체 아래 남는 자리가 200px 이상이면 고른 항목 서랍이 거기를 쓰고, 모자라면 아래에서 덮는다
      if (mobile.matches) {
        const t = globe.target(), below = Math.round(t.cy + t.r * t.ring * 1.02 + 30);
        setDrawerTop(stageEl.clientHeight - 58 - below >= 200 ? below : null);
      } else setDrawerTop(null);
    }
    relayout.current = insets;
    /* 열린 구체 크기 재기: 카드가 닫혀 있어도 열린 모습을 보이지 않게(is-measuring) 잠깐 배치해 무대 크기 · 여백을 잰다(같은 프레임 안에서 되돌림) */
    function measure() {
      const peek = !c.open, wasHidden = cardEl.hidden;
      if (peek) { cardEl.hidden = false; cardEl.classList.add('is-expanded', 'is-measuring'); }
      const s = stageEl.getBoundingClientRect();
      const box = s.width && s.height ? { left: s.left, top: s.top, width: s.width, height: s.height, insets: stageInsets(false) } : null;
      if (peek) { cardEl.classList.remove('is-expanded', 'is-measuring'); cardEl.hidden = wasHidden; }
      return box;
    }
    /* 화면 (x, y)에 메인 화면 구체가 있을 때 열린 구체 반지름. 좁은 창에서 남은 자리 한가운데 크기의 70%보다 작아지면 그 크기로 하고 비켜 연다 */
    function openRadiusAt(x: number, y: number) {
      const key = `${innerWidth}x${innerHeight}`;
      if (measured.key !== key) { const box = cardEl.isConnected ? measure() : null; measured = { key: box ? key : '', box }; }
      const b = measured.box;
      if (!b) return 0;
      const s = b.insets, here = globe.fitFor(b, x - b.left, y - b.top);
      const best = globe.fitFor(b, s.left + (b.width - s.left - s.right) / 2, s.top + (b.height - s.top - s.bottom) / 2);
      return Math.max(here, best * SHIFT_BELOW);
    }
    function placeHover() {
      const box = hover.current, n = c.hover;
      if (!box || !n) return;
      const at = globe.screenOf(n.id);
      box.style.visibility = at ? '' : 'hidden';
      if (!at) return;
      const W = stageEl.clientWidth, H = stageEl.clientHeight, w = box.offsetWidth, hh = box.offsetHeight;
      let x = at.x + at.r + 14;
      if (x + w > W - 12) x = at.x - at.r - 14 - w;
      const y = Math.max(8, Math.min(at.y - hh / 2, H - hh - 8));
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }

    /* 열기: 메인 화면 구체가 같은 자리 · 크기 · 각도에서 그대로 커지며 주황에서 분야 색으로 물들고 엣지가 이어진다.
       카드 면이 먼저 메인 화면을 덮고 글자 · 도구는 그 뒤에 나타난다(css .is-entering) */
    function expand() {
      if (c.open) return;
      c.open = true; closing = false;
      lastFocus = document.activeElement;
      cardEl.classList.add('is-entering');
      cardEl.hidden = false;
      scrimEl.hidden = false; requestAnimationFrame(() => scrimEl.classList.add('is-on'));
      cardEl.classList.add('is-expanded');
      cardEl.setAttribute('role', 'dialog'); cardEl.setAttribute('aria-modal', 'true');
      inerted = [...document.body.children].filter((x): x is HTMLElement => x instanceof HTMLElement && x !== cardEl && x !== scrimEl
        && !x.matches('.toast-host, .tooltip, .popover, dialog') && !x.inert);
      inerted.forEach(x => { x.inert = true; });
      insets();
      c.refresh({ reveal: true });
      globe.intro(orbCircle());
      requestAnimationFrame(() => requestAnimationFrame(() => cardEl.classList.remove('is-entering'))); // 열린 모습이 한 번 그려진 뒤 걷는다
      closeButton.current?.focus({ preventScroll: true });
    }
    /* 닫기: 카드 면이 걷히고 구체만 메인 화면 구체 자리로 줄어든 뒤(주황으로 돌아가며 엣지가 걷힌다) 메인 화면 구체가 그 각도로 이어 돈다 */
    function collapse() {
      if (!c.open || closing) return;
      closing = true;
      // 카드 안의 포커스 테두리(캔버스 등)가 줄어드는 동안 화면 가장자리에 남지 않게 먼저 푼다
      if (cardEl.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      setSearching(false); setPreviewing(null);
      c.resetForClose();
      cardEl.classList.add('is-leaving');
      scrimEl.classList.remove('is-on');
      const to = orbCircle();
      globe.outro(() => {
        c.open = false; closing = false;
        cardEl.classList.remove('is-expanded', 'is-leaving');
        cardEl.removeAttribute('role'); cardEl.removeAttribute('aria-modal');
        cardEl.hidden = true; scrimEl.hidden = true;
        inerted.forEach(x => { x.inert = false; }); inerted = [];
        if (to) c.orb?.setView(globe.view());
        if (c.orb) { c.orb.resume(); c.orb.focus(); } else if (lastFocus instanceof HTMLElement && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
        c.emit();
      }, to);
    }
    c.card = { expand, collapse, openRadiusAt, placeHover };
    // 창 크기가 바뀌면 한 프레임 뒤에 다시 맞춘다 — 같은 프레임에 메인 화면 구체가 새 자리를 먼저 정한 뒤 그 자리를 따라가게
    const observer = new ResizeObserver(() => { if (c.open) requestAnimationFrame(() => { if (c.open && !closing) insets(); }); });
    observer.observe(stageEl);
    const onKey = (event: KeyboardEvent) => {
      if (!c.open || closing || document.querySelector('dialog[open]') || document.querySelector('.popover')) return;
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.key === '/' && !typing) { event.preventDefault(); setSearching(true); return; }
      if (event.key !== 'Escape') return;
      // Esc 단계별 닫기: 찾기 → 선택 → 세컨드 브레인
      event.preventDefault();
      if (searchingNow.current) { setSearching(false); searchButton.current?.focus(); return; }
      if (c.selected) { c.clearSelection(); el.focus({ preventScroll: true }); return; }
      collapse();
    };
    document.addEventListener('keydown', onKey);
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) { measured.key = ''; c.measureVersion++; } });
    if (reduced()) c.setAuto(false);
    return () => {
      alive = false; observer.disconnect(); document.removeEventListener('keydown', onKey);
      inerted.forEach(x => { x.inert = false; });
      if (c.card?.expand === expand) c.card = null;
      c.open = false; c.detach(globe); globe.destroy();
    };
  }, [c]);
  // 연 채로 대시보드를 떠나면(뒤로 가기 · 주소 변경) 닫는다. 카드는 body에 붙어 있어 숨은 대시보드와 함께 가려지지 않는다
  const visible = useContext(DashboardVisible);
  useEffect(() => { if (!visible) c.card?.collapse(); }, [c, visible]);

  const node = c.selected ? c.m.byId.get(c.selected) ?? null : null;
  const panelShown = !!node;
  // 패널이 열리고 닫히면 구체가 비키고 돌아온다. 나타나는 동안(0.4초)은 누름이 구체로 통과한다(오른쪽 끝 항목을 두 번 누를 때)
  useLayoutEffect(() => {
    if (!c.open) return;
    relayout.current();
    const el = panel.current;
    if (!panelShown || !el) return;
    el.classList.add('is-arriving');
    const timer = setTimeout(() => el.classList.remove('is-arriving'), 400);
    if (!reduced()) el.animate([{ opacity: 0, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 120, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' });
    return () => clearTimeout(timer);
  }, [c, panelShown]);
  useLayoutEffect(() => { c.card?.placeHover(); }, [c, c.hover]);

  const { m } = c;
  const router = m.graph.routerId ? m.byId.get(m.graph.routerId)?.name : null;
  const skills = m.groupName('skills'), routines = m.groupName('routines');
  const meta = `${router ?? '작업 공간'} 기준 · ${m.shownGroups.map(g => `${g.name} ${fmt.num(m.counts[g.id] ?? 0)}`).join(' · ')}`;
  const table = c.view === 'table';
  const closeSearch = (restore: boolean) => { setSearching(false); if (restore) searchButton.current?.focus(); };
  return <>
    <div ref={scrim} className="brain-scrim" hidden onClick={() => c.collapse()} />
    <section ref={card} className="card brain bg" aria-labelledby="bg-title" hidden>
      <header className="card__head">
        <h2 className="card__title" id="bg-title"><Icon name="brain" />세컨드 브레인</h2>
        {!searching && <span className="card__meta">{meta}</span>}
        <div className="card__tools">
          {searching && <Search c={c} onClose={closeSearch} />}
          <IconButton ref={searchButton} icon="search" label="세컨드 브레인 검색" tip="찾기 (/)" aria-pressed={searching} onClick={() => (searching ? closeSearch(true) : setSearching(true))} />
          <IconButton icon={table ? 'globe' : 'list'} label={table ? '구체로 보기' : '목록으로 보기'} onClick={() => c.setView(table ? 'globe' : 'table')} />
          <IconButton ref={closeButton} icon="minimize" label="세컨드 브레인 닫기" tip="닫기 (Esc)" onClick={() => c.collapse()} />
        </div>
      </header>
      <div ref={stage} className={['brain__stage bg-stage', table && 'is-table', drawerTop !== null && 'has-drawer-room'].filter(Boolean).join(' ')}
        style={drawerTop !== null ? vars({ '--bg-drawer-top': `${drawerTop}px` }) : undefined}>
        <canvas ref={canvas} className="bg-canvas" tabIndex={0} role="application" aria-roledescription="구체" hidden={table}
          aria-label="세컨드 브레인 구체. 끌거나 화살표 키로 돌리고, 더하기 · 빼기 키로 확대합니다. 모든 항목은 목록 보기에서 키보드로 고를 수 있습니다." />
        {table && <Table c={c} />}
        {/* 왼쪽 위: 분야(범례 겸 필터) · 펼치기 */}
        <div ref={side} className={c.groupFilter ? 'bg-side is-filtered' : 'bg-side'}>
          <div className="bg-side__head"><span className="bg-side__title">분야</span>
            <div className="bg-side__tools">
              <IconButton icon="unfold" label="모두 펼치기" size="sm" onClick={() => c.expandAll()} />
              <IconButton icon="fold" label="처음 상태로 접기" size="sm" onClick={() => c.resetFolds()} />
            </div>
          </div>
          <div className="bg-groups" role="group" aria-label="분야 보기">
            {m.shownGroups.map(g => <button key={g.id} type="button" className="bg-group" aria-pressed={c.groupFilter === g.id} style={vars({ '--c': m.colorOf(g.id) })}
              onClick={() => c.setGroup(c.groupFilter === g.id ? null : g.id)}>
              <span className="bg-glyph" data-shape={SHAPES[g.ring] || 'circle'} style={vars({ '--c': m.colorOf(g.id) })} aria-hidden="true" />
              <span className="bg-group__name">{g.name}</span><span className="bg-group__count">{fmt.num(m.counts[g.id] ?? 0)}</span>
            </button>)}
          </div>
        </div>
        {/* 왼쪽 아래: 범례 칩 — 올리거나 포커스하면 도형 읽는 법 · 선 켜고 끄기 · 표시 수가 위로 펼쳐진다 */}
        <div className="brain__legend bg-legendbox">
          <button type="button" className="brain__legend-handle bg-legend__handle" aria-label="범례 펼치기 · 도형 읽는 법과 선 켜고 끄기">
            <span className="bg-legend__mini" aria-hidden="true"><Shape shape="circle" /><Shape shape="circle" hollow /><IconBadge name="skill" /></span>범례
          </button>
          <div className="brain__legend-list bg-legendbox__list">
            <div className="bg-legend" aria-label="도형 읽는 법">
              <span><Shape shape="circle" hollow />폴더</span>
              <span><Shape shape="circle" />파일</span>
              <span><span className="bg-legend__ring" />접힌 폴더</span>
              <span><span className="bg-legend__orbit bg-legend__orbit--saturn" />고리 = {skills} · {routines}</span>
              <span><span className="bg-legend__stars" />작은 점 · 선 = 접힌 폴더 안까지</span>
              <span className="bg-legend__shapes">
                <span><IconBadge name="skill" />{skills}</span><span><Shape shape="circle" />문서</span><span><Shape shape="square" />에셋</span><span><IconBadge name="routine" />{routines}</span>
              </span>
            </div>
            <div className="bg-toggles">
              <div className="seg seg--sm bg-edgemode" role="radiogroup" aria-label="연결 보기">
                {([['all', '전체'], ['folder', '폴더 구조'], ['markdown', '문서 링크']] as const).map(([mode, name]) =>
                  <button key={mode} type="button" role="radio" aria-checked={c.edgeMode === mode} onClick={() => c.setEdgeMode(mode)}>{name}</button>)}
              </div>
              {/* 설명 줄은 늘 세 줄(지금 보기에 없는 선은 흐리게) — 줄 수가 바뀌면 범례가 위로 늘고 줄어 고르기 단추가 움직였다 */}
              <span className={`bg-toggles__note${c.showMd ? '' : ' is-off'}`}><span className="bg-legend__line bg-legend__line--md" />문서 링크{c.edgeMode === 'markdown' && ' · 링크가 닿는 항목만'}</span>
              <span className={`bg-toggles__note${c.showMd ? '' : ' is-off'}`}><span className="bg-legend__line bg-legend__line--md bg-legend__line--dash" />점선 = 접힌 폴더로 모은 링크</span>
              <span className={`bg-toggles__note${c.showFolder ? '' : ' is-off'}`}><span className={`bg-legend__line${c.edgeMode === 'folder' ? ' is-solid' : ''}`} />폴더 구조{c.edgeMode === 'all' && ' · 옅은 선'}</span>
            </div>
            <p className="bg-stat">{c.stat}</p>
          </div>
        </div>
        {/* 오른쪽: 자주 쓰는 문서 · 스킬 · 루틴(고른 항목 패널이 열리면 그 아래로 가린다 — 좁은 화면은 아래 띠) */}
        <aside ref={favs} className="bg-favs" aria-label={`자주 쓰는 문서 · ${skills} · ${routines}`}>
          <div className="bg-side__head bg-favs__head"><span className="bg-side__title">자주 쓰는</span></div>
          <div className="bg-fav" role="group" aria-label="자주 쓰는 항목">
            {c.favorites().filter(([, list]) => list.length).map(([title, list]) => <div key={title} className="bg-fav__sec" role="group" aria-label={title}>
              <span className="bg-fav__title">{title}</span>
              {list.map(({ n, item }) => {
                const live = !!item && c.live.has(item.id);
                return <span key={n.id} className="bg-fav__cell">
                  <button type="button" className="bg-fav__item" aria-pressed={c.selected === n.id} data-tip={n.path} onClick={() => c.select(n.id)}>
                    <Glyph c={c} n={n} /><span className="bg-fav__name">{n.name}</span>{live && <span className="bg-fav__live" title="실행 중" />}
                  </button>
                  {item?.kind === 'skill' && <IconButton icon="play" label={`${item.name} 실행`} tip={live ? '실행 중' : '실행'} size="sm" className="bg-fav__run" disabled={!item.ready || live} onClick={() => c.onRunSkill(item.id)} />}
                </span>;
              })}
            </div>)}
          </div>
        </aside>
        <p className="bg-drawer-hint" aria-hidden="true">그래프의 문서나 고리의 {skills} · {routines} 항목을 누르면 여기에 자세히 보입니다</p>
        {/* 오른쪽 아래: 회전 · 확대 */}
        <div className="bg-dock" role="toolbar" aria-label="구체 조작">
          <IconButton icon={c.auto ? 'pause' : 'play'} label={c.auto ? '자동 회전 멈추기' : '자동 회전'} size="sm" onClick={() => c.setAuto(!c.auto)} />
          <IconButton icon="minus" label="축소" size="sm" onClick={() => c.globe?.zoomBy(1 / 1.25)} />
          <IconButton icon="plus" label="확대" size="sm" onClick={() => c.globe?.zoomBy(1.25)} />
          <IconButton icon="restart" label="처음 시점으로" size="sm" onClick={() => c.globe?.resetView()} />
        </div>
        <Panel c={c} n={node} panel={panel} onPreview={setPreviewing} onClose={() => { c.clearSelection(); canvas.current?.focus({ preventScroll: true }); }} />
        <div ref={hover} className="bg-hover" hidden={!c.hover} aria-hidden="true">
          {c.hover && <>
            <strong>{c.hover.name}</strong>
            <span>{c.hover.id === m.graph.centerId ? '라우터' : m.groupName(c.hover.group)} · {c.kindOf(c.hover)}</span>
            {c.hover.path && <span className="mono">{c.hover.path}</span>}
            <span className="bg-hover__hint">{c.hoverHint(c.hover)}</span>
          </>}
        </div>
        <p className="sr-only" aria-live="polite">{c.announcement}</p>
      </div>
      {previewing && <PreviewDialog c={c} n={previewing} onClose={() => setPreviewing(null)} />}
    </section>
  </>;
}
