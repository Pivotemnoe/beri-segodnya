import crypto from "node:crypto";
import { readDb, updateDb } from "../storage/jsonStore.mjs";
import { parseCookies } from "./authService.mjs";
import { sendCustomerCode } from "./mailService.mjs";
import { cleanString, validatePhone } from "../utils/validation.mjs";
import { consentReceipt, requireLegalReady } from "../utils/legal.mjs";
import { nowIso } from "../utils/dates.mjs";
import { publicBooking, addAudit } from "../repositories/databaseRepository.mjs";
import { generateId } from "../utils/id.mjs";

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL = 10 * 60 * 1000;
function error(message, status = 400, code = "CUSTOMER_AUTH_FAILED") { return Object.assign(new Error(message), { status, code, expose: true }); }
function digest(value) {
  const secret = String(process.env.SESSION_SECRET || "");
  if (secret.length < 32) throw error("Вход по почте пока недоступен.", 503, "CUSTOMER_AUTH_NOT_CONFIGURED");
  return crypto.createHmac("sha256", secret).update(`customer:${value}`).digest("hex");
}
function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
export function customerAuthEnabled() { return process.env.CUSTOMER_AUTH_ENABLED === "true"; }
function enabled() {
  if (!customerAuthEnabled()) throw error("Вход по почте пока недоступен. Попробуйте позже.", 503, "CUSTOMER_AUTH_DISABLED");
  requireLegalReady();
}
function emailValue(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  // Exactly one mailbox; no address lists, display names, header injection or silent truncation.
  if (email.length > 120 || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) || email.includes("..")) {
    throw error("Укажите вашу почту, например name@mail.ru.", 400, "INVALID_EMAIL");
  }
  return email;
}
function budget(db, key, limit, window, now) {
  const hash = digest(`limit:${key}`);
  db.customerAuthLimits = db.customerAuthLimits.filter(row => row.reset_at > now);
  let row = db.customerAuthLimits.find(item => item.key_hash === hash);
  if (!row) {
    if (db.customerAuthLimits.length >= 5000) return false;
    row = { key_hash: hash, count: 0, reset_at: now + window }; db.customerAuthLimits.push(row);
  }
  row.count += 1;
  return row.count <= limit;
}
function rateError() { return error("Код уже запрашивали несколько раз. Подождите немного и попробуйте снова.", 429, "RATE_LIMIT"); }
function tokenFromRequest(request) {
  const names = String(request.headers.cookie || "").split(";").map(part => part.trim().split("=")[0]);
  if (["__Host-bs_customer", "bs_customer"].some(name => names.filter(value => value === name).length > 1)) return "";
  const cookies = parseCookies(request.headers.cookie || "");
  const secure = process.env.APP_ENV === "production" || String(process.env.APP_BASE_URL || "").startsWith("https://");
  return (secure ? cookies["__Host-bs_customer"] : cookies["__Host-bs_customer"] || cookies.bs_customer) || "";
}
function profile(row) { return { id: row.id, email: row.email, name: row.name || "", phone: row.phone || "", phoneVerified: false, deletionRequestedAt: row.deletion_requested_at || null }; }
export function customerFromRequest(request) {
  if (!customerAuthEnabled()) return null;
  const token = tokenFromRequest(request);
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
  const db = readDb();
  const session = db.customerSessions.find(row => row.token_hash === digest(`session:${token}`) && row.expires_at > Date.now());
  const customer = session && db.customers.find(row => row.id === session.customer_id && row.status === "active");
  return customer ? profile(customer) : null;
}
export function requireCustomer(request) {
  enabled();
  const customer = customerFromRequest(request);
  if (!customer) throw error("Войдите по почте, чтобы открыть свой кабинет.", 401, "CUSTOMER_LOGIN_REQUIRED");
  return customer;
}
export function customerCookie(token, secure) { return `${secure ? "__Host-bs_customer" : "bs_customer"}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure ? "; Secure" : ""}`; }
export function customerLogout(request) {
  const token = tokenFromRequest(request);
  if (token) updateDb(db => { db.customerSessions = db.customerSessions.filter(row => row.token_hash !== digest(`session:${token}`)); });
  return ["__Host-bs_customer=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0", "bs_customer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"];
}

