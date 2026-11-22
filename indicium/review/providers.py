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


# Written out by hand (no $refs) so that every OpenAI-compatible server accepts it.
EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "criterion_id": {"type": "string"},
                    "finding": {
                        "type": "string",
                        "enum": ["documented", "contradicted", "absent", "conflicting"],
                    },
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
                    "confidence": {"type": "number"},
                    "rationale": {"type": "string"},
                },
                "required": ["criterion_id", "finding", "evidence", "confidence", "rationale"],
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
        system, _, user = (
            (PROMPTS / f"{s.prompt_version}.md").read_text("utf-8").partition("=== USER ===\n")
        )
        if not user:
            raise ValueError(f"prompt {s.prompt_version} has no '=== USER ===' section")
        self.system, self.user = system.strip(), Template(user)
        self.budget = s.context_char_budget

    def extract(self, task: ExtractionTask) -> ProviderResult:
        messages = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": self._user_message(task)},
        ]
        tokens_in = tokens_out = 0
        for attempt in range(2):  # one repair turn for output that does not parse
            body = self._post(messages)
            usage = body.get("usage") or {}
            tokens_in += usage.get("prompt_tokens") or 0
            tokens_out += usage.get("completion_tokens") or 0
            content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            try:
                extraction = Extraction.model_validate_json(_json_object(content))
                return ProviderResult(
                    extraction, "openai", self.model, self.prompt_version, tokens_in, tokens_out,
                    {"repaired": attempt > 0},
                )  # fmt: skip
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
            service=task.service,
            policy_title=task.policy.title,
            criteria="\n".join(_criterion_block(c) for c in criteria),
            documents="\n\n".join(
                _document_block(d, texts[d.doc_id]) for d in task.documents if d.doc_id in texts
            ),
        )

    def _post(self, messages: list[dict]) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "findings", "schema": EXTRACTION_SCHEMA, "strict": True},
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
