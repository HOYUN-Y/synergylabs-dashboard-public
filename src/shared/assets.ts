export const assetTypeLabels = {
  '3d-object': '3D 오브젝트', infographic: '인포그래픽', 'motion-recipe': '모션 레시피',
  'hero-counter': '히어로 카운터', background: '배경', icon: '아이콘', sound: '효과음',
  image: '이미지·로고', font: '글꼴', 'design-source': '디자인 원본', archive: '압축 묶음'
} as const;
export type AssetType = keyof typeof assetTypeLabels;
export type AspectRatio = '16:9' | '9:16';
export interface AssetFile { key: string; path: string; mime: string }
export interface Asset {
  id: string; version: string; name: string; description: string; type: AssetType; tags: string[];
  manifestPath: string; sourcePath: string; instructionsPath: string | null;
  absolutePaths: Record<string, string>;
  parameters: Record<string, unknown>; runtime: string; dependencies: string[];
  license: string; status: string; files: AssetFile[];
  images: Partial<Record<AspectRatio, string>>; animations: Partial<Record<AspectRatio, string>>;
  font: string | null;
}
export interface AssetCatalog { root: string; items: Asset[]; warnings: string[] }
export function copyAssetText(asset: Asset, ratio: AspectRatio, root: string): string {
  const absolute = (value: unknown): value is string => typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
  const unavailable = () => new Error('경로 정보를 확인하지 못했습니다. 목록을 새로고침해 주세요.');
  if (!absolute(root)) throw unavailable();
  const resolve = (relative: string) => {
    const resolved = asset.absolutePaths && Object.hasOwn(asset.absolutePaths, relative) ? asset.absolutePaths[relative] : undefined;
    if (!absolute(resolved)) throw unavailable();
    return resolved;
  };
  const manifest = resolve(asset.manifestPath);
  const separator = manifest.startsWith('/') ? '/' : '\\';
  const folder = manifest.slice(0, manifest.lastIndexOf(separator));
  const relativeFolder = asset.manifestPath.slice(0, asset.manifestPath.lastIndexOf('/'));
  const rootPrefix = root.replace(/[\\/]+$/, '') + separator;
  if (!folder.startsWith(rootPrefix) || folder.slice(rootPrefix.length).split(separator).join('/').normalize('NFC') !== relativeFolder) throw unavailable();
  const files = new Map<string, string[]>();
  const add = (path: string, role: string) => {
    const resolved = resolve(path);
    const prefix = folder + separator;
    if (!resolved.startsWith(prefix)) throw unavailable();
    const local = resolved.slice(prefix.length).split(separator).join('/');
    if (local.split('/').some(part => !part || part === '.' || part === '..')
      || `${relativeFolder}/${local.normalize('NFC')}` !== path) throw unavailable();
    const roles = files.get(local) ?? [];
    if (role && !roles.includes(role)) roles.push(role);
    files.set(local, roles);
  };
  const licenseFile = asset.files.find(file => asset.license.endsWith(` · ${file.path}`));
  const license = licenseFile ? asset.license.slice(0, -` · ${licenseFile.path}`.length) : asset.license;
  add(asset.manifestPath, '메타데이터');
  add(asset.sourcePath, '원본');
  if (asset.instructionsPath) add(asset.instructionsPath, '사용법');
  for (const file of asset.files) add(file.path, file === licenseFile ? '라이선스 파일' : '');
  return [
    `에셋: ${asset.name} (${asset.id}@${asset.version})`, `유형: ${assetTypeLabels[asset.type]}`,
    `설명: ${asset.description}`, `선택 비율: ${ratio}`, '',
    '에셋 폴더', `절대경로: ${folder}`, `작업 공간 기준 상대경로: ${relativeFolder}`, '',
    '파일 — 위 에셋 폴더 기준',
    ...[...files].map(([path, roles]) => `- ${roles.length ? roles.join('·') : '추가 파일'}: ${path}`),
    ...(!asset.instructionsPath ? ['사용법: 별도 사용 설명 없음'] : []), '',
    `파라미터: ${JSON.stringify(asset.parameters)}`, `실행 환경: ${asset.runtime}`,
    `의존성: ${asset.dependencies.length ? asset.dependencies.join(', ') : '없음 또는 별도 지정 없음'}`,
    `라이선스: ${license}`, `상태: ${asset.status}`, '',
    '다른 컴퓨터에서는 작업 공간 기준 상대경로를 해당 컴퓨터의 작업 공간에 연결하세요.'
  ].join('\n');
}
