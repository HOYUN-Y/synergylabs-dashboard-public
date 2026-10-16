import { AsyncEntry } from '@napi-rs/keyring';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MailInput, MailSettings, MailSettingsResponse } from '../../shared/api.js';
import { MailError } from './errors.js';
import { parseAccount, parseSettings } from './validation.js';

export interface Credentials {
  get(id: string): Promise<string | null>;
  set(id: string, password: string): Promise<void>;
  delete(id: string): Promise<void>;
}
export function keychainCredentials(service = 'kr.synergylabs.dashboard.imap'): Credentials {
  const entry = (id: string) => new AsyncEntry(service, id);
  return {
    get: id => entry(id).getPassword(),
    set: (id, password) => entry(id).setPassword(password),
    delete: async id => { await entry(id).deleteCredential(); }
  };
}
type StoredSettings = { settings: MailSettings; credentialId: string; obsoleteIds: string[] }
  | { provider: 'gws'; account: string; obsoleteIds: string[] };

export class MailStore {
  private file: string;
  constructor(
    private directory = join(homedir(), 'Library', 'Application Support', 'SynergyLabs Dashboard'),
    private credentials = keychainCredentials()
  ) { this.file = join(directory, 'mail.json'); }

  private async read(): Promise<StoredSettings | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
      if (!Array.isArray(value.obsoleteIds) || !value.obsoleteIds.every(validId)) throw new Error();
      if (value.provider === 'gws') return { provider: 'gws', account: parseAccount(value.account), obsoleteIds: value.obsoleteIds };
      if ((value.provider !== undefined && value.provider !== 'imap') || !validId(value.credentialId)) throw new Error();
      return { settings: parseSettings(value.settings), credentialId: value.credentialId, obsoleteIds: value.obsoleteIds };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new MailError('STORAGE_FAILED');
    }
  }
  private async write(value: StoredSettings) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
    } catch { throw new MailError('STORAGE_FAILED'); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async settings(): Promise<MailSettingsResponse> {
    const stored = await this.read();
    return { settings: stored && 'settings' in stored ? stored.settings : null,
      provider: stored ? ('account' in stored ? 'gws' : 'imap') : null,
      ...(stored && 'account' in stored ? { account: stored.account } : {}),
      cleanupPending: !!stored?.obsoleteIds.length };
  }
  async input(): Promise<MailInput> {
    const stored = await this.read();
    if (!stored || !('settings' in stored)) throw new MailError('NOT_CONFIGURED');
    let password: string | null;
    try { password = await this.credentials.get(stored.credentialId); }
    catch { throw new MailError('KEYCHAIN_FAILED'); }
    if (!password) throw new MailError('KEYCHAIN_FAILED');
    return { ...stored.settings, password };
  }
  async save(input: MailInput): Promise<MailSettingsResponse> {
    const previous = await this.read();
    const credentialId = randomUUID();
    try { await this.credentials.set(credentialId, input.password); }
    catch { throw new MailError('KEYCHAIN_FAILED'); }
    const stored: StoredSettings = {
      settings: parseSettings(input), credentialId,
      obsoleteIds: previous ? [...previous.obsoleteIds, ...('credentialId' in previous ? [previous.credentialId] : [])] : []
    };
    try { await this.write(stored); }
    catch (error) {
      try { await this.credentials.delete(credentialId); }
      catch { throw new MailError('KEYCHAIN_FAILED'); }
      throw error;
    }
    return this.cleanup(stored);
  }
  async saveGws(account: string): Promise<MailSettingsResponse> {
    const previous = await this.read();
    const stored: StoredSettings = { provider: 'gws', account: parseAccount(account),
      obsoleteIds: previous ? [...previous.obsoleteIds, ...('credentialId' in previous ? [previous.credentialId] : [])] : [] };
    await this.write(stored);
    return this.cleanup(stored);
  }
  private async cleanup(stored: StoredSettings) {
    const remaining: string[] = [];
    for (const id of stored.obsoleteIds) {
      try { await this.credentials.delete(id); } catch { remaining.push(id); }
    }
    if (remaining.length !== stored.obsoleteIds.length) {
      // 삭제 실패한 이전 항목은 다음 저장·해제 시 다시 정리할 수 있도록 ID를 보존한다.
      await this.write({ ...stored, obsoleteIds: remaining }).catch(() => {});
    }
    return this.settings();
  }
  async disconnect() {
    const stored = await this.read();
    if (!stored) return;
    // 현재 비밀번호는 마지막에 삭제해 이전 항목 정리 실패 시 기존 연결을 유지한다.
    for (const id of [...stored.obsoleteIds, ...('credentialId' in stored ? [stored.credentialId] : [])]) {
      try { await this.credentials.delete(id); } catch { throw new MailError('KEYCHAIN_FAILED'); }
    }
    try { await unlink(this.file); } catch { throw new MailError('STORAGE_FAILED'); }
  }
}
