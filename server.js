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
const oauthConfidential = process.env.GITLAB_OAUTH_CONFIDENTIAL === 'true';
const redirectUri = process.env.GITLAB_REDIRECT_URI || `http://localhost:${port}/auth/callback`;
const zammadUrl = (process.env.ZAMMAD_URL || '').replace(/\/$/, '');
const zammadToken = process.env.ZAMMAD_TOKEN;
const zammadGroupId = Number(process.env.ZAMMAD_GROUP_ID || 1);
const zammadPortalUserId = Number(process.env.ZAMMAD_PORTAL_USER_ID || 0);
const qaUsernames = new Set((process.env.SUPPORT_QA_USERNAMES || '').split(',').map((value) => value.trim()).filter(Boolean));
const licensesFile = process.env.LICENSES_FILE || path.join(root, 'data', 'licenses.json');
const licensesDirectory = path.resolve(process.env.LICENSES_DIRECTORY || path.join(root, 'data', 'licenses'));
const isProduction = process.env.NODE_ENV === 'production';
const sessions = new Map();
const oauthStates = new Map();

if (!clientId) {
  console.error('Falta GITLAB_CLIENT_ID.');
  process.exit(1);
}

if (isProduction && !process.env.GITLAB_REDIRECT_URI) {
  console.error('En producción debes definir GITLAB_REDIRECT_URI con https://.');
  process.exit(1);
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
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
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...headers });
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

