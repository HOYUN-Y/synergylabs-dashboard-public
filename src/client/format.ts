// 화면 표시용 숫자 · 시각 형식(한국시간). 시안 docs/design/dashboard-v2/js/ui.js의 fmt와 같은 규칙이다.
const KST = 'Asia/Seoul';
const DAY = 86400000;
const parts = (date: string | number | Date, options: Intl.DateTimeFormatOptions) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', { timeZone: KST, ...options }).formatToParts(new Date(date)).map(part => [part.type, part.value]));

const num = (value: number) => value.toLocaleString('ko-KR');
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${num(Math.abs(value))}`;
function ymd(date: string | number | Date = Date.now()) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}
function time(date: string | number | Date) {
  const p = parts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}
function md(date: string | number | Date) {
  const p = parts(date, { month: 'numeric', day: 'numeric' });
  return `${p.month}.${p.day}`;
}
const dateLong = (date: string | number | Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(date));
const dateShort = (date: string | number | Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: KST, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(date));
/** 지난 시각: 방금 · N분 전 · 오늘 HH:MM · 어제 HH:MM · M.D HH:MM */
function when(date: string | number | Date) {
  const t = new Date(date).getTime(); const diff = Date.now() - t;
  if (diff >= 0 && diff < 60e3) return '방금';
  if (diff >= 0 && diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  return at(t);
}
/** 앞뒤 상관없는 시각: 오늘 · 어제 · 내일 HH:MM, 그 밖에는 M.D HH:MM */
function at(date: string | number | Date) {
  const t = new Date(date).getTime(); const day = ymd(t);
  const label = day === ymd() ? '오늘' : day === ymd(Date.now() - DAY) ? '어제' : day === ymd(Date.now() + DAY) ? '내일' : md(t);
  return `${label} ${time(t)}`;
}
function mailTime(date: string | number | Date) {
  const t = new Date(date).getTime();
  return ymd(t) === ymd() ? time(t) : ymd(t) === ymd(Date.now() - DAY) ? '어제' : md(t);
}
const elapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const fmt = { num, signed, ymd, time, md, dateLong, dateShort, when, at, mailTime, elapsed };
