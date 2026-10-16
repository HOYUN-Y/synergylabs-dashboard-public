export const GHOST_FILTER = 'subscribed:true+email_disabled:false';
export type MetricSource = 'api' | 'manual';
export interface GhostMetricsHistoryEntry {
  metricDate: string;
  subscribedMembers: number | null;
  delta: number | null;
  collectedAt: string | null;
  source: MetricSource | null;
}
export interface GhostMetricsSummary {
  current: { subscribedMembers: number; metricDate: string; collectedAt: string; source: MetricSource };
  previous: { subscribedMembers: number; metricDate: string; source: MetricSource } | null;
  delta: number | null;
  history: GhostMetricsHistoryEntry[];
  stale: boolean;
  invalidFiles: number;
}
