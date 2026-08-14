import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "beri-backup-smoke-"));
const dbFile = path.join(tempDir, "data", "db.json");
const uploadDir = path.join(tempDir, "data", "uploads");
const backupDir = path.join(tempDir, "backups");
const testEnv = { ...process.env, DB_FILE: dbFile, UPLOAD_DIR: uploadDir, BACKUP_DIR: backupDir };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(script, args = [], env = testEnv) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`${script} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout;
}

function mode(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

try {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(dbFile, `${JSON.stringify({ version: "original", bookings: [] }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(uploadDir, "fixture.webp"), "fixture-image", { mode: 0o600 });

  run("backup-data.mjs");
  const entries = fs.readdirSync(backupDir);
  const dbName = entries.find((name) => /^db-\d{4}-.+\.json$/.test(name));
  const uploadsName = entries.find((name) => /^uploads-\d{4}-/.test(name));
  const manifestName = entries.find((name) => /^manifest-\d{4}-.+\.json$/.test(name));
  assert(dbName && uploadsName && manifestName, "Paired database, upload and manifest backup was not created");
  assert(mode(backupDir) === 0o700, "Backup directory mode must be 0700");
  assert(mode(path.join(backupDir, dbName)) === 0o600, "Database backup mode must be 0600");
  assert(mode(path.join(backupDir, manifestName)) === 0o600, "Manifest mode must be 0600");
  assert(mode(path.join(backupDir, uploadsName)) === 0o700, "Upload backup directory mode must be 0700");
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, manifestName), "utf8"));
  assert(manifest.database?.file === dbName && manifest.database.sha256, "Backup manifest is incomplete");
  assert(manifest.uploads?.files?.[0]?.path === "fixture.webp", "Upload manifest is incomplete");

  fs.writeFileSync(dbFile, `${JSON.stringify({ version: "changed", bookings: [] }, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(uploadDir, "fixture.webp"), "changed-image", { mode: 0o600 });
  run("restore-data.mjs", [path.join(backupDir, dbName)]);
  assert(JSON.parse(fs.readFileSync(dbFile, "utf8")).version === "original", "Database was not restored from verified backup");
  assert(fs.readFileSync(path.join(uploadDir, "fixture.webp"), "utf8") === "fixture-image", "Paired upload directory was not restored");
  assert(mode(dbFile) === 0o600 && mode(uploadDir) === 0o700, "Restored data modes are unsafe");

  const oldStamp = "2000-01-01-00-00-00";
  const oldDb = path.join(backupDir, `db-${oldStamp}.json`);
  const oldUploads = path.join(backupDir, `uploads-${oldStamp}`);
  const oldManifest = path.join(backupDir, `manifest-${oldStamp}.json`);
  fs.copyFileSync(path.join(backupDir, dbName), oldDb);
  fs.cpSync(path.join(backupDir, uploadsName), oldUploads, { recursive: true });
  fs.copyFileSync(path.join(backupDir, manifestName), oldManifest);
  const oldTime = new Date("2000-01-02T00:00:00Z");
  for (const entryPath of [oldDb, oldUploads, oldManifest]) fs.utimesSync(entryPath, oldTime, oldTime);
  run("prune-backups.mjs", [], { ...testEnv, BACKUP_KEEP_DAYS: "14" });
  assert(!fs.existsSync(oldDb) && !fs.existsSync(oldUploads) && !fs.existsSync(oldManifest), "Expired paired backup was not pruned together");

  console.log("Backup and restore smoke test passed in an isolated temporary directory");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
