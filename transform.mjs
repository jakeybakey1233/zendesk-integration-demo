/** Select fields explicitly. Selection is not an anonymisation guarantee for real data. */
export function mapTicket(ticket) {
  const fail = () => { throw Object.assign(new TypeError('Invalid source ticket'), { code: 'INVALID_TICKET' }); };
  if (!Number.isSafeInteger(ticket?.id) || ticket.id < 1 || typeof ticket.subject !== 'string' || !ticket.subject.trim()) fail();
  if (!['new', 'open', 'pending', 'hold', 'solved', 'closed'].includes(ticket.status)) fail();
  if (ticket.priority != null && !['low', 'normal', 'high', 'urgent'].includes(ticket.priority)) fail();
  if (typeof ticket.updated_at !== 'string' || !Number.isFinite(Date.parse(ticket.updated_at))) fail();
  return { zendesk_id: ticket.id, subject: ticket.subject.trim().slice(0, 150), status: ticket.status,
    priority: ticket.priority ?? 'normal', updated_at: new Date(ticket.updated_at).toISOString() };
}
