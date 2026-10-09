import {
  createSession,
  deleteSession,
  findAdminUser,
  findPartnerUser,
  findPartnerUserById,
  getSession,
  isSessionActive,
  isPartnerActive,
  upsertAdminUserPassword,
  updatePartnerUserPassword
} from "../repositories/databaseRepository.mjs";
import {
  createPasswordHashAsync,
  LEGACY_PASSWORD_ITERATIONS,
  passwordNeedsRehash,
  verifyPasswordAsync
} from "../utils/password.mjs";

const loginAttempts = new Map();
const MAX_RATE_LIMIT_KEYS = 5000;
let nextRateLimitCleanup = 0;
const passwordChangeAttempts = new Map();

function passwordBudget(key, limit) {
  const now = Date.now();
  let bucket = passwordChangeAttempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    for (const [name, item] of passwordChangeAttempts) {
      if (item.resetAt <= now) passwordChangeAttempts.delete(name);
    }
    // Never evict a live user's budget to admit attacker-selected new keys.
    if (passwordChangeAttempts.size >= MAX_RATE_LIMIT_KEYS) return false;
    bucket = { count: 0, resetAt: now + 10 * 60 * 1000 };
    passwordChangeAttempts.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export function allowPasswordChange(session, clientIp) {
  const userAllowed = passwordBudget(`user:${session.role}:${session.user_id}`, 10);
  const ipAllowed = passwordBudget(`ip:${clientIp}`, 20);
  return userAllowed && ipAllowed;
}

export function rateLimit(key, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  if (now >= nextRateLimitCleanup || loginAttempts.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [bucketKey, bucket] of loginAttempts) {
      if (bucket.resetAt <= now) loginAttempts.delete(bucketKey);
    }
    if (loginAttempts.size >= MAX_RATE_LIMIT_KEYS) {
      for (const bucketKey of loginAttempts.keys()) {
        loginAttempts.delete(bucketKey);
        if (loginAttempts.size < Math.floor(MAX_RATE_LIMIT_KEYS * 0.9)) break;
      }
    }
    nextRateLimitCleanup = now + 60 * 1000;
  }

  const current = loginAttempts.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  loginAttempts.set(key, bucket);
  return bucket.count <= limit;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index <= 0) return [part, ""];
        let value;
        try { value = decodeURIComponent(part.slice(index + 1)); }
        catch {
          const error = new Error("Некорректный cookie. Повторите вход в кабинет.");
          error.status = 400;
          error.code = "INVALID_COOKIE";
          throw error;
        }
        return [part.slice(0, index), value];
      })
  );
}

