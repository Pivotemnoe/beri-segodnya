import crypto from "node:crypto";
import { updateDb, readDb } from "../storage/jsonStore.mjs";
import { generateCode, generateId } from "../utils/id.mjs";
import { isOfferAvailableNow, nowIso, pickupEndIso } from "../utils/dates.mjs";

const categoryImages = {
  lunch: "/images/offer-lunch-v2.png",
  bakery: "/images/offer-bakery-v2.png",
  evening: "/images/offer-evening-v2.png"
};

function sessionHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function activeOfferRecord(offer, db, date = new Date()) {
  const partner = db.partners.find((item) => item.id === offer.partner_id);
  const address = db.partnerAddresses.find((item) => item.id === offer.address_id && item.partner_id === offer.partner_id);
  return Boolean(
    partner?.status === "active" &&
    address?.is_active !== false &&
    offer.status === "active" &&
    offer.remaining_quantity > 0 &&
    isOfferAvailableNow(offer, date)
  );
}

export function publicOfferView(offer, db) {
  const partner = db.partners.find((item) => item.id === offer.partner_id);
  const address = db.partnerAddresses.find((item) => item.id === offer.address_id);
  const status = offer.remaining_quantity <= 0 ? "sold_out" : offer.status;
  const fallbackImage = categoryImages[offer.category] || categoryImages.lunch;
  const imageUrls = Array.isArray(offer.image_urls) && offer.image_urls.length
    ? offer.image_urls.slice(0, 3)
    : [offer.image_url || fallbackImage];
  return {
    id: offer.id,
    partnerId: offer.partner_id,
    partnerName: partner?.name || "Заведение",
    addressId: offer.address_id,
    address: address?.address || "Армавир, тестовый адрес",
    title: offer.title,
    category: offer.category,
    price: offer.price,
    oldPrice: offer.old_price,
    description: offer.description || "Набор приготовлен сегодня. Точный состав уточняйте в карточке предложения.",
    contents: offer.contents || "Состав набора может меняться в пределах указанной категории.",
    weight: offer.weight || "",
    allergens: offer.allergens || "Уточняйте у сотрудника заведения",
    pickupWindow: offer.pickup_window,
    date: offer.date,
    remaining: offer.remaining_quantity,
    status,
    ctaLabel: offer.cta_label,
    imageAlt: offer.image_alt || offer.title,
    imageUrl: imageUrls[0],
    imageUrls,
    photoCapturedAt: offer.photo_captured_at || offer.updated_at || offer.created_at,
    sourceType: offer.source_type || "manual",
    publishedAt: offer.updated_at || offer.created_at,
    savingsPercent: offer.old_price > offer.price ? Math.round((1 - offer.price / offer.old_price) * 100) : 0
  };
}

export function listPublicOffers(category) {
  const db = readDb();
  return db.offers
    .filter((offer) => activeOfferRecord(offer, db))
    .filter((offer) => !category || offer.category === category)
    .sort((left, right) => String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at)))
    .map((offer) => publicOfferView(offer, db));
}

export function getPublicOffer(id) {
  const db = readDb();
  const offer = db.offers.find((item) => item.id === id);
  return offer && activeOfferRecord(offer, db) ? publicOfferView(offer, db) : null;
}

export function addAudit(db, actorRole, actorId, action, entityType, entityId, metadata = {}) {
  const safeMetadata = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, /(password|hash|salt|secret|token)/i.test(key) ? "[redacted]" : value])
  );
  db.auditLog.push({
    id: generateId("audit"),
    actor_role: actorRole,
    actor_id: actorId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata_json: JSON.stringify(safeMetadata),
    created_at: nowIso()
  });
}

export function createSession(role, partnerId = null) {
  return updateDb((db) => {
    db.sessions = db.sessions.filter((item) => new Date(item.expires_at).getTime() > Date.now());
    const token = generateId("session");
    const session = {
      id_hash: sessionHash(token),
      role,
      partner_id: partnerId,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
    };
    db.sessions.push(session);
    addAudit(db, role, partnerId, `${role}_login`, "session", session.id_hash);
    return { ...session, id: token };
  });
}

