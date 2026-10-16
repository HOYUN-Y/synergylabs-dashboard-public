// 세컨드 브레인 분류 설정(저장소 config/second-brain.json): 라우터 문서 · 스킬 · 분야 · 루틴 폴더와 이름 · 분야 색.
// 분야 안내 문서는 설정에 적지 않고 라우터의 링크로 정한다(docs/SECOND_BRAIN_STRUCTURE.md 3절 '안내 파일명은 라우터에 명시').
import { readFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrainRing } from '../../shared/brain.js';
import { normalized } from './links.js';

/** 분야 색: 기본색과 진하기 4단계(진함 → 옅음, 지도 칸의 연결 수 · 최근 수정 단계 — 흰 바탕 기준), dark = 검은 바탕(세컨드 브레인 구체)에서 쓰는 색 */
interface BrainPaint { color?: string; ramp?: string[]; dark?: string }
/** 스킬 · 분야 · 루틴 한 칸. folder는 작업 공간 루트 기준(NFC, 끝 '/' 없음). 색은 분야에만 둔다 */
export interface BrainArea extends BrainPaint { id: string; name: string; folder: string; ring: BrainRing }
export interface BrainConfig {
  routerFile: string;
  memory?: { areaId: string };
  /** 스킬 · 분야들 · 루틴 순서(지도 응답 groups 순서). 기타는 따로 둔다 */
  areas: BrainArea[];
  other: BrainPaint & { id: 'other'; name: string; ring: 'doc' };
}

// src/server/brain · dist/server/brain 어디서 읽어도 저장소 루트의 config/를 가리킨다
export const brainConfigFile = fileURLToPath(new URL('../../../config/second-brain.json', import.meta.url));
const reserved = new Set(['skills', 'routines', 'other']);

export class BrainConfigError extends Error {}

const fail = (message: string): never => { throw new BrainConfigError(`세컨드 브레인 설정(config/second-brain.json): ${message}`); };

export async function loadBrainConfig(file = brainConfigFile): Promise<BrainConfig> {
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { return fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? '파일이 없습니다.' : '파일을 읽지 못했습니다.'); }
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { return fail(`JSON 형식이 아닙니다(${(error as Error).message}).`); }
  return parseBrainConfig(value);
}

