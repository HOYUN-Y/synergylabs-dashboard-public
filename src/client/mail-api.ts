import type { MailConnectionInput, MailTestResponse, MailMessagesResponse, MailSettingsResponse } from '../shared/api';

export class MailApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: MailConnectionInput, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/mail/${path}`, {
      method, cache: 'no-store',
      headers: { 'X-Dashboard-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
    });
  } catch {
    throw new MailApiError('NETWORK', '서버에 연결하지 못했거나 응답 시간이 초과되었습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new MailApiError('RESPONSE', '서버 응답을 확인할 수 없습니다.'); }
  if (!response.ok) throw new MailApiError(data.error ?? 'UNKNOWN', data.message ?? '메일 작업에 실패했습니다.');
  return data as T;
}
export const mailApi = {
  settings: (signal?: AbortSignal) => request<MailSettingsResponse>('settings', 'GET', undefined, signal),
  test: (input: MailConnectionInput) => request<MailTestResponse>('test', 'POST', input),
  save: (input: MailConnectionInput) => request<MailSettingsResponse>('settings', 'PUT', input),
  disconnect: () => request<{ ok: boolean }>('settings', 'DELETE'),
  messages: (signal?: AbortSignal, force = false) => request<MailMessagesResponse>(`messages${force ? '?refresh=1' : ''}`, 'GET', undefined, signal)
};
