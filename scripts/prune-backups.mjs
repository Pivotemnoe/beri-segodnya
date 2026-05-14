import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backupDir = path.resolve(ROOT, "backups");
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || process.argv[2] || 14);
const now = Date.now();
const maxAgeMs = keepDays * 24 * 60 * 60 * 1000;

async function main() {
  if (!Number.isFinite(keepDays) || keepDays < 1) {
    throw new Error("BACKUP_KEEP_DAYS must be a positive number");
  }

  const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.isFile() || entry.name === ".gitkeep") continue;
    const filePath = path.join(backupDir, entry.name);
    const stat = await fs.stat(filePath);
    if (now - stat.mtimeMs > maxAgeMs) {
      await fs.unlink(filePath);
      deleted += 1;
    }
  }

  console.log(`Deleted old backups: ${deleted}`);
}

main().catch((error) => {
  console.error(`Prune failed: ${error.message}`);
  process.exit(1);
});
