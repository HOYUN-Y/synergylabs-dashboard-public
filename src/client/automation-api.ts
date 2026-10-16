import type { WorkspaceSettings } from '../shared/workspace';
import type { AutomationCatalog, AutomationRun, SkillConversation, SkillSettings, ExecutionSettings, ExecutionOptions, NotificationPage, AutomationNotification } from '../shared/automation';

export class AutomationApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/automation/${path}`, { method, cache: 'no-store',
    headers: { 'X-Dashboard-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
    .catch(() => { throw new Error('서버에 연결하지 못했거나 응답 시간이 초과되었습니다.'); });
  const data = await response.json().catch(() => { throw new Error('서버 응답을 확인할 수 없습니다.'); });
  if (!response.ok) throw new AutomationApiError(data.error ?? 'UNKNOWN', data.message ?? '자동화 요청에 실패했습니다.');
  return data as T;
}
export const automationApi = {
  notifications: (cursor?: string, signal?: AbortSignal) => request<NotificationPage>(`notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, 'GET', undefined, signal),
  readNotification: (id: string) => request<AutomationNotification>(`notifications/${encodeURIComponent(id)}/read`, 'POST'),
  run: (id: string, signal?: AbortSignal) => request<AutomationRun>(`runs/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  settings: (signal?: AbortSignal) => request<WorkspaceSettings>('settings', 'GET', undefined, signal),
  save: (workspace: string, outputDirectory = '') => request<WorkspaceSettings>('settings', 'PUT', { workspace, outputDirectory }),
  catalog: (signal?: AbortSignal, force = false) => request<AutomationCatalog>(`catalog${force ? '?refresh=1' : ''}`, 'GET', undefined, signal),
  history: (signal?: AbortSignal) => request<{ runs: AutomationRun[] }>('runs', 'GET', undefined, signal),
  latest: (signal?: AbortSignal) => request<{ runs: AutomationRun[] }>('runs?latestPerTarget=true', 'GET', undefined, signal),
  skillHistory: (id: string, signal?: AbortSignal) => request<{ runs: AutomationRun[] }>(`runs?targetId=${encodeURIComponent(id)}`, 'GET', undefined, signal),
  skillSettings: (id: string, signal?: AbortSignal) => request<SkillSettings>(`skills/${encodeURIComponent(id)}/settings`, 'GET', undefined, signal),
  saveSkill: (id: string, input: string) => request<SkillSettings>(`skills/${encodeURIComponent(id)}/settings`, 'PUT', { input }),
  executionOptions: (signal?: AbortSignal) => request<ExecutionOptions>('execution-options', 'GET', undefined, signal),
  saveExecution: (id: string, execution: ExecutionSettings) => request<SkillSettings>(`skills/${encodeURIComponent(id)}/settings`, 'PUT', { execution }),
  startSaved: (targetId: string) => request<AutomationRun>('runs', 'POST', { targetId, useSavedInput: true }),
  start: (targetId: string, input = '') => request<AutomationRun>('runs', 'POST', { targetId, input }),
  conversation: (id: string, signal?: AbortSignal) => request<SkillConversation>(`conversations/${encodeURIComponent(id)}`, 'GET', undefined, signal),
  reply: (id: string, body: { input: string; baseRunId: string; requestId: string }) => request<AutomationRun>(`conversations/${encodeURIComponent(id)}/messages`, 'POST', body),
  cancel: (id: string) => request<AutomationRun>(`runs/${encodeURIComponent(id)}/cancel`, 'POST'),
  retryOutput: (id: string) => request<AutomationRun>(`runs/${encodeURIComponent(id)}/output/retry`, 'POST'),
  download: async (id: string, name: string) => {
    const response = await fetch(`/api/automation/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`, {
      cache: 'no-store', headers: { 'X-Dashboard-Request': '1' }, signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('결과 파일을 내려받지 못했습니다. 저장 위치를 확인해 주세요.');
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};
