<div align="center">

# <img width="192" height="192" alt="android-chrome-192x192" src="https://github.com/user-attachments/assets/e8767ecb-47dc-43b6-a241-ef616d248eab" />

Erumi — Anime Streaming Platform

**A modern, self-hosted anime streaming suite powered by the Yorumi CLI engine.**

*Search → Select → Stream — right from your desktop or any device on your Wi-Fi.*

</div>


## 🌐 Web Interface

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/6b3d487d-7c9c-4731-af4a-dc4197af59aa" alt="Web Interface - Home" width="500"></td>
    <td><img src="https://github.com/user-attachments/assets/1dd38fa6-82b3-4ae1-a7f7-55ae42c85fcd" alt="Web Interface - Browse" width="500"></td>
    <td><img src="https://github.com/user-attachments/assets/c5da53ad-4dcd-4c56-810c-6da377bd9e2e" alt="Web Interface - Player" width="500"></td>
  </tr>
</table>

## 📱 Android Interface

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/febf6bcc-013f-4da9-8f59-85e730b4b501" alt="Android Interface - Home" width="250"></td>
    <td><img src="https://github.com/user-attachments/assets/fda421c7-cd9a-4ab4-8c33-c6e1e3246fa5" alt="Android Interface - Browse" width="250"></td>
    <td><img src="https://github.com/user-attachments/assets/d1808b17-1ebc-4875-8539-0e52ac9438ad" alt="Android Interface - Player" width="250"></td>
    <td><img src="https://github.com/user-attachments/assets/bfed7640-e5a1-42c5-8e84-7d6043768cf7" alt="Android Interface - Episodes" width="250"></td>
  </tr>
</table>
---

## 📖 What is Erumi?

**Erumi** is a full-featured, self-hosted anime streaming platform that runs entirely on your Windows PC. It wraps the open-source **Yorumi CLI** anime engine in two polished interfaces:

| Mode | What it does |
|---|---|
| 🖥️ **Desktop GUI** (`Erumi.exe`) | A native Windows dark-theme app. Search anime → pick an episode → plays in **mpv**. |
| 🌐 **Web Streaming Server** (`ErumiServer.exe`) | A  local web server. Stream in your **browser** or on any phone/tablet on the same Wi-Fi. |

**No account. No subscription. No ads. Just anime.**

---

## ✨ Features

- 🔍 **Search, Latest & Popular** anime browsing via Yorumi CLI
- 🎬 **Cinema-style web player** with HLS.js for smooth in-browser streaming
- 📡 **LAN Wi-Fi streaming** — share to phones, tablets, and smart TVs with a QR code
- 🖼️ **High-res anime covers** pulled from AniList, TMDB, and Jikan APIs
- ⭐ **Community ratings** via AniList
- 🔄 **Auto next episode** and quality selection (1080p / 720p / auto)
- 📱 **PWA support** — install the web app to your Android home screen (no APK needed!)
- 📦 **Android APK** via Capacitor (for advanced users — see [android_setup_guide.md](android_setup_guide.md))
- 💾 **Built-in caching** for fast repeat searches
- 🔒 **SSRF-protected** HLS proxy for safe local streaming
- 🪟 **Zero terminal required** — double-click `.exe` to launch

---

## 🗂️ Project Structure

```
yorumi anime streaming/
│
├── 📄 main.py               # Desktop GUI app (Erumi.exe source)
├── 📄 web_server.py         # HTTP server + HLS proxy + Yorumi CLI API
├── 📄 server_app.py         # Standalone server desktop controller (ErumiServer.exe source)
│
├── 📁 web/                  # Web frontend (HTML/CSS/JS) — served by web_server.py
│   ├── index.html           # Main SPA — browse, search, player
│   ├── style.css            # Full dark-theme stylesheet
│   ├── app.js               # Frontend JS — all app logic
│   ├── sw.js                # Service Worker (PWA offline support)
│   ├── hls.min.js           # Bundled HLS.js (works offline/APK)
│   ├── feather.min.js       # Bundled icon library
│   ├── offline.html         # Shown when offline
│   ├── erumi.png            # Erumi mascot image
│   └── site.webmanifest     # PWA manifest
│
├── 📁 web-loader/           # Android APK loader page (Capacitor entry point)
│   └── index.html           # QR code scanner + server connect screen
│
├── 📁 favicon/              # App icons (favicon.ico, PNG variants, mascot)
│
├── 📁 yorumi-cli-main/      # Bundled Yorumi CLI (Node.js)
│   └── bin/
│       └── yorumi-cli.cjs   # Main CLI entry (run with Node.js)
│
├── 📄 yorumi-cli.cmd        # Windows launcher for yorumi-cli.cjs
├── 📄 erumi_config.json     # User config (port, quality, cache TTL, etc.)
├── 📄 requirements.txt      # Python dependencies
├── 📄 package.json          # Node/Capacitor dependencies (Android APK only)
├── 📄 capacitor.config.json # Capacitor Android build config
│
├── 📄 build.bat             # Build Erumi.exe (Desktop GUI)
├── 📄 build.spec            # PyInstaller spec for Desktop GUI
├── 📄 build_server.bat      # Build ErumiServer.exe (Web Server)
├── 📄 build_server.spec     # PyInstaller spec for Web Server
└── 📄 start_web.bat         # Start the web server without building an .exe
```

---

## 🛠️ Requirements

### Required — Always

