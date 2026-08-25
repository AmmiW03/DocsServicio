/**
 * @view WikiView
 * Main wiki reading interface: sidebar + page viewer.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ Topbar (logo, project name, user, logout) │
 *   ├──────────────┬───────────────────────────┤
 *   │ Sidebar      │ Main content area          │
 *   │  - Search    │  - Breadcrumb              │
 *   │  - Page list │  - WikiPageViewer          │
 *   └──────────────┴───────────────────────────┘
 *
 * @future EDITING — when ready:
 *   1. Uncomment the "Editar" button in WikiPageViewer.render()
 *   2. Add listener for 'edit-page' event here in _bindViewerEvents()
 *   3. Swap WikiPageViewer for a WikiEditor component
 *   4. WikiEditor calls wiki.updatePage() / wiki.createPage() on save
 */

import { listPages, getPage, searchPages } from '../../api/wiki.js';
import { getProject } from '../../api/projects.js';
import { getCachedUser, logout } from '../../auth/session.js';
import { setState, getState } from '../../store/state.js';
import { navigate } from '../router.js';
import { WikiPageList }    from '../components/WikiPageList.js';
import { WikiPageViewer }  from '../components/WikiPageViewer.js';
import { Breadcrumb }      from '../components/Breadcrumb.js';
import { SearchBar }       from '../components/SearchBar.js';

export class WikiView {
  /**
   * @param {HTMLElement} container
   * @param {string} projectId
   * @param {string|null} [pageSlug]
   */
  constructor(container, projectId, pageSlug = null) {
    this.container  = container;
    this.projectId  = projectId;
    this.pageSlug   = pageSlug;
    this._project   = null;
    this._pages     = [];
    this._pageList  = null;
    this._viewer    = null;
    this._breadcrumb = null;
    this._search    = null;
    this._sidebarOpen = getState('sidebarOpen') ?? true;
  }

  async init() {
    this._renderShell();
    await this._loadProject();
    await this._loadPages();
    if (this.pageSlug) {
      await this._loadPage(this.pageSlug);
    } else {
      this._viewer.showPlaceholder();
      // Auto-open 'home' page if it exists
      const home = this._pages.find((p) => p.slug === 'home');
      if (home) await this._loadPage('home');
    }
  }

  // ---------------------------------------------------------------------------
  // Shell (structure)
  // ---------------------------------------------------------------------------

  _renderShell() {
    const user = getCachedUser() || getState('user') || {};

    this.container.innerHTML = `
      <div class="wiki-layout ${this._sidebarOpen ? '' : 'wiki-layout--sidebar-collapsed'}" id="wiki-layout">

        <!-- Topbar -->
        <header class="topbar" id="topbar">
          <div class="topbar__brand">
            <button class="topbar__sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded="${this._sidebarOpen}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6"  x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <a class="topbar__back" href="#/projects" title="Volver a proyectos">
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </a>
            <svg class="topbar__logo" viewBox="0 0 380 380" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M282.83,170.73l-.27-.69-26.14-68.22a6.81,6.81,0,0,0-2.71-3.18,7,7,0,0,0-8,.43,7,7,0,0,0-2.27,3.61l-17.65,54H154.21l-17.65-54A6.86,6.86,0,0,0,134.29,99a7,7,0,0,0-8-.43,6.87,6.87,0,0,0-2.71,3.18L97.44,170l-.26.69a48.54,48.54,0,0,0,16.1,56.1l.09.07.24.17,39.82,29.82,19.7,14.91,12,9.06a8.07,8.07,0,0,0,9.76,0l12-9.06,19.7-14.91,40.06-30,.1-.08A48.56,48.56,0,0,0,282.83,170.73Z"/>
            </svg>
            <span class="topbar__project-name" id="topbar-project-name">Cargando…</span>
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

        <!-- Sidebar -->
        <aside class="wiki-sidebar" id="wiki-sidebar" aria-label="Páginas de la wiki">
          <div class="wiki-sidebar__inner">
            <div id="wiki-searchbar" class="wiki-sidebar__search"></div>
            <nav class="wiki-sidebar__nav" aria-label="Índice de páginas">
              <div id="wiki-page-list" class="wiki-page-list"></div>
            </nav>
          </div>
        </aside>

        <!-- Main content -->
        <main class="wiki-main" id="wiki-main">
          <div id="wiki-breadcrumb" class="wiki-breadcrumb"></div>
          <div id="wiki-viewer" class="wiki-viewer-container"></div>
        </main>
      </div>
    `;

    // Initialize components
    const pageListEl = document.getElementById('wiki-page-list');
    this._pageList  = new WikiPageList(pageListEl, this.projectId);
    this._pageList.showSkeleton();

    const viewerEl  = document.getElementById('wiki-viewer');
    this._viewer    = new WikiPageViewer(viewerEl);
    this._viewer.showSkeleton();

    const bcEl      = document.getElementById('wiki-breadcrumb');
    this._breadcrumb = new Breadcrumb(bcEl);

    const searchEl  = document.getElementById('wiki-searchbar');
    this._search    = new SearchBar(searchEl, { placeholder: 'Buscar en la wiki…' });

    // Wire up events
    this._bindEvents();
  }

