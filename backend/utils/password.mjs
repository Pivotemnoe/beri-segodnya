import crypto from "node:crypto";

export const CURRENT_PASSWORD_ITERATIONS = 600000;
export const LEGACY_PASSWORD_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";
const MAX_ACTIVE_KDFS = 2;
const MAX_QUEUED_KDFS = 8;
let activeKdfs = 0;
const pendingKdfs = [];

function deriveAsync(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeKdfs += 1;
      const finish = (error, value) => {
        activeKdfs -= 1;
        pendingKdfs.shift()?.();
        if (error) reject(error);
        else resolve(value);
      };
      try { crypto.pbkdf2(String(password), salt, iterations, KEY_LENGTH, DIGEST, finish); }
      catch (error) { finish(error); }
    };
    if (activeKdfs < MAX_ACTIVE_KDFS) run();
    else if (pendingKdfs.length < MAX_QUEUED_KDFS) pendingKdfs.push(run);
    else reject(Object.assign(new Error("Сейчас много попыток входа. Попробуйте через минуту."), { status: 429, code: "RATE_LIMIT" }));
  });
}

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

// Keep synchronous helpers for seed/offline reset compatibility. HTTP auth uses
// the bounded asynchronous pool so password work cannot block the event loop.
export async function createPasswordHashAsync(password, iterations = CURRENT_PASSWORD_ITERATIONS) {
  const workFactor = normalizedIterations(iterations);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await deriveAsync(password, salt, workFactor)).toString("hex");
  return { hash, salt, iterations: workFactor };
}

export async function verifyPasswordAsync(password, hash, salt, iterations = LEGACY_PASSWORD_ITERATIONS) {
  if (!password || typeof hash !== "string" || !/^[0-9a-f]{64}$/i.test(hash) || !salt) return false;
  const candidate = await deriveAsync(password, salt, normalizedIterations(iterations, LEGACY_PASSWORD_ITERATIONS));
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}
