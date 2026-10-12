import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { textAsset, sendTextAsset } from "../backend/utils/textAssets.mjs";

export function runTextAssetChecks() {
  const source = "body{color:teal}".repeat(200), asset = textAsset(source, "text/css; charset=utf-8");
  function request(query = "", encoding = "", method = "GET", etag) {
    const response = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
    sendTextAsset({ method, headers: { "accept-encoding": encoding, "if-none-match": etag } }, response, new URL("https://example.test/styles.css" + query), asset, { "X-Content-Type-Options": "nosniff" });
    return response;
  }
  const compressed = request(`?v=${asset.version}`, "br, gzip;q=0.8");
  assert.equal(gunzipSync(compressed.body).toString(), source);
  assert.ok(compressed.body.length < asset.body.length);
  assert.equal(compressed.headers.Vary, "Accept-Encoding");
  assert.equal(compressed.headers["X-Content-Type-Options"], "nosniff");
  assert.ok(compressed.headers["Cache-Control"].includes("immutable"));
  for (const encoding of ["", "br", "gzip;q=0", "gzip; q=0"]) assert.equal(request("", encoding).headers["Content-Encoding"], undefined);
  assert.equal(request().headers["Cache-Control"], "no-cache");
  assert.equal(request("?v=old-version").headers["Cache-Control"], "no-cache");
  assert.equal(request("", "gzip", "HEAD").body, undefined);
  assert.equal(request("", "gzip", "GET", compressed.headers.ETag).status, 304);
  assert.notEqual(request().headers.ETag, compressed.headers.ETag);
  assert.notEqual(textAsset(source + "changed", asset.contentType).version, asset.version);
}
