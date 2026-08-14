import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requireText(text, fragment, message) {
  if (!text.includes(fragment)) fail(message);
}

function listArtifactFiles(directory, prefix = "") {
  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (relativePath === ".git" || relativePath === "node_modules") continue;
      files.push(...listArtifactFiles(path.join(directory, entry.name), relativePath));
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) files.push(relativePath);
  }
  return files;
}

const listed = process.env.SECURITY_CHECK_FORCE_FILESYSTEM === "true"
  ? { status: 1, stdout: "" }
  : spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root,
      encoding: "utf8"
    });
const inventorySource = listed.status === 0 ? "repository" : "release artifact";
const repositoryFiles = listed.status === 0
  ? listed.stdout.split("\0").filter(Boolean)
  : listArtifactFiles(root);
if (repositoryFiles.length === 0) fail("Unable to list files for the security check");

const forbiddenTrackedPath = /^(?:\.env(?!\.example$)(?:\.[^/]+)?|data\/db(?:\.tmp)?\.json|backups\/(?!\.gitkeep$)|logs\/(?!\.gitkeep$)|android-twa\/.*\.(?:jks|keystore|apk|aab))$/i;
const forbiddenPath = repositoryFiles.find((file) => forbiddenTrackedPath.test(file));
if (forbiddenPath) fail(`Sensitive runtime or signing artifact is visible in the ${inventorySource}: ${forbiddenPath}`);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/
];

for (const relativePath of repositoryFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) continue;
  const fileStat = fs.lstatSync(absolutePath);
  if (fileStat.isSymbolicLink()) fail(`Symbolic link is not allowed in the ${inventorySource}: ${relativePath}`);
  if (!fileStat.isFile()) continue;
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) fail(`Possible secret found in ${relativePath}`);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(text)) fail(`Dynamic code execution found in ${relativePath}`);
}

const server = source("server.mjs");
for (const header of ["Content-Security-Policy", "Cross-Origin-Embedder-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "Origin-Agent-Cluster", "Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options", "Permissions-Policy", "Referrer-Policy"]) {
  requireText(server, `"${header}"`, `Required browser security header is missing: ${header}`);
}
requireText(server, "form-action 'self'", "Content Security Policy must restrict form submissions");
if (/Content-Security-Policy[^\n]+unsafe-inline/.test(server)) fail("Content Security Policy still permits inline scripts or styles");
for (const fragment of ['<script src="/page-config.js"></script>', '<script src="/public.js"></script>']) {
  requireText(server, fragment, `External browser script contract is missing: ${fragment}`);
}
requireText(server, 'readEnv("SITE_ACCESS_ENABLED", "false")', "Preview access must default to closed configuration");
requireText(server, 'readEnv("NEXT_PUBLIC_DEMO_MODE", "true")', "Explicit demo-state handling is missing");

const auth = source("backend/services/authService.mjs");
for (const fragment of ["HttpOnly", "SameSite=Strict", "__Host-bs_session", "; Secure", "rateLimit("]) {
  requireText(auth, fragment, `Authentication security contract is missing: ${fragment}`);
}

const router = source("backend/routes/apiRouter.mjs");
for (const fragment of ['request.headers["x-bs-request"] !== "1"', 'request.headers["sec-fetch-site"] === "cross-site"', "ORIGIN_NOT_ALLOWED", "BODY_TOO_LARGE"]) {
  requireText(router, fragment, `Request security contract is missing: ${fragment}`);
}

const responses = source("backend/utils/responses.mjs");
for (const fragment of ["default-src 'none'", '"Cross-Origin-Embedder-Policy"', '"Cross-Origin-Opener-Policy"', '"Cross-Origin-Resource-Policy"']) {
  requireText(responses, fragment, `JSON response hardening contract is missing: ${fragment}`);
}

const passwords = source("backend/utils/password.mjs");
requireText(passwords, "CURRENT_PASSWORD_ITERATIONS = 600000", "Password work factor is below the pilot baseline");
requireText(passwords, "timingSafeEqual", "Password verification is not timing-safe");

const storage = source("backend/storage/jsonStore.mjs");
requireText(storage, "mode: 0o600", "Database files are not created with private permissions");

const backup = source("scripts/backup-data.mjs");
for (const fragment of ['createHash("sha256")', "isSymbolicLink()", "0o700", "0o600"]) {
  requireText(backup, fragment, `Backup security contract is missing: ${fragment}`);
}

const serviceWorker = source("public/sw.js");
for (const fragment of ['request.method !== "GET"', "PRIVATE_PATH.test(url.pathname)", 'url.origin !== self.location.origin']) {
  requireText(serviceWorker, fragment, `Service worker private-data bypass is missing: ${fragment}`);
}
const offlinePage = source("public/offline.html");
if (/<style\b|\son[a-z]+\s*=/i.test(offlinePage)) fail("Offline page contains inline code blocked by the Content Security Policy");

const twaManifest = JSON.parse(source("android-twa/twa-manifest.json"));
const androidManifest = source("android-twa/app/src/main/AndroidManifest.xml");
if (twaManifest.signingKey?.path?.startsWith("/") || twaManifest.enableNotifications !== false) {
  fail("Android wrapper contains a local secret path or an unnecessary notification permission");
}
for (const fragment of ['android:allowBackup="false"', 'android:usesCleartextTraffic="false"']) {
  requireText(androidManifest, fragment, `Android hardening contract is missing: ${fragment}`);
}
if (androidManifest.includes("android.permission.POST_NOTIFICATIONS")) fail("Android pilot requests notifications that the product does not use");

console.log(`Security check passed: ${repositoryFiles.length} ${inventorySource} files and runtime contracts`);