| Tool | Version | Why | Download |
|---|---|---|---|
| **Python** | 3.10+ | Runs `main.py`, `web_server.py`, `server_app.py` | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 18+ | Runs the Yorumi CLI engine (`yorumi-cli.cjs`) | [nodejs.org](https://nodejs.org/) |

> **Important:** When installing Python on Windows, **check "Add Python to PATH"** during setup.

### Required — Python Packages

Install with one command:
```bash
pip install -r requirements.txt
```

| Package | Purpose |
|---|---|
| `customtkinter >= 5.2.0` | Modern dark-theme GUI widgets |
| `Pillow >= 10.0.0` | Image handling (mascot, icons) |
| `pyinstaller >= 6.0.0` | Build `.exe` files (only needed if building) |
| `pywin32 >= 306` | Windows-specific subprocess flags |

### Optional — For Android APK Only

| Tool | Why |
|---|---|
| **Android Studio** (latest) | Build and sign the APK |
| **Java JDK 17+** | Bundled with Android Studio |

See [`android_setup_guide.md`](android_setup_guide.md) for the full APK build walkthrough.

---

## 🚀 Getting Started

### Step 1 — Clone or Download the Project

```bash
git clone https://github.com/YOUR_USERNAME/yorumi-anime-streaming.git
cd yorumi-anime-streaming
```

Or click **Download ZIP** on GitHub and extract it.

### Step 2 — Install Python Dependencies

```bash
pip install -r requirements.txt
```

### Step 3 — Choose How to Run (see below)

---

## ▶️ How to Use

### 🌐 Mode 1: Web Streaming Server *(Recommended)*

The easiest way to watch anime on **any device** — PC, phone, tablet, or smart TV.

**Option A — Batch file (quickest):**
```
Double-click start_web.bat
```

**Option B — Python:**
```bash
python server_app.py
```

**Option C — Built executable:**
```
Double-click dist\ErumiServer.exe
```

Once running:
1. Your browser opens automatically at **http://localhost:3000**
2. To watch on your **phone or tablet**, click **"Copy Wi-Fi Link"** in the server window and open it on your device *(both must be on the same Wi-Fi)*
3. The web app shows a scannable QR code for quick phone access

---

### 🖥️ Mode 2: Desktop GUI *(plays in mpv)*

A native Windows app that searches anime and plays episodes directly in **mpv**.

> **Note:** [mpv](https://mpv.io/) must be installed for playback in this mode.

**Run:**
```bash
python main.py
```
Or double-click `dist\Erumi.exe` (after building).

**How to use:**
1. Type an anime title → press **Enter** or click **Search**
2. Click the result number to select it
3. Pick an episode — it streams in mpv automatically
4. Use **Latest**, **Popular**, **Help**, **Version** for quick browsing
5. Click **CLI Path** (sidebar) → browse to `yorumi-cli.cmd` if the CLI is not found automatically

---

### 📦 Mode 3: Build Standalone `.exe` Files

Build a single `.exe` to share with friends who don't have Python installed.

**Build the Web Server:**
```bash
build_server.bat
# Output: dist\ErumiServer.exe
```

**Build the Desktop GUI:**
```bash
build.bat
# Output: dist\Erumi.exe
```

> **After building**, copy these alongside the `.exe`:
> - `yorumi-cli.cmd`
> - The entire `yorumi-cli-main/` folder
> - `erumi_config.json`
> - `favicon/` folder
> - `web/` folder (only needed for ErumiServer)

---

## ⚙️ Configuration

Edit `erumi_config.json` to customize:

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
    "episodes_ttl_seconds": 600,
    "metadata_ttl_seconds": 43200
  }
}
```

| Option | Values | Description |
|---|---|---|
| `port` | any number | Port the server listens on (default: 3000) |
| `preferred_quality` | `1080p`, `720p`, `auto` | Default streaming quality |
| `default_mode` | `sub`, `dub` | Subtitled or dubbed by default |
| `auto_next_episode` | `true`/`false` | Auto-play next episode |
| `cache.enabled` | `true`/`false` | Cache search results for faster loading |

---

## 🔧 Troubleshooting

**"CLI not found" on startup**
- Make sure `yorumi-cli.cmd` is in the same folder as `main.py`
- Click **CLI Path** in the sidebar and browse to `yorumi-cli.cmd`
- Check Node.js is installed: run `node --version` in a terminal

**Port 3000 already in use**
- Change the port in `erumi_config.json` → `"port": 3001`
- Or close whatever else is using port 3000

**Video not playing in browser**
- Use `http://localhost:3000` — not `https://`
- Chrome or Edge recommended

**Phone/tablet can't connect**
- Both devices must be on the **same Wi-Fi network**
- Temporarily disable Windows Firewall if blocked
- Use the LAN IP shown in the server window (e.g., `http://192.168.1.5:3000`)

**Build errors**
```bash
pip install -r requirements.txt
pip install pyinstaller --upgrade
```

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Desktop GUI | Python · CustomTkinter · Pillow |
| Web Frontend | Vanilla HTML/CSS/JS · HLS.js · Feather Icons |
| Web Server / API | Python `http.server` · `socketserver` · Threading |
| CLI Engine | Node.js · Yorumi CLI (`.cjs` bundle) |
| Android APK | Capacitor 7 · Android Gradle |
| Build / Packaging | PyInstaller |
| PWA | Service Worker (`sw.js`) · Web App Manifest |

---

## 📜 License

MIT — see [`yorumi-cli-main/LICENSE`](yorumi-cli-main/LICENSE)

---

<div align="center">
Created by <strong>Jhudel</strong> · Powered by Yorumi CLI
</div>