// Delivery dependency is injected only by trusted in-process tests, never by an HTTP parameter or production debug flag.
export function createCustomerLogin({ deliver = sendCustomerCode } = {}) {
  return {
    async requestCode(input, ip) {
      enabled();
      const email = emailValue(input.email);
      const receipt = consentReceipt(input, { form: "customer-login", source: "web-or-native:customer-login" });
      const now = Date.now(), id = randomToken(), code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const admitted = updateDb(db => {
        db.customerLoginChallenges = db.customerLoginChallenges.filter(row => row.expires_at > now);
        const permitted = [budget(db, `send-email:${email}`, 3, 30 * 60 * 1000, now), budget(db, `send-ip:${ip}`, 10, CODE_TTL, now),
          budget(db, "send-global", 200, 24 * 60 * 60 * 1000, now), budget(db, `cooldown:${email}`, 1, 60000, now)].every(Boolean);
        if (!permitted || db.customerLoginChallenges.length >= 1000) return false;
        db.customerLoginChallenges.push({ id, email, code_hash: digest(`code:${id}:${code}`), expires_at: now + CODE_TTL, attempts: 0, state: "sending", ...receipt });
        return true;
      });
      if (!admitted) throw rateError();
      try {
        await deliver(email, code);
        const activated = updateDb(db => {
          const row = db.customerLoginChallenges.find(item => item.id === id);
          if (!row || row.expires_at <= Date.now()) return false;
          // Supersede older codes only after the new one was accepted by SMTP.
          db.customerLoginChallenges = db.customerLoginChallenges.filter(item => item.email !== email || item.id === id);
          row.state = "ready"; return true;
        });
        if (!activated) throw error("Код уже истёк. Запросите новый.");
      } catch (failure) {
        updateDb(db => { db.customerLoginChallenges = db.customerLoginChallenges.filter(item => item.id !== id); });
        throw failure;
      }
      return { challengeId: id, expiresIn: CODE_TTL / 1000, resendAfter: 60, message: "Отправили код на вашу почту. Если письма нет, проверьте папку «Спам»." };
    },
    verifyCode(input, ip) {
      enabled();
      const id = typeof input.challengeId === "string" ? input.challengeId : "";
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!/^[a-zA-Z0-9_-]{43}$/.test(id) || !/^\d{6}$/.test(code)) throw error("Введите шесть цифр из письма.", 400, "INVALID_CODE");
      const outcome = updateDb(db => {
        const now = Date.now();
        const row = db.customerLoginChallenges.find(item => item.id === id);
        const permitted = [budget(db, `verify-ip:${ip}`, 30, CODE_TTL, now),
          row ? budget(db, `verify-email:${row.email}`, 10, CODE_TTL, now) : true].every(Boolean);
        if (!permitted) return { failure: rateError() };
        if (!row || row.state !== "ready" || row.expires_at <= now || row.attempts >= 5) return { failure: error("Код неверный или уже истёк. Запросите новый.", 400, "INVALID_CODE") };
        row.attempts += 1;
        if (!crypto.timingSafeEqual(Buffer.from(row.code_hash, "hex"), Buffer.from(digest(`code:${id}:${code}`), "hex"))) return { failure: error("Код не подошёл. Проверьте шесть цифр из письма.", 400, "INVALID_CODE") };
        const current = db.customers.find(item => item.email === row.email);
        if (current && current.status !== "active") return { failure: error("Обратитесь в поддержку для восстановления кабинета.", 403, "CUSTOMER_DISABLED") };
        const customer = current || { id: `customer-${crypto.randomUUID()}`, email: row.email, name: "", phone: "", status: "active", created_at: nowIso(), ...Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith("consent_") || key === "legal_basis")) };
        if (!current) db.customers.push(customer);
        const token = randomToken();
        db.customerLoginChallenges = db.customerLoginChallenges.filter(item => item.email !== row.email);
        db.customerSessions = db.customerSessions.filter(item => item.expires_at > now);
        db.customerSessions.push({ token_hash: digest(`session:${token}`), customer_id: customer.id, expires_at: now + SESSION_TTL });
        addAudit(db, "customer", customer.id, "customer_login", "customer", customer.id);
        return { token, customer: profile(customer) };
      });
      if (outcome.failure) throw outcome.failure;
      return outcome;
    }
  };
}
export const customerLogin = createCustomerLogin();

export function saveCustomerProfile(request, input) {
  const customer = requireCustomer(request);
  const name = cleanString(input.name, 80, true, "Имя"), phone = validatePhone(input.phone);
  return updateDb(db => {
    const row = db.customers.find(item => item.id === customer.id && item.status === "active");
    row.name = name; row.phone = phone; row.updated_at = nowIso();
    return profile(row);
  });
}
export function customerBookings(request) {
  const customer = requireCustomer(request);
  const db = readDb();
  return db.bookings.filter(row => row.customer_id === customer.id).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, 100).map(row => publicBooking(row, db));
}
export function claimCustomerBooking(request, token) {
  const customer = requireCustomer(request);
  if (typeof token !== "string" || !/^booking-view-[a-zA-Z0-9-]{36,160}$/.test(token)) throw error("Ссылка на бронь не подошла.");
  return updateDb(db => {
    const booking = db.bookings.find(row => row.public_token === token);
    if (!booking || (booking.customer_id && booking.customer_id !== customer.id)) throw error("Эта бронь не может быть добавлена в кабинет.", 404, "BOOKING_NOT_FOUND");
    booking.customer_id = customer.id;
    return { claimed: true };
  });
}
export function requestCustomerDeletion(request) {
  const customer = requireCustomer(request);
  return updateDb(db => {
    const row = db.customers.find(item => item.id === customer.id);
    if (!row.deletion_requested_at) {
      row.deletion_requested_at = nowIso();
      db.contactRequests.push({ id: generateId("contact"), customer_id: customer.id, name: row.name || "Покупатель", email: row.email, phone: row.phone || "", type: "other", message: "Прошу удалить мой покупательский кабинет и связанные персональные данные. Перед удалением проверьте незавершённые брони и сообщите о результате на мою почту.", status: "new", created_at: row.deletion_requested_at, updated_at: row.deletion_requested_at });
      addAudit(db, "customer", customer.id, "customer_deletion_requested", "customer", customer.id);
    }
    return { requestedAt: row.deletion_requested_at, message: "Запрос на удаление принят. Поддержка проверит незавершённые брони и сообщит о завершении на вашу почту." };
  });
}
