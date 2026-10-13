import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { createPasswordHash } from "../backend/utils/password.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "beri-admin-accounts-"));
process.env.DB_FILE = path.join(temporary, "db.json");
process.env.APP_ENV = "test";
process.env.APP_BASE_URL = "http://localhost:3010";
process.env.SESSION_SECRET = "isolated-admin-accounts-secret-at-least-32";
process.env.ADMIN_APP_LOGIN = "admin";
const password = "isolated-existing-admin-password", nextPassword = "isolated-new-admin-password";
const credentials = createPasswordHash(password);
Object.assign(process.env, { ADMIN_APP_PASSWORD_HASH: credentials.hash, ADMIN_APP_PASSWORD_SALT: credentials.salt, ADMIN_APP_PASSWORD_ITERATIONS: String(credentials.iterations) });
const blank = Object.fromEntries(["adminUsers", "partners", "partnerUsers", "partnerAddresses", "offers", "offerTemplates", "bookings", "partnerApplications", "contactRequests", "sessions", "auditLog"].map(key => [key, []]));
blank.adminUsers.push({ id: "admin:admin", login: "admin", status: "active", must_change_password: false,
  password_hash: credentials.hash, password_salt: credentials.salt, password_iterations: credentials.iterations });
blank.partners.push({ id: "training", name: "Тестовая пекарня", status: "active" });
blank.bookings.push({ id: "preserved-training-booking" });
fs.writeFileSync(process.env.DB_FILE, JSON.stringify(blank), { mode: 0o600 });
const { readDb, updateDb } = await import("../backend/storage/jsonStore.mjs");
const repository = await import("../backend/repositories/databaseRepository.mjs");
const auth = await import("../backend/services/authService.mjs");
const accounts = await import("../backend/services/adminAccountService.mjs");
const { createAdminRecovery } = await import("../backend/services/adminRecoveryService.mjs");
const { handleApiRequest } = await import("../backend/routes/apiRouter.mjs");
const server = http.createServer((req, res) => handleApiRequest(req, res, new URL(req.url, "http://localhost")));
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function request(route, { method = "GET", body, cookie, confirmed = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: server.address().port, path: route, method,
      headers: { "Content-Type": "application/json", ...(confirmed ? { "X-BS-Request": "1" } : {}), ...(cookie ? { Cookie: cookie } : {}) }
    }, res => {
      let text = ""; res.on("data", chunk => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(text), cookie: res.headers["set-cookie"]?.[0] }));
    });
    req.setTimeout(10000, () => req.destroy(new Error("Timeout"))); req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const login = (email, supplied = password) => request("/api/admin/auth/login", { method: "POST", body: { login: email, password: supplied } });
function migrate(overrides = {}) {
  return spawnSync(process.execPath, [new URL("./configure-service-owner.mjs", import.meta.url).pathname], { encoding: "utf8",
    env: { ...process.env, OWNER_MIGRATION_SERVER_STOPPED: "true", OWNER_EXISTING_LOGIN: "admin", OWNER_EMAIL: "owner@example.test", OWNER_NAME: "Тестовый владелец", ...overrides } });
}
const deliveries = [];
const recovery = createAdminRecovery({ configure: () => {}, deliver: async (email, link) => { deliveries.push({ email, token: new URLSearchParams(new URL(link).hash.slice(1)).get("token") }); } });
function clearBudgets() { updateDb(db => { db.adminAuthLimits = []; }); }
const originalKdf = crypto.pbkdf2;
let deferred = [];
async function race(operation, mutation, code) {
  deferred = []; crypto.pbkdf2 = (...args) => deferred.push(args);
  try {
    const result = operation().then(value => ({ value }), failure => ({ code: failure.code }));
    check(deferred.length, 1, "Race paused in KDF"); mutation();
    while (deferred.length) {
      const [password, salt, iterations, length, digest, callback] = deferred.shift();
      callback(null, crypto.pbkdf2Sync(password, salt, iterations, length, digest)); await new Promise(setImmediate);
    }
    check((await result).code, code, "Stale operation cannot commit");
  } finally { crypto.pbkdf2 = originalKdf; }
}

