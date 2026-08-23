#!/usr/bin/env node

import { listAdminData } from "../backend/repositories/databaseRepository.mjs";
import { patchPartnerUserInput } from "../backend/services/adminService.mjs";
import { ensureDb } from "../backend/storage/jsonStore.mjs";

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function main() {
  const login = requiredEnvironment("RESET_PARTNER_LOGIN");
  const password = requiredEnvironment("RESET_PARTNER_PASSWORD");

  ensureDb();
  const matches = listAdminData("partnerUsers").filter(
    (user) => String(user.login || "").trim().toLowerCase() === login.toLowerCase()
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one partner user for login ${login}; found ${matches.length}`);
  }

  const user = matches[0];
  const updated = patchPartnerUserInput(user.partner_id, user.id, { password });
  if (!updated || updated.must_change_password !== true) {
    throw new Error(`Password reset did not complete for login ${login}`);
  }

  console.log(`Partner password reset completed for login ${updated.login}; first-login change is required; old sessions were revoked.`);
}

try {
  main();
} catch (error) {
  console.error(`Partner password reset failed: ${error.message}`);
  process.exitCode = 1;
}
