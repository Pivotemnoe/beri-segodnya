import { ok, fail } from "../utils/responses.mjs";
import { allowed, cleanString, enumValue, validateEmail, validatePhone } from "../utils/validation.mjs";
import { generateId } from "../utils/id.mjs";
import { nowIso } from "../utils/dates.mjs";
import { listPublicOffers, getPublicOffer, createPartnerApplication, createContactRequest, listAdminData } from "../repositories/databaseRepository.mjs";
import { createBooking } from "../services/bookingService.mjs";
import { adminLogin, cookieForSession, expiredSessionCookie, logout, partnerLogin, rateLimit, requireRole, sessionFromRequest } from "../services/authService.mjs";
import * as admin from "../services/adminService.mjs";
import * as partner from "../services/partnerService.mjs";

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Некорректный JSON");
    error.status = 400;
    error.code = "BAD_JSON";
    throw error;
  }
}

function ip(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function secureCookie() {
  return process.env.APP_ENV === "production";
}

function requireAdmin(request) {
  return requireRole(request, "admin");
}

function requirePartner(request) {
  return requireRole(request, "partner");
}

function sendAuthFailure(response, auth) {
  fail(response, auth.status, auth.code, auth.message);
}

function routeParts(pathname, prefix) {
  return pathname.slice(prefix.length).split("/").filter(Boolean);
}

export async function handleApiRequest(request, response, url) {
  try {
    if (url.pathname.startsWith("/api/public/")) return handlePublic(request, response, url);
    if (url.pathname.startsWith("/api/admin/")) return handleAdmin(request, response, url);
    if (url.pathname.startsWith("/api/partner/")) return handlePartner(request, response, url);
    return fail(response, 404, "NOT_FOUND", "API endpoint не найден");
  } catch (error) {
    return fail(response, error.status || 500, error.code || "INTERNAL_ERROR", error.message || "Ошибка сервера");
  }
}

async function handlePublic(request, response, url) {
  const parts = routeParts(url.pathname, "/api/public/");

  if (request.method === "GET" && parts[0] === "offers" && !parts[1]) {
    return ok(response, listPublicOffers(url.searchParams.get("category")));
  }

  if (request.method === "GET" && parts[0] === "offers" && parts[1]) {
    const offer = getPublicOffer(parts[1]);
    return offer ? ok(response, offer) : fail(response, 404, "OFFER_NOT_FOUND", "Предложение не найдено");
  }

  if (request.method === "POST" && parts[0] === "bookings") {
    return ok(response, createBooking(await readBody(request)), 201);
  }

  if (request.method === "POST" && parts[0] === "partner-applications") {
    const input = await readBody(request);
    const application = {
      id: generateId("application"),
      venue_name: cleanString(input.venueName, 120, true, "Название заведения"),
      venue_type: enumValue(input.venueType, allowed.partnerTypes.filter((type) => type !== "cafe"), "Тип заведения"),
      city: cleanString(input.city, 80, true, "Город"),
      first_address: cleanString(input.firstAddress, 160, true, "Адрес"),
      contact_name: cleanString(input.contactName, 80, true, "Контактное лицо"),
      phone: validatePhone(input.phone),
      email: validateEmail(input.email),
      offer_formats: Array.isArray(input.offerFormats) ? input.offerFormats.slice(0, 8).map((item) => cleanString(item, 80)).filter(Boolean) : [],
      locations_count: enumValue(input.locationsCount || "1", allowed.locationsCount, "Количество точек"),
      comment: cleanString(input.comment, 1000),
      status: "new",
      created_at: nowIso(),
      updated_at: nowIso()
    };
    return ok(response, createPartnerApplication(application), 201);
  }

  if (request.method === "POST" && parts[0] === "contact-requests") {
    const input = await readBody(request);
    const contact = {
      id: generateId("contact"),
      name: cleanString(input.name, 80, true, "Имя"),
      phone: validatePhone(input.phone),
      email: validateEmail(input.email),
      type: enumValue(input.type || "other", allowed.requestTypes, "Тип обращения"),
      message: cleanString(input.message, 1000, true, "Сообщение"),
      status: "new",
      created_at: nowIso(),
      updated_at: nowIso()
    };
    return ok(response, createContactRequest(contact), 201);
  }

  return fail(response, 404, "NOT_FOUND", "Public API endpoint не найден");
}

async function handleAdmin(request, response, url) {
  const parts = routeParts(url.pathname, "/api/admin/");

  if (request.method === "POST" && parts.join("/") === "auth/login") {
    if (!rateLimit(`${ip(request)}:admin-login`)) return fail(response, 429, "RATE_LIMIT", "Слишком много попыток входа");
    const input = await readBody(request);
    const session = adminLogin(input.login, input.password);
    if (!session) return fail(response, 401, "BAD_CREDENTIALS", "Неверный логин или пароль");
    return ok(response, { role: "admin" }, 200, { "Set-Cookie": cookieForSession(session, secureCookie()) });
  }

  if (request.method === "GET" && parts.join("/") === "auth/me") {
    const auth = requireAdmin(request);
    if (!auth.ok) return sendAuthFailure(response, auth);
    return ok(response, { role: "admin" });
  }

  if (request.method === "POST" && parts.join("/") === "auth/logout") {
    logout(request);
    return ok(response, { loggedOut: true }, 200, { "Set-Cookie": expiredSessionCookie() });
  }

  const auth = requireAdmin(request);
  if (!auth.ok) return sendAuthFailure(response, auth);

  if (request.method === "GET" && parts[0] === "dashboard") return ok(response, admin.dashboard());
  if (request.method === "GET" && parts[0] === "audit-log") return ok(response, listAdminData("auditLog"));

  if (parts[0] === "partners") return handleAdminPartners(request, response, parts);
  if (parts[0] === "offers") return handleAdminOffers(request, response, parts);
  if (parts[0] === "bookings") return handleAdminBookings(request, response, parts);
  if (parts[0] === "partner-applications") return handleAdminApplications(request, response, parts);
  if (parts[0] === "contact-requests") return handleAdminContacts(request, response, parts);

  return fail(response, 404, "NOT_FOUND", "Admin API endpoint не найден");
}

async function handleAdminPartners(request, response, parts) {
  const partnerId = parts[1];
  if (request.method === "GET" && !partnerId) return ok(response, listAdminData("partners"));
  if (request.method === "POST" && !partnerId) return ok(response, admin.createPartnerInput(await readBody(request)), 201);
  if (request.method === "PATCH" && partnerId && !parts[2]) return ok(response, admin.patchItem("partners", partnerId, await readBody(request)));
  if (request.method === "DELETE" && partnerId && !parts[2]) return ok(response, { deleted: admin.deleteItem("partners", partnerId) });
  if (request.method === "GET" && partnerId && parts[2] === "addresses") return ok(response, listAdminData("partnerAddresses").filter((item) => item.partner_id === partnerId));
  if (request.method === "POST" && partnerId && parts[2] === "addresses") return ok(response, admin.createAddressInput(partnerId, await readBody(request)), 201);
  if (request.method === "PATCH" && partnerId && parts[2] === "addresses" && parts[3]) return ok(response, admin.patchItem("partnerAddresses", parts[3], await readBody(request)));
  if (request.method === "DELETE" && partnerId && parts[2] === "addresses" && parts[3]) return ok(response, { deleted: admin.deleteItem("partnerAddresses", parts[3]) });
  if (request.method === "GET" && partnerId && parts[2] === "users") return ok(response, listAdminData("partnerUsers").filter((item) => item.partner_id === partnerId).map(({ password_hash, password_salt, ...safe }) => safe));
  if (request.method === "POST" && partnerId && parts[2] === "users") return ok(response, admin.createPartnerUserInput(partnerId, await readBody(request)), 201);
  if (request.method === "PATCH" && partnerId && parts[2] === "users" && parts[3]) return ok(response, admin.patchPartnerUserInput(partnerId, parts[3], await readBody(request)));
  if (request.method === "DELETE" && partnerId && parts[2] === "users" && parts[3]) return ok(response, { deleted: admin.deletePartnerUser(partnerId, parts[3]) });
  return fail(response, 404, "NOT_FOUND", "Partner endpoint не найден");
}

async function handleAdminOffers(request, response, parts) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, listAdminData("offers"));
  if (request.method === "POST" && !id) return ok(response, admin.createOfferInput(await readBody(request)), 201);
  if (request.method === "PATCH" && id) return ok(response, admin.patchItem("offers", id, await readBody(request)));
  if (request.method === "DELETE" && id) return ok(response, { deleted: admin.deleteItem("offers", id) });
  return fail(response, 404, "NOT_FOUND", "Offer endpoint не найден");
}

