import { Icon } from './Icon';
import { fmt } from './format';
import { useCallback, useEffect, useRef, useState } from 'react';
import { automationApi } from './automation-api';
import { isActive, runLabels } from '../shared/automation';
import type { AutomationNotification, AutomationRun, NotificationPage } from '../shared/automation';
import { RunDetail } from './RunParts';
import { openSkillConversation } from './SkillConversation';
import { IconButton, Notice, Popover, Skel, closeOnBackdrop, statusIcon } from './ui';
import { updateLocation } from './settings-state';

/** 머리줄의 실행 알림: 종 버튼 + 버튼에 붙는 팝오버(시안 dialogs.openNotifications). 항목을 열면 확인 처리한다 */
export function Notifications() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadedCount = useRef(50);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const value = await automationApi.notifications(undefined, signal);
      if (!signal?.aborted) {
        // Refresh every loaded page so read state stays consistent across browsers.
        const all = [...value.notifications]; let next = value.nextCursor;
        while (next && all.length < loadedCount.current) {
          const more = await automationApi.notifications(next, signal); all.push(...more.notifications); next = more.nextCursor;
        }
        if (!signal?.aborted) { setPage({ ...value, notifications: [...new Map(all.map(n => [n.id, n])).values()], nextCursor: next }); setError(''); }
      }
    } catch (e) { if (!signal?.aborted) setError((e as Error).message); }
    finally { busyRef.current = false; }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => { if (!document.hidden) void refresh(controller.signal); };
    check(); const timer = setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [refresh]);
  useEffect(() => { if (open) void refresh(); }, [open, refresh]);
  const loadMore = async () => {
    if (!page?.nextCursor || busyRef.current) return;
    setBusy(true); busyRef.current = true;
    try { const value = await automationApi.notifications(page.nextCursor); loadedCount.current += value.notifications.length;
      setPage(old => ({ ...value, notifications: [...new Map([...(old?.notifications ?? []), ...value.notifications].map(n => [n.id, n])).values()] })); setError('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); busyRef.current = false; }
  };
  const read = async (item: AutomationNotification) => {
    if (busyRef.current) return;
    setBusy(true); busyRef.current = true;
    try {
      const value = await automationApi.readNotification(item.id);
      setPage(old => old ? { ...old, unreadCount: Math.max(0, old.unreadCount - (item.readAt === null ? 1 : 0)), notifications: old.notifications.map(n => n.id === item.id ? value : n) } : old);
      // 결과 창이 닫히면 종 버튼으로 포커스가 돌아오도록 먼저 옮겨 둔다
      setOpen(false); trigger.current?.focus();
      updateLocation(item.conversationId ? { conversation: item.conversationId, run: null } : { run: item.id, conversation: null });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); busyRef.current = false; }
  };
  const unread = page?.unreadCount ?? 0;
  return <>
    <IconButton ref={trigger} icon="bell" size="lg" label={`실행 알림${unread ? ` · 미확인 ${unread}개` : ''}${error ? ' · 조회 오류' : ''}`} tip="실행 알림" aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
      {!!unread && <span className="count count--accent" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      {!unread && error && <span className="count" aria-hidden="true">!</span>}
    </IconButton>
    {open && trigger.current && <Popover anchor={trigger.current} label="실행 알림" className="popover--notify notify" onClose={restore => { setOpen(false); if (restore) trigger.current?.focus(); }}>
      <div className="popover__head"><h2>실행 알림</h2><span className="caption">{page ? unread ? `미확인 ${unread}개` : '모두 확인함' : ''}</span></div>
      <div className="popover__body">
        {error && <Notice icon="alert" attention role="alert">{error} <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refresh()}>다시 확인</button></Notice>}
        {!page && !error ? <div className="notify__empty" role="status" aria-label="알림을 불러오는 중"><Skel width="70%" /><div style={{ height: 8 }} /><Skel width="50%" /></div>
          : <ul className="notify__list">{page?.notifications.length ? page.notifications.map(item => <li key={item.id}>
            <button type="button" className={`notify__item${item.readAt === null ? ' is-unread' : ''}`} disabled={busy} onClick={() => void read(item)}>
              <span className="notify__icon"><Icon name={statusIcon(item.status)} className="i--sm" /></span>
              <span className="notify__text"><strong className="ellipsis">{item.name} · {runLabels[item.status]}</strong><span className="caption">{item.kind === 'skill' ? '스킬' : '루틴'} · {fmt.when(item.createdAt)}</span></span>
              {item.readAt === null ? <span className="dot dot--attention" role="img" aria-label="미확인" /> : <span />}
            </button>
          </li>) : <li className="notify__empty caption">아직 실행 알림이 없습니다.</li>}</ul>}
        <p className="caption notify__note">이 Mac의 모든 실행 알림입니다. 항목을 열면 확인 처리됩니다.</p>
      </div>
      {page?.nextCursor && <div className="popover__foot"><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void loadMore()}>이전 알림 더 보기</button></div>}
    </Popover>}
  </>;
}

/** 실행 결과 창(시안 dialogs.openRunDetails). 실행 중이면 2초마다 다시 읽는다 */
export function RunDetails({ id }: { id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState<AutomationRun | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => updateLocation({ run: null });
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const active = !!run && isActive(run.status);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => automationApi.run(id, controller.signal).then(value => { if (!controller.signal.aborted) { setRun(value); setLoadError(''); } })
      .catch(e => { if (!controller.signal.aborted) setLoadError((e as Error).message); });
    void load();
    const timer = active ? setInterval(() => void load(), 2000) : undefined;
    return () => { controller.abort(); clearInterval(timer); };
  }, [id, active]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="dialog dialog--run" aria-labelledby="run-detail-title" onCancel={event => { event.preventDefault(); close(); }} onPointerDown={event => closeOnBackdrop(event, close)}>
    <header className="dialog__head"><h2 id="run-detail-title">{run?.name ?? '실행'} · 실행 결과</h2><IconButton icon="x" label="닫기" tip="닫기 (Esc)" autoFocus onClick={close} /></header>
    <div className="dialog__body">
      {loadError && <Notice icon="alert" attention role="alert">{loadError}</Notice>}
      {run ? <RunDetail run={run} busy={busy} error={error} onRetryOutput={() => act(async () => setRun(await automationApi.retryOutput(run.id)))} onDownload={name => act(() => automationApi.download(run.id, name))} />
        : !loadError && <div className="run" role="status" aria-label="실행 기록을 불러오는 중"><Skel width="100%" height={56} /><Skel width="60%" /></div>}
    </div>
    {run && (run.conversationId || isActive(run.status) || run.sourcePath) && <footer className="dialog__foot">
      <span className="caption mono">{run.sourcePath}</span>
      {run.conversationId && <button type="button" className="btn btn--line" onClick={() => openSkillConversation(run.conversationId!)}><Icon name="message" />대화 열기 · 후속 수정</button>}
      {isActive(run.status) && <button type="button" className="btn btn--line" disabled={busy || run.status === 'cancelling'} onClick={() => void act(async () => setRun(await automationApi.cancel(run.id)))}><Icon name="stop" />실행 취소</button>}
    </footer>}
  </dialog>;
}
