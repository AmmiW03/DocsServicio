/**
 * @module store/state
 * Lightweight reactive state store (pub/sub pattern).
 * Components subscribe to specific state keys and are notified on changes.
 *
 * Usage:
 *   import { getState, setState, subscribe } from '../store/state.js';
 *   subscribe('currentPage', (page) => render(page));
 *   setState('currentPage', pageObject);
 */

/** @type {Map<string, any>} */
const store = new Map([
  ['user',           null],   // Authenticated GitLab user object
  ['config',         null],   // { gitlabUrl, clientId, redirectUri }
  ['projects',       []],     // List of GitLab projects
  ['currentProject', null],   // Selected project object
  ['wikiPages',      []],     // Wiki pages for currentProject
  ['currentPage',    null],   // Selected wiki page object (with content)
  ['searchQuery',    ''],     // Active search query in wiki
  ['loading',        false],  // Global loading indicator
  ['error',          null],   // Global error message
  ['sidebarOpen',    true],   // Sidebar visibility
]);

/** @type {Map<string, Set<Function>>} */
const listeners = new Map();

/**
 * Get the current value of a state key.
 * @template T
 * @param {string} key
 * @returns {T}
 */
export function getState(key) {
  return store.get(key);
}

/**
 * Update a state key and notify all subscribers.
 * @param {string} key
 * @param {any} value
 */
export function setState(key, value) {
  store.set(key, value);
  const subs = listeners.get(key);
  if (subs) {
    for (const cb of subs) {
      try { cb(value); } catch (e) { console.error(`State subscriber error [${key}]:`, e); }
    }
  }
}

/**
 * Subscribe to changes on a specific state key.
 * Returns an unsubscribe function.
 * @param {string} key
 * @param {Function} callback
 * @returns {() => void} unsubscribe
 */
export function subscribe(key, callback) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(callback);
  return () => listeners.get(key)?.delete(callback);
}

/**
 * Get the full current state snapshot (for debugging).
 * @returns {Object}
 */
export function getSnapshot() {
  return Object.fromEntries(store);
}

/**
 * Reset state to initial values (e.g., on logout).
 */
export function resetState() {
  setState('user',           null);
  setState('projects',       []);
  setState('currentProject', null);
  setState('wikiPages',      []);
  setState('currentPage',    null);
  setState('searchQuery',    '');
  setState('loading',        false);
  setState('error',          null);
}
