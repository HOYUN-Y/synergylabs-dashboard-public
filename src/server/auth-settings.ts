import { closeSync, fstatSync, readSync } from 'node:fs';
import { openRegularSync } from './platform/storage.js';
import { basename, isAbsolute, join } from 'node:path';
import { envDirectory } from './local-env.js';
import type { AuthClientStatus } from '../shared/auth-settings.js';

export interface GoogleClient { clientId: string; clientSecret: string }
export interface ResolvedAuthClient { client: GoogleClient | null; status: AuthClientStatus }
const messages = {
  NOT_CONFIGURED: 'env/auth-settings.json 또는 기존 Google 클라이언트 환경변수를 설정해 주세요.',
  AUTH_SETTINGS_INVALID: 'env/auth-settings.json의 형식·버전·파일명·접근 권한을 확인해 주세요.',
  AUTH_CLIENT_INVALID: '선택한 OAuth JSON의 존재·권한·크기와 데스크톱 클라이언트 형식을 확인해 주세요.'
};
export class AuthSettingsError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); }
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
};
// 제한 크기만 읽어, stat 이후 커진 파일도 메모리에 전부 읽지 않는다.
function readJson(file: string): unknown {
  const fd = openRegularSync(file);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error();
    const buffer = Buffer.alloc(65537); let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > 65536) throw new Error();
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally { closeSync(fd); }
}
export function readGoogleClient(file: string): GoogleClient {
  try {
    if (!isAbsolute(file)) throw new Error();
    const value = record(record(readJson(file)).installed);
    if (typeof value.client_id !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(value.client_id)
      || typeof value.client_secret !== 'string' || !value.client_secret.trim()) throw new Error();
    return { clientId: value.client_id, clientSecret: value.client_secret };
  } catch { throw new AuthSettingsError('AUTH_CLIENT_INVALID'); }
}
function settings(directory: string): Record<string, unknown> {
  let raw: unknown;
  try { raw = readJson(join(directory, 'auth-settings.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new AuthSettingsError('AUTH_SETTINGS_INVALID');
  }
  try {
    const value = record(raw);
    if (value.version !== 1) throw new Error();
    for (const key of ['googleClientFile', 'youtubeClientFile']) {
      const name = value[key];
      if (name !== undefined && name !== null && (typeof name !== 'string' || !name.endsWith('.json')
        || /[\\/:]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || name.includes('..') || name === 'auth-settings.json')) throw new Error();
    }
    return value;
  } catch { throw new AuthSettingsError('AUTH_SETTINGS_INVALID'); }
}
export function describeClient(client: GoogleClient | null): ResolvedAuthClient {
  return { client, status: { source: client ? 'environment' : 'none', fileName: null,
    clientIdHint: client ? client.clientId.replace(/\.apps\.googleusercontent\.com$/, '').slice(-6) : null,
    validation: client ? 'valid' : 'missing', error: client ? null : 'NOT_CONFIGURED',
    message: client ? '클라이언트 설정을 확인했습니다. 실제 로그인 상태와는 별개입니다.' : messages.NOT_CONFIGURED } };
}
export function resolveAuthClient(service: 'google' | 'youtube', options: {
  directory?: string; environment?: NodeJS.ProcessEnv; clientFile?: string
} = {}): ResolvedAuthClient {
  const directory = options.directory ?? envDirectory, environment = options.environment ?? process.env;
  let source: AuthClientStatus['source'] = 'settings_file', fileName: string | null = null;
  try {
    let file: string | undefined;
    if (service === 'youtube' && options.clientFile !== undefined) { source = 'cli'; file = options.clientFile; }
    else {
      const selected = settings(directory)[service === 'google' ? 'googleClientFile' : 'youtubeClientFile'];
      if (typeof selected === 'string') file = join(directory, selected);
      else if (service === 'youtube') { source = 'legacy_file'; file = join(directory, 'client_secret_youtube-collector.json'); }
      else {
        const clientId = environment.GOOGLE_CLIENT_ID?.trim(), clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
        return describeClient(clientId && clientSecret ? { clientId, clientSecret } : null);
      }
    }
    fileName = basename(file);
    const result = describeClient(readGoogleClient(file));
    return { ...result, status: { ...result.status, source, fileName } };
  } catch (error) {
    const known = error instanceof AuthSettingsError ? error : new AuthSettingsError('AUTH_CLIENT_INVALID');
    return { client: null, status: { source, fileName, clientIdHint: null, validation: 'invalid', error: known.code, message: known.message } };
  }
}
export function requireAuthClient(result: ResolvedAuthClient): GoogleClient {
  if (!result.client) throw new AuthSettingsError(result.status.error ?? 'NOT_CONFIGURED');
  return result.client;
}
