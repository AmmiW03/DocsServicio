/**
 * @component WikiPageList
 * Sidebar list of wiki pages for a project.
 * Emits 'page-select' events on item click.
 * Supports filtered rendering for search results.
 */

import { navigate } from '../router.js';

export class WikiPageList {
  /**
   * @param {HTMLElement} container
   * @param {string|number} projectId
   */
  constructor(container, projectId) {
    this.container = container;
    this.projectId = projectId;
    this._activeSlug = null;
    this._allPages   = [];
  }

  /**
   * Full render of all pages (call once on project load).
   * @param {Array<{ slug: string, title: string }>} pages
   * @param {string|null} [activeSlug]
   */
  render(pages, activeSlug = null) {
    this._allPages   = pages;
    this._activeSlug = activeSlug;
    this._renderItems(pages);
  }

  /**
   * Re-render with a filtered subset (for search).
   * @param {Array} pages
   */
  renderFiltered(pages) {
    this._renderItems(pages, true);
  }

  /** @param {string} slug */
  setActive(slug) {
    this._activeSlug = slug;
    this.container.querySelectorAll('.wiki-page-list__item').forEach((el) => {
      const isActive = el.dataset.slug === slug;
      el.classList.toggle('is-active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });
  }

  // ---------------------------------------------------------------------------

  _renderItems(pages, isFiltered = false) {
    this.container.innerHTML = '';

    if (!pages.length) {
      this.container.innerHTML = `
        <div class="wiki-page-list__empty">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12h6M9 16h6M7 4H4a2 2 0 00-2 2v14a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2h-3"/><rect x="7" y="2" width="10" height="4" rx="1"/></svg>
          <p>${isFiltered ? 'Sin resultados para esta búsqueda.' : 'Esta wiki no tiene páginas.'}</p>
        </div>`;
      return;
    }

    // Build hierarchical structure by slug path separators ('/')
    const tree = buildPageTree(pages);
    const ul   = this._buildTreeList(tree, 0);
    this.container.appendChild(ul);
  }

  _buildTreeList(nodes, depth) {
    const ul = document.createElement('ul');
    ul.className = `wiki-page-list__list wiki-page-list__list--depth-${depth}`;
    ul.setAttribute('role', 'listbox');

    for (const node of nodes) {
      const li = document.createElement('li');
      li.className = 'wiki-page-list__item';
      li.dataset.slug = node.slug;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', node.slug === this._activeSlug ? 'true' : 'false');

      if (node.slug === this._activeSlug) li.classList.add('is-active');

      const btn = document.createElement('button');
      btn.className = 'wiki-page-list__btn';
      btn.id        = `wiki-page-btn-${node.slug.replace(/[^a-z0-9]/gi, '-')}`;
      btn.innerHTML = `
        <svg class="wiki-page-list__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
        <span class="wiki-page-list__title">${escapeHtml(node.title)}</span>
      `;
      btn.style.paddingLeft = `${0.75 + depth * 0.875}rem`;

      btn.addEventListener('click', () => {
        this.setActive(node.slug);
        navigate(`/wiki/${this.projectId}/${encodeURIComponent(node.slug)}`);
        this.container.dispatchEvent(new CustomEvent('page-select', {
          bubbles: true,
          detail:  { page: node },
        }));
      });

      li.appendChild(btn);

      if (node.children?.length) {
        li.appendChild(this._buildTreeList(node.children, depth + 1));
      }

      ul.appendChild(li);
    }

    return ul;
  }

  showSkeleton(count = 6) {
    this.container.innerHTML = Array.from({ length: count }, (_, i) => `
      <div class="wiki-page-list__skeleton" style="--depth:${i % 3}">
        <div class="skeleton skeleton--icon"></div>
        <div class="skeleton skeleton--text" style="width:${60 + (i * 13) % 35}%"></div>
      </div>
    `).join('');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Build a hierarchical tree from flat page list using slug path separators.
 * @param {Array<{ slug: string, title: string }>} pages
 * @returns {Array}
 */
function buildPageTree(pages) {
  const root = [];
  const map  = new Map();

  // Sort: home first, then alphabetically
  const sorted = [...pages].sort((a, b) => {
    if (a.slug === 'home') return -1;
    if (b.slug === 'home') return  1;
    return a.title.localeCompare(b.title);
  });

  for (const page of sorted) {
    const node = { ...page, children: [] };
    map.set(page.slug, node);

    const parts  = page.slug.split('/');
    if (parts.length > 1) {
      const parentSlug = parts.slice(0, -1).join('/');
      const parent     = map.get(parentSlug);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    root.push(node);
  }

  return root;
}
