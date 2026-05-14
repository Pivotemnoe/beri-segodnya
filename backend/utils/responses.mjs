export function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-DNS-Prefetch-Control": "off",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Connection": "close",
    ...headers
  });
  response.end(body);
}

export function ok(response, data, status = 200, headers = {}) {
  sendJson(response, status, { ok: true, data }, headers);
}

export function fail(response, status, code, message, headers = {}) {
  sendJson(response, status, { ok: false, error: { code, message } }, headers);
}
