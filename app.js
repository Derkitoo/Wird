document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for Offline / PWA Support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker inscrit avec succès. Scope :', reg.scope))
      .catch(err => console.error('[PWA] Échec d\'inscription du Service Worker :', err));
  }

  // PWA Installation Prompt Trigger
  let deferredPrompt = null;
  const btnPwaInstall = document.getElementById('btn-pwa-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btnPwaInstall) {
      btnPwaInstall.style.display = 'inline-flex';
    }
  });

  if (btnPwaInstall) {
    btnPwaInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        console.log('[PWA] L\'utilisateur a accepté d\'installer la PWA.');
      } else {
        console.log('[PWA] L\'utilisateur a refusé l\'installation.');
      }
      deferredPrompt = null;
      btnPwaInstall.style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Application installée !');
    if (btnPwaInstall) btnPwaInstall.style.display = 'none';
    showToast("PWA Installée ! 📲", "L'application a été ajoutée à votre écran d'accueil.");
  });

  // Global State
  const state = {
    currentView: 'dashboard',
    prayersCompleted: {
      fajr: false,
      dhuhr: false,
      asr: false,
      maghrib: false,
      isha: false
    },
    // Selected Juz and Reciter
    selectedJuz: 30,
    selectedReciter: 'ar.minshawi',
    // Active Juz data from API
    juzData: null,
    // Audio State
    currentPlayingVerseNum: null, // Global verse number (1-6236)
    audioLoopRepetitions: '1', // '1', '3', '5', 'infinite'
    audioPlayCount: 1,
    readerMode: 'read', // 'read' or 'memorize' (used in Reader view only)
    hifzLevel: 'auto', // 'auto' (per-verse, driven by SRS status), or 1: Complet, 2: 1er Mot, 3: Troué, 4: Masqué (Reader view only)
    arabicFontSize: 26, // default in px
    encouragedActivities: new Set(),
    // SRS Database for memorized verses schedule
    srsDatabase: {},
    // Speech Recognition state
    recordingVerseNum: null,
    activeRecognition: null,
    // Hifz Workshop active state
    activeHifzVerse: null,
    activeHifzSurah: null,
    activeHifzJuz: null,
    hifzSpeechRecognition: null,
    // Guided review session: an ordered queue of srsDatabase keys due for
    // review, walked one at a time via the flashcard, across any Juz.
    reviewQueue: [],
    reviewSessionActive: false,
    // Hifz gamification: XP earned from every SRS rating (any surface), and
    // a per-day activity log used to compute the current streak.
    hifzXp: 0,
    hifzStreakHistory: {},
    // Wird custom planner (total = 20 pages for 1 Juz)
    wirdPagePlan: {
      fajr: 4,
      dhuhr: 4,
      asr: 4,
      maghrib: 4,
      isha: 4
    },
    consistencyHistory: {},
    isAudioDownloading: false,
    // Resume position (saved by page instead of scroll location)
    lastViewedVerseNum: null,
    lastViewedJuz: null,
    scrollToVerseOnLoad: null,
    currentPageIndex: 0,
    pagesList: [],
    // Pages genuinely read (dwell-time confirmed), keyed by Juz number then page ordinal (1-based, matches "Page N/M" label)
    readPages: {},
    pageDwellTimer: null
  };

  // DOM Views
  const views = {
    dashboard: document.getElementById('view-dashboard'),
    reader: document.getElementById('view-reader'),
    memorize: document.getElementById('view-memorize'),
    circle: document.getElementById('view-circle')
  };

  const navItems = document.querySelectorAll('.nav-item');
  const prayerCards = document.querySelectorAll('.prayer-card');
  const progressBar = document.querySelector('.progress-bar');
  const progressText = document.querySelector('.progress-text');
  const progressPercentText = document.getElementById('progress-percent');
  const progressPagesText = document.getElementById('progress-pages');
  
  // Select Dropdowns
  const selectJuz = document.getElementById('select-juz');
  const selectReciter = document.getElementById('select-reciter');
  const readerLoader = document.getElementById('reader-loader');
  const quranContainer = document.getElementById('quran-page');
  const readerSurahTitle = document.getElementById('reader-surah-title');
  const readerJuzTitle = document.getElementById('reader-juz-title');

  // Native Audio HTML5 Player
  const nativeAudioPlayer = document.getElementById('native-audio-player');
  const audioWidget = document.getElementById('audio-widget');
  const audioPlayBtn = document.getElementById('audio-play-btn');
  const audioVerseTitle = document.getElementById('audio-verse-title');
  const audioProgressBar = document.getElementById('audio-progress-bar');

  // Reader Hifz progressive help (Reader view only)
  const hifzToolbar = document.getElementById('hifz-toolbar');
  const selectAudioLoop = document.getElementById('select-audio-loop');
  
  // SRS Dashboard card
  const srsRevisionsCard = document.getElementById('srs-revisions-card');
  const srsRevisionsCountText = document.getElementById('srs-revisions-count');
  const btnStartRevision = document.getElementById('btn-start-revision');

  // Social Halaqah circle elements
  const inputCirclePost = document.getElementById('input-circle-post');
  const btnCirclePost = document.getElementById('btn-circle-post');
  const circleActivityList = document.querySelector('.circle-activity-list');
  const toastContainer = document.getElementById('toast-container');

  // Reader Voice Speech elements
  const speechModal = document.getElementById('speech-modal');
  const speechTranscription = document.getElementById('speech-transcription');
  const btnSpeechClose = document.getElementById('btn-speech-close');
  const btnSpeechStop = document.getElementById('btn-speech-stop');
  const speechFallbackRow = document.getElementById('speech-fallback-row');
  const speechFallbackMsg = document.getElementById('speech-fallback-msg');
  const btnSpeechFallbackKnown = document.getElementById('btn-speech-fallback-known');
  const btnSpeechFallbackUnsure = document.getElementById('btn-speech-fallback-unsure');

  // Hifz Refactored Workshop elements (view-memorize)
  const hifzJuzBadge = document.getElementById('hifz-juz-badge');
  const hifzSurahList = document.getElementById('hifz-surah-list');
  const hifzDueDetail = document.getElementById('hifz-due-detail');
  const btnHifzStartSession = document.getElementById('btn-hifz-start-session');

  // Hifz Flashcard drawer elements
  const hifzFlashcardModal = document.getElementById('hifz-flashcard-modal');
  const hifzCardClose = document.getElementById('hifz-card-close');
  const hifzCardRef = document.getElementById('hifz-card-ref');
  const hifzSessionBanner = document.getElementById('hifz-session-banner');
  const hifzCardTranslation = document.getElementById('hifz-card-translation');
  const hifzCardTranslit = document.getElementById('hifz-card-translit');

  const hifzCardArabicWrapper = document.getElementById('hifz-card-arabic-wrapper');
  const hifzCardPlaceholder = document.getElementById('hifz-card-placeholder');
  const hifzCardArabic = document.getElementById('hifz-card-arabic');

  const hifzCardMicBtn = document.getElementById('hifz-card-mic-btn');
  const hifzCardRecordingStatus = document.getElementById('hifz-card-recording-status');

  const hifzFallbackRow = document.getElementById('hifz-fallback-row');
  const hifzFallbackMsg = document.getElementById('hifz-fallback-msg');
  const hifzCardFallbackKnown = document.getElementById('hifz-card-fallback-known');
  const hifzCardFallbackUnsure = document.getElementById('hifz-card-fallback-unsure');
  const hifzCardSrsRow = document.getElementById('hifz-card-srs-row');
  
  const drawerOverlay = document.getElementById('drawer-overlay');

  // New features DOM Elements
  const btnToggleWirdPlanner = document.getElementById('btn-toggle-wird-planner');
  const wirdPlannerPanel = document.getElementById('wird-planner-panel');
  const wirdTotalPagesLabel = document.getElementById('wird-total-pages-label');
  const sliders = {
    fajr: document.getElementById('slider-fajr'),
    dhuhr: document.getElementById('slider-dhuhr'),
    asr: document.getElementById('slider-asr'),
    maghrib: document.getElementById('slider-maghrib'),
    isha: document.getElementById('slider-isha')
  };

  const btnAudioDownload = document.getElementById('btn-audio-download');
  const audioDownloadStatus = document.getElementById('audio-download-status');
  const audioDownloadDetail = document.getElementById('audio-download-detail');
  const audioDownloadProgressContainer = document.getElementById('audio-download-progress-container');
  const audioDownloadProgressBar = document.getElementById('audio-download-progress-bar');

  const heatmapGrid = document.getElementById('heatmap-grid');

  // Celebration & Resume elements
  const celebrationCard = document.getElementById('celebration-card');
  const btnNextJuzTrigger = document.getElementById('btn-next-juz-trigger');
  const resumeReadingCard = document.getElementById('resume-reading-card');
  const resumeReadingRef = document.getElementById('resume-reading-ref');
  const resumeReadingDetail = document.getElementById('resume-reading-detail');
  const btnResumeReading = document.getElementById('btn-resume-reading');
  const startWirdContainer = document.getElementById('start-wird-container');

  // Language & display checkbox switches
  const toggleShowAr = document.getElementById('toggle-show-ar');
  const toggleShowFr = document.getElementById('toggle-show-fr');
  const toggleShowTrans = document.getElementById('toggle-show-trans');

  // Pagination buttons
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');

  // Load state from LocalStorage
  try {
    const savedPrayers = localStorage.getItem('wird_prayers_completed');
    if (savedPrayers) state.prayersCompleted = JSON.parse(savedPrayers);
  } catch (err) {
    console.warn("Failed to parse wird_prayers_completed", err);
  }

  try {
    const savedJuz = localStorage.getItem('wird_selected_juz');
    if (savedJuz) state.selectedJuz = parseInt(savedJuz, 10);
  } catch (err) {
    console.warn("Failed to parse wird_selected_juz", err);
  }

  const savedReciter = localStorage.getItem('wird_selected_reciter');
  if (savedReciter) state.selectedReciter = savedReciter;

  try {
    const savedSRS = localStorage.getItem('wird_srs_database');
    if (savedSRS) state.srsDatabase = JSON.parse(savedSRS);
  } catch (err) {
    console.warn("Failed to parse wird_srs_database", err);
  }

  const savedHifzXp = localStorage.getItem('wird_hifz_xp');
  if (savedHifzXp) state.hifzXp = parseInt(savedHifzXp, 10) || 0;

  try {
    const savedHifzStreak = localStorage.getItem('wird_hifz_streak_history');
    if (savedHifzStreak) state.hifzStreakHistory = JSON.parse(savedHifzStreak);
  } catch (err) {
    console.warn("Failed to parse wird_hifz_streak_history", err);
  }

  try {
    const savedPlan = localStorage.getItem('wird_page_plan');
    if (savedPlan) state.wirdPagePlan = JSON.parse(savedPlan);
  } catch (err) {
    console.warn("Failed to parse wird_page_plan", err);
  }

  try {
    const savedLastVerse = localStorage.getItem('wird_last_viewed_verse');
    if (savedLastVerse) state.lastViewedVerseNum = parseInt(savedLastVerse, 10);
  } catch (err) {
    console.warn("Failed to parse wird_last_viewed_verse", err);
  }

  try {
    const savedLastJuz = localStorage.getItem('wird_last_viewed_juz');
    if (savedLastJuz) state.lastViewedJuz = parseInt(savedLastJuz, 10);
  } catch (err) {
    console.warn("Failed to parse wird_last_viewed_juz", err);
  }

  try {
    const savedReadPages = localStorage.getItem('wird_read_pages');
    if (savedReadPages) state.readPages = JSON.parse(savedReadPages);
  } catch (err) {
    console.warn("Failed to parse wird_read_pages", err);
  }

  // Daily Reset check
  const todayDateStr = new Date().toISOString().split('T')[0];
  const lastActiveDate = localStorage.getItem('wird_last_active_date');
  if (lastActiveDate && lastActiveDate !== todayDateStr) {
    state.prayersCompleted = {
      fajr: false,
      dhuhr: false,
      asr: false,
      maghrib: false,
      isha: false
    };
    localStorage.setItem('wird_prayers_completed', JSON.stringify(state.prayersCompleted));
    state.readPages = {};
    localStorage.setItem('wird_read_pages', JSON.stringify(state.readPages));
    showToast("Nouveau jour 🌅", "Votre Wird quotidien a été réinitialisé pour aujourd'hui.");
  }
  localStorage.setItem('wird_last_active_date', todayDateStr);

  // Initialize selectors & views
  function initSelectors() {
    if (!selectJuz || !selectReciter) return;

    // Populate 30 Juz
    selectJuz.innerHTML = '';
    for (let i = 1; i <= 30; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Juz ${i}`;
      if (i === state.selectedJuz) opt.selected = true;
      selectJuz.appendChild(opt);
    }

    // Populate Reciters
    selectReciter.innerHTML = '';
    window.QuranAPI.getReciters().forEach(reciter => {
      const opt = document.createElement('option');
      opt.value = reciter.id;
      opt.textContent = `${reciter.name} (${reciter.style})`;
      if (reciter.id === state.selectedReciter) opt.selected = true;
      selectReciter.appendChild(opt);
    });

    // Dropdown change listeners
    selectJuz.addEventListener('change', (e) => {
      state.selectedJuz = parseInt(e.target.value, 10);
      localStorage.setItem('wird_selected_juz', state.selectedJuz);
      // Reset page index on Juz switch
      state.currentPageIndex = 0;
      localStorage.removeItem('wird_last_page');
      stopAudio();
      
      if (state.currentView === 'memorize') {
        loadHifzDashboard();
      } else {
        loadJuzData();
      }
    });

    selectReciter.addEventListener('change', (e) => {
      state.selectedReciter = e.target.value;
      localStorage.setItem('wird_selected_reciter', state.selectedReciter);
      stopAudio();
      
      if (state.currentView === 'memorize') {
        loadHifzDashboard();
      } else {
        loadJuzData();
      }
    });

    // Hifz levels click listeners (Reader view only) — "Auto" adapts each
    // verse's masking to its own SRS status instead of one level applied to
    // every verse on the page (see computeAutoHifzLevel).
    document.querySelectorAll('#hifz-toolbar [data-hifz-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#hifz-toolbar [data-hifz-level]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const level = btn.dataset.hifzLevel;
        state.hifzLevel = level === 'auto' ? 'auto' : parseInt(level, 10);
        renderQuranText();
      });
    });

    // Audio loop change listener
    if (selectAudioLoop) {
      selectAudioLoop.addEventListener('change', (e) => {
        state.audioLoopRepetitions = e.target.value;
        state.audioPlayCount = 1;
      });
    }

    // SRS dashboard/workshop "start review session" buttons — both just
    // kick off the same guided, cross-Juz review queue.
    if (btnStartRevision) btnStartRevision.addEventListener('click', startReviewSession);
    if (btnHifzStartSession) btnHifzStartSession.addEventListener('click', startReviewSession);

    // Social post button binding
    if (btnCirclePost && inputCirclePost) {
      btnCirclePost.addEventListener('click', postStatusToCircle);
      inputCirclePost.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') postStatusToCircle();
      });
    }

    // Reader Speech UI control bindings
    if (btnSpeechClose) btnSpeechClose.addEventListener('click', cancelSpeechRecording);
    if (btnSpeechStop) btnSpeechStop.addEventListener('click', cancelSpeechRecording);

    // Manual fallback — only ever shown when SpeechRecognition is unsupported
    // or the mic permission was denied (see startSpeechRecording).
    if (btnSpeechFallbackKnown) {
      btnSpeechFallbackKnown.addEventListener('click', () => {
        const verse = getActiveRecordingVerse();
        if (verse) evaluateSpeechResult(verse.textAr);
      });
    }
    if (btnSpeechFallbackUnsure) {
      btnSpeechFallbackUnsure.addEventListener('click', () => {
        evaluateSpeechResult('');
      });
    }

    // Hifz Flashcard Bindings
    if (hifzCardClose) hifzCardClose.addEventListener('click', closeHifzFlashcard);
    if (hifzCardMicBtn) hifzCardMicBtn.addEventListener('click', startHifzVoiceRecording);

    // Manual fallback — only ever shown when SpeechRecognition is unsupported
    // or the mic permission was denied (see startHifzVoiceRecording).
    if (hifzCardFallbackKnown) {
      hifzCardFallbackKnown.addEventListener('click', () => {
        if (state.activeHifzVerse) evaluateHifzSpeechResult(state.activeHifzVerse.textAr);
      });
    }
    if (hifzCardFallbackUnsure) {
      hifzCardFallbackUnsure.addEventListener('click', () => {
        evaluateHifzSpeechResult('');
      });
    }

    // Hifz Flashcard SRS rating click listeners
    const hifzSrsButtons = document.querySelectorAll('#hifz-card-srs-row .btn-srs');
    hifzSrsButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.activeHifzVerse || !state.activeHifzSurah || !state.activeHifzJuz) return;

        const rating = btn.dataset.hifzRating;
        const verseKey = `juz_${state.activeHifzJuz}_surah_${state.activeHifzSurah.number}_verse_${state.activeHifzVerse.numberInSurah}`;
        scheduleSrsReview(verseKey, rating);

        createConfetti(btn);

        setTimeout(() => {
          if (state.reviewSessionActive) {
            state.reviewQueue.shift();
            advanceReviewSession();
          } else {
            closeHifzFlashcard();
            loadHifzDashboard();
          }
          updateSRSDashboardCard();
        }, 600);
      });
    });

    if (drawerOverlay) {
      drawerOverlay.addEventListener('click', () => {
        closeHifzFlashcard();
        closeTafsirDrawer();
      });
    }

    // Wird Custom Planner Bindings
    if (btnToggleWirdPlanner && wirdPlannerPanel) {
      btnToggleWirdPlanner.addEventListener('click', () => {
        if (wirdPlannerPanel.style.display === 'none') {
          wirdPlannerPanel.style.display = 'flex';
        } else {
          wirdPlannerPanel.style.display = 'none';
        }
      });
    }

    Object.keys(sliders).forEach(key => {
      const slider = sliders[key];
      if (slider) {
        slider.value = state.wirdPagePlan[key];
        document.getElementById(`label-slider-${key}`).textContent = `${state.wirdPagePlan[key]}p`;
        
        slider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          state.wirdPagePlan[key] = val;
          document.getElementById(`label-slider-${key}`).textContent = `${val}p`;
          
          calculateWirdPlanTotal();
          refreshPrayerCardPages();
          updateProgress();
        });
      }
    });

    // Audio downloader binding
    if (btnAudioDownload) {
      btnAudioDownload.addEventListener('click', downloadJuzAudioCache);
    }

    // Resume reading click handler
    if (btnResumeReading) {
      btnResumeReading.addEventListener('click', () => {
        if (state.lastViewedJuz && state.lastViewedVerseNum) {
          state.selectedJuz = state.lastViewedJuz;
          localStorage.setItem('wird_selected_juz', state.selectedJuz);
          if (selectJuz) selectJuz.value = state.selectedJuz;
          
          state.scrollToVerseOnLoad = state.lastViewedVerseNum;
          switchView('reader');
        }
      });
    }

    // Celebration triggers next Juz loading
    if (btnNextJuzTrigger) {
      btnNextJuzTrigger.addEventListener('click', () => {
        if (state.selectedJuz < 30) {
          state.selectedJuz = state.selectedJuz + 1;
        } else {
          state.selectedJuz = 1; 
        }
        localStorage.setItem('wird_selected_juz', state.selectedJuz);
        if (selectJuz) selectJuz.value = state.selectedJuz;

        // Reset checked prayers and page positions for next Wird Juz
        state.prayersCompleted = {
          fajr: false,
          dhuhr: false,
          asr: false,
          maghrib: false,
          isha: false
        };
        localStorage.setItem('wird_prayers_completed', JSON.stringify(state.prayersCompleted));
        state.readPages = {};
        localStorage.setItem('wird_read_pages', JSON.stringify(state.readPages));
        localStorage.removeItem('wird_last_page');
        state.currentPageIndex = 0;

        showToast("Juz Suivant ! 🏁", `Bienvenue dans le Juz ${state.selectedJuz}.`);
        
        updateProgress();
        stopAudio();
        switchView('reader');
      });
    }

    // Language display check toggles
    if (toggleShowAr) toggleShowAr.addEventListener('change', refreshDisplayLanguages);
    if (toggleShowFr) toggleShowFr.addEventListener('change', refreshDisplayLanguages);
    if (toggleShowTrans) toggleShowTrans.addEventListener('change', refreshDisplayLanguages);

    // Initial load configurations
    const savedShowAr = localStorage.getItem('wird_show_ar');
    if (savedShowAr && toggleShowAr) toggleShowAr.checked = (savedShowAr === 'true');

    const savedShowFr = localStorage.getItem('wird_show_fr');
    if (savedShowFr && toggleShowFr) toggleShowFr.checked = (savedShowFr === 'true');

    const savedShowTrans = localStorage.getItem('wird_show_trans');
    if (savedShowTrans && toggleShowTrans) toggleShowTrans.checked = (savedShowTrans === 'true');

    // Pagination buttons event bindings
    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', () => goToPrevPage());
    }

    if (btnNextPage) {
      btnNextPage.addEventListener('click', () => goToNextPage());
    }

    // Swipe navigation: drag right → next page (suivant), drag left →
    // previous page (précédent). Ignored when the drag is mostly vertical
    // so it doesn't fight the page's own vertical scroll.
    const pageEl = document.getElementById('quran-page');
    if (pageEl) {
      let touchStartX = 0;
      let touchStartY = 0;
      let touchActive = false;

      pageEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchActive = true;
      }, { passive: true });

      pageEl.addEventListener('touchend', (e) => {
        if (!touchActive) return;
        touchActive = false;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        const SWIPE_THRESHOLD = 50;
        if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) return;
        if (deltaX > 0) {
          goToNextPage();
        } else {
          goToPrevPage();
        }
      }, { passive: true });
    }
  }

  // Web Audio API Paper Rustle Synthesizer (Zero external audio file needed!)
  function playPaperRustleSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const bufferSize = ctx.sampleRate * 0.14; // 140ms sound duration
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1350;
      filter.Q.value = 1.3;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start();
    } catch (e) {
      // Silent catch
    }
  }

  function updatePagePaginationUI() {
    const pages = state.pagesList || [];
    const activePageNum = pages[state.currentPageIndex] || 582;
    const labelReaderPage = document.getElementById('label-reader-page');
    if (labelReaderPage) {
      labelReaderPage.textContent = `Page ${state.currentPageIndex + 1}/${pages.length} (Coran P. ${activePageNum})`;
    }
    if (btnPrevPage) btnPrevPage.disabled = state.currentPageIndex === 0;
    if (btnNextPage) btnNextPage.disabled = state.currentPageIndex === pages.length - 1;
  }

  function goToPrevPage() {
    if (state.currentPageIndex <= 0) return;
    state.currentPageIndex--;
    localStorage.setItem('wird_last_page', state.pagesList[state.currentPageIndex]);
    localStorage.setItem('wird_last_juz', state.selectedJuz);
    stopAudio();
    playPaperRustleSound();
    renderQuranText(true, 'prev');
  }

  function goToNextPage() {
    if (!state.pagesList || state.currentPageIndex >= state.pagesList.length - 1) return;
    state.currentPageIndex++;
    localStorage.setItem('wird_last_page', state.pagesList[state.currentPageIndex]);
    localStorage.setItem('wird_last_juz', state.selectedJuz);
    stopAudio();
    playPaperRustleSound();
    renderQuranText(true, 'next');
  }

  // Calculate pages sum and alert if not equal to 20 pages (1 Juz)
  function calculateWirdPlanTotal() {
    const total = Object.values(state.wirdPagePlan).reduce((acc, val) => acc + val, 0);
    wirdTotalPagesLabel.textContent = `Total : ${total} page${total > 1 ? 's' : ''}`;
    
    if (total === 20) {
      wirdTotalPagesLabel.style.color = 'var(--emerald)';
    } else {
      wirdTotalPagesLabel.style.color = 'var(--primary)';
    }
    
    localStorage.setItem('wird_page_plan', JSON.stringify(state.wirdPagePlan));
  }

  // Recalculate pages segments labels (e.g. Page 1-4, Page 5-8) on prayer cards
  function refreshPrayerCardPages() {
    let start = 1;
    const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    prayers.forEach(id => {
      const card = document.querySelector(`.prayer-card[data-prayer="${id}"]`);
      if (card) {
        const pagesVal = state.wirdPagePlan[id];
        const label = card.querySelector('.prayer-pages');
        if (label) {
          if (pagesVal === 0) {
            label.textContent = "Pas de lecture";
          } else {
            const end = start + pagesVal - 1;
            label.textContent = `P. ${start}-${end}`;
            start = end + 1;
          }
        }
      }
    });
  }

  // Check if all MP3 audio URLs for the active Juz are available in Cache Storage
  async function checkJuzAudioCacheStatus() {
    if (!state.juzData || !btnAudioDownload || !audioDownloadStatus || !audioDownloadDetail) return;
    
    try {
      const cache = await caches.open('wird-audio-cache');
      let allCached = true;
      let count = 0;
      let totalCount = 0;

      state.juzData.surahs.forEach(s => {
        s.verses.forEach(v => {
          totalCount++;
        });
      });

      for (const s of state.juzData.surahs) {
        for (const v of s.verses) {
          const match = await cache.match(v.audio);
          if (match) {
            count++;
          } else {
            allCached = false;
          }
        }
      }

      if (allCached && totalCount > 0) {
        audioDownloadStatus.textContent = "Audio disponible hors-ligne";
        audioDownloadStatus.style.color = 'var(--emerald)';
        audioDownloadDetail.textContent = `Tous les ${totalCount} fichiers MP3 sont stockés localement`;
        btnAudioDownload.innerHTML = '✅ Stocké';
        btnAudioDownload.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        btnAudioDownload.style.color = 'var(--emerald)';
        btnAudioDownload.style.background = 'rgba(16, 185, 129, 0.05)';
        btnAudioDownload.disabled = true;
      } else {
        audioDownloadStatus.textContent = "Audio non stocké hors-ligne";
        audioDownloadStatus.style.color = '#FFF';
        audioDownloadDetail.textContent = `${count} / ${totalCount} fichiers MP3 en cache local`;
        btnAudioDownload.innerHTML = '📥 Télécharger';
        btnAudioDownload.style.borderColor = 'var(--primary)';
        btnAudioDownload.style.color = 'var(--primary)';
        btnAudioDownload.style.background = 'rgba(212, 175, 55, 0.08)';
        btnAudioDownload.disabled = false;
      }
    } catch (e) {
      console.warn("Could not check Cache Storage status", e);
    }
  }

  // Sequence download MP3 tracks into the 'wird-audio-cache' storage
  async function downloadJuzAudioCache() {
    if (!state.juzData || state.isAudioDownloading) return;
    
    state.isAudioDownloading = true;
    btnAudioDownload.disabled = true;
    audioDownloadProgressContainer.style.display = 'block';
    audioDownloadProgressBar.style.width = '0%';

    const cache = await caches.open('wird-audio-cache');
    const audioUrls = [];
    state.juzData.surahs.forEach(s => {
      s.verses.forEach(v => {
        audioUrls.push(v.audio);
      });
    });

    let completed = 0;
    audioDownloadStatus.textContent = "Téléchargement en cours...";
    audioDownloadStatus.style.color = 'var(--primary)';

    for (const url of audioUrls) {
      try {
        const match = await cache.match(url);
        if (!match) {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res);
          }
        }
      } catch (err) {
        console.error("Error storing audio URL", url, err);
      }
      completed++;
      const pct = Math.round((completed / audioUrls.length) * 100);
      audioDownloadProgressBar.style.width = `${pct}%`;
      audioDownloadDetail.textContent = `${completed} / ${audioUrls.length} fichiers MP3 récupérés (${pct}%)`;
    }

    state.isAudioDownloading = false;
    audioDownloadProgressContainer.style.display = 'none';
    
    await checkJuzAudioCacheStatus();
    showToast("Téléchargement fini ! 📥", "Ce Juz est maintenant disponible hors-ligne.");
  }

  // Load and populate Consistency Heatmap History (28 days)
  function initHeatmapHistory() {
    let history = localStorage.getItem('wird_consistency_history');
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (!history) {
      const mock = {};
      for (let i = 0; i < 28; i++) {
        const d = new Date();
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        mock[dateStr] = Math.floor(Math.random() * 4);
      }
      mock[todayStr] = getTodayCompletionLevel();
      
      localStorage.setItem('wird_consistency_history', JSON.stringify(mock));
      state.consistencyHistory = mock;
    } else {
      state.consistencyHistory = JSON.parse(history);
      state.consistencyHistory[todayStr] = getTodayCompletionLevel();
      localStorage.setItem('wird_consistency_history', JSON.stringify(state.consistencyHistory));
    }
  }

  function getTodayCompletionLevel() {
    const checkedCount = Object.values(state.prayersCompleted).filter(Boolean).length;
    if (checkedCount === 0) return 0;
    if (checkedCount <= 2) return 1;
    if (checkedCount <= 4) return 2;
    return 3;
  }

  // Render cells in Consistency Heatmap grid
  function renderHeatmap() {
    if (!heatmapGrid) return;
    
    heatmapGrid.innerHTML = '';
    const now = new Date();
    
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const level = state.consistencyHistory[dateStr] || 0;
      
      const cell = document.createElement('div');
      cell.className = `heatmap-cell level-${level}`;
      
      const opts = { day: 'numeric', month: 'short' };
      const formattedDate = d.toLocaleDateString('fr-FR', opts);
      cell.title = `${formattedDate} • Assiduité niveau ${level}/3`;
      
      cell.addEventListener('click', () => {
        const levelLabels = ["Aucune lecture", "Lecture modérée", "Bonne lecture", "Wird complété ! ✨"];
        showToast(formattedDate, levelLabels[level]);
      });

      heatmapGrid.appendChild(cell);
    }
  }

  // Get active verses grouped on the current page index
  function getVersesOfCurrentPage() {
    if (!state.juzData) return [];
    
    const allVerses = [];
    state.juzData.surahs.forEach(s => {
      s.verses.forEach(v => {
        allVerses.push({ verse: v, surah: s });
      });
    });

    if (state.selectedJuz === 30 && allVerses.length > 0 && !allVerses[0].verse.page) {
      allVerses.forEach((item, index) => {
        item.verse.page = 582 + Math.floor(index / 10);
      });
    }

    const activePageNum = state.pagesList[state.currentPageIndex];
    return allVerses.filter(item => item.verse.page === activePageNum);
  }

  // Toggle visible elements based on persistent settings
  function refreshDisplayLanguages() {
    const showAr = toggleShowAr ? toggleShowAr.checked : true;
    const showFr = toggleShowFr ? toggleShowFr.checked : true;
    const showTrans = toggleShowTrans ? toggleShowTrans.checked : true;

    localStorage.setItem('wird_show_ar', showAr);
    localStorage.setItem('wird_show_fr', showFr);
    localStorage.setItem('wird_show_trans', showTrans);

    document.querySelectorAll('.verse-text-ar-container').forEach(el => {
      el.style.display = showAr ? 'block' : 'none';
    });
    document.querySelectorAll('.verse-text-fr').forEach(el => {
      el.style.display = showFr ? 'block' : 'none';
    });
    document.querySelectorAll('.verse-text-trans').forEach(el => {
      el.style.display = showTrans ? 'block' : 'none';
    });
  }

  // Load dynamic Juz data (for Reader view)
  async function loadJuzData() {
    if (!quranContainer || !readerLoader) return;

    // Only the spinner toggles here — #quran-page (quranContainer) itself is
    // left alone rather than hidden via display:none while loading: it's
    // empty until renderQuranText() fills it a few lines down, and hiding it
    // would make that fill happen inside a display:none box, where
    // scrollHeight always reads 0 and fitReaderPageToViewport() can't
    // measure real content height.
    readerLoader.style.display = 'flex';

    readerSurahTitle.textContent = `Juz ${state.selectedJuz}`;
    readerJuzTitle.textContent = "Récupération en cours...";

    try {
      const data = await window.QuranAPI.fetchJuz(state.selectedJuz, state.selectedReciter);
      state.juzData = data;

      const surahsListed = data.surahs.map(s => s.nameFr).join(' / ');
      readerSurahTitle.textContent = surahsListed.length > 25 ? `${data.surahs[0].nameFr}...` : surahsListed;
      readerJuzTitle.textContent = `Juz ${state.selectedJuz} • ${data.surahs.length} Sourates`;

      renderQuranText();
      await checkJuzAudioCacheStatus();

    } catch (err) {
      console.error("Failed to fetch Quran data, loading fallback Juz 30...", err);
      loadFallbackData();
    } finally {
      readerLoader.style.display = 'none';
    }
  }

  function loadFallbackData() {
    const fallbackSurah = window.quranData;
    state.juzData = {
      juzNumber: 30,
      surahs: [{
        number: fallbackSurah.surahNumber,
        nameAr: fallbackSurah.surahNameAr,
        nameFr: fallbackSurah.surahNameFr,
        translationName: fallbackSurah.surahTranslation,
        verses: fallbackSurah.verses.map((v, idx) => {
          v.page = 582 + Math.floor(idx / 10); // sequential simulation
          return v;
        })
      }]
    };
    readerSurahTitle.textContent = fallbackSurah.surahNameFr;
    readerJuzTitle.textContent = `Juz 30 (Hors-ligne)`;
    renderQuranText();
    checkJuzAudioCacheStatus();
  }

  // Exact Uthmani text of the Bismillah as returned by the API (alquran.cloud,
  // quran-uthmani edition) — glued onto ayah 1's text for every surah except
  // Al-Fatiha and At-Tawbah, with no separator between the two. Normalized
  // (NFC) because the API's combining-mark order for the same visible text
  // doesn't always match a literal string here byte-for-byte — without this,
  // startsWith() below silently fails even though the text is identical.
  const BISMILLAH_AR = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'.normalize('NFC');

  // Shrinks the current Lecture-mode page's Arabic flow (if needed) so the
  // whole page fits without scrolling, instead of forcing one fixed size
  // that's sometimes too tall for a dense page. Safe to do per-page (unlike
  // the old StPageFlip book) since exactly one page is ever in the DOM at a
  // time here — no "uniform size across every page" balancing needed, no
  // async library lifecycle to race. Only touches inline font-size on the
  // flow elements, never state.arabicFontSize, so the A-/A+ controls keep
  // reflecting the user's actual preference rather than a shrunk value.
  function fitReaderPageToViewport() {
    if (state.readerMode !== 'read') return;
    const pageEl = document.getElementById('quran-page');
    if (!pageEl) return;
    const flowEls = pageEl.querySelectorAll('.mushaf-flow');
    if (flowEls.length === 0) return;

    const bottomNav = document.querySelector('.bottom-nav');
    const pagination = document.getElementById('reader-page-pagination');
    const pageRect = pageEl.getBoundingClientRect();
    const navHeight = bottomNav ? bottomNav.getBoundingClientRect().height : 0;
    const paginationHeight = pagination ? pagination.getBoundingClientRect().height : 0;
    const available = window.innerHeight - pageRect.top - paginationHeight - navHeight - 24;
    if (available <= 0) return;

    const applySize = (size) => {
      flowEls.forEach(el => { el.style.fontSize = `${size}px`; });
      // Set explicitly on each verse span too rather than relying on it
      // inheriting from .mushaf-flow: the ayah-marker's own em-based
      // dimensions are relative to its direct parent (.mushaf-verse), so if
      // that inheritance is ever a font behind (e.g. mid-reflow), the marker
      // stays a fixed, too-large size that alone forces the line height,
      // silently defeating the whole point of shrinking the surrounding text.
      pageEl.querySelectorAll('.mushaf-verse').forEach(el => { el.style.fontSize = `${size}px`; });
      pageEl.querySelectorAll('.mushaf-bismillah').forEach(el => { el.style.fontSize = `${Math.round(size * 0.85)}px`; });
    };

    const MIN_FONT = 12;
    const maxFont = state.arabicFontSize;

    applySize(maxFont);
    if (pageEl.scrollHeight <= available) return; // already fits at the user's chosen size

    // Text reflow isn't linear with font-size (word-wrap boundaries shift in
    // jumps), so a single proportional estimate tends to either overshoot or
    // undershoot badly. Binary search instead: it always converges on the
    // largest size that actually fits, in ~5 reflows regardless.
    let lo = MIN_FONT;
    let hi = maxFont;
    let best = MIN_FONT;
    applySize(MIN_FONT);
    if (pageEl.scrollHeight > available) {
      // Doesn't fit even at the floor — leave it at the floor rather than
      // going smaller and risking illegible text; the page will scroll
      // slightly instead of losing content.
      return;
    }
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      applySize(mid);
      if (pageEl.scrollHeight <= available) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    applySize(best);
  }

  // Render text for Page-by-Page Reader View — renders only the current
  // page's content into #quran-page; navigation just moves
  // state.currentPageIndex and calls this again. No book/frame library:
  // the page's height simply follows its content, and the reader's
  // scrollable main area handles anything taller than the viewport.
  // preserveIndex: skip re-deriving currentPageIndex from localStorage/scrollToVerseOnLoad
  // (used when the caller already set state.currentPageIndex explicitly, e.g. pagination buttons/swipe)
  // direction: 'next'|'prev' — plays the matching slide transition; omit for a plain (re)render
  function renderQuranText(preserveIndex, direction) {
    if (!state.juzData) return;

    const pageEl = document.getElementById('quran-page');
    if (!pageEl) return;
    pageEl.innerHTML = '';

    const allVerses = [];
    state.juzData.surahs.forEach(surah => {
      surah.verses.forEach(v => {
        allVerses.push({
          verse: v,
          surah: surah
        });
      });
    });

    if (state.selectedJuz === 30 && allVerses.length > 0 && !allVerses[0].verse.page) {
      allVerses.forEach((item, index) => {
        item.verse.page = 582 + Math.floor(index / 10);
      });
    }

    const pages = [...new Set(allVerses.map(item => item.verse.page || 582))].sort((a, b) => a - b);
    state.pagesList = pages;

    if (!preserveIndex) {
      if (state.scrollToVerseOnLoad) {
        const targetItem = allVerses.find(item => item.verse.number === state.scrollToVerseOnLoad);
        if (targetItem && targetItem.verse.page) {
          state.currentPageIndex = pages.indexOf(targetItem.verse.page);
          if (state.currentPageIndex === -1) state.currentPageIndex = 0;
        }
      } else {
        const savedPage = localStorage.getItem('wird_last_page');
        if (savedPage) {
          const pNum = parseInt(savedPage, 10);
          state.currentPageIndex = pages.indexOf(pNum);
          if (state.currentPageIndex === -1) state.currentPageIndex = 0;
        }
      }
    }

    if (state.currentPageIndex < 0 || state.currentPageIndex >= pages.length) {
      state.currentPageIndex = 0;
    }

    const activePageNum = pages[state.currentPageIndex];
    const pageItems = allVerses.filter(item => item.verse.page === activePageNum);

    {
      if (state.readerMode === 'memorize') {
        // Memorize mode keeps the per-verse card layout: word-masking and
        // SRS rating both need a distinct, individually-interactive block
        // per verse, so it isn't rendered as a dense continuous page.
        let activeSurahHeaderNum = null;

        pageItems.forEach(item => {
          const v = item.verse;
          const surah = item.surah;

          if (activeSurahHeaderNum !== surah.number) {
            activeSurahHeaderNum = surah.number;

            const headerCard = document.createElement('div');
            headerCard.className = 'glass-card';
            headerCard.style.padding = '12px 16px';
            headerCard.style.marginBottom = '14px';
            headerCard.style.textAlign = 'center';
            headerCard.style.borderLeft = '2px solid var(--primary)';
            headerCard.innerHTML = `
              <div style="font-size: 0.625rem; text-transform:uppercase; color:var(--primary); font-weight:600; margin-bottom:4px;">Sourate ${surah.number}</div>
              <div style="font-size: 1rem; font-weight: 700; color:#FFF; margin-bottom: 2px;">${surah.nameFr}</div>
              <div style="font-size: 0.6875rem; color:var(--text-secondary);">${surah.translationName} • <span style="font-family:var(--font-quran); color:var(--primary); font-size: 0.875rem;">${surah.nameAr}</span></div>
            `;
            pageEl.appendChild(headerCard);
          }

          const block = document.createElement('div');
          block.className = 'verse-block';
          block.id = `verse-${v.number}`;
          block.dataset.verseNum = v.number;
          block.dataset.surahNum = surah.number;
          block.dataset.audioUrl = v.audio;

          const verseKey = `juz_${state.selectedJuz}_surah_${surah.number}_verse_${v.numberInSurah}`;
          const effectiveLevel = state.hifzLevel === 'auto' ? computeAutoHifzLevel(verseKey) : state.hifzLevel;

          let arabicHtml = '';
          const words = v.textAr.split(/\s+/);

          if (effectiveLevel === 1) {
            arabicHtml = v.textAr;
          } else if (effectiveLevel === 2) {
            arabicHtml = words.map((w, idx) => {
              if (idx === 0) return w;
              return `<span class="hifz-masked-word" title="Cliquez pour révéler">${w}</span>`;
            }).join(' ');
          } else if (effectiveLevel === 3) {
            arabicHtml = words.map((w, idx) => {
              if (idx % 2 === 1) {
                return `<span class="hifz-masked-word" title="Cliquez pour révéler">${w}</span>`;
              }
              return w;
            }).join(' ');
          } else if (effectiveLevel === 4) {
            arabicHtml = `
              <div class="hifz-masked-full-wrapper" data-target="full-ar-${v.number}">
                <span>Afficher le texte arabe</span>
                <div id="full-ar-${v.number}" style="display:none; margin-top:6px; font-family:var(--font-quran); font-size:${state.arabicFontSize}px; color:#FFF; line-height:2;">
                  ${v.textAr}
                </div>
              </div>
            `;
          }

          block.innerHTML = `
            <div class="verse-header-row">
              <span class="verse-badge">${surah.nameFr} (${v.numberInSurah})</span>
              <div class="verse-actions">
                <button class="verse-action-btn record-recitation" title="Valider par ma voix" data-global-num="${v.number}" style="color:var(--text-secondary)">
                  <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
                </button>
                <button class="verse-action-btn play-verse" title="Écouter" data-global-num="${v.number}">
                  <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </button>
                <button class="verse-action-btn view-tafsir" title="Tafsir" data-global-num="${v.number}">
                  <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                </button>
              </div>
            </div>
            <div class="verse-text-ar-container">
              ${effectiveLevel === 4
                ? arabicHtml
                : `<div class="verse-text-ar" style="font-size: ${state.arabicFontSize}px">${arabicHtml}</div>`
              }
            </div>
            ${v.transliteration ? `<div class="verse-text-trans">${v.transliteration}</div>` : ''}
            <div class="verse-text-fr">${v.translation}</div>

            <div class="srs-buttons-row" data-verse-key="${verseKey}">
              <button class="btn-srs btn-srs-hard" data-rating="hard">🔴 Revoir</button>
              <button class="btn-srs btn-srs-medium" data-rating="medium">🟡 Moyen</button>
              <button class="btn-srs btn-srs-easy" data-rating="easy">🟢 Facile</button>
            </div>
          `;
          pageEl.appendChild(block);
        });
      } else {
        // Read mode: a dense, continuous Mushaf-style page — just the Arabic
        // text flowing per surah, each verse closed by a small tappable
        // ayah-end marker (opens the tafsir drawer) instead of a full card.
        // This is what actually lets a whole page's worth of verses (can be
        // 20-30+ short verses on a single real Mushaf page) fit in the frame
        // at all, rather than the per-verse badges/buttons/translation of
        // the card layout, which simply can't fit that many at once.
        let activeSurahHeaderNum = null;
        let currentFlow = null;

        pageItems.forEach(item => {
          const v = item.verse;
          const surah = item.surah;
          // The API glues the Bismillah directly onto ayah 1's text with no
          // separator ("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ عَمَّ يَتَسَآءَلُونَ" as a single
          // string) for every surah except Al-Fatiha — whose ayah 1 *is* the
          // Bismillah — and At-Tawbah, which traditionally has none.
          const normalizedText = v.textAr.normalize('NFC');
          const hasGluedBismillah = v.numberInSurah === 1 && surah.number !== 1 && surah.number !== 9
            && normalizedText.startsWith(BISMILLAH_AR);

          if (activeSurahHeaderNum !== surah.number) {
            activeSurahHeaderNum = surah.number;

            const header = document.createElement('div');
            header.className = 'mushaf-surah-header';
            header.textContent = `${surah.nameFr} • ${surah.nameAr}`;
            pageEl.appendChild(header);

            if (hasGluedBismillah) {
              const bismillahLine = document.createElement('div');
              bismillahLine.className = 'mushaf-bismillah';
              bismillahLine.dir = 'rtl';
              bismillahLine.textContent = BISMILLAH_AR;
              pageEl.appendChild(bismillahLine);
            }

            currentFlow = document.createElement('div');
            currentFlow.className = 'mushaf-flow';
            currentFlow.dir = 'rtl';
            pageEl.appendChild(currentFlow);
          }

          const verseText = hasGluedBismillah ? normalizedText.slice(BISMILLAH_AR.length).trim() : v.textAr;

          const verseSpan = document.createElement('span');
          verseSpan.className = 'mushaf-verse';
          verseSpan.id = `verse-${v.number}`;
          verseSpan.dataset.verseNum = v.number;
          verseSpan.dataset.surahNum = surah.number;
          verseSpan.dataset.audioUrl = v.audio;
          verseSpan.innerHTML = `${verseText} <span class="ayah-marker" data-global-num="${v.number}">${v.numberInSurah}</span> `;
          currentFlow.appendChild(verseSpan);
        });
      }
    }

    setupVerseInteractions();
    updatePagePaginationUI();
    refreshDisplayLanguages();
    schedulePageDwellTracking(state.selectedJuz, state.currentPageIndex + 1);
    fitReaderPageToViewport();

    // Play the slide-in transition matching the navigation direction, if any
    pageEl.classList.remove('page-slide-next', 'page-slide-prev');
    if (direction === 'next' || direction === 'prev') {
      void pageEl.offsetWidth; // force reflow so the animation restarts on repeated navigation
      pageEl.classList.add(direction === 'next' ? 'page-slide-next' : 'page-slide-prev');
    }

    // Scroll to target verse on load if requested
    if (state.scrollToVerseOnLoad) {
      setTimeout(() => {
        const verseEl = document.getElementById(`verse-${state.scrollToVerseOnLoad}`);
        if (verseEl) {
          verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          verseEl.style.animation = 'pulseGreen 2s ease-in-out';
          setTimeout(() => {
            verseEl.style.animation = '';
          }, 2500);
        }
        state.scrollToVerseOnLoad = null;
      }, 200);
    }
  }

  // Setup click interactions for rendered verses
  function setupVerseInteractions() {
    const targetParent = document.getElementById('quran-page') || quranContainer;
    if (!targetParent) return;

    // Read-mode dense Mushaf page has no per-verse button row, so both
    // actions are reached via the two tap zones the layout already has:
    // tapping the verse's Arabic text plays its recitation, tapping its
    // small ayah-end marker opens tafsir (translation + explanation).
    targetParent.querySelectorAll('.mushaf-verse').forEach(verseEl => {
      verseEl.addEventListener('click', (e) => {
        const num = parseInt(verseEl.dataset.verseNum, 10);
        playVerse(num);
        saveReadingPosition(num);
      });
    });

    targetParent.querySelectorAll('.ayah-marker').forEach(marker => {
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const num = parseInt(marker.dataset.globalNum, 10);
        openTafsirDrawer(num);
        saveReadingPosition(num);
      });
    });

    const blocks = targetParent.querySelectorAll('.verse-block');
    blocks.forEach(block => {
      // 1. Play button
      const playBtn = block.querySelector('.play-verse');
      if (playBtn) {
        playBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const num = parseInt(playBtn.dataset.globalNum, 10);
          playVerse(num);
          saveReadingPosition(num);
        });
      }

      // 2. Tafsir button
      const tafsirBtn = block.querySelector('.view-tafsir');
      if (tafsirBtn) {
        tafsirBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const num = parseInt(tafsirBtn.dataset.globalNum, 10);
          openTafsirDrawer(num);
        });
      }

      // 3. Speech recording button
      const recordBtn = block.querySelector('.record-recitation');
      if (recordBtn) {
        recordBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const num = parseInt(recordBtn.dataset.globalNum, 10);
          startSpeechRecording(num, recordBtn);
        });
      }

      // 4. Word mask interaction (for Hifz levels 2 & 3)
      block.querySelectorAll('.hifz-masked-word').forEach(word => {
        word.addEventListener('click', (e) => {
          e.stopPropagation();
          word.classList.toggle('revealed');
        });
      });

      // 5. Full text mask wrapper (for Hifz level 4)
      block.querySelectorAll('.hifz-masked-full-wrapper').forEach(wrapper => {
        wrapper.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = wrapper.dataset.target;
          const targetDiv = document.getElementById(targetId);
          const span = wrapper.querySelector('span');
          if (targetDiv) {
            if (targetDiv.style.display === 'none') {
              targetDiv.style.display = 'block';
              if (span) span.textContent = 'Masquer le texte arabe';
            } else {
              targetDiv.style.display = 'none';
              if (span) span.textContent = 'Afficher le texte arabe';
            }
          }
        });
      });

      // 6. SRS buttons click handler
      const srsRow = block.querySelector('.srs-buttons-row');
      if (srsRow) {
        const verseKey = srsRow.dataset.verseKey;
        // Restore active class if rating exists in state
        const existingRating = state.srsDatabase[verseKey];
        if (existingRating && existingRating.difficulty) {
          const activeBtn = srsRow.querySelector(`.btn-srs[data-rating="${existingRating.difficulty}"]`);
          if (activeBtn) {
            activeBtn.classList.add('active');
          }
        }

        srsRow.querySelectorAll('.btn-srs').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rating = btn.dataset.rating;
            const intervals = { hard: 1, medium: 3, easy: 7 };
            const intervalDays = intervals[rating] || 1;
            
            state.srsDatabase[verseKey] = {
              nextReviewDate: Date.now() + intervalDays * 24 * 60 * 60 * 1000,
              difficulty: rating,
              interval: intervalDays,
              timestamp: Date.now()
            };
            
            localStorage.setItem('wird_srs_database', JSON.stringify(state.srsDatabase));
            
            srsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            updateSRSDashboardCard();
            
            const ratingLabel = rating === 'easy' ? 'Facile' : rating === 'medium' ? 'Moyen' : 'À revoir';
            showToast("Mise à jour SRS", `Verset marqué comme : ${ratingLabel}`);
          });
        });
      }
    });
  }

  // Audio Playback
  function playVerse(globalNum) {
    if (!nativeAudioPlayer || !state.juzData) return;

    let targetVerse = null;
    let targetSurah = null;
    
    for (const surah of state.juzData.surahs) {
      targetVerse = surah.verses.find(v => v.number === globalNum);
      if (targetVerse) {
        targetSurah = surah;
        break;
      }
    }

    if (!targetVerse) return;

    if (state.currentPlayingVerseNum !== globalNum) {
      state.currentPlayingVerseNum = globalNum;
      state.audioPlayCount = 1;
    }

    document.querySelectorAll('.verse-block, .mushaf-verse').forEach(b => b.classList.remove('active-reciting'));

    const activeBlock = document.getElementById(`verse-${globalNum}`);
    if (activeBlock) {
      activeBlock.classList.add('active-reciting');
    }

    nativeAudioPlayer.src = targetVerse.audio;
    nativeAudioPlayer.load();
    nativeAudioPlayer.play()
      .then(() => {
        audioWidget.style.display = 'flex';
        audioVerseTitle.textContent = `${targetSurah.nameFr} • Verset ${targetVerse.numberInSurah} (Rép. ${state.audioPlayCount})`;
        audioPlayBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
      })
      .catch(err => {
        console.error("Audio playback error:", err);
      });
  }

  function stopAudio() {
    if (!nativeAudioPlayer) return;
    nativeAudioPlayer.pause();
    audioPlayBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    
    if (state.currentPlayingVerseNum) {
      const block = document.getElementById(`verse-${state.currentPlayingVerseNum}`);
      if (block) block.classList.remove('active-reciting');
    }
  }

  if (nativeAudioPlayer) {
    nativeAudioPlayer.addEventListener('ended', () => {
      if (!state.juzData) return;

      if (state.audioLoopRepetitions === 'infinite') {
        state.audioPlayCount++;
        playVerse(state.currentPlayingVerseNum);
      } else {
        const targetLoops = parseInt(state.audioLoopRepetitions, 10);
        if (state.audioPlayCount < targetLoops) {
          state.audioPlayCount++;
          playVerse(state.currentPlayingVerseNum);
        } else {
          state.audioPlayCount = 1;
          const nextGlobalNum = state.currentPlayingVerseNum + 1;
          
          let nextExists = false;
          let nextVerseObj = null;
          for (const surah of state.juzData.surahs) {
            nextVerseObj = surah.verses.find(v => v.number === nextGlobalNum);
            if (nextVerseObj) {
              nextExists = true;
              break;
            }
          }

          // Audio auto transitions page if next verse is on next page
          if (nextExists && nextVerseObj) {
            const curPage = state.pagesList[state.currentPageIndex];
            if (nextVerseObj.page && nextVerseObj.page !== curPage) {
              // Switch page index
              const nextIdx = state.pagesList.indexOf(nextVerseObj.page);
              if (nextIdx !== -1) {
                state.currentPageIndex = nextIdx;
                renderQuranText(true);
              }
            }
            playVerse(nextGlobalNum);
            saveReadingPosition(nextGlobalNum);
          } else {
            stopAudio();
          }
        }
      }
    });

    nativeAudioPlayer.addEventListener('timeupdate', () => {
      if (nativeAudioPlayer.duration) {
        const pct = (nativeAudioPlayer.currentTime / nativeAudioPlayer.duration) * 100;
        audioProgressBar.style.width = `${pct}%`;
      }
    });
  }

  if (audioPlayBtn) {
    audioPlayBtn.addEventListener('click', () => {
      if (nativeAudioPlayer.paused) {
        if (state.currentPlayingVerseNum) {
          nativeAudioPlayer.play();
          audioPlayBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        } else {
          const pageItems = getVersesOfCurrentPage();
          if (pageItems.length > 0) {
            const firstV = pageItems[0].verse;
            playVerse(firstV.number);
            saveReadingPosition(firstV.number);
          }
        }
      } else {
        nativeAudioPlayer.pause();
        audioPlayBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
      }
    });
  }

  const audioCloseBtn = document.getElementById('audio-close-btn');
  if (audioCloseBtn) {
    audioCloseBtn.addEventListener('click', () => {
      stopAudio();
      audioWidget.style.display = 'none';
    });
  }

  // Scores how closely spokenText matches the expected verse text — shared
  // by the reader's inline recitation check and the Hifz Workshop flashcard
  // so the two don't drift into subtly different pass/fail rules.
  function computeRecitationScore(spokenText, originalArabicText) {
    const originalWords = cleanArabicText(originalArabicText).split(' ').filter(Boolean);
    const spokenWords = cleanArabicText(spokenText).split(' ').filter(Boolean);
    let matchesCount = 0;
    originalWords.forEach(w => { if (spokenWords.includes(w)) matchesCount++; });
    const scorePct = originalWords.length > 0 ? Math.round((matchesCount / originalWords.length) * 100) : 0;
    return { scorePct, passed: scorePct >= 70 };
  }

  // "Auto" masking mode: derive how much help a verse gets from its own SRS
  // record instead of applying one level to every verse on the page — never
  // tested or rated hard gets full support, rated easy gets tested hardest.
  function computeAutoHifzLevel(verseKey) {
    const record = state.srsDatabase[verseKey];
    if (!record) return 1;
    if (record.difficulty === 'hard') return 1;
    if (record.difficulty === 'medium') return 2;
    return 4; // easy
  }

  // Persists an SRS rating and schedules the next review date — shared by
  // the reader's per-verse SRS buttons, the Hifz flashcard's SRS buttons,
  // and the automatic pass/fail write after a voice check.
  function scheduleSrsReview(verseKey, rating) {
    const intervals = { hard: 1, medium: 3, easy: 7 };
    const intervalDays = intervals[rating] || 1;
    state.srsDatabase[verseKey] = {
      nextReviewDate: Date.now() + intervalDays * 24 * 60 * 60 * 1000,
      difficulty: rating,
      interval: intervalDays,
      timestamp: Date.now()
    };
    localStorage.setItem('wird_srs_database', JSON.stringify(state.srsDatabase));

    // Every SRS rating, from any surface (reader cards, voice check, Hifz
    // flashcard), counts as one practice rep — reward attempts, not just
    // success, so the streak/XP system doesn't punish honest self-rating.
    const xpRewards = { hard: 5, medium: 10, easy: 15 };
    awardHifzXp(xpRewards[rating] || 5);
  }

  // ==================== HIFZ GAMIFICATION ====================

  const HIFZ_XP_PER_LEVEL = 100;

  function getHifzLevelInfo() {
    const level = Math.floor(state.hifzXp / HIFZ_XP_PER_LEVEL) + 1;
    const xpIntoLevel = state.hifzXp % HIFZ_XP_PER_LEVEL;
    return { level, xpIntoLevel, xpForLevel: HIFZ_XP_PER_LEVEL };
  }

  // Consecutive days (ending today, or ending yesterday if today has no
  // activity yet) found in hifzStreakHistory.
  function computeHifzStreak() {
    let streak = 0;
    const cursor = new Date();
    const todayStr = cursor.toISOString().split('T')[0];
    if (!state.hifzStreakHistory[todayStr]) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (true) {
      const dStr = cursor.toISOString().split('T')[0];
      if (state.hifzStreakHistory[dStr]) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function markHifzActivityToday() {
    const todayStr = new Date().toISOString().split('T')[0];
    if (!state.hifzStreakHistory[todayStr]) {
      state.hifzStreakHistory[todayStr] = true;
      localStorage.setItem('wird_hifz_streak_history', JSON.stringify(state.hifzStreakHistory));
    }
  }

  function awardHifzXp(amount) {
    state.hifzXp += amount;
    localStorage.setItem('wird_hifz_xp', state.hifzXp);
    markHifzActivityToday();
    updateHifzGamificationUI();
  }

  const HIFZ_BADGES = [
    { icon: '🌱', label: 'Premier pas', check: (m, streak) => m.totalTested >= 1 },
    { icon: '📿', label: '10 versets', check: (m, streak) => m.masteredGlobal >= 10 },
    { icon: '🕌', label: '50 versets', check: (m, streak) => m.masteredGlobal >= 50 },
    { icon: '🔥', label: '3 jours', check: (m, streak) => streak >= 3 },
    { icon: '⚡', label: '7 jours', check: (m, streak) => streak >= 7 },
    { icon: '👑', label: '30 jours', check: (m, streak) => streak >= 30 }
  ];

  function renderHifzBadges() {
    const container = document.getElementById('hifz-badges-row');
    if (!container) return;
    const streak = computeHifzStreak();
    const masteredGlobal = Object.values(state.srsDatabase).filter(r => r.difficulty === 'easy').length;
    const totalTested = Object.keys(state.srsDatabase).length;
    const metrics = { masteredGlobal, totalTested };

    container.innerHTML = '';
    HIFZ_BADGES.forEach(b => {
      const earned = b.check(metrics, streak);
      const el = document.createElement('div');
      el.className = 'hifz-badge' + (earned ? ' earned' : '');
      el.title = b.label;
      el.innerHTML = `<span class="hifz-badge-icon">${b.icon}</span><span class="hifz-badge-label">${b.label}</span>`;
      container.appendChild(el);
    });
  }

  // Refreshes every gamification display currently in the DOM (Atelier
  // stats bar + badges, and the reader's compact mini-chip if present).
  function updateHifzGamificationUI() {
    const streak = computeHifzStreak();
    const { level, xpIntoLevel, xpForLevel } = getHifzLevelInfo();

    document.querySelectorAll('.hifz-streak-value').forEach(el => { el.textContent = streak; });
    document.querySelectorAll('.hifz-level-value').forEach(el => { el.textContent = level; });
    document.querySelectorAll('.hifz-xp-bar-fill').forEach(el => {
      el.style.width = `${Math.round((xpIntoLevel / xpForLevel) * 100)}%`;
    });
    document.querySelectorAll('.hifz-xp-detail').forEach(el => {
      el.textContent = `${xpIntoLevel}/${xpForLevel} XP`;
    });

    renderHifzBadges();
  }

  // Starts a focused practice session on a single surah — every verse in
  // it, verses not yet mastered first — rather than only what's due today.
  function startSurahPracticeSession(surahNum, juzNum) {
    if (!state.juzData) return;
    const surah = state.juzData.surahs.find(s => s.number === surahNum);
    if (!surah) return;

    const keys = surah.verses.map(v => `juz_${juzNum}_surah_${surahNum}_verse_${v.numberInSurah}`);
    keys.sort((a, b) => {
      const ra = state.srsDatabase[a];
      const rb = state.srsDatabase[b];
      const masteredA = ra && ra.difficulty === 'easy' ? 1 : 0;
      const masteredB = rb && rb.difficulty === 'easy' ? 1 : 0;
      return masteredA - masteredB;
    });

    state.reviewQueue = keys;
    state.reviewSessionActive = true;
    switchView('memorize');
    advanceReviewSession();
  }

  // Renders one progress card per surah in the selected Juz, replacing the
  // old flat 564-cell number grid — tapping a card starts a focused
  // practice session on that surah instead of testing one verse at a time.
  function renderHifzSurahCards() {
    const container = document.getElementById('hifz-surah-list');
    if (!container || !state.juzData) return;

    container.innerHTML = '';
    state.juzData.surahs.forEach(surah => {
      const total = surah.verses.length;
      let mastered = 0;
      surah.verses.forEach(v => {
        const key = `juz_${state.selectedJuz}_surah_${surah.number}_verse_${v.numberInSurah}`;
        const record = state.srsDatabase[key];
        if (record && record.difficulty === 'easy') mastered++;
      });
      const pct = total > 0 ? Math.round((mastered / total) * 100) : 0;

      const card = document.createElement('div');
      card.className = 'hifz-surah-card';
      card.style.setProperty('--pct', pct);
      card.innerHTML = `
        <div class="hifz-surah-card-ring"><span>${pct}%</span></div>
        <div class="hifz-surah-card-info">
          <div class="hifz-surah-card-name">${surah.nameFr}</div>
          <div class="hifz-surah-card-ar">${surah.nameAr}</div>
          <div class="hifz-surah-card-detail">${mastered}/${total} versets maîtrisés</div>
        </div>
        <button class="hifz-surah-card-play" aria-label="Pratiquer cette sourate">▶</button>
      `;
      card.addEventListener('click', () => startSurahPracticeSession(surah.number, state.selectedJuz));
      container.appendChild(card);
    });
  }

  // Wraps SpeechRecognition setup/teardown so the reader's inline recitation
  // check and the Hifz flashcard's mic button don't each keep their own
  // near-identical copy of it. Calls exactly one of onFinalResult(text) /
  // onNoSpeech() / onUnsupported() / onPermissionDenied(); returns the
  // recognizer instance (or null) so the caller can store it for cancellation.
  function createSpeechRecognizer({ onInterimResult, onFinalResult, onNoSpeech, onUnsupported, onPermissionDenied }) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onUnsupported();
      return null;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'ar-SA';
    rec.interimResults = true;
    rec.continuous = false;

    let lastText = '';
    rec.onresult = (event) => {
      lastText = Array.from(event.results).map(r => r[0].transcript).join('');
      if (onInterimResult) onInterimResult(lastText);
    };

    rec.onend = () => {
      if (lastText.trim()) {
        onFinalResult(lastText.trim());
      } else if (onNoSpeech) {
        onNoSpeech();
      }
    };

    rec.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      if (e.error === 'not-allowed') onPermissionDenied();
    };

    try {
      rec.start();
      return rec;
    } catch (err) {
      console.error("Failed to start recognition:", err);
      onUnsupported();
      return null;
    }
  }

  function closeSpeechModal() {
    if (speechModal) speechModal.style.display = 'none';
    if (speechFallbackRow) speechFallbackRow.style.display = 'none';
    document.querySelectorAll('.record-recitation').forEach(b => b.classList.remove('listening-active'));
  }

  // Voice Speech Recognition Integration (Reader View)
  function startSpeechRecording(globalNum, buttonElement) {
    stopAudio();
    state.recordingVerseNum = globalNum;

    if (speechModal && speechTranscription) {
      speechModal.style.display = 'flex';
      speechTranscription.textContent = "(Parlez maintenant...)";
    }
    if (speechFallbackRow) speechFallbackRow.style.display = 'none';

    document.querySelectorAll('.record-recitation').forEach(b => b.classList.remove('listening-active'));
    if (buttonElement) buttonElement.classList.add('listening-active');

    state.activeRecognition = createSpeechRecognizer({
      onInterimResult: (text) => { speechTranscription.textContent = text; },
      onFinalResult: (text) => evaluateSpeechResult(text),
      onNoSpeech: () => {
        speechTranscription.textContent = "(Rien entendu, réessayez.)";
        document.querySelectorAll('.record-recitation').forEach(b => b.classList.remove('listening-active'));
      },
      onUnsupported: () => {
        speechTranscription.textContent = "(Reconnaissance vocale indisponible.)";
        if (speechFallbackMsg) speechFallbackMsg.textContent = "Reconnaissance vocale indisponible sur cet appareil.";
        if (speechFallbackRow) speechFallbackRow.style.display = 'flex';
      },
      onPermissionDenied: () => {
        speechTranscription.textContent = "(Permission micro refusée.)";
        if (speechFallbackMsg) speechFallbackMsg.textContent = "L'accès au micro a été refusé.";
        if (speechFallbackRow) speechFallbackRow.style.display = 'flex';
      }
    });
  }

  function getActiveRecordingVerse() {
    if (!state.recordingVerseNum || !state.juzData) return null;
    for (const surah of state.juzData.surahs) {
      const v = surah.verses.find(verse => verse.number === state.recordingVerseNum);
      if (v) return v;
    }
    return null;
  }

  function cancelSpeechRecording() {
    if (state.activeRecognition) {
      state.activeRecognition.onend = null;
      state.activeRecognition.stop();
      state.activeRecognition = null;
    }
    closeSpeechModal();
  }

  // Remove diacritics (Harakat/Tashkeel) from Arabic text
  function cleanArabicText(text) {
    if (!text) return '';
    return text
      .replace(/[\u064B-\u065F\u0670\u0671\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()؟?]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Evaluate speech result (Reader View) — also reached with an empty
  // spokenText from the manual "À revoir" fallback button, which correctly
  // scores as 0% via computeRecitationScore.
  function evaluateSpeechResult(spokenText) {
    if (state.activeRecognition) {
      state.activeRecognition.onend = null;
      state.activeRecognition.stop();
      state.activeRecognition = null;
    }

    const globalNum = state.recordingVerseNum;
    const verseBlock = document.getElementById(`verse-${globalNum}`);
    const verseObj = getActiveRecordingVerse();

    if (!verseBlock || !verseObj) {
      closeSpeechModal();
      return;
    }

    const { scorePct, passed } = computeRecitationScore(spokenText, verseObj.textAr);
    const rating = passed ? 'easy' : 'hard';
    const quote = spokenText ? ` - "${spokenText.substring(0, 20)}..."` : '';

    verseBlock.classList.remove('recitation-success', 'recitation-error');
    verseBlock.classList.add(passed ? 'recitation-success' : 'recitation-error');

    const srsRow = verseBlock.querySelector('.srs-buttons-row');
    if (srsRow) {
      srsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));
      srsRow.querySelector(passed ? '.btn-srs-easy' : '.btn-srs-hard').classList.add('active');
    }

    const verseKey = `juz_${state.selectedJuz}_surah_${verseBlock.dataset.surahNum}_verse_${verseObj.numberInSurah}`;
    scheduleSrsReview(verseKey, rating);

    if (passed) {
      showToast("Récitation Réussie ! 🎉", `Précision : ${scorePct}%${quote}`);
      createConfetti(verseBlock);
    } else {
      showToast("À revoir ⚠️", `Précision : ${scorePct}%${quote}`);
    }

    updateSRSDashboardCard();
    closeSpeechModal();
  }

  // ==================== HIFZ WORKSHOP LOGIC ====================

  // Per-Juz data fetched on demand while walking a cross-Juz review session,
  // kept separate from state.juzData (which tracks the reader's own Juz) so
  // reviewing doesn't disturb the user's current reading position.
  const reviewSessionJuzCache = {};
  async function ensureJuzDataLoaded(juzNum) {
    if (state.juzData && state.juzData.juzNumber === juzNum) return state.juzData;
    if (reviewSessionJuzCache[juzNum]) return reviewSessionJuzCache[juzNum];
    const data = await window.QuranAPI.fetchJuz(juzNum, state.selectedReciter);
    reviewSessionJuzCache[juzNum] = data;
    return data;
  }

  // Starts a guided review session: every verse currently due (any Juz),
  // oldest-due-first, presented one at a time via the flashcard.
  async function startReviewSession() {
    const now = Date.now();
    const dueKeys = Object.keys(state.srsDatabase)
      .filter(k => state.srsDatabase[k].nextReviewDate <= now)
      .sort((a, b) => state.srsDatabase[a].nextReviewDate - state.srsDatabase[b].nextReviewDate);

    if (dueKeys.length === 0) {
      showToast("Rien à réviser", "Aucun verset n'est dû pour révision aujourd'hui.");
      return;
    }

    state.reviewQueue = dueKeys;
    state.reviewSessionActive = true;
    switchView('memorize');
    await advanceReviewSession();
  }

  // Presents the next verse in the review queue, or closes out the session
  // once it's empty. Called after each SRS rating during an active session.
  async function advanceReviewSession() {
    if (!state.reviewQueue || state.reviewQueue.length === 0) {
      const wasActive = state.reviewSessionActive;
      closeHifzFlashcard();
      if (wasActive) {
        showToast("Session terminée ! 🎉", "Vous avez révisé tous les versets dus.");
        loadHifzDashboard();
      }
      return;
    }

    const key = state.reviewQueue[0];
    const parts = key.split('_'); // ['juz', J, 'surah', S, 'verse', V]
    const juzNum = parseInt(parts[1], 10);
    const surahNum = parseInt(parts[3], 10);
    const verseNumInSurah = parseInt(parts[5], 10);

    let juzData;
    try {
      juzData = await ensureJuzDataLoaded(juzNum);
    } catch (err) {
      console.warn("Failed to load Juz for review session", juzNum, err);
      state.reviewQueue.shift();
      return advanceReviewSession();
    }

    const surah = juzData.surahs.find(s => s.number === surahNum);
    const verse = surah ? surah.verses.find(v => v.numberInSurah === verseNumInSurah) : null;
    if (!surah || !verse) {
      state.reviewQueue.shift();
      return advanceReviewSession();
    }

    openHifzFlashcard(verse, surah, juzNum, `Sourate ${surah.number}:${verse.numberInSurah}`);
  }

  // Load and Render the visual Hifz Dashboard Grid (view-memorize)
  async function loadHifzDashboard() {
    if (!hifzSurahList || !hifzJuzBadge) return;

    hifzJuzBadge.textContent = `Juz ${state.selectedJuz}`;
    hifzSurahList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 0.75rem;">Chargement du plan de révision...</div>';
    updateHifzDueSummary();
    updateHifzGamificationUI();

    if (!state.juzData || state.juzData.juzNumber !== state.selectedJuz) {
      try {
        const data = await window.QuranAPI.fetchJuz(state.selectedJuz, state.selectedReciter);
        state.juzData = data;
      } catch (err) {
        console.warn("Offline fallback for Hifz grid", err);
        const fallbackSurah = window.quranData;
        state.juzData = {
          juzNumber: 30,
          surahs: [{
            number: fallbackSurah.surahNumber,
            nameAr: fallbackSurah.surahNameAr,
            nameFr: fallbackSurah.surahNameFr,
            translationName: fallbackSurah.surahTranslation,
            verses: fallbackSurah.verses.map((v, idx) => {
              v.page = 582 + Math.floor(idx / 10);
              return v;
            })
          }]
        };
      }
    }

    renderHifzSurahCards();
  }

  // Global count of verses due for review right now, across every Juz —
  // independent of which Juz is currently selected in the dropdown.
  function updateHifzDueSummary() {
    if (!hifzDueDetail) return;
    const now = Date.now();
    const dueCount = Object.values(state.srsDatabase).filter(r => r.nextReviewDate <= now).length;
    hifzDueDetail.textContent = dueCount > 0
      ? `${dueCount} verset${dueCount > 1 ? 's' : ''} à réviser`
      : "Aucun verset à réviser pour le moment";
  }

  // Open Flashcard modal for target verse. refLabel is shown in the header;
  // juzNum must be the verse's actual Juz (not necessarily state.selectedJuz —
  // a review session can walk verses across several Juz).
  function openHifzFlashcard(verse, surah, juzNum, refLabel) {
    state.activeHifzVerse = verse;
    state.activeHifzSurah = surah;
    state.activeHifzJuz = juzNum;
    state.audioPlayCount = 1;

    hifzCardRef.textContent = refLabel || `Sourate ${surah.number}:${verse.numberInSurah}`;

    if (hifzSessionBanner) {
      if (state.reviewSessionActive && state.reviewQueue) {
        hifzSessionBanner.style.display = 'block';
        hifzSessionBanner.textContent = `Session de révision — ${state.reviewQueue.length} restant(s)`;
      } else {
        hifzSessionBanner.style.display = 'none';
      }
    }

    hifzCardTranslation.textContent = `"${verse.translation}"`;
    hifzCardTranslit.textContent = verse.transliteration;

    hifzCardPlaceholder.style.display = 'block';
    hifzCardPlaceholder.textContent = 'Enregistrez votre voix pour valider...';
    hifzCardPlaceholder.style.color = '';
    hifzCardPlaceholder.style.fontStyle = '';
    hifzCardArabic.style.display = 'none';
    hifzCardArabic.textContent = verse.textAr;
    hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';

    hifzCardSrsRow.style.display = 'none';
    if (hifzFallbackRow) hifzFallbackRow.style.display = 'none';
    hifzCardMicBtn.className = '';
    hifzCardRecordingStatus.textContent = 'Cliquez pour réciter';
    hifzCardRecordingStatus.style.color = 'var(--text-secondary)';

    if (hifzFlashcardModal && drawerOverlay) {
      hifzFlashcardModal.classList.add('open');
      drawerOverlay.classList.add('active');
    }
  }

  function closeHifzFlashcard() {
    cancelHifzSpeechRecording();

    if (hifzFlashcardModal && drawerOverlay) {
      hifzFlashcardModal.classList.remove('open');
      drawerOverlay.classList.remove('active');
    }

    state.activeHifzVerse = null;
    state.activeHifzSurah = null;
    state.activeHifzJuz = null;

    // Closing manually (not via a rating) abandons any in-progress session.
    if (state.reviewSessionActive) {
      state.reviewSessionActive = false;
      state.reviewQueue = [];
    }
  }

  // Record voice inside the Hifz Flashcard
  function startHifzVoiceRecording() {
    if (!state.activeHifzVerse) return;

    hifzCardPlaceholder.style.display = 'block';
    hifzCardArabic.style.display = 'none';
    hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';
    hifzCardSrsRow.style.display = 'none';
    if (hifzFallbackRow) hifzFallbackRow.style.display = 'none';

    hifzCardMicBtn.className = 'hifz-mic-pulse-active';
    hifzCardRecordingStatus.textContent = 'Écoute en cours... Récitez le verset';
    hifzCardRecordingStatus.style.color = 'var(--ruby)';

    state.hifzSpeechRecognition = createSpeechRecognizer({
      onInterimResult: (text) => {
        hifzCardPlaceholder.textContent = text;
        hifzCardPlaceholder.style.color = '#FFF';
        hifzCardPlaceholder.style.fontStyle = 'normal';
      },
      onFinalResult: (text) => evaluateHifzSpeechResult(text),
      onNoSpeech: () => cancelHifzSpeechRecording(),
      onUnsupported: () => {
        cancelHifzSpeechRecording();
        if (hifzFallbackMsg) hifzFallbackMsg.textContent = "Reconnaissance vocale indisponible sur cet appareil.";
        if (hifzFallbackRow) hifzFallbackRow.style.display = 'flex';
      },
      onPermissionDenied: () => {
        cancelHifzSpeechRecording();
        if (hifzFallbackMsg) hifzFallbackMsg.textContent = "L'accès au micro a été refusé.";
        if (hifzFallbackRow) hifzFallbackRow.style.display = 'flex';
      }
    });
  }

  // Cancel speech recording loop
  function cancelHifzSpeechRecording() {
    hifzCardMicBtn.className = '';
    hifzCardRecordingStatus.textContent = 'Cliquez pour réciter';
    hifzCardRecordingStatus.style.color = 'var(--text-secondary)';

    if (state.hifzSpeechRecognition) {
      state.hifzSpeechRecognition.onend = null;
      state.hifzSpeechRecognition.stop();
      state.hifzSpeechRecognition = null;
    }
  }

  // Check matching score in Flashcard — writing the SRS rating still
  // requires an explicit tap on one of the three rating buttons below
  // (this only pre-selects a suggested one), matching the flashcard's
  // existing "confirm your own rating" flow.
  function evaluateHifzSpeechResult(spokenText) {
    cancelHifzSpeechRecording();
    if (!state.activeHifzVerse) return;

    const { scorePct, passed } = computeRecitationScore(spokenText, state.activeHifzVerse.textAr);
    const quote = spokenText ? ` - "${spokenText.substring(0, 20)}..."` : '';

    hifzCardPlaceholder.style.display = 'none';
    hifzCardArabic.style.display = 'block';
    hifzCardSrsRow.style.display = 'flex';
    hifzCardSrsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));

    if (passed) {
      showToast("Récitation Réussie ! 🎉", `Précision : ${scorePct}%${quote}`);
      hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper flashcard-reveal-success';
      hifzCardSrsRow.querySelector('.btn-srs-easy').classList.add('active');
    } else {
      showToast("Récitation à revoir ⚠️", `Précision : ${scorePct}%${quote}`);
      hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper flashcard-reveal-error';
      hifzCardSrsRow.querySelector('.btn-srs-hard').classList.add('active');
    }
  }

  // Save current page position details
  function saveReadingPosition(globalNum) {
    if (!state.juzData) return;

    let verseObj = null;
    let surahObj = null;
    for (const surah of state.juzData.surahs) {
      verseObj = surah.verses.find(v => v.number === globalNum);
      if (verseObj) {
        surahObj = surah;
        break;
      }
    }

    if (verseObj && surahObj) {
      state.lastViewedVerseNum = globalNum;
      state.lastViewedJuz = state.selectedJuz;
      
      localStorage.setItem('wird_last_viewed_verse', globalNum);
      localStorage.setItem('wird_last_viewed_juz', state.selectedJuz);

      updateResumeReadingCard(verseObj, surahObj);
    }
  }

  // View Routing - Bulletproof implementation with visual debug logging
  function switchView(viewId) {
    console.log("Attempting view switch to:", viewId);

    const targetView = document.getElementById(`view-${viewId}`);
    if (!targetView) {
      console.error("CRITICAL: Target view not found in DOM:", `view-${viewId}`);
      return;
    }

    if (viewId !== 'reader') cancelPageDwellTracking();

    // Hide all view panels safely
    document.querySelectorAll('.view').forEach(el => {
      el.classList.remove('active');
    });
    
    // Activate target view
    targetView.classList.add('active');
    state.currentView = viewId;

    // Highlight active nav item
    document.querySelectorAll('.nav-item').forEach(nav => {
      if (nav.dataset.view === viewId) {
        nav.classList.add('active');
      } else {
        nav.classList.remove('active');
      }
    });

    console.log("View switch success:", viewId);

    // Context triggers
    if (viewId === 'reader') {
      const hifzToolbar = document.getElementById('hifz-toolbar');
      if (hifzToolbar) hifzToolbar.style.display = 'none';
      setReaderMode('read');
      if (!state.juzData || state.juzData.juzNumber !== state.selectedJuz) {
        loadJuzData();
      } else {
        renderQuranText();
        checkJuzAudioCacheStatus();
      }
    } else if (viewId === 'memorize') {
      loadHifzDashboard();
    } else if (viewId === 'dashboard') {
      renderHeatmap();
      checkInitialReadingPosition();
    } else {
      const hifzToolbar = document.getElementById('hifz-toolbar');
      if (hifzToolbar) hifzToolbar.style.display = 'none';
    }
    
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.scrollTop = 0;
  }

  // Reading-based Wird tracking: a page only counts as "read" if the user stays
  // on it at least PAGE_DWELL_MS — rapidly flipping through pages resets the
  // timer on every navigation, so it never fires and nothing gets counted.
  const PAGE_DWELL_MS = 4000;

  function schedulePageDwellTracking(juz, pageOrdinal) {
    if (state.pageDwellTimer) {
      clearTimeout(state.pageDwellTimer);
      state.pageDwellTimer = null;
    }
    if (state.readerMode !== 'read') return;
    state.pageDwellTimer = setTimeout(() => {
      state.pageDwellTimer = null;
      const stillOnSamePage = state.currentView === 'reader' &&
        state.readerMode === 'read' &&
        state.selectedJuz === juz &&
        (state.currentPageIndex + 1) === pageOrdinal;
      if (stillOnSamePage) {
        markPageAsRead(juz, pageOrdinal);
      }
    }, PAGE_DWELL_MS);
  }

  function cancelPageDwellTracking() {
    if (state.pageDwellTimer) {
      clearTimeout(state.pageDwellTimer);
      state.pageDwellTimer = null;
    }
  }

  function markPageAsRead(juz, pageOrdinal) {
    if (!state.readPages[juz]) state.readPages[juz] = {};
    if (state.readPages[juz][pageOrdinal]) return;
    state.readPages[juz][pageOrdinal] = true;
    localStorage.setItem('wird_read_pages', JSON.stringify(state.readPages));
    if (juz === state.selectedJuz) {
      autoCompletePrayersFromReadPages();
    }
  }

  // Maps the Wird's per-prayer page plan (e.g. Fajr: 4 pages) onto the ordinal
  // page numbers shown in the reader ("Page N/M"), in cumulative order.
  function getPrayerPageRanges() {
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const ranges = {};
    let cursor = 1;
    order.forEach(prayerId => {
      const count = state.wirdPagePlan[prayerId] || 0;
      const start = cursor;
      const end = cursor + count - 1;
      ranges[prayerId] = { start, end };
      cursor = end + 1;
    });
    return ranges;
  }

  // Auto-completes prayer checkboxes once every page in their range has genuinely been read.
  function autoCompletePrayersFromReadPages() {
    const readSet = state.readPages[state.selectedJuz] || {};
    const ranges = getPrayerPageRanges();
    let anyChanged = false;

    Object.keys(ranges).forEach(prayerId => {
      if (state.prayersCompleted[prayerId]) return;
      const { start, end } = ranges[prayerId];
      if (end < start) return;
      for (let p = start; p <= end; p++) {
        if (!readSet[p]) return;
      }
      state.prayersCompleted[prayerId] = true;
      anyChanged = true;
      const card = document.querySelector(`.prayer-card[data-prayer="${prayerId}"]`);
      if (card) {
        card.classList.add('completed');
        createConfetti(card);
      }
    });

    if (anyChanged) {
      updateProgress();
      showToast("Wird mis à jour 📖", "Prière validée automatiquement grâce à votre lecture.");
    }
  }

  // Calculate Wird progress
  function updateProgress(prayerCheckedName = null) {
    const totalPrayers = Object.keys(state.prayersCompleted).length;
    const completedCount = Object.values(state.prayersCompleted).filter(Boolean).length;
    const percentage = Math.round((completedCount / totalPrayers) * 100);
    
    let pagesCompleted = 0;
    Object.keys(state.prayersCompleted).forEach(pr => {
      if (state.prayersCompleted[pr]) {
        pagesCompleted += state.wirdPagePlan[pr];
      }
    });

    localStorage.setItem('wird_prayers_completed', JSON.stringify(state.prayersCompleted));

    const dashOffset = 251.2 - (251.2 * percentage) / 100;
    progressBar.style.strokeDashoffset = dashOffset;
    
    progressText.textContent = `${percentage}%`;
    if (progressPercentText) progressPercentText.textContent = `${percentage}%`;
    if (progressPagesText) progressPagesText.textContent = `${pagesCompleted}/20 pages`;

    updateGarden(state.prayersCompleted);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    state.consistencyHistory[todayStr] = getTodayCompletionLevel();
    localStorage.setItem('wird_consistency_history', JSON.stringify(state.consistencyHistory));
    renderHeatmap();

    // Toggle Celebration layouts
    if (completedCount === totalPrayers) {
      if (celebrationCard) celebrationCard.style.display = 'flex';
      if (resumeReadingCard) resumeReadingCard.style.display = 'none';
      if (startWirdContainer) startWirdContainer.style.display = 'none';
      
      createConfetti(progressBar);
      showToast("Macha Allah ! 🏆", "Vous avez complété votre Wird du jour.");
    } else {
      if (celebrationCard) celebrationCard.style.display = 'none';
      if (state.lastViewedVerseNum && state.lastViewedJuz) {
        if (resumeReadingCard) resumeReadingCard.style.display = 'flex';
        if (startWirdContainer) startWirdContainer.style.display = 'none';
      } else {
        if (resumeReadingCard) resumeReadingCard.style.display = 'none';
        if (startWirdContainer) startWirdContainer.style.display = 'block';
      }
    }

    if (prayerCheckedName) {
      setTimeout(() => {
        const friends = ['Sarah', 'Karim', 'Amine'];
        const randomFriend = friends[Math.floor(Math.random() * friends.length)];
        const messages = [
          `a encouragé votre lecture après la prière de ${prayerCheckedName} ! ✨`,
          `a aimé votre progression du Wird ! 💚`,
          `vous envoie des Douas pour votre constance ! 🤲`
        ];
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        showToast(randomFriend, randomMessage);
      }, 3500);
    }
  }

  prayerCards.forEach(card => {
    const prayerId = card.dataset.prayer;
    const prayerName = card.querySelector('.prayer-name').textContent;
    
    if (state.prayersCompleted[prayerId]) {
      card.classList.add('completed');
    }

    card.addEventListener('click', () => {
      state.prayersCompleted[prayerId] = !state.prayersCompleted[prayerId];
      if (state.prayersCompleted[prayerId]) {
        card.classList.add('completed');
        createConfetti(card);
        updateProgress(prayerName);
      } else {
        card.classList.remove('completed');
        updateProgress();
      }
    });
  });

  function updateGarden(prayers) {
    const elements = {
      fajr: { branch: 'garden-branch-1', flower: 'garden-flower-1' },
      dhuhr: { branch: 'garden-branch-2', flower: 'garden-flower-2' },
      asr: { branch: 'garden-branch-3', flower: 'garden-flower-3' },
      maghrib: { branch: 'garden-branch-4', flower: 'garden-flower-4' },
      isha: { branch: 'garden-branch-5', flower: 'garden-flower-5' }
    };

    Object.keys(prayers).forEach(prayer => {
      const isDone = prayers[prayer];
      const ids = elements[prayer];
      const branchEl = document.getElementById(ids.branch);
      const flowerEl = document.getElementById(ids.flower);
      
      if (branchEl) {
        if (isDone) {
          branchEl.classList.add('grown');
          setTimeout(() => {
            if (flowerEl) flowerEl.classList.add('bloom');
          }, 400);
        } else {
          if (flowerEl) flowerEl.classList.remove('bloom');
          branchEl.classList.remove('grown');
        }
      }
    });
  }

  function createConfetti(element) {
    const rect = element.getBoundingClientRect();
    const parent = document.getElementById('app-container');
    const containerRect = parent.getBoundingClientRect();
    const x = rect.left - containerRect.left + rect.width / 2;
    const y = rect.top - containerRect.top + rect.height / 2;

    for (let i = 0; i < 12; i++) {
      const dot = document.createElement('div');
      dot.className = 'confetti-dot';
      dot.style.position = 'absolute';
      dot.style.width = '6px';
      dot.style.height = '6px';
      dot.style.borderRadius = '50%';
      
      const colors = ['#D4AF37', '#10B981', '#F59E0B', '#3B82F6', '#EC4899'];
      dot.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.style.pointerEvents = 'none';
      dot.style.zIndex = '99';
      parent.appendChild(dot);

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 4;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 2;

      let px = x;
      let py = y;
      let alpha = 1;
      
      const anim = () => {
        px += vx;
        py += vy + 0.15;
        alpha -= 0.03;
        dot.style.left = `${px}px`;
        dot.style.top = `${py}px`;
        dot.style.opacity = alpha;
        
        if (alpha > 0) {
          requestAnimationFrame(anim);
        } else {
          dot.remove();
        }
      };
      requestAnimationFrame(anim);
    }
  }

  function setReaderMode(mode) {
    state.readerMode = mode;
    if (mode !== 'read') cancelPageDwellTracking();
    const readBtn = document.getElementById('switch-read');
    const memoBtn = document.getElementById('switch-memorize');

    if (readBtn && memoBtn) {
      if (mode === 'memorize') {
        readBtn.classList.remove('active');
        memoBtn.classList.add('active');
      } else {
        readBtn.classList.add('active');
        memoBtn.classList.remove('active');
      }
    }

    // Lecture mode's dense Mushaf page doesn't render inline translation/
    // phonetic text, so these toggles have nothing to control there.
    const displayTogglesCard = document.getElementById('display-toggles-card');
    if (displayTogglesCard) {
      displayTogglesCard.style.display = mode === 'memorize' ? 'flex' : 'none';
    }

    if (mode === 'memorize') updateHifzGamificationUI();
  }

  const readBtn = document.getElementById('switch-read');
  const memoBtn = document.getElementById('switch-memorize');
  
  if (readBtn) {
    readBtn.addEventListener('click', () => { 
      setReaderMode('read'); 
      hifzToolbar.style.display = 'none';
      renderQuranText(); 
    });
  }
  if (memoBtn) {
    memoBtn.addEventListener('click', () => { 
      setReaderMode('memorize'); 
      hifzToolbar.style.display = 'flex';
      renderQuranText(); 
    });
  }

  // Dashboard SRS Card Update
  function updateSRSDashboardCard() {
    if (!srsRevisionsCard || !srsRevisionsCountText) return;

    const now = Date.now();
    let dueCount = 0;

    Object.values(state.srsDatabase).forEach(item => {
      if (item.nextReviewDate <= now) {
        dueCount++;
      }
    });

    if (dueCount > 0) {
      srsRevisionsCard.style.display = 'block';
      srsRevisionsCountText.textContent = `Vous avez ${dueCount} verset(s) à réviser aujourd'hui.`;
    } else {
      srsRevisionsCard.style.display = 'none';
    }

    updateHifzDueSummary();
  }

  // Toast Notification Generator
  function showToast(title, text) {
    const container = (typeof toastContainer !== 'undefined' && toastContainer) ? toastContainer : document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'push-toast';
    
    toast.innerHTML = `
      <div class="push-toast-icon">✨</div>
      <div class="push-toast-body">
        <div class="push-toast-title">${title}</div>
        <div class="push-toast-text">${text}</div>
      </div>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  // User posts status update
  function postStatusToCircle() {
    if (!inputCirclePost || !circleActivityList) return;
    
    const val = inputCirclePost.value.trim();
    if (!val) return;

    const card = document.createElement('div');
    card.className = 'activity-card';
    card.style.animation = 'fadeIn 0.4s ease-out forwards';
    card.style.borderLeft = '2px solid var(--primary)';
    card.style.paddingLeft = '8px';
    
    card.innerHTML = `
      <div class="user-avatar" style="background-color: var(--primary); color: #070913; font-weight:700;">Moi</div>
      <div class="activity-details">
        <div class="activity-user-row">
          <span class="activity-username">Vous</span>
          <span class="activity-time">À l'instant</span>
        </div>
        <p class="activity-text">${val}</p>
        <div class="activity-actions">
          <span style="font-size: 0.6875rem; color: var(--text-muted);">Publié dans votre Halaqah</span>
        </div>
      </div>
    `;

    circleActivityList.insertBefore(card, circleActivityList.firstChild);
    inputCirclePost.value = '';

    setTimeout(() => {
      const friends = ['Sarah', 'Amine', 'Karim'];
      const randomFriend = friends[Math.floor(Math.random() * friends.length)];
      showToast(randomFriend, `a encouragé votre publication dans le Cercle ! 🤝`);
      
      const countLabel = document.createElement('span');
      countLabel.textContent = ` • 1 encouragement (${randomFriend})`;
      countLabel.style.color = 'var(--primary)';
      card.querySelector('.activity-actions').appendChild(countLabel);
    }, 4500);
  }

  // Simulate real-time background events
  function startSimulatedBackgroundNetwork() {
    const friendActivities = [
      { name: 'Sarah', avatarClass: 'avatar-1', text: 'vient de terminer la mémorisation de la Sourate An-Naba, versets 1 à 10 ! 📖' },
      { name: 'Amine', avatarClass: 'avatar-3', text: 'a validé son segment de l\'Asr (Juz 30, pages 9-12). Plus que 2 segments ! ☀️' },
      { name: 'Karim', avatarClass: 'avatar-2', text: 'a révisé 8 versets difficiles avec l\'algorithme SRS. Cap sur la constance ! 🎯' },
      { name: 'Sarah', avatarClass: 'avatar-1', text: 'a allumé 4 fleurs dans son Jardin Spirituel aujourd\'hui ! 🌸' }
    ];

    setInterval(() => {
      const randomAct = friendActivities[Math.floor(Math.random() * friendActivities.length)];
      
      if (circleActivityList) {
        const card = document.createElement('div');
        card.className = 'activity-card';
        card.style.animation = 'fadeIn 0.4s ease-out forwards';
        
        card.innerHTML = `
          <div class="user-avatar ${randomAct.avatarClass}">${randomAct.name[0]}</div>
          <div class="activity-details">
            <div class="activity-user-row">
              <span class="activity-username">${randomAct.name}</span>
              <span class="activity-time">À l'instant</span>
            </div>
            <p class="activity-text">${randomAct.text}</p>
            <div class="activity-actions">
              <button class="btn-action-small btn-encourage" data-idx="new-${Date.now()}">
                <svg style="width:14px;height:14px;fill:currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                Encourager
              </button>
            </div>
          </div>
        `;
        
        circleActivityList.insertBefore(card, circleActivityList.firstChild);
        
        card.querySelector('.btn-encourage').addEventListener('click', (e) => {
          const btn = e.currentTarget;
          btn.classList.toggle('encouraged');
          if (btn.classList.contains('encouraged')) {
            btn.innerHTML = 'Encouragé !';
            createConfetti(btn);
          } else {
            btn.innerHTML = 'Encourager';
          }
        });
      }

      showToast(randomAct.name, randomAct.text);

    }, 35000); 
  }

  // Font Size
  // state.arabicFontSize is a plain px value; the responsive engine (inline
  // script in index.html <head>) scales the whole app uniformly via CSS
  // `zoom` on #app-container, so this doesn't need to account for screen
  // size itself — zoom scales it along with everything else automatically.
  const btnFontDec = document.getElementById('btn-font-dec');
  const btnFontInc = document.getElementById('btn-font-inc');

  if (btnFontDec) {
    btnFontDec.addEventListener('click', () => {
      if (state.arabicFontSize > 18) {
        state.arabicFontSize -= 2;
        document.querySelectorAll('.verse-text-ar').forEach(el => {
          el.style.fontSize = `${state.arabicFontSize}px`;
        });
      }
    });
  }

  if (btnFontInc) {
    btnFontInc.addEventListener('click', () => {
      if (state.arabicFontSize < 40) {
        state.arabicFontSize += 2;
        document.querySelectorAll('.verse-text-ar').forEach(el => {
          el.style.fontSize = `${state.arabicFontSize}px`;
        });
      }
    });
  }

  // Tafsir & Asbab an-Nuzul Drawer
  const tafsirDrawer = document.getElementById('tafsir-drawer');
  const closeDrawerBtn = document.getElementById('close-drawer');
  const tafsirVerseRef = document.getElementById('tafsir-verse-ref');
  const tafsirTextAr = document.getElementById('tafsir-text-ar');
  const tafsirTextFr = document.getElementById('tafsir-text-fr');
  const tafsirExp = document.getElementById('tafsir-exp');
  const tafsirLesson = document.getElementById('tafsir-lesson');
  const tafsirNuzul = document.getElementById('tafsir-nuzul');

  function openTafsirDrawer(globalNum) {
    if (!state.juzData) return;

    let targetVerse = null;
    let targetSurah = null;
    
    for (const surah of state.juzData.surahs) {
      targetVerse = surah.verses.find(v => v.number === globalNum);
      if (targetVerse) {
        targetSurah = surah;
        break;
      }
    }

    if (!targetVerse) return;

    const fallbackVerse = window.quranData.verses.find(v => v.number === targetVerse.numberInSurah && targetSurah.number === 78);
    
    tafsirVerseRef.textContent = `${targetSurah.number}:${targetVerse.numberInSurah}`;
    tafsirTextAr.textContent = targetVerse.textAr;
    tafsirTextFr.textContent = targetVerse.translation;
    
    // Historical Asbab an-Nuzul mappings for Juz 30 surahs
    const asbabNuzulDict = {
      "78_1": "Révélé à la Mecque à la suite de l'appel du Prophète (PBSL). Les notables Quraychites commencèrent à se réunir et à contester la réalité de la Résurrection.",
      "78_2": "Cette grande nouvelle désigne l'annonce du Jour Dernier et le Jugement, dont les Quraychites niaient la véracité physique.",
      "78_3": "Le doute et la divergence régnaient parmi les mecquois : certains considéraient l'au-delà comme de la poésie, d'autres comme de la sorcellerie.",
      "78_6": "Révélé suite aux demandes moqueuses des incrédules Quraychites qui réclamaient des preuves matérielles immédiates du pouvoir divin.",
      "78_17": "Définit le décret final : le Jour du Jugement est un terme déjà fixé par Dieu, dont l'époque exacte est gardée secrète.",
      "78_31": "Ancré pour encourager les premiers croyants opprimés de la Mecque en leur promettant un salut éclatant et éternel.",
      "80": "Révélé au sujet d'Abdullah ibn Umm Maktum (compagnon aveugle) venu auprès du Prophète (PBSL) pendant qu'il s'adressait aux notables de Quraych.",
      "93": "Révélé après une interruption temporaire de la Révélation lorsque les idolâtres raillaient le Prophète en disant 'Son Seigneur l'a abandonné'.",
      "94": "Proclamé pour réconforter le Prophète (PBSL) et lui promettre que l'aisance accompagnera toujours la difficulté.",
      "96": "Consacre la toute première Révélation du Coran descendue sur le Prophète (PBSL) dans la grotte de Hira par l'ange Jibril (Gabriel).",
      "97": "Révélé après la mention d'un homme pieux ayant adoré Dieu 1000 mois; Dieu a offert cette Nuit bénie supérieure à toute une vie d'adoration.",
      "108": "Révélé en réponse aux moqueries d'Al-As ibn Wa'il qualifiant le Prophète d'Abtar (sans descendance) à la mort de son jeune fils.",
      "112": "Révélé lorsque les chefs bédouins et notables demandèrent au Prophète : 'Décris-nous la lignée et les caractéristiques de ton Seigneur'.",
      "113": "Descendu conjointement avec la Sourate An-Nas pour protéger et délivrer le Prophète (PBSL) du sortilège pratiqué par Labid ibn al-A'sam.",
      "114": "Deuxième sourate protectrice (Al-Mu'awwidhatayn) révélée pour chercher refuge auprès du Maître des hommes contre le chuchoteur furtif."
    };

    let vNumInSurah = targetVerse.numberInSurah;
    let sNum = targetSurah.number;
    
    const specificKey = `${sNum}_${vNumInSurah}`;
    const surahKey = `${sNum}`;
    
    if (tafsirNuzul) {
      if (asbabNuzulDict[specificKey]) {
        tafsirNuzul.textContent = asbabNuzulDict[specificKey];
      } else if (asbabNuzulDict[surahKey]) {
        tafsirNuzul.textContent = asbabNuzulDict[surahKey];
      } else {
        tafsirNuzul.textContent = `Verset révélé à la Mecque pour consolider la certitude des croyants et renouveler la foi à travers l'observation des signes de la création divine (Sourate ${targetSurah.nameFr}).`;
      }
    }

    if (fallbackVerse) {
      tafsirExp.textContent = fallbackVerse.tafsir;
      tafsirLesson.textContent = fallbackVerse.keyLesson;
    } else {
      tafsirExp.textContent = `Ce verset fait partie de la Sourate ${targetSurah.nameFr} (Juz ${state.selectedJuz}). Il témoigne de la grandeur et des signes de la création divine et rappelle notre retour vers le Créateur.`;
      tafsirLesson.textContent = `Méditer sur les leçons de la Sourate ${targetSurah.nameFr} et renouveler notre intention d'application pratique.`;
    }

    tafsirDrawer.classList.add('open');
    drawerOverlay.classList.add('active');
  }

  function closeTafsirDrawer() {
    tafsirDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
  }

  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeTafsirDrawer);

  // Social Actions static bindings
  const actionEncourageBtns = document.querySelectorAll('.btn-encourage');
  actionEncourageBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      if (state.encouragedActivities.has(idx)) {
        state.encouragedActivities.delete(idx);
        btn.classList.remove('encouraged');
        btn.innerHTML = `
          <svg style="width:14px;height:14px;fill:currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          Encourager
        `;
      } else {
        state.encouragedActivities.add(idx);
        btn.classList.add('encouraged');
        btn.innerHTML = `
          <svg style="width:14px;height:14px;fill:currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          Encouragé !
        `;
        createConfetti(btn);
      }
    });
  });

  const btnMeditateKey = document.getElementById('btn-meditate-key');
  if (btnMeditateKey) {
    btnMeditateKey.addEventListener('click', async () => {
      if (!state.juzData) {
        await loadJuzData();
      }
      if (state.juzData && state.juzData.surahs.length > 0) {
        const firstVerse = state.juzData.surahs[0].verses[0];
        openTafsirDrawer(firstVerse.number);
      }
    });
  }

  const btnStartWird = document.getElementById('btn-start-wird');
  if (btnStartWird) {
    btnStartWird.addEventListener('click', () => {
      switchView('reader');
    });
  }

  // Update layout and details for resume reading position helper
  function updateResumeReadingCard(verse, surah) {
    if (!resumeReadingCard || !resumeReadingRef || !resumeReadingDetail) return;
    
    // Save page representation
    const pageNumIndex = state.pagesList.indexOf(verse.page || 582) + 1;
    resumeReadingRef.textContent = `Juz ${state.selectedJuz} • ${surah.nameFr}`;
    resumeReadingDetail.textContent = `Page ${pageNumIndex} (Coran P. ${verse.page || 582}) • Verset ${verse.numberInSurah}`;
    
    const isCompleted = Object.values(state.prayersCompleted).filter(Boolean).length === 5;
    if (isCompleted) {
      resumeReadingCard.style.display = 'none';
      if (startWirdContainer) startWirdContainer.style.display = 'none';
    } else {
      resumeReadingCard.style.display = 'flex';
      if (startWirdContainer) startWirdContainer.style.display = 'none';
    }
  }

  // Load initial resume position card on launch
  function checkInitialReadingPosition() {
    if (state.lastViewedVerseNum && state.lastViewedJuz) {
      const isCompleted = Object.values(state.prayersCompleted).filter(Boolean).length === 5;
      if (!isCompleted) {
        resumeReadingCard.style.display = 'flex';
        if (startWirdContainer) startWirdContainer.style.display = 'none';
        
        resumeReadingRef.textContent = `Juz ${state.lastViewedJuz} • Chargement...`;
        resumeReadingDetail.textContent = `Chargement de la page...`;

        window.QuranAPI.fetchJuz(state.lastViewedJuz, state.selectedReciter).then(data => {
          let vObj = null;
          let sObj = null;
          for (const s of data.surahs) {
            vObj = s.verses.find(v => v.number === state.lastViewedVerseNum);
            if (vObj) {
              sObj = s;
              break;
            }
          }
          
          // Apply sequential mapping if offline fallback 30
          if (state.lastViewedJuz === 30 && data.surahs[0].verses.length > 0 && !data.surahs[0].verses[0].page) {
            let sequentialVersesCount = 0;
            data.surahs.forEach(s => {
              s.verses.forEach(ve => {
                ve.page = 582 + Math.floor(sequentialVersesCount / 10);
                sequentialVersesCount++;
              });
            });
          }

          if (vObj && sObj) {
            const pages = [...new Set(data.surahs.flatMap(s => s.verses.map(ve => ve.page || 582)))].sort((a, b) => a - b);
            const pIdx = pages.indexOf(vObj.page || 582) + 1;
            resumeReadingRef.textContent = `Juz ${state.lastViewedJuz} • ${sObj.nameFr}`;
            resumeReadingDetail.textContent = `Page ${pIdx} (Coran P. ${vObj.page || 582}) • Verset ${vObj.numberInSurah}`;
          }
        }).catch(err => {
          console.warn("Failed to retrieve resume detail dynamically", err);
          resumeReadingRef.textContent = `Juz ${state.lastViewedJuz} • Reprendre`;
          resumeReadingDetail.textContent = `Cliquez pour continuer`;
        });
      }
    }
  }

  // ==================== SETTINGS: THEME & PALETTE ====================
  const settingsDrawer = document.getElementById('settings-drawer');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const settingsClose = document.getElementById('settings-close');
  const btnThemeLight = document.getElementById('btn-theme-light');
  const btnThemeDark = document.getElementById('btn-theme-dark');
  const btnThemeSepia = document.getElementById('btn-theme-sepia');
  const paletteSwatches = document.querySelectorAll('.palette-swatch');

  state.theme = localStorage.getItem('wird_theme') || 'dark';
  state.palette = localStorage.getItem('wird_palette') || 'gold';

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.setAttribute('data-palette', state.palette);
    localStorage.setItem('wird_theme', state.theme);
    localStorage.setItem('wird_palette', state.palette);

    if (btnThemeLight) btnThemeLight.classList.toggle('active', state.theme === 'light');
    if (btnThemeDark) btnThemeDark.classList.toggle('active', state.theme === 'dark');
    if (btnThemeSepia) btnThemeSepia.classList.toggle('active', state.theme === 'sepia');

    paletteSwatches.forEach(sw => {
      sw.classList.toggle('active', sw.dataset.palette === state.palette);
    });

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', state.theme === 'light' ? '#f2efe9' : state.theme === 'sepia' ? '#E8DACB' : '#070913');
  }

  function openSettingsDrawer() {
    if (settingsDrawer && drawerOverlay) {
      settingsDrawer.classList.add('open');
      drawerOverlay.classList.add('active');
    }
  }
  function closeSettingsDrawer() {
    if (settingsDrawer && drawerOverlay) {
      settingsDrawer.classList.remove('open');
      drawerOverlay.classList.remove('active');
    }
  }

  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettingsDrawer);
  if (settingsClose) settingsClose.addEventListener('click', closeSettingsDrawer);
  
  if (btnThemeLight) btnThemeLight.addEventListener('click', () => { state.theme = 'light'; applyTheme(); showToast("Mode Clair ☀️", "Thème lumineux appliqué."); });
  if (btnThemeDark) btnThemeDark.addEventListener('click', () => { state.theme = 'dark'; applyTheme(); showToast("Mode Sombre 🌙", "Thème sombre appliqué."); });
  if (btnThemeSepia) btnThemeSepia.addEventListener('click', () => { state.theme = 'sepia'; applyTheme(); showToast("Mode Parchemin 📜", "Thème manuscrit doux appliqué."); });
  
  paletteSwatches.forEach(sw => {
    sw.addEventListener('click', () => { 
      state.palette = sw.dataset.palette; 
      applyTheme(); 
      const paletteNames = { gold: 'Or', emerald: 'Émeraude', sapphire: 'Saphir', rose: 'Rose', violet: 'Violet', amber: 'Ambre' };
      showToast("Couleur d'accentuation 🎨", `Palette ${paletteNames[state.palette] || state.palette} appliquée.`);
    });
  });

  applyTheme();

  if (drawerOverlay) {
    drawerOverlay.addEventListener('click', closeSettingsDrawer);
  }

  // Initialize UI & load data
  initSelectors();
  calculateWirdPlanTotal();
  refreshPrayerCardPages();
  initHeatmapHistory();

  // Bind navigation click listeners to bottom nav buttons
  if (navItems && navItems.length > 0) {
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        switchView(item.dataset.view);
      });
    });
    console.log(`[System] Successfully bound click listeners to ${navItems.length} nav items.`);
  } else {
    console.error("[System] No navigation items found with class .nav-item!");
  }
  
  // Re-fit the current Lecture-mode page when the viewport or the app's
  // responsive text-scale changes (rotation, resizing, unfolding mid-read).
  let fitResizeTimeout = null;
  function scheduleReaderRefit() {
    if (state.currentView !== 'reader' || state.readerMode !== 'read') return;
    if (fitResizeTimeout) clearTimeout(fitResizeTimeout);
    fitResizeTimeout = setTimeout(() => {
      fitResizeTimeout = null;
      renderQuranText(true);
    }, 200);
  }
  window.addEventListener('resize', scheduleReaderRefit);
  window.addEventListener('wird:scalechange', scheduleReaderRefit);

  // Default launch
  switchView('dashboard');
  checkInitialReadingPosition();
});
