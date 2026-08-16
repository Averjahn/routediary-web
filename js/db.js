// Тонкая обёртка над IndexedDB. Схема повторяет ios/Sources/Models/Entities.swift.
const DB_NAME = 'routediary';
// v2: у maintenanceItems появился vehicleId — регламент стал персональным
// для каждой машины, а не общим списком на всё приложение.
// v3: vehicleId появился и у поездки. В гараже теперь может быть несколько
// машин, и пробег каждой считается только по её поездкам.
// v4: у синхронизируемых записей появились updatedAt и признак удаления.
// Без отметки времени нечем разрешать расхождения между устройствами,
// а без «надгробий» удаление на одном телефоне не доехало бы до другого:
// исчезнувшую запись не отличить от ещё не полученной, и она бы вернулась.
// v5: кэш дорожных данных OSM (ограничения скорости и светофоры) по квадратам.
// v6: замеренные светофоры — фазы, которые человек измерил сам.
const DB_VERSION = 7;

/**
 * Хранилища, попадающие в синхронизацию.
 *
 * trackPoints сюда не входят намеренно: точек трека десятки тысяч, и по
 * отдельности они превратили бы обмен в поток мелких записей. Они едут
 * вместе со своей поездкой, одним зашифрованным куском.
 *
 * settings тоже вне списка — тема, язык и единицы принадлежат устройству,
 * а не человеку: странно, если выбор тёмной темы на телефоне перекрасил бы
 * ноутбук. Там же лежит код приглашения, привязанный к устройству.
 */
export const SYNCED_STORES = ['trips', 'vehicles', 'refuels', 'expenses', 'expenseTemplates', 'maintenanceItems', 'incomes'];
const isSynced = (storeName) => SYNCED_STORES.includes(storeName);

const STORES = {
  trackPoints: { keyPath: 'id', indexes: [['tripId', 'tripId'], ['timestamp', 'timestamp'], ['dayKey', 'dayKey']] },
  trips: { keyPath: 'id', indexes: [['dayKey', 'dayKey'], ['startTime', 'startTime'], ['vehicleId', 'vehicleId']] },
  vehicles: { keyPath: 'id', indexes: [] },
  refuels: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId'], ['date', 'date']] },
  expenses: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId'], ['date', 'date']] },
  // Доходы отдельным хранилищем, а не флагом на расходе: всё, что суммирует
  // расходы (диаграммы, итоги), продолжает работать не зная о доходах.
  incomes: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId'], ['date', 'date']] },
  expenseTemplates: { keyPath: 'id', indexes: [] },
  maintenanceItems: { keyPath: 'id', indexes: [['vehicleId', 'vehicleId']] },
  plannedActivities: { keyPath: 'id', indexes: [['dayKey', 'dayKey']] },
  settings: { keyPath: 'key', indexes: [] },
  // Кэш карты, а не данные человека: синхронизации не подлежит и стирается
  // отдельной кнопкой в настройках.
  roadTiles: { keyPath: 'key', indexes: [] },
  // Замеры фаз светофоров. Это данные человека, а не кэш карты, но в
  // синхронизацию пока не входят: формат ещё будет меняться.
  signals: { keyPath: 'id', indexes: [] },
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;

      for (const [name, cfg] of Object.entries(STORES)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: cfg.keyPath });
        } else {
          // Стор уже есть — берём его из транзакции апгрейда, чтобы дописать
          // недостающие индексы существующей базе.
          store = tx.objectStore(name);
        }
        for (const [idxName, idxKey] of cfg.indexes) {
          if (!store.indexNames.contains(idxName)) {
            store.createIndex(idxName, idxKey, { unique: false });
          }
        }
      }

      // Записи регламента, созданные до v2, не привязаны ни к какой машине.
      // Помечаем их, чтобы при первом запуске отдать текущему автомобилю,
      // а не потерять историю замен, которую человек уже вёл.
      if (event.oldVersion > 0 && event.oldVersion < 2) {
        const store = tx.objectStore('maintenanceItems');
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const item = cursor.value;
          if (item.vehicleId === undefined) {
            item.vehicleId = null;   // «ничей» — подхватится в migrateLegacyItems()
            cursor.update(item);
          }
          cursor.continue();
        };
      }

      // Поездки, записанные до v3, сделаны на единственной машине —
      // помечаем их «ничьими», чтобы при первом запуске отдать основной.
      // Просто проставить id здесь нельзя: в транзакции апгрейда его ещё
      // неоткуда взять, машина лежит в другом сторе.
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const store = tx.objectStore('trips');
        store.openCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const trip = cursor.value;
          if (trip.vehicleId === undefined) {
            trip.vehicleId = null;
            cursor.update(trip);
          }
          cursor.continue();
        };
      }

      // Записи, созданные до v4, не имеют отметки времени. Проставляем момент
      // обновления: без неё первая же синхронизация не смогла бы решить, чья
      // версия свежее, и рискнула бы затереть данные с другого устройства.
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        const stamp = Date.now();
        for (const name of SYNCED_STORES) {
          if (!db.objectStoreNames.contains(name)) continue;
          tx.objectStore(name).openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value.updatedAt === undefined) {
              cursor.update({ ...cursor.value, updatedAt: stamp });
            }
            cursor.continue();
          };
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

