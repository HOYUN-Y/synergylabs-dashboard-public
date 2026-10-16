import { Icon } from './Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AutomationSettingsForm } from './AutomationSettingsForm';
import { CalendarSettingsForm } from './CalendarSettingsForm';
import { MailSettingsForm } from './MailSettingsForm';
import { SkillSettings } from './SkillSettings';
import { SettingsFormContext, settingsTabs } from './settings-state';
import type { SettingsTab } from './settings-state';
import { IconButton, closeOnBackdrop } from './ui';

const tabIcons: Record<SettingsTab, string> = { workspace: 'folder', mail: 'mail', calendar: 'calendar', skills: 'sliders' };
/** 설정: 왼쪽 세로 탭 + 오른쪽 내용(시안 dialogs.openSettings). 저장하지 않은 변경이 있으면 확인 띠로 막는다 */
export function SettingsModal({ tab, suspended, onTab, onClose, guardRef }: {
  tab: SettingsTab; suspended: boolean; onTab: (tab: SettingsTab) => void; onClose: () => void;
  guardRef: { current: ((discard?: boolean, proceed?: () => void) => boolean) | null };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [forms, setForms] = useState<Record<string, { dirty: boolean; busy: boolean }>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pendingLeave = useRef<(() => void) | null>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmDiscard) discardButton.current?.focus(); }, [confirmDiscard]);
  const dirty = Object.values(forms).some(form => form.dirty);
  const busy = Object.values(forms).some(form => form.busy);
  const report = useCallback((id: string, state: { dirty: boolean; busy: boolean } | null) => {
    setForms(previous => { const next = { ...previous }; if (state) next[id] = state; else delete next[id]; return next; });
  }, []);
  const canClose = useCallback((discard = true, proceed?: () => void) => {
    if (busy) return false;
    if (discard && dirty) { pendingLeave.current = proceed ?? onClose; setConfirmDiscard(true); return false; }
    return true;
  }, [busy, dirty, onClose]);
  useEffect(() => { guardRef.current = canClose; return () => { guardRef.current = null; }; }, [canClose, guardRef]);
  useEffect(() => {
    if (suspended) return;
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [suspended]);
  useEffect(() => {
    if (!dirty || suspended) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, suspended]);
  const close = () => { if (canClose()) onClose(); };
  return <dialog ref={dialog} className="dialog dialog--settings" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); close(); }} onPointerDown={event => closeOnBackdrop(event, close)}>
    <header className="dialog__head"><h2 id="settings-title">설정</h2><IconButton ref={closeButton} icon="x" label="설정 닫기" tip="닫기 (Esc)" autoFocus disabled={busy} onClick={close} /></header>
    <div className="dialog__body">
      <div className="settings">
        <div className="settings__tabs" role="tablist" aria-label="설정 항목" aria-orientation="vertical">
          {(Object.entries(settingsTabs) as [SettingsTab, string][]).map(([id, label], index, entries) => <button key={id} id={`settings-tab-${id}`} type="button" role="tab" className="settings__tab" aria-selected={tab === id} aria-controls={`settings-pane-${id}`} tabIndex={tab === id ? 0 : -1} disabled={busy} onClick={() => onTab(id)} onKeyDown={event => {
            const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (!offset && event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            const next = entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + offset + entries.length) % entries.length][0];
            onTab(next); document.getElementById(`settings-tab-${next}`)?.focus();
          }}><Icon name={tabIcons[id]} />{label}</button>)}
        </div>
        <div className="settings__main">
          {confirmDiscard && <div className="confirm-bar" role="alert">
            <p>저장하지 않은 변경이 있습니다. 변경을 버리고 이동할까요?</p>
            <button ref={discardButton} type="button" className="btn btn--line btn--sm" onClick={() => { setConfirmDiscard(false); closeButton.current?.focus(); }}>계속 편집</button>
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => { guardRef.current = null; setConfirmDiscard(false); pendingLeave.current?.(); }}>변경 버리고 이동</button>
          </div>}
          <SettingsFormContext.Provider value={report}>
            <div hidden={tab !== 'workspace'} role="tabpanel" id="settings-pane-workspace" aria-labelledby="settings-tab-workspace"><AutomationSettingsForm /></div>
            <div hidden={tab !== 'mail'} role="tabpanel" id="settings-pane-mail" aria-labelledby="settings-tab-mail"><MailSettingsForm /></div>
            <div hidden={tab !== 'calendar'} role="tabpanel" id="settings-pane-calendar" aria-labelledby="settings-tab-calendar"><CalendarSettingsForm /></div>
            <div hidden={tab !== 'skills'} role="tabpanel" id="settings-pane-skills" aria-labelledby="settings-tab-skills"><SkillSettings /></div>
          </SettingsFormContext.Provider>
        </div>
      </div>
    </div>
  </dialog>;
}
