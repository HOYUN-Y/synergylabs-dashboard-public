import { Icon } from './Icon';
import { fmt } from './format';
import { EmptyState, IconButton, Skel, scrollHint } from './ui';
import { CardStatus, useDashboardPolling } from './dashboard-state';
import { updateLocation, useSettingsRefresh } from './settings-state';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { calendarApi, CalendarApiError } from './calendar-api';
import { monthGrid, todayKst, shiftMonth, eventsOnDate, dayStart } from '../shared/calendar';
import type { CalendarMonth, CalendarEvent } from '../shared/calendar';

const unconnected = ['NOT_CONFIGURED', 'NOT_CONNECTED', 'NO_CALENDAR'];
const reconnect = ['REAUTH_REQUIRED', 'ACCESS_DENIED', 'CONFIG_CHANGED'];
// env/auth-settings.json 또는 거기서 고른 OAuth JSON이 잘못됨: 다시 시도로는 풀리지 않으므로 설정 확인으로 안내한다
const misconfigured = ['AUTH_SETTINGS_INVALID', 'AUTH_CLIENT_INVALID'];
const range = (event: CalendarEvent) => event.allDay ? '종일' : `${fmt.md(event.start)} ${fmt.time(event.start)} – ${fmt.md(event.end)} ${fmt.time(event.end)}`;
/** 목록의 시각: 종일 · 그날 시작 시각 · 전날부터 이어지는 일정은 '이어짐' */
const startLabel = (event: CalendarEvent, date: string) => event.allDay ? '종일' : Date.parse(event.start) < dayStart(date) ? '이어짐' : fmt.time(event.start);

