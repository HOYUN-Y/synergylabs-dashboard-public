import { settingsTabs } from './settings-state';
import type { SettingsTab } from './settings-state';
export function parseLocation(hash: string) {
  const [path, query] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const legacy = path === '/settings' || path === '/settings/skills';
  const tab = legacy ? path === '/settings/skills' ? 'skills' : 'workspace' : params.get('settings');
  return {
    page: path === '/assets' ? 'assets' as const : ['', '/', '/dashboard', '/crm'].includes(path) || legacy ? 'dashboard' as const : 'not-found' as const,
    settings: tab && Object.hasOwn(settingsTabs, tab) ? tab as SettingsTab : null,
    conversation: params.get('conversation'), run: params.get('run')
  };
}

export function oauthReturnLocation(hash: string, pending: string | null) {
  return hash === '#/settings' && pending === 'calendar' ? '#/?settings=calendar' : null;
}
