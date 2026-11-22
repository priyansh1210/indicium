# One Python image serves the API, the review worker and migrations.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/venv PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1 UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
COPY pyproject.toml uv.lock ./
# The download cache survives between builds, so a dependency change fetches only what changed.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY alembic.ini ./
COPY indicium indicium
RUN useradd --system --uid 10001 indicium
USER indicium
EXPOSE 8000
CMD ["uvicorn", "indicium.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
