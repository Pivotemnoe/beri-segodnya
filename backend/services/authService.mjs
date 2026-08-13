import { createSession, deleteSession, findPartnerUser, getSession, isPartnerActive } from "../repositories/databaseRepository.mjs";
import { verifyPassword } from "../utils/password.mjs";

const loginAttempts = new Map();

export function rateLimit(key, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const bucket = loginAttempts.get(key) || [];
  const fresh = bucket.filter((timestamp) => now - timestamp < windowMs);
  fresh.push(now);
  loginAttempts.set(key, fresh);
  return fresh.length <= limit;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function cookieForSession(session, secure = false) {
  return `bs_session=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie() {
  return "bs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

export function sessionFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return getSession(cookies.bs_session);
}

export function adminLogin(login, password) {
  const expectedLogin = process.env.ADMIN_APP_LOGIN || "admin";
  if (login !== expectedLogin) return null;
  if (!verifyPassword(password, process.env.ADMIN_APP_PASSWORD_HASH, process.env.ADMIN_APP_PASSWORD_SALT)) return null;
  return createSession("admin");
}

export function partnerLogin(login, password) {
  const user = findPartnerUser(login);
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) return null;
  return createSession("partner", user.partner_id);
}

export function logout(request) {
  const token = parseCookies(request.headers.cookie || "").bs_session;
  if (token) deleteSession(token);
}

export function requireRole(request, role) {
  const session = sessionFromRequest(request);
  if (!session) return { ok: false, status: 401, code: "UNAUTHORIZED", message: "Требуется вход" };
  if (session.role !== role) return { ok: false, status: 403, code: "FORBIDDEN", message: "Недостаточно прав" };
  if (role === "partner" && !isPartnerActive(session.partner_id)) {
    return { ok: false, status: 403, code: "PARTNER_DISABLED", message: "Доступ партнёра отключён" };
  }
  return { ok: true, session };
}
