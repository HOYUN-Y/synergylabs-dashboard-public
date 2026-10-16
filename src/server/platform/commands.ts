import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

export interface Command { command: string; prefixArgs: string[] }
const packages: Record<string, string> = { codex: '@openai/codex', claude: '@anthropic-ai/claude-code', gws: '@googleworkspace/cli' };
const file = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
export function processEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const names = ['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'XDG_CONFIG_HOME',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'];
  return Object.fromEntries(names.flatMap(name => {
    const key = Object.keys(env).find(k => process.platform === 'win32' ? k.toLowerCase() === name.toLowerCase() : k === name);
    return key && env[key] !== undefined ? [[name, env[key]!]] : [];
  }));
}
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform): Command | null {
  const absolute = isAbsolute(name);
  if (absolute && /\.(?:c?js|mjs)$/i.test(name) && file(name)) return { command: process.execPath, prefixArgs: [name] };
  const directories = absolute ? [dirname(name)] : [...(processEnvironment(env).PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin')].filter(Boolean);
  const leaf = absolute ? basename(name) : name;
  const windows = platform === 'win32';
  for (const directory of directories) {
    // Prefer native binaries to extensionless Unix shims on Windows.
    for (const suffix of windows && !/\.(exe|com|cmd|bat)$/i.test(leaf) ? ['.exe', '.com', '.cmd', '.bat', ''] : ['']) {
      const candidate = resolve(directory, leaf + suffix);
      if (!file(candidate)) continue;
      if (!windows || /\.(exe|com)$/i.test(candidate)) return { command: candidate, prefixArgs: [] };
      if (!/\.(cmd|bat)$/i.test(candidate)) continue;
      const commandName = basename(candidate).replace(/\.(cmd|bat)$/i, '').toLowerCase();
      const packageName = packages[commandName];
      if (!packageName) continue;
      // Resolve only known npm package bins. Never evaluate a batch wrapper or user-supplied shell text.
      const root = join(dirname(candidate), 'node_modules', packageName);
      try {
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[commandName];
        if (manifest.name !== packageName || typeof bin !== 'string') continue;
        const entry = resolve(root, bin);
        if (!entry.startsWith(root + '\\') && !entry.startsWith(root + '/')) continue;
        if (!file(entry) || !/\.(?:c?js|mjs)$/i.test(entry)) continue;
        return { command: process.execPath, prefixArgs: [entry] };
      } catch { /* Unsupported installation: try the next PATH entry. */ }
    }
  }
  return null;
}
export function windowsPowerShell() {
  const root = processEnvironment().SystemRoot;
  if (!root) throw new Error('WINDOWS_RUNTIME_UNAVAILABLE');
  const executable = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!existsSync(executable)) throw new Error('WINDOWS_RUNTIME_UNAVAILABLE');
  return executable;
}
