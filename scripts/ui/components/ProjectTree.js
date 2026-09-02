/**
 * @component ProjectTree
 * Renders the list of GitLab projects grouped by namespace.
 * Emits 'project-select' events when user clicks a project.
 */

import { groupByNamespace } from '../../api/projects.js';
import { navigate, replace } from '../router.js';

export class ProjectTree {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container      = container;
    this._activeId      = null;
  }

  /**
   * Render the project tree.
   * @param {Array} projects
   * @param {number|string|null} activeProjectId
   */
  render(projects, activeProjectId = null) {
    this._activeId  = activeProjectId;
    this.container.innerHTML = '';

    if (!projects.length) {
      this.container.innerHTML = `
        <div class="project-tree__empty">
          <p>No se encontraron proyectos.</p>
        </div>`;
      return;
    }

    const groups = groupByNamespace(projects);

    for (const [namespace, nsProjects] of groups) {
      const section = document.createElement('div');
      section.className = 'project-tree__group';

      const header = document.createElement('div');
      header.className = 'project-tree__namespace';
      header.innerHTML = `
        <svg class="project-tree__ns-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
        </svg>
        <span>${escapeHtml(namespace)}</span>
      `;
      section.appendChild(header);

      const list = document.createElement('ul');
      list.className  = 'project-tree__list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', `Proyectos en ${namespace}`);

      for (const project of nsProjects) {
        const li   = document.createElement('li');
        li.className   = 'project-tree__item';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', project.id === this._activeId ? 'true' : 'false');
        li.dataset.projectId = project.id;

        if (project.id === this._activeId) li.classList.add('is-active');

        const hasWiki = project.wiki_enabled !== false;

        li.innerHTML = `
          <div class="project-tree__row">
          <button class="project-tree__btn" id="project-btn-${project.id}" title="${escapeHtml(project.name_with_namespace)}">
            <span class="project-tree__avatar" style="background:${avatarColor(project.name)}">
              ${escapeHtml(project.name[0]?.toUpperCase() || '?')}
            </span>
            <span class="project-tree__name">${escapeHtml(project.name)}</span>
            ${hasWiki ? '' : '<span class="project-tree__badge project-tree__badge--no-wiki" title="Wiki deshabilitada">sin wiki</span>'}
          </button>
          ${hasWiki ? `<button type="button" class="project-tree__releases" title="Ver releases de ${escapeHtml(project.name)}" aria-label="Ver releases de ${escapeHtml(project.name)}">Releases</button>` : ''}
          <button type="button" class="project-tree__support" title="Reportar un problema de ${escapeHtml(project.name)}" aria-label="Reportar un problema de ${escapeHtml(project.name)}">Soporte</button>
          </div>
        `;

        if (hasWiki) {
          li.querySelector('button').addEventListener('click', () => {
            this._setActive(project.id);
            navigate(`/wiki/${project.id}`);
            this.container.dispatchEvent(new CustomEvent('project-select', {
              bubbles: true,
              detail:  { project },
            }));
          });
          li.querySelector('.project-tree__releases').addEventListener('click', (event) => {
            event.stopPropagation();
            replace(`/releases/${project.id}`);
          });
        }

        li.querySelector('.project-tree__support').addEventListener('click', (event) => {
          event.stopPropagation();
          replace(`/support/${project.id}`);
        });

        list.appendChild(li);
      }

      section.appendChild(list);
      this.container.appendChild(section);
    }
  }

  /** @param {number|string} id */
  _setActive(id) {
    this._activeId = id;
    this.container.querySelectorAll('.project-tree__item').forEach((el) => {
      const isActive = Number(el.dataset.projectId) === Number(id);
      el.classList.toggle('is-active', isActive);
      el.setAttribute('aria-selected', String(isActive));
    });
  }

  showSkeleton(count = 5) {
    this.container.innerHTML = Array.from({ length: count }, () => `
      <div class="project-tree__skeleton">
        <div class="skeleton skeleton--avatar"></div>
        <div class="skeleton skeleton--text"></div>
      </div>
    `).join('');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const AVATAR_COLORS = [
  '#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b',
  '#ef4444','#ec4899','#3b82f6','#14b8a6','#a855f7',
];

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
