import { fetchAllAnimeStreams } from './allanime.js';
import https from 'node:https';
import http from 'node:http';
function isStreamValid(url, referer) {
    return new Promise((resolve) => {
        if (/streamlare\.com/i.test(url))
            return resolve(false);
        // For iframe fallbacks (like mp4upload), fetch the HTML and check if the video was deleted
        if (!/\.(m3u8|mkv|mp4)(\?|$)/i.test(url) && !/googlevideo\.com|allanime\.day|wixmp\.com|fast4speed\.rsvp/i.test(url)) {
            const ac = new AbortController();
            const timeout = setTimeout(() => ac.abort(), 4000);
            fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': referer }, signal: ac.signal })
                .then(async (res) => {
                clearTimeout(timeout);
                if (!res.ok)
                    return resolve(false);
                const html = await res.text();
                if (/file was deleted|video not found|404 not found|redirecting/i.test(html))
                    return resolve(false);
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
            if (res.statusCode && res.statusCode < 400)
                resolve(true);
            else
                resolve(false);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(4000, () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}
export const resolveEpisodeStreamUrl = async (anime, episode, directPlay, sub, dub, selectStream = false) => {
    const epNum = episode.episodeNumber;
    const isAllAnime = anime.session.startsWith('allanime:');
    const cleanTitle = anime.title.replace(/\(Dub\)/i, '').trim();
    if (!isAllAnime) {
        // nocache=1 ensures we bypass stale in-memory cache on the backend
        const backendUrl = `http://localhost:3001/api/anime/stream?id=${anime.id}&episode=${epNum}&source=anineko&nocache=1`;
        try {
            const res = await fetch(backendUrl);
            if (!res.ok)
                throw new Error('Backend failed to resolve stream');
            const data = await res.json();
            if (!data || (!data.m3u8 && !data.url)) {
                throw new Error('No stream found in backend response');
            }
            // Reject player iframe/embed URLs — mpv can't play them directly
            const rawUrl = data.m3u8 || data.url;
            const path = rawUrl.replace(/^https?:\/\/[^/]+/, '');
            if (/player\.(videasy|vidsrc|2embed)/.test(rawUrl) || /^\/anime\/\d+\/\d+/.test(path)) {
                throw new Error(`Backend returned an embed URL (${data.source}), not a direct stream`);
            }
            let streamUrl = rawUrl;
            const referer = data.referer || 'https://vivibebe.site/';
            // If it's an HLS stream, pass it through the backend proxy so PNG headers are stripped
            if (/\.m3u8/i.test(streamUrl)) {
                streamUrl = `http://localhost:3001/api/scraper/proxy?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(referer)}&proxyMedia=1`;
            }
            const streamObj = {
                provider: data.source || 'anineko',
                server: 'vivibebe',
                url: streamUrl,
                quality: 'Auto',
                audio: 'sub',
                isHls: /\.m3u8/i.test(streamUrl)
            };
            return { stream: streamObj, url: streamUrl };
        }
        catch (error) {
            console.error('Failed to get stream from local backend:', error.message);
        }
    }
    const order = [];
    if (sub && !dub)
        order.push('sub');
    else if (dub && !sub)
        order.push('dub');
    else
        order.push('sub', 'dub');
    const allValidStreams = [];
    const showId = isAllAnime ? anime.session.replace('allanime:', '') : undefined;
    for (const audio of order) {
        const allAnimeStreams = await fetchAllAnimeStreams(cleanTitle, epNum, audio, showId);
        for (const stream of allAnimeStreams) {
            const streamUrl = stream.directUrl || stream.url;
            if (/googlevideo\.com|allanime\.day|wixmp\.com|fast4speed\.rsvp/i.test(streamUrl) || await isStreamValid(streamUrl, 'https://allmanga.to')) {
                if (!selectStream)
                    return { stream, url: streamUrl };
                allValidStreams.push(stream);
            }
        }
    }
    // Fallback to AniNeko provider if AllAnime fails
    if (allValidStreams.length === 0) {
        const { fetchAniNekoStreams } = await import('./anineko.js');
        for (const audio of order) {
            const aniNekoStreams = await fetchAniNekoStreams(cleanTitle, epNum, audio);
            for (const stream of aniNekoStreams) {
                const streamUrl = stream.directUrl || stream.url;
                if (!selectStream)
                    return { stream, url: streamUrl };
                allValidStreams.push(stream);
            }
        }
    }
    if (allValidStreams.length > 0) {
        if (selectStream) {
            const { chooseFromList } = await import('./utils.js');
            const selected = await chooseFromList('Stream Quality / Server', allValidStreams, (stream) => `[${stream.provider}] ${stream.server || 'Server'} - ${stream.quality} ${String(stream.audio || '').toUpperCase()}`);
            return { stream: selected, url: selected.directUrl || selected.url };
        }
        return { stream: allValidStreams[0], url: allValidStreams[0].directUrl || allValidStreams[0].url };
    }
    throw new Error(`No playable stream found for episode ${epNum}`);
};
