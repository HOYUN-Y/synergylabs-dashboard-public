import { createContext, useContext, useEffect } from 'react';
export type SettingsTab = 'workspace' | 'mail' | 'calendar' | 'skills';
export const settingsTabs: Record<SettingsTab, string> = { workspace: '작업 공간', mail: '이메일', calendar: '캘린더', skills: '스킬 관리' };
export const SettingsFormContext = createContext<(id: string, state: { dirty: boolean; busy: boolean } | null) => void>(() => {});
export function useSettingsForm(id: string, dirty: boolean, busy: boolean) {
  const report = useContext(SettingsFormContext);
  useEffect(() => { report(id, { dirty, busy }); return () => report(id, null); }, [report, id, dirty, busy]);
}
export function settingsChanged(tab: SettingsTab) {
  window.dispatchEvent(new CustomEvent('dashboard-settings-changed', { detail: tab }));
}
export function useSettingsRefresh(tab: SettingsTab, refresh: () => void) {
  useEffect(() => {
    const listener = (event: Event) => { if ((event as CustomEvent).detail === tab) refresh(); };
    window.addEventListener('dashboard-settings-changed', listener);
    return () => window.removeEventListener('dashboard-settings-changed', listener);
  }, [tab, refresh]);
}
export function updateLocation(values: Record<string, string | null>) {
  const [path, query] = window.location.hash.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) { if (value === null) params.delete(key); else params.set(key, value); }
  // Legacy settings addresses are accepted, but new navigation keeps the underlying page.
  const base = path === '#/assets' ? path : '#/';
  window.location.hash = `${base}${params.size ? `?${params}` : ''}`;
}
