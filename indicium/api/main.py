"""The HTTP API."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout

from indicium.db import make_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = make_pool()
    pool.open()
    app.state.pool = pool
    try:
        yield
    finally:
        pool.close()


app = FastAPI(title="Indicium", lifespan=lifespan)


@app.exception_handler(PoolTimeout)
async def busy(_request: Request, _exc: PoolTimeout) -> JSONResponse:
    # Every connection stayed busy past the timeout: tell the client to retry instead of hanging.
    return JSONResponse(
        {"detail": "Busy, try again"}, status_code=503, headers={"Retry-After": "2"}
    )


@app.get("/health", tags=["ops"])
def health() -> dict:
    """Liveness: the process is up. It does not touch the database."""
    return {"status": "ok"}


@app.get("/ready", tags=["ops"])
def ready(request: Request) -> JSONResponse:
    """Readiness: the database answers. A load balancer stops routing here while it does not."""
    try:
        with request.app.state.pool.connection(timeout=2) as conn:
            conn.execute("select 1")
    except Exception:
        return JSONResponse({"status": "unavailable", "db": False}, status_code=503)
    return JSONResponse({"status": "ok", "db": True})
