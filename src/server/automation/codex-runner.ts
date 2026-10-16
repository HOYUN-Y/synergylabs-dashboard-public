import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionSettings } from '../../shared/automation.js';
import type { ProcessRunner } from './runner.js';
import { AutomationError } from './errors.js';
import { processEnvironment } from '../platform/commands.js';

export function codexConfig(working: string, output: string) {
  const permissions = `permissions.dashboard.filesystem={ ":root"="deny", ":minimal"="read", ":tmpdir"="deny", ":slash_tmp"="deny", ${JSON.stringify(homedir())}="deny", ${JSON.stringify(working)}="read", ${JSON.stringify(output)}="write" }`;
  return ['default_permissions="dashboard"', permissions, 'permissions.dashboard.network.enabled=false',
    'approval_policy="never"', 'allow_login_shell=false', 'shell_environment_policy.inherit="none"',
    `shell_environment_policy.set=${process.platform === 'win32'
      ? '{' + Object.entries(processEnvironment()).filter(([key]) => ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC'].includes(key)).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',') + '}'
      : '{PATH="/usr/bin:/bin:/usr/sbin:/sbin"}'}`,
    ...(process.platform === 'win32' ? ['windows.sandbox="elevated"'] : []),
    'features.hooks=false', 'features.plugins=false', 'features.remote_plugin=false', 'features.multi_agent=false',
    'features.multi_agent_v2=false', 'features.shell_snapshot=false', 'features.skip_host_skill_discovery=true',
    'features.skill_search=false', 'project_doc_max_bytes=0',
    'web_search="disabled"', 'mcp_servers={}', 'analytics.enabled=false'];
}
export function parseCodex(text: string, expectedSession?: string) {
  let sessionId: string | undefined;
  let result: unknown;
  let completed = false;
  try {
    for (const line of text.split('\n').filter(line => line.trim())) {
      const event = JSON.parse(line);
      if (event.type === 'error' || event.type === 'turn.failed') throw new Error();
      if (event.type === 'thread.started') {
        if (sessionId && sessionId !== event.thread_id) throw new Error();
        sessionId = event.thread_id;
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        // 중간 설명은 무시하고 마지막 assistant 메시지만 구조화 결과로 해석한다.
        result = event.item.text;
      }
      if (event.type === 'turn.completed') completed = true;
    }
    if (!completed || typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(sessionId)
      || (expectedSession && sessionId !== expectedSession) || typeof result !== 'string') throw new Error();
    return { sessionId, value: JSON.parse(result) as unknown };
  } catch { throw new AutomationError('INVALID_RESULT'); }
}
export async function runCodex(args: { command: string; working: string; output: string; record: string;
  input: string; instructions: string; schema: object; execution: ExecutionSettings; sessionId?: string;
  persistent: boolean; timeout: number }, execute: ProcessRunner, signal: AbortSignal) {
  await mkdir(args.output, { recursive: true, mode: 0o700 });
  await mkdir(args.record, { recursive: true, mode: 0o700 });
  const schemaFile = join(args.record, 'response-schema.json');
  await writeFile(schemaFile, JSON.stringify(args.schema), { mode: 0o600, flag: 'wx' });
  const config = codexConfig(args.working, args.output);
  config.push(`developer_instructions=${JSON.stringify(args.instructions + '\n도구는 복사된 작업 자료를 읽고 output에 결과 파일을 만드는 데만 사용하세요. 외부 네트워크·개인 파일·설정·원본 변경은 지원하지 않습니다.')}`);
  if (args.execution.effort !== 'default') config.push(`model_reasoning_effort=${JSON.stringify(args.execution.effort)}`);
  const response = await execute({ command: args.command, cwd: args.working, timeout: args.timeout,
    args: ['exec', ...(args.sessionId ? ['resume', args.sessionId] : []), '--ignore-user-config', '--ignore-rules', '--strict-config',
      '--skip-git-repo-check', '--json', '--output-schema', schemaFile,
      ...(args.persistent ? [] : ['--ephemeral']),
      ...(args.execution.model === 'default' ? [] : ['--model', args.execution.model]),
      ...config.flatMap(value => ['-c', value]), '-'], input: args.input }, signal);
  if (response.code !== 0) throw new AutomationError('EXECUTION_FAILED');
  return parseCodex(response.stdout, args.sessionId);
}
