import type { StartupService } from '../startup.js';
import type { FastifyInstance } from 'fastify';
import { CalendarService } from './service.js';
import { CalendarError } from './errors.js';
import { todayKst } from '../../shared/calendar.js';
import type { CalendarMonth } from '../../shared/calendar.js';
import { APP_ORIGINS } from './oauth.js';
export async function calendarRoutes(app: FastifyInstance, options: { service: CalendarService; startup?: StartupService }) {
  const service = options.service;
  const hosts = new Set(['127.0.0.1:5173', '127.0.0.1:8000']);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!hosts.has(request.headers.host ?? '') || request.headers['x-dashboard-request'] !== '1'
      || (request.headers.origin !== undefined && !APP_ORIGINS.has(request.headers.origin))) throw new CalendarError('FORBIDDEN');
    service.refreshConfiguration();
  });
  app.addHook('onClose', async () => service.close());
  app.setErrorHandler((error, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    const known = error instanceof CalendarError ? error : new CalendarError(status === 400 || status === 413 ? 'INVALID_INPUT' : 'INTERNAL_ERROR');
    const code = known.code;
    reply.code(code === 'FORBIDDEN' || code === 'ACCESS_DENIED' ? 403 : code === 'INVALID_INPUT' ? 400
      : ['AUTH_SETTINGS_INVALID', 'AUTH_CLIENT_INVALID', 'NOT_CONFIGURED', 'NOT_CONNECTED', 'NO_CALENDAR', 'CONFIG_CHANGED', 'REAUTH_REQUIRED'].includes(code) ? 409
      : code === 'TIMEOUT' ? 504 : code === 'RATE_LIMIT' ? 429 : 502).send({ error: code, message: known.message });
  });
  app.get('/settings', () => service.settings());
  app.post('/auth/start', request => service.startAuth(request.headers.origin ?? `http://${request.headers.host}`));
  app.get('/calendars', () => service.calendars());
  app.put('/settings', { bodyLimit: 4096 }, request => {
    const body = request.body as { calendarId?: unknown } | null;
    if (!body || typeof body.calendarId !== 'string' || !body.calendarId || body.calendarId.length > 1024) throw new CalendarError('INVALID_INPUT');
    return service.select(body.calendarId);
  });
  app.get('/events', async request => {
    const { month } = request.query as { month?: unknown };
    if (typeof month !== 'string') throw new CalendarError('INVALID_INPUT');
    if (options.startup && month === todayKst().slice(0, 7)) {
      const value = await options.startup.read('calendar', (request.query as { refresh?: string }).refresh === '1') as CalendarMonth;
      if (value.month === month) return value;
    }
    return service.month(month);
  });
  app.delete('/connection', async () => { await service.disconnect(); return { ok: true }; });
}
