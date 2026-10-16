import { resolveAuthClient } from '../src/server/auth-settings.js';
import { spawnManaged, killManaged } from '../src/server/platform/process.js';
import { loadLocalEnv } from '../src/server/local-env.js';
import { gwsConfigDir } from '../src/server/mail/gws.js';

// env 설정 또는 기존 환경변수의 Google 데스크톱 클라이언트로 대시보드 전용 gws 로그인을 env/gws에 만든다.
// 개인 gws 설정(~/.config/gws)은 건드리지 않는다. 계정 선택 · 권한 승인은 사용자가 브라우저에서 직접 한다.
loadLocalEnv();
const resolved = resolveAuthClient('google');
const { clientId, clientSecret } = resolved.client ?? {};
if (!clientId || !clientSecret) {
  console.error(resolved.status.message); process.exitCode = 1;
} else {
  const child = spawnManaged('gws', ['auth', 'login', '--scopes', 'https://www.googleapis.com/auth/gmail.metadata'], {
    env: { ...process.env, GOOGLE_WORKSPACE_CLI_CONFIG_DIR: gwsConfigDir, GOOGLE_WORKSPACE_CLI_CLIENT_ID: clientId, GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: clientSecret } });
  process.stdin.pipe(child.stdin); child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  process.once('SIGINT', () => killManaged(child)); process.once('SIGTERM', () => killManaged(child));
  child.on('error', error => {
    console.error((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'gws를 찾지 못했습니다. npm install -g @googleworkspace/cli@0.22.5 후 다시 실행해 주세요.' : 'gws를 실행하지 못했습니다.');
    process.exitCode = 1;
  });
  child.on('exit', code => { process.stdin.unpipe(child.stdin); process.stdin.pause(); process.exitCode = code ?? 1; });
}
