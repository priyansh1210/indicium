"""Settings, read once from environment variables prefixed INDICIUM_ (or a local .env file).

A missing or malformed value stops the process at start, not in the middle of a request.
"""

from functools import cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="INDICIUM_", env_file=".env", extra="ignore")

    database_url: str = "postgresql://indicium:indicium@localhost:5432/indicium"
    db_pool_max: int = Field(20, ge=1, le=500)
    db_timeout_seconds: float = Field(10, gt=0)


@cache
def settings() -> Settings:
    return Settings()
