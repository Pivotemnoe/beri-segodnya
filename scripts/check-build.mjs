import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["server.mjs", "ecosystem.config.cjs", "backend", "scripts", "public"];
const files = [];

function collect(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    if (absolutePath.endsWith(".mjs") || absolutePath.endsWith(".cjs") || absolutePath.endsWith(".js")) files.push(absolutePath);
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
  "/manifest.webmanifest",
  "/sw.js",
  "/public.js",
  "/page-config.js",
  "/offline.css",
  "/offline.js",
  "/android",
  "/downloads/beri-segodnya-android-0.1.0-pilot.apk",
  "application/vnd.android.package-archive",
  "Content-Disposition",
  "X-Robots-Tag",
  "Content-Security-Policy"
];

for (const contract of requiredContracts) {
  if (!server.includes(contract)) {
    console.error(`Build contract is missing: ${contract}`);
    process.exit(1);
  }
}

const manifestPath = path.join(root, "public", "manifest.webmanifest");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.display !== "standalone" || manifest.scope !== "/" || !Array.isArray(manifest.icons)) {
  console.error("PWA manifest is missing standalone installability contracts");
  process.exit(1);
}

const assetLinks = JSON.parse(fs.readFileSync(path.join(root, "public", ".well-known", "assetlinks.json"), "utf8"));
if (assetLinks[0]?.target?.package_name !== "ru.berisegodnya.app" || !assetLinks[0]?.target?.sha256_cert_fingerprints?.length) {
  console.error("Android Digital Asset Links configuration is incomplete");
  process.exit(1);
}

const twaRoot = path.join(root, "android-twa");
const twaManifest = JSON.parse(fs.readFileSync(path.join(twaRoot, "twa-manifest.json"), "utf8"));
const androidManifest = fs.readFileSync(path.join(twaRoot, "app", "src", "main", "AndroidManifest.xml"), "utf8");
const androidBuild = fs.readFileSync(path.join(twaRoot, "app", "build.gradle"), "utf8");
const expectedAndroidPackage = "ru.berisegodnya.app";
if (
  twaManifest.packageId !== expectedAndroidPackage
  || twaManifest.host !== "berisegodnya.ru"
  || twaManifest.startUrl !== "/?source=apk"
  || twaManifest.enableNotifications !== false
  || twaManifest.signingKey?.path?.startsWith("/")
) {
  console.error("Android pilot wrapper identity, launch URL, permissions, or secret path is unsafe");
  process.exit(1);
}
if (
  assetLinks[0]?.target?.package_name !== twaManifest.packageId
  || !androidManifest.includes('android:allowBackup="false"')
  || !androidManifest.includes('android:usesCleartextTraffic="false"')
  || androidManifest.includes("android.permission.POST_NOTIFICATIONS")
  || !androidBuild.includes('versionName = "0.1.0-pilot"')
) {
  console.error("Android pilot wrapper security contracts are incomplete");
  process.exit(1);
}

for (const asset of ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png", "favicon-64.png"]) {
  if (!fs.existsSync(path.join(root, "public", "icons", asset))) {
    console.error(`PWA icon is missing: ${asset}`);
    process.exit(1);
  }
}

for (const asset of ["manifest.webmanifest", "sw.js", "pwa.js", "offline.html", "offline.css", "offline.js"]) {
  if (!fs.existsSync(path.join(root, "public", asset))) {
    console.error(`PWA asset is missing: ${asset}`);
    process.exit(1);
  }
}

const publishedApkName = "beri-segodnya-android-0.1.0-pilot.apk";
const publishedApkPath = path.join(root, "public", "downloads", publishedApkName);
const publishedChecksumPath = `${publishedApkPath}.sha256`;
if (!fs.existsSync(publishedApkPath) || !fs.existsSync(publishedChecksumPath)) {
  console.error("Published Android APK or checksum file is missing");
  process.exit(1);
}
const publishedApk = fs.readFileSync(publishedApkPath);
if (publishedApk.length < 1024 * 1024) {
  console.error("Published Android APK is unexpectedly small");
  process.exit(1);
}
const publishedApkSha256 = createHash("sha256").update(publishedApk).digest("hex");
if (fs.readFileSync(publishedChecksumPath, "utf8").trim() !== `${publishedApkSha256}  ${publishedApkName}`) {
  console.error("Published Android APK checksum is inconsistent");
  process.exit(1);
}

await import("./android-config-check.mjs");

console.log(`Build check passed: ${files.length} JavaScript modules and server contracts`);
