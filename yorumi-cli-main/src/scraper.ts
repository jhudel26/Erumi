import { StreamLink, AnimeSearchResult, Episode } from './types.js';
import { fetchAllAnimeStreams } from './allanime.js';
import {
  defaultRefererFor,
  needsPngHlsProxy,
  wrapPngDisguisedHls,
} from './hlsProxy.js';

import https from 'node:https';
import http from 'node:http';

function isStreamValid(url: string, referer: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (/streamlare\.com/i.test(url)) return resolve(false);

    // For iframe fallbacks (like mp4upload), fetch the HTML and check if the video was deleted
    if (!/\.(m3u8|mkv|mp4)(\?|$)/i.test(url) && !/googlevideo\.com|allanime\.day|wixmp\.com|fast4speed\.rsvp/i.test(url)) {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 4000);
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer }, signal: ac.signal })
        .then(async res => {
          clearTimeout(timeout);
          if (!res.ok) return resolve(false);
          const html = await res.text();
          if (/file was deleted|video not found|404 not found|redirecting/i.test(html)) return resolve(false);
          resolve(true);
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve(false);
        });
      return;
    }
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer,
        'Range': 'bytes=0-100' // Use Range GET to mimic player
      }
    }, (res) => {
      // Valid if not 4xx or 5xx
      if (res.statusCode && res.statusCode < 400) resolve(true);
      else resolve(false);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function finalizePlayable(
  stream: StreamLink,
  url: string,
  _detachProxy: boolean,
): Promise<{ stream: StreamLink; url: string }> {
  const referer = stream.referer || defaultRefererFor(url);
  const enriched: StreamLink = { ...stream, referer, url };

  // Always use the in-process proxy. Callers that open mpv in-process keep it alive.
  // GUI play launches the CLI without --json so the proxy stays up during playback.
  if (needsPngHlsProxy(url) || (/vivibebe\.site/i.test(url) && /\.m3u8/i.test(url))) {
    const wrapped = await wrapPngDisguisedHls(url, referer);
    return {
      stream: { ...enriched, url: wrapped, isHls: true },
      url: wrapped,
    };
  }

  return { stream: enriched, url };
}

export const resolveEpisodeStreamUrl = async (
  anime: AnimeSearchResult,
  episode: Episode,
  directPlay: boolean,
  sub: boolean,
  dub: boolean,
  selectStream: boolean = false,
  detachProxy: boolean = false,
): Promise<{ stream: StreamLink; url: string }> => {
  const epNum = episode.episodeNumber;
  const isAllAnime = anime.session.startsWith('allanime:');
  const cleanTitle = anime.title.replace(/\(Dub\)/i, '').trim();

  if (!isAllAnime) {
    // nocache=1 ensures we bypass stale in-memory cache on the backend
    const backendUrl = `http://localhost:3001/api/anime/stream?id=${anime.id}&episode=${epNum}&source=anineko&nocache=1`;

    try {
      const res = await fetch(backendUrl);
      if (!res.ok) throw new Error('Backend failed to resolve stream');
      const data: any = await res.json();

      if (!data || (!data.m3u8 && !data.url)) {
        throw new Error('No stream found in backend response');
      }

      // Reject player iframe/embed URLs — mpv can't play them directly
      const rawUrl: string = data.m3u8 || data.url;
      const path = rawUrl.replace(/^https?:\/\/[^/]+/, '');
      if (/player\.(videasy|vidsrc|2embed)/.test(rawUrl) || /^\/anime\/\d+\/\d+/.test(path)) {
        throw new Error(`Backend returned an embed URL (${data.source}), not a direct stream`);
      }

      let streamUrl = rawUrl;
      const referer = data.referer || 'https://vivibebe.site/';

      // Prefer backend PNG-stripping proxy when the API is up
      if (/\.m3u8/i.test(streamUrl)) {
        streamUrl = `http://localhost:3001/api/scraper/proxy?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(referer)}&proxyMedia=1`;
      }

      const streamObj: StreamLink = {
        provider: data.source || 'anineko',
        server: 'vivibebe',
        url: streamUrl,
        quality: 'Auto',
        audio: 'sub',
        isHls: true,
        referer,
      };

      // If backend proxy host isn't actually reachable, fall through to other providers
      try {
        const probe = await fetch(streamUrl, { signal: AbortSignal.timeout(2500) });
        if (probe.ok) return { stream: streamObj, url: streamUrl };
      } catch {
        // continue to AllAnime / AniNeko
      }
    } catch (error: any) {
      console.error('Failed to get stream from local backend:', error.message);
    }
  }

  const order = [];
  if (sub && !dub) order.push('sub');
  else if (dub && !sub) order.push('dub');
  else order.push('sub', 'dub');

  const allValidStreams: StreamLink[] = [];
  const showId = isAllAnime ? anime.session.replace('allanime:', '') : undefined;

  for (const audio of order) {
    const allAnimeStreams = await fetchAllAnimeStreams(cleanTitle, epNum, audio, showId);
    for (const stream of allAnimeStreams) {
      const streamUrl = stream.directUrl || stream.url;
      if (/googlevideo\.com|allanime\.day|wixmp\.com|fast4speed\.rsvp/i.test(streamUrl) || await isStreamValid(streamUrl, 'https://allmanga.to')) {
        if (!selectStream) return finalizePlayable(stream, streamUrl, detachProxy);
        allValidStreams.push(stream);
      }
    }
  }

  // Fallback to AniNeko provider if AllAnime fails
  if (allValidStreams.length === 0) {
    const { fetchAniNekoStreams } = await import('./anineko.js');
    for (const audio of order as ('sub' | 'dub')[]) {
      const aniNekoStreams = await fetchAniNekoStreams(cleanTitle, epNum, audio);
      for (const stream of aniNekoStreams) {
        const streamUrl = stream.directUrl || stream.url;
        const referer = stream.referer || defaultRefererFor(streamUrl);
        if (!(await isStreamValid(streamUrl, referer))) continue;
        if (!selectStream) return finalizePlayable(stream as StreamLink, streamUrl, detachProxy);
        allValidStreams.push(stream as StreamLink);
      }
    }
  }

  if (allValidStreams.length > 0) {
    if (selectStream) {
      const { chooseFromList } = await import('./utils.js');
      const selected = await chooseFromList(
        'Stream Quality / Server',
        allValidStreams,
        (stream) => `[${stream.provider}] ${stream.server || 'Server'} - ${stream.quality} ${String(stream.audio || '').toUpperCase()}`
      );
      return finalizePlayable(selected, selected.directUrl || selected.url, detachProxy);
    }

    const first = allValidStreams[0];
    return finalizePlayable(first, first.directUrl || first.url, detachProxy);
  }

  throw new Error(`No playable stream found for episode ${epNum}`);
};
