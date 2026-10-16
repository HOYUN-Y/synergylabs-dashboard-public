// 세컨드 브레인 점검(brain review): 작업 공간의 변경 · 끊어진 링크 · 미연결 문서 · 중복 후보 · 설명 부족 항목을 점검해
// 담당자 인터뷰 질문 초안을 만들고, 점검 건의 상태를 개인 실행 영역에 보존한다. 라우터 · 색인 · 기억 · 원본 자료는 쓰지 않는다.
// 설계 · 운영 절차: docs/BRAIN_REVIEW.md, 스킬 지침: 작업 공간 스킬/brain-review/SKILL.md
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { areaOf, loadBrainConfig, routeGuides } from './config.js';
import type { BrainConfig } from './config.js';
import { excludedPath, readText } from './files.js';
import { createLinkResolver, extractLinks, linkSource, normalized } from './links.js';
import { MemoryError, recallMemory } from './memory.js';
import { scanWorkspace } from '../workspace-scan.js';

export class ReviewError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new ReviewError(code, message); }

export type ReviewStatus = 'awaiting_interview' | 'applying' | 'partial' | 'failed' | 'done';
export type FindingKind = 'added' | 'modified' | 'missing' | 'unindexed' | 'broken_link' | 'external_link' | 'duplicate' | 'thin_description' | 'memory_related';
export type Decision = 'apply' | 'hold' | 'skip';
export interface Finding {
  version?: string; key: string; kind: FindingKind; path: string; detail: string; facts: string[]; firstSeenAt: string;
  /** 같은 구조(수집 실행 폴더 등)의 문서를 묶은 발견: ID · 시각 구간을 '*'로 바꾼 경로 패턴과 개수 */
  group?: { pattern: string; count: number };
}
export interface Question { id: string; findingKeys: string[]; text: string; facts: string[]; answer?: { text: string; decision: Decision; at: string; origin?: 'user' | 'agent' } }
export interface ReviewCase {
  format: 'brain-review-case-v1'; id: string; workspace: string; status: ReviewStatus;
  createdAt: string; updatedAt: string; lastInspectedAt: string; baselineAt: string | null;
  findings: Finding[]; questions: Question[];
  applied: { at: string; path: string; note?: string; hash?: string }[];
  notes: { at: string; status: ReviewStatus; note: string }[];
  verification?: { at: string; remaining: Partial<Record<FindingKind, number>>; warnings: string[] };
}
interface Snapshot { format: 'brain-review-snapshot-v1'; takenAt: string; files: Record<string, string>; hashes?: Record<string, string> }
interface WorkspaceState { format: 'brain-review-state-v1'; workspace: string; dismissed: Record<string, { at: string; caseId: string }> }
interface Paths { root: string; state: string; directory: string; cases: string; snapshots: string; baseline: string; stateFile: string; lock: string }
interface RawFinding extends Omit<Finding, 'firstSeenAt'> { question?: boolean }
interface Inspection { snapshot: Snapshot; findings: RawFinding[]; warnings: string[]; stats: Record<string, number>; baselineAt: string | null }

export const kindLabels: Record<FindingKind, string> = {
  added: '새 자료', modified: '변경된 자료', missing: '사라진 자료(확인 필요)', unindexed: '색인 미연결 문서', broken_link: '끊어진 링크',
  external_link: '작업 공간 밖 경로 링크', duplicate: '중복 후보', thin_description: '설명 부족 항목', memory_related: '관련 기억 있음'
};
const deltaKinds: FindingKind[] = ['added', 'modified', 'missing'];
/** 수집 ID · 실행 시각 · 날짜 · 영상 ID처럼 보이는 경로 구간을 '*'로 바꾼 패턴. 같은 구조의 문서를 한 발견으로 묶는 데 쓴다 */
const idLike = (s: string) => /[0-9a-f]{12,}/i.test(s) || /^\d{8}T\d{6}Z$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /^(?=.*[A-Z])(?=.*[a-z0-9])[A-Za-z0-9_]{11}$/.test(s);
export const patternOf = (path: string) => path.split('/').map(s => (idLike(s) ? '*' : s)).join('/');
/** 자료 한 건의 폴더: 경로에서 처음 나오는 ID · 시각 구간까지(예: 콘텐츠/newsletter/<글 ID>). 없으면 null */
const itemRoot = (path: string) => { const parts = path.split('/'); const at = parts.findIndex(idLike); return at < 0 ? null : parts.slice(0, at + 1).join('/'); };
/** 한쪽 문서의 폴더가 다른 쪽 폴더의 상위(또는 같음)거나 같은 자료 폴더 안이면, 같은 자료의 색인 · 수집본 · 본문으로 보고 중복 후보에서 뺀다 */
const related = (a: string, b: string) => {
  const da = `${posix.dirname(a)}/`, db = `${posix.dirname(b)}/`;
  if (da.startsWith(db) || db.startsWith(da)) return true;
  const item = itemRoot(a);
  return item !== null && item === itemRoot(b);
};
export const statusLabels: Record<ReviewStatus, string> = { awaiting_interview: '인터뷰 대기', applying: '반영 중', partial: '부분 반영', failed: '실패', done: '완료' };
const openStatuses: ReviewStatus[] = ['awaiting_interview', 'applying', 'partial', 'failed'];
const LIMIT = 1024 * 1024;
const now = () => new Date().toISOString();
const genericNames = /^(readme|index|skill|memory|agents|claude|routine)\.md$/i;

/** 기본 상태 폴더: 대시보드 개인 실행 영역과 같은 위치 아래 brain-review */
export function defaultStateDirectory(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'SynergyLabs Dashboard', 'brain-review');
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SynergyLabs Dashboard', 'brain-review');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'synergylabs-dashboard', 'brain-review');
}
const expandHome = (path: string) => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

