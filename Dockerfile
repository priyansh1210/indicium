# One Python image serves the API, the review worker and migrations.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/venv PATH=/venv/bin:$PATH PYTHONUNBUFFERED=1 UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
RUN useradd --system --uid 10001 indicium
COPY pyproject.toml uv.lock ./
# The download cache survives between builds, so a dependency change fetches only what changed.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
# The embedding model is part of the image: no container downloads it, and none needs the network
# for it (HF_HUB_OFFLINE). The app user owns the cache so the model library can lock its files.
ENV INDICIUM_EMBEDDING_CACHE=/opt/models HF_HUB_DISABLE_TELEMETRY=1
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/models')" \
    && chown -R indicium /opt/models
ENV HF_HUB_OFFLINE=1
COPY alembic.ini ./
COPY indicium indicium
COPY data/policies/*.yaml data/policies/
COPY data/cases data/cases
USER indicium
EXPOSE 8000
# Access lines come from the app (JSON, with request ids), so uvicorn's own are off.
CMD ["uvicorn", "indicium.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-access-log"]