export function getSession(id) {
  if (!id) return null;
  const db = readDb();
  const hash = sessionHash(id);
  const session = db.sessions.find((item) => item.id_hash === hash || item.id === id);
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
  return session;
}

export function deleteSession(id) {
  return updateDb((db) => {
    const hash = sessionHash(id);
    db.sessions = db.sessions.filter((item) => item.id_hash !== hash && item.id !== id);
  });
}

export function findPartnerUser(login) {
  const db = readDb();
  const normalized = String(login || "").trim().toLowerCase();
  const user = db.partnerUsers.find((item) => item.login.toLowerCase() === normalized && item.status === "active");
  const owner = user && db.partners.find((partner) => partner.id === user.partner_id);
  return owner?.status === "active" ? user : null;
}

export function isPartnerActive(partnerId) {
  return readDb().partners.some((partner) => partner.id === partnerId && partner.status === "active");
}

export function createBookingAtomic(offerId, customerName, customerPhone, code) {
  return updateDb((db) => {
    const offer = db.offers.find((item) => item.id === offerId);
    const partner = db.partners.find((item) => item.id === offer?.partner_id);
    const address = db.partnerAddresses.find((item) => item.id === offer?.address_id && item.partner_id === offer?.partner_id);
    if (!offer) {
      const error = new Error("Предложение не найдено");
      error.status = 404;
      error.code = "OFFER_NOT_FOUND";
      throw error;
    }
    if (partner?.status !== "active" || address?.is_active === false || offer.status !== "active" || !isOfferAvailableNow(offer)) {
      const error = new Error("Предложение недоступно");
      error.status = 409;
      error.code = "OFFER_NOT_ACTIVE";
      throw error;
    }
    if (offer.remaining_quantity <= 0) {
      const error = new Error("Предложение уже закончилось");
      error.status = 409;
      error.code = "OFFER_SOLD_OUT";
      throw error;
    }

    const existingCodes = new Set(db.bookings.map((booking) => booking.code));
    const bookingCode = code && !existingCodes.has(code) ? code : generateCode(existingCodes);
    const time = nowIso();
    offer.remaining_quantity -= 1;
    offer.updated_at = time;
    if (offer.remaining_quantity <= 0) offer.status = "sold_out";

    const booking = {
      id: generateId("booking"),
      code: bookingCode,
      offer_id: offer.id,
      partner_id: offer.partner_id,
      address_id: offer.address_id,
      customer_name: customerName,
      customer_phone: customerPhone,
      status: "created",
      public_token: generateId("booking-view"),
      expires_at: pickupEndIso(offer.date, offer.pickup_window),
      created_at: time,
      updated_at: time
    };
    db.bookings.push(booking);
    addAudit(db, "system", null, "create_booking", "booking", booking.id, { offerId: offer.id });
    return { booking, offer };
  });
}

export function getPublicBooking(publicToken) {
  if (!publicToken) return null;
  const db = readDb();
  const booking = db.bookings.find((item) => item.public_token === publicToken);
  if (!booking) return null;
  const offer = db.offers.find((item) => item.id === booking.offer_id);
  const partner = db.partners.find((item) => item.id === booking.partner_id);
  const address = db.partnerAddresses.find((item) => item.id === booking.address_id);
  return {
    publicToken: booking.public_token,
    code: booking.code,
    status: booking.status,
    createdAt: booking.created_at,
    expiresAt: booking.expires_at,
    offerTitle: offer?.title || "Предложение",
    pickupWindow: offer?.pickup_window || "",
    price: offer?.price || 0,
    partnerName: partner?.name || "Заведение",
    address: address?.address || ""
  };
}

