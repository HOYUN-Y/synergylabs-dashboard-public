import type { FastifyInstance } from 'fastify';
import type { BrainGraphService } from './graph.js';
import { BrainError } from './files.js';

/** Registered inside the existing protected /api scope in app.ts. */
export async function brainGraphRoutes(app: FastifyInstance, { service }: { service: BrainGraphService }) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof BrainError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EACCES' || code === 'ELOOP') return reply.code(404).send({ error: 'NOT_FOUND', message: '자료를 읽을 수 없습니다. 다시 스캔하거나 접근 권한을 확인해 주세요.' });
    if ((error as { statusCode?: number }).statusCode === 400) return reply.code(400).send({ error: 'INVALID_INPUT', message: '요청 형식을 확인해 주세요.' });
    return reply.code(503).send({ error: 'ROOT_UNAVAILABLE', message: '작업 공간을 읽지 못했습니다. 경로와 접근 권한을 확인해 주세요.' });
  });
  const idSchema = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^[a-f0-9]{24}$' } } };
  app.get<{ Querystring: { refresh?: string; all?: string } }>('/api/brain/graph', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { refresh: { type: 'string', enum: ['1'] }, all: { type: 'string', enum: ['1'] } } } }
  }, request => service.graph(request.query.refresh === '1', request.query.all === '1'));
  app.get<{ Querystring: { id: string } }>('/api/brain/expand', { schema: { querystring: idSchema } }, request => service.expand(request.query.id));
  app.get<{ Querystring: { q: string; scope?: 'quick' | 'body' } }>('/api/brain/search', { schema: { querystring: {
    type: 'object', required: ['q'], additionalProperties: false, properties: { q: { type: 'string', maxLength: 200 }, scope: { type: 'string', enum: ['quick', 'body'] } }
  } } }, async (request, reply) => {
    const disconnected = new AbortController(), timeout = AbortSignal.timeout(25000);
    const abort = () => disconnected.abort();
    reply.raw.once('close', abort);
    try { return await service.search(request.query.q, request.query.scope, AbortSignal.any([disconnected.signal, timeout])); }
    catch (error) {
      if (timeout.aborted) throw new BrainError('SEARCH_TIMEOUT', 503, '본문 검색 시간이 초과되었습니다. 빠른 검색 결과는 계속 사용할 수 있습니다.');
      throw error;
    } finally { reply.raw.removeListener('close', abort); }
  });
  app.get<{ Querystring: { id: string } }>('/api/brain/preview', { schema: { querystring: idSchema } }, request => service.preview(request.query.id));
  app.post<{ Body: { id: string } }>('/api/brain/reveal', { bodyLimit: 1024, schema: { body: idSchema } }, request => service.reveal(request.body.id));
}
