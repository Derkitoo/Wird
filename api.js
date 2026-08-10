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

  // Real per-verse tafsir content (used for the Tafsir drawer), sourced from
  // Quranpedia (api.quranpedia.net) and bundled locally as static JSON since
  // that API sends no CORS headers and can't be called directly from the browser.
  // Each file maps surah -> [[ayahFrom, ayahTo, text], ...] (ranges, since a
  // single commentary block often covers several consecutive verses).
  // tafsirFr.json = "Tafsir Al-Mukhtasar" (French) — real text for surahs 1-29
  // only; the source translation is unfinished beyond that (verified empty).
  // tafsirAr.json = "Taysir at-Tafsir" by Al-Qattan (Arabic) — covers the
  // whole Quran, used as an honest, clearly-labeled fallback when no French
  // text exists for a verse.
  TAFSIR_FR_URL: './tafsirFr.json',
  TAFSIR_AR_URL: './tafsirAr.json',
  TAFSIR_FR_CACHE_KEY: 'mukhtasar_fr_v1',
  TAFSIR_AR_CACHE_KEY: 'taysir_ar_v1',

  _tafsirFrPromise: null,
  _tafsirArPromise: null,

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

  async fetchTafsirArRanges() {
    if (!this._tafsirArPromise) {
      this._tafsirArPromise = this._loadTafsirRanges(this.TAFSIR_AR_URL, this.TAFSIR_AR_CACHE_KEY);
    }
    return this._tafsirArPromise;
  },

  /**
   * Looks up the tafsir text covering a given surah:ayah in a ranges map
   * returned by fetchTafsirFrRanges/fetchTafsirArRanges. Returns null if the
   * surah/verse isn't covered.
   */
  findTafsirText(ranges, surahNum, ayahNum) {
    const list = ranges[String(surahNum)];
    if (!list) return null;
    for (const [from, to, text] of list) {
      if (ayahNum >= from && ayahNum <= to) return text;
    }
    return null;
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
