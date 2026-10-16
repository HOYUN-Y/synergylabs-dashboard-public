// 메인 화면 가운데 구체 — 시안 js/orb-globe.js를 옮겼다. 열린 구체와 같은 별자리 · 고리를 모두 주황으로, 엣지 · 이름표 없이 그린다.
// 구체 전체가 여는 버튼이다. 천천히 돌고(한 바퀴 약 70초) 올리면 1.4배로 빨라지며, 구체 위에서 휠을 굴리면 굴린 만큼 빨리 돌다가 서서히 돌아온다.
// 크기는 열린 구체의 70%이고 자리는 같다(열면 제자리에서 1/0.7배로 커지며 분야 색으로 물든다)
import { useContext, useEffect, useRef } from 'react';
import { DashboardVisible } from '../dashboard-state';
import { Icon } from '../Icon';
import { ORB_RATIO } from './BrainCard';
import type { BrainController } from './controller';
import { createGlobe } from './globe-renderer.js';
import { mountGlobeSymbols, orbitScene } from './model';

const SPIN = (Math.PI * 2) / 70;
const WHEEL = 0.006; // 휠 1px당 더하는 회전 속도(rad/s). 한 번에 최대 240px까지 센다

export function OrbGlobe({ controller: c, meta }: { controller: BrainController; meta: string }) {
  const card = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null), button = useRef<HTMLButtonElement>(null);
  // 에셋 화면에 가 있는 동안 대시보드는 숨긴 채 남아 있으므로(상태 유지) 구체 그리기도 멈춘다
  const visible = useContext(DashboardVisible), show = useRef<(on: boolean) => void>(() => {});
  useEffect(() => {
    const el = canvas.current!, cardEl = card.current!, buttonEl = button.current!;
    mountGlobeSymbols();
    /* 반지름 = 이 자리(무대 가운데)에서 열 때의 열린 구체 크기의 70%. 무대 안 여백(옆 24px · 아래 '눌러서 열기' 칩 자리 56px)을 넘으면 무대에 맞춘다.
       화면 크기가 바뀔 때만 다시 센다(그리는 매 프레임에 부른다). 잴 수 없으면 무대의 80%로 두고 다음에 다시 잰다 */
    let fit = { key: '', r: 0 };
    const radius = (w: number, h: number) => {
      const key = `${w}|${h}|${innerWidth}x${innerHeight}|${c.measureVersion}`;
      if (fit.key !== key) {
        const room = Math.max(52, Math.min(w / 2 - 24, h / 2 - 56)), box = el.getBoundingClientRect();
        const open = box.width && c.card ? c.card.openRadiusAt(box.left + w / 2, box.top + scrollY + h / 2) : 0;
        fit = { key: open ? key : '', r: Math.max(52, Math.min(room, open ? open * ORB_RATIO : room * 0.8)) };
      }
      return fit.r;
    };
    const globe = createGlobe(el, {}, { mode: 'button', spin: SPIN, radius });
    globe.setGhost(c.m.ghost);
    const ring = orbitScene(c.m);
    globe.setScene({ items: ring.items, edges: [], orbits: ring.orbits });
    globe.start();
    const enter = () => globe.setSpinScale(1.4), leave = () => globe.setSpinScale(1);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const d = (Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX) * unit;
      globe.spinBy(Math.max(-240, Math.min(240, d)) * WHEEL);
    };
    buttonEl.addEventListener('pointerenter', enter); buttonEl.addEventListener('pointerleave', leave);
    buttonEl.addEventListener('wheel', wheel, { passive: false });
    // 크게 연 동안(paused) · 대시보드가 숨은 동안(hidden)은 멈춘다
    let paused = false, hidden = false;
    const run = () => { if (paused || hidden) globe.stop(); else globe.start(); };
    // 열린 구체와 잇기: 화면(뷰포트) 좌표의 구체 원 · 돌아간 각도를 주고, 닫힐 때 그 구체의 각도를 받아 이어 돈다
    const handle = {
      view() { const v = globe.view(), r = el.getBoundingClientRect(); return r.width ? { ...v, cx: r.left + v.cx, cy: r.top + v.cy } : null; },
      setView: globe.setView,
      pause() { paused = true; globe.stop(); el.style.visibility = 'hidden'; },
      // 숨긴 사이 받은 각도로 바로 다시 그린 뒤 보인다(돌아오는 첫 프레임이 비거나 예전 각도로 번쩍이지 않게)
      resume() { paused = false; cardEl.classList.remove('is-opening'); globe.redraw(); el.style.visibility = ''; run(); },
      focus() { buttonEl.focus({ preventScroll: true }); }
    };
    c.orb = handle;
    show.current = on => { hidden = !on; run(); };
    return () => {
      show.current = () => {};
      buttonEl.removeEventListener('pointerenter', enter); buttonEl.removeEventListener('pointerleave', leave); buttonEl.removeEventListener('wheel', wheel);
      if (c.orb === handle) c.orb = null;
      globe.destroy();
    };
  }, [c]);
  useEffect(() => { show.current(visible); }, [visible]);
  const open = () => {
    const cardEl = card.current!;
    if (cardEl.classList.contains('is-opening') || !c.card) return;
    cardEl.classList.add('is-opening');
    c.expand();
  };
  return <section ref={card} className="card orb dash__center" aria-labelledby="orb-title">
    <header className="card__head"><h2 className="card__title" id="orb-title"><Icon name="brain" />세컨드 브레인</h2><span className="card__meta">{meta}</span></header>
    <div className="orb__stage">
      <canvas ref={canvas} className="orb__canvas" aria-hidden="true" />
      <button ref={button} type="button" className="orb__enter" aria-label="세컨드 브레인 열기" onClick={open}>
        <span className="orb__hint">눌러서 세컨드 브레인 열기<Icon name="arrow-up-right" className="i--xs" /></span>
      </button>
    </div>
  </section>;
}
