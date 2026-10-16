import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { appDataDirectory, privateDirectory } from '../platform/storage.js';
import { join } from 'node:path';
import { keychainCredentials } from '../mail/store.js';
import type { Credentials } from '../mail/store.js';

export class YouTubeAuthError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export interface YouTubeClient { clientId: string; clientSecret: string }
export interface YouTubeCredential extends YouTubeClient { refreshToken: string }
interface Connection { credentialId: string; obsoleteIds: string[] }
export class YouTubeAuthStore {
  private file: string;
  constructor(private directory = appDataDirectory(),
    private credentials: Credentials = keychainCredentials('kr.synergylabs.dashboard.youtube')) {
    this.file = join(directory, 'youtube-auth.json');
  }
  async connection(): Promise<Connection | null> {
    try {
      const v = JSON.parse(await readFile(this.file, 'utf8'));
      const id = (s: unknown) => typeof s === 'string' && /^[a-f0-9-]{36}$/.test(s);
      if (!id(v.credentialId) || !Array.isArray(v.obsoleteIds) || !v.obsoleteIds.every(id)) throw new Error();
      return { credentialId: v.credentialId, obsoleteIds: v.obsoleteIds };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new YouTubeAuthError('STORAGE_FAILED');
    }
  }
  async read(): Promise<(YouTubeCredential & { credentialId: string }) | null> {
    const connection = await this.connection();
    if (!connection) return null;
    try {
      const raw = await this.credentials.get(connection.credentialId);
      if (!raw) throw new Error();
      const v = JSON.parse(raw);
      if (!['clientId', 'clientSecret', 'refreshToken'].every(key => typeof v[key] === 'string' && v[key])) throw new Error();
      return { credentialId: connection.credentialId, clientId: v.clientId, clientSecret: v.clientSecret, refreshToken: v.refreshToken };
    } catch { throw new YouTubeAuthError('KEYCHAIN_FAILED'); }
  }
  private async write(value: Connection) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await privateDirectory(this.directory);
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, this.file);
    } catch { throw new YouTubeAuthError('STORAGE_FAILED'); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async connect(value: YouTubeCredential) {
    const old = await this.connection();
    const credentialId = randomUUID();
    try { await this.credentials.set(credentialId, JSON.stringify(value)); }
    catch { throw new YouTubeAuthError('KEYCHAIN_FAILED'); }
    const next = { credentialId, obsoleteIds: old ? [...old.obsoleteIds, old.credentialId] : [] };
    try { await this.write(next); }
    catch (e) { await this.credentials.delete(credentialId).catch(() => {}); throw e; }
    const remaining: string[] = [];
    for (const id of next.obsoleteIds) {
      try { await this.credentials.delete(id); } catch { remaining.push(id); }
    }
    if (remaining.length !== next.obsoleteIds.length) await this.write({ credentialId, obsoleteIds: remaining }).catch(() => {});
  }
  async rotate(credentialId: string, refreshToken: string) {
    const current = await this.read();
    if (!current || current.credentialId !== credentialId) throw new YouTubeAuthError('CONFIG_CHANGED');
    try { await this.credentials.set(credentialId, JSON.stringify({ clientId: current.clientId, clientSecret: current.clientSecret, refreshToken })); }
    catch { throw new YouTubeAuthError('KEYCHAIN_FAILED'); }
  }
  async disconnect() {
    const old = await this.connection();
    if (!old) return;
    try {
      for (const id of [...old.obsoleteIds, old.credentialId]) await this.credentials.delete(id);
      await unlink(this.file);
    } catch { throw new YouTubeAuthError('STORAGE_FAILED'); }
  }
}
