import { Icon } from './Icon';
import { Notice } from './ui';
import type { AutomationRun } from '../shared/automation';

/** 결과 폴더 저장 상태. 실패하면 모델을 다시 실행하지 않고 저장만 다시 시도한다 */
export function OutputStatus({ run, onRetry, busy = false }: { run: AutomationRun; onRetry: () => unknown; busy?: boolean }) {
  if (!run.output) return null;
  const failed = run.output.status === 'failed';
  return <Notice icon={failed ? 'alert' : 'folder'} attention={failed} role={failed ? 'alert' : 'status'} className="output-status">
    <span>{run.output.message}</span>
    <span className="mono output-status__path" title={run.output.directory}>{run.output.directory}</span>
    {failed && <button type="button" className={`btn btn--line btn--sm${busy ? ' is-busy' : ''}`} disabled={busy} onClick={() => void onRetry()}><Icon name="refresh" />결과 저장 다시 시도</button>}
  </Notice>;
}
