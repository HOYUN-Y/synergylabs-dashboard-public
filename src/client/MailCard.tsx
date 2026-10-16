import { Icon } from './Icon';
import { fmt } from './format';
import { EmptyState, IconButton, scrollHint } from './ui';
import { CardSkeleton, CardStatus, useDashboardPolling } from './dashboard-state';
import { updateLocation, useSettingsRefresh } from './settings-state';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailMessagesResponse } from '../shared/api';
import { MailApiError, mailApi } from './mail-api';

const reconnect = ['CONFIG_CHANGED', 'ACCOUNT_CHANGED', 'GWS_AUTH_REQUIRED', 'GWS_PERMISSION'];
export function MailCard() {
  const [result, setResult] = useState<MailMessagesResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const active = useRef<AbortController | null>(null);
  const lastSuccess = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setStatus('loading'); setError(null);
    try {
      const data = await mailApi.messages(controller.signal, force);
      if (!controller.signal.aborted) { setResult(data); setStatus('ready'); lastSuccess.current = Date.now(); }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof MailApiError && e.code === 'NOT_CONFIGURED') {
        setResult(null); setStatus('unconfigured');
      } else {
        if (e instanceof MailApiError && reconnect.includes(e.code)) setResult(null);
        setStatus('error'); setError(e);
      }
    } finally { if (active.current === controller) active.current = null; }
  }, []);

  useSettingsRefresh('mail', () => { active.current?.abort(); active.current = null; setResult(null); setError(null); setStatus('loading'); lastSuccess.current = 0; if (visible && !document.hidden) void refresh(); });
  const visible = useDashboardPolling(refresh, 300000, lastSuccess);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const loading = status === 'loading';
  const failed = status === 'error';
  const unread = result ? result.messages.filter(mail => !mail.seen).length : 0;
  const message = error instanceof Error ? error.message : '';
  const openSettings = () => updateLocation({ settings: 'mail' });
  return (
    <section className={`card mail${loading && result ? ' is-refetching' : ''}`} aria-labelledby="mail-card-heading" aria-busy={loading}>
      <header className="card__head">
        <h2 className="card__title" id="mail-card-heading"><Icon name="mail" />이메일</h2>
        {unread > 0 && <span className="count" aria-label={`안 읽은 메일 ${unread}개`}>{unread}</span>}
        {result && <span className="card__meta">받은편지함</span>}
        <CardStatus label={failed && result ? '조회 실패' : null} tip={message} />
        {status !== 'unconfigured' && <div className="card__tools"><IconButton icon="refresh" label="메일 새로고침" size="sm" className="reveal" busy={loading} disabled={loading} onClick={() => void refresh(true)} /></div>}
      </header>
      {loading && !result ? <CardSkeleton label="메일을 불러오는 중" rows={3} />
        : status === 'unconfigured' ? <EmptyState icon="mail" title="이메일이 연결되지 않았습니다" text="Gmail(gws) 또는 IMAP 계정 1개의 최근 메일 20건을 이곳에서 봅니다."
          action={<button type="button" className="btn btn--primary btn--sm" onClick={openSettings}><Icon name="plug" />이메일 연결</button>} />
          : !result ? <EmptyState icon="alert" title="메일을 불러오지 못했습니다" text={message || '연결 설정을 확인한 뒤 다시 시도해 주세요.'} role="alert"
            action={error instanceof MailApiError && reconnect.includes(error.code)
              ? <button type="button" className="btn btn--line btn--sm" onClick={openSettings}><Icon name="plug" />연결 설정</button>
              : <button type="button" className="btn btn--line btn--sm" onClick={() => void refresh(true)}><Icon name="refresh" />다시 시도</button>} />
            : result.messages.length === 0 ? <EmptyState icon="mail" title="받은편지함이 비어 있습니다" text="새 메일이 오면 5분 안에 표시됩니다." />
              : <ul className="mail__list card__body" ref={scrollHint} tabIndex={0} aria-label={`최근 메일 ${result.messages.length}건 · 읽음 상태는 바꾸지 않습니다`}>
                {result.messages.map(mail => <li key={mail.id} className={`mail__row${mail.seen ? '' : ' is-unread'}`}>
                  <span className="dot" role={mail.seen ? undefined : 'img'} aria-label={mail.seen ? undefined : '안 읽음'} />
                  <div className="mail__text"><p className="mail__from ellipsis">{mail.from}</p><p className="mail__subject ellipsis" title={mail.subject}>{mail.subject}</p></div>
                  <time className="mono" dateTime={mail.receivedAt ?? undefined}>{mail.receivedAt ? fmt.mailTime(mail.receivedAt) : '—'}</time>
                </li>)}
              </ul>}
      {result && <p className="card__foot">
        {failed && <span className="dot dot--attention" aria-hidden="true" />}
        <span title={failed ? message : undefined}>{failed ? `이전 결과 · ${fmt.time(result.fetchedAt)} 확인` : `${fmt.time(result.fetchedAt)} 확인 · 최근 ${result.messages.length}건`}</span>
      </p>}
    </section>
  );
}
