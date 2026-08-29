#!/usr/bin/env python3
"""
Erumi Web Server - High Performance Local & LAN API, Static Web Server & HLS Proxy for Yorumi Anime Streaming
"""

import http.server
import socketserver
import socket
import urllib.parse
import urllib.request
import subprocess
import threading
import shutil
import json
import os
import sys
import io
import re
import html
import base64
import hashlib
from pathlib import Path
from typing import Optional, List, Dict, Any

# Ensure stdout and stderr exist even when compiled with console=False (pythonw / windowed mode)
if sys.stdout is None:
    sys.stdout = io.StringIO()
if sys.stderr is None:
    sys.stderr = io.StringIO()

import ssl
try:
    # Disable strict cert validation on sandboxed Windows / VM systems missing root CAs
    ssl._create_default_https_context = ssl._create_unverified_context
except Exception:
    pass


import time

def is_trusted_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https"):
            return False
            
        host = (parsed.hostname or "").lower()
        if not host:
            return False
            
        # Allow loopback for local API networking/testing
        if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            return True
            
        # Block private IP ranges (RFC 1918) to prevent SSRF
        if host.startswith("192.168.") or host.startswith("10."):
            return False
        if host.startswith("172."):
            try:
                parts = host.split('.')
                if len(parts) >= 2:
                    second_octet = int(parts[1])
                    if 16 <= second_octet <= 31:
                        return False
            except ValueError:
                pass
        if host.startswith("169.254."):
            return False
            
        return True
    except Exception:
        return False

# Global In-Memory CLI Cache
CLI_CACHE = {}

def get_cached_cli_output(key: tuple, ttl_sec: int) -> Optional[dict]:
    if key in CLI_CACHE:
        entry = CLI_CACHE[key]
        if time.time() - entry["timestamp"] < ttl_sec:
            return entry["data"]
        else:
            del CLI_CACHE[key]
    return None

def set_cached_cli_output(key: tuple, data: dict):
    CLI_CACHE[key] = {
        "timestamp": time.time(),
        "data": data
    }


def app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def web_dir() -> Path:
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            meipass_web = Path(sys._MEIPASS) / "web"
            if meipass_web.exists():
                return meipass_web
        exe_web = Path(sys.executable).resolve().parent / "web"
        if exe_web.exists():
            return exe_web
        parent_web = Path(sys.executable).resolve().parent.parent / "web"
        if parent_web.exists():
            return parent_web
    return app_dir() / "web"


APP_DIR = app_dir()
WEB_DIR = web_dir()
DEFAULT_CLI = APP_DIR / "yorumi-cli.cmd"
FALLBACK_CLI = Path(os.environ.get("LOCALAPPDATA", "")) / "YorumiCLI" / "bin" / "yorumi-cli.cmd"

DEFAULT_CONFIG = {
    "server": {
        "port": 3000,
        "auto_launch_browser": True,
        "bind_all_interfaces": True,
    },
    "playback": {
        "preferred_quality": "1080p",  # 1080p, 720p, auto
        "auto_next_episode": True,
        "default_mode": "sub",         # sub, dub
        "buffer_size_kb": 64,
        "auto_rotate_fullscreen": True,
    },
    "cache": {
        "enabled": True,
        "search_ttl_seconds": 3600,
        "episodes_ttl_seconds": 600,
        "metadata_ttl_seconds": 43200,
    }
}

def load_config() -> dict:
    config_path = APP_DIR / "erumi_config.json"
    if config_path.exists():
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                cfg = json.loads(json.dumps(DEFAULT_CONFIG))
                for section, values in data.items():
                    if isinstance(values, dict) and section in cfg:
                        cfg[section].update(values)
                    else:
                        cfg[section] = values
                return cfg
        except Exception:
            pass
    save_config(DEFAULT_CONFIG)
    return json.loads(json.dumps(DEFAULT_CONFIG))

def save_config(cfg: dict) -> bool:
    try:
        config_path = APP_DIR / "erumi_config.json"
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        return True
    except Exception:
        return False

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
CURRENT_PORT = 3000
SERVER_INSTANCE = None


