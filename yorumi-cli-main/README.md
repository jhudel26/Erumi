# Yorumi CLI

```text
▄▄ ▄▄  ▄▄▄  ▄▄▄▄  ▄▄ ▄▄ ▄▄   ▄▄ ▄▄      ▄▄▄▄ ▄▄    ▄▄
▀███▀ ██▀██ ██▄█▄ ██ ██ ██▀▄▀██ ██ ▄▄▄ ██▀▀▀ ██    ██
  █   ▀███▀ ██ ██ ▀███▀ ██   ██ ██     ▀████ ██▄▄▄ ██
```

Tiny terminal anime watcher using Yorumi search, direct AllAnime fallback scraping, and `mpv` for playback.

## Installation

### Windows

PowerShell:

```powershell
iwr -useb https://raw.githubusercontent.com/davenarchives/yorumi-cli/main/install.ps1 | iex
```

The installer downloads `yorumi-cli`, installs private Node.js/npm and `fzf` runtimes when needed, installs dependencies, and adds the `yorumi-cli` command to PATH. Git and global Node.js/npm are optional on Windows.

Scoop:

```powershell
scoop bucket add yorumi https://github.com/davenarchives/yorumi-cli
scoop install yorumi-cli
```

On Windows, the PowerShell installer attempts to install `mpv`, `yt-dlp`, and `ffmpeg` with Winget when they are missing. The CLI searches the local Yorumi backend when available, then falls back to direct AllAnime GraphQL scraping and stream resolution.

```powershell
yorumi-cli -e 1 "Frieren"
```

Examples:

```powershell
yorumi-cli
yorumi-cli "One Piece"
yorumi-cli "Attack on Titan" --sub
yorumi-cli -e 1 "Frieren"
yorumi-cli -e 1 "Attack on Titan" --dub
yorumi-cli -r "1-5" "Naruto"
yorumi-cli -r "1-5" "Attack on Titan" --sub
yorumi-cli --range "1-5" "Naruto"
yorumi-cli "one piece" --episode 1120
yorumi-cli -d -e 1 "Frieren"
yorumi-cli -d -e 1 "Attack on Titan" --sub
yorumi-cli -d -r "1-5" "Naruto"
yorumi-cli --download --range "1-5" "Naruto" --output "D:\Anime"
yorumi-cli --version
```

Update or uninstall:

```powershell
yorumi-cli --update
yorumi-cli --uninstall
```

Non-HLS fallback players require `yt-dlp`, and download mode requires `ffmpeg`. On Windows, the installer can install both with Winget when needed. Use `--yes` to auto-confirm ffmpeg installation, overwrite an existing output file, or skip the uninstall confirmation.
Downloads are saved to `~/Downloads/Yorumi` by default. Override that with `--output` or `YORUMI_DOWNLOAD_DIR`.
Downloads convert audio to AAC by default for better Windows player compatibility. Use `--copy-audio` to keep the source audio track untouched.

## Interactive Menu

Yorumi CLI uses `fzf` or `rofi` for anime and episode selection when available. The Windows installer includes portable `fzf`; without `fzf` or `rofi`, the CLI falls back to a numbered terminal menu.

```powershell
yorumi-cli
```

Flow:

1. Search anime.
2. Select anime.
3. Choose episode.
4. mpv opens the player window.
