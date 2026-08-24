import customtkinter as ctk
import subprocess
import threading
import os
import sys
import queue
import json
import shutil
from pathlib import Path
from tkinter import filedialog, messagebox
from typing import Optional, List
from urllib.parse import urlparse

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("dark-blue")

# Modern refined palette — sophisticated dark theme with better contrast
C = {
    "bg": "#0d1117",
    "sidebar": "#161b22",
    "panel": "#1c2128",
    "panel_alt": "#21262d",
    "input": "#0d1117",
    "border": "#30363d",
    "border_soft": "#21262d",
    "border_focus": "#58a6ff",
    "text": "#f0f6fc",
    "muted": "#8b949e",
    "dim": "#6e7681",
    "accent": "#ff7b72",
    "accent_hover": "#ff938a",
    "accent_pressed": "#da3633",
    "accent_soft": "#3d1814",
    "success": "#3fb950",
    "warning": "#d29922",
    "danger": "#f85149",
    "nav_hover": "#21262d",
    "nav_active": "#262c36",
    "shadow": "rgba(0,0,0,0.3)",
    "card": "#161b22",
}


def app_dir() -> Path:
    """Directory that holds Erumi + optional yorumi-cli-main (works for .py and .exe)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


APP_DIR = app_dir()
LOCAL_CJS = APP_DIR / "yorumi-cli-main" / "bin" / "yorumi-cli.cjs"
DEFAULT_CLI = APP_DIR / "yorumi-cli.cmd"
FALLBACK_CLI = Path(os.environ.get("LOCALAPPDATA", "")) / "YorumiCLI" / "bin" / "yorumi-cli.cmd"


def resolve_default_cli() -> str:
    if LOCAL_CJS.exists():
        return str(DEFAULT_CLI if DEFAULT_CLI.exists() else LOCAL_CJS)
    if FALLBACK_CLI.exists():
        return str(FALLBACK_CLI)
    if DEFAULT_CLI.exists():
        return str(DEFAULT_CLI)
    return str(FALLBACK_CLI)


def hidden_subprocess_kwargs() -> dict:
    """Avoid flashing a console window when spawning Node/CLI from the GUI .exe."""
    if sys.platform != "win32":
        return {}
    # CREATE_NO_WINDOW = 0x08000000 — available as subprocess.CREATE_NO_WINDOW on 3.7+
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return {"creationflags": flags}


class YorumiGUI:
    def __init__(self):
        self.cli_path = resolve_default_cli()
        self.cli_process = None
        self.output_queue: queue.Queue = queue.Queue()
        self.is_running = False
        self.current_anime = None
        self.current_episodes = None
        self.current_search_results = None
        # Index is relative to this query/mode — must be reused for follow-up CLI calls
        self.current_query: Optional[str] = None
        self.current_browse_mode: Optional[str] = None  # None | "latest" | "popular"
        self._nav_buttons: List[ctk.CTkButton] = []
        self._action_buttons: List[ctk.CTkButton] = []

        self.root = ctk.CTk()
        self.root.title("Erumi")
        self.root.geometry("1100x720")
        self.root.minsize(880, 600)
        self.root.configure(fg_color=C["bg"])

        self.center_window()
        self.setup_ui()

        ico_path = APP_DIR / "favicon" / "favicon.ico"
        if ico_path.exists():
            try:
                self.root.iconbitmap(str(ico_path))
            except Exception:
                pass

        self.root.after(120, self.check_cli_on_startup)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(200, lambda: self.search_entry.focus_set())

    def center_window(self):
        self.root.update_idletasks()
        width, height = 1100, 720
        x = (self.root.winfo_screenwidth() // 2) - (width // 2)
        y = (self.root.winfo_screenheight() // 2) - (height // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _font(self, size=14, weight="normal", family=None):
        if family is None:
            family = "Bahnschrift" if weight == "bold" else "Segoe UI"
        return ctk.CTkFont(family=family, size=size, weight=weight)
    
    def _spacing(self, multiplier=1):
        return 8 * multiplier

    def setup_ui(self):
        self.main_frame = ctk.CTkFrame(self.root, fg_color=C["bg"], corner_radius=0)
        self.main_frame.pack(fill="both", expand=True)

        # ── Sidebar ──
        self.sidebar = ctk.CTkFrame(self.main_frame, fg_color=C["sidebar"], width=220, corner_radius=0)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        brand = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        brand.pack(fill="x", padx=self._spacing(3), pady=(self._spacing(5), self._spacing(1)))

        ctk.CTkLabel(
            brand, text="ERUMI",
            font=self._font(32, "bold", "Bahnschrift"),
            text_color=C["accent"],
        ).pack(anchor="w")

        ctk.CTkLabel(
            brand, text="Watch anime. Quietly.",
            font=self._font(11, family="Segoe UI"),
            text_color=C["dim"],
        ).pack(anchor="w", pady=(self._spacing(0.5), 0))

        accent_line = ctk.CTkFrame(self.sidebar, fg_color=C["accent"], height=2, corner_radius=0)
        accent_line.pack(fill="x", padx=self._spacing(3), pady=(self._spacing(2.5), self._spacing(3.5)))

        self.nav_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        self.nav_frame.pack(fill="both", expand=True, padx=self._spacing(2))

        self.search_nav = self._nav_button("Search", lambda: self.search_entry.focus_set(), active=True)
        self.latest_nav = self._nav_button("Latest", self.run_latest)
        self.settings_nav = self._nav_button("CLI Path", self.browse_cli_path)

        footer = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        footer.pack(fill="x", side="bottom", padx=self._spacing(3), pady=self._spacing(3))
        ctk.CTkLabel(
            footer, text="Yorumi · mpv",
            font=self._font(11, family="Segoe UI"),
            text_color=C["dim"],
        ).pack(anchor="w")

        # ── Content ──
        self.content_area = ctk.CTkFrame(self.main_frame, fg_color=C["bg"], corner_radius=0)
        self.content_area.pack(side="right", fill="both", expand=True)

        top = ctk.CTkFrame(self.content_area, fg_color=C["bg"], height=56, corner_radius=0)
        top.pack(fill="x", side="top", padx=self._spacing(4.5), pady=(self._spacing(2.5), 0))

        status_row = ctk.CTkFrame(top, fg_color="transparent")
        status_row.pack(side="left", pady=self._spacing(1))

        self.status_dot = ctk.CTkLabel(
            status_row, text="●", font=self._font(12), text_color=C["dim"]
        )
        self.status_dot.pack(side="left")

        self.status_text = ctk.CTkLabel(
            status_row, text="Starting…",
            font=self._font(12, family="Segoe UI"),
            text_color=C["muted"],
        )
        self.status_text.pack(side="left", padx=(self._spacing(1), 0))

        self.clear_btn = ctk.CTkButton(
            top, text="Clear log", width=90, height=32,
            corner_radius=6, font=self._font(12, family="Segoe UI"),
            fg_color="transparent", border_width=1, border_color=C["border"],
            text_color=C["muted"], hover_color=C["panel"],
            command=self.clear_output,
        )
        self.clear_btn.pack(side="right", pady=self._spacing(1))

        body = ctk.CTkFrame(self.content_area, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=self._spacing(4.5), pady=(self._spacing(2), self._spacing(3.5)))

        # Search hero
        search_wrap = ctk.CTkFrame(body, fg_color=C["card"], corner_radius=12, border_width=1, border_color=C["border_soft"])
        search_wrap.pack(fill="x")

        search_inner = ctk.CTkFrame(search_wrap, fg_color="transparent")
        search_inner.pack(fill="x", padx=self._spacing(3.5), pady=self._spacing(3.5))

        ctk.CTkLabel(
            search_inner, text="Find something to watch",
            font=self._font(24, "bold", "Bahnschrift"),
            text_color=C["text"],
        ).pack(anchor="w")

        ctk.CTkLabel(
            search_inner,
            text="Search Yorumi, pick an episode, open in mpv.",
            font=self._font(13, family="Segoe UI"),
            text_color=C["muted"],
        ).pack(anchor="w", pady=(self._spacing(0.75), self._spacing(2.5)))

        search_row = ctk.CTkFrame(search_inner, fg_color="transparent")
        search_row.pack(fill="x")

        self.search_entry = ctk.CTkEntry(
            search_row,
            placeholder_text="Anime title…",
            height=48,
            corner_radius=8,
            font=self._font(15, family="Segoe UI"),
            fg_color=C["input"],
            border_color=C["border"],
            border_width=1,
            text_color=C["text"],
            placeholder_text_color=C["dim"],
        )
        self.search_entry.pack(side="left", fill="x", expand=True, padx=(0, self._spacing(1.5)))
        self.search_entry.bind("<Return>", lambda _e: self.search_anime())
        self.search_entry.bind("<FocusIn>", lambda _e: self.search_entry.configure(border_color=C["border_focus"]))
        self.search_entry.bind("<FocusOut>", lambda _e: self.search_entry.configure(border_color=C["border"]))

        self.search_btn = ctk.CTkButton(
            search_row, text="Search", width=120, height=48,
            corner_radius=8, font=self._font(14, "bold", "Bahnschrift"),
            fg_color=C["accent"], hover_color=C["accent_hover"],
            text_color="#0d1117", command=self.search_anime,
        )
        self.search_btn.pack(side="left")
        self._action_buttons.append(self.search_btn)

        # Quick actions
        actions = ctk.CTkFrame(body, fg_color="transparent")
        actions.pack(fill="x", pady=(self._spacing(2), 0))
        for i in range(4):
            actions.grid_columnconfigure(i, weight=1)

        self.latest_btn = self._chip(actions, "Latest", self.run_latest, 0)
        self.popular_btn = self._chip(actions, "Popular", self.run_popular, 1)
        self.help_btn = self._chip(actions, "Help", self.run_help, 2)
        self.version_btn = self._chip(actions, "Version", self.run_version, 3)
        
        # Action button frame for better visual separation
        action_frame = ctk.CTkFrame(body, fg_color=C["card"], corner_radius=8, border_width=1, border_color=C["border_soft"])
        action_frame.pack(fill="x", pady=(self._spacing(1.5), 0), padx=(0, 0))
        
        action_inner = ctk.CTkFrame(action_frame, fg_color="transparent")
        action_inner.pack(fill="x", padx=self._spacing(2), pady=self._spacing(1.5))
        
        self.update_btn = ctk.CTkButton(
            action_inner, text="Update CLI", height=36, width=120,
            corner_radius=6, font=self._font(12, family="Segoe UI"),
            fg_color="transparent", border_width=1, border_color=C["border"],
            text_color=C["muted"], hover_color=C["panel_alt"],
            command=self.run_update,
        )
        self.update_btn.pack(side="left")
        self._action_buttons.append(self.update_btn)

        # Activity log
        log_wrap = ctk.CTkFrame(body, fg_color=C["card"], corner_radius=12, border_width=1, border_color=C["border_soft"])
        log_wrap.pack(fill="both", expand=True, pady=(self._spacing(2.25), 0))

        log_head = ctk.CTkFrame(log_wrap, fg_color="transparent")
        log_head.pack(fill="x", padx=self._spacing(2.75), pady=(self._spacing(2.25), self._spacing(1)))
        
        ctk.CTkLabel(
            log_head, text="Activity",
            font=self._font(14, "bold", "Bahnschrift"),
            text_color=C["text"],
        ).pack(side="left")
        
        # Add a subtle divider line
        divider = ctk.CTkFrame(log_head, fg_color=C["border_soft"], height=1, corner_radius=0)
        divider.pack(fill="x", pady=(self._spacing(1), 0))

        self.output_text = ctk.CTkTextbox(
            log_wrap,
            font=ctk.CTkFont(family="Cascadia Mono", size=12),
            fg_color=C["input"],
            text_color=C["muted"],
            corner_radius=8,
            border_width=0,
            wrap="word",
            activate_scrollbars=True,
        )
        self.output_text.pack(fill="both", expand=True, padx=self._spacing(2.75), pady=(self._spacing(1), self._spacing(2.75)))
        self._reset_log_banner()
        self.output_text.configure(state="disabled")

    def _nav_button(self, text: str, command, active: bool = False) -> ctk.CTkButton:
        btn = ctk.CTkButton(
            self.nav_frame,
            text=f"  {text}",
            height=44,
            corner_radius=8,
            font=self._font(13, family="Segoe UI"),
            fg_color=C["nav_active"] if active else "transparent",
            text_color=C["accent"] if active else C["muted"],
            hover_color=C["nav_hover"],
            anchor="w",
            command=command,
            border_width=0,
        )
        btn.pack(fill="x", pady=self._spacing(0.375))
        self._nav_buttons.append(btn)
        return btn

    def _chip(self, parent, text: str, command, column: int) -> ctk.CTkButton:
        btn = ctk.CTkButton(
            parent, text=text, height=40,
            corner_radius=8, font=self._font(13, family="Segoe UI"),
            fg_color=C["panel"], hover_color=C["panel_alt"],
            border_width=1, border_color=C["border_soft"],
            text_color=C["text"], command=command,
        )
        btn.grid(row=0, column=column, padx=(0 if column == 0 else self._spacing(0.75), 0), sticky="ew")
        self._action_buttons.append(btn)
        return btn

    def _reset_log_banner(self):
        self.output_text.configure(state="normal")
        self.output_text.delete("1.0", "end")
        self.output_text.insert("end", "Erumi is ready.\nSearch for a title to begin.\n")
        self.output_text.configure(state="disabled")
    
    def append_output(self, text: str):
        """Append text to output with auto-scroll and timestamp."""
        import datetime
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        self.output_text.configure(state="normal")
        self.output_text.insert("end", f"[{timestamp}] {text}\n")
        self.output_text.see("end")
        self.output_text.configure(state="disabled")

    # ── Status / busy ─────────────────────────────────────────────

    def set_status(self, text: str, state: str = "idle"):
        colors = {
            "idle": C["dim"],
            "ok": C["success"],
            "busy": C["warning"],
            "error": C["danger"],
        }
        self.status_dot.configure(text_color=colors.get(state, C["dim"]))
        self.status_text.configure(text=text)
        
        # Add pulsing effect for busy state
        if state == "busy":
            self._start_pulse()
        else:
            self._stop_pulse()
    
    def _start_pulse(self):
        """Start pulsing animation for status dot."""
        if getattr(self, "_pulse_after_id", None):
            try:
                self.root.after_cancel(self._pulse_after_id)
            except Exception:
                pass
            self._pulse_after_id = None

        self._pulse_active = True

        def pulse():
            if not getattr(self, "_pulse_active", False):
                return

            current_color = self.status_dot.cget("text_color")
            if current_color == C["warning"]:
                self.status_dot.configure(text_color=C["dim"])
            else:
                self.status_dot.configure(text_color=C["warning"])

            if getattr(self, "_pulse_active", False):
                self._pulse_after_id = self.root.after(500, pulse)

        self._pulse_after_id = self.root.after(500, pulse)

    def _stop_pulse(self):
        """Stop pulsing animation for status dot."""
        self._pulse_active = False
        if getattr(self, "_pulse_after_id", None):
            try:
                self.root.after_cancel(self._pulse_after_id)
            except Exception:
                pass
            self._pulse_after_id = None
        self.status_dot.configure(text="●")

    def set_busy(self, busy: bool):
        self.is_running = busy
        state = "disabled" if busy else "normal"
        for btn in self._action_buttons:
            try:
                btn.configure(state=state)
            except Exception:
                pass
        try:
            self.search_entry.configure(state=state)
        except Exception:
            pass
        
        # Cancel pulse animation when not busy
        if not busy:
            self._stop_pulse()

    # ── CLI path ──────────────────────────────────────────────────

    def check_cli_on_startup(self):
        if os.path.exists(self.cli_path):
            self.set_status("CLI ready", "ok")
            self.append_output(f"CLI: {self.cli_path}")
        else:
            self.set_status("CLI not found", "error")
            self.show_cli_not_found_dialog()

    def show_cli_not_found_dialog(self):
        dialog = self._dialog("CLI Not Found", "420x220")
        ctk.CTkLabel(
            dialog,
            text="Yorumi CLI was not found.",
            font=self._font(16, "bold", "Bahnschrift"),
            text_color=C["text"],
        ).pack(pady=(32, 8), padx=24)
        ctk.CTkLabel(
            dialog,
            text="Point Erumi at yorumi-cli.cmd or the Node entry.",
            font=self._font(12, family="Segoe UI"),
            text_color=C["muted"],
        ).pack(padx=24)
        ctk.CTkButton(
            dialog, text="Browse…", height=40, corner_radius=8,
            font=self._font(13, "bold"), fg_color=C["accent"],
            hover_color=C["accent_hover"], text_color="#0a0c12",
            command=lambda: [self.browse_cli_path(), dialog.destroy()],
        ).pack(fill="x", padx=28, pady=(20, 8))
        ctk.CTkButton(
            dialog, text="Cancel", height=36, corner_radius=8,
            font=self._font(12), fg_color="transparent",
            border_width=1, border_color=C["border"],
            text_color=C["muted"], hover_color=C["panel"],
            command=dialog.destroy,
        ).pack(fill="x", padx=28, pady=(0, 20))
        self.set_status("CLI not found", "error")

    def browse_cli_path(self):
        file_path = filedialog.askopenfilename(
            title="Select Yorumi CLI",
            filetypes=[
                ("Command / script", "*.cmd;*.cjs;*.exe"),
                ("All files", "*.*"),
            ],
            initialdir=str(APP_DIR),
        )
        if not file_path:
            return
        self.cli_path = file_path
        if os.path.exists(self.cli_path):
            self.set_status("CLI ready", "ok")
            self.append_output(f"CLI path updated: {self.cli_path}")
        else:
            self.set_status("Invalid CLI path", "error")
            self.append_output("Invalid path selected.")

    def resolve_node(self) -> str:
        return shutil.which("node") or r"C:\Program Files\nodejs\node.exe"

    def resolve_cli_argv(self, args: list) -> List[str]:
        """Prefer direct node + cjs so Windows .cmd does not mangle flags."""
        node = self.resolve_node()
        local_cjs = APP_DIR / "yorumi-cli-main" / "bin" / "yorumi-cli.cjs"
        path = Path(self.cli_path)
        lower = str(path).lower()

        if lower.endswith("yorumi-cli.cmd") and local_cjs.exists():
            return [node, str(local_cjs), *args]
        if lower.endswith(".cjs") or lower.endswith(".js"):
            return [node, str(path), *args]
        if lower.endswith(".ts") and local_cjs.exists():
            return [node, str(local_cjs), *args]
        if local_cjs.exists() and "yorumi" in lower:
            return [node, str(local_cjs), *args]
        return [str(path), *args]

    def build_selection_args(self, *, episode: Optional[str] = None) -> List[str]:
        """Rebuild CLI args using the same search/browse context as the result list."""
        args: List[str] = []
        if self.current_browse_mode == "latest":
            args.append("--latest")
        elif self.current_browse_mode == "popular":
            args.append("--popular")
        else:
            query = self.current_query or (self.current_anime or {}).get("title") or ""
            if not query:
                raise ValueError("No search query available for this selection.")
            args.append(query)

        anime = self.current_anime or {}
        index = anime.get("index", 1)
        args.extend(["--anime-index", str(index)])
        if episode is not None:
            args.extend(["--episode", str(episode)])
        args.append("--json")
        return args

    # ── Output helpers ────────────────────────────────────────────

    def clear_output(self):
        self._reset_log_banner()

    @staticmethod
    def parse_json_output(raw: str) -> Optional[dict]:
        text = (raw or "").strip()
        if not text:
            return None
        try:
            data = json.loads(text)
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass
        # CLI may print noise before JSON — take the last object
        start = text.rfind("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(text[start : end + 1])
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                return None
        return None

    # ── CLI execution ─────────────────────────────────────────────

    def execute_cli_json(self, args: list):
        if not os.path.exists(self.cli_path):
            self.show_cli_not_found_dialog()
            return

        if self.is_running:
            self.show_error("Another command is already running.")
            return

        self.set_busy(True)
        self.set_status("Working…", "busy")
        self.append_output(f"> {' '.join(args)}")

        def run_command():
            try:
                argv = self.resolve_cli_argv(args)
                process = subprocess.Popen(
                    argv,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    cwd=str(APP_DIR / "yorumi-cli-main") if (APP_DIR / "yorumi-cli-main").exists() else None,
                    **hidden_subprocess_kwargs(),
                )
                self.cli_process = process
                output, error = process.communicate()

                if process.returncode not in (0, None) and not (output or "").strip():
                    msg = (error or "").strip() or f"CLI exited with code {process.returncode}"
                    self.output_queue.put(("ERROR", msg))
                elif error and error.strip() and "Error:" in error:
                    # Prefer structured JSON on stdout when present
                    data = self.parse_json_output(output or "")
                    if data:
                        self.output_queue.put(("JSON", data))
                    else:
                        self.output_queue.put(("ERROR", error.strip()))
                else:
                    data = self.parse_json_output(output or "")
                    if data:
                        self.output_queue.put(("JSON", data))
                    elif (error or "").strip():
                        self.output_queue.put(("ERROR", error.strip()))
                    else:
                        self.output_queue.put(("TEXT", (output or "").strip() or "No output"))

                self.output_queue.put(("DONE", None))
            except Exception as e:
                self.output_queue.put(("ERROR", str(e)))
                self.output_queue.put(("DONE", None))

        def process_output():
            try:
                done_received = False
                while True:
                    try:
                        kind, payload = self.output_queue.get_nowait()
                    except queue.Empty:
                        break

                    if kind == "DONE":
                        done_received = True
                    elif kind == "JSON":
                        self.handle_json_response(payload)
                    elif kind == "ERROR":
                        self.set_status("Error", "error")
                        self.append_output(f"Error: {payload}")
                        self.show_error(str(payload)[:400])
                    elif kind == "TEXT":
                        self.append_output(str(payload))

                if done_received:
                    self.cli_process = None
                    self.set_busy(False)
                    if self.status_text.cget("text") == "Working…":
                        self.set_status("CLI ready", "ok")
                    return

                if self.is_running:
                    self.root.after(80, process_output)
            except Exception as e:
                self.append_output(f"Output error: {e}")
                self.set_busy(False)
                self.set_status("Error", "error")

        threading.Thread(target=run_command, daemon=True).start()
        self.root.after(80, process_output)

    def handle_json_response(self, json_data: dict):
        response_type = json_data.get("type")
        if response_type == "search_results":
            results = json_data.get("results") or []
            self.current_search_results = results
            self.set_status(f"{len(results)} results", "ok")
            self.append_output(f"Found {len(results)} title(s).")
            self.show_anime_selection(results)
        elif response_type == "episodes":
            self.current_anime = {
                **(json_data.get("anime") or {}),
                "index": (self.current_anime or {}).get("index"),
                "title": (json_data.get("anime") or {}).get("title")
                or (self.current_anime or {}).get("title"),
            }
            self.current_episodes = json_data.get("episodes") or []
            self.set_status(f"{len(self.current_episodes)} episodes", "ok")
            self.append_output(f"Episodes ready for {self.current_anime.get('title', 'anime')}.")
            self.show_episode_selection(self.current_anime, self.current_episodes)
        elif response_type == "streams":
            self.handle_stream_response(json_data)
        else:
            self.append_output(f"Unknown response type: {response_type}")
            self.set_status("Unexpected response", "error")

    # ── Selection dialogs ─────────────────────────────────────────

    def _dialog(self, title: str, size: str) -> ctk.CTkToplevel:
        dialog = ctk.CTkToplevel(self.root)
        dialog.title(title)
        dialog.geometry(size)
        dialog.configure(fg_color=C["bg"])
        dialog.transient(self.root)
        dialog.grab_set()
        dialog.attributes('-alpha', 0.0)  # Start invisible for smooth fade-in
        dialog.update_idletasks()
        w, h = (int(x) for x in size.lower().split("x"))
        x = (dialog.winfo_screenwidth() // 2) - (w // 2)
        y = (dialog.winfo_screenheight() // 2) - (h // 2)
        dialog.geometry(f"{w}x{h}+{x}+{y}")

        def step(alpha: float = 0.0):
            if not dialog.winfo_exists():
                return
            new_alpha = min(1.0, alpha + 0.15)
            dialog.attributes('-alpha', new_alpha)
            if new_alpha < 1.0:
                dialog.after(15, lambda: step(new_alpha))

        dialog.after(10, lambda: step(0.0))
        return dialog

    def show_anime_selection(self, results: list = None):
        results = results if results is not None else self.current_search_results
        if not results:
            self.show_error("No search results available.")
            return

        dialog = self._dialog("Select Anime", "640x520")

        ctk.CTkLabel(
            dialog, text="Select a title",
            font=self._font(18, "bold", "Bahnschrift"),
            text_color=C["text"],
        ).pack(anchor="w", padx=self._spacing(3.5), pady=(self._spacing(3), self._spacing(0.5)))
        ctk.CTkLabel(
            dialog, text=f"{len(results)} matches from Yorumi",
            font=self._font(12, family="Segoe UI"),
            text_color=C["muted"],
        ).pack(anchor="w", padx=self._spacing(3.5), pady=(0, self._spacing(1.5)))

        scroll = ctk.CTkScrollableFrame(
            dialog, fg_color=C["card"], corner_radius=10,
            border_width=1, border_color=C["border_soft"],
        )
        scroll.pack(fill="both", expand=True, padx=self._spacing(3.5), pady=(0, self._spacing(1.5)))

        selected = ctk.StringVar(value=str(results[0].get("index", 1)))

        for result in results:
            idx = result.get("index", 1)
            label = result.get("title") or "Untitled"
            meta = []
            if result.get("year"):
                meta.append(str(result["year"]))
            if result.get("episodes"):
                meta.append(f"{result['episodes']} eps")
            if meta:
                label = f"{label}  ·  {' · '.join(meta)}"

            row = ctk.CTkFrame(scroll, fg_color="transparent")
            row.pack(fill="x", pady=2, padx=6)
            ctk.CTkRadioButton(
                row, text=label, variable=selected, value=str(idx),
                font=self._font(13, family="Segoe UI"),
                text_color=C["text"], fg_color=C["accent"],
                hover_color=C["accent_hover"],
                border_color=C["border_focus"],
            ).pack(anchor="w", pady=self._spacing(0.5))

        def submit():
            if not selected.get():
                return
            selected_index = int(selected.get())
            match = next((r for r in results if int(r.get("index", -1)) == selected_index), None)
            if not match:
                # fall back to list position
                pos = selected_index - 1
                if 0 <= pos < len(results):
                    match = results[pos]
            if not match:
                return
            self.current_anime = match
            dialog.destroy()
            self.fetch_episodes_for_anime(match)

        ctk.CTkButton(
            dialog, text="Continue", height=44, corner_radius=8,
            font=self._font(14, "bold", "Bahnschrift"),
            fg_color=C["accent"], hover_color=C["accent_hover"],
            text_color="#0d1117", command=submit,
        ).pack(fill="x", padx=self._spacing(3.5), pady=(0, self._spacing(3)))

    def fetch_episodes_for_anime(self, anime: dict):
        anime_name = anime.get("title") or ""
        self.current_anime = anime
        self.append_output(f"Loading episodes for {anime_name}…")
        try:
            self.execute_cli_json(self.build_selection_args())
        except ValueError as e:
            self.show_error(str(e))

    def show_episode_selection(self, anime: dict = None, episodes: list = None):
        anime = anime if anime is not None else self.current_anime
        episodes = episodes if episodes is not None else self.current_episodes
        if not anime or not episodes:
            self.show_error("No episode data available.")
            return

        dialog = self._dialog("Select Episode", "520x560")
        title = anime.get("title") or "Anime"

        ctk.CTkLabel(
            dialog, text=title,
            font=self._font(18, "bold", "Bahnschrift"),
            text_color=C["text"],
        ).pack(anchor="w", padx=self._spacing(3.5), pady=(self._spacing(3), self._spacing(0.5)))
        ctk.CTkLabel(
            dialog,
            text=f"{len(episodes)} episodes available",
            font=self._font(12, family="Segoe UI"),
            text_color=C["muted"],
        ).pack(anchor="w", padx=self._spacing(3.5), pady=(0, self._spacing(1.5)))

        jump = ctk.CTkFrame(dialog, fg_color="transparent")
        jump.pack(fill="x", padx=self._spacing(3.5), pady=(0, self._spacing(1.25)))
        ctk.CTkLabel(
            jump, text="Episode #",
            font=self._font(12, family="Segoe UI"),
            text_color=C["muted"],
        ).pack(side="left")
        ep_entry = ctk.CTkEntry(
            jump, width=80, height=34, corner_radius=6,
            fg_color=C["input"], border_color=C["border"],
            text_color=C["text"],
        )
        ep_entry.pack(side="left", padx=(self._spacing(1.25), self._spacing(1)))
        ep_entry.bind("<FocusIn>", lambda _e: ep_entry.configure(border_color=C["border_focus"]))
        ep_entry.bind("<FocusOut>", lambda _e: ep_entry.configure(border_color=C["border"]))

        scroll = ctk.CTkScrollableFrame(
            dialog, fg_color=C["card"], corner_radius=10,
            border_width=1, border_color=C["border_soft"],
        )
        scroll.pack(fill="both", expand=True, padx=self._spacing(3.5), pady=(0, self._spacing(1.5)))

        selected = ctk.StringVar(value=str(episodes[0]["episodeNumber"]))
        # Show up to 120 for browsing; jump field covers the rest
        display_episodes = episodes[:120]
        for episode in display_episodes:
            num = episode["episodeNumber"]
            ctk.CTkRadioButton(
                scroll, text=f"Episode {num}", variable=selected, value=str(num),
                font=self._font(13, family="Segoe UI"),
                text_color=C["text"], fg_color=C["accent"],
                hover_color=C["accent_hover"], border_color=C["border_focus"],
            ).pack(anchor="w", pady=self._spacing(0.375), padx=self._spacing(1))

        if len(episodes) > 120:
            ctk.CTkLabel(
                scroll,
                text=f"Showing first 120 — use Episode # for {len(episodes) - 120} more",
                text_color=C["dim"],
                font=self._font(11, family="Segoe UI"),
            ).pack(anchor="w", pady=8, padx=8)

        def resolve_episode() -> Optional[str]:
            typed = ep_entry.get().strip()
            if typed:
                try:
                    n = int(typed)
                except ValueError:
                    self.show_error("Enter a valid episode number.")
                    return None
                if not any(int(e["episodeNumber"]) == n for e in episodes):
                    self.show_error(f"Episode {n} is not in the list.")
                    return None
                return str(n)
            return selected.get() or None

        def submit():
            ep = resolve_episode()
            if not ep:
                return
            dialog.destroy()
            self.play_episode(ep)

        ep_entry.bind("<Return>", lambda _e: submit())

        ctk.CTkButton(
            dialog, text="Play", height=44, corner_radius=8,
            font=self._font(14, "bold", "Bahnschrift"),
            fg_color=C["accent"], hover_color=C["accent_hover"],
            text_color="#0d1117", command=submit,
        ).pack(fill="x", padx=self._spacing(3.5), pady=(0, self._spacing(3)))

    def play_episode(self, episode_number: str):
        if not self.current_anime:
            self.show_error("No anime selected.")
            return
        anime_name = self.current_anime.get("title") or ""
        self.append_output(f"Playing episode {episode_number} of {anime_name}…")
        self.set_status("Launching player…", "busy")
        try:
            # Let the CLI open mpv itself so its PNG-HLS proxy stays alive for playback.
            args = [a for a in self.build_selection_args(episode=episode_number) if a != "--json"]
            argv = self.resolve_cli_argv(args)
            subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=str(APP_DIR / "yorumi-cli-main") if (APP_DIR / "yorumi-cli-main").exists() else None,
                **hidden_subprocess_kwargs(),
            )
            self.set_status("Playing in mpv", "ok")
            self.append_output("Player started via Yorumi CLI.")
        except Exception as e:
            self.set_busy(False)
            self.set_status("Player error", "error")
            self.show_error(str(e))

    def stream_referer(self, stream: Optional[dict], url: str) -> str:
        if stream and stream.get("referer"):
            return str(stream["referer"])
        try:
            host = urlparse(url).hostname or ""
        except Exception:
            host = ""
        if host.endswith("googlevideo.com"):
            return "https://www.youtube.com/"
        if "mp4upload" in host:
            return "https://www.mp4upload.com/"
        if "vivibebe.site" in host or "ibyteimg.com" in host:
            return "https://vivibebe.site/"
        if host in ("127.0.0.1", "localhost"):
            return "https://vivibebe.site/"
        if stream and stream.get("provider") in ("allmanga",):
            return "https://allmanga.to/"
        if stream and stream.get("provider") == "anineko":
            return "https://vivibebe.site/"
        return "https://allmanga.to/"

    def handle_stream_response(self, json_data: dict):
        episodes = json_data.get("episodes") or []
        if not episodes or not episodes[0].get("url"):
            self.set_status("No stream URL", "error")
            self.show_error("Could not resolve a playable stream URL.")
            return

        stream_url = episodes[0]["url"]
        stream_meta = episodes[0].get("stream") or {}
        anime_title = (json_data.get("anime") or {}).get("title") or (
            (self.current_anime or {}).get("title") or "Anime"
        )
        ep_num = episodes[0].get("episodeNumber", "?")
        quality = stream_meta.get("quality") or "auto"
        audio = (stream_meta.get("audio") or "sub").upper()

        self.append_output(f"Stream ready · {quality} · {audio}")
        self.append_output(f"{stream_url[:72]}{'…' if len(stream_url) > 72 else ''}")

        mpv_path = self.resolve_mpv_path()
        if not mpv_path:
            self.set_status("mpv missing", "error")
            self.show_error("Could not find mpv. Install it (winget install mpv) and try again.")
            return

        referer = self.stream_referer(stream_meta, stream_url)
        title = f"{anime_title} — Episode {ep_num}"
        try:
            subprocess.Popen([
                mpv_path,
                "--force-window=immediate",
                "--fullscreen=no",
                f"--title={title}",
                f"--referrer={referer}",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "--hls-bitrate=max",
                "--demuxer-lavf-o=allowed_extensions=ALL",
                "--no-ytdl",
                stream_url,
            ], **hidden_subprocess_kwargs())
            self.set_status("Playing in mpv", "ok")
            self.append_output("Opened in mpv.")
        except Exception as e:
            self.set_status("Player error", "error")
            self.append_output(f"Player error: {e}")
            self.show_error(f"Could not open mpv: {e}")

    def resolve_mpv_path(self) -> Optional[str]:
        for path in os.environ.get("PATH", "").split(os.pathsep):
            candidate = os.path.join(path, "mpv.exe")
            if os.path.exists(candidate):
                return candidate
        candidates = [
            r"C:\Program Files\MPV Player\mpv.exe",
            r"C:\Program Files (x86)\MPV Player\mpv.exe",
            r"C:\Program Files\mpv\mpv.exe",
            r"C:\Program Files (x86)\mpv\mpv.exe",
            r"C:\Program Files\mpv.net\mpvnet.exe",
            r"C:\Program Files (x86)\mpv.net\mpvnet.exe",
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                return candidate
        return shutil.which("mpv")

    # ── Actions ───────────────────────────────────────────────────

    def search_anime(self):
        anime_name = self.search_entry.get().strip()
        if not anime_name:
            self.show_error("Enter an anime title.")
            return
        self.current_browse_mode = None
        self.current_query = anime_name
        self.execute_cli_json([anime_name, "--json"])

    def run_latest(self):
        self.current_browse_mode = "latest"
        self.current_query = None
        self.execute_cli_json(["--latest", "--json"])

    def run_popular(self):
        self.current_browse_mode = "popular"
        self.current_query = None
        self.execute_cli_json(["--popular", "--json"])

    def run_help(self):
        help_text = (
            "Erumi drives Yorumi CLI.\n\n"
            "Search a title, pick a match, choose an episode, and mpv opens the stream.\n\n"
            "CLI flags used under the hood:\n"
            "  --json  --anime-index  --episode\n"
            "  --latest  --popular  --version  --update\n\n"
            f"Current CLI:\n{self.cli_path}"
        )
        messagebox.showinfo("Help", help_text)

    def run_version(self):
        try:
            argv = self.resolve_cli_argv(["--version"])
            result = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=20,
                **hidden_subprocess_kwargs(),
            )
            version = (result.stdout or result.stderr or "").strip() or "Unknown"
            messagebox.showinfo("Yorumi CLI Version", f"Yorumi CLI {version}")
        except Exception as e:
            messagebox.showerror("Error", f"Could not get version: {e}")

    def run_update(self):
        try:
            # Prefer visible PowerShell for interactive update output
            cmd = self.resolve_cli_argv(["--update"])
            if sys.platform == "win32":
                ps_script = f"& {{ & '{cmd[0]}' {' '.join(f'\"{arg}\"' for arg in cmd[1:])} }}"
                subprocess.Popen(
                    ["powershell.exe", "-NoExit", "-Command", ps_script],
                    creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0x00000010),
                )
            else:
                subprocess.Popen(cmd)
            self.append_output("Opened CLI update in a new window.")
        except Exception as e:
            messagebox.showerror("Error", f"Could not start update: {e}")

    def show_error(self, message: str):
        messagebox.showerror("Erumi", message)

    def cleanup(self):
        if self.cli_process and self.cli_process.poll() is None:
            try:
                self.cli_process.terminate()
            except Exception:
                pass

    def on_close(self):
        self.cleanup()
        self.root.destroy()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    YorumiGUI().run()
