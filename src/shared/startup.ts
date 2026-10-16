export type StartupKey = 'automation' | 'assets' | 'brain' | 'mail' | 'calendar';
export interface StartupItem {
  state: 'pending' | 'ready' | 'connection_required' | 'error';
  message: string;
  finishedAt?: string;
}
export interface StartupStatus {
  startedAt: string | null;
  openReady: boolean;
  waiting: boolean;
  timedOut: boolean;
  items: Partial<Record<StartupKey, StartupItem>>;
}
