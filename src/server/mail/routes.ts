import type { StartupService } from '../startup.js';
import type { FastifyInstance } from 'fastify';
import { MailService } from './service.js';
import { MailError } from './errors.js';
import { parseConnection } from './validation.js';

export async function mailRoutes(app: FastifyInstance, options: { service: MailService; startup?: StartupService }) {
  const service = options.service;
  const origins = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:8000']);
  const hosts = new Set(['127.0.0.1:5173', '127.0.0.1:8000']);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
      || (request.headers.origin !== undefined && !origins.has(request.headers.origin))) throw new MailError('FORBIDDEN');
  });
  app.setErrorHandler((error, _request, reply) => {
    const httpStatus = (error as { statusCode?: number }).statusCode;
    const known = error instanceof MailError ? error
      : new MailError(httpStatus === 400 || httpStatus === 413 ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
    const code = known.code;
    const status = code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400
      : code === 'NOT_CONFIGURED' || code === 'CONFIG_CHANGED' ? 409
      : code === 'TIMEOUT' ? 504 : code === 'KEYCHAIN_FAILED' || code === 'STORAGE_FAILED' ? 503 : 502;
    reply.code(status).send({ error: code, message: known.message });
  });
  app.addHook('onClose', async () => service.close());
  app.get('/settings', () => service.settings());
  app.post('/test', { bodyLimit: 8192 }, request => service.test(parseConnection(request.body)));
  app.put('/settings', { bodyLimit: 8192 }, request => service.save(parseConnection(request.body)));
  app.delete('/settings', async () => { await service.disconnect(); return { ok: true }; });
  app.get<{ Querystring: { refresh?: string } }>('/messages', request => options.startup ? options.startup.read('mail', request.query.refresh === '1') : service.messages());
}
