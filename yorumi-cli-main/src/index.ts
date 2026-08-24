#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PACKAGE_ROOT } from './constants.js';
import { ask, chooseFromList, selectEpisode, parseEpisodeRange, normalizeAudio } from './utils.js';
import { resolveEpisodeStreamUrl } from './scraper.js';
import { searchAllAnime, getLatestAnime, getPopularAnime, browseAnime, getRecommendations } from './backend-search.js';
import { playInMediaPlayer, getStreamReferer } from './player.js';
import { downloadEpisodes } from './downloader.js';
import { updateYorumiCli, uninstallYorumiCli } from './system.js';
import { CliOptions, AnimeSearchResult } from './types.js';

const getCliVersion = () => {
  try {
    const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

const getDefaultDownloadDir = () => {
  const configured = String(process.env.YORUMI_DOWNLOAD_DIR || '').trim();
  if (configured) return configured;
  const home = homedir() || process.env.USERPROFILE || process.env.HOME || process.cwd();
  return join(home, 'Downloads', 'Yorumi');
};

const printHelp = () => {
  console.log(`
▄▄ ▄▄  ▄▄▄  ▄▄▄▄  ▄▄ ▄▄ ▄▄   ▄▄ ▄▄      ▄▄▄▄ ▄▄    ▄▄
▀███▀ ██▀██ ██▄█▄ ██ ██ ██▀▄▀██ ██ ▄▄▄ ██▀▀▀ ██    ██
  █   ▀███▀ ██ ██ ▀███▀ ██   ██ ██     ▀████ ██▄▄▄ ██

Yorumi CLI - terminal anime watcher powered by Yorumi + mpv

Usage:
  yorumi-cli [anime title] [options]

Quick Start:
  yorumi-cli
  yorumi-cli "Frieren"
  yorumi-cli -e 1 "Frieren"
  yorumi-cli -r "1-5" "Naruto"

Examples:
  yorumi-cli "One Piece"
  yorumi-cli --episode 1 "Frieren"
  yorumi-cli --range "1-5" "Naruto"
  yorumi-cli -d -e 1 "Frieren"
  yorumi-cli -d -r "1-5" "Naruto"

Options:
  -e, --episode <number>   Pick an episode without prompting
  -r, --range <start-end>  Watch an episode range, for example 1-5
  -i, --anime-index <num>  Pick a search result without prompting, 1-based
  -d, --download           Download selected anime episode(s) instead of opening mpv
  -o, --output <dir>       Download output directory (default: ~/Downloads/Yorumi)
      --copy-audio         Keep source audio instead of converting to AAC
      --direct             Ask Yorumi for a direct stream URL when possible
      --print-url          Print resolved stream URL(s) and exit
  -s, --select             Prompt to manually select the stream/quality
      --player <name>      Choose video player (mpv, vlc, etc. default: mpv)
      --sub                Prefer SUBbed audio
      --dub                Prefer DUBbed audio
  -l, --latest             Show the top latest updated anime
  -p, --popular            Show the top trending anime
  -b, --browse             Browse the anime catalog (use with --genre, --status, --year)
      --recommendations    Playable picks from Yorumi catalog (optional --limit)
      --limit <number>     Max results (default: 18 for latest, 48 for browse)
      --page <number>      Page number for browse mode (default: 1)
      --genre <name>       Filter browse by genre (e.g. Action, Romance)
      --status <status>    Filter browse by status: Releasing, Finished, Not Yet Released
      --year <number>      Filter browse by release year
  -u, --update             Update Yorumi CLI and its dependencies
      --uninstall          Remove Yorumi CLI from this machine
  -y, --yes                Skip confirmation prompts where supported
      --json               Output results in JSON format for GUI integration
  -v, --version            Show the installed Yorumi CLI version
  -h, --help               Show this help
`);
};

const parseArgs = (argv: string[]): CliOptions => {
  const queryParts: string[] = [];
  const options: CliOptions = {
    query: '',
    player: String(process.env.YORUMI_PLAYER || 'mpv'),
    windowSize: String(process.env.YORUMI_PLAYER_SIZE || '1280x720'),
    outputDir: getDefaultDownloadDir(),
    printUrl: false,
    directPlay: false,
    download: false,
    copyAudio: false,
    update: false,
    uninstall: false,
    yes: false,
    latest: false,
    popular: false,
    browse: false,
    recommendations: false,
    limit: undefined,
    page: undefined,
    genre: undefined,
    status: undefined,
    year: undefined,
    sub: false,
    dub: false,
    selectStream: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      console.log(getCliVersion());
      process.exit(0);
    }
    if (arg === '--episode' || arg === '-e') {
      options.episode = Number(next);
      i += 1;
      continue;
    }
    if (arg === '--range' || arg === '-r') {
      options.range = String(next || '').trim();
      i += 1;
      continue;
    }
    if (arg === '--anime-index' || arg === '-i') {
      options.animeIndex = Number(next);
      i += 1;
      continue;
    } else if (arg === '--player') {
      options.player = String(next || options.player);
      i += 1;
      continue;
    } else if (arg === '--size') {
      options.windowSize = String(next || options.windowSize);
      i += 1;
      continue;
    } else if (/^--print-url$/i.test(arg)) {
      options.printUrl = true;
      continue;
    } else if (/^-(s|-select)$/i.test(arg)) {
      options.selectStream = true;
      continue;
    } else if (/^--player$/i.test(arg) && next) {
      options.player = next;
      i += 1;
      continue;
    } else if (/^--sub$/i.test(arg)) {
      options.sub = true;
      continue;
    } else if (/^--dub$/i.test(arg)) {
      options.dub = true;
      continue;
    } else if (/^-y|--yes$/i.test(arg)) {
      options.yes = true;
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      options.outputDir = String(next || options.outputDir);
      i += 1;
      continue;
    }
    if (arg === '--print-url') { options.printUrl = true; continue; }
    if (arg === '--download' || arg === '-d') { options.download = true; continue; }
    if (arg === '--copy-audio') { options.copyAudio = true; continue; }
    if (arg === '--direct') { options.directPlay = true; continue; }
    if (arg === '--update' || arg === '-u') { options.update = true; continue; }
    if (arg === '--uninstall') { options.uninstall = true; continue; }
    if (arg === '--latest' || arg === '-l') { options.latest = true; continue; }
    if (arg === '--popular' || arg === '-p') { options.popular = true; continue; }
    if (arg === '--browse' || arg === '-b') { options.browse = true; continue; }
    if (arg === '--recommendations') { options.recommendations = true; continue; }
    if (arg === '--limit') { options.limit = Number(next); i += 1; continue; }
    if (arg === '--page') { options.page = Number(next); i += 1; continue; }
    if (arg === '--genre') { options.genre = String(next || ''); i += 1; continue; }
    if (arg === '--status') { options.status = String(next || ''); i += 1; continue; }
    if (arg === '--year') { options.year = Number(next); i += 1; continue; }
    if (arg === '--sub') { options.sub = true; continue; }
    if (arg === '--dub') { options.dub = true; continue; }
    if (arg === '--yes' || arg === '-y') { options.yes = true; continue; }
    if (arg === '--json') { options.json = true; continue; }
    queryParts.push(arg);
  }

  options.query = queryParts.join(' ').trim();
  return options;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.update) {
    await updateYorumiCli();
    return;
  }

  if (options.uninstall) {
    await uninstallYorumiCli(options.yes);
    return;
  }

  let results: AnimeSearchResult[] = [];
  let browseHasMore = false;
  if (options.latest) {
    if (!options.json) console.log('Fetching latest anime...');
    results = await getLatestAnime(options.limit || 18);
  } else if (options.popular) {
    if (!options.json) console.log('Fetching popular anime...');
    results = await getPopularAnime(options.limit || 40);
  } else if (options.recommendations) {
    if (!options.json) console.log('Fetching recommendations...');
    const seeds = options.query
      ? options.query.split('|').map((title) => title.trim()).filter(Boolean)
      : [];
    results = await getRecommendations(seeds, options.limit || 14);
  } else if (options.browse) {
    if (!options.json) console.log('Browsing anime catalog...');
    const browseResult = await browseAnime({
      page: options.page || 1,
      limit: options.limit || 48,
      genre: options.genre,
      status: options.status,
      year: options.year,
    });
    results = browseResult.results;
    browseHasMore = browseResult.hasMore;
  } else {
    const query = options.query || await ask('Search anime: ');
    if (!query) {
      printHelp();
      return;
    }
    if (!options.json) console.log(`Searching Yorumi for "${query}"...`);
    results = await searchAllAnime(query);
    
    // Push specials, recaps, movies to bottom to avoid accidental selection, unless user queried for them
    const qLower = query.toLowerCase();
    const isSpecialQuery = qLower.includes('special') || qLower.includes('movie') || qLower.includes('recap');
    if (!isSpecialQuery) {
      results.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const aIsSpecial = aTitle.includes('special') || aTitle.includes('recap') || aTitle.includes('movie');
        const bIsSpecial = bTitle.includes('special') || bTitle.includes('recap') || bTitle.includes('movie');
        if (aIsSpecial && !bIsSpecial) return 1;
        if (!aIsSpecial && bIsSpecial) return -1;
        
        // Prioritize exact matches
        if (aTitle === qLower && bTitle !== qLower) return -1;
        if (bTitle === qLower && aTitle !== qLower) return 1;
        
        return 0;
      });
    }
  }

  const outputLimit = options.browse
    ? (options.limit || 48)
    : options.recommendations
      ? (options.limit || 14)
      : 40;
  const visibleResults = results.slice(0, outputLimit);
  if (visibleResults.length === 0) throw new Error('No anime found.');

  const requestedAnimeIndex = Number(options.animeIndex || 0);
  
  // JSON output for search results (only if no anime index specified)
  if (options.json && !requestedAnimeIndex) {
    const payload: Record<string, unknown> = {
      type: 'search_results',
      results: visibleResults.map((r, i) => ({
        index: i + 1,
        id: r.id,
        title: r.title,
        name: r.name,
        englishName: r.englishName,
        nativeName: r.nativeName,
        year: r.year,
        episodes: r.episodes,
        status: r.status,
        genres: r.genres,
        poster: r.poster,
        banner: r.banner,
        session: r.session
      }))
    };
    if (options.browse) payload.hasMore = browseHasMore;
    console.log(JSON.stringify(payload));
    return;
  }

  let anime: AnimeSearchResult;
  if (requestedAnimeIndex > 0 && requestedAnimeIndex <= visibleResults.length) {
    anime = visibleResults[requestedAnimeIndex - 1];
  } else if (options.json) {
    throw new Error(
      requestedAnimeIndex > 0
        ? `Anime index ${requestedAnimeIndex} is out of range (1-${visibleResults.length}). Re-run search and pick again.`
        : 'Anime index is required with --json when selecting episodes.',
    );
  } else {
    anime = await chooseFromList<AnimeSearchResult>(
      'Anime',
      visibleResults,
      (item) => `${item.title}${item.year ? ` (${item.year})` : ''}${item.episodes ? ` - ${item.episodes} eps` : ''}`,
    );
  }

  if (!options.json) console.log(`Fetching episodes for ${anime.title}...`);
  
  if (!anime.session.startsWith('allanime:')) {
    try {
      const metaRes = await fetch(`http://localhost:3001/api/anime/metadata?id=${anime.id}`);
      if (metaRes.ok) {
        const meta: any = await metaRes.json();
        if (meta.episodes && meta.episodes > 0) {
          anime.episodes = meta.episodes;
        }
      } else {
        if (!options.json) console.error(`\n[ERROR] Failed to fetch metadata for ${anime.title}. Status: ${metaRes.status}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      if (!options.json) console.error(`\n[ERROR] Network error fetching metadata for ${anime.title}:`, e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  let episodePayload;
  
  // If we STILL don't have anime.episodes, default to 500 instead of 1 so they aren't completely blocked
  const maxEp = anime.episodes || 500;
  const episodes = [];
  for (let i = 1; i <= maxEp; i++) {
    episodes.push({
      id: `yorumi:${anime.id}-ep-${i}`,
      session: `yorumi:${anime.id}-ep-${i}`,
      episodeNumber: i
    });
  }
  episodePayload = { episodes };
  
  // JSON output for episodes (only if no episode specified)
  if (options.json && !options.episode && !options.range) {
    console.log(JSON.stringify({
      type: 'episodes',
      anime: {
        id: anime.id,
        title: anime.title,
        year: anime.year,
        episodes: anime.episodes
      },
      episodes: episodes.map(ep => ({
        id: ep.id,
        episodeNumber: ep.episodeNumber
      }))
    }));
    return;
  }
  
  let selectedEpisodes;
  if (options.range) {
    selectedEpisodes = parseEpisodeRange(options.range, episodePayload.episodes);
  } else if (options.episode) {
    selectedEpisodes = [await selectEpisode(episodePayload.episodes, options.episode)];
  } else if (options.json) {
    throw new Error('Episode number is required with --json when resolving streams.');
  } else {
    selectedEpisodes = [await selectEpisode(episodePayload.episodes, options.episode)];
  }

  if (selectedEpisodes.length === 0) throw new Error('No episode selected.');

  const resolved: any[] = [];
  for (const episode of selectedEpisodes) {
    if (!options.json) console.log(`Resolving playable stream for episode ${episode.episodeNumber}...`);
    resolved.push(await resolveEpisodeStreamUrl(
      anime,
      episode,
      options.directPlay,
      options.sub,
      options.dub,
      options.selectStream,
      Boolean(options.json || options.printUrl),
    ));
  }

  const streamUrls = resolved.map((item) => item.url);
  const firstStream = resolved[0]?.stream;
  const title = selectedEpisodes.length > 1
    ? `${anime.title} Episodes ${selectedEpisodes[0].episodeNumber}-${selectedEpisodes[selectedEpisodes.length - 1].episodeNumber}`
    : `${anime.title} Episode ${selectedEpisodes[0].episodeNumber}`;

  // JSON output for stream URLs
  if (options.json) {
    console.log(JSON.stringify({
      type: 'streams',
      anime: {
        id: anime.id,
        title: anime.title
      },
      episodes: selectedEpisodes.map((ep, i) => ({
        episodeNumber: ep.episodeNumber,
        stream: resolved[i]?.stream,
        url: resolved[i]?.url
      }))
    }));
    return;
  }

  if (options.printUrl) {
    streamUrls.forEach((url) => console.log(url));
    return;
  }

  if (options.download) {
    await downloadEpisodes(anime, selectedEpisodes, resolved, options.outputDir, options.yes, options.copyAudio);
    return;
  }

  const referer = getStreamReferer(firstStream);
  const qStr = firstStream?.quality || 'unknown';
  const displayQuality = qStr.toLowerCase() === 'auto' ? 'Auto' : (qStr.endsWith('p') ? qStr : `${qStr}p`);
  if (!options.json) {
    console.log(`Opening ${title} in ${options.player} (${displayQuality} ${normalizeAudio(firstStream?.audio).toUpperCase()})...`);
    console.log(`Stream: ${streamUrls[0]}`);
  }
  await playInMediaPlayer(streamUrls, options.player, title, options.windowSize, referer);
};

main()
  .catch((error) => {
    console.error(`\nError: ${error?.message || error}`);
    process.exitCode = 1;
  });
