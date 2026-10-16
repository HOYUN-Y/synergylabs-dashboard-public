import { Icon } from './Icon';
import chatdaeriLogo from './brand/chatdaeri-logo.png';
import synergyLogo from './brand/synergylabs-logo-reverse.svg';
import { StartupStatus } from './StartupStatus';
import { SettingsModal } from './SettingsModal';
import { Notifications, RunDetails } from './Notifications';
import { SkillConversationHost } from './SkillConversation';
import { parseLocation, oauthReturnLocation } from './navigation';
import { updateLocation } from './settings-state';
import { useEffect, useRef, useState } from 'react';
import { ConnectionStatus } from './ConnectionStatus';
import { MailCard } from './MailCard';
import { CalendarCard } from './CalendarCard';
import { AssetLibrary } from './AssetLibrary';
import { AutomationPanels } from './AutomationPanels';
import { NewsletterMetricsCard } from './NewsletterMetricsCard';
import { YouTubeMetricsCard } from './YouTubeMetricsCard';
import { LinksCard } from './LinksCard';
import { SecondBrainGlobe } from './brain/SecondBrainGlobe';
import { DashboardVisible } from './dashboard-state';
import { fmt } from './format';
import { EmptyState, IconButton, useTooltips } from './ui';

/** 메인 화면(시안 dashboard.js 배치): 왼쪽 지표 · 캘린더 · 다른 대시보드, 가운데 세컨드 브레인 구체, 오른쪽 이메일 · 스킬 · 루틴 */
function Dashboard() {
  return (
    <div className="dash">
      <div className="dash__col dash__col--left">
        <div className="metrics"><YouTubeMetricsCard /><NewsletterMetricsCard /></div>
        <CalendarCard />
        <LinksCard />
      </div>
      <SecondBrainGlobe />
      <div className="dash__col dash__col--right">
        <MailCard />
        <AutomationPanels />
      </div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  return <time className="topbar__date mono" dateTime={new Date(now).toISOString()}>{fmt.dateLong(now)} {fmt.time(now)}</time>;
}

export function App() {
  useTooltips();
  const [hash, setHash] = useState(window.location.hash);
  const view = parseLocation(hash);
  const page = view.page;
  const [dashboardVisited, setDashboardVisited] = useState(page === 'dashboard');
  useEffect(() => { if (page === 'dashboard') setDashboardVisited(true); }, [page]);
  const [assetQuery, setAssetQuery] = useState('');
  const assetSearch = useRef<HTMLInputElement>(null);
  const guard = useRef<((discard?: boolean, proceed?: () => void) => boolean) | null>(null);
  const acceptedHash = useRef(hash);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  const title = page === 'assets' ? '에셋 라이브러리' : page === 'not-found' ? '페이지를 찾을 수 없습니다' : '대시보드';
  useEffect(() => {
    const changed = () => {
      const next = window.location.hash;
      const before = parseLocation(acceptedHash.current), after = parseLocation(next);
      const skillChanged = before.settings === 'skills' && after.settings === 'skills' && new URLSearchParams(acceptedHash.current.split('?')[1]).get('skill') !== new URLSearchParams(next.split('?')[1]).get('skill');
      if (before.settings && (before.settings !== after.settings || skillChanged) && guard.current && !guard.current(!after.settings || skillChanged, () => { guard.current = null; window.location.hash = next; })) {
        history.replaceState(null, '', acceptedHash.current || '#/'); return;
      }
      acceptedHash.current = next; setHash(next);
    };
    window.addEventListener('hashchange', changed);
    if (window.location.hash === '#/crm') { history.replaceState(null, '', '#/'); changed(); }
    try {
      const returned = oauthReturnLocation(window.location.hash, sessionStorage.getItem('dashboard-oauth-return'));
      if (returned) {
        sessionStorage.removeItem('dashboard-oauth-return'); history.replaceState(null, '', returned); changed();
      }
    } catch { /* Settings can still be opened when browser storage is unavailable. */ }
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    document.title = `${title} · 시너지랩스`;
    if (previousPage.current !== page) heading.current?.focus();
    previousPage.current = page;
  }, [page, title]);
  // 에셋 라이브러리: / 로 머리줄 검색 칸에 들어간다(시안)
  useEffect(() => {
    if (page !== 'assets') return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
      event.preventDefault(); assetSearch.current?.focus();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [page]);
  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); heading.current?.focus(); }}>본문으로 이동</a>
    <header className="topbar">
      <a className="topbar__brand" href="#/" aria-label={page === 'dashboard' ? '챗대리 대시보드 처음으로' : '대시보드로 돌아가기'}>
        <img src={chatdaeriLogo} alt="CHATdaeri" width={150} height={19} /><span className="topbar__by"><img src={synergyLogo} alt="SynergyLabs" width={88} height={13} /></span>
      </a>
      {page === 'assets' && <>
        <span className="topbar__crumb">에셋 라이브러리</span>
        <div className="topbar__center">
          <label className="search topbar__search"><Icon name="search" />
            <input ref={assetSearch} id="asset-search" className="input" type="search" placeholder="이름 · 설명 · 태그로 검색" aria-label="에셋 검색" autoComplete="off" value={assetQuery}
              onChange={event => setAssetQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && assetQuery) { event.stopPropagation(); setAssetQuery(''); } }} />
            <IconButton icon="x" label="검색어 지우기" tip={null} size="sm" className="search__clear" onClick={() => { setAssetQuery(''); assetSearch.current?.focus(); }} />
          </label>
        </div>
      </>}
      <div className="topbar__actions">
        <ConnectionStatus />
        <StartupStatus />
        {page !== 'assets' && <Clock />}
        <Notifications />
        <IconButton icon="settings" size="lg" label="설정 열기" tip="설정" aria-haspopup="dialog" onClick={() => updateLocation({ settings: 'workspace' })} />
      </div>
    </header>
    <main id="main-content" className={page === 'assets' ? 'lib-page' : 'dash-page'}>
      <h1 className="sr-only" ref={heading} tabIndex={-1}>{title}</h1>
      <DashboardVisible.Provider value={page === 'dashboard'}>
        <div hidden={page !== 'dashboard'}>{(dashboardVisited || page === 'dashboard') && <Dashboard />}</div>
      </DashboardVisible.Provider>
      {page === 'assets' ? <AssetLibrary query={assetQuery} onClearQuery={() => setAssetQuery('')} />
        : page === 'not-found' ? <div className="page-missing"><EmptyState icon="alert" title="잘못된 화면 주소" text="주소를 확인하거나 대시보드로 돌아가세요." action={<a className="btn btn--line btn--sm" href="#/">대시보드로 돌아가기</a>} /></div> : null}
    </main>
    {view.settings && <SettingsModal tab={view.settings} suspended={!!view.conversation || !!view.run}
      onTab={settings => updateLocation({ settings })} onClose={() => { guard.current = null; updateLocation({ settings: null, skill: null }); }} guardRef={guard} />}
    <SkillConversationHost />
    {!view.conversation && view.run && <RunDetails key={view.run} id={view.run} />}
  </>;
}
