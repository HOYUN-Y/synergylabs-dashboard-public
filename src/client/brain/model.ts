// 세컨드 브레인 구체의 데이터 모델 — 시안 js/brain-globe.js의 buildModel · buildNetwork · orbitScene을 옮겼다(네트워크 구체만).
// 분야 순서 · 이름 · 색은 서버 응답(config/second-brain.json)을 따른다. 색은 검은 바탕용 dark, 설정에 색이 없는 스킬 · 루틴은 --g-<분야> 토큰.
import type { BrainGraph, GraphLink, GraphNode } from '../../shared/brain';
import iconSprite from '../brand/icons.svg?raw';
import { layout, neuralLayout } from './globe-renderer.js';
import type { Ghost, Layout, SceneItem, SceneOrbit, Vec3 } from './globe-renderer.js';

export const SHAPES: Record<string, string> = { skill: 'diamond', doc: 'circle', asset: 'square', routine: 'triangle' };
const TAU = Math.PI * 2;
// 궤도에 올리는 분야. 스킬 · 루틴은 토성 고리처럼 기울어진 두 원(안쪽 스킬 · 바깥 루틴)을 도는 아이콘 위성이다(반지름 · 한 바퀴 초 · 시작 각)
const SATURN: Record<string, { radius: number; period: number; phase: number }> = {
  skills: { radius: 1.3, period: 140, phase: 0.6 }, routines: { radius: 1.52, period: 220, phase: 2.4 }
};
/* 폴더 안에 접어 두는 파일: 이미지 · 수집/실행 데이터 JSON(manifest.json은 목록이라 남긴다). 그래프(3차원 배치 · 별자리)에는 넣지 않고,
   폴더를 고르면 그 폴더 둘레에 펼친다 — 실제 사본에서 노드의 60%가 넘어 그래프가 한 덩어리로 뭉쳤다 */
const TUCK_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico', '.tif', '.tiff', '.heic', '.json']);
export const isTucked = (n: GraphNode) => n.kind === 'file' && TUCK_EXT.has(n.extension ?? '') && n.name !== 'manifest.json';

export type FullGraph = BrainGraph & { visible: string[] };
export interface BrainModel {
  graph: FullGraph; byId: Map<string, GraphNode>; kids: Map<string, GraphNode[]>; depth: Map<string, number>; geo: Layout;
  md: GraphLink[]; out: Map<string, string[]>; inc: Map<string, string[]>;
  shownGroups: BrainGraph['groups']; counts: Record<string, number>; filesUnder: Map<string, number>;
  /** 궤도(스킬 · 루틴) 쪽 항목 · 그 위성(스킬 · 루틴 하나 = 깊이 2 폴더) */
  orbital: Set<string>; unitOf: Map<string, string>; orbitList: { id: string; units: GraphNode[] }[]; units: GraphNode[]; unitIds: Set<string>;
  /** 처음 보이는 항목(궤도 쪽 · 접어 둔 파일 제외) */
  initial: Set<string>;
  /** 3차원 자리(행성 = 그래프의 문서 · 폴더)와 별자리 */
  pos: Map<string, Vec3>; ghost: Ghost;
  colorOf(group: string): string; groupName(group: string): string;
}

