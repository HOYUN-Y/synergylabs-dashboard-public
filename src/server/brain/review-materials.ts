// A nearby README is context, not proof that it describes every file below it.
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { createLinkResolver, extractLinks, normalized, routingRows } from './links.js';
import { readText, excludedPath, BrainError } from './files.js';
import type { BrainConfig } from './config.js';

export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const metadataName = (path: string) => /^(meta|metadata|manifest)\.json$/i.test(posix.basename(path));
export const isMaterial = (path: string, config: BrainConfig) => !/\.md$/i.test(path) && !excludedPath(path)
  && !config.areas.some(a => [config.memory?.areaId, 'skills', 'routines'].includes(a.id) && (normalized(path) === a.folder || normalized(path).startsWith(`${a.folder}/`)));
export const ancestors = (path: string) => {
  const result: string[] = [];
  for (let dir = posix.dirname(path); dir !== '.'; dir = posix.dirname(dir)) result.push(dir);
  return result;
};
export const isIndex = (path: string) => /^(index|readme)\.md$/i.test(posix.basename(path));
const sensitiveKey = /secret|credential|token|password|api[-_]?key|authorization|cookie|private[-_]?key/i;
const metadataKey = /^(id|name|title|description|role|type|path|file|filename|files|assets|source|sources|url|source_url|video_id|post_id|thumbnail|thumbnail_path|thumbnail_url|transcript|images|image|directory|folder|format|version|status|collected_at|published_at|license)$/i;

/** Projection is bounded, retains exact scalar values, and never treats JSON instructions as commands. */
export async function readMetadata(root: string, path: string) {
  const raw = await readText(root, path, '', 64 * 1024);
  let value: unknown;
  try { value = JSON.parse(raw.content); } catch { throw new BrainError('INVALID_METADATA', 415, '메타데이터 JSON 형식을 확인하세요.'); }
  const fields: Record<string, string | number | boolean | null> = {};
  let count = 0;
  const visit = (v: unknown, pointer: string, selected: boolean, depth: number) => {
    if (depth > 12 || ++count > 4000) throw new BrainError('METADATA_LIMIT', 413, '메타데이터 구조 제한을 넘었습니다.');
    if (v && typeof v === 'object') {
      for (const [key, child] of Object.entries(v)) {
        if (sensitiveKey.test(key)) throw new BrainError('SENSITIVE_INPUT', 415, '인증 필드가 있는 JSON은 근거로 읽지 않습니다.');
        visit(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, Array.isArray(v) ? selected : metadataKey.test(key), depth + 1);
      }
    } else if (selected && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) fields[pointer] = v as string | number | boolean | null;
  };
  visit(value, '', false, 0);
  if (!Object.keys(fields).length) throw new BrainError('METADATA_EMPTY', 415, '자료의 소속·용도를 확인할 메타데이터 필드가 없습니다.');
  const content = JSON.stringify(fields, null, 2);
  return { path, content, revision: digest(content), sourceRevision: digest(raw.content), format: 'metadata' as const };
}

export interface MaterialBundle { root: string; members: string[]; context: string[] }
export function materialBundles(paths: string[], texts: Map<string, string>, reachable: Set<string>, changed: Map<string, string>, config: BrainConfig, folders: string[]) {
  const directories = new Set(folders);
  const resolve = createLinkResolver(paths);
  const jsonReferences = new Set<string>();
  const links = new Map([...texts].map(([doc, content]) => [doc, new Set(resolve(doc, extractLinks(content)).targets)]));
  const localRoots = new Set([...texts.keys()].filter(isIndex).map(p => posix.dirname(p)));
  paths.filter(metadataName).forEach(p => localRoots.add(posix.dirname(p)));
  const coverage = new Map<string, string[]>();
  for (const [doc, content] of texts) {
    const targets = [...links.get(doc)!];
    targets.filter(p => /\.json$/i.test(p)).forEach(p => jsonReferences.add(p));
    if (!reachable.has(doc)) continue;
    for (const target of targets) if (isMaterial(target, config)) coverage.set(target, [...(coverage.get(target) ?? []), doc]);
    // Folder coverage requires an actual link with a role description. A bare folder/README is never enough.
    for (const row of routingRows(content)) {
      if (!/[:：—–]\s*\S/.test(row.text)) continue;
      for (const folder of resolve(doc, row.links).targets.filter(p => directories.has(p))) {
        if (normalized(folder).split('/').length < 2) continue;
        for (const path of paths.filter(p => p.startsWith(`${folder}/`) && isMaterial(p, config))) coverage.set(path, [...(coverage.get(path) ?? []), doc]);
      }
    }
  }
  const bundles = new Map<string, MaterialBundle>();
  for (const path of paths.filter(p => isMaterial(p, config) && !directories.has(p))) {
    if (coverage.has(path) && changed.get(path) !== 'modified') continue;
    // Same-path binary changes do not break a valid location/role link. JSON changes may change the membership.
    if (coverage.has(path) && !/\.(json|txt|srt|vtt)$/i.test(path)) continue;
    const parents = ancestors(path);
    const local = parents.find(dir => localRoots.has(dir));
    const root = local ?? posix.dirname(path);
    if (root === '.') continue;
    const context = [...texts.keys()].filter(p => (isIndex(p) && ancestors(path).includes(posix.dirname(p)))
      || (links.get(p)!.has(path) || links.get(p)!.has(root)));
    const json = paths.filter(p => /\.json$/i.test(p) && (metadataName(p) || jsonReferences.has(p))
      && (posix.dirname(p) === root || posix.dirname(p) === posix.dirname(path)));
    const bundle = bundles.get(root) ?? { root, members: [], context: [] };
    bundle.members.push(path); bundle.context = [...new Set([...bundle.context, ...context, ...json])]; bundles.set(root, bundle);
  }
  // Fixed pages keep one package from starving other work and preserve member-level review scope.
  return [...bundles.values()].flatMap(b => {
    b.members.sort(); b.context.sort();
    return Array.from({ length: Math.ceil(b.members.length / 40) }, (_, n) => ({ ...b, members: b.members.slice(n * 40, (n + 1) * 40) }));
  });
}

export function indexCandidates(bundles: MaterialBundle[], paths: string[], config: BrainConfig) {
  return [...new Set(bundles.map(b => `${b.root}/INDEX.md`))].filter(path => {
    const folder = posix.dirname(path);
    return paths.includes(folder) && !excludedPath(path) && isMaterial(`${folder}/placeholder.bin`, config)
      && !paths.some(p => normalized(posix.dirname(p)) === normalized(folder) && isIndex(p));
  });
}
