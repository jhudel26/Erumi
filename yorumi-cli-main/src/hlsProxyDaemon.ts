/**
 * Detached HLS proxy daemon for --json / external players.
 * Usage: tsx hlsProxyDaemon.ts <m3u8-url> <referer>
 * Prints: PROXY <local-url>
 * Exits after idle timeout (keeps serving while mpv is active).
 */
import http from 'node:http';
import { stripDisguiseHeader } from './hlsProxy.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const targetMaster = process.argv[2];
const referer = process.argv[3] || 'https://vivibebe.site/';
if (!targetMaster) {
  console.error('Usage: hlsProxyDaemon.ts <m3u8-url> [referer]');
  process.exit(1);
}

const IDLE_MS = 45 * 60 * 1000;
let lastHit = Date.now();

function touch() {
  lastHit = Date.now();
}

function rewritePlaylist(text: string, playlistUrl: string, proxyPort: number): string {
  const base = new URL(playlistUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).href;
      return `http://127.0.0.1:${proxyPort}/proxy?url=${encodeURIComponent(absolute)}&referer=${encodeURIComponent(referer)}`;
    })
    .join('\n');
}

const server = http.createServer(async (req, res) => {
  touch();
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (reqUrl.pathname !== '/proxy') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const target = reqUrl.searchParams.get('url');
    const ref = reqUrl.searchParams.get('referer') || referer;
    if (!target) {
      res.writeHead(400);
      res.end('missing url');
      return;
    }

    const upstream = await fetch(target, {
      headers: {
        'User-Agent': UA,
        Referer: ref,
        Origin: new URL(ref).origin,
        Accept: '*/*',
      },
    });
    if (!upstream.ok) {
      res.writeHead(upstream.status);
      res.end(`upstream ${upstream.status}`);
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    const ct = String(upstream.headers.get('content-type') || '');
    const isPlaylist =
      /mpegurl|m3u8/i.test(ct) ||
      /\.m3u8(?:[?#]|$)/i.test(target) ||
      buf.subarray(0, 12).toString('utf8').includes('#EXTM3U');

    const addr = server.address();
    const proxyPort = addr && typeof addr === 'object' ? addr.port : 0;

    if (isPlaylist) {
      const rewritten = rewritePlaylist(buf.toString('utf8'), target, proxyPort);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
      });
      res.end(rewritten);
      return;
    }

    const out = stripDisguiseHeader(buf);
    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Content-Length': out.length,
      'Cache-Control': 'no-store',
    });
    res.end(out);
  } catch (error: any) {
    res.writeHead(502);
    res.end(String(error?.message || error));
  }
});

server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    console.error('bind failed');
    process.exit(1);
  }
  const proxied =
    `http://127.0.0.1:${addr.port}/proxy?url=${encodeURIComponent(targetMaster)}` +
    `&referer=${encodeURIComponent(referer)}`;
  process.stdout.write(`PROXY ${proxied}\n`);
});

setInterval(() => {
  if (Date.now() - lastHit > IDLE_MS) {
    server.close(() => process.exit(0));
  }
}, 30_000).unref();
