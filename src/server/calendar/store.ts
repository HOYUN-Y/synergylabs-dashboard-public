import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { appDataDirectory, privateDirectory } from '../platform/storage.js';
import { join } from 'node:path';
import { keychainCredentials } from '../mail/store.js';
import type { Credentials } from '../mail/store.js';
import type { CalendarChoice } from '../../shared/calendar.js';
import { CalendarError } from './errors.js';
export interface CalendarConnection { credentialId: string; clientId: string; selected: CalendarChoice | null; obsoleteIds: string[] }
export class CalendarStore {
  private file: string;
  constructor(private directory = appDataDirectory(),
    private credentials: Credentials = keychainCredentials('kr.synergylabs.dashboard.calendar')) {
    this.file = join(directory, 'calendar.json');
  }
  async read(): Promise<CalendarConnection | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      const id = (v: unknown) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
      if (!id(value.credentialId) || typeof value.clientId !== 'string' || !Array.isArray(value.obsoleteIds)
        || !value.obsoleteIds.every(id) || (value.selected !== null && (typeof value.selected?.id !== 'string' || typeof value.selected?.name !== 'string'))) throw new Error();
      return value;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new CalendarError('STORAGE_FAILED');
    }
  }
  private async write(value: CalendarConnection) {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await privateDirectory(this.directory);
      await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
    } catch { throw new CalendarError('STORAGE_FAILED'); }
    finally { await unlink(temp).catch(() => {}); }
  }
  async refreshToken(connection: CalendarConnection) {
    try {
      const token = await this.credentials.get(connection.credentialId);
      if (!token) throw new Error();
      return token;
    } catch { throw new CalendarError('KEYCHAIN_FAILED'); }
  }
  async connect(clientId: string, refreshToken: string) {
    const old = await this.read();
    const credentialId = randomUUID();
    try { await this.credentials.set(credentialId, refreshToken); }
    catch { throw new CalendarError('KEYCHAIN_FAILED'); }
    const next: CalendarConnection = { clientId, credentialId, selected: null, obsoleteIds: old ? [...old.obsoleteIds, old.credentialId] : [] };
    try { await this.write(next); }
    catch (e) {
      try { await this.credentials.delete(credentialId); } catch { throw new CalendarError('KEYCHAIN_FAILED'); }
      throw e;
    }
    const remaining: string[] = [];
    for (const id of next.obsoleteIds) {
      try { await this.credentials.delete(id); } catch { remaining.push(id); }
    }
    if (remaining.length !== next.obsoleteIds.length) await this.write({ ...next, obsoleteIds: remaining }).catch(() => {});
  }
  async select(selected: CalendarChoice) {
    const old = await this.read();
    if (!old) throw new CalendarError('NOT_CONNECTED');
    await this.write({ ...old, selected });
  }
  async disconnect() {
    const old = await this.read();
    if (!old) return;
    try {
      for (const id of [...old.obsoleteIds, old.credentialId]) await this.credentials.delete(id);
    } catch { throw new CalendarError('KEYCHAIN_FAILED'); }
    try { await unlink(this.file); } catch { throw new CalendarError('STORAGE_FAILED'); }
  }
}
