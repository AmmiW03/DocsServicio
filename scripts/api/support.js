/**
 * Support requests are handled by the application server, which keeps the
 * Zammad token out of the browser.
 */

export function createSupportTicket(formData) {
  return fetch('/api/support/tickets', { method: 'POST', credentials: 'same-origin', body: formData }).then(parseResponse);
}

export function replyToTicket(ticketId, formData) {
  return fetch(`/api/support/tickets/${ticketId}/reply`, { method: 'POST', credentials: 'same-origin', body: formData }).then(parseResponse);
}

export async function listSupportTickets(projectId) {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
  const response = await fetch(`/api/support/tickets${query}`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

export async function listTicketArticles(ticketId) {
  const response = await fetch(`/api/support/tickets/${ticketId}/articles`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}

export async function reopenTicket(ticketId, reason, body) {
  const response = await fetch(`/api/support/tickets/${ticketId}/reopen`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, body }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
  return result;
}

export function articleAttachmentUrl(ticketId, articleId, attachmentId) {
  return `/api/support/tickets/${ticketId}/articles/${articleId}/attachments/${attachmentId}`;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body;
}