import { scanWorkspace, clearWorkspaceScan } from '../workspace-scan.js';
import { constants } from 'node:fs';
import { defaultWorkspace, defaultOutput } from '../workspace-paths.js';
import { exportArtifacts } from './output.js';
import type { WorkspaceSettings } from '../../shared/workspace.js';
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AutomationRun, SkillConversation, ExecutionOptions, AutomationNotification, NotificationPage } from '../../shared/automation.js';
import { isActive, defaultExecution } from '../../shared/automation.js';
import { checkedFile, discover, hash, inside, workspacePath } from './catalog.js';
import { AutomationError } from './errors.js';
import { executionOptions, validateExecution } from './execution-options.js';
import { AutomationStore } from './store.js';
import type { StoredRun } from './store.js';
import { executeTask } from './runner.js';
import type { RunResult, Task, TaskRunner } from './runner.js';

function publicRun(run: StoredRun): AutomationRun {
  return { ...(run.context ? { context: run.context } : {}), id: run.id, targetId: run.targetId, kind: run.kind, name: run.name, sourcePath: run.sourcePath, sourceHash: run.sourceHash,
    status: run.status, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt, message: run.message, result: run.result, artifacts: run.artifacts, ...(run.output ? { output: run.output } : {}), ...(run.execution ? { execution: run.execution } : {}), ...(run.conversationId ? { conversationId: run.conversationId, turn: run.turn } : {}) };
}
export class AutomationService {
  private runs = new Map<string, StoredRun>();
  private queue: Task[] = [];
  private active: { id: string; controller: AbortController } | null = null;
  private initialized: Promise<void> | null = null;
  private gate: Promise<unknown> = Promise.resolve();
  private worker: Promise<void> | null = null;
  private closing = false;
  private storageFailed = false;
  constructor(private store = new AutomationStore(), private runner: TaskRunner = executeTask, private scan = discover, private options: () => Promise<ExecutionOptions> = executionOptions) {}
  executionOptions() { return this.options(); }
  private async prepared(root: string) {
    const result = await this.scan(root, undefined, await scanWorkspace(root, (await this.settings()).outputDirectory));
    for (const item of result.items) {
      if (item.kind !== 'skill') continue;
      const settings = await this.store.skillSettings(item.id);
      if (settings.execution?.provider === 'codex' && item.adapter === 'skill') {
        const provider = (await this.options()).providers.find(p => p.id === 'codex');
        item.reason = provider?.reason ?? null;
        item.ready = provider?.ready === true;
        if (!provider?.models.some(m => m.id === settings.execution!.model && m.efforts.includes(settings.execution!.effort))) {
          item.ready = false; item.reason = '저장된 모델·effort를 사용할 수 없습니다. 스킬 설정에서 다시 선택해 주세요.';
        }
      }
    }
    return result;
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const work = this.gate.then(fn);
    this.gate = work.catch(() => {});
    return work;
  }
  private async persistRun(run: StoredRun) {
    if (!isActive(run.status) && !run.notification) {
      run.notification = { createdAt: run.finishedAt ?? new Date().toISOString(), readAt: null };
    }
    try { await this.store.saveRun(run); }
    catch (error) { this.storageFailed = true; throw error; }
  }
  private init() {
    return this.initialized ??= (async () => {
      for (const run of await this.store.loadRuns()) {
        if (!isActive(run.status) && !run.notification) {
          run.notification = { createdAt: run.finishedAt ?? run.createdAt, readAt: new Date().toISOString() };
          await this.persistRun(run);
        }
        if (isActive(run.status)) {
          run.status = 'interrupted'; run.finishedAt = new Date().toISOString(); run.message = '서버가 재시작되었습니다. 결과를 확인한 뒤 다시 실행해 주세요.';
          await this.persistRun(run);
        }
        this.runs.set(run.id, run);
      }
    })();
  }
  async settings(): Promise<WorkspaceSettings> {
    const saved = await this.store.settings();
    return { workspace: saved.workspace || defaultWorkspace, outputDirectory: saved.outputDirectory || defaultOutput,
      workspaceInput: saved.workspace, outputInput: saved.outputDirectory || '' };
  }
  saveSettings(value: unknown, output?: unknown) {
    return this.exclusive(async () => {
      await this.init();
      if ([...this.runs.values()].some(run => isActive(run.status))) throw new AutomationError('BUSY');
      if (typeof value !== 'string' || (output !== undefined && typeof output !== 'string')) throw new AutomationError('INVALID_INPUT');
      const workspace = value.trim() ? await workspacePath(value.trim()) : '';
      const previous = await this.store.settings();
      const chosen = output === undefined ? previous.outputDirectory || '' : (output as string).trim();
      const destination = chosen ? await workspacePath(chosen) : '';
      if (destination) await access(destination, constants.W_OK).catch(() => { throw new AutomationError('PATH_DENIED'); });
      await this.store.saveSettings(workspace, destination);
      clearWorkspaceScan();
      return this.settings();
    });
  }
  private async root() {
    const settings = await this.settings();
    if (!settings.workspace) throw new AutomationError('NOT_CONFIGURED');
    return workspacePath(settings.workspace);
  }
  async catalog() {
    const root = await this.root();
    const result = await this.prepared(root);
    if (root !== await this.root()) throw new AutomationError('NOT_READY');
    return { warnings: result.warnings, items: result.items.map(item => ({ id: item.id, kind: item.kind, name: item.name,
      description: item.description, path: item.path, ready: item.ready, reason: item.reason })) };
  }
  private async checkSkill(id: string) {
    const root = await this.root();
    const inventory = await scanWorkspace(root, (await this.settings()).outputDirectory);
    if (!(await this.scan(root, undefined, inventory)).items.some(item => item.id === id && item.kind === 'skill')) throw new AutomationError('NOT_FOUND');
  }
  async skillSettings(id: string) {
    await this.checkSkill(id);
    return this.store.skillSettings(id);
  }
  saveSkillSettings(id: string, input: unknown, execution?: unknown) {
    return this.exclusive(async () => {
      if ((input !== undefined && (typeof input !== 'string' || input.length > 10000)) || (input === undefined && execution === undefined)) throw new AutomationError('INVALID_INPUT');
      await this.checkSkill(id);
      const previous = await this.store.skillSettings(id);
      const selected = execution === undefined ? previous.execution : await validateExecution(execution, this.options);
      return this.store.saveSkillSettings(id, typeof input === 'string' ? input.trim() : previous.input, selected);
    });
  }
  async history(targetId?: string, latestPerTarget = false) {
    await this.init();
    if (this.storageFailed) throw new AutomationError('STORAGE_FAILED');
    const sorted = [...this.runs.values()].filter(run => !targetId || run.targetId === targetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (latestPerTarget) {
      const seen = new Set<string>();
      return { runs: sorted.filter(run => { if (seen.has(run.targetId)) return false; seen.add(run.targetId); return true; }).map(publicRun) };
    }
    return { runs: [...sorted.filter(run => isActive(run.status)), ...sorted.filter(run => !isActive(run.status)).slice(0, 20)].map(publicRun) };
  }
  async notifications(cursor?: string): Promise<NotificationPage> {
    await this.init();
    if (this.storageFailed) throw new AutomationError('STORAGE_FAILED');
    const all = [...this.runs.values()].filter(run => run.notification)
      .sort((a, b) => b.notification!.createdAt.localeCompare(a.notification!.createdAt) || b.id.localeCompare(a.id));
    let start = 0;
    if (cursor !== undefined) {
      const index = all.findIndex(run => run.id === cursor);
      if (index < 0) throw new AutomationError('INVALID_INPUT');
      start = index + 1;
    }
    const selected = all.slice(start, start + 50);
    return { notifications: selected.map(run => this.publicNotification(run)),
      unreadCount: all.filter(run => run.notification!.readAt === null).length,
      nextCursor: start + selected.length < all.length ? selected.at(-1)!.id : null };
  }
  private publicNotification(run: StoredRun): AutomationNotification {
    return { id: run.id, kind: run.kind, name: run.name, status: run.status,
      createdAt: run.notification!.createdAt, readAt: run.notification!.readAt, ...(run.conversationId ? { conversationId: run.conversationId } : {}) };
  }
  readNotification(id: string) {
    return this.exclusive(async () => {
      await this.init();
      if (this.storageFailed) throw new AutomationError('STORAGE_FAILED');
      const run = this.runs.get(id);
      if (!run?.notification) throw new AutomationError('NOT_FOUND');
      if (run.notification.readAt === null) {
        const updated = { ...run, notification: { ...run.notification, readAt: new Date().toISOString() } };
        await this.store.saveRun(updated);
        run.notification = updated.notification;
      }
      return this.publicNotification(run);
    });
  }
  async get(id: string) {
    await this.init();
    if (this.storageFailed) throw new AutomationError('STORAGE_FAILED');
    const run = this.runs.get(id);
    if (!run) throw new AutomationError('NOT_FOUND');
    return publicRun(run);
  }
  start(id: unknown, input: unknown, useSavedInput = false) {
    return this.exclusive(async () => {
      await this.init();
      if (this.closing || this.storageFailed) throw new AutomationError('STORAGE_FAILED');
      if (typeof id !== 'string' || typeof input !== 'string' || input.length > 10000) throw new AutomationError('INVALID_INPUT');
      const duplicate = [...this.runs.values()].find(run => run.targetId === id && isActive(run.status));
      if (duplicate) return publicRun(duplicate);
      const workspace = await this.root();
      const item = (await this.prepared(workspace)).items.find(item => item.id === id);
      if (!item) throw new AutomationError('NOT_FOUND');
      if (!item.ready) throw new AutomationError('NOT_READY');
      if (useSavedInput) {
        if (item.kind !== 'skill' || input !== '') throw new AutomationError('INVALID_INPUT');
        input = (await this.store.skillSettings(item.id)).input;
      }
      const note = input as string;
      const source = await readFile(await checkedFile(workspace, item.file), 'utf8');
      const run: StoredRun = { id: randomUUID(), targetId: id, kind: item.kind, name: item.name, sourcePath: item.path,
        sourceHash: hash(source), status: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
        message: '실행 순서를 기다리고 있습니다.', result: null, artifacts: [], workspace, artifactDirectory: null };
      if (item.kind === 'skill') {
        const output = (await this.settings()).outputDirectory;
        run.outputRoot = await realpath(output).catch(() => output);
      }
      if (item.kind === 'skill') run.execution = (await this.store.skillSettings(item.id)).execution ?? { ...defaultExecution };
      if (item.adapter === 'skill') Object.assign(run, { conversationId: run.id, turn: 1,
        ...(run.execution?.provider === 'codex' ? {} : { sessionId: randomUUID() }), sessionReady: false, input: note.trim() });
      await this.persistRun(run);
      this.runs.set(run.id, run); this.queue.push({ run, item, input: note.trim() });
      this.kick();
      return publicRun(run);
    });
  }
  private conversationRuns(id: string) {
    const turns = [...this.runs.values()].filter(run => run.conversationId === id).sort((a, b) => a.turn! - b.turn!);
    if (!turns.length) throw new AutomationError('NOT_FOUND');
    return turns;
  }
  private async replyReason(turns: StoredRun[]) {
    const latest = turns.at(-1)!;
    if (!latest.sessionReady || !['succeeded', 'waiting_input'].includes(latest.status))
      return isActive(latest.status) ? '실행이 끝난 뒤 답변할 수 있습니다.' : '이어 실행할 수 없는 상태입니다. 기록을 확인한 뒤 새 작업을 시작해 주세요.';
    if ([...this.runs.values()].some(run => run.targetId === latest.targetId && isActive(run.status))) return '같은 스킬의 다른 실행이 진행 중입니다.';
    if (await this.root().catch(() => null) !== latest.workspace) return '작업 공간이 변경됐습니다. 기존 작업 공간으로 돌아가거나 새 작업을 시작해 주세요.';
    return null;
  }
  async conversation(id: string): Promise<SkillConversation> {
    await this.init();
    if (this.storageFailed) throw new AutomationError('STORAGE_FAILED');
    const turns = this.conversationRuns(id);
    const reason = await this.replyReason(turns);
    return { id, name: turns[0].name, canReply: reason === null, reason,
      turns: turns.map(run => ({ run: publicRun(run), input: run.input! })) };
  }
  reply(id: string, input: unknown, baseRunId: unknown, requestId: unknown) {
    return this.exclusive(async () => {
      await this.init();
      if (this.closing || this.storageFailed) throw new AutomationError('STORAGE_FAILED');
      if (typeof input !== 'string' || !input.trim() || input.length > 10000
        || typeof baseRunId !== 'string' || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) throw new AutomationError('INVALID_INPUT');
      const turns = this.conversationRuns(id);
      const duplicate = turns.find(run => run.requestId === requestId);
      if (duplicate) {
        if (duplicate.input !== input.trim() || duplicate.baseRunId !== baseRunId) throw new AutomationError('INVALID_INPUT');
        return publicRun(duplicate);
      }
      const previous = turns.at(-1)!;
      if (previous.id !== baseRunId) throw new AutomationError('STALE_TURN');
      if (await this.replyReason(turns)) throw new AutomationError('CONVERSATION_UNAVAILABLE');
      const run: StoredRun = { ...previous, id: randomUUID(), turn: previous.turn! + 1, input: input.trim(), requestId, baseRunId,
        notification: undefined, output: undefined, context: undefined, sessionReady: false, status: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
        result: null, artifacts: [], artifactDirectory: null, message: '답변을 받아 실행 순서를 기다리고 있습니다.' };
      const item = { id: run.targetId, name: run.name, kind: run.kind, description: '', path: run.sourcePath,
        file: join(run.workspace, run.sourcePath), adapter: 'skill' as const, ready: true, reason: null };
      await this.persistRun(run);
      this.runs.set(run.id, run); this.queue.push({ run, item, input: run.input!,
        ...(previous.context?.phase === 'needs_selection' ? { selectionCandidates: previous.context.candidates } : {}) }); this.kick();
      return publicRun(run);
    });
  }
  private kick() {
    if (this.worker || this.closing) return;
    this.worker = this.work().catch(() => { this.storageFailed = true; }).finally(() => {
      this.worker = null;
      if (this.queue.length && !this.storageFailed) this.kick();
    });
  }
  private async work() {
    while (!this.closing) {
      const task = await this.exclusive(async () => {
        let next = this.queue.shift();
        while (next && next.run.status !== 'queued') next = this.queue.shift();
        if (!next || this.closing) return null;
        const controller = new AbortController();
        this.active = { id: next.run.id, controller };
        next.run.status = 'running'; next.run.startedAt = new Date().toISOString(); next.run.message = '작업을 실행하고 있습니다.';
        await this.persistRun(next.run);
        return { ...next, controller };
      });
      if (!task) return;
      let result: RunResult | undefined;
      let error: AutomationError | undefined;
      try { result = await this.runner({ ...task, onContext: async context => {
        await this.exclusive(async () => {
          if (this.closing || task.controller.signal.aborted) return;
          task.run.context = context; task.run.message = context.message;
          await this.persistRun(task.run);
        });
      } }, task.controller.signal, this.store); }
      catch (caught) { error = caught instanceof AutomationError ? caught : new AutomationError('EXECUTION_FAILED'); }
      await this.exclusive(async () => {
        const run = { ...task.run };
        if (this.closing) { run.status = 'interrupted'; run.message = '서버 종료로 중단되었습니다. 생성된 파일을 확인해 주세요.'; }
        else if (task.controller.signal.aborted) { run.status = 'cancelled'; run.message = new AutomationError('CANCELLED').message; }
        else if (result) {
          run.status = result.status ?? 'succeeded'; run.message = result.message; run.result = result.result;
          if (result.context) run.context = result.context;
          run.artifacts = result.artifacts; run.artifactDirectory = result.artifactDirectory;
          if (run.kind === 'skill' && run.outputRoot && run.artifacts.length) run.output = await exportArtifacts(run, this.store);
          if (run.conversationId) {
            if (run.execution?.provider === 'codex' && run.turn === 1 && result.sessionId) run.sessionId = result.sessionId;
            run.sessionReady = !!result.sessionId && result.sessionId === run.sessionId;
          }
        } else { run.status = 'failed'; run.message = error?.message ?? new AutomationError('EXECUTION_FAILED').message; }
        run.finishedAt = new Date().toISOString();
        await this.persistRun(run); this.runs.set(run.id, run); this.active = null;
      });
    }
  }
  cancel(id: string) {
    return this.exclusive(async () => {
      await this.init();
      const run = this.runs.get(id);
      if (!run) throw new AutomationError('NOT_FOUND');
      if (run.status === 'queued') {
        run.status = 'cancelled'; run.finishedAt = new Date().toISOString(); run.message = '대기 중인 작업을 취소했습니다.';
        await this.persistRun(run);
      } else if (run.status === 'running') {
        run.status = 'cancelling'; run.message = '프로세스 종료를 기다리고 있습니다.';
        await this.persistRun(run); this.active?.controller.abort();
      }
      return publicRun(run);
    });
  }
  async artifact(id: string, name: string) {
    await this.get(id);
    const run = this.runs.get(id)!;
    if (!run.artifacts.includes(name) || !run.artifactDirectory) throw new AutomationError('NOT_FOUND');
    const root = run.kind === 'skill' ? this.store.runDirectory(id) : join(run.workspace, dirname(run.sourcePath), 'output');
    const resolved = await realpath(run.artifactDirectory).catch(() => { throw new AutomationError('PATH_DENIED'); });
    if (!inside(await realpath(root), resolved) || (run.kind === 'routine' && !inside(run.workspace, resolved))) throw new AutomationError('PATH_DENIED');
    return readFile(await checkedFile(resolved, join(resolved, name), 10 * 1024 * 1024));
  }
  retryOutput(id: string) {
    return this.exclusive(async () => {
      await this.get(id);
      const run = this.runs.get(id)!;
      if (run.kind !== 'skill' || isActive(run.status) || !run.outputRoot || !run.artifacts.length) throw new AutomationError('NOT_READY');
      run.output = await exportArtifacts(run, this.store);
      await this.persistRun(run);
      return publicRun(run);
    });
  }
  async close() {
    this.closing = true;
    if (!this.initialized) return;
    await this.exclusive(async () => {
      await this.init();
      for (const run of this.runs.values()) {
        if (run.status === 'queued') { run.status = 'interrupted'; run.finishedAt = new Date().toISOString(); run.message = '서버 종료로 대기가 중단되었습니다.'; await this.persistRun(run); }
      }
      this.active?.controller.abort();
    });
    await this.worker;
  }
}
