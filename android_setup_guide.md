# 📱 Erumi Android APK Build Guide

This guide walks you through generating an Android APK from the Erumi web application using **Capacitor**.

---

## Prerequisites

| Tool | Version | Install Link |
|------|---------|-------------|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **Android Studio** | Latest | [developer.android.com](https://developer.android.com/studio) |
| **Java JDK** | 17+ | Bundled with Android Studio |

> [!IMPORTANT]
> Android Studio must have the **Android SDK** (API 34+) and **Build Tools** installed via SDK Manager.

---

## Step 1: Install Dependencies

```bash
cd "d:\JHUDEL PROJECTS\yorumi anime streaming"
npm install
```

This installs `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, and related plugins.

---

## Step 2: Initialize Capacitor (First Time Only)

```bash
npx cap init Erumi com.erumi.animestreaming --web-dir web
```

> This creates internal Capacitor config. Only needed once.

---

## Step 3: Add Android Platform

```bash
npx cap add android
```

This generates the full `android/` project directory with Gradle build files.

---

## Step 4: Sync Web Assets to Android

Every time you update the web UI (`web/` folder), sync it:

```bash
npx cap sync android
```

---

## Step 5: Open in Android Studio

```bash
npx cap open android
```

This opens the `android/` project in Android Studio where you can:
- Run on an emulator or physical device
- Build debug/release APKs
- Sign the APK for distribution

---

## Step 6: Build APK from Command Line (Optional)

### Debug APK
```bash
cd android
.\gradlew assembleDebug
```
Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (Signed)
```bash
cd android
.\gradlew assembleRelease
```

> [!NOTE]
> For release builds, you need a signing keystore. Generate one with:
> ```bash
> keytool -genkey -v -keystore release.keystore -alias erumi -keyalg RSA -keysize 2048 -validity 10000
> ```
> Then configure `android/app/build.gradle` with the keystore path and credentials.

---

## Step 7: Install on Device

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or drag-and-drop the `.apk` file onto your Android device.

---

## Important Notes

- **Server Connection**: The Android APK wraps the web UI. For streaming to work, `ErumiServer.exe` must be running on a PC on the same Wi-Fi network. The app connects via the LAN IP (e.g., `http://192.168.0.16:3000`).
- **PWA Alternative**: Users can also "Add to Home Screen" from Chrome/Edge on Android without building an APK. The Service Worker (`sw.js`) enables this.
- **TWA (Trusted Web Activity)**: For a production Play Store listing, consider converting to a TWA using [Bubblewrap](https://github.com/nicolo-ribaudo/nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo--nicolo-nicolo--nicolo--nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo-nicolo--nicolo-nicolo) or [PWABuilder](https://www.pwabuilder.com/).

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm install` | Install Capacitor dependencies |
| `npx cap add android` | Generate Android project |
| `npx cap sync android` | Sync web files → Android |
| `npx cap open android` | Open in Android Studio |
| `.\gradlew assembleDebug` | Build debug APK |
