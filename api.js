// IndexedDB Helpers for local persistence
const DB_NAME = 'WirdQuranDB';
const DB_VERSION = 1;
const STORE_NAME = 'juzs';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

const QuranAPI = {
  // Base URL
  BASE_URL: 'https://api.alquran.cloud/v1',

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
