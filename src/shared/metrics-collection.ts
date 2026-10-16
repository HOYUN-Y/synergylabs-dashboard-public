export const METRIC_SERVICES = ['ghost', 'youtube'] as const;
export type MetricService = typeof METRIC_SERVICES[number];
export interface CollectionAttempt {
  id: string;
  service: MetricService;
  trigger: 'manual' | 'scheduled';
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  retryable: boolean;
  snapshotSaved: boolean;
  pid: number;
  snapshotFile?: string;
}
export interface CollectionState {
  lastAttempt: CollectionAttempt | null;
  lastSuccessAt: string | null;
}
export interface CollectionStatus {
  schedule: { registered: boolean; hour: 9; timeZone: 'Asia/Seoul' };
  services: Record<MetricService, CollectionState & { available: boolean; nextRetryAt: string | null }>;
}
export const isMetricService = (v: unknown): v is MetricService => v === 'ghost' || v === 'youtube';
