/**
 * @module app
 * Application entry point.
 * Initializes the router, handles auth callback detection,
 * and maps routes to views.
 */

import { initRouter, onNavigate } from './ui/router.js';
import { initializeSession }      from './auth/session.js';
import { setState }               from './store/state.js';
import { AuthView }               from './ui/views/AuthView.js';
import { ProjectsView }           from './ui/views/ProjectsView.js';
import { WikiView }               from './ui/views/WikiView.js';
import { ReleasesView }           from './ui/views/ReleasesView.js';
import { SupportView }            from './ui/views/SupportView.js';
import { createLogger, initGlobalHandlers } from './lib/logger.js';

const log = createLogger('app');

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  initGlobalHandlers();
  log.info('Bootstrap iniciado', {
    href:     window.location.href,
    hash:     window.location.hash,
    referrer: document.referrer || null,
  });

  const appEl = document.getElementById('app');
  if (!appEl) { console.error('#app element not found'); return; }

  const user = await initializeSession();
  if (user) setState('user', user);
  log.debug('Resolviendo ruta inicial', { isAuthenticated: Boolean(user) });

  // Register route handler
  onNavigate(async ({ view, params }) => {
    appEl.innerHTML = ''; // Clear current view

    switch (view) {
      case 'auth': {
        const authView = new AuthView(appEl);
        await authView.init();
        break;
      }
      case 'projects': {
        const projectsView = new ProjectsView(appEl);
        await projectsView.init();
        break;
      }
      case 'wiki': {
        const [projectId, pageSlug = null] = params;
        const wikiView = new WikiView(appEl, projectId, pageSlug ? decodeURIComponent(pageSlug) : null);
        await wikiView.init();
        break;
      }
      case 'releases': {
        const [projectId] = params;
        const releasesView = new ReleasesView(appEl, projectId);
        await releasesView.init();
        break;
      }
      case 'support': {
        const [projectId] = params;
        const supportView = new SupportView(appEl, projectId);
        await supportView.init();
        break;
      }
      default: {
        appEl.innerHTML = '<p style="padding:2rem;color:red">Ruta no encontrada.</p>';
      }
    }
  });

  // Initialize router (also handles OAuth callbacks through AuthView).
  initRouter();
}

// Start the app
bootstrap().catch((err) => {
  log.error('Fatal bootstrap error', err);
  console.error('Fatal bootstrap error:', err);
  document.getElementById('app').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;color:#ef4444">
      <h1>Error al iniciar la aplicación</h1>
      <pre style="font-size:.875rem;background:#1e1e1e;color:#f8f8f8;padding:1rem;border-radius:.5rem">${err.message}</pre>
      <button onclick="location.reload()" style="padding:.5rem 1.5rem;background:#6366f1;color:#fff;border:none;border-radius:.5rem;cursor:pointer">Reiniciar</button>
    </div>
  `;
});
