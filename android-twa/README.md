# Android pilot package

This directory contains a Trusted Web Activity wrapper for the production PWA at
`https://berisegodnya.ru`. The package ID is `ru.berisegodnya.app`.

The private signing key and its password must never be committed. The public SHA-256
certificate fingerprint is published in `public/.well-known/assetlinks.json` so Chrome
can verify the relationship between the Android package and the production origin.

The project pins Android Gradle Plugin 9.3.1, the official Gradle 9.5.0 wrapper JAR
and distribution with published SHA-256 checksums, and every resolved Gradle
configuration. It also verifies downloaded artifacts by SHA-256, uses Android Browser
Helper 2.7.3, runs release lint, R8 and resource shrinking, and keeps GitHub Actions on
immutable commit SHAs.
`npm run test:android-config` verifies those source and supply-chain contracts without
requiring the Android SDK. `npm run test:android-vulnerabilities` submits only the 53
public release dependency coordinates and versions to the OSV batch API and fails on a
known vulnerability; it never submits source code, signing material or user data.
`npm run audit:android-build-vulnerabilities` separately inventories the broader AGP,
lint and device-test toolchain. Findings there do not ship in the APK, but they remain
an explicit upstream-update and CI-isolation review trigger rather than being hidden by
an allowlist.

## Signing preflight without Android SDK installation

Use JDK 17 and the private signing inputs to verify file permissions, the alias,
certificate fingerprint, Digital Asset Links and Gradle checksums. This command does
not install SDK packages, build an APK or accept an Android license:

```bash
export ANDROID_SDK_ROOT=/path/reserved/for/android-sdk
export JAVA_HOME=/absolute/path/to/jdk-17/Contents/Home
export PILOT_KEYSTORE=/absolute/path/to/beri-segodnya-pilot.jks
export PILOT_KEYSTORE_PASSWORD_FILE=/absolute/path/to/keystore-password.txt
export PILOT_KEY_ALIAS=beri-segodnya-pilot
PILOT_PREFLIGHT_ONLY=true ./build-pilot-apk.sh
```

## Build a signed pilot APK

After the responsible person has read and explicitly accepted the Android SDK license,
install Android SDK Platform 36 and Build Tools 36.1.0. Use JDK 17 and provide the
private inputs through environment variables:

```bash
export ANDROID_SDK_ROOT=/absolute/path/to/android-sdk
export JAVA_HOME=/absolute/path/to/jdk-17/Contents/Home
export PILOT_KEYSTORE=/absolute/path/to/beri-segodnya-pilot.jks
export PILOT_KEYSTORE_PASSWORD_FILE=/absolute/path/to/keystore-password.txt
export PILOT_KEY_ALIAS=beri-segodnya-pilot
./build-pilot-apk.sh
```

The script runs release lint, R8 and resource shrinking; validates private-file modes,
the Gradle supply chain and the signing certificate; builds and signs the APK; checks
alignment, signature, package ID, version, min/target SDK and launcher activity; then
produces ignored mode-`0600` files `app-release-signed.apk` and
`app-release-signed.apk.sha256`. The checksum contains only the APK filename and the
script never prints the password.

## Install on a connected Android device

```bash
adb install -r app-release-signed.apk
adb shell am start -n ru.berisegodnya.app/.LauncherActivity
```

Use a UI-tree-derived target for every automated tap. Capture launch/back/resume,
offline and update behavior, a screenshot and the app-specific logcat/crash buffer.
An APK is not accepted merely because Gradle produced a file.

Trusted full-screen mode requires the production site to serve the matching Digital
Asset Links file over HTTPS. Until that verification succeeds, Chrome intentionally
opens a Custom Tab instead.
