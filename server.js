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
const adminUsernames = new Set((process.env.SUPPORT_ADMIN_USERNAMES || '').split(',').map((value) => value.trim()).filter(Boolean));
const licenseStorageProject = String(process.env.GITLAB_LICENSES_PROJECT_ID || '').trim();
const licenseStorageToken = process.env.GITLAB_LICENSES_TOKEN || '';
const licenseStorageBranch = process.env.GITLAB_LICENSES_BRANCH || 'main';
const licenseRegistryPath = 'licenses-registry.json';
const maxLicenseBytes = 25 * 1024 * 1024;
const maxAttachmentBytes = 15 * 1024 * 1024;
const maxAttachmentsPerMessage = 4;
const maxMultipartBytes = 40 * 1024 * 1024;
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
  if (!licenseStorageProject || !licenseStorageToken) {
    throw Object.assign(new Error('Almacenamiento GitLab de licencias no está configurado'), { status: 503 });
  }
  try {
    const buffer = await gitlabRepoFileRaw(licenseRegistryPath);
    const parsed = JSON.parse(buffer.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }
}

async function writeLicenses(licenses, commitMessage = 'Actualizar registro de licencias') {
  await gitlabRepoFileUpsert(licenseRegistryPath, Buffer.from(JSON.stringify(licenses, null, 2), 'utf8'), commitMessage);
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
    return sendJson(response, 200, licenses.map(({ storage_path, gitlab_user_id, gitlab_username, gitlab_file_path, ...license }) => license));
  }

  if (request.method !== 'GET' || !licenseId || !action) {
    return sendJson(response, 405, { message: 'Método no permitido' });
  }

  const license = licenses.find((item) => String(item.id) === String(licenseId));
  if (!license) return sendJson(response, 404, { message: 'Licencia no encontrada' });

  let file;
  try {
    if (license.storage_type === 'gitlab') {
      if (!licenseStorageProject) return sendJson(response, 503, { message: 'Almacenamiento GitLab no configurado en el servidor' });
      file = await gitlabRepoFileRaw(license.gitlab_file_path);
    } else {
      return sendJson(response, 404, { message: 'Documento de licencia no disponible' });
    }
  } catch (error) {
    if (error.status === 404) return sendJson(response, 404, { message: 'Documento de licencia no disponible en GitLab' });
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

function sanitizeStoredFilename(filename) {
  const base = safeFilename(filename).replace(/\.[^.]+$/, '');
  const clean = base.replace(/^\.+/, '').replace(/[^a-z0-9._-]+/gi, '_') || 'licencia';
  return `${clean}.pdf`;
}

function parseMultipartFormData(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim();
  if (!boundary) return { fields: {}, file: null, files: [] };

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let file = null;
  let cursor = 0;

  while (cursor < body.length) {
    const partStart = body.indexOf(delimiter, cursor);
    if (partStart === -1) break;

    const afterDelimiter = partStart + delimiter.length;
    if (body[afterDelimiter] === 0x2d && body[afterDelimiter + 1] === 0x2d) break;

    let contentStart = afterDelimiter;
    if (body[contentStart] === 0x0d && body[contentStart + 1] === 0x0a) contentStart += 2;

    const partEnd = body.indexOf(delimiter, contentStart);
    if (partEnd === -1) break;

    let part = body.subarray(contentStart, partEnd);
    if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerText = part.subarray(0, headerEnd).toString('utf8');
      const content = part.subarray(headerEnd + 4);
      const disposition = headerText.match(/content-disposition:\s*form-data;([\s\S]*)/i)?.[1] || '';
      const fieldName = disposition.match(/name="([^"]*)"/i)?.[1];
      const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
      const contentTypeHeader = headerText.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();

      if (filename) {
        const item = { field: fieldName, filename, contentType: contentTypeHeader || 'application/octet-stream', buffer: Buffer.from(content) };
        files.push(item);
        if (!file) file = item;
      } else if (fieldName) {
        fields[fieldName] = Buffer.from(content).toString('utf8').trim();
      }
    }

    cursor = partEnd;
  }

  return { fields, file, files };
}

