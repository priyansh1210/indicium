"""Logs, traces and metrics.

- Logs are JSON lines carrying the request id (and case or run id when known), so one request can
  be followed across the API and the worker.
- Traces: each request and each review step is a span. Spans are exported over OTLP only when
  OTEL_EXPORTER_OTLP_ENDPOINT is set (Langfuse, Jaeger, Grafana Tempo or any OTLP backend);
  otherwise tracing costs nothing.
- Metrics: /metrics reads the queue and case state from the database when scraped, so every
  replica reports the same truth; request latency is measured per process.
"""

import contextvars
import json
import logging
import os
import re
import time
import uuid

from opentelemetry import trace
from prometheus_client import Histogram
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector

request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
tracer = trace.get_tracer("indicium")
log = logging.getLogger("indicium.http")
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class JsonFormatter(logging.Formatter):
    FIELDS = ("case_id", "run_id", "method", "route", "status", "duration_ms")

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "at": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id.get(),
        } | {k: getattr(record, k) for k in self.FIELDS if hasattr(record, k)}
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure(service: str, json_logs: bool) -> None:
    """Call once per process, at start."""
    handler = logging.StreamHandler()
    handler.setFormatter(
        JsonFormatter()
        if json_logs
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        provider = TracerProvider(resource=Resource.create({"service.name": service}))
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)


HTTP_SECONDS = Histogram(
    "indicium_http_request_duration_seconds",
    "Time to answer an HTTP request.",
    ["method", "route", "status"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)


class RequestContext:
    """Gives each request an id (or keeps a safe one the caller sent), logs it, times it and
    traces it. The route label is the route template ("/cases/{case_id}"), never the raw path,
    so metrics do not grow with every case id."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        sent = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = sent if _SAFE_ID.match(sent) else uuid.uuid4().hex
        token = request_id.set(rid)
        status = 500
        started = time.perf_counter()

        async def send_with_id(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [*message.get("headers", []), (b"x-request-id", rid.encode())]
            await send(message)

        with tracer.start_as_current_span(f"HTTP {scope['method']}") as span:
            try:
                await self.app(scope, receive, send_with_id)
            finally:
                route = getattr(scope.get("route"), "path", "unmatched")
                elapsed = time.perf_counter() - started
                span.update_name(f"{scope['method']} {route}")
                span.set_attributes(
                    {"http.route": route, "http.status_code": status, "request.id": rid}
                )
                HTTP_SECONDS.labels(scope["method"], route, str(status)).observe(elapsed)
                if route not in ("/health", "/ready", "/metrics"):
                    log.info(
                        "request",
                        extra={"method": scope["method"], "route": route, "status": status,
                               "duration_ms": round(elapsed * 1000)},
                    )  # fmt: skip
                request_id.reset(token)


class StateCollector(Collector):
    """Gauges read from the database at scrape time: the same answer from every replica."""

    def __init__(self, pool):
        self.pool = pool

    def collect(self):
        with self.pool.connection() as conn:
            runs = conn.execute(
                "select status, count(*) as n from review.runs group by status"
            ).fetchall()
            oldest = conn.execute(
                "select coalesce(extract(epoch from now() - min(created_at)), 0) as s"
                " from review.runs where status = 'queued'"
            ).fetchone()["s"]
            cases = conn.execute(
                "select status, count(*) as n from app.cases group by status"
            ).fetchall()
            overdue = conn.execute(
                "select count(*) as n from app.cases"
                " where due_at < now() and status not in ('approved', 'denied')"
            ).fetchone()["n"]
            hour = conn.execute(
                "select count(*) as n, coalesce(avg(latency_ms), 0) as latency,"
                " coalesce(sum(tokens_in), 0) as tin, coalesce(sum(tokens_out), 0) as tout,"
                " count(*) filter (where recommendation = 'meets_criteria') as meets"
                " from review.runs where status = 'done'"
                " and finished_at > now() - interval '1 hour'"
            ).fetchone()

        g = GaugeMetricFamily("indicium_review_runs", "Review runs by status.", labels=["status"])
        for r in runs:
            g.add_metric([r["status"]], r["n"])
        yield g
        yield GaugeMetricFamily(
            "indicium_review_oldest_queued_seconds",
            "Age of the oldest queued review.",
            value=oldest,
        )
        g = GaugeMetricFamily("indicium_cases", "Cases by status.", labels=["status"])
        for r in cases:
            g.add_metric([r["status"]], r["n"])
        yield g
        yield GaugeMetricFamily(
            "indicium_cases_overdue", "Open cases past their deadline.", value=overdue
        )
        yield GaugeMetricFamily(
            "indicium_reviews_last_hour", "Reviews finished in the last hour.", value=hour["n"]
        )
        yield GaugeMetricFamily(
            "indicium_review_latency_ms_last_hour",
            "Mean review time, last hour.",
            value=hour["latency"],
        )
        yield GaugeMetricFamily(
            "indicium_model_tokens_in_last_hour", "Prompt tokens, last hour.", value=hour["tin"]
        )
        yield GaugeMetricFamily(
            "indicium_model_tokens_out_last_hour", "Output tokens, last hour.", value=hour["tout"]
        )
        yield GaugeMetricFamily(
            "indicium_meets_criteria_last_hour",
            "Reviews that recommended approval in the last hour (watch for a sudden rise).",
            value=hour["meets"],
        )
