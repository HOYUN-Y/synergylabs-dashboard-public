// Adapted from Rubric Second Brain scan.js (Jay E | RoboNuggets, CC BY 4.0).
// Changes: fenced/inline code exclusion, balanced destinations, deterministic ambiguity reporting.
import { posix } from 'node:path';
export interface RawLink { target: string; wiki: boolean }
export const normalized = (path: string) => path.normalize('NFC');

/** 코드 펜스 · 들여쓴 코드 · 주석 · 인라인 코드를 뺀 링크 분석용 본문(review의 설명 부족 점검에서도 쓴다) */
export function linkSource(text: string) {
  const lines: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (match && match[1][0] === fence.char && match[1].length >= fence.length && !line.slice(match[0].length).trim()) fence = null;
      continue;
    }
    if (match) { fence = { char: match[1][0], length: match[1].length }; continue; }
    if (/^( {4}|\t)/.test(line)) continue;
    lines.push(line);
  }
  return lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/(`+)([^`]|(?!\1)`)*?\1/g, '');
}

export function extractLinks(text: string, visit?: (link: RawLink, start: number, end: number, label: string) => void): RawLink[] {
  const source = linkSource(text);
  const result: RawLink[] = [];
  for (const match of source.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const link = { target: match[1].split('|')[0].trim(), wiki: true };
    result.push(link); visit?.(link, match.index!, match.index! + match[0].length, match[1].split('|')[1] ?? link.target);
  }
  for (const match of source.matchAll(/\]\(\s*/g)) {
    let i = match.index! + match[0].length, target = '', depth = 0;
    const angle = source[i] === '<';
    if (angle) i++;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '\\' && i + 1 < source.length && /[()<>\\ ]/.test(source[i + 1])) { target += source[++i]; continue; }
      if (angle ? c === '>' : (c === ')' && !depth) || /\s/.test(c)) break;
      if (!angle && c === '(') depth++;
      if (!angle && c === ')') depth--;
      if (c === '\n') break;
      target += c;
    }
    if (target && (angle ? source[i] === '>' : source[i] === ')' || /\s/.test(source[i] ?? ''))) {
      const link = { target, wiki: false }; result.push(link);
      const start = source.lastIndexOf('[', match.index), end = source.indexOf(')', i);
      if (start >= 0 && end >= i && !source.slice(start, end).includes('\n')) visit?.(link, start, end + 1, source.slice(start + 1, match.index));
    }
  }
  return result;
}

/** 목록 항목/표 행 안의 설명만 공유한다. 링크 경로는 설명에서 제거한다. */
export function routingRows(text: string): { links: RawLink[]; text: string }[] {
  const rows: { links: RawLink[]; text: string }[] = [];
  for (const line of linkSource(text).split('\n')) {
    const spans: { start: number; end: number; label: string }[] = [];
    const links = extractLinks(line, (_link, start, end, label) => spans.push({ start, end, label }));
    if (!links.length) continue;
    let plain = line;
    for (const span of spans.sort((a, b) => b.start - a.start)) plain = plain.slice(0, span.start) + span.label + plain.slice(span.end);
    plain = plain.replace(/^[\s#>*+-]+/, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain) rows.push({ links, text: plain });
  }
  return rows;
}

export function createLinkResolver(paths: string[]) {
  const map = new Map<string, string[]>(), bases = new Map<string, string[]>();
  for (const path of paths) {
    const key = normalized(path); map.set(key, [...(map.get(key) ?? []), path]);
    if (/\.md$/i.test(path)) {
      const base = normalized(posix.basename(path, posix.extname(path))).toLowerCase();
      bases.set(base, [...(bases.get(base) ?? []), path]);
    }
  }
  return (from: string, raw: RawLink[]) => {
  const targets = new Set<string>(), warnings: string[] = [];
  for (const link of raw) {
    if (/^[a-z][a-z\d+.-]*:/i.test(link.target) || link.target.startsWith('//')) continue;
    let target = link.target.split(/[?#]/)[0];
    if (!target) continue;
    try { target = decodeURIComponent(target).replace(/\\/g, '/'); } catch { warnings.push(`${from}: 잘못된 링크 인코딩`); continue; }
    if (target.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) continue;
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(from), target)).replace(/\/$/, '');
    if (path === '..' || path.startsWith('../')) { warnings.push(`${from}: 작업 공간 밖 링크 제외`); continue; }
    let hits = map.get(normalized(path === '.' ? '' : path)) ?? [];
    if (link.wiki && !hits.length) hits = map.get(normalized(path + '.md')) ?? [];
    if (link.wiki && !hits.length && !target.includes('/')) {
      const candidates = bases.get(normalized(target.replace(/\.md$/i, '')).toLowerCase()) ?? [];
      const sourceParts = posix.dirname(from).split('/');
      const distance = (candidate: string) => {
        const parts = posix.dirname(candidate).split('/'); let common = 0;
        while (common < Math.min(parts.length, sourceParts.length) && normalized(parts[common]) === normalized(sourceParts[common])) common++;
        return parts.length + sourceParts.length - 2 * common;
      };
      const min = Math.min(...candidates.map(distance));
      hits = candidates.filter(candidate => distance(candidate) === min);
    }
    // Do not echo potentially private link destinations into an API warning.
    if (hits.length !== 1) { warnings.push(`${from}: ${hits.length ? '대상이 모호한' : '대상을 찾을 수 없거나 제외된'} 내부 링크`); continue; }
    if (hits[0] !== from) targets.add(hits[0]);
  }
  return { targets: [...targets], warnings };
  };
}
