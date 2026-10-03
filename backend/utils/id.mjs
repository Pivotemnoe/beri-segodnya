import crypto from "node:crypto";

export function generateId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function generateCode(existingCodes = new Set()) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = `BS-${crypto.randomInt(1000, 10000)}`;
    if (!existingCodes.has(code)) return code;
  }
  // Deterministic exhaustive fallback still checks every candidate. Never return a collision.
  for (const [min, count] of [[1000, 9000], [100000, 900000], [10000000, 90000000]]) {
    const start = crypto.randomInt(count);
    for (let offset = 0; offset < count; offset += 1) {
      const code = `BS-${min + (start + offset) % count}`;
      if (!existingCodes.has(code)) return code;
    }
  }
  throw Object.assign(new Error("Не удалось выдать уникальный код. Обратитесь в поддержку."), { status: 503, code: "CODE_SPACE_EXHAUSTED" });
}
