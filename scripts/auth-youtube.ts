import { openBrowser } from '../src/server/platform/desktop.js';
import { resolveAuthClient, requireAuthClient, AuthSettingsError } from '../src/server/auth-settings.js';
import { beginYouTubeOAuth, YouTubeOAuth } from '../src/server/metrics/youtube-auth.js';
import { YouTubeAuthError, YouTubeAuthStore } from '../src/server/metrics/youtube-auth-store.js';

const args = process.argv.slice(2);
try {
  const store = new YouTubeAuthStore();
  if (args.length === 1 && args[0] === '--status') {
    const status = resolveAuthClient('youtube').status;
    console.info('다음 YouTube 로그인 설정:', JSON.stringify(status));
    if (status.validation !== 'valid') process.exitCode = 1;
    const connection = await store.connection();
    console.info(connection ? `YouTube 인증이 이 Mac에 등록되어 있습니다. 유효성은 수집 시 확인합니다.${connection.obsoleteIds.length ? ' 이전 키체인 항목 정리가 남아 있습니다.' : ''}` : 'YouTube 인증이 등록되지 않았습니다.');
  } else if (args.length === 1 && args[0] === '--disconnect') {
    await store.disconnect(); console.info('이 Mac의 YouTube 인증을 제거했습니다. 다른 Google 연결과 Drive 결과는 유지됩니다.');
  } else if (args.length === 0 || (args.length === 2 && args[0] === '--client-json' && args[1])) {
    const client = requireAuthClient(resolveAuthClient('youtube', { clientFile: args[1] }));
    const attempt = await beginYouTubeOAuth(client, new YouTubeOAuth(store));
    const cancel = () => attempt.cancel();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      console.info('브라우저에서 채널 소유자가 직접 로그인하고 읽기 권한을 승인해 주세요. 인증 대기는 5분입니다.');
      try { await openBrowser(attempt.url); }
      catch { attempt.cancel(); throw new YouTubeAuthError('BROWSER_FAILED'); }
      await attempt.done;
      console.info('대상 채널 확인과 키체인 저장이 완료됐습니다. 이후 수집은 인증을 자동 갱신합니다.');
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); attempt.cancel(); }
  } else {
    console.error('사용법: npm run auth:youtube [-- --client-json "JSON 절대 경로"] | -- --status | -- --disconnect'); process.exitCode = 1;
  }
} catch (error) {
  const code = error instanceof YouTubeAuthError || error instanceof AuthSettingsError ? error.code : 'UNEXPECTED_ERROR';
  console.error(`YouTube 인증 실패: ${code}. 키·인증 코드·토큰은 표시하지 않습니다. 설정·테스트 사용자·선택한 채널을 확인해 주세요.`);
  process.exitCode = 1;
}
