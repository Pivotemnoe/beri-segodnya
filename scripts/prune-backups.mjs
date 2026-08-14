import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backupDir = path.resolve(ROOT, process.env.BACKUP_DIR || "backups");
const keepDays = Number(process.env.BACKUP_KEEP_DAYS || process.argv[2] || 14);
const now = Date.now();
const maxAgeMs = keepDays * 24 * 60 * 60 * 1000;

function backupStamp(name) {
  return name.match(/^(?:db|uploads|manifest)(?:-before-restore)?-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})(?:\..+)?$/)?.[1] || null;
}

async function main() {
  if (!Number.isFinite(keepDays) || keepDays < 1) {
    throw new Error("BACKUP_KEEP_DAYS must be a positive number");
  }

  const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const groups = new Map();
  let deleted = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.name === ".gitkeep") continue;
    const stamp = backupStamp(entry.name);
    if (!stamp) {
      skipped += 1;
      continue;
    }
    const entryPath = path.join(backupDir, entry.name);
    const stat = await fs.stat(entryPath);
    const group = groups.get(stamp) || { newestMtimeMs: 0, entries: [] };
    group.newestMtimeMs = Math.max(group.newestMtimeMs, stat.mtimeMs);
    group.entries.push(entryPath);
    groups.set(stamp, group);
  }

  for (const group of groups.values()) {
    if (now - group.newestMtimeMs <= maxAgeMs) continue;
    for (const entryPath of group.entries) {
      await fs.rm(entryPath, { recursive: true, force: true });
      deleted += 1;
    }
  }

  console.log(`Deleted old backups: ${deleted}`);
  if (skipped) console.log(`Skipped unrecognized backup entries: ${skipped}`);
}

main().catch((error) => {
  console.error(`Prune failed: ${error.message}`);
  process.exit(1);
});
