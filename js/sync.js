import {
  deriveFromPassword, deriveWorkKeys, newKdfSalt, newMasterKey,
  wrapMasterKey, unwrapMasterKey, blindKeyId, encryptJson, decryptJson,
} from './crypto.js';

/**
 * Синхронизация между устройствами.
 *
 * Сервер здесь — почтовый ящик для запечатанных конвертов: он хранит
 * шифротекст и порядковые номера, но не понимает содержимого. Всё, что
 * требует смысла — слияние расхождений, разрешение споров, склейка поездки
 * с её треком, — происходит на устройстве.
 *
 * Расхождения разрешаются по времени изменения: выигрывает более поздняя
 * правка. Для дневника поездок это соответствует ожиданиям — человек
 * исправляет запись, а не редактирует одну и ту же строку с двух телефонов
 * одновременно. При совпадении времени до миллисекунды выбор делается
 * одинаково на всех устройствах, иначе они разошлись бы навсегда.
 */

const SYNCED_STORES = ['trips', 'vehicles', 'refuels', 'expenses', 'expenseTemplates', 'maintenanceItems'];

// Поля учёта синхронизации. В шифротекст не попадают: они говорят о состоянии
// обмена на конкретном устройстве, а не о данных.
const BOOKKEEPING = ['syncRev', 'syncedAt'];

const PUSH_BATCH = 40;
const PUSH_BATCH_BYTES = 6 * 1024 * 1024;

/**
 * Кто побеждает при расхождении.
 *
 * Возвращает 'remote', если применить нужно пришедшую версию, иначе 'local'.
 * При равном времени сравниваются сами данные — произвольный, но одинаковый
 * на всех устройствах критерий. Без него два телефона могли бы бесконечно
 * переубеждать друг друга.
 */
export function pickWinner(local, remote) {
  if (!local) return 'remote';
  const localAt = local.updatedAt || 0;
  const remoteAt = remote.updatedAt || 0;
  if (remoteAt !== localAt) return remoteAt > localAt ? 'remote' : 'local';
  return JSON.stringify(remote) > JSON.stringify(local) ? 'remote' : 'local';
}

/** Запись без служебных полей — то, что уезжает в конверте. */
function stripBookkeeping(row) {
  const copy = { ...row };
  for (const field of BOOKKEEPING) delete copy[field];
  return copy;
}

/**
 * @param {object} deps
 * @param {object} deps.db          — хранилище с интерфейсом DB из db.js
 * @param {Function} deps.request   — транспорт (method, path, body, token) → ответ
 * @param {Function} deps.getSetting
 * @param {Function} deps.setSetting
 */