export function setBookingStatus(id, nextStatus, actorRole = "admin", actorId = null) {
  return updateDb((db) => {
    const booking = db.bookings.find((item) => item.id === id);
    if (!booking) return null;
    const transitions = {
      created: ["issued", "no_show", "cancelled"],
      issued: [],
      no_show: [],
      cancelled: []
    };
    if (booking.status !== nextStatus && !transitions[booking.status]?.includes(nextStatus)) {
      const error = new Error("Недопустимый переход статуса брони");
      error.status = 409;
      error.code = "BOOKING_STATUS_CONFLICT";
      throw error;
    }
    const previousStatus = booking.status;
    booking.status = nextStatus;
    booking.updated_at = nowIso();
    if (previousStatus === "created" && nextStatus === "cancelled") {
      const offer = db.offers.find((item) => item.id === booking.offer_id);
      if (offer && isOfferAvailableNow(offer)) {
        offer.remaining_quantity = Math.min(offer.total_quantity, offer.remaining_quantity + 1);
        if (offer.status === "sold_out" && isOfferAvailableNow(offer)) offer.status = "active";
        offer.updated_at = booking.updated_at;
      }
    }
    addAudit(db, actorRole, actorId, "set_booking_status", "booking", booking.id, { from: previousStatus, to: nextStatus });
    return booking;
  });
}

export function cancelPublicBooking(publicToken) {
  const db = readDb();
  const booking = db.bookings.find((item) => item.public_token === publicToken);
  if (!booking) return null;
  return setBookingStatus(booking.id, "cancelled", "customer", null);
}

export function createPartnerApplication(application) {
  return updateDb((db) => {
    db.partnerApplications.push(application);
    addAudit(db, "system", null, "create_partner_application", "partner_application", application.id);
    return application;
  });
}

export function createContactRequest(request) {
  return updateDb((db) => {
    db.contactRequests.push(request);
    addAudit(db, "system", null, "create_contact_request", "contact_request", request.id);
    return request;
  });
}

export function adminDashboard() {
  const db = readDb();
  const activeOffersCount = db.offers.filter((offer) => activeOfferRecord(offer, db)).length;
  const issued = db.bookings.filter((booking) => booking.status === "issued");
  const estimatedPartnerRevenue = issued.reduce((sum, booking) => {
    const offer = db.offers.find((item) => item.id === booking.offer_id);
    return sum + (offer?.price || 0);
  }, 0);
  return {
    activeOffersCount,
    bookingsCount: db.bookings.length,
    issuedBookingsCount: issued.length,
    newPartnerApplicationsCount: db.partnerApplications.filter((item) => item.status === "new").length,
    newContactRequestsCount: db.contactRequests.filter((item) => item.status === "new").length,
    estimatedPartnerRevenue,
    latestBookings: enrichBookings(db.bookings.slice(-5).reverse(), db),
    latestPartnerApplications: db.partnerApplications.slice(-5).reverse()
  };
}

export function enrichBookings(bookings, db = readDb()) {
  return bookings.map((booking) => {
    const offer = db.offers.find((item) => item.id === booking.offer_id);
    const partner = db.partners.find((item) => item.id === booking.partner_id);
    return {
      ...booking,
      offerTitle: offer?.title || "Предложение удалено",
      partnerName: partner?.name || "Партнёр удалён"
    };
  });
}

export function listAdminData(name) {
  const db = readDb();
  if (name === "bookings") return enrichBookings(db.bookings, db);
  return db[name] || [];
}

export function createPartner(data) {
  return updateDb((db) => {
    const time = nowIso();
    const partner = { id: generateId("partner"), slug: data.slug || generateId("partner-slug"), status: "active", ...data, created_at: time, updated_at: time };
    db.partners.push(partner);
    addAudit(db, "admin", null, "create_partner", "partner", partner.id);
    return partner;
  });
}

