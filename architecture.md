# Architecture, retries and destination consistency

```mermaid
sequenceDiagram
  participant App as Integration app
  participant Z as Mock Zendesk API
  participant Auth as Mock token API
  participant Target as Mock RESTlet adapter
  App->>Z: Fetch paginated fictional tickets
  Z-->>App: Tickets and next_page links
  App->>Auth: Exchange signed PS256 assertion
  Auth-->>App: Dummy bearer token
  loop Each ticket
    App->>App: Validate and select fields
    App->>Target: POST record with request key
    Target->>Target: Receipt check and SuiteScript upsert
    Target-->>App: Result or simulated failure
    App->>App: Retry selected faults; log outcome
  end
  App->>App: Aggregate successful and failed tickets
```

## Request boundary

`requestJSON` allows only `127.0.0.1` and `[::1]`, rejects embedded URL credentials and refuses redirects. `runSync` requires the ticket, token and destination endpoints to share the local mock origin. Pagination additionally pins the resource path, detects repeated links and stops after 100 pages.

These guards belong to this local teaching example. They are not a production API client configuration mechanism.

## Retry policy

Only destination sends are retried. Transient statuses are 429, 500, 502, 503 and 504; classified network errors and timeouts are also retryable. Authentication and ticket-fetch failures stop the batch. Invalid JSON, validation failures and other permanent statuses are not repeatedly sent.

Retry count is bounded to three attempts by default. Exponential delays use full jitter. A valid Retry-After header takes precedence, including HTTP-date values. A server wait above the demo's 30-second retry budget is surfaced as a failure rather than shortened. Sleep, clock and random sources can be injected for deterministic tests.

## Two consistency layers

1. **Mock HTTP receipts:** a key derived from the selected record identifies the same request. A stored receipt returns the prior result. Reusing a key with a different body returns a conflict. The lost-response scenario commits and stores its receipt before disconnecting.
2. **SuiteScript upsert decisions:** records are found by source external ID. Identical source versions are unchanged, older events are ignored, and newer events update the same record. A changed payload with an unchanged source timestamp is rejected.

The HTTP receipt cache is **mock middleware behaviour**, not a claim that NetSuite automatically honours an Idempotency-Key header. Its state is in memory and is lost when the simulator exits. The SuiteScript lookup/update sequence is not an atomic distributed transaction. A production system needs durable receipts and an appropriate concurrency or uniqueness strategy; this example does not claim exactly-once delivery.

## Adapter boundary

`mock/netsuite-adapter.mjs` evaluates only the committed RESTlet file, not user-supplied code. It supplies the used record/search/error interfaces. This keeps the destination decisions in one source file while allowing local tests. The adapters do not reproduce all NetSuite behaviour.

## Logging and privacy

Events include fictional ticket IDs, destination IDs, actions, retry counts and safe error codes. Raw exception messages, JWTs, tokens and record bodies are not logged. The field map drops sample email and private-note fields, but real subject text would still need its own privacy policy.

## Vendor references

- [Zendesk offset pagination](https://developer.zendesk.com/documentation/api-basics/pagination/paginating-through-lists-using-offset-pagination/) — this small demo uses next-page responses; cursor/incremental export is a separate production decision.
- [NetSuite client assertion structure](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162790605110.html) — account certificates, claims and scopes must follow the provider configuration.
- [NetSuite RESTlet example](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4634148062.html) — reference for the SuiteScript RESTlet module/entry-point pattern.
