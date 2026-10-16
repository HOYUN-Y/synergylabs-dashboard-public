import { BrainGraphService } from './brain/graph.js';
import { brainGraphRoutes } from './brain/routes.js';
import { BrainService } from './brain.js';
import { StartupService } from './startup.js';
import { clearWorkspaceScan } from './workspace-scan.js';
import { todayKst } from '../shared/calendar.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '../shared/api.js';
import { mailRoutes } from './mail/routes.js';
import { MailService } from './mail/service.js';
import { CalendarService } from './calendar/service.js';
import { calendarRoutes } from './calendar/routes.js';
import { AutomationService } from './automation/service.js';
import { automationRoutes } from './automation/routes.js';
import { AssetService } from './assets/catalog.js';
import { assetRoutes } from './assets/routes.js';
import { GhostMetricsReader } from './metrics/reader.js';
import { metricsRoutes } from './metrics/routes.js';

export function buildApp(staticRoot?: string, mail = new MailService(), calendar = new CalendarService(), automation = new AutomationService()) {
  const assets = new AssetService(async () => (await automation.settings()).workspace, async () => (await automation.settings()).outputDirectory);
  const brain = new BrainService(() => automation.settings());
  const graph = new BrainGraphService(() => automation.settings());
  const startup = new StartupService({ automation: () => automation.catalog(), assets: () => assets.catalog(), brain: () => brain.catalog(),
    mail: () => mail.messages(), calendar: () => calendar.month(todayKst().slice(0, 7)) });
  calendar.onConfigurationChange = () => startup.invalidate(['calendar']);
  const app = Object.assign(Fastify(), { startup });
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 400 || !['PUT', 'DELETE'].includes(request.method)) return;
    if (request.url.startsWith('/api/mail/')) startup.invalidate(['mail']);
    if (request.url.startsWith('/api/calendar/')) startup.invalidate(['calendar']);
    if (request.url === '/api/automation/settings') { clearWorkspaceScan(); graph.invalidate(); startup.invalidate(['automation', 'assets', 'brain']); }
    else if (request.url.startsWith('/api/automation/skills/')) startup.invalidate(['automation']);
  });
  app.register(async api => {
    api.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const hosts = ['127.0.0.1:8000', '127.0.0.1:5173'];
      if (!hosts.includes(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
        || (request.headers.origin !== undefined && !hosts.map(host => `http://${host}`).includes(request.headers.origin))) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: '대시보드에서 요청해 주세요.' });
      }
    });
    api.register(brainGraphRoutes, { service: graph });
    api.get('/api/startup', () => { calendar.refreshConfiguration(); return startup.status(); });
    api.get<{ Querystring: { refresh?: string } }>('/api/brain', async (request, reply) => {
      try {
        if (request.query.refresh === '1') { clearWorkspaceScan(); graph.invalidate(); }
        return await startup.read('brain', request.query.refresh === '1');
      } catch { return reply.code(503).send({ error: 'ROOT_UNAVAILABLE', message: '작업 공간을 읽지 못했습니다. 설정 경로와 접근 권한을 확인해 주세요.' }); }
    });
  });
  app.register(mailRoutes, { prefix: '/api/mail', service: mail, startup });
  app.register(metricsRoutes, { prefix: '/api/metrics', reader: new GhostMetricsReader(), collection: automation.collection });
  app.register(calendarRoutes, { prefix: '/api/calendar', service: calendar, startup });
  app.register(automationRoutes, { prefix: '/api/automation', service: automation, startup });
  app.register(assetRoutes, { prefix: '/api/assets', service: assets, startup });

  app.get('/api/health', async (_request, reply): Promise<HealthResponse> => {
    reply.header('Cache-Control', 'no-store');
    return { status: 'ok', time: new Date().toISOString() };
  });

  if (staticRoot) {
    app.register(fastifyStatic, { root: staticRoot });
  }

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'NOT_FOUND', message: '요청한 경로가 없습니다.' });
  });

  return app;
}
