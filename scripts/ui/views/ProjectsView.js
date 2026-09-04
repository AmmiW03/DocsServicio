/**
 * @view ProjectsView
 * Displays all accessible GitLab projects with wiki-enabled filtering.
 * Acts as a landing page after successful authentication.
 */

import { listProjects } from '../../api/projects.js';
import { checkAdmin } from '../../api/licenses.js';
import { getCachedUser, logout, isTokenExpired } from '../../auth/session.js';
import { setState, getState } from '../../store/state.js';
import { navigate } from '../router.js';
import { ProjectTree } from '../components/ProjectTree.js';
import { SearchBar } from '../components/SearchBar.js';
import { createLogger, downloadLogs } from '../../lib/logger.js';

const log = createLogger('projects');

export class ProjectsView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container   = container;
    this._allProjects = [];
    this._tree        = null;
    this._search      = null;
    this._wikiOnly    = true;
  }

  async init() {
    this._render();
    await Promise.all([this._loadProjects(), this._maybeShowAdminLink()]);
  }

  _render() {
    const user = getCachedUser() || getState('user') || {};

    this.container.innerHTML = `
      <div class="projects-view" id="projects-view">
        <header class="topbar" id="topbar">
          <div class="topbar__brand">
            <svg class="topbar__logo" viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M282.83,170.73l-.27-.69-26.14-68.22a6.81,6.81,0,0,0-2.71-3.18,7,7,0,0,0-8,.43,7,7,0,0,0-2.27,3.61l-17.65,54H154.21l-17.65-54A6.86,6.86,0,0,0,134.29,99a7,7,0,0,0-8-.43,6.87,6.87,0,0,0-2.71,3.18L97.44,170l-.26.69a48.54,48.54,0,0,0,16.1,56.1l.09.07.24.17,39.82,29.82,19.7,14.91,12,9.06a8.07,8.07,0,0,0,9.76,0l12-9.06,19.7-14.91,40.06-30,.1-.08A48.56,48.56,0,0,0,282.83,170.73Z"/>
            </svg>
            <span class="topbar__title">GitLab Wiki Client</span>
          </div>
          <div class="topbar__actions">
            <div class="user-chip" id="user-chip">
              <img
                class="user-chip__avatar"
                src="${escapeAttr(user.avatar_url || '')}"
                alt="${escapeAttr(user.name || 'Usuario')}"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
              />
              <span class="user-chip__fallback" style="display:none">${(user.name || 'U')[0].toUpperCase()}</span>
              <span class="user-chip__name">${escapeHtml(user.name || user.username || '')}</span>
            </div>
            <button class="btn btn--ghost btn--sm" id="logout-btn" aria-label="Cerrar sesión">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Salir
            </button>
          </div>
        </header>

        <main class="projects-main" id="projects-main">
          <div class="projects-header">
            <h1 class="projects-header__title">Proyectos</h1>
            <p class="projects-header__subtitle">Selecciona un proyecto para explorar su wiki o sus releases.</p>
          </div>

          <div class="projects-toolbar">
            <div id="projects-searchbar" class="projects-searchbar"></div>
            <label class="toggle-label" for="wiki-only-toggle">
              <input type="checkbox" id="wiki-only-toggle" checked />
              Solo con wiki habilitada
            </label>
          </div>

          <div id="projects-tree" class="projects-tree-container"></div>
        </main>
      </div>
    `;

    // Search
    const searchContainer = document.getElementById('projects-searchbar');
    this._search = new SearchBar(searchContainer, { placeholder: 'Buscar proyectos…' });
    searchContainer.addEventListener('search', (e) => this._filterProjects(e.detail.query));

    // Wiki-only toggle
    document.getElementById('wiki-only-toggle').addEventListener('change', (e) => {
      this._wikiOnly = e.target.checked;
      this._filterProjects(this._search ? this._search._input?.value || '' : '');
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', () => this._handleLogout());

    // Project tree
    const treeContainer = document.getElementById('projects-tree');
    this._tree = new ProjectTree(treeContainer);
    this._tree.showSkeleton();
  }

  async _loadProjects() {
    log.info('Cargando proyectos…');
    try {
      const projects = await listProjects();
      this._allProjects = projects;
      setState('projects', projects);
      log.info(`Proyectos cargados: ${projects.length}`, {
        conWiki: projects.filter((p) => p.wiki_enabled !== false).length,
      });
      this._filterProjects('');
    } catch (err) {
      log.error('Fallo al cargar proyectos', {
        name:         err.name,
        message:      err.message,
        status:       err.status,
        body:         err.body,
        tokenExpired: isTokenExpired(),
        stack:        err.stack?.split('\n').slice(0, 3),
      });

      document.getElementById('projects-tree').innerHTML = `
        <div class="error-state">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <h2>Error al cargar proyectos</h2>
          <p>${escapeHtml(err.message)}</p>
          <p class="error-state__hint">Abre la consola (F12) o descarga los logs para diagnosticar el problema.</p>
          <div style="display:flex;gap:.75rem">
            <button class="btn btn--primary" id="retry-btn">Reintentar</button>
            <button class="btn btn--ghost" id="logs-btn">Descargar logs</button>
          </div>
        </div>
      `;
      document.getElementById('retry-btn')?.addEventListener('click', () => this._loadProjects());
      document.getElementById('logs-btn')?.addEventListener('click', () => downloadLogs());
    }
  }

  _filterProjects(query = '') {
    let projects = this._allProjects;
    if (this._wikiOnly) {
      projects = projects.filter((p) => p.wiki_enabled !== false);
    }
    if (query?.trim()) {
      const q = query.toLowerCase();
      projects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.namespace?.full_path?.toLowerCase().includes(q)
      );
    }
    this._tree.render(projects);
  }

  async _handleLogout() {
    const btn = document.getElementById('logout-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saliendo…'; }
    await logout();
    navigate('/auth');
  }

  async _maybeShowAdminLink() {
    try {
      const admin = await checkAdmin();
      if (!admin) return;
      const actions = this.container.querySelector('.topbar__actions');
      if (!actions) return;
      const link = document.createElement('button');
      link.className = 'btn btn--ghost btn--sm';
      link.id = 'admin-link';
      link.setAttribute('aria-label', 'Administrar licencias');
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>Administrar licencias';
      link.addEventListener('click', () => navigate('/admin/licenses'));
      actions.insertBefore(link, actions.firstChild);
    } catch { }
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
