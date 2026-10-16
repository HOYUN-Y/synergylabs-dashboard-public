import icons from './brand/icons.svg';
// 재생 · 중지 · 일시정지는 작은 버튼 안에서도 또렷하게 채워 그린다(시안 icons.js의 FILLED_ICONS).
const filled = new Set(['play', 'stop', 'pause']);
export function Icon({ name, className }: { name: string; className?: string }) {
  return <svg className={['i', filled.has(name) && 'i--fill', className].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href={`${icons}#${name}`} /></svg>;
}
