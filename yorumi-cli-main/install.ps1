param(
    [string]$Repo = "davenarchives/yorumi-cli",
    [string]$Ref = "main"
)

$ErrorActionPreference = "Stop"

$installRoot = Join-Path $env:LOCALAPPDATA "YorumiCLI"
$repoDir = Join-Path $installRoot "repo"
$binDir = Join-Path $installRoot "bin"
$nodeRoot = Join-Path $installRoot "node"
$script:nodeExe = $null
$script:npmCmd = $null

# ── Pretty output helpers ──────────────────────────────────────────

function Write-Label($label, $color, $message) {
    Clear-ProgressLine
    Write-Host "  $label  " -ForegroundColor Black -BackgroundColor $color -NoNewline
    Write-Host "  $message"
    Redraw-ProgressLine
}

function Write-Success($message) { Write-Label "success" "Green"   $message }
function Write-Info($message)    { Write-Label "info"    "Cyan"    $message }
function Write-Warn($message)    { Write-Label "warning" "Yellow"  $message }
function Write-Err($message)     { Write-Label "error"   "Red"     $message }
function Write-Note($message)    { Write-Label "note"    "DarkGray" $message }

function Write-Header($message) {
    Clear-ProgressLine
    Write-Host ""
    Write-Host $message -ForegroundColor White
    Redraw-ProgressLine
}

# ── Progress bar ───────────────────────────────────────────────────

$script:totalSteps = 9
$script:currentStep = 0
$script:currentUnits = 0
$script:progressUnits = 100
$script:escape = [char]27
$script:progressActive = $false
$script:progressLabel = ""

function Clear-ProgressLine {
    if ($script:progressActive) {
        [Console]::Write("`r$($script:escape)[2K")
    }
}

function Redraw-ProgressLine {
    if ($script:progressActive) {
        Draw-Progress $script:currentUnits $script:progressLabel
    }
}

function Draw-Progress($units, $label) {
    $script:progressActive = $true
    $script:progressLabel = $label
    $pct = [math]::Floor(($units / $script:progressUnits) * 100)
    $columns = 100
    try {
        if ([Console]::WindowWidth -gt 0) { $columns = [Console]::WindowWidth }
    } catch {}

    $labelText = " | $label"
    $barWidth = [Math]::Min(34, [Math]::Max(12, $columns - $labelText.Length - 14))
    $filled = [math]::Floor($barWidth * $units / $script:progressUnits)
    $filled = [math]::Min($filled, $barWidth)
    $empty = [math]::Max(0, $barWidth - $filled)
    $pct = [math]::Min($pct, 100)
    $bar = ("$([char]0x2588)" * $filled) + ("-" * $empty)
    $line = "  [$bar] $($script:escape)[32m$('{0,3}%' -f $pct)$($script:escape)[0m$labelText"

    [Console]::Write("`r$($script:escape)[2K$line")
}

function Complete-ProgressStep($label) {
    $script:currentStep++
    $target = [math]::Floor($script:progressUnits * $script:currentStep / $script:totalSteps)
    while ($script:currentUnits -lt $target) {
        $script:currentUnits++
        Draw-Progress $script:currentUnits $label
        Start-Sleep -Milliseconds 18
    }
    Draw-Progress $script:currentUnits $label
}

function Invoke-ProgressCommand($label, $file, [string[]]$arguments, $workingDirectory) {
    Draw-Progress $script:currentUnits $label
    $target = [math]::Floor($script:progressUnits * ($script:currentStep + 1) / $script:totalSteps)

    try {
        $job = Start-Job -ScriptBlock {
            param($command, $commandArgs, $cwd)
            Set-Location $cwd

            $output = & $command @commandArgs 2>&1
            $exitCode = $LASTEXITCODE

            if ($output) {
                $output | ForEach-Object { Write-Output $_ }
            }

            if ($exitCode -ne 0) {
                throw "$command exited with code $exitCode"
            }
        } -ArgumentList $file, $arguments, $workingDirectory

        while ($job.State -eq "Running") {
            if ($script:currentUnits -lt ($target - 1)) {
                $script:currentUnits++
            }
            Draw-Progress $script:currentUnits $label
            Start-Sleep -Milliseconds 90
        }

        $details = Receive-Job $job 2>&1 | Out-String
        if ($job.State -ne "Completed") {
            Clear-ProgressLine
            Write-Err "$label failed."
            if ($details) { Write-Host $details.Trim() }
            throw "$label failed"
        }
    } finally {
        if ($job) { Remove-Job $job -Force -ErrorAction SilentlyContinue }
    }

    Complete-ProgressStep $label
}

