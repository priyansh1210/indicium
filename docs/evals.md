# How Indicium is evaluated

Results: [reports/evals/README.md](../reports/evals/README.md), generated from the per-case run
files next to it. Every number there can be traced to a saved run.

## Dataset

48 synthetic prior-authorization requests (`data/cases`) across the four shipped policies
(lumbar MRI, epidural steroid injection, primary knee arthroplasty, CPAP), plus 8 adversarial
cases. No real patient data.

Each case carries, for every criterion of its policy, a label: `documented`, `contradicted`,
`absent` or `conflicting`, with the exact sentence(s) that prove it, and the expected
recommendation. Labels are set when the case is written (the notes are written to match), and
tests check that:

- every labelled evidence sentence is found word for word in its note (the same quote finder the
  engine uses), and
- the expected recommendation follows from the labels through the decision rules.

"Contradicted" is used only when a note states the opposite; silence is "absent". Cases cover
every path through each policy tree and deliberate traps: negated red flags, thresholds one unit
away (AHI 14 vs 15, 24 events vs 30), date order (evaluation after the sleep test), telehealth vs
in person, exclusions far from the main note (a dental abscess before knee surgery), uncovered
diagnosis codes, instructions aimed at the reviewer inside a note, notes that disagree, notes
about the wrong body region, evidence buried in a long visit, copy-forward duplication,
typographic Unicode, and a request with no documents. Outcomes are balanced: 18 meet criteria,
11 pend, 19 refer.

Limitation: 48 cases written by one author. Numbers are evidence about these failure modes, not a
population estimate; a held-out set written by someone else is the next step.

## What is measured

| Metric | Meaning |
|---|---|
| Criterion F1 | "documented" is the positive class (a claim that a criterion is met) |
| Criterion accuracy | all four findings |
| Evidence hit | of verified quotes on documented/contradicted findings, the share that overlap a labelled evidence sentence |
| Quotes discarded | quotes the model gave that were not found word for word, thrown away before anyone sees them |
| Case accuracy | recommendation vs label |
| Unsafe approvals | "meets criteria" where the label is pend or refer. **Target 0.** |
| Injection caught | adversarial cases with instructions aimed at the reviewer that were flagged |
| Latency, tokens | per case, including the approval check when it runs |

Every run goes through the production engine: identifier masking, the provider, quote
verification, the decision rules and (when on) the approval check.

## Configurations

- `baseline`: no language model. Hybrid retrieval (bge-small embeddings + word overlap) and a
  negation rule. It reports a confidence below the trust threshold, so it never approves.
- `qwen3-4b-*`: Qwen3-4B-Instruct-2507 (Q4_K_M GGUF) served locally by llama.cpp with
  schema-constrained JSON output, on a 4 GB laptop GPU. Prompts `extract-v1` and `extract-v2`
  (v2 adds an explicit procedure and stricter confidence guidance), with the approval check off,
  `approval-check-v1` (any verified passage refers) and `approval-check-v2` (the checker explains
  each passage, then says whether it argues against approval).
- `qwen2.5-1.5b-final`: a smaller model in the default configuration, for comparison.

## What the runs decided

- The default is `extract-v1` with `approval-check-v2`: it had the best case accuracy and no
  wrongly referred approvals, with the same unsafe approvals as the strict check.
- `extract-v2` was not adopted: its confidence guidance pushed correct answers below the trust
  threshold, so correct cases were referred.
- The model is told what the requested service code means (from the policy's code list), because
  a bare code ("72148") does not say which body region the request is about.
- Runs before that change are marked in the results table; compare rows with the same notes.
- Run-to-run variation is real even at temperature 0 on a local server (the strict and v1-check
  runs differ by two unsafe approvals on the same configuration apart from service descriptions);
  48 cases cannot separate configurations closer than that.

## Run it

```sh
uv run python -m indicium.evals run baseline
INDICIUM_PROVIDER=openai INDICIUM_OPENAI_BASE_URL=http://127.0.0.1:8081/v1 \
INDICIUM_OPENAI_MODEL=qwen3-4b \
uv run python -m indicium.evals run qwen3-4b-final
uv run python -m indicium.evals report
```

Any OpenAI-compatible server works (Gemini, Ollama, vLLM, Groq, Azure OpenAI). CI runs the
keyless gate (`tests/test_evals.py`): a perfect scripted model must score 1.0 everywhere, invented
quotes must be discarded and never approve, and the baseline must make no unsafe approval.
