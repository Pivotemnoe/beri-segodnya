import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = process.env.DB_FILE || "data/db.json";
const sourcePath = path.resolve(ROOT, dbFile);
const uploadsPath = path.resolve(ROOT, process.env.UPLOAD_DIR || "data/uploads");
const backupDir = path.resolve(ROOT, "backups");

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
  await fs.access(sourcePath);
  await fs.mkdir(backupDir, { recursive: true });
  const ext = path.extname(sourcePath) || ".json";
  const stamp = timestamp();
  const targetPath = path.join(backupDir, `db-${stamp}${ext}`);
  const targetUploads = path.join(backupDir, `uploads-${stamp}`);
  await fs.copyFile(sourcePath, targetPath);
  try {
    await fs.access(uploadsPath);
    await fs.cp(uploadsPath, targetUploads, { recursive: true, force: false });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  console.log(`Backup created: ${targetPath}`);
  console.log(`Photo backup created: ${targetUploads}`);
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});
