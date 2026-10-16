import { useEffect, useState } from 'react';
import { useSettingsForm, settingsChanged } from './settings-state';
import { automationApi } from './automation-api';
import { Notice } from './ui';
import type { WorkspaceSettings } from '../shared/workspace';

/** 작업 공간 탭: 공통 작업 공간 경로와 스킬 결과 저장 폴더(시안 settings workspace + 결과 저장 폴더) */
export function AutomationSettingsForm() {
  const [workspace, setWorkspace] = useState('');
  const [output, setOutput] = useState('');
  const [saved, setSaved] = useState<WorkspaceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changed = !!saved && (workspace !== saved.workspaceInput || output !== saved.outputInput);
  useSettingsForm('workspace', changed, saving);
  useEffect(() => {
    const controller = new AbortController();
    automationApi.settings(controller.signal).then(value => {
      if (!controller.signal.aborted) { setWorkspace(value.workspaceInput ?? value.workspace); setOutput(value.outputInput ?? ''); setSaved(value); }
    }).catch(() => { if (!controller.signal.aborted) setError('설정을 읽지 못했습니다. 서버 연결을 확인해 주세요.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  const save = async () => {
    setBusy(true); setSaving(true); setError(''); setNotice('');
    try {
      const result = await automationApi.save(workspace.trim(), output.trim());
      setWorkspace(result.workspaceInput); setOutput(result.outputInput); setSaved(result);
      settingsChanged('workspace'); setNotice('저장했습니다. 새 경로에서 자료를 확인합니다. 결과 저장 폴더는 새 대화부터 적용됩니다.');
    } catch (error) { setError(error instanceof Error ? error.message : '설정 저장에 실패했습니다.'); }
    finally { setBusy(false); setSaving(false); }
  };
  return <form className="settings__section" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>공통 작업 공간</h3>
    <p className="settings__lead">브랜드에셋 · 스킬 · 루틴 · 자료의 상위 폴더와 스킬 결과를 저장할 폴더를 지정합니다. 두 경로는 서로 독립적입니다.</p>
    <label className="field"><span>작업 공간 경로</span>
      <input className="input mono" value={workspace} onChange={event => { setWorkspace(event.target.value); setNotice(''); }} disabled={busy} placeholder="비우면 대시보드 소스 폴더의 상위 폴더" spellCheck={false} autoComplete="off" />
      <small>적용 중: <span className="mono">{saved?.workspace ?? '확인 중'}</span></small>
    </label>
    <label className="field"><span>스킬 결과 저장 폴더</span>
      <input className="input mono" value={output} onChange={event => { setOutput(event.target.value); setNotice(''); }} disabled={busy} placeholder="비우면 소스 폴더의 상위/output" spellCheck={false} autoComplete="off" />
      <small>적용 중: <span className="mono">{saved?.outputDirectory ?? '확인 중'}</span> · 스킬 · 대화 · 회차별 폴더에 추가 저장하며 기존 파일은 옮기거나 덮어쓰지 않습니다. 저장에 실패해도 결과는 앱 안에 남고, 실행 결과 창에서 저장만 다시 시도할 수 있습니다.</small>
    </label>
    <p className="field-help">직접 지정할 때는 존재하는 폴더의 절대경로를 입력하세요. 비우고 저장하면 기본값으로 돌아갑니다. 대기 · 실행 중인 작업이 있으면 바꿀 수 없습니다.</p>
    <p className="field-help">Claude · Codex CLI 설치와 로그인은 이 Mac에서 준비합니다. 도구 · 모델 · effort는 스킬별 실행 설정에서 고릅니다.</p>
    <div className="settings__actions"><button type="submit" className="btn btn--primary" disabled={busy || !changed}>저장</button></div>
    {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    {notice && <Notice icon="check" role="status">{notice}</Notice>}
  </form>;
}
