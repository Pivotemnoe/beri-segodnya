#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() {
  printf 'APK build preflight failed: %s\n' "$*" >&2
  exit 1
}

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

canonical_fingerprint() {
  printf '%s' "$1" | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]'
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to an installed Android SDK}"
JAVA_HOME="${JAVA_HOME:?Set JAVA_HOME to JDK 17}"
PILOT_KEYSTORE="${PILOT_KEYSTORE:?Set PILOT_KEYSTORE to the private JKS file}"
PILOT_KEYSTORE_PASSWORD_FILE="${PILOT_KEYSTORE_PASSWORD_FILE:?Set PILOT_KEYSTORE_PASSWORD_FILE to a chmod 600 password file}"
PILOT_KEY_ALIAS="${PILOT_KEY_ALIAS:-beri-segodnya-pilot}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-36.1.0}"
BUILD_TOOLS_DIR="${ANDROID_SDK_ROOT}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
ANDROID_PLATFORM_JAR="${ANDROID_SDK_ROOT}/platforms/android-36/android.jar"
ASSET_LINKS="${ROOT_DIR}/public/.well-known/assetlinks.json"
GRADLE_WRAPPER_JAR="${SCRIPT_DIR}/gradle/wrapper/gradle-wrapper.jar"
GRADLE_WRAPPER_PROPERTIES="${SCRIPT_DIR}/gradle/wrapper/gradle-wrapper.properties"
EXPECTED_WRAPPER_SHA256="497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7"
EXPECTED_GRADLE_DISTRIBUTION_SHA256="553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746"
PILOT_PACKAGE_ID="ru.berisegodnya.app"
PILOT_VERSION_CODE="1"
PILOT_VERSION_NAME="0.1.0-pilot"
UNSIGNED_APK="${SCRIPT_DIR}/app/build/outputs/apk/release/app-release-unsigned.apk"
ALIGNED_APK="${SCRIPT_DIR}/app-release-aligned.apk"
SIGNED_APK="${SCRIPT_DIR}/app-release-signed.apk"
KEY_PASSWORD_FILE=""

cleanup() {
  rm -f "${ALIGNED_APK}"
  if [[ -n "${KEY_PASSWORD_FILE}" ]]; then
    rm -f "${KEY_PASSWORD_FILE}"
  fi
}
trap cleanup EXIT

for required_file in "${PILOT_KEYSTORE}" "${PILOT_KEYSTORE_PASSWORD_FILE}" "${ASSET_LINKS}" "${GRADLE_WRAPPER_JAR}" "${GRADLE_WRAPPER_PROPERTIES}"; do
  [[ -f "${required_file}" ]] || fail "Required file is missing: ${required_file}"
done

for private_file in "${PILOT_KEYSTORE}" "${PILOT_KEYSTORE_PASSWORD_FILE}"; do
  mode="$(file_mode "${private_file}")"
  case "${mode}" in
    400|600) ;;
    *) fail "Private signing file must use mode 0400 or 0600: ${private_file}" ;;
  esac
done

password_length="$(tr -d '\r\n' < "${PILOT_KEYSTORE_PASSWORD_FILE}" | wc -c | tr -d ' ')"
[[ "${password_length}" -ge 16 ]] || fail "Keystore password file is unexpectedly short"

JAVA="${JAVA_HOME}/bin/java"
KEYTOOL="${JAVA_HOME}/bin/keytool"
[[ -x "${JAVA}" ]] || fail "JDK java is missing: ${JAVA}"
[[ -x "${KEYTOOL}" ]] || fail "JDK keytool is missing: ${KEYTOOL}"
java_specification_version="$("${JAVA}" -XshowSettings:properties -version 2>&1 | awk -F'= ' '/java.specification.version/{print $2; exit}')"
[[ "${java_specification_version}" == "17" ]] || fail "JDK 17 is required; found ${java_specification_version:-unknown}"

actual_wrapper_sha256="$(shasum -a 256 "${GRADLE_WRAPPER_JAR}" | awk '{print $1}')"
[[ "${actual_wrapper_sha256}" == "${EXPECTED_WRAPPER_SHA256}" ]] || fail "Gradle wrapper JAR checksum does not match the audited Gradle 9.5.0 wrapper"
grep -Fq "distributionSha256Sum=${EXPECTED_GRADLE_DISTRIBUTION_SHA256}" "${GRADLE_WRAPPER_PROPERTIES}" \
  || fail "Gradle distribution checksum is not pinned"

key_info="$(LC_ALL=C "${KEYTOOL}" -list -v \
  -keystore "${PILOT_KEYSTORE}" \
  -storepass:file "${PILOT_KEYSTORE_PASSWORD_FILE}" \
  -alias "${PILOT_KEY_ALIAS}" 2>/dev/null)" \
  || fail "Keystore, password, or signing alias is invalid"
