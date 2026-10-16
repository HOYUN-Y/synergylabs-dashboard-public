import { parseArgs } from 'node:util';
import { MemoryError, recallMemory, reindexMemory, storeMemory } from './memory.js';
import { BrainConfigError } from './config.js';

try {
  const { values, positionals } = parseArgs({ options: { workspace: { type: 'string' } }, allowPositionals: true });
  const [command, query] = positionals;
  if (!values.workspace || !['recall', 'store', 'reindex'].includes(command) || positionals.length !== (command === 'recall' ? 2 : 1))
    throw new MemoryError('INVALID_INPUT', '사용법: npm run brain -- recall "질문" | store | reindex --workspace "절대경로". store 입력은 stdin JSON입니다.');
  let result;
  if (command === 'store') {
    if (process.stdin.isTTY) throw new MemoryError('INVALID_INPUT', 'store 입력 JSON을 표준입력으로 전달하세요.');
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 65536) throw new MemoryError('INVALID_INPUT', '입력 크기 제한(64KiB)을 넘었습니다.');
    }
    let value: unknown;
    try { value = JSON.parse(input); } catch { throw new MemoryError('INVALID_INPUT', '표준입력은 JSON 객체여야 합니다.'); }
    result = await storeMemory(values.workspace, value);
  } else if (command === 'recall') result = await recallMemory(values.workspace, query);
  else result = await reindexMemory(values.workspace);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const known = error instanceof MemoryError;
  console.error(JSON.stringify({ error: known ? error.code : error instanceof BrainConfigError ? 'CONFIG_INVALID' : 'MEMORY_UNAVAILABLE',
    message: known ? error.message : error instanceof BrainConfigError ? '세컨드 브레인 설정 형식을 확인하세요.' : '기억 경로·파일 권한·입력 형식을 확인하세요.' }));
  process.exitCode = 1;
}
