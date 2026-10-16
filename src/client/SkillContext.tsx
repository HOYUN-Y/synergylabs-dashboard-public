// 스킬 대화의 문서 조회 조각 — 후보 선택 · 참고 문서 · 현재 원본 미리보기(시안에 없음, 2026-10-16 B안).
// 스킬 대화와 실행 결과 창이 함께 쓴다. 계약은 docs/SKILL_CONTEXT_API.md
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fmt } from './format';
import { IconButton, Notice, closeOnBackdrop } from './ui';
import { brainApi, BrainApiError } from './brain/api';
import type { SkillDocumentCandidate, SkillDocumentSource } from '../shared/automation';
import type { BrainPreview } from '../shared/brain';

/** 미리볼 문서. 참고 문서는 전달한 본문의 해시가 있어 지금 원본과 비교한다 */
export type PreviewTarget = SkillDocumentCandidate & { hash?: string };

/** 서버 선택 질문에서 후보와 똑같은 목록 줄('1. 경로')만 뺀다. 후보는 단추로 따로 보이므로 두 번 나오지 않게 하고, 다른 안내 줄은 그대로 둔다 */
export function withoutCandidateLines(text: string, candidates: SkillDocumentCandidate[]) {
  const lines = new Set(candidates.map((c, i) => `${i + 1}. ${c.path}`));
  return text.split('\n').filter(line => !lines.has(line.trim())).join('\n').trimEnd();
}
const norm = (value: string) => value.normalize('NFC').toLocaleLowerCase().trim();
/** 지난 선택 회차에서 고른 후보: 다음 회차 답변이 상대경로 · 고유 파일명 · 번호와 맞을 때(서버의 선택 규칙과 같다) */
export function chosenCandidate(candidates: SkillDocumentCandidate[], answer?: string) {
  if (!answer) return undefined;
  const input = norm(answer), exact = candidates.filter(c => norm(c.path) === input || norm(c.name) === input);
  return exact.length === 1 ? exact[0] : /^\d{1,2}$/.test(input) ? candidates[Number(input) - 1] : undefined;
}
const folderOf = (doc: SkillDocumentCandidate) => doc.path.endsWith(`/${doc.name}`) ? doc.path.slice(0, -doc.name.length - 1) : doc.path === doc.name ? '' : doc.path;

/** 동명 문서 후보: 누르면 그 상대경로로 답한다. 최신 선택 대기 회차만 누를 수 있고, 지난 회차는 고른 후보만 표시한다 */
export function ContextCandidates({ candidates, chosen, canPick, onPick, onPreview }: {
  candidates: SkillDocumentCandidate[]; chosen?: SkillDocumentCandidate; canPick: boolean;
  onPick: (doc: SkillDocumentCandidate) => void; onPreview: (doc: PreviewTarget) => void;
}) {
  return <ul className="ctx-picks" aria-label="문서 후보">{candidates.map((doc, i) => {
    const folder = folderOf(doc) || '작업 공간 최상위';
    return <li key={doc.id} className={doc === chosen ? 'is-chosen' : undefined}>
      <button type="button" className="ctx-pick" disabled={!canPick} title={doc.path} onClick={() => onPick(doc)}
        aria-label={`${i + 1}번 ${doc.name} · ${folder}${doc === chosen ? ' · 고른 문서' : ''}`}>
        <span className="ctx-pick__no mono" aria-hidden="true">{i + 1}</span>
        <span className="ctx-pick__text"><span className="ctx-pick__name">{doc.name}</span><span className="ctx-pick__path mono">{folder}</span></span>
        {doc === chosen && <Icon name="check" className="i--sm" />}
      </button>
      <IconButton icon="eye" label={`${i + 1}번 ${doc.name} 현재 원본 미리보기`} tip="현재 원본 미리보기" size="sm" onClick={() => onPreview(doc)} />
    </li>;
  })}</ul>;
}

/** 참고 문서: 이번 회차에 읽어 모델에 전달한 본문의 출처. 실패 · 취소 회차에도 남지만 성공 표시는 하지 않는다 */
export function ContextSources({ sources, onPreview }: { sources: SkillDocumentSource[]; onPreview: (doc: PreviewTarget) => void }) {
  return <div className="ctx-refs">
    <p className="ctx-refs__head">참고 문서 {sources.length}</p>
    {/* 같은 문서를 회차 중에 다시 읽으면(내용이 바뀜) ID는 같고 해시만 다르다 */}
    <ul>{sources.map(doc => <li key={`${doc.id}-${doc.hash}`}>
      <Icon name="file" className="i--sm" />
      <span className="ctx-refs__text"><span className="ctx-refs__name" title={doc.name}>{doc.name}</span><span className="ctx-refs__path mono" title={doc.path}>{doc.path}</span></span>
      <time className="caption" dateTime={doc.readAt} title={`${fmt.at(doc.readAt)}에 읽음`}>{fmt.at(doc.readAt)}</time>
      <IconButton icon="eye" label={`${doc.name} 현재 원본 미리보기`} tip="현재 원본 미리보기" size="sm" onClick={() => onPreview(doc)} />
    </li>)}</ul>
  </div>;
}