const mixHex = (a: string, b: string, t: number) => `#${[1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
/** ramp를 적지 않은 분야: 기본색에서 진하기 4단계를 근사로 만든다(흰 바탕 대비는 따로 확인해야 한다) */
export const rampFrom = (color: string) => [mixHex(color, '#000000', 0.2), color, mixHex(color, '#ffffff', 0.18), mixHex(color, '#ffffff', 0.36)];

export function parseBrainConfig(value: unknown): BrainConfig {
  const object = (v: unknown, where: string) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail(`${where}는 객체여야 합니다.`));
  const hex = (v: unknown, where: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fail(`${where}는 #rrggbb 형식 색이어야 합니다.`));
  const paint = (raw: Record<string, unknown>, where: string): BrainPaint => {
    const dark = raw.dark === undefined ? {} : { dark: hex(raw.dark, `${where}.dark`) };
    if (raw.color === undefined) return raw.ramp === undefined ? dark : fail(`${where}.ramp를 쓰려면 ${where}.color도 적어야 합니다.`);
    const color = hex(raw.color, `${where}.color`);
    if (raw.ramp === undefined) return { color, ramp: rampFrom(color), ...dark };
    if (!Array.isArray(raw.ramp) || raw.ramp.length !== 4) return fail(`${where}.ramp는 색 4개(진함 → 옅음) 배열이어야 합니다.`);
    return { color, ramp: raw.ramp.map((c: unknown, i: number) => hex(c, `${where}.ramp[${i}]`)), ...dark };
  };
  const text = (v: unknown, where: string) => (typeof v === 'string' && v.trim() ? v.trim().normalize('NFC') : fail(`${where}는 비어 있지 않은 문자열이어야 합니다.`));
  const relative = (v: unknown, where: string) => {
    const path = text(v, where).replace(/\/+$/, '');
    if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) fail(`${where}는 작업 공간 루트 기준 상대 경로여야 합니다(예: 콘텐츠).`);
    return path;
  };
  const root = object(value, '설정');
  const routerFile = relative(root.routerFile, 'routerFile');
  const named = (key: 'skills' | 'routines', ring: BrainRing): BrainArea => {
    const area = object(root[key], key);
    return { id: key, name: text(area.name, `${key}.name`), folder: relative(area.folder, `${key}.folder`), ring };
  };
  const fields = (Array.isArray(root.fields) ? root.fields : fail('fields는 배열이어야 합니다.')).map((v: unknown, i: number): BrainArea => {
    const field = object(v, `fields[${i}]`), id = text(field.id, `fields[${i}].id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`fields[${i}].id는 영문 소문자로 시작하고 영문 소문자 · 숫자 · '-'만 씁니다.`);
    if (reserved.has(id)) fail(`fields[${i}].id '${id}'는 예약된 이름입니다(skills · routines · other).`);
    const ring = field.ring ?? 'doc';
    if (ring !== 'doc' && ring !== 'asset') fail(`fields[${i}].ring은 doc 또는 asset입니다.`);
    return { id, name: text(field.name, `fields[${i}].name`), folder: relative(field.folder, `fields[${i}].folder`), ring: ring as BrainRing, ...paint(field, `fields[${i}]`) };
  });
  const areas = [named('skills', 'skill'), ...fields, named('routines', 'routine')];
  const ids = new Set<string>(), folders = new Set<string>();
  for (const area of areas) {
    if (ids.has(area.id)) fail(`id '${area.id}'가 두 번 쓰였습니다.`);
    if (folders.has(area.folder)) fail(`폴더 '${area.folder}'가 두 번 쓰였습니다.`);
    ids.add(area.id); folders.add(area.folder);
  }
  const other = object(root.other, 'other');
  const memory = root.memory === undefined ? undefined : { areaId: text(object(root.memory, 'memory').areaId, 'memory.areaId') };
  if (memory && !fields.some(area => area.id === memory.areaId && area.ring === 'doc')) fail('memory.areaId는 doc 고리의 분야 id여야 합니다.');
  return { routerFile, areas, ...(memory ? { memory } : {}), other: { id: 'other', name: text(other.name, 'other.name'), ring: 'doc', ...paint(other, 'other') } };
}

/** 지도 응답의 groups: 스킬 · 분야들 · 루틴 · 기타. 폴더(기타는 없음)와 색은 있을 때만 */
export const groupsOf = (config: BrainConfig) => [...config.areas, config.other].map(area => ({
  id: area.id, name: area.name, ring: area.ring, ...('folder' in area ? { folder: area.folder } : {}), ...(area.color ? { color: area.color, ramp: area.ramp } : {}),
  ...(area.dark ? { dark: area.dark } : {})
}));

/** 경로가 속한 영역 id. 작업 공간 루트 기준으로 가장 긴 폴더가 이긴다. 어디에도 없으면 null */
export function areaOf(config: BrainConfig, path: string) {
  const target = normalized(path);
  let best: BrainArea | undefined;
  for (const area of config.areas) {
    if ((target === area.folder || target.startsWith(`${area.folder}/`)) && (!best || area.folder.length > best.folder.length)) best = area;
  }
  return best?.id ?? null;
}

/** 영역마다 안내 문서: 라우터가 그 폴더 바로 아래에서 링크하는 첫 .md(라우터 안 링크 순서). 값은 받은 경로 그대로 */
export function routeGuides(config: BrainConfig, routerTargets: string[]) {
  const guides = new Map<string, string>();
  for (const area of config.areas) {
    const hit = routerTargets.find(target => extname(target).toLowerCase() === '.md' && normalized(dirname(target)) === area.folder);
    if (hit) guides.set(area.id, hit);
  }
  return guides;
}
