import { useEffect, useState } from 'react';
import { getHealth } from './api';
import { Icon } from './Icon';
import { getAssetCatalog } from './asset-api';
import { fmt } from './format';
import { useSettingsRefresh } from './settings-state';

/** 다른 대시보드(시안 cards.linksCard): 에셋 라이브러리로 가는 타일. 에셋 수는 실제 목록에서 읽고, 못 읽으면 숫자 없이 둔다.
    미리보기 세 칸은 에셋 수 · 브랜드 표시(장식) · 안테나(서버가 정상이면 주황 — 머리줄 서버 표시와 같은 /api/health 확인) */
export function LinksCard() {
  const [count, setCount] = useState<number | null>(null);
  const [server, setServer] = useState<'checking' | 'ok' | 'down'>('checking');
  const [revision, setRevision] = useState(0);
  useSettingsRefresh('workspace', () => setRevision(n => n + 1));
  useEffect(() => {
    const controller = new AbortController();
    getAssetCatalog(controller.signal).then(catalog => { if (!controller.signal.aborted) setCount(catalog.items.length); })
      .catch(() => { if (!controller.signal.aborted) setCount(null); });
    getHealth(controller.signal).then(() => { if (!controller.signal.aborted) setServer('ok'); })
      .catch(() => { if (!controller.signal.aborted) setServer('down'); });
    return () => controller.abort();
  }, [revision]);
  return <section className="card links" aria-labelledby="links-title">
    <header className="card__head"><h2 className="card__title" id="links-title"><Icon name="dashboard" />다른 대시보드</h2></header>
    <a className="link-tile" href="#/assets">
      <span className="link-tile__thumbs" aria-hidden="true">
        <i><svg viewBox="0 0 40 20"><text x="20" y="14.5" textAnchor="middle" fill="#fff" style={{ font: '600 12px var(--font-display)' }}>{count === null ? '—' : fmt.num(count)}</text></svg></i>
        <i><svg className="link-tile__spark" viewBox="-19.2 -9.7 19.5 19.4" fill="#fff"><path d="M 0,0 C -4.713,1.016 -8.417,4.72 -9.435,9.432 H -9.489 C -10.507,4.72 -14.211,1.016 -18.924,0 h -0.013 v -0.043 h 0.013 c 4.713,-1.016 8.417,-4.72 9.435,-9.433 h 0.054 c 1.018,4.713 4.722,8.417 9.435,9.433 h 0.048 l 0,0.043 z" /></svg></i>
        <i className="link-tile__signal" data-state={server}><svg viewBox="0 0 20 20">{[[3, 11], [8.5, 6], [14, 2]].map(([x, y]) => <rect key={x} x={x} y={y} width="3.5" height={17 - y} rx="1" fill="#79716b" />)}</svg></i>
      </span>
      <span className="link-tile__foot">
        <span className="link-tile__text"><strong>에셋 라이브러리</strong><span className="caption">{count === null ? '' : `${fmt.num(count)}개 · `}영상 샘플 · 로고 · 글꼴</span></span>
        <span className="link-tile__go"><Icon name="arrow-up-right" /></span>
      </span>
    </a>
  </section>;
}
