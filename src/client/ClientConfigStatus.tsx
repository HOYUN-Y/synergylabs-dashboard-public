import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { AuthClientStatus } from '../shared/auth-settings';

const sources: Record<AuthClientStatus['source'], string> = { settings_file: '설정 파일', environment: '기존 환경변수', legacy_file: '기본 파일', cli: '명령 옵션', none: '설정 없음' };

/** Google 클라이언트 설정(읽기 전용, 시안의 '찾은 항목' 줄 모양): 어디서 온 값인지 · 파일명 · client ID 끝자리 · 형식 상태.
 *  형식만 확인한 결과이며 로그인 · 권한 상태와는 별개다. client secret · 전체 ID · 절대경로는 서버가 보내지 않는다 */
export function ClientConfigStatus({ status, label, tools, children }: { status: AuthClientStatus; label: string; tools?: ReactNode; children?: ReactNode }) {
  const ok = status.validation === 'valid';
  // 설정 파일 자체가 손상되면 파일명이 없다
  const name = status.fileName ?? (status.source === 'settings_file' ? 'env/auth-settings.json' : sources[status.source]);
  const state = ok ? status.fileName ? '파일 형식 정상' : '설정됨' : status.validation === 'invalid' ? '확인 필요' : '';
  const facts = [status.fileName && sources[status.source], status.clientIdHint && `ID 끝 ${status.clientIdHint}`, state].filter(Boolean).join(' · ');
  // 목록(li)으로 두지 않는다: 이메일 탭의 단계 목록(.settings__steps li) 안에 들어가면 단계 번호가 붙는다
  return <div className="settings__found client-config" data-validation={status.validation}>
    <p className="field-label">{label}</p>
    <div className="client-config__row">
      <Icon name={ok ? 'check' : 'alert'} className="i--sm" />
      <span className="mono client-config__name" title={name}>{name}</span>
      {facts && <span className="caption">{facts}</span>}
      {tools}
    </div>
    {children}
  </div>;
}
