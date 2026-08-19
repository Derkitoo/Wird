// IndexedDB Helpers for local persistence
const DB_NAME = 'WirdQuranDB';
const DB_VERSION = 2;
const STORE_NAME = 'juzs';
const TAFSIR_STORE_NAME = 'tafsir';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TAFSIR_STORE_NAME)) {
        db.createObjectStore(TAFSIR_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getCachedJuz(juzNumber, reciterId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const key = `juz_${juzNumber}_${reciterId}`;
      const request = store.get(key);
      request.onsuccess = (e) => {
        resolve(e.target.result ? e.target.result.data : null);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.error("IndexedDB read error:", error);
    return null;
  }
}

async function cacheJuz(juzNumber, reciterId, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const key = `juz_${juzNumber}_${reciterId}`;
      const request = store.put({ id: key, data: data, timestamp: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.error("IndexedDB write error:", error);
  }
}

async function getCachedTafsirIndex(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TAFSIR_STORE_NAME, 'readonly');
      const store = transaction.objectStore(TAFSIR_STORE_NAME);
      const request = store.get(key);
      request.onsuccess = (e) => resolve(e.target.result ? e.target.result.data : null);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.error("IndexedDB read error:", error);
    return null;
  }
}

async function cacheTafsirIndex(key, data) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TAFSIR_STORE_NAME, 'readwrite');
      const store = transaction.objectStore(TAFSIR_STORE_NAME);
      const request = store.put({ id: key, data: data, timestamp: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.error("IndexedDB write error:", error);
  }
}