async function zammadRequest(pathname, method = 'GET', body) {
  const upstream = await fetch(`${zammadUrl}/api/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Token token=${zammadToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const error = new Error(responseBody.error || responseBody.message || `Zammad respondió ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  return responseBody;
}

async function authenticatedGitlabUser(session) {
  return fetch(`${gitlabUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  }).then(async (upstream) => {
    if (!upstream.ok) throw new Error('No fue posible obtener el usuario autenticado');
    return upstream.json();
  });
}

async function readLicenses() {
  try {
    const body = await fs.readFile(licensesFile, 'utf8');
    const licenses = JSON.parse(body);
    return Array.isArray(licenses) ? licenses : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function projectLicenses(request, response, session, url) {
  const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/licenses(?:\/([^/]+)\/(preview|download))?$/);
  if (!match) return sendJson(response, 404, { message: 'Ruta de licencias no encontrada' });

  const [, rawProjectId, licenseId, action] = match;
  const projectId = decodeURIComponent(rawProjectId);
  const projectResponse = await fetch(`${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!projectResponse.ok) return sendJson(response, projectResponse.status === 404 ? 404 : 403, { message: 'Proyecto no encontrado o sin acceso' });

  const gitlabUser = await authenticatedGitlabUser(session);
  const licenses = (await readLicenses()).filter((license) =>
    String(license.project_id) === String(projectId) && (
      String(license.gitlab_user_id) === String(gitlabUser.id) ||
      (license.gitlab_username && normalizeUsername(license.gitlab_username) === normalizeUsername(gitlabUser.username)) ||
      (license.gitlab_user_id && normalizeUsername(license.gitlab_user_id) === normalizeUsername(gitlabUser.username))
    )
  );

  if (!licenseId && request.method === 'GET') {
    return sendJson(response, 200, licenses.map(({ storage_path, gitlab_user_id, gitlab_username, ...license }) => license));
  }

  if (request.method !== 'GET' || !licenseId || !action) {
    return sendJson(response, 405, { message: 'Método no permitido' });
  }

  const license = licenses.find((item) => String(item.id) === String(licenseId));
  if (!license) return sendJson(response, 404, { message: 'Licencia no encontrada' });

  const filePath = path.resolve(licensesDirectory, license.storage_path || '');
  if (!filePath.startsWith(`${licensesDirectory}${path.sep}`)) return sendJson(response, 403, { message: 'Archivo de licencia inválido' });

  let file;
  try {
    file = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(response, 404, { message: 'Documento de licencia no disponible' });
    throw error;
  }

  response.writeHead(200, {
    'Content-Type': license.mime_type || 'application/octet-stream',
    'Content-Length': file.length,
    'Content-Disposition': `${action === 'download' ? 'attachment' : 'inline'}; filename="${safeFilename(license.filename || 'licencia')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  response.end(file);
}

function safeFilename(filename) {
  return path.basename(String(filename)).replace(/["\r\n]/g, '_') || 'licencia';
}

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '').toLowerCase();
}

async function zammadCustomerForUser(gitlabUser) {
  const email = gitlabUser.email || gitlabUser.public_email;
  if (!email) throw Object.assign(new Error('Tu usuario de GitLab no tiene un correo disponible'), { status: 422 });
  const matches = await zammadRequest(`/users/search?query=${encodeURIComponent(email)}`);
  return Array.isArray(matches) ? matches.find((user) => user.email?.toLowerCase() === email.toLowerCase()) : null;
}

async function ticketBelongsToUser(ticketId, customerId) {
  const ticket = await zammadRequest(`/tickets/${encodeURIComponent(ticketId)}`);
  return Number(ticket.customer_id) === Number(customerId) ? ticket : null;
}

function ticketStateName(ticket) {
  return typeof ticket.state === 'object' ? ticket.state?.name : ticket.state;
}

function articleOwner(article, customerId) {
  if (Number(article.created_by_id) === Number(customerId) || (zammadPortalUserId && Number(article.created_by_id) === zammadPortalUserId)) return 'customer';
  const sender = typeof article.sender === 'object' ? article.sender?.name : article.sender;
  const senderName = String(sender || '').toLowerCase();
  if (senderName.includes('customer') || senderName.includes('cliente') || Number(article.sender_id) === 2) return 'customer';
  if (senderName.includes('agent') || senderName.includes('agente') || Number(article.sender_id) === 1) return 'support';
  if (article.from) return 'unknown';
  return 'support';
}

async function supportRequest(request, response, session, url) {
  if (!zammadUrl || !zammadToken) return sendJson(response, 503, { message: 'El soporte no está configurado en el servidor' });
  const gitlabUser = await authenticatedGitlabUser(session);
  const customer = await zammadCustomerForUser(gitlabUser);
  if (!customer) return sendJson(response, 200, []);

  if (url.pathname === '/api/support/tickets' && request.method === 'GET') {
    const tickets = await zammadRequest(`/tickets/search?query=customer_id:${customer.id}&limit=100&expand=true`);
    return sendJson(response, 200, Array.isArray(tickets) ? tickets.map((ticket) => ({
      id: ticket.id, number: ticket.number, title: ticket.title, state: ticketStateName(ticket),
      state_id: ticket.state_id, priority: ticket.priority, created_at: ticket.created_at, updated_at: ticket.updated_at,
    })) : []);
  }

  const ticketMatch = url.pathname.match(/^\/api\/support\/tickets\/(\d+)(?:\/(articles|reply|reopen))?$/);
  if (!ticketMatch) return sendJson(response, 404, { message: 'Ruta de soporte no encontrada' });
  const [, ticketId, action] = ticketMatch;
  const ticket = await ticketBelongsToUser(ticketId, customer.id);
  if (!ticket) return sendJson(response, 404, { message: 'Ticket no encontrado' });

  if (action === 'articles' && request.method === 'GET') {
    const articles = await zammadRequest(`/ticket_articles/by_ticket/${ticketId}`);
    return sendJson(response, 200, Array.isArray(articles) ? articles.filter((article) => !article.internal).map((article) => ({
      id: article.id, subject: article.subject, body: article.body, from: article.from,
      owner: articleOwner(article, customer.id), created_at: article.created_at,
    })) : []);
  }

  if (action === 'reply' && request.method === 'POST') {
    if (String(ticketStateName(ticket)).toLowerCase() === 'closed' || String(ticketStateName(ticket)).toLowerCase() === 'cerrado') return sendJson(response, 409, { message: 'Un ticket cerrado debe reabrirse con un motivo' });
    const payload = JSON.parse((await readBody(request)).toString() || '{}');
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    if (!body) return sendJson(response, 400, { message: 'El mensaje es obligatorio' });
    const article = await zammadRequest('/ticket_articles', 'POST', { ticket_id: Number(ticketId), body, type: 'note', internal: false });
    return sendJson(response, 201, article);
  }

  if (action === 'reopen' && request.method === 'PUT') {
    const payload = JSON.parse((await readBody(request)).toString() || '{}');
    const body = typeof payload.body === 'string' ? payload.body.trim() : '';
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!body || !reason) return sendJson(response, 400, { message: 'El motivo y el mensaje son obligatorios' });
    const reopened = await zammadRequest(`/tickets/${ticketId}`, 'PUT', {
      state: 'Reabierto', reapertura: reason,
      article: { subject: 'Reapertura del ticket', body, type: 'note', internal: false },
    });
    return sendJson(response, 200, reopened);
  }
  return sendJson(response, 405, { message: 'Método no permitido' });
}

async function createZammadTicket(request, response, session, allowTarget = false) {
  if (!zammadUrl || !zammadToken) {
    return sendJson(response, 503, { message: 'El soporte no está configurado en el servidor' });
  }

  const payload = JSON.parse((await readBody(request)).toString() || '{}');
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const system = typeof payload.system === 'string' ? payload.system.trim() : '';
  const targetEmail = typeof payload.targetEmail === 'string' ? payload.targetEmail.trim().toLowerCase() : '';
  const priorityId = Number(payload.priorityId);
  if (!title || !body || !system || !Number.isInteger(priorityId)) {
    return sendJson(response, 400, { message: 'Asunto, sistema, prioridad y descripción son obligatorios' });
  }

  const gitlabUser = await authenticatedGitlabUser(session);
  if (targetEmail && (!allowTarget || !qaUsernames.has(gitlabUser.username))) {
    return sendJson(response, 403, { message: 'Solo usuarios QA autorizados pueden crear tickets para otra persona' });
  }
  const email = targetEmail || gitlabUser.email || gitlabUser.public_email;
  if (!email) return sendJson(response, 422, { message: 'Tu usuario de GitLab no tiene un correo disponible' });

  const matches = await zammadRequest(`/users/search?query=${encodeURIComponent(email)}`);
  let customer = Array.isArray(matches) ? matches.find((user) => user.email?.toLowerCase() === email.toLowerCase()) : null;
  if (!customer) {
    customer = await zammadRequest('/users', 'POST', {
      firstname: gitlabUser.name?.split(' ')[0] || gitlabUser.username || 'Cliente',
      lastname: gitlabUser.name?.split(' ').slice(1).join(' ') || 'GitLab',
      email,
      roles: ['Customer'],
    });
  }

  const ticket = await zammadRequest('/tickets', 'POST', {
    title,
    group_id: zammadGroupId,
    customer_id: customer.id,
    priority_id: priorityId,
    article: { subject: 'Reporte de defecto', body, type: 'note', internal: false },
    sistema: system,
  });
  return sendJson(response, 201, { id: ticket.id, number: ticket.number });
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
      const verifier = randomToken();
      oauthStates.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, verifier });
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state, scope: 'api read_user read_repository', code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' });
      return redirect(response, `${gitlabUrl}/oauth/authorize?${params}`);
    }

    if (url.pathname === '/auth/callback') {
      const oauthState = oauthStates.get(url.searchParams.get('state'));
      oauthStates.delete(url.searchParams.get('state'));
      if (!oauthState || oauthState.expiresAt < Date.now()) return sendJson(response, 400, { message: 'OAuth state inválido o expirado' });
      if (url.searchParams.get('error')) return sendJson(response, 401, { message: 'GitLab rechazó la autenticación' });

      const tokenParams = { client_id: clientId, code: url.searchParams.get('code'), code_verifier: oauthState.verifier, grant_type: 'authorization_code', redirect_uri: redirectUri };
      if (oauthConfidential && clientSecret) tokenParams.client_secret = clientSecret;
      const tokenResponse = await fetch(`${gitlabUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenParams),
      });
      if (!tokenResponse.ok) return sendJson(response, 502, { message: 'GitLab no devolvió un token válido' });
      const tokens = await tokenResponse.json();
      const sessionId = randomToken();
      sessions.set(sessionId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000 });
      return redirect(response, '/#/projects', { 'Set-Cookie': `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax${isProduction ? '; Secure' : ''}` });
    }

    if (url.pathname === '/auth/logout') {
      const cookies = parseCookies(request);
      const session = sessionFor(request);
      if (session?.accessToken) {
        const revokeParams = { client_id: clientId, token: session.accessToken };
        if (oauthConfidential && clientSecret) revokeParams.client_secret = clientSecret;
        fetch(`${gitlabUrl}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(revokeParams) }).catch(() => {});
      }
      sessions.delete(cookies.session);
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax' });
    }

    if (url.pathname === '/api/me') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      const upstream = await fetch(`${gitlabUrl}/api/v4/user`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      return sendJson(response, upstream.status, await upstream.json());
    }

    if (url.pathname === '/api/support/tickets' && request.method === 'POST') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return createZammadTicket(request, response, session, false);
    }

    if (url.pathname === '/api/support/qa/tickets' && request.method === 'POST') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return createZammadTicket(request, response, session, true);
    }

    if (url.pathname.startsWith('/api/support/tickets')) {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return supportRequest(request, response, session, url);
    }

    if (url.pathname.startsWith('/api/projects/') && url.pathname.includes('/licenses')) {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return projectLicenses(request, response, session, url);
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
