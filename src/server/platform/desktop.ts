import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { processEnvironment } from './commands.js';
const execute = promisify(execFile);
export async function openBrowser(url: string) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('INVALID_URL');
  const root = processEnvironment().SystemRoot ?? 'C:\\Windows';
  const [command, args] = process.platform === 'win32' ? [join(root, 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', parsed.href]]
    : process.platform === 'darwin' ? ['/usr/bin/open', [parsed.href]] : ['xdg-open', [parsed.href]];
  await execute(command, args, { timeout: 10000, windowsHide: true });
}
export async function revealFile(file: string) {
  const root = processEnvironment().SystemRoot ?? 'C:\\Windows';
  if (process.platform === 'win32') {
    // Explorer may return exit code 1 after forwarding to an existing Explorer process.
    await execute(join(root, 'explorer.exe'), [`/select,${file}`], { timeout: 5000, windowsHide: true }).catch(error => {
      if (error.code !== 1) throw error;
    });
  } else if (process.platform === 'darwin') await execute('/usr/bin/open', ['-R', file], { timeout: 5000 });
  else throw new Error('UNSUPPORTED_PLATFORM');
}
