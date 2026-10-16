import { execFile } from 'node:child_process';
import type { ExecutionOptions, ExecutionSettings } from '../../shared/automation.js';
import { claudeReadiness, cliExecutable, localProcessEnvironment } from './catalog.js';
import { AutomationError } from './errors.js';

const claudeModels = ['default', 'opus', 'sonnet', 'haiku', 'fable'].map(id => ({ id,
  name: id === 'default' ? '기본 모델' : id[0].toUpperCase() + id.slice(1),
  efforts: ['default', 'low', 'medium', 'high', 'xhigh', 'max'] }));
export function executionShape(value: unknown): value is ExecutionSettings {
  const v = value as ExecutionSettings | null;
  return !!v && ['claude', 'codex'].includes(v.provider) && typeof v.model === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(v.model)
    && ['default', 'minimal', 'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(v.effort);
}
function inspect(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => execFile(command, args, {
    env: localProcessEnvironment(), timeout: 5000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8'
  }, (error, stdout) => error ? reject(new AutomationError('NOT_READY')) : resolve(stdout)));
}
export function codexModels(text: string): ExecutionOptions['providers'][number]['models'] {
  const data = JSON.parse(text);
  const values = Array.isArray(data) ? data : data.models;
  if (!Array.isArray(values)) throw new AutomationError('INVALID_RESULT');
  const result = values.filter(m => m.visibility === 'list' && typeof m.slug === 'string'
    && executionShape({ provider: 'codex', model: m.slug, effort: 'default' }))
    .map(m => ({ id: m.slug as string, name: typeof m.display_name === 'string' ? m.display_name.slice(0,100) : m.slug,
      efforts: ['default', ...new Set<string>((Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        .map((v: { effort?: unknown }) => v.effort).filter((effort: unknown): effort is string => typeof effort === 'string'
          && executionShape({ provider: 'codex', model: m.slug, effort })))] }));
  if (!result.length || result.length > 100) throw new AutomationError('INVALID_RESULT');
  return result;
}
let cached: { until: number; promise: Promise<ExecutionOptions> } | undefined;
export function executionOptions(): Promise<ExecutionOptions> {
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = (async () => {
    const claudeStatus = claudeReadiness();
    const command = await cliExecutable('codex');
    let reason: string | null = command ? null : 'Codex CLI 설치와 실행 권한을 확인해 주세요.';
    let models: ExecutionOptions['providers'][number]['models'] = [];
    if (command) {
      const checks = await Promise.allSettled([
        inspect(command, ['login', 'status']),
        inspect(command, ['debug', 'models']).then(codexModels)
          .catch(() => inspect(command, ['debug', 'models', '--bundled']).then(codexModels))
      ]);
      if (checks[0].status === 'rejected') reason = 'Codex CLI 로그인이 필요합니다. 터미널에서 codex login 후 다시 확인해 주세요.';
      if (checks[1].status === 'fulfilled') models = checks[1].value;
      else reason = 'Codex 모델 목록을 확인하지 못했습니다. CLI 버전을 확인해 주세요.';
    }
    const claudeReason = await claudeStatus;
    return { providers: [{ id: 'claude' as const, ready: claudeReason === null, reason: claudeReason, models: claudeModels },
      { id: 'codex' as const, ready: reason === null, reason, models }] };
  })();
  cached = { until: Date.now() + 15000, promise };
  return promise;
}
export async function validateExecution(value: unknown, options: () => Promise<ExecutionOptions>) {
  if (!executionShape(value)) throw new AutomationError('INVALID_INPUT');
  const model = (await options()).providers.find(p => p.id === value.provider)?.models.find(m => m.id === value.model);
  if (!model || !model.efforts.includes(value.effort)) throw new AutomationError('INVALID_INPUT');
  return { provider: value.provider, model: value.model, effort: value.effort };
}
