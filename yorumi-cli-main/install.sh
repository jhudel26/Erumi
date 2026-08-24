#!/usr/bin/env bash
set -e

REPO="davenarchives/yorumi-cli"

# Determine install root
if [ -n "$XDG_DATA_HOME" ]; then
    INSTALL_ROOT="$XDG_DATA_HOME/YorumiCLI"
else
    INSTALL_ROOT="$HOME/.local/share/YorumiCLI"
fi

REPO_DIR="$INSTALL_ROOT/repo"

# ── Color helpers ──────────────────────────────────────────────────

RST='\033[0m'
BG_GREEN='\033[42;30m'
BG_CYAN='\033[46;30m'
BG_YELLOW='\033[43;30m'
BG_RED='\033[41;30m'
BG_GRAY='\033[100;30m'
GREEN='\033[0;32m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'

write_label() {
    clear_progress_line
    printf "  %b %s %b  %s\n" "$2" "$1" "$RST" "$3"
    redraw_progress_line
}

write_success() { write_label "success" "$BG_GREEN" "$1"; }
write_info()    { write_label "info" "$BG_CYAN" "$1"; }
write_warn()    { write_label "warning" "$BG_YELLOW" "$1"; }
write_err()     { write_label "error" "$BG_RED" "$1"; }
write_note()    { write_label "note" "$BG_GRAY" "$1"; }

write_header() {
    clear_progress_line
    echo ""
    printf "  ${WHITE}%s${RST}\n" "$1"
    redraw_progress_line
}

# ── Progress bar ───────────────────────────────────────────────────

TOTAL_STEPS=5
CURRENT_STEP=0
CURRENT_UNITS=0
PROGRESS_UNITS=100
PROGRESS_ACTIVE=0
PROGRESS_LABEL=""

clear_progress_line() {
    if [ "$PROGRESS_ACTIVE" -eq 1 ]; then
        printf "\r\033[2K"
    fi
}

redraw_progress_line() {
    if [ "$PROGRESS_ACTIVE" -eq 1 ]; then
        draw_progress "$CURRENT_UNITS" "$PROGRESS_LABEL"
    fi
}

