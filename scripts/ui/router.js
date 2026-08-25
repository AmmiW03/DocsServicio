/**
 * @module ui/router
 * Hash-based SPA router with authentication guards.
 *
 * Routes:
 *   #/auth                       → AuthView
 *   #/projects                   → ProjectsView (requires auth)
 *   #/wiki/:projectId            → WikiView — index page (requires auth)
 *   #/wiki/:projectId/:slug      → WikiView — specific page (requires auth)
 */

import { isAuthenticated } from '../auth/session.js';

/** @type {Map<RegExp, { view: string, auth: boolean }>} */
const routes = new Map([
  [/^\/auth$/,                        { view: 'auth',     auth: false }],
  [/^\/projects$/,                    { view: 'projects', auth: true  }],
  [/^\/wiki\/([^/]+)$/,               { view: 'wiki',     auth: true  }],
  [/^\/wiki\/([^/]+)\/(.+)$/,         { view: 'wiki',     auth: true  }],
  [/^\/releases\/([^/]+)$/,            { view: 'releases', auth: true  }],
]);

/** @type {{ view: string, params: string[], route: Object } | null} */
let current = null;

/** @type {Array<(route: { view: string, params: string[] }) => void>} */
const handlers = [];

/**
 * Register a navigation handler.
 * @param {(route: { view: string, params: string[] }) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onNavigate(fn) {
  handlers.push(fn);
  return () => {
    const i = handlers.indexOf(fn);
    if (i !== -1) handlers.splice(i, 1);
  };
}

/** @returns {{ view: string, params: string[] } | null} */
export function getCurrentRoute() {
  return current;
}

/**
 * Navigate to a hash route.
 * @param {string} path e.g. '/wiki/123/home'
 */
export function navigate(path) {
  window.location.hash = path;
}

/**
 * Replace current history entry (no back-navigation entry added).
 * @param {string} path
 */
export function replace(path) {
  const newUrl = `${window.location.pathname}${window.location.search}#${path}`;
  window.history.replaceState(null, '', newUrl);
  resolveRoute();
}

function resolveRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/auth';

  for (const [pattern, config] of routes) {
    const match = hash.match(pattern);
    if (!match) continue;

    const params = match.slice(1); // Captured groups

    // Auth guard
    if (config.auth && !isAuthenticated()) {
      replace('/auth');
      return;
    }

    current = { view: config.view, params };
    for (const fn of handlers) {
      try { fn(current); } catch (e) { console.error('Router handler error:', e); }
    }
    return;
  }

  // No match → fallback
  replace(isAuthenticated() ? '/projects' : '/auth');
}

/** Initialize the router (call once from app.js). */
export function initRouter() {
  window.addEventListener('hashchange', resolveRoute);
  resolveRoute(); // Resolve initial route on load
}
