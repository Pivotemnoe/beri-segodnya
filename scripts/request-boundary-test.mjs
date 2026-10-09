import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv.includes("--baseline");
const temporary = fs.mkdtempSync(path.join(process.env.SECURITY_TEST_TMP || os.tmpdir(), "request-boundary-"));
async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
function request(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: route, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", reject);
      res.on("aborted", () => reject(new Error("Response aborted")));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.setTimeout(3000, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
  });
}
async function start(index) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: {
    ...process.env, APP_ENV: "test", HOST: "127.0.0.1", PORT: String(port), DB_FILE: path.join(temporary, `db-${index}.json`),
    UPLOAD_DIR: path.join(temporary, "uploads"), SITE_ACCESS_ENABLED: "false", ADMIN_ACCESS_ENABLED: "false", PARTNER_ACCESS_ENABLED: "false",
    SESSION_SECRET: "isolated-request-boundary-test-secret", NEXT_PUBLIC_DEMO_MODE: "false",
    SEED_PARTNER_1_PASSWORD: crypto.randomBytes(18).toString("hex"), SEED_PARTNER_2_PASSWORD: crypto.randomBytes(18).toString("hex"), SEED_PARTNER_3_PASSWORD: crypto.randomBytes(18).toString("hex")
  }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(child.exitCode, null, `Isolated test server stopped during startup: ${logs.slice(-300)}`);
    try { if ((await request(port, "/api/public/health")).status === 200) return { child, port, logs: () => logs }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error("Isolated server did not start");
}
async function stop(child) {
  if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
}
const originalTriggers = [
  ["/uploads/neutral/missing.jpg", { Cookie: "unrelated=%" }],
  ["/booking/%", {}],
  ["/images//", {}]
];
try {
  if (baseline) {
    for (const [index, [route, headers]] of originalTriggers.entries()) {
      const { child, port, logs } = await start(index);
      try {
        assert.equal((await request(port, "/manifest.webmanifest")).status, 200);
        try { await request(port, route, headers); } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.notEqual(child.exitCode, null, `Baseline did not reproduce: ${route}`);
        assert.match(logs(), /URIError|EISDIR/);
        console.log(`BASELINE CONFIRMED: ${route} terminates the isolated worker`);
      } finally { await stop(child); }
    }
  } else {
    const { child, port } = await start("fixed");
    try {
      const triggers = [...originalTriggers,
        ["/uploads/neutral/missing.jpg", { Cookie: "unrelated=%GG" }],
        ["/uploads/neutral/missing.jpg", { Cookie: "__Host-bs_session=%C0%AF; bs_session=valid-looking" }],
        ["/api/partner/auth/me", { Cookie: "bs_session=%" }],
        ["/booking/%GG", {}], ["/booking/%C0%AF", {}], ["/images/", {}], ["/images/%2e", {}], ["/icons/", {}]
      ];
      for (const [route, headers] of triggers) {
        const result = await request(port, route, headers);
        assert.ok([400, 401, 404].includes(result.status), `${route}: unexpected ${result.status}`);
        assert.equal((await request(port, "/api/public/health")).status, 200, `Worker died after ${route}`);
      }
      for (const [route, content] of [["/manifest.webmanifest", "application/manifest+json"], ["/sw.js", "text/javascript"], ["/icons/ui/store.svg", "image/svg+xml"], ["/icons/android-download-qr-native-v2.svg", "image/svg+xml"], ["/images/offer-lunch-v2.png", "image/png"], ["/downloads/beri-segodnya-android-0.1.0-pilot.apk", "application/vnd.android.package-archive"], ["/downloads/beri-segodnya-android-0.2.0-native-pilot.apk", "application/vnd.android.package-archive"]]) {
        const result = await request(port, route);
        assert.equal(result.status, 200, `Legitimate asset failed: ${route}`);
        assert.ok(result.headers["content-type"].startsWith(content));
        if (route === "/sw.js") assert.equal(result.headers["service-worker-allowed"], "/");
        if (route.endsWith(".apk")) assert.match(result.headers["content-disposition"], /attachment/);
      }
      for (const route of ["/booking/booking-view-neutral", "/booking/%62ooking-view-neutral"]) assert.equal((await request(port, route)).status, 200);
      console.log("Request boundaries passed: malformed cookies/URLs, directory aliases, liveness and legitimate assets");
    } finally { await stop(child); }
    // Force an asynchronous open failure after stat succeeds; no real files or permissions are changed.
    const { streamFile } = await import("../backend/utils/httpFile.mjs");
    const { PassThrough } = await import("node:stream");
    const original = fs.createReadStream;
    const server = http.createServer((_req, res) => streamFile(res, path.join(root, "public/manifest.webmanifest")));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      fs.createReadStream = () => {
        const stream = new PassThrough();
        queueMicrotask(() => stream.destroy(Object.assign(new Error("Injected open failure"), { code: "ENOENT" })));
        return stream;
      };
      assert.equal((await request(server.address().port, "/")).status, 404);
      fs.createReadStream = () => {
        const stream = new PassThrough();
        setImmediate(() => { stream.emit("open", 1); stream.write("partial"); setImmediate(() => stream.destroy(Object.assign(new Error("Injected read failure"), { code: "EIO" }))); });
        return stream;
      };
      await assert.rejects(request(server.address().port, "/"), /aborted|socket hang up|ECONNRESET/);
      fs.createReadStream = original;
      assert.equal((await request(server.address().port, "/")).status, 200);
      console.log("Asynchronous open/read failures passed; subsequent legitimate read succeeds");
    } finally { fs.createReadStream = original; await new Promise((resolve) => server.close(resolve)); }
  }
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
