"""Settings, read once from environment variables prefixed INDICIUM_ (or a local .env file).

A missing or malformed value stops the process at start, not in the middle of a request.
"""

from functools import cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INDICIUM_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://indicium:indicium@localhost:5432/indicium"
    db_pool_max: int = Field(20, ge=1, le=500)
    db_timeout_seconds: float = Field(10, gt=0)
    # Decision deadlines. Defaults follow the CMS prior-authorization rule (CMS-0057-F) that applies
    # from 2026: 72 hours for expedited and 7 calendar days for standard requests.
    sla_expedited_hours: int = Field(72, ge=1)
    sla_standard_hours: int = Field(168, ge=1)

    # Review engine. "baseline" needs no model; "openai" is any OpenAI-compatible server
    # (Gemini, llama.cpp, Ollama, vLLM, Groq, Azure OpenAI).
    provider: Literal["baseline", "openai"] = "baseline"
    openai_base_url: str = ""
    openai_model: str = ""
    openai_api_key: SecretStr = SecretStr("")
    model_timeout_seconds: float = Field(90, gt=0)
    model_max_retries: int = Field(3, ge=0, le=10)
    prompt_version: str = Field("extract-v1", pattern=r"^[a-z0-9-]+$")
    # Below this, a finding is not trusted and the case goes to a person.
    min_confidence: float = Field(0.6, ge=0, le=1)
    # Notes up to this size go to the model whole; longer records are cut to relevant excerpts.
    context_char_budget: int = Field(60_000, ge=2_000)
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_cache: str = ".cache/fastembed"

    # API
    session_hours: int = Field(12, ge=1, le=24 * 30)
    cookie_secure: bool = False  # set true when served over HTTPS
    max_body_bytes: int = Field(5_000_000, ge=10_000)
    # Seeds sign-ins for the demo (one per role) and shows them on the sign-in page. Never in
    # production.
    demo_users: bool = False

    # Worker
    worker_poll_seconds: float = Field(1.0, gt=0)
    worker_lease_seconds: int = Field(900, ge=30)
    worker_max_attempts: int = Field(3, ge=1)

    @model_validator(mode="after")
    def _lease_outlasts_the_model(self) -> "Settings":
        # Worst case for one review: every retry times out, then the repair turn does it again.
        worst = self.model_timeout_seconds * (self.model_max_retries + 1) * 2
        if self.worker_lease_seconds <= worst:
            raise ValueError(
                f"worker_lease_seconds ({self.worker_lease_seconds}) must exceed the longest model "
                f"call ({worst:.0f}s), or a second worker would claim a review still in progress"
            )
        return self


@cache
def settings() -> Settings:
    return Settings()
