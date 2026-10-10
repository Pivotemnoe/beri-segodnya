#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Published APK verification failed: %s\n' "$*" >&2
  exit 1
}

canonical_fingerprint() {
  printf '%s' "$1" | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]'
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-36.1.0}"
BUILD_TOOLS_DIR="${ANDROID_SDK_ROOT}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
APK_NAME="beri-segodnya-android-0.1.0-pilot.apk"
APK_DIR="${ROOT_DIR}/public/downloads"
APK_PATH="${APK_DIR}/${APK_NAME}"
CHECKSUM_PATH="${APK_PATH}.sha256"
ASSET_LINKS="${ROOT_DIR}/public/.well-known/assetlinks.json"

[[ -n "${ANDROID_SDK_ROOT}" ]] || fail "Set ANDROID_SDK_ROOT or ANDROID_HOME"
for required_file in "${APK_PATH}" "${CHECKSUM_PATH}" "${ASSET_LINKS}"; do
  [[ -f "${required_file}" ]] || fail "Required file is missing: ${required_file}"
done
for required_tool in apksigner zipalign aapt2; do
  [[ -x "${BUILD_TOOLS_DIR}/${required_tool}" ]] || fail "Android build tool is missing: ${BUILD_TOOLS_DIR}/${required_tool}"
done

(
  cd "${APK_DIR}"
  shasum -a 256 -c "${APK_NAME}.sha256" >/dev/null
) || fail "Published APK SHA-256 does not match its checksum file"

"${BUILD_TOOLS_DIR}/zipalign" -c -v 4 "${APK_PATH}" >/dev/null \
  || fail "Published APK alignment is invalid"
signature_info="$("${BUILD_TOOLS_DIR}/apksigner" verify --verbose --print-certs "${APK_PATH}")" \
  || fail "Published APK signature is invalid"
actual_fingerprint="$(printf '%s\n' "${signature_info}" | awk -F': ' '/certificate SHA-256 digest:/{print $2; exit}')"
expected_fingerprint="$(ASSET_LINKS="${ASSET_LINKS}" node --input-type=module -e '
  import fs from "node:fs";
  const links = JSON.parse(fs.readFileSync(process.env.ASSET_LINKS, "utf8"));
  process.stdout.write(links[0].target.sha256_cert_fingerprints[0]);
')"
[[ -n "${actual_fingerprint}" && -n "${expected_fingerprint}" ]] \
  || fail "Unable to read the APK or Digital Asset Links fingerprint"
[[ "$(canonical_fingerprint "${actual_fingerprint}")" == "$(canonical_fingerprint "${expected_fingerprint}")" ]] \
  || fail "Published APK certificate does not match Digital Asset Links"

badging="$("${BUILD_TOOLS_DIR}/aapt2" dump badging "${APK_PATH}")" \
  || fail "Unable to inspect the published APK manifest"
grep -Fq "package: name='ru.berisegodnya.app' versionCode='1' versionName='0.1.0-pilot'" <<<"${badging}" \
  || fail "Published APK package or version is incorrect"
grep -Fq "minSdkVersion:'23'" <<<"${badging}" || fail "Published APK minSdk is incorrect"
grep -Fq "targetSdkVersion:'36'" <<<"${badging}" || fail "Published APK targetSdk is incorrect"
grep -Fq "launchable-activity: name='ru.berisegodnya.app.LauncherActivity'" <<<"${badging}" \
  || fail "Published APK launcher activity is incorrect"

printf 'Published APK verified: %s\n' "${APK_NAME}"

# Keep both immutable rollbacks verified as well as the current buyer-account release.
for NATIVE_VERSION in 2 3; do
APK_NAME="beri-segodnya-android-0.${NATIVE_VERSION}.0-native-pilot.apk"
APK_PATH="${APK_DIR}/${APK_NAME}"
[[ -f "${APK_PATH}" && -f "${APK_PATH}.sha256" ]] || fail "Native signed release or checksum is missing"
(
  cd "${APK_DIR}"
  shasum -a 256 -c "${APK_NAME}.sha256" >/dev/null
) || fail "Native APK SHA-256 does not match its checksum file"
"${BUILD_TOOLS_DIR}/zipalign" -c -v 4 "${APK_PATH}" >/dev/null || fail "Native APK alignment is invalid"
signature_info="$("${BUILD_TOOLS_DIR}/apksigner" verify --verbose --print-certs "${APK_PATH}")" || fail "Native APK signature is invalid"
grep -Fq 'Verified using v2 scheme (APK Signature Scheme v2): true' <<<"${signature_info}" || fail "Native APK lacks a verified v2 signature"
grep -Fq 'Verified using v3 scheme (APK Signature Scheme v3): true' <<<"${signature_info}" || fail "Native APK lacks a verified v3 signature"
actual_fingerprint="$(printf '%s\n' "${signature_info}" | awk -F': ' '/certificate SHA-256 digest:/{print $2; exit}')"
[[ "$(canonical_fingerprint "${actual_fingerprint}")" == "$(canonical_fingerprint "${expected_fingerprint}")" ]] || fail "Native certificate does not match the existing pilot and App Links"
badging="$("${BUILD_TOOLS_DIR}/aapt2" dump badging "${APK_PATH}")" || fail "Unable to inspect native manifest"
grep -Fq "package: name='ru.berisegodnya.app' versionCode='${NATIVE_VERSION}' versionName='0.${NATIVE_VERSION}.0-native-pilot'" <<<"${badging}" || fail "Native package or version is incorrect"
grep -Fq "minSdkVersion:'26'" <<<"${badging}" || fail "Native minSdk is incorrect"
grep -Fq "targetSdkVersion:'36'" <<<"${badging}" || fail "Native targetSdk is incorrect"
grep -Fq "launchable-activity: name='ru.berisegodnya.app.MainActivity'" <<<"${badging}" || fail "Native launcher is incorrect"
if grep -Fq 'application-debuggable' <<<"${badging}"; then fail "Native release is debuggable"; fi
printf 'Published APK verified: %s\n' "${APK_NAME}"
done
