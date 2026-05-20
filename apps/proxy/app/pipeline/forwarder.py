from __future__ import annotations
import httpx
import time
from fastapi import Request
from fastapi.responses import Response
from typing import Optional

_client: Optional[httpx.AsyncClient] = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


async def forward_request(
    request: Request,
    upstream_base_url: str,
    upstream_api_key: str,
) -> tuple[Response, int]:
    """
    Forward an incoming request to the upstream API.

    Returns a tuple of (Response, latency_ms).
    """
    client = await get_client()

    # Build upstream URL: base_url + path from route params
    path = request.path_params.get("path", "")
    url = upstream_base_url.rstrip("/") + "/" + path.lstrip("/")

    # Copy headers, stripping hop-by-hop and proxy-specific headers.
    # Also strip the original Authorization header so it cannot override
    # the upstream key we inject below (prevent auth header smuggling).
    _STRIP_HEADERS = {
        "host",
        "x-cb-key",
        "content-length",  # httpx recomputes this
        "authorization",   # replaced below with the upstream key
        "cookie",          # do not forward client cookies upstream
    }
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _STRIP_HEADERS
    }

    # Inject upstream authorisation
    if upstream_api_key:
        headers["authorization"] = f"Bearer {upstream_api_key}"

    body = await request.body()
    start = time.monotonic()

    upstream_response = await client.request(
        method=request.method,
        url=url,
        headers=headers,
        content=body,
        params=dict(request.query_params),
    )

    latency_ms = int((time.monotonic() - start) * 1000)

    # Strip hop-by-hop headers that must not be forwarded
    excluded_headers = {
        "transfer-encoding",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "upgrade",
    }
    response_headers = {
        k: v
        for k, v in upstream_response.headers.items()
        if k.lower() not in excluded_headers
    }

    response = Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
    )
    return response, latency_ms
