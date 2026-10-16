import { promisify } from 'node:util';
import { spawn, execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CollectionError, CollectionStore, due, recoverState, nextRetry } from './collection-store.js';
import type { CollectionAttempt, CollectionStatus, MetricService } from '../../shared/metrics-collection.js';
import { METRIC_SERVICES } from '../../shared/metrics-collection.js';

export const scheduleLabel = 'kr.synergylabs.dashboard.metrics';
export const scheduleFile = () => join(homedir(), 'Library', 'LaunchAgents', `${scheduleLabel}.plist`);
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const permittedEnvironment = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL', 'GHOST_ADMIN_API_URL', 'GHOST_ADMIN_API_KEY', 'GHOST_METRICS_DIR', 'YOUTUBE_DATA_API_KEY', 'YOUTUBE_METRICS_DIR'];
export class MetricsCollection {
  constructor(public store = new CollectionStore(), private env: NodeJS.ProcessEnv = process.env, private timeout = 300000) {}
  available(service: MetricService) {
    return !!(service === 'ghost' ? this.env.GHOST_ADMIN_API_URL && this.env.GHOST_ADMIN_API_KEY && isAbsolute(this.env.GHOST_METRICS_DIR ?? '')
      : this.env.YOUTUBE_DATA_API_KEY && isAbsolute(this.env.YOUTUBE_METRICS_DIR ?? ''));
  }
  async status(now = new Date()): Promise<CollectionStatus> {
    let registered = false;
    try { await access(scheduleFile()); await promisify(execFile)('/bin/launchctl', ['print', `gui/${process.getuid!()}/${scheduleLabel}`], { timeout: 2000, maxBuffer: 65536 }); registered = true; } catch { /* 미등록 */ }
    const entries = await Promise.all(METRIC_SERVICES.map(async service => {
      const state = recoverState(await this.store.read(service));
      return [service, { ...state, available: this.available(service), nextRetryAt: registered ? nextRetry(state, now) : null }] as const;
    }));
    return { schedule: { registered, hour: 9, timeZone: 'Asia/Seoul' }, services: Object.fromEntries(entries) as CollectionStatus['services'] };
  }
  async start(service: MetricService, trigger: CollectionAttempt['trigger'] = 'manual', outputDirectory?: string): Promise<{ id: string; done: Promise<CollectionAttempt> }> {
    if (trigger === 'manual' && !this.available(service) && !outputDirectory) throw new CollectionError('NOT_CONFIGURED');
    await this.store.prepare();
    const id = randomUUID();
    const environment = Object.fromEntries(permittedEnvironment.flatMap(key => this.env[key] === undefined ? [] : [[key, this.env[key]!]]));
    if (outputDirectory) environment[service === 'ghost' ? 'GHOST_METRICS_DIR' : 'YOUTUBE_METRICS_DIR'] = outputDirectory;
    const child = spawn('/usr/bin/lockf', ['-k', '-t', '0', join(this.store.directory, `${service}.lock`), process.execPath,
      '--import', 'tsx', join(repositoryRoot, 'scripts/metrics-worker.ts'), service, trigger, id, this.store.directory, String(this.timeout)],
    { cwd: repositoryRoot, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let accept!: () => void, rejectStart!: (e: unknown) => void;
    const started = new Promise<void>((resolve, reject) => { accept = resolve; rejectStart = reject; });
    let resolveDone!: (a: CollectionAttempt) => void, rejectDone!: (e: unknown) => void;
    const done = new Promise<CollectionAttempt>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    void done.catch(() => {});
    let ready = false, timedOut = false, output = '', bytes = 0;
    const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* 이미 종료됨 */ } };
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { timedOut = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 3000); }, this.timeout + 3000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16384) { kill('SIGTERM'); return; }
      output += chunk.toString('utf8');
      if (!ready && output.includes('\n')) {
        try { if (JSON.parse(output.split('\n')[0]).started === id) { ready = true; accept(); } } catch { kill('SIGTERM'); }
      }
    });
    child.stderr.on('data', () => { /* 원문 오류·환경값을 기록하지 않는다. */ });
    child.on('error', () => { rejectStart(new CollectionError('EXECUTION_FAILED')); });
    child.on('close', async code => {
      if (timedOut) kill('SIGKILL');
      clearTimeout(timer); clearTimeout(killTimer);
      try {
        if (!ready) throw new CollectionError(code === 75 ? 'BUSY' : timedOut ? 'TIMEOUT' : 'EXECUTION_FAILED');
        const finished = output.trim().split('\n').slice(1).map(line => { try { return JSON.parse(line) as { finished?: CollectionAttempt }; } catch { return {}; } }).find(v => v.finished?.id === id)?.finished;
        if (finished && ['succeeded', 'partial', 'failed'].includes(finished.status)) { if (finished.errorCode === 'TIMEOUT') kill('SIGKILL'); resolveDone(finished); return; }
        const state = await this.store.read(service);
        if (state.lastAttempt?.id !== id) throw new CollectionError('EXECUTION_FAILED');
        if (state.lastAttempt.status === 'running') {
          state.lastAttempt = { ...state.lastAttempt, status: 'failed', finishedAt: new Date().toISOString(), errorCode: timedOut ? 'TIMEOUT' : 'INTERRUPTED', retryable: true };
        }
        resolveDone(state.lastAttempt);
      } catch (e) { rejectStart(e); rejectDone(e); }
    });
    await started;
    return { id, done };
  }
  async scheduled(now = new Date()) {
    const outcomes: CollectionAttempt[] = [];
    for (const service of METRIC_SERVICES) {
      try {
        const state = recoverState(await this.store.read(service));
        if (!due(state, now)) continue;
        outcomes.push(await (await this.start(service, 'scheduled')).done);
      } catch (e) {
        if (e instanceof CollectionError && e.code === 'BUSY') continue;
        // 잠금을 얻기 전의 실패는 다른 실행의 상태를 덮어쓰지 않는다.
        outcomes.push({ id: randomUUID(), service, trigger: 'scheduled', status: 'failed', startedAt: now.toISOString(), finishedAt: new Date().toISOString(), errorCode: e instanceof CollectionError ? e.code : 'EXECUTION_FAILED', retryable: false, snapshotSaved: false, pid: process.pid });
      }
    }
    return outcomes;
  }
}
