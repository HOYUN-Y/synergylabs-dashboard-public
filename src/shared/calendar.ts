import type { AuthClientStatus } from './auth-settings.js';
export interface CalendarChoice { id: string; name: string }
export interface CalendarSettings {
  clientConfig?: AuthClientStatus;
  configured: boolean;
  connected: boolean;
  selected: CalendarChoice | null;
  cleanupPending: boolean;
  authStatus: 'idle' | 'pending' | 'connected' | 'failed';
  authError: string | null;
}
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  url: string | null;
}
export interface CalendarMonth {
  month: string;
  calendar: CalendarChoice;
  timeZone: 'Asia/Seoul';
  days: { date: string; count: number }[];
  events: CalendarEvent[];
  fetchedAt: string;
}
const DAY = 86400000;
export function dateKey(ms: number) { return new Date(ms).toISOString().slice(0, 10); }
export function todayKst() { return dateKey(Date.now() + 9 * 3600000); }
export function monthGrid(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month');
  const [year, m] = month.split('-').map(Number);
  if (year < 1900 || year > 9998 || m < 1 || m > 12) throw new Error('Invalid month');
  const first = Date.UTC(year, m - 1, 1);
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const offset = new Date(first).getUTCDay();
  const cells = offset + count > 35 ? 42 : 35;
  return Array.from({ length: cells }, (_, i) => dateKey(first + (i - offset) * DAY));
}
export function shiftMonth(month: string, delta: number) {
  monthGrid(month);
  const [year, m] = month.split('-').map(Number);
  return dateKey(Date.UTC(year, m - 1 + delta, 1)).slice(0, 7);
}
export function dayStart(date: string) { return Date.parse(`${date}T00:00:00+09:00`); }
export function eventsOnDate(events: CalendarEvent[], date: string) {
  const start = dayStart(date);
  return events.filter(e => {
    const from = e.allDay ? dayStart(e.start) : Date.parse(e.start);
    const to = e.allDay ? dayStart(e.end) : Date.parse(e.end);
    return from < start + DAY && to > start;
  }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}