async function gitlabRepoFileUpsert(filePath, content, commitMessage) {
  if (!licenseStorageProject || !licenseStorageToken) {
    throw Object.assign(new Error('GITLAB_LICENSES_PROJECT_ID y GITLAB_LICENSES_TOKEN no están configurados'), { status: 503 });
  }
  const endpoint = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(licenseStorageProject)}/repository/files/${encodeURIComponent(filePath)}`;
  const authHeaders = { Authorization: `Bearer ${licenseStorageToken}` };
  const existing = await fetch(`${endpoint}?ref=${encodeURIComponent(licenseStorageBranch)}`, { headers: authHeaders });
  const method = existing.ok ? 'PUT' : 'POST';
  const upstream = await fetch(endpoint, {
    method,
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branch: licenseStorageBranch,
      content: content.toString('base64'),
      encoding: 'base64',
      commit_message: commitMessage,
    }),
  });
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `GitLab respondió ${upstream.status}`), { status: upstream.status });
  }
  return upstream.json();
}

async function gitlabRepoFileCreate(filePath, content, commitMessage) {
  if (!licenseStorageProject || !licenseStorageToken) {
    throw Object.assign(new Error('GITLAB_LICENSES_PROJECT_ID y GITLAB_LICENSES_TOKEN no están configurados'), { status: 503 });
  }
  const upstream = await fetch(
    `${gitlabUrl}/api/v4/projects/${encodeURIComponent(licenseStorageProject)}/repository/files/${encodeURIComponent(filePath)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${licenseStorageToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch: licenseStorageBranch,
        content: content.toString('base64'),
        encoding: 'base64',
        commit_message: commitMessage,
      }),
    }
  );
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `GitLab respondió ${upstream.status}`), { status: upstream.status });
  }
  return upstream.json();
}

async function gitlabRepoFileRaw(filePath) {
  if (!licenseStorageProject || !licenseStorageToken) {
    throw Object.assign(new Error('GITLAB_LICENSES_PROJECT_ID y GITLAB_LICENSES_TOKEN no están configurados'), { status: 503 });
  }
  const upstream = await fetch(
    `${gitlabUrl}/api/v4/projects/${encodeURIComponent(licenseStorageProject)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(licenseStorageBranch)}`,
    { headers: { Authorization: `Bearer ${licenseStorageToken}` } }
  );
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `GitLab respondió ${upstream.status}`), { status: upstream.status });
  }
  return Buffer.from(await upstream.arrayBuffer());
}

async function isAdmin(session) {
  if (!adminUsernames.size) return false;
  const gitlabUser = await authenticatedGitlabUser(session);
  return adminUsernames.has(gitlabUser.username);
}

async function adminUploadLicense(request, response, session) {
  if (!licenseStorageProject) {
    return sendJson(response, 503, { message: 'GITLAB_LICENSES_PROJECT_ID no está configurado en el servidor' });
  }

  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return sendJson(response, 400, { message: 'El formulario debe enviarse como multipart/form-data' });
  }

  const body = await readBody(request);
  if (body.length > maxLicenseBytes) {
    return sendJson(response, 413, { message: 'El archivo supera el tamaño máximo permitido (25 MB)' });
  }

  const { fields, file } = parseMultipartFormData(body, contentType);
  const projectId = String(fields.project_id || '').trim();
  const username = String(fields.gitlab_username || '').trim();
  const expiresAt = String(fields.expires_at || '').trim() || null;

  if (!projectId) return sendJson(response, 400, { message: 'El proyecto es obligatorio' });
  if (!username) return sendJson(response, 400, { message: 'El username de GitLab del cliente es obligatorio' });
  if (!file) return sendJson(response, 400, { message: 'Debes adjuntar un archivo PDF' });
  if (file.contentType && !file.contentType.toLowerCase().includes('application/pdf') && !String(file.filename).toLowerCase().endsWith('.pdf')) {
    return sendJson(response, 400, { message: 'Solo se aceptan archivos PDF' });
  }
  if (!file.buffer.length) return sendJson(response, 400, { message: 'El archivo está vacío' });

  const storedFilename = sanitizeStoredFilename(file.filename);
  const gitlabFilePath = `${projectId}/${Date.now()}-${storedFilename}`;

  const gitlabUser = await authenticatedGitlabUser(session);
  await gitlabRepoFileCreate(gitlabFilePath, file.buffer, `Añadir licencia PDF para ${username} en proyecto ${projectId}`);

  const licenses = await readLicenses();
  const license = {
    id: `lic-${crypto.randomBytes(8).toString('hex')}`,
    project_id: projectId,
    gitlab_username: username,
    filename: storedFilename,
    mime_type: 'application/pdf',
    storage_type: 'gitlab',
    gitlab_file_path: gitlabFilePath,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    created_by: gitlabUser.username,
  };
  licenses.push(license);
  await writeLicenses(licenses, `Registrar licencia ${storedFilename} para ${username}`);
  return sendJson(response, 201, license);
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

