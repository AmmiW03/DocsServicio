import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const gitlabUrl = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/$/, '');
const clientId = process.env.GITLAB_CLIENT_ID;
const clientSecret = process.env.GITLAB_CLIENT_SECRET;
const redirectUri = process.env.GITLAB_REDIRECT_URI || `http://localhost:${port}/auth/callback`;
const sessions = new Map();
const oauthStates = new Map();

if (!clientId || !clientSecret) {
  console.error('Faltan GITLAB_CLIENT_ID y GITLAB_CLIENT_SECRET.');
  process.exit(1);
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function sessionFor(request) {
  const sessionId = parseCookies(request).session;
  return sessionId ? sessions.get(sessionId) : null;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { Location: location, ...headers });
  response.end();
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyGitlab(request, response, session, pathname, search) {
  const upstream = await fetch(`${gitlabUrl}/api/v4${pathname}${search}`, {
    method: request.method,
    headers: { Authorization: `Bearer ${session.accessToken}`, ...(request.headers['content-type'] ? { 'Content-Type': request.headers['content-type'] } : {}) },
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request),
  });
  const body = await upstream.arrayBuffer();
  response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' });
  response.end(Buffer.from(body));
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(root + path.sep)) return sendJson(response, 403, { message: 'Forbidden' });
  try {
    const body = await fs.readFile(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    response.end(body);
  } catch {
    sendJson(response, 404, { message: 'Not found' });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/auth/login') {
      const state = randomToken();
      oauthStates.set(state, Date.now() + 10 * 60 * 1000);
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state, scope: 'api read_user read_repository' });
      return redirect(response, `${gitlabUrl}/oauth/authorize?${params}`);
    }

    if (url.pathname === '/auth/callback') {
      const stateExpiry = oauthStates.get(url.searchParams.get('state'));
      oauthStates.delete(url.searchParams.get('state'));
      if (!stateExpiry || stateExpiry < Date.now()) return sendJson(response, 400, { message: 'OAuth state inválido o expirado' });
      if (url.searchParams.get('error')) return sendJson(response, 401, { message: 'GitLab rechazó la autenticación' });

      const tokenResponse = await fetch(`${gitlabUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code'), grant_type: 'authorization_code', redirect_uri: redirectUri }),
      });
      if (!tokenResponse.ok) return sendJson(response, 502, { message: 'GitLab no devolvió un token válido' });
      const tokens = await tokenResponse.json();
      const sessionId = randomToken();
      sessions.set(sessionId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000 });
      return redirect(response, '/#/projects', { 'Set-Cookie': `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}` });
    }

    if (url.pathname === '/auth/logout') {
      const cookies = parseCookies(request);
      const session = sessionFor(request);
      if (session?.accessToken) fetch(`${gitlabUrl}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token: session.accessToken }) }).catch(() => {});
      sessions.delete(cookies.session);
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    if (url.pathname === '/api/me') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      const upstream = await fetch(`${gitlabUrl}/api/v4/user`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      return sendJson(response, upstream.status, await upstream.json());
    }

    if (url.pathname.startsWith('/api/')) {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return proxyGitlab(request, response, session, url.pathname.slice(4), url.search);
    }

    return serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { message: 'Internal server error' });
  }
});

server.listen(port, () => console.log(`DocsServicio disponible en http://localhost:${port}`));