# ── Requirement check ──────────────────────────────────────────────

function Require-Command($name, $installHint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Err "$name was not found. $installHint"
        throw "$name is required."
    }
    Write-Success "$name found"
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Assert-SafeInstallPath($path) {
    $resolvedInstallRoot = [System.IO.Path]::GetFullPath($installRoot)
    $resolvedPath = [System.IO.Path]::GetFullPath($path)
    $installRootPrefix = $resolvedInstallRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedPath.StartsWith($installRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside install root: $resolvedPath"
    }
}

function Install-RepoFromZip {
    param(
        [string]$Repo,
        [string]$Ref,
        [string]$Destination
    )

    Draw-Progress $script:currentUnits "Downloading CLI archive"

    $archiveUrl = if ($Ref -eq "main") {
        "https://github.com/$Repo/archive/refs/heads/main.zip"
    } else {
        "https://github.com/$Repo/archive/refs/tags/$Ref.zip"
    }
    $workDir = Join-Path $installRoot ("download-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $workDir "yorumi-cli.zip"
    $extractDir = Join-Path $workDir "extract"

    Assert-SafeInstallPath $workDir
    Assert-SafeInstallPath $Destination

    try {
        New-Item -ItemType Directory -Force -Path $workDir | Out-Null
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

        Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $sourceDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
        if (-not $sourceDir) {
            throw "Downloaded archive did not contain a repository folder."
        }

        if (Test-Path $Destination) {
            Remove-Item -LiteralPath $Destination -Recurse -Force
        }

        Move-Item -LiteralPath $sourceDir.FullName -Destination $Destination
    } finally {
        if (Test-Path $workDir) {
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Complete-ProgressStep "Downloading CLI archive"
}

function Get-NodeArchiveArch {
    $architecture = ""
    if ($env:PROCESSOR_ARCHITEW6432) {
        $architecture = $env:PROCESSOR_ARCHITEW6432
    } elseif ($env:PROCESSOR_ARCHITECTURE) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
    }

    switch ($architecture.ToLowerInvariant()) {
        "arm64" { return "arm64" }
        "x86" { return "x86" }
        default { return "x64" }
    }
}

function Get-FzfArchiveArch {
    $nodeArch = Get-NodeArchiveArch
    switch ($nodeArch) {
        "arm64" { return "arm64" }
        default { return "amd64" }
    }
}

function Get-PortableNodePaths {
    if (-not (Test-Path $nodeRoot)) { return $null }

    $nodeDir = Get-ChildItem -Path $nodeRoot -Directory -Filter "node-v*-win-*" -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1

    if (-not $nodeDir) { return $null }

    $nodeExe = Join-Path $nodeDir.FullName "node.exe"
    $npmCmd = Join-Path $nodeDir.FullName "npm.cmd"
    if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) {
        return @{
            Node = $nodeExe
            Npm = $npmCmd
        }
    }

    return $null
}

function Install-PortableNode {
    Draw-Progress $script:currentUnits "Installing portable Node.js"

    $arch = Get-NodeArchiveArch
    $workDir = Join-Path $installRoot ("node-download-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $workDir "node.zip"
    $extractDir = Join-Path $workDir "extract"

    Assert-SafeInstallPath $workDir
    Assert-SafeInstallPath $nodeRoot

    try {
        New-Item -ItemType Directory -Force -Path $workDir | Out-Null
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null

        $releases = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json"
        $release = $releases |
            Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } |
            Select-Object -First 1

        if (-not $release) {
            throw "Could not find a Windows Node.js LTS archive for $arch."
        }

        $version = $release.version
        $archiveUrl = "https://nodejs.org/dist/$version/node-$version-win-$arch.zip"
        Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $sourceDir = Get-ChildItem -Path $extractDir -Directory -Filter "node-*-win-*" | Select-Object -First 1
        if (-not $sourceDir) {
            throw "Downloaded Node.js archive did not contain a runtime folder."
        }

        $destination = Join-Path $nodeRoot $sourceDir.Name
        Assert-SafeInstallPath $destination

        if (Test-Path $destination) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }

        Move-Item -LiteralPath $sourceDir.FullName -Destination $destination
    } finally {
        if (Test-Path $workDir) {
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Complete-ProgressStep "Installing portable Node.js"
}

function Ensure-NodeRuntime {
    $nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
    $npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        $npmCommand = Get-Command "npm" -ErrorAction SilentlyContinue
    }

    if ($nodeCommand -and $npmCommand) {
        $script:nodeExe = $nodeCommand.Source
        $script:npmCmd = $npmCommand.Source
        Complete-ProgressStep "Checking Node.js"
        Write-Success "node/npm found"
        return
    }

    $portablePaths = Get-PortableNodePaths
    if (-not $portablePaths) {
        Write-Info "node/npm not found, installing private Node.js runtime"
        Install-PortableNode
        $portablePaths = Get-PortableNodePaths
    } else {
        Complete-ProgressStep "Checking Node.js"
    }

    if (-not $portablePaths) {
        Write-Err "Unable to install private Node.js runtime"
        throw "Node.js runtime setup failed"
    }

    $script:nodeExe = $portablePaths.Node
    $script:npmCmd = $portablePaths.Npm
    $env:PATH = "$(Split-Path $script:nodeExe);$env:PATH"
    Write-Success "private node/npm ready"
}

function Normalize-PathEntry {
    param([string]$PathEntry)

    try {
        $expanded = [Environment]::ExpandEnvironmentVariables($PathEntry.Trim().Trim('"'))
        return [System.IO.Path]::GetFullPath($expanded).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    } catch {
        return $null
    }
}

function Add-UserPathEntry {
    param([string]$PathEntry)

    $resolvedEntry = Normalize-PathEntry $PathEntry
    if (-not $resolvedEntry) {
        throw "Unable to resolve PATH entry: $PathEntry"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    $entries = $userPath -split ";" | Where-Object { $_ -and $_.Trim() }
    $alreadyPresent = $entries | Where-Object {
        $normalized = Normalize-PathEntry $_
        $normalized -and $normalized.Equals($resolvedEntry, [System.StringComparison]::OrdinalIgnoreCase)
    }

    if (-not $alreadyPresent) {
        $nextPath = if ($userPath.Trim()) { "$userPath;$resolvedEntry" } else { $resolvedEntry }
        [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
        Write-Success "Added Yorumi CLI to user PATH"
    } else {
        Write-Success "Yorumi CLI already on user PATH"
    }

    $processEntries = $env:PATH -split ";" | Where-Object { $_ -and $_.Trim() }
    $inProcessPath = $processEntries | Where-Object {
        $normalized = Normalize-PathEntry $_
        $normalized -and $normalized.Equals($resolvedEntry, [System.StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $inProcessPath) {
        $env:PATH = "$resolvedEntry;$env:PATH"
    }
}

function Write-CliShim {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    $shimPath = Join-Path $binDir "yorumi-cli.cmd"
    $launcherPath = Join-Path $repoDir "bin\yorumi-cli.cjs"
    $shim = @"
@echo off
setlocal
"$script:nodeExe" "$launcherPath" %*
"@

    Set-Content -LiteralPath $shimPath -Value $shim -Encoding ASCII
    Add-UserPathEntry $binDir
    Write-Success "CLI command shim installed"
}

function Install-PortableFzf {
    Draw-Progress $script:currentUnits "Installing fzf"

    $arch = Get-FzfArchiveArch
    $workDir = Join-Path $installRoot ("fzf-download-" + [guid]::NewGuid().ToString("N"))
    $zipPath = Join-Path $workDir "fzf.zip"
    $extractDir = Join-Path $workDir "extract"
    $fzfPath = Join-Path $binDir "fzf.exe"

    Assert-SafeInstallPath $workDir
    Assert-SafeInstallPath $binDir

    try {
        New-Item -ItemType Directory -Force -Path $workDir | Out-Null
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null

        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/junegunn/fzf/releases/latest"
        $asset = $release.assets |
            Where-Object { $_.name -like "*windows_$arch.zip" } |
            Select-Object -First 1

        if (-not $asset -or -not $asset.browser_download_url) {
            throw "Could not find a Windows fzf archive for $arch."
        }

        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $downloadedFzf = Get-ChildItem -Path $extractDir -Recurse -File -Filter "fzf.exe" | Select-Object -First 1
        if (-not $downloadedFzf) {
            throw "Downloaded fzf archive did not contain fzf.exe."
        }

        Copy-Item -LiteralPath $downloadedFzf.FullName -Destination $fzfPath -Force
    } finally {
        if (Test-Path $workDir) {
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Complete-ProgressStep "Installing fzf"
}

function Ensure-Fzf {
    if (Get-Command "fzf" -ErrorAction SilentlyContinue) {
        Complete-ProgressStep "Checking fzf"
        Write-Success "fzf found"
        return
    }

    $fzfPath = Join-Path $binDir "fzf.exe"
    if (Test-Path $fzfPath) {
        Complete-ProgressStep "Checking fzf"
        Add-UserPathEntry $binDir
        Write-Success "portable fzf ready"
        return
    }

    Write-Info "fzf not found, installing portable fzf"
    Install-PortableFzf
    Add-UserPathEntry $binDir
    Write-Success "portable fzf installed"
}

function Test-MpvInstalled {
    if (Get-Command "mpv" -ErrorAction SilentlyContinue) { return $true }

    $candidates = @(
        "C:\Program Files\MPV Player\mpv.exe",
        "C:\Program Files (x86)\MPV Player\mpv.exe",
        "C:\Program Files\mpv\mpv.exe",
        "C:\Program Files (x86)\mpv\mpv.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $true }
    }

    return $false
}

function Ensure-Mpv {
    if (Test-MpvInstalled) {
        Complete-ProgressStep "Checking mpv"
        Write-Success "mpv found"
        return
    }

    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        Complete-ProgressStep "Checking mpv"
        Write-Warn "mpv was not found and winget is unavailable"
        Write-Note "Install mpv manually: https://mpv.io/installation/"
        return
    }

    Write-Info "mpv not found, installing with winget"
    Invoke-ProgressCommand "Installing mpv" "winget" @(
        "install",
        "--id", "shinchiro.mpv",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) $PWD.Path

    if (Test-MpvInstalled) {
        Write-Success "mpv installed"
    } else {
        Write-Warn "mpv installed, but PATH may need a new terminal"
        Write-Note "If playback does not open, reopen PowerShell and run yorumi-cli again."
    }
}

function Test-YtdlpInstalled {
    if (Get-Command "yt-dlp" -ErrorAction SilentlyContinue) { return $true }

    $candidates = @(
        "C:\Program Files\yt-dlp\yt-dlp.exe",
        "C:\Program Files (x86)\yt-dlp\yt-dlp.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $true }
    }

    return $false
}

function Ensure-Ytdlp {
    if (Test-YtdlpInstalled) {
        Complete-ProgressStep "Checking yt-dlp"
        Write-Success "yt-dlp found"
        return
    }

    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        Complete-ProgressStep "Checking yt-dlp"
        Write-Warn "yt-dlp was not found and winget is unavailable"
        Write-Note "Install yt-dlp manually: https://github.com/yt-dlp/yt-dlp"
        return
    }

    Write-Info "yt-dlp not found, installing with winget"
    Invoke-ProgressCommand "Installing yt-dlp" "winget" @(
        "install",
        "--id", "yt-dlp.yt-dlp",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) $PWD.Path

    if (Test-YtdlpInstalled) {
        Write-Success "yt-dlp installed"
    } else {
        Write-Warn "yt-dlp installed, but PATH may need a new terminal"
        Write-Note "If playback fails, reopen PowerShell and run yorumi-cli again."
    }
}

function Test-FfmpegInstalled {
    if (Get-Command "ffmpeg" -ErrorAction SilentlyContinue) { return $true }

    $candidates = @(
        "C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        "C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $true }
    }

    return $false
}

function Ensure-Ffmpeg {
    if (Test-FfmpegInstalled) {
        Complete-ProgressStep "Checking ffmpeg"
        Write-Success "ffmpeg found"
        return
    }

    if (-not (Get-Command "winget" -ErrorAction SilentlyContinue)) {
        Complete-ProgressStep "Checking ffmpeg"
        Write-Warn "ffmpeg was not found and winget is unavailable"
        Write-Note "Install ffmpeg manually before using yorumi-cli --download."
        return
    }

    Write-Info "ffmpeg not found, installing with winget"
    Invoke-ProgressCommand "Installing ffmpeg" "winget" @(
        "install",
        "--id", "Gyan.FFmpeg",
        "-e",
        "--accept-package-agreements",
        "--accept-source-agreements"
    ) $PWD.Path

    if (Test-FfmpegInstalled) {
        Write-Success "ffmpeg installed"
    } else {
        Write-Warn "ffmpeg installed, but PATH may need a new terminal"
        Write-Note "If downloads fail, reopen PowerShell and run yorumi-cli again."
    }
}

# ── Start ──────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  yorumi-cli installer" -ForegroundColor Magenta
Write-Host ""

Write-Header "Checking requirements"
Complete-ProgressStep "Checking requirements"
$gitAvailable = Test-Command "git"
if ($gitAvailable) {
    Write-Success "git found"
} else {
    Write-Note "git not found; using GitHub zip download instead"
}
Ensure-NodeRuntime
Ensure-Mpv
Ensure-Ytdlp
Ensure-Ffmpeg
Ensure-Fzf

# ── Clone / pull CLI repo ──────────────────────────────────────────

Write-Header "Installing Yorumi CLI"
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

if (Test-Path $repoDir) {
    if ($gitAvailable -and (Test-Path (Join-Path $repoDir ".git"))) {
        Write-Info "CLI repo already exists, pulling latest changes"
        Invoke-ProgressCommand "Fetching updates" "git" @("fetch", "origin", $Ref) $repoDir
        Invoke-ProgressCommand "Updating CLI repository" "git" @("reset", "--hard", "origin/$Ref") $repoDir
        Write-Success "CLI repo updated"
    } else {
        Write-Info "CLI install already exists, replacing it from GitHub archive"
        Install-RepoFromZip $Repo $Ref $repoDir
        Write-Success "CLI archive installed"
    }
} else {
    if ($gitAvailable) {
        Write-Info "Cloning CLI repo from github.com/$Repo"
        Invoke-ProgressCommand "Cloning CLI repository" "git" @("clone", "--branch", $Ref, "--single-branch", "https://github.com/$Repo.git", $repoDir) $installRoot
        Write-Success "CLI repo cloned"
    } else {
        Write-Info "Downloading CLI archive from github.com/$Repo"
        Install-RepoFromZip $Repo $Ref $repoDir
        Write-Success "CLI archive installed"
    }
}

if (-not (Test-Path $repoDir)) {
    Write-Err "Unable to clone https://github.com/$Repo.git"
    throw "Clone failed"
}

# ── Install CLI npm deps ──────────────────────────────────────────

Write-Header "Installing dependencies"
Write-Info "Running npm install in CLI..."
Invoke-ProgressCommand "Installing CLI npm packages" $script:npmCmd @("install", "--loglevel=error") $repoDir
Write-CliShim
Write-Success "CLI dependencies installed"

# ── Done ──────────────────────────────────────────────────────────

Complete-ProgressStep "Complete"
Clear-ProgressLine
$script:progressActive = $false
Write-Host ""
Write-Success "Yorumi CLI installed successfully!"
Write-Host ""
Write-Info "Run: yorumi-cli --help"
if (-not (Get-Command "mpv" -ErrorAction SilentlyContinue)) {
    Write-Warn "If mpv was just installed, reopen your terminal before running yorumi-cli."
}
if (-not (Get-Command "yt-dlp" -ErrorAction SilentlyContinue)) {
    Write-Warn "If yt-dlp was just installed, reopen your terminal before using fallback providers."
}
if (-not (Get-Command "ffmpeg" -ErrorAction SilentlyContinue)) {
    Write-Warn "If ffmpeg was just installed, reopen your terminal before using yorumi-cli --download."
}
Write-Host ""
