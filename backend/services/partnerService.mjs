import { allowed, cleanString, enumValue, integerRange, numberRange, ValidationError, validateEmail, validatePhone } from "../utils/validation.mjs";
import { createAddress, createOfferTemplate, deleteCollectionItem, partnerDashboard, partnerScopedData, patchCollectionItem } from "../repositories/databaseRepository.mjs";
import { createOfferInput, patchAddressInput, patchOfferInput, setBookingStatusInput } from "./adminService.mjs";
import { partnerUploadFolder } from "../storage/imageStore.mjs";

export function dashboard(partnerId) {
  return partnerDashboard(partnerId);
}

export function profile(partnerId) {
  const data = partnerScopedData(partnerId);
  return data.partner;
}

export function scoped(partnerId, collection) {
  const data = partnerScopedData(partnerId);
  return data[collection];
}

export function patchProfile(partnerId, input) {
  const patch = {};
  if (input.name !== undefined) patch.name = cleanString(input.name, 120, true, "Название");
  if (input.type !== undefined) patch.type = enumValue(input.type, allowed.partnerTypes, "Тип");
  if (input.contactName !== undefined) patch.contact_name = cleanString(input.contactName, 80);
  if (input.phone !== undefined) patch.phone = input.phone ? validatePhone(input.phone) : "";
  if (input.email !== undefined) patch.email = validateEmail(input.email);
  return patchCollectionItem("partners", partnerId, patch, "partner");
}

export function createOwnAddress(partnerId, input) {
  return createAddress(partnerId, {
    title: cleanString(input.title, 120, true, "Название точки"),
    city: cleanString(input.city || "Армавир", 80, true, "Город"),
    address: cleanString(input.address, 160, true, "Адрес"),
    is_active: input.isActive ?? true
  }, "partner");
}

export function createOwnOffer(partnerId, input) {
  return createOfferInput({ ...input, partnerId }, "partner", partnerId);
}

export function duplicateOwnOffer(partnerId, offerId) {
  const data = partnerScopedData(partnerId);
  const offer = data.offers.find((item) => item.id === offerId);
  if (!offer) return null;
  return createOfferInput({
    partnerId,
    addressId: offer.address_id,
    title: `${offer.title} копия`,
    category: offer.category,
    price: offer.price,
    oldPrice: offer.old_price,
    pickupWindow: offer.pickup_window,
    totalQuantity: offer.total_quantity,
    remainingQuantity: offer.total_quantity,
    status: "paused",
    ctaLabel: offer.cta_label,
    imageAlt: offer.image_alt,
    imageUrls: offer.image_urls,
    photoCapturedAt: offer.photo_captured_at,
    sourceType: "template"
  }, "partner", partnerId);
}

function templateImageUrls(value, partnerId) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) {
    const error = new Error("Можно сохранить не больше трёх фото");
    error.status = 400;
    error.code = "INVALID_IMAGES";
    throw error;
  }
  const ownPrefix = `/uploads/${partnerUploadFolder(partnerId)}/`;
  return value.map((item) => cleanString(item, 240, true, "Фото")).filter((item) => {
    if (!/^\/images\/[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp)$/.test(item) && !item.startsWith(ownPrefix)) {
      const error = new Error("Нельзя использовать фото другого партнёра");
      error.status = 403;
      error.code = "IMAGE_ACCESS_DENIED";
      throw error;
    }
    return true;
  });
}

function optionalTemplateNumber(value, min, max, label) {
  if (value === undefined || value === null || value === "") return null;
  return numberRange(value, min, max, label);
}

function optionalTemplateInteger(value, min, max, label) {
  if (value === undefined || value === null || value === "") return null;
  return integerRange(value, min, max, label);
}

function templatePickupWindow(value) {
  const window = cleanString(value, 40);
  if (!window) return "";
  const times = window.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g) || [];
  if (times.length !== 2) throw new ValidationError("Укажите интервал выдачи, например 15:30–18:00", "INVALID_PICKUP_WINDOW");
  const minutes = times.map((time) => {
    const [hours, mins] = time.split(":").map(Number);
    return hours * 60 + mins;
  });
  if (minutes[1] <= minutes[0]) throw new ValidationError("Окончание выдачи должно быть позже начала", "INVALID_PICKUP_WINDOW");
  return window;
}

function ensureTemplatePrices(price, oldPrice) {
  if (price && oldPrice && oldPrice <= price) {
    throw new ValidationError("Обычная стоимость должна быть выше цены предложения", "INVALID_OLD_PRICE");
  }
}

