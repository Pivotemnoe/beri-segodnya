import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["server.mjs", "backend", "scripts"];
const files = [];

function collect(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    if (absolutePath.endsWith(".mjs")) files.push(absolutePath);
    return;
  }
  for (const entry of fs.readdirSync(absolutePath)) collect(path.join(relativePath, entry));
}

for (const entry of roots) collect(entry);

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

const server = fs.readFileSync(path.join(root, "server.mjs"), "utf8");
const requiredContracts = [
  "/api/public/bookings",
  "/api/admin/",
  "/api/partner/",
  "X-Robots-Tag",
  "Content-Security-Policy"
];

for (const contract of requiredContracts) {
  if (!server.includes(contract)) {
    console.error(`Build contract is missing: ${contract}`);
    process.exit(1);
  }
}

console.log(`Build check passed: ${files.length} JavaScript modules and server contracts`);
