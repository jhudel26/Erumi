# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
from pathlib import Path

block_cipher = None

ctk_datas, ctk_binaries, ctk_hiddenimports = collect_all("customtkinter")

# Include the static web frontend assets and favicon/branding inside the bundle
extra_datas = [
    ("web", "web"),
    ("favicon", "favicon"),
]

a = Analysis(
    ["server_app.py"],
    pathex=[],
    binaries=ctk_binaries,
    datas=ctk_datas + extra_datas,
    hiddenimports=ctk_hiddenimports + [
        "PIL",
        "PIL._tkinter_finder",
        "PIL.Image",
        "PIL.PngImagePlugin",
        "PIL.IcoImagePlugin",
        "http.server",
        "socketserver",
        "urllib.request",
        "web_server",
        "Crypto",
        "Crypto.Cipher",
        "Crypto.Cipher.AES",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="ErumiServer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="favicon/favicon.ico",
)
