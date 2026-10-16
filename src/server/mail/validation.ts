import type { MailInput, MailSettings, MailConnectionInput } from '../../shared/api.js';
import { MailError } from './errors.js';

export function parseSettings(value: unknown): MailSettings {
  if (!value || typeof value !== 'object') throw new MailError('INVALID_INPUT');
  const v = value as Record<string, unknown>;
  const validText = (s: unknown, max: number): s is string =>
    typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\r\n\0]/.test(s);
  if (!validText(v.host, 253) || !/^[a-zA-Z0-9.-]+$/.test(v.host)
    || typeof v.port !== 'number' || !Number.isInteger(v.port) || v.port < 1 || v.port > 65535
    || (v.security !== 'tls' && v.security !== 'starttls')
    || !validText(v.username, 320) || !validText(v.mailbox, 1024)) throw new MailError('INVALID_INPUT');
  return { host: v.host.toLowerCase(), port: v.port, security: v.security, username: v.username.trim(), mailbox: v.mailbox.trim() };
}
export function parseInput(value: unknown): MailInput {
  const settings = parseSettings(value);
  const password = (value as Record<string, unknown>).password;
  if (typeof password !== 'string' || !password.length || password.length > 4096 || /[\r\n\0]/.test(password)) throw new MailError('INVALID_INPUT');
  return { ...settings, password };
}

export function parseAccount(value: unknown): string {
  if (typeof value !== 'string' || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /[\0\r\n]/.test(value)) throw new MailError('INVALID_INPUT');
  return value.toLowerCase();
}
export function parseConnection(value: unknown): MailConnectionInput {
  if (value && typeof value === 'object' && 'provider' in value) {
    if (value.provider === 'gws') {
      const account = 'account' in value ? parseAccount(value.account) : undefined;
      return { provider: 'gws', ...(account ? { account } : {}) };
    }
    if (value.provider !== 'imap') throw new MailError('INVALID_INPUT');
  }
  return parseInput(value);
}
