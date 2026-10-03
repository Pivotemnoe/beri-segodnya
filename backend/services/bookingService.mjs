import { createBookingAtomic } from "../repositories/databaseRepository.mjs";
import { generateCode } from "../utils/id.mjs";
import { consentReceipt } from "../utils/legal.mjs";
import { cleanString, validatePhone } from "../utils/validation.mjs";
import crypto from "node:crypto";

export function createBooking(input) {
  const offerId = cleanString(input.offerId, 120, true, "Предложение");
  const customerName = cleanString(input.customerName, 80, true, "Имя");
  const customerPhone = validatePhone(input.customerPhone);
  const receipt = consentReceipt(input, { form: "booking", source: "web:booking" });
  const requestId = String(input.requestId ?? "").trim();
  if (requestId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) throw Object.assign(new Error("Некорректный идентификатор запроса"), { status: 400, code: "INVALID_REQUEST_ID" });
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const retry = requestId ? { keyHash: digest(requestId.toLowerCase()), fingerprint: digest(JSON.stringify([offerId, customerName, customerPhone, receipt.consent_version])) } : {};
  const { booking, offer } = createBookingAtomic(offerId, customerName, customerPhone, generateCode(), receipt, retry);
  return {
    bookingId: booking.id,
    code: booking.code,
    offerId: booking.offer_id,
    partnerId: booking.partner_id,
    pickupWindow: booking.terms_snapshot?.pickupWindow || offer?.pickup_window || "",
    publicToken: booking.public_token,
    bookingUrl: `/booking/${booking.public_token}`,
    expiresAt: booking.expires_at,
    message: "Покажите код в магазине и оплатите заказ при получении."
  };
}
