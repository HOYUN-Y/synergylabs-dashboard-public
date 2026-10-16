// 세컨드 브레인 궤도(스킬 · 루틴 고리) 판정 — 화면(document)에 기대지 않는 부분만 따로 두어 시험한다
import type { BrainGraph, GraphNode } from '../../shared/brain';

export const ORBIT_GROUPS = ['skills', 'routines'] as const;
const DEFINITION = /^(skill\.md|routine\.json)$/i;

export interface Orbit {
  /** 궤도 쪽 항목(행성 배치에서 뺀다) */
  orbital: Set<string>;
  /** 궤도 항목 → 그 위성(폴더) id. 위성이 없는 항목(설정 폴더 바로 아래 파일 · 설정 폴더 자신)은 없다 = 고리 전체 */
  unitOf: Map<string, string>;
  orbitList: { id: string; units: GraphNode[] }[];
}

/* 두 가지가 궤도에 오른다(2026-10-16 — 여러 폴더에 흩어진 스킬 · 루틴 대응).
   1) 설정 폴더(groups[].folder — 스킬/ · 루틴/) 아래에서 같은 분류인 항목. 위성은 그 폴더 바로 아래 폴더다(지금까지와 같다. 깊이는 설정 폴더 기준)
   2) 설정 폴더 밖이라도 SKILL.md · skill.md · routine.json이 있는 폴더(서버가 분류 skills · routines를 붙인다). 그 폴더가 위성이고 안쪽은 그 위성에 속한다.
      스킬 안에 또 스킬이 있으면 가까운 쪽 위성에 속한다(스킬 목록도 둘을 따로 보여 준다). 고리는 정의 파일을 따른다(스킬/ 안의 routine.json → 루틴 고리) */
export function orbitOf(graph: Pick<BrainGraph, 'nodes' | 'groups' | 'centerId'>, byId: Map<string, GraphNode>, depth: Map<string, number>): Orbit {
  const groups = new Set<string>(ORBIT_GROUPS);
  const under = (n: GraphNode, path: string) => n.path === path || n.path.startsWith(`${path}/`);
  const hubs = new Map<string, GraphNode>();
  for (const g of ORBIT_GROUPS) {
    // folder가 없는 응답(이전 형식 · 시안 가상 지도)은 지금까지처럼 루트 바로 아래 같은 분류 폴더를 쓴다
    const folder = graph.groups.find(x => x.id === g)?.folder;
    const hub = graph.nodes.find(n => n.kind === 'folder' && n.parentId !== null
      && (folder === undefined ? n.group === g && depth.get(n.id) === 1 : n.path === folder));
    if (hub) hubs.set(g, hub);
  }
  // 설정 폴더 밖의 정의 파일 폴더(같은 분류인 것만)
  const roots = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.kind !== 'file' || !DEFINITION.test(n.name) || !n.parentId) continue;
    const folder = byId.get(n.parentId);
    if (!folder || folder.parentId === null || !groups.has(folder.group)) continue;
    const hub = hubs.get(folder.group);
    if (hub && under(folder, hub.path)) continue;
    roots.set(folder.id, folder);
  }
  const orbital = new Set<string>(), unitOf = new Map<string, string>(), units = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (n.parentId === null || n.id === graph.centerId || !groups.has(n.group)) continue;
    const hub = hubs.get(n.group);
    if (hub && under(n, hub.path)) {
      orbital.add(n.id);
      const level = (depth.get(hub.id) ?? 0) + 1;
      let x: GraphNode | undefined = n;
      while (x && (depth.get(x.id) ?? 0) > level) x = x.parentId ? byId.get(x.parentId) : undefined;
      if (x && depth.get(x.id) === level && x.kind === 'folder') unitOf.set(n.id, x.id);
      if (n.kind === 'folder' && depth.get(n.id) === level) units.set(n.id, n);
      continue;
    }
    let x: GraphNode | undefined = n;
    while (x && !(roots.has(x.id) && roots.get(x.id)!.group === n.group)) x = x.parentId ? byId.get(x.parentId) : undefined;
    if (!x) continue;
    orbital.add(n.id); unitOf.set(n.id, x.id); units.set(x.id, x);
  }
  const orbitList = ORBIT_GROUPS.map(g => ({ id: g as string, units: [...units.values()].filter(u => u.group === g).sort((a, b) => a.name.localeCompare(b.name, 'ko')) }))
    .filter(o => o.units.length);
  return { orbital, unitOf, orbitList };
}

/** 위성 이름표: 같은 고리에 같은 이름이 둘 이상이면 서로 달라지는 가장 가까운 상위 폴더 이름을 붙여 구분한다
    (예: workflows/a/skills/research · workflows/b/skills/research → research · a, research · b) */
export function unitLabels(units: GraphNode[], byId: Map<string, GraphNode>) {
  const ancestor = (u: GraphNode, k: number) => {
    let x: GraphNode | undefined = u;
    for (let i = 0; i < k && x; i++) x = x.parentId ? byId.get(x.parentId) : undefined;
    return x && x.parentId !== null ? x.name : '';
  };
  const labels = new Map(units.map(u => [u.id, u.name]));
  const same = new Map<string, GraphNode[]>();
  for (const u of units) same.set(u.name, [...(same.get(u.name) ?? []), u]);
  for (const list of same.values()) {
    if (list.length < 2) continue;
    let k = 1;
    for (; k < 12; k++) if (new Set(list.map(u => ancestor(u, k))).size === list.length) break;
    if (k === 12) k = 1;
    for (const u of list) { const up = ancestor(u, k); if (up) labels.set(u.id, `${u.name} · ${up}`); }
  }
  return labels;
}
