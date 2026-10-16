import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// src/server와 dist/server 모두 저장소 아래 두 단계에 있다. cwd에 의존하지 않는다.
export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultWorkspace = dirname(sourceRoot.replace(/\/$/, ''));
export const defaultOutput = join(defaultWorkspace, 'output');
