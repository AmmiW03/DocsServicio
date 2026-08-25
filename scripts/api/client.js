/**
 * @module api/client
 * Base HTTP client for the GitLab REST API v4.
 *
 * Features:
 *   - Automatic Bearer token injection
 *   - Transparent pagination (collects all pages by default)
 *   - Typed error classes for 401, 403, 404, and server errors
 *   - Full CRUD interface (GET/POST/PUT/DELETE) — write methods
 *     are available in the API layer for future wiki editing.
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('api');

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name   = 'ApiError';
    this.status = status;
    this.body   = body;
  }
}

export class AuthError    extends ApiError { constructor(b) { super('Authentication required', 401, b); this.name = 'AuthError'; } }
export class ForbiddenError extends ApiError { constructor(b) { super('Access forbidden', 403, b); this.name = 'ForbiddenError'; } }
export class NotFoundError  extends ApiError { constructor(b) { super('Resource not found', 404, b); this.name = 'NotFoundError'; } }

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------

function baseUrl() {
  return '/api';
}

async function parseBody(response) {
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('application/json')) return response.json();
  return response.text();
}

/**
 * Core fetch function. Injects auth header and maps HTTP errors.
 * @param {string} path      API path (relative to /api/v4)
 * @param {RequestInit} init Fetch options
 * @returns {Promise<{ data: any, response: Response }>}
 */
async function request(path, init = {}) {
  const url   = path.startsWith('http') ? path : `${baseUrl()}${path}`;
  const method = init.method || 'GET';
  const startedAt = performance.now();

  log.debug(`→ ${method} ${path}`);

  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  } catch (err) {
    const ms = Math.round(performance.now() - startedAt);
    log.error(`✗ ${method} ${path} — fallo de red/CORS (${ms}ms)`, {
      error: String(err),
      cause: err?.cause?.code || err?.cause?.message,
      hint:  'TypeError: Failed to fetch suele indicar URL incorrecta, servidor caído o CORS bloqueado',
    });
    throw new ApiError(`Network error: ${err.message}`, 0, { originalError: String(err) });
  }

  const data     = await parseBody(response);
  const ms       = Math.round(performance.now() - startedAt);

  if (!response.ok) {
    const message = data?.message || data?.error || `HTTP ${response.status}`;
    log.warn(`← ${response.status} ${method} ${path} (${ms}ms)`, { message, body: data });
    switch (response.status) {
      case 401: throw new AuthError(data);
      case 403: throw new ForbiddenError(data);
      case 404: throw new NotFoundError(data);
      default:  throw new ApiError(message, response.status, data);
    }
  }

  log.debug(`← ${response.status} ${method} ${path} (${ms}ms)`);
  return { data, response };
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Collect all pages of a paginated GitLab list endpoint.
 * GitLab uses `X-Next-Page` / `X-Total-Pages` response headers.
 *
 * @param {string} path    API path
 * @param {Object} params  Query params (will be converted to URLSearchParams)
 * @param {number} [perPage=100]
 * @returns {Promise<Array>}
 */
export async function getAll(path, params = {}, perPage = 100) {
  const allItems = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({ ...params, per_page: perPage, page }).toString();
    const { data, response } = await request(`${path}?${query}`);

    if (Array.isArray(data)) allItems.push(...data);

    const nextPage = response.headers.get('X-Next-Page');
    if (!nextPage) break;
    page = Number(nextPage);
  }

  log.info(`Paginación completa: ${path} — ${allItems.length} elementos`);
  return allItems;
}

// ---------------------------------------------------------------------------
// Public CRUD interface
// ---------------------------------------------------------------------------

/** @param {string} path @param {Object} [params] @returns {Promise<any>} */
export async function get(path, params = {}) {
  const query = Object.keys(params).length
    ? `?${new URLSearchParams(params).toString()}`
    : '';
  const { data } = await request(`${path}${query}`);
  return data;
}

/**
 * POST — used for creating resources (e.g., wiki pages).
 * Available in the API layer now; exposed in UI only when editing is enabled.
 * @param {string} path @param {Object} body @returns {Promise<any>}
 */
export async function post(path, body) {
  const { data } = await request(path, {
    method: 'POST',
    body:   JSON.stringify(body),
  });
  return data;
}

/**
 * PUT — used for updating resources (e.g., wiki pages).
 * Available in the API layer now; exposed in UI only when editing is enabled.
 * @param {string} path @param {Object} body @returns {Promise<any>}
 */
export async function put(path, body) {
  const { data } = await request(path, {
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  return data;
}

/**
 * DELETE — used for removing resources (e.g., wiki pages).
 * Available in the API layer now; exposed in UI only when editing is enabled.
 * @param {string} path @returns {Promise<void>}
 */
export async function del(path) {
  await request(path, { method: 'DELETE' });
}
