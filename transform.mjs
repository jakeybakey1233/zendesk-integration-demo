/** Minimal allowlisted mapping: never copy a whole customer-support ticket. */
export function mapTicket(ticket) {
  if (!Number.isSafeInteger(ticket?.id) || typeof ticket.subject !== 'string') {
    throw new TypeError('Ticket is missing a valid ID or subject');
  }
  const allowedStatuses = new Set(['new', 'open', 'pending', 'hold', 'solved', 'closed']);
  return {
    zendesk_id: ticket.id,
    subject: ticket.subject.slice(0, 150),
    status: allowedStatuses.has(ticket.status) ? ticket.status : 'unknown',
    priority: ['low', 'normal', 'high', 'urgent'].includes(ticket.priority) ? ticket.priority : 'normal',
    updated_at: typeof ticket.updated_at === 'string' ? ticket.updated_at : null
  };
}
