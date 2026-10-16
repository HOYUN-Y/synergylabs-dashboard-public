// File-first graph and folded-folder model inspired by Rubric Second Brain.
// Jay E | RoboNuggets — https://skool.com/robonuggets — CC BY 4.0.
// Reimplemented for the dashboard's IDs, request boundaries, categories and memory cache.
import { automationTargetId } from '../automation/catalog.js';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { WorkspaceSettings } from '../../shared/workspace.js';
import type { BrainExpansion, BrainGraph, BrainPreview, BrainSearch, BrainSearchMatch, GraphLink, GraphNode } from '../../shared/brain.js';
import { includesTerms, quickSearch, searchExcerpt, searchTerms } from '../../shared/brain-search.js';
import { brainNodeId } from '../brain.js';
import { scanWorkspace } from '../workspace-scan.js';
import { extractLinks, normalized, createLinkResolver, routingRows } from './links.js';
import type { RawLink } from './links.js';
import { BrainError, checkedPath, excludedPath, readText, revealInFinder, textExtensions } from './files.js';
import { BrainConfigError, areaOf, groupsOf, loadBrainConfig, routeGuides } from './config.js';
import type { BrainConfig } from './config.js';

const settingKey = (settings: WorkspaceSettings) => `${settings.workspace}\0${settings.outputDirectory}`;
interface Snapshot {
  key: string; epoch: number; at: number; root: string; output: string; scannedAt: string;
  nodes: GraphNode[]; byId: Map<string, GraphNode>; byPath: Map<string, GraphNode>;
  links: GraphLink[]; visible: Set<string>; warnings: string[]; router: GraphNode | undefined; groups: BrainGraph['groups'];
  bodies: Map<string, string>; bodyBytes: number; inventoryIncomplete: boolean;
}

