import fs from "node:fs";
import path from "node:path";
import { createSeedDb } from "../db/seedData.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const collections = [
  "partners",
  "partnerUsers",
  "partnerAddresses",
  "offers",
  "offerTemplates",
  "bookings",
  "partnerApplications",
  "contactRequests",
  "sessions",
  "auditLog"
];

export function ensureDb() {
  const DB_PATH = dbPath();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    writeDb(createSeedDb());
  }
}

export function readDb() {
  ensureDb();
  const data = JSON.parse(fs.readFileSync(dbPath(), "utf8"));
  let changed = false;
  for (const name of collections) {
    if (!Array.isArray(data[name])) {
      data[name] = [];
      changed = true;
    }
  }
  if (changed) writeDb(data);
  return data;
}

export function writeDb(data) {
  const DB_PATH = dbPath();
  const TMP_PATH = DB_PATH.replace(/\.json$/, ".tmp.json");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(TMP_PATH, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(TMP_PATH, DB_PATH);
}

export function updateDb(mutator) {
  const data = readDb();
  const result = mutator(data);
  writeDb(data);
  return result;
}

export function getCollection(name) {
  return readDb()[name] || [];
}

export function setCollection(name, value) {
  return updateDb((data) => {
    data[name] = value;
    return data[name];
  });
}

export function resetDb() {
  const data = createSeedDb();
  writeDb(data);
  return data;
}

export function dbPath() {
  const DB_FILE = process.env.DB_FILE || "data/db.json";
  return path.isAbsolute(DB_FILE) ? DB_FILE : path.join(ROOT, DB_FILE);
}
