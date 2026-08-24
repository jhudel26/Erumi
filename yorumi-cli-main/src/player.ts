import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { StreamLink } from './types.js';
import { commandExists } from './utils.js';
const GENERIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const resolvePlayerCommand = async (player: string) => {
  if (existsSync(player)) return player;
  if (await commandExists(player)) return player;

  if (platform() !== 'win32') return null;

  const candidates = [
    'C:\\Program Files\\MPV Player\\mpv.exe',
    'C:\\Program Files (x86)\\MPV Player\\mpv.exe',
    'C:\\Program Files\\mpv\\mpv.exe',
    'C:\\Program Files (x86)\\mpv\\mpv.exe',
    'C:\\Program Files\\mpv.net\\mpvnet.exe',
    'C:\\Program Files (x86)\\mpv.net\\mpvnet.exe',
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
};

export const getStreamReferer = (stream?: StreamLink) => {
  if (stream?.referer) return stream.referer;

  const streamUrl = String(stream?.url || stream?.directUrl || '').trim();
  try {
    const parsed = new URL(streamUrl);
    if (/(^|\.)googlevideo\.com$/i.test(parsed.hostname)) return 'https://www.youtube.com/';
    if (/(^|\.)mp4upload\.com$/i.test(parsed.hostname)) return 'https://www.mp4upload.com/';
    if (/(^|\.)vivibebe\.site$/i.test(parsed.hostname)) return 'https://vivibebe.site/';
    if (/(^|\.)ibyteimg\.com$/i.test(parsed.hostname)) return 'https://vivibebe.site/';
    if (/^([^/]+\.)?kwik\./i.test(parsed.host)) return `${parsed.origin}/`;
    if (stream?.provider === 'allmanga') return 'https://allmanga.to/';
    if (stream?.provider === 'anineko') return 'https://vivibebe.site/';
    if (/^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)) return 'https://vivibebe.site/';
  } catch {
    // Fall back below
  }
  return 'https://allmanga.to/';
};

export const getStreamOrigin = (referer: string) => {
  if (referer === 'https://allmanga.to/') return 'https://allmanga.to';
  return referer.replace(/\/$/, '');
};

const isDirectMediaUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (/\.(m3u8|mp4|mkv|webm|mov)(?:[?#]|$)/i.test(url)) return true;
    if (/(^|\.)googlevideo\.com$/i.test(host)) return true;
    if (/(^|\.)allanime\.day$/i.test(host)) return true;
    if (/(^|\.)wixmp\.com$/i.test(host)) return true;
    if (/(^|\.)okcdn\.ru$/i.test(host)) return true;
    if (/(^|\.)megaplay\.su$/i.test(host)) return true;
    if (/^(localhost|127\.0\.0\.1)$/i.test(host)) return true;
  } catch {
    // Fall through to false.
  }

  return false;
};

const resolveWithYtdlp = (url: string, referer: string) => {
  const result = spawnSync('yt-dlp', [
    '--no-playlist',
    '--dump-json',
    '--format',
    'best[height<=?720]/best',
    '--referer',
    referer,
    '--user-agent',
    GENERIC_UA,
    url,
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  });

  if (result.status !== 0 || !result.stdout.trim()) return null;

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const directUrl = String(parsed?.url || parsed?.requested_downloads?.[0]?.url || '').trim();
    if (!directUrl) return null;

    const headers = parsed?.http_headers || {};
    return {
      url: directUrl,
      referer: String(headers.Referer || headers.referer || referer),
      userAgent: String(headers['User-Agent'] || headers['user-agent'] || GENERIC_UA),
    };
  } catch {
    return null;
  }
};

export const playInMediaPlayer = async (urls: string[], player: string, title: string, size: string, referer: string) => {
  const playerCommand = await resolvePlayerCommand(player);
  if (!playerCommand) {
    console.error(`${player} was not found, so no media-player popup can be opened.`);
    console.error('Install mpv, then reopen your terminal: winget install mpv');
    console.error('Or pass the player path: yorumi-cli -p "C:\\Path\\To\\mpv.exe" "Frieren"');
    console.error(`Resolved stream URL: ${urls[0] || ''}`);
    return;
  }

  const origin = getStreamOrigin(referer);
  const originalUrls = [...urls];
  let playbackUrls = [...urls];
  let playbackReferer = referer;
  let playbackUserAgent = GENERIC_UA;

  const args = [
    '--force-window=immediate',
    '--fullscreen=no',
    `--geometry=${size}+50%+50%`,
    '--autofit-larger=70%x70%',
    '--keepaspect=yes',
    `--title=${title}`,
    '--msg-level=ffmpeg/demuxer=info,demux=info,cplayer=info',
    '--demuxer-lavf-o=allowed_extensions=ALL',
  ];

  // Only force custom HTTP headers if it's a direct raw stream or wixmp.
  // Passing these headers for iframes overrides yt-dlp and breaks it.
  let isDirect = playbackUrls.every((url) => isDirectMediaUrl(url));
                   
  args.push('--hls-bitrate=max'); // Force highest quality for all HLS streams
  
  if (!isDirect) {
    if (!(await commandExists('yt-dlp'))) {
      console.error('\n[Error] yt-dlp is required to play this stream but was not found.');
      console.error('Please install it using: winget install yt-dlp.yt-dlp');
      console.error('After installation, restart your terminal to update the PATH.');
      return;
    }

    console.log('Resolving external player URL with yt-dlp...');
    const resolvedUrls = [];
    let firstResolved: ReturnType<typeof resolveWithYtdlp> = null;

    for (const url of playbackUrls) {
      if (isDirectMediaUrl(url)) {
        resolvedUrls.push(url);
        continue;
      }

      const resolved = resolveWithYtdlp(url, playbackReferer);
      if (!resolved) {
        resolvedUrls.length = 0;
        break;
      }

      firstResolved ||= resolved;
      resolvedUrls.push(resolved.url);
    }

    if (resolvedUrls.length === playbackUrls.length) {
      playbackUrls = resolvedUrls;
      playbackReferer = firstResolved?.referer || playbackReferer;
      playbackUserAgent = firstResolved?.userAgent || playbackUserAgent;
      isDirect = true;
    } else {
      console.error('\n[Error] yt-dlp failed to resolve the stream. The video might be blocked or unavailable.');
      return;
    }
  }

  if (isDirect) {
    args.push('--no-ytdl');
    args.push(`--referrer=${playbackReferer}`);
    args.push(`--user-agent=${playbackUserAgent}`);
  } else {
    args.push('--ytdl-format=best[height<=?720]/best');
    // Important: Pass referer and user-agent to yt-dlp so it doesn't get blocked.
    // We must use the explicit 'referer' and 'user-agent' yt-dlp arguments instead to pass both!
    const safeUa = playbackUserAgent.replace(/,/g, '');
    args.push(`--ytdl-raw-options=referer=${playbackReferer},user-agent=${safeUa}`);
  }

  args.push(...playbackUrls);
  const child = spawn(playerCommand, args, {
    stdio: 'ignore',
    windowsHide: false,
  });

  await new Promise<void>((resolve, reject) => {
    child.once('error', (error: Error) => {
      reject(error);
    });
    child.once('exit', (code: number | null) => {
      if (code !== null && code !== 0) {
        reject(new Error(`${playerCommand} exited with code ${code}. Re-run with --print-url to debug the stream URL.`));
      } else {
        resolve();
      }
    });
  });
};