async function handleAdminBookings(request, response, parts) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, listAdminData("bookings"));
  if (request.method === "PATCH" && id && parts[2] === "status") {
    const input = await readBody(request);
    return ok(response, admin.setStatus("bookings", id, input.status, allowed.bookingStatuses));
  }
  return fail(response, 404, "NOT_FOUND", "Booking endpoint не найден");
}

async function handleAdminApplications(request, response, parts) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, listAdminData("partnerApplications"));
  if (request.method === "PATCH" && id && parts[2] === "status") {
    const input = await readBody(request);
    return ok(response, admin.setStatus("partnerApplications", id, input.status, allowed.applicationStatuses));
  }
  if (request.method === "POST" && id && parts[2] === "create-partner") return ok(response, admin.approveApplication(id), 201);
  return fail(response, 404, "NOT_FOUND", "Application endpoint не найден");
}

async function handleAdminContacts(request, response, parts) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, listAdminData("contactRequests"));
  if (request.method === "PATCH" && id && parts[2] === "status") {
    const input = await readBody(request);
    return ok(response, admin.setStatus("contactRequests", id, input.status, allowed.contactStatuses));
  }
  return fail(response, 404, "NOT_FOUND", "Contact endpoint не найден");
}

async function handlePartner(request, response, url) {
  const parts = routeParts(url.pathname, "/api/partner/");

  if (request.method === "POST" && parts.join("/") === "auth/login") {
    if (!rateLimit(`${ip(request)}:partner-login`)) return fail(response, 429, "RATE_LIMIT", "Слишком много попыток входа");
    const input = await readBody(request);
    const session = partnerLogin(input.login, input.password);
    if (!session) return fail(response, 401, "BAD_CREDENTIALS", "Неверный логин или пароль");
    return ok(response, { role: "partner", partnerId: session.partner_id }, 200, { "Set-Cookie": cookieForSession(session, secureCookie()) });
  }

  if (request.method === "POST" && parts.join("/") === "auth/logout") {
    logout(request);
    return ok(response, { loggedOut: true }, 200, { "Set-Cookie": expiredSessionCookie() });
  }

  const auth = requirePartner(request);
  if (!auth.ok) return sendAuthFailure(response, auth);
  const partnerId = auth.session.partner_id;

  if (request.method === "GET" && parts.join("/") === "auth/me") return ok(response, { role: "partner", partnerId });
  if (request.method === "GET" && parts[0] === "dashboard") return ok(response, partner.dashboard(partnerId));
  if (request.method === "GET" && parts[0] === "profile") return ok(response, partner.profile(partnerId));
  if (request.method === "PATCH" && parts[0] === "profile") return ok(response, partner.patchProfile(partnerId, await readBody(request)));
  if (parts[0] === "addresses") return handlePartnerAddresses(request, response, parts, partnerId);
  if (parts[0] === "offers") return handlePartnerOffers(request, response, parts, partnerId);
  if (parts[0] === "bookings") return handlePartnerBookings(request, response, parts, partnerId);
  return fail(response, 404, "NOT_FOUND", "Partner API endpoint не найден");
}

