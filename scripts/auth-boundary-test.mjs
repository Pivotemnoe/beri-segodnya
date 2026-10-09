import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { canonicalIp, requestIdentity } from "../backend/utils/requestIdentity.mjs";
import { createPasswordHash, createPasswordHashAsync, verifyPasswordAsync, LEGACY_PASSWORD_ITERATIONS } from "../backend/utils/password.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "beri-auth-boundary-"));
process.env.DB_FILE = path.join(temporary, "db.json");
process.env.APP_ENV = "test";
process.env.SESSION_SECRET = "isolated-auth-boundary-test-secret";
process.env.ADMIN_APP_LOGIN = "boundary-admin";
process.env.TRUST_PROXY = "true";
const password = "isolated-correct-password";
const replacement = "isolated-next-password";
const credentials = createPasswordHash(password);
process.env.ADMIN_APP_PASSWORD_HASH = credentials.hash;
process.env.ADMIN_APP_PASSWORD_SALT = credentials.salt;
process.env.ADMIN_APP_PASSWORD_ITERATIONS = String(credentials.iterations);
const fields = (value) => ({ password_hash: value.hash, password_salt: value.salt, password_iterations: value.iterations });
const blank = Object.fromEntries(["adminUsers", "partners", "partnerUsers", "partnerAddresses", "offers", "offerTemplates", "bookings", "partnerApplications", "contactRequests", "sessions", "auditLog"].map((key) => [key, []]));
blank.partners.push({ id: "boundary-partner", status: "active", name: "Тестовая кулинария" });
for (const role of ["owner", "manager", "seller"]) blank.partnerUsers.push({
  id: `boundary-${role}`, partner_id: "boundary-partner", login: `boundary-${role}`,
  role, status: "active", must_change_password: true, ...fields(credentials)
});
fs.writeFileSync(process.env.DB_FILE, JSON.stringify(blank), { mode: 0o600 });
const repository = await import("../backend/repositories/databaseRepository.mjs");
const { readDb, updateDb } = await import("../backend/storage/jsonStore.mjs");
const auth = await import("../backend/services/authService.mjs");
const { handleApiRequest } = await import("../backend/routes/apiRouter.mjs");
const server = http.createServer((req, res) => handleApiRequest(req, res, new URL(req.url, "http://127.0.0.1")));
let checks = 0;
function check(value, expected, message) { assert.deepEqual(value, expected, message); checks += 1; }
function identity(peer, forwarded, proto = "https", extra = {}) {
  return requestIdentity({ socket: { remoteAddress: peer }, headers: { "x-forwarded-for": forwarded, "x-forwarded-proto": proto }, ...extra });
}
function request(route, { method = "GET", body, cookie, client = "192.0.2.1", extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: route, method, headers: {
      "X-BS-Request": "1", "X-Forwarded-For": client, "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}), ...extra
    } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text), cookie: res.headers["set-cookie"]?.[0] }));
      res.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("Isolated request timed out")));
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function login(role, name, client = "192.0.2.1", supplied = password) {
  return request(`/api/${role}/auth/login`, { method: "POST", body: { login: name, password: supplied }, client });
}
async function change(role, cookie, client, current = "wrong-password") {
  return request(`/api/${role}/auth/change-password`, { method: "POST", cookie, client,
    body: { currentPassword: current, newPassword: replacement, confirmPassword: replacement } });
}

// Test-only controlled callbacks make logout/reset races and queue bounds deterministic.
const originalPbkdf2 = crypto.pbkdf2;
let deferred = [];
function pauseKdfs() {
  deferred = [];
  crypto.pbkdf2 = (...args) => { deferred.push(args); };
}
function releaseOne() {
  const [value, salt, iterations, length, digest, callback] = deferred.shift();
  callback(null, crypto.pbkdf2Sync(value, salt, iterations, length, digest));
}
async function drain() {
  do {
    while (deferred.length) releaseOne();
    await new Promise(setImmediate);
  } while (deferred.length);
}
async function race(operation, mutation, expected) {
  pauseKdfs();
  try {
    const result = operation().then((value) => ({ value }), (error) => ({ error: error.code }));
    check(deferred.length, 1, "Race must stop inside verification");
    mutation();
    await drain();
    check(await result, expected, "Stale authentication must not commit");
  } finally { crypto.pbkdf2 = originalPbkdf2; }
}

