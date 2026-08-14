import { nowIso } from "./dates.mjs";

const ACCEPTED_CONSENT_VALUES = new Set([true, 1, "1", "true", "on", "yes"]);

export function legalConfig() {
  const config = {
    operatorName: String(process.env.LEGAL_OPERATOR_NAME || "").trim(),
    operatorId: String(process.env.LEGAL_OPERATOR_ID || "").trim(),
    operatorAddress: String(process.env.LEGAL_OPERATOR_ADDRESS || "").trim(),
    privacyEmail: String(process.env.LEGAL_PRIVACY_EMAIL || "").trim(),
    documentVersion: String(process.env.LEGAL_DOCUMENT_VERSION || "").trim()
  };
  return {
    ...config,
    ready: process.env.LEGAL_OPERATOR_READY === "true" && Object.values(config).every(Boolean)
  };
}

export function requireLegalReady() {
  const config = legalConfig();
  if (!config.ready) {
    const error = new Error("Приём данных временно закрыт. Документы сервиса ещё готовятся.");
    error.status = 503;
    error.code = "LEGAL_NOT_READY";
    error.expose = true;
    throw error;
  }
  return config;
}

function accepted(value) {
  return ACCEPTED_CONSENT_VALUES.has(value);
}

export function consentReceipt(input, { form, source, partnerTerms = false } = {}) {
  const config = requireLegalReady();
  if (!accepted(input?.personalDataConsent)) {
    const error = new Error("Подтвердите согласие на обработку персональных данных");
    error.status = 400;
    error.code = "PERSONAL_DATA_CONSENT_REQUIRED";
    throw error;
  }
  if (partnerTerms && !accepted(input?.partnerTermsConsent)) {
    const error = new Error("Подтвердите условия подключения партнёров");
    error.status = 400;
    error.code = "PARTNER_TERMS_CONSENT_REQUIRED";
    throw error;
  }

  const acceptedAt = nowIso();
  return {
    consent_version: config.documentVersion,
    consent_given_at: acceptedAt,
    consent_form: String(form || "web-form").slice(0, 80),
    consent_source: String(source || "web").slice(0, 80),
    legal_basis: "consent",
    ...(partnerTerms
      ? {
          partner_terms_version: config.documentVersion,
          partner_terms_accepted_at: acceptedAt
        }
      : {})
  };
}
