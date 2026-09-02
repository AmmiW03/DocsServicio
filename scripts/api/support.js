/**
 * Support requests are handled by the application server, which keeps the
 * Zammad token out of the browser.
 */

import { post } from './client.js';

export function createSupportTicket(body) {
  return post('/support/tickets', body);
}

export async function listSupportTickets() {
  const response = await fetch('/api/support/tickets', { credentials: 'same-origin', cache: 'no-store' });
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

export function replyToTicket(ticketId, body) {
  return post(`/support/tickets/${ticketId}/reply`, { body });
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