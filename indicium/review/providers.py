"""Providers turn a case's notes into one finding per criterion, in a single shared shape.

- BaselineProvider: no language model. The best-ranked sentence per criterion, with a negation
  check. Deterministic and keyless; CI and the demo use it, and evals report it as the bar the
  language models must clear.
- OpenAIProvider: any server that speaks the OpenAI chat completions API (Gemini, llama.cpp,
  Ollama, vLLM, Groq, Azure OpenAI), asked for JSON that matches EXTRACTION_SCHEMA.

Whatever a provider returns is checked afterwards (verify.py); no provider is trusted.
"""

import json
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from string import Template
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel, Field, ValidationError

from indicium.config import Settings, settings
from indicium.policies.model import Criterion, Policy, criteria_of
from indicium.review.retrieval import Embedder, Ranker, embedder, excerpts

PROMPTS = Path(__file__).parent / "prompts"
NEWLINE = chr(10)
USER_MARK = "=== USER ===" + NEWLINE


class Quote(BaseModel):
    doc_id: str
    quote: str


class Finding(BaseModel):
    criterion_id: str
    finding: Literal["documented", "contradicted", "absent", "conflicting"]
    evidence: list[Quote] = []
    confidence: float = Field(ge=0, le=1)
    rationale: str = ""


class Extraction(BaseModel):
    findings: list[Finding]
    suspected_instructions: bool = False


class Concern(BaseModel):
    kind: Literal["exclusion", "scope", "contradiction"]
    criterion_id: str = ""
    doc_id: str
    quote: str
    explanation: str = ""
    # The checker's own verdict, given after it explains the passage: small models also report
    # passages that support approval, and only those against it may stop one.
    against_approval: bool = True


class Concerns(BaseModel):
    concerns: list[Concern]


CONCERNS_SCHEMA = {
    "type": "object",
    "properties": {
        "concerns": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["exclusion", "scope", "contradiction"]},
                    "criterion_id": {"type": "string"},
                    "doc_id": {"type": "string"},
                    "quote": {"type": "string"},
                    "explanation": {"type": "string"},
                    "against_approval": {"type": "boolean"},
                },
                "required": [
                    "kind",
                    "criterion_id",
                    "doc_id",
                    "quote",
                    "explanation",
                    "against_approval",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["concerns"],
    "additionalProperties": False,
}


