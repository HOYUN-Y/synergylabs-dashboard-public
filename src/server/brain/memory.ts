// Index-first retrieval inspired by Rubric Second Brain (Jay E | RoboNuggets, CC BY 4.0).
// Korean text, configurable routing, revision checks and local writer locking are dashboard-specific.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { loadBrainConfig, routeGuides } from './config.js';
import type { BrainConfig } from './config.js';
import { checkedPath, excludedPath, readText } from './files.js';
import { createLinkResolver, extractLinks, normalized } from './links.js';

const LIMIT = 65536;
const START = '<!-- brain:index:start -->', END = '<!-- brain:index:end -->';
const CONTENT = '<!-- brain:content -->', HISTORY = '<!-- brain:history -->';
const lf = (text: string) => text.replace(/\r\n/g, '\n');
const revision = (text: string) => createHash('sha256').update(text).digest('hex');
export class MemoryError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new MemoryError(code, message); }
interface Fact { id: string; type: 'project' | 'feedback' | 'reference'; title: string; summary: string; content: string; sources: string[] }
interface RecordMeta extends Omit<Fact, 'content'> { format: 'brain-memory-v1'; updatedAt: string }
interface RecordFile { fact: Fact; meta: RecordMeta; history: string }
interface Context { root: string; folder: string; directory: string; index: string; files: string[] }

function factInput(value: unknown): Fact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', '기억 입력은 JSON 객체여야 합니다.');
  const v = value as Record<string, unknown>;
  const string = (key: string, max: number, multiline = false) => {
    const x = v[key];
    if (typeof x !== 'string' || !x.trim() || x.length > max || x.includes('\0') || (!multiline && /[\r\n]/.test(x)) || x.includes('<!-- brain:'))
      return fail('INVALID_INPUT', `${key} 형식을 확인해 주세요.`);
    return lf(x).trim().normalize('NFC');
  };
  const id = string('id', 64);
  if (!/^[a-z][a-z0-9_-]*$/.test(id) || excludedPath(id)) fail('INVALID_INPUT', 'id는 안전한 영문 소문자·숫자·밑줄·하이픈으로 지정하세요.');
  if (!['project', 'feedback', 'reference'].includes(String(v.type))) fail('INVALID_INPUT', '기억 유형을 확인해 주세요.');
  if (!Array.isArray(v.sources) || !v.sources.length || v.sources.length > 10 || v.sources.some(s => typeof s !== 'string' || !s.trim() || s.length > 1000 || /[\r\n\0]/.test(s)))
    fail('INVALID_INPUT', '근거는 비어 있지 않은 문자열 배열(최대 10개)이어야 합니다.');
  const fact = { id, type: v.type as Fact['type'], title: string('title', 160), summary: string('summary', 300), content: string('content', 16000, true), sources: (v.sources as string[]).map(s => s.trim().normalize('NFC')) };
  // Known token shapes are rejected, never hidden in the index while retained in the body.
  if (/\b(?:github_pat_|ghp_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/.test(JSON.stringify(fact))) fail('SENSITIVE_INPUT', '인증값 형태의 입력은 기억으로 저장할 수 없습니다.');
  return fact;
}

