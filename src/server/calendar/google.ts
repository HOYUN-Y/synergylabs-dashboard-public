import type { CalendarChoice, CalendarEvent } from '../../shared/calendar.js';
import { CalendarError } from './errors.js';
export const SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];
export interface OAuthConfig { clientId: string; clientSecret: string }
export interface Tokens { accessToken: string; refreshToken?: string; expiresAt: number }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CalendarError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function requiredString(value: unknown) {
  if (typeof value !== 'string' || !value) throw new CalendarError('INVALID_RESPONSE');
  return value;
}
export function safeEventUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && ['calendar.google.com', 'www.google.com'].includes(u.hostname) ? u.href : null; }
  catch { return null; }
}
export class GoogleCalendar {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async json(url: string, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(20000);
    let response: Response;
    try { response = await this.fetcher(url, { ...init, redirect: 'error', signal: signal ? AbortSignal.any([timeout, signal]) : timeout }); }
    catch { throw new CalendarError(signal?.aborted ? 'CONFIG_CHANGED' : timeout.aborted ? 'TIMEOUT' : 'NETWORK'); }
    let data: Record<string, unknown>;
    try { data = object(await response.json()); } catch { throw new CalendarError('INVALID_RESPONSE'); }
    if (!response.ok) {
      const error = typeof data.error === 'object' && data.error ? data.error as Record<string, unknown> : {};
      const reasons = JSON.stringify(error); // Only inspect provider codes; never return/log provider text.
      if (response.status === 401 || data.error === 'invalid_grant') throw new CalendarError('REAUTH_REQUIRED');
      if (response.status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|RESOURCE_EXHAUSTED/.test(reasons)) throw new CalendarError('RATE_LIMIT');
      if (/accessNotConfigured|SERVICE_DISABLED/.test(reasons)) throw new CalendarError('API_DISABLED');
      if (response.status === 403 || response.status === 404) throw new CalendarError('ACCESS_DENIED');
      throw new CalendarError(url.endsWith('/token') ? 'AUTH_FAILED' : 'NETWORK');
    }
    return data;
  }
  async token(config: OAuthConfig, params: Record<string, string>, signal?: AbortSignal): Promise<Tokens> {
    const data = await this.json('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }) }, signal);
    const expires = data.expires_in;
    if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0 || data.token_type !== 'Bearer') throw new CalendarError('INVALID_RESPONSE');
    if (params.grant_type === 'authorization_code') {
      const granted = requiredString(data.scope).split(' ');
      if (!SCOPES.every(s => granted.includes(s)) || !data.refresh_token) throw new CalendarError('AUTH_FAILED');
    }
    return { accessToken: requiredString(data.access_token), expiresAt: Date.now() + expires * 1000,
      ...(data.refresh_token ? { refreshToken: requiredString(data.refresh_token) } : {}) };
  }
  private async list(path: string, params: Record<string, string>, token: string, signal?: AbortSignal) {
    const all: unknown[] = [];
    const seen = new Set<string>();
    let page = '';
    const deadline = AbortSignal.timeout(20000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      do {
        const query = new URLSearchParams({ ...params, ...(page ? { pageToken: page } : {}) });
        const data = await this.json(`https://www.googleapis.com/calendar/v3/${path}?${query}`, { headers: { Authorization: `Bearer ${token}` } }, combined);
        if (data.items !== undefined && !Array.isArray(data.items)) throw new CalendarError('INVALID_RESPONSE');
        all.push(...(data.items as unknown[] ?? []));
        page = data.nextPageToken === undefined ? '' : requiredString(data.nextPageToken);
        if (page && seen.has(page)) throw new CalendarError('INVALID_RESPONSE');
        seen.add(page);
      } while (page);
    } catch (e) { if (deadline.aborted && !signal?.aborted) throw new CalendarError('TIMEOUT'); throw e; }
    return all;
  }
  async calendars(token: string, signal?: AbortSignal): Promise<CalendarChoice[]> {
    const items = await this.list('users/me/calendarList', { minAccessRole: 'reader', showHidden: 'true', maxResults: '250' }, token, signal);
    return items.map(value => { const c = object(value); return { id: requiredString(c.id), name: requiredString(c.summaryOverride ?? c.summary) }; });
  }
  async events(id: string, start: string, end: string, token: string, signal?: AbortSignal): Promise<CalendarEvent[]> {
    const items = await this.list(`calendars/${encodeURIComponent(id)}/events`, { timeMin: start, timeMax: end,
      singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', timeZone: 'Asia/Seoul', maxResults: '2500' }, token, signal);
    const events = new Map<string, CalendarEvent>();
    for (const value of items) {
      const e = object(value);
      if (e.status === 'cancelled') continue;
      const start = object(e.start), end = object(e.end);
      const allDay = typeof start.date === 'string';
      const from = requiredString(allDay ? start.date : start.dateTime), to = requiredString(allDay ? end.date : end.dateTime);
      const format = allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/;
      if (!format.test(from) || !format.test(to) || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from)) throw new CalendarError('INVALID_RESPONSE');
      const event = { id: requiredString(e.id), title: typeof e.summary === 'string' && e.summary ? e.summary : '제목 비공개 또는 없음',
        start: from, end: to, allDay, location: typeof e.location === 'string' ? e.location : '', url: safeEventUrl(e.htmlLink) };
      events.set(event.id, event);
    }
    return [...events.values()];
  }
}
