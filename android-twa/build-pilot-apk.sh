#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to an installed Android SDK}"
JAVA_HOME="${JAVA_HOME:?Set JAVA_HOME to JDK 17}"
PILOT_KEYSTORE="${PILOT_KEYSTORE:?Set PILOT_KEYSTORE to the private JKS file}"
PILOT_KEYSTORE_PASSWORD_FILE="${PILOT_KEYSTORE_PASSWORD_FILE:?Set PILOT_KEYSTORE_PASSWORD_FILE to a chmod 600 password file}"
PILOT_KEY_ALIAS="${PILOT_KEY_ALIAS:-beri-segodnya-pilot}"
ANDROID_BUILD_TOOLS_VERSION="${ANDROID_BUILD_TOOLS_VERSION:-36.1.0}"
BUILD_TOOLS_DIR="${ANDROID_SDK_ROOT}/build-tools/${ANDROID_BUILD_TOOLS_VERSION}"
UNSIGNED_APK="${SCRIPT_DIR}/app/build/outputs/apk/release/app-release-unsigned.apk"
ALIGNED_APK="${SCRIPT_DIR}/app-release-aligned.apk"
SIGNED_APK="${SCRIPT_DIR}/app-release-signed.apk"

for required_file in "${PILOT_KEYSTORE}" "${PILOT_KEYSTORE_PASSWORD_FILE}"; do
  if [[ ! -f "${required_file}" ]]; then
    echo "Required private file is missing: ${required_file}" >&2
    exit 1
  fi
done

for required_tool in zipalign apksigner; do
  if [[ ! -x "${BUILD_TOOLS_DIR}/${required_tool}" ]]; then
    echo "Android build tool is missing: ${BUILD_TOOLS_DIR}/${required_tool}" >&2
    exit 1
  fi
done

export ANDROID_HOME="${ANDROID_SDK_ROOT}"
export ANDROID_SDK_ROOT
export JAVA_HOME

cd "${SCRIPT_DIR}"
./gradlew --no-daemon clean assembleRelease

"${BUILD_TOOLS_DIR}/zipalign" -f 4 "${UNSIGNED_APK}" "${ALIGNED_APK}"
"${BUILD_TOOLS_DIR}/apksigner" sign \
  --ks "${PILOT_KEYSTORE}" \
  --ks-key-alias "${PILOT_KEY_ALIAS}" \
  --ks-pass "file:${PILOT_KEYSTORE_PASSWORD_FILE}" \
  --key-pass "file:${PILOT_KEYSTORE_PASSWORD_FILE}" \
  --out "${SIGNED_APK}" \
  "${ALIGNED_APK}"

"${BUILD_TOOLS_DIR}/zipalign" -c -v 4 "${SIGNED_APK}" >/dev/null
"${BUILD_TOOLS_DIR}/apksigner" verify --verbose --print-certs "${SIGNED_APK}"
shasum -a 256 "${SIGNED_APK}" > "${SIGNED_APK}.sha256"
echo "Pilot APK: ${SIGNED_APK}"
echo "SHA-256 file: ${SIGNED_APK}.sha256"
