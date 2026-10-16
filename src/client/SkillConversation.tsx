import { Icon } from './Icon';
import { OutputStatus } from './OutputStatus';
import { ArtifactFiles } from './RunParts';
import { ContextCandidates, ContextSources, DocPreview, chosenCandidate, withoutCandidateLines } from './SkillContext';
import type { PreviewTarget } from './SkillContext';
import { IconButton, Notice, closeOnBackdrop, statusIcon, toast } from './ui';
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { automationApi, AutomationApiError } from './automation-api';
import { isActive, runLabels } from '../shared/automation';
import type { SkillConversation as Conversation } from '../shared/automation';

function changeConversation(id?: string) {
  const [page, query] = window.location.hash.split('?');
  const params = new URLSearchParams(query);
  if (id) params.set('conversation', id); else params.delete('conversation');
  window.location.hash = `${page || '#/'}${params.size ? `?${params}` : ''}`;
}
export const openSkillConversation = (id: string) => changeConversation(id);
const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};
const errorText = (error: unknown) => error instanceof Error ? error.message : '대화를 처리하지 못했습니다.';
const attention = ['waiting_input', 'needs_input', 'failed'];

/** 스킬 대화: 대시보드를 보면서 쓰는 오른쪽 서랍(시안 dialogs.openChat) */
function ConversationDialog({ id }: { id: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);
  const focused = useRef(false);
  const pending = useRef<{ input: string; baseRunId: string; requestId: string } | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewing, setPreviewing] = useState<PreviewTarget | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const serial = ++sequence.current;
    try {
      const value = await automationApi.conversation(id, signal);
      if (!signal?.aborted && serial === sequence.current) { setConversation(value); setLoadError(''); }
      return value;
    } catch (error) { if (!signal?.aborted && serial === sequence.current) setLoadError(errorText(error)); }
  }, [id]);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      clearTimeout(timer);
      const value = document.visibilityState === 'hidden' ? null : await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void check(), value?.turns.some(turn => isActive(turn.run.status)) ? 2000 : 10000);
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    void check(); document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const latest = conversation?.turns.at(-1)?.run;
  const running = !!latest && isActive(latest.status);
  const canWrite = !!conversation?.canReply && !loadError && !running;
  const turns = conversation?.turns.length ?? 0;
  // 새 회차 · 문서 조회 단계가 오면 맨 아래로, 처음 쓸 수 있게 되면 입력칸으로
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [turns, latest?.status, latest?.context?.phase, latest?.context?.sources.length]);
  useEffect(() => { if (canWrite && !focused.current) { focused.current = true; input.current?.focus(); } }, [canWrite]);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  // 답변: 입력칸의 글 또는 고른 문서 후보의 상대경로. 같은 글을 다시 보내면 같은 요청 ID를 쓴다. 후보를 골라 보낼 때는 입력칸의 글을 지우지 않는다
  const submit = async (text: string, fromDraft: boolean) => {
    const value = text.trim();
    if (!latest || !value || !canWrite) return;
    if (!pending.current || pending.current.input !== value) pending.current = { input: value, baseRunId: latest.id, requestId: crypto.randomUUID() };
    await action(async () => {
      try { await automationApi.reply(id, pending.current!); }
      catch (error) {
        if (error instanceof AutomationApiError && error.code === 'STALE_TURN') { pending.current = null; await refresh(); }
        throw error;
      }
      pending.current = null; setNotice('답변을 전송했습니다.');
      if (fromDraft) { setDraft(''); if (input.current) input.current.style.height = ''; }
    });
  };
  const send = () => submit(draft, true);
  const targetId = conversation?.turns[0]?.run.targetId;
  // 현재 설정으로 처음부터 다시 실행: 새 대화가 생기면 그 대화로 옮겨 간다
  const restart = () => void action(async () => {
    const run = await automationApi.startSaved(targetId!);
    toast(`${conversation?.name ?? '스킬'} · 처음부터 다시 실행합니다`, 'restart');
    if (run.conversationId) changeConversation(run.conversationId);
  });
  const execution = conversation?.turns[0]?.run.execution;
  return <><dialog ref={dialog} className="dialog dialog--drawer chat" aria-labelledby="skill-chat-title" onCancel={event => { event.preventDefault(); changeConversation(); }} onPointerDown={event => closeOnBackdrop(event, () => changeConversation())}>
    <header className="dialog__head">
      <h2 id="skill-chat-title">{conversation?.name ?? '스킬'}</h2>
      {latest && <span className={`state-chip${attention.includes(latest.status) ? '' : ' state-chip--quiet'}`}>{runLabels[latest.status]}</span>}
      {running ? <IconButton icon="stop" label="실행 취소" tip="실행 취소" disabled={busy || latest!.status === 'cancelling'} onClick={() => void action(() => automationApi.cancel(latest!.id))} />
        : <IconButton icon="restart" label="처음부터 다시 실행" tip="현재 설정으로 처음부터 다시 실행" disabled={busy || !targetId} onClick={restart} />}
      <IconButton icon="x" label="대화 닫기" tip="닫기 (Esc)" onClick={() => changeConversation()} />
    </header>
    <div className="dialog__body"><div className="chat__body">
      <p className="chat__meta caption">{execution ? `${execution.provider === 'codex' ? 'Codex' : 'Claude'} · ${execution.model === 'default' ? '기본 모델' : execution.model} · effort ${execution.effort === 'default' ? '기본' : execution.effort}` : '실행 설정 확인 중'}<span> · 닫아도 실행은 계속됩니다 · 대화는 이 Mac과 선택한 CLI의 개인 세션 저장소에 보관됩니다</span></p>
      {loadError && <Notice icon="alert" attention role="alert">{loadError} <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refresh()}>다시 확인</button></Notice>}
      <div className="chat__log" ref={log} role="log" aria-label={`${conversation?.name ?? '스킬'} 대화 기록`}>
        {!conversation && !loadError && <p className="caption" role="status">대화를 불러오고 있습니다.</p>}
        {conversation?.turns.map(({ run, input: text }, index, all) => {
          const context = run.context;
          // 문서 조회(docs/SKILL_CONTEXT_API.md): 단계 문구는 실행 중에만 보인다(끝난 뒤에도 '작업을 이어갑니다'로 남음). 성공 여부는 run.status로만 본다.
          // 동명 문서 선택 질문은 서버 문장의 후보 목록 줄을 빼고 단추로 보인다
          const candidates = context?.phase === 'needs_selection' && run.status === 'waiting_input' ? context.candidates ?? [] : [];
          const reply = run.result ?? run.message;
          return <Fragment key={run.id}>
            <div className="chat__msg chat__msg--user"><span className="sr-only">사용자 · {run.turn}회차</span><p className="chat__text">{text || '스킬 시작 · 필요한 입력을 먼저 질문해 주세요.'}</p></div>
            <div className="chat__msg chat__msg--agent">
              <p className="chat__who"><Icon name={statusIcon(run.status)} className="i--xs" /><span>에이전트 · {runLabels[run.status]}</span></p>
              {(run.status === 'running' || run.status === 'queued') && !run.result ? <>
                <p className="chat__typing" aria-label="작성 중"><i /><i /><i /></p>
                {context && <p className="chat__step">{context.message}</p>}
              </> : <p className="chat__text">{candidates.length > 0 && run.result === context?.message ? withoutCandidateLines(reply, candidates) : reply}</p>}
              {candidates.length > 0 && <ContextCandidates candidates={candidates} canPick={index === all.length - 1 && canWrite && !busy}
                chosen={chosenCandidate(candidates, all[index + 1]?.input)} onPick={doc => void submit(doc.path, false)} onPreview={setPreviewing} />}
              {!!context?.sources.length && <ContextSources sources={context.sources} onPreview={setPreviewing} />}
              <OutputStatus run={run} onRetry={() => action(() => automationApi.retryOutput(run.id))} busy={busy} />
              <ArtifactFiles run={run} busy={busy} onDownload={name => action(() => automationApi.download(run.id, name))} />
            </div>
          </Fragment>;
        })}
      </div>
    </div></div>
    <footer className="dialog__foot">
      {conversation?.reason && <Notice icon="info">{conversation.reason}</Notice>}
      {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
      <p className="caption chat__usage">보낼 때마다 모델 사용량이 발생합니다<span className="sr-only" role="status">{notice}</span></p>
      <form className="chat__composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea ref={input} className="textarea chat__input" rows={1} maxLength={10000} value={draft} aria-label="답변 · 수정 요청" placeholder="질문에 답하거나 결과 수정을 요청하세요" disabled={busy || !canWrite}
          onChange={event => { setDraft(event.target.value); setNotice(''); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`; }}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} />
        <IconButton type="submit" icon="send" label="보내기" tip="보내기 (⌘ Enter)" variant="solid" disabled={busy || !canWrite || !draft.trim()} />
      </form>
    </footer>
  </dialog>
  {/* 미리보기는 대화 창 밖(형제)에 둔다: 위에 겹쳐 뜨고 Esc는 미리보기만 닫는다 */}
  {previewing && <DocPreview doc={previewing} onClose={() => setPreviewing(null)} />}</>;
}

export function SkillConversationHost() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const id = new URLSearchParams(hash.split('?')[1]).get('conversation');
  return id ? <ConversationDialog key={id} id={id} /> : null;
}
