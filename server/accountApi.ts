/**
 * The account API on the game server's HTTP side (`/api/*`, through the Oracle
 * relay's Caddy like `/play`): Better Auth's own routes under `/api/auth/*`
 * (the popup sign-in, sign-out, sessions), and the game's:
 *
 *   GET  /api/config   providers set up, whether local test logins exist
 *   GET  /api/me       the account: providers, progress (Authorization: Bearer)
 *   POST /api/solo     a bot match's summary from the browser (checked, added)
 *   POST /api/import   a guest's local progress, once (capped)
 *   POST /api/logout   this session signed out
 *   POST /api/delete   the account and its progress, for good
 *   POST /api/shop       buying, boxes, the exchange, missions, mail, boosters, what is worn (step 5)
 *   POST /api/dev-login  local testing only (`STRIKEGY_DEV_LOGIN`, local requests)
 *   GET  /api/link, /api/linked   the popup that joins a second provider to a signed-in account
 *
 * Sites on another origin (strikegy.xyz, the github.io copy) call it, so it
 * answers CORS for the trusted origins only, with `Authorization` allowed and
 * Better Auth's `set-auth-token` header exposed.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Accounts } from './accounts.ts';

const BODY_MAX = 64 * 1024;
/** Requests one address may make to the game's routes: a bucket, refilled a second. */
const RATE = { burst: 30, perSecond: 0.5 } as const;

export function accountApi(accounts: Accounts, log: (line: string) => void): (req: IncomingMessage, res: ServerResponse, addr: string) => void {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const take = (addr: string): boolean => {
    const now = Date.now();
    const b = buckets.get(addr) ?? { tokens: RATE.burst, at: now };
    b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 1000) * RATE.perSecond);
    b.at = now;
    buckets.set(addr, b);
    if (buckets.size > 5000) buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  };
  const trusted = new Set(accounts.trustedOrigins);

  const cors = (req: IncomingMessage, res: ServerResponse): void => {
    const origin = req.headers.origin;
    if (!origin || !trusted.has(origin)) return;
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-expose-headers', 'set-auth-token');
    res.setHeader('access-control-max-age', '600');
  };
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let size = 0;
      const parts: Buffer[] = [];
      req.on('data', (d: Buffer) => {
        size += d.length;
        if (size > BODY_MAX) {
          req.destroy();
          resolve(null);
          return;
        }
        parts.push(d);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });

  return (req, res, addr) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    cors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path.startsWith('/api/auth/')) {
      void accounts.handler(req, res).catch((err: unknown) => {
        log(`auth: ${String(err)}`);
        if (!res.headersSent) json(res, 500, { error: 'auth' });
      });
      return;
    }
    if (req.method === 'GET' && (path === '/api/link' || path === '/api/linked' || path === '/api/link.js' || path === '/api/linked.js')) return linkPages(req, res, url, trusted, accounts.providers);
    if (!take(addr)) return json(res, 429, { error: 'rate' });
    void (async () => {
      if (path === '/api/config' && req.method === 'GET') return json(res, 200, { providers: accounts.providers, devLogin: accounts.devLogin });
      if (path === '/api/dev-login' && req.method === 'POST') {
        // Local testing only: never through the relay (it comes in as a local socket with a forwarded address).
        const local = /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
        if (!accounts.devLogin || !local) return json(res, 404, { error: 'none' });
        const made = await accounts.devAccount();
        return json(res, 200, { token: made.token });
      }
      const userId = await accounts.fromRequest(req);
      if (!userId) return json(res, 401, { error: 'login' });
      if (path === '/api/me' && req.method === 'GET') return json(res, 200, accounts.view(userId));
      if (req.method !== 'POST') return json(res, 404, { error: 'none' });
      if (path === '/api/name') {
        // The account's game name (the same on every device).
        const body = (await readBody(req)) as { name?: unknown } | null;
        const out = accounts.rename(userId, body?.name);
        return json(res, 'error' in out ? 400 : 200, out);
      }
      if (path === '/api/privacy') {
        // Who sees the account card in rooms.
        const body = (await readBody(req)) as { privacy?: unknown } | null;
        const out = accounts.setPrivacy(userId, body?.privacy);
        return json(res, out ? 200 : 400, out ?? { error: 'bad' });
      }
      if (path === '/api/shop') {
        // The shop and the armory (step 5): one action a request.
        const out = accounts.shop(userId, await readBody(req));
        if (!out) return json(res, 400, { error: 'bad' });
        return json(res, out.error ? 409 : 200, out);
      }
      if (path === '/api/solo') {
        const body = (await readBody(req)) as { summary?: unknown } | null;
        const applied = accounts.solo(userId, body?.summary);
        if (!applied) return json(res, 400, { error: 'bad' });
        const after = applied.profile.xp;
        return json(res, 200, { profile: applied.profile, before: after - (applied.profile.history[0]?.xp ?? 0), after, promotions: applied.promotions });
      }
      if (path === '/api/import') {
        const body = (await readBody(req)) as { profile?: unknown } | null;
        const p = accounts.importGuest(userId, body?.profile);
        return json(res, p ? 200 : 409, p ? { profile: p } : { error: 'done' });
      }
      if (path === '/api/logout') {
        await accounts.auth.api.signOut({ headers: new Headers({ authorization: req.headers.authorization ?? '' }) }).catch(() => null);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/delete') {
        accounts.remove(userId);
        log(`account ${userId.slice(0, 8)} deleted by its owner`);
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'none' });
    })().catch((err: unknown) => {
      log(`api ${path}: ${String(err)}`);
      if (!res.headersSent) json(res, 500, { error: 'server' });
    });
  };
}

