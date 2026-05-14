import { allowed, cleanString, enumValue, validateEmail, validatePhone } from "../utils/validation.mjs";
import { createAddress, deleteCollectionItem, partnerDashboard, partnerScopedData, patchCollectionItem } from "../repositories/databaseRepository.mjs";
import { createOfferInput } from "./adminService.mjs";

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
  return patchCollectionItem("partners", partnerId, {
    name: input.name ? cleanString(input.name, 120, true, "Название") : undefined,
    type: input.type ? enumValue(input.type, allowed.partnerTypes, "Тип") : undefined,
    contact_name: input.contactName !== undefined ? cleanString(input.contactName, 80) : undefined,
    phone: input.phone ? validatePhone(input.phone) : undefined,
    email: input.email !== undefined ? validateEmail(input.email) : undefined
  }, "partner");
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
    date: offer.date,
    ctaLabel: offer.cta_label,
    imageAlt: offer.image_alt
  }, "partner", partnerId);
}

export function patchOwn(collection, partnerId, id, patch) {
  const data = partnerScopedData(partnerId);
  const list = collection === "partnerAddresses" ? data.addresses : collection === "offers" ? data.offers : data.bookings;
  if (!list.some((item) => item.id === id)) return null;
  return patchCollectionItem(collection, id, patch, "partner");
}

export function deleteOwn(collection, partnerId, id) {
  const data = partnerScopedData(partnerId);
  const list = collection === "partnerAddresses" ? data.addresses : data.offers;
  if (!list.some((item) => item.id === id)) return false;
  return deleteCollectionItem(collection, id, "partner");
}
