import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceRoot } from '../workspace-paths.js';
import { processEnvironment, resolveCommand, windowsPowerShell } from './commands.js';

let windowsScript: string | undefined;
export interface ProcessOptions { cwd?: string; env?: NodeJS.ProcessEnv; lockFile?: string }
export function spawnManaged(command: string, args: string[], options: ProcessOptions = {}): ChildProcessWithoutNullStreams {
  const env = { ...processEnvironment(), ...options.env };
  const target = resolveCommand(command, env) ?? { command, prefixArgs: [] };
  const targetArgs = [...target.prefixArgs, ...args];
  if (process.platform === 'win32') {
    windowsScript ??= readFileSync(join(sourceRoot, 'scripts', 'windows-process.ps1'), 'utf8');
    const request = JSON.stringify({ command: target.command, args: targetArgs, cwd: options.cwd ?? process.cwd(), parent: process.pid, lockFile: options.lockFile ?? null });
    return spawn(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', windowsScript], {
      env: { ...env, SYNERGY_PROCESS_REQUEST: Buffer.from(request).toString('base64') }, cwd: options.cwd,
      shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
  }
  const invocation = options.lockFile ? { command: '/usr/bin/lockf', args: ['-k', '-t', '0', options.lockFile, target.command, ...targetArgs] }
    : { command: target.command, args: targetArgs };
  return spawn(invocation.command, invocation.args, { cwd: options.cwd, env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function killManaged(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals = 'SIGTERM') {
  try {
    if (process.platform === 'win32') { if (child.exitCode === null && child.signalCode === null) child.kill(signal); }
    else if (child.pid) process.kill(-child.pid, signal);
  } catch { /* Already exited. Never act on a PID supplied by a state file. */ }
}
export function captureProcess(command: string, args: string[], options: ProcessOptions & { timeout?: number; maxBuffer?: number; signal?: AbortSignal; input?: string } = {}) {
  return new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('CANCELLED')); return; }
    const child = spawnManaged(command, args, options);
    let output = '', bytes = 0, failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string) => { if (failure) return; failure = new Error(reason); killManaged(child); killTimer = setTimeout(() => killManaged(child, 'SIGKILL'), 3000); };
    const abort = () => stop('CANCELLED');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('TIMEOUT'), options.timeout ?? 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { bytes += Buffer.byteLength(chunk); if (bytes > (options.maxBuffer ?? 1024 * 1024)) stop('OUTPUT_LIMIT'); else output += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > (options.maxBuffer ?? 1024 * 1024)) stop('OUTPUT_LIMIT'); });
    child.on('error', error => { failure = error; });
    child.stdin.on('error', () => {});
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve({ stdout: output, code });
    });
    child.stdin.end(options.input ?? '');
  });
}
