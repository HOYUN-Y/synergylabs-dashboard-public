// 세컨드 브레인 구체의 상태와 동작 — 시안 js/brain-globe.js BrainCard의 선택 · 펼치기 · 접어 둔 파일 · 장면 · 자주 쓰는 목록 · 찾기를 옮겼다.
// 렌더러(열린 구체 · 메인 화면 구체)와 화면(React)이 이 객체를 함께 본다. 화면에 보일 상태가 바뀌면 emit()으로 다시 그린다(useSyncExternalStore).
import type { AutomationItem, AutomationRun } from '../../shared/automation';
import { isActive } from '../../shared/automation';
import type { GraphNode } from '../../shared/brain';
import { fmt } from '../format';
import { toast } from '../ui';
import { brainApi } from './api';
import type { Globe, GlobeView, Hit, Scene, SceneEdge, SceneItem, Vec3 } from './globe-renderer.js';
import { SHAPES, isTucked, orbitScene } from './model';
import type { BrainModel } from './model';

const EXPAND_LIMIT = 900;   // 모두 펼치기 상한. 실제 작업 공간(약 3,400개)을 한 번에 펼치지 않는다
const TUCK_MAX = 200;       // 폴더 아래 전체의 이미지 · 데이터가 이보다 많으면 바로 아래 것만 펼친다
const USAGE_KEY = 'sl-brain-usage';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (text: string) => text.normalize('NFC').toLocaleLowerCase();
const posix = (path: string) => path.split('\\').join('/').normalize('NFC');

/** 메인 화면 구체(OrbGlobe)가 등록한다: 열 때 · 닫을 때 같은 자리 · 크기 · 각도로 잇는다(뷰포트 좌표) */
export interface OrbHandle { view(): GlobeView | null; setView(view: GlobeView): void; pause(): void; resume(): void; focus(): void }
export type FavoriteSection = [title: string, items: { n: GraphNode; item?: AutomationItem }[]];

export class BrainController {
  globe: Globe | null = null;
  orb: OrbHandle | null = null;
  /** 열린 카드(BrainCard)가 등록한다: 열기 · 닫기, 메인 화면 구체 크기(열린 구체 반지름), 올렸을 때 설명 자리 */
  card: { expand(): void; collapse(): void; openRadiusAt(x: number, y: number): number; placeHover(): void } | null = null;
  /** 글꼴을 다 읽거나 열린 카드가 다시 잴 때 늘린다(메인 화면 구체가 크기를 다시 정한다) */
  measureVersion = 0;
  onRunSkill: (targetId: string) => void = () => {};

  visible: Set<string>;
  expanded = new Set<string>();
  /** 잠깐 펼친 폴더: 깊은 항목을 고르거나 직접 펼친 것. 다른 것을 고르면 다시 접는다 */
  revealed = new Set<string>();
  tuckOpen: string | null = null;
  tuckShown = new Set<string>();
  selected: string | null = null;
  depth = 1;
  groupFilter: string | null = null;
  view: 'globe' | 'table' = 'globe';
  showMd = true;
  showFolder = true;
  auto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  open = false;
  scene: Scene = { items: [], edges: [], orbits: [] };
  stat = '';
  hover: GraphNode | null = null;
  announcement = '';
  automation: { items: AutomationItem[]; runs: AutomationRun[] } = { items: [], runs: [] };
  /** 실행 중인 스킬 · 루틴(automation target ID) */
  live = new Set<string>();
  previews = new Map<string, { content?: string; size?: number; modifiedAt?: string; error?: string }>();
  private version = 0;
  private listeners = new Set<() => void>();
  private tuckAll = new Map<string, GraphNode[]>();
  private tuckAt = new Map<string, Map<string, Vec3>>();
  private favoriteCache: FavoriteSection[] | null = null;
  private readonly accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

  constructor(readonly m: BrainModel) {
    this.visible = new Set(m.initial);
    this.resetExpanded();
  }

