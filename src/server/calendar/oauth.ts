import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { CalendarError } from './errors.js';
import { SCOPES } from './google.js';
import type { OAuthConfig } from './google.js';
export const APP_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:8000']);
export interface OAuthAttempt { url: string; cancel(): void }
export async function beginOAuth(config: OAuthConfig, origin: string,
  complete: (code: string, verifier: string, redirectUri: string) => Promise<void>,
  failed: (error: CalendarError) => void, ttl = 300000): Promise<OAuthAttempt> {
  if (!APP_ORIGINS.has(origin)) throw new CalendarError('FORBIDDEN');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let redirectUri = '';
  let used = false;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1'); }
    catch { res.writeHead(400); res.end('인증 요청이 유효하지 않습니다.'); return; }
    const got = url.searchParams.get('state') ?? '';
    const sameState = Buffer.byteLength(got) === Buffer.byteLength(state) && timingSafeEqual(Buffer.from(got), Buffer.from(state));
    if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || url.pathname !== '/' || !sameState || used) {
      res.writeHead(400); res.end('인증 요청이 유효하지 않습니다.'); return;
    }
    used = true;
    if (timer) clearTimeout(timer);
    void (async () => {
      try {
        if (url.searchParams.has('error')) throw new CalendarError('AUTH_CANCELLED');
        const code = url.searchParams.get('code');
        if (!code) throw new CalendarError('AUTH_FAILED');
        await complete(code, verifier, redirectUri);
      } catch (e) { failed(e instanceof CalendarError ? e : new CalendarError('AUTH_FAILED')); }
      finally {
        res.writeHead(303, { Location: `${origin}/#/settings` }); res.end(); server.close();
      }
    })();
  });
  server.requestTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new CalendarError('AUTH_FAILED')));
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new CalendarError('AUTH_FAILED'); }
  redirectUri = `http://127.0.0.1:${address.port}`;
  const timer = setTimeout(() => {
    used = true; failed(new CalendarError('AUTH_EXPIRED')); server.close(); server.closeAllConnections();
  }, ttl);
  timer.unref();
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, cancel() {
    used = true; if (timer) clearTimeout(timer); server.close(); server.closeAllConnections();
  } };
}