/** Физическое удаление — без следа и без уведомления других устройств. */
async function hardDelete(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Скрытая от приложения запись: удалённая либо ещё не разрешённая к показу. */
const isTombstone = (row) => !!row?.deleted;
const visible = (rows) => rows.filter(row => !isTombstone(row));

export const DB = {
  /**
   * @param {object} [options]
   * @param {boolean} [options.stamp=true] проставить время изменения.
   *   Синхронизация ставит false: у пришедшей записи уже есть своё время,
   *   и подмена его на текущее сделала бы чужую правку «самой свежей»,
   *   после чего она затирала бы более новую версию на других устройствах.
   */
  async put(storeName, value, { stamp = true } = {}) {
    const row = (stamp && isSynced(storeName)) ? { ...value, updatedAt: Date.now() } : value;
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(row);
      req.onsuccess = () => resolve(row);
      req.onerror = () => reject(req.error);
    });
  },

  async putMany(storeName, values, { stamp = true } = {}) {
    const now = Date.now();
    const rows = (stamp && isSynced(storeName))
      ? values.map(v => ({ ...v, updatedAt: now }))
      : values;
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      let remaining = rows.length;
      if (remaining === 0) return resolve();
      for (const v of rows) {
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
      req.onsuccess = () => resolve(isTombstone(req.result) ? null : (req.result || null));
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(visible(req.result || []));
      req.onerror = () => reject(req.error);
    });
  },

  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.index(indexName).getAll(value);
      req.onsuccess = () => resolve(visible(req.result || []));
      req.onerror = () => reject(req.error);
    });
  },

  /** Всё, включая «надгробия». Нужно только синхронизации. */
  async getAllRaw(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * Удаление.
   *
   * Если запись уже побывала на сервере, физически стереть её нельзя: другое
   * устройство прислало бы её обратно, не отличив удаление от «ещё не видел».
   * Вместо этого остаётся «надгробие» — пустая запись с признаком удаления,
   * которая доедет до остальных устройств и там сотрёт данные.
   *
   * Запись, которую сервер никогда не видел, удаляется по-настоящему: сообщать
   * о ней некому. Так короткие поездки, отброшенные при автотрекинге, не
   * оставляют за собой мусора.
   */
  async delete(storeName, key) {
    if (!isSynced(storeName)) return hardDelete(storeName, key);

    const store = await tx(storeName, 'readwrite');
    const existing = await new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!existing || existing.syncRev === undefined) return hardDelete(storeName, key);

    return DB.put(storeName, {
      [STORES[storeName].keyPath]: key,
      deleted: true,
      syncRev: existing.syncRev,
      syncedAt: existing.syncedAt,
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
