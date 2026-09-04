import { getState } from '../../store/state.js';
import { getCachedUser } from '../../auth/session.js';
import { createSupportTicket, listSupportTickets, listTicketArticles, replyToTicket, reopenTicket, articleAttachmentUrl } from '../../api/support.js';
import { replace } from '../router.js';

const MAX_CHAT_FILES = 4;

export class SupportView {
  constructor(container, projectId = null) {
    this.container = container;
    this.projectId = projectId ? String(projectId) : null;
    this.tickets = [];
    this.chatTicket = null;
    this.chatPoll = null;
    this.chatFiles = [];
  }

  async init() {
    this.project = getState('projects')?.find((item) => String(item.id) === this.projectId);
    this._render();
    await this._loadTickets();
  }

  _render() {
    this.container.innerHTML = `
      <div class="support-view">
        <header class="topbar"><div class="topbar__brand"><button class="topbar__back" id="support-back" aria-label="Volver a proyectos" title="Volver a proyectos"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><span class="topbar__title">Soporte</span></div></header>
        <main class="support-main">
          <div class="support-heading"><span class="support-eyebrow">Atención al usuario</span><h1>Soporte</h1><p>Consulta el estado de los reportes de <strong>${escapeHtml(this.project?.name || 'este proyecto')}</strong> o conversa con el equipo de soporte.</p></div>
          <section class="support-section"><div class="support-section__heading"><h2>Mis reportes</h2><button class="btn btn--secondary btn--sm" id="new-ticket">Nuevo reporte</button></div><div id="ticket-list" class="ticket-list"><p class="support-loading">Cargando tickets…</p></div></section>
          <section class="support-form-section" id="support-form-section" hidden>${this._formMarkup()}</section>
          <section class="support-chat" id="support-chat" hidden></section>
        </main>
      </div>`;
    document.getElementById('support-back').addEventListener('click', () => replace('/projects'));
    document.getElementById('new-ticket').addEventListener('click', () => this._showForm());
  }

  _formMarkup() {
    const projectName = this.project?.name || '';
    return `<div class="support-section__heading"><h2>Nuevo reporte</h2><button class="btn btn--ghost btn--sm" id="cancel-ticket">Cancelar</button></div><form class="support-form" id="support-form"><label>Asunto<input name="title" required maxlength="120" placeholder="Describe brevemente el problema" /></label><label>Sistema o proyecto<input name="system" required maxlength="120" value="${escapeAttr(projectName)}" /></label><label>Prioridad<select name="priorityId"><option value="2">Alta</option><option value="3" selected>Media</option><option value="4">Baja</option></select></label><label>Descripción<textarea name="body" required maxlength="10000" rows="6" placeholder="¿Qué ocurrió? Incluye pasos para reproducirlo."></textarea></label><label>Evidencia (imágenes o PDF, opcional)<input name="attachments" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" multiple /></label><button class="btn btn--primary" id="support-submit" type="submit">Enviar reporte</button><p class="support-form__status" id="support-status" role="status"></p></form>`;
  }

  async _loadTickets() {
    try { this.tickets = await listSupportTickets(this.projectId); this._renderTickets(); }
    catch (error) { document.getElementById('ticket-list').innerHTML = `<p class="support-form__status support-form__status--error">${escapeHtml(error.message)}</p>`; }
  }

  _renderTickets() {
    const list = document.getElementById('ticket-list');
    if (!this.tickets.length) { list.innerHTML = '<p class="support-empty">Todavía no tienes reportes para este proyecto.</p>'; return; }
    list.innerHTML = this.tickets.map((ticket) => `<button class="ticket-card" data-ticket-id="${ticket.id}"><span class="ticket-card__number">#${escapeHtml(ticket.number)}</span><strong>${escapeHtml(ticket.title)}</strong><span class="ticket-status ticket-status--${statusClass(ticket.state)}">${escapeHtml(ticket.state || 'Sin estado')}</span><time>${formatDate(ticket.updated_at || ticket.created_at)}</time></button>`).join('');
    list.querySelectorAll('.ticket-card').forEach((card) => card.addEventListener('click', () => this._openChat(card.dataset.ticketId)));
  }

  _showForm() {
    const section = document.getElementById('support-form-section'); section.hidden = false;
    document.getElementById('cancel-ticket').addEventListener('click', () => { section.hidden = true; });
    document.getElementById('support-form').addEventListener('submit', (event) => this._submit(event));
  }

