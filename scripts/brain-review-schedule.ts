// 세컨드 브레인 자동 갱신(brain review run --scheduled)의 macOS launchd 예약 등록 · 상태 · 해제.
// 지표 수집 예약과 별도 Label이다. 근거가 확인된 색인·기억을 갱신하고 모호한 항목만 보류한다.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { AutomationStore } from '../src/server/automation/store.js';
import { reviewDirectory } from '../src/server/brain/review.js';
import { sourceRoot } from '../src/server/workspace-paths.js';

const execute = promisify(execFile);
export const scheduleLabel = 'com.synergylabs.dashboard.brain-review';
const repositoryRoot = sourceRoot.replace(/\/$/, '');
const file = join(homedir(), 'Library', 'LaunchAgents', `${scheduleLabel}.plist`);
const target = () => `gui/${process.getuid!()}/${scheduleLabel}`;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
async function registered() {
  try { await execute('/bin/launchctl', ['print', target()], { maxBuffer: 65536 }); return true; } catch { return false; }
}
const usage = '사용법: npm run schedule:brain-review -- --install [--hour 9] [--minute 0] [--weekday 1-7] [--workspace "절대경로"] [--state "상태 폴더"] | --status | --uninstall. 기본은 매일 KST 09:00.';

try {
  const { values } = parseArgs({ options: { install: { type: 'boolean' }, status: { type: 'boolean' }, uninstall: { type: 'boolean' },
    hour: { type: 'string' }, minute: { type: 'string' }, weekday: { type: 'string' }, workspace: { type: 'string' }, state: { type: 'string' } } });
  const modes = [values.install, values.status, values.uninstall].filter(Boolean).length;
  if (process.platform !== 'darwin' || modes !== 1) throw new Error('USAGE');
  if (values.install) {
    if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Asia/Seoul') { console.error('예약 설치는 Mac 시간대가 Asia/Seoul일 때 지원합니다.'); process.exit(1); }
    const hour = Number(values.hour ?? 9), minute = Number(values.minute ?? 0), weekday = values.weekday === undefined ? null : Number(values.weekday);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59 || (weekday !== null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7))) throw new Error('USAGE');
    const workspace = values.workspace ?? (await new AutomationStore().settings()).workspace;
    if (!workspace) { console.error('작업 공간을 --workspace로 지정하거나 대시보드 설정 → 작업 공간에서 먼저 저장해 주세요.'); process.exit(1); }
    const paths = await reviewDirectory(workspace, { state: values.state });
    await mkdir(paths.stateDirectory, { recursive: true, mode: 0o700 });
    const command = [process.execPath, '--import', 'tsx', join(repositoryRoot, 'src/server/brain/cli.ts'), 'review', 'run', '--workspace', paths.workspace, '--scheduled', ...(values.state ? ['--state', values.state] : [])];
    const calendar = `<key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer>${weekday === null ? '' : `<key>Weekday</key><integer>${weekday % 7}</integer>`}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${scheduleLabel}</string>
<key>ProgramArguments</key><array>${command.map(v => `<string>${escape(v)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(repositoryRoot)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>RunAtLoad</key><false/>
<key>StartCalendarInterval</key><dict>${calendar}</dict>
<key>StandardOutPath</key><string>${escape(join(paths.stateDirectory, 'schedule-stdout.log'))}</string>
<key>StandardErrorPath</key><string>${escape(join(paths.stateDirectory, 'schedule-error.log'))}</string>
</dict></plist>\n`;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    try { await writeFile(file, xml, { flag: 'wx', mode: 0o600 }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(file, 'utf8') !== xml) { console.error('다른 내용의 기존 예약 파일이 있습니다. --uninstall로 해제한 뒤 다시 등록해 주세요.'); process.exit(1); }
    }
    await execute('/usr/bin/plutil', ['-lint', file]);
    if (!(await registered())) await execute('/bin/launchctl', ['bootstrap', `gui/${process.getuid!()}`, file]);
    console.info(`세컨드 브레인 자동 갱신을 ${weekday === null ? '매일' : `매주 요일 ${weekday}(1=월)`} KST ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}에 실행하도록 등록했습니다. 결과 · 로그: ${paths.stateDirectory}. 근거가 명확한 항목을 갱신하고 변경 보고를 남깁니다. 모호한 항목만 보류합니다.`);
  } else if (values.uninstall) {
    if (await registered()) await execute('/bin/launchctl', ['bootout', target()]);
    try {
      const xml = await readFile(file, 'utf8');
      if (!xml.includes(`<string>${scheduleLabel}</string>`) || !xml.includes(escape(join(repositoryRoot, 'src/server/brain/cli.ts')))) throw new Error('FOREIGN');
      await unlink(file);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    console.info('세컨드 브레인 점검 예약을 해제했습니다. 점검 건 · 기준점 · 로그는 상태 폴더에 유지합니다.');
  } else {
    let detail = '';
    try { const xml = await readFile(file, 'utf8'); const h = xml.match(/<key>Hour<\/key><integer>(\d+)/)?.[1], m = xml.match(/<key>Minute<\/key><integer>(\d+)/)?.[1], w = xml.match(/<key>Weekday<\/key><integer>(\d+)/)?.[1]; detail = ` · ${w === undefined ? '매일' : `주 1회(launchd Weekday ${w})`} ${h?.padStart(2, '0')}:${m?.padStart(2, '0')}`; } catch { /* 파일 없음 */ }
    console.info(`세컨드 브레인 점검 예약: ${await registered() ? `등록됨${detail}` : '미등록'}`);
  }
} catch (error) {
  console.error((error as Error).message === 'USAGE' ? usage : `예약 설정을 처리하지 못했습니다. ${usage} 경로 · 권한 · 기존 예약을 확인해 주세요.`);
  process.exitCode = 1;
}
