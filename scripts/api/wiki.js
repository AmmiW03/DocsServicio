/**
 * @module api/wiki
 * GitLab Wiki API endpoints.
 * Docs: https://docs.gitlab.com/ee/api/wikis.html
 *
 * READ operations are fully implemented and exposed to the UI.
 * WRITE operations (create, update, delete) are implemented at the API layer
 * with their correct signatures but are NOT connected to the UI yet.
 * To enable editing: import these functions in WikiView and add editor UI.
 */

import { get, getAll, post, put, del } from './client.js';

// ---------------------------------------------------------------------------
// READ (currently exposed in UI)
// ---------------------------------------------------------------------------

/**
 * List all wiki pages for a project.
 * @param {string|number} projectId
 * @param {{ withContent?: boolean }} [options]
 * @returns {Promise<Array<{ slug: string, title: string, format: string, content?: string }>>}
 */
export async function listPages(projectId, { withContent = false } = {}) {
  const id    = encodeProjectId(projectId);
  const pages = await getAll(`/projects/${id}/wikis`, {
    with_content: withContent ? 1 : 0,
  });
  return pages;
}

/**
 * Get a single wiki page (with full content).
 * @param {string|number} projectId
 * @param {string} slug  URL-encoded page slug
 * @returns {Promise<{ slug: string, title: string, content: string, format: string, encoding: string }>}
 */
export async function getPage(projectId, slug) {
  const id = encodeProjectId(projectId);
  return get(`/projects/${id}/wikis/${encodeURIComponent(slug)}`, {
    render_html: false, // Receive raw markdown
  });
}

/**
 * Search wiki pages client-side by title and content match.
 * GitLab CE does not expose a wiki full-text search endpoint,
 * so we filter locally on already-fetched pages.
 *
 * @param {Array} pages       Pages with at least { title, slug, content? }
 * @param {string} query
 * @returns {Array}
 */
export function searchPages(pages, query) {
  if (!query?.trim()) return pages;
  const q = query.toLowerCase();
  return pages.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      (p.content && p.content.toLowerCase().includes(q))
  );
}

// ---------------------------------------------------------------------------
// WRITE — API layer ready, UI integration pending
// ---------------------------------------------------------------------------

/**
 * Create a new wiki page.
 * @param {string|number} projectId
 * @param {{ title: string, content: string, format?: 'markdown'|'rdoc'|'asciidoc'|'org' }} data
 * @returns {Promise<Object>}
 *
 * @todo Connect to WikiEditor component in WikiView when editing is enabled.
 */
export async function createPage(projectId, data) {
  const id = encodeProjectId(projectId);
  return post(`/projects/${id}/wikis`, {
    title:   data.title,
    content: data.content,
    format:  data.format || 'markdown',
  });
}

/**
 * Update an existing wiki page.
 * @param {string|number} projectId
 * @param {string} slug
 * @param {{ title?: string, content?: string, format?: string }} data
 * @returns {Promise<Object>}
 *
 * @todo Connect to WikiEditor component in WikiView when editing is enabled.
 */
export async function updatePage(projectId, slug, data) {
  const id = encodeProjectId(projectId);
  return put(`/projects/${id}/wikis/${encodeURIComponent(slug)}`, data);
}

/**
 * Delete a wiki page.
 * @param {string|number} projectId
 * @param {string} slug
 * @returns {Promise<void>}
 *
 * @todo Connect to WikiPageList component when editing is enabled.
 */
export async function deletePage(projectId, slug) {
  const id = encodeProjectId(projectId);
  return del(`/projects/${id}/wikis/${encodeURIComponent(slug)}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeProjectId(projectId) {
  return typeof projectId === 'string'
    ? encodeURIComponent(projectId)
    : projectId;
}
