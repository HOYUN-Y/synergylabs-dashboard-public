import type { FastifyInstance } from 'fastify';
import { GhostMetricsReader, MetricsError } from './reader.js';
import { YouTubeMetricsReader } from './youtube-reader.js';
import { MetricsCollection } from './collection.js';
import { CollectionError } from './collection-store.js';
import { isMetricService } from '../../shared/metrics-collection.js';

export async function metricsRoutes(app: FastifyInstance, options: { reader: GhostMetricsReader; youtubeReader?: YouTubeMetricsReader; collection?: MetricsCollection }) {
  const collection = options.collection ?? new MetricsCollection();
  const youtubeReader = options.youtubeReader ?? new YouTubeMetricsReader();
  const hosts = new Set(['127.0.0.1:5173', '127.0.0.1:8000']);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
      || (request.headers.origin !== undefined && !hosts.has(request.headers.origin.replace(/^http:\/\//, '')))) throw new MetricsError('FORBIDDEN');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CollectionError) {
      const labels: Record<string, string> = { BUSY: '이미 수집 중입니다.', NOT_CONFIGURED: '수집 담당 Mac의 API·저장 경로 설정이 필요합니다.', INVALID_INPUT: '수집 대상을 확인해 주세요.', STORAGE_FAILED: '수집 상태를 읽거나 저장하지 못했습니다.' };
      reply.code(error.code === 'BUSY' || error.code === 'NOT_CONFIGURED' ? 409 : error.code === 'INVALID_INPUT' ? 400 : 503)
        .send({ error: error.code, message: labels[error.code] ?? '수집 실행을 시작하지 못했습니다.' }); return;
    }
    const known = error instanceof MetricsError ? error : new MetricsError('STORAGE_FAILED');
    reply.code(known.code === 'FORBIDDEN' ? 403 : known.code === 'NOT_CONFIGURED' ? 409 : known.code === 'NO_DATA' ? 404 : 503)
      .send({ error: known.code, message: known.message });
  });
  app.get('/collection', () => collection.status());
  app.post<{ Params: { service: string } }>('/:service/collect', { bodyLimit: 1024 }, async (request, reply) => {
    if (!isMetricService(request.params.service) || request.body !== undefined) throw new CollectionError('INVALID_INPUT');
    const run = await collection.start(request.params.service);
    return reply.code(202).send({ id: run.id });
  });
  app.get('/ghost', () => options.reader.summary());
  app.get('/youtube', () => youtubeReader.summary());
}