export function buildModel(graph: FullGraph): BrainModel {
  const css = getComputedStyle(document.documentElement);
  const configured = new Map(graph.groups.map(g => [g.id, g]));
  // 설정 dark(검은 바탕용) → --g-<분야> 토큰(설정에 색이 없는 스킬 · 루틴) → 설정 color(흰 바탕용) → --stone
  const colorOf = (group: string) => configured.get(group)?.dark || css.getPropertyValue(`--g-${group}`).trim() || configured.get(group)?.color || css.getPropertyValue('--stone').trim();
  const groupName = (id: string) => configured.get(id)?.name ?? id;
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const kids = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (!n.parentId || !byId.has(n.parentId)) continue;
    const list = kids.get(n.parentId) ?? [];
    list.push(n); kids.set(n.parentId, list);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || a.name.localeCompare(b.name, 'ko'));
  const depth = new Map<string, number>();
  const depthOf = (n: GraphNode): number => {
    const known = depth.get(n.id);
    if (known !== undefined) return known;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const d = parent ? depthOf(parent) + 1 : 0;
    depth.set(n.id, d);
    return d;
  };
  graph.nodes.forEach(depthOf);
  /* 궤도 항목: 스킬 · 루틴 분야 중 같은 분야의 최상위 폴더(스킬/ · 루틴/) 아래에 있는 것. 최상위 폴더는 궤도 자체(허브),
     그 바로 아래 폴더(깊이 2 — 스킬 · 루틴 하나)가 위성이고, 더 깊은 파일은 자기 위성에 속한다. 다른 곳에 놓인 스킬은 행성에 그대로 둔다 */
  const topOf = (n: GraphNode) => {
    let x: GraphNode | undefined = n;
    while (x?.parentId && byId.get(x.parentId) && byId.get(x.parentId)!.parentId !== null) x = byId.get(x.parentId);
    return x;
  };
  const orbital = new Set(graph.nodes.filter(n => {
    if (n.parentId === null || n.id === graph.centerId || !(n.group in SATURN)) return false;
    return topOf(n)?.group === n.group;
  }).map(n => n.id));
  const unitOf = new Map<string, string>();
  for (const n of graph.nodes) {
    if (!orbital.has(n.id)) continue;
    let x: GraphNode | undefined = n;
    while (x && depth.get(x.id)! > 2) x = x.parentId ? byId.get(x.parentId) : undefined;
    if (x && depth.get(x.id) === 2 && x.kind === 'folder') unitOf.set(n.id, x.id);
  }
  const orbitList = Object.keys(SATURN).map(g => ({ id: g, units: graph.nodes
    .filter(n => orbital.has(n.id) && n.group === g && depth.get(n.id) === 2 && n.kind === 'folder').sort((a, b) => a.name.localeCompare(b.name, 'ko')) }))
    .filter(o => o.units.length);
  const units = orbitList.flatMap(o => o.units);
  // 행성 배치는 궤도 항목을 뺀 문서만으로 정한다
  const geo = layout({ ...graph, nodes: graph.nodes.filter(n => !orbital.has(n.id)) });
  const md = graph.links.filter(l => l.kind === 'markdown');
  const out = new Map<string, string[]>(), inc = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); };
  for (const l of md) { push(out, l.source, l.target); push(inc, l.target, l.source); }
  const counts: Record<string, number> = {};
  for (const n of graph.nodes) if (n.kind === 'file' && n.role !== 'router') counts[n.group] = (counts[n.group] ?? 0) + 1;
  const shownGroups = graph.groups.filter(g => graph.nodes.some(n => n.group === g.id && !geo.core.has(n.id)));
  const filesUnder = new Map<string, number>();
  const countFiles = (n: GraphNode): number => {
    const known = filesUnder.get(n.id);
    if (known !== undefined) return known;
    const c = n.kind === 'file' ? 1 : (kids.get(n.id) ?? []).reduce((sum, k) => sum + countFiles(k), 0);
    filesUnder.set(n.id, c);
    return c;
  };
  graph.nodes.forEach(countFiles);
  const initial = new Set(graph.visible.filter(id => byId.has(id) && !orbital.has(id) && !isTucked(byId.get(id)!)));

  /* 네트워크 구체: 행성의 문서 · 폴더를 신경망처럼 가지 · 송이로 펼치고(neuralLayout — 신경망 시안. 구 표면 배치의 방향 · 트리 깊이에서 출발하는 힘 배치로,
     먼 점끼리도 밀고 폴더 → 파일은 짧게 · 폴더 → 하위 폴더는 하위 파일 수만큼 길게 잇는다. 스킬 · 루틴은 지금처럼 배치에서 빼고 궤도에 둔다),
     별자리(접힌 폴더 안까지 모든 점과 폴더 관계 · 문서 링크 선, 중복 · 자기 링크 제외)를 만든다. 색은 분야(링크는 링크한 문서의 분야).
     가운데 핵(번호 -1 = 원점)으로 가는 연결도 넣어 최상위 폴더 · 안내 문서가 가운데 쪽으로 당겨진다 */
  const planet = graph.nodes.filter(n => !geo.core.has(n.id) && !orbital.has(n.id) && !isTucked(n));
  const at = new Map(planet.map((n, i) => [n.id, i])), seen = new Set<string>();
  const end = (id: string | null) => (id === null ? undefined : at.has(id) ? at.get(id)! : geo.core.has(id) ? -1 : undefined);
  const links: Ghost['edges'] = [];
  for (const n of planet) { const p = end(n.parentId); if (p !== undefined) links.push({ a: p, b: at.get(n.id)!, kind: 'folder', color: colorOf(n.group) }); }
  for (const l of md) {
    const a = end(l.source), b = end(l.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ a, b, kind: 'markdown', color: colorOf(byId.get(l.source)!.group) });
  }
  const xyz = neuralLayout(planet.map(n => ({ dir: geo.dirs.get(n.id), depth: depth.get(n.id) || 1, group: n.group, folder: n.kind === 'folder', weight: filesUnder.get(n.id) || 0 })),
    links, { anchors: geo.anchors });
  const pos = new Map(planet.map((n, i) => [n.id, xyz[i]]));
  const ghost: Ghost = { nodes: planet.map((n, i) => ({ id: n.id, pos: xyz[i], color: colorOf(n.group), group: n.group, file: n.kind === 'file' })),
    edges: links.filter(l => l.a >= 0 && l.b >= 0) };
  return { graph, byId, kids, depth, geo, md, out, inc, shownGroups, counts, filesUnder, orbital, unitOf, orbitList, units,
    unitIds: new Set(units.map(u => u.id)), initial, pos, ghost, colorOf, groupName };
}

