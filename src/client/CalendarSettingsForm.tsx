import { useEffect, useState } from 'react';
import { useSettingsForm, settingsChanged } from './settings-state';
import { calendarApi } from './calendar-api';
import { Icon } from './Icon';
import { Notice } from './ui';
import { ClientConfigStatus } from './ClientConfigStatus';
import type { CalendarSettings, CalendarChoice } from '../shared/calendar';

// 마지막으로 읽은 클라이언트 설정(이 화면을 연 동안). 설정 파일은 앱 밖에서 고치므로, 탭에서 다시 읽은 값이 달라졌을 때 카드 · 시작 준비도 다시 확인한다
let seenClient: string | null = null;

/** 캘린더 탭(시안 settings calendar): 연결 상태 줄(다시 연결 · 연결 해제) · 표시할 회사 캘린더 · 저장 */
export function CalendarSettingsForm() {
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [calendars, setCalendars] = useState<CalendarChoice[]>([]);
  const [selected, setSelected] = useState('');
  const [reload, setReload] = useState(0);
  const [acting, setActing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  useSettingsForm('calendar', selected !== (settings?.selected?.id ?? ''), acting);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setBusy(true); setError(''); setCalendars([]);
      try {
        const result = await calendarApi.settings(controller.signal);
        if (controller.signal.aborted) return;
        setSettings(result); setSelected(result.selected?.id ?? '');
        setAuthNotice(result.authError ?? '');
        // 처음 읽을 때는 비교할 값이 없으므로 쓸 수 없는 설정일 때만 다시 확인한다. 연결 여부는 빼고 본다(연결 · 해제는 action이 이미 알린다)
        const client = result.clientConfig, signature = [result.configured, client?.source, client?.fileName, client?.clientIdHint, client?.validation, client?.error].join('|');
        if (seenClient === null ? !result.configured : seenClient !== signature) settingsChanged('calendar');
        seenClient = signature;
        if (result.connected) {
          const list = await calendarApi.calendars(controller.signal);
          if (!controller.signal.aborted) setCalendars(list.calendars);
        }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [reload]);
  async function action(kind: 'connect' | 'save' | 'disconnect') {
    setBusy(true); setActing(true); setError(''); setNotice('');
    try {
      if (kind === 'connect') {
        const { url } = await calendarApi.start();
        const parsed = new URL(url);
        if (parsed.origin !== 'https://accounts.google.com') throw new Error('인증 주소를 확인할 수 없습니다.');
        try { sessionStorage.setItem('dashboard-oauth-return', 'calendar'); } catch { /* The legacy settings route remains usable without session storage. */ }
        window.location.assign(url); return;
      }
      if (kind === 'save') { const result = await calendarApi.save(selected); setSettings(old => old ? { ...old, selected: result.selected } : old); setNotice('캘린더를 저장했습니다. 대시보드에서 일정을 확인하세요.'); }
      else { await calendarApi.disconnect(); setSelected(''); setSettings(old => old ? { ...old, connected: false, selected: null } : old); setNotice('이 Mac의 캘린더 연결을 해제했습니다. 원래 일정은 유지됩니다.'); }
      settingsChanged('calendar');
      setReload(n => n + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setActing(false); }
  }
  const connected = !!settings?.connected;
  const client = settings?.clientConfig;
  return <section className="settings__section" aria-labelledby="calendar-settings-heading">
    <h3 id="calendar-settings-heading">Google 캘린더 연결</h3>
    <div className="settings__status">
      <span className="settings__status-icon"><Icon name="calendar" /></span>
      <span className="settings__status-text"><strong>{!settings ? '연결 상태 확인 중' : connected ? 'Google 계정 연결됨' : '연결되지 않음'}</strong>
        <span className="caption">{settings?.selected ? `${settings.selected.name} · ` : ''}읽기 전용 · 일정은 바꾸지 않습니다</span></span>
      <span className="settings__status-tools">
        <button type="button" className={`btn ${connected ? 'btn--line' : 'btn--primary'} btn--sm`} disabled={busy || !settings?.configured} onClick={() => void action('connect')}>{connected ? '다시 연결' : 'Google로 연결'}</button>
        {connected && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void action('disconnect')}>연결 해제</button>}
      </span>
    </div>
    <p className="settings__lead">회사 캘린더를 공유받은 계정으로 로그인하세요. 일정은 조회만 하며 변경하지 않습니다.</p>
    {client && <ClientConfigStatus status={client} label="Google 클라이언트">
      {client.validation === 'valid' && <p className="field-help">{client.source === 'environment'
        ? '로그인과는 별개입니다. 환경변수는 서버를 다시 시작해야 반영되고, env/auth-settings.json에 JSON 파일명을 적으면 그 파일을 먼저 씁니다.'
        : '형식만 확인한 결과이며 로그인과는 별개입니다. JSON을 바꾸면 ‘연결 상태 새로고침’으로 바로 반영되고, client ID가 바뀌면 다시 연결해야 합니다.'}</p>}
    </ClientConfigStatus>}
    {settings && !settings.configured && <Notice icon="alert" attention role="status">{client?.validation === 'invalid'
      ? `${client.message} 고친 뒤 ‘연결 상태 새로고침’을 누르세요. 저장된 연결 정보는 지우지 않았습니다.`
      : 'Google 클라이언트를 먼저 설정해야 연결할 수 있습니다. 저장소 env/ 폴더에 데스크톱 OAuth JSON을 넣고 env/auth-settings.json의 googleClientFile에 파일명을 적거나, 기존 환경변수(GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET)를 설정해 주세요. JSON은 바로, 환경변수는 서버를 다시 시작하면 반영됩니다.'}</Notice>}
    {connected && <>
      <label className="field"><span>표시할 회사 캘린더</span>
        <select className="select" value={selected} disabled={busy || calendars.length === 0} onChange={e => setSelected(e.target.value)}>
          <option value="">캘린더를 선택하세요</option>
          {calendars.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
        </select>
        <small>개인 기본 캘린더는 자동으로 고르지 않습니다. 목록에 없으면 Google Calendar에서 공유 수락 · 목록 추가를 확인하세요.</small>
      </label>
      {!busy && !error && calendars.length === 0 && <Notice icon="info">조회 가능한 캘린더가 없습니다. Google Calendar에서 공유 수락 · 목록 추가와 일정 조회 권한을 확인하세요.</Notice>}
      <div className="settings__actions">
        <button type="button" className="btn btn--primary" disabled={busy || !calendars.some(c => c.id === selected) || selected === (settings?.selected?.id ?? '')} onClick={() => void action('save')}>캘린더 저장</button>
      </div>
    </>}
    <div className="settings__actions"><button type="button" className={`btn btn--ghost btn--sm${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => setReload(n => n + 1)}><Icon name="refresh" />연결 상태 새로고침</button></div>
    {settings?.authStatus === 'pending' && <Notice icon="clock">Google 인증 대기 중입니다. 다시 연결하면 이전 인증 요청은 취소됩니다.</Notice>}
    {settings?.cleanupPending && <Notice icon="info" role="status">이전 키체인 항목 정리가 남아 있습니다. 연결 해제 또는 재연결 시 다시 정리합니다.</Notice>}
    {busy && <p className="caption" role="status">캘린더 연결 확인 중…</p>}
    {authNotice && <Notice icon="alert" attention role="status">{authNotice}</Notice>}
    {notice && <Notice icon="check" role="status">{notice}</Notice>}
    {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    <p className="field-help">연결 정보는 이 Mac에만 저장합니다. Google 계정의 앱 권한 철회는 <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 연결 관리</a>에서 할 수 있습니다.</p>
  </section>;
}
