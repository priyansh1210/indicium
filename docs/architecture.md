# Indicium architecture

Indicium helps a utilization-management nurse review a prior-authorization request. It reads the
request and the clinical notes, finds the coverage policy that applies, turns the policy into a
checklist, and quotes the sentence in the notes that supports each item. It recommends
**meets criteria** or **pend for more information**. It never denies. A nurse makes every decision,
and only a physician reviewer can issue a denial.

All data is synthetic or public. Policies come from the public CMS Medicare Coverage Database;
patients and notes are generated. No real patient data is ever used.

## Guarantees enforced in code, never in a prompt

1. **No invented evidence.** Every quote the model returns is located in the source note after
   normalization (whitespace, quote marks, case). A quote that is not found is dropped and
   recorded; a criterion marked "met" with no surviving quote becomes "not found".
2. **No automatic denial.** The decision rules can only produce `meets_criteria`,
   `pend_for_info` or `refer_to_clinician`. Deny exists only as a human decision by the
   `physician` role.
3. **Uncertainty goes to a person.** Low confidence, contradicting evidence, a suspected
   instruction hidden in a note, a missing policy or a failed model call all lead to
   `refer_to_clinician` or `pend_for_info`, never to `meets_criteria`. A would-be approval also
   passes an approval check that can only refer, never approve (evals showed the extraction
   model under-reports exclusions; see docs/evals.md).
4. **Everything is audited.** Every model run (provider, model, prompt version, policy version,
   input hash, output), every edit to a checklist and every decision is written to an
   append-only audit log in the same transaction as the change it records.
5. **Text from notes is data.** Notes are delimited in prompts, scanned for instructions, and
   nothing in them can change a rule above.

## System design principles

Every phase is checked against these before it is called done.

| Principle | How Indicium applies it |
|---|---|
| Stateless services | API and worker keep no state in memory between requests; all state is in Postgres. Any replica can serve any request, so both scale horizontally. |
| Asynchronous work behind a queue | A review (seconds to minutes of model calls) never runs inside an HTTP request. The API enqueues; workers claim jobs with `for update skip locked`, so adding workers adds throughput without coordination. |
| Idempotency | Submitting the same request twice (same idempotency key or content hash) returns the existing case. A job retried after a crash produces one result, not two. |
| Backpressure and bounded resources | Fixed-size connection pools, request body limits, per-provider concurrency and rate limits, queue depth visible in metrics. Overload answers 503 with Retry-After instead of hanging. |
| Failure isolation | A failing model provider or CMS API fails one job with a recorded error, retried with backoff, never the API. Timeouts on every outbound call. |
| Consistency where it matters | A state change and its audit row commit in one transaction. Case status moves only along allowed transitions, checked in the database. |
| Versioned, immutable inputs | Policy versions and prompt versions are immutable once used; every review records exactly which ones it used, so any past result can be explained and reproduced. |
| Configuration from the environment | One image for every environment; behaviour changes through `INDICIUM_*` variables validated at start (12-factor). |
| Observability | Structured logs with request and case ids, metrics (latency, queue depth, model tokens and errors), traces per review step. |
| Defense in depth | Authentication, role checks on every route, proxy as the only entry point, least-privilege containers, untrusted note text kept out of control flow. |
| Graceful degradation | No model key: the baseline provider still produces a checklist. No embeddings: keyword retrieval still runs. Nothing silently approves when a part is missing. |
| Evolvability | Providers, policies and procedures plug in as data or one interface; schema changes are forward-only migrations. |

## Nothing is hard-coded per procedure

A policy is data: a versioned **criteria tree** (all / any / at-least-n groups over leaf
criteria), the billing codes it covers, and the source text each criterion was drawn from.
Adding a procedure means importing or writing a policy, not writing code. The same engine, eval
harness and UI work for any policy.

Policies enter in two ways:
- **Import** from the CMS Coverage API (`api.coverage.cms.gov`, no key; a one-hour license token).
  The LCD text is stored, a model drafts the criteria tree, and each drafted criterion must quote
  its source sentence in the LCD (checked by the same quote verifier). The draft is reviewed,
  edited and published by an admin. Only published versions are used for reviews.
- **Write** a policy file (YAML) and load it.

## Flow of one review

