import crypto from "node:crypto";

export const CURRENT_PASSWORD_ITERATIONS = 600000;
export const LEGACY_PASSWORD_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

function normalizedIterations(value, fallback = CURRENT_PASSWORD_ITERATIONS) {
  const iterations = Number(value || fallback);
  return Number.isInteger(iterations) && iterations >= LEGACY_PASSWORD_ITERATIONS
    ? iterations
    : fallback;
}

export function createPasswordHash(password, iterations = CURRENT_PASSWORD_ITERATIONS) {
  const workFactor = normalizedIterations(iterations);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, workFactor, KEY_LENGTH, DIGEST).toString("hex");
  return { hash, salt, iterations: workFactor };
}

export function verifyPassword(password, hash, salt, iterations = LEGACY_PASSWORD_ITERATIONS) {
  if (!password || !hash || !salt) return false;
  const workFactor = normalizedIterations(iterations, LEGACY_PASSWORD_ITERATIONS);
  const candidate = crypto.pbkdf2Sync(String(password), salt, workFactor, KEY_LENGTH, DIGEST).toString("hex");
  if (candidate.length !== hash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(iterations) {
  return normalizedIterations(iterations, LEGACY_PASSWORD_ITERATIONS) < CURRENT_PASSWORD_ITERATIONS;
}
