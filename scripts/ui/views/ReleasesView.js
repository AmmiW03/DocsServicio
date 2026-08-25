/** @view ReleasesView Displays GitLab releases and their tag assets. */

import { listReleases } from '../../api/releases.js';
import { getProject } from '../../api/projects.js';
import { getCachedUser, logout } from '../../auth/session.js';
import { getState } from '../../store/state.js';
import { navigate } from '../router.js';

export class ReleasesView {
  constructor(container, projectId) {
    this.container = container;
    this.projectId = projectId;
    this.project = null;
  }

  async init() {
    this._renderShell();
    try {
      const [project, releases] = await Promise.all([
        getProject(this.projectId),
        listReleases(this.projectId),
      ]);
      this.project = project;
      document.getElementById('releases-project-name').textContent = project.name;
      document.title = `${project.name} — Releases | GitLab Wiki Client`;
      this._renderReleases(releases);
    } catch (error) {
      document.getElementById('releases-content').innerHTML = `
        <div class="release-empty release-empty--error">
          <h2>No se pudieron cargar los releases</h2>
          <p>${escapeHtml(error.message)}</p>
          <button class="btn btn--primary" id="releases-retry">Reintentar</button>
        </div>`;
      document.getElementById('releases-retry').addEventListener('click', () => this.init());
    }
  }

  _renderShell() {
    const user = getCachedUser() || getState('user') || {};
    this.container.innerHTML = `
      <div class="releases-view">
        <header class="topbar">
          <div class="topbar__brand">
            <a class="topbar__back" href="#/projects" title="Volver a proyectos" aria-label="Volver a proyectos">←</a>
            <span class="topbar__title">Releases / <strong id="releases-project-name">Cargando…</strong></span>
          </div>
          <div class="topbar__actions">
            <span class="user-chip__name">${escapeHtml(user.name || user.username || '')}</span>
            <button class="btn btn--ghost btn--sm" id="releases-logout">Salir</button>
          </div>
        </header>
        <main class="releases-main">
          <div class="releases-heading">
            <span class="releases-eyebrow">VERSIONES PUBLICADAS</span>
            <h1>Releases</h1>
            <p>Descarga versiones, consulta sus novedades y revisa los tags publicados.</p>
          </div>
          <div id="releases-content" class="releases-content">
            <div class="release-loading"><span class="spinner spinner--lg"></span><p>Cargando releases…</p></div>
          </div>
        </main>
      </div>`;
    document.getElementById('releases-logout').addEventListener('click', async () => {
      await logout();
      navigate('/auth');
    });
  }

  _renderReleases(releases) {
    const content = document.getElementById('releases-content');
    if (!releases.length) {
      content.innerHTML = '<div class="release-empty"><h2>Aún no hay releases</h2><p>Cuando publiques un release en GitLab, aparecerá aquí junto con su tag.</p></div>';
      return;
    }
    content.innerHTML = releases.map((release, index) => `
      <article class="release-card ${index === 0 ? 'release-card--latest' : ''}">
        <div class="release-card__rail"><span class="release-card__dot"></span><span class="release-card__line"></span></div>
        <div class="release-card__body">
          <div class="release-card__topline">
            <span class="release-tag">${escapeHtml(release.tag_name || 'sin tag')}</span>
            ${index === 0 ? '<span class="release-latest">Más reciente</span>' : ''}
            <time>${formatDate(release.released_at || release.created_at)}</time>
          </div>
          <h2>${escapeHtml(release.name || release.tag_name || 'Release sin título')}</h2>
          ${release.description ? `<div class="release-description">${formatDescription(release.description)}</div>` : '<p class="release-muted">Sin notas de publicación.</p>'}
          ${this._assets(release)}
        </div>
      </article>`).join('');
  }

  _assets(release) {
    const links = release.assets?.links || [];
    const sources = release.assets?.sources || [];
    const items = [...links, ...sources.map((source) => ({ name: `Código fuente (${source.format})`, url: source.url }))];
    if (!items.length) return '';
    return `<div class="release-assets"><h3>Descargas</h3><div class="release-assets__list">${items.map((asset) => `<a class="release-asset" href="${escapeAttr(asset.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(asset.name || 'Descarga')}</span><span aria-hidden="true">↗</span></a>`).join('')}</div></div>`;
  }
}

function formatDate(value) {
  if (!value) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDescription(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}