import { resolveAuthClient } from '../auth-settings.js';
import type { MailConnectionInput, MailMessagesResponse, MailTestResponse } from '../../shared/api.js';
import { MailStore } from './store.js';
import { queryMail } from './imap.js';
import { queryGws } from './gws.js';
import { MailError } from './errors.js';

export class MailService {
  private pending: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private flight?: Promise<MailMessagesResponse>;
  private controller?: AbortController;
  constructor(private store = new MailStore(), private query = queryMail, private gmail = queryGws,
    private clientConfig = () => resolveAuthClient('google').status) {}

  async settings() { await this.pending; return { ...await this.store.settings(), gmailClientConfig: this.clientConfig() }; }
  async test(input: MailConnectionInput): Promise<MailTestResponse> {
    if ('provider' in input) {
      const result = await this.gmail(input.account);
      return { ok: true, account: result.account };
    }
    await this.query(input, false); return { ok: true };
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.generation++;
    this.controller?.abort();
    this.flight = undefined;
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }
  save(input: MailConnectionInput) {
    return this.mutate(async () => {
      if ('provider' in input && !input.account) throw new MailError('INVALID_INPUT');
      await this.test(input);
      return 'provider' in input ? this.store.saveGws(input.account!) : this.store.save(input);
    });
  }
  close() { this.controller?.abort(); }
  disconnect() { return this.mutate(() => this.store.disconnect()); }
  async messages(): Promise<MailMessagesResponse> {
    const version = this.generation;
    await this.pending;
    if (version !== this.generation) throw new MailError('CONFIG_CHANGED');
    if (this.flight) return this.flight;
    const controller = new AbortController();
    this.controller = controller;
    const work = async () => {
      const settings = await this.store.settings();
      if (version !== this.generation) throw new MailError('CONFIG_CHANGED');
      const messages = settings.provider === 'gws'
        ? (await this.gmail(settings.account, true, controller.signal)).messages
        : await this.query(await this.store.input(), true, controller.signal);
      if (version !== this.generation) throw new MailError('CONFIG_CHANGED');
      return { messages, fetchedAt: new Date().toISOString() };
    };
    const flight = work().finally(() => { if (this.flight === flight) this.flight = undefined; });
    this.flight = flight;
    return flight;
  }
}
