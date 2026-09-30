# Validation of package v2

Completed with Node.js 24.19.0:

- All 18 domain/HTTP integration tests pass.
- The demonstration runs two complete syncs: each reports 4 fetched, 3 sent and 1 deliberately failed; the destination remains at 3 records and 3 writes.
- The lost-response test commits once, drops the response, retries and confirms one record and one write.
- The SuiteScript handler is tested through the same source file used by the mock server, including create, unchanged replay, update, stale event and version conflict.
- Pagination loop/origin guards, redirect rejection, bounded retry exhaustion, Retry-After handling, timeout classification and malformed responses are covered.
- Event logs are checked for the sample private fields and authentication strings.
- JavaScript syntax checks pass.

The tests validate a local simulator and explicit in-memory adapters. They do not validate deployment, production certificates, permissions, governance limits, vendor behaviour or concurrent writes inside a real NetSuite account. The HTTP receipt cache is mock middleware, not a native NetSuite Idempotency-Key guarantee.
