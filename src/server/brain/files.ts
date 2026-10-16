import { lstat, realpath } from 'node:fs/promises';
import { openRegular } from '../platform/storage.js';
import { revealFile } from '../platform/desktop.js';
import { join, relative, isAbsolute, sep } from 'node:path';
import { sourceRoot } from '../workspace-paths.js';

export class BrainError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export const textExtensions = new Set(['.md', '.txt', '.json', '.csv', '.vtt', '.srt', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.css', '.svg', '.py', '.yaml', '.yml', '.toml', '.xml', '.sh']);
const blocked = /^(node_modules|output|dist|build|__pycache__|credentials|secrets)$/i;
const privateName = /secret|credential|token|password|api[-_]?key|\.key(?:\.|$)|\.pem$/i;
export const excludedPath = (path: string) => path.split('/').some(part => part.startsWith('.') || blocked.test(part) || privateName.test(part));
const inside = (root: string, target: string) => { const rel = relative(root, target); return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };

export async function checkedPath(root: string, path: string, output: string) {
  if (path && (isAbsolute(path) || path.includes('\0') || path.includes('\\') || excludedPath(path))) throw new BrainError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
  const base = await realpath(root);
  const source = await realpath(sourceRoot);
  const outputRoot = output ? await realpath(output).catch(() => output) : '';
  let current = base;
  for (const part of path ? path.split('/') : []) {
    if (!part || part === '..' || part === '.') throw new BrainError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new BrainError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
  }
  const resolved = await realpath(current);
  if (!inside(base, resolved) || inside(source, resolved) || (outputRoot && outputRoot !== base && inside(outputRoot, resolved))) throw new BrainError('NOT_FOUND', 404, '자료를 찾을 수 없습니다.');
  return resolved;
}

export async function readText(root: string, path: string, output: string, limit: number) {
  const file = await checkedPath(root, path, output);
  const handle = await openRegular(file);
  try {
    const info = await handle.stat();
    const current = await lstat(await checkedPath(root, path, output));
    if (current.dev !== info.dev || current.ino !== info.ino) throw new BrainError('NOT_FOUND', 404, '자료가 변경되었습니다. 다시 스캔해 주세요.');
    if (!info.isFile()) throw new BrainError('UNSUPPORTED_TYPE', 415, '텍스트 파일만 미리볼 수 있습니다.');
    if (info.size > limit) throw new BrainError('FILE_TOO_LARGE', 413, '미리보기 또는 링크 분석 크기 제한을 넘었습니다.');
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) { const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null); if (!bytesRead) break; length += bytesRead; }
    if (length > limit) throw new BrainError('FILE_TOO_LARGE', 413, '파일 크기 제한을 넘었습니다.');
    if (bytes.subarray(0, length).includes(0)) throw new BrainError('UNSUPPORTED_TYPE', 415, '바이너리 파일은 미리볼 수 없습니다.');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new BrainError('UNSUPPORTED_TYPE', 415, 'UTF-8 텍스트만 미리볼 수 있습니다.'); }
    if (await checkedPath(root, path, output) !== file) throw new BrainError('NOT_FOUND', 404, '자료가 변경되었습니다. 다시 스캔해 주세요.');
    return { content, size: length, modifiedAt: info.mtime.toISOString(), stamp: `${info.mtimeMs}:${info.ctimeMs}:${info.size}` };
  } finally { await handle.close(); }
}

export async function revealInFinder(path: string): Promise<void> {
  try { await revealFile(path); }
  catch { throw new BrainError('REVEAL_FAILED', 503, '파일 위치를 표시하지 못했습니다. 경로를 복사해 확인해 주세요.'); }
}
