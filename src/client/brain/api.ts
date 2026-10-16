import type { BrainPreview, BrainSearch } from '../../shared/brain';
import type { FullGraph } from './model';

/** 서버 오류 코드(NOT_FOUND · UNSUPPORTED_TYPE 등)를 함께 넘긴다. 문구는 그대로 message */
export class BrainApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request<T>(path: string, init: RequestInit & { timeout?: number } = {}): Promise<T> {
  const { timeout = 30000, signal, ...rest } = init;
  const response = await fetch(`/api/brain/${path}`, { cache: 'no-store', ...rest,
    headers: { 'X-Dashboard-Request': '1', ...(rest.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new BrainApiError(data?.error ?? 'UNKNOWN', data?.message ?? '세컨드 브레인 자료를 읽지 못했습니다. 다시 시도해 주세요.');
  }
  return response.json();
}
export const brainApi = {
  // 처음 스캔은 작업 공간 크기에 따라 오래 걸릴 수 있다
  graph: (signal: AbortSignal, force = false) => request<FullGraph>(`graph?all=1${force ? '&refresh=1' : ''}`, { signal, timeout: 120000 }),
  searchBody: (query: string, signal: AbortSignal) => request<BrainSearch>(`search?scope=body&q=${encodeURIComponent(query)}`, { signal }),
  preview: (id: string, signal?: AbortSignal) => request<BrainPreview>(`preview?id=${id}`, { signal }),
  reveal: (id: string) => request<{ ok: true }>('reveal', { method: 'POST', body: JSON.stringify({ id }) })
};
