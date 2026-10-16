import { Icon } from './Icon';
import { updateLocation, useSettingsRefresh } from './settings-state';
import { useEffect, useRef, useState } from 'react';
import { getAssetCatalog, getAssetFile } from './asset-api';
import { assetTypeLabels, copyAssetText } from '../shared/assets';
import type { Asset, AssetCatalog, AspectRatio } from '../shared/assets';
import { EmptyState, IconButton, Skel, closeOnBackdrop, toast } from './ui';

function useAssetResource(asset: Asset, key: string | undefined, html = false) {
  const identity = `${asset.id}@${asset.version}:${key ?? ''}:${html}`;
  const [resource, setResource] = useState({ identity: '', value: '', error: '' });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let url = '';
    void (async () => {
      try {
        const response = await getAssetFile(asset, key, controller.signal);
        const value = html ? await response.text() : URL.createObjectURL(await response.blob());
        if (!html) url = value;
        if (!controller.signal.aborted) setResource({ identity, value, error: '' });
        else if (url) URL.revokeObjectURL(url);
      } catch {
        if (!controller.signal.aborted) setResource({ identity, value: '', error: '미리보기를 읽지 못했습니다.' });
      }
    })();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [asset, key, html, identity]);
  return resource.identity === identity ? resource : { value: '', error: '' };
}