/**
 * Joining a second provider (Better Auth's `link-social`) has to start on this
 * origin: the OAuth state cookie it sets must come back with the provider's
 * callback here. So the site opens `/api/link` in a popup, the page says it is
 * ready, the site posts it the session token (to this origin only), the page
 * asks for the provider's address and goes there; the callback ends on
 * `/api/linked`, which tells the site and closes. No token in any address.
 */
function linkPages(req: IncomingMessage, res: ServerResponse, url: URL, trusted: Set<string>, providers: readonly string[]): void {
  const csp = "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
  const page = (data: Record<string, unknown>, script: string): void => {
    const json = JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Strikegy</title><meta name="viewport" content="width=device-width"></head><body style="font:16px sans-serif;background:#111;color:#ddd;padding:24px"><script type="application/json" id="d">${json}</script><p id="m">…</p><script src="${script}"></script></body></html>`);
  };
  const js = (body: string): void => {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const origin = url.searchParams.get('origin') ?? url.searchParams.get('o') ?? '';
  const nonce = url.searchParams.get('nonce') ?? url.searchParams.get('n') ?? '';
  const okNonce = /^[0-9a-f]{16,64}$/.test(nonce);
  if (url.pathname === '/api/link.js') return js(LINK_JS);
  if (url.pathname === '/api/linked.js') return js(LINKED_JS);
  if (!trusted.has(origin) || !okNonce) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
    return;
  }
  if (url.pathname === '/api/link') {
    const provider = url.searchParams.get('provider') ?? '';
    if (!providers.includes(provider)) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('bad provider');
      return;
    }
    return page({ provider, origin, nonce }, '/api/link.js');
  }
  void req;
  page({ origin, nonce, ok: !url.searchParams.has('error') && !url.searchParams.has('e') }, '/api/linked.js');
}

const LINK_JS = `(function () {
  var d = JSON.parse(document.getElementById('d').textContent);
  var m = document.getElementById('m');
  var fail = function () { m.textContent = '연결하지 못했습니다. 창을 닫고 다시 해 보세요. / Could not link; close this window and try again.'; };
  if (!window.opener) return fail();
  window.addEventListener('message', function (e) {
    var x = e.data;
    if (e.origin !== d.origin || !x || x.type !== 'strikegy-link' || x.nonce !== d.nonce || typeof x.token !== 'string') return;
    var back = location.origin + '/api/linked?o=' + encodeURIComponent(d.origin) + '&n=' + d.nonce;
    fetch('/api/auth/link-social', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + x.token, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: d.provider, callbackURL: back, errorCallbackURL: back + '&e=1' }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.url) location.href = j.url; else fail();
    }).catch(fail);
  });
  window.opener.postMessage({ type: 'strikegy-link-ready', nonce: d.nonce }, d.origin);
})();
`;

const LINKED_JS = `(function () {
  var d = JSON.parse(document.getElementById('d').textContent);
  document.getElementById('m').textContent = d.ok ? '연결되었습니다. / Linked.' : '연결하지 못했습니다. / Could not link.';
  if (window.opener) window.opener.postMessage({ type: 'strikegy-linked', nonce: d.nonce, ok: d.ok }, d.origin);
  setTimeout(function () { window.close(); }, 600);
})();
`;
