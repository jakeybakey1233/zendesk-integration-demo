# Zendesk → NetSuite RESTlet integration demo

[![Tests](https://github.com/jakeybakey1233/zendesk-integration-demo/actions/workflows/tests.yml/badge.svg)](https://github.com/jakeybakey1233/zendesk-integration-demo/actions/workflows/tests.yml)

A local integration simulator inspired by the Zendesk, NetSuite and API integration work I carried out at **Fourth**. It fetches fictional tickets, signs a PS256 client assertion, maps a small set of fields, and executes a SuiteScript RESTlet handler against an in-memory NetSuite adapter.

**[Fourth experience case study](docs/case-study.md)** · [Architecture and failure handling](docs/architecture.md) · [RESTlet schema](netsuite/README.md)

## Run it

Node.js 22 or newer. No packages, credentials or vendor accounts are needed.

```bash
npm run demo
npm test
```

The demo runs the same batch twice. On the first pass, three records succeed, one recovers from an injected HTTP 503, and one produces a deliberate permanent error. On the replay, the three successful records reuse their receipts:

```text
FIRST SYNC: pagination, a transient retry and a permanent error
... tickets_fetched: 4
... ticket_retry: 2003, HTTP 503
... sync_complete: fetched 4, sent 3, failed 1
REPLAY: the same successful records must not be written twice
... ticket_sent: replayed true
... destination_state: records 3, writes 3
```

Detailed output is newline-delimited JSON. The failure is an intentional teaching scenario, so `npm run demo` exits successfully when the expected state is verified.

## What this demonstrates

- **Pagination:** follows offset `next_page` responses with origin, path, loop and page-count guards.
- **Authentication:** signs and verifies PS256 JWT client assertions with a disposable in-memory RSA key.
- **Field mapping:** validates ticket IDs, statuses and timestamps; selects explicit fields instead of forwarding whole tickets.
- **Real handler logic:** `netsuite/ticket-sync-restlet.js` contains SuiteScript 2.1 record search, validation and create/update decisions. The simulator executes this same file through explicit `N/record`, `N/search` and `N/error` adapters.
- **Resilience:** bounded exponential backoff with jitter, `Retry-After` support, timeout/network retry classification and permanent-error isolation.
- **Replay protection:** request receipts prevent a duplicate write after a committed response is lost. Keys change for new payload versions.
- **Version handling:** the RESTlet ignores stale events, treats identical versions as unchanged, and rejects conflicting payloads with the same timestamp.
- **Observability:** per-ticket outcomes, attempt counts and summaries without raw payloads or authentication material.

## Failure tests

Tests cover normal pagination, 503 recovery, 429 waits, exhausted retries, malformed JSON, HTTP redirects, unsafe next-page links, request timeouts, lost responses after commit, idempotency conflicts and RESTlet create/update/stale-event behaviour.

A lost-response test is particularly useful: the target has already written a record before the connection is dropped. A retry succeeds from its stored receipt while the record and write counts both remain **one**.

## Local-only boundary

Every URL is checked before a request. Only literal loopback hosts are allowed; the runner requires one mock-server origin; redirects are rejected. Signing keys never reach disk, and committed tokens are obvious dummy values.

This is a portfolio simulator, **not a live NetSuite connector**. The mock uses vendor-shaped paths, but real account authentication, certificates, permissions and error formats require their own configuration and review. Field selection is not anonymisation: real ticket subjects can contain personal information. Keep the fixtures fictional.

## Layout

```text
src/auth.mjs                  PS256 assertion signing
src/http.mjs                  Loopback boundary, timeouts and safe error types
src/clients.mjs               Pagination, token exchange and stable request keys
src/transform.mjs             Explicit field selection and validation
src/sync.mjs                  Orchestration, retries and structured events
netsuite/ticket-sync-restlet.js SuiteScript validation and record upsert
mock/netsuite-adapter.mjs      In-memory implementations of the used N/* APIs
mock/server.mjs               Fictional ticket/auth services and fault injection
scripts/run-demo.mjs           Two-pass demonstration with write-count assertion
tests/integration.test.mjs     Domain and HTTP integration regressions
```

## Experience and provenance

At Fourth I worked on Zendesk-to-NetSuite cloud integration, Zendesk-to-Salesforce middleware, REST APIs, RESTlets, SuiteScripts and cross-system administration. The exact fields, ticket workflow, JWT configuration and failure fixtures in this repository are independent demonstration choices, not claims about Fourth's production implementation.

This original public example was developed with AI assistance. It contains no employer source, customer records or live credentials. MIT applies to this example; Zendesk and NetSuite are their respective owners' trademarks. No affiliation or endorsement is implied.
