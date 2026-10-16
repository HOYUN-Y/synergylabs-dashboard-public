import type { CalendarSettings, CalendarChoice, CalendarMonth } from '../shared/calendar';
export class CalendarApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/calendar/${path}`, { method, cache: 'no-store',
      headers: { 'X-Dashboard-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  } catch { throw new CalendarApiError('NETWORK', '서버에 연결하지 못했거나 응답 시간이 초과되었습니다.'); }
  let data;
  try { data = await response.json(); } catch { throw new CalendarApiError('RESPONSE', '서버 응답을 확인할 수 없습니다.'); }
  if (!response.ok) throw new CalendarApiError(data.error ?? 'UNKNOWN', data.message ?? '캘린더 작업에 실패했습니다.');
  return data as T;
}
export const calendarApi = {
  settings: (signal?: AbortSignal) => request<CalendarSettings>('settings', 'GET', undefined, signal),
  start: () => request<{ url: string }>('auth/start', 'POST'),
  calendars: (signal?: AbortSignal) => request<{ calendars: CalendarChoice[] }>('calendars', 'GET', undefined, signal),
  save: (calendarId: string) => request<{ selected: CalendarChoice }>('settings', 'PUT', { calendarId }),
  disconnect: () => request<{ ok: boolean }>('connection', 'DELETE'),
  month: (month: string, signal?: AbortSignal, force = false) => request<CalendarMonth>(`events?month=${encodeURIComponent(month)}${force ? '&refresh=1' : ''}`, 'GET', undefined, signal)
};
