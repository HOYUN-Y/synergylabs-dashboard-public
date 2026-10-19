// The review case remains the source of truth; this private ledger only remembers per-document progress.
import { readFile } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { hash } from '../automation/catalog.js';
import { patternOf } from './review.js';
import type { MaterialBundle } from './review-materials.js';
import type { ReviewCase } from './review.js';
import { normalized } from './links.js';

export const reviewInputLimit = 128 * 1024;
export const reviewRunBudget = 30 * 60 * 1000;
export interface ReviewItem {
  bundle?: MaterialBundle; id: string; questionId: string; version: string; paths: string[]; text: string; facts: string[]; findingKeys: string[];
}
export interface ReviewProgress {
  format: 'brain-review-progress-v1'; caseId: string;
  items: Record<string, { version: string; decision: 'apply' | 'hold'; reason: string }>;
}
export async function loadProgress(directory: string, caseId: string): Promise<ReviewProgress> {
  try {
    const value = JSON.parse(await readFile(join(directory, 'progress.json'), 'utf8')) as ReviewProgress;
    if (value.format !== 'brain-review-progress-v1' || typeof value.items !== 'object' || !value.items) throw new Error('Invalid progress');
    return { ...value, caseId };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { format: 'brain-review-progress-v1', caseId, items: {} };
}
export function reviewItems(current: ReviewCase, files: { path: string; modifiedAt: string }[]): ReviewItem[] {
  const items: (ReviewItem & { rank: number })[] = [];
  for (const q of current.questions) {
    if (q.answer && q.answer.decision !== 'hold') continue;
    for (const f of current.findings.filter(f => q.findingKeys.includes(f.key) && f.active !== false)) {
      const subjects = f.bundle ? f.bundle.members : f.group ? (f.group.members?.map(m => m.path) ?? files.filter(p => patternOf(p.path) === f.group!.pattern).map(p => p.path))
        : [...new Set([f.path, ...f.facts.filter(x => x.startsWith('경로 ')).map(x => x.slice(3))])];
      // Duplicate candidates must be compared together. Repeated collection documents can be reviewed independently.
      const units = f.group ? subjects.map(path => [path]) : [subjects];
      for (const paths of units.length ? units : [[f.path]]) {
        const id = `item-${hash(JSON.stringify([f.key, paths])).slice(0, 20)}`;
        const version = hash(JSON.stringify([f.group?.members?.find(m => m.path === paths[0])?.version ?? f.version, paths.map(path => [path, files.find(p => p.path === path)?.modifiedAt]), q.answer?.origin === 'user' ? q.answer : null]));
        items.push({ ...(f.bundle ? { bundle: f.bundle } : {}), id, questionId: q.id, version, paths, findingKeys: [f.key],
          text: f.group ? `이 반복 자료 한 건만 검토합니다: ${paths[0]}. ${f.group.pattern} 전체의 완료 판단은 하지 마세요.` : f.bundle ? `${q.text} 이번에는 ${paths.length}개 구성 파일만 검토합니다. 전체 패키지 완료로 표시하지 마세요.` : q.text,
          facts: f.group ? paths.map(path => `경로 ${path}`) : f.facts,
          rank: ['added', 'modified', 'memory_related', 'materials'].includes(f.kind) ? 0 : 1 });
      }
    }
  }
  return items.sort((a, b) => a.rank - b.rank || normalized(a.paths[0]).localeCompare(normalized(b.paths[0]))).map(item => ({ ...(item.bundle ? { bundle: item.bundle } : {}), id: item.id, questionId: item.questionId, version: item.version, paths: item.paths, text: item.text, facts: item.facts, findingKeys: item.findingKeys }));
}
export function itemResult(progress: ReviewProgress, item: ReviewItem) {
  const result = progress.items[item.id];
  return result?.version === item.version ? result : undefined;
}
export function areaKey(path: string) { return normalized(path).split('/')[0]; }
export function parentPaths(path: string) {
  const parts: string[] = [];
  for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) parts.push(parent);
  return parts;
}

/** Only complete, changed agent answers are synchronized; user decisions remain authoritative. */
export function progressAnswers(current: ReviewCase, items: ReviewItem[], progress: ReviewProgress, questionIds?: Set<string>) {
  return current.questions.flatMap(q => {
    if ((q.answer && q.answer.origin !== 'agent') || (questionIds && !questionIds.has(q.id))) return [];
    const members = items.filter(item => item.questionId === q.id);
    if (!members.length || members.some(item => !itemResult(progress, item))) return [];
    const held = members.map(item => itemResult(progress, item)!).filter(result => result.decision === 'hold');
    const decision = held.length ? 'hold' : 'apply';
    const answer = (held.length ? held.map(result => result.reason).join(' / ') : '분할 검토와 검증된 반영 완료').slice(0, 3000).trim().normalize('NFC');
    if (q.answer?.decision === decision && q.answer.text === answer) return [];
    return [{ questionId: q.id, decision, answer, origin: 'agent' }];
  });
}
