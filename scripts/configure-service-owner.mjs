import fs from "node:fs";
import { dbPath, readDb, updateDb } from "../backend/storage/jsonStore.mjs";
import { addAudit } from "../backend/repositories/databaseRepository.mjs";
import { adminEmail } from "../backend/utils/adminEmail.mjs";
import { nowIso } from "../backend/utils/dates.mjs";

try {
  if (process.env.OWNER_MIGRATION_SERVER_STOPPED !== "true") throw new Error("Stop the single JSON writer and set OWNER_MIGRATION_SERVER_STOPPED=true");
  if (!fs.existsSync(dbPath())) throw new Error("Existing database is required; no seed is allowed");
  const email = adminEmail(process.env.OWNER_EMAIL);
  const source = String(process.env.OWNER_EXISTING_LOGIN || "").trim().toLowerCase();
  if (!source) throw new Error("OWNER_EXISTING_LOGIN is required");
  const db = readDb();
  const owners = db.adminUsers.filter(row => row.role === "owner");
  const existing = db.adminUsers.filter(row => row.login.toLowerCase() === email);
  if (owners.length === 1 && existing.length === 1 && owners[0].id === existing[0].id && existing[0].status === "active") {
    console.log(JSON.stringify({ result: "ALREADY_CONFIGURED", ownerLogin: email, passwordPreserved: true }));
  } else {
    if (owners.length || existing.length) throw new Error("Owner/email conflict; refusing to overwrite any account");
    const matches = db.adminUsers.filter(row => row.login.toLowerCase() === source && row.status === "active");
    if (matches.length !== 1) throw new Error("Exactly one existing active administrator is required");
    const id = matches[0].id;
    updateDb(current => {
      const user = current.adminUsers.find(row => row.id === id);
      // Keep the stable ID, password, password gate and all business data intact.
      user.login = email; user.role = "owner";
      user.name = String(process.env.OWNER_NAME || user.name || email).trim().slice(0, 120);
      user.updated_at = nowIso();
      current.sessions = current.sessions.filter(row => row.role !== "admin");
      current.adminPasswordResets = [];
      addAudit(current, "system", null, "configure_service_owner", "admin_user", id);
    });
    console.log(JSON.stringify({ result: "CONFIGURED", ownerLogin: email, passwordPreserved: true, administratorSessionsRevoked: true }));
  }
} catch (failure) {
  console.error("Owner configuration failed: " + failure.message); process.exitCode = 1;
}
