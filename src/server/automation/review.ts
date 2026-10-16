import { readReviewReport, reportRun, runReviewUpdate } from '../brain/review-update.js';
import { ReviewError } from '../brain/review.js';
import type { AutomationStore } from './store.js';
import type { RunResult, Task } from './runner.js';

/** 일반 실행 ID와 변경 보고 ID를 공유해 알림·읽음·결과가 중복되지 않게 한다. */
export async function executeReviewTask(task: Task, signal: AbortSignal, store: AutomationStore, execute = runReviewUpdate): Promise<RunResult> {
  let message: string, status: RunResult['status'] = 'succeeded';
  try {
    const outcome = await execute(task.run.workspace, { runId: task.run.id, trigger: 'manual', signal, store, execution: task.run.execution });
    message = outcome.message;
    if (outcome.result === 'unchanged_pending') status = 'needs_input';
  } catch (error) {
    status = signal.aborted ? 'cancelled' : 'failed';
    message = signal.aborted ? '실행을 취소했습니다. 이미 반영한 변경과 백업은 유지됩니다.'
      : error instanceof ReviewError ? error.message : '자동 갱신에 실패했습니다. 실행 설정과 변경 보고를 확인해 주세요.';
  }
  const report = await readReviewReport(task.run.workspace, task.run.id);
  return { status: report ? report.status === 'interrupted' ? 'failed' : report.status === 'running' ? status : report.status : status,
    message: report?.message ?? message, result: report ? reportRun(report).result! : message,
    artifacts: [], artifactDirectory: store.runDirectory(task.run.id) };
}
