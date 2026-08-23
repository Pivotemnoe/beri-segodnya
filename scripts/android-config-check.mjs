import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const twaRoot = path.join(root, "android-twa");
const expected = {
  packageId: "ru.berisegodnya.app",
  host: "berisegodnya.ru",
  versionCode: 1,
  versionName: "0.1.0-pilot",
  wrapperJarSha256: "497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7",
  wrapperUnixSha256: "ab5c0cad16305af2e619c159c1f58dd68d07fab9c11e36701e109c0277407f7a",
  wrapperWindowsSha256: "5c0a21ecd6b3a6292e0746bff3b75fd2d8f47b9ff226ce53dc22b30184ef3bec",
  distributionSha256: "553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746",
  distributionUrl: "https://services.gradle.org/distributions/gradle-9.5.0-bin.zip"
};

function fail(message) {
  console.error(`Android config check failed: ${message}`);
  process.exit(1);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sha256(relativePath) {
  return createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

function requireText(text, fragment, message) {
  if (!text.includes(fragment)) fail(message);
}

function normalizeFingerprint(value) {
  return String(value || "").replaceAll(":", "").replaceAll(/\s/g, "").toUpperCase();
}

function properties(text) {
  const entries = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) fail(`Malformed Gradle wrapper property: ${line}`);
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).replaceAll("\\:", ":");
    entries[key] = value;
  }
  return entries;
}

if (sha256("android-twa/gradle/wrapper/gradle-wrapper.jar") !== expected.wrapperJarSha256) {
  fail("Gradle wrapper JAR is not the audited official Gradle 9.5.0 binary");
}
if (sha256("android-twa/gradlew") !== expected.wrapperUnixSha256 || sha256("android-twa/gradlew.bat") !== expected.wrapperWindowsSha256) {
  fail("Gradle wrapper launcher scripts differ from the audited generated files");
}
if ((fs.statSync(path.join(twaRoot, "gradlew")).mode & 0o111) === 0) fail("android-twa/gradlew is not executable");

const wrapper = properties(read("android-twa/gradle/wrapper/gradle-wrapper.properties"));
if (
  wrapper.distributionUrl !== expected.distributionUrl
  || wrapper.distributionSha256Sum !== expected.distributionSha256
  || wrapper.validateDistributionUrl !== "true"
) {
  fail("Gradle distribution URL, checksum, or URL validation is not pinned");
}

const assetLinks = JSON.parse(read("public/.well-known/assetlinks.json"));
if (!Array.isArray(assetLinks) || assetLinks.length !== 1) fail("Digital Asset Links must contain exactly one pilot application");
const appLink = assetLinks[0];
const publishedFingerprints = appLink?.target?.sha256_cert_fingerprints;
if (
  appLink?.target?.namespace !== "android_app"
  || appLink?.target?.package_name !== expected.packageId
  || !appLink?.relation?.includes("delegate_permission/common.handle_all_urls")
  || !Array.isArray(publishedFingerprints)
  || publishedFingerprints.length !== 1
  || !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(publishedFingerprints[0])
) {
  fail("Digital Asset Links identity, relation, or release fingerprint is invalid");
}

const twaManifest = JSON.parse(read("android-twa/twa-manifest.json"));
const twaFingerprints = Array.isArray(twaManifest.fingerprints)
  ? twaManifest.fingerprints.map((entry) => typeof entry === "string" ? entry : entry?.value)
  : [];
if (
  twaManifest.packageId !== expected.packageId
  || twaManifest.host !== expected.host
  || twaManifest.startUrl !== "/?source=apk"
  || twaManifest.appVersionCode !== expected.versionCode
  || twaManifest.appVersion !== expected.versionName
  || twaManifest.enableNotifications !== false
  || twaManifest.signingKey?.path?.startsWith("/")
  || twaFingerprints.length !== 1
  || normalizeFingerprint(twaFingerprints[0]) !== normalizeFingerprint(publishedFingerprints[0])
) {
  fail("TWA identity, version, permissions, signing path, or fingerprint is inconsistent");
}
for (const shortcut of twaManifest.shortcuts || []) {
  const url = new URL(shortcut.url);
  if (url.protocol !== "https:" || url.hostname !== expected.host) fail("TWA shortcut leaves the trusted HTTPS origin");
}

const androidManifest = read("android-twa/app/src/main/AndroidManifest.xml");
for (const fragment of ['android:allowBackup="false"', 'android:usesCleartextTraffic="false"', 'android:exported="false"']) {
  requireText(androidManifest, fragment, `Android manifest hardening is missing: ${fragment}`);
}
for (const forbidden of ["android.permission.POST_NOTIFICATIONS", 'android:debuggable="true"', 'android:usesCleartextTraffic="true"']) {
  if (androidManifest.includes(forbidden)) fail(`Android manifest contains a forbidden pilot setting: ${forbidden}`);
}

