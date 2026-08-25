/**
 * @view AuthView
 * Configuration screen for GitLab OAuth + PKCE login flow.
 *
 * Responsibilities:
 *   1. Render GitLab URL + Client ID form
 *   2. Initiate the PKCE authorization redirect
 *   3. Handle the OAuth callback (?code= + ?state=) after GitLab redirects back
 */

import { navigate } from '../router.js';
import { createLogger, downloadLogs } from '../../lib/logger.js';

const log = createLogger('auth');

export class AuthView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
  }

  async init() {
    log.debug('Mostrando formulario de conexión con GitLab');
    this._renderForm();
  }

  _renderForm() {
    this.container.innerHTML = `
      <div class="auth-view" id="auth-view">
        <div class="auth-card">
          <div class="auth-card__logo" aria-hidden="true"></div>
          <div class="auth-card__header">
            <h1 class="auth-card__title">GitLab Wiki Client</h1>
            <p class="auth-card__subtitle">Inicia sesión con tu cuenta de GitLab.</p>
          </div>
          <form class="auth-form" id="auth-form">
            <p class="form-hint">GitLab gestionará tu usuario, contraseña, MFA o SSO. Tus credenciales no pasan por esta aplicación.</p>
            <button class="btn btn--primary btn--lg btn--full" type="submit" id="auth-submit-btn">
              Conectar con GitLab
            </button>
          </form>
          <div class="auth-card__footer"><p>Autenticación segura mediante OAuth 2.0.</p></div>
        </div>
      </div>
    `;
    document.getElementById('auth-form').addEventListener('submit', (event) => {
      event.preventDefault();
      this._startAuth();
    });
  }

  _startAuth() {
    const button = document.getElementById('auth-submit-btn');
    button.disabled = true;
    button.textContent = 'Redirigiendo…';
    window.location.href = '/auth/login';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _showError(message) {
    const box = document.getElementById('auth-error');
    if (!box) return;
    box.textContent = message;
    box.hidden      = false;
  }

  _setCallbackMessage(msg) {
    const el = document.getElementById('auth-callback-message');
    if (el) el.textContent = msg;
  }

  _showCallbackError(message, withLogs = false) {
    this.container.innerHTML = `
      <div class="auth-view" id="auth-view">
        <div class="auth-card">
          <div class="auth-error-state">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <h2>Error de autenticación</h2>
            <p>${escapeHtml(message)}</p>
            <div style="display:flex;gap:.75rem">
              <button class="btn btn--primary" id="auth-retry-btn">Intentar de nuevo</button>
              ${withLogs ? '<button class="btn btn--ghost" id="auth-logs-btn">Descargar logs</button>' : ''}
            </div>
          </div>
        </div>
      </div>
    `;
    document.getElementById('auth-retry-btn').addEventListener('click', () => {
      navigate('/auth');
    });
    if (withLogs) {
      document.getElementById('auth-logs-btn').addEventListener('click', () => downloadLogs());
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateRandomString(len) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => b.toString(16).padStart(2,'0')).join('').slice(0, len);
}
