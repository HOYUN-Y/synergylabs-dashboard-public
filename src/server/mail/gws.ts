import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { envDirectory } from '../local-env.js';
import type { MailMessage } from '../../shared/api.js';
import { MailError } from './errors.js';
import { parseAccount } from './validation.js';

export type GwsRunner = (args: string[], signal: AbortSignal) => Promise<unknown>;
/** 대시보드 전용 gws 로그인 폴더(npm run auth:gmail이 env의 Google 클라이언트로 만든다). 개인 gws 설정(~/.config/gws)과 섞지 않는다. */
export const gwsConfigDir = join(envDirectory, 'gws');
/** 전용 로그인 폴더가 있으면 gws가 그 폴더를 쓰게 하고, 없으면 gws 기본 설정을 그대로 쓴다. */
export const gwsEnvironment = (configDir = gwsConfigDir): NodeJS.ProcessEnv =>
  existsSync(configDir) ? { ...process.env, GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir } : process.env;
export function gwsFailure(output: string, code: unknown): MailError {
  let value;
  try { value = JSON.parse(output); } catch { /* 원본 출력은 노출하지 않는다. */ }
  const error = value?.error;
  const reason = error?.reason ?? error?.errors?.[0]?.reason;
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return new MailError('GWS_API_DISABLED');
  if (code === 2 || error?.code === 401) return new MailError('GWS_AUTH_REQUIRED');
  if (error?.code === 403) return new MailError('GWS_PERMISSION');
  return new MailError('GWS_FAILED');
}
export function runGws(args: string[], signal: AbortSignal, executable = 'gws'): Promise<unknown> {
  return new Promise((resolve, reject) => {
  execFile(executable, args, { shell: false, signal, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8', env: gwsEnvironment() }, (error, stdout) => {
    if (error) {
      const code = (error as NodeJS.ErrnoException).code;
      reject(code === 'ENOENT' ? new MailError('GWS_NOT_FOUND') : gwsFailure(stdout, code));
      return;
    }
    try { resolve(JSON.parse(stdout)); } catch { reject(new MailError('GWS_RESPONSE')); }
  });
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MailError('GWS_RESPONSE');
  return value as Record<string, unknown>;
}

export async function queryGws(expectedAccount?: string, list = false, signal?: AbortSignal,
  runner: GwsRunner = runGws, timeoutMs = 20000): Promise<{ account: string; messages: MailMessage[] }> {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let rejectAbort!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort(new MailError(signal?.aborted ? 'CONFIG_CHANGED' : 'TIMEOUT'));
  combined.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const call = async (method: string[], params: object) => {
    if (combined.aborted) throw new MailError(signal?.aborted ? 'CONFIG_CHANGED' : 'TIMEOUT');
    return object(await runner(['gmail', 'users', ...method, '--params', JSON.stringify(params)], combined));
  };
  const work = async () => {
    const profile = await call(['getProfile'], { userId: 'me' });
    let account: string;
    try { account = parseAccount(profile.emailAddress); } catch { throw new MailError('GWS_RESPONSE'); }
    if (expectedAccount && account !== expectedAccount.toLowerCase()) throw new MailError('ACCOUNT_CHANGED');
    // 연결 테스트도 목록 권한을 확인하되 메일 내용은 조회하지 않는다.
    const response = await call(['messages', 'list'], { userId: account, labelIds: ['INBOX'], maxResults: list ? 20 : 1, includeSpamTrash: false });
    if (response.messages !== undefined && !Array.isArray(response.messages)) throw new MailError('GWS_RESPONSE');
    const ids = [...new Set(((response.messages ?? []) as unknown[]).map(item => {
      const id = object(item).id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(id)) throw new MailError('GWS_RESPONSE');
      return id;
    }))].slice(0, 20);
    if (!list) return { account, messages: [] };
    const messages: MailMessage[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++];
        const item = await call(['messages', 'get'], { userId: account, id, format: 'metadata', metadataHeaders: ['Subject', 'From'] });
        if (item.id !== id || !Array.isArray(item.labelIds) || !item.labelIds.every(label => typeof label === 'string')) throw new MailError('GWS_RESPONSE');
        const payload = object(item.payload);
        if (payload.headers !== undefined && !Array.isArray(payload.headers)) throw new MailError('GWS_RESPONSE');
        const headers = ((payload.headers ?? []) as unknown[]).map(object);
        const header = (name: string, fallback: string) => {
          const value = headers.find(h => typeof h.name === 'string' && h.name.toLowerCase() === name)?.value;
          if (value !== undefined && typeof value !== 'string') throw new MailError('GWS_RESPONSE');
          return typeof value === 'string' && value.trim() ? value : fallback;
        };
        const timestamp = typeof item.internalDate === 'string' && /^\d+$/.test(item.internalDate) ? Number(item.internalDate) : NaN;
        const date = new Date(timestamp);
        messages.push({ id, subject: header('subject', '(제목 없음)'), from: header('from', '(발신자 없음)'),
          receivedAt: Number.isFinite(date.getTime()) ? date.toISOString() : null, seen: !item.labelIds.includes('UNREAD') });
      }
    }));
    messages.sort((a, b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '') || a.id.localeCompare(b.id));
    return { account, messages };
  };
  try { return await Promise.race([work(), failed]); }
  finally { clearTimeout(timer); combined.removeEventListener('abort', abort); controller.abort(); }
}
