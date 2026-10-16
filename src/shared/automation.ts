export type AutomationKind = 'skill' | 'routine';
export interface ExecutionSettings { provider: 'claude' | 'codex'; model: string; effort: string }
export interface SkillSettings { input: string; execution?: ExecutionSettings }
export const defaultExecution: ExecutionSettings = { provider: 'claude', model: 'default', effort: 'default' };
export interface ExecutionOptions {
  providers: { id: ExecutionSettings['provider']; ready: boolean; reason: string | null;
    models: { id: string; name: string; efforts: string[] }[] }[];
}
export type RunStatus = 'queued' | 'running' | 'cancelling' | 'succeeded' | 'partial' | 'waiting_input' | 'needs_input' | 'failed' | 'cancelled' | 'interrupted';
export interface SkillDocumentCandidate { id: string; name: string; path: string }
export interface SkillDocumentSource extends SkillDocumentCandidate { hash: string; bytes: number; readAt: string }
/** 이번 회차의 조회 정보. 원문·개인 보관 위치·CLI 세션 ID는 공개하지 않는다. */
export interface SkillContext {
  phase: 'searching' | 'reading' | 'ready' | 'needs_selection' | 'unavailable' | 'limited';
  sources: SkillDocumentSource[];
  candidates?: SkillDocumentCandidate[];
  message: string;
}
export interface AutomationItem {
  metricsService?: 'youtube';
  id: string;
  kind: AutomationKind;
  name: string;
  description: string;
  path: string;
  ready: boolean;
  reason: string | null;
}
export interface AutomationCatalog { items: AutomationItem[]; warnings: string[] }
export interface AutomationRun {
  trigger?: 'manual' | 'scheduled';
  context?: SkillContext;
  output?: { status: 'saved' | 'failed'; directory: string; message: string };
  execution?: ExecutionSettings;
  id: string;
  targetId: string;
  kind: AutomationKind;
  name: string;
  sourcePath: string;
  sourceHash: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  message: string;
  result: string | null;
  artifacts: string[];
  conversationId?: string;
  turn?: number;
}
export const runLabels: Record<RunStatus, string> = {
  queued: '대기 중', running: '실행 중', cancelling: '취소 중', succeeded: '완료', partial: '부분 실패',
  waiting_input: '답변 필요', needs_input: '추가 작업 필요', failed: '실패', cancelled: '취소됨', interrupted: '중단됨'
};
export function isActive(status: RunStatus) { return ['queued', 'running', 'cancelling'].includes(status); }
export function skillPage(items: AutomationItem[], query: string, page: number) {
  const term = query.trim().normalize('NFC').toLocaleLowerCase();
  const filtered = items.filter(item => item.kind === 'skill' &&
    `${item.name} ${item.description} ${item.path}`.normalize('NFC').toLocaleLowerCase().includes(term));
  const pages = Math.max(1, Math.ceil(filtered.length / 4));
  const current = Math.max(0, Math.min(page, pages - 1));
  return { items: filtered.slice(current * 4, current * 4 + 4), total: filtered.length, pages, page: current };
}

export interface SkillConversation {
  id: string;
  name: string;
  canReply: boolean;
  reason: string | null;
  turns: { run: AutomationRun; input: string }[];
}

export interface AutomationNotification {
  id: string; kind: AutomationKind; name: string; status: RunStatus;
  createdAt: string; readAt: string | null; conversationId?: string;
}
export interface NotificationPage { notifications: AutomationNotification[]; unreadCount: number; nextCursor: string | null }
