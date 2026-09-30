# SuiteScript RESTlet example

`ticket-sync-restlet.js` is an independent SuiteScript 2.1 handler using `N/record`, `N/search` and `N/error`. The local simulator executes this same source with in-memory adapters. It is not deployed to a real account.

## Fictional schema

| Record/field | Suggested type in a dedicated test account | Meaning |
| --- | --- | --- |
| `customrecord_demo_support_ticket` | Custom record | Demo destination record |
| `externalid` | Standard external ID | `demo-zendesk-<ticket ID>` |
| `name` | Standard name | Human-readable ticket label |
| `custrecord_demo_subject` | Free-form text | Selected subject, up to 150 characters |
| `custrecord_demo_status` | Free-form text | Validated source status |
| `custrecord_demo_priority` | Free-form text | Validated source priority |
| `custrecord_demo_source_updated` | Free-form text | Canonical ISO source timestamp |
| `custrecord_demo_source_payload` | Long text | Canonical selected payload for replay/conflict comparison |

The handler accepts only ID, subject, status, priority and update timestamp. It searches by external ID, then creates or updates the matching record. Newer timestamps can update it; older ones cannot overwrite it; same-time differing payloads produce a conflict.

## Deployment boundary

The table documents a possible **dedicated test schema**, not an existing employer schema. Creating account records, deploying the script, mapping certificates/roles and connecting live APIs are outside this package. The local HTTP adapter also translates errors differently from a real RESTlet response.

Before any adaptation, review account permissions, search visibility, custom-record uniqueness, parallel update behaviour, governance limits and durable replay/checkpoint handling. The source demonstrates decisions; the local tests do not prove production compatibility or account security.
