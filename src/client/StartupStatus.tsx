import { useEffect, useRef, useState } from 'react';
import type { StartupKey, StartupItem, StartupStatus as Status } from '../shared/startup';
import { Icon } from './Icon';
import { Popover } from './ui';
import { updateLocation, useSettingsRefresh } from './settings-state';

const labels: Record<StartupKey, string> = { automation: '스킬·루틴', assets: '브랜드에셋', brain: '세컨드 브레인', mail: '이메일', calendar: '캘린더' };
const states: Record<StartupItem['state'], string> = { ready: '준비됨', pending: '확인 중', connection_required: '연결 필요', error: '확인 필요' };
const icons: Record<StartupItem['state'], string> = { ready: 'check', pending: 'clock', connection_required: 'plug', error: 'alert' };
/** 시작 준비: 모두 준비되면 보이지 않고, 확인 중이거나 연결 · 확인이 필요할 때만 머리줄에 칩이 나온다. 누르면 목록 */
export function StartupStatus() {
  const [value, setValue] = useState<Status | null>(null);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  useSettingsRefresh('workspace', () => setRevision(n => n + 1));
  useSettingsRefresh('mail', () => setRevision(n => n + 1));
  useSettingsRefresh('calendar', () => setRevision(n => n + 1));
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const response = await fetch('/api/startup', { headers: { 'X-Dashboard-Request': '1' }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) return;
        const next: Status = await response.json();
        if (!controller.signal.aborted) { setValue(next); timer = setTimeout(() => void read(), next.waiting ? 2000 : 30000); }
      } catch { /* 서버 연결 오류는 머리줄의 서버 표시에서 안내한다. */ }
    };
    void read(); return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  if (!value?.startedAt) return null;
  const items = (Object.entries(value.items) as [StartupKey, StartupItem | undefined][]).filter((entry): entry is [StartupKey, StartupItem] => !!entry[1]);
  const problems = items.filter(([, item]) => item.state === 'connection_required' || item.state === 'error').length;
  if (!value.waiting && !value.timedOut && !problems) return null;
  const label = problems ? '확인 필요' : value.timedOut ? '준비 지연' : '준비 중';
  const text = problems ? `${label} ${problems}` : label;
  const summary = value.timedOut ? '일부 준비가 지연되고 있습니다. 준비된 기능부터 사용할 수 있습니다.' : value.waiting ? '자료와 연결 상태를 확인하고 있습니다.' : '연결하거나 확인할 항목이 있습니다.';
  const close = (restore: boolean) => { setOpen(false); if (restore) chip.current?.focus(); };
  return <>
    <button ref={chip} type="button" className={`state-chip startup-chip${problems || value.timedOut ? '' : ' state-chip--quiet'}${problems ? ' has-count' : ''}`} aria-haspopup="dialog" aria-label={`시작 준비 · ${text}`} onClick={() => setOpen(o => !o)}><span className="startup-chip__label">{label}</span>{problems ? ` ${problems}` : ''}</button>
    {open && chip.current && <Popover anchor={chip.current} label="시작 준비 상태" className="popover--startup" onClose={close}>
      <div className="popover__head"><h2>시작 준비</h2></div>
      <div className="popover__body">
        <p className="caption startup__summary" role="status">{summary}</p>
        <ul className="startup__list">{items.map(([key, item]) => <li key={key} data-state={item.state}>
          <span className="notify__icon"><Icon name={icons[item.state]} className="i--sm" /></span>
          <span className="startup__text"><strong>{labels[key]} · {states[item.state]}</strong>
            {item.state !== 'ready' && <span className="caption">{item.message}</span>}</span>
          {item.state !== 'ready' && item.state !== 'pending' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { close(false); updateLocation({ settings: key === 'mail' || key === 'calendar' ? key : 'workspace' }); }}>설정</button>}
        </li>)}</ul>
      </div>
    </Popover>}
  </>;
}