  _bindEvents() {
    // Sidebar toggle
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      this._sidebarOpen = !this._sidebarOpen;
      setState('sidebarOpen', this._sidebarOpen);
      const layout = document.getElementById('wiki-layout');
      const toggle = document.getElementById('sidebar-toggle');
      layout?.classList.toggle('wiki-layout--sidebar-collapsed', !this._sidebarOpen);
      toggle?.setAttribute('aria-expanded', String(this._sidebarOpen));
    });

    // Page selection
    document.getElementById('wiki-page-list')?.addEventListener('page-select', (e) => {
      this._loadPage(e.detail.page.slug);
    });

    // Search
    document.getElementById('wiki-searchbar')?.addEventListener('search', (e) => {
      const query = e.detail.query;
      setState('searchQuery', query);
      const filtered = searchPages(this._pages, query);
      this._pageList.renderFiltered(filtered);
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await logout();
      navigate('/auth');
    });

    // Back to projects
    document.querySelector('.topbar__back')?.addEventListener('click', (e) => {
      e.preventDefault();
      navigate('/projects');
    });

    /*
     * @future EDITING — Uncomment when ready:
     * document.getElementById('wiki-viewer')?.addEventListener('edit-page', (e) => {
     *   this._openEditor(e.detail.slug);
     * });
     */
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async _loadProject() {
    try {
      const project = await getProject(this.projectId);
      this._project = project;
      setState('currentProject', project);

      // Update topbar title
      const titleEl = document.getElementById('topbar-project-name');
      if (titleEl) titleEl.textContent = project.name;

      document.title = `${project.name} — Wiki | GitLab Wiki Client`;
    } catch (err) {
      console.error('Failed to load project:', err);
    }
  }

  async _loadPages() {
    try {
      const pages = await listPages(this.projectId);
      this._pages = pages;
      setState('wikiPages', pages);
      this._pageList.render(pages, this.pageSlug);
    } catch (err) {
      document.getElementById('wiki-page-list').innerHTML = `
        <div class="wiki-page-list__error">
          <p>Error al cargar páginas: ${escapeHtml(err.message)}</p>
          <button class="btn btn--sm btn--secondary" id="reload-pages-btn">Reintentar</button>
        </div>
      `;
      document.getElementById('reload-pages-btn')?.addEventListener('click', () => this._loadPages());
    }
  }

  async _loadPage(slug) {
    this._viewer.showSkeleton();
    this._pageList.setActive(slug);
    setState('currentPage', null);

    try {
      const page = await getPage(this.projectId, slug);
      setState('currentPage', page);

      // Update breadcrumb
      this._breadcrumb.render([
        { label: 'Proyectos',                           path: '/projects' },
        { label: this._project?.name || 'Proyecto',    path: `/wiki/${this.projectId}` },
        { label: page.title },
      ]);

      // Render content
      await this._viewer.render(page, this._project?.name || '');

      // Update URL without adding to history
      const newHash = `/wiki/${this.projectId}/${encodeURIComponent(slug)}`;
      if (window.location.hash !== `#${newHash}`) {
        window.history.replaceState(null, '', `${window.location.pathname}#${newHash}`);
      }

    } catch (err) {
      this._viewer.showError(err.message);
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