export function onboardPartner({ partner: partnerData, address: addressData, user: userData, applicationId = null }) {
  return updateDb((db) => {
    if (db.partnerUsers.some((user) => user.login.toLowerCase() === userData.login.toLowerCase())) {
      const error = new Error("Пользователь с таким логином уже существует");
      error.status = 409;
      error.code = "LOGIN_ALREADY_EXISTS";
      throw error;
    }

    const application = applicationId
      ? db.partnerApplications.find((item) => item.id === applicationId)
      : null;
    if (applicationId && !application) {
      const error = new Error("Заявка партнёра не найдена");
      error.status = 404;
      error.code = "APPLICATION_NOT_FOUND";
      throw error;
    }
    if (application?.created_partner_id) {
      const error = new Error("По этой заявке партнёр уже создан");
      error.status = 409;
      error.code = "APPLICATION_ALREADY_CONVERTED";
      throw error;
    }

    const time = nowIso();
    const partner = {
      id: generateId("partner"),
      slug: partnerData.slug || generateId("partner-slug"),
      status: "active",
      ...partnerData,
      created_at: time,
      updated_at: time
    };
    const address = {
      id: generateId("address"),
      partner_id: partner.id,
      is_active: true,
      ...addressData,
      created_at: time,
      updated_at: time
    };
    const user = {
      id: generateId("partner-user"),
      partner_id: partner.id,
      role: "owner",
      status: "active",
      ...userData,
      created_at: time,
      updated_at: time
    };

    db.partners.push(partner);
    db.partnerAddresses.push(address);
    db.partnerUsers.push(user);
    if (application) {
      application.status = "approved";
      application.created_partner_id = partner.id;
      application.updated_at = time;
    }
    addAudit(db, "admin", null, "onboard_partner", "partner", partner.id, { applicationId });

    const { password_hash, password_salt, ...safeUser } = user;
    return { partner, address, user: safeUser };
  });
}

export function patchCollectionItem(collection, id, patch, actorRole = "admin") {
  return updateDb((db) => {
    const item = db[collection].find((entry) => entry.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updated_at: nowIso() });
    addAudit(db, actorRole, null, `patch_${collection}`, collection, id, patch);
    return item;
  });
}

export function deleteCollectionItem(collection, id, actorRole = "admin") {
  return updateDb((db) => {
    const before = db[collection].length;
    db[collection] = db[collection].filter((entry) => entry.id !== id);
    if (before !== db[collection].length) addAudit(db, actorRole, null, `delete_${collection}`, collection, id);
    return before !== db[collection].length;
  });
}

export function createAddress(partnerId, data, actorRole = "admin") {
  return updateDb((db) => {
    const partner = db.partners.find((item) => item.id === partnerId);
    if (!partner) return null;
    const time = nowIso();
    const address = { id: generateId("address"), partner_id: partnerId, is_active: true, ...data, created_at: time, updated_at: time };
    db.partnerAddresses.push(address);
    addAudit(db, actorRole, partnerId, "create_address", "partner_address", address.id);
    return address;
  });
}

export function createOffer(data, actorRole = "admin", actorId = null) {
  return updateDb((db) => {
    const partner = db.partners.find((item) => item.id === data.partner_id);
    const address = db.partnerAddresses.find((item) => item.id === data.address_id && item.partner_id === data.partner_id);
    if (!partner || !address) return null;
    const time = nowIso();
    const offer = { id: generateId("offer"), status: "active", ...data, created_at: time, updated_at: time };
    db.offers.push(offer);
    addAudit(db, actorRole, actorId || data.partner_id, "create_offer", "offer", offer.id);
    return offer;
  });
}

export function createOfferTemplate(data, actorRole = "partner", actorId = null) {
  return updateDb((db) => {
    const partner = db.partners.find((item) => item.id === data.partner_id);
    const address = data.address_id
      ? db.partnerAddresses.find((item) => item.id === data.address_id && item.partner_id === data.partner_id)
      : null;
    if (!partner || (data.address_id && !address)) return null;
    const time = nowIso();
    const template = {
      id: generateId("offer-template"),
      is_active: true,
      ...data,
      created_at: time,
      updated_at: time
    };
    db.offerTemplates.push(template);
    addAudit(db, actorRole, actorId || data.partner_id, "create_offer_template", "offer_template", template.id);
    return template;
  });
}

