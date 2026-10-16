import type { BrainSearchMatch, BrainSearchResult, GraphNode } from './brain.js';

export const normalizeSearch = (text: string) => text.normalize('NFC').toLowerCase();
export const searchTerms = (query: string) => [...new Set(normalizeSearch(query).trim().split(/\s+/).filter(Boolean))];
export const includesTerms = (text: string, terms: string[]) => {
  const normalized = normalizeSearch(text);
  return terms.length > 0 && terms.every(term => normalized.includes(term));
};

export function searchExcerpt(text: string, terms: string[]) {
  const plain = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const positions = terms.map(term => plain.toLowerCase().indexOf(term)).filter(i => i >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 45);
  return `${start ? '…' : ''}${plain.slice(start, start + 180)}${plain.length > start + 180 ? '…' : ''}`;
}

export function quickSearch(nodes: GraphNode[], query: string) {
  const terms = searchTerms(query), q = normalizeSearch(query.trim());
  const matches: { node: GraphNode; match: BrainSearchMatch; score: number }[] = [];
  if (!terms.length) return { results: [], truncated: false };
  for (const node of nodes) {
    const name = normalizeSearch(node.name);
    if (includesTerms(name, terms)) {
      matches.push({ node, match: { kind: 'name' }, score: name === q ? 100 : name.startsWith(q) ? 90 : 80 });
      continue;
    }
    const hint = node.searchHints?.find(h => includesTerms(`${node.path} ${h.text}`, terms));
    if (hint) {
      matches.push({ node, match: { kind: 'routing', sourcePath: hint.sourcePath, excerpt: searchExcerpt(hint.text, terms) }, score: 60 });
    } else if (includesTerms(node.path, terms)) matches.push({ node, match: { kind: 'path' }, score: 40 });
  }
  matches.sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path, 'ko'));
  return { results: matches.slice(0, 100).map(({ node, match }) => ({ node, match })), truncated: matches.length > 100 };
}

/** 빠른 결과 위치를 유지한다. 본문 일치는 같은 노드의 근거만 갱신한다. */
export function mergeSearchResults(quick: BrainSearchResult[], body: BrainSearchResult[]) {
  const result = quick.map(r => ({ ...r })), positions = new Map(result.map((r, i) => [r.node.id, i]));
  for (const hit of body) {
    const position = positions.get(hit.node.id);
    if (position !== undefined) {
      const previous = result[position];
      result[position] = { ...previous, match: hit.match ? { ...hit.match,
        ...(previous.match?.kind === 'routing' ? { sourcePath: previous.match.sourcePath } : {}) } : previous.match };
    }
    else { positions.set(hit.node.id, result.length); result.push(hit); }
  }
  return result;
}
