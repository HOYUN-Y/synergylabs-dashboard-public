import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { appDataDirectory, privateDirectory } from '../platform/storage.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import type { AutomationRun, SkillSettings } from '../../shared/automation.js';
import { runLabels } from '../../shared/automation.js';
import { AutomationError } from './errors.js';
import { executionShape } from './execution-options.js';
import { contextShape } from './skill-context.js';

export interface StoredRun extends AutomationRun {
  notification?: { createdAt: string; readAt: string | null };
  workspace: string;
  outputRoot?: string;
  artifactDirectory: string | null;
  sessionId?: string;
  sessionReady?: boolean;
  input?: string;
  requestId?: string;
  baseRunId?: string;
}
export const validArtifactName = (name: unknown): name is string => typeof name === 'string'
  && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(md|txt|html|css|js|json|svg|png|jpg|jpeg|pptx|pdf)$/.test(name);
export class AutomationStore {
  constructor(public directory = appDataDirectory()) {}
  runDirectory(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new AutomationError('NOT_FOUND');
    return join(this.directory, 'automation', 'runs', id);
  }
  private async write(file: string, content: string) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
      await rename(temp, file);
    } catch { throw new AutomationError('STORAGE_FAILED'); }
    finally { await unlink(temp).catch(() => {}); }
  }
  private async prepare(directory: string) {
    await privateDirectory(directory);
  }
  async settings(): Promise<{ workspace: string; outputDirectory?: string }> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'automation.json'), 'utf8'));
      if (typeof value.workspace !== 'string') throw new Error();
      if (value.outputDirectory !== undefined && typeof value.outputDirectory !== 'string') throw new Error();
      return { workspace: value.workspace, ...(value.outputDirectory !== undefined ? { outputDirectory: value.outputDirectory } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { workspace: '' };
      throw new AutomationError('STORAGE_FAILED');
    }
  }
  async saveSettings(workspace: string, outputDirectory = '') {
    await this.prepare(this.directory);
    await this.write(join(this.directory, 'automation.json'), JSON.stringify({ workspace, outputDirectory }));
    return { workspace, outputDirectory };
  }
  private skillFile(id: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) throw new AutomationError('INVALID_INPUT');
    return join(this.directory, 'automation', 'skills', `${id}.json`);
  }
  async skillSettings(id: string): Promise<SkillSettings> {
    const file = this.skillFile(id);
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (typeof value.input !== 'string' || value.input.length > 10000) throw new Error();
      if (value.execution !== undefined && !executionShape(value.execution)) throw new Error();
      return { input: value.input, ...(value.execution ? { execution: value.execution } : {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { input: '' };
      throw new AutomationError('STORAGE_FAILED');
    }
  }
  async saveSkillSettings(id: string, input: string, execution?: SkillSettings['execution']) {
    const file = this.skillFile(id);
    await this.prepare(join(this.directory, 'automation', 'skills'));
    const value = { input, ...(execution ? { execution } : {}) };
    await this.write(file, JSON.stringify(value));
    return value;
  }
  async saveRun(run: StoredRun) {
    await this.prepare(this.runDirectory(run.id));
    await this.write(join(this.runDirectory(run.id), 'run.json'), JSON.stringify(run));
  }
  async artifact(id: string, name: 'result.md', content: string) {
    await this.write(join(this.runDirectory(id), name), content);
  }
  async loadRuns(): Promise<StoredRun[]> {
    const directory = join(this.directory, 'automation', 'runs');
    let entries: Dirent[];
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new AutomationError('STORAGE_FAILED');
    }
    try {
      const result: StoredRun[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
        let text;
        try { text = await readFile(join(directory, entry.name, 'run.json'), 'utf8'); }
        catch (error) {
          // 첫 기록 저장 전 중단되어 빈 디렉터리만 남아도 다른 이력은 유지한다.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        const run = JSON.parse(text);
        if (run.id !== entry.name || !Object.hasOwn(runLabels, run.status) || !['skill', 'routine'].includes(run.kind)
          || !['targetId', 'name', 'sourcePath', 'sourceHash', 'createdAt', 'workspace', 'message'].every(key => typeof run[key] === 'string')
          || !Array.isArray(run.artifacts) || !run.artifacts.every(validArtifactName)
          || (run.result !== null && typeof run.result !== 'string') || (run.artifactDirectory !== null && typeof run.artifactDirectory !== 'string')) throw new Error();
        if (run.outputRoot !== undefined && typeof run.outputRoot !== 'string') throw new Error();
        if (run.context !== undefined && !contextShape(run.context)) throw new Error();
        if (run.output !== undefined && (!run.output || !['saved', 'failed'].includes(run.output.status) || typeof run.output.directory !== 'string' || typeof run.output.message !== 'string')) throw new Error();
        if (run.conversationId !== undefined && (run.kind !== 'skill'
          || !/^[a-f0-9-]{36}$/.test(run.conversationId)
          || (run.sessionId === undefined ? !(run.execution?.provider === 'codex' && run.turn === 1 && run.sessionReady === false) : !/^[a-f0-9-]{36}$/.test(run.sessionId))
          || !Number.isSafeInteger(run.turn) || run.turn < 1 || typeof run.input !== 'string' || run.input.length > 10000
          || typeof run.sessionReady !== 'boolean'
          || (run.turn > 1 && (!/^[a-f0-9-]{36}$/.test(run.requestId) || !/^[a-f0-9-]{36}$/.test(run.baseRunId))))) throw new Error();
        if (run.notification !== undefined && (!run.notification || typeof run.notification !== 'object'
          || typeof run.notification.createdAt !== 'string' || !Number.isFinite(Date.parse(run.notification.createdAt))
          || (run.notification.readAt !== null && (typeof run.notification.readAt !== 'string' || !Number.isFinite(Date.parse(run.notification.readAt)))))) throw new Error();
        if (run.execution !== undefined && !executionShape(run.execution)) throw new Error();
        result.push(run);
      }
      return result;
    } catch { throw new AutomationError('STORAGE_FAILED'); }
  }
}
