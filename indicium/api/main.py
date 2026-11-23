"""The HTTP API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest
from psycopg import errors
from psycopg_pool import PoolTimeout

from indicium import observability
from indicium.api import auth, cases, policies
from indicium.config import settings
from indicium.db import make_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    observability.configure("indicium-api", settings().log_json)
    pool = make_pool()
    pool.open()
    app.state.pool = pool
    collector = observability.StateCollector(pool)
    REGISTRY.register(collector)
    try:
        yield
    finally:
        REGISTRY.unregister(collector)
        pool.close()


class BodyLimit:
    """Refuse request bodies over the limit, counted as they arrive (Content-Length can lie)."""

    def __init__(self, app, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope["headers"]).get(b"content-length", b"")
        if length.isdigit() and int(length) > self.max_bytes:
            return await _too_large(send)
        received = 0

        async def counted():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _TooLarge
            return message

        try:
            await self.app(scope, counted, send)
        except _TooLarge:
            await _too_large(send)


class _TooLarge(Exception):
    pass


async def _too_large(send) -> None:
    await JSONResponse({"detail": "Request body is too large"}, status_code=413)(
        {"type": "http"}, None, send
    )


app = FastAPI(title="Indicium", lifespan=lifespan)
app.add_middleware(BodyLimit, max_bytes=settings().max_body_bytes)
app.add_middleware(observability.RequestContext)  # outermost: every response gets a request id
app.include_router(auth.router)
app.include_router(cases.router)
app.include_router(policies.router)


@app.exception_handler(PoolTimeout)
async def busy(_request: Request, _exc: PoolTimeout) -> JSONResponse:
    # Every connection stayed busy past the timeout: tell the client to retry instead of hanging.
    return JSONResponse(
        {"detail": "Busy, try again"}, status_code=503, headers={"Retry-After": "2"}
    )


@app.exception_handler(errors.RaiseException)
@app.exception_handler(errors.CheckViolation)
async def refused_by_database(_request: Request, exc: Exception) -> JSONResponse:
    # The database enforces case transitions and append-only history. If application code ever
    # misses a check, the database still refuses, and the client sees a conflict, not a crash.
    return JSONResponse({"detail": str(exc).splitlines()[0]}, status_code=409)


@app.get("/health", tags=["ops"])
def health() -> dict:
    """Liveness: the process is up. It does not touch the database."""
    return {"status": "ok"}


@app.get("/metrics", tags=["ops"], include_in_schema=False)
def metrics() -> Response:
    """Prometheus metrics. The proxy does not publish this path: scrape it privately."""
    return Response(generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@app.get("/ready", tags=["ops"])
def ready(request: Request) -> JSONResponse:
    """Readiness: the database answers. A load balancer stops routing here while it does not."""
    try:
        with request.app.state.pool.connection(timeout=2) as conn:
            conn.execute("select 1")
    except Exception:
        return JSONResponse({"status": "unavailable", "db": False}, status_code=503)
    return JSONResponse({"status": "ok", "db": True})
