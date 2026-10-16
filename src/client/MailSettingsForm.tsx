import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { MailInput } from '../shared/api';
import { useSettingsForm, settingsChanged } from './settings-state';
import { mailApi } from './mail-api';
import { Icon } from './Icon';
import { IconButton, Notice, toast } from './ui';
import { ClientConfigStatus } from './ClientConfigStatus';
import type { AuthClientStatus } from '../shared/auth-settings';

const blank: MailInput = { host: '', port: 993, security: 'tls', username: '', password: '', mailbox: 'INBOX' };
// 대시보드 전용 gws 로그인(env/gws)을 만드는 명령(README · Google 연결 가이드). 아래 '다음 로그인에 쓸 클라이언트'가 이 명령에 쓰인다
const gwsCommand = 'npm run auth:gmail';

/** 이메일 탭(시안 settings mail): 연결 상태 줄 · 연결 방식 세그먼트 · gws 단계 안내 또는 IMAP 입력 · 연결 테스트 → 저장 */
export function MailSettingsForm() {
  const [dirty, setDirty] = useState(false);
  const [provider, setProvider] = useState<'imap' | 'gws'>('imap');
  const [account, setAccount] = useState('');
  const [savedProvider, setSavedProvider] = useState<'imap' | 'gws' | null>(null);
  const [savedAccount, setSavedAccount] = useState('');
  const [input, setInput] = useState<MailInput>(blank);
  const [configured, setConfigured] = useState(false);
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'testing' | 'saving' | 'disconnecting' | null>('loading');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [cleanupPending, setCleanupPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [client, setClient] = useState<AuthClientStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useSettingsForm('mail', dirty, busy !== null && busy !== 'loading');
  useEffect(() => {
    const controller = new AbortController();
    setBusy('loading');
    setLoadFailed(false);
    void mailApi.settings(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setInput(data.settings ? { ...data.settings, password: '' } : blank);
      setConfigured(!!data.settings || data.provider === 'gws');
      setProvider(data.provider ?? 'imap'); setSavedProvider(data.provider ?? (data.settings ? 'imap' : null));
      setAccount(data.account ?? ''); setSavedAccount(data.account ?? data.settings?.username ?? '');
      setCleanupPending(data.cleanupPending); setClient(data.gmailClientConfig ?? null);
      setError(''); setDirty(false);
    }).catch(e => {
      if (!controller.signal.aborted) { setLoadFailed(true); setError((e as Error).message); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, [reload]);

  function update<K extends keyof MailInput>(key: K, value: MailInput[K]) {
    setInput(previous => ({ ...previous, [key]: value }));
    setDirty(true); setTested(false);
    setNotice('');
    setError('');
  }
  function choose(next: 'imap' | 'gws') {
    if (next === provider) return;
    setDirty(true); setProvider(next); setTested(false); setAccount(''); setError(''); setNotice('');
    setInput(previous => ({ ...previous, password: '' }));
  }
  async function test(event: FormEvent) {
    event.preventDefault();
    setBusy('testing'); setError(''); setNotice(''); setTested(false);
    try { const result = await mailApi.test(provider === 'gws' ? { provider: 'gws' } : input);
      if (provider === 'gws') setAccount(result.account ?? '');
      setTested(true); setNotice(provider === 'gws' && result.account ? `연결 테스트 성공 · ${result.account}. 저장을 눌러 연결을 완료하세요.` : '연결 테스트 성공. 저장을 눌러 연결을 완료하세요.'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!tested) return;
    setBusy('saving'); setError(''); setNotice('');
    try {
      const result = await mailApi.save(provider === 'gws' ? { provider: 'gws', account } : input);
      setDirty(false); settingsChanged('mail');
      setConfigured(true); setSavedProvider(provider); setSavedAccount(provider === 'gws' ? account : input.username); setCleanupPending(result.cleanupPending);
      setNotice('연결 정보를 저장했습니다. 대시보드에서 최근 메일을 확인하세요.');
    } catch (e) { setError((e as Error).message); }
    finally { setInput(previous => ({ ...previous, password: '' })); setTested(false); setBusy(null); }
  }
  async function disconnect() {
    setBusy('disconnecting'); setError(''); setNotice('');
    try {
      await mailApi.disconnect();
      setDirty(false); settingsChanged('mail');
      setInput(blank); setAccount(''); setSavedAccount(''); setSavedProvider(null); setConfigured(false); setTested(false); setCleanupPending(false);
      setNotice('이 앱의 연결 정보를 삭제했습니다. 원래 메일은 그대로 유지됩니다.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  // 클라이언트 설정만 다시 읽는다(입력 중인 연결 정보는 그대로)
  async function recheck() {
    setChecking(true);
    try { setClient((await mailApi.settings()).gmailClientConfig ?? null); }
    catch (e) { setError((e as Error).message); }
    finally { setChecking(false); }
  }
  const copy = () => navigator.clipboard?.writeText(gwsCommand).then(() => toast('명령을 복사했습니다'), () => toast('복사하지 못했습니다. 직접 선택해 복사하세요.', 'alert'));
  const locked = busy !== null || loadFailed;

  return (
    <form className="settings__section" aria-labelledby="mail-settings-heading" onSubmit={event => void test(event)}>
      <h3 id="mail-settings-heading">이메일 연결</h3>
      <div className="settings__status">
        <span className="settings__status-icon"><Icon name="mail" /></span>
        <span className="settings__status-text"><strong>{configured ? `${savedProvider === 'gws' ? 'Gmail (gws)' : 'IMAP'} 연결됨` : '연결되지 않음'}</strong>
          <span className="caption">{configured ? savedAccount || '저장된 계정' : '계정 1개의 최근 메일 목록을 읽습니다'}</span></span>
        {configured && <span className="settings__status-tools"><button type="button" className="btn btn--ghost btn--sm" disabled={busy !== null} onClick={() => void disconnect()}>연결 해제</button></span>}
      </div>
      <p className="settings__lead">연결 방식을 바꾸면 새 연결을 확인한 뒤 기존 앱 연결 정보를 교체합니다. 본문 · 첨부 · 발송은 지원하지 않고, 읽음 상태도 바꾸지 않습니다.</p>
      <div className="field"><span>연결 방식</span>
        <div className="seg" role="radiogroup" aria-label="연결 방식">
          {([['gws', 'Gmail (gws)'], ['imap', 'IMAP']] as const).map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={provider === id} disabled={locked} onClick={() => choose(id)}
            onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const other = id === 'gws' ? 'imap' : 'gws'; choose(other); (event.currentTarget.parentElement?.querySelector(`[data-provider="${other}"]`) as HTMLElement | null)?.focus(); } }}
            data-provider={id}>{label}</button>)}
        </div>
      </div>
      <fieldset className="settings__fieldset" disabled={locked}>
        {provider === 'imap' ? <>
          <div className="settings__grid">
            <label className="field"><span>IMAP 서버</span><input className="input" required maxLength={253} value={input.host} onChange={e => update('host', e.target.value)} placeholder="imap.gmail.com" autoCapitalize="none" spellCheck={false} /></label>
            <label className="field"><span>포트</span><input className="input" required type="number" min="1" max="65535" value={input.port || ''} onChange={e => update('port', Number(e.target.value))} /></label>
            <label className="field"><span>보안 방식</span><select className="select" value={input.security} onChange={e => update('security', e.target.value as MailInput['security'])}><option value="tls">TLS</option><option value="starttls">STARTTLS 필수</option></select></label>
            <label className="field"><span>사용자명</span><input className="input" required maxLength={320} value={input.username} onChange={e => update('username', e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="전체 이메일 주소" /></label>
            <label className="field"><span>앱 비밀번호</span><input className="input" required type="password" maxLength={4096} value={input.password} onChange={e => update('password', e.target.value)} autoComplete="off" aria-describedby="app-password-help" />
              <small id="app-password-help">Gmail은 2단계 인증 후 발급한 16자리 앱 비밀번호를 공백 없이 입력합니다. 이 Mac의 키체인에 보관합니다. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Google 앱 비밀번호 관리</a></small></label>
            <label className="field"><span>메일함</span><input className="input" required maxLength={1024} value={input.mailbox} onChange={e => update('mailbox', e.target.value)} autoCapitalize="none" spellCheck={false} /></label>
          </div>
          <p className="field-help">Gmail 예시: imap.gmail.com · 993 · TLS · INBOX. 다른 서비스는 제공받은 IMAP 정보를 입력하세요.</p>
        </> : <ol className="settings__steps">
          <li><strong>터미널에서 Google 로그인</strong>
            <div className="code"><code>{gwsCommand}</code><IconButton icon="copy" label="명령 복사" size="sm" onClick={() => void copy()} /></div>
            <span className="caption">저장소 폴더에서 실행하면 아래 클라이언트로 대시보드 전용 gws 로그인(env/gws)을 만들고, 개인 gws 설정은 바꾸지 않습니다. gws CLI를 설치한 뒤 저장소 폴더에서 npm run auth:gmail로 로그인합니다. 연동 기준 버전 0.22.5 · 권한 gmail.metadata.</span>
            {client && <ClientConfigStatus status={client} label="다음 로그인에 쓸 클라이언트"
              tools={<IconButton icon="refresh" label="클라이언트 설정 다시 확인" size="sm" busy={checking} disabled={checking} onClick={() => void recheck()} />}>
              {client.validation === 'valid'
                ? <p className="field-help">지금 연결된 Gmail이 이 클라이언트로 로그인했는지는 알 수 없습니다. 클라이언트를 바꿨다면 위 명령으로 다시 로그인한 뒤 연결 테스트를 하세요.</p>
                : <Notice icon="alert" attention role="status">{client.validation === 'invalid' ? client.message : '다음 로그인에 쓸 Google 클라이언트가 없습니다. env/auth-settings.json에 OAuth JSON 파일명을 적거나 기존 환경변수를 설정해 주세요.'}{configured && ' 지금 연결과 메일 조회는 그대로 유지됩니다.'}</Notice>}
            </ClientConfigStatus>}</li>
          <li><strong>연결 테스트로 계정 확인</strong><span className="caption">받은편지함의 최근 20건 메타데이터만 읽습니다.{account && ` 확인된 계정: ${account}`}</span></li>
          <li><strong>저장</strong><span className="caption">연결 해제는 이 대시보드에만 적용되고 gws 로그인은 유지됩니다.</span></li>
        </ol>}
        <div className="settings__actions">
          <button type="submit" className={`btn btn--line${busy === 'testing' ? ' is-busy' : ''}`}><Icon name={busy === 'testing' ? 'refresh' : 'plug'} />{busy === 'testing' ? '확인 중…' : '연결 테스트'}</button>
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!tested}>{busy === 'saving' ? '저장 중…' : '저장'}</button>
        </div>
      </fieldset>
      {busy && busy !== 'testing' && <p className="caption" role="status">{busy === 'loading' ? '설정을 불러오는 중…' : busy === 'saving' ? '연결 재확인 및 저장 중…' : '연결 해제 중…'}</p>}
      {notice && <Notice icon="check" role="status">{notice}</Notice>}
      {cleanupPending && <Notice icon="info" role="status">이전 키체인 항목 정리가 남아 있습니다. 다음 저장 또는 연결 해제 시 다시 정리합니다.</Notice>}
      {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
      {loadFailed && <div className="settings__actions"><button type="button" className="btn btn--line btn--sm" onClick={() => setReload(n => n + 1)}><Icon name="refresh" />설정 다시 불러오기</button></div>}
    </form>
  );
}
