/**
 * @module api/projects
 * GitLab Projects API endpoints.
 * Docs: https://docs.gitlab.com/ee/api/projects.html
 */

import { get, getAll } from './client.js';

/**
 * List all projects the authenticated user is a member of.
 * Returns all pages automatically.
 *
 * @param {{ search?: string, orderBy?: string, sort?: string, withWikiEnabled?: boolean }} [params]
 * @returns {Promise<Array>}
 */
export async function listProjects(params = {}) {
  const query = {
    membership:      true,
    order_by:        params.orderBy    || 'last_activity_at',
    sort:            params.sort       || 'desc',
    with_issues_enabled: false,
    ...(params.search           ? { search: params.search }                   : {}),
    ...(params.withWikiEnabled  ? { with_wiki_enabled: true }                 : {}),
  };
  return getAll('/projects', query);
}

/**
 * Get a single project by numeric ID or "namespace/path" slug.
 * @param {string|number} projectId
 * @returns {Promise<Object>}
 */
export async function getProject(projectId) {
  const id = typeof projectId === 'string'
    ? encodeURIComponent(projectId)
    : projectId;
  return get(`/projects/${id}`);
}

/**
 * Group an array of projects by their namespace (group or user).
 * @param {Array} projects
 * @returns {Map<string, Array>} namespace name → projects[]
 */
export function groupByNamespace(projects) {
  const map = new Map();
  for (const project of projects) {
    const ns = project.namespace?.full_path || project.namespace?.name || 'Personal';
    if (!map.has(ns)) map.set(ns, []);
    map.get(ns).push(project);
  }
  return map;
}