try {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const legacy = await login("admin"); check(legacy.status, 200);
  check((await request("/api/admin/administrators", { cookie: legacy.cookie })).status, 403, "Legacy admin is not silently owner");
  check(migrate({ OWNER_MIGRATION_SERVER_STOPPED: "false" }).status, 1);
  check(migrate().status, 0);
  check(migrate().stdout.includes("ALREADY_CONFIGURED"), true);
  const owner = readDb().adminUsers[0];
  check([owner.id, owner.login, owner.role, owner.password_hash, owner.must_change_password], ["admin:admin", "owner@example.test", "owner", credentials.hash, false]);
  check(readDb().partners, blank.partners); check(readDb().bookings, blank.bookings);
  check((await request("/api/admin/auth/me", { cookie: legacy.cookie })).json.data.authenticated, false);
  check((await login("admin")).status, 401, "Environment cannot resurrect renamed owner");
  const ownerLogin = await login("OWNER@EXAMPLE.TEST"); check(ownerLogin.status, 200);
  const ownerCookie = ownerLogin.cookie;
  check(ownerLogin.json.data.canManageAdministrators, true);
  check(ownerLogin.json.data.login, "owner@example.test", "Stable id does not become the login");
  const ownerSession = repository.getSession(ownerCookie.split(";")[0].split("=")[1]);
  const created = await request("/api/admin/administrators", { method: "POST", cookie: ownerCookie,
    body: { name: "Тестовый помощник", login: "helper@example.test", password } });
  check(created.status, 201); const helperId = created.json.data.id;
  check(created.json.data.passwordChangeRequired, true);
  check(created.json.data.password_hash, undefined);
  check((await request("/api/admin/administrators", { method: "POST", cookie: ownerCookie, body: { name: "Подмена", login: "other@example.test", role: "owner", password } })).status, 400);
  check((await request("/api/admin/administrators", { method: "POST", cookie: ownerCookie, body: { name: "Дубликат", login: "HELPER@example.test", password } })).status, 409);
  check((await request("/api/admin/administrators", { method: "POST", cookie: ownerCookie, body: { name: "Без почты", login: "nickname", password } })).status, 400);
  check((await request("/api/admin/administrators", { method: "POST", cookie: ownerCookie, confirmed: false, body: {} })).status, 403);
  for (const status of ["disabled", "archived", "active"]) check((await request(`/api/admin/administrators/${owner.id}/status`, { method: "PATCH", cookie: ownerCookie, body: { status } })).status, 403);
  check((await request(`/api/admin/administrators/${owner.id}/reset-password`, { method: "POST", cookie: ownerCookie, body: { password } })).status, 403);
  const first = await login("helper@example.test"); check(first.status, 200);
  check((await request("/api/admin/dashboard", { cookie: first.cookie })).status, 403);
  const changed = await request("/api/admin/auth/change-password", { method: "POST", cookie: first.cookie,
    body: { currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword } });
  check(changed.status, 200); const helperCookie = changed.cookie;
  check((await request("/api/admin/auth/me", { cookie: ownerCookie })).json.data.authenticated, true, "Helper change leaves owner signed in");
  check((await request("/api/admin/dashboard", { cookie: helperCookie })).status, 200);
  for (const [method, route, body] of [["GET", "", undefined], ["POST", "", {}], ["PATCH", `/${owner.id}/status`, { status: "archived" }], ["POST", `/${helperId}/reset-password`, { password }]]) {
    check((await request("/api/admin/administrators" + route, { method, cookie: helperCookie, body })).status, 403);
  }
  const list = await request("/api/admin/administrators", { cookie: ownerCookie }); check(list.status, 200);
  check(list.json.data.every(row => !Object.keys(row).some(key => /hash|salt|iterations|token/i.test(key))), true);
  check((await request(`/api/admin/administrators/${helperId}/status`, { method: "PATCH", cookie: ownerCookie, body: { status: "disabled" } })).status, 200);
  check((await request("/api/admin/auth/me", { cookie: helperCookie })).json.data.authenticated, false);
  check((await login("helper@example.test", nextPassword)).status, 401);
  await request(`/api/admin/administrators/${helperId}/status`, { method: "PATCH", cookie: ownerCookie, body: { status: "archived" } });
  check((await login("helper@example.test", nextPassword)).status, 401);
  const beforeUnknown = deliveries.length;
  const unknown = await recovery.request({ email: "unknown@example.test" }, "192.0.2.1");
  check(deliveries.length, beforeUnknown);
  clearBudgets(); check(await recovery.request({ email: "helper@example.test" }, "192.0.2.1"), unknown, "Archive recovery is indistinguishable");
  check(deliveries.length, beforeUnknown);
  await request(`/api/admin/administrators/${helperId}/status`, { method: "PATCH", cookie: ownerCookie, body: { status: "active" } });
  clearBudgets(); check(await recovery.request({ email: "helper@example.test" }, "192.0.2.1"), unknown);
  const helperRecoveryToken = deliveries.at(-1).token;
  check(JSON.stringify(readDb()).includes(helperRecoveryToken), false, "Raw recovery token never persisted");
  const recoverySession = await recovery.complete({ token: helperRecoveryToken, newPassword: password, confirmPassword: password }, "192.0.2.1");
  check(auth.adminSessionView(recoverySession).canManageAdministrators, false, "Recovery cannot escalate helper");
  check((await login("helper@example.test", nextPassword)).status, 401);
  check((await login("helper@example.test", password)).status, 200);
  await assert.rejects(recovery.complete({ token: helperRecoveryToken, newPassword: nextPassword, confirmPassword: nextPassword }, "192.0.2.1"), { code: "INVALID_RESET_LINK" }); checks++;
  clearBudgets(); await recovery.request({ email: "owner@example.test" }, "192.0.2.1"); const ownerToken = deliveries.at(-1).token;
  await assert.rejects(recovery.request({ email: "owner@example.test" }, "192.0.2.2"), { code: "RATE_LIMIT" }); checks++;
  await assert.rejects(recovery.complete({ token: ownerToken, newPassword: nextPassword, confirmPassword: "different" }, "192.0.2.1"), { code: "PASSWORD_CONFIRMATION_MISMATCH" }); checks++;
  await assert.rejects(recovery.complete({ token: ownerToken, newPassword: "weak", confirmPassword: "weak" }, "192.0.2.1"), { code: "WEAK_PASSWORD" }); checks++;
  await assert.rejects(recovery.request({ email: "owner@example.test\r\nBcc: attack@example.test" }, "192.0.2.1"), { code: "INVALID_ADMIN_EMAIL" }); checks++;
  const ownerRecovered = await recovery.complete({ token: ownerToken, newPassword: nextPassword, confirmPassword: nextPassword }, "192.0.2.1");
  check(auth.adminSessionView(ownerRecovered).userRole, "owner");
  check((await request("/api/admin/auth/me", { cookie: ownerCookie })).json.data.authenticated, false);
  const newOwnerSession = repository.getSession(ownerRecovered.id);
  clearBudgets(); await recovery.request({ email: "helper@example.test" }, "192.0.2.5"); const tokenBeforeReset = deliveries.at(-1).token;
  await accounts.resetAdministratorPassword(newOwnerSession, helperId, { password: nextPassword });
  await assert.rejects(recovery.complete({ token: tokenBeforeReset, newPassword: password, confirmPassword: password }, "192.0.2.5"), { code: "INVALID_RESET_LINK" }); checks++;
  check(repository.isSessionActive(newOwnerSession), true);
  clearBudgets(); await recovery.request({ email: "owner@example.test" }, "192.0.2.6"); const expiryToken = deliveries.at(-1).token;
  updateDb(db => { db.adminPasswordResets[0].expires_at = Date.now() - 1; });
  await assert.rejects(recovery.complete({ token: expiryToken, newPassword: password, confirmPassword: password }, "192.0.2.6"), { code: "INVALID_RESET_LINK" }); checks++;
  const failingRecovery = createAdminRecovery({ configure: () => {}, deliver: async () => { throw new Error("provider error with private content"); } });
  clearBudgets(); check(await failingRecovery.request({ email: "owner@example.test" }, "192.0.2.7"), unknown);
  check(readDb().adminPasswordResets.length, 0);
  clearBudgets(); await recovery.request({ email: "owner@example.test" }, "192.0.2.8");
  const firstOwnerLink = deliveries.at(-1).token;
  clearBudgets(); await recovery.request({ email: "owner@example.test" }, "192.0.2.8");
  await assert.rejects(recovery.complete({ token: firstOwnerLink, newPassword: password, confirmPassword: password }, "192.0.2.8"), { code: "INVALID_RESET_LINK" }); checks++;
  // Live budgets cannot be evicted by attacker-controlled addresses.
  updateDb(db => { db.adminAuthLimits = Array.from({ length: 5000 }, (_, n) => ({ key_hash: String(n), count: 1, reset_at: Date.now() + 60000 })); });
  await assert.rejects(recovery.request({ email: "another@example.test" }, "192.0.2.99"), { code: "RATE_LIMIT" }); checks++;
  check(readDb().adminAuthLimits.length, 5000); clearBudgets();
  const currentLink = deliveries.at(-1).token;
  await race(() => recovery.complete({ token: currentLink, newPassword: password, confirmPassword: password }, "192.0.2.8"),
    () => repository.upsertAdminUserPassword("owner@example.test", createPasswordHash(nextPassword)), "INVALID_RESET_LINK");
  const activeOwner = await auth.adminLogin("owner@example.test", nextPassword);
  await race(() => accounts.createAdministrator(repository.getSession(activeOwner.id), { name: "Тест", login: "race@example.test", password }),
    () => repository.deleteSession(activeOwner.id), "OWNER_REQUIRED");
  check(readDb().adminUsers.some(row => row.login === "race@example.test"), false);
  check(readDb().partners, blank.partners); check(readDb().bookings, blank.bookings);
  const log = repository.listAdminAuditLog();
  check(log.some(row => row.action === "create_administrator" && row.actorName === "Тестовый владелец"), true);
  check(JSON.stringify(log).includes(credentials.hash), false);
  console.log(`Admin accounts passed (${checks} checks): owner migration, isolated assistants, archive, first login, email recovery, replay/expiry/races, budgets and preserved business data`);
} finally {
  crypto.pbkdf2 = originalKdf;
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