export function createSync({ db, request, getSetting, setSetting }) {
  let keys = null;        // рабочие ключи, живут в памяти сессии

  async function loadKeys() {
    if (keys) return keys;
    const master = await getSetting('syncMasterKey');
    if (!master) return null;
    keys = await deriveWorkKeys(Uint8Array.from(master));
    return keys;
  }

  async function token() {
    return getSetting('syncToken');
  }

  async function api(method, path, body) {
    return request(method, path, body, await token());
  }

  // --- Учётная запись ---

  async function register(login, password, device, { referralCode, invitedBy } = {}) {
    const kdfSalt = newKdfSalt();
    const { authHash, kek } = await deriveFromPassword(password, kdfSalt);
    const master = newMasterKey();
    const wrappedKey = await wrapMasterKey(kek, master);

    // Код с устройства предлагается серверу к закреплению: его могли раздать
    // до регистрации, и такие ссылки должны продолжать работать.
    const res = await request('POST', '/api/auth/register',
      { login, authHash, kdfSalt, wrappedKey, device, referralCode, invitedBy }, null);
    if (!res.ok) throw new SyncError(res.body?.error || 'register_failed');

    await saveSession(res.body, master);
    await refreshAccount();
    return res.body;
  }

  async function login(loginName, password, device) {
    const params = await request('POST', '/api/auth/params', { login: loginName }, null);
    if (!params.ok) throw new SyncError('server_unreachable');

    const { authHash, kek } = await deriveFromPassword(password, params.body.kdfSalt);
    const res = await request('POST', '/api/auth/login', { login: loginName, authHash, device }, null);
    if (!res.ok) throw new SyncError(res.body?.error || 'bad_credentials');

    // Ключ распечатывается здесь же: если пароль не тот, AES-GCM не сойдётся,
    // и мы узнаем об этом до того, как начнём тянуть чужие данные.
    let master;
    try {
      master = await unwrapMasterKey(kek, res.body.wrappedKey);
    } catch {
      throw new SyncError('bad_credentials');
    }

    await saveSession(res.body, master);
    await refreshAccount();
    return res.body;
  }

  /**
   * Сведения об аккаунте: код приглашения, счётчик приведённых и срок Про.
   *
   * Это единственное, что сервер знает о человеке содержательного, и оно
   * нужно, чтобы показывать награду. Заодно досылается код пригласившего,
   * если ссылку открыли уже после регистрации: сервер примет его один раз.
   */
  async function refreshAccount() {
    const res = await api('GET', '/api/me');
    if (!res.ok) return null;

    const pendingInvite = await getSetting('invitedBy');
    if (pendingInvite && !res.body.invitedBy) {
      const credited = await api('POST', '/api/account/invited-by', { code: pendingInvite });
      if (credited.ok && credited.body?.credited) return refreshAccount();
    }

    await setSetting('syncReferralCode', res.body.referralCode);
    await setSetting('syncInvitedCount', res.body.invitedCount);
    await setSetting('syncProUntil', res.body.proUntil || undefined);
    await setSetting('syncRewardDays', res.body.rewardDays);
    return res.body;
  }

  async function saveSession(body, master) {
    keys = null;
    await setSetting('syncToken', body.token);
    await setSetting('syncLogin', body.login);
    await setSetting('syncMasterKey', Array.from(master));
    // Ревизия нулевая: этот аппарат ещё ничего не получал, даже если сервер
    // уже далеко впереди. Первая же синхронизация подтянет всё.
    if ((await getSetting('syncRev')) === undefined) await setSetting('syncRev', 0);
  }

  async function logout() {
    try { await api('POST', '/api/auth/logout'); } catch { /* сеть не обязана быть */ }
    keys = null;
    for (const key of ['syncToken', 'syncLogin', 'syncMasterKey', 'syncRev', 'syncLastAt',
                       'syncReferralCode', 'syncInvitedCount', 'syncProUntil', 'syncRewardDays']) {
      await setSetting(key, undefined);
    }
  }

  async function status() {
    return {
      login: await getSetting('syncLogin'),
      signedIn: !!(await getSetting('syncToken')),
      lastAt: await getSetting('syncLastAt'),
      pending: (await collectDirty()).length,
      referralCode: await getSetting('syncReferralCode'),
      invitedCount: (await getSetting('syncInvitedCount')) || 0,
      proUntil: await getSetting('syncProUntil'),
      rewardDays: (await getSetting('syncRewardDays')) || 90,
    };
  }

  // --- Обмен ---

  /** Записи, изменённые после последней удачной отправки. */
  async function collectDirty() {
    const dirty = [];
    for (const store of SYNCED_STORES) {
      for (const row of await db.getAllRaw(store)) {
        if (row.syncedAt !== row.updatedAt) dirty.push({ store, row });
      }
    }
    return dirty;
  }

  /** Конверт: поездка едет вместе со своим треком, иначе маршрут потеряется. */
  async function buildPayload(store, row) {
    const data = stripBookkeeping(row);
    if (store === 'trips' && !row.deleted) {
      data.points = await db.getAllByIndex('trackPoints', 'tripId', row.id);
    }
    return data;
  }

  /** Применение пришедшей записи поверх местной. */
  async function applyRemote(store, remote) {
    const points = remote.points;
    const row = { ...remote };
    delete row.points;

    await db.put(store, row, { stamp: false });

    if (store === 'trips') {
      // Точки трека заменяются целиком: они принадлежат поездке и по
      // отдельности не редактируются, поэтому слияние им не нужно.
      const existing = await db.getAllByIndex('trackPoints', 'tripId', remote.id);
      for (const point of existing) await db.delete('trackPoints', point.id);
      if (Array.isArray(points) && points.length) {
        await db.putMany('trackPoints', points, { stamp: false });
      }
    }
  }

  /**
   * Приём изменений с сервера.
   * Возвращает число применённых записей.
   */
  async function pull() {
    const work = await loadKeys();
    if (!work) throw new SyncError('not_signed_in');

    let applied = 0;
    let since = (await getSetting('syncRev')) || 0;

    for (;;) {
      const res = await api('GET', `/api/sync/changes?since=${since}`);
      if (!res.ok) throw new SyncError(res.body?.error || 'pull_failed');

      for (const record of res.body.records) {
        const remote = await decryptJson(work.encKey, record.payload);
        const local = await rawGet(remote.store, remote.id);

        if (pickWinner(local, remote) === 'remote') {
          await applyRemote(remote.store, { ...remote, syncRev: record.rev, syncedAt: remote.updatedAt });
          applied++;
        } else {
          // Наша версия свежее. Запоминаем серверную ревизию, чтобы следующая
          // отправка не выглядела попыткой перезаписать вслепую.
          await db.put(remote.store, { ...local, syncRev: record.rev }, { stamp: false });
        }
        since = Math.max(since, record.rev);
      }

      await setSetting('syncRev', since);
      if (!res.body.hasMore) break;
    }
    return applied;
  }

  async function rawGet(store, id) {
    const rows = await db.getAllRaw(store);
    return rows.find(row => row.id === id) || null;
  }

  /**
   * Отправка изменений.
   *
   * Конфликт означает, что другое устройство успело записать своё. Тогда
   * присланная сервером версия сливается с нашей по общему правилу, и запись
   * уходит повторно — уже с актуальной базовой ревизией. Одного круга хватает:
   * если и он не прошёл, значит на той стороне пишут прямо сейчас, и мы
   * оставляем запись на следующий раз, ничего не теряя.
   */
  async function push() {
    const work = await loadKeys();
    if (!work) throw new SyncError('not_signed_in');

    let sent = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const dirty = await collectDirty();
      if (dirty.length === 0) break;

      let conflicted = false;

      // Пачка набирается и по числу записей, и по объёму: одна поездка с
      // длинным треком весит сотни килобайт, и сорок таких не влезли бы
      // в тело запроса. Размер известен только после шифрования, поэтому
      // конверты запечатываются по одному, а пачка отправляется по заполнении.
      for (const prepared of await batches(dirty, work)) {
        const res = await api('POST', '/api/sync/changes', {
          records: prepared.map(p => ({ keyId: p.keyId, payload: p.payload, baseRev: p.baseRev })),
        });
        if (!res.ok) throw new SyncError(res.body?.error || 'push_failed');

        const byKey = new Map(prepared.map(p => [p.keyId, p]));

        for (const ok of res.body.applied) {
          const item = byKey.get(ok.keyId);
          await db.put(item.store, { ...item.row, syncRev: ok.rev, syncedAt: item.row.updatedAt }, { stamp: false });
          sent++;
        }

        for (const clash of res.body.conflicts) {
          conflicted = true;
          const item = byKey.get(clash.keyId);
          if (!clash.payload) continue;
          const remote = await decryptJson(work.encKey, clash.payload);

          if (pickWinner(item.row, remote) === 'remote') {
            await applyRemote(remote.store, { ...remote, syncRev: clash.rev, syncedAt: remote.updatedAt });
          } else {
            // Наша версия свежее — берём серверную ревизию и пойдём на второй круг.
            await db.put(item.store, { ...item.row, syncRev: clash.rev }, { stamp: false });
          }
        }

        if (res.body.quotaExceeded) throw new SyncError('quota_exceeded');
        await setSetting('syncRev', Math.max((await getSetting('syncRev')) || 0, res.body.rev));
      }

      if (!conflicted) break;
    }
    return sent;

    /** Запечатанные конверты, разложенные по пачкам допустимого размера. */
    async function batches(dirty, work) {
      const out = [];
      let current = [];
      let bytes = 0;

      for (const { store, row } of dirty) {
        const payloadObject = {
          store, id: row.id, updatedAt: row.updatedAt,
          ...(row.deleted ? { deleted: true } : await buildPayload(store, row)),
        };
        const item = {
          store, row,
          keyId: await blindKeyId(work.macKey, store, row.id),
          payload: await encryptJson(work.encKey, payloadObject),
          baseRev: row.syncRev || 0,
        };

        if (current.length && (current.length >= PUSH_BATCH || bytes + item.payload.length > PUSH_BATCH_BYTES)) {
          out.push(current);
          current = [];
          bytes = 0;
        }
        current.push(item);
        bytes += item.payload.length;
      }
      if (current.length) out.push(current);
      return out;
    }
  }

  /**
   * Полный круг. Сначала приём, потом отправка: так свежие чужие правки
   * учитываются до того, как мы предъявим свои, и конфликтов меньше.
   */
  async function syncNow() {
    const received = await pull();
    const sent = await push();
    // Отправка могла поднять ревизию — дотягиваем хвост, чтобы на следующем
    // круге не пришли собственные же записи.
    await pull();
    await refreshAccount();
    await setSetting('syncLastAt', Date.now());
    return { received, sent };
  }

  /** Смена пароля: перезапечатывается только ключ, данные не трогаются. */
  async function changePassword(newPassword) {
    const master = await getSetting('syncMasterKey');
    if (!master) throw new SyncError('not_signed_in');

    const kdfSalt = newKdfSalt();
    const { authHash, kek } = await deriveFromPassword(newPassword, kdfSalt);
    const wrappedKey = await wrapMasterKey(kek, Uint8Array.from(master));

    const res = await api('POST', '/api/account/password', { authHash, kdfSalt, wrappedKey });
    if (!res.ok) throw new SyncError(res.body?.error || 'password_change_failed');
  }

  async function deleteAccount() {
    const res = await api('DELETE', '/api/account');
    if (!res.ok) throw new SyncError(res.body?.error || 'delete_failed');
    await logout();
  }

  return {
    register, login, logout, status, syncNow, pull, push,
    changePassword, deleteAccount, collectDirty, refreshAccount,
  };
}

export class SyncError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
