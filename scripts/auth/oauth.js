/**
 * @module oauth
 * OAuth 2.0 Authorization Code Flow with PKCE for GitLab.
 * No client_secret required — safe for browser-only SPAs.
 *
 * References:
 *   - https://docs.gitlab.com/ee/api/oauth2.html
 *   - RFC 7636 (PKCE)
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('oauth');

const STORAGE_KEY_VERIFIER  = 'gl_pkce_verifier';
const STORAGE_KEY_CONFIG    = 'gl_oauth_config';
const STORAGE_KEY_STATE     = 'gl_oauth_state';

// ---------------------------------------------------------------------------
// PKCE Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random string suitable as a code_verifier.
 * @param {number} length
 * @returns {string}
 */
function generateRandomString(length = 64) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
}

/**
 * SHA-256 hash a string and return it as a base64url-encoded string (code_challenge).
 * @param {string} plain
 * @returns {Promise<string>}
 */
async function sha256Base64Url(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

/**
 * Encode an ArrayBuffer to base64url (no padding, URL-safe chars).
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a PKCE pair { verifier, challenge }.
 * The verifier must be persisted and sent with the token exchange request.
 * @returns {Promise<{ verifier: string, challenge: string }>}
 */
export async function generatePKCE() {
  const verifier  = generateRandomString(64);
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge };
}

/**
 * Build the GitLab authorization URL.
 * @param {{ gitlabUrl: string, clientId: string, redirectUri: string, challenge: string, state: string }} config
 * @returns {string}
 */
export function buildAuthURL({ gitlabUrl, clientId, redirectUri, challenge, state }) {
  const base   = gitlabUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          redirectUri,
    response_type:         'code',
    state,
    scope:                 'api read_user read_repository',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  const authUrl = `${base}/oauth/authorize?${params.toString()}`;

  log.info('URL de autorización construida', {
    gitlabUrl: base,
    clientId,
    redirectUri,
    scopes: 'api read_user read_repository',
  });

  return authUrl;
}

/**
 * Exchange an authorization code for tokens.
 * @param {{ code: string, verifier: string, gitlabUrl: string, clientId: string, redirectUri: string }} params
 * @returns {Promise<{ access_token: string, refresh_token: string, token_type: string, expires_in: number }>}
 */
export async function exchangeCode({ code, verifier, gitlabUrl, clientId, redirectUri }) {
  const base = gitlabUrl.replace(/\/$/, '');
  const body = new URLSearchParams({
    client_id:     clientId,
    code,
    code_verifier: verifier,
    grant_type:    'authorization_code',
    redirect_uri:  redirectUri,
  });

  const response = await fetch(`${base}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    log.error(`Intercambio de código falló: ${response.status}`, err);
    throw new Error(err.error_description || `Token exchange failed: ${response.status}`);
  }

  const tokens = await response.json();
  log.info('Intercambio de código exitoso', {
    expiresIn:     tokens.expires_in,
    tokenType:     tokens.token_type,
    hasRefresh:    Boolean(tokens.refresh_token),
    scopesGranted: tokens.scope,
  });
  return tokens;
}

/**
 * Refresh an access token using a refresh_token.
 * Note: GitLab refresh tokens are single-use.
 * @param {{ gitlabUrl: string, clientId: string, refreshToken: string }} params
 * @returns {Promise<{ access_token: string, refresh_token: string, expires_in: number }>}
 */
export async function refreshToken({ gitlabUrl, clientId, refreshToken: token }) {
  const base = gitlabUrl.replace(/\/$/, '');
  const body = new URLSearchParams({
    client_id:     clientId,
    refresh_token: token,
    grant_type:    'refresh_token',
  });

  log.info('Refrescando access token…');

  const response = await fetch(`${base}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    log.error(`Refresh de token falló: ${response.status}`, err);
    throw new Error(err.error_description || `Token refresh failed: ${response.status}`);
  }

  log.info('Token refrescado correctamente');
  return response.json();
}

/**
 * Revoke a token (access or refresh) at the GitLab introspection endpoint.
 * @param {{ gitlabUrl: string, clientId: string, token: string }} params
 * @returns {Promise<void>}
 */
export async function revokeToken({ gitlabUrl, clientId, token }) {
  const base = gitlabUrl.replace(/\/$/, '');
  const body = new URLSearchParams({ client_id: clientId, token });

  // Best-effort: ignore errors (e.g. token already expired)
  await fetch(`${base}/oauth/revoke`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Session Storage Helpers (used by AuthView / session.js)
// ---------------------------------------------------------------------------

/** Persist the PKCE verifier between redirect hops. */
export function saveVerifier(verifier) {
  sessionStorage.setItem(STORAGE_KEY_VERIFIER, verifier);
}

/** Retrieve and clear the stored PKCE verifier. */
export function popVerifier() {
  const v = sessionStorage.getItem(STORAGE_KEY_VERIFIER);
  sessionStorage.removeItem(STORAGE_KEY_VERIFIER);
  return v;
}

/** Persist the OAuth config across the redirect. */
export function saveOAuthConfig(config) {
  sessionStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
}

/** Retrieve the stored OAuth config. */
export function loadOAuthConfig() {
  const raw = sessionStorage.getItem(STORAGE_KEY_CONFIG);
  return raw ? JSON.parse(raw) : null;
}

/** Persist the anti-CSRF state parameter. */
export function saveState(state) {
  sessionStorage.setItem(STORAGE_KEY_STATE, state);
}

/** Retrieve and clear the stored state. */
export function popState() {
  const s = sessionStorage.getItem(STORAGE_KEY_STATE);
  sessionStorage.removeItem(STORAGE_KEY_STATE);
  return s;
}
