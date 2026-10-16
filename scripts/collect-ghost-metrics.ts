import { MetricsCollection } from '../src/server/metrics/collection.js';
import { CollectionError } from '../src/server/metrics/collection-store.js';
import { GhostMetricsReader } from '../src/server/metrics/reader.js';
import { loadLocalEnv } from '../src/server/local-env.js';
loadLocalEnv();

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output-dir' || !args[1]) {
  console.error('사용법: npm run collect:ghost -- --output-dir "절대 저장 경로"');
  process.exitCode = 1;
} else {
  try {
    const result = await (await new MetricsCollection().start('ghost', 'manual', args[1])).done;
    if (result.snapshotSaved) {
      const { current } = await new GhostMetricsReader(args[1]).summary();
      console.info(`구독 중인 회원: ${current.subscribedMembers}명 / 기준일: ${current.metricDate}`);
    }
    console.info(`수집 상태: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}`);
    if (result.status !== 'succeeded') process.exitCode = 1;
  } catch (error) {
    console.error(`수집 실패: ${error instanceof CollectionError ? error.code : 'EXECUTION_FAILED'}. 기존 결과는 유지됩니다.`);
    process.exitCode = 1;
  }
}
