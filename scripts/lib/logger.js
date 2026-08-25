/**
 * @module lib/logger
 * Structured logging system for diagnostics.
 *
 * Features:
 *   - Leveled logging (debug/info/warn/error) with scoped child loggers
 *   - Ring buffer persisted to localStorage (survives reloads and OAuth redirects)
 *   - Automatic redaction of secrets (tokens, verifiers, authorization headers)
 *   - Console mirror with level styling
 *   - Global handlers for uncaught errors and unhandled rejections
 *   - Export: download as .txt or dump via `__glLogs.dump()` in DevTools console
 *
 * Usage:
 *   import { createLogger } from '../lib/logger.js';
 *   const log = createLogger('api');
 *   log.info('Request finished', { status: 200, ms: 42 });
 */

const STORAGE_KEY = 'gl_logs';
const LEVEL_KEY   = 'gl_loglevel';
const MAX_ENTRIES = 500;

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/** Keys whose values are never written to logs (case-insensitive match). */
const REDACT_KEYS = new Set([
  'access_token', 'refresh_token', 'id_token', 'authorization',
  'code_verifier', 'verifier', 'client_secret', 'password',
  'secret', 'private_key', 'token',
]);

let minLevel = LEVELS.debug;
let buffer   = [];
let loaded   = false;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureLoaded() {
  if (loaded) return;
  loaded = true;

  try {
    const savedLevel = localStorage.getItem(LEVEL_KEY);
    if (savedLevel && LEVELS[savedLevel] != null) minLevel = LEVELS[savedLevel];
  } catch { /* storage unavailable */ }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    buffer = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(buffer)) buffer = [];
  } catch { buffer = []; }

  // DevTools console access: __glLogs.download() / __glLogs.dump() / __glLogs.clear()
  window.__glLogs = {
    entries:  () => [...buffer],
    dump:     exportText,
    download: downloadLogs,
    clear:    clearLogs,
    setLevel,
  };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer));
  } catch { /* quota exceeded — keep in-memory only */ }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Deep-clone a value for logging: redacts secret keys, truncates long strings,
 * converts Errors into plain objects with stack traces.
 */
function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6)     return '[…]';

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  try {
    if (Array.isArray(value)) return value.slice(0, 100).map((v) => sanitize(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : sanitize(v, depth + 1);
    }
    return out;
  } catch {
    return String(value);
  }
}

/** Safe token preview for diagnostics: first4…last4 + length. Never the full value. */
export function maskToken(token) {
  if (!token) return null;
  return `${token.slice(0, 4)}…${token.slice(-4)} (len:${token.length})`;
}

// ---------------------------------------------------------------------------
// Core emit
// ---------------------------------------------------------------------------

const CONSOLE_STYLE = {
  debug: 'color:#6b7280',
  info:  'color:#60a5fa',
  warn:  'color:#fbbf24',
  error: 'color:#ef4444;font-weight:bold',
};

function emit(level, scope, message, data) {
  ensureLoaded();
  if (LEVELS[level] < minLevel) return;

  const entry = {
    t:      new Date().toISOString(),
    level,
    scope,
    message,
    ...(data !== undefined ? { data: sanitize(data) } : {}),
  };

  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  persist();

  const tag = `%c[${scope}] ${message}`;
  const fn  = level === 'debug' ? 'debug' : level;
  // eslint-disable-next-line no-console
  console[fn](tag, CONSOLE_STYLE[level], entry.data ?? '');
}

/**
 * Create a scoped logger.
 * @param {string} scope Module or component name (e.g. 'api', 'auth')
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(scope = 'app') {
  return {
    debug: (message, data) => emit('debug', scope, message, data),
    info:  (message, data) => emit('info',  scope, message, data),
    warn:  (message, data) => emit('warn',  scope, message, data),
    error: (message, data) => emit('error', scope, message, data),
  };
}

// ---------------------------------------------------------------------------
// Configuration & Export API
// ---------------------------------------------------------------------------

/** @param {'debug'|'info'|'warn'|'error'} name */
export function setLevel(name) {
  if (LEVELS[name] == null) return;
  minLevel = LEVELS[name];
  try { localStorage.setItem(LEVEL_KEY, name); } catch { /* noop */ }
}

export function getEntries() {
  ensureLoaded();
  return [...buffer];
}

export function clearLogs() {
  ensureLoaded();
  buffer = [];
  persist();
}

export function exportText() {
  return getEntries()
    .map((e) =>
      `${e.t} ${e.level.toUpperCase().padEnd(5)} [${e.scope}] ${e.message}` +
      (e.data !== undefined ? ` | ${JSON.stringify(e.data)}` : '')
    )
    .join('\n');
}

export function downloadLogs() {
  const blob = new Blob([exportText()], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href        = url;
  a.download    = `gl-wiki-client-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Global handlers — capture anything that escapes module-level try/catch
// ---------------------------------------------------------------------------

export function initGlobalHandlers() {
  window.addEventListener('error', (e) => {
    emit('error', 'window', e.message || 'Uncaught error', {
      filename: e.filename,
      line:     e.lineno,
      col:      e.colno,
      stack:    e.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    emit('error', 'promise', 'Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.stack : String(reason),
    });
  });
}
