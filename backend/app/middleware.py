"""Cross-cutting HTTP middleware: request IDs, access logs, security headers.

Three small pieces that every later subsystem depends on.

**Request IDs.** Until now a 500 was untraceable: nginx logged a status, the app
logged a stack trace, and nothing tied the two together — so "a customer saw an
error at 14:32" could not be turned into a specific log line. Every response now
carries `X-Request-ID`, every log line for that request carries the same id, and
error responses include it so a customer can quote it to support.

**Security headers.** Next sets these for page responses; the API sets none, and
the API is what serves preview images, JSON and file downloads. `nosniff` in
particular matters here — a browser that content-sniffs an uploaded file is how
an "image" becomes script.

**Access logging.** Method, path, status, latency, request id, on one line, to
stdout, where Dozzle already collects it.
"""

from __future__ import annotations

import contextvars
import logging
import secrets
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

log = logging.getLogger("access")

# Read by the logging filter below so every log line emitted while handling a
# request carries its id — including logs from deep inside a service that knows
# nothing about HTTP.
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)

REQUEST_ID_HEADER = "X-Request-ID"

# Paths that are polled constantly and would otherwise bury real traffic.
_QUIET_PATHS = frozenset({"/health", "/"})


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Trust an inbound id so a request can be followed across nginx and the
        # frontend proxy, but cap the length — this value ends up in log lines,
        # and an unbounded caller-controlled string in a log is how log files
        # get flooded and parsers get confused.
        incoming = (request.headers.get(REQUEST_ID_HEADER) or "")[:64].strip()
        request_id = incoming or secrets.token_hex(8)
        token = request_id_var.set(request_id)

        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        except Exception:
            # Log with the id BEFORE re-raising, so the trace and the customer's
            # error id are connected even when the exception handler is what
            # ultimately formats the response.
            elapsed = (time.perf_counter() - start) * 1000
            log.exception(
                "%s %s -> unhandled (%.1fms) id=%s",
                request.method,
                request.url.path,
                elapsed,
                request_id,
            )
            request_id_var.reset(token)
            raise

        elapsed = (time.perf_counter() - start) * 1000
        response.headers[REQUEST_ID_HEADER] = request_id

        if request.url.path not in _QUIET_PATHS:
            log.info(
                "%s %s -> %s (%.1fms) id=%s",
                request.method,
                request.url.path,
                response.status_code,
                elapsed,
                request_id,
            )
        request_id_var.reset(token)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # `nosniff` is the load-bearing one for this service: it serves
        # user-uploaded bytes (preview renders, and payment proofs later), and
        # it stops a browser deciding for itself that something is HTML.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        # The API is not meant to be framed by anyone. The storefront is served
        # by Next, which sets its own SAMEORIGIN.
        response.headers.setdefault("X-Frame-Options", "DENY")

        # A deliberately strict CSP: this service returns JSON and images, never
        # HTML that needs to load anything. `/docs` is the exception — Swagger
        # UI pulls its own assets — and it is only mounted in development.
        if not request.url.path.startswith(("/docs", "/openapi")):
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; img-src 'self' data:; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'none'",
            )
        return response


class RequestIdFilter(logging.Filter):
    """Injects `%(request_id)s` into every record, HTTP-aware or not."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True
