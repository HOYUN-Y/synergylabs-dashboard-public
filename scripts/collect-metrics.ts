import { MetricsCollection } from '../src/server/metrics/collection.js';
import { CollectionError } from '../src/server/metrics/collection-store.js';
import { METRIC_SERVICES } from '../src/shared/metrics-collection.js';
import { loadLocalEnv } from '../src/server/local-env.js';
loadLocalEnv();
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--scheduled')) {
  console.error('사용법: npm run collect:metrics [-- --scheduled]'); process.exitCode = 1;
} else {
  try {
    const service = new MetricsCollection();
    if (args.length) {
      const results = await service.scheduled();
      console.info(results.length ? JSON.stringify(results.map(({ service, status, errorCode, snapshotSaved }) => ({ service, status, errorCode, snapshotSaved }))) : '예정된 수집이 없거나 이미 완료했습니다.');
      if (results.some(r => r.status !== 'succeeded')) process.exitCode = 1;
    } else {
      for (const target of METRIC_SERVICES) {
        try {
          const result = await (await service.start(target)).done;
          console.info(`${target}: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}`);
          if (result.status !== 'succeeded') process.exitCode = 1;
        } catch (e) { console.error(`${target}: ${e instanceof CollectionError ? e.code : 'EXECUTION_FAILED'}`); process.exitCode = 1; }
      }
    }
  } catch { console.error('수집 상태 저장소를 확인해 주세요.'); process.exitCode = 1; }
}