expected_fingerprint="$(printf '%s\n' "${key_info}" | awk -F'SHA256: ' '/SHA256:/{print $2; exit}')"
[[ -n "${expected_fingerprint}" ]] || fail "Unable to read the signing certificate SHA-256 fingerprint"
grep -Fq "\"package_name\": \"${PILOT_PACKAGE_ID}\"" "${ASSET_LINKS}" || fail "Digital Asset Links package does not match the APK"
grep -Fq "\"${expected_fingerprint}\"" "${ASSET_LINKS}" || fail "Signing certificate does not match public Digital Asset Links"

if [[ "${PILOT_PREFLIGHT_ONLY:-false}" == "true" ]]; then
  printf 'Pilot signing preflight passed: JDK 17, private-file modes, Gradle checksums, alias and Digital Asset Links match.\n'
  exit 0
fi

[[ -f "${ANDROID_PLATFORM_JAR}" ]] || fail "Android Platform 36 is missing: ${ANDROID_PLATFORM_JAR}"
for required_tool in zipalign apksigner aapt2; do
  [[ -x "${BUILD_TOOLS_DIR}/${required_tool}" ]] || fail "Android build tool is missing: ${BUILD_TOOLS_DIR}/${required_tool}"
done

export ANDROID_HOME="${ANDROID_SDK_ROOT}"
export ANDROID_SDK_ROOT
export JAVA_HOME

rm -f "${SIGNED_APK}" "${SIGNED_APK}.sha256" "${ALIGNED_APK}"
cd "${SCRIPT_DIR}"
./gradlew --no-daemon --warning-mode fail --dependency-verification strict clean lintRelease assembleRelease
[[ -f "${UNSIGNED_APK}" ]] || fail "Gradle did not produce the expected unsigned release APK"

"${BUILD_TOOLS_DIR}/zipalign" -f 4 "${UNSIGNED_APK}" "${ALIGNED_APK}"
KEY_PASSWORD_FILE="$(mktemp "${TMPDIR:-/tmp}/beri-segodnya-key-pass.XXXXXX")"
cp "${PILOT_KEYSTORE_PASSWORD_FILE}" "${KEY_PASSWORD_FILE}"
chmod 0600 "${KEY_PASSWORD_FILE}"
"${BUILD_TOOLS_DIR}/apksigner" sign \
  --ks "${PILOT_KEYSTORE}" \
  --ks-key-alias "${PILOT_KEY_ALIAS}" \
  --ks-pass "file:${PILOT_KEYSTORE_PASSWORD_FILE}" \
  --key-pass "file:${KEY_PASSWORD_FILE}" \
  --out "${SIGNED_APK}" \
  "${ALIGNED_APK}"

"${BUILD_TOOLS_DIR}/zipalign" -c -v 4 "${SIGNED_APK}" >/dev/null
signature_info="$("${BUILD_TOOLS_DIR}/apksigner" verify --verbose --print-certs "${SIGNED_APK}")" \
  || fail "APK signature verification failed"
actual_fingerprint="$(printf '%s\n' "${signature_info}" | awk -F': ' '/certificate SHA-256 digest:/{print $2; exit}')"
[[ -n "${actual_fingerprint}" ]] || fail "Unable to read the signed APK certificate fingerprint"
[[ "$(canonical_fingerprint "${actual_fingerprint}")" == "$(canonical_fingerprint "${expected_fingerprint}")" ]] \
  || fail "Signed APK certificate does not match the release keystore and Digital Asset Links"

badging="$("${BUILD_TOOLS_DIR}/aapt2" dump badging "${SIGNED_APK}")" || fail "Unable to inspect the signed APK manifest"
grep -Fq "package: name='${PILOT_PACKAGE_ID}' versionCode='${PILOT_VERSION_CODE}' versionName='${PILOT_VERSION_NAME}'" <<<"${badging}" \
  || fail "Signed APK package or version is incorrect"
grep -Fq "minSdkVersion:'23'" <<<"${badging}" || fail "Signed APK minSdk is incorrect"
grep -Fq "targetSdkVersion:'36'" <<<"${badging}" || fail "Signed APK targetSdk is incorrect"
grep -Fq "launchable-activity: name='${PILOT_PACKAGE_ID}.LauncherActivity'" <<<"${badging}" \
  || fail "Signed APK launcher activity is incorrect"

(
  cd "${SCRIPT_DIR}"
  shasum -a 256 "$(basename "${SIGNED_APK}")" > "$(basename "${SIGNED_APK}").sha256"
  shasum -a 256 -c "$(basename "${SIGNED_APK}").sha256" >/dev/null
)
chmod 0600 "${SIGNED_APK}" "${SIGNED_APK}.sha256"

printf 'Pilot APK verified: package=%s version=%s (%s)\n' "${PILOT_PACKAGE_ID}" "${PILOT_VERSION_NAME}" "${PILOT_VERSION_CODE}"
printf 'Pilot APK: %s\n' "${SIGNED_APK}"
printf 'SHA-256 file: %s\n' "${SIGNED_APK}.sha256"
