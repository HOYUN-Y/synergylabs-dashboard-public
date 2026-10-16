import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutomationItem, AutomationRun } from '../../shared/automation.js';
import { runLabels } from '../../shared/automation.js';
import type { CollectionAttempt } from '../../shared/metrics-collection.js';
import { checkedFile } from './catalog.js';
import { AutomationError } from './errors.js';

export function metricsRun(attempt: CollectionAttempt, item: AutomationItem, cancelling = false): AutomationRun {
  const status = attempt.status === 'running' && cancelling ? 'cancelling'
    : attempt.errorCode === 'INTERRUPTED' ? 'interrupted' : attempt.status;
  const message = `${attempt.trigger === 'scheduled' ? '예약' : '수동'} 수집 · ${runLabels[status]}${attempt.errorCode ? ` (${attempt.errorCode})` : ''}`;
  return { id: attempt.id, targetId: item.id, kind: 'routine', name: item.name, sourcePath: item.path,
    // 실제 실행 코드는 서버 내장 수집기이며 작업 공간 정의를 실행한 것이 아니다.
    sourceHash: '', status, trigger: attempt.trigger, createdAt: attempt.startedAt, startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt, message,
    result: `${message}\n${attempt.snapshotSaved ? '지표 JSON을 저장했습니다.' : '저장 완료된 지표 JSON이 없습니다.'}${attempt.snapshotFile ? `\n${attempt.snapshotFile}` : ''}\n실행 기록·예약 상태는 이 Mac 기준입니다.`,
    artifacts: attempt.snapshotSaved && attempt.snapshotFile ? ['snapshot.json'] : [] };
}

export async function metricsArtifact(attempt: CollectionAttempt, name: string, outputDirectory: string) {
  if (name !== 'snapshot.json' || !attempt.snapshotSaved || !attempt.snapshotFile || !outputDirectory) throw new AutomationError('NOT_FOUND');
  const root = await realpath(outputDirectory).catch(() => { throw new AutomationError('PATH_DENIED'); });
  return readFile(await checkedFile(root, join(root, attempt.snapshotFile), 10 * 1024 * 1024));
}
