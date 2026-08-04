"""One error shape for the whole API.

    {"detail": "...", "error": {"code": "not_found", "requestId": "a1b2c3d4"}}

**`detail` is kept deliberately.** Every client already reads it — the auth
client in `frontend/lib/auth/provider.ts` and the catalogue adapter both pull
`detail` out and show it to the user. Replacing it with a nicer envelope would
have silently degraded every error message on the site to "Something went
wrong", which is exactly the kind of regression a schema change makes invisible.
So the envelope is ADDITIVE: same `detail`, plus a machine-readable code and the
request id.

`requestId` is the point of the exercise. A customer who reports "it failed"
becomes a customer who reports "it failed, id a1b2c3d4", and that id is in the
logs.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.middleware import request_id_var

log = logging.getLogger(__name__)

# HTTP status -> stable machine-readable code. Clients should branch on these,
# never on the human-readable text.
_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "unavailable",
}


def _envelope(status: int, detail, code: str | None = None) -> dict:
    return {
        "detail": detail,
        "error": {
            "code": code or _CODES.get(status, "error"),
            "requestId": request_id_var.get(),
        },
    }


def install(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.status_code, exc.detail),
            # Preserve headers the raiser set deliberately — `Retry-After` on a
            # 429 and `WWW-Authenticate` on a 401 are part of the contract, and
            # dropping them here would silently break client back-off.
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default list-of-objects is kept as `detail` because clients
        # already parse it (the auth client surfaces the first `msg`).
        return JSONResponse(status_code=422, content=_envelope(422, exc.errors()))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # The stack is logged (with the request id, via the middleware) and
        # NEVER returned. An internal error message can leak table names, file
        # paths and library versions.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content=_envelope(
                500,
                "Something went wrong on our end. Quote the request id below if "
                "you contact support.",
            ),
        )
