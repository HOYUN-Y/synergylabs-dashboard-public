import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { sourceRoot } from '../workspace-paths.js';
import { processEnvironment, windowsPowerShell } from './commands.js';

export interface ScheduleSpec { command: string; args: string[]; cwd: string; at: Date; hourly?: boolean; weekday?: number; once?: boolean }
export interface ScheduleStatus { registered: boolean; running: boolean; lastResult?: number }
// Only data crosses into PowerShell. No task or path input is interpolated as code.
const script = `$ErrorActionPreference='Stop'
$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SYNERGY_SCHEDULE_REQUEST)) | ConvertFrom-Json
$service=New-Object -ComObject 'Schedule.Service'; $service.Connect()
$folder=$service.GetFolder('\\')
$task=$null
try { $task=$folder.GetTask($r.name) } catch { if ($_.Exception.HResult -ne -2147024894) { throw } }
if ($task -and $task.Definition.RegistrationInfo.Source -ne $r.owner) { throw 'FOREIGN_TASK' }
if ($r.operation -eq 'status') {
 @{registered=($null -ne $task);running=($task -and $task.State -eq 4);lastResult=$(if($task){$task.LastTaskResult}else{0})} | ConvertTo-Json -Compress
} elseif ($r.operation -eq 'remove') {
 if ($task) { if ($task.State -eq 4) { throw 'TASK_RUNNING' }; $folder.DeleteTask($r.name,0) }
} elseif ($r.operation -eq 'install') {
 if ($task) { throw 'TASK_EXISTS' }
 $d=$service.NewTask(0)
 $d.RegistrationInfo.Source=$r.owner
 $d.RegistrationInfo.Description='SynergyLabs Dashboard: logged-in user only'
 $d.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $d.Principal.LogonType=3; $d.Principal.RunLevel=0
 $d.Settings.Enabled=$true; $d.Settings.Hidden=$true; $d.Settings.StartWhenAvailable=$true
 $d.Settings.DisallowStartIfOnBatteries=$false; $d.Settings.StopIfGoingOnBatteries=$false
 $d.Settings.MultipleInstances=2; $d.Settings.ExecutionTimeLimit='PT15M'
 $s=$r.spec
 $kind=2; if($s.once){$kind=1}elseif($null -ne $s.weekday){$kind=3}
 $trigger=$d.Triggers.Create($kind); $trigger.StartBoundary=$s.at; $trigger.Enabled=$true
 if($kind -eq 2){$trigger.DaysInterval=1}
 if($kind -eq 3){$trigger.WeeksInterval=1; $trigger.DaysOfWeek=[int][Math]::Pow(2,([int]$s.weekday % 7))}
 if($s.hourly){$trigger.Repetition.Interval='PT1H';$trigger.Repetition.Duration='P1D'}
 if($s.once){$trigger.EndBoundary=$s.end; $d.Settings.DeleteExpiredTaskAfter='PT1M'}
 $action=$d.Actions.Create(0); $action.Path=$r.host; $action.Arguments=$r.arguments; $action.WorkingDirectory=$s.cwd
 $null=$folder.RegisterTaskDefinition($r.name,$d,2,$d.Principal.UserId,$null,3,$null)
} else { throw 'INVALID_OPERATION' }`;

export async function windowsSchedule(operation: 'status' | 'install' | 'remove', name: string, spec?: ScheduleSpec): Promise<ScheduleStatus> {
  if (process.platform !== 'win32' || !/^(kr\.synergylabs\.dashboard\.metrics|com\.synergylabs\.dashboard\.brain-review|synergylabs-test-[a-f0-9-]{36})$/.test(name)) throw new Error('INVALID_TASK');
  if (operation === 'install' && (!spec || !Number.isFinite(spec.at.getTime()))) throw new Error('INVALID_SCHEDULE');
  const owner = `synergylabs:${createHash('sha256').update(resolve(sourceRoot).toLowerCase()).digest('hex')}`;
  // Encoded script is generated solely from JSON data, encoded a second time; arguments remain an array.
  const data = Buffer.from(JSON.stringify(spec ? { command: spec.command, args: spec.args } : {})).toString('base64');
  const launch = `$ErrorActionPreference='Stop';$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json;& $r.command @($r.args);exit $LASTEXITCODE`;
  const argumentsText = `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(launch, 'utf16le').toString('base64')}`;
  const request = { operation, name, owner, host: windowsPowerShell(), arguments: argumentsText,
    spec: spec && { ...spec, at: spec.at.toISOString(), end: new Date(spec.at.getTime() + 120000).toISOString() } };
  const { stdout } = await promisify(execFile)(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, timeout: 15000, maxBuffer: 65536, env: { ...processEnvironment(), SYNERGY_SCHEDULE_REQUEST: Buffer.from(JSON.stringify(request)).toString('base64') }
  }).catch(() => { throw new Error('WINDOWS_SCHEDULE_FAILED'); });
  return operation === 'status' ? JSON.parse(stdout) as ScheduleStatus : { registered: operation === 'install', running: false };
}

export function nextLocalTime(hour: number, minute: number) {
  const date = new Date(); date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}
