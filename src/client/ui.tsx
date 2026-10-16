// 화면 공용 부품 — 시안 docs/design/dashboard-v2/js/ui.js(아이콘 버튼 · 툴팁 · 팝오버 · 토스트 · 스크롤 흐림)를 React로 옮겼다.
// 스타일은 design/base.css의 시안 class를 그대로 쓴다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import icons from './brand/icons.svg';
import { Icon } from './Icon';
import { fmt } from './format';
import type { RunStatus } from '../shared/automation';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: string; label: string; tip?: string | null; variant?: 'line' | 'solid' | 'accent'; size?: 'sm' | 'lg';
  busy?: boolean; ref?: Ref<HTMLButtonElement>; children?: ReactNode;
};
/** 글자 대신 심볼을 쓰는 버튼. label은 화면 낭독기용, tip은 마우스 · 키보드 포커스 설명(null이면 툴팁 없음) */
export function IconButton({ icon, label, tip, variant, size, busy, className, ref, children, ...rest }: IconButtonProps) {
  const classes = ['icon-btn', variant && `icon-btn--${variant}`, size && `icon-btn--${size}`, busy && 'is-busy', className].filter(Boolean).join(' ');
  return <button ref={ref} type="button" className={classes} aria-label={label} data-tip={tip === null ? undefined : tip ?? label} {...rest}><Icon name={icon} />{children}</button>;
}

export function EmptyState({ icon, title, text, action, role }: { icon: string; title: string; text?: ReactNode; action?: ReactNode; role?: 'status' | 'alert' }) {
  return <div className="empty" role={role}><span className="empty__icon"><Icon name={icon} /></span><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>;
}

export function Skel({ width, height = 12, style }: { width: string | number; height?: number; style?: CSSProperties }) {
  return <span className="skel" style={{ width, height, ...style }} />;
}

/** 카드 · 창 안의 안내 줄. attention이면 왼쪽 오렌지 막대 */
export function Notice({ icon = 'info', attention, role, className, children }: { icon?: string; attention?: boolean; role?: 'status' | 'alert'; className?: string; children: ReactNode }) {
  return <div className={['notice', attention && 'notice--attention', className].filter(Boolean).join(' ')} role={role}><Icon name={icon} /><div className="notice__text">{children}</div></div>;
}

export const statusIcon = (status: RunStatus) => ({ succeeded: 'check', failed: 'alert', waiting_input: 'message', needs_input: 'message', running: 'clock', queued: 'clock', cancelling: 'clock' } as Partial<Record<RunStatus, string>>)[status] ?? 'info';

/** 실행 경과 시간(분:초). 1초마다 다시 그린다 */
export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <span className="mono tile__elapsed">{fmt.elapsed(Math.max(0, (now - Date.parse(since)) / 1000))}</span>;
}

/** 스크롤 목록 아래에 더 있을 때만 끝을 흐리게 한다(ref 콜백). */
export function scrollHint(element: HTMLElement | null) {
  if (!element) return;
  const sync = () => element.classList.toggle('has-more', element.scrollTop + element.clientHeight < element.scrollHeight - 2);
  sync();
  element.addEventListener('scroll', sync, { passive: true });
  const resize = new ResizeObserver(sync); resize.observe(element);
  const mutation = new MutationObserver(sync); mutation.observe(element, { childList: true, subtree: true });
  return () => { element.removeEventListener('scroll', sync); resize.disconnect(); mutation.disconnect(); };
}

/* ── 팝오버: 한 번에 하나. 바깥 누르기 · Esc로 닫고, Esc · 취소는 연 버튼으로 포커스를 돌려준다 ── */
type Placement = 'bottom-end' | 'bottom-start' | 'right-start';
type Side = 'below' | 'above';
/** 아래(bottom-*)가 기본이고, 모자라면 위로 뒤집는다. 양쪽 다 모자라면 자리가 넓은 쪽에 두고 화면 안으로 민다.
 *  한 번 정한 쪽(prefer)은 그쪽에 들어가는 동안 유지한다 — 내용이 바뀌어 크기가 달라져도 반대쪽으로 튀지 않게 */
