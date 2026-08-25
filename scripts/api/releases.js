/** GitLab Releases API endpoints. */

import { get } from './client.js';

/**
 * List releases for a project, newest first.
 * @param {string|number} projectId
 * @returns {Promise<Array>}
 */
export async function listReleases(projectId) {
  const id = typeof projectId === 'string'
    ? encodeURIComponent(projectId)
    : projectId;
  return get(`/projects/${id}/releases`, { page: 1, per_page: 100 });
}