/**
 * Erumi Web Application Frontend Core - Teal Cinema Edition v2.5.1
 * Capacitor/APK Server Connect + Jellyfin Settings Dashboard
 */
console.log('[Erumi] app.js v2.5.1 loaded — Capacitor build support active');

class ErumiApp {
  constructor() {
    // Detect Capacitor (Android/iOS APK) - multiple checks for reliability
    const proto = window.location.protocol;
    const host = window.location.host;
    const isCapacitor = !!(
      window.Capacitor ||                       // Capacitor runtime object
      proto === 'capacitor:' ||                 // capacitor:// scheme
      (proto === 'http:' && host === 'localhost' && !window._erumiIsServer)  // http://localhost in APK
    );
    const savedServerUrl = localStorage.getItem('erumi_server_url');

    if (isCapacitor && !savedServerUrl) {
      // Show the server connect onboarding screen, defer full init
      this._showServerConnectScreen();
      return;
    }

    // In Capacitor with saved URL, or plain browser → resolve API base
    if (isCapacitor && savedServerUrl) {
      this.apiUrl = savedServerUrl.replace(/\/$/, '');
    } else {
      this.apiUrl = window.location.origin;
    }

    this._initApp();
  }

  _showServerConnectScreen() {
    const screen = document.getElementById('serverConnectScreen');
    if (screen) screen.style.display = 'flex';
    // Global handler for the connect button
    window._erumiConnectServer = async () => {
      const input = document.getElementById('serverIpInput');
      const errEl = document.getElementById('serverConnectError');
      const btn = document.getElementById('serverConnectBtn');
      let url = (input?.value || '').trim().replace(/\/$/, '');
      if (!url) url = 'http://192.168.0.10:3000';
      if (!url.startsWith('http')) url = 'http://' + url;
      errEl.style.display = 'none';
      btn.textContent = 'Connecting...';
      btn.disabled = true;
      try {
        const res = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data.status === 'ok') {
          localStorage.setItem('erumi_server_url', url);
          if (screen) screen.style.display = 'none';
          this.apiUrl = url;
          this._initApp();
        } else {
          throw new Error('Server did not respond correctly.');
        }
      } catch (e) {
        errEl.textContent = `Cannot connect to ${url}. Make sure ErumiServer.exe is running and both devices are on the same Wi-Fi.`;
        errEl.style.display = 'block';
        btn.textContent = 'Connect →';
        btn.disabled = false;
      }
    };
  }

  _initApp() {
    this.currentMode = 'latest';
    this.currentQuery = '';
    this.currentAnimeList = [];
    this.currentAnime = null;
    this.currentEpisodes = [];
    this.currentEpIndex = 0;
    this.hls = null;
    this.searchTimeout = null;

    // 3D 3-Card Carousel state
    this.heroAnimeList = [];
    this.currentHeroIndex = 0;
    this.carouselAutoTimer = null;
    this.touchStartX = 0;
    this.touchEndX = 0;

    this.watchlist = this.loadStorage('erumi_watchlist', []);
    this.history = this.loadStorage('erumi_history', {});
    this.metaCache = this.loadStorage('erumi_meta_cache_v2', {});

    this.initElements();
    this.initEvents();
    this.initTouchSwipe();
    this.initKeyboardShortcuts();
    this.initSettings();
    this.checkStatus();
    this.loadLatest();
    this.updateWatchlistBadge();
    this.updateHistoryBadge();

    this.initFullscreenOrientation();
  }

  /* ── Fullscreen + landscape orientation (Android APK + mobile browsers) ── */

  shouldAutoRotateFullscreen() {
    return this._settingsConfig?.playback?.auto_rotate_fullscreen !== false;
  }

  syncAutoRotateToNative() {
    if (window.ErumiAndroid && window.ErumiAndroid.setAutoRotateFullscreen) {
      window.ErumiAndroid.setAutoRotateFullscreen(this.shouldAutoRotateFullscreen());
    }
  }

  lockLandscapeForVideo() {
    if (!this.shouldAutoRotateFullscreen()) return;
    if (window.ErumiAndroid && window.ErumiAndroid.lockLandscape) {
      window.ErumiAndroid.lockLandscape();
    } else if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  }

  unlockLandscapeForVideo() {
    if (window.ErumiAndroid && window.ErumiAndroid.unlockOrientation) {
      window.ErumiAndroid.unlockOrientation();
    } else if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  }

  isVideoFullscreenActive() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) return false;
    const container = document.getElementById('videoContainer');
    const video = this.videoPlayer;
    return fsEl === video || fsEl === container || fsEl.contains(video) || container?.contains(fsEl);
  }

  handleFullscreenOrientationChange() {
    if (this.isVideoFullscreenActive()) {
      this.lockLandscapeForVideo();
    } else {
      this.unlockLandscapeForVideo();
    }
  }

  initFullscreenOrientation() {
    ['fullscreenchange', 'webkitfullscreenchange'].forEach((event) => {
      document.addEventListener(event, () => this.handleFullscreenOrientationChange());
    });

    if (this.videoPlayer) {
      this.videoPlayer.addEventListener('webkitbeginfullscreen', () => this.lockLandscapeForVideo());
      this.videoPlayer.addEventListener('webkitendfullscreen', () => this.unlockLandscapeForVideo());
    }
  }

  loadStorage(key, defaultVal) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultVal;
    } catch {
      return defaultVal;
    }
  }

  saveStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn('Storage error:', e);
    }
  }

  initElements() {
    // Views
    this.browseView = document.getElementById('browseView');
    this.searchView = document.getElementById('searchView');
    this.watchView = document.getElementById('watchView');

    // Header & Desktop Search
    this.searchInput = document.getElementById('searchInput');
    this.searchClearBtn = document.getElementById('searchClearBtn');
    this.statusDot = document.getElementById('statusDot');
    this.statusLabel = document.getElementById('statusLabel');

    // Dedicated Search Page Elements
    this.searchPageInput = document.getElementById('searchPageInput');
    this.searchPageClearBtn = document.getElementById('searchPageClearBtn');
    this.searchResultsHeader = document.getElementById('searchResultsHeader');
    this.searchResultsTitle = document.getElementById('searchResultsTitle');
    this.searchResultsCount = document.getElementById('searchResultsCount');
    this.searchResultsGrid = document.getElementById('searchResultsGrid');
    this.searchLoader = document.getElementById('searchLoader');
    this.searchLoaderText = document.getElementById('searchLoaderText');
    this.searchEmptyState = document.getElementById('searchEmptyState');
    this.searchEmptyTitle = document.getElementById('searchEmptyTitle');
    this.searchEmptyMessage = document.getElementById('searchEmptyMessage');

    // Browse Elements
    this.animeGrid = document.getElementById('animeGrid');
    this.loader = document.getElementById('loader');
    this.loaderText = document.getElementById('loaderText');
    this.errorState = document.getElementById('errorState');
    this.errorMessage = document.getElementById('errorMessage');
    this.sectionTitle = document.getElementById('sectionTitle');
    this.sectionSubtitle = document.getElementById('sectionSubtitle');
    this.emptyActions = document.getElementById('emptyActions');

    // Continue Watching Shelf
    this.continueWatchingSection = document.getElementById('continueWatchingSection');
    this.continueCardsShelf = document.getElementById('continueCardsShelf');
    this.historyCount = document.getElementById('historyCount');

    // Hero 3D Carousel & Spotlight Elements
    this.heroSection = document.getElementById('heroSection');
    this.heroTitle = document.getElementById('heroTitle');
    this.heroDesc = document.getElementById('heroDesc');
    this.heroYear = document.getElementById('heroYear');
    this.heroScore = document.getElementById('heroScore');
    this.heroEps = document.getElementById('heroEps');
    this.heroBg = document.getElementById('heroBg');
    this.heroStatusText = document.getElementById('heroStatusText');
    this.heroTypeBadge = document.getElementById('heroTypeBadge');
    this.heroDotsIndicator = document.getElementById('heroDotsIndicator');
    this.hero3DCarousel = document.getElementById('hero3DCarousel');

    // 3 Cards
    this.cardPrev = document.getElementById('cardPrev');
    this.cardActive = document.getElementById('cardActive');
    this.cardNext = document.getElementById('cardNext');
    this.imgCardPrev = document.getElementById('imgCardPrev');
    this.imgCardActive = document.getElementById('imgCardActive');
    this.imgCardNext = document.getElementById('imgCardNext');

    // Watch Page Elements
    this.videoPlayer = document.getElementById('videoPlayer');
    this.videoLoader = document.getElementById('videoLoader');
    this.videoStatusText = document.getElementById('videoStatusText');
    this.watchBreadcrumbAnime = document.getElementById('watchBreadcrumbAnime');
    this.watchBreadcrumbEp = document.getElementById('watchBreadcrumbEp');
    this.watchAnimeTitle = document.getElementById('watchAnimeTitle');
    this.watchAnimeSub = document.getElementById('watchAnimeSub');
    this.watchAnimeDesc = document.getElementById('watchAnimeDesc');
    this.watchEpBadge = document.getElementById('watchEpBadge');
    this.watchYearBadge = document.getElementById('watchYearBadge');
    this.watchScoreBadge = document.getElementById('watchScoreBadge');
    this.watchQualityBadge = document.getElementById('watchQualityBadge');
    this.watchSaveText = document.getElementById('watchSaveText');
    this.autoNextCheck = document.getElementById('autoNextCheck');

    // Watch Sidebar
    this.sidebarEpCount = document.getElementById('sidebarEpCount');
    this.sidebarEpisodesList = document.getElementById('sidebarEpisodesList');
    this.epRangeTabs = document.getElementById('epRangeTabs');
    this.epJumpInput = document.getElementById('epJumpInput');

    // Modals
    this.aboutModal = document.getElementById('aboutModal');
    this.lanModal = document.getElementById('lanModal');
    this.lanQrImage = document.getElementById('lanQrImage');
    this.lanUrlInput = document.getElementById('lanUrlInput');
  }

  initEvents() {
    // Desktop Header Search
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        this.searchClearBtn.style.display = q ? 'flex' : 'none';
        clearTimeout(this.searchTimeout);
        if (q.length > 1) {
          this.searchTimeout = setTimeout(() => {
            this.showSearchView(q);
          }, 350);
        }
      });

      this.searchClearBtn.addEventListener('click', () => {
        this.searchInput.value = '';
        this.searchClearBtn.style.display = 'none';
        this.loadLatest();
      });
    }

    // Dedicated Search Page Input
    if (this.searchPageInput) {
      this.searchPageInput.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        this.searchPageClearBtn.style.display = q ? 'flex' : 'none';
        clearTimeout(this.searchTimeout);
        if (q.length > 1) {
          this.searchTimeout = setTimeout(() => {
            this.performSearch(q);
          }, 350);
        } else if (q.length === 0) {
          this.clearSearchPage();
        }
      });
    }

    // Save playback progress on timeupdate
    this.videoPlayer.addEventListener('timeupdate', () => {
      this.saveCurrentPlaybackProgress();
    });

    // Auto next on video end
    this.videoPlayer.addEventListener('ended', () => {
      if (this.autoNextCheck && this.autoNextCheck.checked) {
        this.showToast('Episode finished. Auto-playing next episode...', 'info');
        setTimeout(() => this.playNextEpisode(), 1200);
      }
    });

    // Pause carousel on mouse enter, resume on leave
    if (this.heroSection) {
      this.heroSection.addEventListener('mouseenter', () => this.stopCarouselAutoPlay());
      this.heroSection.addEventListener('mouseleave', () => this.startCarouselAutoPlay());
    }

    this.initRecoShelfScroll();
  }

  initRecoShelfScroll() {
    const shelf = document.getElementById('recommendationsGrid');
    if (!shelf || shelf.dataset.scrollReady === '1') return;
    shelf.dataset.scrollReady = '1';

    shelf.addEventListener('scroll', () => this.updateRecoScrollButtons(), { passive: true });
    window.addEventListener('resize', () => this.updateRecoScrollButtons());

    let isDragging = false;
    let startX = 0;
    let scrollLeft = 0;

    shelf.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.pageX - shelf.offsetLeft;
      scrollLeft = shelf.scrollLeft;
      shelf.classList.add('is-dragging');
    });

    shelf.addEventListener('mouseleave', () => {
      isDragging = false;
      shelf.classList.remove('is-dragging');
    });

    shelf.addEventListener('mouseup', () => {
      isDragging = false;
      shelf.classList.remove('is-dragging');
    });

    shelf.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const x = e.pageX - shelf.offsetLeft;
      shelf.scrollLeft = scrollLeft - (x - startX);
    });
  }

  scrollRecoShelf(direction = 1) {
    const shelf = document.getElementById('recommendationsGrid');
    if (!shelf) return;
    const amount = Math.max(320, Math.floor(shelf.clientWidth * 0.72));
    shelf.scrollBy({ left: direction * amount, behavior: 'smooth' });
  }

  updateRecoScrollButtons() {
    const shelf = document.getElementById('recommendationsGrid');
    const prev = document.getElementById('recoScrollPrev');
    const next = document.getElementById('recoScrollNext');
    if (!shelf || !prev || !next) return;

    const maxScroll = Math.max(0, shelf.scrollWidth - shelf.clientWidth);
    prev.disabled = shelf.scrollLeft <= 4;
    next.disabled = shelf.scrollLeft >= maxScroll - 4;
  }

  cleanQueryForCli(str) {
    if (!str) return '';
    let clean = str.trim();
    // If the title contains a subtitle colon (e.g. "KAMUI: He's Behind You"),
    // AllAnime CLI parser fails on the colon. The main prefix before ":" always resolves accurately.
    if (clean.includes(':') && !clean.toLowerCase().startsWith('re:')) {
      const parts = clean.split(':');
      if (parts[0].trim().length >= 2) {
        clean = parts[0].trim();
      }
    }
    return clean;
  }

  buildAnimeApiParams(anime, extra = {}) {
    const params = new URLSearchParams({ ...extra });
    let q = '';
    let idx = String(anime.index || 1);
    let mode = anime.mode || 'direct';

    if (anime.searchQuery && anime.searchQuery.trim()) {
      q = anime.searchQuery.trim();
      mode = 'search';
    } else if (anime.title && anime.title.trim()) {
      q = anime.title.trim();
    } else if (anime.name && anime.name.trim()) {
      q = anime.name.trim();
    }

    const cleanQ = this.cleanQueryForCli(q);

    params.set('query', cleanQ || q);
    params.set('index', idx);
    params.set('mode', mode);
    return params;
  }

  hideAllMainViews() {
    if (this.browseView) this.browseView.style.display = 'none';
    if (this.searchView) this.searchView.style.display = 'none';
    if (this.watchView) this.watchView.style.display = 'none';
  }

  initTouchSwipe() {
    if (!this.hero3DCarousel) return;
    this.hero3DCarousel.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
      this.stopCarouselAutoPlay();
    }, { passive: true });

    this.hero3DCarousel.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      const diff = this.touchEndX - this.touchStartX;
      if (Math.abs(diff) > 40) {
        if (diff > 0) {
          this.slide3DCarousel(-1); // Swipe Right -> Prev
        } else {
          this.slide3DCarousel(1);  // Swipe Left -> Next
        }
      }
      this.startCarouselAutoPlay();
    }, { passive: true });
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target === this.searchInput || e.target === this.searchPageInput || e.target === this.epJumpInput) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        this.showSearchView();
      } else if (e.key === 'Escape') {
        if (this.aboutModal.classList.contains('active')) {
          this.closeAboutModal();
        } else if (this.lanModal.classList.contains('active')) {
          this.closeLanModal();
        } else if (this.watchView.style.display !== 'none') {
          this.showBrowseView();
        }
      } else if (this.watchView.style.display !== 'none') {
        if (e.key === ' ' || e.key.toLowerCase() === 'k') {
          e.preventDefault();
          this.videoPlayer.paused ? this.videoPlayer.play() : this.videoPlayer.pause();
        } else if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          this.toggleFullscreen();
        } else if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          this.videoPlayer.muted = !this.videoPlayer.muted;
        } else if (e.key === 'ArrowRight') {
          this.videoPlayer.currentTime = Math.min(this.videoPlayer.duration, this.videoPlayer.currentTime + 5);
        } else if (e.key === 'ArrowLeft') {
          this.videoPlayer.currentTime = Math.max(0, this.videoPlayer.currentTime - 5);
        }
      }
    });
  }

  toggleFullscreen() {
    const container = document.getElementById('videoContainer');

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const requestFs = container.requestFullscreen || container.webkitRequestFullscreen;
      if (!requestFs) return;

      Promise.resolve(requestFs.call(container))
        .then(() => this.lockLandscapeForVideo())
        .catch(() => this.lockLandscapeForVideo());
    } else {
      const exitFs = document.exitFullscreen || document.webkitExitFullscreen;
      if (exitFs) exitFs.call(document).catch(() => {});
      this.unlockLandscapeForVideo();
    }
  }

  async checkStatus() {
    try {
      const res = await fetch(`${this.apiUrl}/api/status`);
      const data = await res.json();
      if (this.statusDot) {
        this.statusDot.className = data.cli_ready ? 'status-indicator ready' : 'status-indicator error';
      }
      if (this.statusLabel) {
        this.statusLabel.textContent = data.cli_ready ? 'Ready' : 'CLI Missing';
      }
    } catch {
      if (this.statusDot) this.statusDot.className = 'status-indicator error';
      if (this.statusLabel) this.statusLabel.textContent = 'Offline';
    }
  }

  /* ── Metadata & Poster Resolver (AniList API + Cache + Airing Validation) ── */

  cleanTitleForSearch(title) {
    if (!title) return '';
    return title
      .replace(/\((TV|Dub|Sub|Dubbed|Subbed|Uncensored|Batch|Raw|1080p|720p)\)/gi, '')
      .replace(/\[(TV|Dub|Sub|Dubbed|Subbed|Uncensored|Batch|Raw|1080p|720p)\]/gi, '')
      .replace(/ - \d+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  setCardPoster(imgEl, src) {
    if (!imgEl || !src) return;
    imgEl.onload = () => imgEl.classList.add('loaded');
    imgEl.src = src;
    if (imgEl.complete) {
      imgEl.classList.add('loaded');
    }
  }

  applyPosterToElement(imgEl, fallbackEl, src) {
    if (!imgEl || !src) return;
    imgEl.onload = () => {
      imgEl.style.display = 'block';
      if (fallbackEl) fallbackEl.style.display = 'none';
    };
    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      if (fallbackEl) fallbackEl.style.display = 'flex';
    };
    imgEl.src = src;
    if (imgEl.complete && imgEl.naturalWidth > 0) {
      imgEl.style.display = 'block';
      if (fallbackEl) fallbackEl.style.display = 'none';
    }
  }

  async resolveItemArt(item) {
    if (item?.poster || item?.banner) {
      return { poster: item.poster || null, banner: item.banner || null };
    }

    const showId = String(item?.session || '').replace(/^allanime:/, '');
    const title = item?.title || item?.name || '';

    // If no showId and no title, can't fetch anything
    if (!showId && !title) return { poster: null, banner: null };

    try {
      const url = new URL(`${this.apiUrl}/api/poster`);
      if (showId) url.searchParams.set('showId', showId);
      if (title) url.searchParams.set('title', title);
      
      const res = await fetch(url.toString());
      const json = await res.json();
      if (json.success && json.data) {
        if (json.data.poster) item.poster = json.data.poster;
        if (json.data.banner) item.banner = json.data.banner;
        return {
          poster: json.data.poster || null,
          banner: json.data.banner || null,
          source: json.data.source || 'unknown',
        };
      }
    } catch (e) {
      console.warn('[Erumi] Failed to resolve item art:', e);
    }

    return { poster: null, banner: null };
  }

  async resolveItemPoster(item) {
    const art = await this.resolveItemArt(item);
    return art.poster;
  }

  getSeasonNumber(title) {
    if (!title) return 1;
    const t = title.toLowerCase();
    if (/\b(season\s*4|4th\s*season|iv|s4)\b/.test(t)) return 4;
    if (/\b(season\s*3|3rd\s*season|iii|s3)\b/.test(t)) return 3;
    if (/\b(season\s*2|2nd\s*season|ii|s2|part\s*2|two)\b/.test(t)) return 2;
    if (/\b(season\s*1|1st\s*season|i|s1|part\s*1|one)\b/.test(t)) return 1;
    return 1;
  }

  pickBestMediaCandidate(title, year, mediaList) {
    if (!mediaList || mediaList.length === 0) return null;
    if (mediaList.length === 1) return mediaList[0];

    const targetSeason = this.getSeasonNumber(title);
    let best = mediaList[0];
    let bestScore = -999;

    mediaList.forEach(m => {
      let score = 0;
      const tEng = (m.title?.english || '').toLowerCase();
      const tRom = (m.title?.romaji || '').toLowerCase();
      const mSeasonEng = this.getSeasonNumber(tEng);
      const mSeasonRom = this.getSeasonNumber(tRom);
      const mSeason = mSeasonEng !== 1 ? mSeasonEng : mSeasonRom;

      if (targetSeason === mSeason) {
        score += 50;
      } else if (targetSeason > 1 && mSeason === 1) {
        score -= 40;
      } else if (targetSeason === 1 && mSeason > 1) {
        score -= 40;
      }

      const mYear = m.seasonYear;
      if (year && mYear) {
        const numYear = parseInt(year, 10);
        if (numYear === mYear) score += 30;
        else if (Math.abs(numYear - mYear) <= 1) score += 15;
      }

      if (m.status === 'RELEASING' && targetSeason > 1) score += 15;
      if (tRom.includes('movie') && !title.toLowerCase().includes('movie')) score -= 30;

      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    });

    return best;
  }

  async fetchAnimeMetadata(title, year = null) {
    if (!title) return null;
    const cleanTitle = this.cleanTitleForSearch(title);
    const cacheKey = year ? `${cleanTitle}_${year}` : cleanTitle;
    if (this.metaCache[cacheKey]) {
      return this.metaCache[cacheKey];
    }

    const parseMedia = (media) => {
      if (!media) return null;
      let maxAiredEpisode = null;
      if (media.nextAiringEpisode && typeof media.nextAiringEpisode.episode === 'number') {
        maxAiredEpisode = media.nextAiringEpisode.episode - 1;
      } else if (media.status === 'NOT_YET_RELEASED') {
        maxAiredEpisode = 0;
      } else if (typeof media.episodes === 'number' && media.episodes > 0) {
        maxAiredEpisode = media.episodes;
      }

      return {
        poster: media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || null,
        banner: media.bannerImage || null,
        score: media.averageScore ? (media.averageScore / 10).toFixed(1) : null,
        status: media.status ? media.status.replace(/_/g, ' ') : 'RELEASING',
        format: media.format || 'TV',
        desc: media.description ? media.description.replace(/<[^>]*>?/gm, '') : null,
        genres: media.genres || [],
        totalEpisodes: media.episodes || null,
        nextAiringEpisode: media.nextAiringEpisode || null,
        maxAiredEpisode: maxAiredEpisode
      };
    };

    // 1. Try local server API
    try {
      const url = new URL(`${this.apiUrl}/api/metadata`);
      url.searchParams.set('q', cleanTitle);
      if (year) url.searchParams.set('year', String(year));
      const res = await fetch(url.toString());
      const json = await res.json();
      if (json.success && json.data) {
        const meta = parseMedia(json.data);
        if (meta) {
          this.metaCache[cacheKey] = meta;
          this.saveStorage('erumi_meta_cache_v2', this.metaCache);
          return meta;
        }
      }
    } catch {
      // Fall through to direct query
    }

    // 2. Direct browser AniList fuzzy query fallback with Season matching
    try {
      const query = `
        query ($s: String) {
          Page(page: 1, perPage: 5) {
            media(search: $s, type: ANIME, sort: SEARCH_MATCH) {
              id
              title { romaji english userPreferred }
              status
              format
              episodes
              seasonYear
              nextAiringEpisode { episode timeUntilAiring }
              coverImage { extraLarge large medium }
              bannerImage
              averageScore
              description(asHtml: false)
              genres
            }
          }
        }
      `;
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { s: cleanTitle } })
      });
      const data = await res.json();
      const mediaList = data?.data?.Page?.media || [];
      if (mediaList.length > 0) {
        const bestCandidate = this.pickBestMediaCandidate(cleanTitle, year, mediaList);
        const meta = parseMedia(bestCandidate);
        if (meta) {
          this.metaCache[cacheKey] = meta;
          this.saveStorage('erumi_meta_cache_v2', this.metaCache);
          return meta;
        }
      }
    } catch {
      // Ignore
    }

    return null;
  }

  /* ── Continue Watching & Playback History Core ──────────── */

  saveCurrentPlaybackProgress() {
    if (this._isSwitchingEpisode) return;
    if (!this.currentAnime || !this.currentEpisodes[this.currentEpIndex]) return;
    const curTime = this.videoPlayer.currentTime;
    const dur = this.videoPlayer.duration || 0;
    if (curTime < 3 || dur <= 0 || isNaN(curTime)) return;

    const ep = this.currentEpisodes[this.currentEpIndex];
    const epNum = ep.episodeNumber;
    const key = `${this.currentAnime.title}_ep_${epNum}`;

    this.history[key] = {
      key: key,
      anime: {
        title: this.currentAnime.title,
        name: this.currentAnime.name || this.currentAnime.title,
        year: this.currentAnime.year,
        index: this.currentAnime.index || 1,
        mode: this.currentAnime.mode || 'direct',
        searchQuery: this.currentAnime.searchQuery
      },
      episodeNumber: epNum,
      episodeIndex: this.currentEpIndex,
      currentTime: Math.floor(curTime),
      duration: Math.floor(dur),
      percent: dur > 0 ? Math.min(100, Math.round((curTime / dur) * 100)) : 0,
      updatedAt: Date.now()
    };

    this.saveStorage('erumi_history', this.history);
    this.updateHistoryBadge();
  }

  renderContinueWatchingShelf() {
    if (!this.continueWatchingSection || !this.continueCardsShelf) return;

    const items = Object.values(this.history)
      .filter(item => item.percent < 95 && item.currentTime > 5)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8);

    if (items.length === 0) {
      this.continueWatchingSection.style.display = 'none';
      return;
    }

    this.continueWatchingSection.style.display = 'block';
    this.continueCardsShelf.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'continue-card';

      const remainSec = Math.max(0, item.duration - item.currentTime);
      const remainText = remainSec > 0 ? `${Math.ceil(remainSec / 60)}m left` : `${item.percent}%`;

      card.innerHTML = `
        <div class="continue-card-thumb">
          <img id="continueImg_${item.key.replace(/[^a-zA-Z0-9]/g, '_')}" src="favicon-32x32.png" alt="${item.anime.title}">
          <span class="continue-ep-tag">EP ${item.episodeNumber}</span>
          <button class="continue-remove-btn" title="Remove" onclick="app.removeFromHistory('${item.key}', event)">
            <i data-feather="x"></i>
          </button>
          <div class="continue-play-overlay">
            <div class="continue-play-circle">
              <i data-feather="play"></i>
            </div>
          </div>
          <div class="continue-progress-track">
            <div class="continue-progress-bar" style="width: ${item.percent}%"></div>
          </div>
        </div>
        <div class="continue-card-info">
          <h4 class="continue-card-title" title="${item.anime.title}">${item.anime.title}</h4>
          <div class="continue-card-meta">
            <span>Episode ${item.episodeNumber}</span>
            <span class="continue-card-time">${remainText}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.continue-remove-btn')) return;
        this.resumeWatching(item);
      });

      this.continueCardsShelf.appendChild(card);

      // Posters from Yorumi / AllAnime (not AniList)
      this.resolveItemArt(item.anime).then((art) => {
        const imgEl = document.getElementById(`continueImg_${item.key.replace(/[^a-zA-Z0-9]/g, '_')}`);
        if (imgEl && (art.banner || art.poster)) {
          imgEl.src = art.banner || art.poster;
        }
      });
    });

    if (window.feather) feather.replace();
  }

  resumeWatching(item) {
    // Use the stored mode from history to ensure correct anime loading
    const animeObj = {
      title: item.anime.title,
      name: item.anime.name || item.anime.title,
      year: item.anime.year,
      index: 1,
      mode: item.anime.mode || 'direct',
      searchQuery: item.anime.searchQuery
    };
    this.openWatchView(animeObj, item.episodeNumber, item.currentTime);
  }

  removeFromHistory(key, event) {
    if (event) event.stopPropagation();
    delete this.history[key];
    this.saveStorage('erumi_history', this.history);
    this.updateHistoryBadge();
    this.renderContinueWatchingShelf();
    if (this.currentMode === 'history') {
      this.showHistoryView();
    }
    this.showToast('Removed from history.', 'info');
  }

  clearAllHistory() {
    this.history = {};
    this.saveStorage('erumi_history', this.history);
    this.updateHistoryBadge();
    this.renderContinueWatchingShelf();
    this.showHistoryView();
    this.showToast('Watch history cleared.', 'success');
  }

  showHistoryView() {
    this.hideAllMainViews();
    this.browseView.style.display = 'block';
    this.videoPlayer.pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    this.currentMode = 'history';
    this.setActiveNav('history');
    this.sectionTitle.textContent = 'Watch History';
    this.sectionSubtitle.textContent = 'Episodes you recently watched';
    this.heroSection.style.display = 'none';
    this.continueWatchingSection.style.display = 'none';
    const recoSection = document.getElementById('recommendationsSection');
    if (recoSection) recoSection.style.display = 'none';

    const historyItems = Object.values(this.history).sort((a, b) => b.updatedAt - a.updatedAt);

    if (historyItems.length === 0) {
      this.showError('No watch history yet. Start watching anime to track your progress.');
      this.emptyActions.innerHTML = `<button class="btn btn-primary" onclick="app.loadLatest()">Explore Latest</button>`;
    } else {
      this.renderHistoryGrid(historyItems);
      this.hideLoader();
    }
  }

  renderHistoryGrid(items) {
    this.animeGrid.innerHTML = '';
    
    // Add Clear All Bar if items exist
    const clearBar = document.createElement('div');
    clearBar.style.gridColumn = '1 / -1';
    clearBar.style.display = 'flex';
    clearBar.style.justifyContent = 'flex-end';
    clearBar.style.marginBottom = '10px';
    clearBar.innerHTML = `
      <button class="btn btn-sm btn-glass" onclick="app.clearAllHistory()">
        <i data-feather="trash-2"></i>
        <span>Clear All History</span>
      </button>
    `;
    this.animeGrid.appendChild(clearBar);

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'anime-card';

      const remainSec = Math.max(0, item.duration - item.currentTime);
      const remainText = remainSec > 0 ? `${Math.ceil(remainSec / 60)}m left` : 'Completed';
      const initials = (item.anime.title || 'A').slice(0, 2).toUpperCase();

      card.innerHTML = `
        <div class="card-poster">
          <div class="card-placeholder-fallback">
            <div class="fallback-initials">${initials}</div>
            <div class="fallback-sub">Erumi</div>
          </div>
          <img id="histPoster_${index}" alt="${item.anime.title}" loading="lazy">
          <span class="card-badge">EP ${item.episodeNumber}</span>
          <div class="card-overlay">
            <div class="card-play-btn">
              <i data-feather="play"></i>
            </div>
          </div>
          <div class="continue-progress-track" style="position: absolute; bottom: 0; left: 0; right: 0; height: 5px;">
            <div class="continue-progress-bar" style="width: ${item.percent}%"></div>
          </div>
        </div>
        <div class="card-info">
          <h4 class="card-title" title="${item.anime.title}">${item.anime.title}</h4>
          <div class="card-meta">
            <span>Ep ${item.episodeNumber}</span>
            <span class="continue-card-time">${remainText}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => this.resumeWatching(item));
      this.animeGrid.appendChild(card);

      this.resolveItemPoster(item.anime).then((poster) => {
        if (poster) {
          const imgEl = document.getElementById(`histPoster_${index}`);
          this.setCardPoster(imgEl, poster);
        }
      });
    });

    if (window.feather) feather.replace();
  }

  updateHistoryBadge() {
    const count = Object.keys(this.history).length;
    if (this.historyCount) {
      this.historyCount.textContent = count;
      this.historyCount.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  /* ── Dedicated Search Page Controller ──────────────────── */

  showSearchView(initialQuery = '') {
    this.hideAllMainViews();
    this.searchView.style.display = 'block';
    this.videoPlayer.pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    this.currentMode = 'search';
    this.setActiveNav('search');

    if (initialQuery) {
      this.searchPageInput.value = initialQuery;
      this.searchPageClearBtn.style.display = 'flex';
      this.performSearch(initialQuery);
    } else {
      setTimeout(() => {
        this.searchPageInput.focus();
      }, 100);
    }
  }

  searchByTag(query) {
    this.showSearchView(query);
  }

  clearSearchPage() {
    this.searchPageInput.value = '';
    this.searchPageClearBtn.style.display = 'none';
    this.searchResultsHeader.style.display = 'none';
    this.searchResultsGrid.innerHTML = '';
    this.searchEmptyState.style.display = 'none';
  }

  async performSearch(query) {
    if (!query) return;
    this.currentQuery = query;

    this.searchLoader.style.display = 'flex';
    this.searchLoaderText.textContent = `Searching for "${query}"...`;
    this.searchEmptyState.style.display = 'none';
    this.searchResultsHeader.style.display = 'none';
    this.searchResultsGrid.innerHTML = '';

    try {
      const res = await fetch(`${this.apiUrl}/api/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      this.searchLoader.style.display = 'none';

      if (json.success && json.data && json.data.results) {
        const list = json.data.results;
        this.searchResultsHeader.style.display = 'flex';
        this.searchResultsTitle.textContent = `Results for "${query}"`;
        this.searchResultsCount.textContent = `${list.length} titles found`;

        if (list.length === 0) {
          this.searchEmptyState.style.display = 'flex';
          this.searchEmptyTitle.textContent = `No anime found for "${query}"`;
        } else {
          this.renderSearchResultsGrid(list);
        }
      } else {
        this.searchEmptyState.style.display = 'flex';
        this.searchEmptyTitle.textContent = 'Search returned no results';
      }
    } catch (e) {
      this.searchLoader.style.display = 'none';
      this.searchEmptyState.style.display = 'flex';
      this.searchEmptyTitle.textContent = 'Search Error';
      this.searchEmptyMessage.textContent = e.message;
    }
  }

  renderSearchResultsGrid(list) {
    this.searchResultsGrid.innerHTML = '';
    list.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'anime-card';

      const epText = item.episodes ? `${item.episodes} EPS` : 'HD';
      const yearText = item.year ? `${item.year}` : '';
      const initials = (item.title || 'A').slice(0, 2).toUpperCase();

      card.innerHTML = `
        <div class="card-poster">
          <div class="card-placeholder-fallback">
            <div class="fallback-initials">${initials}</div>
            <div class="fallback-sub">Erumi</div>
          </div>
          <img id="srchPoster_${index}" alt="${item.title}" loading="lazy">
          <span class="card-badge">${epText}</span>
          <span class="card-score-badge" id="srchScore_${index}" style="display:none;"></span>
          <div class="card-overlay">
            <div class="card-play-btn">
              <i data-feather="play"></i>
            </div>
          </div>
        </div>
        <div class="card-info">
          <h4 class="card-title" title="${item.title}">${item.title}</h4>
          <div class="card-meta">
            <span>${yearText}</span>
            <span>#${item.index || index + 1}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        const animeObj = {
          ...item,
          mode: 'search',
          index: item.index || (index + 1),
          searchQuery: this.currentQuery
        };
        this.openWatchView(animeObj, 0);
      });

      this.searchResultsGrid.appendChild(card);

      // Posters from Yorumi / AllAnime catalog
      this.resolveItemPoster(item).then((poster) => {
        if (poster) {
          const imgEl = document.getElementById(`srchPoster_${index}`);
          this.setCardPoster(imgEl, poster);
        }
      });
    });

    if (window.feather) feather.replace();
  }

  /* ── View Navigation ──────────────────────────────────── */

  showBrowseView() {
    this.hideAllMainViews();
    this.browseView.style.display = 'block';
    this.videoPlayer.pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.updateMobileNav('home');
  }

  async openWatchView(anime, targetEpIdentifier = 0, resumeTime = null) {
    // Increment session token — any in-flight fetch from a previous openWatchView
    // call that resolves later will see a mismatched token and discard its result.
    const sessionId = (this._watchSessionId = (this._watchSessionId || 0) + 1);

    this.currentAnime = anime;

    this.hideAllMainViews();
    this.watchView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Update Details
    this.watchBreadcrumbAnime.textContent = anime.title;
    this.watchAnimeTitle.textContent = anime.title;
    this.watchAnimeSub.textContent = anime.name || anime.englishName || 'Anime Streaming';
    this.watchYearBadge.textContent = anime.year ? `${anime.year}` : 'Latest';
    this.watchQualityBadge.textContent = 'HD 1080p';
    this.watchAnimeDesc.textContent = anime.name ? `Original title: ${anime.name}. High quality stream with sub/dub options.` : 'Instant stream via Yorumi backend.';

    this.updateSaveButtonState();

    // Fetch poster & metadata in parallel (with season & year matching)
    const metaPromise = this.fetchAnimeMetadata(anime.title, anime.year);
    metaPromise.then(meta => {
      if (this._watchSessionId !== sessionId) return; // stale — user opened a different anime
      if (meta) {
        if (meta.score) {
          this.watchScoreBadge.textContent = `⭐ ${meta.score}`;
          this.watchScoreBadge.style.display = 'inline-flex';
        }
        if (meta.desc) {
          this.watchAnimeDesc.textContent = meta.desc;
        }
      }
    });

    // Fetch and render verified available episode list
    const meta = await metaPromise;
    if (this._watchSessionId !== sessionId) return; // user opened another anime while awaiting
    await this.fetchEpisodesForWatchView(anime, targetEpIdentifier, resumeTime, meta, sessionId);
  }

  async fetchEpisodesForWatchView(anime, targetEpIdentifier = 0, resumeTime = null, meta = null, sessionId = null) {
    this.sidebarEpisodesList.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div>';
    this.sidebarEpCount.textContent = 'Checking available aired episodes...';

    const params = this.buildAnimeApiParams(anime);

    try {
      const res = await fetch(`${this.apiUrl}/api/episodes?${params.toString()}`);
      const json = await res.json();
      
      if (json.success && json.data && json.data.episodes && json.data.episodes.length > 0) {
        const rawEps = json.data.episodes;
        
        let validEps = rawEps
          .filter(ep => ep && ep.episodeNumber !== undefined && ep.episodeNumber !== null && String(ep.episodeNumber).trim() !== '')
          .map(ep => ({
            ...ep,
            episodeNumber: String(ep.episodeNumber).trim(),
            numVal: parseFloat(ep.episodeNumber) || 0
          }));

        // Sort ascending numerically
        validEps.sort((a, b) => a.numVal - b.numVal);

        // Deduplicate
        const seen = new Set();
        validEps = validEps.filter(ep => {
          if (seen.has(ep.episodeNumber)) return false;
          seen.add(ep.episodeNumber);
          return true;
        });

        // Strict Airing Verification: Filter out un-aired / future / placeholder episodes
        let maxAired = null;
        if (meta && typeof meta.maxAiredEpisode === 'number' && meta.maxAiredEpisode > 0) {
          maxAired = meta.maxAiredEpisode;
        } else if (meta && meta.nextAiringEpisode && typeof meta.nextAiringEpisode.episode === 'number') {
          maxAired = meta.nextAiringEpisode.episode - 1;
        } else if (meta && meta.status === 'NOT_YET_RELEASED') {
          maxAired = 0;
        } else if (anime && typeof anime.episodes === 'number' && anime.episodes > 0 && anime.episodes < validEps.length) {
          maxAired = anime.episodes;
        }

        if (maxAired !== null && maxAired >= 0) {
          validEps = validEps.filter(ep => ep.numVal <= (maxAired + 0.5));
        }

        // Guard: if user navigated to a different anime while this fetch was in-flight, discard
        if (sessionId !== null && this._watchSessionId !== sessionId) return;

        this.currentEpisodes = validEps;

        if (this.currentEpisodes.length === 0) {
          const nextMsg = meta && meta.nextAiringEpisode ? ` (Next episode airs soon)` : '';
          this.sidebarEpisodesList.innerHTML = `<p style="color: var(--warning); padding: 16px;">This anime has not aired any episodes yet${nextMsg}.</p>`;
          this.sidebarEpCount.textContent = '0 episodes available';
          return;
        }

        const firstEp = this.currentEpisodes[0].episodeNumber;
        const lastEp = this.currentEpisodes[this.currentEpisodes.length - 1].episodeNumber;
        this.sidebarEpCount.textContent = `${this.currentEpisodes.length} Aired Episodes (Ep ${firstEp} – ${lastEp})`;

        // Find which episode index to start
        let epIdx = 0;
        if (targetEpIdentifier !== undefined && targetEpIdentifier !== null) {
          const match = this.currentEpisodes.findIndex(e => String(e.episodeNumber) === String(targetEpIdentifier));
          if (match >= 0) {
            epIdx = match;
          } else if (typeof targetEpIdentifier === 'number' && targetEpIdentifier < this.currentEpisodes.length) {
            epIdx = targetEpIdentifier;
          }
        }

        this.renderSidebarEpisodeList(this.currentEpisodes);
        this.playEpisode(epIdx, resumeTime);
      } else {
        this.sidebarEpisodesList.innerHTML = `<p style="color: var(--danger); padding: 16px;">No available episodes found for this title.</p>`;
        this.sidebarEpCount.textContent = '0 episodes';
      }
    } catch (e) {
      this.sidebarEpisodesList.innerHTML = `<p style="color: var(--danger); padding: 16px;">Episode fetch error: ${e.message}</p>`;
      this.sidebarEpCount.textContent = 'Error';
    }
  }

  renderSidebarEpisodeList(episodes, activeRangeStart = 1, rangeSize = 50) {
    this.renderRangeTabs(episodes.length, activeRangeStart, rangeSize);

    const filtered = episodes.filter(ep => {
      const num = parseInt(ep.episodeNumber, 10);
      return num >= activeRangeStart && num < activeRangeStart + rangeSize;
    });

    this.sidebarEpisodesList.innerHTML = '';
    filtered.forEach((ep) => {
      const num = ep.episodeNumber;
      const key = `${this.currentAnime.title}_ep_${num}`;
      const isWatched = !!this.history[key];
      const isCurrent = (this.currentEpisodes[this.currentEpIndex]?.episodeNumber === num);
      const isUnavailable = ep.unavailable === true;

      const card = document.createElement('div');
      card.className = `sidebar-ep-card ${isCurrent ? 'active' : ''} ${isUnavailable ? 'unavailable' : ''}`;
      card.id = `epCard_${num}`;

      let statusTag = 'Available';
      if (isUnavailable) statusTag = 'Unavailable / Not Aired';
      else if (isCurrent) statusTag = 'Now Playing';
      else if (isWatched) statusTag = 'Watched';

      card.innerHTML = `
        <div class="sidebar-ep-left">
          <div class="ep-index-badge">${num}</div>
          <div class="ep-meta-wrap">
            <span class="ep-name">Episode ${num}</span>
            <span class="ep-status-tag">${statusTag}</span>
          </div>
        </div>
        <div class="sidebar-ep-right">
          ${isCurrent ? `
            <div class="sound-wave">
              <span></span><span></span><span></span>
            </div>
          ` : `<i data-feather="${isUnavailable ? 'alert-circle' : 'play'}" style="width: 16px; height: 16px; color: ${isUnavailable ? 'var(--danger)' : 'var(--text-dim)'};"></i>`}
        </div>
      `;

      card.addEventListener('click', () => {
        const epIdx = this.currentEpisodes.findIndex(e => e.episodeNumber === num);
        if (epIdx >= 0) this.playEpisode(epIdx);
      });

      this.sidebarEpisodesList.appendChild(card);
    });

    if (window.feather) feather.replace();
  }

  renderRangeTabs(total, currentStart, size) {
    this.epRangeTabs.innerHTML = '';
    if (total <= size) return;

    for (let start = 1; start <= total; start += size) {
      const end = Math.min(start + size - 1, total);
      const tab = document.createElement('button');
      tab.className = `range-tab ${start === currentStart ? 'active' : ''}`;
      tab.textContent = `${start}-${end}`;
      tab.addEventListener('click', () => {
        this.renderSidebarEpisodeList(this.currentEpisodes, start, size);
      });
      this.epRangeTabs.appendChild(tab);
    }
  }

  jumpToEpisode() {
    const val = parseInt(this.epJumpInput.value, 10);
    if (!val || !this.currentEpisodes || this.currentEpisodes.length === 0) return;
    const matchIdx = this.currentEpisodes.findIndex(e => parseInt(e.episodeNumber, 10) === val);
    if (matchIdx >= 0) {
      this.playEpisode(matchIdx);
    } else {
      const firstEp = this.currentEpisodes[0].episodeNumber;
      const lastEp = this.currentEpisodes[this.currentEpisodes.length - 1].episodeNumber;
      this.showToast(`Episode ${val} is not available yet. (Available: ${firstEp} – ${lastEp})`, 'error');
    }
  }

  /* ── Video Streaming Core ──────────────────────────────── */

  async playEpisode(epIndex, explicitResumeTime = null) {
    if (!this.currentAnime || !this.currentEpisodes[epIndex]) return;

    // Immediately stop and detach the old video to prevent any timeupdate events
    // from saving old timestamps under the new episode's key
    this._isSwitchingEpisode = true;
    if (this.videoPlayer) {
      this.videoPlayer.pause();
      this.videoPlayer.currentTime = 0;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    this.currentEpIndex = epIndex;
    const ep = this.currentEpisodes[epIndex];
    const epNum = ep.episodeNumber;

    // Capture a play-request token. If the user clicks another episode before this
    // fetch resolves, _playRequestId will have changed and we discard the stale response.
    const playId = (this._playRequestId = (this._playRequestId || 0) + 1);

    // Update UI headers
    this.watchBreadcrumbEp.textContent = `Episode ${epNum}`;
    this.watchEpBadge.textContent = `Episode ${epNum}`;
    this.videoLoader.style.display = 'flex';
    this.videoStatusText.textContent = `Resolving Episode ${epNum}...`;

    // Re-render sidebar to highlight active playing episode
    this.renderSidebarEpisodeList(this.currentEpisodes);

    // Scroll active episode into view
    setTimeout(() => {
      const activeEl = document.getElementById(`epCard_${epNum}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);

    const params = this.buildAnimeApiParams(this.currentAnime, { episode: epNum });

    try {
      const res = await fetch(`${this.apiUrl}/api/stream?${params.toString()}`);
      const json = await res.json();

      // Discard if a newer episode click happened while this was fetching
      if (this._playRequestId !== playId) return;

      if (json.success && json.data && json.data.episodes && json.data.episodes[0] && json.data.episodes[0].url) {
        const rawStreamUrl = json.data.episodes[0].url;
        const streamMeta = json.data.episodes[0].stream || {};
        const referer = streamMeta.referer || '';

        ep.unavailable = false;
        const proxiedUrl = `${this.apiUrl}/api/proxy?url=${encodeURIComponent(rawStreamUrl)}&referer=${encodeURIComponent(referer)}`;
        this.initVideoPlayer(proxiedUrl, explicitResumeTime);
        this.showToast(`Now Streaming: Episode ${epNum}`, 'success');
      } else {
        ep.unavailable = true;
        this.renderSidebarEpisodeList(this.currentEpisodes);
        this.videoStatusText.textContent = `Episode ${epNum} is currently unavailable or has not aired yet.`;
        this.showToast(`Episode ${epNum} is not available from provider.`, 'error');
      }
    } catch (e) {
      if (this._playRequestId !== playId) return; // stale error from a superseded request
      ep.unavailable = true;
      this.renderSidebarEpisodeList(this.currentEpisodes);
      this.videoStatusText.textContent = `Stream Error: ${e.message}`;
      this.showToast(`Stream load error: ${e.message}`, 'error');
    }
  }

  initVideoPlayer(streamUrl, explicitResumeTime = null) {
    this.videoLoader.style.display = 'none';
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Reset timestamp to 0 before loading new source.
    this.videoPlayer.currentTime = 0;

    if (Hls.isSupported()) {
      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.videoPlayer);
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.resumePlayback(explicitResumeTime);
      });
      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.hls.recoverMediaError();
              break;
            default:
              this.hls.destroy();
              this.hls = null;
              break;
          }
        }
      });
    } else {
      this.videoPlayer.src = streamUrl;
      this.videoPlayer.addEventListener('loadedmetadata', () => {
        this.resumePlayback(explicitResumeTime);
      }, { once: true });
    }
  }

  resumePlayback(explicitResumeTime = null) {
    if (explicitResumeTime !== null && explicitResumeTime > 3) {
      this.videoPlayer.currentTime = explicitResumeTime;
    } else if (this.currentAnime && this.currentEpisodes[this.currentEpIndex]) {
      const epNum = this.currentEpisodes[this.currentEpIndex].episodeNumber;
      const key = `${this.currentAnime.title}_ep_${epNum}`;
      const saved = this.history[key];
      if (saved && saved.currentTime > 5 && saved.currentTime < (saved.duration - 20)) {
        this.videoPlayer.currentTime = saved.currentTime;
      }
    }
    // Done switching, allow normal timeupdate progress saving
    this._isSwitchingEpisode = false;
    this.videoPlayer.play().catch(() => {});
  }

  playPrevEpisode() {
    if (this.currentEpIndex > 0) {
      this.playEpisode(this.currentEpIndex - 1);
    } else {
      this.showToast('This is the first available episode.', 'info');
    }
  }

  playNextEpisode() {
    if (this.currentEpIndex < this.currentEpisodes.length - 1) {
      this.playEpisode(this.currentEpIndex + 1);
    } else {
      this.showToast('Reached the latest available episode.', 'info');
    }
  }

  async launchInMpv() {
    if (!this.currentAnime || !this.currentEpisodes[this.currentEpIndex]) return;
    const epNum = this.currentEpisodes[this.currentEpIndex].episodeNumber;
    
    this.showToast(`Launching Episode ${epNum} in native MPV...`, 'info');
    const params = this.buildAnimeApiParams(this.currentAnime, { episode: epNum });

    try {
      const res = await fetch(`${this.apiUrl}/api/play-mpv?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        this.showToast(`Playing Episode ${epNum} in MPV!`, 'success');
      } else {
        this.showToast(`MPV launch failed: ${json.error}`, 'error');
      }
    } catch (e) {
      this.showToast(`Error: ${e.message}`, 'error');
    }
  }

  /* ── Feed & Browse Core with Real Posters ──────────────── */

  showLoader(text = 'Loading anime...') {
    this.loaderText.textContent = text;
    this.loader.style.display = 'flex';
    this.animeGrid.style.display = 'none';
    this.errorState.style.display = 'none';
  }

  hideLoader() {
    this.loader.style.display = 'none';
    this.animeGrid.style.display = 'grid';
  }

  showError(msg) {
    this.loader.style.display = 'none';
    this.animeGrid.style.display = 'none';
    this.errorState.style.display = 'flex';
    this.errorMessage.textContent = msg;
    if (this.emptyActions) {
      this.emptyActions.innerHTML = `<button class="btn btn-primary" onclick="app.retryLastAction()">Retry</button>`;
    }
  }

  setActiveNav(tab) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.pill').forEach(pill => {
      pill.classList.toggle('active', pill.id === `pill${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    });
    this.updateMobileNav(tab);
  }

  updateMobileNav(tab) {
    document.querySelectorAll('.mobile-nav-item').forEach(btn => btn.classList.remove('active'));
    if (tab === 'latest' || tab === 'home') {
      document.getElementById('mobNavHome')?.classList.add('active');
    } else if (tab === 'search') {
      document.getElementById('mobNavSearch')?.classList.add('active');
    } else if (tab === 'history') {
      document.getElementById('mobNavHistory')?.classList.add('active');
    } else if (tab === 'watchlist' || tab === 'saved') {
      document.getElementById('mobNavSaved')?.classList.add('active');
    }
  }

  /* ── 3D 3-Card Overlapping Carousel System ──────────────── */

  render3DCarousel(list) {
    if (!list || list.length === 0) return;
    this.heroAnimeList = list.slice(0, 8);
    this.currentHeroIndex = 0;
    this._carouselGen = 0; // reset generation counter

    // Reset card images to blank transparent placeholder
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    [this.imgCardPrev, this.imgCardActive, this.imgCardNext].forEach(img => {
      if (img) {
        img.classList.remove('loaded');
        img.src = blank;
      }
    });

    // Render pagination dots
    this.heroDotsIndicator.innerHTML = '';
    this.heroAnimeList.forEach((_, idx) => {
      const dot = document.createElement('div');
      dot.className = `hero-dot ${idx === 0 ? 'active' : ''}`;
      dot.id = `heroDot_${idx}`;
      dot.addEventListener('click', () => {
        this.currentHeroIndex = idx;
        this.update3DCarouselView();
      });
      this.heroDotsIndicator.appendChild(dot);
    });

    this.update3DCarouselView();
    this.startCarouselAutoPlay();
  }

  update3DCarouselView() {
    const len = this.heroAnimeList.length;
    if (len === 0) return;

    // Generation token — prevents stale async callbacks from overwriting newer slides
    const gen = (this._carouselGen = (this._carouselGen || 0) + 1);

    const currIdx = this.currentHeroIndex;
    const prevIdx = (currIdx - 1 + len) % len;
    const nextIdx = (currIdx + 1) % len;

    const currentAnime = this.heroAnimeList[currIdx];
    const prevAnime    = this.heroAnimeList[prevIdx];
    const nextAnime    = this.heroAnimeList[nextIdx];

    // 1. Update hero text info
    this.heroTitle.textContent = currentAnime.title || 'Discover Anime';
    this.heroYear.textContent  = currentAnime.year  ? `${currentAnime.year}` : '2026';
    this.heroEps.textContent   = currentAnime.episodes ? `${currentAnime.episodes} EPS` : 'HD · Sub/Dub';
    this.heroDesc.textContent  = currentAnime.name  || 'Stream episodes in high definition with instant HLS streaming.';
    this.heroScore.style.display = 'none';

    // 2. Update pagination dots
    document.querySelectorAll('.hero-dot').forEach((d, idx) => {
      d.classList.toggle('active', idx === currIdx);
    });

    // Helper — set image with fade-in and error safety
    const setCarouselImg = (imgEl, src) => {
      if (!imgEl || !src) return;
      imgEl.classList.remove('loaded');
      imgEl.onerror = () => { imgEl.onerror = null; imgEl.classList.remove('loaded'); };
      imgEl.onload  = () => { imgEl.onload  = null; imgEl.classList.add('loaded'); };
      imgEl.src = src;
      if (imgEl.complete && imgEl.naturalWidth > 0) imgEl.classList.add('loaded');
    };

    // ── TWO-STAGE IMAGE LOADING ──────────────────────────────────────────────
    // Stage 1: resolveItemArt  →  uses session/showId (AllAnime thumbnail) — instant
    // Stage 2: fetchAnimeMetadata  →  upgrades to AniList/TMDB higher-quality art
    // Cards are NEVER blank: stage 1 fires first, stage 2 upgrades silently after.
    // ────────────────────────────────────────────────────────────────────────

    // ── Active (center) card ──────────────────────────────────────────────────
    this.resolveItemArt(currentAnime).then(art => {
      if (this._carouselGen !== gen) return;
      if (art.poster) setCarouselImg(this.imgCardActive, art.poster);
      if (art.banner) this.heroBg.style.backgroundImage = `url("${art.banner}")`;
      else if (art.poster) this.heroBg.style.backgroundImage = `url("${art.poster}")`;
      // Stage 2 — higher quality upgrade
      this.fetchAnimeMetadata(currentAnime.title).then(meta => {
        if (this._carouselGen !== gen) return;
        if (!meta) return;
        if (meta.banner) this.heroBg.style.backgroundImage = `url("${meta.banner}")`;
        else if (meta.poster) this.heroBg.style.backgroundImage = `url("${meta.poster}")`;
        if (meta.score)  { this.heroScore.textContent = `⭐ ${meta.score}`; this.heroScore.style.display = 'inline-flex'; }
        if (meta.status) this.heroStatusText.textContent = meta.status.toUpperCase();
        if (meta.format) this.heroTypeBadge.textContent = meta.format;
        if (meta.desc)   this.heroDesc.textContent = meta.desc.slice(0, 220) + '...';
        if (meta.poster) setCarouselImg(this.imgCardActive, meta.poster);
      }).catch(() => {});
    }).catch(err => console.debug('[Erumi] Active card art failed:', err.message));

    // ── Prev (left) card ─────────────────────────────────────────────────────
    this.resolveItemArt(prevAnime).then(art => {
      if (this._carouselGen !== gen) return;
      if (art.poster) setCarouselImg(this.imgCardPrev, art.poster);
      this.fetchAnimeMetadata(prevAnime.title).then(meta => {
        if (this._carouselGen !== gen) return;
        if (meta && meta.poster) setCarouselImg(this.imgCardPrev, meta.poster);
      }).catch(() => {});
    }).catch(err => console.debug('[Erumi] Prev card art failed:', err.message));

    // ── Next (right) card ────────────────────────────────────────────────────
    this.resolveItemArt(nextAnime).then(art => {
      if (this._carouselGen !== gen) return;
      if (art.poster) setCarouselImg(this.imgCardNext, art.poster);
      this.fetchAnimeMetadata(nextAnime.title).then(meta => {
        if (this._carouselGen !== gen) return;
        if (meta && meta.poster) setCarouselImg(this.imgCardNext, meta.poster);
      }).catch(() => {});
    }).catch(err => console.debug('[Erumi] Next card art failed:', err.message));
  }



  slide3DCarousel(direction) {
    const len = this.heroAnimeList.length;
    if (len <= 1) return;
    this.currentHeroIndex = (this.currentHeroIndex + direction + len) % len;
    this.update3DCarouselView();
  }

  startCarouselAutoPlay() {
    this.stopCarouselAutoPlay();
    this.carouselAutoTimer = setInterval(() => {
      this.slide3DCarousel(1);
    }, 5500);
  }

  stopCarouselAutoPlay() {
    if (this.carouselAutoTimer) {
      clearInterval(this.carouselAutoTimer);
      this.carouselAutoTimer = null;
    }
  }

  async loadLatest() {
    this.showBrowseView();
    this.currentMode = 'latest';
    this.currentQuery = '';
    this.heroSection.style.display = 'block';
    this.continueWatchingSection.style.display = 'block';
    this.setActiveNav('latest');
    this.sectionTitle.textContent = 'Latest Releases';
    this.sectionSubtitle.textContent = 'Top 18 recently updated anime';
    this.showLoader('Fetching latest anime releases...');
    this.renderContinueWatchingShelf();
    this.hideError();

    // Fetch recommendations in parallel with latest releases for instant loading
    this.loadRecommendations();

    try {
      const res = await fetch(`${this.apiUrl}/api/latest?limit=18`);
      const json = await res.json();
      if (json.success && json.data && json.data.results) {
        this.currentAnimeList = json.data.results.slice(0, 18);
        this.renderAnimeGrid(this.currentAnimeList, { mode: 'latest' });
        this.render3DCarousel(this.currentAnimeList);
      } else {
        this.showError(json.error || 'Failed to load latest anime.');
      }
    } catch (e) {
      this.showError(`Connection error: ${e.message}`);
    } finally {
      this.hideLoader();
    }
  }

  getRecommendationSeeds() {
    const fromHistory = Object.values(this.history || {})
      .map((h) => h.anime?.title)
      .filter(Boolean);
    const fromWatchlist = (this.watchlist || []).map((w) => w.title).filter(Boolean);
    const combined = [...new Set([...fromHistory, ...fromWatchlist])];
    return combined.slice(0, 3);
  }

  async loadRecommendations() {
    const section = document.getElementById('recommendationsSection');
    const grid = document.getElementById('recommendationsGrid');
    const subtitle = document.getElementById('recommendationsSubtitle');
    if (!section || !grid) return;

    const seeds = this.getRecommendationSeeds();
    const titlesParam = encodeURIComponent(seeds.join('|'));
    if (subtitle) {
      subtitle.textContent = seeds.length
        ? `Playable picks based on ${seeds.slice(0, 2).join(', ')}`
        : 'Playable trending anime from Yorumi';
    }

    try {
      const res = await fetch(`${this.apiUrl}/api/recommendations?titles=${titlesParam}&limit=14`);
      const json = await res.json();
      const results = json.success ? (json.data?.results || []) : [];

      if (results.length) {
        section.style.display = 'block';
        this.renderRecommendationShelf(results);
        if (window.feather) feather.replace();
        requestAnimationFrame(() => this.updateRecoScrollButtons());
      } else {
        section.style.display = 'none';
      }
    } catch {
      section.style.display = 'none';
    }
  }

  async openAnimeByTitle(title) {
    if (!title) return;
    this.showLoader(`Finding "${title}"...`);
    try {
      const res = await fetch(`${this.apiUrl}/api/search?q=${encodeURIComponent(title)}`);
      const json = await res.json();
      if (json.success && json.data?.results?.length) {
        const match = json.data.results[0];
        this.openWatchView({ ...match, mode: 'direct', index: match.index || 1 }, 0);
      } else {
        this.showToast('Could not find that anime in the catalog.', 'error');
      }
    } catch (e) {
      this.showToast(`Search failed: ${e.message}`, 'error');
    } finally {
      this.hideLoader();
    }
  }

  renderRecommendationShelf(list) {
    const shelf = document.getElementById('recommendationsGrid');
    if (!shelf) return;
    shelf.innerHTML = '';

    list.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'reco-card';
      const initials = (item.title || 'A').slice(0, 2).toUpperCase();
      const epText = item.episodes ? `${item.episodes} eps` : '';
      const meta = [item.year, epText, item.status].filter(Boolean).join(' · ');
      const cardId = `recoPoster_${index}_${Math.random().toString(36).slice(2, 6)}`;

      card.innerHTML = `
        <div class="reco-card-poster">
          <div class="card-placeholder-fallback">
            <div class="fallback-initials">${initials}</div>
            <div class="fallback-sub">Erumi</div>
          </div>
          <img id="${cardId}" alt="${item.title}" loading="lazy">
        </div>
        <div class="reco-card-title" title="${item.title}">${item.title}</div>
        <div class="reco-card-meta">${meta || 'Playable on Yorumi'}</div>
      `;

      card.addEventListener('click', () => {
        if (item.session && String(item.session).startsWith('allanime:')) {
          this.openWatchView({ ...item, mode: 'direct', index: 1 }, 0);
        } else {
          this.openAnimeByTitle(item.title);
        }
      });
      shelf.appendChild(card);

      const imgEl = card.querySelector('img');
      this.resolveItemPoster(item).then((poster) => {
        if (poster) {
          this.setCardPoster(imgEl, poster);
        }
      });
    });
    if (window.feather) feather.replace();
    requestAnimationFrame(() => this.updateRecoScrollButtons());
  }

  hideError() {
    if (this.errorState) this.errorState.style.display = 'none';
    if (this.animeGrid) this.animeGrid.style.display = 'grid';
  }

  renderAnimeGrid(list, options = {}) {
    const grid = options.gridEl || this.animeGrid;
    if (!grid) return;
    grid.innerHTML = '';
    const cardMode = options.mode || this.currentMode;

    list.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'anime-card';
      
      const epText = item.episodes ? `${item.episodes} EPS` : (item.status || item.format || 'HD');
      const yearText = item.year ? `${item.year}` : '';
      const initials = (item.title || 'A').slice(0, 2).toUpperCase();
      const cardId = `poster_${cardMode}_${index}_${Math.random().toString(36).slice(2, 7)}`;

      card.innerHTML = `
        <div class="card-poster">
          <div class="card-placeholder-fallback">
            <div class="fallback-initials">${initials}</div>
            <div class="fallback-sub">Erumi</div>
          </div>
          <img id="${cardId}" alt="${item.title}" loading="lazy">
          <span class="card-badge">${epText}</span>
          <span class="card-score-badge" id="score_${cardId}" style="display:none;"></span>
          <div class="card-overlay">
            <div class="card-play-btn">
              <i data-feather="play"></i>
            </div>
          </div>
        </div>
        <div class="card-info">
          <h4 class="card-title" title="${item.title}">${item.title}</h4>
          <div class="card-meta">
            <span>${yearText}</span>
            <span>#${item.index || index + 1}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        if (options.onClick) {
          options.onClick(item, index);
          return;
        }
        const payload = {
          ...item,
          mode: cardMode === 'search' ? 'search' : 'direct',
          index: cardMode === 'search' ? (item.index || index + 1) : 1,
          searchQuery: cardMode === 'search' ? this.currentQuery : undefined,
        };
        this.openWatchView(payload, 0);
      });

      grid.appendChild(card);

      this.resolveItemPoster(item).then((poster) => {
        if (!poster) return;
        const imgEl = document.getElementById(cardId);
        this.setCardPoster(imgEl, poster);
      });
    });

    if (window.feather) feather.replace();
  }

  heroAction() {
    const target = this.heroAnimeList[this.currentHeroIndex] || this.currentAnimeList[0];
    if (target) {
      this.openWatchView({ ...target, mode: 'direct', index: 1 }, 0);
    }
  }

  heroDetails() {
    const target = this.heroAnimeList[this.currentHeroIndex] || this.currentAnimeList[0];
    if (target) {
      this.openWatchView({ ...target, mode: 'direct', index: 1 }, 0);
    }
  }

  /* ── Watchlist Management ──────────────────────────────── */

  toggleCurrentWatchlist() {
    if (!this.currentAnime) return;
    const exists = this.watchlist.some(a => a.title === this.currentAnime.title);
    if (exists) {
      this.watchlist = this.watchlist.filter(a => a.title !== this.currentAnime.title);
      this.showToast('Removed from Watchlist.', 'info');
    } else {
      this.watchlist.push(this.currentAnime);
      this.showToast('Added to Watchlist!', 'success');
    }
    this.saveStorage('erumi_watchlist', this.watchlist);
    this.updateWatchlistBadge();
    this.updateSaveButtonState();
  }

  updateSaveButtonState() {
    if (!this.currentAnime || !this.watchSaveText) return;
    const isSaved = this.watchlist.some(a => a.title === this.currentAnime.title);
    this.watchSaveText.textContent = isSaved ? 'Saved' : 'Save';
  }

  showWatchlist() {
    this.hideAllMainViews();
    this.browseView.style.display = 'block';
    this.videoPlayer.pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    this.currentMode = 'watchlist';
    this.setActiveNav('watchlist');
    this.heroSection.style.display = 'none';
    this.continueWatchingSection.style.display = 'none';
    const recoSection = document.getElementById('recommendationsSection');
    if (recoSection) recoSection.style.display = 'none';
    this.sectionTitle.textContent = 'My Watchlist';
    this.sectionSubtitle.textContent = 'Your saved anime titles';
    if (this.watchlist.length === 0) {
      this.showError('Your watchlist is empty. Bookmark anime to see them here.');
      this.emptyActions.innerHTML = `<button class="btn btn-primary" onclick="app.loadLatest()">Explore Latest</button>`;
    } else {
      this.renderAnimeGrid(this.watchlist);
      this.hideLoader();
    }
  }

  updateWatchlistBadge() {
    const badge = document.getElementById('watchlistCount');
    if (badge) badge.textContent = this.watchlist.length;
  }

  /* ── About Us Modal ────────────────────────────────────── */

  openAboutModal() {
    this.aboutModal.classList.add('active');
    document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('mobNavAbout')?.classList.add('active');
  }

  closeAboutModal() {
    this.aboutModal.classList.remove('active');
    this.updateMobileNav(this.currentMode);
  }

  /* ── Mobile / LAN Modal (Desktop Only Feature) ─────────── */

  async openLanModal() {
    this.lanModal.classList.add('active');

    try {
      const res = await fetch(`${this.apiUrl}/api/network-info`);
      const data = await res.json();
      if (data.url) {
        this.lanUrlInput.value = data.url;
        this.lanQrImage.src = data.qr_code_url;
      }
    } catch {
      this.lanUrlInput.value = `${window.location.protocol}//${window.location.hostname}:${window.location.port}`;
    }
  }

  closeLanModal() {
    this.lanModal.classList.remove('active');
  }

  copyLanUrl() {
    const input = this.lanUrlInput;
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value).then(() => {
      this.showToast('Network address copied to clipboard!', 'success');
    }).catch(() => {
      this.showToast('Address copied.', 'info');
    });
  }

  retryLastAction() {
    if (this.currentMode === 'search') this.performSearch(this.currentQuery);
    else if (this.currentMode === 'history') this.showHistoryView();
    else if (this.currentMode === 'watchlist') this.showWatchlist();
    else this.loadLatest();
  }

  showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /* ── Jellyfin Settings Dashboard ─────────────────────── */

  initSettings() {
    this.settingsModal = document.getElementById('settingsModal');
    this._settingsConfig = null;
    this.prefetchSettings();
  }

  async prefetchSettings() {
    try {
      const res = await fetch(`${this.apiUrl}/api/settings`);
      const data = await res.json();
      if (data.success) {
        this._settingsConfig = data.config;
        this.syncAutoRotateToNative();
      }
    } catch {
      // Offline or server not ready — default auto-rotate stays enabled
    }
  }

  switchSettingsTab(tab) {
    const tabMap = { playback: 'panePlayback', server: 'paneServer', cache: 'paneCache', system: 'paneSystem' };
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
    const btn = document.getElementById(`tabBtn_${tab}`);
    const pane = document.getElementById(tabMap[tab]);
    if (btn) btn.classList.add('active');
    if (pane) pane.classList.add('active');
  }

  async openSettingsModal() {
    if (!this.settingsModal) return;
    this.settingsModal.classList.add('active');
    if (typeof feather !== 'undefined') feather.replace();

    try {
      const res = await fetch(`${this.apiUrl}/api/settings`);
      const data = await res.json();
      if (data.success) {
        this._settingsConfig = data.config;
        const cfg = data.config;
        const stats = data.stats || {};

        // Populate Playback
        const qualityEl = document.getElementById('settingQuality');
        const audioEl = document.getElementById('settingAudio');
        const autoNextEl = document.getElementById('settingAutoNext');
        const autoRotateEl = document.getElementById('settingAutoRotate');
        if (qualityEl) qualityEl.value = cfg.playback?.preferred_quality || '1080p';
        if (audioEl) audioEl.value = cfg.playback?.default_mode || 'sub';
        if (autoNextEl) autoNextEl.checked = cfg.playback?.auto_next_episode !== false;
        if (autoRotateEl) autoRotateEl.checked = cfg.playback?.auto_rotate_fullscreen !== false;

        // Populate Server
        const portEl = document.getElementById('settingPort');
        const autoLaunchEl = document.getElementById('settingAutoLaunch');
        const bindAllEl = document.getElementById('settingBindAll');
        if (portEl) portEl.value = cfg.server?.port || 3000;
        if (autoLaunchEl) autoLaunchEl.checked = cfg.server?.auto_launch_browser !== false;
        if (bindAllEl) bindAllEl.checked = cfg.server?.bind_all_interfaces !== false;

        // Populate Cache Stats
        const cliCacheEl = document.getElementById('statCliCache');
        const historyEl = document.getElementById('statHistory');
        const watchlistEl = document.getElementById('statWatchlist');
        if (cliCacheEl) cliCacheEl.textContent = stats.cli_cache_entries || 0;
        if (historyEl) historyEl.textContent = Object.keys(this.history || {}).length;
        if (watchlistEl) watchlistEl.textContent = (this.watchlist || []).length;

        // Populate System Info
        const mpvEl = document.getElementById('sysMpvStatus');
        const lanEl = document.getElementById('sysLanAddress');
        if (mpvEl) mpvEl.textContent = stats.mpv_available ? 'MPV Installed ✓' : 'Not Available';
        if (lanEl) lanEl.textContent = this.apiUrl || `http://${stats.local_ip || 'localhost'}:${stats.port || 3000}`;

        // Show "Change Server" button in APK mode
        const isCapacitor = !!(window.Capacitor || window.location.protocol === 'capacitor:');
        const changeRow = document.getElementById('changeServerRow');
        if (changeRow) changeRow.style.display = isCapacitor ? 'block' : 'none';
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
  }

  closeSettingsModal() {
    if (this.settingsModal) this.settingsModal.classList.remove('active');
  }

  changeServer() {
    // Clear saved server, reload page to show connect screen
    localStorage.removeItem('erumi_server_url');
    this.closeSettingsModal();
    window.location.reload();
  }

  async saveSettingsFromModal() {
    const payload = {
      playback: {
        preferred_quality: document.getElementById('settingQuality')?.value || '1080p',
        auto_next_episode: document.getElementById('settingAutoNext')?.checked ?? true,
        default_mode: document.getElementById('settingAudio')?.value || 'sub',
        auto_rotate_fullscreen: document.getElementById('settingAutoRotate')?.checked ?? true,
      },
      server: {
        port: parseInt(document.getElementById('settingPort')?.value) || 3000,
        auto_launch_browser: document.getElementById('settingAutoLaunch')?.checked ?? true,
        bind_all_interfaces: document.getElementById('settingBindAll')?.checked ?? true,
      }
    };

    try {
      const res = await fetch(`${this.apiUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this._settingsConfig = data.config;
        this.syncAutoRotateToNative();
        this.showToast('Settings saved successfully!', 'success');
        this.closeSettingsModal();
      } else {
        this.showToast('Failed to save settings.', 'error');
      }
    } catch (e) {
      this.showToast('Error saving settings: ' + e.message, 'error');
    }
  }

  async clearBackendCache() {
    try {
      const res = await fetch(`${this.apiUrl}/api/cache/clear`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const el = document.getElementById('statCliCache');
        if (el) el.textContent = '0';
        this.showToast('In-memory cache cleared!', 'success');
      }
    } catch (e) {
      this.showToast('Failed to clear cache.', 'error');
    }
  }

  clearBrowserCache() {
    try {
      localStorage.removeItem('erumi_meta_cache_v2');
      this.metaCache = {};
      const el = document.getElementById('statCliCache');
      this.showToast('Browser image & metadata cache reset!', 'success');
    } catch (e) {
      this.showToast('Failed to clear browser cache.', 'error');
    }
  }
}

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new ErumiApp();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('Service Worker registered successfully:', reg.scope))
        .catch(err => console.warn('Service Worker registration failed:', err));
    });
  }
});
