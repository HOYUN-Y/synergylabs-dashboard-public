import type { AuthClientStatus } from './auth-settings.js';
export interface HealthResponse {
  status: 'ok';
  time: string;
}

export interface MailSettings {
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
  mailbox: string;
}
export interface MailInput extends MailSettings { password: string }
export interface GwsMailInput { provider: 'gws'; account?: string }
export type MailConnectionInput = MailInput | GwsMailInput;
export interface MailTestResponse { ok: boolean; account?: string }
export interface MailSettingsResponse {
  gmailClientConfig?: AuthClientStatus;
  provider?: 'imap' | 'gws' | null;
  account?: string;
  settings: MailSettings | null;
  cleanupPending: boolean;
}
export interface MailMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string | null;
  seen: boolean;
}
export interface MailMessagesResponse {
  messages: MailMessage[];
  fetchedAt: string;
}
