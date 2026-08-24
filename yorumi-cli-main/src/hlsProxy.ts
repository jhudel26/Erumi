import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let server: http.Server | null = null;
let port = 0;

/** Strip a leading 1x1 PNG disguise used by some HLS CDNs (vivibebe / ibyteimg). */
export function stripDisguiseHeader(buf: Buffer): Buffer {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const iend = buf.indexOf(Buffer.from('IEND'));
    if (iend >= 0 && iend + 8 <= buf.length) {
      return buf.subarray(iend + 8);
    }
  }
  return buf;
}

export function needsPngHlsProxy(url: string): boolean {
  return /vivibebe\.site|(^|\.)ibyteimg\.com$/i.test(url) || /\/public\/stream\//i.test(url);
}

export function defaultRefererFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/vivibebe\.site$/i.test(host) || /ibyteimg\.com$/i.test(host)) {
      return 'https://vivibebe.site/';
    }
    return `${new URL(url).origin}/`;
  } catch {
    return 'https://vivibebe.site/';
  }
}

async function fetchUpstream(target: string, referer: string): Promise<Response> {
  return fetch(target, {
    headers: {
      'User-Agent': UA,
      Referer: referer,
      Origin: new URL(referer).origin,
      Accept: '*/*',
    },
    redirect: 'follow',
  });
}

function rewritePlaylist(text: string, playlistUrl: string, referer: string, proxyPort: number): string {
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

function attachHandler(httpServer: http.Server, boundPort: number) {
  httpServer.on('request', async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`);
      if (reqUrl.pathname !== '/proxy') {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const target = reqUrl.searchParams.get('url');
      const referer = reqUrl.searchParams.get('referer') || 'https://vivibebe.site/';
      if (!target) {
        res.writeHead(400);
        res.end('missing url');
        return;
      }

      const upstream = await fetchUpstream(target, referer);
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

      if (isPlaylist) {
        const rewritten = rewritePlaylist(buf.toString('utf8'), target, referer, boundPort);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(rewritten);
        return;
      }

      const out = stripDisguiseHeader(buf);
      res.writeHead(200, {
        'Content-Type': 'video/mp2t',
        'Content-Length': out.length,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(out);
    } catch (error: any) {
      res.writeHead(502);
      res.end(String(error?.message || error));
    }
  });
}

export async function ensureHlsProxy(): Promise<number> {
  if (server && port) return port;

  return new Promise((resolve, reject) => {
    const httpServer = http.createServer();
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind HLS proxy'));
        return;
      }
      port = addr.port;
      server = httpServer;
      attachHandler(httpServer, port);
      resolve(port);
    });
    httpServer.on('error', reject);
  });
}

/** Try the Yorumi backend proxy first (when a local API is running). */
export async function tryBackendHlsProxy(url: string, referer: string): Promise<string | null> {
  const proxy =
    `http://127.0.0.1:3001/api/scraper/proxy?url=${encodeURIComponent(url)}` +
    `&referer=${encodeURIComponent(referer)}&proxyMedia=1`;
  try {
    const res = await fetch(proxy, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    // Only sniff the start of the body — never download a full media stream here
    const reader = res.body?.getReader();
    if (!reader) return null;
    const { value } = await reader.read();
    reader.cancel().catch(() => undefined);
    const sample = Buffer.from(value || []).subarray(0, 16).toString('utf8');
    if (sample.includes('#EXTM3U') || sample.includes('#EXT')) return proxy;
    return null;
  } catch {
    return null;
  }
}

export async function wrapPngDisguisedHls(url: string, referer?: string): Promise<string> {
  const ref = referer || defaultRefererFor(url);
  const backend = await tryBackendHlsProxy(url, ref);
  if (backend) return backend;

  const proxyPort = await ensureHlsProxy();
  return `http://127.0.0.1:${proxyPort}/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(ref)}`;
}

/**
 * Keep a proxy alive after this process exits (for --json + external mpv).
 * Falls back to in-process proxy if spawn fails.
 */
export async function wrapPngDisguisedHlsDetached(url: string, referer?: string): Promise<string> {
  const ref = referer || defaultRefererFor(url);
  const backend = await tryBackendHlsProxy(url, ref);
  if (backend) return backend;

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const helper = join(here, 'hlsProxyDaemon.ts');
    const tsxCli = join(here, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsxCli, helper, url, ref], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const proxied = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('proxy daemon timeout')), 8000);
      let buf = '';
      child.stdout?.on('data', (chunk) => {
        buf += String(chunk);
        const line = buf.split(/\r?\n/).find((l) => l.startsWith('PROXY '))?.trim();
        if (line) {
          clearTimeout(timer);
          resolve(line.slice('PROXY '.length));
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (!buf.includes('PROXY ')) reject(new Error(`proxy daemon exited ${code}`));
      });
    });
    child.unref();
    return proxied;
  } catch {
    return wrapPngDisguisedHls(url, ref);
  }
}
