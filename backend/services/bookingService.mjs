import { createBookingAtomic } from "../repositories/databaseRepository.mjs";
import { generateCode } from "../utils/id.mjs";
import { consentReceipt } from "../utils/legal.mjs";
import { cleanString, validatePhone } from "../utils/validation.mjs";

export function createBooking(input) {
  const offerId = cleanString(input.offerId, 120, true, "Предложение");
  const customerName = cleanString(input.customerName, 80, true, "Имя");
  const customerPhone = validatePhone(input.customerPhone);
  const receipt = consentReceipt(input, { form: "booking", source: "web:booking" });
  const { booking, offer } = createBookingAtomic(offerId, customerName, customerPhone, generateCode(), receipt);
  return {
    bookingId: booking.id,
    code: booking.code,
    offerId: booking.offer_id,
    partnerId: booking.partner_id,
    pickupWindow: offer.pickup_window,
    publicToken: booking.public_token,
    bookingUrl: `/booking/${booking.public_token}`,
    expiresAt: booking.expires_at,
    message: "Покажите код в заведении и оплатите заказ на кассе."
  };
}
