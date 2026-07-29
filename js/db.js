// Тонкая обёртка над IndexedDB. Схема повторяет ios/Sources/Models/Entities.swift.
const DB_NAME = 'routediary';
const DB_VERSION = 1;

const STORES = {
  trackPoints: { keyPath: 'id', indexes: [['tripId', 'tripId'], ['timestamp', 'timestamp'], ['dayKey', 'dayKey']] },
  trips: { keyPath: 'id', indexes: [['dayKey', 'dayKey'], ['startTime', 'startTime']] },
  vehicles: { keyPath: 'id', indexes: [] },
  refuels: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId'], ['date', 'date']] },
  expenses: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId'], ['date', 'date']] },
  expenseTemplates: { keyPath: 'id', indexes: [] },
  maintenanceItems: { keyPath: 'id', indexes: [] },
  plannedActivities: { keyPath: 'id', indexes: [['dayKey', 'dayKey']] },
  settings: { keyPath: 'key', indexes: [] },
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
          for (const [idxName, idxKey] of cfg.indexes) store.createIndex(idxName, idxKey, { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

export const DB = {
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  },

  async putMany(storeName, values) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      let remaining = values.length;
      if (remaining === 0) return resolve();
      for (const v of values) {
        const req = store.put(v);
        req.onsuccess = () => { if (--remaining === 0) resolve(); };
        req.onerror = () => reject(req.error);
      }
    });
  },

  async get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.index(indexName).getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};

// Настройки (key/value) — обёртка поудобнее.
export async function getSetting(key, fallback) {
  const row = await DB.get('settings', key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  return DB.put('settings', { key, value });
}
