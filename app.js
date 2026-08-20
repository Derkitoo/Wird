document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for Offline / PWA Support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker inscrit avec succès. Scope :', reg.scope))
      .catch(err => console.error('[PWA] Échec d\'inscription du Service Worker :', err));

    // sw.js calls skipWaiting()/clients.claim() so a new version takes over
    // as soon as it installs — but a tab that was already open keeps
    // running the OLD cached JS/CSS until it reloads, since the swap only
    // affects future network requests, not what's already executing. This
    // reloads automatically the moment a new service worker takes control,
    // so an update is never silently "invisible" until the next manual
    // refresh (this is exactly why some changes can appear to not show up
    // on a device that already had the app open).
    let hasReloadedForNewSW = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloadedForNewSW) return;
      hasReloadedForNewSW = true;
      window.location.reload();
    });
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
    // The Atelier Mémorisation has its own Juz selection, independent of the
    // Reader's — so browsing Juz X to practice memorization never disturbs
    // what the Reader/Wird plan currently has loaded.
    hifzSelectedJuz: 30,
    hifzJuzData: null,
    // Which step of the flashcard's Découvrir/S'entraîner/Tester cycle is
    // currently shown — transient, reset every time a card opens.
    hifzCardPhase: 'discover',
    // Audio State
    currentPlayingVerseNum: null, // Global verse number (1-6236)
    audioLoopRepetitions: '1', // '1', '3', '5', 'infinite'
    audioPlayCount: 1,
    readerMode: 'read', // 'read' or 'memorize' (used in Reader view only)
    missedWirdJuz: null, // Juz number left incomplete on a previous day, or null
    khatmGoal: null, // { multiplier, days, startDate, juzCompleted } or null
    totalPagesReadAllTime: 0, // cumulative, never resets (unlike readPages)
    totalJuzCompleted: 0, // cumulative "Juz Suivant" advances, all-time
    kidMode: false, // bigger/more playful presentation in the memorization workshop
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

  // SRS Dashboard card
  const srsRevisionsCard = document.getElementById('srs-revisions-card');
  const srsRevisionsCountText = document.getElementById('srs-revisions-count');
  const btnStartRevision = document.getElementById('btn-start-revision');

  // Social Halaqah circle elements
  const inputCirclePost = document.getElementById('input-circle-post');
  const btnCirclePost = document.getElementById('btn-circle-post');
  const circleActivityList = document.querySelector('.circle-activity-list');
  const toastContainer = document.getElementById('toast-container');

  // Hifz Refactored Workshop elements (view-memorize)
  const hifzJuzSelect = document.getElementById('hifz-juz-select');
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

  // Hifz Flashcard phase-cycle elements (Découvrir / S'entraîner / Tester)
  const hifzPhaseDots = document.querySelectorAll('.hifz-phase-dot');
  const hifzAudioRow = document.getElementById('hifz-audio-row');
  const hifzCardAudio = document.getElementById('hifz-card-audio');
  const hifzAudioPlayBtn = document.getElementById('hifz-audio-play-btn');
  const hifzAudioUnavailableNote = document.getElementById('hifz-audio-unavailable-note');
  const hifzHintsToggleRow = document.getElementById('hifz-card-hints-toggle-row');
  const hifzHintsToggleBtn = document.getElementById('hifz-hints-toggle-btn');
  const hifzCardHintsBlock = document.getElementById('hifz-card-hints-block');
  const hifzMaskToggleRow = document.getElementById('hifz-mask-toggle-row');
  const hifzMaskToggleBtn = document.getElementById('hifz-mask-toggle-btn');
  const hifzBtnDiscoverContinue = document.getElementById('hifz-btn-discover-continue');
  const hifzBtnPracticeReady = document.getElementById('hifz-btn-practice-ready');
  const hifzBtnSkipToTest = document.getElementById('hifz-btn-skip-to-test');
  const hifzPhaseTestControls = document.getElementById('hifz-phase-test-controls');
  const hifzPhaseAdvanceRow = document.getElementById('hifz-phase-advance-row');
  
  const drawerOverlay = document.getElementById('drawer-overlay');

  // New features DOM Elements
  const btnToggleDashboardSecondary = document.getElementById('btn-toggle-dashboard-secondary');
  const dashboardSecondarySection = document.getElementById('dashboard-secondary-section');
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


  const heatmapGrid = document.getElementById('heatmap-grid');

  // Celebration & Resume elements
  const celebrationCard = document.getElementById('celebration-card');
  const btnNextJuzTrigger = document.getElementById('btn-next-juz-trigger');
  const resumeReadingCard = document.getElementById('resume-reading-card');
  const resumeReadingRef = document.getElementById('resume-reading-ref');
  const resumeReadingDetail = document.getElementById('resume-reading-detail');
  const btnResumeReading = document.getElementById('btn-resume-reading');
  const startWirdContainer = document.getElementById('start-wird-container');
  const missedWirdCard = document.getElementById('missed-wird-card');
  const missedWirdRef = document.getElementById('missed-wird-ref');
  const btnMissedWirdResume = document.getElementById('btn-missed-wird-resume');
  const btnMissedWirdDismiss = document.getElementById('btn-missed-wird-dismiss');

  // Khatm goal DOM elements
  const khatmGoalEmpty = document.getElementById('khatm-goal-empty');
  const khatmGoalActive = document.getElementById('khatm-goal-active');
  const khatmGoalMultiplierSelect = document.getElementById('khatm-goal-multiplier');
  const khatmGoalDaysInput = document.getElementById('khatm-goal-days');
  const btnKhatmGoalSet = document.getElementById('btn-khatm-goal-set');
  const btnKhatmGoalCancel = document.getElementById('btn-khatm-goal-cancel');
  const khatmGoalLabel = document.getElementById('khatm-goal-label');
  const khatmGoalProgressBar = document.getElementById('khatm-goal-progress-bar');
  const khatmGoalDetail = document.getElementById('khatm-goal-detail');

  // Dashboard statistics grid
  const dashboardStatsGrid = document.getElementById('dashboard-stats-grid');
  const dashboardStatValues = {
    streak: document.getElementById('stat-streak-value'),
    bestStreak: document.getElementById('stat-best-streak-value'),
    pages: document.getElementById('stat-pages-value'),
    juz: document.getElementById('stat-juz-value'),
    activeDays: document.getElementById('stat-active-days-value'),
    avgPerDay: document.getElementById('stat-avg-value')
  };

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
  state.hifzSelectedJuz = state.selectedJuz;

  try {
    const savedHifzJuz = localStorage.getItem('wird_hifz_selected_juz');
    if (savedHifzJuz) state.hifzSelectedJuz = parseInt(savedHifzJuz, 10);
  } catch (err) {
    console.warn("Failed to parse wird_hifz_selected_juz", err);
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
    const savedKhatmGoal = localStorage.getItem('wird_khatm_goal');
    if (savedKhatmGoal) state.khatmGoal = JSON.parse(savedKhatmGoal);
  } catch (err) {
    console.warn("Failed to parse wird_khatm_goal", err);
  }

  state.totalPagesReadAllTime = parseInt(localStorage.getItem('wird_total_pages_alltime'), 10) || 0;
  state.totalJuzCompleted = parseInt(localStorage.getItem('wird_total_juz_completed'), 10) || 0;

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
    // If yesterday's Wird wasn't fully checked off, remember which Juz it
    // was so the dashboard can offer to pick it back up — persisted (not
    // just in-memory) so it survives reloads until the user dismisses or
    // resumes it, since this reset block only runs once per day boundary.
    const wasComplete = Object.values(state.prayersCompleted).filter(Boolean).length === 5;
    if (!wasComplete) {
      localStorage.setItem('wird_missed_reminder_juz', String(state.selectedJuz));
    }

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

    if (wasComplete) {
      showToast("Nouveau jour 🌅", "Votre Wird quotidien a été réinitialisé pour aujourd'hui.");
    } else {
      showToast("Wird non terminé ⚠️", `Le Wird du Juz ${state.selectedJuz} n'était pas fini hier — vous pouvez le reprendre.`);
    }
  }
  localStorage.setItem('wird_last_active_date', todayDateStr);

  const missedReminderJuzRaw = localStorage.getItem('wird_missed_reminder_juz');
  if (missedReminderJuzRaw) state.missedWirdJuz = parseInt(missedReminderJuzRaw, 10);

  // Initialize selectors & views
  function initSelectors() {

    // SRS dashboard/workshop "start review session" buttons — both just
    // kick off the same guided, cross-Juz review queue.
    if (btnStartRevision) btnStartRevision.addEventListener('click', startReviewSession);
    if (btnHifzStartSession) btnHifzStartSession.addEventListener('click', startReviewSession);

    // Atelier's own Juz picker — deliberately separate from the Reader's
    // selectedJuz (see state.hifzSelectedJuz).
    if (hifzJuzSelect) {
      hifzJuzSelect.addEventListener('change', (e) => {
        state.hifzSelectedJuz = parseInt(e.target.value, 10);
        localStorage.setItem('wird_hifz_selected_juz', state.hifzSelectedJuz);
        loadHifzDashboard();
      });
    }

    // Social post button binding
    if (btnCirclePost && inputCirclePost) {
      btnCirclePost.addEventListener('click', postStatusToCircle);
      inputCirclePost.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') postStatusToCircle();
      });
    }

    // Hifz Flashcard Bindings
    if (hifzCardClose) hifzCardClose.addEventListener('click', closeHifzFlashcard);
    if (hifzCardMicBtn) hifzCardMicBtn.addEventListener('click', startHifzVoiceRecording);

    // Phase-cycle bindings (Découvrir → S'entraîner → Tester)
    if (hifzBtnDiscoverContinue) {
      hifzBtnDiscoverContinue.addEventListener('click', () => {
        state.hifzCardPhase = 'practice';
        renderHifzCardPhase();
      });
    }
    if (hifzBtnPracticeReady || hifzBtnSkipToTest) {
      [hifzBtnPracticeReady, hifzBtnSkipToTest].forEach(btn => {
        if (!btn) return;
        btn.addEventListener('click', () => {
          state.hifzCardPhase = 'test';
          renderHifzCardPhase();
        });
      });
    }
    if (hifzHintsToggleBtn && hifzCardHintsBlock) {
      hifzHintsToggleBtn.addEventListener('click', () => {
        const isHidden = hifzCardHintsBlock.style.display === 'none';
        hifzCardHintsBlock.style.display = isHidden ? 'flex' : 'none';
        hifzHintsToggleBtn.textContent = isHidden ? '🙈 Cacher les indices' : '👁 Afficher les indices';
      });
    }
    // Bulk mask/reveal — flips every tokenized word span at once.
    if (hifzMaskToggleBtn) {
      hifzMaskToggleBtn.addEventListener('click', () => {
        const nowRevealed = hifzMaskToggleBtn.dataset.allRevealed !== 'true';
        hifzCardArabic.querySelectorAll('.hifz-masked-word').forEach(w => {
          w.classList.toggle('revealed', nowRevealed);
        });
        hifzMaskToggleBtn.dataset.allRevealed = String(nowRevealed);
        const label = hifzMaskToggleBtn.querySelector('span');
        if (label) label.textContent = nowRevealed ? 'Révéler tout' : 'Masquer tout';
      });
    }
    // Delegated: individual masked-word taps, rebuilt fresh on every phase render.
    if (hifzCardArabic) {
      hifzCardArabic.addEventListener('click', (e) => {
        if (e.target.classList.contains('hifz-masked-word')) {
          e.target.classList.toggle('revealed');
        }
      });
    }
    if (hifzAudioPlayBtn && hifzCardAudio) {
      hifzAudioPlayBtn.addEventListener('click', () => {
        if (hifzCardAudio.paused) {
          hifzCardAudio.play().catch(() => {});
        } else {
          hifzCardAudio.pause();
        }
      });
      hifzCardAudio.addEventListener('play', () => { hifzAudioPlayBtn.textContent = '⏸ Pause'; });
      hifzCardAudio.addEventListener('pause', () => { hifzAudioPlayBtn.textContent = '▶ Écouter'; });
      hifzCardAudio.addEventListener('ended', () => { hifzAudioPlayBtn.textContent = '▶ Écouter'; });
    }

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
        closeJuzSummaryDrawer();
      });
    }

    if (btnToggleDashboardSecondary && dashboardSecondarySection) {
      btnToggleDashboardSecondary.addEventListener('click', () => {
        const isOpen = dashboardSecondarySection.style.display !== 'none';
        dashboardSecondarySection.style.display = isOpen ? 'none' : 'block';
        btnToggleDashboardSecondary.setAttribute('aria-expanded', String(!isOpen));
        btnToggleDashboardSecondary.querySelector('span').textContent = isOpen ? 'Voir plus' : 'Voir moins';
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

        if (state.khatmGoal) {
          state.khatmGoal.juzCompleted += 1;
          localStorage.setItem('wird_khatm_goal', JSON.stringify(state.khatmGoal));
          renderKhatmGoal();
        }

        state.totalJuzCompleted += 1;
        localStorage.setItem('wird_total_juz_completed', String(state.totalJuzCompleted));

        showToast("Juz Suivant ! 🏁", `Bienvenue dans le Juz ${state.selectedJuz}.`);

        updateProgress();
        switchView('reader');
      });
    }

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

  // Page-turn transition: the "out" phase (frosted-glass blur + fade) plays
  // on the *current* content, then (once it's finished, not sooner) the
  // page is actually turned — content swapped and the "in" phase applied
  // in renderQuranText(). Skips straight to the swap if the page element
  // isn't there yet to animate. Guarded by pageFlipInProgress so a rapid
  // double-tap can't queue up two overlapping transitions (each with its
  // own setTimeout) and double-advance the page.
  const PAGE_FLIP_OUT_MS = 260;
  let pageFlipInProgress = false;
  function flipPageOut(direction, onComplete) {
    if (pageFlipInProgress) return;
    const pageEl = document.getElementById('quran-page');
    if (!pageEl) { onComplete(); return; }
    pageFlipInProgress = true;
    pageEl.classList.remove('page-glass-out-next', 'page-glass-out-prev', 'page-glass-in-next', 'page-glass-in-prev');
    void pageEl.offsetWidth; // force reflow so a repeated transition restarts the animation
    pageEl.classList.add(direction === 'next' ? 'page-glass-out-next' : 'page-glass-out-prev');
    setTimeout(() => {
      pageFlipInProgress = false;
      onComplete();
    }, PAGE_FLIP_OUT_MS);
  }

  function goToPrevPage() {
    if (state.currentPageIndex <= 0) return;
    playPaperRustleSound();
    flipPageOut('prev', () => {
      state.currentPageIndex--;
      localStorage.setItem('wird_last_page', state.pagesList[state.currentPageIndex]);
      localStorage.setItem('wird_last_juz', state.selectedJuz);
      renderQuranText(true, 'prev');
    });
  }

  function goToNextPage() {
    if (!state.pagesList || state.currentPageIndex >= state.pagesList.length - 1) return;
    playPaperRustleSound();
    flipPageOut('next', () => {
      state.currentPageIndex++;
      localStorage.setItem('wird_last_page', state.pagesList[state.currentPageIndex]);
      localStorage.setItem('wird_last_juz', state.selectedJuz);
      renderQuranText(true, 'next');
    });
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

      // Hide the loader before rendering: fitReaderPageToViewport() measures
      // #quran-page's distance from the top of the viewport, and the loader
      // (spinner + padding) sitting above it while still visible pushes that
      // measurement down enough that the page misses the available space
      // entirely and skips sizing — leaving the very first page rendered at
      // its unshrunk default size until some later action re-triggers a fit.
      readerLoader.style.display = 'none';
      renderQuranText();

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
    readerLoader.style.display = 'none'; // see loadJuzData(): must hide before rendering, not after
    renderQuranText();
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
    // Measured to the nav's own top edge (not just its height) so this stays
    // correct regardless of how it's positioned — e.g. the floating pill nav
    // sits above the viewport bottom with its own margin/safe-area offset,
    // which a plain height subtraction wouldn't account for. Fall back to
    // the viewport's own bottom edge if the nav isn't actually occupying
    // space (e.g. not yet rendered).
    const navRect = bottomNav ? bottomNav.getBoundingClientRect() : null;
    const navTop = (navRect && navRect.height > 0) ? navRect.top : window.innerHeight;
    const paginationHeight = pagination ? pagination.getBoundingClientRect().height : 0;
    const available = navTop - pageRect.top - paginationHeight - 16;
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

    // A dense, continuous Mushaf-style page — just the Arabic text flowing
    // per surah, each verse closed by a small tappable ayah-end marker
    // (opens the tafsir drawer). This is the reader's only rendering mode:
    // it's what lets a whole page's worth of verses (can be 20-30+ short
    // verses on a single real Mushaf page) fit in the frame at all.
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
      verseSpan.innerHTML = `${verseText} <span class="ayah-marker" data-global-num="${v.number}">${v.numberInSurah}</span> `;
      currentFlow.appendChild(verseSpan);
    });

    setupVerseInteractions();
    updatePagePaginationUI();
    schedulePageDwellTracking(state.selectedJuz, state.currentPageIndex + 1);
    fitReaderPageToViewport();

    // Play the "in" half of the glass dissolve, matching the "out" half
    // already played by flipPageOut() before this render happened.
    pageEl.classList.remove('page-glass-out-next', 'page-glass-out-prev', 'page-glass-in-next', 'page-glass-in-prev');
    if (direction === 'next' || direction === 'prev') {
      void pageEl.offsetWidth; // force reflow so the animation restarts on repeated navigation
      pageEl.classList.add(direction === 'next' ? 'page-glass-in-next' : 'page-glass-in-prev');
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

    // Read-mode dense Mushaf page: tapping a verse's Arabic text does
    // nothing on its own. The small ayah-end marker is the only way to
    // open tafsir.
    targetParent.querySelectorAll('.ayah-marker').forEach(marker => {
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        const num = parseInt(marker.dataset.globalNum, 10);
        openTafsirDrawer(num);
        saveReadingPosition(num);
      });
    });
  }

  // Scores how closely spokenText matches the expected verse text — used by
  // the Hifz Workshop flashcard's voice check.
  function computeRecitationScore(spokenText, originalArabicText) {
    const originalWords = cleanArabicText(originalArabicText).split(' ').filter(Boolean);
    const spokenWords = cleanArabicText(spokenText).split(' ').filter(Boolean);
    let matchesCount = 0;
    originalWords.forEach(w => { if (spokenWords.includes(w)) matchesCount++; });
    const scorePct = originalWords.length > 0 ? Math.round((matchesCount / originalWords.length) * 100) : 0;
    return { scorePct, passed: scorePct >= 70 };
  }

  // Persists an SRS rating and schedules the next review date using a
  // simplified SM-2-style growing interval (not a flat 1/3/7-day bucket):
  // repeated "easy" ratings push the interval further out each time instead
  // of always landing exactly 7 days later, so a verse known for months
  // gets reviewed less often than one just barely graduated from "hard".
  function scheduleSrsReview(verseKey, rating) {
    // Defaults also cover legacy records saved before this rewrite (they
    // only ever had {nextReviewDate, difficulty, interval, timestamp}) —
    // read as a fresh-start case rather than crashing on undefined fields.
    const prev = state.srsDatabase[verseKey] || {};
    let repetitions = prev.repetitions || 0;
    let easeFactor = prev.easeFactor || 2.5;
    let interval = prev.interval || 0;

    if (rating === 'hard') {
      repetitions = 0;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      interval = 1;
    } else if (rating === 'medium') {
      repetitions += 1;
      interval = interval > 0 ? Math.round(interval * 1.3) : 3;
    } else { // 'easy'
      repetitions += 1;
      interval = interval > 0 ? Math.round(interval * easeFactor) : 7;
      easeFactor = Math.min(2.8, easeFactor + 0.1);
    }

    state.srsDatabase[verseKey] = {
      nextReviewDate: Date.now() + interval * 24 * 60 * 60 * 1000,
      difficulty: rating,
      interval,
      repetitions,
      easeFactor,
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
    const now = Date.now();
    const masteredGlobal = Object.values(state.srsDatabase).filter(r => r.difficulty === 'easy' && r.nextReviewDate > now).length;
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
    if (!state.hifzJuzData) return;
    const surah = state.hifzJuzData.surahs.find(s => s.number === surahNum);
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
    if (!container || !state.hifzJuzData) return;

    const now = Date.now();
    container.innerHTML = '';
    state.hifzJuzData.surahs.forEach(surah => {
      const total = surah.verses.length;
      let mastered = 0;
      surah.verses.forEach(v => {
        const key = `juz_${state.hifzSelectedJuz}_surah_${surah.number}_verse_${v.numberInSurah}`;
        const record = state.srsDatabase[key];
        // A verse only counts as "mastered" while its easy rating is still
        // fresh (not yet due again) — an overdue verse visually drops back
        // out until it's reviewed, even if its last rating was easy.
        if (record && record.difficulty === 'easy' && record.nextReviewDate > now) mastered++;
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
      card.addEventListener('click', () => startSurahPracticeSession(surah.number, state.hifzSelectedJuz));
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

  // Populates the Atelier's own Juz picker (1-30), independent of the
  // Reader's #select-juz — this select drives state.hifzSelectedJuz only.
  function populateHifzJuzSelect() {
    if (!hifzJuzSelect) return;
    hifzJuzSelect.innerHTML = '';
    for (let i = 1; i <= 30; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Juz ${i}`;
      if (i === state.hifzSelectedJuz) opt.selected = true;
      hifzJuzSelect.appendChild(opt);
    }
  }

  // Load and Render the visual Hifz Dashboard Grid (view-memorize)
  async function loadHifzDashboard() {
    if (!hifzSurahList || !hifzJuzSelect) return;

    renderKidMascotMessage();
    hifzJuzSelect.value = state.hifzSelectedJuz;
    hifzSurahList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 0.75rem;">Chargement du plan de révision...</div>';
    updateHifzDueSummary();
    updateHifzGamificationUI();

    try {
      state.hifzJuzData = await ensureJuzDataLoaded(state.hifzSelectedJuz);
    } catch (err) {
      console.warn("Offline fallback for Hifz grid", err);
      const fallbackSurah = window.quranData;
      state.hifzJuzData = {
        juzNumber: 30,
        surahs: [{
          number: fallbackSurah.surahNumber,
          nameAr: fallbackSurah.surahNameAr,
          nameFr: fallbackSurah.surahNameFr,
          translationName: fallbackSurah.surahTranslation,
          verses: fallbackSurah.verses.map((v, idx) => {
            v.page = 582 + Math.floor(idx / 10);
            v.numberInSurah = idx + 1;
            return v;
          })
        }]
      };
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

  // A verse with no SRS record yet has never been studied → start with the
  // full Découvrir teaching pass. Any verse that's already been rated at
  // least once (including every due-review verse, by definition) skips
  // straight to S'entraîner — no special-casing needed at the call sites.
  function determineHifzCardPhase(verseKey) {
    return state.srsDatabase[verseKey] ? 'practice' : 'discover';
  }

  // Wraps each space-separated word in a tappable .hifz-masked-word span
  // for the S'entraîner phase's progressive-recall masking.
  function tokenizeHifzArabicWords(text) {
    return text.split(' ').filter(Boolean)
      .map(w => `<span class="hifz-masked-word">${w}</span>`)
      .join(' ');
  }

  // Single source of truth for what's visible in the flashcard, driven by
  // state.hifzCardPhase. Called on open and on every phase transition.
  function renderHifzCardPhase() {
    const verse = state.activeHifzVerse;
    if (!verse) return;
    const phase = state.hifzCardPhase;

    const order = ['discover', 'practice', 'test'];
    const currentIdx = order.indexOf(phase);
    hifzPhaseDots.forEach(dot => {
      const dotIdx = order.indexOf(dot.dataset.phase);
      dot.classList.toggle('active', dotIdx === currentIdx);
      dot.classList.toggle('done', dotIdx < currentIdx);
    });

    // Audio: available while discovering/practicing, not during the test.
    const hasAudio = !!verse.audio;
    if (hifzCardAudio) {
      hifzCardAudio.pause();
      hifzCardAudio.currentTime = 0;
      hifzCardAudio.src = hasAudio ? verse.audio : '';
    }
    if (hifzAudioPlayBtn) {
      hifzAudioPlayBtn.textContent = '▶ Écouter';
      hifzAudioPlayBtn.style.display = hasAudio ? 'inline-flex' : 'none';
    }
    if (hifzAudioUnavailableNote) hifzAudioUnavailableNote.style.display = hasAudio ? 'none' : 'block';
    if (hifzAudioRow) hifzAudioRow.style.display = phase === 'test' ? 'none' : 'flex';

    if (hifzPhaseAdvanceRow) hifzPhaseAdvanceRow.style.display = phase === 'test' ? 'none' : 'flex';
    if (hifzBtnDiscoverContinue) hifzBtnDiscoverContinue.style.display = phase === 'discover' ? 'inline-flex' : 'none';
    if (hifzBtnPracticeReady) hifzBtnPracticeReady.style.display = phase === 'practice' ? 'inline-flex' : 'none';
    if (hifzBtnSkipToTest) hifzBtnSkipToTest.style.display = phase === 'test' ? 'none' : 'inline-flex';
    if (hifzPhaseTestControls) hifzPhaseTestControls.style.display = phase === 'test' ? 'flex' : 'none';

    if (phase === 'discover') {
      if (hifzCardHintsBlock) hifzCardHintsBlock.style.display = 'flex';
      if (hifzHintsToggleRow) hifzHintsToggleRow.style.display = 'none';
      if (hifzMaskToggleRow) hifzMaskToggleRow.style.display = 'none';
      hifzCardPlaceholder.style.display = 'none';
      hifzCardArabic.style.display = 'block';
      hifzCardArabic.textContent = verse.textAr;
      hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';
    } else if (phase === 'practice') {
      if (hifzCardHintsBlock) hifzCardHintsBlock.style.display = 'none';
      if (hifzHintsToggleRow) hifzHintsToggleRow.style.display = 'block';
      if (hifzHintsToggleBtn) hifzHintsToggleBtn.textContent = '👁 Afficher les indices';
      if (hifzMaskToggleRow) hifzMaskToggleRow.style.display = 'block';
      if (hifzMaskToggleBtn) {
        hifzMaskToggleBtn.dataset.allRevealed = 'false';
        const label = hifzMaskToggleBtn.querySelector('span');
        if (label) label.textContent = 'Masquer tout';
      }
      hifzCardPlaceholder.style.display = 'none';
      hifzCardArabic.style.display = 'block';
      hifzCardArabic.innerHTML = tokenizeHifzArabicWords(verse.textAr);
      hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';
    } else { // test — identical to the flashcard's original single-phase reset
      if (hifzCardHintsBlock) hifzCardHintsBlock.style.display = 'flex';
      if (hifzHintsToggleRow) hifzHintsToggleRow.style.display = 'none';
      if (hifzMaskToggleRow) hifzMaskToggleRow.style.display = 'none';
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
      hifzCardRecordingStatus.style.color = 'rgba(255,255,255,0.75)';
    }
  }

  // Open Flashcard modal for target verse. refLabel is shown in the header;
  // juzNum must be the verse's actual Juz (not necessarily state.selectedJuz —
  // a review session can walk verses across several Juz).
  function openHifzFlashcard(verse, surah, juzNum, refLabel) {
    state.activeHifzVerse = verse;
    state.activeHifzSurah = surah;
    state.activeHifzJuz = juzNum;
    state.audioPlayCount = 1;

    const verseKey = `juz_${juzNum}_surah_${surah.number}_verse_${verse.numberInSurah}`;
    state.hifzCardPhase = determineHifzCardPhase(verseKey);

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

    renderHifzCardPhase();

    if (hifzFlashcardModal && drawerOverlay) {
      hifzFlashcardModal.classList.add('open');
      drawerOverlay.classList.add('active');
    }
  }

  function closeHifzFlashcard() {
    cancelHifzSpeechRecording();
    if (hifzCardAudio) {
      hifzCardAudio.pause();
      hifzCardAudio.currentTime = 0;
    }

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
    hifzCardRecordingStatus.style.color = 'rgba(255,255,255,0.75)';

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
      if (!state.juzData || state.juzData.juzNumber !== state.selectedJuz) {
        loadJuzData();
      } else {
        renderQuranText();
      }
    } else if (viewId === 'memorize') {
      loadHifzDashboard();
    } else if (viewId === 'dashboard') {
      // Re-derives the celebration card (and the "Résumé du tafsir" access
      // inside it) from the actually-persisted prayer state every time the
      // dashboard is shown — not just right after checking the 5th prayer
      // box in the same session. Without this, completing the Wird, then
      // leaving and coming back to the dashboard (or just reloading) would
      // silently drop back to the resume-reading card, hiding the
      // celebration card and the summary button with it. Silent: no
      // confetti/toast replaying on every visit, only real completions.
      updateProgress(null, true); // also re-renders the heatmap internally
      renderDashboardStats();
      checkInitialReadingPosition();
      updateSRSDashboardCard();
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

    // Unlike readPages (cleared on every daily reset), this never resets —
    // it's the running total behind the dashboard's "Pages lues" stat.
    state.totalPagesReadAllTime += 1;
    localStorage.setItem('wird_total_pages_alltime', String(state.totalPagesReadAllTime));

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
  function updateProgress(prayerCheckedName = null, silent = false) {
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

      if (!silent) {
        createConfetti(progressBar);
        showToast("Macha Allah ! 🏆", "Vous avez complété votre Wird du jour.");
      }
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

    // More festive burst in kid mode — same mechanic, just bigger.
    const dotCount = state.kidMode ? 28 : 12;
    for (let i = 0; i < dotCount; i++) {
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

  // Tafsir & Asbab an-Nuzul Drawer
  const tafsirDrawer = document.getElementById('tafsir-drawer');
  const closeDrawerBtn = document.getElementById('close-drawer');
  const tafsirVerseRef = document.getElementById('tafsir-verse-ref');
  const tafsirTextAr = document.getElementById('tafsir-text-ar');
  const tafsirTextFr = document.getElementById('tafsir-text-fr');
  const tafsirExp = document.getElementById('tafsir-exp');
  const tafsirLessonBox = document.getElementById('tafsir-lesson-box');
  const tafsirNuzul = document.getElementById('tafsir-nuzul');
  const tafsirNuzulSection = document.getElementById('tafsir-nuzul-section');
  const tafsirTabBtns = document.querySelectorAll('.tafsir-tab-btn');

  // Real, sourced Asbab an-Nuzul (occasions of revelation). No fabricated
  // filler: verses/surahs without a genuine entry simply hide the section.
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

  let tafsirRequestId = 0;
  let tafsirCurrentVerse = null; // { sNum, vNumInSurah }
  let tafsirSource = 'fr'; // 'fr' (Al-Mukhtasar) or 'ar' (Ibn Kathir)

  const TAFSIR_SPINNER_HTML = '<div class="spinner" style="width: 24px; height: 24px; border: 2px solid rgba(212, 175, 55, 0.15); border-radius: 50%; border-top-color: var(--primary); animation: spin 1s linear infinite; margin: 8px 0;"></div>';

  async function renderTafsirExplication() {
    if (!tafsirCurrentVerse) return;
    const { sNum, vNumInSurah } = tafsirCurrentVerse;
    const requestId = ++tafsirRequestId;

    tafsirExp.innerHTML = TAFSIR_SPINNER_HTML;

    if (tafsirSource === 'ar') {
      try {
        const surahData = await QuranAPI.fetchIbnKathirSurah(sNum);
        if (requestId !== tafsirRequestId) return;
        const arText = surahData[vNumInSurah];
        if (arText) {
          tafsirExp.innerHTML = `<div dir="rtl" style="text-align:right; font-family: var(--font-quran); font-size: 1rem; line-height: 1.9; white-space: pre-line;">${arText}</div>`;
          return;
        }
      } catch (error) {
        console.error('Tafsir Ibn Kathir error:', error);
      }
      if (requestId !== tafsirRequestId) return;
      tafsirExp.textContent = "Aucun commentaire d'Ibn Kathir disponible pour ce verset.";
      return;
    }

    // Real per-verse French tafsir (Tafsir Al-Mukhtasar), full Quran coverage.
    try {
      const frRanges = await QuranAPI.fetchTafsirFrRanges();
      if (requestId !== tafsirRequestId) return; // a newer verse/tab was opened meanwhile
      const frText = QuranAPI.findTafsirText(frRanges, sNum, vNumInSurah);
      if (frText) {
        tafsirExp.innerHTML = frText;
        return;
      }
    } catch (error) {
      console.error('Tafsir FR index error:', error);
    }

    if (requestId !== tafsirRequestId) return;
    tafsirExp.textContent = "Aucune explication détaillée n'est disponible pour ce verset pour le moment.";
  }

  tafsirTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const source = btn.dataset.tafsirSource;
      if (source === tafsirSource) return;
      tafsirSource = source;
      tafsirTabBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderTafsirExplication();
    });
  });

  async function openTafsirDrawer(globalNum) {
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

    const vNumInSurah = targetVerse.numberInSurah;
    const sNum = targetSurah.number;
    tafsirCurrentVerse = { sNum, vNumInSurah };

    tafsirVerseRef.textContent = `${sNum}:${vNumInSurah}`;
    tafsirTextAr.textContent = targetVerse.textAr;
    tafsirTextFr.textContent = targetVerse.translation;
    tafsirLessonBox.style.display = 'none';
    tafsirNuzulSection.style.display = 'none';

    tafsirDrawer.classList.add('open');
    drawerOverlay.classList.add('active');

    // Asbab an-Nuzul: only ever show a real, sourced entry.
    const asbabText = asbabNuzulDict[`${sNum}_${vNumInSurah}`] || asbabNuzulDict[`${sNum}`] || null;
    if (asbabText) {
      tafsirNuzul.textContent = asbabText;
      tafsirNuzulSection.style.display = '';
    }

    renderTafsirExplication();
  }

  function closeTafsirDrawer() {
    tafsirDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
  }

  if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeTafsirDrawer);

  // Juz Summary Drawer: concatenated Tafsir Al-Muyassar (Arabic) for a
  // whole Juz, opened from the celebration card once it's finished.
  const juzSummaryDrawer = document.getElementById('juz-summary-drawer');
  const juzSummaryRef = document.getElementById('juz-summary-ref');
  const juzSummaryContent = document.getElementById('juz-summary-content');
  const closeJuzSummaryDrawerBtn = document.getElementById('close-juz-summary-drawer');
  const btnJuzSummary = document.getElementById('btn-juz-summary');

  function closeJuzSummaryDrawer() {
    if (juzSummaryDrawer) juzSummaryDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
  }

  async function openJuzSummaryDrawer(juzNumber) {
    if (!juzSummaryDrawer || !juzSummaryContent) return;
    juzSummaryRef.textContent = `Juz ${juzNumber}`;
    juzSummaryContent.innerHTML = TAFSIR_SPINNER_HTML;
    juzSummaryDrawer.classList.add('open');
    drawerOverlay.classList.add('active');

    try {
      const bySurah = await QuranAPI.fetchJuzTafsirMuyassar(juzNumber);
      const html = bySurah.map(surah => {
        const versesHtml = surah.verses.map(v =>
          `<span style="color: var(--primary); font-weight:700;">(${v.numberInSurah})</span> ${v.text}`
        ).join(' ');
        return `<h4 style="margin: 16px 0 8px; color: var(--primary); font-size: 0.9375rem;">${surah.surahName}</h4><p style="margin:0 0 8px;">${versesHtml}</p>`;
      }).join('');
      juzSummaryContent.innerHTML = html || "Aucun résumé disponible pour ce Juz.";
    } catch (error) {
      console.error('Juz tafsir summary error:', error);
      juzSummaryContent.textContent = "Impossible de charger le résumé pour le moment.";
    }
  }

  if (closeJuzSummaryDrawerBtn) closeJuzSummaryDrawerBtn.addEventListener('click', closeJuzSummaryDrawer);
  if (btnJuzSummary) {
    btnJuzSummary.addEventListener('click', () => openJuzSummaryDrawer(state.selectedJuz));
  }

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

  // Shows/hides the "yesterday's Wird wasn't finished" card based on
  // state.missedWirdJuz, set from the persisted flag during the daily
  // reset check. Cleared (card hidden, flag removed) once the user
  // resumes it or dismisses it — never reappears on its own after that.
  function renderMissedWirdCard() {
    if (!missedWirdCard) return;
    if (state.missedWirdJuz) {
      missedWirdRef.textContent = `Juz ${state.missedWirdJuz}`;
      missedWirdCard.style.display = 'flex';
    } else {
      missedWirdCard.style.display = 'none';
    }
  }

  function dismissMissedWirdReminder() {
    state.missedWirdJuz = null;
    localStorage.removeItem('wird_missed_reminder_juz');
    renderMissedWirdCard();
  }

  if (btnMissedWirdDismiss) {
    btnMissedWirdDismiss.addEventListener('click', dismissMissedWirdReminder);
  }
  if (btnMissedWirdResume) {
    btnMissedWirdResume.addEventListener('click', () => {
      const juz = state.missedWirdJuz;
      dismissMissedWirdReminder();
      if (juz) {
        state.selectedJuz = juz;
        localStorage.setItem('wird_selected_juz', juz);
        if (selectJuz) selectJuz.value = juz;
        switchView('reader');
      }
    });
  }

  // Khatm goal: finish the Quran `multiplier` times within `days` days
  // (e.g. Ramadan). juzCompleted increments each time the user advances to
  // the next Juz (see btnNextJuzTrigger below) while a goal is active — the
  // existing single-Juz-per-Wird mechanic is unchanged, this just tracks
  // progress against it and tells the user the daily pace they need.
  const QURAN_TOTAL_JUZ = 30;

  function renderKhatmGoal() {
    if (!khatmGoalEmpty || !khatmGoalActive) return;
    const goal = state.khatmGoal;
    if (!goal) {
      khatmGoalEmpty.style.display = 'flex';
      khatmGoalActive.style.display = 'none';
      return;
    }

    khatmGoalEmpty.style.display = 'none';
    khatmGoalActive.style.display = 'flex';

    const targetJuz = goal.multiplier * QURAN_TOTAL_JUZ;
    const juzCompleted = Math.min(goal.juzCompleted, targetJuz);
    const msPerDay = 24 * 60 * 60 * 1000;
    const startDate = new Date(goal.startDate + 'T00:00:00');
    const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
    const daysElapsed = Math.max(0, Math.round((today - startDate) / msPerDay));
    const daysRemaining = Math.max(1, goal.days - daysElapsed);
    const juzRemaining = Math.max(0, targetJuz - juzCompleted);
    const pacePerDay = Math.ceil(juzRemaining / daysRemaining);

    khatmGoalLabel.textContent = `Khatm x${goal.multiplier} en ${goal.days} jours`;
    khatmGoalProgressBar.style.width = `${Math.min(100, (juzCompleted / targetJuz) * 100)}%`;

    if (juzRemaining === 0) {
      khatmGoalDetail.textContent = `🎉 Objectif atteint ! ${juzCompleted}/${targetJuz} Juz complétés.`;
    } else {
      khatmGoalDetail.textContent = `${juzCompleted}/${targetJuz} Juz — ~${pacePerDay} Juz/jour nécessaires (${daysRemaining} j restants)`;
    }
  }

  if (btnKhatmGoalSet) {
    btnKhatmGoalSet.addEventListener('click', () => {
      const multiplier = parseInt(khatmGoalMultiplierSelect.value, 10);
      const days = Math.max(1, parseInt(khatmGoalDaysInput.value, 10) || 30);
      state.khatmGoal = {
        multiplier,
        days,
        startDate: new Date().toISOString().split('T')[0],
        juzCompleted: 0
      };
      localStorage.setItem('wird_khatm_goal', JSON.stringify(state.khatmGoal));
      renderKhatmGoal();
    });
  }

  if (btnKhatmGoalCancel) {
    btnKhatmGoalCancel.addEventListener('click', () => {
      state.khatmGoal = null;
      localStorage.removeItem('wird_khatm_goal');
      renderKhatmGoal();
    });
  }

  // Dashboard statistics: current/best streak are derived from
  // consistencyHistory (the same date→level map the heatmap already reads),
  // days actifs counts every date with at least one prayer checked, pages
  // and Juz totals are the cumulative counters maintained above.
  function computeWirdStreak() {
    let streak = 0;
    const cursor = new Date();
    const todayStr = cursor.toISOString().split('T')[0];
    if (!(state.consistencyHistory[todayStr] > 0)) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (true) {
      const dStr = cursor.toISOString().split('T')[0];
      if (state.consistencyHistory[dStr] > 0) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function computeWirdBestStreak() {
    const activeDates = Object.keys(state.consistencyHistory)
      .filter(d => state.consistencyHistory[d] > 0)
      .sort();
    if (activeDates.length === 0) return 0;

    let best = 1;
    let current = 1;
    for (let i = 1; i < activeDates.length; i++) {
      const prev = new Date(activeDates[i - 1] + 'T00:00:00');
      const cur = new Date(activeDates[i] + 'T00:00:00');
      const dayGap = Math.round((cur - prev) / (24 * 60 * 60 * 1000));
      if (dayGap === 1) {
        current++;
      } else {
        current = 1;
      }
      if (current > best) best = current;
    }
    return best;
  }

  function renderDashboardStats() {
    if (!dashboardStatsGrid) return;
    const activeDays = Object.values(state.consistencyHistory).filter(level => level > 0).length;
    const avgPerDay = activeDays > 0 ? (state.totalPagesReadAllTime / activeDays) : 0;

    dashboardStatValues.streak.textContent = String(computeWirdStreak());
    dashboardStatValues.bestStreak.textContent = String(computeWirdBestStreak());
    dashboardStatValues.pages.textContent = String(state.totalPagesReadAllTime);
    dashboardStatValues.juz.textContent = String(state.totalJuzCompleted);
    dashboardStatValues.activeDays.textContent = String(activeDays);
    dashboardStatValues.avgPerDay.textContent = avgPerDay > 0 ? avgPerDay.toFixed(1) : '0';
  }

  // Load initial resume position card on launch
  function checkInitialReadingPosition() {
    renderMissedWirdCard();
    renderKhatmGoal();
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

  // ==================== KID MODE ====================
  // Bigger, more playful presentation for the memorization workshop —
  // same verses/tafsir/SRS data, just a friendlier frame (see the
  // [data-kid-mode="true"] #view-memorize rules in style.css). Toggle
  // lives in both Paramètres and the first-run welcome screen; both write
  // to the same state/localStorage key and stay in sync with each other.
  const toggleKidMode = document.getElementById('toggle-kid-mode');
  const toggleKidModeOnboarding = document.getElementById('toggle-kid-mode-onboarding');

  state.kidMode = localStorage.getItem('wird_kid_mode') === 'true';

  function applyKidMode() {
    document.documentElement.setAttribute('data-kid-mode', state.kidMode ? 'true' : 'false');
    localStorage.setItem('wird_kid_mode', String(state.kidMode));
    if (toggleKidMode) toggleKidMode.checked = state.kidMode;
    if (toggleKidModeOnboarding) toggleKidModeOnboarding.checked = state.kidMode;
  }

  // Owl mascot's greeting, picked fresh each time the workshop is opened —
  // the banner itself only ever appears in normal document flow (see
  // .kid-mascot-banner in style.css), so it can never sit on top of and
  // hide the lesson content beneath it.
  const KID_MASCOT_MESSAGES = [
    "Salut ! Prêt à réviser aujourd'hui ? 🌟",
    "Bravo pour ta constance, continue comme ça ! 💪",
    "Chaque verset appris est une victoire ! 🏆",
    "On y va doucement, un verset à la fois. 🦉",
    "Je suis fier de toi, champion ! ✨"
  ];

  function renderKidMascotMessage() {
    const el = document.getElementById('kid-mascot-message');
    if (!el) return;
    el.textContent = KID_MASCOT_MESSAGES[Math.floor(Math.random() * KID_MASCOT_MESSAGES.length)];
  }

  if (toggleKidMode) {
    toggleKidMode.addEventListener('change', () => {
      state.kidMode = toggleKidMode.checked;
      applyKidMode();
      showToast(state.kidMode ? "Mode enfant activé 👶" : "Mode enfant désactivé", "Atelier Mémorisation mis à jour.");
    });
  }
  if (toggleKidModeOnboarding) {
    toggleKidModeOnboarding.addEventListener('change', () => {
      state.kidMode = toggleKidModeOnboarding.checked;
      applyKidMode();
    });
  }

  applyKidMode();

  // ==================== FIRST-RUN ONBOARDING ====================
  const onboardingDrawer = document.getElementById('onboarding-drawer');
  const btnOnboardingContinue = document.getElementById('btn-onboarding-continue');

  function closeOnboarding() {
    if (!onboardingDrawer) return;
    onboardingDrawer.classList.remove('open');
    drawerOverlay.classList.remove('active');
    localStorage.setItem('wird_onboarding_seen', 'true');
  }

  if (btnOnboardingContinue) btnOnboardingContinue.addEventListener('click', closeOnboarding);
  if (drawerOverlay && onboardingDrawer) {
    drawerOverlay.addEventListener('click', () => {
      if (onboardingDrawer.classList.contains('open')) closeOnboarding();
    });
  }

  if (onboardingDrawer && !localStorage.getItem('wird_onboarding_seen')) {
    onboardingDrawer.classList.add('open');
    drawerOverlay.classList.add('active');
  }

  // Initialize UI & load data
  initSelectors();
  populateHifzJuzSelect();
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
