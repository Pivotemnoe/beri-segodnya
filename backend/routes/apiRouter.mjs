import { ok, fail } from "../utils/responses.mjs";
import { allowed, cleanString, enumValue, validateEmail, validatePhone } from "../utils/validation.mjs";
import { generateId } from "../utils/id.mjs";
import { nowIso } from "../utils/dates.mjs";
import { cancelPublicBooking, createContactRequest, createPartnerApplication, getPublicBooking, getPublicOffer, listAdminData, listPublicOffers } from "../repositories/databaseRepository.mjs";
import { createBooking } from "../services/bookingService.mjs";
import { adminLogin, cookieForSession, expiredSessionCookie, logout, partnerLogin, rateLimit, requireRole, sessionFromRequest } from "../services/authService.mjs";
import * as admin from "../services/adminService.mjs";
import * as partner from "../services/partnerService.mjs";
import { savePartnerImages } from "../storage/imageStore.mjs";

async function readBody(request, maxBytes = 32 * 1024) {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    const error = new Error("Тело запроса слишком большое");
    error.status = 413;
    error.code = "BODY_TOO_LARGE";
    throw error;
  }
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
  const trustProxy = process.env.TRUST_PROXY === "true";
  return (trustProxy ? request.headers["x-forwarded-for"]?.split(",")[0]?.trim() : null) || request.socket.remoteAddress || "unknown";
}

function secureCookie() {
  return process.env.APP_ENV === "production" || String(process.env.APP_BASE_URL || "").startsWith("https://");
}

function validateOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method || "GET")) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const configured = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : null;
  const forwardedProto = request.headers["x-forwarded-proto"] || "http";
  const requestOrigin = request.headers.host ? `${forwardedProto}://${request.headers.host}` : null;
  if (origin !== configured && origin !== requestOrigin) {
    const error = new Error("Источник запроса не разрешён");
    error.status = 403;
    error.code = "ORIGIN_NOT_ALLOWED";
    throw error;
  }
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
    validateOrigin(request);
    if (url.pathname.startsWith("/api/public/")) return await handlePublic(request, response, url);
    if (url.pathname.startsWith("/api/admin/")) return await handleAdmin(request, response, url);
    if (url.pathname.startsWith("/api/partner/")) return await handlePartner(request, response, url);
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
    if (parts[1] && parts[2] === "cancel") {
      if (!rateLimit(`${ip(request)}:booking-cancel`, 20, 10 * 60 * 1000)) return fail(response, 429, "RATE_LIMIT", "Слишком много запросов");
      const booking = cancelPublicBooking(parts[1]);
      return booking ? ok(response, { cancelled: true }) : fail(response, 404, "BOOKING_NOT_FOUND", "Бронь не найдена");
    }
    if (parts[1]) return fail(response, 404, "NOT_FOUND", "Booking endpoint не найден");
    if (!rateLimit(`${ip(request)}:booking-create`, 12, 10 * 60 * 1000)) return fail(response, 429, "RATE_LIMIT", "Слишком много бронирований. Попробуйте позже");
    return ok(response, createBooking(await readBody(request)), 201);
  }

  if (request.method === "GET" && parts[0] === "bookings" && parts[1]) {
    const booking = getPublicBooking(parts[1]);
    return booking ? ok(response, booking) : fail(response, 404, "BOOKING_NOT_FOUND", "Бронь не найдена");
  }

  if (request.method === "POST" && parts[0] === "partner-applications") {
    if (!rateLimit(`${ip(request)}:partner-application`, 5, 60 * 60 * 1000)) return fail(response, 429, "RATE_LIMIT", "Слишком много заявок. Попробуйте позже");
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
    if (!rateLimit(`${ip(request)}:contact-request`, 8, 60 * 60 * 1000)) return fail(response, 429, "RATE_LIMIT", "Слишком много обращений. Попробуйте позже");
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
    return ok(response, auth.ok
      ? { authenticated: true, role: "admin" }
      : { authenticated: false });
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
  if (request.method === "PATCH" && partnerId && !parts[2]) return ok(response, admin.patchPartnerInput(partnerId, await readBody(request)));
  if (request.method === "DELETE" && partnerId && !parts[2]) return ok(response, { deleted: admin.deleteItem("partners", partnerId) });
  if (request.method === "GET" && partnerId && parts[2] === "addresses") return ok(response, listAdminData("partnerAddresses").filter((item) => item.partner_id === partnerId));
  if (request.method === "POST" && partnerId && parts[2] === "addresses") return ok(response, admin.createAddressInput(partnerId, await readBody(request)), 201);
  if (request.method === "PATCH" && partnerId && parts[2] === "addresses" && parts[3]) return ok(response, admin.patchAddressInput(partnerId, parts[3], await readBody(request)));
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
  if (request.method === "PATCH" && id) return ok(response, admin.patchOfferInput(id, await readBody(request)));
  if (request.method === "DELETE" && id) return ok(response, { deleted: admin.deleteItem("offers", id) });
  return fail(response, 404, "NOT_FOUND", "Offer endpoint не найден");
}

async function handleAdminBookings(request, response, parts) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, listAdminData("bookings"));
  if (request.method === "PATCH" && id && parts[2] === "status") {
    const input = await readBody(request);
    return ok(response, admin.setBookingStatusInput(id, input.status));
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

  if (request.method === "GET" && parts.join("/") === "auth/me") {
    const auth = requirePartner(request);
    return ok(response, auth.ok
      ? { authenticated: true, role: "partner", partnerId: auth.session.partner_id }
      : { authenticated: false });
  }

  const auth = requirePartner(request);
  if (!auth.ok) return sendAuthFailure(response, auth);
  const partnerId = auth.session.partner_id;

  if (request.method === "GET" && parts[0] === "dashboard") return ok(response, partner.dashboard(partnerId));
  if (request.method === "GET" && parts[0] === "profile") return ok(response, partner.profile(partnerId));
  if (request.method === "PATCH" && parts[0] === "profile") return ok(response, partner.patchProfile(partnerId, await readBody(request)));
  if (request.method === "POST" && parts[0] === "uploads") {
    if (!rateLimit(`${ip(request)}:${partnerId}:photo-upload`, 30, 60 * 60 * 1000)) return fail(response, 429, "RATE_LIMIT", "Слишком много загрузок. Попробуйте позже");
    const input = await readBody(request, 16 * 1024 * 1024);
    return ok(response, { images: savePartnerImages(partnerId, input.images) }, 201);
  }
  if (parts[0] === "offer-templates") return handlePartnerTemplates(request, response, parts, partnerId);
  if (parts[0] === "addresses") return handlePartnerAddresses(request, response, parts, partnerId);
  if (parts[0] === "offers") return handlePartnerOffers(request, response, parts, partnerId);
  if (parts[0] === "bookings") return handlePartnerBookings(request, response, parts, partnerId);
  return fail(response, 404, "NOT_FOUND", "Partner API endpoint не найден");
}

async function handlePartnerTemplates(request, response, parts, partnerId) {
  const id = parts[1];
  if (request.method === "GET" && !id) return ok(response, partner.scoped(partnerId, "templates"));
  if (request.method === "POST" && !id) return ok(response, partner.createOwnTemplate(partnerId, await readBody(request)), 201);
  if (request.method === "PATCH" && id) return ok(response, partner.patchOwnTemplate(partnerId, id, await readBody(request)));
  if (request.method === "DELETE" && id) return ok(response, { deleted: partner.deleteOwnTemplate(partnerId, id) });
  return fail(response, 404, "NOT_FOUND", "Template endpoint не найден");
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
