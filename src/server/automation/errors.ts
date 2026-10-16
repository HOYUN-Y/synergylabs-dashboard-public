const messages = {
  CONVERSATION_UNAVAILABLE: '이 대화는 이어서 실행할 수 없습니다. 기록을 확인한 뒤 새 작업을 시작해 주세요.',
  STALE_TURN: '새로운 실행이나 답변이 있습니다. 대화를 새로 확인해 주세요.',
  INVALID_INPUT: '입력 또는 작업 공간 경로를 확인해 주세요.',
  FORBIDDEN: '허용되지 않은 요청입니다.',
  NOT_CONFIGURED: '설정에서 스킬·루틴 작업 공간을 지정해 주세요.',
  NOT_FOUND: '대상 또는 실행 기록을 찾을 수 없습니다.',
  NOT_READY: '실행 설정이 필요하거나 원본 파일이 변경되었습니다. 목록을 다시 확인해 주세요.',
  BUSY: '대기·실행 중인 작업이 있어 작업 공간을 변경할 수 없습니다.',
  PATH_DENIED: '허용된 폴더 안의 일반 파일만 사용할 수 있습니다.',
  STORAGE_FAILED: '실행 기록 또는 설정을 읽거나 저장하지 못했습니다.',
  CLI_MISSING: '선택한 CLI를 찾을 수 없습니다. 설치와 실행 권한을 확인해 주세요.',
  EXECUTION_FAILED: '실행에 실패했습니다. CLI 로그인 또는 루틴의 로컬 환경 설정을 확인해 주세요.',
  INVALID_RESULT: '필수 결과를 확인하지 못해 완료로 처리하지 않았습니다.',
  TIMEOUT: '실행 제한 시간을 초과했습니다.',
  CANCELLED: '실행을 취소했습니다. 이미 생성된 파일은 유지됩니다.',
  OUTPUT_LIMIT: '실행 출력이 허용 크기를 초과했습니다.',
  INTERNAL_ERROR: '자동화 작업을 처리하지 못했습니다.'
};
export class AutomationError extends Error {
  constructor(public code: keyof typeof messages) { super(messages[code]); }
}
