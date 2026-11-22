# Indicium

A prior-authorization review assistant. It reads a request and the clinical notes, turns the
matching coverage policy into a checklist, and quotes the sentence in the notes that supports each
item. It recommends **meets criteria** or **pend for more information**, never a denial: a nurse
makes every decision.

All data is synthetic or public (CMS Medicare Coverage Database). No real patient data is used.

Status: in development. Design and phase plan: [docs/architecture.md](docs/architecture.md).

## Run locally

```sh
docker compose up --build --wait
curl http://localhost:8000/ready
```

## Develop

```sh
uv sync
uv run pytest -q      # starts a throwaway Postgres container; Docker must be running
uv run ruff check . && uv run ruff format --check .
```
