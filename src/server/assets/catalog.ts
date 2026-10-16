import { createHash } from 'node:crypto';
import { scanWorkspace } from '../workspace-scan.js';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { inside } from '../automation/catalog.js';
import { assetTypeLabels } from '../../shared/assets.js';
import type { Asset, AssetCatalog, AssetType, AspectRatio } from '../../shared/assets.js';

const messages = {
  NOT_CONFIGURED: '설정에서 공통 작업 공간 루트를 지정해 주세요.',
  ROOT_UNAVAILABLE: '설정된 작업 공간을 읽을 수 없습니다. 폴더 경로와 Drive 동기화를 확인해 주세요.',
  CATALOG_UNAVAILABLE: '브랜드에셋/manifest.json을 읽을 수 없습니다. 파일과 형식을 확인해 주세요.',
  PATH_DENIED: '등록된 자료 폴더 안의 일반 파일만 사용할 수 있습니다.',
  NOT_FOUND: '등록된 에셋 또는 미리보기 파일을 찾을 수 없습니다.',
  CONFIG_CHANGED: '자료 루트가 변경되었습니다. 목록을 다시 불러와 주세요.',
  FORBIDDEN: '허용되지 않은 요청입니다.'
};
export class AssetError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); }
}

const mimeTypes: Record<string, string> = {
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.html': 'text/html; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'application/octet-stream', '.ai': 'application/octet-stream', '.zip': 'application/zip', '.css': 'text/plain; charset=utf-8'
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('잘못된 메타데이터 형식');
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\0\r\n]/.test(value)) throw new Error('필수 문자열 누락');
  return value;
}
function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) throw new Error('잘못된 목록');
  return value.map(v => text(v));
}
// 경로를 추측해 정규화하지 않고 실제 디렉터리 이름을 찾는다. Mac/Drive의 한글 표기 차이를 허용한다.
export async function assetPath(root: string, path: string, directory = false, limit = 256 * 1024 * 1024): Promise<string> {
  if (isAbsolute(path) || /[\0\\]/.test(path) || path.length > 4096) throw new AssetError('PATH_DENIED');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new AssetError('PATH_DENIED');
  try {
    root = await realpath(root);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const matches = (await readdir(current)).filter(name => name.normalize('NFC') === parts[i].normalize('NFC'));
      if (matches.length !== 1) throw new Error();
      current = join(current, matches[0]);
      const info = await lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw new Error();
    }
    const resolved = await realpath(current);
    const info = await stat(resolved);
    if (!inside(root, resolved) || (directory ? !info.isDirectory() : !info.isFile() || info.size > limit)) throw new Error();
    return resolved;
  } catch { throw new AssetError('PATH_DENIED'); }
}
const relativePath = (root: string, file: string) => relative(root, file).split(sep).join('/').normalize('NFC');
async function json(root: string, path: string) {
  return object(JSON.parse(await readFile(await assetPath(root, path, false, 256 * 1024), 'utf8')));
}

