export class ValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

export function cleanString(value, max = 120, required = false, label = "Поле") {
  const text = String(value ?? "").trim().slice(0, max);
  if (required && !text) throw new ValidationError(`${label} обязательно`);
  return text;
}

export function validatePhone(value) {
  const phone = cleanString(value, 30, true, "Телефон");
  if (!/^[+0-9 ()-]+$/.test(phone)) throw new ValidationError("Введите телефон цифрами в формате +7 (XXX) XXX-XX-XX");
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) digits = digits.slice(1);
  if (digits.length !== 10) throw new ValidationError("Введите телефон полностью в формате +7 (XXX) XXX-XX-XX");
  return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
}

export function validateEmail(value) {
  const email = cleanString(value, 120, false);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Укажите корректный email");
  return email;
}

export function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new ValidationError(`${label}: недопустимое значение`);
  return value;
}

export function numberRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new ValidationError(`${label}: значение должно быть от ${min} до ${max}`);
  }
  return number;
}

export function integerRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${label}: значение должно быть целым числом от ${min} до ${max}`);
  }
  return number;
}

export const allowed = {
  partnerTypes: ["bakery", "cafe", "culinary", "buffet", "coffee", "ready_food_cafe", "other"],
  partnerStatuses: ["active", "paused", "disabled", "archived"],
  categories: ["bakery", "lunch", "evening"],
  offerStatuses: ["active", "paused", "sold_out", "expired"],
  offerSourceTypes: ["manual", "quick_photo", "template"],
  bookingStatuses: ["created", "issued", "no_show", "cancelled"],
  applicationStatuses: ["new", "contacted", "approved", "rejected", "archived"],
  contactStatuses: ["new", "in_progress", "closed", "archived"],
  requestTypes: ["venue_connection", "service_question", "partner_pilot", "order_question", "other"],
  locationsCount: ["1", "2-3", "4+", "unknown"],
  userRoles: ["owner", "manager"],
  userStatuses: ["active", "disabled"],
  ctaLabels: ["Получить код", "Забронировать"]
};
