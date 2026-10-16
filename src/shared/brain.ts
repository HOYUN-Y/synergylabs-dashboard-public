export type BrainRing = 'skill' | 'doc' | 'asset' | 'routine';
export interface GraphNode {
  id: string;
  parentId: string | null;
  path: string;
  name: string;
  kind: 'folder' | 'file';
  role: 'router' | 'guide' | 'item';
  ring: BrainRing;
  /** 'skills' · 'routines' · 'other' 또는 설정(config/second-brain.json fields)의 분야 id */
  group: string;
  extension?: string;
  modifiedAt?: string;
  childCount: number;
  folded: boolean;
  capabilities: { preview: boolean; reveal: boolean };
  /** Join with automation/catalog; availability is determined by that catalog, not this ID. */
  automationTargetId?: string;
  /** 주 라우터·분야 안내의 해당 링크 항목만 포함한다. */
  searchHints?: { sourcePath: string; text: string }[];
}
export interface GraphLink {
  source: string;
  target: string;
  sourcePath: string;
  targetPath: string;
  kind: 'folder' | 'markdown';
}
export interface BrainGraph {
  root: string;
  routerId: string | null;
  centerId: string;
  nodes: GraphNode[];
  /** all=1 응답에만: 처음 보이는 노드 ID. 이때 nodes에는 접힌 폴더 안까지 전체 노드가 온다(세컨드 브레인 구체의 3차원 배치용) */
  visible?: string[];
  /** File-level endpoints may be folded; use paths to find the deepest visible ancestor. */
  links: GraphLink[];
  /** 설정(config/second-brain.json) 순서: 스킬 · 분야들 · 루틴 · 기타. folder는 작업 공간 루트 기준(기타는 없음),
   *  color · ramp(진하기 4단계, 진함 → 옅음, 흰 바탕 기준) · dark(검은 바탕 — 세컨드 브레인 구체)는 설정에 색이 있는 분야만 */
  groups: { id: GraphNode['group']; name: string; ring: BrainRing; folder?: string; color?: string; ramp?: string[]; dark?: string }[];
  warnings: string[];
  scannedAt: string;
  totalNodes: number;
}
export interface BrainExpansion { nodes: GraphNode[]; links: GraphLink[]; scannedAt: string }
export interface BrainSearchMatch { kind: 'name' | 'path' | 'routing' | 'body'; excerpt?: string; sourcePath?: string }
export interface BrainSearchResult { node: GraphNode; ancestors: GraphNode[]; match?: BrainSearchMatch }
export interface BrainSearch {
  results: BrainSearchResult[]; truncated: boolean; scannedAt: string;
  /** 본문 검색에서 읽은 수·누락 수. 지도 스캔 누락도 partial에 포함한다. */
  searchedFiles?: number; skippedFiles?: number; partial?: boolean;
}
export interface BrainPreview { id: string; path: string; extension: string; size: number; modifiedAt: string; content: string; format: 'text' }
