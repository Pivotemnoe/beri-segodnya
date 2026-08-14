import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbFile = process.env.DB_FILE || "data/db.json";
const sourcePath = path.resolve(ROOT, dbFile);
const uploadsPath = path.resolve(ROOT, process.env.UPLOAD_DIR || "data/uploads");
const backupDir = path.resolve(ROOT, process.env.BACKUP_DIR || "backups");

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
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function secureTree(directory) {
  await fs.chmod(directory, 0o700);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in uploads: ${entryPath}`);
    if (entry.isDirectory()) await secureTree(entryPath);
    if (entry.isFile()) await fs.chmod(entryPath, 0o600);
  }
}

async function fileManifest(directory, root = directory) {
  const result = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await fileManifest(entryPath, root));
    if (entry.isFile()) result.push({ path: path.relative(root, entryPath), sha256: await hashFile(entryPath) });
  }
  return result;
}

async function main() {
  await fs.access(sourcePath);
  JSON.parse(await fs.readFile(sourcePath, "utf8"));
  await fs.mkdir(backupDir, { recursive: true, mode: 0o700 });
  await fs.chmod(backupDir, 0o700);
  const ext = path.extname(sourcePath) || ".json";
  const stamp = timestamp();
  const targetPath = path.join(backupDir, `db-${stamp}${ext}`);
  const targetUploads = path.join(backupDir, `uploads-${stamp}`);
  const targetManifest = path.join(backupDir, `manifest-${stamp}.json`);
  const tempPath = `${targetPath}.partial`;
  const tempUploads = `${targetUploads}.partial`;
  await fs.copyFile(sourcePath, tempPath);
  await fs.chmod(tempPath, 0o600);
  await fs.rename(tempPath, targetPath);
  let uploads = [];
  let uploadsCreated = false;
  try {
    await fs.access(uploadsPath);
    await fs.cp(uploadsPath, tempUploads, { recursive: true, force: false });
    await secureTree(tempUploads);
    await fs.rename(tempUploads, targetUploads);
    uploads = await fileManifest(targetUploads);
    uploadsCreated = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: { file: path.basename(targetPath), sha256: await hashFile(targetPath) },
    uploads: { directory: uploadsCreated ? path.basename(targetUploads) : null, files: uploads }
  };
  await fs.writeFile(targetManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await fs.chmod(targetManifest, 0o600);
  console.log(`Backup created: ${targetPath}`);
  console.log(uploadsCreated ? `Photo backup created: ${targetUploads}` : "Photo directory does not exist; database backup is complete.");
  console.log(`Integrity manifest created: ${targetManifest}`);
}

main().catch((error) => {
  console.error(`Backup failed: ${error.message}`);
  process.exit(1);
});
