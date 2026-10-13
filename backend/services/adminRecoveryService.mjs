import crypto from "node:crypto";
import { readDb, updateDb } from "../storage/jsonStore.mjs";
import { addAudit, createSession } from "../repositories/databaseRepository.mjs";
import { adminEmail } from "../utils/adminEmail.mjs";
import { createPasswordHashAsync } from "../utils/password.mjs";
import { sendAdminPasswordReset, mailConfiguration } from "./mailService.mjs";
import { nowIso } from "../utils/dates.mjs";

const TTL = 20 * 60 * 1000;
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const invalid = () => error(400, "INVALID_RESET_LINK", "Ссылка уже использована или истекла. Запросите новое письмо.");
function digest(value) {
  const secret = String(process.env.SESSION_SECRET || "");
  if (secret.length < 32) throw error(503, "ADMIN_RECOVERY_NOT_CONFIGURED", "Восстановление по почте пока недоступно. Обратитесь к владельцу сервиса.");
  return crypto.createHmac("sha256", secret).update("admin-recovery:" + value).digest("hex");
}
function fingerprint(user) {
  return digest(JSON.stringify([user.id, user.login, user.role || "admin", user.status, user.must_change_password,
    user.password_hash, user.password_salt, user.password_iterations]));
}
function budget(db, key, limit, window) {
  const now = Date.now(), hash = digest("budget:" + key);
  db.adminAuthLimits = db.adminAuthLimits.filter(row => row.reset_at > now);
  let row = db.adminAuthLimits.find(row => row.key_hash === hash);
  if (!row) {
    if (db.adminAuthLimits.length >= 5000) return false;
    row = { key_hash: hash, count: 0, reset_at: now + window }; db.adminAuthLimits.push(row);
  }
  row.count += 1;
  return row.count <= limit;
}
function currentChallenge(db, hash) {
  const row = db.adminPasswordResets.find(row => row.token_hash === hash && row.state === "ready" && row.expires_at > Date.now());
  const user = row && db.adminUsers.find(user => user.id === row.user_id && user.status === "active" && ["admin", "owner"].includes(user.role || "admin"));
  return user && row.credential_fingerprint === fingerprint(user) ? { row, user } : null;
}

// Only tests inject delivery in-process. No HTTP test flag, code or password bypass.
export function createAdminRecovery({ deliver = sendAdminPasswordReset, configure = mailConfiguration } = {}) {
  return {
    async request(input, ip) {
      const email = adminEmail(input.email);
      const base = new URL(process.env.APP_BASE_URL || "http://localhost:3010");
      if (process.env.APP_ENV === "production" && base.protocol !== "https:") throw error(503, "ADMIN_RECOVERY_NOT_CONFIGURED", "Восстановление по почте пока недоступно.");
      digest("configuration-check"); configure();
      const token = crypto.randomBytes(32).toString("base64url"), hash = digest("token:" + token);
      const admitted = updateDb(db => {
        db.adminPasswordResets = db.adminPasswordResets.filter(row => row.expires_at > Date.now());
        const permitted = [budget(db, "email:" + email, 3, 30 * 60 * 1000), budget(db, "cooldown:" + email, 1, 60000),
          budget(db, "ip:" + ip, 10, 10 * 60 * 1000), budget(db, "global", 100, 24 * 60 * 60 * 1000)].every(Boolean);
        if (!permitted || db.adminPasswordResets.length >= 500) return { limited: true };
        const user = db.adminUsers.find(row => row.login.toLowerCase() === email && row.status === "active" && ["admin", "owner"].includes(row.role || "admin"));
        if (!user) return {};
        db.adminPasswordResets.push({ token_hash: hash, user_id: user.id, credential_fingerprint: fingerprint(user), expires_at: Date.now() + TTL, state: "sending" });
        return { userId: user.id };
      });
      if (admitted.limited) throw error(429, "RATE_LIMIT", "Письмо уже запрашивали. Подождите немного и попробуйте снова.");
      if (admitted.userId) {
        try {
          // The fragment never reaches HTTP access logs or a Referrer header.
          const link = new URL("/admin?reset=1", base.origin); link.hash = "token=" + token;
          await deliver(email, link.toString());
          updateDb(db => {
            const row = db.adminPasswordResets.find(row => row.token_hash === hash);
            const user = db.adminUsers.find(user => user.id === admitted.userId);
            if (!row || !user || row.expires_at <= Date.now() || row.credential_fingerprint !== fingerprint(user)) {
              db.adminPasswordResets = db.adminPasswordResets.filter(row => row.token_hash !== hash); return;
            }
            db.adminPasswordResets = db.adminPasswordResets.filter(other => other.user_id !== user.id || other.token_hash === hash);
            row.state = "ready";
            addAudit(db, "system", null, "admin_recovery_email_sent", "admin_user", user.id);
          });
        } catch {
          updateDb(db => { db.adminPasswordResets = db.adminPasswordResets.filter(row => row.token_hash !== hash);
            addAudit(db, "system", null, "admin_recovery_email_failed", "admin_user", admitted.userId); });
        }
      }
      // Same response for unknown, disabled or archived accounts and delivery failures.
      return { requested: true, message: "Если эта почта указана у действующего администратора, на неё придёт ссылка. Проверьте также папку «Спам»." };
    },
    async complete(input, ip) {
      const token = typeof input.token === "string" ? input.token : "";
      if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw invalid();
      const hash = digest("token:" + token);
      const permitted = updateDb(db => budget(db, "complete-ip:" + ip, 20, 10 * 60 * 1000));
      if (!permitted) throw error(429, "RATE_LIMIT", "Слишком много попыток. Подождите и запросите новое письмо.");
      if (!currentChallenge(readDb(), hash)) throw invalid();
      const password = typeof input.newPassword === "string" ? input.newPassword : "";
      if (password !== input.confirmPassword) throw error(400, "PASSWORD_CONFIRMATION_MISMATCH", "Пароли не совпадают.");
      if (password.length < 12 || password.length > 120) throw error(400, "WEAK_PASSWORD", "Новый пароль должен содержать от 12 до 120 символов.");
      const { hash: passwordHash, salt, iterations } = await createPasswordHashAsync(password);
      const user = updateDb(db => {
        // Revalidate after KDF: another reset, password change, archive or role change wins.
        const current = currentChallenge(db, hash);
        if (!current) throw invalid();
        Object.assign(current.user, { password_hash: passwordHash, password_salt: salt, password_iterations: iterations, must_change_password: false, updated_at: nowIso() });
        db.adminPasswordResets = db.adminPasswordResets.filter(row => row.user_id !== current.user.id);
        db.sessions = db.sessions.filter(row => row.role !== "admin" || row.user_id !== current.user.id);
        addAudit(db, "admin", current.user.id, "recover_administrator_password", "admin_user", current.user.id);
        return current.user;
      });
      return createSession("admin", null, user.id, user.role || "admin");
    }
  };
}
export const adminRecovery = createAdminRecovery();
