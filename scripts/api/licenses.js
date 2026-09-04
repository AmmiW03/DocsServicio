import { get } from './client.js';

export function listLicenses(projectId) {
  return get(`/projects/${encodeURIComponent(projectId)}/licenses`);
}

export function licensePreviewUrl(projectId, licenseId) {
  return `/api/projects/${encodeURIComponent(projectId)}/licenses/${encodeURIComponent(licenseId)}/preview`;
}

export function licenseDownloadUrl(projectId, licenseId) {
  return `/api/projects/${encodeURIComponent(projectId)}/licenses/${encodeURIComponent(licenseId)}/download`;
}
