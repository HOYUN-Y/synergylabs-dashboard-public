import { scanWorkspace } from '../workspace-scan.js';
import type { WorkspaceInventory } from '../workspace-scan.js';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { processEnvironment, resolveCommand } from '../platform/commands.js';
import { captureProcess } from '../platform/process.js';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { AutomationCatalog, AutomationItem } from '../../shared/automation.js';
import { AutomationError } from './errors.js';

export interface DiscoveredItem extends AutomationItem { file: string; adapter: 'skill' | 'ghost' | 'youtube' | 'brain-review' | null; reviewSkillId?: string }
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
// 기존 실행 ID를 보존하도록 OS의 상대경로 구분자를 사용한다.
export function automationTargetId(root: string, file: string, relativePath = relative) {
  return hash(`${root.normalize('NFC')}\0${relativePath(root, file).normalize('NFC')}`).slice(0, 24);
}
export function inside(root: string, file: string) {
  const rel = relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export async function workspacePath(value: unknown) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || value.includes('\0')) throw new AutomationError('INVALID_INPUT');
  try {
    const root = await realpath(value);
    if (!(await stat(root)).isDirectory()) throw new Error();
    return root;
  } catch { throw new AutomationError('INVALID_INPUT'); }
}
export async function checkedFile(root: string, file: string, limit = 65536) {
  try {
    const resolved = await realpath(file);
    const info = await lstat(file);
    if (!inside(await realpath(root), resolved) || !info.isFile() || info.size > limit) throw new Error();
    return resolved;
  } catch { throw new AutomationError('PATH_DENIED'); }
}
export async function cliExecutable(name: 'claude' | 'codex') {
  const target = resolveCommand(name);
  return target ? target.prefixArgs[0] ?? target.command : null;
}
export const claudeExecutable = () => cliExecutable('claude');
export async function ghostConfiguration(root: string, directory: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.API_URL !== undefined || env.CONTENT_API_KEY !== undefined) {
    const missing = ['API_URL', 'CONTENT_API_KEY'].filter(key => !env[key]?.trim());
    return { reason: missing.length ? `중앙 환경 설정에 ${missing.join('·')}가 필요합니다.` : null,
      environment: missing.length ? undefined : { API_URL: env.API_URL!, CONTENT_API_KEY: env.CONTENT_API_KEY! } };
  }
  try { await checkedFile(root, join(directory, '.env')); return { reason: null, environment: undefined }; }
  catch { return { reason: '중앙 환경 설정에 API_URL·CONTENT_API_KEY가 필요합니다. 기존 루틴 .env도 없습니다.', environment: undefined }; }
}
export function localProcessEnvironment() {
  // CLI 로그인과 루틴 자체 환경 파일을 사용하며 서버의 다른 서비스 비밀값은 전달하지 않는다.
  return processEnvironment();
}
export async function claudeReadiness(): Promise<string | null> {
  const executable = await claudeExecutable();
  if (!executable) return 'Claude CLI 설치와 실행 권한을 확인해 주세요.';
  try {
        const help = await captureProcess(executable, ['--help'], { timeout: 10000, maxBuffer: 65536, env: localProcessEnvironment() });
        if (help.code !== 0 || !['--safe-mode', '--restricted', '--strict-mcp-config'].every(flag => help.stdout.includes(flag))) return '설치된 Claude CLI가 필요한 격리 옵션을 지원하지 않습니다. 호환 버전을 확인해 주세요.';
        const { code, stdout } = await captureProcess(executable, ['auth', 'status', '--json'], { timeout: 10000, maxBuffer: 65536, env: localProcessEnvironment() });
        const status = JSON.parse(stdout);
        if (code === 0 && status.loggedIn === true) return null;
        if (status.loggedIn === false) return 'Claude CLI 로그인이 필요합니다. 터미널에서 claude auth login 후 목록을 새로고침해 주세요.';
  } catch { /* 원문 인증 응답과 stderr는 노출하지 않는다. */ }
  return 'Claude CLI 로그인 상태를 확인하지 못했습니다. CLI 버전과 로그인을 확인해 주세요.';
}
function metadata(text: string, fallback: string) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  // 기존 스킬의 한 줄 메타데이터만 사용한다. 복잡한 YAML은 본문 제목으로 대체한다.
  const field = (name: string) => front.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '');
  const heading = text.match(/^#\s+(.+)$/m)?.[1];
  const description = field('description');
  return { name: (heading ?? field('name') ?? fallback).slice(0, 160),
    description: description && !['>', '|', '>-', '|-'].includes(description) ? description.slice(0, 400) : '개별 스킬 문서에서 입력과 실행 조건을 확인합니다.' };
}
export async function discover(root: string, checkClaude = claudeReadiness, inventory?: WorkspaceInventory): Promise<Omit<AutomationCatalog, 'items'> & { items: DiscoveredItem[] }> {
  root = await workspacePath(root);
  const scanned = inventory ?? await scanWorkspace(root);
  const items: DiscoveredItem[] = [];
  const warnings = [...scanned.warnings];
  const claudeReason = await checkClaude();
  const candidates = scanned.files.filter(file => ['SKILL.md', 'skill.md', 'routine.json'].includes(file.name));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const kind = candidate.name === 'routine.json' ? 'routine' : 'skill';
    const directory = dirname(join(root, candidate.path));
    const identity = `${kind}\0${directory}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    try {
      const file = await checkedFile(root, join(root, candidate.path));
      const text = await readFile(file, 'utf8');
      const path = relative(root, file).split(sep).join('/');
      const folder = path.split('/').at(-2)!;
      let adapter: DiscoveredItem['adapter'] = null;
      let info = metadata(text, folder);
      let reason: string | null = '실행 설정 필요: 등록되지 않은 프로그램 루틴입니다.';
      if (kind === 'skill') {
        adapter = 'skill'; reason = claudeReason;
      } else {
        const config = JSON.parse(text);
        // routine.json에 description이 있으면 그 설명을, 없으면 기존 Ghost 루틴 설명을 유지한다
        info = { name: typeof config.name === 'string' ? config.name.slice(0, 160) : '프로그램 루틴',
          description: typeof config.description === 'string' && config.description.trim() ? config.description.trim().slice(0, 400) : 'Ghost 최신 공개 글의 원본 JSON과 본문 HTML을 수집합니다.' };
        if (folder === 'routine-collect-newsletter' && config.id === 'collect-newsletter-example'
          && config.type === 'program' && config.entrypoint === 'collect-newsletter.mjs' && config.limit === 1 && config.outputDir === 'output') {
          await checkedFile(root, join(directory, config.entrypoint)); adapter = 'ghost';
          reason = (await ghostConfiguration(root, directory)).reason;
        }
        if (folder === 'routine-collect-youtube-metrics' && config.id === 'collect-youtube-metrics'
          && config.type === 'program' && config.adapter === 'youtube-metrics') {
          adapter = 'youtube'; reason = null;
          if (typeof config.description !== 'string' || !config.description.trim()) info.description = 'YouTube 공개 롱폼 지표의 수동·예약 수집과 실행 기록을 확인합니다.';
        }
        if (folder === 'routine-brain-review' && config.id === 'brain-review-prepare' && config.type === 'program') {
          adapter = 'brain-review'; reason = null;
        }
      }
      items.push({ id: automationTargetId(root, file), kind, ...info,
        path, ready: adapter !== null && reason === null, reason, file, adapter, ...(adapter === 'youtube' ? { metricsService: 'youtube' as const } : {}) });
    } catch { warnings.push(`${relative(root, directory).normalize('NFC')}: 안내 파일 또는 실행 설정을 확인하지 못했습니다.`); }
  }
  items.sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name, 'ko') || a.path.localeCompare(b.path));
  return { items, warnings };
}
