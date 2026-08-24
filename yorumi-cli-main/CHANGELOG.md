# Changelog

All notable changes to the Yorumi CLI project will be documented in this file.

## [2.1.9] - 2026-07-31

### Fixed & Added
- **Multi-Provider Fallback**: Added standalone `AniNeko` stream scraper (`src/anineko.ts`) as a fallback provider when `AllAnime` streams fail or are missing for an episode.
- **Search Episode Ranking**: Fixed episode calculation in `backend-search.ts` to prevent unreleased upcoming seasons (with 0 episodes) from being incorrectly scored and misranked above main released seasons.

## [2.1.8] - 2026-07-26

### Fixed & Changed
- **Dynamic AES-256-GCM Key Scraping**: Replaced static AllManga keys with dynamic runtime scraping of `epoch`, `partB`, and SvelteKit JavaScript chunks from `mkissa.to` to compute the AES-256-GCM key (`aaKey`), preventing static key expiration.
- **ani-cli Alignment & Endpoints**: Updated timestamp-bucketed `aaReq` signature generation (seconds-based timestamp, `epoch:queryHash:ts` seed) and switched API requests to `mkissa.net/api` with `mkissa.to` Origin and Referer headers.
- **AllAnime Payload Decryption**: Added multi-pass key candidates (`SimtVuagFbGR2K7P`, `Xot36i3lK3:v1`, `allanime`) and resilient slicing strategies to `decryptTobeparsed()` in both `yorumi-cli` and the main Yorumi backend scraper to prevent "No valid sources" failures across API payload rotations.

## [2.1.7] - 2026-07-17

### Fixed
- **AllAnime Scraper**: Updated AES-GCM and AES-256-CTR encryption keys for `aaReq` generation and `tobeparsed` decryption to restore streaming source retrieval after API changes.
- **Backend Sync**: Synchronized the main Yorumi backend scraper to utilize the CLI's `aaReq` handshake mechanism.

## [2.1.5] - 2026-07-12
- **AllAnime Scraper**: Updated AES-GCM token generator to dynamically scrape keys from SvelteKit chunks to avoid static key rot.
- **Payload Decryption**: Removed erroneous AES-GCM decryption for `tobeparsed` responses; AllAnime continues to return AES-256-CTR encoded responses with an appended garbage tag that is now safely discarded.

## [2.1.4] - 2026-07-08

### Fixed
- **AllAnime Scraper**: Updated AES-GCM decryption and request signature logic to handle AllAnime's new `extensions.aaReq` requirements and Cloudflare patches.

## [2.1.0] - 2026-07-03

### Added
- **Local Backend Search Fallback**: Search now tries the local Yorumi backend first, then falls back to direct AllAnime GraphQL results when the backend is unavailable.

### Changed
- **Improved Search Ranking**: Exact and near-exact title matches are prioritized above specials, movies, and recap entries so searches like `naruto` select the main series first.

### Fixed
- **No Anime Found on Offline Backend**: Fixed CLI searches returning "No anime found" when `localhost:3001` is not running.
- **Non-HLS mpv Launches**: Fixed non-HLS iframe/player URLs by resolving them through `yt-dlp` before launching `mpv`, while direct CDN media URLs continue to bypass `yt-dlp`.
- **AllAnime Stream Fallback**: Restored direct AllAnime stream resolution so episodes can still resolve without the Yorumi backend.

## [2.0.0] - 2026-06-15

### Added
- **Direct AllAnime (AllManga) API Scraper Integration**: Bypassed GogoAnime's browser-emulation scraping and Vercel proxy requirements. The CLI now queries the AllAnime backend via optimized GraphQL requests.
- **Silent On-the-Fly Decryption**: Integrated native Node.js decryption logic using `aes-256-ctr` to decode AllAnime's encrypted `"tobeparsed"` stream blocks and resolve direct, playable `.m3u8` playlist files.
- **GraphQL-based Search Fallback**: Implemented an automated search pipeline. If GogoAnime's search fails due to Cloudflare anti-bot blocks (yielding 0 results), the CLI automatically falls back to AllAnime's GraphQL API search.
- **Robust Direct Stream Headers**: Added automatic `--referrer` injection and custom HTTP header overrides for Direct streams in `mpv`.

### Changed
- **Architectural Refactor & Code Modularization**: Deconstructed the monolithic CLI architecture into clean, decoupled, single-responsibility modules (`src/allanime.ts`, `src/gogoanime.ts`, `src/player.ts`, `src/downloader.ts`, `src/scraper.ts`, `src/system.ts`, `src/cliUtils.ts`, `src/constants.ts`, `src/types.ts`, `src/utils.ts`).

### Fixed
- **Instant Media Player Playback (`mpv` Code 2 Errors)**: Fixed the frequent "exited with code 2" errors by automatically appending `--no-ytdl` to direct AllAnime HLS `.m3u8` streams. This completely disables unnecessary `youtube-dl` / `yt-dlp` parsing checks, making video streams load instantly.
- **Strict Episode List Mapping (Naruto 1000+ Eps Bug)**: Resolved the episode list overflow bug where sidebar recent releases (e.g., One Piece episodes) were incorrectly counted towards the selected show's total episodes. Scraper regexes are now strictly constrained to the chosen anime's slug.
- **Search Failures on Cloudflare-Blocked Titles**: Fixed "No anime found" errors on titles heavily protected by Cloudflare by resolving them transparently via AllAnime's API search.

## [1.6.8] - 2026-06-14

### Added
- Added `--sub` and `--dub` flags to explicitly prefer SUBbed or DUBbed audio streams when resolving episodes.

## [1.6.7] - 2026-06-13

### Added
- Added `--latest` flag to fetch the top recently updated anime directly from AllManga.
- Added `--popular` flag to fetch trending anime from Animetsu and resolve them locally.

[2.1.5]: https://github.com/davenarchives/yorumi-cli/releases/tag/v2.1.5
[2.1.4]: https://github.com/davenarchives/yorumi-cli/releases/tag/v2.1.4
[2.1.0]: https://github.com/davenarchives/yorumi-cli/releases/tag/v2.1.0
[2.0.0]: https://github.com/davenarchives/yorumi-cli/releases/tag/v2.0.0
[1.6.8]: https://github.com/davenarchives/yorumi-cli/releases/tag/v1.6.8
[1.6.7]: https://github.com/davenarchives/yorumi-cli/releases/tag/v1.6.7
