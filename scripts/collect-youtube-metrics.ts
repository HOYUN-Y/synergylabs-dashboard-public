import { MetricsCollection } from '../src/server/metrics/collection.js';
import { CollectionError } from '../src/server/metrics/collection-store.js';
import { YouTubeMetricsReader } from '../src/server/metrics/youtube-reader.js';
import { loadLocalEnv } from '../src/server/local-env.js';
loadLocalEnv();

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--output-dir' || !args[1]) {
  console.error('사용법: npm run collect:youtube -- --output-dir "절대 저장 경로"');
  process.exitCode = 1;
} else {
  try {
    const result = await (await new MetricsCollection().start('youtube', 'manual', args[1])).done;
    if (result.snapshotSaved) {
      const { current } = await new YouTubeMetricsReader(args[1]).summary();
      console.info(`${current.uploadYear}년 공개 롱폼 ${current.videos.length}편 / 조회수 ${current.totalViews}회 / 좋아요 ${current.totalLikes}개`);
      console.info(`30초 부근 유지율: ${current.analytics?.averageAudienceWatchRatio == null ? '데이터 없음' : `${(current.analytics.averageAudienceWatchRatio * 100).toFixed(1)}%`} / 평균 포함 ${current.analytics?.availableVideos ?? 0}편`);
    }
    console.info(`수집 상태: ${result.status}${result.errorCode ? ` (${result.errorCode})` : ''}`);
    if (result.status !== 'succeeded' && result.errorCode !== 'NOT_CONNECTED') process.exitCode = 1;
  } catch (error) {
    console.error(`수집 실패: ${error instanceof CollectionError ? error.code : 'EXECUTION_FAILED'}. 기존 결과는 유지됩니다.`);
    process.exitCode = 1;
  }
}
