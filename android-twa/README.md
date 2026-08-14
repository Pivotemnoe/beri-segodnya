# Android pilot package

This directory contains a Trusted Web Activity wrapper for the production PWA at
`https://berisegodnya.ru`. The package ID is `ru.berisegodnya.app`.

The private signing key and its password must never be committed. The public SHA-256
certificate fingerprint is published in `public/.well-known/assetlinks.json` so Chrome
can verify the relationship between the Android package and the production origin.

## Build a signed pilot APK

Install Android SDK Platform 36 and Build Tools 36.1.0, use JDK 17, then provide the
private inputs through environment variables:

```bash
export ANDROID_SDK_ROOT=/absolute/path/to/android-sdk
export JAVA_HOME=/absolute/path/to/jdk-17/Contents/Home
export PILOT_KEYSTORE=/absolute/path/to/beri-segodnya-pilot.jks
export PILOT_KEYSTORE_PASSWORD_FILE=/absolute/path/to/keystore-password.txt
export PILOT_KEY_ALIAS=beri-segodnya-pilot
./build-pilot-apk.sh
```

The script produces ignored local files `app-release-signed.apk` and
`app-release-signed.apk.sha256`, verifies alignment and signature, and never prints the
password.

## Install on a connected Android device

```bash
adb install -r app-release-signed.apk
adb shell am start -n ru.berisegodnya.app/.LauncherActivity
```

Trusted full-screen mode requires the production site to serve the matching Digital
Asset Links file over HTTPS. Until that verification succeeds, Chrome intentionally
opens a Custom Tab instead.
