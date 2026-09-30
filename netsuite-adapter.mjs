import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Execute the committed SuiteScript source with a small, explicit in-memory API adapter. */
export function createLocalRestlet() {
  const records = new Map();
  let sequence = 0;
  let writes = 0;
  const wrap = (id, initial = {}) => {
    const fields = { ...initial };
    return {
      getValue: ({ fieldId }) => fields[fieldId],
      setValue: ({ fieldId, value }) => { fields[fieldId] = value; },
      save: () => {
        for (const [existingId, existing] of records) {
          if (existing.externalid === fields.externalid && existingId !== id) throw Object.assign(new Error('Duplicate external ID'), { code: 'DUPLICATE_EXTERNAL_ID' });
        }
        const savedId = id ?? `EXAMPLE-${++sequence}`;
        records.set(savedId, { ...fields }); writes++;
        return savedId;
      }
    };
  };
  const modules = {
    'N/record': { create: () => wrap(null), load: ({ id }) => wrap(id, records.get(id)) },
    'N/search': { create: ({ filters }) => ({ run: () => ({ getRange: () => {
      const externalId = filters[0][2];
      const match = [...records].find(([, value]) => value.externalid === externalId);
      return match ? [{ getValue: () => match[0] }] : [];
    } }) }) },
    'N/error': { create: ({ name, message }) => Object.assign(new Error(message), { code: name, name }) }
  };
  let handler;
  const source = readFileSync(new URL('../netsuite/ticket-sync-restlet.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { define: (dependencies, factory) => { handler = factory(...dependencies.map(id => modules[id])); } },
    { filename: 'ticket-sync-restlet.js', timeout: 1000 });
  return { post: input => handler.post(input), records, get writes() { return writes; } };
}