const QuranAPI = {
  // Base URL
  BASE_URL: 'https://api.alquran.cloud/v1',

  // Real per-verse tafsir content (used for the Tafsir drawer): "Tafsir
  // Al-Mukhtasar" (Tafsir Center for Quranic Studies), French, full Quran
  // coverage (verified: all 6236 verses, sourced from quranenc.com's API).
  // Bundled locally as static JSON because quranenc.com's translation API,
  // while CORS-enabled, has no bulk endpoint (114 requests to build it) —
  // fetching it live on every drawer open would be wasteful and slow.
  // Maps surah -> [[ayahFrom, ayahTo, text], ...] (ranges, since consecutive
  // verses sharing identical text are merged to shrink the file).
  TAFSIR_FR_URL: './tafsirFr.json',
  TAFSIR_FR_CACHE_KEY: 'mukhtasar_fr_v2',

  _tafsirFrPromise: null,

  async _loadTafsirRanges(url, cacheKey) {
    const cached = await getCachedTafsirIndex(cacheKey);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Tafsir fetch failed: ${url}`);
    const data = await res.json();
    await cacheTafsirIndex(cacheKey, data);
    return data;
  },

  async fetchTafsirFrRanges() {
    if (!this._tafsirFrPromise) {
      this._tafsirFrPromise = this._loadTafsirRanges(this.TAFSIR_FR_URL, this.TAFSIR_FR_CACHE_KEY);
    }
    return this._tafsirFrPromise;
  },

  /**
   * Looks up the tafsir text covering a given surah:ayah in a ranges map
   * returned by fetchTafsirFrRanges. Returns null if the surah/verse isn't covered.
   */
  findTafsirText(ranges, surahNum, ayahNum) {
    const list = ranges[String(surahNum)];
    if (!list) return null;
    for (const [from, to, text] of list) {
      if (ayahNum >= from && ayahNum <= to) return text;
    }
    return null;
  },

  // Tafsir Ibn Kathir (Arabic), full Quran, classical reference commentary —
  // shown as an alternate source alongside the French Al-Mukhtasar. Fetched
  // on demand per surah (some surahs run several MB, far too big to bundle)
  // from spa5k/tafsir_api via jsDelivr (CORS-enabled), pinned to a fixed
  // commit so an upstream change can't silently alter/break it. Cached per
  // surah in IndexedDB after first fetch.
  IBN_KATHIR_COMMIT: '05d5ba765d77c6ca6d43c30f0e1c273deb137454',
  _ibnKathirSurahPromises: {},

  async fetchIbnKathirSurah(surahNum) {
    if (this._ibnKathirSurahPromises[surahNum]) return this._ibnKathirSurahPromises[surahNum];
    const cacheKey = `ibn_kathir_ar_surah_${surahNum}`;
    this._ibnKathirSurahPromises[surahNum] = (async () => {
      const cached = await getCachedTafsirIndex(cacheKey);
      if (cached) return cached;

      const url = `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@${this.IBN_KATHIR_COMMIT}/tafsir/ar-tafsir-ibn-kathir/${surahNum}.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Ibn Kathir fetch failed for surah ${surahNum}`);
      const json = await res.json();
      const ayahs = Array.isArray(json) ? json : (json.ayahs || []);

      const byAyah = {};
      ayahs.forEach((item) => {
        if (item.text && item.text.trim()) byAyah[item.ayah] = item.text;
      });

      await cacheTafsirIndex(cacheKey, byAyah);
      return byAyah;
    })();
    return this._ibnKathirSurahPromises[surahNum];
  },

  // Tafsir Al-Muyassar (Arabic) — concise, modern, verse-by-verse, from
  // King Fahd Complex. Much shorter per verse than Ibn Kathir, so a whole
  // Juz concatenated reads like an actual summary rather than a wall of
  // text. Served directly by api.alquran.cloud (same CORS-enabled host
  // already used for Quran text/translation/audio), one request per Juz.
  _muyassarJuzPromises: {},

  async fetchJuzTafsirMuyassar(juzNumber) {
    if (this._muyassarJuzPromises[juzNumber]) return this._muyassarJuzPromises[juzNumber];
    const cacheKey = `muyassar_ar_juz_${juzNumber}`;
    this._muyassarJuzPromises[juzNumber] = (async () => {
      const cached = await getCachedTafsirIndex(cacheKey);
      if (cached) return cached;

      const res = await fetch(`${this.BASE_URL}/juz/${juzNumber}/ar.muyassar`);
      if (!res.ok) throw new Error(`Tafsir Muyassar fetch failed for juz ${juzNumber}`);
      const json = await res.json();
      const ayahs = json.data.ayahs;

      // Grouped by surah, in order, so the summary reads as one surah's
      // worth of commentary at a time rather than a flat verse list.
      const bySurah = [];
      let currentSurahNum = null;
      ayahs.forEach((ayah) => {
        if (!ayah.text || !ayah.text.trim()) return;
        if (ayah.surah.number !== currentSurahNum) {
          currentSurahNum = ayah.surah.number;
          bySurah.push({ surahName: ayah.surah.name, surahNumber: currentSurahNum, verses: [] });
        }
        bySurah[bySurah.length - 1].verses.push({ numberInSurah: ayah.numberInSurah, text: ayah.text });
      });

      await cacheTafsirIndex(cacheKey, bySurah);
      return bySurah;
    })();
    return this._muyassarJuzPromises[juzNumber];
  },

  // Curated list of popular reciters
  getReciters() {
    return [
      { id: 'ar.minshawi', name: 'Siddiq Al-Minshawi', style: 'Murattal (Apprentissage)' },
      { id: 'ar.alafasy', name: 'Mishary Rashid Alafasy', style: 'Moderne / Mélodieux' },
      { id: 'ar.alhusary', name: 'Mahmoud Al-Husary', style: 'Classique / Tajwid Précis' },
      { id: 'ar.abdulbasitmurattal', name: 'Abdul Basit', style: 'Murattal' },
      { id: 'ar.hudhaify', name: 'Ali Al-Huthaify', style: 'Lent / Méditatif' }
    ];
  },

  /**
   * Fetches and merges all text, translation, and audio content for a specific Juz.
   * Checks IndexedDB cache first.
   * @param {number} juzNumber 
   * @param {string} reciterId 
   * @returns {Promise<Object>} Formatted Juz data
   */
  async fetchJuz(juzNumber, reciterId = 'ar.minshawi') {
    // 1. Try to read from local cache first
    const cachedData = await getCachedJuz(juzNumber, reciterId);
    if (cachedData) {
      console.log(`[IndexedDB Cache] Loaded Juz ${juzNumber} (${reciterId}) from local storage.`);
      return cachedData;
    }

    try {
      console.log(`[API Fetch] Fetching Juz ${juzNumber} with reciter ${reciterId} from network...`);
      
      // Parallel fetches for performance
      const [arRes, frRes, audioRes, transRes] = await Promise.all([
        fetch(`${this.BASE_URL}/juz/${juzNumber}/quran-uthmani`),
        fetch(`${this.BASE_URL}/juz/${juzNumber}/fr.hamidullah`),
        fetch(`${this.BASE_URL}/juz/${juzNumber}/${reciterId}`),
        fetch(`${this.BASE_URL}/juz/${juzNumber}/en.transliteration`).catch(() => null)
      ]);

      if (!arRes.ok || !frRes.ok || !audioRes.ok) {
        throw new Error("Erreur lors de la récupération des données du Coran.");
      }

      const arJson = await arRes.json();
      const frJson = await frRes.json();
      const audioJson = await audioRes.json();
      
      let transJson = null;
      if (transRes && transRes.ok) {
        transJson = await transRes.json();
      }

      const arAyahs = arJson.data.ayahs;
      const frAyahs = frJson.data.ayahs;
      const audioAyahs = audioJson.data.ayahs;
      const transAyahs = transJson ? transJson.data.ayahs : null;

      // Group ayahs by Surah
      const surahsMap = {};

      arAyahs.forEach((ayah, index) => {
        const surahNum = ayah.surah.number;
        const frAyah = frAyahs[index];
        const audioAyah = audioAyahs[index];
        const transAyah = transAyahs ? transAyahs[index] : null;

        if (!surahsMap[surahNum]) {
          surahsMap[surahNum] = {
            number: surahNum,
            nameAr: ayah.surah.name,
            nameFr: ayah.surah.englishName,
            translationName: ayah.surah.englishNameTranslation,
            verses: []
          };
        }

        surahsMap[surahNum].verses.push({
          number: ayah.number, // global verse index (1-6236)
          numberInSurah: ayah.numberInSurah,
          textAr: ayah.text,
          translation: frAyah.text,
          transliteration: transAyah ? transAyah.text : '',
          audio: audioAyah.audio,
          page: ayah.page
        });
      });

      const result = {
        juzNumber: juzNumber,
        surahs: Object.values(surahsMap)
      };

      // 3. Save to local cache for future offline use
      await cacheJuz(juzNumber, reciterId, result);
      console.log(`[IndexedDB Cache] Successfully saved Juz ${juzNumber} (${reciterId}) locally.`);

      return result;

    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = QuranAPI;
} else {
  window.QuranAPI = QuranAPI;
}
