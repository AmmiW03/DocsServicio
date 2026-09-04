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

export async function checkAdmin() {
  const response = await fetch('/api/admin/check', { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return Boolean(body.admin);
}

export async function uploadLicense(formData) {
  const response = await fetch('/api/admin/licenses', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}
