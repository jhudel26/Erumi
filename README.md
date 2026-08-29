<div align="center">

# <img width="192" height="192" alt="android-chrome-192x192" src="https://github.com/user-attachments/assets/962f1f46-a988-4021-9fa0-f41ad07a13e6" />

 Erumi Stream — Anime Streaming Platform

**A modern, zero-dependency, self-hosted anime streaming suite.**

*Search → Select → Stream in 1080p — right from your desktop, browser, or any device on your Wi-Fi.*

---

[![Version](https://img.shields.io/badge/version-2.7.0-blue.svg?style=for-the-badge)](https://github.com/davenarchives/Yorumi)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Web%20%7C%20LAN%20%7C%20PWA-teal.svg?style=for-the-badge)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=for-the-badge)]()
[![No Dependencies](https://img.shields.io/badge/standalone-No%20Python%20%2F%20Node%20Needed-purple.svg?style=for-the-badge)]()

</div>

---

## 📖 What is Erumi?

**Erumi** is a full-featured anime streaming platform with a native desktop controller, an embedded high-performance HLS proxy server, and a responsive cinema-style web application.

It operates in **100% Standalone Mode** without requiring Python, Node.js, or external CLI installations on the client's machine.

| Distribution Mode | How it Works | Primary Use Case |
|---|---|---|
| 📦 **Windows Setup Installer** (`ErumiStream_Setup_v2.7.0.exe`) | Standard Windows installation wizard with desktop shortcut, Start Menu entry, and auto-start option. | General users & friends. |
| 🗜️ **Portable Archive** (`ErumiStream_Portable_Windows.zip`) | Zero-install portable folder. Extract and double-click `ErumiServer.exe`. | Flash drives, VMs, clean Windows PCs. |
| 🌐 **LAN & PWA Web Server** | Host locally on port 3000 and stream to phones, tablets, Smart TVs, and Android devices. | Home media & multi-device streaming. |

**No accounts. No subscriptions. No ads. Just anime in 1080p.**

---

🖼️ Screenshots  Desktop & Web Interface  
<table>   
<tr>     
<td align="center">       
<img width="1641" height="881" alt="Screenshot 2026-08-29 124810" src="https://github.com/user-attachments/assets/35e9e6cc-2821-474a-9434-f32b6316d174" />
</td>     
 <td align="center">       
  <img width="1450" height="906" alt="Screenshot 2026-08-29 124829" src="https://github.com/user-attachments/assets/1f28c118-9ad0-46c4-b249-39b62a0460fa" />
 </td>
 <td align="center">
<img width="1584" height="982" alt="Screenshot 2026-08-29 132125" src="https://github.com/user-attachments/assets/436ecfa7-9031-4520-99a6-b4ce32def3d3" />
 </td>   
</tr>   
 <tr>     
 <td align="center">
 <strong>Home / Browse</strong></td>     
 <td align="center"><strong>Anime Details</strong></td>    
  <td align="center"><strong>Video Player</strong></td>   
 </tr> 
</table>  More Screenshots  <table>   <tr>     
 <td align="center">      
  <img src="https://placehold.co/600x340?text=Screenshot+4" alt="Erumi Stream Screenshot 4" width="100%">    
 </td>     
 <td align="center">       
  <img src="https://placehold.co/600x340?text=Screenshot+5" alt="Erumi Stream Screenshot 5" width="100%">     
 </td>    
 <td align="center">     
  <img src="https://placehold.co/600x340?text=Screenshot+6" alt="Erumi Stream Screenshot 6" width="100%">     
 </td>   </tr>   <tr>    
  <td align="center"><strong>Search</strong></td>     
  <td align="center"><strong>Settings</strong></td>    
  <td align="center"><strong>Mobile / PWA</strong></td>   </tr> </table>


## ✨ Key Features

- ⚡ **Multi-Tier Native Stream Resolvers**:
  - **AniDB Engine** (`anidb.app`): Primary high-bitrate adaptive 1080p HLS stream extractor.
  - **AniNeko Engine** (`anineko.to` / `vivibebe.site`): Intelligent TV series prioritization over recaps/OVAs.
  - **AllAnime GraphQL**: Fallback episode indexer and multi-server resolver.
- 🎬 **Cinema Web Player**: Custom HTML5 player powered by **Hls.js** with subtitle toggling (`Sub`/`Dub`), auto-quality switching, auto-next episode, and theater mode.
- 📡 **LAN Wi-Fi Streaming & QR Code**: Share your stream across your home Wi-Fi. Scan the QR code with your phone or tablet to start watching instantly.
- 🖼️ **Rich Metadata & Banners**: High-resolution banners, posters, studios, release schedules, and community scores pulled via **AniList GraphQL API**.
- 🛡️ **Built-in HLS Reverse Proxy**:
  - Automatically bypasses CORS and ISP stream throttling.
  - Resolves encrypted `#EXT-X-KEY` and `#EXT-X-MAP` initialization segments.
  - Strips disguised PNG headers (`\x89PNG...`) on-the-fly for players.
  - Sandboxed SSL context support for clean Windows VMs.
- 📱 **PWA & Android Support**: Install directly as a Progressive Web App (PWA) to your home screen or build as an APK via Capacitor.

---

## 🗂️ Project Structure

```
Erumi anime streaming/
│
├── 📄 main.py                      # Desktop GUI app (plays directly in mpv)
├── 📄 web_server.py                # Standalone HTTP Server, HLS Proxy, and Native Scraping Engine
├── 📄 server_app.py                # CustomTkinter GUI Server Launcher (ErumiServer.exe source)
│
├── 📁 web/                         # Web frontend (SPA served by web_server.py)
│   ├── index.html                  # Main cinema browsing & streaming UI
│   ├── style.css                   # Glassmorphic dark-theme stylesheet
│   ├── app.js                      # Core frontend application logic (v2.7.0)
│   ├── sw.js                       # PWA Service Worker (API cache-bypassing)
│   ├── hls.min.js                  # Bundled Hls.js library
│   ├── feather.min.js              # Bundled icon library
│   ├── offline.html                # Offline status page
│   └── site.webmanifest            # PWA manifest configuration
│
├── 📁 favicon/                     # Icons, logos, and mascot assets
├── 📁 installer_output/            # Compiled Inno Setup installer (.exe)
│
├── 📄 erumi_installer.iss          # Inno Setup 6 compiler script
├── 📄 build_installer.bat          # 1-Click build script for Inno Setup installer
├── 📄 build_server.bat             # PyInstaller script for ErumiServer.exe
├── 📄 build.bat                    # PyInstaller script for Erumi.exe (mpv GUI)
├── 📄 start_web.bat                # Direct Python runner (development mode)
├── 📄 erumi_config.json            # Server & playback configuration
└── 📄 requirements.txt             # Python dependencies (for developers)
```

---

## 🚀 Quick Start (For End Users)

### Using the Windows Installer *(Recommended)*
1. Download **`ErumiStream_Setup_v2.7.0.exe`** from the `installer_output/` folder.
2. Run the installer and complete the setup wizard.
3. Launch **Erumi Stream** from your Desktop or Start Menu.
4. Your browser will automatically open to `http://localhost:3000`.

---

## 🛠️ Developer Setup & Building from Source

### Prerequisites
- **Python 3.10+** (Check *"Add Python to PATH"* during installation)
- **Inno Setup 6** (Optional &mdash; only needed for compiling the installer)

### 1. Install Dependencies
```bash
git clone https://github.com/YOUR_USERNAME/yorumi-anime-streaming.git
cd "yorumi anime streaming"
pip install -r requirements.txt
```

### 2. Run Development Server
```bash
python server_app.py
```
*Or simply double-click `start_web.bat`.*

### 3. Build Standalone Binaries & Installer
- **Build Server Executable (`dist/ErumiServer.exe`)**:
  ```bash
  build_server.bat
  ```
- **Build Full Inno Setup Installer (`installer_output/ErumiStream_Setup_v2.7.0.exe`)**:
  ```bash
  build_installer.bat
  ```

---

## ⚙️ Configuration (`erumi_config.json`)

The server configuration can be customized in `erumi_config.json` or via the in-app **Settings** modal:

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

---

## 🔍 Built-In Diagnostics

If you encounter any streaming or network issues on a restricted network or VM:
- Navigate to: **`http://localhost:3000/api/debug-stream?query=Solo+Leveling&episode=1`**
- The server will perform a live diagnostic check on provider resolution, HLS headers, and proxy status.

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| **Server Engine** | Python 3 · `ThreadingHTTPServer` · Multi-source Scraper Pipeline |
| **Frontend UI** | Modern Vanilla JavaScript · HTML5 Canvas · Feather Icons |
| **Video Engine** | HLS.js (Adaptive Bitrate Streaming) · Custom Native Proxy |
| **Metadata** | AniList GraphQL API |
| **Desktop Shell** | CustomTkinter · Tkinter · DarkDetect |
| **Packaging & Installer**| PyInstaller · Inno Setup 6 (LZMA2 Ultra Compression) |

---

## 📜 License & Disclaimer

- Distributed under the **MIT License**.
- **Educational Disclaimer**: This project does not host or store copyrighted media files. All content is resolved in real-time from publicly available third-party sources.

---

<div align="center">
Made with 🌸 by <strong>Jhudel</strong> · Erumi Stream v2.7.0
</div>