try {
  check(canonicalIp("0:0:0:0:0:ffff:c000:201"), "192.0.2.1");
  check(canonicalIp("2001:0DB8:0:0:0:0:0:1"), "2001:db8::1");
  for (const peer of ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
    check(identity(peer, "192.0.2.1"), { ip: "192.0.2.1", protocol: "https" });
  }
  check(identity("203.0.113.1", "192.0.2.1"), { ip: "203.0.113.1", protocol: "http" });
  process.env.TRUST_PROXY = "false";
  check(identity("127.0.0.1", "192.0.2.1"), { ip: "127.0.0.1", protocol: "http" });
  process.env.TRUST_PROXY = "true";
  for (const invalid of ["", "bad", "192.0.2.1, 198.51.100.1", "[2001:db8::1]", "192.0.2.1:123", "fe80::1%en0"]) {
    check(identity("127.0.0.1", invalid).ip, "127.0.0.1", `Unsafe forwarded identity: ${invalid}`);
  }
  check(identity("127.0.0.1", "192.0.2.1", "javascript").protocol, "http");
  check(identity("127.0.0.1", "192.0.2.1", "https,http").protocol, "http");
  check(identity("127.0.0.1", "192.0.2.1", "https", { rawHeaders: ["X-Forwarded-For", "192.0.2.1", "x-forwarded-for", "198.51.100.1"] }).ip, "127.0.0.1");

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  for (let attempt = 0; attempt < 12; attempt += 1) check((await request("/api/public/bookings", { method: "POST", body: {}, client: "198.51.100.1" })).status, 400);
  check((await request("/api/public/bookings", { method: "POST", body: {}, client: "198.51.100.1" })).status, 429);
  check((await request("/api/public/bookings", { method: "POST", body: {}, client: "198.51.100.2" })).status, 400, "Second visitor must retain own budget");
  check((await request("/api/public/contact-requests", { method: "POST", body: {}, client: "198.51.100.3", extra: { Origin: `https://127.0.0.1:${server.address().port}`, "X-Forwarded-Proto": "https" } })).status, 400, "Trusted HTTPS origin accepted");
  check((await request("/api/public/contact-requests", { method: "POST", body: {}, extra: { Origin: "https://wrong.example.test" } })).status, 403);
  check((await login("admin", "boundary-admin", "192.0.2.10", "wrong-password")).status, 401, "An unawaited Promise must never authenticate");
  const admin = await login("admin", "boundary-admin", "192.0.2.10");
  check(admin.status, 200);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await change("admin", admin.cookie, "192.0.2.11");
    check([result.status, result.json.error.code], [401, "BAD_CURRENT_PASSWORD"]);
  }
  check((await change("admin", admin.cookie, "192.0.2.11")).status, 429);
  const adminAgain = await login("admin", "boundary-admin", "192.0.2.12");
  check(adminAgain.status, 200);
  check((await change("admin", adminAgain.cookie, "192.0.2.13")).status, 429, "Cookie/IP rotation cannot replenish user budget");
  check((await request("/api/admin/auth/me", { cookie: adminAgain.cookie })).json.data.authenticated, true);

  const owner = await login("partner", "boundary-owner", "192.0.2.20");
  check(owner.status, 200);
  for (let attempt = 0; attempt < 10; attempt += 1) check((await change("partner", owner.cookie, "192.0.2.21")).status, 401);
  check((await change("partner", owner.cookie, "192.0.2.22")).status, 429);
  for (const [index, role] of ["manager", "seller"].entries()) {
    check((await login("partner", `boundary-${role}`, `192.0.2.${30 + index}`, "wrong-password")).status, 401);
    const account = await login("partner", `boundary-${role}`, `192.0.2.${30 + index}`);
    check(account.status, 200);
    check((await request("/api/partner/dashboard", { cookie: account.cookie })).status, 403, "Temporary gate preserved");
    const changed = await change("partner", account.cookie, `192.0.2.${40 + index}`, password);
    check(changed.status, 200, `${role} can rotate temporary password`);
    check((await request("/api/partner/auth/me", { cookie: account.cookie })).json.data.authenticated, false);
    check((await request("/api/partner/dashboard", { cookie: changed.cookie })).status, 200);
  }

  pauseKdfs();
  try {
    const requests = Array.from({ length: 12 }, (_, index) => index % 2
      ? createPasswordHashAsync(password) : verifyPasswordAsync(password, credentials.hash, credentials.salt, credentials.iterations));
    const settled = Promise.allSettled(requests);
    check(deferred.length, 2, "Only two KDFs may be active");
    check((await request("/api/public/health")).status, 200, "HTTP remains responsive while KDFs are held");
    await drain();
    const outcomes = await settled;
    check(outcomes.filter((item) => item.status === "fulfilled").length, 10);
    check(outcomes.filter((item) => item.status === "rejected").map((item) => [item.reason.status, item.reason.code]), [[429, "RATE_LIMIT"], [429, "RATE_LIMIT"]]);
  } finally { crypto.pbkdf2 = originalPbkdf2; }

  for (const kind of ["logout", "reset", "disable", "role", "partner"]) {
    const id = `race-${kind}`;
    updateDb((db) => db.partnerUsers.push({ id, login: id, partner_id: "boundary-partner", role: "owner", status: "active", must_change_password: true, ...fields(credentials) }));
    const token = repository.createSession("partner", "boundary-partner", id, "owner");
    const session = repository.getSession(token.id);
    await race(() => auth.changePartnerPassword(session, password, replacement), () => {
      if (kind === "logout") repository.deleteSession(token.id);
      if (kind === "reset") repository.updatePartnerUserPassword(id, createPasswordHash("isolated-reset-password"));
      if (kind === "disable") updateDb((db) => { db.partnerUsers.find((user) => user.id === id).status = "disabled"; });
      if (kind === "role") updateDb((db) => { db.partnerUsers.find((user) => user.id === id).role = "seller"; });
      if (kind === "partner") updateDb((db) => { db.partners[0].status = "disabled"; });
    }, { error: "SESSION_REVOKED" });
    check(readDb().partnerUsers.find((user) => user.id === id).password_hash === credentials.hash, kind !== "reset");
    updateDb((db) => { db.partners[0].status = "active"; });
  }
  await race(() => auth.adminLogin("boundary-admin", password), () => repository.upsertAdminUserPassword("boundary-admin", createPasswordHash("isolated-reset-password")), { value: null });
  const adminToken = repository.createSession("admin", null, "admin:boundary-admin", "admin");
  await race(() => auth.changeAdminPassword(repository.getSession(adminToken.id), "isolated-reset-password", replacement), () => repository.deleteSession(adminToken.id), { error: "SESSION_REVOKED" });
  const legacy = createPasswordHash(password, LEGACY_PASSWORD_ITERATIONS);
  updateDb((db) => db.partnerUsers.push({ id: "legacy-owner", login: "legacy-owner", partner_id: "boundary-partner", role: "owner", status: "active", must_change_password: true, ...fields(legacy) }));
  check(Boolean(await auth.partnerLogin("legacy-owner", password)), true);
  check([repository.findPartnerUser("legacy-owner").password_iterations, repository.findPartnerUser("legacy-owner").must_change_password], [600000, true]);
  console.log(`Auth boundaries passed (${checks} checks): trusted proxy identity, independent visitor budgets, all-role password limits, bounded KDFs, stale auth races and legitimate rotation/rehash`);
} finally {
  crypto.pbkdf2 = originalPbkdf2;
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
