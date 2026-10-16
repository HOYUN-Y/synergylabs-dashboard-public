/* 앱 화면: docs/design/second-brain-globe-20261014/js/globe.js를 옮겼다(시안과 같은 렌더러).
   바꾼 곳: 전역(window.SLGlobe) 대신 ES 모듈로 내보내고, React 화면이 내려갈 때 쓰는 destroy()를 더했다(그리기 중단 · 크기 감시 · 동작 줄이기 감시 해제).
   분야 기준 방향을 시안 분야 id(ANCHORS) 대신 지도 응답 groups 순서로 정한다(ANCHOR_DIRS · anchorsOf — 설정에 분야를 더해도 자리가 겹치지 않게).
   2026-10-16 신경망 시안(docs/design/second-brain-neural-20261016/js/globe.js)에서 공으로 모으지 않는 신경망 배치(neuralLayout · layout()의 anchors),
   살짝 휜 네트워크 선(BEND · curveTo), 메인 화면 구체의 주황 가지 선(REST_EDGE), 이를 끄는 options.neural을 옮겼다.
   스킬 · 루틴은 궤도(토성 고리)로만 두므로 시안의 고리 ↔ 망 날기(flights · modelPosOf)는 옮기지 않았다.
   ─ 아래는 시안 원문 ─
/* 세컨드 브레인 지구본 — 배치(layout)와 Canvas 2D 렌더러(createGlobe).
   참고: n1ghtmare-dev/obsidian-cosmograph (MIT). 구 표면 배치 · 이웃 깊이 포커스 · 고른 항목을 앞으로 돌리는 동작을 참고했고
   코드는 가져오지 않았다. 흰 바탕에서는 발광(bloom)이 보이지 않으므로 뒤쪽 반구를 반투명 막으로 덮어 앞뒤를 나눈다.
   검은 바탕(다크 모드 시안 — css/dark.css)에서는 CosmoGraph처럼 빛을 쓴다: 대기 빛무리 · 밝게 솟는 봉우리 · 짙은 그늘(LOOKS).
   네트워크 구체(?look=network)는 구 표면 · 지형 없이 작업 공간 전체의 문서 · 폴더(점)를 3차원 공간에 퍼뜨리고(volumeLayout) 연결을 직선으로 잇는다.
   점과 선이 모인 모양이 대략 공이 되고, 고르면 관련 항목 · 선이 빛난다.
   표면의 점은 dashboard-v2 점 구체(js/orb.js)와 같은 규칙(피보나치 나선 · 깊이와 왼쪽 위 빛으로 정한 진하기)으로 그려,
   메인 화면의 점 구체가 그대로 커져 지구본이 되는 것처럼 보이게 한다.
   가운데 핵 = centerId(AGENTS.md, 없으면 작업 공간 루트). 표면 = 분야별 폴더 트리. 폴더는 자기 자리에서 하위 항목을 해바라기 배열로 펼친다. */

  const TAU = Math.PI * 2;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const CAMERA = 3.2;                 // 카메라 거리(구 반지름 = 1). 점 구체(2.8)보다 원근을 약하게 해 이름표가 덜 일그러진다
  const PITCH_LIMIT = 1.25;
  const SPIN = 0.06;                  // 자동 회전 rad/s(점 구체의 2/3 — 이름표를 읽을 수 있게)
  const APPEAR_MS = 520;
  const INTRO_MS = 900;
  const OUTRO_MS = 420;
  const SHRINK_MS = 640;              // 닫을 때 메인 화면 가운데 행성 자리로 줄어드는 시간
  const SPIN_MAX = 6;                 // 휠로 더할 수 있는 회전 속도 상한(rad/s, 약 1초에 한 바퀴)
  // 표면 점 개수: 화면 폭으로만 정해 메인 화면 행성과 크게 연 지구본이 같은 점을 쓴다(열고 닫을 때 점이 바뀌어 반짝이지 않게)
  const dotCount = () => (window.innerWidth < 720 ? 900 : 1800);
  const LIGHT = (() => { const v = [-0.45, 0.55, 0.7]; const n = Math.hypot(...v); return v.map(c => c / n); })(); // 왼쪽 위 앞(y 위쪽이 +)
  const DOT_LEVELS = 10;
  const REST_TONE = 0.4;               // 열린 뒤 표면 점의 진하기(1 = 메인 화면 점 구체와 같음)
  const LINE_FADE = 0.15;              // 연결선이 행성 테두리(지평선)에 닿을 때의 진하기 배율 — 구 뒤로 넘어가는 선이 테두리에서 흐려진다(draw lineFade)
  // 위성 ↔ 항목 곡선(draw): lean = 출발 방향을 앞으로 숙이는 양(클수록 곧아지고 행성 옆을 덜 돈다), drop = 높이가 내려오는 빠르기, bend = 핵으로 가는 줄의 옆 휨(rad)
  const TETHER = { lean: 0.35, drop: 3, bend: 0.1 };
  // 지형: 높이 = 그 자리에 쌓인 문서 양. 산의 큰 모양이 가장 높은 곳에서 구 반지름의 15%(CosmoGraph 장식 지형은 약 10%).
  // land: 파일 하나의 봉우리 꼭대기를 1로 볼 때 밀도가 0.45를 넘는 곳이 땅(파일 하나 둘레도 작은 섬이 된다). 나머지는 바다(평평)
  // levels: 등고선(첫 줄 = 해안선). relief: 빛을 받는 경사 과장 배율
  // rough: 땅에만 얹는 바위 질감(그 자리 고도의 ±45%). 바다(고도 0)에는 생기지 않아 문서가 없는 곳을 산처럼 보이게 하지 않는다
  // narrow: 땅 · 분야 색을 정하는 좁은 봉우리 폭(배치 간격 배수), wide: 높이를 정하는 넓은 봉우리 폭(큰 분야일수록 넓고 높은 산)
  const TERRAIN = { lon: 240, lat: 120, height: 0.15, gamma: 0.7, land: 0.45, shore: 0.04, rough: 0.45, narrow: 0.8, wide: 1.8, levels: [0.02, 0.3, 0.55, 0.8], relief: 4 };
  // 분야 기준 방향: 지도 응답 groups(설정 순서: 스킬 · 분야들 · 루틴 · 기타) 차례로 앉는다(anchorsOf). 앞의 여섯은 시안이 고른 자리라
  // 첫째 · 둘째 · 셋째(지금 스킬 · 콘텐츠 · 개발운영)가 첫 화면 앞쪽에 오고 넷째부터는 돌려야 보인다. 일곱째부터는 이미 쓴 방향에서 가장 먼 곳
  const ANCHOR_DIRS = [[0.64, 0.36, 0.68], [-0.6, 0.32, 0.73], [0.02, -0.72, 0.69], [0.88, -0.2, -0.43], [-0.82, -0.28, -0.5], [0.04, 0.9, -0.43]];
  // 바탕별 그리기. 색은 CSS 토큰(readColors · --g-*)에서 오고, 여기서는 바탕 밝기에 따라 달라지는 그리기 방식만 고른다.
  // 흰 바탕: 땅은 바다색에 분야 색을 옅게 섞고(높을수록 진하게) 그늘은 얕게. 빛무리는 보이지 않으므로 쓰지 않는다.
  // 검은 바탕: 땅은 높을수록 밝아지고 높은 봉우리에는 흰빛이 돈다(peak). 그늘 · 가장자리 어둡기(limb)를 짙게 하고 행성 둘레에 대기 빛무리를 둔다.
  // tint: 땅 색 진하기 [해안, 높이 기울기, 최대], shade: 경사 조명 [바탕, 빛 몫], contour: 등고선 진하기 배수, ring: 궤도 선 진하기,
  // hollow: 속 빈 표시(폴더)의 속을 분야 색으로 옅게 채우는 양(검은 바탕에서 바탕색 그대로면 구멍처럼 보인다),
  // bloom: 앞쪽 항목 둘레 빛 세기, additive: 앞쪽 연결선을 더해 칠한다(겹치는 곳이 밝아진다)
  // 네트워크 구체(<html data-look="network">, 검은 바탕): 구 표면 · 지형 · 표면 점 · 빛무리 없이 별자리(setGhost — 문서 · 폴더 점과 선)가 공 모양으로 모인다.
  // volume: 항목이 구 표면이 아니라 3차원 자리(pos)에 있고 선은 모두 직선, 가리는 구가 없다. glow: 고르면 관련 항목 · 선이 빛나고 선을 따라 빛이 흐른다
  const DARK = { tint: [0.3, 0.62, 0.95], peak: 0.16, shade: [0.62, 0.48], limb: 0.3, contour: 0.85, ring: 0.62, atmosphere: 1, hollow: 0.3, bloom: 0.55, additive: true };
  const LOOKS = {
    light: { tint: [0.2, 0.45, 0.72], peak: 0, shade: [0.84, 0.24], limb: 0.07, contour: 1, ring: 0.42, atmosphere: 0, hollow: 0, bloom: 0, additive: false },
    dark: DARK,
    network: { ...DARK, atmosphere: 0, hollow: 0.35, bloom: 0.75, dots: false, volume: true, glow: true }
  };
  const lookNow = () => (document.documentElement.dataset.look === 'network' ? LOOKS.network
    : getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() === 'dark' ? LOOKS.dark : LOOKS.light);
  const ON_ACCENT = '#ffffff';        // 오렌지 면 위 글리프(핵의 반짝이). 다크에서도 흰색
  const HOME = { yaw: 0.22, pitch: 0.12 };
  /* 네트워크 구체: 스킬 · 루틴 토성 고리가 그래프의 적도면(법선 = 회전축 y)에 있어 끌어서 시점을 바꾸면 함께 기울고 돈다.
     처음 시점은 고리가 24° 열려 보이게 위에서 내려다보고(pitch 0.42), 화면에서 −20° 비스듬히 돌려 둔다(ROLL — 그래프 전체에 같이 적용).
     고리가 회전축에 수직이라 저절로 돌 때(yaw)는 고리 모양이 그대로이고 위성만 돈다 */
  const HOME_VOLUME = { yaw: 0.22, pitch: 0.42 }, ROLL_VOLUME = -0.35;
  const FOCUS_AT = [0, 0.4];          // 고른 항목이 돌아와 서는 자리(구 반지름 기준 화면 x, y) — 가운데 핵 바로 위
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // 고른 항목 · 연결이 빛날 때의 맥동(0.56 ~ 1). 동작 줄이기에서는 멈춘 빛
  const pulseAt = now => (reducedMotion.matches ? 0.85 : 0.78 + 0.22 * Math.sin(now / 480));

  /* ── 벡터 ── */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  /* 테두리 쪽 높이 누르기: 솟은 땅(점 · 등고선 · 항목 · 선)이 행성 테두리 밖으로 삐져나오지 않게 한다.
     화면 쪽 성분 z(회전 후 방향의 z)에서 테두리 안에 머무는 최대 반지름은 C / (sin·√(C²−1) + cos)이다(지평선 z = 1/C에서 1, 정면에서 C).
     그 여유의 85%를 넘지 않게 부드럽게 줄인다. 정면 쪽 산(여유가 큼)은 그대로이고 테두리 쪽만 낮아진다.
     행성 면은 구 위에 칠하므로(paintPlanet) 이렇게 하면 면과 그 위의 점 · 등고선이 테두리에서 어긋나지 않는다 */
  const SIL_K = Math.sqrt(CAMERA * CAMERA - 1);
  function limbClamp(h, z) {
    if (h <= 0 || z <= 1 / CAMERA) return 0;
    const room = (CAMERA / (Math.sqrt(Math.max(0, 1 - z * z)) * SIL_K + z) - 1) * 0.85;
    if (room <= 0) return 0;
    const q = h / room;
    return q < 0.35 ? h : h / Math.sqrt(Math.sqrt(1 + q * q * q * q)); // 부드러운 최솟값(h와 여유 중 작은 쪽으로 이어진다)
  }
  /* 열린 지구본 반지름: (x, y)를 가운데로 둘 때 궤도 원(구 반지름 배수 ext)과 그 밖의 위성 이름표 자리
     (가로 폭의 16% · 56~150px, 세로 28px)가 무대(box: { width, height, insets }) 안에 들어가는 크기. 가운데가 한쪽으로 치우치면 좁은 쪽에 맞춘다.
     렌더러와 메인 화면 행성(열린 지구본의 70% 크기 — brain-globe.js openRadiusAt)이 같은 식을 쓴다 */
  function fitIn(box, x, y, ext) {
    const { width, height, insets } = box, w = width - insets.left - insets.right;
    const hw = Math.min(x - insets.left, width - insets.right - x), hh = Math.min(y - insets.top, height - insets.bottom - y);
    const labelRoom = clamp(w * 0.16, 56, 150);
    return Math.max(60, Math.min(hh * 0.84, hw * 0.84, (hw - labelRoom) / (ext.x * 1.02), (hh - 28) / (ext.y * 1.02)));
  }
  function perpendicular(a) { return norm(cross(a, Math.abs(a[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0])); }
  function slerp(a, b, t) {
    const d = clamp(dot(a, b), -1, 1);
    if (d > 0.9995) return norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    if (d < -0.9995) { const p = perpendicular(a); return t < 0.5 ? slerp(a, p, t * 2) : slerp(p, b, t * 2 - 1); }
    const w = Math.acos(d), s = Math.sin(w), k0 = Math.sin((1 - t) * w) / s, k1 = Math.sin(t * w) / s;
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
  }
  function around(center, radius, angle) {
    const t1 = perpendicular(center), t2 = cross(center, t1);
    const c = Math.cos(radius), s = Math.sin(radius), ca = Math.cos(angle), sa = Math.sin(angle);
    return norm([0, 1, 2].map(i => center[i] * c + (t1[i] * ca + t2[i] * sa) * s));
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  /* ── 배치 ──
     전체 트리를 한 번에 배치한다. 접힌 폴더의 하위 항목도 자리를 미리 받아 두므로 펼쳐도 다른 항목이 움직이지 않는다.
     면적 = 자신 + 하위 항목 수. 안내 문서 → 파일 → 작은 폴더 → 큰 폴더 순으로 안쪽부터 놓는다.
     큰 하위 폴더는 앞선 형제들이 차지한 원 바깥에 중심을 두어 자기 하위 항목을 펼칠 자리를 갖는다.
     분야마다 가장 큰 최상위 항목이 기준 방향에 앉고, 같은 분야의 나머지는 그 둘레에 놓인다. */
  function anchorsOf(ids) {
    const out = new Map(), used = [], spare = fibonacciSphere(64);
    for (const id of ids) {
      if (out.has(id)) continue;
      const dir = used.length < ANCHOR_DIRS.length ? norm(ANCHOR_DIRS[used.length])
        : spare.reduce((best, c) => { const near = Math.max(...used.map(u => dot(u, c))); return near < best.near ? { c, near } : best; }, { c: spare[0], near: Infinity }).c;
      out.set(id, dir); used.push(dir);
    }
    return out;
  }

  function layout(graph) {
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const kids = new Map();
    for (const n of graph.nodes) {
      if (!n.parentId || !byId.has(n.parentId)) continue;
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId).push(n);
    }
    const area = new Map();
    const areaOf = id => {
      if (area.has(id)) return area.get(id);
      let a = 1;
      for (const c of kids.get(id) || []) a += areaOf(c.id);
      area.set(id, a);
      return a;
    };
    const root = graph.nodes.find(n => n.parentId === null);
    const core = new Set([graph.centerId, root && root.id].filter(Boolean));
    const step = clamp(Math.sqrt(2.4 / graph.nodes.length), 0.03, 0.17); // 항목이 많아도(약 2,600개까지) 구 표면 안에 들어가는 간격
    const rank = n => (n.role !== 'item' ? 0 : n.kind === 'file' ? 1 : 2);
    const order = (a, b) => rank(a) - rank(b) || areaOf(a.id) - areaOf(b.id) || a.name.localeCompare(b.name, 'ko');
    const childrenOf = n => (kids.get(n.id) || []).filter(c => !core.has(c.id)).sort(order);
    const dirs = new Map();

    function spread(list, center, phase, used0) {
      let used = used0;
      list.forEach((n, k) => {
        const a = areaOf(n.id);
        const inner = step * Math.sqrt(used);           // 앞선 형제들이 차지한 원
        used += a;
        let r = step * Math.sqrt(used - a / 2 + 0.6);
        if (a > 8) r = Math.min(Math.max(r, inner + step * Math.sqrt(a) * 0.7), 1.5);
        const dir = around(center, r, phase + k * GOLDEN);
        dirs.set(n.id, dir);
        spread(childrenOf(n), dir, hash(n.id) * TAU, 0);
      });
    }

    const top = graph.nodes.filter(n => !core.has(n.id) && (n.parentId === null || core.has(n.parentId) || !byId.has(n.parentId)));
    const byGroup = new Map();
    for (const n of top) {
      if (!byGroup.has(n.group)) byGroup.set(n.group, []);
      byGroup.get(n.group).push(n);
    }
    const anchors = anchorsOf([...(graph.groups || []).map(g => g.id), ...byGroup.keys()]);
    for (const [group, list] of byGroup) {
      const anchor = anchors.get(group);
      list.sort((a, b) => areaOf(b.id) - areaOf(a.id) || a.name.localeCompare(b.name, 'ko'));
      const [first, ...rest] = list;
      dirs.set(first.id, anchor);
      spread(childrenOf(first), anchor, hash(first.id) * TAU, 0);
      spread(rest.sort(order), anchor, hash(group) * TAU, areaOf(first.id));
    }
    for (const id of core) dirs.set(id, null);
    return { dirs, core, areaOf, step, anchors };
  }

  /* ── 3차원 배치(네트워크 구체) ──
     구 표면 배치(layout)의 방향과 트리 깊이로 출발점을 잡고, 힘 배치로 문서 · 폴더를 공 모양 공간 안에 퍼뜨린다.
     가까운 것끼리 밀어내는 힘(격자로 이웃만 센다)과 가운데로 당기는 힘(거리에 비례)이 맞서 전체가 대략 공 모양으로 모이고,
     연결(폴더 관계 · 문서 링크)의 용수철이 같은 폴더 · 서로 링크한 문서를 가까이 묶는다. 번호 -1은 원점에 고정된 가운데 핵이다.
     난수를 쓰지 않아 같은 데이터면 늘 같은 모양이다(메인 화면 구체와 열린 화면이 같은 자리를 쓴다). 끝으로 98%가 반지름 1 안에 들게 맞춘다.
     points: [{ dir, depth }], links: [{ a, b, kind }] → [[x, y, z], …] */
  function volumeLayout(points, links, iterations = 180) {
    const N = points.length;
    if (!N) return [];
    const P = new Float64Array(N * 3), V = new Float64Array(N * 3), F = new Float64Array(N * 3);
    const s = Math.cbrt(4.19 / N), cut = 1.6 * s, cut2 = cut * cut, vmax = 0.5 * s; // s = 단위 공을 N개로 나눈 간격
    // 가운데로 당기는 세기: 반지름 1 안에서 간격 s쯤으로 맞서게 s²에 비례(고정값이면 항목이 많을수록 공이 눌려 이웃 셈이 N²로 커진다)
    const pull = 0.3 * s * s;
    const maxDepth = points.reduce((m, p) => Math.max(m, p.depth), 1);
    points.forEach((p, i) => {
      const r = 0.25 + 0.7 * Math.pow(p.depth / maxDepth, 0.8);
      P[i * 3] = p.dir[0] * r; P[i * 3 + 1] = p.dir[1] * r; P[i * 3 + 2] = p.dir[2] * r;
    });
    const deg = new Float64Array(N);
    for (const l of links) { if (l.a >= 0) deg[l.a]++; if (l.b >= 0) deg[l.b]++; }
    // 문서 링크는 길고 약한 용수철(멀리 있는 문서끼리 뭉개지지 않게). 연결이 많은 쪽일수록 약하게(허브 쏠림 방지).
    // 가운데 핵과 잇는 선은 반지름의 2/3쯤(0.65)이 제 길이 — 짧으면 최상위 폴더 · 안내 문서 · 스킬이 핵에 몰려 이름표가 겹친다
    const springs = links.map(l => ({ a: l.a, b: l.b, rest: l.a < 0 || l.b < 0 ? 0.65 : (l.kind === 'markdown' ? 1.5 : 0.9) * s,
      k: (l.kind === 'markdown' ? 0.06 : 0.25) / Math.max(1, Math.min(l.a >= 0 ? deg[l.a] : 1, l.b >= 0 ? deg[l.b] : 1)) }));
    const cellOf = new Int32Array(N), idx = new Int32Array(N);
    let start = new Int32Array(1);
    for (let it = 0; it < iterations; it++) {
      const heat = 1 - it / iterations;
      for (let i = 0; i < N * 3; i++) F[i] = -pull * P[i];
      // 밀어내기: 한 변이 g(≥ cut)인 칸에 나눠 담고 이웃 27칸만 본다. 칸 수는 축마다 100개 이하로 막는다
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const g = Math.max(cut, (x1 - x0) / 100, (y1 - y0) / 100, (z1 - z0) / 100);
      const nx = Math.floor((x1 - x0) / g) + 1, ny = Math.floor((y1 - y0) / g) + 1, nz = Math.floor((z1 - z0) / g) + 1, cells = nx * ny * nz;
      if (start.length < cells + 1) start = new Int32Array(cells + 1); else start.fill(0, 0, cells + 1);
      for (let i = 0; i < N; i++) {
        const c = (Math.floor((P[i * 3] - x0) / g) * ny + Math.floor((P[i * 3 + 1] - y0) / g)) * nz + Math.floor((P[i * 3 + 2] - z0) / g);
        cellOf[i] = c; start[c + 1]++;
      }
      for (let c = 0; c < cells; c++) start[c + 1] += start[c];
      const fill = start.slice(0, cells);
      for (let i = 0; i < N; i++) idx[fill[cellOf[i]]++] = i;
      for (let i = 0; i < N; i++) {
        const xi = P[i * 3], yi = P[i * 3 + 1], zi = P[i * 3 + 2];
        const cx = Math.floor((xi - x0) / g), cy = Math.floor((yi - y0) / g), cz = Math.floor((zi - z0) / g);
        for (let ax = Math.max(0, cx - 1); ax <= Math.min(nx - 1, cx + 1); ax++) {
          for (let ay = Math.max(0, cy - 1); ay <= Math.min(ny - 1, cy + 1); ay++) {
            for (let az = Math.max(0, cz - 1); az <= Math.min(nz - 1, cz + 1); az++) {
              const c = (ax * ny + ay) * nz + az;
              for (let k = start[c], end = start[c + 1]; k < end; k++) {
                const j = idx[k];
                if (j <= i) continue;
                const dx = xi - P[j * 3], dy = yi - P[j * 3 + 1], dz = zi - P[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= cut2) continue;
                const d = Math.sqrt(d2) || 1e-6, f = (0.5 * (cut - d)) / d;
                F[i * 3] += dx * f; F[i * 3 + 1] += dy * f; F[i * 3 + 2] += dz * f;
                F[j * 3] -= dx * f; F[j * 3 + 1] -= dy * f; F[j * 3 + 2] -= dz * f;
              }
            }
          }
        }
      }
      for (const sp of springs) {
        const a = sp.a * 3, b = sp.b * 3;
        const dx = (sp.b < 0 ? 0 : P[b]) - (sp.a < 0 ? 0 : P[a]), dy = (sp.b < 0 ? 0 : P[b + 1]) - (sp.a < 0 ? 0 : P[a + 1]), dz = (sp.b < 0 ? 0 : P[b + 2]) - (sp.a < 0 ? 0 : P[a + 2]);
        const d = Math.hypot(dx, dy, dz) || 1e-6, f = (sp.k * (d - sp.rest)) / d;
        if (sp.a >= 0) { F[a] += dx * f; F[a + 1] += dy * f; F[a + 2] += dz * f; }
        if (sp.b >= 0) { F[b] -= dx * f; F[b + 1] -= dy * f; F[b + 2] -= dz * f; }
      }
      // 속도: 감쇠하고 한 번에 움직이는 거리를 막는다(식을수록 더 작게)
      const lim = vmax * (0.2 + 0.8 * heat);
      for (let i = 0; i < N * 3; i += 3) {
        let vx = (V[i] + F[i]) * 0.6, vy = (V[i + 1] + F[i + 1]) * 0.6, vz = (V[i + 2] + F[i + 2]) * 0.6;
        const m = Math.hypot(vx, vy, vz);
        if (m > lim) { const k = lim / m; vx *= k; vy *= k; vz *= k; }
        V[i] = vx; V[i + 1] = vy; V[i + 2] = vz;
        P[i] += vx; P[i + 1] += vy; P[i + 2] += vz;
      }
    }
    const radii = points.map((_, i) => Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const q = Float64Array.from(radii).sort()[Math.min(N - 1, Math.floor(N * 0.98))] || 1;
    return radii.map((r, i) => { const k = (r / q > 1.08 ? 1.08 / (r / q) : 1) / q; return [P[i * 3] * k, P[i * 3 + 1] * k, P[i * 3 + 2] * k]; });
  }

  /* ── 신경망 배치(신경망 시안) ──
     volumeLayout은 '겹치지 않게만' 미는 짧은 힘과 가운데로 당기는 힘으로 부피를 채워, 전체가 공 하나로 뭉친다.
     여기서는 모든 점이 멀리서도 서로 미는 힘(전하 반발, 세기 ∝ 1/거리 — d3-force와 같은 감쇠)을 쓴다. 가지(하위 트리)끼리 서로 밀어
     사이가 비고, 폴더 둘레 파일은 송이로 모인다. Obsidian · 3d-force-graph의 트리가 신경 가지처럼 보이는 까닭과 같다.
     - 먼 점: Barnes–Hut 팔진 트리로 센다(멀리 있는 묶음은 무게중심 하나로 — 묶음 크기 / 거리 < theta). 가까운 점은 하나하나 정확히
     - 용수철: 폴더 → 파일은 짧고 강하게(송이), 폴더 → 하위 폴더는 하위 파일 수에 따라 길게(가지), 가운데 핵 → 최상위는 줄기,
       문서 링크는 길고 아주 약하게(분야 사이를 잇는 긴 연결 — 가지를 끌어 뭉개지 않게). 세기는 양끝 중 연결이 적은 쪽 수로 나눈다
     - 출발: 구 표면 배치(layout)의 방향을 분야 기준 방향 쪽으로 squeeze만큼 좁히고 깊이만큼 바깥에 둔다. 아주 약하게 그 방향으로 돌아가고(hold)
       아주 약하게 가운데로 당긴다(gravity — 분야 덩어리가 끝없이 멀어지지 않게)
     - 크기: keep(97%)가 반지름 1 안에 들게 줄이고, 그 바깥으로 뻗은 가지는 1 + soft까지 부드럽게만 누른다(자르지 않는다)
     난수를 쓰지 않아 같은 데이터면 늘 같은 모양이다. 번호 -1은 원점의 가운데 핵.
     points: [{ dir, depth, group, folder, weight(하위 파일 수) }], links: [{ a(상위 · 링크한 쪽), b, kind }],
     options: { anchors: Map(분야 → 기준 방향) } → [[x, y, z], …] */
  // 길이는 모두 간격 s(단위 공을 N개로 나눈 간격) 배수. leaf: 파일, branch: 하위 폴더 [기본, 배수, 지수] — 기본 + 배수 × 하위 파일 수^지수,
  // trunk: 핵 줄기, link: 문서 링크. charge: 반발 세기(거리 s에서 s × charge), near: 반발을 셀 때 가장 가까운 거리, theta: 묶어 세는 기준
  // 2026-10-16 실제 사본(1,313개)에서 고른 값: 줄기 3 → 7 · 반발 0.06 → 0.12로 가운데 핵 둘레 쏠림을 줄였다. 1440px Chrome에서 배치 약 0.2초 더 걸린다(구체 배치 대비)
  const NEURAL = { leaf: 1, branch: [1.4, 0.5, 0.5], trunk: 7, link: 4, k: { leaf: 0.4, branch: 0.3, trunk: 0.15, link: 0.01 },
    charge: 0.12, near: 0.6, theta: 0.9, gravity: 0.004, squeeze: 0.45, hold: 0.004, shell: [2, 3.2], iterations: 300, keep: 0.97, soft: 0.25 };
  function neuralLayout(points, links, { anchors = new Map(), squeeze = NEURAL.squeeze, iterations = NEURAL.iterations } = {}) {
    const N = points.length;
    if (!N) return [];
    const P = new Float64Array(N * 3), V = new Float64Array(N * 3), F = new Float64Array(N * 3), D = new Float64Array(N * 3);
    const s = Math.cbrt(4.19 / N), vmax = 0.6 * s, q = NEURAL.charge * s * s, near2 = (NEURAL.near * s) ** 2;
    points.forEach((p, i) => {
      const anchor = anchors.get(p.group);
      const d = anchor ? slerp(anchor, p.dir, squeeze) : p.dir;
      // 깊이만큼 바깥에서 출발. 같은 깊이끼리 한 껍질에 서지 않게 이름으로 ±8% 엇갈린다
      const r = s * (NEURAL.shell[0] + NEURAL.shell[1] * p.depth) * (0.92 + 0.16 * hash(`${i}:${p.depth}`));
      D[i * 3] = d[0]; D[i * 3 + 1] = d[1]; D[i * 3 + 2] = d[2];
      P[i * 3] = d[0] * r; P[i * 3 + 1] = d[1] * r; P[i * 3 + 2] = d[2] * r;
    });
    const deg = new Float64Array(N);
    for (const l of links) { if (l.a >= 0) deg[l.a]++; if (l.b >= 0) deg[l.b]++; }
    const springs = links.map(l => {
      const lo = Math.max(1, Math.min(l.a >= 0 ? deg[l.a] : 1, l.b >= 0 ? deg[l.b] : 1));
      if (l.a < 0 || l.b < 0) return { a: l.a, b: l.b, rest: NEURAL.trunk * s, k: NEURAL.k.trunk };
      if (l.kind === 'markdown') return { a: l.a, b: l.b, rest: NEURAL.link * s, k: NEURAL.k.link / lo };
      const child = points[l.b];
      return child.folder
        ? { a: l.a, b: l.b, rest: (NEURAL.branch[0] + NEURAL.branch[1] * Math.pow(child.weight || 0, NEURAL.branch[2])) * s, k: NEURAL.k.branch / lo }
        : { a: l.a, b: l.b, rest: NEURAL.leaf * s, k: NEURAL.k.leaf };
    });
    /* Barnes–Hut 팔진 트리: 반복마다 점 자리로 새로 만든다. 마디마다 점 수 · 무게중심 · 한 변 길이, 잎은 점 범위(order[lo, hi)).
       점이 BH_LEAF개 이하이거나 깊이 BH_DEPTH에 닿으면 잎(같은 자리에 겹친 점이 있어도 끝없이 나누지 않는다) */
    const BH_LEAF = 6, BH_DEPTH = 18, theta2 = NEURAL.theta * NEURAL.theta;
    const order = new Int32Array(N), tmp = new Int32Array(N), oct = new Uint8Array(N), stack = new Int32Array(8 * (BH_DEPTH + 2));
    let tCnt = [], tMx = [], tMy = [], tMz = [], tSize = [], tLo = [], tHi = [], tKid = [], tKids = [];
    function build(lo, hi, cx, cy, cz, half, depth) {
      const id = tCnt.length;
      let sx = 0, sy = 0, sz = 0;
      for (let k = lo; k < hi; k++) { const i = order[k] * 3; sx += P[i]; sy += P[i + 1]; sz += P[i + 2]; }
      const n = hi - lo;
      tCnt.push(n); tMx.push(sx / n); tMy.push(sy / n); tMz.push(sz / n); tSize.push(half * 2); tLo.push(lo); tHi.push(hi); tKid.push(-1);
      if (n <= BH_LEAF || depth >= BH_DEPTH) return id;
      const counts = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let k = lo; k < hi; k++) {
        const i = order[k] * 3, o = (P[i] > cx ? 1 : 0) | (P[i + 1] > cy ? 2 : 0) | (P[i + 2] > cz ? 4 : 0);
        oct[k] = o; counts[o]++;
      }
      const at = [lo];
      for (let o = 0; o < 7; o++) at.push(at[o] + counts[o]);
      const put = at.slice();
      for (let k = lo; k < hi; k++) tmp[put[oct[k]]++] = order[k];
      for (let k = lo; k < hi; k++) order[k] = tmp[k];
      const kids = [], h2 = half / 2;
      for (let o = 0; o < 8; o++) {
        if (!counts[o]) continue;
        kids.push(build(at[o], at[o] + counts[o], cx + (o & 1 ? h2 : -h2), cy + (o & 2 ? h2 : -h2), cz + (o & 4 ? h2 : -h2), h2, depth + 1));
      }
      tKid[id] = tKids.length;
      tKids.push(kids.length, ...kids);
      return id;
    }
    for (let it = 0; it < iterations; it++) {
      const heat = 1 - it / iterations;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < N; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
        // 자기 방향으로 · 가운데로(둘 다 아주 약하게)
        const r = Math.hypot(x, y, z);
        F[i * 3] = NEURAL.hold * (D[i * 3] * r - x) - NEURAL.gravity * x;
        F[i * 3 + 1] = NEURAL.hold * (D[i * 3 + 1] * r - y) - NEURAL.gravity * y;
        F[i * 3 + 2] = NEURAL.hold * (D[i * 3 + 2] * r - z) - NEURAL.gravity * z;
        order[i] = i;
      }
      tCnt = []; tMx = []; tMy = []; tMz = []; tSize = []; tLo = []; tHi = []; tKid = []; tKids = [];
      build(0, N, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-6) / 2 + 1e-9, 0);
      for (let i = 0; i < N; i++) {
        const xi = P[i * 3], yi = P[i * 3 + 1], zi = P[i * 3 + 2];
        let fx = 0, fy = 0, fz = 0, sp = 0;
        stack[sp++] = 0;
        while (sp) {
          const nd = stack[--sp];
          const dx = xi - tMx[nd], dy = yi - tMy[nd], dz = zi - tMz[nd], d2 = dx * dx + dy * dy + dz * dz;
          if (tKid[nd] < 0) {
            // 잎: 점마다 정확히
            for (let k = tLo[nd], end = tHi[nd]; k < end; k++) {
              const j = order[k];
              if (j === i) continue;
              const ex = xi - P[j * 3], ey = yi - P[j * 3 + 1], ez = zi - P[j * 3 + 2];
              const f = q / Math.max(near2, ex * ex + ey * ey + ez * ez);
              fx += ex * f; fy += ey * f; fz += ez * f;
            }
          } else if (tSize[nd] * tSize[nd] < theta2 * d2) {
            // 멀리 있는 묶음: 무게중심 하나에 점 수만큼
            const f = (q * tCnt[nd]) / Math.max(near2, d2);
            fx += dx * f; fy += dy * f; fz += dz * f;
          } else {
            for (let c = tKid[nd] + 1, end = tKid[nd] + 1 + tKids[tKid[nd]]; c < end; c++) stack[sp++] = tKids[c];
          }
        }
        F[i * 3] += fx; F[i * 3 + 1] += fy; F[i * 3 + 2] += fz;
      }
      for (const sp of springs) {
        const a = sp.a * 3, b = sp.b * 3;
        const dx = (sp.b < 0 ? 0 : P[b]) - (sp.a < 0 ? 0 : P[a]), dy = (sp.b < 0 ? 0 : P[b + 1]) - (sp.a < 0 ? 0 : P[a + 1]), dz = (sp.b < 0 ? 0 : P[b + 2]) - (sp.a < 0 ? 0 : P[a + 2]);
        const d = Math.hypot(dx, dy, dz) || 1e-6, f = (sp.k * (d - sp.rest)) / d;
        if (sp.a >= 0) { F[a] += dx * f; F[a + 1] += dy * f; F[a + 2] += dz * f; }
        if (sp.b >= 0) { F[b] -= dx * f; F[b + 1] -= dy * f; F[b + 2] -= dz * f; }
      }
      const lim = vmax * (0.15 + 0.85 * heat);
      for (let i = 0; i < N * 3; i += 3) {
        let vx = (V[i] + F[i]) * 0.6, vy = (V[i + 1] + F[i + 1]) * 0.6, vz = (V[i + 2] + F[i + 2]) * 0.6;
        const m = Math.hypot(vx, vy, vz);
        if (m > lim) { const k = lim / m; vx *= k; vy *= k; vz *= k; }
        V[i] = vx; V[i + 1] = vy; V[i + 2] = vz;
        P[i] += vx; P[i + 1] += vy; P[i + 2] += vz;
      }
    }
    const radii = points.map((_, i) => Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const q97 = Float64Array.from(radii).sort()[Math.min(N - 1, Math.floor(N * NEURAL.keep))] || 1;
    return radii.map((r, i) => {
      const u = r / q97, w = u > 1 ? 1 + NEURAL.soft * Math.tanh((u - 1) / NEURAL.soft) : u, k = r > 0 ? w / r : 0;
      return [P[i * 3] * k, P[i * 3 + 1] * k, P[i * 3 + 2] * k];
    });
  }

  /* ── 색 ── */
  const rgbCache = new Map();
  function rgba(hex, alpha) {
    let rgb = rgbCache.get(hex);
    if (!rgb) {
      const v = hex.replace('#', '');
      rgb = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
      rgbCache.set(hex, rgb);
    }
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha, 0, 1).toFixed(3)})`;
  }
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    return { paper: v('--paper'), ink: v('--ink'), charcoal: v('--charcoal'), stone: v('--stone'), ash: v('--ash'), accent: v('--accent') };
  }

  function fibonacciSphere(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), a = i * GOLDEN;
      out.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
  }

  /* ── 지형: 높이 = 그 자리에 쌓인 문서 양 ──
     파일마다 자기 자리에 종 모양 봉우리(가우스)를 하나씩 쌓아 더한다(구면 커널 밀도). 접힌 폴더 안의 파일도 넣으므로
     접혀 있어도 그 아래 문서 양이 산 높이로 보인다. 봉우리는 두 벌이다 — 좁은 것(배치 간격 0.8배)으로 땅 · 바다와 분야 색을 정해
     문서가 모인 곳만 섬 · 대륙이 되고, 넓은 것(1.8배)으로 높이를 정해 큰 분야일수록 넓고 높은 산이 된다. 높이는 가장 높은 곳을 1로 맞춘
     밀도를 0.7제곱으로 눌러 큰 분야 하나가 나머지를 평평하게 만들지 않게 한다. 그 위에 땅에만 바위 질감(잔주름)을 얹는다.
     CosmoGraph 지형은 고정 시드의 장식이지만 여기서는 산의 큰 모양(어디가 얼마나 높은지)이 정보이고, 잔주름만 장식이다.
     경위도 격자(180×90)에 미리 구해 두고 겹선형으로 읽는다. 등고선은 같은 격자에서 마칭 스퀘어로 한 번만 뽑는다. */
  // 바위 질감용 값 노이즈: 정수 격자 꼭짓점마다 해시 난수를 두고 부드럽게 잇는다(두 옥타브)
  function lattice(x, y, z) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x61c88647);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296 * 2 - 1;
  }
  function valueNoise(x, y, z) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const sm = t => t * t * (3 - 2 * t), u = sm(x - x0), v = sm(y - y0), w = sm(z - z0);
    const c = (i, j, k) => lattice(x0 + i, y0 + j, z0 + k);
    return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
  }
  const roughness = (x, y, z) => (valueNoise(x * 5 + 17.3, y * 5 - 4.1, z * 5 + 9.7) * 2 + valueNoise(x * 11 - 3.7, y * 11 + 8.2, z * 11 - 1.9)) / 3;

  const SQUARE_CASES = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
    [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], []];
  const hexRgb = hex => { const v = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };
  /* palette: { sea: '#hex', groups: { 분야: '#hex' } }. 땅은 그 자리에서 가장 많이 쌓인 분야의 색(경계만 부드럽게 섞음)을
     높을수록 진하게 칠하고, 바다는 --g-sea(밝은 모드는 옅은 살구빛, 다크는 검은 바탕보다 한 단계 밝은 갈색)로 둔다.
     화면에서는 이 색을 경사면 조명과 함께 픽셀마다 읽는다(createGlobe의 paintPlanet). 진하기는 바탕별로 다르다(LOOKS) */
  function buildTerrain(points, step, palette) {
    const { lon, lat } = TERRAIN, look = lookNow();
    const grid = new Float32Array(lon * lat), land = new Float32Array(lon * lat), cells = new Float32Array(lon * lat * 3);
    const groupIds = [...new Set(points.map(p => p.group || 'other'))];
    const byGroup = new Map(groupIds.map(g => [g, new Float32Array(lon * lat)]));
    for (let j = 0; j < lat; j++) {
      const th = ((j + 0.5) / lat) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      for (let i = 0; i < lon; i++) {
        const ph = (i / lon) * TAU, k = (j * lon + i) * 3;
        cells[k] = st * Math.cos(ph); cells[k + 1] = ct; cells[k + 2] = st * Math.sin(ph);
      }
    }
    // 파일 하나를 폭 sigma의 봉우리로 격자에 더한다. 3σ 밖은 건너뛰고(현의 길이² = 2 − 2cos ≈ 각²), 위도 띠만 훑는다
    function splat(p, sigma, total, own) {
      const px = p.dir[0], py = p.dir[1], pz = p.dir[2], w = p.w || 1;
      const cut = 1 - (3 * sigma) ** 2 / 2, inv = 1 / (2 * sigma * sigma), th = Math.acos(clamp(py, -1, 1));
      const j0 = Math.max(0, Math.floor(((th - 3 * sigma) / Math.PI) * lat - 1)), j1 = Math.min(lat - 1, Math.ceil(((th + 3 * sigma) / Math.PI) * lat + 1));
      for (let j = j0; j <= j1; j++) {
        for (let c = j * lon, end = c + lon, k = c * 3; c < end; c++, k += 3) {
          const d = cells[k] * px + cells[k + 1] * py + cells[k + 2] * pz;
          if (d <= cut) continue;
          const v = w * Math.exp(-(2 - 2 * d) * inv);
          total[c] += v;
          if (own) own[c] += v;
        }
      }
    }
    for (const p of points) {
      splat(p, step * TERRAIN.wide, grid, null);                                   // 높이: 넓은 봉우리
      splat(p, step * TERRAIN.narrow, land, byGroup.get(p.group || 'other'));      // 땅 · 분야 색: 좁은 봉우리
    }
    let max = 0;
    for (const v of grid) if (v > max) max = v;
    if (max > 0) {
      for (let c = 0, k = 0; c < grid.length; c++, k += 3) {
        // 땅다움(0~1): 좁은 봉우리 밀도가 기준(land) 둘레에서 부드럽게 0 → 1. 해안에서 높이가 끊기지 않게 높이에 곱한다
        const shore = smoothstep(TERRAIN.land * 0.7, TERRAIN.land * 1.3, land[c]);
        if (shore <= 0) { grid[c] = 0; continue; }
        // 높이 = 넓은 봉우리 밀도를 가장 높은 곳 대비로(0.7제곱으로 눌러 작은 분야도 보이게). 해안 바로 안쪽도 조금은 솟게(shore)
        const e = Math.max(TERRAIN.shore, Math.pow(grid[c] / max, TERRAIN.gamma));
        grid[c] = shore * Math.max(TERRAIN.shore * 0.6, e * (1 + TERRAIN.rough * roughness(cells[k], cells[k + 1], cells[k + 2])));
      }
    }
    const value = (i, j) => grid[j * lon + (((i % lon) + lon) % lon)];
    // 격자 좌표(fi = 경도 칸, fj = 위도 칸) → 단위 방향
    const toDir = (fi, fj) => { const th = ((fj + 0.5) / lat) * Math.PI, ph = (fi / lon) * TAU, st = Math.sin(th); return [st * Math.cos(ph), Math.cos(th), st * Math.sin(ph)]; };
    function at(d) {
      const th = Math.acos(clamp(d[1], -1, 1));
      let ph = Math.atan2(d[2], d[0]);
      if (ph < 0) ph += TAU;
      const fj = clamp((th / Math.PI) * lat - 0.5, 0, lat - 1), fi = (ph / TAU) * lon;
      const j0 = Math.floor(fj), j1 = Math.min(lat - 1, j0 + 1), tj = fj - j0;
      const i0 = Math.floor(fi), ti = fi - i0;
      return lerp(lerp(value(i0, j0), value(i0 + 1, j0), ti), lerp(value(i0, j1), value(i0 + 1, j1), ti), tj);
    }
    // 색 · 경사 격자. 분야 색은 밀도의 4제곱으로 가중해 섞어(가장 많은 분야가 거의 그대로) 경계에서만 부드럽게 바뀐다
    const sea = hexRgb(palette && palette.sea || '#fcf7f3');
    const groupRgb = new Map(groupIds.map(g => [g, hexRgb((palette && palette.groups && palette.groups[g]) || '#79716b')]));
    const color = new Float32Array(lon * lat * 3), grad = new Float32Array(lon * lat * 3);
    const eps = 0.02;
    for (let c = 0, k = 0; c < grid.length; c++, k += 3) {
      let r = sea[0], g = sea[1], b = sea[2], wr = 0, wg = 0, wb = 0, ws = 0;
      for (const [id, arr] of byGroup) {
        const w = arr[c] ** 4; // 좁은 봉우리 기준 분야별 밀도
        if (!w) continue;
        const rgb = groupRgb.get(id);
        wr += rgb[0] * w; wg += rgb[1] * w; wb += rgb[2] * w; ws += w;
      }
      if (ws > 0) {
        const shore = smoothstep(TERRAIN.land * 0.7, TERRAIN.land * 1.3, land[c]) || 1;
        const hgt = grid[c] / shore, t = clamp(look.tint[0] + look.tint[1] * hgt, 0, look.tint[2]); // 땅다움을 나눠 낸 땅 높이로 진하기
        r = lerp(sea[0], wr / ws, t); g = lerp(sea[1], wg / ws, t); b = lerp(sea[2], wb / ws, t);
        // 검은 바탕: 높은 봉우리에 흰빛을 섞어 빛나 보이게 한다(색상은 그대로라 분야는 읽힌다)
        if (look.peak) { const k = look.peak * smoothstep(0.4, 1, hgt); r = lerp(r, 255, k); g = lerp(g, 255, k); b = lerp(b, 255, k); }
      }
      color[k] = r; color[k + 1] = g; color[k + 2] = b;
    }
    if (max > 0) {
      for (let c = 0, k = 0; c < grid.length; c++, k += 3) {
        const d = [cells[k], cells[k + 1], cells[k + 2]], e0 = grid[c];
        const t1 = perpendicular(d), t2 = cross(d, t1);
        const s1 = ((at(around(d, eps, 0)) - e0) / eps) * TERRAIN.height * TERRAIN.relief;
        const s2 = ((at(around(d, eps, Math.PI / 2)) - e0) / eps) * TERRAIN.height * TERRAIN.relief;
        grad[k] = s1 * t1[0] + s2 * t2[0]; grad[k + 1] = s1 * t1[1] + s2 * t2[1]; grad[k + 2] = s1 * t1[2] + s2 * t2[2];
      }
    }
    const contours = max > 0 ? TERRAIN.levels.map(level => {
      const segs = [];
      for (let j = 0; j < lat - 1; j++) {
        for (let i = 0; i < lon; i++) {
          const a = value(i, j), b = value(i + 1, j), c = value(i + 1, j + 1), d = value(i, j + 1);
          const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
          if (code === 0 || code === 15) continue;
          const t = (p, q) => (level - p) / (q - p);
          const edge = e => (e === 0 ? [i + t(a, b), j] : e === 1 ? [i + 1, j + t(b, c)] : e === 2 ? [i + 1 - t(c, d), j + 1] : [i, j + 1 - t(d, a)]);
          for (const [e1, e2] of SQUARE_CASES[code]) segs.push(...toDir(...edge(e1)), ...toDir(...edge(e2)));
        }
      }
      return { level, segs: new Float32Array(segs) };
    }) : [];
    return { at, contours, empty: max === 0, lon, lat, elev: grid, color, grad, field: land, sea };
  }

  /* 신경망 시안: 네트워크 선은 곧은 선 대신 한쪽으로 살짝 휜 2차 곡선이다(신경 가지처럼).
     휘는 쪽 · 양(bendOf)은 선의 양끝 id로 정해 돌려도, 별자리 선과 그 위에 다시 그리는 항목 선이 같은 곡선이다.
     k = 조절점을 선 길이의 몇 배만큼 옆으로 미는지(부호 = 쪽). g(0~1)만큼만 그리면 그 앞부분 곡선이다(드 카스텔조 분할) */
  const BEND = 0.24;
  const REST_EDGE = 0.4; // 메인 화면 구체의 주황 가지 선 진하기(가까운 쪽 기준)
  const bendOf = key => { const h = hash(key); return BEND * (h < 0.5 ? -1 : 1) * (0.35 + 1.3 * Math.abs(h - 0.5)); };
  function curveCtrl(s0, s1, k) { return { x: (s0.x + s1.x) / 2 - (s1.y - s0.y) * k, y: (s0.y + s1.y) / 2 + (s1.x - s0.x) * k }; }
  function curveAt(s0, s1, k, t) {
    const c = curveCtrl(s0, s1, k), u = 1 - t;
    return { x: u * u * s0.x + 2 * u * t * c.x + t * t * s1.x, y: u * u * s0.y + 2 * u * t * c.y + t * t * s1.y };
  }
  function curveTo(path, s0, s1, k, g = 1) {
    const c = curveCtrl(s0, s1, k);
    path.moveTo(s0.x, s0.y);
    if (g >= 1) { path.quadraticCurveTo(c.x, c.y, s1.x, s1.y); return; }
    const end = curveAt(s0, s1, k, g);
    path.quadraticCurveTo(lerp(s0.x, c.x, g), lerp(s0.y, c.y, g), end.x, end.y);
  }

  function markPath(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'diamond') {
      const d = r * 1.3;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d, y); ctx.lineTo(x, y + d); ctx.lineTo(x - d, y); ctx.closePath();
    } else if (shape === 'square') {
      const s = r * 0.9;
      ctx.rect(x - s, y - s, s * 2, s * 2);
    } else if (shape === 'triangle') {
      const d = r * 1.32;
      ctx.moveTo(x, y - d); ctx.lineTo(x + d * 0.866, y + d * 0.5); ctx.lineTo(x - d * 0.866, y + d * 0.5); ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, TAU);
    }
  }

  /* ── 렌더러 ──
     scene.items: { id, dir, core, primary, color, shape, hollow, size, guide, folded, badge, live, label, depth, group, from, delay, orbit? }
       orbit: { index, slot, count } — 행성 표면이 아니라 궤도 위성(스킬 · 루틴). 자리는 매 프레임 궤도에서 정한다
     scene.edges: { a, b, kind: 'markdown' | 'folder', color, count, rerouted, summary, groups }
     scene.orbits: { id, label, count, radius, arcStart, arcEnd, labelAt, speed, phase, color, tilt?, bank? }
       기본은 화면에 놓인 원(tilt = π/2). 분야마다 원의 한 구간(arcStart~arcEnd rad)을 쓰고, 이름은 labelAt 각도에 둔다. speed rad/s
     options: { mode: 'button'(캔버스는 입력을 받지 않고 위에 덮인 버튼이 받는다 — 메인 화면 행성), spin(자동 회전 rad/s), radius(w, h)(궤도 없을 때 반지름),
       neural(기본 true — false면 곧은 선 · 메인 화면 점만, 이전 구체와 같다) } */
  function createGlobe(canvas, hooks = {}, options = {}) {
    const ctx = canvas.getContext('2d');
    const spinRate = options.spin || SPIN;
    const neural = options.neural !== false, bendScale = neural ? 1 : 0; // 신경망 시안: 휜 선 · 메인 화면 가지 선(끄면 곧은 선 — 이전 구체와 같다)
    let spinScale = 1, spinScaleTarget = 1, vSpin = 0; // 올렸을 때 배율(서서히 바뀜) · 휠로 더한 회전 속도(서서히 줄어든다)
    let colors = readColors(), look = lookNow();
    let surface = [];
    let width = 0, height = 0, dpr = 1;
    const home = look.volume ? HOME_VOLUME : HOME;
    // 화면 기울기(네트워크 구체만): 돌린 뒤 화면 평면에서 roll만큼 돌린다(토성 고리가 비스듬히 보이게)
    const roll = look.volume ? ROLL_VOLUME : 0, rollC = Math.cos(roll), rollS = Math.sin(roll);
    let yaw = home.yaw, pitch = home.pitch, zoom = 1;
    let vYaw = 0, vPitch = 0, tween = null;
    let auto = !reducedMotion.matches, lastInput = 0;
    let items = [], byId = new Map(), edges = [];
    const born = new Map();
    let show = { markdown: true, folder: true };
    let hl = { selected: null, focus: null, group: null };
    let hover = null, hits = [], ghostHits = [], dirty = true; // ghostHits: 별자리 점(아직 항목으로 펼치지 않은 노드)도 누르고 올릴 수 있게
    let insets = { left: 0, right: 0, top: 0, bottom: 0 };
    let cx = 0, cy = 0, cxTarget = 0, cyTarget = 0, centered = false;
    let anchor = null, rNow = 0;                      // anchor: 메인 화면 구체 자리와 열린 지구본 반지름(캔버스 좌표 { x, y, r }) · rNow: 지금 그리는 반지름(목표로 서서히)
    let pointer = null, running = false, raf = 0;
    let intro = null, outro = null;
    let prevFrame = 0, lastDraw = 0;
    let terrain = null, terrainOn = true, tsBase = 1; // tsBase: 지형 켜고 끌 때 0 ↔ 1로 서서히
    let orbits = [], orbitPhase = [];                 // 스킬 · 루틴 궤도(행성 둘레를 도는 위성)
    let ghost = null, gNodeDelay = null, gEdgeDelay = null, gBend = null; // 별자리(네트워크 구체 — setGhost)와 물들기 · 잇기 순서(가운데부터 바깥으로) · 선마다 휘는 양
    const bendCache = new WeakMap(); // 항목 선(scene.edges 객체)마다 휘는 양
    /* 물들기(네트워크 구체): m = 0이면 메인 화면 모습(주황 점 · 주황 고리 · 위성은 작은 주황 점 · 엣지 · 이름표 없음), 1이면 열린 모습.
       메인 화면 구체(mode button)는 늘 0. 크게 연 지구본은 메인 화면 구체에서 열 때 0 → 1(점이 분야 색으로 물들고 엣지가 상위에서 하위로 뻗어 이어진다),
       메인 화면 구체로 닫을 때 1 → 0(다시 주황으로, 엣지는 걷힌다). 그 밖에는 1 */
    let morph = null, morphNow = 1;
    const MORPH_MS = 1500, UNMORPH_MS = 420;
    function morphAt(now) {
      if (!morph) return 1;
      const t = clamp((now - morph.t0) / morph.ms, 0, 1);
      if (morph.dir > 0) { if (t >= 1) { morph = null; return 1; } return easeInOut(t); }
      return 1 - easeInOut(t);
    }
    // 두 색 사이(8단계로 끊어 같은 색끼리 한 번에 칠한다)
    const mixCache = new Map();
    function mixColor(a, b, k) {
      if (k <= 0) return a;
      if (k >= 1) return b;
      const q = Math.round(k * 8) / 8, key = `${a}|${b}|${q}`;
      let c = mixCache.get(key);
      if (!c) {
        const A = hexRgb(a), B = hexRgb(b);
        c = '#' + [0, 1, 2].map(i => Math.round(lerp(A[i], B[i], q)).toString(16).padStart(2, '0')).join('');
        mixCache.set(key, c);
      }
      return c;
    }
    let glowScale = 1;                                // 빛나는 이웃이 많을수록 줄인다(더해 칠한 빛이 겹쳐 하얗게 타지 않게 — draw)
    const planet = { canvas: document.createElement('canvas'), ctx: null, img: null, size: 0 };
    planet.ctx = planet.canvas.getContext('2d');

    // (x, y)를 가운데로 둘 때 들어가는 반지름(fitIn). 메인 화면 행성은 options.radius가 정한다.
    // 바깥 끝(구 반지름 배수) = 궤도와 구 · 별자리 끝(1.1 — 98%가 1 안, 최대 1.08) 중 큰 쪽. 기울어진 토성 고리는 세로로 납작해 별자리가 더 높다
    const orbitExtent = () => ({ x: Math.max(1.1, ...orbits.map(o => o.extentX)), y: Math.max(1.1, ...orbits.map(o => o.extentY)) });
    function fitRadius(x, y) {
      if (options.radius) return options.radius(width - insets.left - insets.right, height - insets.top - insets.bottom);
      return fitIn({ width, height, insets }, x, y, orbitExtent());
    }
    // 메인 화면 구체 자리에 둘 때는 그 반지름(anchor.r)을 넘지 않는다(메인 화면 구체 = 열린 지구본의 70%를 지킨다)
    const baseRadius = () => { const fit = fitRadius(cxTarget, cyTarget); return anchor && anchor.r ? Math.min(anchor.r, fit) : fit; };
    // 위성의 화면 좌표(구 반지름 단위). 궤도는 지구본 축과 상관없이 화면에 놓인 원이고(행성 테두리보다 바깥이라 가려지지 않는다),
    // 분야마다 원의 한 구간(arcStart~arcEnd)을 나눠 쓴다. 자리 = 구간 안 같은 간격 + 궤도가 돈 만큼.
    // space: 'model'(네트워크 구체의 토성 고리)은 그래프의 적도면에 있는 고리라 지구본과 함께 돌린다(시점을 바꾸면 같이 기운다)
    const orbitAngle = (o, index, t) => o.arcStart + (o.arcEnd - o.arcStart) * t + (orbitPhase[index] || 0);
    function orbitPoint(o, a) {
      const c = Math.cos(a) * o.radius, s = Math.sin(a) * o.radius;
      const p = [o.u[0] * c + o.v[0] * s, o.u[1] * c + o.v[1] * s, o.u[2] * c + o.v[2] * s];
      return o.space === 'model' ? rotate(p) : p;
    }
    function satellitePos(item) {
      const o = orbits[item.orbit.index];
      return orbitPoint(o, orbitAngle(o, item.orbit.index, (item.orbit.slot + 0.5) / item.orbit.count));
    }
    /* 가운데: 남은 자리의 한가운데. 메인 화면 구체 자리(anchor { x, y, r }, r = 열린 지구본 반지름)가 있으면 그 자리에 r 크기로 둔다.
       메인 화면 구체는 이 자리에서 들어가는 크기의 70%로 그려지므로(brain-globe.js openRadiusAt) 열 때는 제자리다.
       오른쪽 패널이 열려 좁아질 때, 모바일에서 화면을 내린 뒤 열 때, 좁은 창에서 왼쪽 분야 목록에 막힐 때처럼 그 자리에 r이 들어가지 않을 때만
       한가운데 쪽으로 들어가는 만큼 비킨다 */
    function centerTarget() {
      const mx = insets.left + (width - insets.left - insets.right) / 2, my = insets.top + (height - insets.top - insets.bottom) / 2;
      cxTarget = mx; cyTarget = my;
      if (anchor && width) {
        const fits = t => fitRadius(lerp(anchor.x, mx, t), lerp(anchor.y, my, t)) >= anchor.r * 0.995;
        let hi = 1;
        if (fits(0)) hi = 0;
        else if (fits(1)) { let lo = 0; for (let i = 0; i < 12; i++) { const t = (lo + hi) / 2; if (fits(t)) hi = t; else lo = t; } }
        cxTarget = lerp(anchor.x, mx, hi); cyTarget = lerp(anchor.y, my, hi);
      }
      if (!centered && width) { cx = cxTarget; cy = cyTarget; rNow = baseRadius(); centered = true; }
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      centerTarget();
      // 점 간격은 크게 연 지구본에서 24px 안팎(메인 화면 행성에서는 16px 안팎) — 항목이 올라갈 자리를 남긴다
      const count = dotCount();
      if (count !== surface.length) { surface = fibonacciSphere(count).map(d => ({ d, e: 0, g: [0, 0, 0] })); prepSurface(); }
      dirty = true;
    }
    /* 표면 점마다 고도(e)와 경사(g)를 미리 구한다. 빛은 경사면 기준으로 받아(법선 = 방향 − 경사) 산의 밝은 쪽 · 그늘이 생긴다 */
    function prepSurface() {
      const eps = 0.02;
      for (const p of surface) {
        if (!terrain || terrain.empty) { p.e = 0; p.g = [0, 0, 0]; continue; }
        const d = p.d, e0 = terrain.at(d), t1 = perpendicular(d), t2 = cross(d, t1);
        const s1 = ((terrain.at(around(d, eps, 0)) - e0) / eps) * TERRAIN.height * TERRAIN.relief;
        const s2 = ((terrain.at(around(d, eps, Math.PI / 2)) - e0) / eps) * TERRAIN.height * TERRAIN.relief;
        p.e = e0; p.g = [s1 * t1[0] + s2 * t2[0], s1 * t1[1] + s2 * t2[1], s1 * t1[2] + s2 * t2[2]];
      }
    }

    // 모델 → 화면: y축(yaw) 다음 x축(pitch) 회전, 네트워크 구체는 마지막에 화면 평면에서 roll
    function rotate(v, yw = yaw, pt = pitch) {
      const cy_ = Math.cos(yw), sy = Math.sin(yw), cp = Math.cos(pt), sp = Math.sin(pt);
      const x = v[0] * cy_ + v[2] * sy, z1 = -v[0] * sy + v[2] * cy_, y = v[1] * cp - z1 * sp, z = v[1] * sp + z1 * cp;
      if (roll) return [x * rollC - y * rollS, x * rollS + y * rollC, z];
      return [x, y, z];
    }
    // 카메라에서 점까지의 선분이 구에 먼저 닿으면 가려진 점
    function occluded(p) {
      const d = [p[0], p[1], p[2] - CAMERA];
      const a = dot(d, d), b = -CAMERA * d[2], c = CAMERA * CAMERA - 1;
      const disc = b * b - a * c;
      if (disc <= 0) return false;
      const s = (-b - Math.sqrt(disc)) / a;
      return s > 0 && s < 1 - 2e-3;
    }

    /* 등장 · 퇴장 중의 구 크기와 중심, 점 진하기(1 = 점 구체와 같은 진하기), 항목 투명도, 궤도 선 진하기(ring) */
    function stage(now) {
      const R1 = (rNow || baseRadius()) * zoom;
      let R = R1, x = cx, y = cy, tone = REST_TONE, fade = 1, nodes = 1, rise = 1, ring = null;
      if (intro) {
        const t = clamp((now - intro.t0) / INTRO_MS, 0, 1), e = easeOut(t);
        R = lerp(intro.from.r, R1, e); x = lerp(intro.from.cx, cx, e); y = lerp(intro.from.cy, cy, e);
        if (intro.from.solid) {
          // 메인 화면 행성에서: 산이 솟은 그 행성이 그대로 커지고, 궤도는 뒤따라 나타난다(네트워크 구체는 메인 화면에도 고리가 있어 처음부터 보인다)
          ring = look.volume ? 1 : easeOut(clamp((t - 0.35) / 0.65, 0, 1));
        } else {
          // v2 점 구체에서: 매끈한 점 구체로 커진 뒤 산이 솟는다
          tone = lerp(1, REST_TONE, clamp((t - 0.25) / 0.75, 0, 1));
          rise = easeOut(clamp((t - 0.3) / 0.7, 0, 1));
        }
        if (t >= 1) intro = null;
      } else if (outro && outro.to) {
        // 메인 화면 행성 자리로 줄어든다: 항목 · 궤도가 먼저 걷히고 행성은 그대로 작아진다
        const t = clamp((now - outro.t0) / outro.ms, 0, 1), e = easeInOut(t);
        R = lerp(R1, outro.to.r, e); x = lerp(cx, outro.to.cx, e); y = lerp(cy, outro.to.cy, e);
        nodes = 1 - clamp(t / 0.35, 0, 1);
        if (look.volume) ring = 1; // 네트워크 구체: 고리는 메인 화면 구체에도 있으므로 남긴다(색만 주황으로 돌아간다)
      } else if (outro) {
        // 닫을 때: 항목이 먼저 걷히고 산이 가라앉으며 점이 오렌지로 짙어지다 흩어진다. 이어서 메인 화면 점 구체가 모인다(v2 orb.js)
        const t = clamp((now - outro.t0) / outro.ms, 0, 1), e = t * t;
        R = R1 * (1 + 0.14 * e);
        tone = lerp(REST_TONE, 0.85, clamp(t / 0.6, 0, 1));
        nodes = 1 - clamp(t / 0.45, 0, 1);
        rise = 1 - clamp(t / 0.6, 0, 1);
        fade = 1 - e;
      }
      const ts = terrain && !terrain.empty ? tsBase * rise : 0;
      return { R, x, y, tone, fade, nodes, ts, rise, ring: ring ?? rise * nodes };
    }

    function appear(id, now) {
      const t0 = born.get(id);
      if (t0 === undefined || reducedMotion.matches) return 1;
      const t = (now - t0) / APPEAR_MS;
      if (t >= 1) { born.delete(id); return 1; }
      return t <= 0 ? 0 : t;
    }
    function dirOf(item, a) {
      if (item.core) return null;
      if (a >= 1 || !item.from) return item.dir;
      return slerp(item.from, item.dir, easeOut(a));
    }
    // 3차원 자리(네트워크 구체): 새로 보이는 항목은 부모 자리에서 곧게 나와 제자리에 앉는다
    function posOf(item, a) {
      if (a >= 1 || !item.fromPos) return item.pos;
      const t = easeOut(a), f = item.fromPos, p = item.pos;
      return [lerp(f[0], p[0], t), lerp(f[1], p[1], t), lerp(f[2], p[2], t)];
    }

    function alphaFor(id, groupId) {
      if (hl.focus) return hl.focus.has(id) ? 1 : 0.13;
      if (hl.group) return groupId === hl.group ? 1 : 0.15;
      return 1;
    }

    function draw(now) {
      const st = stage(now), R = st.R, X = st.x, Y = st.y, ts = st.ts, H = TERRAIN.height * ts;
      const m = morphNow = look.volume ? (options.mode === 'button' ? 0 : morphAt(now)) : 1;
      const project = v => { const k = CAMERA / (CAMERA - v[2]); return { x: X + v[0] * R * k, y: Y - v[1] * R * k, k }; };
      const silhouette = R * CAMERA / Math.sqrt(CAMERA * CAMERA - 1);
      const ks = Math.sqrt(zoom);
      // 그 자리 땅 높이(구 반지름 비율). 화면에 놓을 때는 테두리 쪽에서 눌러(limbClamp) 행성 테두리 밖으로 나가지 않게 한다
      const heightAt = d => (ts > 0 ? terrain.at(d) * H : 0);
      const scaled = (v, r) => [v[0] * r, v[1] * r, v[2] * r];
      const onGround = (rv, h) => scaled(rv, 1 + limbClamp(h, rv[2])); // rv = 회전한 방향, h = 높이
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      hits = []; ghostHits = [];
      if (st.fade <= 0) return;
      ctx.globalAlpha = 1;
      // 가려짐: 구 뒤로 넘어간 것. 네트워크 구체는 가리는 구가 없다(깊이는 진하기 · 크기로만 보인다 — fog)
      const hidden = v => !look.volume && occluded(v);
      const fog = z => 0.45 + 0.55 * smoothstep(-1.1, 1.1, z);

      // 위치 계산: 항목은 지형 위에 올라앉는다(d = 모델 방향, r = 반지름, v = 화면 회전 후 좌표). 네트워크 구체는 3차원 자리(pos)
      const pos = new Map();
      for (const item of items) {
        const a = appear(item.id, now);
        if (item.core) { pos.set(item.id, { v: [0, 0, 0], s: { x: X, y: Y, k: 1 }, front: true, core: true, a }); continue; }
        if (item.orbit) {
          const v = satellitePos(item), r = Math.hypot(v[0], v[1], v[2]), c = v[0] / (Math.hypot(v[0], v[1]) || 1);
          // 이름표는 원 바깥쪽으로: 오른쪽 · 왼쪽, 위아래 끝에서는 위 · 아래 가운데
          const align = c > 0.35 ? 'right' : c < -0.35 ? 'left' : v[1] > 0 ? 'top' : 'bottom';
          pos.set(item.id, { d: [v[0] / r, v[1] / r, v[2] / r], r, v, s: project(v), front: !hidden(v), a, orbit: true, align });
          continue;
        }
        if (look.volume) { const v = rotate(posOf(item, a)); pos.set(item.id, { d: item.dir, v, s: project(v), front: true, a }); continue; }
        const d = dirOf(item, a), h = heightAt(d) + 0.01 * ts, v = onGround(rotate(d), h);
        pos.set(item.id, { d, h, v, s: project(v), front: !occluded(v), a });
      }

      // 표면 점: 점 구체와 같은 규칙(깊이 · 빛 → 진하기). 지형이 있으면 고도만큼 솟고, 빛은 경사면 기준, 땅(문서가 쌓인 곳)은 바다보다 짙다.
      // 네트워크 구체는 그리지 않는다(별자리가 구를 이룬다)
      const backDots = Array.from({ length: DOT_LEVELS }, () => []), frontDots = Array.from({ length: DOT_LEVELS }, () => []);
      if (look.dots !== false) for (const p of surface) {
        const d = p.d, rv = rotate(d), v = onGround(rv, p.e * H), s = project(v);
        const n = ts > 0 ? rotate(norm([d[0] - p.g[0] * ts, d[1] - p.g[1] * ts, d[2] - p.g[2] * ts])) : rv;
        const depth = (rv[2] + 1) / 2, light = Math.max(0, dot(n, LIGHT));
        // 행성 면이 칠해지면 점은 바다에만 옅게 남긴다(땅은 색이 대신한다)
        const land = ts > 0 ? lerp(1, 0.55 * (1 - Math.min(1, p.e / 0.06)) + 0.08, ts) : 1;
        const shade = Math.min(0.999, Math.pow(depth, 1.3) * (0.4 + 0.6 * light) * land);
        const r = 1.1 * (0.45 + 0.85 * depth) * Math.min(s.k, 3) * ks * (0.75 + 0.25 * st.tone) * (1 + 0.3 * p.e * ts);
        (occluded(v) ? backDots : frontDots)[Math.floor(shade * DOT_LEVELS)].push(s.x, s.y, r);
      }
      const paintDots = buckets => {
        ctx.fillStyle = colors.accent;
        buckets.forEach((list, level) => {
          if (!list.length) return;
          ctx.globalAlpha = (0.1 + 0.9 * ((level + 0.5) / DOT_LEVELS)) * st.tone * st.fade;
          ctx.beginPath();
          for (let i = 0; i < list.length; i += 3) { ctx.moveTo(list[i] + list[i + 2], list[i + 1]); ctx.arc(list[i], list[i + 1], list[i + 2], 0, TAU); }
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      };
      paintDots(backDots);

      /* 별자리(네트워크 구체): 접힌 폴더 안까지 행성의 모든 문서 · 폴더를 3차원 자리의 점(분야 색, 폴더는 조금 크게)으로 찍는다.
         지금 보이는 항목도 그 밑에 같은 점이 깔려, 메인 화면 구체 ↔ 열린 화면 · 펼치기 · 접기가 끊기지 않는다.
         가까운 쪽일수록 또렷하고 크다(fog · 원근). 고르면 한발 물러나(30%) 빛나는 이웃이 돋보이고, 분야를 걸러 보면 그 분야만 남는다 */
      const gA = st.fade * st.rise * (hl.focus ? 0.3 : 1);
      const gSpots = ghost && gA > 0.01 ? ghost.nodes.map(n => { const v = rotate(n.pos); return { v, s: project(v) }; }) : null;
      const gKeep = (...groups) => (hl.group && !hl.focus ? (groups.includes(hl.group) ? 1 : 0.22) : 1);
      const ghostDots = new Map();
      if (gSpots) ghost.nodes.forEach((n, i) => {
        const p = gSpots[i], a = Math.round(fog(p.v[2]) * gA * gKeep(n.group) * 20) / 20;
        if (a <= 0) return;
        // 물들기: 메인 화면은 주황, 열면 가운데 점부터 바깥으로 분야 색이 입혀진다(gNodeDelay)
        const color = m >= 1 ? n.color : mixColor(colors.accent, n.color, (m - gNodeDelay[i]) / 0.5);
        const key = `${color}|${a}`;
        let b = ghostDots.get(key);
        if (!b) { b = { color, a, path: new Path2D() }; ghostDots.set(key, b); }
        const r = (n.file ? 1.7 : 2.4) * Math.min(p.s.k, 3) * ks;
        b.path.moveTo(p.s.x + r, p.s.y); b.path.arc(p.s.x, p.s.y, r, 0, TAU);
        // 눌러서 고를 수 있게(크게 연 화면만 — 메인 화면 구체는 통째로 여는 버튼). 항목으로 펼쳐진 노드는 항목 쪽이 먼저 잡힌다(hitTest)
        if (n.id && options.mode !== 'button' && st.nodes > 0.5) ghostHits.push({ id: n.id, x: p.s.x, y: p.s.y, r, z: p.v[2] });
      });
      const paintGhost = () => {
        if (look.additive) ctx.globalCompositeOperation = 'lighter';
        for (const b of ghostDots.values()) { ctx.fillStyle = rgba(b.color, b.a); ctx.fill(b.path); }
        ctx.globalCompositeOperation = 'source-over';
      };

      // 연결선: 뒤쪽 구간 → 막 → 앞쪽 구간. 표면을 따라가는 호는 지형을 넘어간다
      // 앞쪽 선의 진하기(0~1). 행성 면 위에서는 지평선(테두리)에 가까울수록 옅어져, 구 뒤로 넘어가는 선이 테두리에서 사라지듯 흐려진다.
      // 행성 밖 허공(위성 쪽)은 그대로 또렷하고, 지평선 뒤쪽으로 테두리에 다가갈 때만 옅어진다
      const lineFade = (v, s) => {
        const rho = Math.hypot(s.x - X, s.y - Y) / silhouette, c = v[2] / (Math.hypot(v[0], v[1], v[2]) || 1);
        if (rho < 1) return LINE_FADE + (1 - LINE_FADE) * smoothstep(1 / CAMERA, 1 / CAMERA + 0.32, c);
        return c >= 1 / CAMERA ? 1 : LINE_FADE + (1 - LINE_FADE) * smoothstep(1, 1.14, rho);
      };
      const strokes = new Map();
      const bucket = (layer, color, alpha, w, dash) => {
        const key = `${layer}|${color}|${alpha.toFixed(2)}|${w.toFixed(1)}|${dash ? 1 : 0}`;
        let b = strokes.get(key);
        if (!b) { b = { layer, color, alpha, w, dash, path: new Path2D() }; strokes.set(key, b); }
        return b;
      };
      // 별자리 선: 폴더 관계 · 문서 링크를 휜 선으로(curveTo — 분야 색, 가늘고 옅게, 가까운 쪽일수록 또렷). 범례의 선 종류 켜고 끄기를 따른다.
      // 지금 보이는 항목의 선은 아래에서 다시 또렷하게 그린다. 메인 화면(m = 0)에는 없고, 열 때 가운데 쪽 선부터 a(상위 · 링크한 문서) → b로 뻗어 이어진다
      // 신경망 시안: 메인 화면 구체(m = 0)에도 폴더 관계 선을 주황으로 옅게 그려 가지 모양이 읽히게 한다(점만 있으면 흩어진 점구름으로 보였다).
      // 열면(m → 1) 그 위로 분야 색 선이 뻗어 이어지고 주황 선은 걷힌다. 문서 링크는 가지를 가로질러 어지러우므로 메인 화면에는 그리지 않는다
      if (gSpots) for (let j = 0; j < ghost.edges.length; j++) {
        const e = ghost.edges[j];
        if (e.kind === 'markdown' ? !show.markdown : !show.folder) continue;
        const pa = gSpots[e.a], pb = gSpots[e.b];
        if (neural && e.kind !== 'markdown' && m < 1) {
          const rest = Math.round(REST_EDGE * (1 - m) * gA * fog((pa.v[2] + pb.v[2]) / 2) * 20) / 20;
          if (rest > 0) curveTo(bucket('front', colors.accent, rest, 0.8, false).path, pa.s, pb.s, gBend[j]);
        }
        if (m <= 0) continue;
        const g = m >= 1 ? 1 : clamp((m - gEdgeDelay[j]) / 0.45, 0, 1);
        if (g <= 0) continue;
        const a = Math.round((e.kind === 'markdown' ? 0.28 : 0.42) * gA * gKeep(ghost.nodes[e.a].group, ghost.nodes[e.b].group) * fog((pa.v[2] + pb.v[2]) / 2) * (0.35 + 0.65 * g) * 20) / 20;
        if (a <= 0) continue;
        const b = bucket('front', e.color, a, e.kind === 'markdown' ? 0.8 : 0.7, false);
        curveTo(b.path, pa.s, pb.s, gBend[j], g);
      }
      /* 고른 항목의 연결(네트워크 구체): 넓고 옅은 빛 두 겹을 더해 칠해 선이 빛나 보이게 하고(맥동), 선을 따라 빛 한 점이 흐른다.
         흐르는 방향 = 선의 a → b(폴더는 상위 → 하위, 문서 링크는 링크한 문서 → 링크된 문서). 동작 줄이기에서는 흐르지 않는다 */
      const pulse = pulseAt(now), sparks = [];
      glowScale = hl.focus ? clamp(Math.sqrt(12 / hl.focus.size), 0.3, 1) : 1; // 이웃 12개까지는 그대로, 72개면 약 0.4배
      // 신경망 시안: 빛나는 선도 같은 곡선(bend · g)을 따르고, 빛 한 점도 곡선 위를 흐른다
      const glowLine = (s0, s1, color, w, grow, key, bend, g) => {
        for (const [k, wk] of [[0.14, 6], [0.3, 2.6]]) {
          const gb = bucket('glow', color, Math.round(k * pulse * grow * glowScale * 100) / 100, w * wk, false);
          curveTo(gb.path, s0, s1, bend, g);
        }
        if (reducedMotion.matches) return;
        const t = (now / 1600 + hash(key)) % 1;
        const at = curveAt(s0, s1, bend, t * g);
        sparks.push({ x: at.x, y: at.y, color, r: 5 + w * 2, a: grow * glowScale });
      };
      const edgeBend = e => { let k = bendCache.get(e); if (k === undefined) { k = bendScale * bendOf(`${e.a}>${e.b}`); bendCache.set(e, k); } return k; };
      for (const e of edges) {
        if (e.kind === 'markdown' ? !show.markdown : !show.folder) continue;
        if (e.summary && !(hl.focus && (hl.focus.has(e.a) || hl.focus.has(e.b)))) continue;
        const pa = pos.get(e.a), pb = pos.get(e.b);
        if (!pa || !pb) continue;
        const grow = Math.min(pa.a, pb.a) * st.nodes;
        if (grow <= 0) continue;
        // 접힌 폴더로 모은 연결(점선)은 요약이라 한 단계 옅게. 위성과 문서를 잇는 줄은 행성 앞을 지나므로 더 옅게(고르면 또렷)
        const tether = pa.orbit || pb.orbit;
        let alpha = e.kind === 'markdown' ? (tether ? 0.26 : e.rerouted ? 0.4 : 0.55) : 0.4;
        let w = e.kind === 'markdown' ? 1.15 + Math.min(1.6, Math.log2(e.count) * 0.55) : 0.8;
        // 폴더 구조 선은 회색이다. 네트워크 구체에서는 하위 항목의 분야 색으로(빛날 때도 분야 색으로 빛난다)
        const color = e.kind === 'markdown' ? e.color : look.volume && byId.has(e.b) ? byId.get(e.b).color : colors.ash;
        if (hl.focus) {
          if (hl.focus.has(e.a) && hl.focus.has(e.b)) { alpha = 0.95; w += 0.7; } else alpha *= 0.08;
        } else if (hl.group) {
          if (e.groups.has(hl.group)) alpha = Math.min(1, alpha + 0.2); else alpha *= 0.1;
        }
        alpha = Math.round(alpha * grow * 20) / 20;
        if (alpha <= 0) continue;
        // 네트워크 구체: 모든 선이 두 점을 살짝 휜 곡선으로 잇는다(edgeBend — 위성 줄 · 가운데 핵으로 가는 선도, neural이 false면 곧게). 진하기는 가운데 깊이로(fog), 빛나는 선은 그대로
        if (look.volume) {
          // 물들기 중에는 a → b로 뻗어 이어진다(별자리 선보다 조금 늦게 시작)
          const g = m >= 1 ? 1 : clamp((m - 0.2) / 0.6, 0, 1);
          if (g <= 0) continue;
          const bend = edgeBend(e);
          const glowing = look.glow && hl.focus && hl.focus.has(e.a) && hl.focus.has(e.b);
          const b = bucket('front', color, glowing ? alpha : Math.round(alpha * fog((pa.v[2] + pb.v[2]) / 2) * 20) / 20, w, e.rerouted);
          curveTo(b.path, pa.s, pb.s, bend, g);
          if (glowing) glowLine(pa.s, pb.s, color, w, grow, `${e.a}>${e.b}`, bend, g);
          continue;
        }
        const pts = [];
        if (tether) {
          // 위성 ↔ 항목: 위성 자리에서 행성 쪽으로 내려와 표면 위를 따라가 항목에 닿는 곡선(구 속을 지나지 않는다).
          // 곧은 줄은 구 속을 지나 들어가는 곳에서 끊겨, 줄이 구를 뚫고 아무 데서나 끝나는 것처럼 보였다.
          // 출발 방향은 위성 방향을 앞으로 조금 숙인 것(TETHER.lean — 화면에서는 위성과 같은 자리)이라 행성 옆을 크게 돌지 않고 앞쪽으로 넘어온다.
          // 방향은 그 출발 방향에서 항목 방향으로 구면 보간하고, 높이는 (1 − t)^TETHER.drop으로 항목 높이까지 내려온다(늘 구 바깥).
          // 가운데 핵(AGENTS.md)은 화면 한가운데 = 앞쪽 정면 표면 자리에 닿는다. 그 길은 시선 축을 지나는 평면이라 곧게 보이므로 옆으로 살짝 휜다(TETHER.bend)
          const sat = pa.orbit ? pa : pb, node = pa.orbit ? pb : pa;
          const rs = Math.hypot(sat.v[0], sat.v[1], sat.v[2]);
          const rn = node.core ? 1.01 : Math.hypot(node.v[0], node.v[1], node.v[2]);
          const us = norm([sat.v[0] / rs, sat.v[1] / rs, sat.v[2] / rs + TETHER.lean]), un = node.core ? [0, 0, 1] : [node.v[0] / rn, node.v[1] / rn, node.v[2] / rn];
          const r0 = rs * CAMERA / (Math.hypot(us[0], us[1]) * CAMERA + rs * us[2]); // 화면에서 위성과 같은 자리가 되는 출발 반지름
          const side = node.core ? norm(cross(us, un)) : null;
          const n = Math.max(12, Math.ceil(Math.acos(clamp(dot(us, un), -1, 1)) * 20));
          for (let i = 0; i <= n; i++) {
            const t = i / n, r = rn + (r0 - rn) * Math.pow(1 - t, TETHER.drop);
            let d = slerp(us, un, t);
            if (side) { const k = TETHER.bend * Math.sin(Math.PI * t); d = norm([d[0] + side[0] * k, d[1] + side[1] * k, d[2] + side[2] * k]); }
            pts.push({ v: [d[0] * r, d[1] * r, d[2] * r] });
          }
        } else if (pa.core || pb.core) {
          // 핵에서 표면으로 뻗는 살: 구 안쪽이므로 막 아래에 그린다
          const tip = pa.core ? pb : pa;
          for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push({ v: [tip.v[0] * t, tip.v[1] * t, tip.v[2] * t], inside: true }); }
        } else {
          const ang = Math.acos(clamp(dot(pa.d, pb.d), -1, 1));
          // 표면에 붙어 가는 낮은 호. 높게 띄우면 뒤쪽을 지나는 긴 선이 구 바깥으로 크게 휘어 보인다(테두리 쪽은 땅처럼 눌린다)
          const lift = e.kind === 'markdown' ? 0.015 + 0.05 * (ang / Math.PI) : 0.004;
          const n = Math.max(6, Math.ceil(ang * 14));
          for (let i = 0; i <= n; i++) {
            const t = i / n, d = slerp(pa.d, pb.d, t);
            const h = Math.max(lerp(pa.h, pb.h, t), heightAt(d) + 0.004) + lift * Math.sin(Math.PI * t);
            pts.push({ v: onGround(rotate(d), h) });
          }
        }
        // 구간마다 진하기를 정해 같은 진하기끼리 한 경로로 모은다. 앞쪽은 테두리 가까이에서 옅어지고(lineFade), 가려진 뒤쪽은 행성 면 아래에 그린다
        let prev = null, b = null;
        for (const p of pts) {
          const s = project(p.v), back = p.inside || occluded(p.v);
          const a = back ? alpha * (p.inside ? 0.85 : 0.28) : Math.round(alpha * lineFade(p.v, s) * 20) / 20;
          const next = bucket(back ? 'back' : 'front', color, a, w, e.rerouted);
          if (next !== b) { b = next; b.path.moveTo((prev || s).x, (prev || s).y); }
          b.path.lineTo(s.x, s.y);
          prev = s;
        }
      }
      const ringLabels = [];
      orbits.forEach((o, index) => {
        const focus = hl.group === o.id, a0 = (focus ? look.ring + 0.28 : look.ring) * st.ring * st.fade;
        if (a0 <= 0.01) return;
        const ringColor = mixColor(colors.accent, o.color, m); // 메인 화면은 주황 고리, 열면 분야 색으로
        const steps = Math.max(8, Math.ceil(((o.arcEnd - o.arcStart) / TAU) * 160));
        let prevLayer = null, b = null, prev = null, edge = null;
        for (let i = 0; i <= steps; i++) {
          const v = orbitPoint(o, orbitAngle(o, index, i / steps)), sp = project(v);
          // 이름을 둘 고리 끝(labelSide): 지구본과 함께 도는 고리는 지금 화면에서 가장 왼쪽 · 오른쪽 점에 둔다
          if (o.labelSide && (!edge || (o.labelSide === 'left' ? sp.x < edge.x : sp.x > edge.x))) edge = sp;
          // 네트워크 구체(토성 고리): 앞쪽 반은 별자리 위에(over — 항목보다 먼저, 위성 아이콘은 그 위), 뒤쪽 반은 옅게 별자리 아래에 그린다
          const layer = look.volume ? (v[2] >= 0 ? 'over' : 'front') : hidden(v) ? 'back' : 'front';
          if (layer !== prevLayer) {
            b = bucket(layer, ringColor, layer === 'back' ? a0 * 0.35 : look.volume && layer === 'front' ? a0 * 0.4 : a0, focus ? 2 : 1.4, layer === 'back');
            b.path.moveTo((prev || sp).x, (prev || sp).y); prevLayer = layer;
          }
          b.path.lineTo(sp.x, sp.y); prev = sp;
        }
        // 분야 이름: 구간 앞의 빈자리(구간 사이 틈)에 원 위로 가운데 맞춤. 고리 하나를 통째로 쓰는 궤도(labelSide)는 고리 바깥 끝에 둔다
        if (edge) {
          ringLabels.push({ item: { label: `${o.label} ${o.count}` }, x: edge.x + (o.labelSide === 'left' ? -8 : 8), y: edge.y, anchor: o.labelSide === 'left' ? 'end' : 'start', priority: 86, alpha: st.ring * st.nodes });
        } else {
          const lp = project(orbitPoint(o, o.labelAt + (orbitPhase[index] || 0)));
          ringLabels.push({ item: { label: `${o.label} ${o.count}` }, x: lp.x, y: lp.y, anchor: 'middle', priority: 86, alpha: st.ring * st.nodes });
        }
      });
      const stroke = layer => {
        if (look.additive && layer !== 'back') ctx.globalCompositeOperation = 'lighter';
        for (const b of strokes.values()) {
          if (b.layer !== layer) continue;
          ctx.strokeStyle = rgba(b.color, b.alpha * st.fade); ctx.lineWidth = b.w; ctx.setLineDash(b.dash ? [3, 3] : []);
          ctx.stroke(b.path);
        }
        ctx.setLineDash([]);
        ctx.globalCompositeOperation = 'source-over';
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      stroke('back');

      // 뒤쪽 항목
      const order = items.filter(i => !i.core).sort((a, b) => pos.get(a.id).v[2] - pos.get(b.id).v[2]);
      for (const item of order) {
        const p = pos.get(item.id);
        if (p.front || p.a <= 0) continue;
        drawItem(item, p, alphaFor(item.id, item.group) * 0.45 * st.nodes * st.fade, now, ks);
      }

      // 막: 뒤쪽을 바탕색으로 덮어 깊이를 만든다. 지형을 켜면 막 대신 분야 색으로 칠한 행성 면이 덮는다. 네트워크 구체는 구가 없어 막 · 테두리도 없다
      if (!look.volume) {
        ctx.globalAlpha = st.fade;
        ctx.fillStyle = rgba(colors.paper, 0.6 * (1 - Math.min(1, ts * 1.2)));
        ctx.beginPath(); ctx.arc(X, Y, silhouette, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(colors.accent, (0.12 * st.tone + 0.06) * (1 - ts)); ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 검은 바탕: 대기 빛무리. 테두리에서 가장 밝고 바깥으로 번진다. 안쪽은 행성 면이 덮어 테두리 밖 빛만 남는다
      // (테두리 안쪽에 더하는 빛은 행성 면 위에 유리 껍질처럼 떠 보여 쓰지 않는다)
      const glowA = look.atmosphere * st.fade * (0.35 + 0.65 * st.rise);
      if (glowA > 0) {
        const halo = ctx.createRadialGradient(X, Y, silhouette * 0.92, X, Y, silhouette * 1.22);
        halo.addColorStop(0, rgba(colors.accent, 0)); halo.addColorStop(0.27, rgba(colors.accent, 0.2 * glowA));
        halo.addColorStop(0.5, rgba(colors.accent, 0.06 * glowA)); halo.addColorStop(1, rgba(colors.accent, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(X, Y, silhouette * 1.22, 0, TAU); ctx.fill();
      }
      paintPlanet(st, X, Y, R);

      // 핵: 지구본은 막 위(뒤쪽 항목 위 · 앞쪽 항목 아래)에 그린다. 네트워크 구체는 앞쪽 항목 사이에 깊이 순서로 끼운다(아래)
      const coreItem = items.find(i => i.core && i.primary), coreA = coreItem ? pos.get(coreItem.id).a * st.nodes * st.fade : 0;
      let coreDrawn = !coreItem;
      if (coreItem && !look.volume) { drawCore(coreItem, coreA, now, X, Y, ks); coreDrawn = true; }

      paintDots(frontDots);
      // 등고선: 해안선 + 3단(잉크색 가는 선). 높을수록 짙고, 구 가장자리로 갈수록(눕혀 보일수록) 옅다. 고르거나 분야를 걸러 볼 때는 한 단계 옅게
      if (ts > 0.02) {
        const dim = (hl.focus || hl.group ? 0.55 : 1) * ts * st.fade, levels = terrain.contours;
        const LEVEL_ALPHA = [0.3, 0.1, 0.14, 0.2], BAND = [0.12, 0.5, 1];
        ctx.lineWidth = 1;
        levels.forEach((c, li) => {
          const h = c.level * H + 0.002, segs = c.segs, paths = [new Path2D(), new Path2D(), new Path2D()];
          for (let k = 0; k < segs.length; k += 6) {
            const ra = rotate([segs[k], segs[k + 1], segs[k + 2]]);
            if (ra[2] < 0.06) continue;
            const va = onGround(ra, h);
            if (occluded(va)) continue;
            const vb = onGround(rotate([segs[k + 3], segs[k + 4], segs[k + 5]]), h);
            if (occluded(vb)) continue;
            const sa = project(va), sb = project(vb), z = (va[2] + vb[2]) / 2;
            const path = paths[z > 0.5 ? 2 : z > 0.22 ? 1 : 0];
            path.moveTo(sa.x, sa.y); path.lineTo(sb.x, sb.y);
          }
          paths.forEach((path, band) => {
            ctx.strokeStyle = rgba(colors.ink, (LEVEL_ALPHA[li] ?? 0.2) * BAND[band] * dim * look.contour);
            ctx.stroke(path);
          });
        });
      }
      stroke('front');
      paintGhost();
      // 올린 별자리 점(아직 항목이 아닌 노드): 둘레에 고리를 그려 무엇을 누르려는지 보이게 한다
      const gh = hover && !byId.has(hover) && ghostHits.find(x => x.id === hover);
      if (gh) { ctx.strokeStyle = rgba(colors.ink, 0.75); ctx.lineWidth = 1.25; ctx.beginPath(); ctx.arc(gh.x, gh.y, gh.r + 3.5, 0, TAU); ctx.stroke(); }
      stroke('glow');
      // 고른 연결 위를 흐르는 빛: 분야 색 빛 번짐 + 가운데 밝은 점(더해 칠한다)
      if (sparks.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (const sp of sparks) {
          ctx.globalAlpha = clamp(0.9 * sp.a * st.fade, 0, 1);
          ctx.drawImage(glowSprite(sp.color), sp.x - sp.r, sp.y - sp.r, sp.r * 2, sp.r * 2);
          ctx.fillStyle = colors.ink; ctx.beginPath(); ctx.arc(sp.x, sp.y, 1.3, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      stroke('over'); // 토성 고리의 앞쪽 반(네트워크 구체)

      const labels = [];
      if (coreItem && pos.get(coreItem.id).a > 0 && st.nodes > 0.5) {
        hits.push({ id: coreItem.id, x: X, y: Y, r: 14 * ks, z: -1 });
        labels.push({ item: coreItem, x: X, y: Y + 24 * ks + 6, center: true, priority: 95, alpha: alphaFor(coreItem.id, coreItem.group) * pos.get(coreItem.id).a });
      }
      for (const item of order) {
        const p = pos.get(item.id);
        if (!p.front || p.a <= 0) continue;
        if (!coreDrawn && p.v[2] >= 0) { drawCore(coreItem, coreA, now, X, Y, ks); coreDrawn = true; }
        // 행성 항목은 가장자리로 갈수록 옅게(깊이), 궤도 위성은 화면 위 원이라 늘 또렷하게
        // 네트워크 구체의 위성은 메인 화면 구체로 줄어들 때도 남는다(작은 주황 점으로 돌아가 메인 화면 고리로 이어진다)
        // 위성: 화면 고리는 늘 또렷하게, 지구본과 함께 도는 고리(네트워크)는 그래프 뒤로 갈수록 옅게
        const depthA = item.orbit ? (look.volume ? fog(p.v[2]) : 1) : clamp(0.55 + p.v[2] * 0.6, 0.55, 1);
        const a = alphaFor(item.id, item.group) * depthA * (item.orbit && look.volume ? 1 : st.nodes) * st.fade;
        const r = drawItem(item, p, a, now, ks);
        if (st.nodes > 0.5) hits.push({ id: item.id, x: p.s.x, y: p.s.y, r, z: p.v[2] });
        const l = labelFor(item, p, r, a * p.a);
        if (l) labels.push(l);
      }
      if (!coreDrawn) drawCore(coreItem, coreA, now, X, Y, ks);
      // 이름표는 물든 만큼(메인 화면 구체에는 없다)
      const labelFade = st.nodes * st.fade * m;
      if (labelFade > 0.01) drawLabels(labels.concat(ringLabels), labelFade);
    }

    /* 픽셀 표: 화면 픽셀 → 구 위의 점(화면 좌표) · 위도 칸 · 경도 시작 칸 · 가장자리 어둡기. 크기 · 반지름 · 기울기(pitch)가
       같으면 다시 쓰고, 돌기(yaw)는 경도 칸을 미는 것으로 끝난다(자동 회전 중에는 픽셀마다 역삼각함수를 다시 풀지 않는다) */
    const raster = { key: '' };
    function rasterTable(size, outer, scale, R, lon, lat) {
      const key = `${size}|${outer.toFixed(2)}|${scale.toFixed(4)}|${R.toFixed(2)}|${pitch.toFixed(5)}|${look.limb}`;
      if (raster.key === key) return raster;
      const N = size * size, C = CAMERA, C2 = C * C, C4 = C2 * C2, silR = C / Math.sqrt(C2 - 1);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      if (!raster.kind || raster.kind.length !== N) {
        Object.assign(raster, { kind: new Uint8Array(N), rho: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N),
          lon0: new Float32Array(N), row0: new Int32Array(N), row1: new Int32Array(N), tj: new Float32Array(N), limb: new Float32Array(N) });
      }
      const { kind, rho: RHO, vx: VX, vy: VY, vz: VZ, lon0: LON0, row0: ROW0, row1: ROW1, tj: TJ, limb: LIMB } = raster;
      for (let py = 0, k = 0; py < size; py++) {
        const v = (outer - (py + 0.5) / scale) / R;
        for (let px = 0; px < size; px++, k++) {
          const u = ((px + 0.5) / scale - outer) / R, rr = u * u + v * v, rho = Math.sqrt(rr) / silR;
          const disc = C4 - (rr + C2) * (C2 - 1);
          if (disc < 0) { kind[k] = 0; continue; } // 구 테두리 밖은 칠하지 않는다(솟은 땅도 테두리 안에 머문다 — limbClamp)
          const t = (C2 - Math.sqrt(disc)) / (rr + C2);
          const x = t * u, y = t * v, z = C - t * C;
          kind[k] = 1;
          // 화면 → 모델(pitch만 되돌린다. yaw는 경도를 미는 것과 같다)
          const y1 = y * cp + z * sp, z1 = -y * sp + z * cp;
          let ph = Math.atan2(z1, x); if (ph < 0) ph += TAU;
          const fj = Math.min(lat - 1, Math.max(0, (Math.acos(Math.max(-1, Math.min(1, y1))) / Math.PI) * lat - 0.5)), j0 = Math.floor(fj);
          RHO[k] = rho; VX[k] = x; VY[k] = y; VZ[k] = z; LON0[k] = (ph / TAU) * lon;
          ROW0[k] = j0 * lon; ROW1[k] = Math.min(lat - 1, j0 + 1) * lon; TJ[k] = fj - j0;
          LIMB[k] = 1 - look.limb + look.limb * Math.max(0, z);
        }
      }
      raster.key = key;
      return raster;
    }

    /* 행성 면: 화면의 구 영역을 낮은 해상도(지름 360px 이하)로 픽셀마다 칠한 뒤 늘려 붙인다(부드러운 지도 느낌).
       땅 · 바다는 픽셀마다 좁은 봉우리 밀도로 다시 가려 해안선이 격자 계단 없이 매끈하다.
       픽셀 → 카메라 광선이 구와 만나는 점(픽셀 표) → 모델 좌표 → 경위도 격자의 색 · 고도 · 경사. 빛은 점 구체와 같은 왼쪽 위(화면 고정).
       산은 경사면 빛 · 등고선으로 보이고 테두리는 매끈한 원이다. 예전에는 테두리 밖에 그 방향 지평선 점의 높이만큼 땅을 더 칠했는데,
       지평선 한 점만 보고 칠해 테두리 밖으로 판이 겹쳐 쌓이고 땅이 끝나는 곳에서 곧게 잘려 보여서 뺐다 */
    function paintPlanet(st, X, Y, R) {
      const T = terrain, ts = st.ts;
      if (!T || T.empty || ts <= 0.01) return;
      const C = CAMERA, C2 = C * C;
      const silR = C / Math.sqrt(C2 - 1), sil = silR * R;
      const outer = sil + 2;
      const scale = Math.min(1, 360 / (2 * outer)), size = Math.max(16, Math.ceil(2 * outer * scale));
      if (size !== planet.size) { planet.canvas.width = size; planet.canvas.height = size; planet.img = planet.ctx.createImageData(size, size); planet.size = size; }
      const data = planet.img.data, { lon, lat, color, grad, field, sea } = T, L0 = TERRAIN.land * 0.7, L1 = TERRAIN.land * 1.3;
      const tb = rasterTable(size, outer, scale, R, lon, lat);
      const { kind, rho: RHO, vx: VX, vy: VY, vz: VZ, lon0: LON0, row0: ROW0, row1: ROW1, tj: TJ, limb: LIMB } = tb;
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const edgePx = sil * scale, shift = ((yaw / TAU) * lon) % lon;
      const s0 = look.shade[0], s1 = look.shade[1], LX = LIGHT[0], LY = LIGHT[1], LZ = LIGHT[2], invL = 1 / (L1 - L0);
      for (let k = 0, o = 0, N = size * size; k < N; k++, o += 4) {
        if (!kind[k]) { data[o + 3] = 0; continue; }
        let fi = LON0[k] + shift; if (fi >= lon) fi -= lon; else if (fi < 0) fi += lon;
        const i0 = fi | 0, ti = fi - i0, i1 = i0 + 1 === lon ? 0 : i0 + 1, tj = TJ[k], r0 = ROW0[k], r1 = ROW1[k];
        const c00 = r0 + i0, c10 = r0 + i1, c01 = r1 + i0, c11 = r1 + i1;
        const w00 = (1 - ti) * (1 - tj), w10 = ti * (1 - tj), w01 = (1 - ti) * tj, w11 = ti * tj;
        const rho = RHO[k];
        const q0 = c00 * 3, q1 = c10 * 3, q2 = c01 * 3, q3 = c11 * 3;
        const gx = grad[q0] * w00 + grad[q1] * w10 + grad[q2] * w01 + grad[q3] * w11;
        const gy = grad[q0 + 1] * w00 + grad[q1 + 1] * w10 + grad[q2 + 1] * w01 + grad[q3 + 1] * w11;
        const gz = grad[q0 + 2] * w00 + grad[q1 + 2] * w10 + grad[q2 + 2] * w01 + grad[q3 + 2] * w11;
        // 경사면 법선(화면 좌표) = 구 위의 점 − 경사(모델 → 화면으로 돌린 것)
        const gx1 = gx * cyw + gz * syw, gz1 = -gx * syw + gz * cyw, gy2 = gy * cp - gz1 * sp, gz2 = gy * sp + gz1 * cp;
        const nx = VX[k] - gx1 * ts, ny = VY[k] - gy2 * ts, nz = VZ[k] - gz2 * ts;
        const light = Math.max(0, (nx * LX + ny * LY + nz * LZ) / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1));
        const shade = (s0 + s1 * light) * LIMB[k];
        const f = field[c00] * w00 + field[c10] * w10 + field[c01] * w01 + field[c11] * w11, lt = (f - L0) * invL;
        const ld = lt <= 0 ? 0 : lt >= 1 ? 1 : lt * lt * (3 - 2 * lt);
        // ImageData는 0~255로 알아서 자르고 반올림한다(Uint8ClampedArray). 덮임(가장자리 부드럽게)도 그대로 넣는다
        data[o] = (sea[0] + ((color[q0] * w00 + color[q1] * w10 + color[q2] * w01 + color[q3] * w11) - sea[0]) * ld) * shade;
        data[o + 1] = (sea[1] + ((color[q0 + 1] * w00 + color[q1 + 1] * w10 + color[q2 + 1] * w01 + color[q3 + 1] * w11) - sea[1]) * ld) * shade;
        data[o + 2] = (sea[2] + ((color[q0 + 2] * w00 + color[q1 + 2] * w10 + color[q2 + 2] * w01 + color[q3 + 2] * w11) - sea[2]) * ld) * shade;
        data[o + 3] = ((1 - rho) * edgePx + 0.5) * 255;
      }
      planet.ctx.putImageData(planet.img, 0, 0);
      ctx.globalAlpha = 0.95 * Math.min(1, ts * 1.2) * st.fade;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(planet.canvas, X - outer, Y - outer, 2 * outer, 2 * outer);
      ctx.globalAlpha = 1;
    }

    // 검은 바탕의 항목 빛: 색마다 방사형 무늬를 한 번 그려 두고 늘려 붙인다(더해 칠해 겹치면 밝아진다)
    const sprites = new Map();
    function glowSprite(color) {
      let c = sprites.get(color);
      if (!c) {
        c = document.createElement('canvas'); c.width = c.height = 64;
        const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, rgba(color, 0.9)); grad.addColorStop(0.3, rgba(color, 0.35)); grad.addColorStop(1, rgba(color, 0));
        g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
        sprites.set(color, c);
      }
      return c;
    }

    // 위성 아이콘(네트워크 구체의 스킬 · 루틴): 대시보드 아이콘 묶음(dashboard-v2 icons.js)의 심볼 #i-skill · #i-routine 경로를 그대로 읽는다(24 격자)
    const symbols = new Map();
    function symbolPaths(name) {
      if (!symbols.has(name)) symbols.set(name, [...document.querySelectorAll(`#i-${name} path`)].map(el => new Path2D(el.getAttribute('d'))));
      return symbols.get(name);
    }
    function drawItem(item, p, alpha, now, ks) {
      const g = easeOut(p.a);
      const base = item.size * p.s.k * ks * (p.front ? 1 : 0.85);
      const selected = hl.selected === item.id, hovered = hover === item.id;
      let r = base * (0.3 + 0.7 * g) * (hovered && !selected ? 1.18 : 1);
      // 물들기(네트워크 구체): 색은 주황 → 분야 색. 위성은 작은 주황 점(메인 화면 구체) → 아이콘 배지로 커지고, 아이콘은 뒤따라 떠오른다
      const mo = look.volume ? morphNow : 1, ic = mo < 1 ? mixColor(colors.accent, item.color, mo) : item.color;
      if (item.symbol && mo < 1) r = lerp(2.6 * p.s.k * ks, r, mo);
      const { x, y } = p.s, shape = item.symbol ? 'circle' : item.shape;
      const lit = look.glow && hl.focus && hl.focus.has(item.id);
      // 빛 번짐: 모두 펼친 변형의 작은 항목(quiet)은 고르거나 올렸을 때만(3천 개를 다 번지게 하면 무겁고 하얗게 탄다)
      if (look.bloom && p.front && (!item.quiet || lit || selected || hovered)) {
        // 고른 항목과 그 이웃(네트워크 구체): 빛 번짐을 넓고 진하게, 맥동한다
        const gr = r * (lit ? 3.6 + 2 * pulseAt(now) : 3.4);
        ctx.globalAlpha = clamp(alpha * g * (lit ? glowScale : look.bloom), 0, 1); ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glowSprite(item.live ? colors.accent : ic), x - gr, y - gr, gr * 2, gr * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = clamp(alpha * g, 0, 1);
      if (item.live && p.front) {
        const t = reducedMotion.matches ? 0.4 : (now % 1600) / 1600;
        ctx.strokeStyle = rgba(colors.accent, 0.9 * (1 - t)); ctx.lineWidth = 2;
        markPath(ctx, shape, x, y, r + 3 + 14 * easeOut(t)); ctx.stroke();
      }
      if (selected && p.front) {
        const glow = ctx.createRadialGradient(x, y, r, x, y, r + 16);
        glow.addColorStop(0, rgba(colors.accent, 0.4)); glow.addColorStop(1, rgba(colors.accent, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r + 16, 0, TAU); ctx.fill();
      }
      if (item.symbol) {
        // 분야 색 원판 위에 어두운 아이콘 선(실행 중이면 오렌지 원판). 아이콘 내용(3~21)이 원판 지름의 62%에 들게 줄인다
        markPath(ctx, 'circle', x, y, r);
        ctx.fillStyle = item.live ? colors.accent : ic; ctx.fill();
        const ia = smoothstep(0.35, 1, mo); // 작은 점일 때는 테두리 · 아이콘 없이
        if (ia > 0) {
          ctx.save(); ctx.globalAlpha *= ia;
          ctx.strokeStyle = colors.paper; ctx.lineWidth = 1.5; ctx.stroke();
          const s = (2 * r * 0.62) / 18;
          ctx.translate(x - 12 * s, y - 12 * s); ctx.scale(s, s);
          ctx.strokeStyle = colors.paper; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          for (const path of symbolPaths(item.symbol)) ctx.stroke(path);
          ctx.restore();
        }
      } else {
        if (item.folded && p.front) {
          ctx.setLineDash([2, 2.5]); ctx.strokeStyle = rgba(ic, 0.8); ctx.lineWidth = 1.2;
          markPath(ctx, shape, x, y, r + 4); ctx.stroke(); ctx.setLineDash([]);
        } else if (item.guide && p.front) {
          ctx.strokeStyle = rgba(ic, 0.45); ctx.lineWidth = 1;
          markPath(ctx, shape, x, y, r + 3.5); ctx.stroke();
        }
        markPath(ctx, shape, x, y, r);
        if (item.hollow) {
          ctx.fillStyle = item.live ? rgba(colors.accent, 0.45) : colors.paper; ctx.fill();
          if (!item.live && look.hollow) { ctx.fillStyle = rgba(ic, look.hollow); ctx.fill(); }
          ctx.strokeStyle = ic; ctx.lineWidth = Math.max(1.5, r * 0.3); ctx.stroke();
        } else {
          ctx.fillStyle = item.live ? colors.accent : ic; ctx.fill();
          ctx.strokeStyle = colors.paper; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      if (selected) {
        ctx.strokeStyle = colors.ink; ctx.lineWidth = 2;
        markPath(ctx, shape, x, y, r + 4.5); ctx.stroke();
      } else if (hovered) {
        ctx.strokeStyle = rgba(colors.ink, 0.55); ctx.lineWidth = 1.25;
        markPath(ctx, shape, x, y, r + 4); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return r;
    }

    // 핵: 오렌지 원 + 로고의 네 갈래 반짝이. 가만히 숨 쉬듯 번진다
    function drawCore(item, alpha, now, X, Y, ks) {
      if (alpha <= 0) return;
      const a = alphaFor(item.id, item.group) * alpha;
      const pulse = reducedMotion.matches ? 0.5 : Math.sin(now / 900) * 0.5 + 0.5;
      ctx.globalAlpha = a;
      const glow = ctx.createRadialGradient(X, Y, 4 * ks, X, Y, (40 + pulse * 6) * ks);
      glow.addColorStop(0, rgba(colors.accent, 0.42)); glow.addColorStop(1, rgba(colors.accent, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(X, Y, (46 + pulse * 6) * ks, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(colors.accent, 0.4); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X, Y, 17 * ks, 0, TAU); ctx.stroke();
      ctx.fillStyle = colors.accent; ctx.beginPath(); ctx.arc(X, Y, 10.5 * ks, 0, TAU); ctx.fill();
      ctx.strokeStyle = colors.paper; ctx.lineWidth = 2; ctx.stroke();
      const d = 5.5 * ks;
      ctx.fillStyle = ON_ACCENT; ctx.beginPath();
      ctx.moveTo(X, Y - d); ctx.quadraticCurveTo(X, Y, X + d, Y); ctx.quadraticCurveTo(X, Y, X, Y + d);
      ctx.quadraticCurveTo(X, Y, X - d, Y); ctx.quadraticCurveTo(X, Y, X, Y - d); ctx.fill();
      if (hl.selected === item.id) { ctx.strokeStyle = colors.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 15 * ks, 0, TAU); ctx.stroke(); }
      else if (hover === item.id) { ctx.strokeStyle = rgba(colors.ink, 0.55); ctx.lineWidth = 1.25; ctx.beginPath(); ctx.arc(X, Y, 14 * ks, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    // 이름표: 중요한 것부터 놓고 겹치면 건너뛴다. 글자는 분야 색이 아닌 ink · charcoal
    function labelFor(item, p, r, alpha) {
      let priority;
      if (item.id === hl.selected) priority = 100;
      else if (item.id === hover) priority = 90;
      // 폴더를 골라 펼친 이미지 · 데이터(tuck)는 수십 개가 한꺼번에 이웃이 되므로, 크게 확대했을 때만 이름표를 단다
      else if (item.tuck) { if (zoom < 1.6 || p.v[2] <= 0.5) return null; priority = 30 + p.v[2]; }
      else if (hl.focus && hl.focus.has(item.id)) priority = 70 + p.v[2];
      else if (hl.focus) return null;
      // 모두 펼친 변형의 작은 항목(quiet): 크게 확대해 앞쪽에 있을 때만(그 밖에는 올리거나 고르면 보인다)
      else if (item.quiet) { if (zoom < 1.6 || p.v[2] <= 0.5) return null; priority = 10 + p.v[2]; }
      else if (hl.group && item.group === hl.group) priority = 55 + p.v[2];
      else if (item.orbit) priority = p.front ? 64 + p.v[2] : 0;
      else if (item.depth === 1) priority = 60 + p.v[2];
      else if (item.guide || item.live) priority = 50 + p.v[2];
      else if (item.folded) priority = 40 + p.v[2];
      else if (zoom >= 1.45 || p.v[2] > 0.62) priority = 10 + p.v[2];
      else return null;
      if (!priority || (hl.group && item.group !== hl.group && priority < 90)) return null;
      const alphaOut = priority >= 90 ? Math.max(alpha, 0.9) : alpha;
      if (p.align === 'left') return { item, x: p.s.x - r - 6, y: p.s.y, anchor: 'end', priority, alpha: alphaOut };
      if (p.align === 'top') return { item, x: p.s.x, y: p.s.y - r - 11, anchor: 'middle', priority, alpha: alphaOut };
      if (p.align === 'bottom') return { item, x: p.s.x, y: p.s.y + r + 12, anchor: 'middle', priority, alpha: alphaOut };
      return { item, x: p.s.x + r + 6, y: p.s.y, priority, alpha: alphaOut };
    }
    function drawLabels(list, fade) {
      list.sort((a, b) => b.priority - a.priority);
      const placed = [];
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const bodyFont = w => `${w} 12px Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif`;
      const monoFont = '500 11px "Geist Mono", ui-monospace, SFMono-Regular, monospace';
      // 글자가 놓일 수 있는 가로 범위(이름표 상자 여백 3px를 뺀 무대 안쪽)
      const minX = insets.left - 1, maxX = width - insets.right + 1;
      // 넘치는 이름표는 통째로 빼지 않고 '…'로 줄인다(좁은 화면 · 패널 옆에서 궤도 이름표가 사라지지 않게). ctx.font는 본문 글꼴이어야 한다
      const clip = (text, max) => {
        const chars = Array.from(text);
        let lo = 0, hi = chars.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(`${chars.slice(0, mid).join('')}…`).width <= max) lo = mid; else hi = mid - 1; }
        return lo >= 2 ? `${chars.slice(0, lo).join('')}…` : '';
      };
      for (const l of list) {
        const strong = l.priority >= 50;
        let text = l.item.label;
        const badge = l.item.folded && l.item.badge ? ` +${l.item.badge}` : '';
        ctx.font = bodyFont(strong ? 600 : 500);
        let tw = ctx.measureText(text).width;
        ctx.font = monoFont;
        const bw = badge ? ctx.measureText(badge).width : 0;
        const anchor = l.anchor || (l.center ? 'middle' : 'start');
        const room = anchor === 'middle' ? 2 * Math.min(l.x - minX, maxX - l.x) : anchor === 'end' ? l.x - minX : maxX - l.x;
        if (tw + bw > room && room - bw >= 36) {
          ctx.font = bodyFont(strong ? 600 : 500);
          const short = clip(text, room - bw);
          if (short) { text = short; tw = ctx.measureText(text).width; }
        }
        const w = tw + bw, h = 16;
        const x = anchor === 'middle' ? l.x - w / 2 : anchor === 'end' ? l.x - w : l.x, y = l.y;
        const box = { x: x - 3, y: y - h / 2 - 1, w: w + 6, h: h + 2 };
        const overlaps = placed.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
        if (l.priority < 90 && (overlaps || box.x < insets.left - 4 || box.x + box.w > width - insets.right + 4)) continue;
        placed.push(box);
        ctx.globalAlpha = clamp(l.alpha * fade, 0, 1);
        ctx.font = bodyFont(strong ? 600 : 500);
        ctx.strokeStyle = rgba(colors.paper, 0.92); ctx.lineWidth = 4;
        ctx.strokeText(text, x, y);
        ctx.fillStyle = strong ? colors.ink : colors.charcoal;
        ctx.fillText(text, x, y);
        if (badge) {
          ctx.font = monoFont;
          ctx.strokeText(badge, x + tw, y);
          ctx.fillStyle = colors.stone; ctx.fillText(badge, x + tw, y);
        }
      }
      ctx.globalAlpha = 1;
    }

    function hitTest(x, y) {
      let best = null;
      for (const h of hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d > h.r + 5) continue;
        // 가장 가까운 것을 고르고, 거의 같은 거리면 앞쪽(z가 큰) 것을 고른다
        if (!best || d < best.d - 2 || (Math.abs(d - best.d) <= 2 && h.z > best.z)) best = { ...h, d };
      }
      // 항목 도형 안을 눌렀으면 그 항목. 아니면 더 가까운 별자리 점이 있을 때 그 노드({ id, ghost } — 카드가 노드를 찾아 고른다)
      if (best && best.d <= best.r) return byId.get(best.id);
      let dot = null;
      for (const h of ghostHits) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d > h.r + 4) continue;
        if (!dot || d < dot.d - 1 || (Math.abs(d - dot.d) <= 1 && h.z > dot.z)) dot = { ...h, d };
      }
      if (dot && (!best || dot.d + 1.5 < best.d)) return byId.get(dot.id) || { id: dot.id, ghost: true };
      return best ? byId.get(best.id) : null;
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      const dt = prevFrame ? Math.min(0.05, (now - prevFrame) / 1000) : 0;
      prevFrame = now;
      let moving = !!(intro || outro || morph);
      if (tween) {
        const t = reducedMotion.matches ? 1 : clamp((now - tween.start) / tween.dur, 0, 1), e = easeInOut(t);
        yaw = lerp(tween.yaw0, tween.yaw1, e);
        pitch = lerp(tween.pitch0, tween.pitch1, e);
        if (tween.zoom1) zoom = lerp(tween.zoom0, tween.zoom1, e);
        if (t >= 1) tween = null;
        moving = true;
      } else if (!pointer && (Math.abs(vYaw) > 0.002 || Math.abs(vPitch) > 0.002)) {
        yaw += vYaw * dt; pitch = clamp(pitch + vPitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
        const decay = Math.exp(-dt * 4);
        vYaw *= decay; vPitch *= decay;
        moving = true;
      } else if (auto && !reducedMotion.matches && !pointer && !hover && !hl.selected && now - lastInput > 2500) {
        spinScale += (spinScaleTarget - spinScale) * Math.min(1, dt * 3); // 올렸을 때 빨라지는 속도는 뛰지 않고 서서히 바뀐다
        yaw += dt * spinRate * spinScale;
        moving = true;
      }
      if (vSpin) {
        // 휠로 더한 회전: 굴린 만큼 빨리 돌다가 서서히(반감 약 0.8초) 원래 속도로 돌아온다
        yaw += vSpin * dt; vSpin *= Math.exp(-dt * 0.9);
        if (Math.abs(vSpin) < 0.004) vSpin = 0;
        moving = true;
      }
      if (orbits.length && !reducedMotion.matches && !pointer && !hover && !hl.selected && !outro) {
        orbits.forEach((o, i) => { orbitPhase[i] = (orbitPhase[i] || 0) + o.speed * dt; });
        moving = true;
      }
      const tsTarget = terrainOn ? 1 : 0;
      if (Math.abs(tsBase - tsTarget) > 0.002) {
        tsBase = reducedMotion.matches ? tsTarget : tsBase + (tsTarget - tsBase) * (1 - Math.exp(-dt * 4));
        moving = true;
      }
      // 가운데 · 반지름은 목표로 서서히 옮긴다(패널이 열리고 닫힐 때 행성이 튀지 않게)
      const rTarget = baseRadius();
      if (Math.abs(cx - cxTarget) > 0.3 || Math.abs(cy - cyTarget) > 0.3 || Math.abs(rNow - rTarget) > 0.3) {
        const k = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 9);
        cx += (cxTarget - cx) * k; cy += (cyTarget - cy) * k; rNow += (rTarget - rNow) * k;
        moving = true;
      } else rNow = rTarget;
      const animating = born.size > 0 || items.some(i => i.live) || (!reducedMotion.matches && (items.some(i => i.core && i.primary) || (look.glow && !!hl.focus)));
      // 메인 화면 행성이 천천히 돌기만 할 때(휠 · 올림 변화 · 전환 없음)는 초당 30장만 그린다. 이 속도에서는 60장과 구별되지 않는다
      const idle = options.mode === 'button' && !dirty && !vSpin && !intro && !outro && Math.abs(spinScale - spinScaleTarget) < 0.01;
      if ((moving || dirty || animating) && !(idle && now - lastDraw < 30)) {
        draw(now);
        dirty = false; lastDraw = now;
        if (hooks.onFrame) hooks.onFrame();
      }
      if (outro && now - outro.t0 >= outro.ms) {
        const done = outro.done; outro = null; running = false;
        ctx.clearRect(0, 0, width, height);
        done();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true; prevFrame = 0; dirty = true;
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); raf = 0; }

    /* ── 입력 ── 메인 화면 행성(mode: button)은 캔버스가 입력을 받지 않는다(위에 덮인 버튼이 열기 · 휠 회전을 받는다) */
    if (options.mode !== 'button') bindInput();
    function bindInput() {
      const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0 || intro || outro) return;
        const p = local(e);
        pointer = { id: e.pointerId, x: p.x, y: p.y, yaw, pitch, drag: false, lx: p.x, ly: p.y, lt: performance.now() };
        vYaw = 0; vPitch = 0; lastInput = performance.now();
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', e => {
        const p = local(e);
        if (pointer) {
          // 좌우로 끌면 회전축(네트워크 구체는 토성 고리의 축)을 중심으로 돌고, 위아래로 끌면 기운다(고리가 열리고 닫힌다)
          const dx = p.x - pointer.x, dy = p.y - pointer.y;
          // 끌기 시작할 때만 진행 중인 회전을 멈춘다(누르기만 하면 앞으로 돌아오는 회전이 이어진다)
          if (!pointer.drag && Math.hypot(dx, dy) > 4) {
            pointer.drag = true; tween = null; pointer.yaw = yaw - dx * 0.0062 / zoom; pointer.pitch = pitch - dy * 0.0062 / zoom;
            canvas.classList.add('is-dragging'); setHover(null, p);
          }
          if (pointer.drag) {
            const speed = 0.0062 / zoom, now = performance.now(), dts = Math.max(1, now - pointer.lt) / 1000;
            yaw = pointer.yaw + dx * speed;
            pitch = clamp(pointer.pitch + dy * speed, -PITCH_LIMIT, PITCH_LIMIT);
            vYaw = vYaw * 0.5 + ((p.x - pointer.lx) * speed / dts) * 0.5;
            vPitch = vPitch * 0.5 + ((p.y - pointer.ly) * speed / dts) * 0.5;
            pointer.lx = p.x; pointer.ly = p.y; pointer.lt = now; lastInput = now;
            dirty = true;
          }
          return;
        }
        if (!intro && !outro) setHover(hitTest(p.x, p.y), p);
      });
      /* 누르기는 click(detail = 누른 횟수)으로 받는다. 끌기가 끝난 뒤의 click은 버린다.
         두 번 누르기: 첫 번째 누름으로 지구본이 돌기 시작해 항목이 움직이므로, 두 번째 누름은 선택을 바꾸지 않고
         dblclick에서 첫 번째 누름의 항목을 쓴다 */
      let lastClick = null, dragged = false;
      const release = e => {
        if (!pointer || pointer.id !== e.pointerId) return;
        dragged = pointer.drag;
        if (performance.now() - pointer.lt > 90) { vYaw = 0; vPitch = 0; }
        pointer = null; canvas.classList.remove('is-dragging'); lastInput = performance.now();
      };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
      canvas.addEventListener('pointerleave', () => { if (!pointer) setHover(null); });
      canvas.addEventListener('click', e => {
        if (dragged) { dragged = false; return; }
        if (e.detail > 1 || intro || outro) return;
        const p = local(e), item = hitTest(p.x, p.y);
        lastClick = item ? { id: item.id, t: performance.now() } : null;
        hooks.onClick(item);
      });
      canvas.addEventListener('dblclick', e => {
        const p = local(e);
        const item = lastClick && performance.now() - lastClick.t < 700 ? byId.get(lastClick.id) : hitTest(p.x, p.y);
        if (item) hooks.onDoubleClick(item);
      });
      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        setZoom(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      }, { passive: false });
      canvas.addEventListener('keydown', e => {
        const stepAngle = 0.16;
        if (e.key === 'ArrowLeft') nudge(-stepAngle, 0);
        else if (e.key === 'ArrowRight') nudge(stepAngle, 0);
        else if (e.key === 'ArrowUp') nudge(0, -stepAngle);
        else if (e.key === 'ArrowDown') nudge(0, stepAngle);
        else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
        else if (e.key === '-' || e.key === '_') setZoom(zoom / 1.2);
        else return;
        e.preventDefault();
      });
    }

    function nudge(dYaw, dPitch) {
      lastInput = performance.now();
      tween = { start: performance.now(), dur: 260, yaw0: yaw, pitch0: pitch, yaw1: yaw + dYaw, pitch1: clamp(pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT) };
    }
    function setHover(item, p) {
      const id = item ? item.id : null;
      canvas.classList.toggle('is-pointing', !!item);
      if (id === hover) return;
      hover = id; dirty = true;
      hooks.onHover(item, p);
    }
    function setZoom(z) { zoom = clamp(z, 0.7, 3.2); lastInput = performance.now(); dirty = true; }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (document.fonts) document.fonts.ready.then(() => { dirty = true; });
    const onMotion = () => { if (reducedMotion.matches) auto = false; dirty = true; };
    reducedMotion.addEventListener('change', onMotion);

    return {
      /* reveal: 처음 열 때처럼 항목이 깊이 순서로 차례로 돋아난다. 그 밖에는 새로 보이는 항목만 부모 자리에서 펼쳐진다 */
      setScene(scene, { reveal = false } = {}) {
        const now = performance.now(), prev = byId;
        items = scene.items; edges = scene.edges;
        byId = new Map(items.map(i => [i.id, i]));
        const prevPhase = new Map(orbits.map((o, i) => [o.id, orbitPhase[i]]));
        // 궤도면: 수평에서 tilt만큼 앞으로 숙여(위에서 내려다본 타원) 화면에서 bank만큼 기울인다.
        // space: 'model'은 그래프의 적도면(법선 = y)에 놓인 고리 — 그리기 때 지구본과 함께 돌린다. 무대에 맞출 크기는 처음 시점(home)에서 본 크기
        orbits = (scene.orbits || []).map(o => {
          if (o.space === 'model') {
            const u = [1, 0, 0], v = [0, 0, 1];
            let extentX = 0, extentY = 0;
            for (let i = 0; i < 64; i++) {
              const a = (TAU * i) / 64, p = rotate([Math.cos(a) * o.radius, 0, Math.sin(a) * o.radius], home.yaw, home.pitch);
              extentX = Math.max(extentX, Math.abs(p[0])); extentY = Math.max(extentY, Math.abs(p[1]));
            }
            return { arcStart: 0, arcEnd: TAU, labelAt: 0, ...o, u, v, extentX, extentY };
          }
          const tilt = o.tilt ?? Math.PI / 2, bank = o.bank || 0;
          const n = [-Math.sin(bank) * Math.cos(tilt), Math.cos(bank) * Math.cos(tilt), Math.sin(tilt)];
          const u = Math.abs(n[2]) > 0.999 ? [1, 0, 0] : norm(cross(n, [0, 0, 1])), v = cross(n, u);
          let extentX = 0, extentY = 0;
          for (let i = 0; i < 64; i++) {
            const a = (TAU * i) / 64, c = Math.cos(a) * o.radius, sn = Math.sin(a) * o.radius;
            extentX = Math.max(extentX, Math.abs(u[0] * c + v[0] * sn)); extentY = Math.max(extentY, Math.abs(u[1] * c + v[1] * sn));
          }
          return { arcStart: 0, arcEnd: TAU, labelAt: 0, ...o, u, v, extentX, extentY };
        });
        orbitPhase = orbits.map(o => prevPhase.get(o.id) ?? o.phase ?? 0);
        centerTarget();
        for (const id of [...born.keys()]) if (!byId.has(id)) born.delete(id);
        // 네트워크 구체의 위성은 메인 화면 구체에도 있으므로 돋아나지 않고 처음부터 보인다(물들기로 점 → 아이콘)
        if (reveal) for (const i of items) { if (!(i.orbit && look.volume)) born.set(i.id, now + (i.delay || 0)); }
        else if (prev.size) for (const i of items) if (!prev.has(i.id)) born.set(i.id, now);
        if (hover && !byId.has(hover)) hover = null;
        dirty = true;
      },
      setHighlight(next) { hl = { ...hl, ...next }; dirty = true; },
      setTerrain(next) { terrain = next; prepSurface(); dirty = true; },
      // 별자리(네트워크 구체): { nodes: [{ id, pos(3차원 자리), color, group, file }], edges: [{ a, b(nodes 번호), kind, color }] } 또는 null.
      // id가 있는 점은 누르고 올릴 수 있다(hooks에 { id, ghost: true }가 온다)
      setGhost(next) {
        ghost = next;
        // 물들기 순서: 점은 가운데(반지름 0)부터 바깥으로, 선은 출발점(a)이 가운데에 가까운 것부터(약간 흩뜨림)
        const len = p => Math.min(1, Math.hypot(p[0], p[1], p[2]));
        gNodeDelay = ghost ? Float32Array.from(ghost.nodes, n => 0.38 * len(n.pos)) : null;
        gEdgeDelay = ghost ? Float32Array.from(ghost.edges, e => Math.min(0.55, 0.42 * len(ghost.nodes[e.a].pos) + 0.12 * hash(`${e.a}>${e.b}`))) : null;
        // 휘는 쪽 · 양: 항목 선(edgeBend)과 같은 열쇠(양끝 id)로 정한다. id가 없는 점이면 번호로
        gBend = ghost ? Float32Array.from(ghost.edges, e => bendScale * bendOf(`${ghost.nodes[e.a].id ?? e.a}>${ghost.nodes[e.b].id ?? e.b}`)) : null;
        dirty = true;
      },
      setTerrainVisible(on) { terrainOn = on; dirty = true; },
      setEdges(next) { show = { ...show, ...next }; dirty = true; },
      setInsets(next) { insets = { ...insets, ...next }; centerTarget(); dirty = true; },
      // 메인 화면 구체 자리와 열린 지구본 반지름(캔버스 좌표 { x, y, r } 또는 null). 열 때 행성이 그 자리에서 r까지 커진다(centerTarget)
      setAnchor(p) { anchor = p; centerTarget(); dirty = true; },
      setAutoRotate(on) { auto = on; lastInput = 0; dirty = true; },
      getAutoRotate: () => auto,
      zoomBy(f) { setZoom(zoom * f); },
      resetView() { lastInput = performance.now(); tween = { start: performance.now(), dur: 700, yaw0: yaw, pitch0: pitch, yaw1: home.yaw, pitch1: home.pitch, zoom0: zoom, zoom1: 1 }; },
      /* 고른 항목이 앞으로 오도록 돌린다. 정면 한가운데는 핵(AGENTS.md) 자리라 그 바로 위(FOCUS_AT)에 오게 한다.
         yaw로 화면 x를, pitch로 화면 y를 맞춘다(구면에서 두 번의 회전으로 풀리는 닫힌 식). 핵(dir 없음)은 회전하지 않는다 */
      focusOn(id) {
        const item = byId.get(id);
        if (!item || !item.dir) return; // 핵 · 궤도 위성은 돌리지 않는다(위성은 화면 기준 궤도에 있다)
        const d = item.dir, rho = Math.hypot(d[0], d[2]);
        // 네트워크 구체는 돌린 뒤 화면에서 roll하므로, roll하기 전 자리로 되돌린 목표를 푼다(화면에서는 FOCUS_AT에 선다)
        const fa = roll ? [FOCUS_AT[0] * rollC + FOCUS_AT[1] * rollS, -FOCUS_AT[0] * rollS + FOCUS_AT[1] * rollC] : FOCUS_AT;
        let yaw1, pitch1;
        if (rho < 0.08) { // 극 근처: 위아래로만 돌린다
          yaw1 = yaw; pitch1 = clamp(Math.sign(d[1]) * (Math.PI / 2) - Math.asin(fa[1]), -PITCH_LIMIT, PITCH_LIMIT);
        } else {
          const alpha = Math.atan2(d[0], d[2]);
          yaw1 = Math.asin(clamp(fa[0] / rho, -0.95, 0.95)) - alpha;
          const z1 = -d[0] * Math.sin(yaw1) + d[2] * Math.cos(yaw1);
          const sigma = Math.hypot(d[1], z1) || 1, beta = Math.atan2(z1, d[1]);
          pitch1 = clamp(Math.acos(clamp(fa[1] / sigma, -1, 1)) - beta, -PITCH_LIMIT, PITCH_LIMIT);
        }
        if (!Number.isFinite(yaw1) || !Number.isFinite(pitch1)) return;
        yaw1 = yaw + ((((yaw1 - yaw) % TAU) + TAU + Math.PI) % TAU - Math.PI);
        tween = { start: performance.now(), dur: 760, yaw0: yaw, pitch0: pitch, yaw1, pitch1 };
        vYaw = 0; vPitch = 0;
      },
      /* 메인 화면 구체(from: 캔버스 좌표의 원 { cx, cy, r })에서 커지며 나타난다.
         from.solid(메인 화면 행성)면 그 행성이 돌아간 각도(yaw · pitch) 그대로 커지고, 아니면(v2 점 구체) 처음 시점에서 산이 솟는다 */
      intro(from) {
        resize();
        const solid = !!(from && from.solid);
        yaw = solid ? from.yaw : home.yaw; pitch = solid ? from.pitch : home.pitch;
        // 고리 위 위성 자리도 메인 화면 구체에서 이어받는다(같은 궤도 순서)
        if (solid && from.phases && from.phases.length === orbitPhase.length) orbitPhase = from.phases.slice();
        zoom = 1; tween = null; vYaw = 0; vPitch = 0; vSpin = 0; lastInput = 0;
        cx = cxTarget; cy = cyTarget; rNow = baseRadius();
        intro = reducedMotion.matches || !from ? null : { t0: performance.now(), from };
        // 네트워크 구체를 메인 화면 구체에서 열면 주황 → 분야 색으로 물들며 엣지가 이어진다(동작 줄이기에서는 바로 열린 모습)
        morph = solid && look.volume && !reducedMotion.matches ? { t0: performance.now(), ms: MORPH_MS, dir: 1 } : null;
        outro = null;
        start();
        // 첫 장면은 바로 그린다(메인 화면 행성이 숨는 그 프레임에 같은 자리 · 같은 모습으로 이어지게)
        if (width) { draw(performance.now()); dirty = false; }
      },
      /* 닫기. to(캔버스 좌표의 원 { cx, cy, r, pitch })가 있으면 메인 화면 행성 자리로 줄어들고, 없으면 흩어지며 사라진다. 끝나면 done.
         줄어들 때는 메인 화면 행성과 같은 기울기로 바로잡고, 돌아간 각도(yaw)는 그대로 넘겨준다(view) */
      outro(done, to) {
        if (reducedMotion.matches || !running) { stop(); done(); return; }
        intro = null; hover = null; vSpin = 0;
        outro = { t0: performance.now(), done, to: to || null, ms: to ? SHRINK_MS : OUTRO_MS };
        if (to) tween = { start: performance.now(), dur: SHRINK_MS, yaw0: yaw, pitch0: pitch, yaw1: yaw, pitch1: to.pitch ?? home.pitch };
        // 메인 화면 구체로 줄어들 때: 다시 주황으로, 엣지는 걷힌다(줄어드는 앞부분에 끝난다)
        if (to && look.volume) { const from = morphAt(performance.now()); morph = { t0: performance.now() - (1 - from) * UNMORPH_MS, ms: UNMORPH_MS, dir: -1 }; }
      },
      start, stop,
      // 무대(box: { width, height, insets }) 안에서 (x, y)를 가운데로 둘 때 들어가는 열린 지구본 반지름(지금 궤도 기준).
      // 열린 카드가 닫혀 있어도 잰 무대로 셀 수 있어, 메인 화면 행성 크기(이 값의 70%)를 정하는 데 쓴다(brain-globe.js openRadiusAt)
      fitFor(box, x, y) { return fitIn(box, x, y, orbitExtent()); },
      // 지금 가려는 자리(캔버스 좌표): 가운데 · 반지름 · 궤도 바깥 끝(구 반지름 배수). 모바일 서랍 자리를 정하는 데 쓴다
      target() { return { cx: cxTarget, cy: cyTarget, r: baseRadius(), ring: orbitExtent().y }; },
      // 지금 모습(캔버스 좌표). 메인 화면 행성 ↔ 크게 연 지구본을 같은 자리 · 크기 · 각도로 잇는 데 쓴다.
      // 멈춰 있을 때(세컨드 브레인이 열려 메인 화면 행성이 숨은 동안)는 목표 자리를 준다 — 그 사이 창 크기가 바뀌어도 새 자리로 잇는다
      view: () => (running ? { cx, cy, r: (rNow || baseRadius()) * zoom, yaw, pitch, phases: orbitPhase.slice() }
        : { cx: cxTarget, cy: cyTarget, r: baseRadius() * zoom, yaw, pitch, phases: orbitPhase.slice() }),
      setView(v) {
        yaw = v.yaw; pitch = clamp(v.pitch, -PITCH_LIMIT, PITCH_LIMIT); tween = null; vYaw = 0; vPitch = 0;
        if (v.phases && v.phases.length === orbitPhase.length) orbitPhase = v.phases.slice();
        dirty = true;
      },
      // 숨겨 둔 뒤 다시 보일 때 그 자리에 바로 그린다(멈춰 있던 사이 목표 자리가 바뀌었으면 그 자리로)
      redraw() { if (!width) return; if (!running) { cx = cxTarget; cy = cyTarget; rNow = baseRadius(); } draw(performance.now()); dirty = false; },
      // 휠 회전: 굴린 만큼 회전 속도를 더한다(동작 줄이기에서는 돌지 않는다). setSpinScale: 올렸을 때 자동 회전 배율
      spinBy(dv) { if (!reducedMotion.matches) { vSpin = clamp(vSpin + dv, -SPIN_MAX, SPIN_MAX); dirty = true; } },
      setSpinScale(k) { spinScaleTarget = k; },
      screenOf(id) {
        const h = hits.find(x => x.id === id) || ghostHits.find(x => x.id === id);
        return h ? { x: h.x, y: h.y, r: h.r } : null;
      },
      refreshColors() { colors = readColors(); look = lookNow(); dirty = true; },
      // 앱: 화면에서 내려갈 때 그리기 · 감시를 모두 멈춘다
      destroy() { stop(); observer.disconnect(); reducedMotion.removeEventListener('change', onMotion); },
      appearDelay: APPEAR_MS
    };
  }

export { layout, volumeLayout, neuralLayout, buildTerrain, createGlobe };