export function CalendarCard() {
  const [month, setMonth] = useState(() => todayKst().slice(0, 7));
  const [selected, setSelected] = useState(todayKst);
  const [result, setResult] = useState<CalendarMonth | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  const lastSuccess = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const data = await calendarApi.month(month, controller.signal, force);
      if (!controller.signal.aborted) { setResult(data); lastSuccess.current = Date.now(); }
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof CalendarApiError && [...unconnected, ...reconnect, ...misconfigured].includes(e.code)) setResult(null);
        setError(e);
      }
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [month]);
  useSettingsRefresh('calendar', () => { active.current?.abort(); active.current = null; setResult(null); setError(null); setBusy(true); lastSuccess.current = 0; if (visible && !document.hidden) void refresh(); });
  const visible = useDashboardPolling(refresh, 300000, lastSuccess);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  function move(next: string, date?: string) {
    setSelected(date ?? (next === todayKst().slice(0, 7) ? todayKst() : `${next}-01`));
    if (next === month) { void refresh(true); return; }
    active.current?.abort(); active.current = null; lastSuccess.current = 0;
    setBusy(true); setMonth(next);
    setResult(null); setError(null);
  }
  const today = todayKst();
  const days = monthGrid(month);
  const displayed = result?.month === month ? result : null;
  const list = displayed ? eventsOnDate(displayed.events, selected) : [];
  const counts = new Map(displayed?.days.map(day => [day.date, day.count]));
  const code = error instanceof CalendarApiError ? error.code : '';
  const message = error instanceof Error ? error.message : '';
  const openSettings = () => updateLocation({ settings: 'calendar' });
  const head = (tools: boolean) => <header className="card__head">
    <h2 className="card__title" id="calendar-heading"><Icon name="calendar" />캘린더</h2>
    {displayed && !error && <span className="card__meta" title={displayed.calendar.name}>{displayed.calendar.name}</span>}
    <CardStatus label={error && displayed ? '조회 실패' : null} tip={message} />
    {tools && <div className="card__tools">
      <IconButton icon="refresh" label="캘린더 새로고침" size="sm" className="reveal" busy={busy} disabled={busy} onClick={() => void refresh(true)} />
      {selected !== today && <button type="button" className="chip cal__today" onClick={() => move(today.slice(0, 7))}>오늘</button>}
      <IconButton icon="chevron-left" label="이전 달" tip={null} size="sm" disabled={month === '1900-01'} onClick={() => move(shiftMonth(month, -1))} />
      <span className="cal__month mono" aria-live="polite">{month.replace('-', '.')}</span>
      <IconButton icon="chevron-right" label="다음 달" tip={null} size="sm" disabled={month === '9998-12'} onClick={() => move(shiftMonth(month, 1))} />
    </div>}
  </header>;
  // 연결이 안 됐거나 다시 연결해야 하면 잔디 대신 안내를 보인다
  if (!displayed && (unconnected.includes(code) || reconnect.includes(code) || misconfigured.includes(code))) return <section className="card cal" aria-labelledby="calendar-heading">
    {head(false)}
    {unconnected.includes(code)
      ? <EmptyState icon="calendar" title="Google 캘린더 미연결" text="회사 캘린더를 공유받은 계정으로 연결하면 날짜별 일정 수가 잔디로 보입니다."
        action={<button type="button" className="btn btn--primary btn--sm" onClick={openSettings}><Icon name="plug" />캘린더 연결</button>} />
      : misconfigured.includes(code) ? <EmptyState icon="alert" title="캘린더 인증 설정을 확인해 주세요" text={message} role="alert"
        action={<button type="button" className="btn btn--line btn--sm" onClick={openSettings}><Icon name="settings" />설정 확인</button>} />
      : <EmptyState icon="alert" title="캘린더를 다시 연결해 주세요" text={message} role="alert"
        action={<button type="button" className="btn btn--line btn--sm" onClick={openSettings}><Icon name="plug" />연결 설정</button>} />}
  </section>;
  const rows = days.length / 7;
  // 잔디 오른쪽 주차별 막대: 그 주(이번 달 날짜만)에 걸친 일정 수. 여러 날 일정은 한 번만 센다. 조회 전 · 첫 조회 실패는 0이 아니라 빈 칸
  const weeks = displayed ? Array.from({ length: rows }, (_, row) => {
    const ids = new Set<string>();
    for (const date of days.slice(row * 7, row * 7 + 7)) if (date.startsWith(month)) for (const event of eventsOnDate(displayed.events, date)) ids.add(event.id);
    return ids.size;
  }) : null;
  const peak = Math.max(1, ...(weeks ?? []));
  const selectedRow = Math.floor(days.indexOf(selected) / 7);
  return <section className="card cal" aria-labelledby="calendar-heading" aria-busy={busy}>
    {head(true)}
    <div className="cal__week" aria-hidden="true"><span />{['일', '월', '화', '수', '목', '금', '토'].map(day => <span key={day}>{day}</span>)}<span className="cal__wkbar-head">주간 일정</span></div>
    <div className="cal__grid" role="group" aria-label={`${month} 날짜별 일정 수 · 한국시간`} style={{ '--rows': rows } as CSSProperties}>
      {days.flatMap((date, i) => {
        const outside = !date.startsWith(month);
        const count = displayed && !outside ? counts.get(date) ?? 0 : null;
        const name = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일${outside ? ' · 다른 달' : count === null ? ' · 조회 전' : ` · 일정 ${count}건`}`;
        const cell = <button key={date} type="button" className={`cal__cell${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}`}
          data-level={outside ? 'none' : count === null ? 'unknown' : String(Math.min(count, 4))} aria-pressed={date === selected} aria-label={name} data-tip={name} data-tip-delay="250"
          aria-current={date === today ? 'date' : undefined} onClick={() => outside ? move(date.slice(0, 7), date) : setSelected(date)} />;
        const row = Math.floor(i / 7), total = weeks?.[row];
        const bar = total === undefined ? <span key={`b${row}`} className="cal__wkbar" aria-hidden="true" />
          : <span key={`b${row}`} className={`cal__wkbar${row === selectedRow ? ' is-selected' : ''}`} role="img" aria-label={`${row + 1}주차 일정 ${total}건`} data-tip={`${row + 1}주차 · 일정 ${total}건`} data-tip-delay="250">
            <i style={{ '--w': `${(total / peak) * 100}%` } as CSSProperties} /><span className="mono">{total}</span></span>;
        return [...(i % 7 === 0 ? [<span key={`w${i}`} className="cal__wk">{row + 1}주차</span>] : []), cell, ...(i % 7 === 6 ? [bar] : [])];
      })}
    </div>
    <div className="cal__agenda">
      {!displayed && !error ? <div role="status" aria-label="일정을 불러오는 중"><Skel width="40%" height={14} /><div style={{ height: 8 }} /><Skel width="80%" /></div>
        : !displayed ? <EmptyState icon="alert" title="일정을 불러오지 못했습니다" text={<span title={message}>{message}</span>} role="alert"
          action={<button type="button" className="btn btn--line btn--sm" onClick={() => void refresh(true)}><Icon name="refresh" />다시 시도</button>} />
          : <>
            <div className="cal__agenda-head">
              <strong>{fmt.dateShort(`${selected}T12:00:00+09:00`)}</strong>
              <span className="caption">일정 {list.length}건</span>
              <div className="cal__legend" aria-hidden="true"><span>일정 0</span><i /><i /><i /><i /><i /><span>4+</span></div>
            </div>
            {list.length ? <ul className="cal__events" ref={scrollHint} aria-label="선택한 날짜의 일정">{list.map(event => <li className="cal__event" key={event.id}>
              <time className="mono" dateTime={event.start} data-tip={range(event)}>{startLabel(event, selected)}</time>
              <span className="ellipsis" title={`${event.title} · ${range(event)}`}>{event.title}{event.location && <span className="caption"> · {event.location}</span>}</span>
              {event.url ? <a href={event.url} target="_blank" rel="noreferrer" aria-label={`${event.title} Google Calendar에서 열기`} data-tip="Google Calendar에서 열기"><Icon name="arrow-up-right" className="i--xs" /></a> : <span />}
            </li>)}</ul> : <p className="cal__none">일정이 없습니다.</p>}
            {!!error && <p className="cal__stale caption" title={message}><span className="dot dot--attention" aria-hidden="true" />이전 결과 · {fmt.time(displayed.fetchedAt)} 확인</p>}
          </>}
    </div>
  </section>;
}