  async _submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.getElementById('support-status');
    document.getElementById('support-submit').disabled = true;
    status.className = 'support-form__status';
    status.textContent = 'Enviando…';
    try {
      const ticket = await createSupportTicket(new FormData(form));
      status.className = 'support-form__status support-form__status--success';
      status.textContent = `Reporte creado${ticket.number ? ` (#${ticket.number})` : ''}.`;
      form.reset();
      await this._loadTickets();
    } catch (error) {
      status.className = 'support-form__status support-form__status--error';
      status.textContent = error.message;
      document.getElementById('support-submit').disabled = false;
    }
  }

  async _openChat(ticketId) {
    clearInterval(this.chatPoll);
    this.chatPoll = null;
    this.chatFiles = [];
    const chat = document.getElementById('support-chat'); chat.hidden = false; chat.innerHTML = '<p class="support-loading">Cargando conversación…</p>';
    try {
      const articles = await listTicketArticles(ticketId);
      const ticket = this.tickets.find((item) => String(item.id) === String(ticketId));
      const closed = isClosed(ticket?.state);
      chat.innerHTML = this._chatMarkup(ticket, ticketId, articles, closed);
      this.chatTicket = ticket;
      document.getElementById('close-chat').addEventListener('click', () => this._closeChat());
      const form = document.getElementById(closed ? 'reopen-form' : 'chat-form');
      form.addEventListener('submit', (event) => closed ? this._reopen(event, ticket) : this._sendMessage(event, ticket));
      if (!closed) this._wireChatAttachments();
    }
    catch (error) { chat.innerHTML = `<p class="support-form__status support-form__status--error">${escapeHtml(error.message)}</p>`; }
  }

  _chatMarkup(ticket, ticketId, articles, closed) {
    const messages = articles.length
      ? articles.map((article) => `<article class="chat-message chat-message--${messageOwner(article)}"><div class="chat-message__body">${renderArticleBody(article.body)}</div>${renderArticleAttachments(article, ticketId)}<time>${formatDate(article.created_at)}</time></article>`).join('')
      : '<p class="support-empty">Aún no hay mensajes visibles.</p>';
    const composer = closed
      ? '<div class="chat-closed"><strong>Este ticket está cerrado.</strong><p>El chat está bloqueado. Puedes reabrirlo si el problema continúa.</p><form class="reopen-form" id="reopen-form"><label>Motivo<select name="reason" required><option value="">Selecciona un motivo</option><option value="Continua">La falla continúa</option><option value="Otro Error">La solución causó otro error</option><option value="Claridad">No queda clara la solución</option><option value="Similar">Otro error similar</option></select></label><textarea name="message" required rows="3" placeholder="Explica por qué necesitas reabrir el ticket…"></textarea><button class="btn btn--primary btn--sm" type="submit">Reabrir ticket</button></form></div>'
      : '<form class="chat-form" id="chat-form"><div class="chat-form__row"><label class="chat-form__attach" title="Adjuntar evidencia (imágenes o PDF)"><input type="file" id="chat-file-input" name="attachments" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" multiple hidden /><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></label><textarea name="message" required rows="3" placeholder="Escribe tu mensaje para soporte…"></textarea><button class="btn btn--primary btn--sm" type="submit">Enviar</button></div><ul class="chat-attachments" id="chat-attachments" hidden></ul></form>';
    return `<div class="support-section__heading"><h2>Conversación #${escapeHtml(ticket?.number || ticketId)}</h2><button class="btn btn--ghost btn--sm" id="close-chat">Cerrar</button></div><div class="chat-messages">${messages}</div>${composer}`;
  }