# Written out by hand (no $refs) so that every OpenAI-compatible server accepts it.
EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                # Order matters: constrained decoding writes fields in this order, so the model
                # quotes, then reasons, then decides, instead of deciding first.
                "properties": {
                    "criterion_id": {"type": "string"},
                    "evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "doc_id": {"type": "string"},
                                "quote": {"type": "string"},
                            },
                            "required": ["doc_id", "quote"],
                            "additionalProperties": False,
                        },
                    },
                    "rationale": {"type": "string"},
                    "finding": {
                        "type": "string",
                        "enum": ["documented", "contradicted", "absent", "conflicting"],
                    },
                    "confidence": {"type": "number"},
                },
                "required": ["criterion_id", "evidence", "rationale", "finding", "confidence"],
                "additionalProperties": False,
            },
        },
        "suspected_instructions": {"type": "boolean"},
    },
    "required": ["findings", "suspected_instructions"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class Document:
    doc_id: str
    kind: str
    written_on: str
    author: str
    text: str  # already masked


@dataclass(frozen=True)
class ExtractionTask:
    policy: Policy
    service: str
    documents: list[Document]


@dataclass
class ProviderResult:
    extraction: Extraction
    provider: str
    model: str
    prompt_version: str
    tokens_in: int = 0
    tokens_out: int = 0
    detail: dict = field(default_factory=dict)


@dataclass
class CheckResult:
    concerns: list[Concern]
    tokens_in: int
    tokens_out: int
    version: str  # which approval-check prompt produced these concerns


class Provider(Protocol):
    def extract(self, task: ExtractionTask) -> ProviderResult: ...


class ProviderError(Exception):
    """The model could not produce a usable answer; the run fails and is retried or escalated."""


def query_for(criterion: Criterion) -> str:
    return f"{criterion.text} {criterion.guidance}".strip()


class BaselineProvider:
    # Fixed when the baseline was written; not tuned on the evaluation set.
    THRESHOLD = 0.45
    # Retrieval can find a real sentence that does not mean what the criterion needs ("AHI 8" for
    # "AHI of at least 15"); only reading can tell. With no calibrated confidence, the baseline
    # reports one below the trust threshold, so it highlights evidence but never approves.
    CONFIDENCE = 0.5
    NEGATION = re.compile(
        r"\b(?:no|not|denies|denied|negative for|without|never|hasn't|has not|did not|didn't|"
        r"absent|none)\b",
        re.IGNORECASE,
    )

    def __init__(self, model: Embedder | None):
        self.model = model

    def extract(self, task: ExtractionTask) -> ProviderResult:
        ranker = Ranker({d.doc_id: d.text for d in task.documents}, self.model)
        findings = []
        for criterion in criteria_of(task.policy.criteria):
            best = ranker.top(query_for(criterion), 1)
            if not best or best[0][0] < self.THRESHOLD:
                findings.append(
                    Finding(criterion_id=criterion.id, finding="absent", confidence=self.CONFIDENCE)
                )
                continue
            sentence = best[0][1]
            findings.append(
                Finding(
                    criterion_id=criterion.id,
                    finding="contradicted" if self.NEGATION.search(sentence.text) else "documented",
                    evidence=[Quote(doc_id=sentence.doc_id, quote=sentence.text)],
                    confidence=self.CONFIDENCE,
                    rationale="Best-matching sentence in the notes; the baseline does not read it.",
                )
            )
        name = "hybrid-retrieval" if self.model else "keyword-retrieval"
        return ProviderResult(Extraction(findings=findings), "baseline", name, "baseline-v1")


class OpenAIProvider:
    RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}

    def __init__(self, s: Settings, client: httpx.Client | None = None, sleep=time.sleep):
        if not (s.openai_base_url and s.openai_model):
            raise ValueError("provider 'openai' needs INDICIUM_OPENAI_BASE_URL and _MODEL")
        key = s.openai_api_key.get_secret_value()
        self.client = client or httpx.Client(
            base_url=s.openai_base_url.rstrip("/") + "/",
            headers={"Authorization": f"Bearer {key}"} if key else {},
            timeout=s.model_timeout_seconds,
        )
        self.model, self.retries, self.sleep = s.openai_model, s.model_max_retries, sleep
        self.prompt_version = s.prompt_version
        self.system, self.user = _prompt(s.prompt_version)
        self.check_version = s.approval_check_version
        self.check_system, self.check_user = _prompt(s.approval_check_version)
        self.budget = s.context_char_budget

    def extract(self, task: ExtractionTask) -> ProviderResult:
        extraction, tokens_in, tokens_out, repaired = self._ask(
            self.system, self._user_message(task), Extraction, EXTRACTION_SCHEMA, "findings"
        )
        return ProviderResult(
            extraction, "openai", self.model, self.prompt_version, tokens_in, tokens_out,
            {"repaired": repaired},
        )  # fmt: skip

    def check_approval(self, task: ExtractionTask, met: list[str]) -> CheckResult:
        criteria = list(criteria_of(task.policy.criteria))
        texts = excerpts(
            {d.doc_id: d.text for d in task.documents},
            [query_for(c) for c in criteria],
            self.budget,
        )
        blocks = {
            "exclusions": [_criterion_block(c) for c in criteria if c.kind == "exclusion"],
            "met": [_criterion_block(c) for c in criteria if c.id in met],
            "documents": [
                _document_block(d, texts[d.doc_id]) for d in task.documents if d.doc_id in texts
            ],
        }
        user = self.check_user.substitute(
            service=_service(task),
            policy_title=task.policy.title,
            exclusions=NEWLINE.join(blocks["exclusions"]) or "(none)",
            met=NEWLINE.join(blocks["met"]) or "(none)",
            documents=(NEWLINE * 2).join(blocks["documents"]),
        )
        concerns, tokens_in, tokens_out, _ = self._ask(
            self.check_system, user, Concerns, CONCERNS_SCHEMA, "concerns"
        )
        return CheckResult(concerns.concerns, tokens_in, tokens_out, self.check_version)

    def _ask(self, system: str, user: str, model, schema: dict, name: str):
        """One schema-constrained question, with one repair turn for output that does not parse.
        Returns (parsed, tokens_in, tokens_out, repaired)."""
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        tokens_in = tokens_out = 0
        for attempt in range(2):
            body = self._post(messages, schema, name)
            usage = body.get("usage") or {}
            tokens_in += usage.get("prompt_tokens") or 0
            tokens_out += usage.get("completion_tokens") or 0
            content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            try:
                parsed = model.model_validate_json(_json_object(content))
                return parsed, tokens_in, tokens_out, attempt > 0
            except (ValidationError, ValueError) as error:
                messages += [
                    {"role": "assistant", "content": content[:20_000]},
                    {"role": "user", "content": f"That was not valid: {str(error)[:500]}. "
                     "Reply with only the JSON object."},
                ]  # fmt: skip
        raise ProviderError("the model returned invalid output twice")

    def _user_message(self, task: ExtractionTask) -> str:
        criteria = list(criteria_of(task.policy.criteria))
        texts = excerpts(
            {d.doc_id: d.text for d in task.documents},
            [query_for(c) for c in criteria],
            self.budget,
        )
        return self.user.substitute(
            service=_service(task),
            policy_title=task.policy.title,
            criteria="\n".join(_criterion_block(c) for c in criteria),
            documents="\n\n".join(
                _document_block(d, texts[d.doc_id]) for d in task.documents if d.doc_id in texts
            ),
        )

    def _post(self, messages: list[dict], schema: dict, name: str) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": name, "schema": schema, "strict": True},
            },
        }
        for attempt in range(self.retries + 1):
            try:
                response = self.client.post("chat/completions", json=payload)
            except httpx.TransportError as error:  # timeouts and connection failures
                if attempt == self.retries:
                    raise ProviderError(f"model server unreachable: {error}") from error
                self.sleep(_backoff(attempt, None))
                continue
            if response.status_code < 400:
                return response.json()
            if response.status_code not in self.RETRY_STATUS or attempt == self.retries:
                raise ProviderError(
                    f"model server answered {response.status_code}: {response.text[:300]}"
                )
            self.sleep(_backoff(attempt, response.headers.get("retry-after")))
        raise AssertionError("unreachable")


