import { createPasswordHash } from "../utils/password.mjs";
import { todayDate } from "../utils/dates.mjs";
import { allowed, cleanString, enumValue, integerRange, numberRange, validateEmail, validatePhone } from "../utils/validation.mjs";
import { partnerUploadFolder } from "../storage/imageStore.mjs";
import {
  adminDashboard,
  createAddress,
  createOffer,
  onboardPartner,
  createPartner,
  createPartnerFromApplication,
  createPartnerUser,
  archivePartner,
  deleteAdminRecord,
  deleteCollectionItem,
  deletePartnerPermanently,
  listAdminData,
  patchCollectionItem,
  setBookingStatus
} from "../repositories/databaseRepository.mjs";

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function passwordValue(value) {
  const password = cleanString(value, 120, true, "Пароль");
  if (password.length < 12) {
    const error = new Error("Пароль должен содержать не менее 12 символов");
    error.status = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }
  return password;
}

function offerDate(value) {
  const date = cleanString(value, 10, true, "Дата");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    const error = new Error("Дата должна быть в формате ГГГГ-ММ-ДД");
    error.status = 400;
    error.code = "INVALID_DATE";
    throw error;
  }
  return date;
}

function pickupWindow(value) {
  const window = cleanString(value, 40, true, "Время выдачи");
  const times = window.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
  if (times.length !== 2) {
    const error = new Error("Укажите интервал выдачи, например 15:30–18:00");
    error.status = 400;
    error.code = "INVALID_PICKUP_WINDOW";
    throw error;
  }
  const minutes = times.map((time) => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  });
  if (minutes[1] <= minutes[0]) {
    const error = new Error("Окончание выдачи должно быть позже начала");
    error.status = 400;
    error.code = "INVALID_PICKUP_WINDOW";
    throw error;
  }
  return window;
}

function localImageUrls(value, actorRole, partnerId) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3) {
    const error = new Error("Можно прикрепить не больше трёх фото");
    error.status = 400;
    error.code = "INVALID_IMAGES";
    throw error;
  }
  const ownPrefix = `/uploads/${partnerUploadFolder(partnerId)}/`;
  return value.map((item) => cleanString(item, 240, true, "Фото")).filter((item) => {
    const allowedStatic = /^\/images\/[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp)$/.test(item);
    const allowedUpload = /^\/uploads\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.(?:jpg|png|webp)$/.test(item);
    if (!allowedStatic && !allowedUpload) {
      const error = new Error("Недопустимый адрес фото");
      error.status = 400;
      error.code = "INVALID_IMAGE_URL";
      throw error;
    }
    if (actorRole === "partner" && allowedUpload && !item.startsWith(ownPrefix)) {
      const error = new Error("Нельзя использовать фото другого партнёра");
      error.status = 403;
      error.code = "IMAGE_ACCESS_DENIED";
      throw error;
    }
    return true;
  });
}

