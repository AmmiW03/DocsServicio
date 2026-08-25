/**
 * @component WikiPageViewer
 * Renders a wiki page's content as formatted HTML.
 * Uses the `marked` library (loaded via CDN) for Markdown → HTML.
 *
 * Supported formats: markdown, rdoc (fallback to plain text), asciidoc (fallback).
 *
 * @future When editing is enabled:
 *   1. Add an "Edit" button that triggers an 'edit-page' event on this.container
 *   2. WikiView listens for 'edit-page' and swaps in a WikiEditor component
 *   3. WikiEditor calls wiki.updatePage() on save
 */

export class WikiPageViewer {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
  }

  /**
   * @param {{ title: string, content: string, format: string, slug: string }} page
   * @param {string} projectName
   */
  async render(page, projectName = '') {
    const html = await this._toHtml(page.content, page.format);

    this.container.innerHTML = `
      <article class="wiki-viewer" id="wiki-content-${slugToId(page.slug)}" aria-label="Página wiki: ${escapeAttr(page.title)}">
        <header class="wiki-viewer__header">
          <div class="wiki-viewer__meta">
            <span class="wiki-viewer__format-badge wiki-viewer__format-badge--${page.format}">${page.format}</span>
          </div>
          <h1 class="wiki-viewer__title">${escapeHtml(page.title)}</h1>
          <div class="wiki-viewer__actions">
            <!--
              FUTURE EDITING: Uncomment this button and handle 'edit-page' event in WikiView.
              <button class="btn btn--secondary" id="wiki-edit-btn" data-slug="${escapeAttr(page.slug)}">
                <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar
              </button>
            -->
          </div>
        </header>
        <div class="wiki-viewer__body markdown-body">
          ${html}
        </div>
        <footer class="wiki-viewer__footer">
          <div class="wiki-viewer__footer-info">
            <span>Proyecto: <strong>${escapeHtml(projectName)}</strong></span>
            <span class="wiki-viewer__slug">slug: <code>${escapeHtml(page.slug)}</code></span>
          </div>
        </footer>
      </article>
    `;

    this._postProcess();
  }

  /** Fix relative links and add target="_blank" to external anchors */
  _postProcess() {
    this.container.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (href.startsWith('http://') || href.startsWith('https://')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });

    // Syntax highlight code blocks if hljs is available
    if (window.hljs) {
      this.container.querySelectorAll('pre code').forEach((block) => {
        window.hljs.highlightElement(block);
      });
    }
  }

  /** @param {string} content @param {string} format @returns {Promise<string>} */
  async _toHtml(content, format) {
    if (!content) return '<p class="wiki-viewer__no-content">Esta página no tiene contenido.</p>';

    if (format === 'markdown' || format === 'md') {
      return this._renderMarkdown(content);
    }
    // rdoc, asciidoc, org → render as escaped preformatted text (fallback)
    return `<pre class="wiki-viewer__raw-content">${escapeHtml(content)}</pre>`;
  }

  _renderMarkdown(content) {
    if (window.marked) {
      // Configure marked for security + nice output
      window.marked.setOptions({
        gfm:     true,
        breaks:  false,
        pedantic: false,
      });
      // Use DOMPurify if available, otherwise trust GitLab-sourced content
      const raw = window.marked.parse(content);
      return window.DOMPurify ? window.DOMPurify.sanitize(raw) : raw;
    }
    // Fallback: basic markdown-like rendering
    return basicMarkdown(content);
  }

  showSkeleton() {
    this.container.innerHTML = `
      <div class="wiki-viewer wiki-viewer--loading">
        <div class="wiki-viewer__header">
          <div class="skeleton skeleton--title"></div>
        </div>
        <div class="wiki-viewer__body">
          ${Array.from({ length: 5 }, (_, i) => `
            <div class="skeleton skeleton--line" style="width:${100 - (i * 7) % 40}%"></div>
          `).join('')}
          <div class="skeleton skeleton--block"></div>
          ${Array.from({ length: 3 }, (_, i) => `
            <div class="skeleton skeleton--line" style="width:${85 - (i * 11) % 30}%"></div>
          `).join('')}
        </div>
      </div>
    `;
  }

  showError(message) {
    this.container.innerHTML = `
      <div class="wiki-viewer wiki-viewer--error">
        <div class="error-state">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <h2>Error al cargar la página</h2>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>
    `;
  }

  showPlaceholder() {
    this.container.innerHTML = `
      <div class="wiki-viewer wiki-viewer--placeholder">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>
          <h2>Selecciona una página</h2>
          <p>Elige una página del panel izquierdo para ver su contenido.</p>
        </div>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function slugToId(slug) {
  return slug.replace(/[^a-z0-9]/gi, '-');
}

/**
 * Very basic Markdown → HTML converter (fallback when marked.js is not loaded).
 * Handles: headings, bold, italic, code, links, lists, blockquotes, horizontal rules.
 */
function basicMarkdown(md) {
  return md
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^[-*+]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---+$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}
