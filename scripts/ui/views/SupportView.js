import { getState } from '../../store/state.js';
import { getCachedUser } from '../../auth/session.js';
import { createSupportTicket, listSupportTickets, listTicketArticles, replyToTicket, reopenTicket } from '../../api/support.js';
import { replace } from '../router.js';

export class SupportView {
  constructor(container, projectId = null) {
    this.container = container;
    this.projectId = projectId ? String(projectId) : null;
    this.tickets = [];
    this.chatTicket = null;
    this.chatPoll = null;
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
          <div class="support-heading"><span class="support-eyebrow">Atención al usuario</span><h1>Soporte</h1><p>Consulta el estado de tus reportes o conversa con el equipo de soporte.</p></div>
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
    return `<div class="support-section__heading"><h2>Nuevo reporte</h2><button class="btn btn--ghost btn--sm" id="cancel-ticket">Cancelar</button></div><form class="support-form" id="support-form"><label>Asunto<input name="title" required maxlength="120" placeholder="Describe brevemente el problema" /></label><label>Sistema o proyecto<input name="system" required maxlength="120" value="${escapeAttr(projectName)}" /></label><label>Prioridad<select name="priorityId"><option value="2">Alta</option><option value="3" selected>Media</option><option value="4">Baja</option></select></label><label>Descripción<textarea name="body" required maxlength="10000" rows="6" placeholder="¿Qué ocurrió? Incluye pasos para reproducirlo."></textarea></label><button class="btn btn--primary" id="support-submit" type="submit">Enviar reporte</button><p class="support-form__status" id="support-status" role="status"></p></form>`;
  }

  async _loadTickets() {
    try { this.tickets = await listSupportTickets(); this._renderTickets(); }
    catch (error) { document.getElementById('ticket-list').innerHTML = `<p class="support-form__status support-form__status--error">${escapeHtml(error.message)}</p>`; }
  }

  _renderTickets() {
    const list = document.getElementById('ticket-list');
    if (!this.tickets.length) { list.innerHTML = '<p class="support-empty">Todavía no tienes reportes.</p>'; return; }
    list.innerHTML = this.tickets.map((ticket) => `<button class="ticket-card" data-ticket-id="${ticket.id}"><span class="ticket-card__number">#${escapeHtml(ticket.number)}</span><strong>${escapeHtml(ticket.title)}</strong><span class="ticket-status ticket-status--${statusClass(ticket.state)}">${escapeHtml(ticket.state || 'Sin estado')}</span><time>${formatDate(ticket.updated_at || ticket.created_at)}</time></button>`).join('');
    list.querySelectorAll('.ticket-card').forEach((card) => card.addEventListener('click', () => this._openChat(card.dataset.ticketId)));
  }

  _showForm() {
    const section = document.getElementById('support-form-section'); section.hidden = false;
    document.getElementById('cancel-ticket').addEventListener('click', () => { section.hidden = true; });
    document.getElementById('support-form').addEventListener('submit', (event) => this._submit(event));
  }

  async _submit(event) {
    event.preventDefault(); const form = event.currentTarget; const status = document.getElementById('support-status');
    document.getElementById('support-submit').disabled = true; status.textContent = 'Enviando…';
    try { const values = Object.fromEntries(new FormData(form)); const ticket = await createSupportTicket({ title: values.title, system: values.system, priorityId: Number(values.priorityId), body: values.body }); status.className = 'support-form__status support-form__status--success'; status.textContent = `Reporte creado${ticket.number ? ` (#${ticket.number})` : ''}.`; form.reset(); await this._loadTickets(); }
    catch (error) { status.className = 'support-form__status support-form__status--error'; status.textContent = error.message; document.getElementById('support-submit').disabled = false; }
  }

  async _openChat(ticketId) {
    clearInterval(this.chatPoll);
    this.chatPoll = null;
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
      if (!closed) this._startChatPolling(ticket.id);
    }
    catch (error) { chat.innerHTML = `<p class="support-form__status support-form__status--error">${escapeHtml(error.message)}</p>`; }
  }

  _chatMarkup(ticket, ticketId, articles, closed) {
    const messages = articles.length
    ? articles.map((article) => `<article class="chat-message chat-message--${messageOwner(article)}"><div class="chat-message__body">${renderArticleBody(article.body)}</div><time>${formatDate(article.created_at)}</time></article>`).join('')
      : '<p class="support-empty">Aún no hay mensajes visibles.</p>';
    const composer = closed
      ? '<div class="chat-closed"><strong>Este ticket está cerrado.</strong><p>El chat está bloqueado. Puedes reabrirlo si el problema continúa.</p><form class="reopen-form" id="reopen-form"><label>Motivo<select name="reason" required><option value="">Selecciona un motivo</option><option value="Continua">La falla continúa</option><option value="Otro Error">La solución causó otro error</option><option value="Claridad">No queda clara la solución</option><option value="Similar">Otro error similar</option></select></label><textarea name="message" required rows="3" placeholder="Explica por qué necesitas reabrir el ticket…"></textarea><button class="btn btn--primary btn--sm" type="submit">Reabrir ticket</button></form></div>'
      : '<form class="chat-form" id="chat-form"><textarea name="message" required rows="3" placeholder="Escribe tu mensaje para soporte…"></textarea><button class="btn btn--primary btn--sm" type="submit">Enviar mensaje</button></form>';
    return `<div class="support-section__heading"><h2>Conversación #${escapeHtml(ticket?.number || ticketId)}</h2><button class="btn btn--ghost btn--sm" id="close-chat">Cerrar</button></div><div class="chat-messages">${messages}</div>${composer}`;
  }

  async _sendMessage(event, ticket) {
    event.preventDefault(); const form = event.currentTarget; const body = new FormData(form).get('message');
    try { await replyToTicket(ticket.id, body); await this._loadTickets(); await this._openChat(ticket.id); }
    catch (error) { alert(error.message); }
  }

  _closeChat() {
    clearInterval(this.chatPoll);
    this.chatPoll = null;
    this.chatTicket = null;
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
      const nextMarkup = articles.length ? articles.map((article) => `<article class="chat-message chat-message--${messageOwner(article)}"><div class="chat-message__body">${renderArticleBody(article.body)}</div><time>${formatDate(article.created_at)}</time></article>`).join('') : '<p class="support-empty">Aún no hay mensajes visibles.</p>';
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
