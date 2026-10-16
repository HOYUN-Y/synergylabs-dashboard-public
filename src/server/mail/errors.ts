const messages = {
  GWS_NOT_FOUND: 'gws가 없습니다. 터미널에서 설치한 뒤 서버를 다시 시작해 주세요.',
  GWS_AUTH_REQUIRED: 'gws 로그인이 필요합니다. 터미널에서 Gmail 권한으로 로그인해 주세요.',
  GWS_PERMISSION: 'Gmail 조회 권한이 없습니다. 필요한 권한으로 다시 로그인해 주세요.',
  GWS_API_DISABLED: 'Google Cloud에서 Gmail API를 활성화해 주세요.',
  GWS_FAILED: 'gws 조회에 실패했습니다. 설치 버전과 네트워크를 확인해 주세요.',
  GWS_RESPONSE: 'gws 응답 형식이 올바르지 않습니다. 지원 버전을 확인해 주세요.',
  ACCOUNT_CHANGED: 'gws 계정이 변경되었습니다. 설정에서 계정을 확인하고 다시 저장해 주세요.',

  INVALID_INPUT: '서버·포트·보안 방식·계정·비밀번호·메일함을 확인해 주세요.',
  NOT_CONFIGURED: '이메일을 먼저 연결해 주세요.',
  AUTH_FAILED: '인증에 실패했습니다. 사용자명과 앱 비밀번호를 확인해 주세요.',
  CONNECTION_FAILED: '메일 서버에 접속하지 못했습니다. 서버 주소와 네트워크를 확인해 주세요.',
  TLS_FAILED: '암호화 연결을 확인하지 못했습니다. 포트와 보안 방식을 확인해 주세요.',
  MAILBOX_FAILED: '지정한 메일함을 읽을 수 없습니다. 메일함 이름과 권한을 확인해 주세요.',
  TIMEOUT: '메일 서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.',
  KEYCHAIN_FAILED: 'Mac 키체인에 접근하지 못했습니다. 키체인 잠금과 접근 권한을 확인해 주세요.',
  STORAGE_FAILED: '개인 설정을 읽거나 저장하지 못했습니다. 로컬 폴더 권한을 확인해 주세요.',
  CONFIG_CHANGED: '연결 설정이 변경되었습니다. 다시 조회해 주세요.',
  FORBIDDEN: '대시보드의 로컬 화면에서 요청해 주세요.',
  INTERNAL_ERROR: '메일 작업을 완료하지 못했습니다. 다시 시도해 주세요.'
};
export class MailError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); }
}