/** 상태 폴더 결정 순서: 명시한 --state → 스킬 설정 문서(스킬 폴더/brain-review/config.json의 stateDir) → 기본 위치 */
export async function resolveStateDirectory(root: string, config: BrainConfig, explicit?: string) {
  let dir = explicit?.trim();
  let source: 'option' | 'skill-config' | 'default' = 'option';
  if (!dir) {
    const skills = config.areas.find(a => a.id === 'skills')!;
    const file = join(root, skills.folder, 'brain-review', 'config.json');
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value && typeof value === 'object' && value.stateDir !== undefined && value.stateDir !== null && value.stateDir !== '') {
        if (typeof value.stateDir !== 'string' || /[\0\r\n]/.test(value.stateDir)) fail('CONFIG_INVALID', '스킬 설정 문서의 stateDir는 문자열 경로여야 합니다.');
        dir = value.stateDir.trim(); source = 'skill-config';
      }
    } catch (error) {
      if (error instanceof ReviewError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('CONFIG_INVALID', '스킬 설정 문서(brain-review/config.json)를 읽지 못했습니다. JSON 형식을 확인하세요.');
    }
  }
  if (!dir) { dir = defaultStateDirectory(); source = 'default'; }
  dir = expandHome(dir);
  if (!isAbsolute(dir) || dir.includes('\0')) fail('INVALID_INPUT', '상태 폴더는 절대경로(또는 ~/로 시작)여야 합니다.');
  // 작업 공간 안에 두려면 지도 · 검색 · 공유에서 제외되는 이름(.으로 시작 · output 등)이어야 한다
  // Resolve existing parents too: a symlink outside the workspace may point back inside it.
  const canonical = async (path: string): Promise<string> => {
    try { return await realpath(path); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw e;
      return join(await canonical(dirname(path)), basename(path));
    }
  };
  dir = await canonical(dir);
  const inside = relative(await realpath(root), dir);
  if (!inside || (!inside.startsWith('..') && !isAbsolute(inside) && !excludedPath(inside.split(sep).join('/'))))
    fail('STATE_IN_WORKSPACE', '상태 폴더가 작업 공간 안에 있으면 지도 · 공유에 노출됩니다. 작업 공간 밖이나 .으로 시작하는 폴더를 지정하세요.');
  return { directory: dir, source };
}