const androidBuild = read("android-twa/app/build.gradle");
for (const fragment of [
  "compileSdk = 36",
  "resValues = true",
  "minSdk = 23",
  "targetSdk = 36",
  "versionCode = 1",
  'versionName = "0.1.0-pilot"',
  "debuggable = false",
  "jniDebuggable = false",
  "minifyEnabled = true",
  "shrinkResources = true",
  "checkReleaseBuilds = true",
  "abortOnError = true",
  "com.google.androidbrowserhelper:androidbrowserhelper:2.7.3"
]) {
  requireText(androidBuild, fragment, `Android release build contract is missing: ${fragment}`);
}

const rootBuild = read("android-twa/build.gradle");
for (const fragment of ["dependencyLocking", "lockAllConfigurations()", "com.android.tools.build:gradle:9.3.1"]) {
  requireText(rootBuild, fragment, `Android dependency lock contract is missing: ${fragment}`);
}
const dependencyLock = read("android-twa/app/gradle.lockfile");
requireText(dependencyLock, "# This is a Gradle generated file for dependency locking.", "Gradle dependency lockfile is not generated");
const releasePackages = new Map();
for (const rawLine of dependencyLock.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("empty=")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) fail(`Malformed Gradle dependency lock entry: ${line}`);
  const coordinate = line.slice(0, separator);
  const configurations = line.slice(separator + 1).split(",");
  if (!configurations.includes("releaseRuntimeClasspath")) continue;
  const parts = coordinate.split(":");
  if (parts.length !== 3) fail(`Malformed release dependency coordinate: ${coordinate}`);
  const [group, artifact, version] = parts;
  if (/(?:snapshot|alpha|beta|(?:^|[.-])rc\d*)/i.test(version)) {
    fail(`Pre-release dependency is forbidden in release runtime: ${coordinate}`);
  }
  const packageName = `${group}:${artifact}`;
  const previousVersion = releasePackages.get(packageName);
  if (previousVersion && previousVersion !== version) {
    fail(`Conflicting release dependency versions are locked: ${packageName} ${previousVersion} and ${version}`);
  }
  releasePackages.set(packageName, version);
}
if (releasePackages.size < 20) fail("Release runtime dependency lock is unexpectedly incomplete");
for (const [packageName, version] of [
  ["com.google.androidbrowserhelper:androidbrowserhelper", "2.7.3"],
  ["androidx.browser:browser", "1.10.0"]
]) {
  if (releasePackages.get(packageName) !== version) {
    fail(`Expected stable release dependency is not locked: ${packageName}:${version}`);
  }
}

const verificationMetadata = read("android-twa/gradle/verification-metadata.xml");
for (const fragment of [
  "<verify-metadata>true</verify-metadata>",
  '<component group="com.google.androidbrowserhelper" name="androidbrowserhelper" version="2.7.3">',
  '<component group="androidx.browser" name="browser" version="1.10.0">'
]) {
  requireText(verificationMetadata, fragment, `Gradle dependency verification contract is missing: ${fragment}`);
}
for (const forbidden of ["<trusted-artifacts", "<ignored-keys", "<trusted-keys", "<sha1 ", "<md5 "]) {
  if (verificationMetadata.includes(forbidden)) fail(`Gradle dependency verification contains a forbidden bypass or weak checksum: ${forbidden}`);
}
const verifiedArtifacts = verificationMetadata.match(/<artifact\s/g)?.length || 0;
const sha256Checksums = verificationMetadata.match(/<sha256 value="[0-9a-f]{64}"/g)?.length || 0;
if (verifiedArtifacts < releasePackages.size || verifiedArtifacts !== sha256Checksums) {
  fail("Gradle dependency verification must provide exactly one SHA-256 checksum for every verified artifact");
}

const buildScript = read("android-twa/build-pilot-apk.sh");
for (const fragment of [
  "umask 077",
  "PILOT_PREFLIGHT_ONLY",
  "file_mode",
  "EXPECTED_WRAPPER_SHA256",
  "EXPECTED_GRADLE_DISTRIBUTION_SHA256",
  "Digital Asset Links",
  "--warning-mode fail --dependency-verification strict clean lintRelease assembleRelease",
  "zipalign",
  "apksigner",
  "aapt2",
  "certificate SHA-256 digest",
  "shasum -a 256 -c",
  "trap cleanup EXIT"
]) {
  requireText(buildScript, fragment, `Signed APK verification contract is missing: ${fragment}`);
}

console.log(`Android config check passed: wrapper supply chain, ${releasePackages.size} locked release dependencies, ${verifiedArtifacts} SHA-256 verified artifacts, TWA identity, release hardening and signing verifier`);
