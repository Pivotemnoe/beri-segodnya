import { updateDb, readDb } from "../storage/jsonStore.mjs";
import { generateCode, generateId } from "../utils/id.mjs";
import { nowIso } from "../utils/dates.mjs";

export function publicOfferView(offer, db) {
  const partner = db.partners.find((item) => item.id === offer.partner_id);
  const address = db.partnerAddresses.find((item) => item.id === offer.address_id);
  const status = offer.remaining_quantity <= 0 ? "sold_out" : offer.status;
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
    pickupWindow: offer.pickup_window,
    remaining: offer.remaining_quantity,
    status,
    ctaLabel: offer.cta_label,
    imageAlt: offer.image_alt || offer.title
  };
}

export function listPublicOffers(category) {
  const db = readDb();
  return db.offers
    .filter((offer) => offer.status === "active")
    .filter((offer) => !category || offer.category === category)
    .map((offer) => publicOfferView(offer, db));
}

export function getPublicOffer(id) {
  const db = readDb();
  const offer = db.offers.find((item) => item.id === id);
  return offer ? publicOfferView(offer, db) : null;
}

export function addAudit(db, actorRole, actorId, action, entityType, entityId, metadata = {}) {
  db.auditLog.push({
    id: generateId("audit"),
    actor_role: actorRole,
    actor_id: actorId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata_json: JSON.stringify(metadata),
    created_at: nowIso()
  });
}

export function createSession(role, partnerId = null) {
  return updateDb((db) => {
    const session = {
      id: generateId("session"),
      role,
      partner_id: partnerId,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
    };
    db.sessions.push(session);
    addAudit(db, role, partnerId, `${role}_login`, "session", session.id);
    return session;
  });
}

export function getSession(id) {
  if (!id) return null;
  const db = readDb();
  const session = db.sessions.find((item) => item.id === id);
  if (!session || new Date(session.expires_at).getTime() < Date.now()) return null;
  return session;
}

export function deleteSession(id) {
  return updateDb((db) => {
    db.sessions = db.sessions.filter((item) => item.id !== id);
  });
}

export function findPartnerUser(login) {
  return readDb().partnerUsers.find((user) => user.login === login && user.status === "active") || null;
}

export function createBookingAtomic(offerId, customerName, customerPhone, code) {
  return updateDb((db) => {
    const offer = db.offers.find((item) => item.id === offerId);
    if (!offer) {
      const error = new Error("Предложение не найдено");
      error.status = 404;
      error.code = "OFFER_NOT_FOUND";
      throw error;
    }
    if (offer.status !== "active") {
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
      created_at: time,
      updated_at: time
    };
    db.bookings.push(booking);
    addAudit(db, "system", null, "create_booking", "booking", booking.id, { offerId: offer.id });
    return { booking, offer };
  });
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
  const activeOffersCount = db.offers.filter((offer) => offer.status === "active").length;
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

export function createPartnerUser(data) {
  return updateDb((db) => {
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
    bookings: enrichBookings(db.bookings.filter((item) => item.partner_id === partnerId), db)
  };
}

export function partnerDashboard(partnerId) {
  const data = partnerScopedData(partnerId);
  const issued = data.bookings.filter((booking) => booking.status === "issued");
  return {
    activeOffersCount: data.offers.filter((offer) => offer.status === "active").length,
    bookingsCount: data.bookings.length,
    issuedBookingsCount: issued.length,
    noShowBookingsCount: data.bookings.filter((booking) => booking.status === "no_show").length,
    estimatedRevenue: issued.reduce((sum, booking) => sum + (data.offers.find((offer) => offer.id === booking.offer_id)?.price || 0), 0),
    recentOffers: data.offers.slice(-5).reverse(),
    recentBookings: data.bookings.slice(-5).reverse()
  };
}
