// Isolated UI rehearsal. No production database, mail delivery or real credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPasswordHash } from "../backend/utils/password.mjs";
import { createSeedDb } from "../backend/db/seedData.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "beri-pwa-preview-"));
const admin = createPasswordHash("local-pwa-preview-only");
const port = Number(process.env.PWA_PREVIEW_PORT || 3097);
const previewEnv = {
    ...process.env, APP_ENV: "test", APP_BASE_URL: `http://127.0.0.1:${port}`, HOST: "127.0.0.1", PORT: String(port),
    DB_FILE: path.join(scratch, "db.json"), UPLOAD_DIR: path.join(scratch, "uploads"), DB_DRIVER: "json", TRUST_PROXY: "false",
    SITE_ACCESS_ENABLED: "false", ADMIN_ACCESS_ENABLED: "false", PARTNER_ACCESS_ENABLED: "false", CUSTOMER_AUTH_ENABLED: "false",
    ADMIN_APP_LOGIN: "local-pwa-preview", ADMIN_APP_PASSWORD_HASH: admin.hash, ADMIN_APP_PASSWORD_SALT: admin.salt, ADMIN_APP_PASSWORD_ITERATIONS: String(admin.iterations),
    SESSION_SECRET: crypto.randomBytes(48).toString("hex"), SEED_PARTNER_1_PASSWORD: "local-pwa-preview-only", SEED_PARTNER_2_PASSWORD: crypto.randomBytes(24).toString("hex"), SEED_PARTNER_3_PASSWORD: crypto.randomBytes(24).toString("hex"),
    LEGAL_OPERATOR_READY: "true", LEGAL_OPERATOR_NAME: "Учебный оператор", LEGAL_OPERATOR_ID: "TEST-PWA", LEGAL_OPERATOR_ADDRESS: "Учебный адрес", LEGAL_PRIVACY_EMAIL: "operator@example.test", LEGAL_DOCUMENT_VERSION: "test-pwa-v1", NEXT_PUBLIC_DEMO_MODE: "true"
};
// Preconfigured fictional users let UI tests inspect navigation without changing a user's password.
Object.assign(process.env, { APP_ENV: "test", SEED_PARTNER_1_PASSWORD: previewEnv.SEED_PARTNER_1_PASSWORD, SEED_PARTNER_2_PASSWORD: previewEnv.SEED_PARTNER_2_PASSWORD, SEED_PARTNER_3_PASSWORD: previewEnv.SEED_PARTNER_3_PASSWORD });
const fixture = createSeedDb();
fixture.adminUsers.push({ id: "admin:local-pwa-preview", login: previewEnv.ADMIN_APP_LOGIN, status: "active", password_hash: admin.hash, password_salt: admin.salt, password_iterations: admin.iterations, must_change_password: false });
fixture.partnerUsers.forEach(user => { user.must_change_password = false; });
fixture.partnerUsers.push({ ...fixture.partnerUsers[0], id: "preview-seller", login: "preview-seller", name: "Учебный продавец", role: "seller" });
fs.writeFileSync(previewEnv.DB_FILE, JSON.stringify(fixture), { mode: 0o600 });
const child = spawn(process.execPath, ["server.mjs"], { cwd: root, stdio: "inherit", env: previewEnv });
console.log(`PWA preview: http://127.0.0.1:${port}/app; temporary fixture: ${scratch}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill("SIGTERM"));
child.once("exit", code => { fs.rmSync(scratch, { recursive: true, force: true }); process.exitCode = code || 0; });
