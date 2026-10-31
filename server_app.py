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

import web_server
from web_server import start_server_in_background, stop_server, get_local_ip, app_dir, web_dir


class ErumiServerApp:
    def __init__(self, port: int = 3000):
        self.requested_port = port
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
        self.root.geometry("460x570")
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
        w, h = 460, 580
        x = (self.root.winfo_screenwidth() // 2) - (w // 2)
        y = (self.root.winfo_screenheight() // 2) - (h // 2)
        self.root.geometry(f"{w}x{h}+{x}+{y}")

    def start_backend_server(self):
        try:
            self.server = start_server_in_background(self.port)
            self.port = getattr(web_server, "CURRENT_PORT", self.port)
            self.local_url = f"http://localhost:{self.port}"
            self.lan_url = f"http://{self.local_ip}:{self.port}"
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
        card.pack(fill="x", pady=(0, 18))

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
        self.lbl_local_url = ctk.CTkLabel(
            card_inner, text=f"Local PC:  {self.local_url}",
            font=ctk.CTkFont(family="Consolas", size=12),
            text_color="#9aa5b8"
        )
        self.lbl_local_url.pack(anchor="w", pady=2)

        self.lbl_lan_url = ctk.CTkLabel(
            card_inner, text=f"Wi-Fi LAN:  {self.lan_url}",
            font=ctk.CTkFont(family="Consolas", size=12),
            text_color="#4ecdc4"
        )
        self.lbl_lan_url.pack(anchor="w", pady=2)

        # Primary Action: Open Browser
        ctk.CTkButton(
            main, text="Open Web App in Browser",
            height=44, corner_radius=8,
            font=ctk.CTkFont(family="Bahnschrift", size=15, weight="bold"),
            fg_color="#ff6b6b", hover_color="#ff8585", text_color="#080b11",
            command=self.open_browser
        ).pack(fill="x", pady=(0, 8))

        # Action: View QR Code
        ctk.CTkButton(
            main, text="View QR Code (Scan to Watch on Phone)",
            height=38, corner_radius=8,
            font=ctk.CTkFont(family="Segoe UI", size=13, weight="bold"),
            fg_color="#151b29", hover_color="#1e2638",
            border_width=1, border_color="#14b8a6",
            text_color="#14b8a6",
            command=self.show_qr_dialog
        ).pack(fill="x", pady=(0, 8))

        # Action: Copy Same Wi-Fi Link
        ctk.CTkButton(
            main, text="Copy Wi-Fi Link (Phone / Tablet)",
            height=36, corner_radius=8,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            fg_color="#151b29", hover_color="#1e2638",
            border_width=1, border_color="#1d2433",
            text_color="#f3f6fc",
            command=self.copy_lan_url
        ).pack(fill="x", pady=(0, 8))

        # Action: Restart Server
        ctk.CTkButton(
            main, text="Restart Server",
            height=32, corner_radius=8,
            font=ctk.CTkFont(family="Segoe UI", size=11),
            fg_color="transparent", hover_color="#151b29",
            border_width=1, border_color="#1d2433",
            text_color="#9aa5b8",
            command=self.restart_server
        ).pack(fill="x", pady=(0, 14))

        # Footer Tip
        tip = ctk.CTkFrame(main, fg_color="#10141f", corner_radius=8)
        tip.pack(fill="x", side="bottom")
        ctk.CTkLabel(
            tip, text="💡 Tip: Keep this app open while streaming.\nClosing this window stops the server.",
            font=ctk.CTkFont(family="Segoe UI", size=11),
            text_color="#606d82", justify="center"
        ).pack(pady=8, padx=12)

    def _setup_tk_ui(self):
        # Fallback for standard tkinter
        lbl = tk.Label(self.root, text="ERUMI SERVER", font=("Helvetica", 18, "bold"), fg="#ff6b6b", bg="#080b11")
        lbl.pack(pady=20)
        self.lbl_local_url = tk.Label(self.root, text=f"Local: {self.local_url}", fg="#9aa5b8", bg="#080b11")
        self.lbl_local_url.pack(pady=2)
        self.lbl_lan_url = tk.Label(self.root, text=f"LAN: {self.lan_url}", fg="#4ecdc4", bg="#080b11")
        self.lbl_lan_url.pack(pady=2)
        btn = tk.Button(self.root, text="Open in Browser", command=self.open_browser, bg="#ff6b6b", fg="#000", font=("Helvetica", 12, "bold"))
        btn.pack(pady=10, fill="x", padx=40)
        btn_copy = tk.Button(self.root, text="Copy Wi-Fi Link", command=self.copy_lan_url, bg="#151b29", fg="#fff")
        btn_copy.pack(pady=5, fill="x", padx=40)

    def show_qr_dialog(self):
        qr_win = ctk.CTkToplevel(self.root) if HAS_CTK else tk.Toplevel(self.root)
        qr_win.title("Erumi Mobile QR Code")
        qr_win.geometry("340x420")
        qr_win.resizable(False, False)
        if HAS_CTK:
            qr_win.configure(fg_color="#080b11")
        else:
            qr_win.configure(bg="#080b11")

        # Center on top of parent window
        self.root.update_idletasks()
        rx, ry = self.root.winfo_x(), self.root.winfo_y()
        qr_win.geometry(f"+{rx + 60}+{ry + 70}")

        lbl_title = ctk.CTkLabel(
            qr_win, text="Scan with Phone Camera",
            font=ctk.CTkFont(family="Bahnschrift", size=16, weight="bold"),
            text_color="#14b8a6"
        ) if HAS_CTK else tk.Label(qr_win, text="Scan with Phone Camera", fg="#14b8a6", bg="#080b11", font=("Helvetica", 14, "bold"))
        lbl_title.pack(pady=(20, 8))

        lbl_sub = ctk.CTkLabel(
            qr_win, text=self.lan_url,
            font=ctk.CTkFont(family="Consolas", size=12),
            text_color="#9aa5b8"
        ) if HAS_CTK else tk.Label(qr_win, text=self.lan_url, fg="#9aa5b8", bg="#080b11")
        lbl_sub.pack(pady=(0, 14))

        status_lbl = ctk.CTkLabel(
            qr_win, text="Loading QR Code...",
            font=ctk.CTkFont(size=12), text_color="#606d82"
        ) if HAS_CTK else tk.Label(qr_win, text="Loading QR Code...", fg="#606d82", bg="#080b11")
        status_lbl.pack(pady=20)

        def fetch_qr():
            import urllib.request
            qr_api = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={urllib.parse.quote(self.lan_url)}&bgcolor=16-20-31&color=243-246-252&margin=6"
            try:
                req = urllib.request.Request(qr_api, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=5) as r:
                    raw_data = r.read()
                from PIL import Image
                img = Image.open(io.BytesIO(raw_data))
                def update_img():
                    try:
                        status_lbl.destroy()
                        if HAS_CTK:
                            ctk_img = ctk.CTkImage(light_image=img, dark_image=img, size=(200, 200))
                            img_lbl = ctk.CTkLabel(qr_win, image=ctk_img, text="")
                            img_lbl.image = ctk_img
                            img_lbl.pack(pady=10)
                        else:
                            from PIL import ImageTk
                            tk_img = ImageTk.PhotoImage(img)
                            img_lbl = tk.Label(qr_win, image=tk_img, bg="#080b11")
                            img_lbl.image = tk_img
                            img_lbl.pack(pady=10)
                    except Exception:
                        pass
                qr_win.after(0, update_img)
            except Exception:
                def show_fallback():
                    try:
                        status_lbl.configure(text=f"Open on your phone:\n\n{self.lan_url}")
                    except Exception:
                        pass
                qr_win.after(0, show_fallback)

        threading.Thread(target=fetch_qr, daemon=True).start()

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
        if hasattr(self, "lbl_local_url") and self.lbl_local_url:
            self.lbl_local_url.configure(text=f"Local PC:  {self.local_url}")
        if hasattr(self, "lbl_lan_url") and self.lbl_lan_url:
            self.lbl_lan_url.configure(text=f"Wi-Fi LAN:  {self.lan_url}")
        messagebox.showinfo("Erumi Server", f"Server restarted successfully on port {self.port}!")

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
