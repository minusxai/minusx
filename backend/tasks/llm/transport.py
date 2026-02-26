"""Httpx transport that redirects LiteLLM traffic to mx-llm-provider."""

import httpx

from .config import HTTP_MAX_CONNECTIONS, HTTP_KEEPALIVE_EXPIRY


class MxProxyTransport(httpx.AsyncBaseTransport):
    def __init__(self, proxy_url: str, mx_api_key: str):
        self._proxy_url = proxy_url.rstrip("/")
        self._mx_api_key = mx_api_key
        limits = httpx.Limits(
            max_keepalive_connections=HTTP_MAX_CONNECTIONS,
            max_connections=HTTP_MAX_CONNECTIONS,
            keepalive_expiry=HTTP_KEEPALIVE_EXPIRY,
        )
        self._inner = httpx.AsyncHTTPTransport(limits=limits)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        # Read the full body (LiteLLM always sends complete JSON bodies)
        body_bytes = await request.aread()

        # Forward ALL original headers (including provider auth like x-api-key / Authorization).
        headers = dict(request.headers)
        headers["mx-api-key"] = self._mx_api_key       # Proxy authentication
        headers["x-original-url"] = str(request.url)  # Original provider URL
        headers["content-length"] = str(len(body_bytes))

        new_request = httpx.Request(
            method=request.method,
            url=f"{self._proxy_url}/intercept",
            headers=headers,
            content=body_bytes,
        )
        return await self._inner.handle_async_request(new_request)

    async def aclose(self) -> None:
        await self._inner.aclose()