async function parsePayload(request, contentType, maxBytes = maxMultipartBytes) {
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const body = await readBody(request);
    if (body.length > maxBytes) throw Object.assign(new Error('La solicitud supera el tamaño máximo permitido'), { status: 413 });
    return parseMultipartFormData(body, contentType);
  }
  const parsed = JSON.parse((await readBody(request)).toString() || '{}');
  return { fields: parsed, file: null, files: [] };
}

const allowedAttachmentMimes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

function isAllowedAttachment(mimeType, filename) {
  if (allowedAttachmentMimes.has(String(mimeType || '').toLowerCase())) return true;
  return /\.(png|jpe?g|gif|webp|pdf)$/i.test(String(filename || ''));
}

function normalizeAttachmentMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime || 'application/octet-stream';
}

function toZammadAttachments(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length > maxAttachmentsPerMessage) {
    throw Object.assign(new Error(`Máximo ${maxAttachmentsPerMessage} archivos adjuntos por mensaje`), { status: 400 });
  }
  return list.map((file) => {
    const mimeType = normalizeAttachmentMime(file.contentType);
    if (!isAllowedAttachment(mimeType, file.filename)) {
      throw Object.assign(new Error('Formato de adjunto no permitido. Usa imágenes JPG, PNG, GIF, WebP o PDF.'), { status: 400 });
    }
    if (!file.buffer.length) {
      throw Object.assign(new Error('El archivo adjunto está vacío'), { status: 400 });
    }
    if (file.buffer.length > maxAttachmentBytes) {
      throw Object.assign(new Error('Cada adjunto supera el límite de 15 MB'), { status: 413 });
    }
    return { filename: String(file.filename || 'adjunto').slice(0, 255), data: file.buffer.toString('base64'), 'mime-type': mimeType };
  });
}

function zammadFieldValue(value) {
  if (typeof value === 'object' && value !== null) return value.value ?? value.label ?? '';
  return String(value ?? '');
}

