// 실행 결과 조각 — 실행 결과 창 · 스킬 대화 · 실행 기록 목록이 함께 쓴다(시안 dialogs.openRunDetails · settings__history).
import { useState } from 'react';
import { Icon } from './Icon';
import { fmt } from './format';
import { OutputStatus } from './OutputStatus';
import { ContextSources, DocPreview } from './SkillContext';
import type { PreviewTarget } from './SkillContext';
import { Notice, statusIcon } from './ui';
import { updateLocation } from './settings-state';
import { runLabels } from '../shared/automation';
import type { AutomationRun } from '../shared/automation';

/** 결과 파일: 누르면 이 Mac에 내려받는다 */
export function ArtifactFiles({ run, busy, onDownload }: { run: AutomationRun; busy: boolean; onDownload: (name: string) => unknown }) {
  if (!run.artifacts.length) return null;
  return <div className="chat__files">{run.artifacts.map(name => <button key={name} type="button" className="file-chip" aria-label={`${name} 내려받기`} data-tip="내려받기" disabled={busy} onClick={() => void onDownload(name)}>
    <Icon name="file" className="i--sm" /><span>{name}</span><Icon name="download" className="i--sm" />
  </button>)}</div>;
}

const tool = (run: AutomationRun) => run.execution ? `${run.execution.provider === 'codex' ? 'Codex' : 'Claude'} · ${run.execution.model === 'default' ? '기본 모델' : run.execution.model} · ${run.execution.effort === 'default' ? '기본' : run.execution.effort}`
  : run.kind === 'routine' ? '루틴 스크립트' : '—';
/** 실행 결과 본문: 상태 · 시작 · 소요 · 실행 도구, 메시지, 결과 저장 상태, 결과 글, 결과 파일 */
export function RunDetail({ run, busy, error, onRetryOutput, onDownload }: {
  run: AutomationRun; busy: boolean; error: string; onRetryOutput: () => unknown; onDownload: (name: string) => unknown;
}) {
  const seconds = run.startedAt ? Math.max(0, ((run.finishedAt ? Date.parse(run.finishedAt) : Date.now()) - Date.parse(run.startedAt)) / 1000) : null;
  const [previewing, setPreviewing] = useState<PreviewTarget | null>(null);
  return <div className="run">
    <dl className="run__facts">
      <div><dt>상태</dt><dd><Icon name={statusIcon(run.status)} className="i--sm" />{runLabels[run.status]}</dd></div>
      <div><dt>시작</dt><dd>{fmt.when(run.createdAt)}</dd></div>
      <div><dt>소요</dt><dd className="tnum">{seconds === null ? '—' : fmt.elapsed(seconds)}</dd></div>
      <div><dt>실행 도구</dt><dd>{tool(run)}</dd></div>
      {run.trigger && <div><dt>실행 방식</dt><dd>{run.trigger === 'scheduled' ? '자동 예약' : '수동 실행'}</dd></div>}
    </dl>
    <p className="run__message" role="status">{run.message}</p>
    <OutputStatus run={run} busy={busy} onRetry={onRetryOutput} />
    {run.result && <pre className="run__result">{run.result}</pre>}
    {!!run.context?.sources.length && <ContextSources sources={run.context.sources} onPreview={setPreviewing} />}
    <ArtifactFiles run={run} busy={busy} onDownload={onDownload} />
    {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    {previewing && <DocPreview doc={previewing} onClose={() => setPreviewing(null)} />}
  </div>;
}

/** 실행 기록 목록: 누르면 실행 결과 창을 연다 */
export function RunHistory({ runs, showName = false }: { runs: AutomationRun[]; showName?: boolean }) {
  if (!runs.length) return <p className="caption">아직 실행 기록이 없습니다.</p>;
  return <ul className="settings__history">{runs.map(run => <li key={run.id}><button type="button" onClick={() => updateLocation({ run: run.id })}>
    <Icon name={statusIcon(run.status)} className="i--sm" />
    <span>{runLabels[run.status]}{showName && <span className="caption"> · {run.name}</span>}</span>
    <span className="caption">{fmt.when(run.createdAt)}</span>
    <Icon name="chevron-right" className="i--sm" />
  </button></li>)}</ul>;
}