async function sameText(content: string, hash: string) {
  if (!globalThis.crypto?.subtle) return null; // 안전한 주소(127.0.0.1 · localhost)가 아니면 비교하지 않는다
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') === hash;
}
const failure = (error: unknown) => !(error instanceof BrainApiError) ? '미리보기를 불러오지 못했습니다. 서버 연결을 확인해 주세요.'
  : error.code === 'UNSUPPORTED_TYPE' ? '텍스트 문서가 아니라 미리볼 수 없습니다. 대화에서도 UTF-8 텍스트 문서만 읽을 수 있습니다.'
    : error.code === 'FILE_TOO_LARGE' ? '500KiB를 넘는 문서라 미리볼 수 없습니다.' : error.message;

/** 현재 원본 미리보기(기존 세컨드 브레인 미리보기 API). 대화 때 전달한 본문은 공개하지 않으므로 해시로 같은지만 알린다.
 *  지도는 5분 동안 재사용되어 방금 만든 문서는 없을 수 있다 → 지도를 새로 읽고 다시 본다 */
export function DocPreview({ doc, onClose }: { doc: PreviewTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ preview?: BrainPreview; same?: boolean | null; error?: string; missing?: boolean }>({});
  const [rescan, setRescan] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current!; element.showModal();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    void (async () => {
      try {
        if (rescan) await brainApi.graph(controller.signal, true);
        const preview = await brainApi.preview(doc.id, controller.signal);
        const same = doc.hash ? await sameText(preview.content, doc.hash) : null;
        if (!controller.signal.aborted) setState({ preview, same });
      } catch (error) {
        if (!controller.signal.aborted) setState({ error: failure(error), missing: error instanceof BrainApiError && error.code === 'NOT_FOUND' });
      }
    })();
    return () => controller.abort();
  }, [doc, rescan]);
  const { preview, same, error, missing } = state;
  // 바깥 창(대화 · 실행 결과)의 onCancel까지 올라가 함께 닫히지 않게 막는다
  return <dialog ref={dialog} className="dialog bg-preview-dialog ctx-preview" aria-labelledby="ctx-preview-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onPointerDown={event => closeOnBackdrop(event, onClose)}>
    <header className="dialog__head"><h2 id="ctx-preview-title" className="ellipsis" title={doc.name}>{doc.name}</h2><span className="caption ctx-preview__kind">현재 원본</span>
      <IconButton icon="x" label="닫기" tip="닫기 (Esc)" onClick={onClose} /></header>
    <div className="dialog__body bg-preview">
      <p className="bg-preview__meta mono">{[doc.path, preview && `${fmt.num(preview.size)}바이트`, preview && `수정 ${fmt.when(preview.modifiedAt)}`].filter(Boolean).join(' · ')}</p>
      {preview ? <>
        {same === true ? <Notice icon="check" role="status">대화 때 전달한 본문과 같습니다.</Notice>
          : same === false ? <Notice icon="info" attention role="status">대화 뒤에 내용이 바뀌었습니다. 아래는 지금 원본이며, 전달한 본문은 이 Mac의 실행 기록에만 보관됩니다.</Notice>
            : <Notice icon="info" role="status">{doc.hash ? '지금 작업 공간의 원본입니다. 대화 때 전달한 본문과 다를 수 있습니다.' : '지금 작업 공간의 원본입니다. 이 후보를 고르면 그때의 내용을 읽어 전달합니다.'}</Notice>}
        <pre className="bg-preview__text">{preview.content}</pre>
      </> : error ? <Notice icon="alert" attention role="alert">
        {missing ? rescan ? '지도를 새로 읽어도 찾지 못했습니다. 이동 · 삭제됐거나 작업 공간이 바뀌었을 수 있습니다.' : '지금 지도에서 이 문서를 찾지 못했습니다. 이동 · 삭제됐거나, 방금 만든 문서라 지도에 아직 없을 수 있습니다.' : error}
        {missing && !rescan && <button type="button" className="btn btn--line btn--sm" onClick={() => setRescan(true)}><Icon name="refresh" />지도 새로 읽고 다시 보기</button>}
      </Notice> : <p className="caption" role="status">미리보기를 불러오는 중입니다.{rescan && ' 지도를 새로 읽고 있어 시간이 걸릴 수 있습니다.'}</p>}
    </div>
  </dialog>;
}
