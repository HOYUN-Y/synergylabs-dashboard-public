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
export interface BrainSearch { results: { node: GraphNode; ancestors: GraphNode[] }[]; truncated: boolean; scannedAt: string }
export interface BrainPreview { id: string; path: string; extension: string; size: number; modifiedAt: string; content: string; format: 'text' }
