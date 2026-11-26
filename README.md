# Indicium

[![ci](https://github.com/priyansh1210/indicium/actions/workflows/ci.yml/badge.svg)](https://github.com/priyansh1210/indicium/actions/workflows/ci.yml)

A prior-authorization review assistant. A utilization-management nurse opens a request; Indicium
has already turned the matching Medicare coverage policy into a checklist and quoted, for every
item, the exact sentence in the clinical notes that supports it, highlighted in the note. It
recommends **meets criteria**, **pend for information** or **refer to a physician**. It never
denies: a nurse decides, and only a physician reviewer can deny.

All data is synthetic or public. Policies come from the public CMS Medicare Coverage Database;
patients and notes are synthetic. No real patient data is used anywhere.

![A knee replacement request: each checklist item quotes its evidence, highlighted in the X-ray report](docs/images/case-review.png)

![A request whose note carries instructions aimed at an automated reviewer: the case goes to a person and the line is underlined](docs/images/flagged-case.png)

More: [welcome page](docs/images/welcome.png) · [worklist](docs/images/worklist.png) ·
[policy with its source sentences](docs/images/policy.png) · [phone](docs/images/phone.png).
Screens show synthetic cases reviewed by a local Qwen3-4B model.

## What it guarantees, in code, not in a prompt

- **No invented evidence.** Every quote a model returns is located word for word in its note
  (after normalising whitespace, case, quote marks and dashes). Quotes that are not found are
  dropped; an item with no surviving quote counts as not documented.
- **No automatic denial.** The decision rules can only output meets criteria, pend or refer.
  "Denied" requires the physician role, checked by the API and by a database constraint.
- **A wrong approval costs more than a referral.** A would-be approval gets a second, narrow model
  pass that looks only for reasons against it (an exclusion that applies, notes about another
  body site, contradictions). Any verified passage refers the case to a person.
- **Uncertainty goes to a person.** Low confidence, conflicting notes, an uncovered diagnosis code
  and text in a note that addresses an automated reviewer all refer the case.
- **Patient identifiers never reach the model.** Name, member id and birth date are masked before
  any text leaves the process, and quotes are mapped back to the original note for highlighting.
- **Everything is audited.** Every review (model, prompt and policy version, input hash), every
  checklist correction (with a reason) and every decision is written to an append-only audit log
  in the same transaction as the change.

## Results

48 labelled synthetic cases across four policies, 8 of them adversarial (prompt injection,
conflicting notes, wrong body region, buried evidence, no documents). Full table and per-case
results: [reports/evals](reports/evals/README.md); method: [docs/evals.md](docs/evals.md).

| Configuration | Criterion F1 | Evidence hit | Case accuracy | Unsafe approvals | Quotes discarded | Median time |
|---|---|---|---|---|---|---|
| Keyless baseline (retrieval, no model) | 0.66 | 0.63 | 0.42 | 0 (never approves) | 0% | 0.2 s |
| Qwen3-4B, no approval check | 0.93 | 0.92 | 0.81 | 7 | 0% | 28 s |
| **Qwen3-4B + approval check (default)** | **0.94** | **0.92** | **0.90** | **3** | **0%** | **27 s** |
| Qwen2.5-1.5B + approval check | 0.57 | 0.54 | 0.42 | 2 | 38% | 11 s |

Qwen models run locally (Q4 GGUF, llama.cpp) on a 4 GB laptop GPU. What the runs showed, and
what changed because of them:

- The extraction model under-reported **exclusions** (an infection at the surgical site, a
  dental abscess, a poor response to a prior injection): 5 of its 7 unsafe approvals. The
  approval check was added for this and cut unsafe approvals from 7 to 3 without losing a single
  valid approval.
- A first version of the check also referred valid cases, because a small model reported
  passages that *support* approval. Asking it to explain each passage before judging it
  (reasoning-first output order) removed those false referrals.
- A prompt with stricter confidence guidance improved criterion F1 slightly but pushed many
  answers under the trust threshold, referring correct cases; it was not adopted.
- With the 1.5B model, 38% of quotes were invented. Verification discarded every one before a
  reviewer could see it, which is the reason that check exists.
- 3 unsafe approvals remain with the 4B model (conflicting notes, notes about the wrong body
  region, an undocumented response marked present). Every recommendation is advisory and every
  case is decided by a nurse; a stronger model plugs in through configuration, and the same
  harness measures it.

## How it works

```mermaid
flowchart LR
    A[EHR / portal<br/>JSON or FHIR R4] -->|API key| P[Caddy proxy]
    N[Nurse / physician] --> P
    P --> W[Next.js web]
    P --> API[FastAPI]
    W --> API
    API --> DB[(PostgreSQL<br/>+ pgvector)]
    API -->|queue| DB
    K[Review workers] -->|skip locked| DB
    K --> M[Model: llama.cpp / Gemini /<br/>any OpenAI-compatible]
    C[CMS Coverage API] -->|import| API
```

1. **Policies** are data: a versioned tree of required criteria and exclusions, imported from a
   CMS Local Coverage Determination. Each criterion quotes the policy sentence it comes from,
   checked by the same quote verifier. Adding a procedure means adding a policy, not code.
2. **Intake** accepts JSON or a FHIR R4 Bundle, validates it, stores the case with its decision
   deadline (72 hours expedited, 7 days standard) and queues a review in the same transaction.
3. **Review workers** claim cases from a Postgres queue (`for update skip locked`, leases and
   attempt fencing, retries with backoff), so any number can run. Each review masks identifiers,
   asks the model for one finding per criterion with quotes, verifies every quote, applies the
   decision rules and, for would-be approvals, runs the approval check.
4. **The nurse screen** shows the checklist beside the notes; choosing an item highlights its
   sentence, and choosing a highlight selects its item. Nurses correct items with a reason and
   approve, pend or refer; physicians decide referred cases.

Design and phase plan: [docs/architecture.md](docs/architecture.md).

## Run it

Requirements: Docker. Nothing needs an API key.

```sh
docker compose up --build --wait
```

Open http://localhost:8080. Visitors without a session land on a short tour of how a review
works, with a live example. On the sign-in page, "Exploring Indicium? Use a sample account"
offers one sign-in per role. The demo loads the four policies and the 48 synthetic cases, and
the worker reviews them with the keyless baseline (retrieval only; it highlights evidence and
never approves on its own).

Accounts work as they would in production: an admin invites people from Admin → People, each
person chooses their own password from the emailed link, can reset a forgotten one and can turn
on two-step sign-in (an authenticator app). Locally every email lands in Mailpit at
http://localhost:8025; set `INDICIUM_SMTP_URL` to send real mail. The first admin of a real
deployment is created from the command line:
`INDICIUM_PASSWORD=... python -m indicium.api.users create EMAIL "NAME" admin`.

### With a language model

Any OpenAI-compatible endpoint works. For a local model with llama.cpp:

```sh
llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --alias qwen3-4b -ngl 99 -c 12288 --port 8081
INDICIUM_PROVIDER=openai INDICIUM_OPENAI_MODEL=qwen3-4b \
INDICIUM_OPENAI_BASE_URL=http://host.docker.internal:8081/v1 docker compose up --build --wait
```

For Gemini, set `INDICIUM_OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`,
`INDICIUM_OPENAI_MODEL` and `INDICIUM_OPENAI_API_KEY`.

## Develop

```sh
uv sync && uv run pytest -q          # needs Docker: database tests use a throwaway Postgres
uv run ruff check . && uv run ruff format --check .
cd web && pnpm install && pnpm lint && pnpm build
pnpm exec playwright test            # against the running stack
uv run python -m indicium.evals run baseline && uv run python -m indicium.evals report
```

CI runs lint, the Python suite, the web build, and the whole stack from a clean start with the
browser tests against it.

## Operations

- One public entry point (Caddy); the API, database and metrics stay on the private network.
- JSON logs with a request id on every line and response; Prometheus metrics at `/metrics`
  (queue depth, oldest queued review, overdue cases, reviews and tokens per hour, approvals per
  hour) read from the database so every replica agrees; OpenTelemetry traces per request and per
  review step, exported to Langfuse or any OTLP backend when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- Settings are environment variables (`INDICIUM_*`), validated at start.
- Deploys to Azure Container Apps + Azure Database for PostgreSQL from one Bicep template:
  [docs/deploy.md](docs/deploy.md).

## Project layout

```
indicium/policies   policy model, CMS importer, versioned store
indicium/cases      request model, FHIR intake, labelled dataset
indicium/review     masking, injection scan, retrieval, providers, verification, rules, worker
indicium/api        FastAPI routes, auth and permissions
indicium/evals      evaluation harness
web/                Next.js welcome page, nurse and physician screens (design: web/DESIGN.md)
data/               policies (from CMS) and synthetic cases
reports/evals       saved evaluation runs
```

## Limitations

- 48 cases written by one author: evidence about specific failure modes, not a population
  estimate. A held-out set written by someone else is the next step.
- The local 4B model is slow on a 4 GB laptop GPU (about 30 s per case).
- Policies are a reviewed subset of each LCD's criteria, drafted from the CMS text by hand.
