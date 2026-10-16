import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { AutomationCatalog, AutomationItem, AutomationRun } from '../shared/automation';
import { isActive } from '../shared/automation';
import { automationApi } from './automation-api';
import { useSettingsForm, settingsChanged, useSettingsRefresh, updateLocation } from './settings-state';
import { RunHistory } from './RunParts';
import { fmt } from './format';
import { Notice } from './ui';

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';

function SkillDetail({ item, onState }: { item: AutomationItem; onState: (state: { dirty: boolean; busy: boolean }) => void }) {
  const [input, setInput] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [historyError, setHistoryError] = useState('');
  const active = runs.some(run => isActive(run.status));
  useSettingsForm('skill-input', input !== saved, busy && loaded);
  useEffect(() => { onState({ dirty: input !== saved, busy }); }, [onState, input, saved, busy]);
  useEffect(() => {
    const controller = new AbortController();
    automationApi.skillSettings(item.id, controller.signal).then(value => {
      if (!controller.signal.aborted) { setInput(value.input); setSaved(value.input); setLoaded(true); }
    }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [item.id]);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void automationApi.skillHistory(item.id, controller.signal).then(value => {
        if (!controller.signal.aborted) { setRuns(value.runs); setHistoryError(''); }
      }).catch(error => { if (!controller.signal.aborted) setHistoryError(errorMessage(error)); });
    };
    refresh();
    const timer = setInterval(refresh, active ? 2000 : 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [item.id, active]);
  const save = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await automationApi.saveSkill(item.id, input);
      setInput(value.input); setSaved(value.input); settingsChanged('skills');
      setNotice(value.input ? '저장했습니다. 대시보드의 실행 버튼으로 실행하세요.' : '저장된 입력을 비웠습니다. 업무 스킬은 입력 없이도 시작해 필요한 내용을 질문할 수 있습니다.');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <>
    <div className="settings__skill">
      <p>{item.description}</p>
      <p className="mono caption">{item.path.normalize('NFC')}</p>
      {item.reason && <Notice icon="alert" attention role="status">{item.reason}</Notice>}
    </div>
    <form className="settings__section settings__section--inner" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="field"><span className="settings__label-row"><span>작업 요청 · 원문 자료</span><span className="caption tnum">{fmt.num(input.length)} / 10,000</span></span>
        <textarea className="textarea" rows={7} maxLength={10000} disabled={busy || !loaded} value={input} onChange={event => { setInput(event.target.value); setNotice(''); }} placeholder="원문과 원하는 결과를 입력하세요. 로컬 파일 경로 대신 원문을 붙여 넣습니다." />
        <small>이 Mac에 저장하고 실행 버튼을 누를 때마다 다시 씁니다. 빈 값으로 저장하면 입력을 비웁니다. 이미 대기 · 실행 중인 작업에는 반영되지 않습니다. 글 · HTML 생성과 공개 웹 조회를 지원하며 게시 · 업로드 · PPTX 변환 프로그램은 연결되지 않았습니다. 업무 스킬의 후속 답변 · 수정은 실행 기록의 대화에서 진행하세요.</small>
      </label>
      <div className="settings__actions"><button type="submit" className="btn btn--primary" disabled={busy || !loaded || input === saved}>입력 저장</button>{input !== saved && loaded && <span className="caption">저장하지 않은 변경이 있습니다</span>}</div>
      {notice && <Notice icon="check" role="status">{notice}</Notice>}
      {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    </form>
    <p className="field-label settings__history-title">실행 기록 · 결과</p>
    {historyError && <Notice icon="alert" attention role="alert">{historyError}</Notice>}
    <RunHistory runs={runs} />
  </>;
}

export function SkillSettings() {
  const [detailState, setDetailState] = useState({ dirty: false, busy: false });
  const onState = useCallback((state: { dirty: boolean; busy: boolean }) => setDetailState(state), []);
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const selected = new URLSearchParams(hash.split('?')[1] ?? '').get('skill');
  const [reload, setReload] = useState(0);
  useSettingsRefresh('workspace', () => setReload(n => n + 1));
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    automationApi.catalog(controller.signal).then(value => { if (!controller.signal.aborted) setCatalog(value); })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => controller.abort();
  }, [reload]);
  const skills = catalog?.items.filter(item => item.kind === 'skill') ?? [];
  const item = selected ? skills.find(item => item.id === selected) : skills[0];
  return <section className="settings__section" aria-labelledby="skill-settings-heading">
    <h3 id="skill-settings-heading">스킬 관리</h3>
    {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    {catalog?.warnings.map(warning => <Notice key={warning} icon="info" role="status">{warning}</Notice>)}
    {!catalog && !error && <p className="caption" role="status">스킬 목록을 확인하고 있습니다.</p>}
    {!!skills.length && <label className="field"><span>스킬 선택</span><select className="select" disabled={detailState.busy} value={item?.id ?? ''} onChange={event => { updateLocation({ settings: 'skills', skill: event.target.value }); }}>
      {!item && <option value="">스킬을 선택하세요</option>}
      {skills.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
    </select></label>}
    {catalog && !item && <Notice icon="info">해당 스킬이 없습니다. 작업 공간과 스킬 목록을 확인해 주세요.</Notice>}
    {item && <SkillDetail key={item.id} item={item} onState={onState} />}
  </section>;
}