  /* ── 화면(React) 구독 ── */
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const listener of this.listeners) listener(); }
  announce(text: string) { this.announcement = text; this.emit(); }

  /* ── 렌더러 연결: 열린 카드의 캔버스가 붙을 때 · 떨어질 때 ── */
  attach(globe: Globe) {
    this.globe = globe;
    globe.setGhost(this.m.ghost);
    globe.setEdges({ markdown: this.showMd, folder: this.showFolder });
    globe.setAutoRotate(this.auto);
    this.refresh();
  }
  detach(globe: Globe) { if (this.globe === globe) this.globe = null; }
  expand() { if (!this.card) return; this.orb?.pause(); this.card.expand(); }
  collapse() { this.card?.collapse(); }

  /* ── 자리 ── */
  private resetExpanded() { this.expanded = new Set(this.m.graph.nodes.filter(n => n.kind === 'folder' && this.visible.has(n.id) && !n.folded).map(n => n.id)); }
  isShown = (id: string) => this.visible.has(id) || this.tuckShown.has(id);
  visibleAncestor(id: string): string | null {
    let n = this.m.byId.get(id);
    while (n && !this.isShown(n.id)) n = n.parentId ? this.m.byId.get(n.parentId) : undefined;
    return n ? n.id : null;
  }
  /** 접힘 = 펼치면 새로 보일 하위가 있는 폴더(접어 둔 파일은 펼치기가 아니라 고르기로 보인다) */
  isFolded = (n: GraphNode) => n.kind === 'folder' && !this.m.orbital.has(n.id) && !this.expanded.has(n.id) && (this.m.kids.get(n.id) ?? []).some(c => !isTucked(c));
  /** 구체 위 자리: 궤도 항목은 자기 위성, 행성 항목은 보이는 가장 가까운 상위(접힌 폴더). 궤도 허브(스킬/ · 루틴/)는 자리가 없다 */
  placeOf = (id: string) => (this.m.orbital.has(id) ? this.m.unitOf.get(id) ?? null : this.visibleAncestor(id));
  private sceneIdOf = (id: string | null) => (id ? this.placeOf(id) : null);
  kindOf(n: GraphNode) {
    if (n.id === this.m.graph.centerId) return '라우터';
    if (n.role === 'guide') return '안내 문서';
    if (n.kind === 'folder') return n.parentId === null ? '작업 공간' : '폴더';
    return n.extension ? `${n.extension.slice(1).toUpperCase()} 파일` : '파일';
  }

  /* ── 폴더 안에 접어 둔 파일(이미지 · 데이터 JSON) ──
     평소에는 그래프에 없고, 폴더(또는 그 안의 파일)를 고르면 그 폴더 아래 전체의 것을 그 폴더 둘레 작은 공 표면에 펼친다.
     아래 전체가 TUCK_MAX를 넘으면 바로 아래 것만 펼치고 패널에서 아래 폴더를 누르라고 안내한다. 궤도(스킬 · 루틴) 쪽은 펼치지 않는다 */
  tuckKids = (n: GraphNode) => (this.m.kids.get(n.id) ?? []).filter(c => isTucked(c) && !this.m.orbital.has(c.id));
  tuckUnder(n: GraphNode) {
    let list = this.tuckAll.get(n.id);
    if (!list) {
      const found: GraphNode[] = [];
      const walk = (f: GraphNode) => { for (const c of this.m.kids.get(f.id) ?? []) { if (this.m.orbital.has(c.id)) continue; if (isTucked(c)) found.push(c); else if (c.kind === 'folder') walk(c); } };
      if (!this.m.orbital.has(n.id)) walk(n);
      list = found; this.tuckAll.set(n.id, list);
    }
    return list;
  }
  private tuckReveal = (n: GraphNode) => { const all = this.tuckUnder(n); return all.length <= TUCK_MAX ? all : this.tuckKids(n); };
  /** 펼치면 새로 보이는 하위 수(접어 둔 파일은 빼고 센다) */
  unfoldCount = (n: GraphNode) => (this.m.kids.get(n.id) ?? []).filter(c => !isTucked(c)).length;
  private openTuck(folderId: string | null) {
    if (folderId === this.tuckOpen) return false;
    this.tuckOpen = folderId;
    this.tuckShown = new Set(folderId ? this.tuckReveal(this.m.byId.get(folderId)!).map(c => c.id) : []);
    return true;
  }
  private tuckPositions(folder: GraphNode) {
    let at = this.tuckAt.get(folder.id);
    if (!at) {
      const list = this.tuckKids(folder), c = this.m.pos.get(folder.id) ?? [0, 0, 0], rr = clamp(0.035 * Math.cbrt(list.length), 0.05, 0.2);
      at = new Map(list.map((n, i): [string, Vec3] => {
        const y = 1 - (2 * (i + 0.5)) / list.length, r = Math.sqrt(1 - y * y), a = i * 2.399963;
        return [n.id, [c[0] + Math.cos(a) * r * rr, c[1] + y * rr, c[2] + Math.sin(a) * r * rr]];
      }));
      this.tuckAt.set(folder.id, at);
    }
    return at;
  }

  /* ── 스킬 · 루틴(자동화 목록 · 실행 기록)과 잇기: 서버가 스킬 · 루틴 폴더 아래 노드마다 실행 ID(automationTargetId)를 붙인다 ── */
  automationOf = (n: GraphNode) => (n.automationTargetId ? this.automation.items.find(i => i.id === n.automationTargetId) : undefined);
  /** 스킬 · 루틴 자체(그 폴더나 SKILL.md · routine.json)인가: 패널의 실행 단추를 여기에만 둔다 */
  isAutomationRoot(n: GraphNode, item: AutomationItem) {
    const file = posix(item.path), path = n.path.normalize('NFC');
    return n.kind === 'folder' ? path === file.slice(0, file.lastIndexOf('/')) : path === file;
  }
  setAutomation(items: AutomationItem[], runs: AutomationRun[]) {
    this.automation = { items, runs }; this.favoriteCache = null;
    const next = new Set(runs.filter(run => isActive(run.status)).map(run => run.targetId));
    const changed = next.size !== this.live.size || [...next].some(id => !this.live.has(id));
    this.live = next;
    if (changed) this.refresh(); else this.emit();
  }
  private liveSet() {
    const ids = new Set<string>();
    for (const n of this.m.graph.nodes) {
      if (n.kind !== 'file' || !n.automationTargetId || !this.live.has(n.automationTargetId) || !/^(skill\.md|routine\.json)$/i.test(n.name)) continue;
      const at = this.placeOf(n.id);
      if (at) ids.add(at);
    }
    return ids;
  }

  /* ── 장면 ── */
  private buildScene(): Scene {
    const { m } = this, live = this.liveSet();
    let k = 0;
    const items: SceneItem[] = [...this.visible, ...this.tuckShown].map(id => m.byId.get(id)!).map(n => {
      const core = m.geo.core.has(n.id), area = m.geo.areaOf(n.id), d = m.depth.get(n.id) ?? 0;
      // tuckHidden: 이 폴더 바로 아래에 접어 둔 채 아직 안 보이는 이미지 · 데이터 수(위 폴더를 골라 아래 전체가 펼쳐졌으면 0)
      const tuck = this.tuckShown.has(n.id), tuckHidden = n.kind === 'folder' ? this.tuckKids(n).filter(c => !this.tuckShown.has(c.id)).length : 0, folded = this.isFolded(n);
      // 3차원 자리. 새로 보이면 부모 자리(최상위는 가운데 핵)에서 나온다. dir은 고른 항목을 앞으로 돌릴 때 쓰는 방향
      const p3 = tuck ? this.tuckPositions(m.byId.get(n.parentId!)!).get(n.id) : m.pos.get(n.id), len = p3 ? Math.hypot(p3[0], p3[1], p3[2]) || 1 : 1;
      return {
        id: n.id, node: n, core, primary: n.id === m.graph.centerId,
        dir: p3 ? [p3[0] / len, p3[1] / len, p3[2] / len] as Vec3 : m.geo.dirs.get(n.id), from: n.parentId ? m.geo.dirs.get(n.parentId) ?? null : null,
        pos: p3, fromPos: p3 && n.parentId ? m.pos.get(n.parentId) ?? [0, 0, 0] : null,
        group: n.group, color: m.colorOf(n.group), shape: SHAPES[n.ring] || 'circle',
        hollow: n.kind === 'folder', guide: n.role === 'guide',
        size: tuck ? 2.6 : n.kind === 'folder' ? Math.min(9.5, 4.2 + Math.log2(1 + area)) : n.role === 'guide' ? 6 : 4.3,
        quiet: tuck, tuck,
        // 접어 둔 파일이 있는 폴더는 고르기 전까지 점선 고리와 '+개수'(펼치면 보일 것 + 고르면 보일 이미지 · 데이터)를 단다
        folded: folded || tuckHidden > 0, badge: (folded ? this.unfoldCount(n) : 0) + tuckHidden, live: live.has(n.id),
        label: n.name, depth: d, delay: 240 + d * 120 + (k++ % 14) * 16
      };
    });
    const ring = orbitScene(m, live);
    items.push(...ring.items);
    const edges: SceneEdge[] = [];
    for (const id of [...this.visible, ...this.tuckShown]) {
      const n = m.byId.get(id)!;
      if (!n.parentId) continue;
      // 위 폴더를 골라 펼친 이미지 · 데이터의 상위 폴더가 아직 접혀 있으면 보이는 가장 가까운 상위로 잇는다(점선)
      const a = this.tuckShown.has(id) && !this.isShown(n.parentId) ? this.visibleAncestor(n.parentId) : n.parentId;
      if (!a || !this.isShown(a) || (m.geo.core.has(n.id) && m.geo.core.has(a))) continue;
      edges.push({ a, b: n.id, kind: 'folder', count: 1, rerouted: a !== n.parentId, groups: new Set([n.group]) });
    }
    // 접힌 폴더 안쪽을 가리키는 문서 링크는 보이는 가장 가까운 상위 폴더로 모은다(점선)
    const merged = new Map<string, SceneEdge>();
    for (const l of m.md) {
      const a = this.placeOf(l.source), b = this.placeOf(l.target);
      if (!a || !b || a === b || (m.geo.core.has(a) && m.geo.core.has(b))) continue;
      const key = `${a}>${b}`;
      let e = merged.get(key);
      if (!e) {
        e = { a, b, kind: 'markdown', count: 0, rerouted: false, color: a === m.graph.centerId ? this.accent : m.colorOf(m.byId.get(a)!.group), groups: new Set() };
        merged.set(key, e);
      }
      e.count++;
      // 위성 쪽은 자기 위성으로 모은 것이 정상 자리라 '접힌 폴더로 모은 링크'(점선)로 보지 않는다
      const aMoved = !m.orbital.has(l.source) && a !== l.source, bMoved = !m.orbital.has(l.target) && b !== l.target;
      if (aMoved || bMoved) e.rerouted = true;
      if (!aMoved || !bMoved) e.direct = true;
      e.groups.add(m.byId.get(l.source)!.group); e.groups.add(m.byId.get(l.target)!.group);
    }
    // 양쪽 끝이 모두 접힌 폴더 안쪽인 연결은 요약(summary)이다. 평소에는 숨기고, 그 폴더를 고르면 보인다
    for (const e of merged.values()) e.summary = !e.direct;
    return { items, edges: edges.concat([...merged.values()]), orbits: ring.orbits };
  }
  /** 이웃: 지금 보이는 선(문서 링크 · 폴더 구조 중 켜 둔 것)을 따라 depth 단계까지 */
  private focusSet(id: string) {
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => { const set = adj.get(a) ?? new Set(); set.add(b); adj.set(a, set); };
    for (const e of this.scene.edges) {
      if ((e.kind === 'markdown' && !this.showMd) || (e.kind === 'folder' && !this.showFolder)) continue;
      link(e.a, e.b); link(e.b, e.a);
    }
    const seen = new Set([id]);
    let frontier = [id];
    for (let d = 0; d < this.depth && frontier.length; d++) {
      const next: string[] = [];
      for (const x of frontier) for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); next.push(y); }
      frontier = next;
    }
    return seen;
  }
  /** 고른 항목이 구체에서 빛날 자리(궤도 허브는 없음 → 그 궤도만 또렷하게) */
  private highlight() {
    const at = this.sceneIdOf(this.selected), hub = this.selected && this.m.orbital.has(this.selected) && !at ? this.m.byId.get(this.selected)!.group : null;
    this.globe?.setHighlight({ selected: at, focus: at ? this.focusSet(at) : null, group: hub || this.groupFilter });
  }
  refresh({ reveal = false } = {}) {
    this.scene = this.buildScene();
    this.globe?.setScene(this.scene, { reveal });
    if (this.selected && !this.m.orbital.has(this.selected) && !this.visible.has(this.selected)) this.selected = this.visibleAncestor(this.selected);
    this.highlight();
    const shownMd = this.scene.edges.filter(e => e.kind === 'markdown' && !e.summary).length;
    const sats = this.m.units.length;
    this.stat = `${fmt.num(this.m.graph.nodes.length)}개 중 ${fmt.num(this.visible.size + this.tuckShown.size + sats)}개 표시 · 문서 링크 ${fmt.num(shownMd)}`;
    this.emit();
  }

  /* ── 펼치기 · 접기 ── */
  private expandFolder(id: string) {
    this.expanded.add(id);
    for (const c of this.m.kids.get(id) ?? []) if (!isTucked(c)) this.visible.add(c.id);
  }
  private collapseFolder(id: string) {
    this.expanded.delete(id);
    const hide = (pid: string) => { for (const c of this.m.kids.get(pid) ?? []) { this.visible.delete(c.id); this.expanded.delete(c.id); hide(c.id); } };
    hide(id);
  }
  toggleFold(id: string) {
    const n = this.m.byId.get(id);
    if (!n || n.kind !== 'folder' || n.parentId === null || this.m.orbital.has(id)) return;
    // 직접 펼친 폴더도 고르느라 펼친 것처럼 다른 것을 고르면 다시 접는다(unreveal)
    const wasFolded = this.isFolded(n);
    if (wasFolded) { this.expandFolder(id); this.revealed.add(id); } else { this.collapseFolder(id); this.revealed.delete(id); }
    this.refresh();
    this.announce(`${n.name} ${wasFolded ? `펼침 · 하위 ${this.unfoldCount(n)}개` : '접음'}`);
  }
  private ancestorsOf(id: string) {
    const out = new Set<string>();
    for (let n = this.m.byId.get(id); n?.parentId; n = this.m.byId.get(n.parentId)) out.add(n.parentId);
    return out;
  }
  private revealPath(id: string) {
    if (this.m.orbital.has(id)) return; // 궤도 항목은 늘 자기 위성으로 보인다
    const chain: GraphNode[] = [];
    for (let n = this.m.byId.get(id); n?.parentId;) { n = this.m.byId.get(n.parentId); if (n) chain.unshift(n); }
    for (const f of chain) if (!this.expanded.has(f.id)) { this.expandFolder(f.id); this.revealed.add(f.id); }
  }
  /** 잠깐 펼친 폴더 중 keep(새로 고른 것과 그 상위)이 아닌 것을 얕은 것부터 다시 접는다 */
  private unreveal(keep = new Set<string>()) {
    let changed = false;
    for (const id of [...this.revealed].sort((a, b) => (this.m.depth.get(a) ?? 0) - (this.m.depth.get(b) ?? 0))) {
      if (keep.has(id)) continue;
      this.revealed.delete(id);
      if (this.expanded.has(id)) { this.collapseFolder(id); changed = true; }
    }
    return changed;
  }
  expandAll() {
    this.revealed.clear();
    const queue = this.m.graph.nodes.filter(n => this.visible.has(n.id) && this.isFolded(n));
    let limited = false;
    while (queue.length) {
      const f = queue.shift()!, children = this.m.kids.get(f.id) ?? [];
      if (this.visible.size + children.length > EXPAND_LIMIT) { limited = true; break; }
      this.expandFolder(f.id);
      for (const c of children) if (this.isFolded(c)) queue.push(c);
    }
    this.refresh();
    if (limited) toast(`항목이 많아 ${fmt.num(this.visible.size)}개까지만 펼쳤습니다. 폴더를 두 번 누르면 더 펼쳐집니다`, 'info');
    else this.announce(`모두 펼침 · ${this.visible.size}개 표시`);
  }
  resetFolds() {
    this.visible = new Set(this.m.initial); this.resetExpanded(); this.revealed.clear();
    if (this.selected && !this.visible.has(this.selected)) this.clearSelection();
    this.refresh();
    this.announce('처음 상태로 접음');
  }

  /* ── 선택 ── */
  select(id: string, { rotate = true } = {}) {
    const n = this.m.byId.get(id);
    if (!n) return;
    // 접어 둔 파일이 있는 폴더를 고르면 그 폴더 둘레에, 접어 둔 파일을 고르면 그 상위 폴더 둘레에 이미지 · 데이터를 펼친다(그 밖에는 접는다)
    const tuck = isTucked(n), target = tuck && n.parentId ? n.parentId : id;
    const host = tuck ? (this.tuckShown.has(id) ? this.tuckOpen : n.parentId) : n.kind === 'folder' && this.tuckUnder(n).length ? id : null;
    // 앞서 잠깐 펼친 폴더 중 이번 것과 그 상위가 아닌 것은 다시 접는다
    const undone = this.unreveal(this.m.orbital.has(id) ? new Set() : this.ancestorsOf(target).add(target));
    const reveal = !this.m.orbital.has(id) && !this.visible.has(target);
    if (reveal) this.revealPath(target);
    const tucked = this.openTuck(host);
    if (tucked || reveal || undone) this.refresh();
    if (n.parentId === null && n.id !== this.m.graph.centerId) { this.select(this.m.graph.centerId, { rotate }); return; }
    this.selected = id;
    this.highlight();
    const at = this.sceneIdOf(id);
    if (rotate && at) this.globe?.focusOn(at);
    this.hover = null;
    this.bumpUsage(n);
    this.loadPreview(n);
    this.announce(`${n.name} 선택 · ${this.m.groupName(n.group)} · ${this.kindOf(n)}`);
  }
  clearSelection() {
    this.selected = null;
    // 펼쳐 둔 이미지 · 데이터와 잠깐 펼친 폴더를 다시 접는다
    const tucked = this.openTuck(null), undone = this.unreveal();
    if (tucked || undone) this.refresh(); else { this.highlight(); this.emit(); }
  }
  /** 열린 구체를 닫을 때: 다시 열면 접힌 채로 시작한다 */
  resetForClose() {
    this.selected = null; this.hover = null;
    this.globe?.setHighlight({ selected: null, focus: null, group: null });
    this.openTuck(null); this.unreveal();
    // 목록 보기에서 닫으면 멈춰 둔 렌더러를 다시 켜야 줄어드는 전환이 보인다
    if (this.view === 'table') { this.view = 'globe'; this.globe?.start(); }
    this.emit();
  }

  /* ── 분야 · 선 · 회전 · 보기 ── */
  setDepth(d: number) { this.depth = d; if (this.selected) this.highlight(); this.emit(); }
  setGroup(id: string | null) {
    this.groupFilter = id;
    this.highlight();
    if (id) {
      const top = this.m.graph.nodes.filter(n => n.group === id && this.visible.has(n.id) && !this.m.geo.core.has(n.id) && !this.m.orbital.has(n.id))
        .sort((a, b) => ((this.m.depth.get(a.id) ?? 0) - (this.m.depth.get(b.id) ?? 0)) || this.m.geo.areaOf(b.id) - this.m.geo.areaOf(a.id))[0];
      if (top && !this.selected) this.globe?.focusOn(top.id);
      this.announce(`${this.m.groupName(id)}만 또렷하게`);
    } else this.emit();
  }
  setEdgeKind(kind: 'markdown' | 'folder') {
    if (kind === 'markdown') this.showMd = !this.showMd; else this.showFolder = !this.showFolder;
    this.globe?.setEdges({ markdown: this.showMd, folder: this.showFolder });
    if (this.selected) this.highlight();
    this.emit();
  }
  setAuto(on: boolean) { this.auto = on; this.globe?.setAutoRotate(on); this.emit(); }
  setView(next: 'globe' | 'table') {
    this.view = next;
    if (next === 'table') this.globe?.stop();
    else { this.globe?.start(); const at = this.sceneIdOf(this.selected); if (at) this.globe?.focusOn(at); }
    this.emit();
  }

  /* ── 올렸을 때 설명: 내용은 화면이 그리고, 자리는 매 프레임 카드가 맞춘다(card.placeHover) ── */
  setHover(item: Hit | null) {
    const n = item ? item.node ?? this.m.byId.get(item.id) ?? null : null;
    if (n === this.hover) return;
    this.hover = n;
    this.emit();
  }
  hoverHint(n: GraphNode) {
    const under = n.kind === 'folder' ? this.tuckUnder(n).length : 0;
    const fold = this.isFolded(n) ? `두 번 눌러 펼치기 · 하위 ${fmt.num(this.unfoldCount(n))}개` : under ? '' : '두 번 눌러 접기';
    const tuckHint = !under || this.tuckOpen === n.id ? '' : under <= TUCK_MAX ? `눌러서 안의 이미지 · 데이터 ${fmt.num(under)}개 보기` : `안의 이미지 · 데이터 ${fmt.num(under)}개는 아래 폴더를 누르면 보입니다`;
    if (this.m.orbital.has(n.id)) return `${this.m.groupName(n.group)} 고리 · 눌러서 자세히 보기`;
    return n.kind === 'folder' && n.parentId !== null ? [tuckHint, fold].filter(Boolean).join(' · ') || '눌러서 자세히 보기' : '눌러서 자세히 보기';
  }
  /** 패널의 이미지 · 데이터 줄: 아래 전체 수와 실제로 펼친 범위 */
  tuckFact(n: GraphNode) {
    const under = n.kind === 'folder' ? this.tuckUnder(n).length : 0;
    if (!under) return null;
    const direct = under > TUCK_MAX ? this.tuckKids(n).length : 0;
    return under <= TUCK_MAX ? `${fmt.num(under)}개 · 구체에 펼침` : `${fmt.num(under)}개 · 많아서 ${direct ? `바로 아래 ${fmt.num(direct)}개만 펼침, 나머지는 ` : ''}아래 폴더를 누르면 보입니다`;
  }

  /* ── 미리보기: 고르면 앞부분을 패널에, 전체는 대화상자에 ── */
  loadPreview(n: GraphNode) {
    if (!n.capabilities.preview || this.previews.has(n.id)) return;
    this.previews.set(n.id, {});
    brainApi.preview(n.id).then(p => { this.previews.set(n.id, { content: p.content, size: p.size, modifiedAt: p.modifiedAt }); this.emit(); },
      error => { this.previews.set(n.id, { error: error instanceof Error ? error.message : '미리보기를 읽지 못했습니다.' }); this.emit(); });
  }
  reveal(n: GraphNode) {
    brainApi.reveal(n.id).then(() => toast('Finder에서 위치를 열었습니다'), error => toast(error instanceof Error ? error.message : 'Finder를 열지 못했습니다.', 'alert'));
  }
  copyPath(n: GraphNode) {
    const text = n.path ? `${this.m.graph.root}/${n.path}` : this.m.graph.root;
    navigator.clipboard.writeText(text).then(() => toast('경로를 복사했습니다'), () => toast(`복사하지 못했습니다: ${text}`, 'alert'));
  }

  /* ── 자주 쓰는 문서 · 스킬 · 루틴 ──
     스킬 · 루틴: 실행 기록(최근일수록 가중) + 실행 중 + 이 화면에서 연 횟수. 문서: 연 횟수 + 라우터 · 안내 문서 + 들어오는 링크 수 + 최근 7일 수정.
     연 횟수는 이 브라우저에만 저장한다(localStorage) */
  private usageKey = (n: GraphNode) => `${this.m.graph.root}|${n.path}`;
  private readUsage(): Record<string, number> { try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') || {}; } catch { return {}; } }
  private bumpUsage(n: GraphNode) {
    try { const u = this.readUsage(); u[this.usageKey(n)] = (u[this.usageKey(n)] || 0) + 1; localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch { /* 저장할 수 없는 환경 — 기록 없이 쓴다 */ }
    this.favoriteCache = null;
  }
  favorites(): FavoriteSection[] {
    if (this.favoriteCache) return this.favoriteCache;
    const usage = this.readUsage(), runs = this.automation.runs, runScore = new Map<string, number>();
    runs.forEach((r, i) => runScore.set(r.targetId, (runScore.get(r.targetId) || 0) + 1 + (runs.length - i) / runs.length));
    const sats = this.m.units.map(u => {
      const item = this.automationOf(u);
      return { n: u, item, score: (usage[this.usageKey(u)] || 0) * 2 + (item ? (runScore.get(item.id) || 0) * 3 : 0) + (item && this.live.has(item.id) ? 6 : 0) };
    });
    const week = Date.now() - 7 * 864e5;
    const docs = this.m.graph.nodes.filter(n => n.kind === 'file' && !this.m.orbital.has(n.id)).map(n => ({ n, item: undefined, score: (usage[this.usageKey(n)] || 0) * 3
      + (n.id === this.m.graph.centerId ? 2.5 : 0) + (n.role === 'guide' ? 1.5 : 0) + new Set(this.m.inc.get(n.id) ?? []).size * 0.3
      + (n.modifiedAt && Date.parse(n.modifiedAt) > week ? 0.4 : 0) }));
    const top = <T extends { n: GraphNode; score: number }>(list: T[], k: number) => list.filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.n.name.localeCompare(b.n.name, 'ko')).slice(0, k);
    const sat = (group: string, k: number): FavoriteSection => [this.m.groupName(group), top(sats.filter(x => x.n.group === group), k)];
    this.favoriteCache = [['문서', top(docs, 3)], sat('skills', 3), sat('routines', 2)];
    return this.favoriteCache;
  }

  /* ── 찾기: 작업 공간 전체(접힌 폴더 안까지)에서 이름 · 경로로 찾는다 ── */
  search(query: string) {
    const q = norm(query.trim());
    if (!q) return [];
    const score = (n: GraphNode) => (norm(n.name).startsWith(q) ? 0 : norm(n.name).includes(q) ? 1 : 2);
    return this.m.graph.nodes.filter(n => n.parentId !== null && norm(`${n.name} ${n.path}`).includes(q))
      .sort((a, b) => score(a) - score(b) || a.path.length - b.path.length).slice(0, 40);
  }
}
