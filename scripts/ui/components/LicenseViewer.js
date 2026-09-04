import { licenseDownloadUrl, licensePreviewUrl } from '../../api/licenses.js';

export class LicenseViewer {
  constructor(container, projectId) {
    this.container = container;
    this.projectId = projectId;
  }

  render(licenses) {
    if (!licenses.length) {
      this.container.innerHTML = `
        <section class="wiki-viewer license-viewer">
          <header class="wiki-viewer__header">
            <span class="wiki-viewer__format-badge wiki-viewer__format-badge--license">Licencias</span>
            <h1 class="wiki-viewer__title">Mis licencias</h1>
          </header>
          <div class="empty-state">
            <h2>No tienes licencias asociadas</h2>
            <p>Cuando se asigne una licencia a tu usuario, aparecerá aquí.</p>
          </div>
        </section>`;
      return;
    }

    this.container.innerHTML = `
      <section class="wiki-viewer license-viewer" aria-label="Mis licencias">
        <header class="wiki-viewer__header">
          <span class="wiki-viewer__format-badge wiki-viewer__format-badge--license">Licencias</span>
          <h1 class="wiki-viewer__title">Mis licencias</h1>
          <p class="license-viewer__intro">Documentos disponibles para tu usuario en este proyecto.</p>
        </header>
        <div class="license-viewer__layout">
          <nav class="license-list" aria-label="Documentos de licencia">
            ${licenses.map((license, index) => `
              <button class="license-list__item${index === 0 ? ' license-list__item--active' : ''}" data-license-id="${escapeAttr(license.id)}">
                <strong>${escapeHtml(license.filename || license.name || 'Licencia')}</strong>
                <span>${escapeHtml(formatDate(license.expires_at))}</span>
              </button>`).join('')}
          </nav>
          <div class="license-preview" id="license-preview"></div>
        </div>
      </section>`;

    this.container.querySelectorAll('[data-license-id]').forEach((button) => {
      button.addEventListener('click', () => {
        this.container.querySelectorAll('[data-license-id]').forEach((item) => item.classList.remove('license-list__item--active'));
        button.classList.add('license-list__item--active');
        this._showLicense(licenses.find((license) => String(license.id) === button.dataset.licenseId));
      });
    });
    this._showLicense(licenses[0]);
  }

  _showLicense(license) {
    const preview = this.container.querySelector('#license-preview');
    if (!preview || !license) return;
    const previewUrl = licensePreviewUrl(this.projectId, license.id);
    const downloadUrl = licenseDownloadUrl(this.projectId, license.id);
    const mimeType = license.mime_type || '';
    const canEmbed = mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('text/');

    preview.innerHTML = `
      <div class="license-preview__header">
        <div>
          <h2>${escapeHtml(license.filename || license.name || 'Licencia')}</h2>
          <p>${escapeHtml(license.expires_at ? `Vence: ${formatDate(license.expires_at)}` : 'Sin fecha de vencimiento')}</p>
        </div>
        <a class="btn btn--secondary" href="${downloadUrl}" download>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>
          Descargar
        </a>
      </div>
      ${canEmbed
        ? `<iframe class="license-preview__frame" src="${previewUrl}" title="Vista previa de ${escapeAttr(license.filename || 'licencia')}"></iframe>`
        : `<div class="license-preview__unsupported"><p>Este formato no tiene vista previa integrada.</p><a class="btn btn--primary" href="${downloadUrl}" download>Descargar documento</a></div>`}`;
  }
}

function formatDate(value) {
  if (!value) return 'Sin vencimiento';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : `Vence ${date.toLocaleDateString('es-MX')}`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
