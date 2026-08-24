import { AnimeSearchResult } from './types.js';
import { searchAllAnime as searchDirectAllAnime, hasEpisodeSources, probeAnidbPlayable } from './allanime.js';

const LOCAL_API_BASE = process.env.YORUMI_API_BASE ? String(process.env.YORUMI_API_BASE).replace(/\/+$/, '') : null;
const ALLANIME_API_URL = 'https://api.mkissa.net/api';
const ALLANIME_REFERER = 'https://mkissa.to';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';

type AllAnimeSort = 'Latest_Update' | 'Trending' | 'Recent' | 'Name_ASC' | 'Random';

const API_PAGE_SIZE = 20;
const PAGES_SCANNED_PER_UI_PAGE = 4;

export interface BrowseResult {
  results: AnimeSearchResult[];
  hasMore: boolean;
}

const isCatalogCandidate = (item: AnimeSearchResult) =>
  Number(item.episodes || 0) > 0 && item.status !== 'Not Yet Released';

async function filterPlayable(
  items: AnimeSearchResult[],
  maxCount: number,
  sourceConcurrency = 16,
  anidbConcurrency = 10,
): Promise<AnimeSearchResult[]> {
  const playable: AnimeSearchResult[] = [];
  const anidbQueue: AnimeSearchResult[] = [];

  for (let i = 0; i < items.length && playable.length < maxCount; i += sourceConcurrency) {
    const chunk = items.slice(i, i + sourceConcurrency);
    const checks = await Promise.all(
      chunk.map(async (item) => {
        if (!Number(item.episodes || 0)) return null;
        if (!item.session?.startsWith('allanime:')) return item;

        const showId = item.session.replace(/^allanime:/, '');
        const hasSources = await hasEpisodeSources(showId, 1, 'sub');
        return hasSources ? item : { item, needsAnidb: true as const };
      }),
    );

    for (const result of checks) {
      if (!result) continue;
      if (typeof result === 'object' && result !== null && 'needsAnidb' in result) {
        anidbQueue.push(result.item);
      } else if (playable.length < maxCount) {
        playable.push(result as AnimeSearchResult);
      }
    }
  }

  if (playable.length >= maxCount) return playable;

  for (let i = 0; i < anidbQueue.length && playable.length < maxCount; i += anidbConcurrency) {
    const chunk = anidbQueue.slice(i, i + anidbConcurrency);
    const checks = await Promise.all(
      chunk.map(async (item) => {
        const ok = await probeAnidbPlayable(item.title, item.session, 1, 'sub');
        return ok ? item : null;
      }),
    );

    for (const item of checks) {
      if (item && playable.length < maxCount) playable.push(item);
    }
  }

  return playable;
}

async function collectCatalogCandidates(options: {
  page: number;
  targetCount: number;
  sortBy: AllAnimeSort;
  genres?: string[];
  year?: number;
  status?: string;
}): Promise<{ candidates: AnimeSearchResult[]; hasMore: boolean }> {
  const seen = new Set<string>();
  const candidates: AnimeSearchResult[] = [];
  const startApiPage = (Math.max(1, options.page) - 1) * PAGES_SCANNED_PER_UI_PAGE + 1;
  let lastBatchFull = false;

  for (let offset = 0; offset < PAGES_SCANNED_PER_UI_PAGE; offset += 1) {
    const batch = await fetchAllAnimeResults({
      sortBy: options.sortBy,
      page: startApiPage + offset,
      limit: 50,
      genres: options.genres,
      year: options.year,
    }).catch(() => []);

    if (!batch.length) break;
    lastBatchFull = batch.length >= API_PAGE_SIZE;

    for (const item of batch) {
      if (options.status && item.status !== options.status) continue;
      if (!isCatalogCandidate(item)) continue;
      const key = String(item.session || item.id);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(item);
    }

    if (candidates.length >= options.targetCount) break;
    if (!lastBatchFull) break;
  }

  return { candidates, hasMore: lastBatchFull };
}

const SHOWS_QUERY = `query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){
  shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){
    edges{_id name englishName type season availableEpisodes episodeCount status genres thumbnail banner}
  }
}`;

const toAnimeResult = (anime: any): AnimeSearchResult => ({
  id: anime.id,
  title: anime.title?.english || anime.title?.romaji || anime.title?.native || anime.title?.userPreferred,
  session: `yorumi:${anime.id}`,
  year: anime.seasonYear || anime.startDate?.year,
  episodes: anime.episodes,
});

const normalizeTitle = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const scoreSearchResult = (query: string, result: AnimeSearchResult) => {
  const q = normalizeTitle(query);
  const titles = [result.title, result.name, result.englishName].map(normalizeTitle).filter(Boolean);
  let score = 0;
  let exactMatch = false;

  for (const title of titles) {
    if (title === q) {
      exactMatch = true;
      score = Math.max(score, 100_000);
    } else if (title.startsWith(`${q} `)) score = Math.max(score, 20_000);
    else if (title.includes(q)) score = Math.max(score, 5_000);
  }

  const isSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(result.title);
  const asksSpecial = /\b(movie|special|recap|ova|ona)\b/i.test(query);
  if (isSpecial && !asksSpecial) score -= 200_000;
  if (!asksSpecial && !exactMatch && Number(result.episodes || 0) <= 1) score -= 200_000;

  score += Math.min(Number(result.episodes || 0), 1_000);
  return score;
};

const rankSearchResults = (query: string, results: AnimeSearchResult[]) =>
  [...results].sort((a, b) => scoreSearchResult(query, b) - scoreSearchResult(query, a));

