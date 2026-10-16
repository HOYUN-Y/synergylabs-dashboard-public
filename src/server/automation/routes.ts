import type { StartupService } from '../startup.js';
import type { FastifyInstance } from 'fastify';
import { AutomationError } from './errors.js';
import type { AutomationService } from './service.js';

export async function automationRoutes(app: FastifyInstance, options: { service: AutomationService; startup?: StartupService }) {
  const service = options.service;
  const hosts = new Set(['127.0.0.1:5173', '127.0.0.1:8000']);
  const origins = new Set([...hosts].map(host => `http://${host}`));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
      || (request.headers.origin !== undefined && !origins.has(request.headers.origin))) throw new AutomationError('FORBIDDEN');
  });
  app.addHook('onClose', () => service.close());
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    const known = error instanceof AutomationError ? error : new AutomationError(status === 400 || status === 413 ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
    reply.code(known.code === 'FORBIDDEN' || known.code === 'PATH_DENIED' ? 403 : known.code === 'INVALID_INPUT' ? 400
      : known.code === 'NOT_FOUND' ? 404 : ['BUSY', 'NOT_READY', 'NOT_CONFIGURED', 'STALE_TURN', 'CONVERSATION_UNAVAILABLE'].includes(known.code) ? 409 : 500)
      .send({ error: known.code, message: known.message });
  });
  app.get('/settings', () => service.settings());
  app.put('/settings', { bodyLimit: 8192 }, request => { const body = request.body as { workspace?: unknown; outputDirectory?: unknown } | null; return service.saveSettings(body?.workspace, body?.outputDirectory); });
  app.get('/execution-options', () => service.executionOptions());
  app.get<{ Querystring: { cursor?: string } }>('/notifications', request => {
    const { cursor } = request.query;
    if (cursor !== undefined && !/^[a-f0-9-]{36}$/.test(cursor)) throw new AutomationError('INVALID_INPUT');
    return service.notifications(cursor);
  });
  app.post<{ Params: { id: string } }>('/notifications/:id/read', request => service.readNotification(request.params.id));
  app.post<{ Params: { id: string } }>('/runs/:id/output/retry', request => service.retryOutput(request.params.id));
  app.get<{ Querystring: { refresh?: string } }>('/catalog', request => options.startup ? options.startup.read('automation', request.query.refresh === '1') : service.catalog());
  app.get<{ Params: { id: string } }>('/skills/:id/settings', request => service.skillSettings(request.params.id));
  app.put<{ Params: { id: string } }>('/skills/:id/settings', { bodyLimit: 65536 }, request =>
    service.saveSkillSettings(request.params.id, (request.body as { input?: unknown } | null)?.input, (request.body as { execution?: unknown } | null)?.execution));
  app.get<{ Querystring: { targetId?: string; latestPerTarget?: string } }>('/runs', request => {
    const { targetId, latestPerTarget } = request.query;
    if ((targetId !== undefined && !/^[a-f0-9]{24}$/.test(targetId))
      || (latestPerTarget !== undefined && latestPerTarget !== 'true')) throw new AutomationError('INVALID_INPUT');
    return service.history(targetId, latestPerTarget === 'true');
  });
  app.post('/runs', { bodyLimit: 65536 }, async (request, reply) => {
    const body = request.body as { targetId?: unknown; input?: unknown; useSavedInput?: unknown } | null;
    if (body?.useSavedInput !== undefined && typeof body.useSavedInput !== 'boolean') throw new AutomationError('INVALID_INPUT');
    const run = await service.start(body?.targetId, body?.input ?? '', body?.useSavedInput === true);
    return reply.code(202).send(run);
  });
  app.get<{ Params: { id: string } }>('/conversations/:id', request => service.conversation(request.params.id));
  app.post<{ Params: { id: string } }>('/conversations/:id/messages', { bodyLimit: 65536 }, async (request, reply) => {
    const body = request.body as { input?: unknown; baseRunId?: unknown; requestId?: unknown } | null;
    const run = await service.reply(request.params.id, body?.input, body?.baseRunId, body?.requestId);
    return reply.code(202).send(run);
  });
  app.get<{ Params: { id: string } }>('/runs/:id', request => service.get(request.params.id));
  app.post<{ Params: { id: string } }>('/runs/:id/cancel', request => service.cancel(request.params.id));
  app.get<{ Params: { id: string; name: string } }>('/runs/:id/artifacts/:name', async (request, reply) => {
    const bytes = await service.artifact(request.params.id, request.params.name);
    return reply.header('Content-Disposition', `attachment; filename="${request.params.name}"`)
      .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; sandbox")
      .type('application/octet-stream').send(bytes);
  });
}
