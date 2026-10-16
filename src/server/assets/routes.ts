import type { StartupService } from '../startup.js';
import type { FastifyInstance } from 'fastify';
import { AssetError, AssetService } from './catalog.js';

export async function assetRoutes(app: FastifyInstance, options: { service: AssetService; startup?: StartupService }) {
  const hosts = new Set(['127.0.0.1:5173', '127.0.0.1:8000']);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
      || (request.headers.origin !== undefined && !hosts.has(request.headers.origin.replace(/^http:\/\//, '')))) throw new AssetError('FORBIDDEN');
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof AssetError ? error : new AssetError('ROOT_UNAVAILABLE');
    reply.code(['FORBIDDEN', 'PATH_DENIED'].includes(known.code) ? 403 : known.code === 'NOT_FOUND' ? 404
      : ['NOT_CONFIGURED', 'CONFIG_CHANGED'].includes(known.code) ? 409 : 503)
      .send({ error: known.code, message: known.message });
  });
  app.get<{ Querystring: { refresh?: string } }>('/catalog', request => options.startup ? options.startup.read('assets', request.query.refresh === '1') : options.service.catalog());
  app.get<{ Params: { id: string; key: string } }>('/:id/files/:key', async (request, reply) => {
    const file = await options.service.file(request.params.id, request.params.key);
    return reply.header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .type(file.mime).send(file.bytes);
  });
}