async function handlePartnerAddresses(request, response, parts, partnerId) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, partner.scoped(partnerId, "addresses"));
  if (request.method === "POST" && !id) return ok(response, partner.createOwnAddress(partnerId, await readBody(request)), 201);
  if (request.method === "PATCH" && id) return ok(response, partner.patchOwn("partnerAddresses", partnerId, id, await readBody(request)));
  if (request.method === "DELETE" && id) return ok(response, { deleted: partner.deleteOwn("partnerAddresses", partnerId, id) });
  return fail(response, 404, "NOT_FOUND", "Address endpoint не найден");
}

async function handlePartnerOffers(request, response, parts, partnerId) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, partner.scoped(partnerId, "offers"));
  if (request.method === "POST" && !id) return ok(response, partner.createOwnOffer(partnerId, await readBody(request)), 201);
  if (request.method === "POST" && id && parts[2] === "duplicate") return ok(response, partner.duplicateOwnOffer(partnerId, id), 201);
  if (request.method === "PATCH" && id && parts[2] === "status") return ok(response, partner.patchOwn("offers", partnerId, id, { status: enumValue((await readBody(request)).status, allowed.offerStatuses, "Статус") }));
  if (request.method === "PATCH" && id && !parts[2]) return ok(response, partner.patchOwn("offers", partnerId, id, await readBody(request)));
  if (request.method === "DELETE" && id) return ok(response, { deleted: partner.deleteOwn("offers", partnerId, id) });
  return fail(response, 404, "NOT_FOUND", "Offer endpoint не найден");
}

async function handlePartnerBookings(request, response, parts, partnerId) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, partner.scoped(partnerId, "bookings"));
  if (request.method === "PATCH" && id && parts[2] === "status") {
    const input = await readBody(request);
    return ok(response, partner.patchOwn("bookings", partnerId, id, { status: enumValue(input.status, allowed.bookingStatuses, "Статус") }));
  }
  return fail(response, 404, "NOT_FOUND", "Booking endpoint не найден");
}
