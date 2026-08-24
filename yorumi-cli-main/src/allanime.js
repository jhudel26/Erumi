import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const API_URL = 'https://api.mkissa.net/api';
const REFERER = 'https://mkissa.to';
const STREAM_REFERER = 'https://allmanga.to';
const ALLANIME_BASE = 'allanime.day';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0';
const STATIC_QUERY_HASH = 'f4662f4b7510b26795dd53ef824a0bf1740fbbc5d1273fab18222ac831bca8d0';
const TS_BUCKET_MS = 300_000;
let dynamicKeys = null;
const HEX_MAP = {
    '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G', '70': 'H', '71': 'I', '72': 'J',
    '73': 'K', '74': 'L', '75': 'M', '76': 'N', '77': 'O', '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T',
    '6d': 'U', '6e': 'V', '6f': 'W', '60': 'X', '61': 'Y', '62': 'Z', '59': 'a', '5a': 'b', '5b': 'c',
    '5c': 'd', '5d': 'e', '5e': 'f', '5f': 'g', '50': 'h', '51': 'i', '52': 'j', '53': 'k', '54': 'l',
    '55': 'm', '56': 'n', '57': 'o', '48': 'p', '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u',
    '4e': 'v', '4f': 'w', '40': 'x', '41': 'y', '42': 'z', '08': '0', '09': '1', '0a': '2', '0b': '3',
    '0c': '4', '0d': '5', '0e': '6', '0f': '7', '00': '8', '01': '9', '15': '-', '16': '.', '67': '_',
    '46': '~', '02': ':', '17': '/', '07': '?', '1b': '#', '63': '[', '65': ']', '78': '@', '19': '!', '1c': '$',
    '1e': '&', '10': '(', '11': ')', '12': '*', '13': '+', '14': ',', '03': ';', '05': '=', '1d': '%',
};
const normalizeTitle = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanSearchQuery = (query) => query.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
async function fetchText(url, timeoutMs = 10_000) {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok)
        throw new Error(`Request failed ${res.status}: ${url}`);
    return res.text();
}
async function fetchDynamicKeys() {
    if (dynamicKeys && Date.now() - dynamicKeys.fetchTime < 5 * 60 * 1000)
        return dynamicKeys;
    try {
        const home = await fetchText('https://mkissa.to/');
        const epochMatch = home.match(/"epoch":(\d+)/);
        const partBMatch = home.match(/"partB":"([^"]+)"/);
        const appUrlMatch = home.match(/https:\/\/cdn\.mkissa\.net\/all\/mk\/_app\/immutable\/entry\/app\.[A-Za-z0-9_.-]+\.js/);
        if (epochMatch && partBMatch && appUrlMatch) {
            const epoch = Number(epochMatch[1]);
            const partBHex = Buffer.from(partBMatch[1], 'base64').toString('hex');
            const app = await fetchText(appUrlMatch[0]);
            const chunkUrls = [...app.matchAll(/"(\.\.\/chunks\/[A-Za-z0-9_.-]+\.js)"/g)]
                .map((match) => match[1].replace('../', 'https://cdn.mkissa.net/all/mk/_app/immutable/'))
                .slice(0, 5);
            for (const chunkUrl of chunkUrls) {
                const chunk = await fetchText(chunkUrl, 5_000);
                const maskMatch = chunk.match(/[0-9a-f]{64}/);
                if (!maskMatch)
                    continue;
                let keyHex = '';
                for (let i = 0; i < 64; i += 2) {
                    const mask = parseInt(maskMatch[0].slice(i, i + 2), 16);
                    const part = parseInt(partBHex.slice(i, i + 2), 16);
                    keyHex += (mask ^ part).toString(16).padStart(2, '0');
                }
                dynamicKeys = {
                    epoch,
                    aaKey: Buffer.from(keyHex, 'hex'),
                    queryHash: STATIC_QUERY_HASH,
                    fetchTime: Date.now(),
                };
                return dynamicKeys;
            }
        }
    }
    catch {
        // Fall back to the last known public values below.
    }
    return {
        epoch: 6887,
        aaKey: Buffer.from('c9df59c795466fc271f8e48af65e7390860ac465acf6d2cb6a17670c8e5505b0', 'hex'),
        queryHash: STATIC_QUERY_HASH,
        fetchTime: Date.now(),
    };
}
async function generateAaReq() {
    const keys = await fetchDynamicKeys();
    const ts = Math.floor(Date.now() / TS_BUCKET_MS) * TS_BUCKET_MS;
    const payload = { v: 1, ts, epoch: keys.epoch, buildId: '74', qh: keys.queryHash, k: 'k7' };
    const nonce = crypto.createHash('sha256').update(`${keys.epoch}:${keys.queryHash}:${ts}`).digest().subarray(0, 12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keys.aaKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}
const decodeClockSource = (sourceUrl) => {
    const clean = sourceUrl.startsWith('--') ? sourceUrl.slice(2) : sourceUrl;
    let decoded = '';
    for (let i = 0; i < clean.length; i += 2) {
        const pair = clean.slice(i, i + 2);
        decoded += HEX_MAP[pair] ?? pair;
    }
    return decoded.replace(/\\u002F/gi, '/').replace(/\\\|/g, '');
};
const toClockUrl = (decoded) => {
    const clockPath = decoded.replace('/clock', '/clock.json');
    if (clockPath.startsWith('//'))
        return `https:${clockPath}`;
    if (clockPath.startsWith('/'))
        return `https://${ALLANIME_BASE}${clockPath}`;
    if (/^https?:\/\//i.test(clockPath))
        return clockPath;
    return `https://${ALLANIME_BASE}/${clockPath}`;
};
const parseSourcePayload = (value) => {
    if (Array.isArray(value))
        return value;
    const parsed = value;
    if (Array.isArray(parsed?.episode?.sourceUrls))
        return parsed.episode.sourceUrls;
    if (Array.isArray(parsed?.sourceUrls))
        return parsed.sourceUrls;
    return [];
};
const extractSourcesFromText = (plain) => {
    const sources = [];
    for (const chunk of plain.split(/[{}]/)) {
        const urlMatch = chunk.match(/"sourceUrl"\s*:\s*"([^"]+)"/);
        if (!urlMatch)
            continue;
        const nameMatch = chunk.match(/"sourceName"\s*:\s*"([^"]+)"/);
        const priorityMatch = chunk.match(/"priority"\s*:\s*([0-9.]+)/);
        sources.push({
            sourceUrl: urlMatch[1],
            sourceName: nameMatch?.[1] || '',
            priority: priorityMatch ? Number(priorityMatch[1]) : 0,
        });
    }
    return sources;
};
const decryptTobeparsed = async (blob) => {
    try {
        const keys = await fetchDynamicKeys();
        const raw = Buffer.from(blob, 'base64');
        if (raw.length <= 29)
            return [];
        const decipher = crypto.createDecipheriv('aes-256-gcm', keys.aaKey, raw.subarray(1, 13));
        decipher.setAuthTag(raw.subarray(-16));
        const plain = decipher.update(raw.subarray(13, -16), undefined, 'utf8') + decipher.final('utf8');
        try {
            const sources = parseSourcePayload(JSON.parse(plain));
            if (sources.length > 0)
                return sources;
        }
        catch {
            const sources = extractSourcesFromText(plain);
            if (sources.length > 0)
                return sources;
        }
    }
    catch {
        // Return no sources on auth/decrypt failure.
    }
    return [];
};
const providerRank = (source) => {
    const name = String(source.sourceName || '').trim().toLowerCase();
    if (name === 'default')
        return 0;
    if (name === 'yt-mp4' || name === 'yt')
        return 1;
    if (name === 's-mp4' || name === 'sharepoint')
        return 2;
    if (name === 'mp4' || name === 'mp4upload')
        return 3;
    return 99;
};
const orderSources = (sources) => sources
    .filter((source) => source?.sourceUrl)
    .sort((a, b) => {
    const rankDiff = providerRank(a) - providerRank(b);
    if (rankDiff !== 0)
        return rankDiff;
    const aEncoded = String(a.sourceUrl || '').startsWith('--') ? 1 : 0;
    const bEncoded = String(b.sourceUrl || '').startsWith('--') ? 1 : 0;
    return (bEncoded - aEncoded) || (Number(b.priority || 0) - Number(a.priority || 0));
});
async function followRedirects(url, maxHops = 10) {
    let current = url;
    for (let hop = 0; hop < maxHops; hop += 1) {
        const res = await fetch(current, {
            redirect: 'manual',
            headers: { 'User-Agent': USER_AGENT, Referer: STREAM_REFERER },
            signal: AbortSignal.timeout(10_000),
        });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            current = new URL(location, current).href;
            continue;
        }
        return current;
    }
    return current;
}
async function resolveSource(source, audio) {
    const sourceUrl = String(source.sourceUrl || '');
    if (!sourceUrl)
        return [];
    if (/^https?:\/\//i.test(sourceUrl) && !/\/clock(?:\.json)?(?:[?#]|$)/i.test(sourceUrl)) {
        const isMedia = /\.m3u8(?:[?#]|$)|\.(mp4|webm|mkv)(?:[?#]|$)|googlevideo\.com|wixmp\.com|okcdn\.ru/i.test(sourceUrl);
        if (!isMedia)
            return [];
        return [{
                server: String(source.sourceName || 'AllAnime'),
                url: sourceUrl,
                directUrl: sourceUrl,
                quality: /\.m3u8/i.test(sourceUrl) ? 'auto' : '1080',
                audio,
                provider: 'allmanga',
                isHls: /\.m3u8(?:[?#]|$)/i.test(sourceUrl),
            }];
    }
    if (!sourceUrl.startsWith('--'))
        return [];
    const sourceName = String(source.sourceName || 'AllAnime');
    const clockUrl = toClockUrl(decodeClockSource(sourceUrl));
    if (/fast4speed\.rsvp/i.test(clockUrl) || /^yt-mp4$/i.test(sourceName)) {
        const finalUrl = await followRedirects(clockUrl);
        return [{
                server: sourceName,
                url: finalUrl,
                directUrl: finalUrl,
                quality: '1080',
                audio,
                provider: 'allmanga',
                isHls: /\.m3u8(?:[?#]|$)/i.test(finalUrl),
            }];
    }
    const res = await fetch(clockUrl, {
        headers: { 'User-Agent': USER_AGENT, Referer: STREAM_REFERER },
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
        return [];
    const data = await res.json();
    return (Array.isArray(data.links) ? data.links : [])
        .filter((link) => link?.link && !String(link.link).includes('sk.json'))
        .map((link) => {
        const url = String(link.link || '');
        return {
            server: sourceName,
            url,
            directUrl: url,
            quality: String(link.resolutionStr || '').replace(/[^\d]/g, '') || '1080',
            audio,
            provider: 'allmanga',
            isHls: /\.m3u8(?:[?#]|$)/i.test(url),
        };
    });
}
const scoreShow = (query, show, audio, episode = 1) => {
    const target = normalizeTitle(query);
    const titles = [show.name, show.englishName].map(normalizeTitle).filter(Boolean);
    if (!target || titles.length === 0)
        return 0;
    let score = 0;
    let exactMatch = false;
    for (const title of titles) {
        if (title === target) {
            exactMatch = true;
            score = Math.max(score, 150);
        }
        else if (target === 'onepiece' && title === '1p') {
            exactMatch = true;
            score = Math.max(score, 148);
        }
        else if (title.startsWith(target) || target.startsWith(title))
            score = Math.max(score, 105);
        else if (title.includes(target) || target.includes(title))
            score = Math.max(score, 70);
    }
    if (score <= 0)
        return 0;
    const rawTitle = String(show.englishName || show.name || '');
    const rawType = String(show.type || '');
    const asksSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(query);
    const isSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(rawTitle) || /\b(movie|special|ova|ona)\b/i.test(rawType);
    if (isSpecial && !asksSpecial)
        score -= 220;
    const availableEpisodes = Number(show.availableEpisodes?.[audio] || 0);
    if (episode > 0 && availableEpisodes >= episode)
        score += 30;
    if (!asksSpecial && !exactMatch && availableEpisodes <= 1)
        score -= 120;
    if (availableEpisodes > 1)
        score += Math.min(25, Math.floor(availableEpisodes / 50));
    return score;
};
async function searchShows(query, audio) {
    const searchQueryGql = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name englishName type season availableEpisodes episodeCount}}}`;
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, Origin: REFERER, Referer: REFERER },
        body: JSON.stringify({
            query: searchQueryGql,
            variables: {
                search: { allowAdult: false, allowUnknown: false, query: cleanSearchQuery(query) },
                limit: 40,
                page: 1,
                translationType: audio,
                countryOrigin: 'ALL',
            },
        }),
        signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok)
        return [];
    const data = await res.json();
    return Array.isArray(data?.data?.shows?.edges) ? data.data.shows.edges : [];
}
export async function searchAllAnime(query) {
    try {
        const [subShows, dubShows] = await Promise.all([
            searchShows(query, 'sub').catch(() => []),
            searchShows(query, 'dub').catch(() => []),
        ]);
        const showMap = new Map();
        [...subShows, ...dubShows].forEach((show) => {
            const id = String(show?._id || '').trim();
            if (id && !showMap.has(id))
                showMap.set(id, show);
        });
        return [...showMap.values()]
            .map((show) => {
            const available = show.availableEpisodes || {};
            const episodes = Math.max(Number(show.episodeCount || 0), available.sub || 0, available.dub || 0, available.raw || 0, 1);
            return {
                show,
                score: Math.max(scoreShow(query, show, 'sub'), scoreShow(query, show, 'dub')),
                result: {
                    id: `allanime-${show._id}`,
                    title: String(show.englishName || show.name || '').trim(),
                    name: show.name,
                    englishName: show.englishName || undefined,
                    session: `allanime:${show._id}`,
                    episodes,
                    year: show.season?.year,
                },
            };
        })
            .filter((entry) => entry.result.title && entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.result);
    }
    catch {
        return [];
    }
}
async function getEpisodeSources(showId, episode, audio) {
    const keys = await fetchDynamicKeys();
    const variables = {
        showId,
        translationType: audio,
        episodeString: String(episode),
    };
    const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        extensions: JSON.stringify({
            persistedQuery: { version: 1, sha256Hash: keys.queryHash },
            aaReq: await generateAaReq(),
        }),
    });
    let data;
    try {
        const res = await fetch(`${API_URL}?${params.toString()}`, {
            headers: { 'User-Agent': USER_AGENT, Origin: REFERER, Referer: REFERER },
            signal: AbortSignal.timeout(10_000),
        });
        data = await res.json();
    }
    catch {
        data = undefined;
    }
    const plainSources = parseSourcePayload(data?.data?.episode);
    if (plainSources.length > 0)
        return plainSources;
    const encrypted = data?.data?.tobeparsed;
    if (encrypted)
        return decryptTobeparsed(encrypted);
    try {
        const EPISODE_GQL = `query($showId:String! $translationType:VaildTranslationTypeEnumType! $episodeString:String!){episode(showId:$showId translationType:$translationType episodeString:$episodeString){episodeString sourceUrls}}`;
        const postRes = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, Origin: REFERER, Referer: REFERER },
            body: JSON.stringify({ query: EPISODE_GQL, variables }),
            signal: AbortSignal.timeout(10_000),
        });
        const postData = await postRes.json();
        const postSources = parseSourcePayload(postData?.data?.episode);
        if (postSources.length > 0)
            return postSources;
        if (postData?.data?.tobeparsed)
            return decryptTobeparsed(postData.data.tobeparsed);
    }
    catch {
        // Ignore error and return empty array.
    }
    return [];
}
async function fetchAnidbUrl(url) {
    try {
        const { stdout } = await execFileAsync('curl', [
            '-sL',
            url,
            '-A',
            USER_AGENT,
            '-H',
            'Accept: application/json',
            '-H',
            'Referer: https://anidb.app/',
            '--max-time',
            '10',
        ]);
        if (stdout && stdout.trim().length > 0) {
            return stdout.trim();
        }
    }
    catch {
        // ignore curl failure
    }
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: 'https://anidb.app/' },
            signal: AbortSignal.timeout(10_000),
        });
        return await res.text();
    }
    catch {
        return '';
    }
}
async function searchAnidb(query) {
    const q = encodeURIComponent(query.trim());
    const page = await fetchAnidbUrl(`https://anidb.app/search/suggestions?q=${q}`);
    if (!page)
        return undefined;
    const match = page.match(/anime\/[a-z0-9-]+-(\d+)/i);
    return match ? match[1] : undefined;
}
async function getAnidbStreamLink(title, episodeNumber, audio) {
    if (!title || episodeNumber <= 0)
        return undefined;
    const id = await searchAnidb(title);
    if (!id)
        return undefined;
    const epJsonStr = await fetchAnidbUrl(`https://anidb.app/api/frontend/anime/${id}/episodes`);
    if (!epJsonStr)
        return undefined;
    try {
        const epData = JSON.parse(epJsonStr);
        const epList = Array.isArray(epData) ? epData : (epData.episodes || epData.data || []);
        const targetEp = epList.find((e) => String(e.number) === String(episodeNumber));
        if (!targetEp?.id)
            return undefined;
        const langJsonStr = await fetchAnidbUrl(`https://anidb.app/api/frontend/episode/${targetEp.id}/languages`);
        if (!langJsonStr)
            return undefined;
        const langData = JSON.parse(langJsonStr);
        const langList = Array.isArray(langData) ? langData : (langData.languages || langData.data || []);
        const pref = audio === 'dub' ? 'eng' : 'jpn';
        const targetLang = langList.find((l) => l.code === pref) || langList[0];
        if (!targetLang?.embed_url)
            return undefined;
        const embedPage = await fetchAnidbUrl(targetLang.embed_url);
        const m3u8Match = embedPage.match(/file:\s*['"]([^'"]+)['"]/);
        return m3u8Match ? m3u8Match[1] : undefined;
    }
    catch {
        return undefined;
    }
}
export async function fetchAllAnimeStreams(title, episode, audio = 'sub', showId) {
    try {
        let showIdToUse = showId;
        if (!showIdToUse) {
            const matches = await searchAllAnime(title);
            showIdToUse = matches[0]?.session?.replace('allanime:', '');
        }
        let resolvedStreams = [];
        if (showIdToUse) {
            const sources = orderSources(await getEpisodeSources(showIdToUse, episode, audio));
            const resolved = await Promise.all(sources.map((source) => resolveSource(source, audio).catch(() => [])));
            const seen = new Set();
            resolvedStreams = resolved.flat()
                .filter((stream) => {
                const url = String(stream.directUrl || stream.url || '');
                if (!url || /streamwish|streamsb|sbvideo|sbfull|sbspeed|sbfast|streamtape|embedsito|ok\.ru/i.test(url))
                    return false;
                const key = `${stream.audio}:${stream.quality}:${url}`;
                if (seen.has(key))
                    return false;
                seen.add(key);
                return true;
            })
                .sort((a, b) => {
                const score = (stream) => {
                    const url = String(stream.url || '');
                    const quality = Number(String(stream.quality || '').replace(/[^\d]/g, '')) || 0;
                    return (stream.isHls || /\.m3u8/i.test(url) ? 10_000 : 0)
                        + (/googlevideo\.com|wixmp\.com|fast4speed\.rsvp/i.test(url) ? 5_000 : 0)
                        + quality;
                };
                return score(b) - score(a);
            });
        }
        if (resolvedStreams.length === 0 && title) {
            const fallbackUrl = await getAnidbStreamLink(title, episode, audio);
            if (fallbackUrl) {
                resolvedStreams.push({
                    quality: '1080p',
                    audio,
                    provider: 'Anidb',
                    server: 'anidb.app',
                    url: fallbackUrl,
                    directUrl: fallbackUrl,
                    isHls: /\.m3u8/i.test(fallbackUrl),
                });
            }
        }
        return resolvedStreams;
    }
    catch {
        return [];
    }
}
