import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { sourceRoot } from './workspace-paths.js';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadLocalEnv } from './local-env.js';

try { loadLocalEnv(); }
catch {
  console.error('서버 환경변수 파일을 불러오지 못했습니다. env/.env.local(또는 루트 .env.local) 접근 권한과 형식을 확인하세요.');
  process.exit(1);
}

const staticRoot = process.argv.includes('--static')
  ? fileURLToPath(new URL('../client/', import.meta.url))
  : undefined;
const app = buildApp(staticRoot);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { stopping = true; await app.close(); });
}

try {
  if (staticRoot) await access(new URL('../client/index.html', import.meta.url));
  await app.listen({ host: '127.0.0.1', port: 8000 });
  app.startup.start();
  console.info('대시보드 서버: http://127.0.0.1:8000 · 자료와 연결 상태를 준비합니다.');
  if (staticRoot) {
    while (!stopping && !app.startup.status().openReady) await new Promise(resolve => setTimeout(resolve, 250));
    if (!stopping) {
      const browser = spawn(process.execPath, [join(sourceRoot, 'scripts/open-dashboard.mjs'), 'http://127.0.0.1:8000'], { stdio: 'inherit' });
      browser.on('error', () => console.info('브라우저에서 http://127.0.0.1:8000 을 열어 주세요.'));
    }
  }
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE'
    ? '8000 포트가 사용 중입니다. 사용 중인 프로그램을 확인한 후 다시 실행하세요.'
    : code === 'ENOENT'
      ? '화면 빌드가 없습니다. npm run build 후 다시 실행하세요.'
      : '서버를 시작하지 못했습니다. 실행 환경과 포트 접근 권한을 확인하세요.');
  await app.close();
  process.exitCode = 1;
}
