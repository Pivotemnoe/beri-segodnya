const DEFAULT_TIME_ZONE = "Europe/Moscow";

export function nowIso() {
  return new Date().toISOString();
}

export function todayDate(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function localMinutes(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export function pickupEndMinutes(pickupWindow = "") {
  const matches = String(pickupWindow).match(/(?:[01]?\d|2[0-3]):[0-5]\d/g);
  if (!matches?.length) return null;
  const [hours, minutes] = matches.at(-1).split(":").map(Number);
  return hours * 60 + minutes;
}

export function pickupEndIso(date, pickupWindow) {
  const matches = String(pickupWindow).match(/(?:[01]?\d|2[0-3]):[0-5]\d/g);
  const end = matches?.at(-1);
  if (!date || !end) return null;
  return new Date(`${date}T${end}:00+03:00`).toISOString();
}

export function isOfferAvailableNow(offer, date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (!offer || offer.date !== todayDate(date, timeZone)) return false;
  const end = pickupEndMinutes(offer.pickup_window);
  return end === null || localMinutes(date, timeZone) < end;
}
