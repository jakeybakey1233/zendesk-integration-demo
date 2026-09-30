# Fourth — platform integration and automation

## Professional context

At Fourth I designed and maintained integrations and APIs across platforms including Zendesk, NetSuite, Salesforce and Jitterbit. My work included a Zendesk-to-NetSuite cloud integration, Zendesk-to-Salesforce middleware, REST APIs, RESTlets, NetSuite extensions and SuiteScripts. I also worked on platform administration, automation rules, incident handling and cross-system synchronisation.

That work required reasoning about data crossing system boundaries: which fields a receiving system needs, how a record is identified, what happens when an API call fails, and how to investigate a partial synchronisation.

## Public demonstration

This repository rebuilds a small ticket-to-record workflow with fictional data. Its field map, custom-record schema, client-assertion settings and fault scenarios were chosen for the demonstration. They are not a disclosure of Fourth's data model or a record of the exact authentication method used there.

| Demonstration choice | Engineering question it makes visible |
| --- | --- |
| Explicit ticket-field selection | What information does the destination actually need? |
| Source ID plus version-aware updates | Does a replay create a duplicate or change the existing record? |
| Lost response after a successful commit | Can the caller retry without repeating the write? |
| Bounded retries and Retry-After | Which failures justify another attempt, and when? |
| Permanent per-ticket failure | Can a bad record fail without hiding the remaining outcomes? |
| Structured event logs | Can the run be understood without exposing payloads or tokens? |
| Shared SuiteScript source in the simulator | Are the demonstrated destination decisions actually executable? |

## Scope and evidence

The local mock runs the committed SuiteScript handler against adapters for the specific NetSuite APIs it calls. This verifies the handler's decision logic and simulated interactions. It does not validate deployment inside a NetSuite account, governance consumption, permission configuration or production concurrency behaviour.

The tests and demo logs show observable results for the public reconstruction. No employer performance metrics or business-outcome figures are invented. A production integration would additionally need durable state, operational monitoring, incremental export/checkpointing, deployment configuration and a concurrency strategy suitable for its target platform.
