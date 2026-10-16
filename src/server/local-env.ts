import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { sourceRoot } from './workspace-paths.js';

// 로컬 환경 파일 · 인증 JSON은 저장소의 env/ 폴더(Git 제외)에 둔다.
export const envDirectory = join(sourceRoot, 'env');

/** 저장소 루트 .env.local(예전 위치) → env/.env.local 순서로 읽는다. 이미 설정된 값(셸 · 앞의 파일)이 우선하고 없는 파일은 건너뛴다. */
export function loadLocalEnv(root = sourceRoot) {
  for (const file of [join(root, '.env.local'), join(root, 'env', '.env.local')]) {
    try { loadEnvFile(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