def _service(task: ExtractionTask) -> str:
    """The code and what it means ("72148, MRI lumbar spine without contrast"): a bare code does
    not tell a model which body region the request is about."""
    described = {p.code: p.description for p in task.policy.procedure_codes}
    description = described.get(task.service, "")
    return f"{task.service}, {description.lower()}" if description else task.service


def _prompt(version: str) -> tuple[str, Template]:
    system, _, user = (PROMPTS / f"{version}.md").read_text("utf-8").partition(USER_MARK)
    if not user:
        raise ValueError(f"prompt {version} has no user section")
    return system.strip(), Template(user)


def _backoff(attempt: int, retry_after: str | None) -> float:
    if retry_after and retry_after.isdigit():
        return min(float(retry_after), 60)
    return min(2**attempt, 30) + random.random()  # noqa: S311 - jitter, not security


def _json_object(content: str) -> str:
    """The JSON object in a reply, ignoring code fences or text around it."""
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end < start:
        raise ValueError("no JSON object in the reply")
    return content[start : end + 1]


def _criterion_block(c: Criterion) -> str:
    kind = "exclusion" if c.kind == "exclusion" else "required"
    lines = [f"- id: {c.id} ({kind})", f"  statement: {c.text}"]
    if c.guidance:
        lines.append(f"  guidance: {c.guidance}")
    return "\n".join(lines)


def _document_block(d: Document, text: str) -> str:
    # A note must not be able to close its own tag and write outside it.
    safe = re.sub(r"</\s*document", "</ document", text, flags=re.IGNORECASE)
    attributes = " ".join(
        f'{k}="{json.dumps(v)[1:-1]}"'
        for k, v in {
            "id": d.doc_id,
            "kind": d.kind,
            "date": d.written_on,
            "author": d.author,
        }.items()
        if v
    )
    return f"<document {attributes}>\n{safe}\n</document>"


def provider_from_settings(s: Settings | None = None) -> Provider:
    s = s or settings()
    if s.provider == "openai":
        return OpenAIProvider(s)
    return BaselineProvider(embedder())