async function gitlabProjectLookup(projectId, session) {
  const upstream = await fetch(`${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!upstream.ok) return null;
  const project = await upstream.json();
  return { name: String(project.name || ''), path: String(project.path_with_namespace || '') };
}

function ticketMatchesProject(ticket, project) {
  const sistema = zammadFieldValue(ticket.sistema || ticket.system).toLowerCase();
  if (!sistema) return false;
  return sistema === String(project.name).toLowerCase() || sistema === String(project.path).toLowerCase();
}

function mapSupportTicket(ticket) {
  return {
    id: ticket.id, number: ticket.number, title: ticket.title, state: ticketStateName(ticket),
    state_id: ticket.state_id, priority: ticket.priority, created_at: ticket.created_at, updated_at: ticket.updated_at,
  };
}

async function streamZammadAttachment(response, ticketId, articleId, attachmentId) {
  const upstream = await fetch(`${zammadUrl}/api/v1/ticket_attachment/${ticketId}/${articleId}/${attachmentId}`, {
    headers: { Authorization: `Token token=${zammadToken}` },
  });
  if (!upstream.ok) return sendJson(response, upstream.status === 404 ? 404 : 502, { message: 'Adjunto no disponible' });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const disposition = upstream.headers.get('content-disposition') || '';
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'private, no-store',
    ...(disposition ? { 'Content-Disposition': disposition } : {}),
  });
  response.end(buffer);
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
    const projectId = url.searchParams.get('project');
    if (!projectId) return sendJson(response, 200, []);
    const project = await gitlabProjectLookup(projectId, session);
    if (!project) return sendJson(response, 200, []);
    const owned = Array.isArray(tickets) ? tickets.filter((ticket) => ticketMatchesProject(ticket, project)) : [];
    return sendJson(response, 200, owned.map(mapSupportTicket));
  }

  const attachmentMatch = url.pathname.match(/^\/api\/support\/tickets\/(\d+)\/articles\/(\d+)\/attachments\/(\d+)$/);
  if (attachmentMatch && request.method === 'GET') {
    const [, ticketId, articleId, attachmentId] = attachmentMatch;
    const ticket = await ticketBelongsToUser(ticketId, customer.id);
    if (!ticket) return sendJson(response, 404, { message: 'Ticket no encontrado' });
    return streamZammadAttachment(response, ticketId, articleId, attachmentId);
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
      attachments: Array.isArray(article.attachments) ? article.attachments.map((attachment) => ({
        id: attachment.id, filename: attachment.filename || '', size: attachment.size,
        mimeType: typeof attachment.preferences === 'object' && attachment.preferences
          ? attachment.preferences['Mime-Type'] || attachment.preferences.mime_type || ''
          : '',
      })) : [],
    })) : []);
  }

  if (action === 'reply' && request.method === 'POST') {
    if (String(ticketStateName(ticket)).toLowerCase() === 'closed' || String(ticketStateName(ticket)).toLowerCase() === 'cerrado') return sendJson(response, 409, { message: 'Un ticket cerrado debe reabrirse con un motivo' });
    const contentType = request.headers['content-type'] || '';
    const { fields, files } = await parsePayload(request, contentType);
    const body = typeof fields.body === 'string' ? fields.body.trim() : typeof fields.message === 'string' ? fields.message.trim() : '';
    if (!body) return sendJson(response, 400, { message: 'El mensaje es obligatorio' });
    let attachments = [];
    if (files && files.length) attachments = toZammadAttachments(files);
    const payload = { ticket_id: Number(ticketId), body, type: 'note', internal: false };
    if (attachments.length) payload.attachments = attachments;
    const article = await zammadRequest('/ticket_articles', 'POST', payload);
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

  const contentType = request.headers['content-type'] || '';
  const { fields, files } = await parsePayload(request, contentType);
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const body = typeof fields.body === 'string' ? fields.body.trim() : '';
  const system = typeof fields.system === 'string' ? fields.system.trim() : '';
  const targetEmail = typeof fields.targetEmail === 'string' ? fields.targetEmail.trim().toLowerCase() : '';
  const priorityId = Number(fields.priorityId);
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

  const article = { subject: 'Reporte de defecto', body, type: 'note', internal: false };
  const attachments = files && files.length ? toZammadAttachments(files) : [];
  if (attachments.length) article.attachments = attachments;

  const ticket = await zammadRequest('/tickets', 'POST', {
    title,
    group_id: zammadGroupId,
    customer_id: customer.id,
    priority_id: priorityId,
    article,
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

    if (url.pathname === '/api/admin/check') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return sendJson(response, 200, { admin: await isAdmin(session) });
    }

    if (url.pathname === '/api/admin/licenses' && request.method === 'POST') {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      if (!(await isAdmin(session))) return sendJson(response, 403, { message: 'Acceso restringido a administradores' });
      return adminUploadLicense(request, response, session);
    }

    if (url.pathname.startsWith('/api/')) {
      const session = sessionFor(request);
      if (!session) return sendJson(response, 401, { message: 'Authentication required' });
      return proxyGitlab(request, response, session, url.pathname.slice(4), url.search);
    }

    return serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    sendJson(response, status, { message: error.message || 'Internal server error' });
  }
});

server.listen(port, () => console.log(`DocsServicio disponible en http://localhost:${port}`));
