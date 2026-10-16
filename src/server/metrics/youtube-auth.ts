import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readGoogleClient } from '../auth-settings.js';
import { YOUTUBE_CHANNEL_ID } from '../../shared/youtube-metrics.js';
import { YouTubeAuthError, YouTubeAuthStore } from './youtube-auth-store.js';
import type { YouTubeClient } from './youtube-auth-store.js';
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new YouTubeAuthError('INVALID_RESPONSE');
  return v as Record<string, unknown>;
};
export async function readYouTubeClient(file: string): Promise<YouTubeClient> {
  try { return readGoogleClient(file); }
  catch { throw new YouTubeAuthError('INVALID_CLIENT_JSON'); }
}

export class YouTubeOAuth {
  private access?: { value: string; expiresAt: number };
  constructor(private store = new YouTubeAuthStore(), private fetcher: typeof fetch = fetch) {}
  async json(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try { response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new YouTubeAuthError('NETWORK'); }
    if (response.status >= 500) throw new YouTubeAuthError('SERVICE_UNAVAILABLE');
    let data: Record<string, unknown>;
    try { data = record(await response.json()); } catch { throw new YouTubeAuthError('INVALID_RESPONSE'); }
    if (!response.ok) {
      if (response.status === 401 || data.error === 'invalid_grant') throw new YouTubeAuthError('REAUTH_REQUIRED');
      if (response.status === 429) throw new YouTubeAuthError('RATE_LIMIT');
      throw new YouTubeAuthError(response.status === 403 ? 'ACCESS_DENIED' : 'AUTH_FAILED');
    }
    return data;
  }
  async token(config: YouTubeClient, params: Record<string, string>) {
    const data = await this.json('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }) });
    if (typeof data.access_token !== 'string' || !data.access_token || data.token_type !== 'Bearer'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new YouTubeAuthError('INVALID_RESPONSE');
    if (params.grant_type === 'authorization_code' && (typeof data.scope !== 'string'
      || !YOUTUBE_SCOPES.every(scope => (data.scope as string).split(' ').includes(scope))
      || typeof data.refresh_token !== 'string' || !data.refresh_token)) throw new YouTubeAuthError('MISSING_PERMISSION');
    return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : undefined };
  }
  async assertChannel(accessToken: string) {
    const data = await this.json('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!Array.isArray(data.items) || data.items.length !== 1 || data.items[0]?.id !== YOUTUBE_CHANNEL_ID) throw new YouTubeAuthError('WRONG_CHANNEL');
  }
  async finish(config: YouTubeClient, code: string, verifier: string, redirectUri: string, valid = () => true) {
    const tokens = await this.token(config, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    await this.assertChannel(tokens.accessToken);
    if (!valid()) throw new YouTubeAuthError('AUTH_CANCELLED');
    await this.store.connect({ ...config, refreshToken: tokens.refreshToken! });
    this.access = { value: tokens.accessToken, expiresAt: tokens.expiresAt };
  }
  async accessToken(): Promise<string | null> {
    if (this.access && this.access.expiresAt > Date.now() + 60000) return this.access.value;
    const saved = await this.store.read();
    if (!saved) return null;
    const tokens = await this.token(saved, { grant_type: 'refresh_token', refresh_token: saved.refreshToken });
    await this.assertChannel(tokens.accessToken);
    if (tokens.refreshToken && tokens.refreshToken !== saved.refreshToken) await this.store.rotate(saved.credentialId, tokens.refreshToken);
    this.access = { value: tokens.accessToken, expiresAt: tokens.expiresAt };
    return tokens.accessToken;
  }
  invalidate() { this.access = undefined; }
}
export async function beginYouTubeOAuth(config: YouTubeClient, oauth: YouTubeOAuth, ttl = 300000) {
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
  let redirectUri = '', used = false, cancelled = false, settled = false;
  let resolveDone!: () => void, rejectDone!: (error: YouTubeAuthError) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // 브라우저를 열기 전 실패해도 처리되지 않은 rejection을 남기지 않는다.
  void done.catch(() => {});
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { response.writeHead(400); response.end(); return; }
    const got = url.searchParams.get('state') ?? '';
    const same = Buffer.byteLength(got) === Buffer.byteLength(state) && timingSafeEqual(Buffer.from(got), Buffer.from(state));
    if (request.method !== 'GET' || request.headers.host !== new URL(redirectUri).host || url.pathname !== '/' || !same || used) {
      response.writeHead(400); response.end('인증 요청이 유효하지 않습니다.'); return;
    }
    used = true; clearTimeout(timer);
    void (async () => {
      try {
        if (url.searchParams.has('error')) throw new YouTubeAuthError('AUTH_CANCELLED');
        const code = url.searchParams.get('code');
        if (!code) throw new YouTubeAuthError('AUTH_FAILED');
        await oauth.finish(config, code, verifier, redirectUri, () => !cancelled);
        settled = true;
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('YouTube 연결을 완료했습니다. 이 창을 닫고 터미널로 돌아가세요.'); resolveDone();
      } catch (error) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('연결하지 못했습니다. 터미널의 안내를 확인하세요.');
        rejectDone(error instanceof YouTubeAuthError ? error : new YouTubeAuthError('AUTH_FAILED'));
      } finally { server.close(); }
    })();
  });
  server.requestTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', () => reject(new YouTubeAuthError('AUTH_FAILED'))); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new YouTubeAuthError('AUTH_FAILED'); }
  redirectUri = `http://127.0.0.1:${address.port}`;
  const cancel = (code = 'AUTH_CANCELLED') => {
    if (settled) return;
    cancelled = true; used = true; clearTimeout(timer); server.close(); server.closeAllConnections(); rejectDone(new YouTubeAuthError(code));
  };
  const timer = setTimeout(() => cancel('AUTH_EXPIRED'), ttl);
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, done, cancel };
}