async function paths(workspace: string, config: BrainConfig, explicitState?: string): Promise<Paths & { stateSource: string }> {
  if (!isAbsolute(workspace)) fail('INVALID_INPUT', '작업 공간의 절대경로를 지정하세요.');
  const root = await realpath(workspace).catch(() => fail('PATH_UNAVAILABLE', '작업 공간 폴더를 찾을 수 없습니다.'));
  const { directory: state, source } = await resolveStateDirectory(root, config, explicitState);
  const directory = join(state, createHash('sha256').update(root).digest('hex').slice(0, 16));
  return { root, state, directory, cases: join(directory, 'cases'), snapshots: join(directory, 'snapshots'), baseline: join(directory, 'baseline.json'),
    stateFile: join(directory, 'state.json'), lock: join(directory, '.lock'), stateSource: source };
}

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return fail('STATE_INVALID', `상태 파일을 읽지 못했습니다: ${basename(file)}`); }
}
async function writeAtomic(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { await writeFile(temp, text, { flag: 'wx', mode: 0o600 }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}
const writeJson = (file: string, value: unknown) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n');

/** 같은 컴퓨터의 수동 · 예약 실행이 겹치지 않게 한다. 잠금 파일에는 PID를 적고, 그 프로세스가 없으면 남은 잠금으로 보고 한 번 치운다 */
async function locked<T>(p: Paths, work: () => Promise<T>) {
  await mkdir(p.directory, { recursive: true, mode: 0o700 });
  let handle, cleaned = false;
  for (let attempt = 0; ; attempt++) {
    try { handle = await open(p.lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await handle.writeFile(String(process.pid)); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!cleaned) {
        const pid = Number((await readFile(p.lock, 'utf8').catch(() => '')).trim());
        let alive = true;
        if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; } }
        if (!alive) { await unlink(p.lock).catch(() => {}); cleaned = true; continue; }
      }
      if (attempt >= 20) fail('BUSY', '다른 점검 · 반영이 진행 중입니다. 실행 상태를 확인한 뒤 다시 시도하세요.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await work(); }
  finally { await handle.close(); await unlink(p.lock).catch(() => {}); }
}

const caseFile = (p: Paths, id: string) => {
  if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{6}$/.test(id)) fail('NOT_FOUND', '점검 건 ID 형식이 아닙니다.');
  return join(p.cases, `${id}.json`);
};
async function loadCase(p: Paths, id: string) { return (await readJson<ReviewCase>(caseFile(p, id))) ?? fail('NOT_FOUND', '해당 점검 건이 없습니다.'); }
async function listCases(p: Paths) {
  const names = await readdir(p.cases).catch(() => [] as string[]);
  const cases: ReviewCase[] = [];
  for (const name of names.filter(n => n.endsWith('.json')).sort()) { const c = await readJson<ReviewCase>(join(p.cases, name)); if (c?.format === 'brain-review-case-v1') cases.push(c); }
  return cases;
}
const openCase = (cases: ReviewCase[]) => cases.filter(c => openStatuses.includes(c.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
async function loadState(p: Paths): Promise<WorkspaceState> {
  return (await readJson<WorkspaceState>(p.stateFile)) ?? { format: 'brain-review-state-v1', workspace: p.root, dismissed: {} };
}

/** 라우터 · 분야 안내의 링크 행에서 설명이 거의 없는 항목(링크 이름만 있는 행) */
function thinRows(text: string) {
  const rows: string[] = [];
  for (const line of linkSource(text).split('\n')) {
    const spans: { start: number; end: number; label: string }[] = [];
    const links = extractLinks(line, (_l, start, end, label) => spans.push({ start, end, label }));
    if (!links.length || !spans.length) continue;
    let plain = line;
    for (const span of spans.sort((a, b) => b.start - a.start)) plain = plain.slice(0, span.start) + plain.slice(span.end);
    plain = plain.replace(/[|#>*+:·—–-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain.length < 4) rows.push(spans.map(s => s.label).join(' · ').slice(0, 80));
  }
  return rows;
}

/** 현재 작업 공간을 읽어 기준점 대비 변경과 구조 점검 결과를 만든다. 아무 파일도 쓰지 않는다 */
async function inspectWorkspace(p: Paths, config: BrainConfig, baseline: Snapshot | null, dismissed: WorkspaceState['dismissed']): Promise<Inspection> {
  const inventory = await scanWorkspace(p.root, '', true);
  const warnings = [...inventory.warnings];
  const files = inventory.files.filter(f => !excludedPath(f.path));
  const snapshot: Snapshot = { format: 'brain-review-snapshot-v1', takenAt: now(), files: Object.fromEntries(files.map(f => [f.path, f.modifiedAt])) };
  const allPaths = ['', ...inventory.folders.filter(f => f && !excludedPath(f)), ...files.map(f => f.path)];
  const resolve = createLinkResolver(allPaths);
  const findings: RawFinding[] = [];
  const stats: Record<string, number> = {};
  const add = (f: RawFinding) => { if (dismissed[f.key]) { stats.dismissed = (stats.dismissed ?? 0) + 1; return; } findings.push(f); stats[f.kind] = (stats[f.kind] ?? 0) + 1; };
  const areaName = (path: string) => config.areas.find(a => a.id === areaOf(config, path))?.name ?? config.other.name;

  const changed = new Map<string, 'added' | 'modified'>();
  // Markdown 읽기: 링크 · 제목 · 설명 부족
  const router = allPaths.find(path => path && normalized(path) === config.routerFile);
  const edges = new Map<string, string[]>(), incoming = new Map<string, string[]>(), titles = new Map<string, string>();
  const broken = new Map<string, string[]>(), external = new Map<string, string[]>();
  const markdown = files.filter(f => extname(f.path).toLowerCase() === '.md').map(f => f.path);
  const texts = new Map<string, string>();
  snapshot.hashes = {};
  for (const path of markdown) {
    try {
      const { content } = await readText(p.root, path, '', LIMIT);
      texts.set(path, content);
      snapshot.hashes[path] = createHash('sha256').update(content).digest('hex');
      titles.set(path, content.match(/^#\s+(.+?)\s*$/m)?.[1].replace(/[`*_]/g, '').trim() ?? '');
      const targets: string[] = [];
      for (const link of extractLinks(content)) {
        const result = resolve(path, [link]);
        if (result.warnings.length) {
          const raw = link.target.split(/[?#]/)[0];
          // 절대경로(/Users/...)와 작업 공간 위로 나가는 링크는 끊어진 내부 링크가 아니라 바깥 참조로 본다
          const outside = raw.startsWith('/') || posix.normalize(posix.join(posix.dirname(path), raw)).startsWith('..');
          const bucket = outside ? external : broken, list = bucket.get(path) ?? [];
          if (!list.includes(raw)) bucket.set(path, [...list, raw.slice(0, 120)]);
        }
        for (const t of result.targets) { targets.push(t); incoming.set(t, [...(incoming.get(t) ?? []), path]); }
      }
      edges.set(path, targets);
    } catch { warnings.push(`${path}: 문서를 읽지 못해 링크 점검에서 제외했습니다.`); }
  }
  // 기준점 대비 변경
  if (baseline) {
    for (const [path, at] of Object.entries(snapshot.files)) {
      if (!(path in baseline.files)) changed.set(path, 'added');
      else if ((baseline.hashes?.[path] && snapshot.hashes?.[path] ? baseline.hashes[path] !== snapshot.hashes[path] : baseline.files[path] !== at)) changed.set(path, 'modified');
    }
    for (const path of Object.keys(baseline.files)) if (!(path in snapshot.files))
      add({ key: `missing:${path}`, kind: 'missing', path, detail: '기준점에는 있었지만 지금은 없습니다. 이동 · 이름 변경 · 삭제인지 담당자 확인이 필요하며 자동으로 정리하지 않습니다.', facts: [`기준점 수정 시각 ${baseline.files[path]}`], question: true });
  }

  const guideSet = new Set(router ? routeGuides(config, edges.get(router) ?? []).values() : []);
  const guides = [...(router ? [router] : []), ...guideSet];
  const linkedFrom = (path: string) => (incoming.get(path) ?? []).filter(from => guides.includes(from));

  // 라우터에서 Markdown 링크로 닿는 문서
  const reachable = new Set<string>();
  if (router) {
    const queue = [router]; reachable.add(router);
    while (queue.length) for (const next of edges.get(queue.shift()!) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      // 폴더 링크는 그 폴더 바로 아래 문서를 연결로 보지 않는다. 문서 링크만 따라간다
      if (extname(next).toLowerCase() === '.md') queue.push(next);
    }
  } else warnings.push(`${config.routerFile}가 없어 색인 연결 점검을 건너뛰었습니다.`);

  for (const [path, kind] of changed) {
    const indexed = linkedFrom(path);
    const facts = [`경로 ${path}`, `분야 ${areaName(path)}`, `수정 시각 ${snapshot.files[path]}`, indexed.length ? `색인 연결: ${indexed.join(', ')}` : '색인 연결: 없음'];
    if (kind === 'added') add({ key: `added:${path}`, kind, path, detail: indexed.length ? '기준점 이후 추가됐고 색인에 연결돼 있습니다.' : '기준점 이후 추가됐고 라우터 · 분야 안내에 직접 연결되지 않았습니다.', facts, question: !indexed.length });
    else add({ key: `modified:${path}`, kind, path, detail: guides.includes(path) ? '라우터 · 분야 안내 자체가 바뀌었습니다.' : '기준점 이후 내용이 바뀌었습니다. 색인 설명이나 기억의 기준도 바뀌어야 하는지 확인합니다.', facts, question: !guides.includes(path) });
  }
  if (router) {
    const unindexed = new Map<string, string[]>();
    for (const path of markdown) {
      if (reachable.has(path) || changed.get(path) === 'added' || path === router || /^claude\.md$/i.test(basename(path))) continue;
      const pattern = patternOf(path);
      unindexed.set(pattern, [...(unindexed.get(pattern) ?? []), path]);
    }
    for (const [pattern, group] of unindexed) {
      if (group.length > 1) add({ key: `unindexed:${pattern}`, kind: 'unindexed', path: group[0], group: { pattern, count: group.length },
        detail: `같은 구조의 문서 ${group.length}개(${pattern})가 라우터에서 Markdown 링크로 닿지 않습니다. 상위 색인에 묶어서 연결할지, 보관만 할지 확인합니다.`,
        facts: [`패턴 ${pattern}`, `분야 ${areaName(group[0])}`, ...group.slice(0, 10).map(g => `경로 ${g}`), ...(group.length > 10 ? [`외 ${group.length - 10}개`] : [])], question: true });
      else add({ key: `unindexed:${group[0]}`, kind: 'unindexed', path: group[0], detail: '라우터에서 Markdown 링크로 닿지 않는 문서입니다. 어느 분야 안내 · 색인에 넣을지, 보관만 할지 확인합니다.', facts: [`경로 ${group[0]}`, `분야 ${areaName(group[0])}`, `제목 ${titles.get(group[0]) || '(없음)'}`], question: true });
    }
  }
  for (const [from, targets] of broken) {
    if (targets.length > 10) add({ key: `broken:${from}:*`, kind: 'broken_link', path: from, detail: `끊어진 내부 링크가 ${targets.length}개 있습니다. 대상 폴더가 통째로 이동 · 삭제됐는지 확인합니다.`, facts: [`문서 ${from}`, ...targets.slice(0, 10).map(t => `링크 ${t}`), `외 ${targets.length - 10}개`], question: true });
    else for (const target of targets) add({ key: `broken:${from}:${target}`, kind: 'broken_link', path: from, detail: `링크 대상 '${target}'을 찾을 수 없거나 제외 대상입니다. 대상이 이동됐는지, 링크를 고칠지 뺄지 확인합니다.`, facts: [`문서 ${from}`, `링크 ${target}`], question: true });
  }
  for (const [from, targets] of external) add({ key: `external:${from}`, kind: 'external_link', path: from, detail: `작업 공간 밖 절대경로 · 상위 경로 링크가 ${targets.length}개 있습니다. 원본 저장소 참조라면 그대로 두고, 작업 공간 자료라면 상대 링크로 바꿉니다.`, facts: [`문서 ${from}`, ...targets.slice(0, 5).map(t => `링크 ${t}`)], question: false });

  // 중복 후보: 같은 이름이면서 제목도 같은 문서, 또는 같은 제목의 문서. 상위 · 하위 색인 관계(같은 자료의 수집본 색인 등)는 제외하고, 4개 이상은 반복 구조로 본다
  const byName = new Map<string, string[]>(), byTitle = new Map<string, string[]>();
  for (const path of markdown) {
    const name = normalized(basename(path)).toLowerCase();
    if (!genericNames.test(name)) byName.set(name, [...(byName.get(name) ?? []), path]);
    const title = normalized(titles.get(path) ?? '').toLowerCase();
    if (title.length >= 4) byTitle.set(title, [...(byTitle.get(title) ?? []), path]);
  }
  const unrelated = (group: string[]) => group.filter((a, i) => !group.some((b, j) => j < i && related(a, b)));
  const duplicateFinding = (key: string, group: string[], what: string) => add({ key, kind: 'duplicate', path: group[0],
    detail: group.length > 3 ? `${what}의 문서가 ${group.length}개 있습니다. 수집 실행 폴더 같은 반복 구조로 보여 질문하지 않습니다. 중복이면 정리 기준을 기억에 남깁니다.` : `${what}의 문서가 ${group.length}개 있습니다. 중복인지, 어느 쪽이 최종본인지 확인합니다.`,
    facts: group.slice(0, 10).map(g => `경로 ${g}`), question: group.length <= 3 });
  const named = new Set<string>();
  for (const [name, raw] of byName) {
    const sameTitle = new Set(raw.map(g => normalized(titles.get(g) ?? '').toLowerCase()).filter(Boolean));
    const group = sameTitle.size <= 1 ? unrelated(raw) : [];
    if (group.length > 1) { duplicateFinding(`duplicate:name:${name}`, group, '같은 파일 이름과 제목'); group.forEach(g => named.add(g)); }
  }
  for (const [title, raw] of byTitle) {
    const group = unrelated(raw).filter(g => !named.has(g));
    if (group.length > 1) duplicateFinding(`duplicate:title:${title}`, group, `같은 제목 '${titles.get(group[0])}'`);
  }
  for (const guide of guides) for (const row of thinRows(texts.get(guide) ?? ''))
    add({ key: `thin:${guide}:${row}`, kind: 'thin_description', path: guide, detail: `'${row}' 항목에 링크 이름 외 설명이 없습니다. 한 줄 설명을 보충할지 확인합니다.`, facts: [`안내 문서 ${guide}`], question: true });

  // 변경된 문서와 관련된 기존 기억: 기준이 바뀐 것인지 확인할 대상
  const memoryTargets = [...changed.keys()].filter(path => extname(path).toLowerCase() === '.md' && !guides.includes(path)).slice(0, 20);
  for (const path of memoryTargets) {
    const query = (titles.get(path) || basename(path, extname(path))).slice(0, 200);
    try {
      const result = await recallMemory(p.root, query, config);
      if (result.hits.length) add({ key: `memory:${path}`, kind: 'memory_related', path, detail: `관련 기억 ${result.hits.length}건이 있습니다. 변경이 확정 기준의 변경인지, 기억을 갱신해야 하는지 확인합니다.`,
        facts: result.hits.map(h => `기억 ${h.path} — ${h.title} (revision ${h.revision.slice(0, 12)})`), question: true });
    } catch (error) {
      if (error instanceof MemoryError && ['NOT_CONFIGURED', 'PATH_UNAVAILABLE', 'INDEX_UNAVAILABLE'].includes(error.code)) { warnings.push(`기억 대조 생략: ${error.message}`); break; }
      warnings.push(`${path}: 기억 대조에 실패했습니다.`);
    }
  }
  for (const f of findings) {
    const versions = f.group ? Object.keys(snapshot.files).filter(path => patternOf(path) === f.group!.pattern).map(path => [path, snapshot.hashes?.[path] ?? snapshot.files[path]]) : [snapshot.hashes?.[f.path] ?? snapshot.files[f.path] ?? null];
    f.version = createHash('sha256').update(JSON.stringify([f.detail, f.group, versions])).digest('hex');
  }
  return { snapshot, findings, warnings: [...new Set(warnings)], stats, baselineAt: baseline?.takenAt ?? null };
}

/** 질문 초안: 파일만으로 알 수 없는 것만 묻고, 확인된 사실은 함께 적어 다시 묻지 않게 한다. 같은 폴더의 다수 변경은 한 질문으로 묶는다 */
function draftQuestions(findings: Finding[], existing: Question[]): Question[] {
  const asked = new Set(existing.flatMap(q => q.findingKeys));
  const fresh = findings.filter(f => !asked.has(f.key));
  const result: Question[] = [];
  let n = existing.length;
  const push = (keys: string[], text: string, facts: string[]) => result.push({ id: `q-${++n}`, findingKeys: keys, text, facts: facts.slice(0, 30) });
  const groupByFolder = (items: Finding[], single: (f: Finding) => string, many: (folder: string, items: Finding[]) => string) => {
    const folders = new Map<string, Finding[]>();
    for (const f of items) { const folder = posix.dirname(f.path); folders.set(folder, [...(folders.get(folder) ?? []), f]); }
    for (const [folder, group] of folders) {
      if (group.length > 5) push(group.map(g => g.key), many(folder, group), group.map(g => `경로 ${g.path}`));
      else for (const f of group) push([f.key], single(f), f.facts);
    }
  };
  const of = (kind: FindingKind) => fresh.filter(f => f.kind === kind);
  groupByFolder(of('added').filter(f => !f.facts.some(x => x.startsWith('색인 연결: ') && x !== '색인 연결: 없음')),
    f => `새 자료 '${f.path}'의 용도와 소속 프로젝트, 최종본인지 여부를 알려주세요. 어느 분야 안내 · 색인에 어떤 한 줄 설명으로 넣을까요?`,
    (folder, g) => `'${folder}/' 아래 새 자료 ${g.length}개가 색인에 없습니다. 이 묶음의 용도 · 프로젝트와, 개별로 색인할지 폴더 색인 하나로 연결할지 알려주세요.`);
  const modified = of('modified');
  if (modified.length) push(modified.map(f => f.key), `변경된 자료 ${modified.length}개가 있습니다. 색인 설명이나 기억에 적힌 기준을 바꿔야 하는 항목이 있나요? 없으면 '변경 없음'으로 답해 주세요.`, modified.map(f => `경로 ${f.path}`));
  for (const f of of('unindexed')) push([f.key], f.group
    ? `같은 구조의 문서 ${f.group.count}개(${f.group.pattern})가 라우터에서 링크로 닿지 않습니다. 상위 색인에 묶어서 연결할지, 보관만 하고 색인하지 않을지 알려주세요.`
    : `'${f.path}'은(는) 라우터에서 링크로 닿지 않습니다. 어느 분야 안내 · 색인에 넣을지, 보관만 하고 색인하지 않을지 알려주세요.`, f.facts);
  for (const f of of('missing')) push([f.key], `'${f.path}'이(가) 기준점 이후 사라졌습니다. 이동 · 이름 변경 · 삭제 중 무엇인지, 색인 · 기억의 링크를 어떻게 바꿀지 알려주세요.`, f.facts);
  for (const f of of('broken_link')) push([f.key], `'${f.path}'의 링크 '${f.facts[1]?.replace(/^링크 /, '')}'이(가) 끊어졌습니다. 대상이 어디로 갔는지, 링크를 고칠지 뺄지 알려주세요.`, f.facts);
  for (const f of of('duplicate')) push([f.key], `${f.detail} 어느 문서가 최종본이고 나머지는 어떻게 안내할까요?`, f.facts);
  for (const f of of('thin_description')) push([f.key], `${f.path}의 ${f.detail} 넣을 한 줄 설명을 알려주세요.`, f.facts);
  for (const f of of('memory_related')) push([f.key], `'${f.path}' 변경이 기존 기억의 확정 기준을 바꾸나요? 바뀐다면 새 기준과 이유를 알려주세요.`, f.facts);
  return result;
}

function renderCase(c: ReviewCase) {
  const counts = Object.entries(kindLabels).map(([k, label]) => [label, c.findings.filter(f => f.kind === k).length] as const).filter(([, n]) => n);
  const lines = [`# 세컨드 브레인 점검 건 ${c.id}`, '', `- 작업 공간: ${c.workspace}`, `- 상태: ${statusLabels[c.status]}`, `- 기준점: ${c.baselineAt ?? '이번 점검에서 처음 설정'}`,
    `- 마지막 점검: ${c.lastInspectedAt}`, `- 점검 결과: ${counts.map(([l, n]) => `${l} ${n}`).join(' · ') || '없음'}`, '', '## 점검 결과', ''];
  for (const [kind, label] of Object.entries(kindLabels) as [FindingKind, string][]) {
    const items = c.findings.filter(f => f.kind === kind);
    if (!items.length) continue;
    lines.push(`### ${label} (${items.length})`, '');
    for (const f of items) lines.push(`- \`${f.path}\` — ${f.detail}`, ...f.facts.map(x => `  - ${x}`));
    lines.push('');
  }
  lines.push('## 질문 초안', '');
  if (!c.questions.length) lines.push('- 질문이 필요한 항목이 없습니다.', '');
  for (const q of c.questions) {
    lines.push(`- **${q.id}** ${q.text}`, ...q.facts.map(x => `  - 확인된 사실: ${x}`));
    lines.push(q.answer ? `  - 답변(${q.answer.at}, ${q.answer.decision}): ${q.answer.text}` : '  - 답변: (대기)');
  }
  lines.push('', '## 반영 기록', '', ...(c.applied.length ? c.applied.map(a => `- ${a.at} — \`${a.path}\`${a.note ? ` — ${a.note}` : ''}`) : ['- 아직 없음']));
  if (c.verification) lines.push('', '## 완료 전 검증', '', `- ${c.verification.at}`, ...Object.entries(c.verification.remaining).map(([k, n]) => `- 남은 ${kindLabels[k as FindingKind]}: ${n}`), ...c.verification.warnings.map(w => `- 경고: ${w}`));
  lines.push('', '## 상태 기록', '', ...c.notes.map(n => `- ${n.at} — ${statusLabels[n.status]} — ${n.note}`), '');
  return lines.join('\n');
}
async function saveCase(p: Paths, c: ReviewCase) {
  c.updatedAt = now();
  await writeJson(caseFile(p, c.id), c);
  await writeAtomic(join(p.cases, `${c.id}.md`), renderCase(c));
}
const summary = (c: ReviewCase) => ({ id: c.id, status: c.status, statusLabel: statusLabels[c.status], createdAt: c.createdAt, lastInspectedAt: c.lastInspectedAt,
  findings: c.findings.length, questions: c.questions.length, unanswered: c.questions.filter(q => !q.answer).length, applied: c.applied.length });
const publicPaths = (p: Paths & { stateSource: string }) => ({ workspace: p.root, stateDirectory: p.directory, stateSource: p.stateSource });

/** 점검 실행: 기준점이 없으면 지금 상태를 기준점으로 삼고 구조 점검만 보고한다. 미완료 건이 있으면 새 건을 만들지 않고 추가 발견만 덧붙인다 */
export async function inspectReview(workspace: string, options: { state?: string; config?: BrainConfig } = {}) {
  const config = options.config ?? await loadBrainConfig();
  const p = await paths(workspace, config, options.state);
  return locked(p, async () => {
    const state = await loadState(p);
    let baseline = await readJson<Snapshot>(p.baseline);
    const inspection = await inspectWorkspace(p, config, baseline, state.dismissed);
    const at = inspection.snapshot.takenAt;
    let firstBaseline = false;
    if (!baseline) { await writeJson(p.baseline, inspection.snapshot); baseline = inspection.snapshot; firstBaseline = true; }
    await writeJson(p.stateFile, { ...state, workspace: p.root });
    const cases = await listCases(p);
    const current = openCase(cases);
    const base = { ...publicPaths(p), inspectedAt: at, firstBaseline, baselineAt: baseline.takenAt, stats: inspection.stats, warnings: inspection.warnings };
    if (!inspection.findings.length) {
      if (current) { current.lastInspectedAt = at; await writeJson(join(p.snapshots, `${current.id}.json`), inspection.snapshot); await saveCase(p, current); }
      return { ...base, result: current ? 'open_case_unchanged' : 'no_change', case: current ? summary(current) : null, additions: 0,
        report: current ? join(p.cases, `${current.id}.md`) : null, questions: current ? current.questions.filter(q => !q.answer) : [],
        message: current ? `새 발견은 없고 미완료 점검 건 ${current.id}(${statusLabels[current.status]})이 있습니다.` : '변경 · 점검 사항이 없어 인터뷰 건을 만들지 않았습니다.' };
    }
    const target: ReviewCase = current ?? { format: 'brain-review-case-v1', id: `${at.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomBytes(3).toString('hex')}`, workspace: p.root,
      status: 'awaiting_interview', createdAt: at, updatedAt: at, lastInspectedAt: at, baselineAt: firstBaseline ? null : baseline.takenAt, findings: [], questions: [], applied: [],
      notes: [{ at, status: 'awaiting_interview', note: firstBaseline ? '첫 점검: 기준점을 설정하고 구조 점검 결과로 건을 만들었습니다.' : '점검 결과로 건을 만들었습니다.' }] };
    // Preserve historical answers, but reopen questions when their observed content changes.
    const changedKeys = new Set<string>();
    for (const fresh of inspection.findings) {
      const previous = target.findings.find(f => f.key === fresh.key);
      if (previous && previous.version !== fresh.version) {
        changedKeys.add(fresh.key);
        Object.assign(previous, { detail: fresh.detail, facts: fresh.facts, version: fresh.version, group: fresh.group });
      }
    }
    for (const q of target.questions) if (q.findingKeys.some(key => changedKeys.has(key)) && q.answer) {
      target.notes.push({ at, status: target.status, note: `${q.id} 재검토: 이전 판단(${q.answer.origin ?? 'user'}, ${q.answer.decision}): ${q.answer.text}` });
      delete q.answer;
    }
    const known = new Set(target.findings.map(f => f.key));
    const additions: Finding[] = inspection.findings.filter(f => !known.has(f.key)).map(f => ({ version: f.version, key: f.key, kind: f.kind, path: f.path, detail: f.detail, facts: f.facts, firstSeenAt: at, ...(f.group ? { group: f.group } : {}) }));
    const needQuestion = new Set(inspection.findings.filter(f => f.question).map(f => f.key));
    // 사라진 발견(해결됨)은 지우지 않고 남겨 두되 해결 표시만 한다 — 질문 중복 방지에 key가 필요하다
    for (const f of target.findings) if (!inspection.findings.some(x => x.key === f.key) && !f.detail.startsWith('[해결됨] ')) f.detail = `[해결됨] ${f.detail}`;
    for (const f of target.findings) if (inspection.findings.some(x => x.key === f.key) && f.detail.startsWith('[해결됨] ')) f.detail = f.detail.slice('[해결됨] '.length);
    target.findings.push(...additions);
    target.questions.push(...draftQuestions(additions.filter(f => needQuestion.has(f.key)), target.questions));
    target.lastInspectedAt = at;
    if (current && additions.length) target.notes.push({ at, status: target.status, note: `추가 발견 ${additions.length}건을 기존 건에 덧붙였습니다.` });
    await writeJson(join(p.snapshots, `${target.id}.json`), inspection.snapshot);
    await saveCase(p, target);
    return { ...base, result: current ? (additions.length || changedKeys.size ? 'open_case_updated' : 'open_case_unchanged') : 'case_created', case: summary(target), additions: additions.length,
      report: join(p.cases, `${target.id}.md`), questions: target.questions.filter(q => !q.answer),
      message: current ? `미완료 점검 건 ${target.id}(${statusLabels[target.status]})에 ${additions.length}건을 덧붙였습니다. 새 건은 만들지 않았습니다.`
        : `점검 건 ${target.id}을 만들었습니다. 인터뷰 대기 상태입니다.` };
  });
}

export async function reviewStatus(workspace: string, options: { state?: string; config?: BrainConfig } = {}) {
  const config = options.config ?? await loadBrainConfig();
  const p = await paths(workspace, config, options.state);
  const baseline = await readJson<Snapshot>(p.baseline);
  const cases = await listCases(p);
  const current = openCase(cases);
  return { ...publicPaths(p), baselineAt: baseline?.takenAt ?? null, baselineFiles: baseline ? Object.keys(baseline.files).length : 0,
    openCase: current ? summary(current) : null, cases: cases.map(summary).reverse().slice(0, 20), dismissed: Object.keys((await loadState(p)).dismissed).length };
}

export async function showReview(workspace: string, id: string, options: { state?: string; config?: BrainConfig } = {}) {
  const config = options.config ?? await loadBrainConfig();
  const p = await paths(workspace, config, options.state);
  return { ...publicPaths(p), case: await loadCase(p, id), report: join(p.cases, `${id}.md`) };
}

/** 인터뷰 답변 기록. decision: apply(반영) · hold(보류, 다음 점검에서 다시 묻음) · skip(묻지 않음, 같은 발견은 이후 점검에서 제외) */
export async function answerReview(workspace: string, id: string, value: unknown, options: { state?: string; config?: BrainConfig } = {}) {
  const config = options.config ?? await loadBrainConfig();
  const p = await paths(workspace, config, options.state);
  if (!value || typeof value !== 'object' || !Array.isArray((value as { answers?: unknown }).answers)) fail('INVALID_INPUT', '입력은 { "answers": [ { "questionId", "answer", "decision" } ] } 형식의 JSON입니다.');
  const answers = (value as { answers: unknown[] }).answers;
  if (!answers.length || answers.length > 200) fail('INVALID_INPUT', '답변은 1~200개여야 합니다.');
  return locked(p, async () => {
    const c = await loadCase(p, id);
    if (!openStatuses.includes(c.status)) fail('CASE_CLOSED', '완료된 점검 건에는 답변을 기록할 수 없습니다.');
    const state = await loadState(p), at = now();
    for (const raw of answers) {
      const a = raw as Record<string, unknown>;
      const q = c.questions.find(x => x.id === a.questionId) ?? fail('INVALID_INPUT', `질문 ID를 확인하세요: ${String(a.questionId).slice(0, 40)}`);
      if (typeof a.answer !== 'string' || !a.answer.trim() || a.answer.length > 4000 || a.answer.includes('\0')) fail('INVALID_INPUT', `${q.id}의 답변은 1~4000자 문자열이어야 합니다.`);
      if (!['apply', 'hold', 'skip'].includes(String(a.decision))) fail('INVALID_INPUT', `${q.id}의 decision은 apply · hold · skip 중 하나입니다.`);
      if (/\b(?:github_pat_|ghp_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/.test(a.answer)) fail('SENSITIVE_INPUT', '인증값 형태의 답변은 기록할 수 없습니다.');
      q.answer = { text: a.answer.trim().normalize('NFC'), decision: a.decision as Decision, at, origin: a.origin === 'agent' ? 'agent' : 'user' };
      for (const key of q.findingKeys) { if (q.answer.decision === 'skip') state.dismissed[key] = { at, caseId: c.id }; else delete state.dismissed[key]; }
    }
    await writeJson(p.stateFile, state);
    await saveCase(p, c);
    return { ...publicPaths(p), case: summary(c), unanswered: c.questions.filter(q => !q.answer).map(q => q.id), message: '답변을 기록했습니다. 확정된 내용만 반영하고 반영한 문서는 mark --applied로 남기세요.' };
  });
}

/** 상태 전환과 반영 기록. done은 점검 이후 생긴 뜻밖의 변경이 있으면 거부하고(--accept-new로 수용), 기준점을 지금 상태로 옮긴다 */
export async function markReview(workspace: string, id: string, input: { status?: ReviewStatus; note?: string; applied?: string[]; acceptNew?: boolean; verify?: boolean }, options: { state?: string; config?: BrainConfig } = {}) {
  const config = options.config ?? await loadBrainConfig();
  const p = await paths(workspace, config, options.state);
  if (input.status !== undefined && !(input.status in statusLabels)) fail('INVALID_INPUT', 'status는 awaiting_interview · applying · partial · failed · done 중 하나입니다.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1000 || /[\0]/.test(input.note))) fail('INVALID_INPUT', 'note는 1000자 이하 문자열입니다.');
  for (const path of input.applied ?? []) if (!path.trim() || isAbsolute(path) || path.includes('\0') || path.includes('\\') || path.split('/').some(s => s === '..')) fail('INVALID_INPUT', `applied는 작업 공간 기준 상대경로입니다: ${path.slice(0, 60)}`);
  return locked(p, async () => {
    const c = await loadCase(p, id), at = now();
    if (c.status === 'done') fail('CASE_CLOSED', '완료된 점검 건은 바꿀 수 없습니다. 새 점검을 실행하세요.');
    for (const path of input.applied ?? []) {
      const content = (await readText(p.root, path.trim(), '', LIMIT)).content;
      c.applied.push({ at, path: path.trim().normalize('NFC'), hash: createHash('sha256').update(content).digest('hex'), ...(input.note ? { note: input.note } : {}) });
    }
    let verification: ReviewCase['verification'];
    if (input.status === 'done' || input.verify) {
      const last = await readJson<Snapshot>(join(p.snapshots, `${c.id}.json`)) ?? fail('STATE_INVALID', '점검 건의 스냅샷이 없습니다. inspect를 다시 실행하세요.');
      const state = await loadState(p);
      const fresh = await inspectWorkspace(p, config, last, state.dismissed);
      const applied = new Set<string>();
      for (const a of new Map(c.applied.map(a => [normalized(a.path), a])).values()) {
        const path = Object.keys(fresh.snapshot.files).find(path => normalized(path) === normalized(a.path));
        if (path && a.hash && fresh.snapshot.hashes?.[path] === a.hash) applied.add(normalized(a.path));
      }
      const unexpected = fresh.findings.filter(f => deltaKinds.includes(f.kind) && !applied.has(normalized(f.path))).map(f => `${kindLabels[f.kind]}: ${f.path}`);
      if (unexpected.length && !input.acceptNew) fail('NEW_CHANGES', `마지막 점검 이후 반영 기록에 없는 변경 ${unexpected.length}건이 있습니다: ${unexpected.slice(0, 10).join(' / ')}. 다시 inspect하거나 --accept-new로 수용하세요.`);
      if (c.questions.some(q => !q.answer) && !input.acceptNew) fail('UNANSWERED', `답변 없는 질문 ${c.questions.filter(q => !q.answer).length}개가 있습니다. 보류(hold)로 기록하거나 partial로 남기세요.`);
      const remaining: Partial<Record<FindingKind, number>> = {};
      for (const f of fresh.findings) if (!deltaKinds.includes(f.kind)) remaining[f.kind] = (remaining[f.kind] ?? 0) + 1;
      verification = { at, remaining, warnings: fresh.warnings };
      c.verification = verification;
      // A completed review must not advance past deferred file changes.
      const previousBaseline = await readJson<Snapshot>(p.baseline);
      for (const q of c.questions.filter(q => q.answer?.decision === 'hold' || !q.answer)) {
        for (const f of c.findings.filter(f => q.findingKeys.includes(f.key) && (deltaKinds.includes(f.kind) || f.kind === 'memory_related'))) {
          if (previousBaseline?.files[f.path]) fresh.snapshot.files[f.path] = previousBaseline.files[f.path];
          else delete fresh.snapshot.files[f.path];
          if (previousBaseline?.hashes?.[f.path]) fresh.snapshot.hashes![f.path] = previousBaseline.hashes[f.path];
          else delete fresh.snapshot.hashes![f.path];
        }
      }
      if (input.status === 'done') {
        await writeJson(p.baseline, fresh.snapshot);
        c.baselineAt = fresh.snapshot.takenAt;
      }
    }
    if (input.status) { c.status = input.status; c.notes.push({ at, status: input.status, note: input.note ?? (input.status === 'done' ? '완료: 기준점을 지금 상태로 옮겼습니다.' : '상태 변경') }); }
    else if (input.note) c.notes.push({ at, status: c.status, note: input.note });
    await saveCase(p, c);
    return { ...publicPaths(p), case: summary(c), ...(verification ? { verification, baselineAdvanced: input.status === 'done' } : {}),
      message: input.status === 'done' ? '점검 건을 완료하고 기준점을 옮겼습니다. 남은 구조 점검 항목은 verification을 확인하세요.' : '점검 건을 갱신했습니다.' };
  });
}

/** 예약 스크립트 · 안내용: 이 작업 공간의 상태 폴더 위치(쓰지 않음) */
export async function reviewDirectory(workspace: string, options: { state?: string; config?: BrainConfig } = {}) {
  const p = await paths(workspace, options.config ?? await loadBrainConfig(), options.state);
  return publicPaths(p);
}

/** 예약 실행용 한 줄 요약 */
export const scheduledLine = (result: Awaited<ReturnType<typeof inspectReview>>) =>
  `${result.inspectedAt} ${result.result}${result.case ? ` case=${result.case.id} status=${result.case.status} unanswered=${result.case.unanswered}` : ''} additions=${result.additions}${result.warnings.length ? ` warnings=${result.warnings.length}` : ''}`;

/** 예약 로그: 상태 폴더에 한 줄씩 덧붙이고 1MiB를 넘으면 뒤 절반만 남긴다 */
export async function appendScheduleLog(stateDirectory: string, line: string) {
  const file = join(stateDirectory, 'schedule.log');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const info = await lstat(file).catch(() => null);
  if (info?.isSymbolicLink()) return;
  if (info && info.size > 1024 * 1024) { const text = await readFile(file, 'utf8'); await writeAtomic(file, text.slice(text.length >> 1).replace(/^[^\n]*\n/, '')); }
  const handle = await open(file, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${line}\n`); } finally { await handle.close(); }
}

/** Serialize the full model/read/apply cycle, independently of the short state-file lock. */
export async function withReviewRunLock<T>(workspace: string, options: { state?: string; config?: BrainConfig }, work: () => Promise<T>) {
  const p = await paths(workspace, options.config ?? await loadBrainConfig(), options.state);
  return locked({ ...p, lock: join(p.directory, '.run.lock') }, work);
}
