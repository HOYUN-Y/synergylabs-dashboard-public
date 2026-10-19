import { posix } from 'node:path';
import { routeGuides, type BrainConfig } from './config.js';
import { normalized } from './links.js';
import { isIndex, isMaterial } from './review-materials.js';

// Review routing is independent of the map's configured colors/categories.
export function reviewGuides(config: BrainConfig, targets: string[], paths: string[] = []) {
  const named = paths.filter(path => {
    const folder = posix.dirname(path);
    const area = config.areas.find(a => a.folder === normalized(folder));
    return folder !== '.' && (area || !folder.includes('/')) && isMaterial(`${folder}/placeholder.bin`, config)
      && normalized(posix.basename(path)).toLowerCase() === `${area?.id ?? normalized(posix.basename(folder))}.md`.toLowerCase();
  });
  return [...new Set([...named, ...routeGuides(config, targets).values(), ...targets.filter(path =>
    /\.md$/i.test(path) && posix.dirname(path) !== '.' && !posix.dirname(path).includes('/')
    && isMaterial(`${posix.dirname(path)}/placeholder.bin`, config))])];
}

export function areaGuideCandidates(subjects: string[], paths: string[], guides: string[], config: BrainConfig) {
  const roots = new Set(subjects.filter(p => p.includes('/')).map(path => {
    const area = config.areas.filter(a => normalized(path).startsWith(`${a.folder}/`)).sort((a, b) => b.folder.length - a.folder.length)[0];
    return paths.find(p => normalized(p) === (area?.folder ?? normalized(path.split('/')[0])));
  }).filter((p): p is string => !!p));
  return [...roots].flatMap(folder => {
    if (!isMaterial(`${folder}/placeholder.bin`, config) || guides.some(p => normalized(posix.dirname(p)) === normalized(folder))) return [];
    const area = config.areas.find(a => a.folder === normalized(folder));
    const name = area?.id ?? posix.basename(folder).normalize('NFC');
    if (!name || /[\\/]/.test(name) || name.startsWith('.')) return [];
    const candidate = `${folder}/${name}.md`;
    // Existing entrypoints are reused, never replaced with a second index.
    if (paths.some(p => normalized(posix.dirname(p)) === normalized(folder)
      && (isIndex(p) || normalized(p).toLowerCase() === normalized(candidate).toLowerCase()))) return [];
    return [candidate];
  });
}

// Locate the existing area table by links rather than a language-specific heading.
export function routerTableLines(content: string) {
  const lines = content.split('\n');
  const rows = new Set<number>();
  for (let i = 1; i < lines.length; i++) {
    if (!/^\s*\|?\s*:?-{3,}/.test(lines[i]) || !lines[i].includes('|')) continue;
    const block: number[] = [];
    for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) block.push(j);
    if (block.some(j => /\]\([^)]*\/?\)/.test(lines[j]))) block.forEach(j => rows.add(j));
  }
  return rows;
}