function render(meta: RecordMeta, content: string, history: string) {
  return `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n# ${meta.title}\n\n${CONTENT}\n${content}\n\n## 근거\n${meta.sources.map(s => `- ${s}`).join('\n')}\n\n${HISTORY}\n## 변경 이력\n${history}`;
}
function parse(text: string): RecordFile {
  text = lf(text);
  try {
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!front) throw new Error();
    const meta = Object.fromEntries(front[1].split('\n').map(line => {
      const at = line.indexOf(': ');
      if (at < 1) throw new Error();
      return [line.slice(0, at), JSON.parse(line.slice(at + 2))];
    })) as RecordMeta;
    const start = text.indexOf(CONTENT + '\n'), end = text.lastIndexOf('\n\n## 근거\n'), historyStart = text.indexOf(HISTORY + '\n## 변경 이력\n');
    if (meta.format !== 'brain-memory-v1' || typeof meta.updatedAt !== 'string' || !Number.isFinite(Date.parse(meta.updatedAt)) || start < 0 || end <= start || historyStart <= end) throw new Error();
    const content = text.slice(start + CONTENT.length + 1, end);
    const fact = factInput({ ...meta, content });
    const history = text.slice(historyStart + HISTORY.length + '\n## 변경 이력\n'.length);
    if (render(meta, fact.content, history) !== text) throw new Error();
    return { fact, meta, history };
  } catch { return fail('INVALID_MEMORY', '기억 문서 형식이 달라 자동으로 덮어쓰지 않습니다. 문서를 확인해 주세요.'); }
}