draw_progress() {
    local units="$1"
    local label="$2"
    PROGRESS_ACTIVE=1
    PROGRESS_LABEL="$label"
    local pct=$((units * 100 / PROGRESS_UNITS))
    local columns="${COLUMNS:-100}"
    local label_text=" | $label"
    local bar_width=$((columns - ${#label_text} - 14))
    if [ "$bar_width" -gt 34 ]; then bar_width=34; fi
    if [ "$bar_width" -lt 12 ]; then bar_width=12; fi
    local filled=$((bar_width * units / PROGRESS_UNITS))
    local empty=$((bar_width - filled))
    local bar=""
    for ((i = 0; i < filled; i++)); do bar+="█"; done
    for ((i = 0; i < empty; i++));  do bar+="-"; done
    printf "\r\033[2K  [%s] ${GREEN}%3d%%${RST}%s" "$bar" "$pct" "$label_text"
}

complete_progress_step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    local target=$((PROGRESS_UNITS * CURRENT_STEP / TOTAL_STEPS))
    while [ "$CURRENT_UNITS" -lt "$target" ]; do
        CURRENT_UNITS=$((CURRENT_UNITS + 1))
        draw_progress "$CURRENT_UNITS" "$1"
        sleep 0.018
    done
    draw_progress "$CURRENT_UNITS" "$1"
}

run_progress_in() {
    local label="$1"
    local cwd="$2"
    shift 2
    local target=$((PROGRESS_UNITS * (CURRENT_STEP + 1) / TOTAL_STEPS))
    local out_file
    local err_file
    out_file="$(mktemp)"
    err_file="$(mktemp)"

    draw_progress "$CURRENT_UNITS" "$label"
    (
        cd "$cwd"
        "$@"
    ) > "$out_file" 2> "$err_file" &
    local pid=$!

    while kill -0 "$pid" 2> /dev/null; do
        if [ "$CURRENT_UNITS" -lt $((target - 1)) ]; then
            CURRENT_UNITS=$((CURRENT_UNITS + 1))
        fi
        draw_progress "$CURRENT_UNITS" "$label"
        sleep 0.09
    done

    if ! wait "$pid"; then
        clear_progress_line
        write_err "$label failed."
        if [ -s "$err_file" ]; then
            cat "$err_file"
        elif [ -s "$out_file" ]; then
            cat "$out_file"
        fi
        rm -f "$out_file" "$err_file"
        exit 1
    fi

    rm -f "$out_file" "$err_file"
    complete_progress_step "$label"
}

# ── Requirement check ──────────────────────────────────────────────

require_command() {
    if ! command -v "$1" &> /dev/null; then
        write_err "$1 was not found. $2"
        exit 1
    fi
    write_success "$1 found"
}

# ── Start ──────────────────────────────────────────────────────────

echo ""
printf "  ${MAGENTA}yorumi-cli installer${RST}\n"
echo ""

write_header "Checking requirements"
complete_progress_step "Checking requirements"
require_command "git" "Please install git."
require_command "node" "Please install Node.js from https://nodejs.org/"
require_command "npm" "Please install npm."

if command -v mpv &> /dev/null; then
    write_success "mpv found"
else
    write_warn "mpv was not found on PATH"
    write_note "Install it via your package manager (e.g. apt, brew, pacman)"
fi

if command -v yt-dlp &> /dev/null; then
    write_success "yt-dlp found"
else
    write_warn "yt-dlp was not found on PATH"
    write_note "Install it via your package manager (e.g. apt, brew, pacman, pip)"
fi

if command -v ffmpeg &> /dev/null; then
    write_success "ffmpeg found"
else
    write_warn "ffmpeg was not found on PATH"
    write_note "Install ffmpeg before using yorumi-cli --download."
fi

if command -v fzf &> /dev/null; then
    write_success "fzf found"
else
    write_note "fzf not found (optional). Install for fuzzy menus."
fi

# ── Clone / pull CLI repo ──────────────────────────────────────────

write_header "Installing Yorumi CLI"
mkdir -p "$INSTALL_ROOT"

if [ -d "$REPO_DIR" ]; then
    write_info "CLI repo already exists, pulling latest changes"
    run_progress_in "Updating CLI repository" "$REPO_DIR" git pull --ff-only
    write_success "CLI repo updated"
else
    write_info "Cloning CLI repo from github.com/$REPO"
    run_progress_in "Cloning CLI repository" "$INSTALL_ROOT" git clone "https://github.com/$REPO.git" "$REPO_DIR"
    write_success "CLI repo cloned"
fi

# ── Install CLI npm deps ──────────────────────────────────────────

write_header "Installing dependencies"
write_info "Running npm install in CLI..."
run_progress_in "Installing CLI npm packages" "$REPO_DIR" npm install --loglevel=error

if ! (cd "$REPO_DIR" && npm link > /dev/null 2>&1); then
    write_warn "Global 'npm link' failed (likely permissions)."
    mkdir -p "$HOME/.local/bin"
    ln -sf "$REPO_DIR/bin/yorumi-cli.cjs" "$HOME/.local/bin/yorumi-cli"
    chmod +x "$REPO_DIR/bin/yorumi-cli.cjs"
    write_success "Symlinked to $HOME/.local/bin/yorumi-cli"
    write_note "Make sure $HOME/.local/bin is in your PATH."
else
    write_success "CLI globally linked via npm"
fi

write_success "CLI dependencies installed"

# ── Done ──────────────────────────────────────────────────────────

complete_progress_step "Complete"
clear_progress_line
PROGRESS_ACTIVE=0
echo ""
write_success "Yorumi CLI installed successfully!"
echo ""
write_info "Run: yorumi-cli --help"
if ! command -v mpv &> /dev/null; then
    write_warn "Install mpv before running yorumi-cli."
fi
if ! command -v yt-dlp &> /dev/null; then
    write_warn "Install yt-dlp so fallback providers work correctly."
fi
if ! command -v ffmpeg &> /dev/null; then
    write_warn "Install ffmpeg before using yorumi-cli --download."
fi
echo ""