export function cookieForSession(session, secure = false) {
  const name = secure ? "__Host-bs_session" : "bs_session";
  const maxAge = session.role === "admin" ? 12 * 60 * 60 : 24 * 60 * 60;
  return `${name}=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie() {
  return [
    "__Host-bs_session=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0",
    "bs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
  ];
}

function tokenFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return cookies["__Host-bs_session"] || cookies.bs_session;
}

export function sessionFromRequest(request) {
  return getSession(tokenFromRequest(request));
}

function adminCredentials(login) {
  const stored = findAdminUser(login);
  if (stored) return stored;
  const expectedLogin = process.env.ADMIN_APP_LOGIN || "admin";
  if (login !== expectedLogin) return null;
  return {
    id: `admin:${expectedLogin}`, login: expectedLogin, status: "active",
    password_hash: process.env.ADMIN_APP_PASSWORD_HASH,
    password_salt: process.env.ADMIN_APP_PASSWORD_SALT,
    password_iterations: Number(process.env.ADMIN_APP_PASSWORD_ITERATIONS || LEGACY_PASSWORD_ITERATIONS)
  };
}

function sameCredentials(before, after) {
  return Boolean(before && after && ["id", "login", "status", "role", "partner_id", "must_change_password", "password_hash", "password_salt", "password_iterations"]
    .every((key) => before[key] === after[key]));
}

function requireCurrentSession(session, before, after) {
  if (!isSessionActive(session) || !sameCredentials(before, after)) {
    throw Object.assign(new Error("Доступ изменился. Войдите снова."), { status: 401, code: "SESSION_REVOKED" });
  }
}

export async function adminLogin(login, password) {
  const normalized = String(login || "").trim();
  const stored = adminCredentials(normalized);
  if (!stored || !await verifyPasswordAsync(password, stored.password_hash, stored.password_salt, stored.password_iterations)) return null;
  if (!sameCredentials(stored, adminCredentials(normalized))) return null;
  return createSession("admin", null, stored.id, "admin");
}

export async function partnerLogin(login, password) {
  const user = findPartnerUser(login);
  const iterations = Number(user?.password_iterations || LEGACY_PASSWORD_ITERATIONS);
  if (!user || !await verifyPasswordAsync(password, user.password_hash, user.password_salt, iterations)) return null;
  let next = null;
  if (passwordNeedsRehash(iterations)) {
    next = await createPasswordHashAsync(password);
  }
  if (!sameCredentials(user, findPartnerUser(login))) return null;
  if (next) updatePartnerUserPassword(user.id, next, "rehash_partner_password");
  return createSession("partner", user.partner_id, user.id, user.role);
}

function passwordValue(value) {
  const password = String(value || "");
  if (password.length < 12 || password.length > 120) {
    const error = new Error("Новый пароль должен содержать от 12 до 120 символов");
    error.status = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }
  return password;
}

function requireDifferentPassword(currentPassword, nextPassword) {
  if (currentPassword === nextPassword) {
    const error = new Error("Новый пароль должен отличаться от текущего");
    error.status = 400;
    error.code = "PASSWORD_NOT_CHANGED";
    throw error;
  }
}

export function adminPasswordChangeRequired(session) {
  if (!session?.user_id) return true;
  const login = String(session.user_id).replace(/^admin:/, "");
  return !findAdminUser(login);
}

export function partnerPasswordChangeRequired(session) {
  return Boolean(findPartnerUserById(session?.user_id)?.must_change_password);
}

export async function changeAdminPassword(session, currentPassword, nextPassword) {
  const login = String(session?.user_id || "").replace(/^admin:/, "");
  const stored = adminCredentials(login);
  if (!stored || !await verifyPasswordAsync(currentPassword, stored.password_hash, stored.password_salt, stored.password_iterations)) {
    const error = new Error("Текущий пароль указан неверно");
    error.status = 401;
    error.code = "BAD_CURRENT_PASSWORD";
    throw error;
  }
  const next = passwordValue(nextPassword);
  requireDifferentPassword(currentPassword, next);
  const credentials = await createPasswordHashAsync(next);
  requireCurrentSession(session, stored, adminCredentials(login));
  const user = upsertAdminUserPassword(login, credentials);
  return createSession("admin", null, user.id, "admin");
}

export async function changePartnerPassword(session, currentPassword, nextPassword) {
  const candidate = findPartnerUserById(session?.user_id);
  const user = candidate && findPartnerUser(candidate.login);
  const iterations = Number(user?.password_iterations || LEGACY_PASSWORD_ITERATIONS);
  if (!user || user.partner_id !== session.partner_id || user.role !== session.user_role || !await verifyPasswordAsync(currentPassword, user.password_hash, user.password_salt, iterations)) {
    const error = new Error("Текущий пароль указан неверно");
    error.status = 401;
    error.code = "BAD_CURRENT_PASSWORD";
    throw error;
  }
  const next = passwordValue(nextPassword);
  requireDifferentPassword(currentPassword, next);
  const credentials = await createPasswordHashAsync(next);
  requireCurrentSession(session, user, findPartnerUser(user.login));
  updatePartnerUserPassword(user.id, credentials, "change_partner_password");
  return createSession("partner", user.partner_id, user.id, user.role);
}

export function logout(request) {
  const token = tokenFromRequest(request);
  if (token) deleteSession(token);
}

export function requireRole(request, role) {
  const session = sessionFromRequest(request);
  if (!session) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Требуется вход" };
  if (session.role !== role) return { ok: false, status: 403, code: "FORBIDDEN", message: "Недостаточно прав" };
  if (!session.user_id) return { ok: false, status: 401, code: "SESSION_REVOKED", message: "Войдите снова" };
  if (role === "partner") {
    const user = findPartnerUserById(session.user_id);
    if (!user || user.status !== "active" || user.partner_id !== session.partner_id || user.role !== session.user_role) {
      return { ok: false, status: 401, code: "SESSION_REVOKED", message: "Доступ изменён. Войдите снова" };
    }
    if (!isPartnerActive(session.partner_id)) {
      return { ok: false, status: 403, code: "PARTNER_DISABLED", message: "Доступ партнёра отключён" };
    }
  }
  return { ok: true, session };
}

export function hasPartnerPermission(session, permission) {
  if (session?.role !== "partner") return false;
  if (session.user_role === "owner") return true;
  if (session.user_role === "seller") return ["dashboard:read", "bookings:read", "bookings:issue"].includes(permission);
  if (session.user_role !== "manager") return false;
  const managerPermissions = new Set([
    "dashboard:read",
    "profile:read",
    "addresses:read",
    "offers:read",
    "offers:write",
    "bookings:read",
    "bookings:write",
    "bookings:issue",
    "templates:read",
    "templates:write",
    "uploads:write"
  ]);
  return managerPermissions.has(permission);
}