function isoDateTime(value, label) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${label}: некорректная дата`);
    error.status = 400;
    error.code = "INVALID_DATE_TIME";
    throw error;
  }
  return parsed.toISOString();
}

export function dashboard() {
  return adminDashboard();
}

export function auditLog() {
  return listAdminData("auditLog").map((row) => ({
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    createdAt: row.created_at
  }));
}

export function list(collection) {
  return listAdminData(collection);
}

export function createPartnerInput(input) {
  return createPartner({
    name: cleanString(input.name, 120, true, "Название партнёра"),
    type: enumValue(input.type || "other", allowed.partnerTypes, "Тип партнёра"),
    contact_name: cleanString(input.contactName || input.contact_name, 80),
    phone: input.phone ? validatePhone(input.phone) : "",
    email: validateEmail(input.email),
    status: enumValue(input.status || "active", allowed.partnerStatuses, "Статус")
  });
}

export function onboardPartnerInput(input) {
  const { hash, salt, iterations } = createPasswordHash(passwordValue(input.password));
  return onboardPartner({
    partner: {
      name: cleanString(input.partnerName || input.name, 120, true, "Название партнёра"),
      type: enumValue(input.partnerType || input.type || "other", allowed.partnerTypes, "Тип партнёра"),
      contact_name: cleanString(input.contactName || input.contact_name, 80),
      phone: input.phone ? validatePhone(input.phone) : "",
      email: validateEmail(input.email),
      status: "active"
    },
    address: {
      title: cleanString(input.addressTitle || input.title || "Основная точка", 120, true, "Название точки"),
      city: cleanString(input.city || "Армавир", 80, true, "Город"),
      address: cleanString(input.address, 160, true, "Адрес"),
      is_active: true
    },
    user: {
      name: cleanString(input.userName || input.contactName, 120, true, "Имя пользователя"),
      login: cleanString(input.login, 80, true, "Логин"),
      password_hash: hash,
      password_salt: salt,
      password_iterations: iterations,
      must_change_password: true,
      role: "owner",
      status: "active"
    },
    applicationId: cleanString(input.applicationId, 120) || null
  });
}

export function createAddressInput(partnerId, input) {
  return createAddress(partnerId, {
    title: cleanString(input.title, 120, true, "Название точки"),
    city: cleanString(input.city || "Армавир", 80, true, "Город"),
    address: cleanString(input.address, 160, true, "Адрес"),
    is_active: input.isActive ?? input.is_active ?? true
  });
}

export function createPartnerUserInput(partnerId, input) {
  const { hash, salt, iterations } = createPasswordHash(passwordValue(input.password));
  return createPartnerUser({
    partner_id: partnerId,
    name: cleanString(input.name, 120, true, "Имя"),
    login: cleanString(input.login, 80, true, "Логин"),
    password_hash: hash,
    password_salt: salt,
    password_iterations: iterations,
    must_change_password: true,
    role: enumValue(input.role || "owner", allowed.userRoles, "Роль"),
    status: enumValue(input.status || "active", allowed.userStatuses, "Статус")
  });
}

export function patchPartnerUserInput(partnerId, userId, input) {
  const patch = {};
  if (input.name !== undefined) patch.name = cleanString(input.name, 120, true, "Имя");
  if (input.login !== undefined) patch.login = cleanString(input.login, 80, true, "Логин");
  if (input.password !== undefined) {
    const { hash, salt, iterations } = createPasswordHash(passwordValue(input.password));
    patch.password_hash = hash;
    patch.password_salt = salt;
    patch.password_iterations = iterations;
    patch.must_change_password = true;
  }
  if (input.role !== undefined) patch.role = enumValue(input.role, allowed.userRoles, "Роль");
  if (input.status !== undefined) patch.status = enumValue(input.status, allowed.userStatuses, "Статус");

  const user = listAdminData("partnerUsers").find((item) => item.id === userId && item.partner_id === partnerId);
  if (!user) return null;
  const updated = patchCollectionItem("partnerUsers", userId, patch);
  if (!updated) return null;
  const { password_hash, password_salt, password_iterations, ...safe } = updated;
  return safe;
}

export function deletePartnerUser(partnerId, userId) {
  const user = listAdminData("partnerUsers").find((item) => item.id === userId && item.partner_id === partnerId);
  if (!user) return false;
  return Boolean(patchCollectionItem("partnerUsers", userId, { status: "disabled" }));
}

export function deletePartnerInput(partnerId, input = {}) {
  return deletePartnerPermanently(partnerId, cleanString(input.confirmation, 120));
}

export function archivePartnerInput(partnerId) {
  return archivePartner(partnerId);
}

export function deleteRecord(collection, id) {
  return deleteAdminRecord(collection, id);
}

export function createOfferInput(input, actorRole = "admin", actorId = null) {
  const partnerId = cleanString(input.partnerId || input.partner_id, 120, true, "Партнёр");
  const imageUrls = localImageUrls(input.imageUrls || input.image_urls, actorRole, partnerId);
  const data = {
    partner_id: partnerId,
    address_id: cleanString(input.addressId || input.address_id, 120, true, "Адрес"),
    title: cleanString(input.title, 120, true, "Название"),
    category: enumValue(input.category, allowed.categories, "Категория"),
    price: numberRange(input.price, 1, 100000, "Цена"),
    old_price: input.oldPrice || input.old_price ? numberRange(input.oldPrice || input.old_price, 1, 100000, "Старая цена") : undefined,
    description: cleanString(input.description, 240),
    contents: cleanString(input.contents, 500),
    weight: cleanString(input.weight, 80),
    allergens: cleanString(input.allergens, 240),
    pickup_window: pickupWindow(input.pickupWindow || input.pickup_window),
    total_quantity: integerRange(input.totalQuantity || input.total_quantity, 1, 10000, "Количество"),
    remaining_quantity: integerRange(input.remainingQuantity ?? input.remaining_quantity ?? input.totalQuantity ?? input.total_quantity, 0, 10000, "Остаток"),
    status: enumValue(input.status || "active", allowed.offerStatuses, "Статус"),
    date: offerDate(input.date || todayDate()),
    cta_label: enumValue(input.ctaLabel || input.cta_label || "Получить код", allowed.ctaLabels, "CTA"),
    image_alt: cleanString(input.imageAlt || input.image_alt || input.title, 120),
    image_urls: imageUrls,
    image_url: imageUrls?.[0],
    photo_captured_at: isoDateTime(input.photoCapturedAt || input.photo_captured_at, "Время фото"),
    source_type: enumValue(input.sourceType || input.source_type || "manual", allowed.offerSourceTypes, "Источник предложения"),
    template_id: cleanString(input.templateId || input.template_id, 120)
  };
  if (data.remaining_quantity > data.total_quantity) {
    const error = new Error("Остаток не может быть больше общего количества");
    error.status = 400;
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  if (data.old_price && data.old_price <= data.price) {
    const error = new Error("Обычная стоимость должна быть выше цены предложения");
    error.status = 400;
    error.code = "INVALID_OLD_PRICE";
    throw error;
  }
  return createOffer(data, actorRole, actorId);
}

export function patchPartnerInput(id, input) {
  const patch = {};
  if (has(input, "name")) patch.name = cleanString(input.name, 120, true, "Название партнёра");
  if (has(input, "type")) patch.type = enumValue(input.type, allowed.partnerTypes, "Тип партнёра");
  if (has(input, "contactName") || has(input, "contact_name")) patch.contact_name = cleanString(input.contactName ?? input.contact_name, 80);
  if (has(input, "phone")) patch.phone = input.phone ? validatePhone(input.phone) : "";
  if (has(input, "email")) patch.email = validateEmail(input.email);
  if (has(input, "status")) patch.status = enumValue(input.status, allowed.partnerStatuses, "Статус");
  if (patch.status === "archived") return archivePartner(id);
  return patchCollectionItem("partners", id, patch);
}

export function patchAddressInput(partnerId, addressId, input, actorRole = "admin") {
  const address = listAdminData("partnerAddresses").find((item) => item.id === addressId && item.partner_id === partnerId);
  if (!address) return null;
  const patch = {};
  if (has(input, "title")) patch.title = cleanString(input.title, 120, true, "Название точки");
  if (has(input, "city")) patch.city = cleanString(input.city, 80, true, "Город");
  if (has(input, "address")) patch.address = cleanString(input.address, 160, true, "Адрес");
  if (has(input, "isActive") || has(input, "is_active")) patch.is_active = Boolean(input.isActive ?? input.is_active);
  return patchCollectionItem("partnerAddresses", addressId, patch, actorRole);
}

export function patchOfferInput(id, input, actorRole = "admin") {
  const current = listAdminData("offers").find((item) => item.id === id);
  if (!current) return null;
  const patch = {};
  if (has(input, "title")) patch.title = cleanString(input.title, 120, true, "Название");
  if (has(input, "category")) patch.category = enumValue(input.category, allowed.categories, "Категория");
  if (has(input, "price")) patch.price = numberRange(input.price, 1, 100000, "Цена");
  if (has(input, "oldPrice") || has(input, "old_price")) {
    const value = input.oldPrice ?? input.old_price;
    patch.old_price = value ? numberRange(value, 1, 100000, "Старая цена") : undefined;
  }
  if (has(input, "description")) patch.description = cleanString(input.description, 240);
  if (has(input, "contents")) patch.contents = cleanString(input.contents, 500);
  if (has(input, "weight")) patch.weight = cleanString(input.weight, 80);
  if (has(input, "allergens")) patch.allergens = cleanString(input.allergens, 240);
  if (has(input, "pickupWindow") || has(input, "pickup_window")) patch.pickup_window = pickupWindow(input.pickupWindow ?? input.pickup_window);
  if (has(input, "totalQuantity") || has(input, "total_quantity")) patch.total_quantity = integerRange(input.totalQuantity ?? input.total_quantity, 0, 10000, "Количество");
  if (has(input, "remainingQuantity") || has(input, "remaining_quantity")) patch.remaining_quantity = integerRange(input.remainingQuantity ?? input.remaining_quantity, 0, 10000, "Остаток");
  if (has(input, "status")) patch.status = enumValue(input.status, allowed.offerStatuses, "Статус");
  if (has(input, "date")) patch.date = offerDate(input.date);
  if (has(input, "ctaLabel") || has(input, "cta_label")) patch.cta_label = enumValue(input.ctaLabel ?? input.cta_label, allowed.ctaLabels, "CTA");
  if (has(input, "imageUrls") || has(input, "image_urls")) {
    patch.image_urls = localImageUrls(input.imageUrls ?? input.image_urls, actorRole, current.partner_id);
    patch.image_url = patch.image_urls[0];
  }
  if (has(input, "photoCapturedAt") || has(input, "photo_captured_at")) patch.photo_captured_at = isoDateTime(input.photoCapturedAt ?? input.photo_captured_at, "Время фото");
  if (has(input, "sourceType") || has(input, "source_type")) patch.source_type = enumValue(input.sourceType ?? input.source_type, allowed.offerSourceTypes, "Источник предложения");
  const total = patch.total_quantity ?? current.total_quantity;
  const remaining = patch.remaining_quantity ?? current.remaining_quantity;
  const price = patch.price ?? current.price;
  const oldPrice = Object.prototype.hasOwnProperty.call(patch, "old_price") ? patch.old_price : current.old_price;
  if (remaining > total) {
    const error = new Error("Остаток не может быть больше общего количества");
    error.status = 400;
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  if (oldPrice && oldPrice <= price) {
    const error = new Error("Обычная стоимость должна быть выше цены предложения");
    error.status = 400;
    error.code = "INVALID_OLD_PRICE";
    throw error;
  }
  return patchCollectionItem("offers", id, patch, actorRole);
}

export function patchItem(collection, id, patch) {
  return patchCollectionItem(collection, id, patch);
}

export function deleteItem(collection, id) {
  if (collection === "partners") return Boolean(patchCollectionItem(collection, id, { status: "disabled" }));
  if (collection === "partnerAddresses") return Boolean(patchCollectionItem(collection, id, { is_active: false }));
  if (collection === "offers") return Boolean(patchCollectionItem(collection, id, { status: "paused" }));
  return deleteCollectionItem(collection, id);
}

export function setStatus(collection, id, status, allowedStatuses) {
  return patchCollectionItem(collection, id, { status: enumValue(status, allowedStatuses, "Статус") });
}

export function setBookingStatusInput(id, status, actorRole = "admin", actorId = null) {
  return setBookingStatus(id, enumValue(status, allowed.bookingStatuses, "Статус"), actorRole, actorId);
}

export function approveApplication(applicationId, userData = null) {
  return createPartnerFromApplication(applicationId, userData);
}
