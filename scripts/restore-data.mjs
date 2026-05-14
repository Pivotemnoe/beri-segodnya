import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = process.env.DB_FILE || "data/db.json";
const targetPath = path.resolve(ROOT, dbFile);
const backupDir = path.resolve(ROOT, "backups");
const restoreSource = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : "";

function timestamp() {
  const pad = (value) => String(value).padStart(2, "0");
  const now = new Date();
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join("-") + "-" + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("-");
}

async function main() {
  if (!restoreSource) {
    throw new Error("Usage: node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json");
  }

  await fs.access(restoreSource);
  await fs.access(targetPath);
  await fs.mkdir(backupDir, { recursive: true });

  const ext = path.extname(targetPath) || ".json";
  const currentBackup = path.join(backupDir, `db-before-restore-${timestamp()}${ext}`);
  await fs.copyFile(targetPath, currentBackup);
  await fs.copyFile(restoreSource, targetPath);

  console.log(`Current data backed up: ${currentBackup}`);
  console.log(`Restored data from: ${restoreSource}`);
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});