export class BrainGraphService {
  private snapshot?: Snapshot;
  private flight?: { key: string; epoch: number; promise: Promise<Snapshot> };
  private epoch = 0;
  private parsed = new Map<string, { stamp: string; raw: RawLink[] }>();
  constructor(private settings: () => Promise<WorkspaceSettings>, private options: {
    now?: () => number; platform?: string; reveal?: (path: string) => Promise<void>;
    /** 시험용: 주지 않으면 지도를 만들 때마다 config/second-brain.json을 읽는다 */
    config?: BrainConfig;
  } = {}) {}
  invalidate() { this.epoch++; this.snapshot = undefined; this.flight = undefined; }
  private async config() {
    if (this.options.config) return this.options.config;
    try { return await loadBrainConfig(); }
    catch (error) { throw new BrainError('CONFIG_INVALID', 500, error instanceof BrainConfigError ? error.message : '세컨드 브레인 설정을 읽지 못했습니다.'); }
  }
  private async current(snapshot: Pick<Snapshot, 'key' | 'epoch'>) {
    const settings = await this.settings();
    if (snapshot.epoch !== this.epoch || settingKey(settings) !== snapshot.key) throw new BrainError('CONFIG_CHANGED', 409, '작업 공간이 변경되었습니다. 지도를 다시 조회해 주세요.');
  }
  private async load(force = false): Promise<Snapshot> {
    const settings = await this.settings(), key = settingKey(settings), now = this.options.now ?? Date.now;
    if (force) this.invalidate();
    if (this.snapshot?.key === key && now() - this.snapshot.at < 300000) return this.snapshot;
    if (this.flight?.key === key && this.flight.epoch === this.epoch) return this.flight.promise;
    const epoch = this.epoch;
    const promise = this.build(settings, key, epoch, force).then(async snapshot => {
      await this.current(snapshot); this.snapshot = snapshot; return snapshot;
    }).finally(() => { if (this.flight?.promise === promise) this.flight = undefined; });
    this.flight = { key, epoch, promise };
    return promise;
  }
  private async build(settings: WorkspaceSettings, key: string, epoch: number, force: boolean): Promise<Snapshot> {
    const config = await this.config(), groups = groupsOf(config);
    const inventory = await scanWorkspace(settings.workspace, settings.outputDirectory, force);
    const root = inventory.root, output = settings.outputDirectory;
    const id = (path: string) => brainNodeId(root, path);
    const nodes: GraphNode[] = [], warnings = [...inventory.warnings];
    const warningSet = new Set(warnings);
    const warn = (message: string) => {
      if (warningSet.has(message)) return;
      warningSet.add(message);
      if (warnings.length < 200) warnings.push(message); else if (warnings.length === 200) warnings.push('추가 경고는 생략했습니다.');
    };
    const canReveal = (this.options.platform ?? process.platform) === 'darwin';
    const makeNode = (path: string, kind: GraphNode['kind'], modifiedAt?: string): GraphNode => {
      const extension = kind === 'file' ? extname(path).toLowerCase() : undefined;
      return { id: id(path), parentId: path ? id(dirname(path) === '.' ? '' : dirname(path)) : null,
        path, name: basename(path || root), kind, role: normalized(path) === config.routerFile ? 'router' : 'item',
        ring: 'doc', group: 'other', ...(extension ? { extension } : {}), ...(modifiedAt ? { modifiedAt } : {}),
        childCount: 0, folded: kind === 'folder', capabilities: { preview: !!extension && textExtensions.has(extension), reveal: canReveal } };
    };
    for (const path of inventory.folders) if (!path || !excludedPath(path)) nodes.push(makeNode(path, 'folder'));
    for (const file of inventory.files) if (!excludedPath(file.path)) nodes.push(makeNode(file.path, 'file', file.modifiedAt));
    const byId = new Map(nodes.map(n => [n.id, n])), byPath = new Map(nodes.map(n => [n.path, n]));
    const links: GraphLink[] = [];
    const link = (source: GraphNode, target: GraphNode, kind: GraphLink['kind']) => links.push({ source: source.id, target: target.id, sourcePath: source.path, targetPath: target.path, kind });
    for (const node of nodes) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) { parent.childCount++; link(parent, node, 'folder'); }
    }
    const paths = nodes.map(n => n.path), nextParsed = new Map<string, { stamp: string; raw: RawLink[] }>();
    const resolveLinks = createLinkResolver(paths);
    const router = nodes.find(n => n.role === 'router');
    let parsedBytes = 0, limited = false;
    // 라우터를 먼저 분석한다: 분야 안내를 라우터의 링크로 정하므로 분석 상한에 걸려도 빠지지 않게
    for (const node of router ? [router, ...nodes.filter(n => n !== router)] : nodes) {
      if (node.extension !== '.md') continue;
      try {
        const file = await checkedPath(root, node.path, output), info = await lstat(file);
        if (!info.isFile() || info.size > 1024 * 1024) { warn(`${node.path}: Markdown 분석 크기 제한(1MiB)`); continue; }
        parsedBytes += info.size;
        if (parsedBytes > 64 * 1024 * 1024 || links.length >= 100000) { limited = true; break; }
        const cacheKey = `${key}\0${node.path}`, stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
        const cached = this.parsed.get(cacheKey);
        const entry = cached?.stamp === stamp ? cached : { stamp, raw: extractLinks((await readText(root, node.path, output, 1024 * 1024)).content) };
        nextParsed.set(cacheKey, entry);
        const resolved = resolveLinks(node.path, entry.raw);
        for (const target of resolved.targets) { if (links.length >= 100000) { limited = true; break; } link(node, byPath.get(target)!, 'markdown'); }
        resolved.warnings.forEach(warn);
      } catch { warn(`${node.path}: 문서 링크를 읽지 못했습니다.`); }
    }
    if (limited) warn('Markdown 분석 범위(64MiB·연결 100,000개)에 도달했습니다. 일부 연결만 표시합니다.');
    if (!router) warn(`${config.routerFile}가 없어 실제 폴더 구조를 중심으로 표시합니다.`);
    // 분야 안내: 라우터가 각 영역(스킬 · 분야 · 루틴) 폴더 바로 아래에서 링크하는 첫 .md. 설정에는 안내 경로를 적지 않는다
    const routerTargets = router ? links.filter(l => l.kind === 'markdown' && l.source === router.id && byId.get(l.target)?.kind === 'file').map(l => l.targetPath) : [];
    const guidePaths = routeGuides(config, routerTargets);
    const folderPaths = new Set(nodes.filter(n => n.kind === 'folder').map(n => normalized(n.path)));
    for (const area of config.areas) {
      const guide = guidePaths.get(area.id);
      if (guide) byPath.get(guide)!.role = 'guide';
      else if (!folderPaths.has(area.folder)) warn(`설정의 '${area.name}' 폴더(${area.folder})가 작업 공간에 없습니다.`);
      else if (router) warn(`${config.routerFile}가 '${area.name}' 폴더(${area.folder}) 바로 아래의 안내 문서를 링크하지 않습니다.`);
    }
    const guideNodes = nodes.filter(n => n.role === 'guide');
    for (const guide of [...(router ? [router] : []), ...guideNodes]) {
      try {
        const { content } = await readText(root, guide.path, output, 1024 * 1024);
        for (const row of routingRows(content)) {
          for (const target of resolveLinks(guide.path, row.links).targets) {
            const node = byPath.get(target)!;
            const hint = { sourcePath: guide.path, text: row.text };
            node.searchHints ??= [];
            if (!node.searchHints.some(h => h.sourcePath === hint.sourcePath && h.text === hint.text)) node.searchHints.push(hint);
          }
        }
      } catch { warn(`${guide.path}: 라우팅 검색 정보를 읽지 못했습니다.`); }
    }
    const automationRoots = new Map<string, { group: GraphNode['group']; targetId: string }>();
    for (const node of nodes) if (['SKILL.md', 'skill.md', 'routine.json'].includes(node.name)) {
      if (automationRoots.has(dirname(node.path))) continue;
      automationRoots.set(dirname(node.path), { group: node.name === 'routine.json' ? 'routines' : 'skills',
        targetId: automationTargetId(root, join(root, node.path)) });
    }
    for (const node of nodes) {
      const automation = [...automationRoots].filter(([p]) => node.path === p || node.path.startsWith(p + '/')).sort((a, b) => b[0].length - a[0].length)[0]?.[1];
      node.group = automation?.group ?? areaOf(config, node.path) ?? 'other';
      if (automation) node.automationTargetId = automation.targetId;
    }
    // Unclassified linked material inherits only an unambiguous guide category.
    const outgoing = new Map<string, string[]>();
    for (const edge of links) { const targets = outgoing.get(edge.source) ?? []; targets.push(edge.target); outgoing.set(edge.source, targets); }
    const inherited = new Map<string, Set<GraphNode['group']>>();
    for (const guide of guideNodes) {
      const visited = new Set<string>([guide.id]), queue = [guide.id];
      for (let i = 0; i < queue.length; i++) for (const target of outgoing.get(queue[i]) ?? []) {
        if (visited.has(target)) continue; visited.add(target);
        const node = byId.get(target)!;
        if (!node.path || node.role === 'router' || (node.group !== 'other' && node.group !== guide.group)) continue;
        if (node.group === 'other') { const categories = inherited.get(target) ?? new Set(); categories.add(guide.group); inherited.set(target, categories); }
        queue.push(target);
      }
    }
    for (const node of nodes) {
      const categories = inherited.get(node.id);
      if (node.group === 'other' && categories?.size === 1) node.group = [...categories][0];
      node.ring = groups.find(g => g.id === node.group)!.ring;
    }
    const visible = new Set<string>([id(''), ...(router ? [router.id] : [])]);
    const visibleDirectories = new Set<string>(['']);
    for (const node of guideNodes) {
      visible.add(node.id);
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) visibleDirectories.add(parent.path);
      while (parent) { visible.add(parent.id); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    }
    for (const node of nodes) if (node.parentId && visibleDirectories.has(byId.get(node.parentId)!.path)) visible.add(node.id);
    for (const node of nodes) if (visibleDirectories.has(node.path)) node.folded = false;
    const snapshot: Snapshot = { key, epoch, root, output, at: (this.options.now ?? Date.now)(), scannedAt: new Date().toISOString(), nodes, byId, byPath, links, visible, warnings, router, groups,
      bodies: new Map(), bodyBytes: 0, inventoryIncomplete: inventory.warnings.length > 0 };
    await this.current(snapshot); this.parsed = nextParsed;
    return snapshot;
  }
  /** all: 접힌 폴더 안까지 전체 노드와 처음 보이는 노드 ID(visible)를 함께 준다 */
  async graph(force = false, all = false): Promise<BrainGraph> {
    const s = await this.load(force); await this.current(s);
    return { root: s.root, routerId: s.router?.id ?? null, centerId: s.router?.id ?? brainNodeId(s.root, ''),
      nodes: all ? s.nodes : s.nodes.filter(n => s.visible.has(n.id)), ...(all ? { visible: [...s.visible] } : {}), links: s.links, groups: s.groups, warnings: s.warnings, scannedAt: s.scannedAt, totalNodes: s.nodes.length };
  }
  private async node(id: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new BrainError('INVALID_INPUT', 400, '올바른 자료 ID가 필요합니다.');
    const s = await this.load(), node = s.byId.get(id);
    if (!node) throw new BrainError('NOT_FOUND', 404, '자료를 찾을 수 없습니다. 지도를 새로고침해 주세요.');
    await this.current(s); return { s, node };
  }
  async expand(id: string): Promise<BrainExpansion> {
    const { s, node } = await this.node(id);
    if (node.kind !== 'folder') throw new BrainError('INVALID_INPUT', 400, '폴더를 선택해 주세요.');
    return { nodes: s.nodes.filter(n => n.parentId === id), links: s.links.filter(l => l.source === id || l.target === id || s.byId.get(l.source)?.parentId === id || s.byId.get(l.target)?.parentId === id), scannedAt: s.scannedAt };
  }
  async search(query: string, scope: 'quick' | 'body' = 'quick', signal?: AbortSignal): Promise<BrainSearch> {
    if (query.length > 200) throw new BrainError('INVALID_INPUT', 400, '검색어는 200자 이내로 입력해 주세요.');
    signal?.throwIfAborted();
    const s = await this.load();
    const found = scope === 'body' ? await this.searchBodies(s, query, signal) : quickSearch(s.nodes, query);
    const results = found.results.map(({ node, match }) => {
      const ancestors: GraphNode[] = []; let parent = node.parentId ? s.byId.get(node.parentId) : undefined;
      while (parent) { ancestors.unshift(parent); parent = parent.parentId ? s.byId.get(parent.parentId) : undefined; }
      return { node, ancestors, match };
    });
    signal?.throwIfAborted();
    await this.current(s); return { ...found, results, scannedAt: s.scannedAt };
  }
  private async searchBodies(s: Snapshot, query: string, signal?: AbortSignal) {
    const terms = searchTerms(query), results: { node: GraphNode; match: BrainSearchMatch }[] = [];
    let searchedFiles = 0, skippedFiles = 0, matches = 0;
    if (terms.length) for (const node of s.nodes) {
      if (!node.extension || !['.md', '.txt', '.srt', '.vtt'].includes(node.extension)) continue;
      signal?.throwIfAborted();
      if (s.epoch !== this.epoch) throw new BrainError('CONFIG_CHANGED', 409, '작업 공간이 변경되었습니다. 지도를 다시 조회해 주세요.');
      let content = s.bodies.get(node.id);
      if (content === undefined) {
        if (s.bodyBytes >= 64 * 1024 * 1024) { skippedFiles++; continue; }
        try { content = (await readText(s.root, node.path, s.output, 500 * 1024)).content; }
        catch { signal?.throwIfAborted(); skippedFiles++; continue; }
        signal?.throwIfAborted();
        // 동시 검색에서 같은 문서를 읽어도 캐시 사용량은 한 번만 계산한다.
        if (!s.bodies.has(node.id)) {
          const bytes = content.length * 2;
          if (s.bodyBytes + bytes > 64 * 1024 * 1024) { skippedFiles++; continue; }
          s.bodies.set(node.id, content); s.bodyBytes += bytes;
        }
      }
      searchedFiles++;
      if (includesTerms(content, terms)) {
        matches++;
        if (results.length < 100) results.push({ node, match: { kind: 'body', excerpt: searchExcerpt(content, terms) } });
      }
      // 캐시가 준비된 뒤에도 긴 검색이 이벤트 루프와 취소 처리를 막지 않는다.
      if (searchedFiles % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    }
    return { results, truncated: matches > 100, searchedFiles, skippedFiles, partial: skippedFiles > 0 || s.inventoryIncomplete };
  }
  async preview(id: string): Promise<BrainPreview> {
    const { s, node } = await this.node(id);
    if (!node.capabilities.preview) throw new BrainError('UNSUPPORTED_TYPE', 415, '이 자료는 경로와 Finder 위치 보기로 확인해 주세요.');
    const file = await readText(s.root, node.path, s.output, 500 * 1024);
    await this.current(s);
    return { id, path: node.path, extension: node.extension!, size: file.size, modifiedAt: file.modifiedAt, content: file.content, format: 'text' };
  }
  async reveal(id: string) {
    const { s, node } = await this.node(id);
    if (!node.capabilities.reveal) throw new BrainError('UNSUPPORTED_PLATFORM', 501, 'Finder 위치 보기는 macOS에서 지원합니다.');
    const file = await checkedPath(s.root, node.path, s.output);
    await this.current(s);
    if (await realpath(s.root) !== s.root) throw new BrainError('CONFIG_CHANGED', 409, '작업 공간이 변경되었습니다.');
    await (this.options.reveal ?? revealInFinder)(file);
    return { ok: true };
  }
}
