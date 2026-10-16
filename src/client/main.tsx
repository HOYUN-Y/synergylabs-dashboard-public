import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// 화면 스타일은 dashboard-v2 시안의 CSS를 옮긴 design/ 묶음에 지구본 시안(docs/design/second-brain-globe-20261014)의 다크 토큰을 얹는다.
// 육각형 시안의 hex-ui.css는 사용자 결정으로 뺐다(2026-10-15).
// 이전 화면의 styles.css · dashboard-v2.css는 사용자 결정으로 파일만 남기고 불러오지 않는다(2026-10-15).
import './design-tokens.css';
import './design/base.css';
import './design/dashboard.css';
import './design/popups.css';
import './design/assets.css';
import './design/brain.css';
import './design/dark.css';
import './design/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
);
