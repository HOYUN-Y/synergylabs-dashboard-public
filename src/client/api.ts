import type { HealthResponse } from '../shared/api';

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.');
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null
    || !('status' in data) || data.status !== 'ok'
    || !('time' in data) || typeof data.time !== 'string'
    || Number.isNaN(Date.parse(data.time))) {
    throw new Error('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.');
  }
  return { status: data.status, time: data.time };
}
