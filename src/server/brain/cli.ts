import { parseArgs } from 'node:util';
import { MemoryError, recallMemory, reindexMemory, storeMemory } from './memory.js';
import { BrainConfigError } from './config.js';
import { ReviewError, answerReview, appendScheduleLog, inspectReview, markReview, reviewStatus, scheduledLine, showReview } from './review.js';
import { applyReviewUpdate, prepareReviewUpdate, runReviewUpdate } from './review-update.js';
import type { ReviewContext } from './review-update.js';
import type { ReviewStatus } from './review.js';

const usage = '사용법: npm run brain -- recall "질문" | store | reindex --workspace "절대경로". store 입력은 stdin JSON입니다. '
  + '점검: review run|prepare|apply|inspect|status --workspace "절대경로" [--state "상태 폴더"] [--scheduled], review show|answer <점검건ID>, '
  + 'review mark <점검건ID> --status applying|partial|failed|done [--note "..."] [--applied "상대경로"]... [--accept-new]. answer 입력은 stdin JSON입니다.';

async function stdinJson() {
  if (process.stdin.isTTY) throw new MemoryError('INVALID_INPUT', '입력 JSON을 표준입력으로 전달하세요.');
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > (process.argv.includes('apply') ? 2 * 1024 * 1024 : 65536)) throw new MemoryError('INVALID_INPUT', '입력 크기 제한(일반 64KiB, review apply 2MiB)을 넘었습니다.');
  }
  try { return JSON.parse(input) as unknown; } catch { throw new MemoryError('INVALID_INPUT', '표준입력은 JSON 객체여야 합니다.'); }
}

try {
  const { values, positionals } = parseArgs({ options: {
    workspace: { type: 'string' }, state: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' },
    applied: { type: 'string', multiple: true }, 'accept-new': { type: 'boolean' }, scheduled: { type: 'boolean' } }, allowPositionals: true });
  const [command, query, third] = positionals;
  if (!values.workspace) throw new MemoryError('INVALID_INPUT', usage);
  let result;
  if (command === 'review') {
    const options = { state: values.state };
    const needId = (id: string | undefined) => id ?? (() => { throw new ReviewError('INVALID_INPUT', usage); })();
    if (query === 'run' && positionals.length === 2) {
      result = await runReviewUpdate(values.workspace, { ...options, trigger: values.scheduled ? 'scheduled' : 'manual' });
      if (values.scheduled) {
        const { reviewDirectory } = await import('./review.js');
        await appendScheduleLog((await reviewDirectory(values.workspace, options)).stateDirectory, `${new Date().toISOString()} ${result.result} ${result.report ?? ''}`);
      }
    } else if (query === 'prepare' && positionals.length === 2) result = await prepareReviewUpdate(values.workspace, options);
    else if (query === 'apply' && positionals.length === 2) {
      const input = await stdinJson() as { context: ReviewContext; proposal: unknown };
      if (!input?.context || !input?.proposal) throw new ReviewError('INVALID_INPUT', 'context와 proposal을 전달하세요.');
      result = await applyReviewUpdate(values.workspace, input.context, input.proposal, options);
    } else if (query === 'inspect' && positionals.length === 2) {
      result = await inspectReview(values.workspace, options);
      if (values.scheduled) { await appendScheduleLog(result.stateDirectory, scheduledLine(result)); result = { result: result.result, case: result.case, additions: result.additions, message: result.message }; }
    } else if (query === 'status' && positionals.length === 2) result = await reviewStatus(values.workspace, options);
    else if (query === 'show' && positionals.length === 3) result = await showReview(values.workspace, needId(third), options);
    else if (query === 'answer' && positionals.length === 3) result = await answerReview(values.workspace, needId(third), await stdinJson(), options);
    else if (query === 'mark' && positionals.length === 3) result = await markReview(values.workspace, needId(third),
      { status: values.status as ReviewStatus | undefined, note: values.note, applied: values.applied, acceptNew: values['accept-new'] }, options);
    else throw new ReviewError('INVALID_INPUT', usage);
  } else {
    if (!['recall', 'store', 'reindex'].includes(command) || positionals.length !== (command === 'recall' ? 2 : 1)) throw new MemoryError('INVALID_INPUT', usage);
    if (command === 'store') result = await storeMemory(values.workspace, await stdinJson());
    else if (command === 'recall') result = await recallMemory(values.workspace, query);
    else result = await reindexMemory(values.workspace);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const known = error instanceof MemoryError || error instanceof ReviewError;
  const scheduled = process.argv.includes('--scheduled');
  const payload = { error: known ? error.code : error instanceof BrainConfigError ? 'CONFIG_INVALID' : 'MEMORY_UNAVAILABLE',
    message: known ? error.message : error instanceof BrainConfigError ? '세컨드 브레인 설정 형식을 확인하세요.' : '기억 · 점검 경로, 파일 권한, 입력 형식을 확인하세요.' };
  // 예약 실행(launchd)의 표준 오류는 예약 스크립트가 상태 폴더의 schedule-error.log로 보낸다
  console.error(JSON.stringify({ ...payload, ...(scheduled ? { at: new Date().toISOString(), scheduled: true } : {}) }));
  process.exitCode = 1;
}
