import { readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { sourceRoot } from './workspace-paths.js';

export interface WorkspaceInventory { root: string; folders: string[]; files: { path: string; name: string; modifiedAt: string }[]; warnings: string[] }
const ignored = /^(node_modules|output|dist|build|__pycache__|credentials|secrets)$/i;
const privateName = /secret|credential|token|password|\.key(?:\.|$)|\.pem$/i;
const snapshots = new Map<string, { at: number; flight: Promise<WorkspaceInventory> }>();
export function clearWorkspaceScan() { snapshots.clear(); }

export async function scanWorkspace(value: string, output = '', force = false): Promise<WorkspaceInventory> {
  const root = await realpath(value);
  const key = `${root}\0${output}`;
  const cached = snapshots.get(key);
  if (!force && cached) return cached.flight;
  const scan = async () => {
    const result: WorkspaceInventory = { root, folders: [''], files: [], warnings: [] };
    const excluded = await Promise.all([sourceRoot, ...(output && output !== root ? [output] : [])].map(path => realpath(path).catch(() => path.replace(/\/$/, ''))));
    let visited = 0, limited = false;
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (excluded.includes(directory)) return;
      if (depth > 12 || ++visited > 2000 || result.files.length >= 10000) { limited = true; return; }
      const path = relative(root, directory).split(sep).join('/');
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch { result.warnings.push(`${path || '.'}: 폴더를 읽지 못했습니다.`); return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ignored.test(entry.name) || privateName.test(entry.name) || entry.isSymbolicLink()) continue;
        const file = join(directory, entry.name), local = relative(root, file).split(sep).join('/');
        if (entry.isDirectory()) {
          if (excluded.includes(file)) continue;
          result.folders.push(local);
          await walk(file, depth + 1);
        } else if (entry.isFile()) {
          if (result.files.length >= 10000) { limited = true; break; }
          try { result.files.push({ path: local, name: entry.name, modifiedAt: (await stat(file)).mtime.toISOString() }); }
          catch { result.warnings.push(`${local}: 파일 정보를 읽지 못했습니다.`); }
        }
        if (visited > 2000) break;
      }
    };
    await walk(root, 0);
    if (limited) result.warnings.push('스캔 범위 제한(깊이 12·폴더 2,000·파일 10,000)에 도달했습니다. 더 구체적인 작업 공간을 지정하세요.');
    return result;
  };
  const flight = scan();
  if (snapshots.size > 8) snapshots.clear();
  snapshots.set(key, { at: Date.now(), flight });
  try { return await flight; } finally { if (snapshots.get(key)?.flight === flight) snapshots.delete(key); }
}
