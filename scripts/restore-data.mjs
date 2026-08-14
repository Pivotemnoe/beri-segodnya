import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = process.env.DB_FILE || "data/db.json";
const targetPath = path.resolve(ROOT, dbFile);
const uploadsPath = path.resolve(ROOT, process.env.UPLOAD_DIR || "data/uploads");
const backupDir = path.resolve(ROOT, process.env.BACKUP_DIR || "backups");
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

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

async function validateJson(filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Backup must contain a JSON object");
  return parsed;
}

async function secureTree(directory) {
  await fs.chmod(directory, 0o700);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in backup uploads: ${entryPath}`);
    if (entry.isDirectory()) await secureTree(entryPath);
    if (entry.isFile()) await fs.chmod(entryPath, 0o600);
  }
}

async function verifyManifest(source) {
  const sourceName = path.basename(source, path.extname(source));
  if (!sourceName.startsWith("db-")) return;
  const stamp = sourceName.slice(3);
  const manifestPath = path.join(path.dirname(source), `manifest-${stamp}.json`);
  try {
    const manifest = await validateJson(manifestPath);
    if (manifest.database?.sha256 !== await hashFile(source)) throw new Error("Database backup checksum does not match manifest");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log("Integrity manifest not found; JSON structure was validated.");
  }
}

async function main() {
  if (!restoreSource) {
    throw new Error("Usage: node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json");
  }

  await fs.access(restoreSource);
  await fs.access(targetPath);
  await validateJson(restoreSource);
  await verifyManifest(restoreSource);
  await validateJson(targetPath);
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fs.chmod(backupDir, 0o700);

  const ext = path.extname(targetPath) || ".json";
  const stamp = timestamp();
  const currentBackup = path.join(backupDir, `db-before-restore-${stamp}${ext}`);
  const currentUploadsBackup = path.join(backupDir, `uploads-before-restore-${stamp}`);
  await fs.copyFile(targetPath, currentBackup);
  await fs.chmod(currentBackup, 0o600);
  try {
    await fs.access(uploadsPath);
    await fs.cp(uploadsPath, currentUploadsBackup, { recursive: true, force: false });
    await secureTree(currentUploadsBackup);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const stagedDatabase = `${targetPath}.restore-${stamp}`;
  await fs.copyFile(restoreSource, stagedDatabase);
  await validateJson(stagedDatabase);
  await fs.chmod(stagedDatabase, 0o600);
  await fs.rename(stagedDatabase, targetPath);
  await fs.chmod(targetPath, 0o600);

  const sourceName = path.basename(restoreSource, path.extname(restoreSource));
  const photoStamp = sourceName.startsWith("db-") ? sourceName.slice(3) : "";
  const restoreUploads = photoStamp ? path.join(path.dirname(restoreSource), `uploads-${photoStamp}`) : "";
  if (restoreUploads) {
    try {
      await fs.access(restoreUploads);
      const stagedUploads = `${uploadsPath}.restore-${stamp}`;
      const displacedUploads = `${uploadsPath}.previous-${stamp}`;
      await fs.cp(restoreUploads, stagedUploads, { recursive: true, force: false });
      await secureTree(stagedUploads);
      let displaced = false;
      try {
        await fs.rename(uploadsPath, displacedUploads);
        displaced = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        await fs.rename(stagedUploads, uploadsPath);
      } catch (error) {
        if (displaced) await fs.rename(displacedUploads, uploadsPath);
        throw error;
      }
      if (displaced) await fs.rm(displacedUploads, { recursive: true, force: true });
      console.log(`Restored photos from: ${restoreUploads}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.log("Matching photo backup not found; current photo directory was preserved.");
    }
  }

  console.log(`Current data backed up: ${currentBackup}`);
  console.log(`Restored data from: ${restoreSource}`);
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});
