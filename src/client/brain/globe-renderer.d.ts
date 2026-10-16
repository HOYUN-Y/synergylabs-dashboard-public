// globe-renderer.js(시안 렌더러)에서 앱이 쓰는 부분의 타입
import type { GraphNode } from '../../shared/brain';

export type Vec3 = [number, number, number];
export interface Insets { left: number; right: number; top: number; bottom: number }
export interface GlobeView { cx: number; cy: number; r: number; yaw: number; pitch: number; phases: number[] }

/** 구 표면 배치: 노드마다 방향(가운데 핵은 null) · 폴더 하위 면적 · 배치 간격 · 분야 기준 방향(anchors). 분야 기준 방향은 groups 순서로 정한다 */
export interface Layout { dirs: Map<string, Vec3 | null>; core: Set<string>; areaOf(id: string): number; step: number; anchors: Map<string, Vec3> }
export function layout(graph: { nodes: GraphNode[]; centerId: string; groups?: { id: string }[] }): Layout;
/** 3차원 배치(네트워크 구체). links의 a · b는 points 번호이고 -1은 원점에 고정된 가운데 핵 */
export function volumeLayout(points: { dir: Vec3 | null | undefined; depth: number }[], links: { a: number; b: number; kind: string }[], iterations?: number): Vec3[];
/** 신경망 배치: 공으로 모으지 않고 가지 · 송이로 펼친다(weight = 하위 파일 수). links는 volumeLayout과 같고, anchors는 layout()의 분야 기준 방향 */
export function neuralLayout(points: { dir: Vec3 | null | undefined; depth: number; group: string; folder: boolean; weight: number }[], links: { a: number; b: number; kind: string }[],
  options?: { anchors?: Map<string, Vec3>; squeeze?: number; iterations?: number }): Vec3[];

export interface SceneItem {
  id: string; node: GraphNode; group: string; color: string; shape: string; label: string; depth: number; delay: number;
  size: number; hollow: boolean; guide: boolean; folded: boolean; badge: number; live: boolean;
  core?: boolean; primary?: boolean; quiet?: boolean; tuck?: boolean;
  dir?: Vec3 | null; from?: Vec3 | null; pos?: Vec3 | null; fromPos?: Vec3 | null;
  orbit?: { index: number; slot: number; count: number }; symbol?: string | null;
}
export interface SceneEdge { a: string; b: string; kind: 'folder' | 'markdown'; count: number; rerouted: boolean; direct?: boolean; summary?: boolean; color?: string; groups: Set<string> }
export interface SceneOrbit {
  id: string; label: string; count: number; color: string; radius: number; speed: number; phase: number;
  arcStart: number; arcEnd: number; labelAt: number; space?: 'model'; labelSide?: 'left' | 'right';
}
export interface Scene { items: SceneItem[]; edges: SceneEdge[]; orbits: SceneOrbit[] }
export interface Ghost { nodes: { id: string; pos: Vec3; color: string; group: string; file: boolean }[]; edges: { a: number; b: number; kind: string; color: string }[] }
/** 올리거나 누른 대상: 장면 항목이거나 별자리 점({ id, ghost }) */
export interface Hit { id: string; node?: GraphNode; ghost?: boolean }

export interface Globe {
  setScene(scene: Scene, options?: { reveal?: boolean }): void;
  setHighlight(next: { selected?: string | null; focus?: Set<string> | null; group?: string | null }): void;
  setGhost(ghost: Ghost | null): void;
  setEdges(next: { markdown?: boolean; folder?: boolean }): void;
  setInsets(next: Partial<Insets>): void;
  setAnchor(anchor: { x: number; y: number; r: number } | null): void;
  setAutoRotate(on: boolean): void;
  getAutoRotate(): boolean;
  zoomBy(factor: number): void;
  resetView(): void;
  focusOn(id: string): void;
  intro(from: (GlobeView & { solid?: boolean }) | null): void;
  outro(done: () => void, to?: GlobeView | null): void;
  start(): void;
  stop(): void;
  fitFor(box: { width: number; height: number; insets: Insets }, x: number, y: number): number;
  target(): { cx: number; cy: number; r: number; ring: number };
  view(): GlobeView;
  setView(view: GlobeView): void;
  redraw(): void;
  spinBy(delta: number): void;
  setSpinScale(scale: number): void;
  screenOf(id: string): { x: number; y: number; r: number } | null;
  destroy(): void;
}
export function createGlobe(canvas: HTMLCanvasElement,
  hooks?: { onHover?(item: Hit | null, point?: { x: number; y: number }): void; onClick?(item: Hit | null): void; onDoubleClick?(item: Hit): void; onFrame?(): void },
  options?: { mode?: 'button'; spin?: number; radius?(width: number, height: number): number; neural?: boolean }): Globe;
