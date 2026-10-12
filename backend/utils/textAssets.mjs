import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// Only deployment-owned CSS/JS may use this helper, never HTML, APIs or account data.
export function textAsset(source, contentType) {
  const body = Buffer.from(source);
  return { body, gzip: gzipSync(body), version: createHash("sha256").update(body).digest("hex").slice(0, 16), contentType };
}

export function sendTextAsset(request, response, url, asset, securityHeaders) {
  const gzip = String(request.headers["accept-encoding"] || "").split(",").some(part => {
    const [name, ...parameters] = part.trim().split(";");
    const quality = parameters.find(value => value.trim().startsWith("q="));
    return name === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
  });
  const etag = `"${asset.version}${gzip ? "-gzip" : ""}"`;
  const headers = {
    ...securityHeaders, "Content-Type": asset.contentType, Vary: "Accept-Encoding", ETag: etag,
    "Cache-Control": url.searchParams.get("v") === asset.version ? "public, max-age=31536000, immutable" : "no-cache",
    ...(gzip ? { "Content-Encoding": "gzip" } : {})
  };
  if (request.headers["if-none-match"] === etag) { response.writeHead(304, headers); response.end(); return; }
  const body = gzip ? asset.gzip : asset.body;
  response.writeHead(200, { ...headers, "Content-Length": body.length });
  response.end(request.method === "HEAD" ? undefined : body);
}
