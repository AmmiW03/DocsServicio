import { listProjects } from '../../api/projects.js';
import { checkAdmin, uploadLicense } from '../../api/licenses.js';
import { replace } from '../router.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('admin');

export class AdminLicensesView {
  constructor(container) {
    this.container = container;
    this.projects = [];
  }

  async init() {
    let admin = false;
    try {
      admin = await checkAdmin();
    } catch (error) {
      log.warn('No fue posible validar permisos de administrador', { message: error.message });
    }
    if (!admin) {
      this._renderForbidden();
      return;
    }
    this._render();
    await this._loadProjects();
  }

  _render() {
    this.container.innerHTML = `
      <div class="admin-view">
        <header class="topbar">
          <div class="topbar__brand">
            <button class="topbar__back" id="admin-back" aria-label="Volver a proyectos" title="Volver a proyectos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
            <span class="topbar__title">Gestión de licencias</span>
          </div>
        </header>
        <main class="admin-main">
          <div class="admin-heading">
            <span class="admin-eyebrow">Panel de administración</span>
            <h1>Subir licencia</h1>
            <p>Asocia un archivo PDF de licencia a un cliente. El documento se almacena de forma segura en el repositorio GitLab privado y el cliente podrá descargarlo desde su perfil.</p>
          </div>
          <section class="admin-section">
            <form class="admin-form" id="license-form">
              <label>Proyecto
                <select name="project_id" id="license-project" required>
                  <option value="">Selecciona un proyecto…</option>
                  ${this.projects.map((project) => `<option value="${escapeAttr(project.id)}">${escapeHtml(project.path_with_namespace || project.name_with_namespace || project.name)}</option>`).join('')}
                </select>
              </label>
              <label>Cliente (username de GitLab)
                <input name="gitlab_username" required maxlength="120" placeholder="ej: juan.perez" autocomplete="off" />
              </label>
              <label>Vencimiento
                <input name="expires_at" type="date" />
              </label>
              <label>Archivo PDF
                <input name="file" type="file" accept="application/pdf,.pdf" required />
              </label>
              <div class="admin-form__actions">
                <button class="btn btn--primary" id="license-submit" type="submit">Subir licencia</button>
              </div>
              <p class="admin-form__status" id="license-status" role="status"></p>
            </form>
          </section>
        </main>
      </div>`;
    document.getElementById('admin-back').addEventListener('click', () => replace('/projects'));
    document.getElementById('license-form').addEventListener('submit', (event) => this._submit(event));
  }

  _renderForbidden() {
    this.container.innerHTML = `
      <div class="admin-view">
        <main class="admin-main" style="display:flex;min-height:100vh;align-items:center;justify-content:center">
          <div class="error-state">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="12" y1="9" x2="12" y2="15"/></svg>
            <h2>Acceso restringido</h2>
            <p>Solo los administradores pueden gestionar licencias.</p>
            <button class="btn btn--primary" id="admin-back-forbidden">Volver a proyectos</button>
          </div>
        </main>
      </div>`;
    document.getElementById('admin-back-forbidden').addEventListener('click', () => replace('/projects'));
  }

  async _loadProjects() {
    try {
      this.projects = await listProjects();
      const select = document.getElementById('license-project');
      if (select) {
        select.innerHTML = `<option value="">Selecciona un proyecto…</option>${this.projects
          .map((project) => `<option value="${escapeAttr(project.id)}">${escapeHtml(project.path_with_namespace || project.name_with_namespace || project.name)}</option>`)
          .join('')}`;
      }
      log.info(`Proyectos disponibles para licencias: ${this.projects.length}`);
    } catch (error) {
      log.error('Fallo al cargar proyectos', { message: error.message });
    }
  }

  async _submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('license-status');
    const button = document.getElementById('license-submit');
    const file = form.elements.file;
    if (file?.files?.[0] && !/\.pdf$/i.test(file.files[0].name)) {
      status.className = 'admin-form__status admin-form__status--error';
      status.textContent = 'El documento debe ser un archivo PDF.';
      return;
    }

    button.disabled = true;
    status.className = 'admin-form__status';
    status.textContent = 'Subiendo a GitLab…';
    try {
      const license = await uploadLicense(new FormData(form));
      status.className = 'admin-form__status admin-form__status--success';
      status.textContent = `Licencia subida y almacenada en GitLab${license?.id ? ` (${license.id})` : ''}.`;
      form.reset();
      log.info('Licencia subida', { id: license?.id, projectId: license?.project_id, username: license?.gitlab_username });
    } catch (error) {
      status.className = 'admin-form__status admin-form__status--error';
      status.textContent = error.message || 'No se pudo subir la licencia.';
      log.error('Fallo al subir licencia', { message: error.message });
    } finally {
      button.disabled = false;
    }
  }
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}