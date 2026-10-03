export function snapshotBookingTerms(offer, partner, address, capturedAt) {
  return {
    version: 1, capturedAt,
    offerTitle: offer.title, price: offer.price, contents: offer.contents || "",
    weight: offer.weight || "", allergens: offer.allergens || "", description: offer.description || "",
    pickupWindow: offer.pickup_window, date: offer.date,
    partnerName: partner.name, address: address.address, addressTitle: address.title
  };
}

export function bookingTerms(booking, db) {
  if (booking.terms_snapshot?.version === 1) return { ...booking.terms_snapshot, termsVerified: true };
  const offer = db.offers.find((item) => item.id === booking.offer_id);
  const partner = db.partners.find((item) => item.id === booking.partner_id);
  const address = db.partnerAddresses.find((item) => item.id === booking.address_id);
  // A current price cannot reconstruct an old contract. Do not fabricate a historical amount.
  return {
    offerTitle: offer?.title || "Предложение", partnerName: partner?.name || "Заведение",
    pickupWindow: offer?.pickup_window || "", date: offer?.date || "", address: address?.address || "",
    contents: "", weight: "", allergens: "", price: null, termsVerified: false
  };
}
