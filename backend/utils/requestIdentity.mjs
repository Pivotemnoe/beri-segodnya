import { isIP } from "node:net";

export function canonicalIp(value) {
  if (typeof value !== "string" || value.includes("%")) return null;
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = address.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
  if (!mapped) return address;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function singleHeader(request, name) {
  const value = request.headers[name];
  if (typeof value !== "string" || value.includes(",")) return null;
  let count = 0;
  for (let index = 0; index < (request.rawHeaders || []).length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count += 1;
  }
  return count > 1 ? null : value.trim();
}

// Only one local proxy hop is supported. The proxy must replace client-supplied
// forwarding headers; chains/CDN trust require a separate explicit hop policy.
export function requestIdentity(request) {
  const peer = canonicalIp(request.socket.remoteAddress);
  const trusted = process.env.TRUST_PROXY === "true" && ["127.0.0.1", "::1"].includes(peer);
  const client = trusted ? canonicalIp(singleHeader(request, "x-forwarded-for")) : null;
  const forwardedProtocol = trusted ? singleHeader(request, "x-forwarded-proto") : null;
  return {
    ip: client || peer || "unknown",
    protocol: ["http", "https"].includes(forwardedProtocol)
      ? forwardedProtocol
      : (request.socket.encrypted ? "https" : "http")
  };
}
