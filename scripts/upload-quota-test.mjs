import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { savePartnerImages } from "../backend/storage/imageStore.mjs";
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "beri-upload-quota-"));
const previous = Object.fromEntries(["UPLOAD_DIR", "UPLOAD_PARTNER_MAX_BYTES", "UPLOAD_TOTAL_MAX_BYTES"].map((key) => [key, process.env[key]]));
try {
  Object.assign(process.env, { UPLOAD_DIR: temporary, UPLOAD_PARTNER_MAX_BYTES: "7", UPLOAD_TOTAL_MAX_BYTES: "10" });
  const image = { dataUrl: "data:image/jpeg;base64,/9j/AA==" }; // Four-byte neutral format fixture, not production food imagery.
  assert.throws(() => savePartnerImages("partner-1", [image, image]), (error) => error.code === "PARTNER_UPLOAD_QUOTA");
  assert.equal(fs.readdirSync(temporary).length, 0, "Quota rejection wrote partial files");
  assert.equal(savePartnerImages("partner-1", [image]).length, 1);
  assert.throws(() => savePartnerImages("partner-1", [image]), (error) => error.code === "PARTNER_UPLOAD_QUOTA");
  assert.equal(fs.readdirSync(path.join(temporary, "partner-1")).length, 1);
  savePartnerImages("partner-2", [image]);
  assert.throws(() => savePartnerImages("partner-3", [image]), (error) => error.code === "TOTAL_UPLOAD_QUOTA");
  assert.throws(() => savePartnerImages("partner-3", [image, { dataUrl: "bad" }]), (error) => error.code === "INVALID_IMAGE");
  assert.equal(fs.existsSync(path.join(temporary, "partner-3")), false);
  process.env.UPLOAD_PARTNER_MAX_BYTES = "invalid";
  assert.throws(() => savePartnerImages("partner-1", [image]), (error) => error.code === "UPLOAD_QUOTA_CONFIGURATION");
  console.log("Upload quota test passed: per-partner/global bounds, invalid config, and no partial writes");
} finally {
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(temporary, { recursive: true, force: true });
}