export function createPartnerUser(data) {
  return updateDb((db) => {
    if (db.partnerUsers.some((user) => user.login.toLowerCase() === data.login.toLowerCase())) {
      const error = new Error("Пользователь с таким логином уже существует");
      error.status = 409;
      error.code = "LOGIN_ALREADY_EXISTS";
      throw error;
    }
    const time = nowIso();
    const user = { id: generateId("partner-user"), role: "owner", status: "active", ...data, created_at: time, updated_at: time };
    db.partnerUsers.push(user);
    addAudit(db, "admin", null, "create_partner_user", "partner_user", user.id, { partnerId: user.partner_id });
    const { password_hash, password_salt, ...safe } = user;
    return safe;
  });
}

export function createPartnerFromApplication(applicationId, userData = null) {
  return updateDb((db) => {
    const application = db.partnerApplications.find((item) => item.id === applicationId);
    if (!application) return null;
    if (application.created_partner_id) {
      return {
        partner: db.partners.find((item) => item.id === application.created_partner_id) || null,
        address: db.partnerAddresses.find((item) => item.partner_id === application.created_partner_id) || null,
        alreadyCreated: true
      };
    }
    const time = nowIso();
    const partner = {
      id: generateId("partner"),
      slug: generateId("partner-slug"),
      name: application.venue_name,
      type: application.venue_type === "ready_food_cafe" ? "ready_food_cafe" : application.venue_type,
      contact_name: application.contact_name,
      phone: application.phone,
      email: application.email || "",
      status: "active",
      created_at: time,
      updated_at: time
    };
    const address = {
      id: generateId("address"),
      partner_id: partner.id,
      title: "Основная точка",
      city: application.city,
      address: application.first_address,
      is_active: true,
      created_at: time,
      updated_at: time
    };
    db.partners.push(partner);
    db.partnerAddresses.push(address);
    if (userData) {
      db.partnerUsers.push({ id: generateId("partner-user"), partner_id: partner.id, role: "owner", status: "active", created_at: time, updated_at: time, ...userData });
    }
    application.status = "approved";
    application.created_partner_id = partner.id;
    application.updated_at = time;
    addAudit(db, "admin", null, "create_partner_from_application", "partner", partner.id, { applicationId });
    return { partner, address };
  });
}

export function partnerScopedData(partnerId) {
  const db = readDb();
  return {
    partner: db.partners.find((item) => item.id === partnerId),
    addresses: db.partnerAddresses.filter((item) => item.partner_id === partnerId),
    offers: db.offers.filter((item) => item.partner_id === partnerId),
    templates: db.offerTemplates.filter((item) => item.partner_id === partnerId && item.is_active !== false),
    bookings: enrichBookings(db.bookings.filter((item) => item.partner_id === partnerId), db)
  };
}

export function partnerDashboard(partnerId) {
  const data = partnerScopedData(partnerId);
  const issued = data.bookings.filter((booking) => booking.status === "issued");
  return {
    activeOffersCount: data.offers.filter((offer) => offer.status === "active" && offer.remaining_quantity > 0 && isOfferAvailableNow(offer)).length,
    bookingsCount: data.bookings.length,
    issuedBookingsCount: issued.length,
    noShowBookingsCount: data.bookings.filter((booking) => booking.status === "no_show").length,
    estimatedRevenue: issued.reduce((sum, booking) => sum + (data.offers.find((offer) => offer.id === booking.offer_id)?.price || 0), 0),
    recentOffers: data.offers.slice(-5).reverse(),
    recentBookings: data.bookings.slice(-5).reverse()
  };
}