function FontPreview({ asset }: { asset: Asset }) {
  const file = useAssetResource(asset, asset.font ?? undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const family = `asset-font-${asset.id}`;
  useEffect(() => {
    if (!file.value) return;
    let cancelled = false;
    const font = new FontFace(family, `url("${file.value}")`);
    font.load().then(loaded => {
      if (cancelled) return;
      document.fonts.add(loaded); setReady(true);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; document.fonts.delete(font); };
  }, [file.value, family]);
  return <div className="pv__font" style={{ fontFamily: ready ? family : undefined }} data-tip={file.error || (failed ? '글꼴을 표시하지 못했습니다' : ready ? '실제 글꼴 미리보기' : '글꼴 불러오는 중')}>
    <strong>가나다 Aa</strong><span>함께 만드는 새로운 가능성</span>
    {(file.error || failed) && <small className="caption">글꼴을 표시하지 못했습니다</small>}
  </div>;
}

const extension = (asset: Asset) => asset.type === 'archive' ? 'ZIP' : asset.type === 'design-source' ? 'AI' : /\.([a-z0-9]{1,5})$/i.exec(asset.sourcePath)?.[1].toUpperCase() ?? 'FILE';
/** 미리보기(시안 .pv): 이미지 · 글꼴 · 파일 자리표시. 재생 중이면 애니메이션을 격리된 iframe으로 겹친다 */
function Preview({ asset, ratio, playing }: { asset: Asset; ratio: AspectRatio; playing: boolean }) {
  const image = useAssetResource(asset, asset.images[ratio]);
  const animation = useAssetResource(asset, playing ? asset.animations[ratio] : undefined, true);
  const [imageFailed, setImageFailed] = useState(false);
  const imageKey = asset.images[ratio];
  return <>
    {asset.font ? <div className="pv"><FontPreview asset={asset} /></div>
      : imageKey ? <div className={`pv pv--image${ratio === '9:16' ? ' pv--vertical' : ''}`}>
        {image.value && !imageFailed && <img key={image.value} src={image.value} alt={`${asset.name} 미리보기`} onError={() => setImageFailed(true)} />}
        {(image.error || imageFailed) && <div className="pv__file"><Icon name="image" /><span>미리보기를 표시하지 못했습니다</span></div>}
        {!image.value && !image.error && <span className="skel pv__skel" role="status" aria-label="미리보기 불러오는 중" />}
      </div>
        : <div className="pv"><div className="pv__file">{asset.type === 'image' ? <Icon name="image" /> : <strong>{extension(asset)}</strong>}<span>{asset.type === 'archive' ? '압축 자료 묶음' : asset.type === 'image' ? `${extension(asset)} · 원본 이미지` : '전용 도구에서 원본 확인'}</span></div></div>}
    {playing && animation.value && <iframe className="pv__frame" title={`${asset.name} ${ratio} 애니메이션 미리보기`}
      srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'">${animation.value}`}
      sandbox="allow-scripts" referrerPolicy="no-referrer" />}
    {playing && animation.error && <span className="pv__error caption">{animation.error}</span>}
  </>;
}

const quietStatus = ['사용 가능', '등록됨', 'available', 'ready'];
/** 긴 절대경로는 끝 두 단계만 보인다(전체는 올렸을 때) */
const shortPath = (path: string) => { const parts = path.split(/[\\/]/).filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path; };
const statusLabel = (status: string) => status === 'test-sample' ? '테스트 샘플' : status;
function CopyFallback({ text, onClose }: { text: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal(); area.current?.focus(); area.current?.select();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="dialog" aria-labelledby="asset-copy-title" onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => closeOnBackdrop(event, onClose)}>
    <header className="dialog__head"><h2 id="asset-copy-title">직접 복사하기</h2><IconButton icon="x" label="닫기" tip="닫기 (Esc)" onClick={onClose} /></header>
    <div className="dialog__body asset-copy">
      <p className="field-help">자동 복사가 되지 않았습니다. 아래 내용을 선택한 뒤 ⌘C 또는 Ctrl+C로 복사하세요.</p>
      <textarea ref={area} className="textarea mono" rows={9} readOnly value={text} aria-label="직접 복사할 사용 정보" onFocus={event => event.target.select()} />
    </div>
  </dialog>;
}

/** 에셋 라이브러리(시안 assets.html): 왼쪽 유형 · 작업 공간, 오른쪽 결과 머리 · 카드 격자. 검색 칸은 머리줄에 있다(App) */
export function AssetLibrary({ query, onClearQuery }: { query: string; onClearQuery: () => void }) {
  const [catalog, setCatalog] = useState<AssetCatalog | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const catalogRequest = useRef<AbortController | null>(null);
  const workspace = catalog?.root ?? '';
  const [type, setType] = useState('전체');
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fallback, setFallback] = useState('');
  const refresh = () => {
    catalogRequest.current?.abort();
    setCatalog(null); setBusy(true); setCopying(false); setCopiedId(null); setFallback('');
    setReload(n => n + 1);
  };
  useSettingsRefresh('workspace', refresh);
  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 1600);
    return () => clearTimeout(timer);
  }, [copiedId]);
  useEffect(() => {
    const controller = new AbortController();
    catalogRequest.current = controller;
    setBusy(true); setError(''); setCatalog(null); setPlaying(null); setFallback(''); setCopiedId(null);
    getAssetCatalog(controller.signal, reload > 0).then(data => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '에셋 목록을 읽지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => { setPlaying(null); }, [query]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) setPlaying(null); };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => { if (media.matches) setPlaying(null); };
    document.addEventListener('visibilitychange', hidden); media.addEventListener('change', reduced);
    return () => { document.removeEventListener('visibilitychange', hidden); media.removeEventListener('change', reduced); };
  }, []);
  const items = catalog?.items ?? [];
  const search = query.trim().normalize('NFC').toLocaleLowerCase();
  const results = items.filter(asset => (type === '전체' || assetTypeLabels[asset.type] === type)
    && [asset.name, asset.description, ...asset.tags].join(' ').normalize('NFC').toLocaleLowerCase().includes(search));
  async function copy(asset: Asset) {
    // 버튼을 막지 않고 중복만 거른다(막으면 포커스가 빠져 직접 복사 창을 닫은 뒤 돌아갈 곳이 없어진다)
    if (copying || busy || !catalog) return;
    let text: string;
    try { text = copyAssetText(asset, ratio, catalog.root); }
    catch { toast('경로 정보를 확인하지 못했습니다. 목록을 새로고침해 주세요.'); return; }
    const controller = catalogRequest.current;
    if (!controller || controller.signal.aborted) return;
    setCopying(true); setCopiedId(null); setFallback('');
    try {
      await navigator.clipboard.writeText(text);
      if (!controller.signal.aborted) { setCopiedId(`${asset.id}@${asset.version}`); toast(`‘${asset.name}’ 사용 정보를 복사했습니다`); }
    } catch { if (!controller.signal.aborted) setFallback(text); }
    finally { if (!controller.signal.aborted) setCopying(false); }
  }
  const openWorkspace = () => updateLocation({ settings: 'workspace' });
  const all = ['전체', ...Object.values(assetTypeLabels)];
  return <div className="lib">
    <aside className="lib__side" aria-label="에셋 유형">
      <nav className="lib__types" aria-label="유형">{all.map(category => {
        const count = category === '전체' ? items.length : items.filter(asset => assetTypeLabels[asset.type] === category).length;
        return <button key={category} type="button" className={`lib__type${count || !catalog ? '' : ' is-empty'}`} aria-pressed={type === category} onClick={() => { setType(category); setPlaying(null); setCopiedId(null); }}>
          <span>{category}</span><span className="tnum">{catalog ? count : ''}</span>
        </button>;
      })}</nav>
      <div className="lib__workspace">
        <span className="field-label">작업 공간</span>
        <div className="lib__workspace-row"><span className="mono" title={workspace}>{workspace ? shortPath(workspace) : '확인 중'}</span><IconButton icon="settings" label="작업 공간 설정" size="sm" onClick={openWorkspace} /></div>
        <span className="caption">브랜드에셋/manifest.json을 읽습니다. 사용 전 원본 안내와 라이선스를 확인하세요. ‘테스트 샘플’은 확인용 자료입니다.</span>
      </div>
    </aside>
    <section aria-labelledby="lib-title">
      <div className="lib__head">
        <h2 id="lib-title">{type} 에셋</h2>{catalog && <span className="count" aria-label={`에셋 ${results.length}개`} role="status">{results.length}</span>}
        <div className="lib__head-tools">
          <div className="seg lib__ratio" role="radiogroup" aria-label="샘플 비율">{(['16:9', '9:16'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={ratio === value}
            onClick={() => { setRatio(value); setPlaying(null); setCopiedId(null); }}
            onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const other = value === '16:9' ? '9:16' : '16:9'; setRatio(other); setPlaying(null); (event.currentTarget.parentElement?.querySelector(`[data-ratio="${other}"]`) as HTMLElement | null)?.focus(); } }}
            data-ratio={value}>{value}</button>)}</div>
          <IconButton icon="refresh" label="목록 새로고침" busy={busy} disabled={busy} onClick={refresh} />
        </div>
      </div>
      {!!catalog?.warnings.length && <details className="lib__warnings"><summary><Icon name="alert" className="i--sm" />읽지 못한 항목 {catalog.warnings.length}개</summary><ul>{catalog.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      {busy && !catalog ? <div className="lib__grid" role="status" aria-label="에셋 목록을 불러오는 중">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="asset asset--skel"><div className="asset__media"><span className="skel pv__skel" /></div><div className="asset__bar"><Skel width="60%" /></div></div>)}</div>
        : error ? <div className="lib__empty"><EmptyState icon="alert" title="에셋 목록을 읽지 못했습니다" text={error} role="alert"
          action={<button type="button" className="btn btn--line btn--sm" onClick={openWorkspace}><Icon name="settings" />작업 공간 설정</button>} /></div>
          : <div className="lib__grid" aria-live="polite">{results.length ? results.map(asset => {
            const id = `${asset.id}@${asset.version}`;
            const active = playing === id;
            const animated = !!asset.animations[ratio];
            return <article className={`asset${expanded === id ? ' is-open' : ''}${active ? ' is-playing' : ''}`} key={`${reload}:${id}`} tabIndex={0} aria-label={`${asset.name} · ${assetTypeLabels[asset.type]}`}
              onClick={event => { if (window.matchMedia('(hover: none)').matches && !(event.target as HTMLElement).closest('button, a')) setExpanded(expanded === id ? null : id); }}
              onPointerEnter={e => { if (e.pointerType === 'mouse' && animated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(id); }}
              onPointerLeave={e => { if (e.pointerType === 'mouse') setPlaying(previous => previous === id ? null : previous); }}
              onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPlaying(previous => previous === id ? null : previous); }}>
              <div className="asset__media">
                <Preview key={ratio} asset={asset} ratio={ratio} playing={active} />
                {!quietStatus.includes(asset.status) && <span className="badge badge--line pv__label" style={{ background: 'var(--paper)' }}>{statusLabel(asset.status)}</span>}
              </div>
              <div className="asset__bar"><h3 title={asset.name}>{asset.name}</h3><span className="caption">{assetTypeLabels[asset.type]}</span></div>
              <div className="asset__reveal">
                <p>{asset.description}</p>
                <div className="asset__reveal-row">
                  <span className="asset__meta" title={`${asset.tags.map(tag => `#${tag}`).join(' ')} · ${asset.license}`}>{asset.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}{asset.tags.length ? ' · ' : ''}{asset.license}</span>
                  {animated && <IconButton icon={active ? 'pause' : 'play'} label={`${asset.name} 미리보기 ${active ? '정지' : '재생'}`} tip={active ? '정지' : '재생'} variant="line" size="sm" aria-pressed={active} onClick={() => setPlaying(active ? null : id)} />}
                  <IconButton icon={copiedId === id ? 'check' : 'copy'} label={copiedId === id ? `${asset.name} 복사됨` : `${asset.name} 사용 정보 복사`} tip="사용 정보 복사" variant="solid" size="sm" aria-busy={copying} onClick={() => { void copy(asset); }} />
                </div>
              </div>
            </article>;
          }) : <div className="lib__empty" style={{ gridColumn: '1 / -1' }}><EmptyState icon="search" title={items.length === 0 ? '등록된 에셋이 없습니다' : query.trim() ? '검색 결과가 없습니다' : '이 유형의 에셋이 아직 없습니다'} text="manifest.json에 등록한 뒤 목록을 새로고침하세요."
            action={items.length ? <button type="button" className="btn btn--line btn--sm" onClick={() => { onClearQuery(); setType('전체'); }}>전체 에셋 보기</button> : undefined} /></div>}</div>}
    </section>
    {fallback && <CopyFallback text={fallback} onClose={() => setFallback('')} />}
  </div>;
}
