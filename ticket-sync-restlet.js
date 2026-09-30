/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * Independent portfolio example. Custom record and field IDs are fictional.
 * The local simulator executes this same source against in-memory N/* adapters.
 */
define(['N/record', 'N/search', 'N/error'], (record, search, error) => {
  const TYPE = 'customrecord_demo_support_ticket';
  const FIELDS = {
    subject: 'custrecord_demo_subject', status: 'custrecord_demo_status',
    priority: 'custrecord_demo_priority', updated: 'custrecord_demo_source_updated',
    payload: 'custrecord_demo_source_payload'
  };
  const allowed = ['zendesk_id', 'subject', 'status', 'priority', 'updated_at'];
  const fail = (name, message) => { throw error.create({ name, message, notifyOff: true }); };

  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_RECORD', 'Expected a record object.');
    if (Object.keys(input).some(key => !allowed.includes(key))) fail('UNEXPECTED_FIELD', 'Unexpected mapped field.');
    if (!Number.isSafeInteger(input.zendesk_id) || input.zendesk_id < 1) fail('INVALID_RECORD', 'Expected a positive ticket ID.');
    if (typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 150) fail('INVALID_RECORD', 'Expected a subject of 1 to 150 characters.');
    if (!['new', 'open', 'pending', 'hold', 'solved', 'closed'].includes(input.status)) fail('INVALID_RECORD', 'Unrecognised ticket status.');
    if (!['low', 'normal', 'high', 'urgent'].includes(input.priority)) fail('INVALID_RECORD', 'Unrecognised priority.');
    if (typeof input.updated_at !== 'string' || !Number.isFinite(Date.parse(input.updated_at))) fail('INVALID_RECORD', 'Expected a source timestamp.');
    return { zendesk_id: input.zendesk_id, subject: input.subject.trim(), status: input.status,
      priority: input.priority, updated_at: new Date(input.updated_at).toISOString() };
  }

  function post(input) {
    const mapped = validate(input);
    const externalId = `demo-zendesk-${mapped.zendesk_id}`;
    const rows = search.create({ type: TYPE, filters: [['externalidstring', 'is', externalId]], columns: ['internalid'] })
      .run().getRange({ start: 0, end: 1 });
    const id = rows.length ? rows[0].getValue({ name: 'internalid' }) : null;
    const target = id ? record.load({ type: TYPE, id, isDynamic: false }) : record.create({ type: TYPE, isDynamic: false });
    const fingerprint = JSON.stringify(mapped);
    if (id) {
      const current = target.getValue({ fieldId: FIELDS.updated });
      if (current && Date.parse(current) > Date.parse(mapped.updated_at)) {
        return { success: true, record_id: String(id), action: 'ignored', reason: 'STALE_UPDATE' };
      }
      if (current && Date.parse(current) === Date.parse(mapped.updated_at)) {
        if (target.getValue({ fieldId: FIELDS.payload }) === fingerprint) return { success: true, record_id: String(id), action: 'unchanged' };
        fail('VERSION_CONFLICT', 'Different payloads share the same source timestamp.');
      }
    }
    target.setValue({ fieldId: 'externalid', value: externalId });
    target.setValue({ fieldId: 'name', value: `Ticket ${mapped.zendesk_id}` });
    target.setValue({ fieldId: FIELDS.subject, value: mapped.subject });
    target.setValue({ fieldId: FIELDS.status, value: mapped.status });
    target.setValue({ fieldId: FIELDS.priority, value: mapped.priority });
    target.setValue({ fieldId: FIELDS.updated, value: mapped.updated_at });
    target.setValue({ fieldId: FIELDS.payload, value: fingerprint });
    return { success: true, record_id: String(target.save({ enableSourcing: false, ignoreMandatoryFields: false })), action: id ? 'updated' : 'created' };
  }
  return { post };
});