  async _sendMessage(event, ticket) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = new FormData(form).get('message');
    if (!String(message || '').trim()) return;
    const fd = new FormData();
    fd.append('body', String(message).trim());
    for (const file of this.chatFiles) fd.append('files', file);
    try {
      await replyToTicket(ticket.id, fd);
      this.chatFiles = [];
      await this._loadTickets();
      await this._openChat(ticket.id);
    } catch (error) { alert(error.message); }
  }

  _wireChatAttachments() {
    const input = document.getElementById('chat-file-input');
    if (!input) return;
    input.addEventListener('change', () => {
      const selected = [...(input.files || [])];
      this.chatFiles = [...this.chatFiles, ...selected].slice(0, MAX_CHAT_FILES);
      input.value = '';
      this._renderChatAttachments();
    });
  }

  _renderChatAttachments() {
    const list = document.getElementById('chat-attachments');
    if (!list) return;
    list.hidden = this.chatFiles.length === 0;
    list.innerHTML = this.chatFiles.map((file, index) => `
      <li class="chat-attachment-pill">
        <span title="${escapeAttr(file.name || 'adjunto')}">${escapeHtml(file.name || 'adjunto')}</span>
        <button type="button" data-remove-chat-file="${index}" aria-label="Quitar archivo">&#215;</button>
      </li>`).join('');
    list.querySelectorAll('[data-remove-chat-file]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const index = Number(event.currentTarget.dataset.removeChatFile);
        this.chatFiles.splice(index, 1);
        this._renderChatAttachments();
      });
    });
  }

  _closeChat() {
    clearInterval(this.chatPoll);
    this.chatPoll = null;
    this.chatTicket = null;
    this.chatFiles = [];
    document.getElementById('support-chat').hidden = true;
  }

  _startChatPolling(ticketId) {
    clearInterval(this.chatPoll);
    this.chatPoll = setInterval(() => this._refreshMessages(ticketId), 2000);
  }

  async _refreshMessages(ticketId) {
    if (document.hidden || !this.chatTicket) return;
    try {
      const articles = await listTicketArticles(ticketId);
      const messages = document.querySelector('.chat-messages');
      if (!messages) return;
      const nextMarkup = articles.length ? articles.map((article) => `<article class="chat-message chat-message--${messageOwner(article)}"><div class="chat-message__body">${renderArticleBody(article.body)}</div>${renderArticleAttachments(article, ticketId)}<time>${formatDate(article.created_at)}</time></article>`).join('') : '<p class="support-empty">Aún no hay mensajes visibles.</p>';
      if (messages.dataset.content !== nextMarkup) {
        const wasAtBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
        messages.innerHTML = nextMarkup;
        messages.dataset.content = nextMarkup;
        if (wasAtBottom) messages.scrollTop = messages.scrollHeight;
      }
    } catch { }
  }

  async _reopen(event, ticket) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try { await reopenTicket(ticket.id, values.reason, values.message); await this._loadTickets(); await this._openChat(ticket.id); }
    catch (error) { alert(error.message); }
  }
}

function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }
function renderArticleBody(value) {
  const body = String(value || '');
  if (window.DOMPurify) return window.DOMPurify.sanitize(body, { ALLOWED_TAGS: ['a', 'br', 'p', 'strong', 'em', 'ul', 'ol', 'li'], ALLOWED_ATTR: ['href', 'title', 'target', 'rel'] });
  return escapeHtml(body).replace(/\n/g, '<br>');
}
function renderArticleAttachments(article, ticketId) {
  const list = Array.isArray(article.attachments) ? article.attachments : [];
  if (!list.length) return '';
  const items = list.map((attachment) => {
    const url = articleAttachmentUrl(ticketId, article.id, attachment.id);
    const isImage = String(attachment.mimeType || '').startsWith('image/');
    if (isImage) {
      return `<a class="chat-attachment chat-attachment--image" href="${escapeAttr(url)}" target="_blank" rel="noopener" title="${escapeAttr(attachment.filename || 'imagen')}"><img src="${escapeAttr(url)}" alt="${escapeAttr(attachment.filename || 'adjunto')}" loading="lazy" /></a>`;
    }
    return `<a class="chat-attachment chat-attachment--file" href="${escapeAttr(url)}" download>${escapeHtml(attachment.filename || 'adjunto')}</a>`;
  }).join('');
  return `<div class="chat-attachment-list">${items}</div>`;
}
function messageOwner(article) {
  if (article.owner === 'customer') return 'customer';
  if (article.owner === 'support') return 'support';
  if (article.is_customer === true) return 'customer';
  if (article.is_customer === false) return 'support';
  const userEmail = getCachedUser()?.email || getCachedUser()?.public_email;
  return article.from && userEmail && article.from.toLowerCase().includes(userEmail.toLowerCase()) ? 'customer' : 'support';
}
function statusClass(value) { return String(value || '').toLowerCase().replace(/[^a-záéíóú]+/g, '-').replace(/^-|-$/g, '') || 'unknown'; }
function isClosed(value) { const state = typeof value === 'object' ? value?.name : value; return ['closed', 'cerrado'].includes(String(state || '').toLowerCase()); }
function formatDate(value) { return value ? new Date(value).toLocaleDateString('es-MX') : ''; }