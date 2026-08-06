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
    hifzLevel: 1, // 1: Complet, 2: 1er Mot, 3: Troué, 4: Masqué (Reader view only)
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
    hifzSpeechRecognition: null,
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
  const quranContainer = document.getElementById('quran-container');
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
  const btnSpeechSimOk = document.getElementById('btn-speech-sim-ok');
  const btnSpeechSimErr = document.getElementById('btn-speech-sim-err');

  // Hifz Refactored Workshop elements (view-memorize)
  const hifzJuzBadge = document.getElementById('hifz-juz-badge');
  const hifzProgressDetail = document.getElementById('hifz-progress-detail');
  const hifzProgressBarFill = document.getElementById('hifz-progress-bar-fill');
  const hifzGrid = document.getElementById('hifz-grid');
  
  // Hifz Flashcard drawer elements
  const hifzFlashcardModal = document.getElementById('hifz-flashcard-modal');
  const hifzCardClose = document.getElementById('hifz-card-close');
  const hifzCardRef = document.getElementById('hifz-card-ref');
  const hifzCardTranslation = document.getElementById('hifz-card-translation');
  const hifzCardTranslit = document.getElementById('hifz-card-translit');
  
  const hifzCardArabicWrapper = document.getElementById('hifz-card-arabic-wrapper');
  const hifzCardPlaceholder = document.getElementById('hifz-card-placeholder');
  const hifzCardArabic = document.getElementById('hifz-card-arabic');
  
  const hifzCardMicBtn = document.getElementById('hifz-card-mic-btn');
  const hifzCardRecordingStatus = document.getElementById('hifz-card-recording-status');
  
  const hifzCardSimOk = document.getElementById('hifz-card-sim-ok');
  const hifzCardSimErr = document.getElementById('hifz-card-sim-err');
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

    // Hifz levels click listeners (Reader view only)
    for (let i = 1; i <= 4; i++) {
      const btn = document.getElementById(`hifz-btn-level${i}`);
      if (btn) {
        btn.addEventListener('click', () => {
          for (let j = 1; j <= 4; j++) {
            document.getElementById(`hifz-btn-level${j}`).classList.remove('active');
          }
          btn.classList.add('active');
          state.hifzLevel = i;
          renderQuranText();
        });
      }
    }

    // Audio loop change listener
    if (selectAudioLoop) {
      selectAudioLoop.addEventListener('change', (e) => {
        state.audioLoopRepetitions = e.target.value;
        state.audioPlayCount = 1;
      });
    }

    // SRS dashboard start button
    if (btnStartRevision) {
      btnStartRevision.addEventListener('click', () => {
        const now = Date.now();
        const dueVerseKey = Object.keys(state.srsDatabase).find(key => {
          return state.srsDatabase[key].nextReviewDate <= now;
        });

        if (dueVerseKey) {
          const parts = dueVerseKey.split('_');
          const targetJuz = parseInt(parts[1], 10);
          state.selectedJuz = targetJuz;
          localStorage.setItem('wird_selected_juz', targetJuz);
          if (selectJuz) selectJuz.value = targetJuz;
          
          switchView('memorize');
        }
      });
    }

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
    
    // Reader Speech Simulations overrides
    if (btnSpeechSimOk) {
      btnSpeechSimOk.addEventListener('click', () => {
        const verse = getActiveRecordingVerse();
        if (verse) evaluateSpeechResult(verse.textAr);
      });
    }
    if (btnSpeechSimErr) {
      btnSpeechSimErr.addEventListener('click', () => {
        evaluateSpeechResult("كلمات خاطئة غير مطابقة تماما");
      });
    }

    // Hifz Flashcard Bindings
    if (hifzCardClose) hifzCardClose.addEventListener('click', closeHifzFlashcard);
    if (hifzCardMicBtn) hifzCardMicBtn.addEventListener('click', startHifzVoiceRecording);
    
    if (hifzCardSimOk) {
      hifzCardSimOk.addEventListener('click', () => {
        if (state.activeHifzVerse) {
          evaluateHifzSpeechResult(state.activeHifzVerse.textAr);
        }
      });
    }
    
    if (hifzCardSimErr) {
      hifzCardSimErr.addEventListener('click', () => {
        evaluateHifzSpeechResult("خطأ تلاوة خاطئة");
      });
    }

    // Hifz Flashcard SRS rating click listeners
    const hifzSrsButtons = document.querySelectorAll('#hifz-card-srs-row .btn-srs');
    hifzSrsButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!state.activeHifzVerse || !state.activeHifzSurah) return;
        
        const rating = btn.dataset.hifzRating;
        const verseKey = `juz_${state.selectedJuz}_surah_${state.activeHifzSurah.number}_verse_${state.activeHifzVerse.numberInSurah}`;
        
        let intervalDays = 1;
        if (rating === 'medium') intervalDays = 3;
        if (rating === 'easy') intervalDays = 7;

        state.srsDatabase[verseKey] = {
          nextReviewDate: Date.now() + intervalDays * 24 * 60 * 60 * 1000,
          difficulty: rating,
          interval: intervalDays,
          timestamp: Date.now()
        };

        localStorage.setItem('wird_srs_database', JSON.stringify(state.srsDatabase));
        
        createConfetti(btn);
        
        setTimeout(() => {
          closeHifzFlashcard();
          loadHifzDashboard();
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

    // Swipe navigation on the reader content: swipe right = next page, swipe left = previous page
    if (quranContainer) {
      let touchStartX = 0;
      let touchStartY = 0;
      let touchDeltaX = 0;
      // null = undecided, true = horizontal swipe in progress, false = vertical scroll, let the browser handle it
      let isHorizontalSwipe = null;
      const MIN_SWIPE_DISTANCE = 50;
      const DIRECTION_LOCK_THRESHOLD = 10;

      quranContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchDeltaX = 0;
        isHorizontalSwipe = null;
      }, { passive: true });

      // Non-passive: once we're confident the gesture is horizontal, we must
      // preventDefault() here or the browser hijacks it as a vertical scroll
      // (the <main> ancestor is scrollable) and touchend never reflects the swipe.
      quranContainer.addEventListener('touchmove', (e) => {
        const deltaX = e.touches[0].clientX - touchStartX;
        const deltaY = e.touches[0].clientY - touchStartY;

        if (isHorizontalSwipe === null && (Math.abs(deltaX) > DIRECTION_LOCK_THRESHOLD || Math.abs(deltaY) > DIRECTION_LOCK_THRESHOLD)) {
          isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
        }

        if (isHorizontalSwipe) {
          e.preventDefault();
          touchDeltaX = deltaX;
        }
      }, { passive: false });

      const finishSwipe = () => {
        if (isHorizontalSwipe && Math.abs(touchDeltaX) >= MIN_SWIPE_DISTANCE) {
          if (touchDeltaX > 0) {
            goToNextPage();
          } else {
            goToPrevPage();
          }
        }
        isHorizontalSwipe = null;
        touchDeltaX = 0;
      };

      quranContainer.addEventListener('touchend', finishSwipe, { passive: true });
      quranContainer.addEventListener('touchcancel', finishSwipe, { passive: true });
    }
  }

  function goToPrevPage() {
    if (state.currentPageIndex > 0) {
      state.currentPageIndex--;
      stopAudio();
      renderQuranText(true);
      const pageItems = getVersesOfCurrentPage();
      if (pageItems.length > 0) {
        saveReadingPosition(pageItems[0].verse.number);
      }
    }
  }

  function goToNextPage() {
    if (state.pagesList && state.currentPageIndex < state.pagesList.length - 1) {
      state.currentPageIndex++;
      stopAudio();
      renderQuranText(true);
      const pageItems = getVersesOfCurrentPage();
      if (pageItems.length > 0) {
        saveReadingPosition(pageItems[0].verse.number);
      }
    }
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
    
    quranContainer.style.display = 'none';
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
      quranContainer.style.display = 'flex';
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

  // Render text for Page-by-Page Reader View
  // preserveIndex: skip re-deriving currentPageIndex from localStorage/scrollToVerseOnLoad
  // (used when the caller already set state.currentPageIndex explicitly, e.g. pagination buttons/swipe)
  function renderQuranText(preserveIndex) {
    if (!quranContainer || !state.juzData) return;
    quranContainer.innerHTML = '';

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
    localStorage.setItem('wird_last_page', activePageNum);
    localStorage.setItem('wird_last_juz', state.selectedJuz);

    // Any navigation (buttons, swipe, audio auto-advance) lands here and resets
    // the dwell timer, so rapid page-flipping never counts as "read".
    schedulePageDwellTracking(state.selectedJuz, state.currentPageIndex + 1);

    const pageItems = allVerses.filter(item => item.verse.page === activePageNum);

    // Update pagination labels
    const labelReaderPage = document.getElementById('label-reader-page');
    if (labelReaderPage) {
      labelReaderPage.textContent = `Page ${state.currentPageIndex + 1}/${pages.length} (Coran P. ${activePageNum})`;
    }

    if (btnPrevPage) btnPrevPage.disabled = (state.currentPageIndex === 0);
    if (btnNextPage) btnNextPage.disabled = (state.currentPageIndex === pages.length - 1);

    // Render filtered page verses
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
        quranContainer.appendChild(headerCard);
      }

      const block = document.createElement('div');
      block.className = 'verse-block';
      block.id = `verse-${v.number}`;
      block.dataset.verseNum = v.number;
      block.dataset.surahNum = surah.number;
      block.dataset.audioUrl = v.audio;

      const verseKey = `juz_${state.selectedJuz}_surah_${surah.number}_verse_${v.numberInSurah}`;

      let arabicHtml = '';
      const words = v.textAr.split(/\s+/);
      
      if (state.readerMode === 'memorize') {
        if (state.hifzLevel === 1) {
          arabicHtml = v.textAr;
        } else if (state.hifzLevel === 2) {
          arabicHtml = words.map((w, idx) => {
            if (idx === 0) return w;
            return `<span class="hifz-masked-word" title="Cliquez pour révéler">${w}</span>`;
          }).join(' ');
        } else if (state.hifzLevel === 3) {
          arabicHtml = words.map((w, idx) => {
            if (idx % 2 === 1) {
              return `<span class="hifz-masked-word" title="Cliquez pour révéler">${w}</span>`;
            }
            return w;
          }).join(' ');
        } else if (state.hifzLevel === 4) {
          arabicHtml = `
            <div class="hifz-masked-full-wrapper" data-target="full-ar-${v.number}">
              <span>Afficher le texte arabe</span>
              <div id="full-ar-${v.number}" style="display:none; margin-top:6px; font-family:var(--font-quran); font-size:${state.arabicFontSize * (window.__wirdTextScale || 1)}px; color:#FFF; line-height:2;">
                ${v.textAr}
              </div>
            </div>
          `;
        }
      } else {
        arabicHtml = v.textAr;
      }

      block.innerHTML = `
        <div class="verse-header-row">
          <span class="verse-badge">${surah.nameFr} (${v.numberInSurah})</span>
          <div class="verse-actions">
            ${state.readerMode === 'memorize' ? `
              <button class="verse-action-btn record-recitation" title="Valider par ma voix" data-global-num="${v.number}" style="color:var(--text-secondary)">
                <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
              </button>
            ` : ''}
            <button class="verse-action-btn play-verse" title="Écouter" data-global-num="${v.number}">
              <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="verse-action-btn view-tafsir" title="Tafsir" data-global-num="${v.number}">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
            </button>
          </div>
        </div>
        <div class="verse-text-ar-container">
          ${state.hifzLevel === 4 && state.readerMode === 'memorize' 
            ? arabicHtml 
            : `<div class="verse-text-ar" style="font-size: ${state.arabicFontSize * (window.__wirdTextScale || 1)}px">${arabicHtml}</div>`
          }
        </div>
        ${v.transliteration ? `<div class="verse-text-trans">${v.transliteration}</div>` : ''}
        <div class="verse-text-fr">${v.translation}</div>
        
        <!-- SRS Rating Panel -->
        ${state.readerMode === 'memorize' ? `
          <div class="srs-buttons-row" data-verse-key="${verseKey}">
            <button class="btn-srs btn-srs-hard" data-rating="hard">🔴 Revoir</button>
            <button class="btn-srs btn-srs-medium" data-rating="medium">🟡 Moyen</button>
            <button class="btn-srs btn-srs-easy" data-rating="easy">🟢 Facile</button>
          </div>
        ` : ''}
      `;
      quranContainer.appendChild(block);
    });

    setupVerseInteractions();
    refreshDisplayLanguages();

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
    if (!quranContainer) return;
    const blocks = quranContainer.querySelectorAll('.verse-block');
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

    document.querySelectorAll('.verse-block').forEach(b => b.classList.remove('active-reciting'));

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

  // Voice Speech Recognition API Integration (for Reader View)
  function startSpeechRecording(globalNum, buttonElement) {
    stopAudio();
    state.recordingVerseNum = globalNum;
    
    if (speechModal && speechTranscription) {
      speechModal.style.display = 'flex';
      speechTranscription.textContent = "(Parlez maintenant...)";
    }

    document.querySelectorAll('.record-recitation').forEach(b => b.classList.remove('listening-active'));
    if (buttonElement) buttonElement.classList.add('listening-active');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'ar-SA';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onresult = (event) => {
        const resultText = Array.from(event.results)
          .map(r => r[0].transcript)
          .join('');
        speechTranscription.textContent = resultText;
      };

      rec.onend = () => {
        const finalVal = speechTranscription.textContent.trim();
        if (finalVal && finalVal !== "(Parlez maintenant...)") {
          evaluateSpeechResult(finalVal);
        }
      };

      rec.onerror = (e) => {
        console.warn("Speech recognition error:", e.error);
        if (e.error === 'not-allowed') {
          speechTranscription.textContent = "(Permission micro bloquée. Utilisez le bouton 'Simuler' pour tester.)";
        }
      };

      try {
        rec.start();
        state.activeRecognition = rec;
      } catch (err) {
        console.error("Failed to start recognition:", err);
      }
    } else {
      speechTranscription.textContent = "(Votre navigateur ne supporte pas le micro. Utilisez les boutons 'Simuler'.)";
    }
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

  // Evaluate speech result (Reader View)
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

    const cleanOriginal = cleanArabicText(verseObj.textAr);
    const cleanSpoken = cleanArabicText(spokenText);

    const originalWords = cleanOriginal.split(' ');
    const spokenWords = cleanSpoken.split(' ');
    
    let matchesCount = 0;
    originalWords.forEach(w => {
      if (spokenWords.includes(w)) {
        matchesCount++;
      }
    });

    const scorePct = Math.round((matchesCount / originalWords.length) * 100);

    verseBlock.classList.remove('recitation-success', 'recitation-error');

    const srsRow = verseBlock.querySelector('.srs-buttons-row');
    const verseKey = `juz_${state.selectedJuz}_surah_${verseBlock.dataset.surahNum}_verse_${verseObj.numberInSurah}`;

    if (scorePct >= 70) {
      showToast("Récitation Réussie ! 🎉", `Précision : ${scorePct}% - "${spokenText.substring(0, 20)}..."`);
      verseBlock.classList.add('recitation-success');
      
      if (srsRow) {
        srsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));
        srsRow.querySelector('.btn-srs-easy').classList.add('active');
      }

      state.srsDatabase[verseKey] = {
        nextReviewDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
        difficulty: 'easy',
        interval: 7,
        timestamp: Date.now()
      };
      
      createConfetti(verseBlock);

    } else {
      showToast("À revoir ⚠️", `Précision : ${scorePct}% - "${spokenText.substring(0, 20)}..."`);
      verseBlock.classList.add('recitation-error');
      
      if (srsRow) {
        srsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));
        srsRow.querySelector('.btn-srs-hard').classList.add('active');
      }

      state.srsDatabase[verseKey] = {
        nextReviewDate: Date.now() + 1 * 24 * 60 * 60 * 1000,
        difficulty: 'hard',
        interval: 1,
        timestamp: Date.now()
      };
    }

    localStorage.setItem('wird_srs_database', JSON.stringify(state.srsDatabase));
    updateSRSDashboardCard();
    closeSpeechModal();
  }

  // ==================== HIFZ WORKSHOP LOGIC ====================

  // Load and Render the visual Hifz Dashboard Grid (view-memorize)
  async function loadHifzDashboard() {
    if (!hifzGrid || !hifzProgressDetail || !hifzProgressBarFill || !hifzJuzBadge) return;

    hifzJuzBadge.textContent = `Juz ${state.selectedJuz}`;
    hifzGrid.innerHTML = '<div style="grid-column: span 5; text-align: center; color: var(--text-secondary); padding: 20px; font-size: 0.75rem;">Chargement du plan de révision...</div>';

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

    const allVerses = [];
    state.juzData.surahs.forEach(surah => {
      surah.verses.forEach(v => {
        allVerses.push({
          verse: v,
          surah: surah
        });
      });
    });

    let masteredCount = 0;
    allVerses.forEach(item => {
      const key = `juz_${state.selectedJuz}_surah_${item.surah.number}_verse_${item.verse.numberInSurah}`;
      const record = state.srsDatabase[key];
      if (record && record.difficulty === 'easy') {
        masteredCount++;
      }
    });

    const percent = allVerses.length > 0 ? Math.round((masteredCount / allVerses.length) * 100) : 0;
    hifzProgressDetail.textContent = `${masteredCount}/${allVerses.length} versets acquis (${percent}%)`;
    hifzProgressBarFill.style.width = `${percent}%`;

    hifzGrid.innerHTML = '';
    allVerses.forEach((item, index) => {
      const v = item.verse;
      const surah = item.surah;
      const key = `juz_${state.selectedJuz}_surah_${surah.number}_verse_${v.numberInSurah}`;
      
      const gridItem = document.createElement('div');
      gridItem.className = 'hifz-grid-item';
      
      gridItem.textContent = index + 1;
      gridItem.title = `${surah.nameFr} (V. ${v.numberInSurah})`;

      const record = state.srsDatabase[key];
      if (record) {
        if (record.difficulty === 'hard') gridItem.classList.add('srs-hard');
        else if (record.difficulty === 'medium') gridItem.classList.add('srs-medium');
        else if (record.difficulty === 'easy') gridItem.classList.add('srs-easy');
      } else {
        gridItem.classList.add('srs-none');
      }

      gridItem.addEventListener('click', () => {
        openHifzFlashcard(v, surah, index + 1);
      });

      hifzGrid.appendChild(gridItem);
    });
  }

  // Open Flashcard modal for target verse
  function openHifzFlashcard(verse, surah, sequentialIdx) {
    state.activeHifzVerse = verse;
    state.activeHifzSurah = surah;
    state.audioPlayCount = 1;

    hifzCardRef.textContent = `V. ${sequentialIdx} (Sourate ${surah.number}:${verse.numberInSurah})`;
    hifzCardTranslation.textContent = `"${verse.translation}"`;
    hifzCardTranslit.textContent = verse.transliteration;

    hifzCardPlaceholder.style.display = 'block';
    hifzCardArabic.style.display = 'none';
    hifzCardArabic.textContent = verse.textAr;
    hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';
    
    hifzCardSrsRow.style.display = 'none';
    hifzCardMicBtn.className = '';
    hifzCardRecordingStatus.textContent = 'Cliquez pour réciter';
    hifzCardRecordingStatus.style.color = 'var(--text-secondary)';

    if (hifzFlashcardModal && drawerOverlay) {
      hifzFlashcardModal.classList.add('open');
      drawerOverlay.classList.add('active');
    }
  }

  function closeHifzFlashcard() {
    if (state.hifzSpeechRecognition) {
      state.hifzSpeechRecognition.onend = null;
      state.hifzSpeechRecognition.stop();
      state.hifzSpeechRecognition = null;
    }
    
    if (hifzFlashcardModal && drawerOverlay) {
      hifzFlashcardModal.classList.remove('open');
      drawerOverlay.classList.remove('active');
    }
    
    state.activeHifzVerse = null;
    state.activeHifzSurah = null;
  }

  // Record voice inside the Hifz Flashcard
  function startHifzVoiceRecording() {
    if (!state.activeHifzVerse) return;

    hifzCardPlaceholder.style.display = 'block';
    hifzCardArabic.style.display = 'none';
    hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper';
    hifzCardSrsRow.style.display = 'none';

    hifzCardMicBtn.className = 'hifz-mic-pulse-active';
    hifzCardRecordingStatus.textContent = 'Écoute en cours... Récitez le verset';
    hifzCardRecordingStatus.style.color = 'var(--ruby)';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'ar-SA';
      rec.interimResults = true;
      rec.continuous = false;

      rec.onresult = (event) => {
        const resultText = Array.from(event.results)
          .map(r => r[0].transcript)
          .join('');
        hifzCardPlaceholder.textContent = resultText;
        hifzCardPlaceholder.style.color = '#FFF';
        hifzCardPlaceholder.style.fontStyle = 'normal';
      };

      rec.onend = () => {
        const val = hifzCardPlaceholder.textContent.trim();
        if (val && val !== "Enregistrez votre voix pour valider...") {
          evaluateHifzSpeechResult(val);
        } else {
          cancelHifzSpeechRecording();
        }
      };

      rec.onerror = (e) => {
        console.warn("Hifz mic error", e.error);
        if (e.error === 'not-allowed') {
          hifzCardRecordingStatus.textContent = 'Permission refusée. Utilisez la simulation.';
          hifzCardRecordingStatus.style.color = 'var(--ruby)';
        }
        cancelHifzSpeechRecording();
      };

      rec.start();
      state.hifzSpeechRecognition = rec;

    } else {
      hifzCardRecordingStatus.textContent = 'Micro non supporté. Utilisez la simulation.';
      hifzCardRecordingStatus.style.color = 'var(--ruby)';
    }
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

  // Check matching score in Flashcard
  function evaluateHifzSpeechResult(spokenText) {
    cancelHifzSpeechRecording();

    if (!state.activeHifzVerse || !state.activeHifzSurah) return;

    const cleanOriginal = cleanArabicText(state.activeHifzVerse.textAr);
    const cleanSpoken = cleanArabicText(spokenText);

    const originalWords = cleanOriginal.split(' ');
    const spokenWords = cleanSpoken.split(' ');
    
    let matchesCount = 0;
    originalWords.forEach(w => {
      if (spokenWords.includes(w)) {
        matchesCount++;
      }
    });

    const scorePct = Math.round((matchesCount / originalWords.length) * 100);

    hifzCardPlaceholder.style.display = 'none';
    hifzCardArabic.style.display = 'block';
    hifzCardSrsRow.style.display = 'flex';
    hifzCardSrsRow.querySelectorAll('.btn-srs').forEach(b => b.classList.remove('active'));

    if (scorePct >= 70) {
      showToast("Récitation Réussie ! 🎉", `Précision : ${scorePct}% - "${spokenText.substring(0, 20)}..."`);
      hifzCardArabicWrapper.className = 'hifz-card-arabic-wrapper flashcard-reveal-success';
      hifzCardSrsRow.querySelector('.btn-srs-easy').classList.add('active');
    } else {
      showToast("Récitation à revoir ⚠️", `Précision : ${scorePct}% - "${spokenText.substring(0, 20)}..."`);
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
  // state.arabicFontSize is the user's manual preference at 1x screen scale;
  // the responsive engine (inline script in index.html <head>) separately
  // scales the whole app for screen size/density via window.__wirdTextScale.
  // These two multiply together so a tablet/unfolded-foldable reader still
  // benefits from the bigger base text while keeping the user's own +/- intact.
  function applyArabicFontSize() {
    const px = state.arabicFontSize * (window.__wirdTextScale || 1);
    document.querySelectorAll('.verse-text-ar, [id^="full-ar-"]').forEach(el => {
      el.style.fontSize = `${px}px`;
    });
  }

  window.addEventListener('wird:scalechange', applyArabicFontSize);

  const btnFontDec = document.getElementById('btn-font-dec');
  const btnFontInc = document.getElementById('btn-font-inc');

  if (btnFontDec) {
    btnFontDec.addEventListener('click', () => {
      if (state.arabicFontSize > 18) {
        state.arabicFontSize -= 2;
        applyArabicFontSize();
      }
    });
  }

  if (btnFontInc) {
    btnFontInc.addEventListener('click', () => {
      if (state.arabicFontSize < 40) {
        state.arabicFontSize += 2;
        applyArabicFontSize();
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
  const paletteSwatches = document.querySelectorAll('.palette-swatch');

  state.theme = localStorage.getItem('wird_theme') || 'dark';
  state.palette = localStorage.getItem('wird_palette') || 'gold';

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.setAttribute('data-palette', state.palette);
    localStorage.setItem('wird_theme', state.theme);
    localStorage.setItem('wird_palette', state.palette);

    if (btnThemeLight && btnThemeDark) {
      btnThemeLight.classList.toggle('active', state.theme === 'light');
      btnThemeDark.classList.toggle('active', state.theme === 'dark');
    }
    paletteSwatches.forEach(sw => {
      sw.classList.toggle('active', sw.dataset.palette === state.palette);
    });

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', state.theme === 'light' ? '#f2efe9' : '#070913');
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
  if (btnThemeLight) btnThemeLight.addEventListener('click', () => { state.theme = 'light'; applyTheme(); });
  if (btnThemeDark) btnThemeDark.addEventListener('click', () => { state.theme = 'dark'; applyTheme(); });
  paletteSwatches.forEach(sw => {
    sw.addEventListener('click', () => { state.palette = sw.dataset.palette; applyTheme(); });
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
  
  // Default launch
  switchView('dashboard');
  checkInitialReadingPosition();
});
