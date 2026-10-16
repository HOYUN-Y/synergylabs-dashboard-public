import { constants, closeSync, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { processEnvironment, windowsPowerShell } from './commands.js';

export function appDataDirectory(platform = process.platform, env = process.env) {
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SynergyLabs Dashboard');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'SynergyLabs Dashboard');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'synergylabs-dashboard');
}
const protectedDirectories = new Map<string, string>();
const aclScript = `$ErrorActionPreference='Stop'
$path=$env:SYNERGY_PRIVATE_DIRECTORY
$item=Get-Item -LiteralPath $path -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'LINK_DENIED' }
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($sid)
foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
 $rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $acl.AddAccessRule($rule)
}
$item.SetAccessControl($acl)`;
export async function privateDirectory(path: string) {
  rejectWindowsJunctions(path, true);
  await mkdir(path, { recursive: true, mode: 0o700 });
  rejectWindowsJunctions(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('PATH_DENIED');
  if (process.platform !== 'win32') { await chmod(path, 0o700); return; }
  const canonical = await realpath(path), stamp = `${info.dev}:${info.ino}`;
  if (protectedDirectories.get(canonical) === stamp) return;
  await promisify(execFile)(windowsPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', aclScript], {
    windowsHide: true, timeout: 10000, env: { ...processEnvironment(), SYNERGY_PRIVATE_DIRECTORY: canonical }
  });
  protectedDirectories.set(canonical, stamp);
}
function rejectWindowsJunctions(file: string, allowMissing = false) {
  if (process.platform !== 'win32') return;
  for (let part = resolve(file); ; part = dirname(part)) {
    try {
      if (lstatSync(part).isSymbolicLink()) throw Object.assign(new Error('PATH_DENIED'), { code: 'ELOOP' });
    } catch (error) { if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(part) === part) break;
  }
}
const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
export function openRegularSync(file: string) {
  rejectWindowsJunctions(file);
  const before = lstatSync(file), canonical = realpathSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw Object.assign(new Error('PATH_DENIED'), { code: 'ELOOP' });
  const fd = openSync(file, flags);
  try {
    const handle = fstatSync(fd), after = lstatSync(file);
    rejectWindowsJunctions(file);
    if (!handle.isFile() || after.isSymbolicLink() || handle.dev !== before.dev || handle.ino !== before.ino
      || handle.dev !== after.dev || handle.ino !== after.ino || canonical !== realpathSync(file)) throw new Error('FILE_CHANGED');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
export async function openRegular(file: string) {
  rejectWindowsJunctions(file);
  const before = await lstat(file), canonical = await realpath(file);
  if (!before.isFile() || before.isSymbolicLink()) throw Object.assign(new Error('PATH_DENIED'), { code: 'ELOOP' });
  const handle = await open(file, flags);
  try {
    const info = await handle.stat(), after = await lstat(file);
    rejectWindowsJunctions(file);
    if (!info.isFile() || after.isSymbolicLink() || info.dev !== before.dev || info.ino !== before.ino
      || info.dev !== after.dev || info.ino !== after.ino || canonical !== await realpath(file)) throw new Error('FILE_CHANGED');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