```
request + notes ──► intake (validate, hash, mask identifiers)
                    │
                    ▼
               policy match ── billing code → published policy version
                    │          (no code match: semantic search over policy text, flagged)
                    ▼
               note retrieval ── split notes into sentences with offsets; per criterion,
                    │            rank sentences (embeddings + keywords), keep the top k
                    ▼
               extraction (model) ── per criterion: status, evidence quotes, confidence,
                    │                rationale; schema-validated, retried on invalid output
                    ▼
               verification ── quote located in note? relevant to the criterion?
                    │           instruction-like text in the notes?
                    ▼
               decision rules ── evaluate the tree with three values (met / not met /
                    │            unknown) → recommendation + reasons
                    ▼
               approval check ── only for a would-be approval: a second, narrow model call
                    │            looks for exclusions, wrong body site or service, and
                    │            contradictions; any verified quote sends it to a person
                    ▼
               nurse review ── checklist with highlighted evidence; edit any item with a
                               reason; approve, pend, or refer to a physician
```

Reviews run in a worker. The `review.runs` table is the queue (`for update skip locked`), so
more workers can be added without new infrastructure.

## Model providers

One interface, three implementations, chosen per run:
- `baseline`: no model. Sentence embeddings plus negation rules. Deterministic, needs no key;
  CI and the demo use it, and the evals report it as the baseline the language models must beat.
  Retrieval can find a real sentence that does not mean what a criterion needs, so the baseline
  reports a confidence below the trust threshold: it highlights evidence and never approves.
- `openai`: any OpenAI-compatible endpoint (Gemini, Ollama, llama.cpp, vLLM, Groq, Azure OpenAI).
- Every call has a timeout, retries with backoff on rate limits and server errors, and a token
  count recorded on the run.

## Components

| Part | Technology |
|---|---|
| API and worker | Python 3.12, FastAPI, psycopg 3 (plain SQL), Pydantic, one image |
| Database | PostgreSQL 17 with pgvector; schema changes as Alembic migrations in plain SQL |
| Embeddings | fastembed (ONNX, no PyTorch), model baked into the image |
| Web | Next.js nurse and admin screens |
| Proxy | Caddy, the only public entry point |
| Observability | JSON logs with request ids; Prometheus `/metrics` read from the database; OpenTelemetry spans per request and review step, exported over OTLP (Langfuse, Jaeger, Tempo) when configured |
| Evals | labelled synthetic cases, criterion-level F1, unsafe approvals, grounding, latency, cost |
| CI | GitHub Actions: lint, tests, evals on the baseline, Docker build, browser tests |
| Deploy | Azure Container Apps + Azure Database for PostgreSQL |

## Roles

Permissions, not a ladder: `viewer` reads; `nurse` submits, corrects checklist items (with a
reason, append-only) and approves, pends or refers; `physician` can also decide referred cases,
which is the only path to a denial (also enforced by a database constraint); `supervisor` watches
the queue and assigns work without deciding; `admin` manages policies, people and API keys and
makes no clinical decisions.

Staff accounts are invited, never self-registered: an admin names the person and role, and the
person chooses a password from a one-use emailed link (only its hash is stored). Resets work the
same way and sign out every session. Two-step sign-in uses authenticator codes (RFC 6238), each
accepted once. Changing a role or deactivating someone ends their sessions at once. Email is
written to an outbox table in the same transaction as the change that causes it and sent by the
worker, retried with backoff; a sent message keeps no body.

Practices use the provider portal. A practice registers itself (its NPI must pass the check
digit; its first person confirms their email) and adds colleagues; its people have the
`provider` role, which can submit requests and follow only its own practice's (`track`). They
see the status in plain words, the history, the documents they sent and each decision's reason,
never the checklist, the model's output or reviewers' notes. A pended request is answered by
sending documents, which queues a new review. Each decision is emailed to the practice in the
same transaction that records it. Machine clients (an EHR or a provider portal)
use API keys that can only submit. Every route declares its permission, and a test fails if a
new route is reachable without signing in.

## Phases

Each phase ends with its tests passing, a review, a whole-repo audit and a shortcut ledger, then a
commit.

| # | Phase | Done when |
|---|---|---|
| 0 | Foundation: repo, config, database, migrations, health, CI | stack starts, CI green |
| 1 | Policies: criteria tree model, YAML loader, CMS import, versioning, seed policies | policies load and validate; import works against the live API |
| 2 | Cases: synthetic patients and notes, labels, adversarial cases, FHIR bundle intake | dataset validates against its policies |
| 3 | Review engine: retrieval, providers, extraction, verification, decision rules, worker | every guarantee above has a failing-when-broken test |
| 4 | API: auth, roles, cases, reviews, decisions, overrides, audit, SLA timers | end-to-end case through the API |
| 5 | Nurse and admin UI | browser tests pass on desktop and phone |
| 6 | Evals: harness, metrics, model and prompt comparison, CI gate | report generated; baseline gate in CI |
| 7 | Safety and operations: injection, contradiction and missing-note suites, tracing, metrics, rate limits | safety suite green |
| 8 | Ship: Azure deploy, README, demo | live URL |
