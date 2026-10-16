import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { defaultExecution } from '../shared/automation';
import type { AutomationItem, ExecutionOptions, ExecutionSettings } from '../shared/automation';
import { automationApi } from './automation-api';
import { Notice, Popover, Skel, toast } from './ui';

const effortLabel = (effort: string) => effort === 'default' ? '기본' : effort;
// 칸이 7개 이상이면(Codex) 칸이 좁아 긴 effort 이름이 옆 이름과 붙는다. 머리 글자만 줄이고, 원래 이름은 올렸을 때 · 읽어 주는 이름으로 둔다
const shortEffort: Record<string, string> = { medium: 'med', minimal: 'min' };
const providers: ExecutionSettings['provider'][] = ['claude', 'codex'];
const ROW = 32; // popups.css .exec__matrix의 줄 높이(grid-auto-rows)
const modelRows = (options: ExecutionOptions) => Math.max(1, ...options.providers.map(p => p.models.length));
// 마지막으로 불러온 판 줄 수(이 화면을 연 동안만 기억): 다음에 열 때 불러오는 동안의 자리를 같은 높이로 잡아, 불러온 뒤 팝오버가 움직이지 않게 한다
let lastRows = 6;

/** 실행 설정: 타일의 설정 버튼에 붙는 팝오버. 모델 × effort 판(시안 dialogs.openExecSettings, Rubric adjuster) */
export function SkillExecutionSettings({ item, anchor, onClose, onSaved }: {
  item: AutomationItem; anchor: HTMLElement; onClose: (restoreFocus: boolean) => void; onSaved: () => void;
}) {
  const matrix = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const [options, setOptions] = useState<ExecutionOptions | null>(null);
  const [value, setValue] = useState<ExecutionSettings>(defaultExecution);
  const [saved, setSaved] = useState<ExecutionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([automationApi.executionOptions(controller.signal), automationApi.skillSettings(item.id, controller.signal)])
      .then(([options, settings]) => { if (!controller.signal.aborted) { lastRows = modelRows(options); setOptions(options); setValue(settings.execution ?? defaultExecution); setSaved(settings.execution ?? defaultExecution); } })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '설정을 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [item.id]);
  // 불러오기 전 팝오버에 있던 포커스를 고른 칸으로 옮긴다
  useEffect(() => {
    const pop = matrix.current?.closest('.popover');
    if (options && pop && document.activeElement === pop) matrix.current?.querySelector<HTMLElement>('.exec__cell.is-on, .exec__cell:not(:disabled)')?.focus();
  }, [options]);
  // 키보드로 칸을 옮기면 다시 그린 뒤 고른 칸에 포커스를 둔다
  useEffect(() => { if (keyboard.current) { keyboard.current = false; matrix.current?.querySelector<HTMLElement>('.exec__cell.is-on')?.focus(); } }, [value]);
  const provider = options?.providers.find(p => p.id === value.provider);
  const model = provider?.models.find(m => m.id === value.model);
  const valid = !!model?.efforts.includes(value.effort);
  const efforts = provider ? [...new Set(provider.models.flatMap(m => m.efforts))] : [];
  // Claude · Codex를 바꿔도 팝오버 크기가 그대로이도록 모델 줄이 가장 많은 도구에 맞춰 판 자리를 잡는다(머리 줄 포함).
  // 크기가 바뀌면 팝오버가 다시 자리를 잡으며 위아래로 튄다. 불러오는 동안은 지난번 줄 수(처음은 6줄)로 잡아 둔다
  const area = ((options ? modelRows(options) : lastRows) + 1) * ROW;
  const save = async () => {
    if (busy || !valid) return;
    setBusy(true); setError('');
    try { await automationApi.saveExecution(item.id, value); onSaved(); onClose(true); toast(`${item.name} 실행 설정을 저장했습니다`); }
    catch (error) { setError(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.'); }
    finally { setBusy(false); }
  };
  const move = (event: KeyboardEvent) => {
    const step = ({ ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] } as Record<string, [number, number]>)[event.key];
    if (!step || !provider) return;
    event.preventDefault();
    const mi = Math.max(0, provider.models.findIndex(m => m.id === value.model)); const ei = Math.max(0, efforts.indexOf(value.effort));
    const next = provider.models[Math.max(0, Math.min(provider.models.length - 1, mi + step[0]))];
    const effort = efforts[Math.max(0, Math.min(efforts.length - 1, ei + step[1]))];
    if (next.efforts.includes(effort)) { keyboard.current = true; setValue({ ...value, model: next.id, effort }); }
  };
  return <Popover anchor={anchor} label={`${item.name} 실행 설정`} className="popover--exec" onClose={onClose}>
    <div className="popover__head"><h2>실행 설정</h2><span className="caption ellipsis exec__name" title={item.name}>{item.name}</span></div>
    <div className="popover__body exec">
      <div className="seg" role="radiogroup" aria-label="실행 도구">{providers.map(id => <button key={id} type="button" role="radio" aria-checked={value.provider === id} disabled={!options || busy}
        tabIndex={value.provider === id ? 0 : -1} /* 고른 도구만 Tab으로 오고 ← → 로 바꾼다(라디오 묶음) */
        onClick={() => { const first = options?.providers.find(p => p.id === id)?.models[0]; setValue({ provider: id, model: first?.id ?? 'default', effort: 'default' }); }}
        onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const other = id === 'claude' ? 'codex' : 'claude'; const first = options?.providers.find(p => p.id === other)?.models[0]; setValue({ provider: other, model: first?.id ?? 'default', effort: 'default' }); (event.currentTarget.parentElement?.querySelector(`[data-provider="${other}"]`) as HTMLElement | null)?.focus(); } }}
        data-provider={id}>{id === 'claude' ? 'Claude' : 'Codex'}</button>)}</div>
      {(options || !error) && <div className="exec__area" style={{ minHeight: area }}>
        {!options && <div role="status" aria-label="설정을 불러오는 중"><Skel width="100%" height={area} /></div>}
        {provider?.reason && <Notice icon="alert" attention className="exec__notice">{provider.reason}</Notice>}
        {options && saved && !valid && saved.provider === value.provider && saved.model === value.model && <Notice icon="info">저장된 설정({saved.model} · {effortLabel(saved.effort)})은 지금 고를 수 없습니다. 다른 칸을 골라 저장하세요.</Notice>}
        {!!provider?.models.length && <div className="exec__matrix" ref={matrix} role="grid" aria-label="모델과 effort" style={{ '--cols': efforts.length } as CSSProperties} onKeyDown={move}>
          <div className="exec__corner" role="presentation" />
          {efforts.map(effort => {
            const short = efforts.length >= 7 ? shortEffort[effort] : undefined;
            return <div key={effort} className="exec__colhead" role="columnheader" aria-label={short ? effort : undefined} data-tip={short ? effort : undefined}>{short ?? effortLabel(effort)}</div>;
          })}
          {provider.models.map(row => {
            const isRow = row.id === value.model;
            const selected = isRow ? efforts.indexOf(value.effort) : -1;
            return [<div key={`${row.id}-head`} className={`exec__rowhead${isRow ? ' is-on' : ''}`} role="rowheader" title={row.name}>{row.name}</div>,
              ...efforts.map((effort, column) => {
                const on = isRow && effort === value.effort && valid;
                return <button key={`${row.id}-${effort}`} type="button" role="gridcell" aria-label={`${row.name} · effort ${effortLabel(effort)}`} aria-selected={on} tabIndex={on || (!valid && column === 0 && row === provider.models[0]) ? 0 : -1}
                  className={`exec__cell${isRow && valid && column <= selected ? ' is-fill' : ''}${on ? ' is-on' : ''}${column === 0 ? ' is-first' : ''}`}
                  disabled={busy || !row.efforts.includes(effort)} onClick={() => setValue({ ...value, model: row.id, effort })}><i /></button>;
              })];
          })}
        </div>}
      </div>}
      {/* 안내는 불러오는 동안에도 보여 불러온 뒤 높이가 덜 바뀌게 한다 */}
      {(options || !error) && <p className="caption exec__note">새 작업부터 적용됩니다. 기존 대화는 시작할 때의 설정으로 이어지고, 높은 effort는 시간과 사용량이 늘어날 수 있어요.</p>}
      {error && <Notice icon="alert" attention role="alert">{error}</Notice>}
    </div>
    <div className="popover__foot">
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onClose(true)}>취소</button>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy || !valid} onClick={() => void save()}>저장</button>
    </div>
  </Popover>;
}
