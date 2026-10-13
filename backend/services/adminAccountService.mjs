import { readDb, updateDb } from "../storage/jsonStore.mjs";
import { addAudit, findAdminUserById } from "../repositories/databaseRepository.mjs";
import { createPasswordHashAsync } from "../utils/password.mjs";
import { cleanString, enumValue } from "../utils/validation.mjs";
import { generateId } from "../utils/id.mjs";
import { nowIso } from "../utils/dates.mjs";
import { adminEmail } from "../utils/adminEmail.mjs";

const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const view = (user) => ({ id: user.id, name: user.name || user.login, login: user.login,
  role: user.role || "admin", status: user.status, passwordChangeRequired: Boolean(user.must_change_password),
  createdAt: user.created_at, updatedAt: user.updated_at });

function requireOwner(db, session) {
  const active = session && db.sessions.some(row => ((session.id_hash && row.id_hash === session.id_hash) || (session.id && row.id === session.id)) &&
    row.role === "admin" && row.user_id === session.user_id && row.user_role === "owner" &&
    new Date(row.expires_at).getTime() > Date.now());
  const owner = db.adminUsers.find(row => row.id === session?.user_id);
  if (!active || owner?.status !== "active" || owner.role !== "owner" || owner.must_change_password) {
    throw error(403, "OWNER_REQUIRED", "Управлять администраторами может только владелец сервиса.");
  }
}

function targetAdmin(db, id, session) {
  requireOwner(db, session);
  const user = db.adminUsers.find(row => row.id === id);
  if (!user) throw error(404, "ADMIN_NOT_FOUND", "Администратор не найден.");
  if (user.role === "owner" || user.id === session.user_id) {
    throw error(403, "OWNER_PROTECTED", "Владельца нельзя отключить, перенести в архив или сбросить ему пароль здесь. Свой пароль меняйте в настройках.");
  }
  return user;
}

function password(value) {
  // Preserve spaces, just as the ordinary password-change endpoint does.
  const result = String(value || "");
  if (result.length < 12 || result.length > 120) throw error(400, "WEAK_PASSWORD", "Временный пароль должен содержать от 12 до 120 символов.");
  return result;
}

export function listAdministrators(session) {
  const db = readDb();
  requireOwner(db, session);
  return db.adminUsers.map(view);
}

export async function createAdministrator(session, input) {
  if (input.role !== undefined && input.role !== "admin") throw error(400, "INVALID_ADMIN_ROLE", "Здесь можно добавить только администратора, не владельца.");
  const name = cleanString(input.name, 120, true, "Имя");
  const login = adminEmail(input.login);
  // Check access before expensive hashing, then again inside the atomic write.
  listAdministrators(session);
  const { hash, salt, iterations } = await createPasswordHashAsync(password(input.password));
  return updateDb(db => {
    requireOwner(db, session);
    if (db.adminUsers.some(row => row.login.toLowerCase() === login)) throw error(409, "ADMIN_LOGIN_EXISTS", "Этот логин уже занят, в том числе среди архивных записей.");
    const time = nowIso();
    const user = { id: generateId("admin"), name, login, role: "admin", status: "active",
      password_hash: hash, password_salt: salt, password_iterations: iterations,
      must_change_password: true, created_at: time, updated_at: time };
    db.adminUsers.push(user);
    addAudit(db, "admin", session.user_id, "create_administrator", "admin_user", user.id);
    return view(user);
  });
}

export function setAdministratorStatus(session, id, input) {
  const status = enumValue(input.status, ["active", "disabled", "archived"], "Статус");
  return updateDb(db => {
    const user = targetAdmin(db, id, session);
    const previous = user.status;
    user.status = status;
    user.updated_at = nowIso();
    db.sessions = db.sessions.filter(row => row.role !== "admin" || row.user_id !== id);
    db.adminPasswordResets = db.adminPasswordResets.filter(row => row.user_id !== id);
    addAudit(db, "admin", session.user_id, "set_administrator_status", "admin_user", id, { from: previous, to: status });
    return view(user);
  });
}

export async function resetAdministratorPassword(session, id, input) {
  const before = findAdminUserById(id);
  listAdministrators(session);
  if (!before) throw error(404, "ADMIN_NOT_FOUND", "Администратор не найден.");
  if (before.role === "owner" || before.id === session.user_id) throw error(403, "OWNER_PROTECTED", "Свой пароль меняйте в настройках.");
  const { hash, salt, iterations } = await createPasswordHashAsync(password(input.password));
  return updateDb(db => {
    const user = targetAdmin(db, id, session);
    if (JSON.stringify(user) !== JSON.stringify(before)) throw error(409, "RECORD_CHANGED", "Данные администратора изменились. Обновите список и повторите.");
    Object.assign(user, { password_hash: hash, password_salt: salt, password_iterations: iterations,
      must_change_password: true, updated_at: nowIso() });
    db.sessions = db.sessions.filter(row => row.role !== "admin" || row.user_id !== id);
    db.adminPasswordResets = db.adminPasswordResets.filter(row => row.user_id !== id);
    addAudit(db, "admin", session.user_id, "reset_administrator_password", "admin_user", id);
    return view(user);
  });
}
