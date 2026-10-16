import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrainCatalog } from '../shared/workspace';
import { useSettingsRefresh } from './settings-state';
import { useDashboardPolling } from './dashboard-state';

export function SecondBrain() {
  const [catalog, setCatalog] = useState<BrainCatalog | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);
  const lastSuccess = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/brain${force ? '?refresh=1' : ''}`, { cache: 'no-store', headers: { 'X-Dashboard-Request': '1' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.message ?? '자료 목록을 불러오지 못했습니다.');
      if (!controller.signal.aborted) { setCatalog(value); lastSuccess.current = Date.now(); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '자료 목록을 확인해 주세요.'); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }, []);
  useSettingsRefresh('workspace', () => {
    active.current?.abort(); active.current = null; setCatalog(null); setFolder(null); setPage(0); lastSuccess.current = 0; void refresh();
  });
  useDashboardPolling(refresh, 300000, lastSuccess);
  useEffect(() => () => { active.current?.abort(); }, []);
  const root = catalog?.nodes.find(node => node.parentId === null);
  const current = catalog?.nodes.find(node => node.id === folder && node.kind === 'folder') ?? root;
  const term = query.trim().normalize('NFC').toLocaleLowerCase();
  const items = (catalog?.nodes.filter(node => term ? node.kind === 'document' && `${node.name} ${node.path}`.normalize('NFC').toLocaleLowerCase().includes(term) : node.parentId === current?.id) ?? [])
    .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, 'ko'));
  const pages = Math.max(1, Math.ceil(items.length / 50)), selectedPage = Math.min(page, pages - 1);
  const copy = async (path: string) => {
    try { await navigator.clipboard.writeText(`${catalog!.root}/${path}`); setNotice('경로를 복사했습니다.'); }
    catch { setNotice('경로를 복사하지 못했습니다. 표시된 경로를 선택해 복사해 주세요.'); }
  };
  return <section className="panel brain-panel">
    <div className="panel-heading"><h2>세컨드 브레인</h2><span className="badge">{busy ? '스캔 중' : error ? '확인 필요' : `${catalog?.nodes.filter(node => node.kind === 'document').length ?? 0}개 문서`}</span></div>
    <div className="panel-content">
      <div className="mail-actions"><a href="#/?settings=workspace">경로 설정</a><button disabled={busy} onClick={() => void refresh(true)}>다시 스캔</button></div>
      {error && <p className="failed" role="alert">{error}</p>}
      {catalog && <>
        <p className="muted output-path">{catalog.root}</p>
        <p className="muted">{catalog.router ? `안내 문서: ${catalog.router}` : '라우팅 문서 없음 · 실제 폴더 구조를 기본 목록으로 표시합니다.'}</p>
        <label>문서 검색<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="문서 이름·경로" /></label>
        {!term && <div className="mail-actions"><button disabled={!current?.parentId} onClick={() => { setFolder(current?.parentId ?? null); setPage(0); }}>상위 폴더</button><span>{current?.path || '전체 폴더'}</span></div>}
        {catalog.warnings.map(warning => <p className="muted" key={warning}>{warning}</p>)}
        <ul className="brain-list">{items.slice(selectedPage * 50, (selectedPage + 1) * 50).map(node => <li key={node.id}>
          {node.kind === 'folder' ? <button onClick={() => { setFolder(node.id); setPage(0); }}>{node.name}/</button> : <><strong>{node.name}</strong><small>{node.extension} · {new Date(node.modifiedAt!).toLocaleString('ko-KR')}</small></>}
          <span className="output-path">{node.path}</span><button onClick={() => void copy(node.path)}>경로 복사</button>
        </li>)}</ul>
        {!items.length && <p>{term ? '일치하는 문서가 없습니다.' : '이 폴더에 표시할 문서·하위 폴더가 없습니다.'}</p>}
        {pages > 1 && <div className="mail-actions"><button disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)}>이전</button><span>{selectedPage + 1}/{pages}</span><button disabled={selectedPage + 1 === pages} onClick={() => setPage(selectedPage + 1)}>다음</button></div>}
        <p className="muted">마지막 스캔 {new Date(catalog.scannedAt).toLocaleString('ko-KR')} · 목록과 경로만 제공합니다.</p>
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>;
}
