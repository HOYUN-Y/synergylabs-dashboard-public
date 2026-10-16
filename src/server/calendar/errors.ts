const messages = {
  INVALID_INPUT: '캘린더 설정 또는 조회 기간을 확인해 주세요.',
  FORBIDDEN: '허용되지 않은 요청입니다.',
  NOT_CONFIGURED: 'env/auth-settings.json 또는 기존 Google 클라이언트 환경변수를 설정해 주세요.',
  AUTH_SETTINGS_INVALID: 'env/auth-settings.json의 형식·버전·파일명·접근 권한을 확인해 주세요.',
  AUTH_CLIENT_INVALID: '선택한 OAuth JSON의 존재·권한·크기와 데스크톱 클라이언트 형식을 확인해 주세요.',
  NOT_CONNECTED: '설정에서 Google 계정을 연결해 주세요.',
  NO_CALENDAR: '설정에서 회사 캘린더를 선택해 주세요.',
  REAUTH_REQUIRED: 'Google 인증이 만료되거나 취소되었습니다. 다시 연결해 주세요.',
  ACCESS_DENIED: '캘린더 조회 권한이 없습니다. 공유 권한을 확인해 주세요.',
  API_DISABLED: 'Cloud Console에서 Google Calendar API를 활성화해 주세요.',
  RATE_LIMIT: 'Google 조회 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  TIMEOUT: 'Google 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
  NETWORK: 'Google에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.',
  INVALID_RESPONSE: 'Google 응답이 완전하지 않습니다. 다시 조회해 주세요.',
  KEYCHAIN_FAILED: 'Mac 키체인에 접근하지 못했습니다. 접근 권한을 확인해 주세요.',
  STORAGE_FAILED: '캘린더 설정을 저장하거나 읽지 못했습니다.',
  CONFIG_CHANGED: '캘린더 연결이 변경되었습니다. 다시 조회해 주세요.',
  AUTH_CANCELLED: 'Google 연결이 취소되었습니다.',
  AUTH_EXPIRED: '인증 대기 시간이 만료되었습니다. 다시 연결해 주세요.',
  AUTH_FAILED: 'Google 인증을 완료하지 못했습니다. 클라이언트 설정·테스트 사용자·조회 권한을 확인해 주세요.',
  INTERNAL_ERROR: '캘린더 작업을 완료하지 못했습니다.'
};
export class CalendarError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); }
}