export function createOwnTemplate(partnerId, input) {
  const data = partnerScopedData(partnerId);
  const addressId = cleanString(input.addressId || input.address_id, 120);
  if (addressId && !data.addresses.some((item) => item.id === addressId)) return null;
  const price = optionalTemplateNumber(input.price, 1, 100000, "Цена");
  const oldPrice = optionalTemplateNumber(input.oldPrice ?? input.old_price, 1, 100000, "Старая цена");
  ensureTemplatePrices(price, oldPrice);
  return createOfferTemplate({
    partner_id: partnerId,
    address_id: addressId || null,
    title: cleanString(input.title, 120, true, "Название шаблона"),
    category: enumValue(input.category || "lunch", allowed.categories, "Категория"),
    description: cleanString(input.description, 240),
    contents: cleanString(input.contents, 500),
    price,
    old_price: oldPrice,
    pickup_window: templatePickupWindow(input.pickupWindow || input.pickup_window),
    total_quantity: optionalTemplateInteger(input.totalQuantity ?? input.total_quantity, 1, 10000, "Количество"),
    image_urls: templateImageUrls(input.imageUrls || input.image_urls, partnerId)
  }, "partner", partnerId);
}

export function patchOwnTemplate(partnerId, id, input) {
  const template = partnerScopedData(partnerId).templates.find((item) => item.id === id);
  if (!template) return null;
  const patch = {};
  if (input.title !== undefined) patch.title = cleanString(input.title, 120, true, "Название шаблона");
  if (input.category !== undefined) patch.category = enumValue(input.category, allowed.categories, "Категория");
  if (input.description !== undefined) patch.description = cleanString(input.description, 240);
  if (input.contents !== undefined) patch.contents = cleanString(input.contents, 500);
  if (input.addressId !== undefined || input.address_id !== undefined) {
    const addressId = cleanString(input.addressId ?? input.address_id, 120);
    if (addressId && !partnerScopedData(partnerId).addresses.some((item) => item.id === addressId)) return null;
    patch.address_id = addressId || null;
  }
  if (input.price !== undefined) patch.price = optionalTemplateNumber(input.price, 1, 100000, "Цена");
  if (input.oldPrice !== undefined || input.old_price !== undefined) {
    patch.old_price = optionalTemplateNumber(input.oldPrice ?? input.old_price, 1, 100000, "Старая цена");
  }
  if (input.pickupWindow !== undefined || input.pickup_window !== undefined) {
    patch.pickup_window = templatePickupWindow(input.pickupWindow ?? input.pickup_window);
  }
  if (input.totalQuantity !== undefined || input.total_quantity !== undefined) {
    patch.total_quantity = optionalTemplateInteger(input.totalQuantity ?? input.total_quantity, 1, 10000, "Количество");
  }
  if (input.imageUrls !== undefined || input.image_urls !== undefined) patch.image_urls = templateImageUrls(input.imageUrls || input.image_urls, partnerId);
  ensureTemplatePrices(patch.price ?? template.price, patch.old_price ?? template.old_price);
  return patchCollectionItem("offerTemplates", id, patch, "partner");
}

export function deleteOwnTemplate(partnerId, id) {
  const template = partnerScopedData(partnerId).templates.find((item) => item.id === id);
  return template ? Boolean(patchCollectionItem("offerTemplates", id, { is_active: false }, "partner")) : false;
}

export function patchOwn(collection, partnerId, id, patch) {
  const data = partnerScopedData(partnerId);
  const list = collection === "partnerAddresses" ? data.addresses : collection === "offers" ? data.offers : data.bookings;
  if (!list.some((item) => item.id === id)) return null;
  if (collection === "partnerAddresses") return patchAddressInput(partnerId, id, patch, "partner");
  if (collection === "offers") return patchOfferInput(id, patch, "partner");
  if (collection === "bookings") return setBookingStatusInput(id, patch.status, "partner", partnerId);
  return null;
}

export function deleteOwn(collection, partnerId, id) {
  const data = partnerScopedData(partnerId);
  const list = collection === "partnerAddresses" ? data.addresses : data.offers;
  if (!list.some((item) => item.id === id)) return false;
  if (collection === "partnerAddresses") return Boolean(patchCollectionItem(collection, id, { is_active: false }, "partner"));
  if (collection === "offers") return Boolean(patchCollectionItem(collection, id, { status: "paused" }, "partner"));
  return deleteCollectionItem(collection, id, "partner");
}
