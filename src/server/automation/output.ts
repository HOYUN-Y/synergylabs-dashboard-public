import { defaultOutput } from '../workspace-paths.js';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedFile, inside } from './catalog.js';
import type { AutomationStore, StoredRun } from './store.js';
import type { AutomationRun } from '../../shared/automation.js';

export async function exportArtifacts(run: StoredRun, store: AutomationStore): Promise<NonNullable<AutomationRun['output']>> {
  const directory = join(run.outputRoot!, run.targetId, run.conversationId ?? run.id, `turn-${run.turn ?? 1}`);
  let temporary: string | undefined;
  try {
    if (!/^[a-f0-9]{24}$/.test(run.targetId) || !/^[a-f0-9-]{36}$/.test(run.conversationId ?? run.id)) throw new Error();
    if (run.outputRoot === defaultOutput) await mkdir(run.outputRoot, { recursive: true, mode: 0o700 });
    const root = await realpath(run.outputRoot!);
    if (root !== run.outputRoot) throw new Error();
    let parent = root;
    for (const segment of [run.targetId, run.conversationId ?? run.id]) {
      parent = join(parent, segment);
      try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      if (!(await lstat(parent)).isDirectory() || (await realpath(parent)) !== parent) throw new Error();
    }
    if (!inside(root, await realpath(parent))) throw new Error();
    const source = await realpath(run.artifactDirectory!);
    if (!inside(await realpath(store.runDirectory(run.id)), source)) throw new Error();
    const files = await Promise.all(run.artifacts.map(async name => ({ name, bytes: await readFile(await checkedFile(source, join(source, name), 10 * 1024 * 1024)) })));
    const existing = await realpath(directory).catch(() => null);
    if (existing) {
      if (!inside(root, existing)) throw new Error();
      for (const file of files) if (!(await readFile(await checkedFile(existing, join(existing, file.name), 10 * 1024 * 1024))).equals(file.bytes)) throw new Error();
    } else {
      temporary = join(parent, `.export-${randomUUID()}`);
      await mkdir(temporary, { mode: 0o700 });
      for (const file of files) await writeFile(join(temporary, file.name), file.bytes, { mode: 0o600, flag: 'wx' });
      await rename(temporary, directory);
    }
    return { status: 'saved', directory, message: '결과 파일을 저장했습니다.' };
  } catch {
    return { status: 'failed', directory, message: '결과는 앱에 보관했습니다. 저장 폴더의 연결·권한·동명 파일을 확인한 뒤 저장만 다시 시도하세요.' };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
