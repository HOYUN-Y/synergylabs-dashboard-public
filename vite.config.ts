import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 참고 시안의 HTML/import map까지 검사하면 앱 의존성 사전 처리가 실패한다.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000' }
  },
  build: { outDir: 'dist/client' }
});
