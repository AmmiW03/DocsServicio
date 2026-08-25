/**
 * @module session
 * Manages the authenticated session: token lifecycle, current user info.
 * Tokens are kept in sessionStorage (cleared on tab close, safer than localStorage).
 */

import { createLogger } from '../lib/logger.js';

const log = createLogger('session');

const KEY_USER          = 'gl_user';
let authenticated = false;

// ---------------------------------------------------------------------------
// Token Storage
// ---------------------------------------------------------------------------

/** Compatibility hook for callers from the previous browser-only flow. */
export function saveTokens(tokenData) {
  authenticated = Boolean(tokenData?.access_token);
}

/** @returns {string|null} */
export function getAccessToken() {
  return null;
}

/** @returns {string|null} */
export function getRefreshToken() {
  return null;
}

/** @returns {boolean} Whether the access token is known to be expired. */
export function isTokenExpired() {
  return false;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

/**
 * Fetch and cache the authenticated user from the GitLab API.
 * @param {string} gitlabUrl
 * @returns {Promise<Object>}
 */
export async function fetchAndCacheUser(gitlabUrl) {
  const response = await fetch('/api/me', { credentials: 'same-origin' });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    log.error(`GET /user falló: ${response.status}`, { body: body.slice(0, 500) });
    throw new Error(`Failed to fetch user: ${response.status}`);
  }

  const user = await response.json();
  sessionStorage.setItem(KEY_USER, JSON.stringify(user));
  log.info('Usuario autenticado', { username: user.username, id: user.id });
  return user;
}

/** @returns {Object|null} */
export function getCachedUser() {
  const raw = sessionStorage.getItem(KEY_USER);
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// Auth Status
// ---------------------------------------------------------------------------

/** @returns {boolean} */
export function isAuthenticated() {
  return authenticated;
}

export async function initializeSession() {
  let response;
  try {
    response = await fetch('/api/me', { credentials: 'same-origin' });
  } catch (error) {
    log.warn('Backend de autenticación no disponible', { message: error.message });
    authenticated = false;
    return null;
  }
  if (!response.ok) {
    authenticated = false;
    return null;
  }
  const user = await response.json();
  authenticated = true;
  sessionStorage.setItem(KEY_USER, JSON.stringify(user));
  return user;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * Revoke tokens and clear all session data.
 * @returns {Promise<void>}
 */
export async function logout() {
  await fetch('/auth/logout', { credentials: 'same-origin' });
  authenticated = false;
  sessionStorage.removeItem(KEY_USER);
}