// Resolve each segment against actual names: macOS decomposed names must not become new duplicate paths.
async function actualPath(root: string, relative: string) {
  if (isAbsolute(relative) || /[\\\0:]/.test(relative) || excludedPath(relative) || relative.split('/').some(s => !s || s === '.' || s === '..'))
    fail('PATH_DENIED', '허용된 작업 공간 상대경로만 사용할 수 있습니다.');
  let result = '';
  for (const segment of relative.split('/')) {
    const matches = (await readdir(join(root, result))).filter(name => normalized(name) === normalized(segment));
    if (matches.length !== 1) fail('PATH_UNAVAILABLE', '필요한 폴더·문서가 없거나 경로가 모호합니다.');
    result = result ? `${result}/${matches[0]}` : matches[0];
    await checkedPath(root, result, '');
  }
  return result;
}
async function context(workspace: string, config: BrainConfig): Promise<Context> {
  if (!isAbsolute(workspace)) fail('INVALID_INPUT', '작업 공간의 절대경로를 지정하세요.');
  if (!config.memory) fail('NOT_CONFIGURED', '설정에 memory.areaId를 등록해 주세요.');
  const area = config.areas.find(a => a.id === config.memory!.areaId);
  if (!area) fail('NOT_CONFIGURED', '기억 분야 설정을 확인해 주세요.');
  const root = await realpath(workspace);
  const folder = await actualPath(root, area.folder), directory = await checkedPath(root, folder, '');
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 1000) fail('LIMIT_EXCEEDED', '기억 폴더의 항목 수 제한(1,000개)을 넘었습니다.');
  const files = entries.filter(e => e.isFile() && /\.md$/i.test(e.name) && !excludedPath(e.name)).map(e => `${folder}/${e.name}`);
  const router = await actualPath(root, config.routerFile);
  const text = (await readText(root, router, '', LIMIT)).content;
  // Memory routing requires explicit relative links; unrelated router links are not traversed.
  const raw = extractLinks(text).filter(l => !l.wiki && !l.target.startsWith('/'));
  const targets = createLinkResolver(files)(router, raw).targets;
  const index = routeGuides(config, targets).get(area.id);
  if (!index) fail('INDEX_UNAVAILABLE', '라우터에서 기억 폴더 바로 아래 목차로 상대경로 링크를 연결해 주세요.');
  return { root, folder, directory, files, index };
}
async function read(c: Context, path: string) { return (await readText(c.root, path, '', LIMIT)).content; }
function managedIndex(text: string, entries: string[]) {
  const start = text.indexOf(START), end = text.indexOf(END);
  if (start < 0 || end < start || start !== text.lastIndexOf(START) || end !== text.lastIndexOf(END))
    fail('INVALID_INDEX', '목차에 brain:index:start/end 관리 구역을 하나씩 지정해 주세요.');
  const newline = text.match(/\r?\n/)?.[0] ?? '\n';
  return text.slice(0, start + START.length) + newline + entries.join(newline) + newline + text.slice(end);
}
async function atomic(c: Context, path: string, text: string, previous: string | null) {
  if (Buffer.byteLength(text) > LIMIT) fail('LIMIT_EXCEEDED', '기억 문서 크기 제한(64KiB)을 넘었습니다.');
  if (dirname(path) !== c.folder || excludedPath(path)) fail('PATH_DENIED', '기억 폴더 밖에는 쓸 수 없습니다.');
  if (await checkedPath(c.root, c.folder, '') !== c.directory) fail('CONFLICT', '작업 공간이 변경되었습니다.');
  const file = join(c.root, path);
  const info = await lstat(file).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
  if (info && (!info.isFile() || info.isSymbolicLink())) fail('PATH_DENIED', '일반 기억 파일만 수정할 수 있습니다.');
  if ((info ? await read(c, path) : null) !== previous) fail('CONFLICT', '문서가 변경되었습니다. 다시 읽은 뒤 갱신하세요.');
  const temp = join(c.directory, `.brain-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    await checkedPath(c.root, c.folder, '');
    await rename(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
}
async function locked<T>(c: Context, work: () => Promise<T>) {
  const file = join(c.directory, '.brain-memory.lock');
  let handle;
  for (let attempt = 0; ; attempt++) {
    try { handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt >= 20) fail('BUSY', '다른 기억 갱신이 진행 중이거나 잠금이 남아 있습니다. 실행 상태를 확인하세요.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try { return await work(); }
  finally { await handle.close(); await unlink(file); }
}
const indexLabel = (text: string) => text.replace(/[[\]<>`]/g, '').replace(/[\r\n]/g, ' ');
async function rebuild(c: Context) {
  const index = await read(c, c.index);
  const entries: { title: string; line: string }[] = [];
  const names = await readdir(c.directory, { withFileTypes: true });
  if (names.length > 1000) fail('LIMIT_EXCEEDED', '기억 폴더 항목 수 제한을 넘었습니다.');
  const warnings: string[] = [];
  for (const name of names) {
    const path = `${c.folder}/${name.name}`;
    if (path === c.index || excludedPath(name.name) || !/\.md$/i.test(name.name)) continue;
    if (!name.isFile()) { warnings.push('일반 파일이 아닌 기억 후보를 제외했습니다.'); continue; }
    const raw = await read(c, path);
    if (!lf(raw).startsWith('---\nformat: "brain-memory-v1"\n')) { warnings.push('기억 형식이 아닌 문서를 제외했습니다.'); continue; }
    const { fact, meta } = parse(raw);
    if (name.name !== `${fact.id}.md`) fail('INVALID_MEMORY', '기억 ID와 파일 이름이 일치하지 않습니다.');
    entries.push({ title: fact.title, line: `- [${indexLabel(fact.title)}](${name.name}) — ${fact.type} · ${meta.updatedAt.slice(0, 10)} · ${indexLabel(fact.summary)}` });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const next = managedIndex(index, entries.map(e => e.line));
  if (next !== index) await atomic(c, c.index, next, index);
  return { index: c.index, count: entries.length, warnings };
}
export async function reindexMemory(workspace: string, config?: BrainConfig) {
  const c = await context(workspace, config ?? await loadBrainConfig());
  return locked(c, () => rebuild(c));
}
export async function storeMemory(workspace: string, value: unknown, config?: BrainConfig) {
  const fact = factInput(value), input = value as Record<string, unknown>;
  const c = await context(workspace, config ?? await loadBrainConfig());
  return locked(c, async () => {
    // Validate the index before writing a fact; a later I/O failure remains repairable with reindex.
    managedIndex(await read(c, c.index), []);
    const path = `${c.folder}/${fact.id}.md`;
    if (path === c.index) fail('INVALID_INPUT', '목차 파일 이름은 기억 ID로 사용할 수 없습니다.');
    const exists = await lstat(join(c.root, path)).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    const before = exists ? await read(c, path) : null;
    const old = before === null ? null : parse(before);
    if (old && input.expectedRevision !== revision(before!)) fail('CONFLICT', '기존 기억의 최신 수정 버전을 지정하세요.');
    if (!old && input.expectedRevision !== undefined) fail('CONFLICT', '갱신할 기존 기억이 없습니다.');
    if (old && old.fact.id !== fact.id) fail('INVALID_MEMORY', '기존 기억 ID가 다릅니다.');
    const unchanged = old && JSON.stringify(old.fact) === JSON.stringify(fact);
    let after = before;
    if (!unchanged) {
      const reason = input.changeReason;
      if (old && (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /[\r\n\0]/.test(reason))) fail('INVALID_INPUT', '갱신에는 한 줄 변경 이유(changeReason)가 필요합니다.');
      if (typeof reason === 'string' && /\b(?:github_pat_|ghp_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/.test(reason)) fail('SENSITIVE_INPUT', '변경 이유에 인증값을 기록할 수 없습니다.');
      const updatedAt = new Date().toISOString();
      const { content, ...fields } = fact;
      const meta: RecordMeta = { format: 'brain-memory-v1', ...fields, updatedAt };
      const history = `- ${updatedAt} — ${old ? indexLabel(String(reason)) : '최초 기록'}\n${old?.history ?? ''}`;
      after = render(meta, content, history);
      await atomic(c, path, after, before);
    }
    try { await rebuild(c); }
    catch { fail('INDEX_UPDATE_FAILED', '기억 본문은 저장됐지만 목차 반영에 실패했습니다. reindex로 복구하세요.'); }
    return { path, revision: revision(after!), unchanged: !!unchanged };
  });
}

const words = (text: string) => [...new Set(normalized(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter(w => w.length >= 2);
export async function recallMemory(workspace: string, query: string, config?: BrainConfig) {
  if (!query.trim() || query.length > 500) fail('INVALID_INPUT', '검색어는 1~500자로 입력하세요.');
  const c = await context(workspace, config ?? await loadBrainConfig());
  const index = await read(c, c.index), terms = words(query);
  const resolve = createLinkResolver(c.files);
  const candidates = new Map<string, number>(), warnings: string[] = [];
  for (const line of index.split('\n')) {
    const termsInLine = words(line);
    const score = terms.reduce((n, w) => n + (termsInLine.includes(w) ? 3 : termsInLine.some(t => t.startsWith(w) || w.startsWith(t)) ? 1 : 0), 0);
    if (!score) continue;
    const found = resolve(c.index, extractLinks(line));
    if (found.warnings.length) warnings.push('관련 목차 링크를 확인하지 못했습니다. reindex 또는 라우터를 확인하세요.');
    for (const path of found.targets) if (path !== c.index && dirname(path) === c.folder) candidates.set(path, Math.max(score, candidates.get(path) ?? 0));
  }
  const hits = [];
  for (const [path, score] of [...candidates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (hits.length === 3) break;
    try {
      const text = await read(c, path), { fact, meta } = parse(text);
      const lines = fact.content.split('\n');
      let best = 0, bestScore = 0;
      lines.forEach((line, i) => { const s = terms.filter(t => normalized(line).toLowerCase().includes(t)).length; if (s > bestScore) { best = i; bestScore = s; } });
      hits.push({ path, title: fact.title, summary: fact.summary, sources: fact.sources, updatedAt: meta.updatedAt, revision: revision(text), score,
        content: lines.slice(Math.max(0, best - 3), best + 16).join('\n').slice(0, 3000) });
    } catch { warnings.push('선택한 기억을 읽지 못했습니다. 문서 형식과 접근 권한을 확인하세요.'); }
  }
  return { hits, warnings: [...new Set(warnings)], message: hits.length ? '관련 기억을 찾았습니다. 원본 근거와 현재 지시를 함께 확인하세요.' : '관련 기억이 없습니다. 분야별 안내와 원본 문서를 확인하세요.' };
}
