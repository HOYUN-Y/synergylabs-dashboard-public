import { resolveAuthClient, describeClient } from '../auth-settings.js';
import type { ResolvedAuthClient } from '../auth-settings.js';
import { CalendarStore } from './store.js';
import { GoogleCalendar } from './google.js';
import type { OAuthConfig, Tokens } from './google.js';
import { beginOAuth } from './oauth.js';
import type { OAuthAttempt } from './oauth.js';
import { CalendarError } from './errors.js';
import { monthGrid, dayStart, dateKey, eventsOnDate } from '../../shared/calendar.js';
import type { CalendarSettings, CalendarMonth } from '../../shared/calendar.js';

export class CalendarService {
  private pending: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private requests = new AbortController();
  private tokens?: Tokens;
  private tokenFlight?: Promise<string>;
  private monthFlights = new Map<string, Promise<CalendarMonth>>();
  private attempt?: OAuthAttempt;
  private attemptVersion = 0;
  private authStatus: CalendarSettings['authStatus'] = 'idle';
  private authError: string | null = null;
  constructor(private store = new CalendarStore(), private google = new GoogleCalendar(),
    private config: () => OAuthConfig | null | ResolvedAuthClient = () => resolveAuthClient('google'), private oauth = beginOAuth) {}
  private current?: ResolvedAuthClient;
  onConfigurationChange?: () => void;
  refreshConfiguration() {
    const value = this.config();
    const next = value && 'status' in value ? value : describeClient(value);
    const previous = this.current;
    this.current = next;
    if (previous && (previous.client?.clientId !== next.client?.clientId
      || previous.client?.clientSecret !== next.client?.clientSecret || previous.status.error !== next.status.error)) {
      this.changed(); this.attemptVersion++;
      this.attempt?.cancel(); this.attempt = undefined;
      this.authStatus = 'idle'; this.authError = null;
      this.onConfigurationChange?.();
    }
    return next;
  }
  private configured() {
    const result = this.current ?? this.refreshConfiguration();
    if (!result.client) throw new CalendarError(result.status.error ?? 'NOT_CONFIGURED');
    return result.client;
  }
  private changed() {
    this.generation++; this.requests.abort(); this.requests = new AbortController();
    this.tokens = undefined; this.tokenFlight = undefined; this.monthFlights.clear();
  }
  private mutate<T>(run: () => Promise<T>) {
    this.changed();
    const work = this.pending.then(run);
    this.pending = work.then(() => undefined, () => undefined);
    return work;
  }
  async settings(): Promise<CalendarSettings> {
    await this.pending;
    const saved = await this.store.read();
    const resolved = this.refreshConfiguration(), config = resolved.client;
    const connected = !!saved && !!config && saved.clientId === config.clientId;
    return { configured: !!config, connected, selected: connected ? saved!.selected : null,
      cleanupPending: !!saved?.obsoleteIds.length, authStatus: this.authStatus, authError: this.authError, clientConfig: resolved.status };
  }
  async startAuth(origin: string) {
    this.refreshConfiguration();
    const config = this.configured();
    this.attempt?.cancel();
    const version = ++this.attemptVersion;
    this.authStatus = 'pending'; this.authError = null;
    const authController = new AbortController();
    try {
      const attempt = await this.oauth(config, origin, async (code, verifier, redirectUri) => {
        this.refreshConfiguration();
        if (version !== this.attemptVersion) throw new CalendarError('CONFIG_CHANGED');
        const tokens = await this.google.token(config, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, authController.signal);
        this.refreshConfiguration();
        if (version !== this.attemptVersion) throw new CalendarError('CONFIG_CHANGED');
        await this.mutate(async () => {
          this.refreshConfiguration();
          if (version !== this.attemptVersion) throw new CalendarError('CONFIG_CHANGED');
          await this.store.connect(config.clientId, tokens.refreshToken!);
          this.refreshConfiguration();
          if (version !== this.attemptVersion) throw new CalendarError('CONFIG_CHANGED');
          this.tokens = tokens; this.authStatus = 'connected'; this.authError = null;
        });
      }, error => {
        authController.abort();
        if (version === this.attemptVersion) { this.authStatus = 'failed'; this.authError = error.message; }
      });
      const cancel = () => { authController.abort(); attempt.cancel(); };
      if (version !== this.attemptVersion) { cancel(); throw new CalendarError('CONFIG_CHANGED'); }
      this.attempt = { url: attempt.url, cancel };
      return { url: attempt.url };
    } catch (e) {
      if (version === this.attemptVersion) { this.authStatus = 'failed'; this.authError = 'Google 인증을 시작하지 못했습니다.'; }
      throw e;
    }
  }
  private async accessToken(version: number): Promise<string> {
    this.refreshConfiguration();
    if (version !== this.generation) throw new CalendarError('CONFIG_CHANGED');
    if (this.tokens && this.tokens.expiresAt > Date.now() + 60000) return this.tokens.accessToken;
    if (this.tokenFlight) return this.tokenFlight;
    const signal = this.requests.signal;
    const work = async () => {
      const config = this.configured(); const connection = await this.store.read();
      if (!connection) throw new CalendarError('NOT_CONNECTED');
      if (connection.clientId !== config.clientId) throw new CalendarError('REAUTH_REQUIRED');
      const refreshToken = await this.store.refreshToken(connection);
      const tokens = await this.google.token(config, { grant_type: 'refresh_token', refresh_token: refreshToken }, signal);
      this.refreshConfiguration();
      if (version !== this.generation) throw new CalendarError('CONFIG_CHANGED');
      this.tokens = tokens;
      return tokens.accessToken;
    };
    const flight = work().finally(() => { if (this.tokenFlight === flight) this.tokenFlight = undefined; });
    this.tokenFlight = flight; return flight;
  }
  private async query<T>(version: number, run: (token: string, signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.requests.signal;
    try {
      for (let attempt = 0; ; attempt++) {
        const token = await this.accessToken(version);
        try {
          const result = await run(token, signal);
          this.refreshConfiguration();
          if (version !== this.generation) throw new CalendarError('CONFIG_CHANGED');
          return result;
        } catch (e) {
          if (attempt === 0 && e instanceof CalendarError && e.code === 'REAUTH_REQUIRED') { this.tokens = undefined; continue; }
          throw e;
        }
      }
    } catch (e) {
      if (version !== this.generation) throw new CalendarError('CONFIG_CHANGED');
      throw e;
    }
  }
  async calendars() {
    this.refreshConfiguration();
    const version = this.generation; await this.pending;
    return { calendars: await this.query(version, (token, signal) => this.google.calendars(token, signal)) };
  }
  select(id: string) {
    this.refreshConfiguration();
    return this.mutate(async () => {
      const version = this.generation;
      const calendars = await this.query(version, (token, signal) => this.google.calendars(token, signal));
      const selected = calendars.find(c => c.id === id);
      if (!selected) throw new CalendarError('ACCESS_DENIED');
      await this.store.select(selected);
      return { selected };
    });
  }
  async month(month: string): Promise<CalendarMonth> {
    let days: string[];
    try { days = monthGrid(month); } catch { throw new CalendarError('INVALID_INPUT'); }
    this.refreshConfiguration();
    const version = this.generation; await this.pending;
    if (version !== this.generation) throw new CalendarError('CONFIG_CHANGED');
    const existing = this.monthFlights.get(month); if (existing) return existing;
    const work = async (): Promise<CalendarMonth> => {
      this.configured();
      const connection = await this.store.read();
      if (!connection) throw new CalendarError('NOT_CONNECTED');
      if (!connection.selected) throw new CalendarError('NO_CALENDAR');
      const end = dateKey(Date.parse(days.at(-1)! + 'T00:00:00Z') + 86400000);
      const events = await this.query(version, (token, signal) => this.google.events(connection.selected!.id,
        new Date(dayStart(days[0])).toISOString(), new Date(dayStart(end)).toISOString(), token, signal));
      return { month, calendar: connection.selected, timeZone: 'Asia/Seoul', days: days.map(date => ({ date, count: eventsOnDate(events, date).length })), events, fetchedAt: new Date().toISOString() };
    };
    const flight = work().finally(() => { if (this.monthFlights.get(month) === flight) this.monthFlights.delete(month); });
    this.monthFlights.set(month, flight); return flight;
  }
  disconnect() {
    this.attemptVersion++; this.attempt?.cancel(); this.attempt = undefined;
    this.authStatus = 'idle'; this.authError = null;
    return this.mutate(async () => { await this.store.disconnect(); this.authStatus = 'idle'; this.authError = null; });
  }
  close() { this.attemptVersion++; this.attempt?.cancel(); this.requests.abort(); }
}