async function discoverManifest(root: string, folder: string): Promise<Pick<AssetCatalog, 'items' | 'warnings'>> {
  let brand: string;
  let index: Record<string, unknown>;
  try {
    root = await realpath(root);
    brand = await assetPath(root, folder, true);
    index = await json(root, `${relativePath(root, brand)}/manifest.json`);
    if (index.schemaVersion !== 1 || !Array.isArray(index.assets) || index.assets.length > 1000) throw new Error();
  } catch { throw new AssetError('CATALOG_UNAVAILABLE'); }
  const items: Asset[] = [];
  const warnings: string[] = [];
  for (const [position, raw] of (index.assets as unknown[]).entries()) {
    try {
      const entry = object(raw);
      let metadata = entry;
      let base = relativePath(root, brand);
      let manifestPath = `${base}/manifest.json`;
      if (entry.manifest !== undefined) {
        const requested = `${base}/${text(entry.manifest)}`;
        const resolvedManifest = await assetPath(root, requested);
        if (!inside(brand, resolvedManifest)) throw new Error();
        manifestPath = relativePath(root, resolvedManifest);
        base = dirname(manifestPath).split(sep).join('/');
        metadata = await json(root, manifestPath);
      }
      if (metadata.schemaVersion !== undefined && metadata.schemaVersion !== 1) throw new Error();
      const id = text(metadata.id, 100);
      const version = text(metadata.version, 64);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^[a-zA-Z0-9_.-]+$/.test(version)) throw new Error();
      if (!Object.hasOwn(assetTypeLabels, metadata.type as string)) throw new Error();
      if (items.some(item => item.id === id && item.version === version)) throw new Error();
      const files: Asset['files'] = [];
      const absolutePaths: Asset['absolutePaths'] = { [manifestPath]: await assetPath(root, manifestPath, false, 256 * 1024) };
      const addFile = async (path: unknown) => {
        const resolved = await assetPath(root, `${base}/${text(path)}`);
        if (!inside(brand, resolved)) throw new AssetError('PATH_DENIED');
        const mime = mimeTypes[extname(resolved).toLowerCase()];
        if (!mime) throw new Error();
        const relative = relativePath(root, resolved);
        absolutePaths[relative] = resolved;
        const existing = files.find(file => file.path === relative);
        if (existing) return existing;
        const file = { key: `f${files.length}`, path: relative, mime };
        files.push(file); return file;
      };
      const source = await addFile(metadata.source);
      const instructions = metadata.instructions === undefined ? null : await addFile(metadata.instructions);
      for (const path of strings(metadata.files)) await addFile(path);
      const license = metadata.license === undefined ? {} : object(metadata.license);
      const licenseFile = license.file === undefined ? null : await addFile(license.file);
      const images: Asset['images'] = {};
      const animations: Asset['animations'] = {};
      if (source.mime.startsWith('image/')) { images['16:9'] = source.key; images['9:16'] = source.key; }
      for (const ratio of ['16:9', '9:16'] as AspectRatio[]) {
        const preview = metadata.previews === undefined ? undefined : object(metadata.previews)[ratio];
        if (preview === undefined) continue;
        const fields = object(preview);
        if (fields.image !== undefined) {
          const file = await addFile(fields.image);
          if (!file.mime.startsWith('image/')) throw new Error();
          images[ratio] = file.key;
        }
        if (fields.animation !== undefined) {
          const file = await addFile(fields.animation);
          if (!file.mime.startsWith('text/html')) throw new Error();
          animations[ratio] = file.key;
        }
      }
      items.push({
        id, version, name: text(metadata.name, 160), description: text(metadata.description),
        type: metadata.type as AssetType, tags: strings(metadata.tags), manifestPath, absolutePaths,
        sourcePath: source.path, instructionsPath: instructions?.path ?? null,
        parameters: metadata.parameters === undefined ? {} : object(metadata.parameters),
        runtime: metadata.runtime === undefined ? '해당 파일을 지원하는 도구' : text(metadata.runtime),
        dependencies: strings(metadata.dependencies), status: typeof metadata.status === 'string' ? text(metadata.status) : '등록됨',
        license: `${typeof license.id === 'string' ? text(license.id) : '라이선스 미확인'}${licenseFile ? ` · ${licenseFile.path}` : ''}`,
        files, images, animations, font: source.mime.startsWith('font/') ? source.key : null
      });
    } catch { warnings.push(`목록 ${position + 1}번: 형식·중복 ID·파일 경로를 확인해 주세요.`); }
  }
  return { items, warnings };
}

export async function discoverAssets(root: string, output = ''): Promise<AssetCatalog> {
  const inventory = await scanWorkspace(root, output);
  root = inventory.root;
  const manifests = inventory.files.filter(file => file.name === 'manifest.json' && dirname(file.path).split('/').at(-1)?.normalize('NFC') === '브랜드에셋');
  if (!manifests.length) throw new AssetError('CATALOG_UNAVAILABLE');
  const result: AssetCatalog = { root, items: [], warnings: [...inventory.warnings] };
  let valid = 0;
  for (const manifest of manifests) {
    const folder = dirname(manifest.path);
    try {
      const catalog = await discoverManifest(root, folder); valid++;
      const prefix = folder.normalize('NFC') === '브랜드에셋' ? '' : createHash('sha256').update(folder).digest('hex').slice(0, 16) + '-';
      result.items.push(...catalog.items.map(item => ({ ...item, id: prefix + item.id })));
      result.warnings.push(...catalog.warnings.map(warning => `${folder.normalize('NFC')}: ${warning}`));
    } catch { result.warnings.push(`${folder}: manifest 형식·경로를 확인해 주세요.`); }
  }
  if (!valid) throw new AssetError('CATALOG_UNAVAILABLE');
  return result;
}

export class AssetService {
  private snapshot: { root: string; catalog: AssetCatalog } | null = null;
  constructor(private workspace: () => Promise<string>, private output: () => Promise<string> = async () => '') {}
  private async root() {
    const value = await this.workspace();
    if (!value) throw new AssetError('NOT_CONFIGURED');
    try {
      if (!isAbsolute(value)) throw new Error();
      const root = await realpath(value);
      if (!(await stat(root)).isDirectory()) throw new Error();
      return root;
    } catch { throw new AssetError('ROOT_UNAVAILABLE'); }
  }
  async catalog() {
    const root = await this.root();
    const catalog = await discoverAssets(root, await this.output());
    if (root !== await this.root()) throw new AssetError('CONFIG_CHANGED');
    this.snapshot = { root, catalog };
    return catalog;
  }
  async file(id: string, key: string) {
    const root = await this.root();
    if (this.snapshot?.root !== root) await this.catalog();
    if (this.snapshot?.root !== root) throw new AssetError('CONFIG_CHANGED');
    const file = this.snapshot.catalog.items.find(asset => `${asset.id}@${asset.version}` === id)?.files.find(file => file.key === key);
    if (!file) throw new AssetError('NOT_FOUND');
    const path = await assetPath(root, file.path);
    const bytes = await readFile(path);
    if (root !== await this.root()) throw new AssetError('CONFIG_CHANGED');
    return { bytes, mime: file.mime };
  }
}
