import crypto from "node:crypto";

export function generateId(prefix = "id") {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function generateCode(existingCodes = new Set()) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = `BS-${Math.floor(1000 + Math.random() * 9000)}`;
    if (!existingCodes.has(code)) return code;
  }
  return `BS-${Date.now().toString().slice(-4)}`;
}