/* 위성 · 고리: 열린 구체와 메인 화면 구체가 같은 고리를 쓴다. 분야마다 고리 하나를 통째로 쓰고 위성을 같은 간격으로 앉히며,
   이름은 고리 끝(스킬 왼쪽 · 루틴 오른쪽)에 고정한다. 위성은 스킬 · 루틴 카드와 같은 아이콘(#i-skill · #i-routine)으로 그린다 */
export function orbitScene(m: BrainModel, live = new Set<string>()): { items: SceneItem[]; orbits: SceneOrbit[] } {
  const items: SceneItem[] = [];
  const orbits = m.orbitList.map((o, index): SceneOrbit => {
    const ring = SATURN[o.id];
    o.units.forEach((u, slot) => items.push({
      id: u.id, node: u, orbit: { index, slot, count: o.units.length }, group: u.group, color: m.colorOf(u.group), shape: SHAPES[u.ring] || 'circle',
      symbol: o.id === 'skills' ? 'skill' : 'routine', hollow: false, guide: u.role === 'guide', size: 8, folded: false, badge: 0, live: live.has(u.id),
      label: u.name, depth: 2, delay: 900 + index * 240 + slot * 40
    }));
    return { id: o.id, label: m.groupName(o.id), count: o.units.length, color: m.colorOf(o.id), radius: ring.radius, speed: TAU / ring.period, phase: ring.phase,
      space: 'model', arcStart: 0, arcEnd: TAU, labelAt: o.id === 'skills' ? Math.PI : 0, labelSide: o.id === 'skills' ? 'left' : 'right' };
  });
  return { items, orbits };
}

/* 렌더러는 위성 아이콘을 페이지 안의 #i-skill · #i-routine 심볼에서 읽는다(시안은 아이콘 묶음을 페이지에 심었다).
   앱은 아이콘 묶음을 파일로 쓰므로 그 두 심볼만 숨은 SVG로 한 번 넣는다 */
export function mountGlobeSymbols() {
  if (document.getElementById('i-skill')) return;
  const sprite = new DOMParser().parseFromString(iconSprite, 'image/svg+xml');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true'); svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  for (const name of ['skill', 'routine']) {
    const symbol = sprite.querySelector(`symbol[id="${name}"]`);
    if (!symbol) continue;
    const copy = document.importNode(symbol, true) as Element;
    copy.id = `i-${name}`; svg.append(copy);
  }
  document.body.append(svg);
}