function place(pop: HTMLElement, anchor: HTMLElement, placement: Placement, prefer?: Side): Side | undefined {
  const r = anchor.getBoundingClientRect(); const p = pop.getBoundingClientRect();
  const gap = 8, edge = 12; const [side, align] = placement.split('-');
  let top: number; let left: number; let chosen: Side | undefined;
  if (side === 'right') {
    left = r.right + gap; top = r.top;
    if (top + p.height > innerHeight - edge) top = Math.max(edge, innerHeight - edge - p.height);
  } else {
    const room = { below: innerHeight - edge - (r.bottom + gap), above: r.top - gap - edge };
    const first = prefer ?? 'below', other: Side = first === 'below' ? 'above' : 'below';
    chosen = p.height <= room[first] ? first : p.height <= room[other] ? other : room.below >= room.above ? 'below' : 'above';
    top = Math.max(edge, Math.min(chosen === 'below' ? r.bottom + gap : r.top - gap - p.height, innerHeight - edge - p.height));
    left = align === 'start' ? r.left : r.right - p.width;
  }
  if (left + p.width > innerWidth - edge) left = side === 'right' ? r.left - p.width - gap : innerWidth - p.width - edge;
  left = Math.max(edge, left);
  pop.style.top = `${Math.round(top)}px`; pop.style.left = `${Math.round(left)}px`;
  return chosen;
}
export function Popover({ anchor, label, placement = 'bottom-end', className, onClose, children }: {
  anchor: HTMLElement; label: string; placement?: Placement; className?: string; onClose: (restoreFocus: boolean) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    const pop = ref.current!;
    let side: Side | undefined;
    const reposition = () => { if (anchor.isConnected) side = place(pop, anchor, placement, side); else close.current(false); };
    reposition();
    hideTip();
    anchor.setAttribute('aria-expanded', 'true');
    const onDown = (event: PointerEvent) => { const target = event.target as Node; if (!pop.contains(target) && !anchor.contains(target)) close.current(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(true); } };
    const resize = new ResizeObserver(reposition); resize.observe(pop);
    const timer = setTimeout(() => document.addEventListener('pointerdown', onDown));
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', reposition); addEventListener('scroll', reposition, true);
    // 우선순위: data-autofocus → 고른 항목 → 첫 번째 조작 요소
    const focusable = pop.querySelector<HTMLElement>('[data-autofocus]') ?? pop.querySelector<HTMLElement>('[aria-checked="true"], [aria-selected="true"]')
      ?? pop.querySelector<HTMLElement>('button:not(:disabled), [href], input, select, textarea');
    focusable?.focus({ preventScroll: true });
    // 내용을 아직 불러오는 중이라 고를 것이 없으면 팝오버 자체에 포커스를 둔다(Esc · Tab이 팝오버에서 시작)
    if (!pop.contains(document.activeElement)) pop.focus({ preventScroll: true });
    return () => {
      clearTimeout(timer); resize.disconnect();
      document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', reposition); removeEventListener('scroll', reposition, true);
      anchor.setAttribute('aria-expanded', 'false');
    };
  }, [anchor, placement]);
  return createPortal(<div ref={ref} className={['popover', className].filter(Boolean).join(' ')} role="dialog" aria-label={label} tabIndex={-1}>{children}</div>, document.body);
}

/* ── 네이티브 대화상자: 가림막(대화상자 바깥)을 누르면 닫는다. 대화상자 안쪽 누르기는 무시 ── */
export function closeOnBackdrop(event: ReactPointerEvent<HTMLDialogElement>, close: () => void) {
  if (event.target !== event.currentTarget) return;
  const r = event.currentTarget.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
}

/* ── 툴팁: [data-tip]에 마우스를 0.4초 올리거나 키보드로 포커스하면 나타난다. 앱에서 한 번만 켠다 ── */
const tip = { el: null as HTMLDivElement | null, timer: 0, target: null as Element | null };
function hideTip() { clearTimeout(tip.timer); tip.target = null; tip.el?.classList.remove('is-on'); }
function showTip(target: Element) {
  const text = target.getAttribute('data-tip');
  if (!text || !target.isConnected || target.getAttribute('aria-expanded') === 'true') return;
  // 대화상자 · 팝오버가 열려 있으면 그 안의 요소만 툴팁을 띄운다
  const layer = document.querySelector('dialog[open]') ?? document.querySelector('.popover');
  if (layer && !layer.contains(target)) return;
  if (!tip.el) { tip.el = document.createElement('div'); tip.el.className = 'tooltip'; tip.el.setAttribute('role', 'tooltip'); }
  const el = tip.el;
  // 모달 대화상자는 최상위 층이라 툴팁도 그 안에 넣어야 보인다
  const host = target.closest('dialog[open]') ?? document.body;
  if (el.parentElement !== host) host.append(el);
  el.textContent = text; el.classList.add('is-on');
  const r = target.getBoundingClientRect(); const t = el.getBoundingClientRect();
  let top = r.top - t.height - 8; if (top < 8) top = r.bottom + 8;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8));
  el.style.top = `${Math.round(top)}px`; el.style.left = `${Math.round(left)}px`;
  tip.target = target;
}
export function useTooltips() {
  useEffect(() => {
    const over = (event: PointerEvent) => {
      const target = (event.target as Element).closest?.('[data-tip]');
      if (!target || target === tip.target) return;
      hideTip(); tip.timer = window.setTimeout(() => showTip(target), Number((target as HTMLElement).dataset.tipDelay ?? 400));
    };
    const out = (event: PointerEvent) => {
      const target = (event.target as Element).closest?.('[data-tip]');
      if (target && !target.contains(event.relatedTarget as Node)) hideTip();
    };
    const focus = (event: FocusEvent) => {
      const target = (event.target as Element).closest?.('[data-tip]');
      if (target && target.matches(':focus-visible')) { hideTip(); showTip(target); }
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hideTip(); };
    const check = () => { if (tip.target && !tip.target.isConnected) hideTip(); };
    const observer = new MutationObserver(check); observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', hideTip);
    document.addEventListener('pointerdown', hideTip); document.addEventListener('keydown', key);
    addEventListener('scroll', hideTip, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hideTip);
      document.removeEventListener('pointerdown', hideTip); document.removeEventListener('keydown', key);
      removeEventListener('scroll', hideTip, true); hideTip();
    };
  }, []);
}

/* ── 토스트: 화면 아래 가운데에 잠깐 뜨는 알림 ── */
export function toast(message: string, icon: string | null = 'check') {
  let host = document.querySelector<HTMLElement>('.toast-host');
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); }
  // 모달 대화상자가 열려 있으면 그 위에 보이도록 대화상자 안에 둔다
  const layer = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body;
  if (host.parentElement !== layer) layer.append(host);
  const item = document.createElement('div'); item.className = 'toast';
  if (icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'i'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `${icons}#${icon}`);
    svg.append(use); item.append(svg);
  }
  const text = document.createElement('span'); text.textContent = message; item.append(text);
  host.append(item);
  setTimeout(() => item.remove(), 3200);
}
