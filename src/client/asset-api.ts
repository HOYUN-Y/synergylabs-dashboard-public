import type { Asset, AssetCatalog } from '../shared/assets';

async function request(path: string, signal: AbortSignal) {
  const response = await fetch(`/api/assets/${path}`, { cache: 'no-store', headers: { 'X-Dashboard-Request': '1' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message ?? '에셋 자료를 읽지 못했습니다. 목록을 다시 불러와 주세요.');
  }
  return response;
}
export async function getAssetCatalog(signal: AbortSignal, force = false): Promise<AssetCatalog> {
  return (await request(`catalog${force ? '?refresh=1' : ''}`, signal)).json();
}
export async function getAssetFile(asset: Asset, key: string, signal: AbortSignal) {
  return request(`${encodeURIComponent(`${asset.id}@${asset.version}`)}/files/${encodeURIComponent(key)}`, signal);
}
