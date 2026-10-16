/** 설정 검증 상태이며 실제 Google 로그인·권한 상태와 별개다. */
export interface AuthClientStatus {
  source: 'settings_file' | 'environment' | 'legacy_file' | 'cli' | 'none';
  fileName: string | null;
  clientIdHint: string | null;
  validation: 'valid' | 'missing' | 'invalid';
  error: 'NOT_CONFIGURED' | 'AUTH_SETTINGS_INVALID' | 'AUTH_CLIENT_INVALID' | null;
  message: string;
}
