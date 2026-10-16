import { spawnManaged, killManaged } from '../platform/process.js';
import { resolveCommand } from '../platform/commands.js';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DiscoveredItem } from './catalog.js';
import { checkedFile, claudeExecutable, cliExecutable, ghostConfiguration, hash, inside, localProcessEnvironment } from './catalog.js';
import { AutomationError } from './errors.js';
import type { AutomationStore, StoredRun } from './store.js';
import { executeSkill } from './skill-runner.js';
import type { SkillContext, SkillDocumentCandidate } from '../../shared/automation.js';

export interface Task { run: StoredRun; item: DiscoveredItem; input: string; selectionCandidates?: SkillDocumentCandidate[]; onContext?: (context: SkillContext) => Promise<void> }
export interface RunResult { status?: 'succeeded' | 'waiting_input' | 'needs_input' | 'failed' | 'cancelled'; sessionId?: string; context?: SkillContext; message: string; result: string; artifacts: string[]; artifactDirectory: string }
export interface ProcessSpec { command: string; args: string[]; cwd: string; input?: string; timeout: number; ghostEnv?: { API_URL: string; CONTENT_API_KEY: string } }
export type ProcessRunner = (spec: ProcessSpec, signal: AbortSignal) => Promise<{ code: number | null; stdout: string }>;
export type TaskRunner = (task: Task, signal: AbortSignal, store: AutomationStore) => Promise<RunResult>;

export const runProcess: ProcessRunner = (spec, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new AutomationError('CANCELLED')); return; }
  if (!resolveCommand(spec.command)) { reject(new AutomationError('CLI_MISSING')); return; }
  const child = spawnManaged(spec.command, spec.args, { cwd: spec.cwd, env: { ...localProcessEnvironment(), ...(spec.ghostEnv ? { API_URL: spec.ghostEnv.API_URL, CONTENT_API_KEY: spec.ghostEnv.CONTENT_API_KEY } : {}) } });
  let failure: AutomationError | null = null;
  let output = '';
  let bytes = 0;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (type: NodeJS.Signals) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    killManaged(child, type);
  };
  const stop = (error: AutomationError) => {
    if (failure) return;
    failure = error;
    kill('SIGTERM');
    killTimer = setTimeout(() => kill('SIGKILL'), 3000);
  };
  const abort = () => stop(new AutomationError('CANCELLED'));
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => stop(new AutomationError('TIMEOUT')), spec.timeout);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) stop(new AutomationError('OUTPUT_LIMIT'));
    else output += chunk;
  });
  // stderr에는 API 키나 원문이 포함될 수 있어 보관·반환하지 않는다.
  child.stderr.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) stop(new AutomationError('OUTPUT_LIMIT'));
  });
  child.stdin.on('error', () => {});
  child.on('error', error => { failure = new AutomationError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'CLI_MISSING' : 'EXECUTION_FAILED'); });
  child.on('close', code => {
    clearTimeout(timeout); clearTimeout(killTimer); signal.removeEventListener('abort', abort);
    if (failure) reject(failure); else resolve({ code, stdout: output });
  });
  child.stdin.end(spec.input ?? '');
});

export async function executeTask(task: Task, signal: AbortSignal, store: AutomationStore, execute: ProcessRunner = runProcess, findClaude = claudeExecutable, findCodex = () => cliExecutable('codex')): Promise<RunResult> {
  const { run, item } = task;
  const resuming = run.conversationId && (run.turn ?? 0) > 1;
  const root = resuming ? join(store.runDirectory(run.conversationId!), 'work', 'skill') : run.workspace;
  const file = resuming ? join(root, basename(run.sourcePath)) : item.file;
  const source = await readFile(await checkedFile(root, file), 'utf8');
  if (hash(source) !== run.sourceHash) throw new AutomationError('NOT_READY');
  if (item.adapter === 'skill') return executeSkill(task, source, signal, store, execute, findClaude, findCodex);
  if (item.adapter === 'brain-review') {
    const { executeReviewTask } = await import('./review.js');
    return executeReviewTask(task, signal, store);
  }
  if (item.adapter !== 'ghost') throw new AutomationError('NOT_READY');
  const directory = dirname(item.file);
  const script = await checkedFile(run.workspace, join(directory, 'collect-newsletter.mjs'));
  const config = await ghostConfiguration(run.workspace, directory);
  if (config.reason) throw new AutomationError('NOT_READY');
  const response = await execute({ command: process.execPath, args: [...(config.environment ? [] : ['--env-file=.env']), script],
    ...(config.environment ? { ghostEnv: config.environment } : {}), cwd: directory, timeout: 45000 }, signal);
  if (response.code !== 0) throw new AutomationError('EXECUTION_FAILED');
  try {
    const data = JSON.parse(response.stdout);
    if (data.routineId !== 'collect-newsletter-example' || !['succeeded', 'no_data'].includes(data.status)
      || typeof data.runDir !== 'string' || !Number.isFinite(Date.parse(data.startedAt))
      || Date.parse(data.startedAt) < Date.parse(run.startedAt!) - 1000) throw new Error();
    const output = await realpath(join(directory, 'output'));
    const resultDirectory = await realpath(data.runDir);
    if (!inside(await realpath(run.workspace), output) || resultDirectory === output || !inside(output, resultDirectory)) throw new Error();
    const saved = JSON.parse(await readFile(await checkedFile(resultDirectory, join(resultDirectory, 'result.json')), 'utf8'));
    if (JSON.stringify(saved) !== JSON.stringify(data) || (data.status === 'succeeded' ? data.count !== 1 : data.count !== 0)) throw new Error();
    const artifacts = ['result.json', 'response.json', ...(data.status === 'succeeded' ? ['article.html'] : [])];
    for (const name of artifacts) await checkedFile(resultDirectory, join(resultDirectory, name), 10 * 1024 * 1024);
    const sourceData = JSON.parse(await readFile(join(resultDirectory, 'response.json'), 'utf8'));
    if (!Array.isArray(sourceData.posts) || sourceData.posts.length !== data.count) throw new Error();
    if (data.count === 1) {
      const post = sourceData.posts[0];
      const html = await readFile(join(resultDirectory, 'article.html'), 'utf8');
      if (post.id !== data.postId || typeof data.title !== 'string' || html !== post.html || html.length !== data.htmlCharacters) throw new Error();
    }
    return { message: data.count ? '공개 글 1건을 수집했습니다.' : '수집할 공개 글이 없습니다.',
      result: data.count ? `제목: ${data.title}\n수집: 1건\n저장 위치: ${resultDirectory}` : '공개 글 0건', artifacts, artifactDirectory: resultDirectory };
  } catch { throw new AutomationError('INVALID_RESULT'); }
}