async function fetchBackendResults(path: string): Promise<AnimeSearchResult[]> {
  if (!LOCAL_API_BASE) return [];
  const res = await fetch(`${LOCAL_API_BASE}${path}`, { signal: AbortSignal.timeout(3500) });
  if (!res.ok) return [];

  const data: any = await res.json();
  const media: any[] = Array.isArray(data?.media) ? data.media : [];
  return media
    .map(toAnimeResult)
    .filter((item: AnimeSearchResult) => item.id && item.title);
}

function mapShowEdges(edges: any[]): AnimeSearchResult[] {
  return edges.map((edge: any) => {
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
      type: edge.type,
      status: edge.status,
      genres: edge.genres || [],
      poster: edge.thumbnail || undefined,
      banner: edge.banner || undefined,
    };
  }).filter((item: AnimeSearchResult) => item.title);
}

async function fetchAllAnimeResults(options: {
  query?: string;
  sortBy?: AllAnimeSort;
  limit?: number;
  page?: number;
  genres?: string[];
  year?: number;
}): Promise<AnimeSearchResult[]> {
  try {
    const search: Record<string, unknown> = { allowAdult: false, allowUnknown: false };
    if (options.query) {
      search.query = normalizeTitle(options.query);
    } else if (options.sortBy) {
      search.sortBy = options.sortBy;
      search.sortDirection = 'DSC';
    }
    if (options.genres?.length) search.genres = options.genres;
    if (options.year) search.year = options.year;

    const res = await fetch(ALLANIME_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        Origin: ALLANIME_REFERER,
      },
      body: JSON.stringify({
        query: SHOWS_QUERY,
        variables: {
          search,
          limit: options.limit || 40,
          page: options.page || 1,
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

    const data: any = await res.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
    }
    const edges = Array.isArray(data?.data?.shows?.edges) ? data.data.shows.edges : [];
    const results = mapShowEdges(edges);

    return options.query ? rankSearchResults(options.query, results) : results;
  } catch (error) {
    console.error('fetchAllAnimeResults error:', error);
    return [];
  }
}

export async function getLatestAnime(limit = 18): Promise<AnimeSearchResult[]> {
  try {
    const backendResults = await fetchBackendResults('/anime/search?sort=TRENDING_DESC');
    if (backendResults.length > 0) return backendResults.slice(0, limit);
  } catch {
    // Fall back to the direct provider below.
  }

  return fetchAllAnimeResults({ sortBy: 'Latest_Update', limit }).catch(() => []);
}

export async function getPopularAnime(limit = 40): Promise<AnimeSearchResult[]> {
  try {
    const backendResults = await fetchBackendResults('/anime/search?sort=POPULARITY_DESC');
    if (backendResults.length > 0) return backendResults.slice(0, limit);
  } catch {
    // Fall back to the direct provider below.
  }

  return fetchAllAnimeResults({ sortBy: 'Trending', limit }).catch(() => []);
}

export async function browseAnime(options: {
  page?: number;
  limit?: number;
  genre?: string;
  status?: string;
  year?: number;
}): Promise<BrowseResult> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 48));
  const genre = options.genre?.trim();
  const status = options.status?.trim();
  const year = options.year ? Number(options.year) : undefined;

  const sortBy: AllAnimeSort = genre || year ? 'Latest_Update' : 'Trending';
  const candidateTarget = Math.min(limit + 20, 80);

  const { candidates, hasMore } = await collectCatalogCandidates({
    page,
    targetCount: candidateTarget,
    sortBy,
    genres: genre ? [genre] : undefined,
    year,
    status,
  });

  const results = await filterPlayable(candidates, limit);
  return { results, hasMore: hasMore || results.length >= limit };
}

export async function getRecommendations(seedTitles: string[] = [], limit = 14): Promise<AnimeSearchResult[]> {
  const exclude = new Set(seedTitles.map((title) => normalizeTitle(title)).filter(Boolean));
  const target = Math.min(24, Math.max(limit + exclude.size, limit + 4));

  const { candidates } = await collectCatalogCandidates({
    page: 1,
    targetCount: target * 2,
    sortBy: 'Trending',
  });

  let filtered = candidates.filter((item) => !exclude.has(normalizeTitle(item.title)));

  if (seedTitles.length) {
    try {
      const seedMatches = await searchAllAnime(seedTitles[0]);
      const seed = seedMatches[0];
      const seedGenre = seed?.genres?.[0];
      if (seedGenre) {
        const { candidates: genreCandidates } = await collectCatalogCandidates({
          page: 1,
          targetCount: target,
          sortBy: 'Latest_Update',
          genres: [seedGenre],
        });
        const merged = [...genreCandidates, ...filtered];
        const seen = new Set<string>();
        filtered = [];
        for (const item of merged) {
          const key = String(item.session || item.id);
          if (seen.has(key) || exclude.has(normalizeTitle(item.title))) continue;
          seen.add(key);
          filtered.push(item);
        }
      }
    } catch {
      // Keep trending-only results.
    }
  }

  const playable = await filterPlayable(filtered, limit);
  return playable;
}

export async function searchAllAnime(query: string): Promise<AnimeSearchResult[]> {
  try {
    const backendResults = await fetchBackendResults(`/anime/search?query=${encodeURIComponent(query)}`);
    if (backendResults.length > 0) return rankSearchResults(query, backendResults);
  } catch {
    // Fall back to the direct provider below.
  }

  if (!LOCAL_API_BASE) return searchDirectAllAnime(query).catch(() => []);

  const directResults = await fetchAllAnimeResults({ query }).catch(() => []);
  if (directResults.length > 0) return directResults;
  return searchDirectAllAnime(query).catch(() => []);
}
