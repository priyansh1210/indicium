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
   `refer_to_clinician` or `pend_for_info`, never to `meets_criteria`.
4. **Everything is audited.** Every model run (provider, model, prompt version, policy version,
   input hash, output), every edit to a checklist and every decision is written to an
   append-only audit log in the same transaction as the change it records.
5. **Text from notes is data.** Notes are delimited in prompts, scanned for instructions, and
   nothing in them can change a rule above.

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
               nurse review ── checklist with highlighted evidence; edit any item with a
                               reason; approve, pend, or refer to a physician
```

Reviews run in a worker. The `review.runs` table is the queue (`for update skip locked`), so
more workers can be added without new infrastructure.

## Model providers

One interface, three implementations, chosen per run:
- `baseline`: no model. Sentence embeddings plus negation rules. Deterministic, needs no key;
  CI and the demo use it, and the evals report it as the baseline the language models must beat.
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
| Tracing | OpenTelemetry spans per review step; Langfuse when configured |
| Evals | labelled synthetic cases, criterion-level F1, unsafe approvals, grounding, latency, cost |
| CI | GitHub Actions: lint, tests, evals on the baseline, Docker build, browser tests |
| Deploy | Azure Container Apps + Azure Database for PostgreSQL |

## Roles

`viewer` (read only), `nurse` (review, edit checklist, approve, pend, refer), `physician`
(everything a nurse can, plus deny), `admin` (users, policies). Every route declares its role.

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
