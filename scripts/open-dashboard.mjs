import { spawn } from 'node:child_process';

const url = process.argv[2];
if (!['http://127.0.0.1:8000', 'http://127.0.0.1:5173'].includes(url)) process.exit(1);
const [command, args] = process.platform === 'darwin' ? ['open', [url]]
  : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
const child = spawn(command, args, { stdio: 'ignore' });
const timer = setTimeout(() => child.kill(), 5000);
child.on('error', () => { clearTimeout(timer); console.info(`브라우저에서 직접 열어 주세요: ${url}`); });
child.on('exit', code => { clearTimeout(timer); if (code) console.info(`브라우저에서 직접 열어 주세요: ${url}`); });
