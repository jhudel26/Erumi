#!/usr/bin/env python3
"""
Erumi Server Desktop Controller - Jellyfin-style Standalone App for Erumi Anime Streaming
"""

import os
import sys
import io
import webbrowser
import threading
import time
import urllib.parse
from pathlib import Path
import tkinter as tk
from tkinter import messagebox

# Ensure stdout and stderr exist even when compiled with console=False (pythonw / windowed mode)
if sys.stdout is None:
    sys.stdout = io.StringIO()
if sys.stderr is None:
    sys.stderr = io.StringIO()

try:
    import customtkinter as ctk
    HAS_CTK = True
except ImportError:
    HAS_CTK = False

from web_server import start_server_in_background, stop_server, get_local_ip, app_dir, web_dir


class ErumiServerApp:
    def __init__(self, port: int = 3000):
        self.port = port
        self.local_ip = get_local_ip()
        self.local_url = f"http://localhost:{port}"
        self.lan_url = f"http://{self.local_ip}:{port}"
        self.server = None

        # Start the background streaming server
        self.start_backend_server()

        # Build GUI
        if HAS_CTK:
            ctk.set_appearance_mode("dark")
            ctk.set_default_color_theme("dark-blue")
            self.root = ctk.CTk()
        else:
            self.root = tk.Tk()

        self.root.title("Erumi Server")
        self.root.geometry("460x530")
        self.root.resizable(False, False)

        if HAS_CTK:
            self.root.configure(fg_color="#080b11")
        else:
            self.root.configure(bg="#080b11")

        self.center_window()
        self.setup_ui()

        # Set window icon
        ico_path = app_dir() / "favicon" / "favicon.ico"
        if not ico_path.exists():
            ico_path = app_dir() / "web" / "favicon.ico"
        if ico_path.exists():
            try:
                self.root.iconbitmap(str(ico_path))
            except Exception:
                pass

        # Handle window close
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Auto open browser on first launch
        self.root.after(800, self.open_browser)

    def center_window(self):
        self.root.update_idletasks()
        w, h = 460, 530
        x = (self.root.winfo_screenwidth() // 2) - (w // 2)
        y = (self.root.winfo_screenheight() // 2) - (h // 2)
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    def start_backend_server(self):
        try:
            self.server = start_server_in_background(self.port)
        except Exception as e:
            try:
                messagebox.showerror(
                    "Server Error",
                    f"Could not start server on port {self.port}:\n\n{str(e)}\n\n"
                    "Make sure another instance of Erumi or another server is not using port 3000."
                )
            except Exception:
                pass

    def setup_ui(self):
        if HAS_CTK:
            self._setup_ctk_ui()
        else:
            self._setup_tk_ui()

    def _setup_ctk_ui(self):
        main = ctk.CTkFrame(self.root, fg_color="#080b11", corner_radius=0)
        main.pack(fill="both", expand=True, padx=24, pady=24)

        # Brand header with Mascot
        header = ctk.CTkFrame(main, fg_color="transparent")
        header.pack(fill="x", pady=(0, 16))

        mascot_path = app_dir() / "web" / "erumi.png"
        if not mascot_path.exists():
            mascot_path = app_dir() / "favicon" / "erumi.png"

        mascot_img = None
        if mascot_path.exists():
            try:
                from PIL import Image
                pil_img = Image.open(mascot_path)
                mascot_img = ctk.CTkImage(light_image=pil_img, dark_image=pil_img, size=(48, 48))
            except Exception:
                pass

        if mascot_img:
            mascot_lbl = ctk.CTkLabel(header, image=mascot_img, text="")
            mascot_lbl.pack(side="left", padx=(0, 12))

        title_frame = ctk.CTkFrame(header, fg_color="transparent")
        title_frame.pack(side="left", fill="both", expand=True)

        ctk.CTkLabel(
            title_frame, text="ERUMI SERVER",
            font=ctk.CTkFont(family="Bahnschrift", size=22, weight="bold"),
            text_color="#ff6b6b"
        ).pack(anchor="w")

        ctk.CTkLabel(
            title_frame, text="Anime Streaming Engine",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color="#606d82"
        ).pack(anchor="w", pady=(2, 0))

        # Status Card
        card = ctk.CTkFrame(main, fg_color="#10141f", corner_radius=12, border_width=1, border_color="#1d2433")
        card.pack(fill="x", pady=(0, 20))

        card_inner = ctk.CTkFrame(card, fg_color="transparent")
        card_inner.pack(fill="x", padx=18, pady=16)

        status_row = ctk.CTkFrame(card_inner, fg_color="transparent")
        status_row.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(
            status_row, text="●", font=ctk.CTkFont(size=14),
            text_color="#3fb950"
        ).pack(side="left")

        ctk.CTkLabel(
            status_row, text=" Server Running & Active",
            font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
            text_color="#f3f6fc"
        ).pack(side="left", padx=4)

        # URLs
        ctk.CTkLabel(
            card_inner, text=f"Local PC:  {self.local_url}",
            font=ctk.CTkFont(family="Consolas", size=12),
            text_color="#9aa5b8"
        ).pack(anchor="w", pady=2)

        ctk.CTkLabel(
            card_inner, text=f"Wi-Fi LAN:  {self.lan_url}",
            font=ctk.CTkFont(family="Consolas", size=12),
            text_color="#4ecdc4"
        ).pack(anchor="w", pady=2)

        # Primary Action: Open Browser
        ctk.CTkButton(
            main, text="Open Web App in Browser",
            height=46, corner_radius=8,
            font=ctk.CTkFont(family="Bahnschrift", size=15, weight="bold"),
            fg_color="#ff6b6b", hover_color="#ff8585", text_color="#080b11",
            command=self.open_browser
        ).pack(fill="x", pady=(0, 10))

        # Action: Copy Same Wi-Fi Link
        ctk.CTkButton(
            main, text="Copy Wi-Fi Link (Phone / Tablet)",
            height=40, corner_radius=8,
            font=ctk.CTkFont(family="Segoe UI", size=13),
            fg_color="#151b29", hover_color="#1e2638",
            border_width=1, border_color="#1d2433",
            text_color="#f3f6fc",
            command=self.copy_lan_url
        ).pack(fill="x", pady=(0, 10))

        # Action: Restart Server
        ctk.CTkButton(
            main, text="Restart Server",
            height=36, corner_radius=8,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            fg_color="transparent", hover_color="#151b29",
            border_width=1, border_color="#1d2433",
            text_color="#9aa5b8",
            command=self.restart_server
        ).pack(fill="x", pady=(0, 20))

        # Footer Tip
        tip = ctk.CTkFrame(main, fg_color="#10141f", corner_radius=8)
        tip.pack(fill="x", side="bottom")
        ctk.CTkLabel(
            tip, text="💡 Tip: Keep this app open while streaming.\nClosing this window stops the server.",
            font=ctk.CTkFont(family="Segoe UI", size=11),
            text_color="#606d82", justify="center"
        ).pack(pady=10, padx=12)

    def _setup_tk_ui(self):
        # Fallback for standard tkinter
        lbl = tk.Label(self.root, text="ERUMI SERVER", font=("Helvetica", 18, "bold"), fg="#ff6b6b", bg="#080b11")
        lbl.pack(pady=20)
        btn = tk.Button(self.root, text="Open in Browser", command=self.open_browser, bg="#ff6b6b", fg="#000", font=("Helvetica", 12, "bold"))
        btn.pack(pady=10, fill="x", padx=40)

    def open_browser(self):
        webbrowser.open(self.local_url)

    def copy_lan_url(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.lan_url)
        messagebox.showinfo(
            "Wi-Fi Link Copied",
            f"Copied to clipboard:\n\n{self.lan_url}\n\nOpen this address on any Phone, Tablet, or Smart TV connected to the same Wi-Fi!"
        )

    def restart_server(self):
        stop_server()
        time.sleep(0.3)
        self.start_backend_server()
        messagebox.showinfo("Erumi Server", "Server restarted successfully on port 3000!")

    def on_close(self):
        stop_server()
        self.root.destroy()
        sys.exit(0)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    port = 3000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    ErumiServerApp(port).run()
