import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 5000);
  timer.unref();
}

for (const [name, args] of [
  ['서버', ['--import', 'tsx', 'src/server/index.ts']],
  ['화면', ['node_modules/vite/bin/vite.js']]
]) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name} 실행 실패: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} 프로세스가 종료되어 개발 환경을 함께 종료합니다.`);
      stop(code === 0 ? 0 : 1);
    }
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// 두 서버가 실제로 준비된 뒤 한 번만 연다. 개별 dev:server/client 명령은 자동으로 열지 않는다.
async function openWhenReady() {
  const deadline = Date.now() + 60000;
  while (!stopping && Date.now() < deadline) {
    try {
      const [api, page] = await Promise.all([
        fetch('http://127.0.0.1:8000/api/startup', { headers: { 'X-Dashboard-Request': '1' }, signal: AbortSignal.timeout(1000) }),
        fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(1000) })
      ]);
      if (api.ok && page.ok && (await api.json()).openReady && !stopping) {
        const browser = spawn(process.execPath, ['scripts/open-dashboard.mjs', 'http://127.0.0.1:5173'], { cwd, stdio: 'inherit' });
        browser.on('error', () => console.info('브라우저에서 http://127.0.0.1:5173 을 열어 주세요.'));
        return;
      }
    } catch { /* 서버가 포트를 열 때까지 기다린다. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!stopping) console.info('시작 상태를 확인한 뒤 http://127.0.0.1:5173 을 직접 열어 주세요.');
}
void openWhenReady();
