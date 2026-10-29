<div align="center">

# 🌌 Erumi Stream — Anime Streaming Platform

**A modern, self-hosted anime streaming suite with full multi-season franchise support.**

*Search ➔ Select ➔ Stream in 1080p — right from your desktop, browser, or Android app on your Wi-Fi.*

---

[![Version](https://img.shields.io/badge/version-2.8.2-teal.svg?style=for-the-badge)](https://github.com/jhudel26/Erumi)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web%20%7C%20Android%20%7C%20LAN%20%7C%20PWA-0d9488.svg?style=for-the-badge)](https://github.com/jhudel26/Erumi)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)](https://github.com/jhudel26/Erumi/blob/main/LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/standalone-No%20Node%20Required-blueviolet.svg?style=for-the-badge)]()

</div>

---

## 🎬 What is Erumi?

**Erumi** is a clean, feature-rich anime streaming application that pairs a high-performance Python streaming backend and HLS reverse proxy with a cinema-style dark UI web application and native Android support.

| Deployment / Target | Description | Primary Use Case |
|---|---|---|
| 🌐 **Web Server & LAN Hub** | Run `python web_server.py` on your PC. Streams to any browser on your local network. | Desktop, laptops, home entertainment. |
| 📱 **Android App (Capacitor)** | Native Android build with fullscreen landscape auto-rotation and portrait lock. | Mobile phones and tablets. |
| 🖥️ **Desktop Controller** | Run `server_app.py` or `main.py` with MPV native player support. | Local playback on desktop PC. |

**No accounts. No subscriptions. No ads. Just anime in 1080p.**

---

## ✨ Key Features

- ⚡ **Multi-Tier Native Stream Resolvers**:
  - **HiAnime Engine** (`hianime.to`): Direct episode resolution with multi-server and Sub/Dub streams.
  - **AniDB Engine** (`anidb.app`): High-bitrate adaptive 1080p HLS stream extraction.
  - **AniNeko Engine** (`anineko.to`): Intelligent TV series prioritization over recaps/OVAs.
- 🔁 **Full Multi-Season & Franchise Switcher**:
  - Automatically captures and links **all seasons, cours, sequels, prequels, and movies** using a high-speed AniList GraphQL batch resolver.
  - Responsive dropdown with complete title visibility on mobile and desktop.
  - Filtered to canonical seasons (`TV`, `TV_SHORT`, `ONA`, `MOVIE`, `SPECIAL`).
- 📱 **Mobile & Android Optimized**:
  - **Clean 2-Row Drawer Header**: Full-width season dropdown that never gets cut off or truncated on narrow mobile screens.
  - **Smart Fullscreen Rotation**: Locked in portrait for browsing; automatically rotates to landscape only when entering video player fullscreen.
- 🎛️ **Player Controls & Polish**:
  - **Sub / Dub Quick Toggle Pill**: One-click audio switching without losing playback position.
  - **Playback Speed Selector**: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x controls.
  - **Smart Skip Intro**: 85-second intelligent skip button.
  - **Per-Episode Watch Progress Bars**: Remembers exact watch progress and resume points.
  - **In-Player Error Recovery Overlay**: In-place reload/retry without leaving the video player.
- 🏷️ **Dynamic Genre Filter Chips**:
  - 13 curated genres (Action, Romance, Fantasy, Comedy, Sci-Fi, Slice of Life, etc.).
- 🛡️ **Built-in HLS Reverse Proxy**:
  - Bypasses CORS and ISP video stream blocks.
  - Transparently handles encrypted `#EXT-X-KEY` and initialization segments.
  - Automatically strips disguised PNG headers (`\x89PNG...`) on-the-fly.

---

## 📂 Project Structure

```
Erumi/
├── web_server.py                # Python HTTP Server, HLS Proxy & Scraping Engine (v2.8.2)
├── server_app.py                # Desktop GUI Server Launcher
├── main.py                      # Desktop app with native MPV player integration
├── start_web.bat                # 1-Click launcher script for Windows
├── erumi_config.json            # Configuration file
├── requirements.txt             # Python dependencies
│
├── web/                         # Frontend Single Page Application
│   ├── index.html               # Main cinema browsing & streaming UI
│   ├── style.css                # Responsive glassmorphic dark theme
│   ├── app.js                   # Frontend controller (v2.8.2)
│   ├── sw.js                    # PWA Service Worker
│   ├── hls.min.js               # Bundled HLS.js player
│   └── feather.min.js           # Feather icons library
│
├── android/                     # Capacitor Native Android project
│   ├── app/src/main/            # Android source & AndroidManifest.xml
│   └── build.gradle             # Android build configuration
│
├── favicon/                     # Logos, posters, and app icons
└── README.md                    # Documentation
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Python 3.10+** installed (ensure *"Add Python to PATH"* is checked)
- A modern web browser (Chrome, Edge, Firefox, Brave, Safari)

### 2. Setup & Installation
```bash
# Clone the repository
git clone https://github.com/jhudel26/Erumi.git
cd Erumi

# Install dependencies
pip install -r requirements.txt
```

### 3. Run the Server
```bash
python web_server.py
```
*Or double-click `start_web.bat` on Windows.*

The server will start on port `3000`:
- **Local Browser:** `http://localhost:3000`
- **Phone / Tablet / Smart TV (Same Wi-Fi):** `http://<YOUR_LOCAL_IP>:3000`

---

## 📱 Building the Android APK

The mobile app is built using **Capacitor**:

```bash
# Install dependencies
npm install

# Sync web assets to Android
npx cap sync android

# Open in Android Studio to build APK
npx cap open android
```

---

## ⚙️ Configuration (`erumi_config.json`)

```json
{
  "server": {
    "port": 3000,
    "auto_launch_browser": true,
    "bind_all_interfaces": true
  },
  "playback": {
    "preferred_quality": "1080p",
    "auto_next_episode": true,
    "default_mode": "sub"
  },
  "cache": {
    "enabled": true,
    "search_ttl_seconds": 3600,
    "episodes_ttl_seconds": 300,
    "metadata_ttl_seconds": 86400
  }
}
```

---

## 🛠️ Diagnostics & Health Check

- **Server Status & Version:** `http://localhost:3000/api/status`
- **Stream Diagnostic Probe:** `http://localhost:3000/api/debug-stream?query=Solo+Leveling&episode=1`

---

## 📄 License & Disclaimer

- Distributed under the **MIT License**.
- **Educational Disclaimer**: This project does not host or store copyrighted media files. All streams are resolved dynamically in real-time from publicly available web sources.

---

<div align="center">
Built with ❤️ by <strong>Jhudel</strong> • Erumi Stream v2.8.2
</div>
