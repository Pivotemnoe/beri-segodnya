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
  let manifest;
  try { manifest = await validateJson(manifestPath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log("Legacy backup: integrity manifest is absent; only JSON structure can be verified.");
    return null;
  }
  if (manifest.version !== 1 || manifest.database?.file !== path.basename(source) || manifest.database?.sha256 !== await hashFile(source)) throw new Error("Database backup checksum or identity does not match manifest");
  const expectedDirectory = `uploads-${stamp}`;
  if (manifest.uploads?.directory !== null && manifest.uploads?.directory !== expectedDirectory) throw new Error("Invalid photo backup directory in manifest");
  if (!Array.isArray(manifest.uploads?.files)) throw new Error("Photo manifest is incomplete");
  if (manifest.uploads.directory === null && manifest.uploads.files.length) throw new Error("Photo manifest has files without a directory");
  if (manifest.uploads.directory) await verifyPhotos(path.join(path.dirname(source), expectedDirectory), manifest.uploads.files);
  return manifest;
}

async function photoManifest(directory, root = directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error("Backup photos must contain only regular files and directories");
    if (entry.isDirectory()) result.push(...await photoManifest(file, root));
    else result.push({ path: path.relative(root, file), sha256: await hashFile(file) });
  }
  return result;
}

async function verifyPhotos(directory, expected) {
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Photo backup is not a regular directory");
  const actual = await photoManifest(directory);
  const normalize = (entries) => entries.map((entry) => {
    if (typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256 || "")) throw new Error("Invalid photo checksum entry");
    return [entry.path, entry.sha256];
  }).sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(expected))) throw new Error("Photo backup file list or checksum does not match manifest");
}

async function main() {
  if (!restoreSource) {
    throw new Error("Usage: node scripts/restore-data.mjs backups/db-YYYY-MM-DD-HH-mm-ss.json");
  }
  if (process.env.RESTORE_SERVER_STOPPED !== "true") throw new Error("Stop the application before restore, then set RESTORE_SERVER_STOPPED=true. Never restore under live writes.");

  await fs.access(restoreSource);
  await fs.access(targetPath);
  await validateJson(restoreSource);
  const manifest = await verifyManifest(restoreSource);
  await validateJson(targetPath);
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fs.chmod(backupDir, 0o700);

  const ext = path.extname(targetPath) || ".json";
  const stamp = `${timestamp()}-${crypto.randomUUID()}`;
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
  if (manifest && manifest.database.sha256 !== await hashFile(stagedDatabase)) throw new Error("Staged database checksum does not match manifest");

  const sourceName = path.basename(restoreSource, path.extname(restoreSource));
  const photoStamp = sourceName.startsWith("db-") ? sourceName.slice(3) : "";
  const restoreUploads = photoStamp && (!manifest || manifest.uploads.directory) ? path.join(path.dirname(restoreSource), `uploads-${photoStamp}`) : "";
  const stagedUploads = `${uploadsPath}.restore-${stamp}`;
  const displacedUploads = `${uploadsPath}.previous-${stamp}`;
  let photosReady = false;
  if (restoreUploads) {
    try {
      await fs.access(restoreUploads);
      await fs.cp(restoreUploads, stagedUploads, { recursive: true, force: false });
      await secureTree(stagedUploads);
      if (manifest?.uploads.directory) await verifyPhotos(stagedUploads, manifest.uploads.files);
      photosReady = true;
    } catch (error) {
      if (error.code !== "ENOENT" || manifest?.uploads.directory) throw error;
      console.log("Matching legacy photo backup not found; current photo directory was preserved.");
    }
  }
  // Stage and verify the whole pair before the first live data replacement.
  await fs.rename(stagedDatabase, targetPath);
  try {
    if (photosReady) {
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
      if (displaced) await fs.rm(displacedUploads, { recursive: true, force: true }).catch((error) => console.warn(`Restored pair is active; previous photo staging was retained: ${error.code || "CLEANUP_FAILED"}`));
      console.log(`Restored photos from: ${restoreUploads}`);
    }
  } catch (error) {
    // A failed photo switch must not leave the database on the other snapshot.
    await fs.copyFile(currentBackup, stagedDatabase);
    await fs.chmod(stagedDatabase, 0o600);
    await fs.rename(stagedDatabase, targetPath);
    throw error;
  }

  console.log(`Current data backed up: ${currentBackup}`);
  console.log(`Restored data from: ${restoreSource}`);
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});
