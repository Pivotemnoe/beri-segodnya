import {
  createSession,
  deleteSession,
  findAdminUser,
  findPartnerUser,
  findPartnerUserById,
  getSession,
  isPartnerActive,
  upsertAdminUserPassword,
  updatePartnerUserPassword
} from "../repositories/databaseRepository.mjs";
import {
  createPasswordHash,
  LEGACY_PASSWORD_ITERATIONS,
  passwordNeedsRehash,
  verifyPassword
} from "../utils/password.mjs";

const loginAttempts = new Map();
const MAX_RATE_LIMIT_KEYS = 5000;
let nextRateLimitCleanup = 0;

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
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
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

export function adminLogin(login, password) {
  const normalized = String(login || "").trim();
  const stored = findAdminUser(normalized);
  if (stored) {
    const iterations = Number(stored.password_iterations || LEGACY_PASSWORD_ITERATIONS);
    if (!verifyPassword(password, stored.password_hash, stored.password_salt, iterations)) return null;
    return createSession("admin", null, stored.id, "admin");
  }
  const expectedLogin = process.env.ADMIN_APP_LOGIN || "admin";
  if (normalized !== expectedLogin) return null;
  const iterations = Number(process.env.ADMIN_APP_PASSWORD_ITERATIONS || LEGACY_PASSWORD_ITERATIONS);
  if (!verifyPassword(password, process.env.ADMIN_APP_PASSWORD_HASH, process.env.ADMIN_APP_PASSWORD_SALT, iterations)) return null;
  return createSession("admin", null, `admin:${expectedLogin}`, "admin");
}

export function partnerLogin(login, password) {
  const user = findPartnerUser(login);
  const iterations = Number(user?.password_iterations || LEGACY_PASSWORD_ITERATIONS);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt, iterations)) return null;
  if (passwordNeedsRehash(iterations)) {
    const next = createPasswordHash(password);
    updatePartnerUserPassword(user.id, next, "rehash_partner_password");
  }
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

export function changeAdminPassword(session, currentPassword, nextPassword) {
  const login = String(session?.user_id || "").replace(/^admin:/, "");
  const stored = findAdminUser(login);
  const currentIterations = Number(stored?.password_iterations || process.env.ADMIN_APP_PASSWORD_ITERATIONS || LEGACY_PASSWORD_ITERATIONS);
  const currentHash = stored?.password_hash || process.env.ADMIN_APP_PASSWORD_HASH;
  const currentSalt = stored?.password_salt || process.env.ADMIN_APP_PASSWORD_SALT;
  if (!login || !verifyPassword(currentPassword, currentHash, currentSalt, currentIterations)) {
    const error = new Error("Текущий пароль указан неверно");
    error.status = 401;
    error.code = "BAD_CURRENT_PASSWORD";
    throw error;
  }
  const next = passwordValue(nextPassword);
  requireDifferentPassword(currentPassword, next);
  const credentials = createPasswordHash(next);
  const user = upsertAdminUserPassword(login, credentials);
  return createSession("admin", null, user.id, "admin");
}

export function changePartnerPassword(session, currentPassword, nextPassword) {
  const user = findPartnerUserById(session?.user_id);
  const iterations = Number(user?.password_iterations || LEGACY_PASSWORD_ITERATIONS);
  if (!user || !verifyPassword(currentPassword, user.password_hash, user.password_salt, iterations)) {
    const error = new Error("Текущий пароль указан неверно");
    error.status = 401;
    error.code = "BAD_CURRENT_PASSWORD";
    throw error;
  }
  const next = passwordValue(nextPassword);
  requireDifferentPassword(currentPassword, next);
  updatePartnerUserPassword(user.id, createPasswordHash(next), "change_partner_password");
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
  const managerPermissions = new Set([
    "dashboard:read",
    "profile:read",
    "addresses:read",
    "offers:read",
    "offers:write",
    "bookings:read",
    "bookings:write",
    "templates:read",
    "templates:write",
    "uploads:write"
  ]);
  return managerPermissions.has(permission);
}