def get_local_ip() -> str:
    """Retrieve the host computer's Local Area Network (Wi-Fi) IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def resolve_node() -> str:
    return shutil.which("node") or r"C:\Program Files\nodejs\node.exe"


def resolve_cli_argv(args: list) -> List[str]:
    node = resolve_node()
    candidates_cjs = [
        app_dir() / "yorumi-cli-main" / "bin" / "yorumi-cli.cjs",
        app_dir().parent / "yorumi-cli-main" / "bin" / "yorumi-cli.cjs",
    ]
    for cjs in candidates_cjs:
        if cjs.exists():
            return [node, str(cjs), *args]

    candidates_cmd = [
        app_dir() / "yorumi-cli.cmd",
        app_dir().parent / "yorumi-cli.cmd",
        FALLBACK_CLI,
    ]
    for cmd in candidates_cmd:
        if cmd.exists():
            return [str(cmd), *args]

    return [node, str(candidates_cjs[0]), *args]


def resolve_cli_cwd() -> str:
    candidates = [
        app_dir() / "yorumi-cli-main",
        app_dir().parent / "yorumi-cli-main",
        app_dir(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return str(app_dir())


def hidden_subprocess_kwargs() -> dict:
    if sys.platform != "win32":
        return {}
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return {"creationflags": flags}


def resolve_mpv_path() -> Optional[str]:
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


def parse_json_output(raw: str) -> Optional[dict]:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    start = text.rfind("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def run_cli_command(args: list, timeout_sec: int = 25) -> Dict[str, Any]:
    argv = resolve_cli_argv(args)
    cwd = resolve_cli_cwd()
    
    try:
        process = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=cwd,
            **hidden_subprocess_kwargs(),
        )
        
        try:
            output, error = process.communicate(timeout=timeout_sec)
        except subprocess.TimeoutExpired:
            process.kill()
            output, error = process.communicate()

        parsed = parse_json_output(output or "")
        if parsed:
            return {"success": True, "data": parsed}
        
        if process.returncode != 0 and error:
            return {"success": False, "error": error.strip(), "code": process.returncode}
            
        return {"success": True, "raw": (output or "").strip(), "error": (error or "").strip()}
    except Exception as e:
        return {"success": False, "error": str(e)}


def strip_disguise_header(buf: bytes) -> bytes:
    """Strip leading 1x1 PNG disguise used by some HLS CDNs (vivibebe / ibyteimg)."""
    if len(buf) >= 8 and buf[:4] == b"\x89PNG":
        iend = buf.find(b"IEND")
        if iend >= 0 and iend + 8 <= len(buf):
            return buf[iend + 8 :]
    return buf


def default_referer_for(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or ""
        if "vivibebe.site" in host or "ibyteimg.com" in host:
            return "https://vivibebe.site/"
        if "anidb.app" in host:
            return "https://anidb.app/"
        if "allmanga" in host:
            return "https://allmanga.to/"
        if "mp4upload" in host:
            return "https://www.mp4upload.com/"
        return f"{parsed.scheme}://{parsed.netloc}/"
    except Exception:
        return "https://allmanga.to/"


def rewrite_m3u8(content: str, base_url: str, referer: str) -> str:
    lines = content.splitlines()
    rewritten = []
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            rewritten.append(line)
        elif trimmed.startswith("#"):
            if 'URI="' in line:
                def replace_uri(m):
                    orig = m.group(1)
                    abs_u = urllib.parse.urljoin(base_url, orig)
                    enc_u = urllib.parse.quote(abs_u, safe="")
                    enc_r = urllib.parse.quote(referer, safe="")
                    return f'URI="/api/proxy?url={enc_u}&referer={enc_r}"'
                line = re.sub(r'URI="([^"]+)"', replace_uri, line)
            rewritten.append(line)
        else:
            abs_url = urllib.parse.urljoin(base_url, trimmed)
            encoded_url = urllib.parse.quote(abs_url, safe="")
            encoded_ref = urllib.parse.quote(referer, safe="")
            rewritten.append(f"/api/proxy?url={encoded_url}&referer={encoded_ref}")
    return "\n".join(rewritten)


ALLANIME_API_URL = "https://api.mkissa.net/api"
ALLANIME_REFERER = "https://mkissa.to"
ANINEKO_BASE = "https://anineko.to"


def normalize_title(value: Any) -> str:
    return re.sub(r'[^a-z0-9]+', ' ', str(value or '').lower()).strip()


def clean_search_query(query: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9\s]', '', query.lower())).strip()


def score_search_result(query: str, result: Dict[str, Any]) -> int:
    q = normalize_title(query)
    titles = [
        normalize_title(result.get('title')),
        normalize_title(result.get('name')),
        normalize_title(result.get('englishName')),
    ]
    titles = [t for t in titles if t]
    score = 0
    exact_match = False
    for title in titles:
        if title == q:
            exact_match = True
            score = max(score, 100_000)
        elif title.startswith(f"{q} "):
            score = max(score, 20_000)
        elif q in title:
            score = max(score, 5_000)

    title_str = str(result.get('title') or '')
    is_special = bool(re.search(r'\b(movie|special|recap|ova|ona)\b', title_str, re.IGNORECASE))
    asks_special = bool(re.search(r'\b(movie|special|recap|ova|ona)\b', query, re.IGNORECASE))
    if is_special and not asks_special:
        score -= 200_000
    if not asks_special and not exact_match and int(result.get('episodes') or 0) <= 1:
        score -= 200_000
    score += min(int(result.get('episodes') or 0), 1_000)
    return score


def map_show_edges(edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    results = []
    for edge in edges:
        available = edge.get("availableEpisodes") or {}
        episodes = max(
            available.get("sub") or 0,
            available.get("dub") or 0,
            available.get("raw") or 0,
            int(edge.get("episodeCount") or 0),
            1
        )
        season_obj = edge.get("season")
        year = None
        if isinstance(season_obj, dict):
            year = season_obj.get("year")

        title = edge.get("englishName") or edge.get("name")
        if not title:
            continue

        results.append({
            "id": f"allanime-{edge.get('_id')}",
            "title": title,
            "name": edge.get("name"),
            "englishName": edge.get("englishName"),
            "session": f"allanime:{edge.get('_id')}",
            "episodes": episodes,
            "year": year,
            "type": edge.get("type"),
            "status": edge.get("status"),
            "genres": edge.get("genres") or [],
            "poster": edge.get("thumbnail") or None,
            "banner": edge.get("banner") or None,
        })
    return results


def fetch_allanime_shows_gql(
    query_str: Optional[str] = None,
    sort_by: Optional[str] = None,
    limit: int = 40,
    page: int = 1,
    genres: Optional[List[str]] = None,
    year: Optional[int] = None,
    translation_type: str = "sub"
) -> List[Dict[str, Any]]:
    search_params: Dict[str, Any] = {"allowAdult": False, "allowUnknown": False}
    if query_str:
        search_params["query"] = clean_search_query(query_str)
    elif sort_by:
        search_params["sortBy"] = sort_by
        search_params["sortDirection"] = "DSC"

    if genres:
        search_params["genres"] = genres
    if year:
        search_params["year"] = year

    gql = """query ($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges {
      _id
      name
      englishName
      type
      season
      availableEpisodes
      episodeCount
      status
      genres
      thumbnail
      banner
    }
  }
}"""

    req_data = json.dumps({
        "query": gql,
        "variables": {
            "search": search_params,
            "limit": limit,
            "page": page,
            "translationType": translation_type,
            "countryOrigin": "ALL",
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        ALLANIME_API_URL,
        data=req_data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": UA,
            "Origin": ALLANIME_REFERER,
            "Referer": ALLANIME_REFERER,
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            edges = data.get("data", {}).get("shows", {}).get("edges") or []
            return map_show_edges(edges)
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AllAnime GQL error: {str(e)}\n")
            sys.stdout.flush()
        return []


def fetch_anilist_catalog(
    sort_by: str = "TRENDING_DESC",
    limit: int = 18,
    page: int = 1,
    search_query: Optional[str] = None,
    genre: Optional[str] = None,
    year: Optional[int] = None
) -> List[Dict[str, Any]]:
    query = """
    query ($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $genre: String, $seasonYear: Int) {
      Page (page: $page, perPage: $perPage) {
        media (sort: $sort, type: ANIME, isAdult: false, search: $search, genre: $genre, seasonYear: $seasonYear) {
          id
          title { romaji english userPreferred }
          status
          format
          episodes
          seasonYear
          coverImage { extraLarge large medium }
          bannerImage
          averageScore
          description(asHtml: false)
          genres
        }
      }
    }
    """
    variables: Dict[str, Any] = {
        "page": page,
        "perPage": limit,
        "sort": [sort_by] if sort_by else ["TRENDING_DESC"]
    }
    if search_query:
        variables["search"] = search_query
        variables["sort"] = ["SEARCH_MATCH"]
    if genre:
        variables["genre"] = genre
    if year:
        variables["seasonYear"] = year

    req_data = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        "https://graphql.anilist.co",
        data=req_data,
        headers={"Content-Type": "application/json", "User-Agent": UA}
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            media_list = data.get("data", {}).get("Page", {}).get("media") or []
            results = []
            for i, m in enumerate(media_list):
                t_obj = m.get("title") or {}
                title = t_obj.get("english") or t_obj.get("userPreferred") or t_obj.get("romaji") or "Unknown"
                cover = m.get("coverImage") or {}
                poster = cover.get("extraLarge") or cover.get("large") or cover.get("medium")
                results.append({
                    "id": f"anilist-{m.get('id')}",
                    "title": title,
                    "name": t_obj.get("romaji") or title,
                    "englishName": t_obj.get("english") or title,
                    "session": f"anilist:{m.get('id')}",
                    "episodes": m.get("episodes") or 12,
                    "year": m.get("seasonYear"),
                    "type": m.get("format") or "TV",
                    "status": (m.get("status") or "RELEASING").replace("_", " ").title(),
                    "genres": m.get("genres") or [],
                    "poster": poster,
                    "banner": m.get("bannerImage"),
                    "index": i + 1
                })
            return results
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AniList catalog fallback error: {str(e)}\n")
            sys.stdout.flush()
        return []


def search_anime(query: str) -> Dict[str, Any]:
    raw_results = fetch_allanime_shows_gql(query_str=query, limit=40)
    if not raw_results:
        raw_results = fetch_allanime_shows_gql(query_str=query, limit=40, translation_type="dub")
    if not raw_results:
        raw_results = fetch_anilist_catalog(search_query=query, limit=40)

    ranked = sorted(raw_results, key=lambda x: score_search_result(query, x), reverse=True)
    results = []
    for i, r in enumerate(ranked):
        r_copy = dict(r)
        r_copy["index"] = i + 1
        results.append(r_copy)

    return {
        "success": True,
        "data": {
            "type": "search_results",
            "results": results
        }
    }


def get_latest_anime(limit: int = 18) -> Dict[str, Any]:
    raw_results = fetch_allanime_shows_gql(sort_by="Latest_Update", limit=limit)
    if not raw_results:
        raw_results = fetch_anilist_catalog(sort_by="UPDATED_AT_DESC", limit=limit)
    if not raw_results:
        raw_results = fetch_anilist_catalog(sort_by="TRENDING_DESC", limit=limit)

    results = []
    for i, r in enumerate(raw_results[:limit]):
        r_copy = dict(r)
        r_copy["index"] = i + 1
        results.append(r_copy)

    return {
        "success": True,
        "data": {
            "type": "search_results",
            "results": results
        }
    }


def get_popular_anime(limit: int = 40) -> Dict[str, Any]:
    raw_results = fetch_allanime_shows_gql(sort_by="Trending", limit=limit)
    if not raw_results:
        raw_results = fetch_anilist_catalog(sort_by="TRENDING_DESC", limit=limit)
    if not raw_results:
        raw_results = fetch_anilist_catalog(sort_by="POPULARITY_DESC", limit=limit)

    results = []
    for i, r in enumerate(raw_results[:limit]):
        r_copy = dict(r)
        r_copy["index"] = i + 1
        results.append(r_copy)

    return {
        "success": True,
        "data": {
            "type": "search_results",
            "results": results
        }
    }


def browse_anime(page: int = 1, limit: int = 48, genre: str = "", status: str = "", year: Optional[int] = None) -> Dict[str, Any]:
    sort_by = "Latest_Update" if (genre or year) else "Trending"
    genres_list = [genre.strip()] if genre.strip() else None
    raw_results = fetch_allanime_shows_gql(
        sort_by=sort_by,
        limit=limit,
        page=page,
        genres=genres_list,
        year=year
    )
    if not raw_results:
        raw_results = fetch_anilist_catalog(
            sort_by="TRENDING_DESC",
            limit=limit,
            page=page,
            genre=genre if genre else None,
            year=year
        )

    if status:
        filtered = [r for r in raw_results if str(r.get("status", "")).lower() == status.lower()]
    else:
        filtered = raw_results

    results = []
    for i, r in enumerate(filtered[:limit]):
        r_copy = dict(r)
        r_copy["index"] = i + 1
        results.append(r_copy)

    return {
        "success": True,
        "data": {
            "type": "search_results",
            "results": results,
            "hasMore": len(raw_results) >= limit
        }
    }


def get_anime_episodes(title: str = "", index: int = 1, mode: str = "search") -> Dict[str, Any]:
    show_match = None
    if title:
        res = search_anime(title)
        results = res.get("data", {}).get("results", [])
        if results:
            idx = max(0, min(index - 1, len(results) - 1))
            show_match = results[idx]

    if not show_match:
        show_match = {
            "id": f"yorumi-{clean_search_query(title)}",
            "title": title or "Anime",
            "year": None,
            "episodes": 24
        }

    total_episodes = show_match.get("episodes") or 24
    episodes = [
        {
            "id": f"yorumi:{show_match.get('id')}-ep-{i}",
            "session": f"yorumi:{show_match.get('id')}-ep-{i}",
            "episodeNumber": i
        }
        for i in range(1, total_episodes + 1)
    ]

    return {
        "success": True,
        "data": {
            "type": "episodes",
            "anime": {
                "id": show_match.get("id"),
                "title": show_match.get("title"),
                "year": show_match.get("year"),
                "episodes": total_episodes
            },
            "episodes": episodes
        }
    }


def fetch_anineko_streams(title: str, episode: int, audio: str = "sub") -> List[Dict[str, Any]]:
    try:
        clean_t = re.sub(r'\((TV|Dub|Sub|Dubbed|Subbed|Uncensored|Batch|Raw|1080p|720p)\)', '', title, flags=re.IGNORECASE).strip()
        search_url = f"{ANINEKO_BASE}/browser?keyword={urllib.parse.quote(clean_t)}"
        req = urllib.request.Request(search_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as resp:
            search_html = resp.read().decode("utf-8")

        results = []
        for m in re.finditer(r'<a\b[^>]*class=["\'][^"\']*nv-anime-thumb[^"\']*["\'][^>]*>[\s\S]*?</a>', search_html, re.IGNORECASE):
            tag_m = re.search(r'<a\b[^>]*>', m.group(0), re.IGNORECASE)
            tag = tag_m.group(0) if tag_m else ""
            href_m = re.search(r'href=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if not href_m:
                continue
            slug_m = re.search(r'/watch/([^/?#]+)', href_m.group(1))
            if not slug_m:
                continue
            slug = slug_m.group(1)
            title_m = re.search(r'<(?:h3|[^>]+class=["\'][^"\']*nv-anime-title[^"\']*["\'][^>]*)>([\s\S]*?)</(?:h3|[^>]+)>', m.group(0), re.IGNORECASE)
            r_title = re.sub(r'<[^>]*>', '', title_m.group(1)).strip() if title_m else slug.replace('-', ' ')
            results.append({"slug": slug, "text": r_title})

        if not results:
            return []

        expected = re.sub(r'[^a-z0-9]+', '-', clean_t.lower()).strip('-')
        expected_no_the = re.sub(r'^the-', '', expected)
        best_slug = results[0]["slug"]
        best_score = -999999

        for r in results:
            score = 0
            slug = r["slug"].lower()
            slug_no_the = re.sub(r'^the-', '', slug)
            t = r["text"].lower()

            if slug == expected or slug_no_the == expected_no_the:
                score += 2500
            elif t == clean_t.lower():
                score += 2000
            elif slug.startswith(expected) or expected.startswith(slug) or slug_no_the.startswith(expected_no_the):
                score += 1200
            elif clean_t.lower() in t or t in clean_t.lower():
                score += 800

            # TV series preference over Movie/ONA/OVA/Special
            if " tv" in t or "tv " in t or "\ntv" in t or "cc " in t:
                score += 300
            if "movie" in slug or "movie" in t:
                score -= 700
            if "ona" in slug or "ona" in t:
                score -= 600
            if "ova" in slug or "ova" in t:
                score -= 600
            if "special" in slug or "special" in t:
                score -= 600
            if "-season-2" in slug and "2" not in clean_t and "ii" not in clean_t.lower():
                score -= 400

            if score > best_score:
                best_score = score
                best_slug = r["slug"]

        ep_slug = f"ep-{episode}"
        watch_url = f"{ANINEKO_BASE}/watch/{best_slug}/{ep_slug}"
        watch_req = urllib.request.Request(watch_url, headers={
            "User-Agent": UA,
            "Referer": f"{ANINEKO_BASE}/watch/{best_slug}"
        })
        with urllib.request.urlopen(watch_req, timeout=10) as wresp:
            watch_html = wresp.read().decode("utf-8")

        by_audio = {"sub": [], "dub": []}
        for panel in re.finditer(r'<div\b[^>]*class=["\'][^"\']*nv-server-grid[^"\']*["\'][^>]*data-id=["\']([^"\']+)["\'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["\'][^"\']*nv-server-grid|$)', watch_html, re.IGNORECASE):
            raw_audio = panel.group(1).lower()
            panel_audio = "dub" if "dub" in raw_audio else "sub"
            for btn in re.finditer(r'data-video=["\']([^"\']+)["\']', panel.group(2), re.IGNORECASE):
                by_audio[panel_audio].append(html.unescape(btn.group(1)))

        embeds = by_audio.get(audio) or by_audio.get("sub") or []
        streams = []

        for i, embed in enumerate(embeds):
            try:
                embed_req = urllib.request.Request(embed, headers={
                    "User-Agent": UA,
                    "Referer": f"{ANINEKO_BASE}/"
                })
                with urllib.request.urlopen(embed_req, timeout=10) as eresp:
                    embed_html = eresp.read().decode("utf-8")

                patterns = [
                    r'const\s+src\s*=\s*["\'](https?://[^"\']+\.m3u8[^"\']*)["\']',
                    r'file\s*:\s*["\'](https?://[^"\']+\.m3u8[^"\']*)["\']',
                    r'["\'](https?://[^"\']+/master\.m3u8[^"\']*)["\']',
                    r'["\'](https?://[^"\']+\.m3u8[^"\']*)["\']',
                ]
                for p in patterns:
                    m = re.search(p, embed_html, re.IGNORECASE)
                    if m:
                        hls_url = html.unescape(m.group(1))
                        parsed_origin = urllib.parse.urlparse(embed)
                        origin = f"{parsed_origin.scheme}://{parsed_origin.netloc}/"
                        streams.append({
                            "provider": "anineko",
                            "server": f"Server {i+1}",
                            "url": hls_url,
                            "directUrl": hls_url,
                            "quality": "Auto",
                            "audio": audio,
                            "isHls": True,
                            "referer": origin
                        })
                        break
            except Exception:
                continue

        return streams
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AniNeko stream fetch error: {str(e)}\n")
            sys.stdout.flush()
        return []


def fetch_anidb_stream(title: str, episode: int = 1, audio: str = "sub") -> Optional[Dict[str, Any]]:
    try:
        q = urllib.parse.quote(title.strip())
        search_url = f"https://anidb.app/search/suggestions?q={q}"
        req = urllib.request.Request(search_url, headers={"User-Agent": UA, "Referer": "https://anidb.app/"})
        with urllib.request.urlopen(req, timeout=8) as r:
            page = r.read().decode("utf-8")

        m = re.search(r'anime/[a-z0-9-]+-(\d+)', page, re.IGNORECASE)
        if not m:
            return None

        anime_id = m.group(1)
        ep_url = f"https://anidb.app/api/frontend/anime/{anime_id}/episodes"
        req_ep = urllib.request.Request(ep_url, headers={"User-Agent": UA, "Referer": "https://anidb.app/"})
        with urllib.request.urlopen(req_ep, timeout=8) as r:
            ep_data = json.loads(r.read().decode("utf-8"))

        ep_list = ep_data if isinstance(ep_data, list) else (ep_data.get("episodes") or ep_data.get("data") or [])
        target_ep = None
        for e in ep_list:
            if str(e.get("number")) == str(episode):
                target_ep = e
                break

        if not target_ep:
            return None

        ep_id = target_ep.get("id")
        lang_url = f"https://anidb.app/api/frontend/episode/{ep_id}/languages"
        req_lang = urllib.request.Request(lang_url, headers={"User-Agent": UA, "Referer": "https://anidb.app/"})
        with urllib.request.urlopen(req_lang, timeout=8) as r:
            lang_data = json.loads(r.read().decode("utf-8"))

        lang_list = lang_data if isinstance(lang_data, list) else (lang_data.get("languages") or lang_data.get("data") or [])
        pref = "eng" if audio == "dub" else "jpn"
        target_lang = next((l for l in lang_list if l.get("code") == pref), (lang_list[0] if lang_list else None))
        if not target_lang or not target_lang.get("embed_url"):
            return None

        embed_u = target_lang["embed_url"]
        req_embed = urllib.request.Request(embed_u, headers={"User-Agent": UA, "Referer": "https://anidb.app/"})
        with urllib.request.urlopen(req_embed, timeout=8) as r:
            embed_page = r.read().decode("utf-8")

        m3u8_m = re.search(r'file:\s*[\'"]([^\'"]+)[\'"]', embed_page)
        if m3u8_m:
            stream_url = m3u8_m.group(1)
            return {
                "provider": "anidb",
                "server": "AniDB Server",
                "url": stream_url,
                "directUrl": stream_url,
                "quality": "1080p",
                "audio": audio,
                "isHls": True,
                "referer": "https://anidb.app/"
            }
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AniDB fetch error: {type(e).__name__}: {str(e)}\n")
            sys.stdout.flush()
        raise e
    return None


def get_stream(title: str, episode: int = 1, audio: str = "sub") -> Dict[str, Any]:
    # 1. Check AniDB First
    anidb_stream = fetch_anidb_stream(title, episode, audio)
    if anidb_stream:
        return {
            "success": True,
            "data": {
                "type": "streams",
                "anime": {"title": title},
                "episodes": [{
                    "episodeNumber": episode,
                    "stream": anidb_stream,
                    "url": anidb_stream["url"]
                }]
            }
        }

    # 2. Check AniNeko
    streams = fetch_anineko_streams(title, episode, audio)
    if not streams and ":" in title:
        prefix = title.split(":")[0].strip()
        if prefix:
            anidb_stream = fetch_anidb_stream(prefix, episode, audio)
            if anidb_stream:
                streams = [anidb_stream]
            else:
                streams = fetch_anineko_streams(prefix, episode, audio)

    if not streams and " - " in title:
        prefix = title.split(" - ")[0].strip()
        if prefix:
            anidb_stream = fetch_anidb_stream(prefix, episode, audio)
            if anidb_stream:
                streams = [anidb_stream]
            else:
                streams = fetch_anineko_streams(prefix, episode, audio)

    if not streams:
        # Search catalog for alternate titles (romaji, english, original)
        search_res = search_anime(title)
        results = search_res.get("data", {}).get("results", [])
        if results:
            for item in results[:3]:
                for alt_name in [item.get("name"), item.get("englishName"), item.get("title")]:
                    if alt_name and alt_name.lower() != title.lower():
                        anidb_stream = fetch_anidb_stream(alt_name, episode, audio)
                        if anidb_stream:
                            streams = [anidb_stream]
                            break
                        streams = fetch_anineko_streams(alt_name, episode, audio)
                        if streams:
                            break
                if streams:
                    break

    if streams:
        first_stream = streams[0]
        return {
            "success": True,
            "data": {
                "type": "streams",
                "anime": {"title": title},
                "episodes": [{
                    "episodeNumber": episode,
                    "stream": first_stream,
                    "url": first_stream["url"]
                }]
            }
        }

    return {
        "success": False,
        "error": f"No playable stream found for episode {episode}"
    }


def fetch_allanime_show_art(show_id: str) -> Dict[str, Any]:
    """Fetch poster/banner for a show directly from the AllAnime API."""
    show_id = (show_id or "").strip().replace("allanime:", "")
    if not show_id:
        return {}

    try:
        gql = """
        query ($search: SearchInput, $limit: Int, $page: Int, $translationType: VaildTranslationTypeEnumType, $countryOrigin: VaildCountryOriginEnumType) {
          shows(search: $search, limit: $limit, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
            edges { _id thumbnail banner englishName name }
          }
        }
        """
        req_data = json.dumps({
            "query": gql,
            "variables": {
                "search": {"showIds": [show_id], "allowAdult": False, "allowUnknown": False},
                "limit": 1,
                "page": 1,
                "translationType": "sub",
                "countryOrigin": "ALL",
            },
        }).encode("utf-8")
        req = urllib.request.Request(
            ALLANIME_API_URL,
            data=req_data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": UA,
                "Origin": ALLANIME_REFERER,
            },
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            edges = data.get("data", {}).get("shows", {}).get("edges") or []
            if not edges:
                return {}
            edge = edges[0]
            return {
                "poster": edge.get("thumbnail"),
                "banner": edge.get("banner"),
                "title": edge.get("englishName") or edge.get("name"),
            }
    except Exception as e:
        # Log the error but don't fail - return empty dict to allow graceful degradation
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AllAnime API error for showId {show_id}: {str(e)}\n")
            sys.stdout.flush()
        return {}


def fetch_jikan_show_art(title: str) -> Dict[str, Any]:
    """Fetch poster/banner for a show from Jikan API (MyAnimeList wrapper)."""
    if not title:
        return {}

    try:
        # Search for anime by title
        search_url = f"https://api.jikan.moe/v4/anime?q={urllib.parse.quote(title)}&limit=1"
        req = urllib.request.Request(
            search_url,
            headers={"User-Agent": UA},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("data", [])
            if not results:
                return {}
            
            anime = results[0]
            images = anime.get("images", {})
            jpg = images.get("jpg", {})
            webp = images.get("webp", {})
            
            return {
                "poster": webp.get("large_image_url") or webp.get("image_url") or jpg.get("large_image_url") or jpg.get("image_url"),
                "banner": None,  # Jikan doesn't provide banners
                "title": anime.get("title") or anime.get("name"),
            }
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] Jikan API error for title {title}: {str(e)}\n")
            sys.stdout.flush()
        return {}


def fetch_anilist_show_art(title: str) -> Dict[str, Any]:
    """Fetch poster/banner for a show from AniList API."""
    if not title:
        return {}

    try:
        ani_query = """
        query ($search: String) {
          Media(search: $search, type: ANIME) {
            id
            coverImage {
              extraLarge
              large
              medium
            }
            bannerImage
            title {
              romaji
              english
              userPreferred
            }
          }
        }
        """
        req_data = json.dumps({"query": ani_query, "variables": {"search": title}}).encode("utf-8")
        req = urllib.request.Request(
            "https://graphql.anilist.co",
            data=req_data,
            headers={"Content-Type": "application/json", "User-Agent": UA},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            media = data.get("data", {}).get("Media")
            if not media:
                return {}
            
            cover = media.get("coverImage", {})
            title_data = media.get("title", {})
            
            return {
                "poster": cover.get("extraLarge") or cover.get("large") or cover.get("medium"),
                "banner": media.get("bannerImage"),
                "title": title_data.get("english") or title_data.get("userPreferred") or title_data.get("romaji"),
            }
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] AniList API error for title {title}: {str(e)}\n")
            sys.stdout.flush()
        return {}


def fetch_tmdb_show_art(title: str) -> Dict[str, Any]:
    """Fetch poster/banner for a show from TMDB API."""
    if not title:
        return {}

    try:
        # Search for anime by title
        search_url = f"https://api.themoviedb.org/3/search/tv?api_key=2dca580c2a14b55200e784d157207b4d&query={urllib.parse.quote(title)}&first_air_date_year.gte=2000"
        req = urllib.request.Request(
            search_url,
            headers={"User-Agent": UA},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            if not results:
                return {}
            
            # Get the first result
            show = results[0]
            poster_path = show.get("poster_path")
            backdrop_path = show.get("backdrop_path")
            
            if not poster_path:
                return {}
            
            base_url = "https://image.tmdb.org/t/p/w500"
            base_url_original = "https://image.tmdb.org/t/p/original"
            
            return {
                "poster": f"{base_url}{poster_path}" if poster_path else None,
                "banner": f"{base_url_original}{backdrop_path}" if backdrop_path else None,
                "title": show.get("name") or show.get("original_name"),
            }
    except Exception as e:
        if sys.stdout is not None:
            sys.stdout.write(f"[Erumi] TMDB API error for title {title}: {str(e)}\n")
            sys.stdout.flush()
        return {}


def fetch_anilist_recommendations(seed_titles: List[str]) -> List[Dict[str, Any]]:
    """Fetch anime recommendations from AniList based on seed titles (watch history) or trending anime."""
    seen_ids = set()
    results: List[Dict[str, Any]] = []

    clean_seeds = [t.strip() for t in seed_titles if t.strip()]

    if clean_seeds:
        ani_query = """
        query ($search: String) {
          Media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            recommendations(page: 1, perPage: 8, sort: RATING_DESC) {
              nodes {
                mediaRecommendation {
                  id
                  title { romaji english userPreferred }
                  coverImage { large extraLarge }
                  averageScore
                  seasonYear
                  episodes
                  genres
                  format
                }
              }
            }
          }
        }
        """
        for title in clean_seeds:
            req_data = json.dumps({"query": ani_query, "variables": {"search": title}}).encode("utf-8")
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=req_data,
                headers={"Content-Type": "application/json", "User-Agent": UA},
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    media = data.get("data", {}).get("Media")
                    if not media:
                        continue
                    nodes = media.get("recommendations", {}).get("nodes", [])
                    for node in nodes:
                        rec = node.get("mediaRecommendation")
                        if not rec or rec.get("id") in seen_ids:
                            continue
                        seen_ids.add(rec["id"])
                        t = rec.get("title") or {}
                        display_title = t.get("english") or t.get("userPreferred") or t.get("romaji") or "Unknown"
                        cover = rec.get("coverImage") or {}
                        results.append({
                            "id": f"anilist-{rec['id']}",
                            "title": display_title,
                            "year": rec.get("seasonYear"),
                            "episodes": rec.get("episodes"),
                            "score": rec.get("averageScore"),
                            "genres": rec.get("genres") or [],
                            "format": rec.get("format"),
                            "poster": cover.get("extraLarge") or cover.get("large"),
                            "recommended": True,
                        })
            except Exception:
                continue

    # Fallback to high-speed trending query if no seeds or no recommendations found
    if len(results) < 6:
        trending_query = """
        query {
          Page(page: 1, perPage: 18) {
            media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
              id
              title { romaji english userPreferred }
              coverImage { large extraLarge }
              averageScore
              seasonYear
              episodes
              genres
              format
            }
          }
        }
        """
        req_data = json.dumps({"query": trending_query}).encode("utf-8")
        req = urllib.request.Request(
            "https://graphql.anilist.co",
            data=req_data,
            headers={"Content-Type": "application/json", "User-Agent": UA},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                media_list = data.get("data", {}).get("Page", {}).get("media", [])
                for rec in media_list:
                    if not rec or rec.get("id") in seen_ids:
                        continue
                    seen_ids.add(rec["id"])
                    t = rec.get("title") or {}
                    display_title = t.get("english") or t.get("userPreferred") or t.get("romaji") or "Unknown"
                    cover = rec.get("coverImage") or {}
                    results.append({
                        "id": f"anilist-{rec['id']}",
                        "title": display_title,
                        "year": rec.get("seasonYear"),
                        "episodes": rec.get("episodes"),
                        "score": rec.get("averageScore"),
                        "genres": rec.get("genres") or [],
                        "format": rec.get("format"),
                        "poster": cover.get("extraLarge") or cover.get("large"),
                        "recommended": True,
                    })
        except Exception:
            pass

    return results[:24]


class ErumiHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(web_dir()), **kwargs)

    def log_message(self, format, *args):
        try:
            path = getattr(self, "path", "")
            if "/api/proxy" not in path and sys.stdout is not None:
                sys.stdout.write(f"[{self.log_date_time_string()}] {self.command} {path}\n")
                sys.stdout.flush()
        except Exception:
            pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body_json = json.loads(post_data.decode("utf-8")) if post_data else {}
        except Exception:
            body_json = {}

        if path == "/api/settings":
            current_cfg = load_config()
            if isinstance(body_json, dict) and body_json:
                for section, values in body_json.items():
                    if isinstance(values, dict) and section in current_cfg:
                        current_cfg[section].update(values)
                    else:
                        current_cfg[section] = values
                save_config(current_cfg)
            self.send_json({"success": True, "config": current_cfg})
            return

        if path == "/api/cache/clear":
            global CLI_CACHE
            CLI_CACHE.clear()
            self.send_json({"success": True, "message": "In-memory cache cleared successfully", "entries": 0})
            return

        self.send_json({"error": "Not Found"}, status=404)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # ── Stream Diagnostic Endpoint ──
        if path == "/api/debug-stream":
            title = query.get("query", ["KAMUI: He's Behind You"])[0].strip()
            episode_str = query.get("episode", ["1"])[0].strip()
            episode = int(episode_str) if episode_str.isdigit() else 1

            report = {
                "query": title,
                "episode": episode,
                "anidb": {},
                "anineko": {},
                "resolved": False,
                "stream_url": None,
                "proxy_test": {},
            }

            try:
                ad_stream = fetch_anidb_stream(title, episode)
                report["anidb"] = {
                    "success": bool(ad_stream),
                    "url": ad_stream["url"] if ad_stream else None
                }
            except Exception as e:
                report["anidb"] = {"success": False, "error": f"{type(e).__name__}: {str(e)}"}

            try:
                nk_streams = fetch_anineko_streams(title, episode)
                report["anineko"] = {
                    "success": bool(nk_streams),
                    "count": len(nk_streams),
                    "first_url": nk_streams[0]["url"] if nk_streams else None
                }
            except Exception as e:
                report["anineko"] = {"success": False, "error": f"{type(e).__name__}: {str(e)}"}

            try:
                full_stream = get_stream(title, episode)
                report["resolved"] = full_stream.get("success", False)
                report["get_stream_error"] = full_stream.get("error")
                if full_stream.get("success"):
                    stream_obj = full_stream["data"]["episodes"][0]
                    report["stream_url"] = stream_obj["url"]
                    report["provider"] = stream_obj.get("stream", {}).get("provider")
                    
                    proxy_u = stream_obj["url"]
                    ref = stream_obj.get("stream", {}).get("referer", "")
                    p_req = urllib.request.Request(proxy_u, headers={"User-Agent": UA, "Referer": ref})
                    with urllib.request.urlopen(p_req, timeout=5) as pr:
                        sample = pr.read(150)
                        report["proxy_test"] = {
                            "status": pr.status,
                            "content_sample": sample.decode("utf-8", errors="ignore")[:100],
                            "is_valid_hls": b"#EXTM3U" in sample or b"#EXT" in sample
                        }
            except Exception as e:
                report["error"] = f"{type(e).__name__}: {str(e)}"

            self.send_json(report)
            return

        # ── Settings Endpoint ──
        if path == "/api/settings":
            cfg = load_config()
            self.send_json({
                "success": True,
                "config": cfg,
                "stats": {
                    "cli_cache_entries": len(CLI_CACHE),
                    "mpv_available": bool(resolve_mpv_path()),
                    "local_ip": get_local_ip(),
                    "port": CURRENT_PORT,
                    "web_dir": str(web_dir()),
                }
            })
            return

        # ── Network Info Endpoint ──
        if path == "/api/network-info":
            local_ip = get_local_ip()
            url = f"http://{local_ip}:{CURRENT_PORT}"
            self.send_json({
                "local_ip": local_ip,
                "port": CURRENT_PORT,
                "url": url,
                "qr_code_url": f"https://api.qrserver.com/v1/create-qr-code/?size=220x220&data={urllib.parse.quote(url)}&bgcolor=15-19-29&color=243-246-252&margin=10"
            })
            return

        # ── HLS & CORS Proxy Endpoint ──
        if path == "/api/proxy":
            target_url = query.get("url", [""])[0].strip()
            referer = query.get("referer", [""])[0].strip() or default_referer_for(target_url)
            if not target_url:
                self.send_json({"error": "Missing 'url' parameter"}, status=400)
                return
            
            # SSRF Protection Whitelist check
            if not is_trusted_url(target_url):
                self.send_json({"error": "Forbidden: Destination domain is not trusted"}, status=403)
                return
            
            try:
                origin = urllib.parse.urlparse(referer).scheme + "://" + urllib.parse.urlparse(referer).netloc
            except Exception:
                origin = referer

            req = urllib.request.Request(
                target_url,
                headers={
                    "User-Agent": UA,
                    "Referer": referer,
                    "Origin": origin,
                    "Accept": "*/*",
                }
            )

            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    content_type = resp.headers.get("Content-Type", "")
                    
                    is_playlist = (
                        "mpegurl" in content_type.lower()
                        or "m3u8" in content_type.lower()
                        or ".m3u8" in target_url.lower()
                    )

                    if is_playlist:
                        body = resp.read()
                        try:
                            text = body.decode("utf-8", errors="replace")
                            rewritten_text = rewrite_m3u8(text, target_url, referer)
                            out_bytes = rewritten_text.encode("utf-8")
                            self.send_response(200)
                            self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                            self.send_header("Content-Length", str(len(out_bytes)))
                            self.send_header("Access-Control-Allow-Origin", "*")
                            self.send_header("Cache-Control", "no-store")
                            self.end_headers()
                            self.wfile.write(out_bytes)
                            return
                        except Exception:
                            pass

                    # Binary stream segment (.ts video)
                    ct = content_type or "video/mp2t"
                    if "image/png" in ct.lower():
                        ct = "video/mp2t"

                    # Memory-efficient chunked streaming with on-the-fly disguise header stripping
                    first_chunk = resp.read(64 * 1024)
                    
                    diff = 0
                    stripped_chunk = first_chunk
                    if len(first_chunk) >= 8 and first_chunk[:4] == b"\x89PNG":
                        iend = first_chunk.find(b"IEND")
                        if iend >= 0 and iend + 8 <= len(first_chunk):
                            stripped_chunk = first_chunk[iend + 8 :]
                            diff = len(first_chunk) - len(stripped_chunk)

                    content_length = resp.headers.get("Content-Length")
                    self.send_response(200)
                    self.send_header("Content-Type", ct)
                    if content_length:
                        try:
                            adjusted_length = int(content_length) - diff
                            self.send_header("Content-Length", str(adjusted_length))
                        except ValueError:
                            pass
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()

                    if stripped_chunk:
                        self.wfile.write(stripped_chunk)

                    try:
                        while True:
                            chunk = resp.read(64 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                    except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                        pass
            except Exception as e:
                self.send_json({"error": f"Proxy fetch failed: {str(e)}"}, status=502)
            return

        # ── API Routes ──
        if path == "/api/status":
            mpv_path = resolve_mpv_path()
            local_ip = get_local_ip()
            self.send_json({
                "status": "ok",
                "cli_ready": True,
                "mpv_available": bool(mpv_path),
                "mpv_path": mpv_path,
                "local_ip": local_ip,
                "lan_url": f"http://{local_ip}:{CURRENT_PORT}",
            })
            return

        if path == "/api/poster":
            show_id = query.get("showId", query.get("session", [""]))[0].strip()
            show_id = show_id.replace("allanime:", "")
            title = query.get("title", [""])[0].strip()  # Optional title for fallback APIs
            
            # Allow requests with just title (for Jikan/AniList) or just showId (for AllAnime)
            if not show_id and not title:
                self.send_json({"error": "Missing 'showId' or 'title' query parameter"}, status=400)
                return

            # Use title as cache key if showId is not available
            cache_key = ("poster", show_id if show_id else title)
            cached = get_cached_cli_output(cache_key, 86400)
            if cached:
                self.send_json(cached)
                return

            # Load configuration to get image source priority
            config = load_config()
            image_config = config.get("images", {})
            sources = image_config.get("sources", ["allanime", "anilist", "jikan"])
            fallback_enabled = image_config.get("fallback_enabled", True)

            art = {}
            
            # Try sources in configured order
            for source in sources:
                if source == "allanime" and show_id:
                    try:
                        art = fetch_allanime_show_art(show_id)
                        if art.get("poster"):
                            art["source"] = "allanime"
                            break
                    except Exception:
                        pass
                elif source == "anilist" and title:
                    try:
                        anilist_art = fetch_anilist_show_art(title)
                        if anilist_art.get("poster"):
                            art = anilist_art
                            art["source"] = "anilist"
                            break
                    except Exception:
                        pass
                elif source == "jikan" and title:
                    try:
                        jikan_art = fetch_jikan_show_art(title)
                        if jikan_art.get("poster"):
                            art = jikan_art
                            art["source"] = "jikan"
                            break
                    except Exception:
                        pass
                elif source == "tmdb" and title:
                    try:
                        tmdb_art = fetch_tmdb_show_art(title)
                        if tmdb_art.get("poster"):
                            art = tmdb_art
                            art["source"] = "tmdb"
                            break
                    except Exception:
                        pass
                elif not fallback_enabled:
                    break
            
            # Mark source if not already set
            if art.get("poster") and "source" not in art:
                art["source"] = sources[0] if sources else "unknown"
            
            # Even if poster fetch fails, return success with empty data to avoid 502 errors
            # The frontend will handle missing posters gracefully with fallbacks
            res_body = {"success": True, "data": art}
            
            # Only cache successful results with actual poster data
            if art.get("poster"):
                set_cached_cli_output(cache_key, res_body)
            
            self.send_json(res_body)
            return

        if path == "/api/metadata":
            title = query.get("q", [""])[0].strip()
            if not title:
                self.send_json({"error": "Missing 'q' query parameter"}, status=400)
                return

            cache_key = ("metadata", "v2", title.lower().strip())
            cached = get_cached_cli_output(cache_key, 86400)  # 24 hours cache for maximum efficiency
            if cached:
                self.send_json(cached)
                return

            # Try AniList Page fuzzy search first
            ani_query = """
            query ($search: String) {
              Page(page: 1, perPage: 4) {
                media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
                  id
                  title { romaji english userPreferred }
                  status
                  format
                  episodes
                  nextAiringEpisode {
                    episode
                    timeUntilAiring
                  }
                  seasonYear
                  coverImage {
                    extraLarge
                    large
                    medium
                  }
                  bannerImage
                  averageScore
                  description(asHtml: false)
                  genres
                }
              }
            }
            """
            req_data = json.dumps({"query": ani_query, "variables": {"search": title}}).encode("utf-8")
            req = urllib.request.Request(
                "https://graphql.anilist.co",
                data=req_data,
                headers={"Content-Type": "application/json", "User-Agent": UA}
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp_data = json.loads(resp.read().decode("utf-8"))
                    media_list = resp_data.get("data", {}).get("Page", {}).get("media", [])
                    if media_list:
                        # Intelligent Season & Year matching to prevent Season 1 matching Season 2
                        import re
                        def get_sn(t_str: str) -> int:
                            s = (t_str or "").lower()
                            if re.search(r'\b(season\s*4|4th\s*season|iv|s4)\b', s): return 4
                            if re.search(r'\b(season\s*3|3rd\s*season|iii|s3)\b', s): return 3
                            if re.search(r'\b(season\s*2|2nd\s*season|ii|s2|part\s*2|two)\b', s): return 2
                            if re.search(r'\b(season\s*1|1st\s*season|i|s1|part\s*1|one)\b', s): return 1
                            return 1

                        target_season = get_sn(title)
                        year_str = query.get("year", [""])[0].strip()
                        target_year = int(year_str) if year_str.isdigit() else None

                        best_m = media_list[0]
                        best_score = -999

                        for m in media_list:
                            score = 0
                            t_eng = (m.get("title", {}).get("english") or "").lower()
                            t_rom = (m.get("title", {}).get("romaji") or "").lower()
                            c_season = get_sn(t_eng) if get_sn(t_eng) != 1 else get_sn(t_rom)

                            if target_season == c_season:
                                score += 50
                            elif target_season > 1 and c_season == 1:
                                score -= 40
                            elif target_season == 1 and c_season > 1:
                                score -= 40

                            m_year = m.get("seasonYear")
                            if target_year and m_year:
                                if target_year == m_year: score += 30
                                elif abs(target_year - m_year) <= 1: score += 15

                            if m.get("status") == "RELEASING" and target_season > 1:
                                score += 15
                            if "movie" in t_rom and "movie" not in title.lower():
                                score -= 30

                            if score > best_score:
                                best_score = score
                                best_m = m

                        res_body = {"success": True, "data": best_m}
                        set_cached_cli_output(cache_key, res_body)
                        self.send_json(res_body)
                        return
            except Exception as e:
                # AniList failed or rate limited, try TMDB fallback
                pass
            
            # Fallback to TMDB
            try:
                if sys.stdout is not None:
                    sys.stdout.write(f"[Erumi] Trying TMDB fallback for: {title}\n")
                    sys.stdout.flush()
                search_url = f"https://api.themoviedb.org/3/search/tv?api_key=2dca580c2a14b55200e784d157207b4d&query={urllib.parse.quote(title)}&first_air_date_year.gte=2000"
                req = urllib.request.Request(
                    search_url,
                    headers={"User-Agent": UA},
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    results = data.get("results", [])
                    if sys.stdout is not None:
                        sys.stdout.write(f"[Erumi] TMDB search results: {len(results)}\n")
                        sys.stdout.flush()
                    if results:
                        show = results[0]
                        show_id = show.get("id")
                        if show_id:
                            detail_url = f"https://api.themoviedb.org/3/tv/{show_id}?api_key=2dca580c2a14b55200e784d157207b4d"
                            detail_req = urllib.request.Request(
                                detail_url,
                                headers={"User-Agent": UA},
                            )
                            with urllib.request.urlopen(detail_req, timeout=10) as detail_resp:
                                detail_data = json.loads(detail_resp.read().decode("utf-8"))
                                # Map TMDB data to AniList format
                                tmdb_data = {
                                    "id": show_id,
                                    "status": detail_data.get("status", "Unknown"),
                                    "format": "TV",
                                    "episodes": detail_data.get("number_of_episodes"),
                                    "nextAiringEpisode": None,
                                    "coverImage": {
                                        "extraLarge": f"https://image.tmdb.org/t/p/w500{show.get('poster_path')}" if show.get('poster_path') else None,
                                        "large": f"https://image.tmdb.org/t/p/w500{show.get('poster_path')}" if show.get('poster_path') else None,
                                        "medium": f"https://image.tmdb.org/t/p/w300{show.get('poster_path')}" if show.get('poster_path') else None,
                                    },
                                    "bannerImage": f"https://image.tmdb.org/t/p/original{show.get('backdrop_path')}" if show.get('backdrop_path') else None,
                                    "averageScore": detail_data.get("vote_average", 0) * 10,
                                    "description": detail_data.get("overview", ""),
                                    "genres": [g.get("name") for g in detail_data.get("genres", [])]
                                }
                                res_body = {"success": True, "data": tmdb_data}
                                set_cached_cli_output(cache_key, res_body)
                                self.send_json(res_body)
                                return
            except Exception as e:
                if sys.stdout is not None:
                    sys.stdout.write(f"[Erumi] TMDB fallback error: {str(e)}\n")
                    sys.stdout.flush()
                pass
            
            # Both failed, return null
            res_body = {"success": True, "data": None}
            self.send_json(res_body)
            return

        if path == "/api/search":
            q = query.get("q", [""])[0].strip()
            if not q:
                self.send_json({"error": "Missing 'q' query parameter"}, status=400)
                return
            cache_key = ("search", q)
            cached = get_cached_cli_output(cache_key, 3600)  # 1 hour
            if cached:
                self.send_json(cached)
                return
            res = search_anime(q)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/latest":
            limit_str = query.get("limit", ["18"])[0].strip()
            limit = int(limit_str) if limit_str.isdigit() else 18
            cache_key = ("latest", str(limit))
            cached = get_cached_cli_output(cache_key, 600)  # 10 minutes
            if cached:
                self.send_json(cached)
                return
            res = get_latest_anime(limit=limit)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/browse":
            page_str = query.get("page", ["1"])[0].strip()
            limit_str = query.get("limit", ["48"])[0].strip()
            page = int(page_str) if page_str.isdigit() else 1
            limit = int(limit_str) if limit_str.isdigit() else 48
            genre = query.get("genre", [""])[0].strip()
            status = query.get("status", [""])[0].strip()
            year_str = query.get("year", [""])[0].strip()
            year = int(year_str) if year_str.isdigit() else None
            cache_key = ("browse", genre, status, str(year), str(page), str(limit))
            cached = get_cached_cli_output(cache_key, 1800)
            if cached:
                self.send_json(cached)
                return
            res = browse_anime(page=page, limit=limit, genre=genre, status=status, year=year)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/recommendations":
            titles_raw = query.get("titles", [""])[0].strip()
            seed_titles = [t.strip() for t in titles_raw.split("|") if t.strip()][:3]
            limit_raw = query.get("limit", ["14"])[0].strip()
            limit_int = int(limit_raw) if limit_raw.isdigit() else 14
            cache_key = ("recommendations", "v3", "|".join(seed_titles), str(limit_int))
            cached = get_cached_cli_output(cache_key, 1800)
            if cached:
                self.send_json(cached)
                return

            recs = fetch_anilist_recommendations(seed_titles)
            if recs:
                res = {"success": True, "data": {"type": "search_results", "results": recs[:limit_int]}}
                set_cached_cli_output(cache_key, res)
                self.send_json(res)
                return

            res = get_popular_anime(limit=limit_int)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/popular":
            cache_key = ("popular",)
            cached = get_cached_cli_output(cache_key, 3600)  # 1 hour
            if cached:
                self.send_json(cached)
                return
            res = get_popular_anime(limit=40)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/episodes":
            title = query.get("query", [""])[0].strip()
            mode = query.get("mode", [""])[0].strip()
            index_str = query.get("index", ["1"])[0].strip()
            index = int(index_str) if index_str.isdigit() else 1

            if not title and not mode:
                self.send_json({"error": "Missing 'query' or 'mode' parameter"}, status=400)
                return

            cache_key = ("episodes", title, mode, str(index))
            cached = get_cached_cli_output(cache_key, 600)  # 10 minutes
            if cached:
                self.send_json(cached)
                return

            # If mode provided without title, look up title from mode
            target_title = title
            if not target_title:
                if mode == "latest":
                    l_res = get_latest_anime(18)
                    items = l_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")
                elif mode == "popular":
                    p_res = get_popular_anime(40)
                    items = p_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")

            res = get_anime_episodes(title=target_title, index=index, mode=mode)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/stream":
            title = query.get("query", [""])[0].strip()
            mode = query.get("mode", [""])[0].strip()
            index_str = query.get("index", ["1"])[0].strip()
            index = int(index_str) if index_str.isdigit() else 1
            episode_str = query.get("episode", ["1"])[0].strip()
            episode = int(episode_str) if episode_str.isdigit() else 1

            if not title and not mode:
                self.send_json({"error": "Missing 'query' or 'mode' parameter"}, status=400)
                return

            cache_key = ("stream", title, mode, str(index), str(episode))
            cached = get_cached_cli_output(cache_key, 1800)  # 30 minutes
            if cached:
                self.send_json(cached)
                return

            target_title = title
            if not target_title:
                if mode == "latest":
                    l_res = get_latest_anime(18)
                    items = l_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")
                elif mode == "popular":
                    p_res = get_popular_anime(40)
                    items = p_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")

            res = get_stream(target_title, episode=episode)
            if res.get("success"):
                set_cached_cli_output(cache_key, res)
            self.send_json(res)
            return

        if path == "/api/play-mpv":
            title = query.get("query", [""])[0].strip()
            mode = query.get("mode", [""])[0].strip()
            index_str = query.get("index", ["1"])[0].strip()
            index = int(index_str) if index_str.isdigit() else 1
            episode_str = query.get("episode", ["1"])[0].strip()
            episode = int(episode_str) if episode_str.isdigit() else 1

            if not title and not mode:
                self.send_json({"error": "Missing 'query' or 'mode' parameter"}, status=400)
                return

            target_title = title
            if not target_title:
                if mode == "latest":
                    l_res = get_latest_anime(18)
                    items = l_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")
                elif mode == "popular":
                    p_res = get_popular_anime(40)
                    items = p_res.get("data", {}).get("results", [])
                    if items and index <= len(items):
                        target_title = items[index - 1].get("title", "")

            res = get_stream(target_title, episode=episode)
            if res.get("success") and res.get("data", {}).get("episodes"):
                ep_obj = res["data"]["episodes"][0]
                stream_url = ep_obj.get("url")
                stream_meta = ep_obj.get("stream") or {}
                referer = stream_meta.get("referer") or "https://bibiemb.xyz/"
                mpv_path = resolve_mpv_path()
                if not mpv_path:
                    self.send_json({"success": False, "error": "MPV Player was not found on your PC."}, status=404)
                    return
                try:
                    subprocess.Popen(
                        [mpv_path, stream_url, f"--http-header-fields=Referer: {referer}", f"--title={target_title} - Episode {episode}"],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        **hidden_subprocess_kwargs()
                    )
                    self.send_json({"success": True, "message": f"Playing Episode {episode} in MPV"})
                except Exception as e:
                    self.send_json({"success": False, "error": str(e)}, status=500)
            else:
                self.send_json({"success": False, "error": res.get("error", "Could not resolve stream")}, status=500)
            return

        # ── Static Web Files ──
        return super().do_GET()


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server_in_background(port: int = 3000):
    global CURRENT_PORT, SERVER_INSTANCE

    web_dir().mkdir(parents=True, exist_ok=True)
    handler = ErumiHTTPRequestHandler

    for p in range(port, port + 10):
        try:
            httpd = ThreadedTCPServer(("", p), handler)
            CURRENT_PORT = p
            SERVER_INSTANCE = httpd
            thread = threading.Thread(target=httpd.serve_forever, daemon=True)
            thread.start()
            return httpd
        except OSError:
            continue

    raise RuntimeError(f"Could not bind to any port between {port} and {port+9}")


def stop_server():
    global SERVER_INSTANCE
    if SERVER_INSTANCE:
        try:
            SERVER_INSTANCE.shutdown()
            SERVER_INSTANCE.server_close()
        except Exception:
            pass
        SERVER_INSTANCE = None


def run_server(port: int = 3000):
    global CURRENT_PORT
    CURRENT_PORT = port

    web_dir().mkdir(parents=True, exist_ok=True)
    handler = ErumiHTTPRequestHandler
    local_ip = get_local_ip()
    
    with ThreadedTCPServer(("", port), handler) as httpd:
        if sys.stdout is not None:
            try:
                print("==========================================================")
                print("  [Erumi] Anime Streaming Web Server Running!")
                print(f"  Local PC URL:       http://localhost:{port}")
                print(f"  Same Wi-Fi LAN URL: http://{local_ip}:{port}")
                print("  (Open the Wi-Fi URL on your Phone, Tablet, or Smart TV)")
                print("  HLS CORS Proxy:     Enabled (/api/proxy)")
                print("  Press Ctrl+C to stop.")
                print("==========================================================")
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.shutdown()
            httpd.server_close()


if __name__ == "__main__":
    port = 3000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
