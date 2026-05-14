import { createPasswordHash } from "../utils/password.mjs";
import { allowed, cleanString, enumValue, integerRange, numberRange, validateEmail, validatePhone } from "../utils/validation.mjs";
import {
  adminDashboard,
  createAddress,
  createOffer,
  createPartner,
  createPartnerFromApplication,
  createPartnerUser,
  deleteCollectionItem,
  listAdminData,
  patchCollectionItem
} from "../repositories/databaseRepository.mjs";

export function dashboard() {
  return adminDashboard();
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

export function createAddressInput(partnerId, input) {
  return createAddress(partnerId, {
    title: cleanString(input.title, 120, true, "Название точки"),
    city: cleanString(input.city || "Армавир", 80, true, "Город"),
    address: cleanString(input.address, 160, true, "Адрес"),
    is_active: input.isActive ?? input.is_active ?? true
  });
}

export function createPartnerUserInput(partnerId, input) {
  const { hash, salt } = createPasswordHash(cleanString(input.password, 120, true, "Пароль"));
  return createPartnerUser({
    partner_id: partnerId,
    name: cleanString(input.name, 120, true, "Имя"),
    login: cleanString(input.login, 80, true, "Логин"),
    password_hash: hash,
    password_salt: salt,
    role: enumValue(input.role || "owner", allowed.userRoles, "Роль"),
    status: enumValue(input.status || "active", allowed.userStatuses, "Статус")
  });
}

export function patchPartnerUserInput(partnerId, userId, input) {
  const patch = {};
  if (input.name !== undefined) patch.name = cleanString(input.name, 120, true, "Имя");
  if (input.login !== undefined) patch.login = cleanString(input.login, 80, true, "Логин");
  if (input.password !== undefined) {
    const { hash, salt } = createPasswordHash(cleanString(input.password, 120, true, "Пароль"));
    patch.password_hash = hash;
    patch.password_salt = salt;
  }
  if (input.role !== undefined) patch.role = enumValue(input.role, allowed.userRoles, "Роль");
  if (input.status !== undefined) patch.status = enumValue(input.status, allowed.userStatuses, "Статус");

  const user = listAdminData("partnerUsers").find((item) => item.id === userId && item.partner_id === partnerId);
  if (!user) return null;
  const updated = patchCollectionItem("partnerUsers", userId, patch);
  if (!updated) return null;
  const { password_hash, password_salt, ...safe } = updated;
  return safe;
}

export function deletePartnerUser(partnerId, userId) {
  const user = listAdminData("partnerUsers").find((item) => item.id === userId && item.partner_id === partnerId);
  if (!user) return false;
  return deleteCollectionItem("partnerUsers", userId);
}

export function createOfferInput(input, actorRole = "admin", actorId = null) {
  return createOffer({
    partner_id: cleanString(input.partnerId || input.partner_id, 120, true, "Партнёр"),
    address_id: cleanString(input.addressId || input.address_id, 120, true, "Адрес"),
    title: cleanString(input.title, 120, true, "Название"),
    category: enumValue(input.category, allowed.categories, "Категория"),
    price: numberRange(input.price, 1, 100000, "Цена"),
    old_price: input.oldPrice || input.old_price ? numberRange(input.oldPrice || input.old_price, 1, 100000, "Старая цена") : undefined,
    pickup_window: cleanString(input.pickupWindow || input.pickup_window, 40, true, "Время выдачи"),
    total_quantity: integerRange(input.totalQuantity || input.total_quantity, 0, 10000, "Количество"),
    remaining_quantity: integerRange(input.remainingQuantity ?? input.remaining_quantity ?? input.totalQuantity ?? input.total_quantity, 0, 10000, "Остаток"),
    status: enumValue(input.status || "active", allowed.offerStatuses, "Статус"),
    date: cleanString(input.date || new Date().toISOString().slice(0, 10), 20, true, "Дата"),
    cta_label: enumValue(input.ctaLabel || input.cta_label || "Получить код", allowed.ctaLabels, "CTA"),
    image_alt: cleanString(input.imageAlt || input.image_alt || input.title, 120)
  }, actorRole, actorId);
}

export function patchItem(collection, id, patch) {
  return patchCollectionItem(collection, id, patch);
}

export function deleteItem(collection, id) {
  return deleteCollectionItem(collection, id);
}

export function setStatus(collection, id, status, allowedStatuses) {
  return patchCollectionItem(collection, id, { status: enumValue(status, allowedStatuses, "Статус") });
}

export function approveApplication(applicationId, userData = null) {
  return createPartnerFromApplication(applicationId, userData);
}
