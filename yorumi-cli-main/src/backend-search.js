import { searchAllAnime as searchDirectAllAnime } from './allanime.js';
const LOCAL_API_BASE = process.env.YORUMI_API_BASE ? String(process.env.YORUMI_API_BASE).replace(/\/+$/, '') : null;
const ALLANIME_API_URL = 'https://api.mkissa.net/api';
const ALLANIME_REFERER = 'https://mkissa.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const toAnimeResult = (anime) => ({
    id: anime.id,
    title: anime.title?.english || anime.title?.romaji || anime.title?.native || anime.title?.userPreferred,
    session: `yorumi:${anime.id}`,
    year: anime.seasonYear || anime.startDate?.year,
    episodes: anime.episodes
});
const normalizeTitle = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const scoreSearchResult = (query, result) => {
    const q = normalizeTitle(query);
    const titles = [
        result.title,
        result.name,
        result.englishName,
    ].map(normalizeTitle).filter(Boolean);
    let score = 0;
    let exactMatch = false;
    for (const title of titles) {
        if (title === q) {
            exactMatch = true;
            score = Math.max(score, 100_000);
        }
        else if (title.startsWith(`${q} `))
            score = Math.max(score, 20_000);
        else if (title.includes(q))
            score = Math.max(score, 5_000);
    }
    const isSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(result.title);
    const asksSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(query);
    if (isSpecial && !asksSpecial)
        score -= 200_000;
    if (!asksSpecial && !exactMatch && Number(result.episodes || 0) <= 1)
        score -= 200_000;
    score += Math.min(Number(result.episodes || 0), 1_000);
    return score;
};
const rankSearchResults = (query, results) => [...results].sort((a, b) => scoreSearchResult(query, b) - scoreSearchResult(query, a));
async function fetchBackendResults(path) {
    if (!LOCAL_API_BASE)
        return [];
    const res = await fetch(`${LOCAL_API_BASE}${path}`, { signal: AbortSignal.timeout(3500) });
    if (!res.ok)
        return [];
    const data = await res.json();
    const media = Array.isArray(data?.media) ? data.media : [];
    return media
        .map(toAnimeResult)
        .filter((item) => item.id && item.title);
}
async function fetchAllAnimeResults(options) {
    try {
        const search = { allowAdult: false, allowUnknown: false };
        if (options.query) {
            search.query = normalizeTitle(options.query);
        }
        else if (options.sortBy) {
            search.sortBy = options.sortBy;
            search.sortDirection = 'DSC';
        }
        const query = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){edges{_id name englishName type season availableEpisodes episodeCount}}}`;
        const res = await fetch(ALLANIME_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
                Origin: ALLANIME_REFERER,
            },
            body: JSON.stringify({
                query,
                variables: {
                    search,
                    limit: options.limit || 40,
                    page: 1,
                    translationType: 'sub',
                    countryOrigin: 'ALL',
                },
            }),
            signal: AbortSignal.timeout(25_000),
        });
        if (!res.ok) {
            console.error(`Fetch failed with status: ${res.status}`);
            return [];
        }
        const data = await res.json();
        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
        }
        const edges = Array.isArray(data?.data?.shows?.edges) ? data.data.shows.edges : [];
        const results = edges.map((edge) => {
            const available = edge.availableEpisodes || {};
            const episodes = Math.max(available.sub || 0, available.dub || 0, available.raw || 0);
            return {
                id: `allanime-${edge._id}`,
                title: edge.englishName || edge.name,
                name: edge.name,
                englishName: edge.englishName,
                session: `allanime:${edge._id}`,
                episodes,
                year: edge.season?.year,
            };
        }).filter((item) => item.title);
        return options.query ? rankSearchResults(options.query, results) : results;
    }
    catch (error) {
        console.error('fetchAllAnimeResults error:', error);
        return [];
    }
}
export async function getLatestAnime() {
    try {
        const backendResults = await fetchBackendResults('/anime/search?sort=TRENDING_DESC');
        if (backendResults.length > 0)
            return backendResults;
    }
    catch {
        // Fall back to the direct provider below.
    }
    return fetchAllAnimeResults({ sortBy: 'Latest_Update', limit: 15 }).catch(() => []);
}
export async function getPopularAnime() {
    try {
        const backendResults = await fetchBackendResults('/anime/search?sort=POPULARITY_DESC');
        if (backendResults.length > 0)
            return backendResults;
    }
    catch {
        // Fall back to the direct provider below.
    }
    return fetchAllAnimeResults({ sortBy: 'Score', limit: 15 }).catch(() => []);
}
export async function searchAllAnime(query) {
    try {
        const backendResults = await fetchBackendResults(`/anime/search?query=${encodeURIComponent(query)}`);
        if (backendResults.length > 0)
            return rankSearchResults(query, backendResults);
    }
    catch {
        // Fall back to the direct provider below.
    }
    if (!LOCAL_API_BASE)
        return searchDirectAllAnime(query).catch(() => []);
    const directResults = await fetchAllAnimeResults({ query }).catch(() => []);
    if (directResults.length > 0)
        return directResults;
    return searchDirectAllAnime(query).catch(() => []);
}
