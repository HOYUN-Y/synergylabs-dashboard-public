import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MetricsCollection, repositoryRoot, scheduleFile, scheduleLabel } from '../src/server/metrics/collection.js';
import { CollectionStore } from '../src/server/metrics/collection-store.js';
import { loadLocalEnv } from '../src/server/local-env.js';
loadLocalEnv();
const execute = promisify(execFile);
const args = process.argv.slice(2);
const target = `gui/${process.getuid!()}/${scheduleLabel}`;
async function registered() {
  try { await execute('/bin/launchctl', ['print', target], { maxBuffer: 65536 }); return true; } catch { return false; }
}
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
try {
  if (process.platform !== 'darwin' || args.length !== 1 || !['--install', '--status', '--uninstall'].includes(args[0])) throw new Error();
  const file = scheduleFile();
  if (args[0] === '--install') {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Asia/Seoul') {
      console.error('예약 설치는 Mac 시간대가 Asia/Seoul일 때 지원합니다.'); process.exit(1);
    }
    const collection = new MetricsCollection();
    if (!collection.available('ghost') || !collection.available('youtube')) {
      console.error('두 지표의 API 환경변수와 Drive 저장 경로를 먼저 설정해 주세요.'); process.exit(1);
    }
    await execute('/usr/bin/which', ['yt-dlp']);
    const store = new CollectionStore(); await store.prepare();
    const command = [process.execPath, '--import', 'tsx', join(repositoryRoot, 'scripts/collect-metrics.ts'), '--scheduled'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${scheduleLabel}</string>
<key>ProgramArguments</key><array>${command.map(v => `<string>${escape(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(repositoryRoot)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>RunAtLoad</key><true/>
<key>StartCalendarInterval</key><dict><key>Minute</key><integer>0</integer></dict>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, xml, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(file, 'utf8') !== xml) throw new Error('EXISTING_SCHEDULE', { cause: e }); }
    await execute('/usr/bin/plutil', ['-lint', file]);
    if (!(await registered())) await execute('/bin/launchctl', ['bootstrap', `gui/${process.getuid!()}`, file]);
    console.info('매일 KST 09:00 수집·일시 실패 시간별 재시도 예약을 등록했습니다. 로그인·잠자기 복귀 시 누락을 확인합니다.');
  } else if (args[0] === '--uninstall') {
    if (await registered()) {
      const status = await new MetricsCollection().status();
      if (Object.values(status.services).some(v => v.lastAttempt?.status === 'running')) {
        console.error('수집 중에는 예약을 해제하지 않습니다. 완료 후 다시 실행해 주세요.'); process.exit(1);
      }
      await execute('/bin/launchctl', ['bootout', target]);
    }
    try {
      const xml = await readFile(file, 'utf8');
      if (!xml.includes(`<string>${scheduleLabel}</string>`) || !xml.includes(escape(join(repositoryRoot, 'scripts/collect-metrics.ts')))) throw new Error();
      await unlink(file);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    console.info('지표 수집 예약을 해제했습니다. 지표 JSON·인증·실행 상태는 유지합니다.');
  } else console.info(`지표 수집 예약: ${await registered() ? '등록됨 · 매일 KST 09:00, 실패 시 시간별 재시도' : '미등록'}`);
} catch { console.error('예약 설정을 처리하지 못했습니다. 사용법: npm run schedule:metrics -- --install | --status | --uninstall. 경로·권한·기존 예약을 확인해 주세요.'); process.exitCode = 1; }
