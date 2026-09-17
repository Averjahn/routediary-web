/**
 * Две сигнализации за одним экраном: чем они отличаются.
 *
 * Pandora и StarLine отвечают по-разному — у одной состояние приходит
 * объектом «номер машины → состояние», у другой списком машин; у одной
 * возможности блока лежат в features, у другой в списке кнопок. Все эти
 * различия собраны ЗДЕСЬ, чтобы окно управления машиной оставалось одним:
 * иначе подписи и правила подтверждения на двух системах со временем
 * разъедутся, и никто этого не заметит.
 *
 * Модуль чистый: ни сети, ни DOM — только разбор ответов.
 */
import * as pandora from './pandoraState.js';
import * as starline from './starlineState.js';

export const PROVIDER_ORDER = Object.freeze(['pandora', 'starline']);

export const PROVIDERS = Object.freeze({
  pandora: {
    id: 'pandora',
    title: 'Pandora',
    /** Куда ходить: /api/car/<path>/… */
    path: 'pandora',
    state: pandora,
    /** Как часто спрашивать состояние, пока окно открыто. */
    pollMs: 15_000,
    /** Pandora хранит возможности блока в features. */
    capabilitiesOf: (device) => device?.features ?? null,
    /** Ответ на вход: {token, devices}. Пользователя как отдельной сущности нет. */
    fromLogin: (data) => ({ token: data.token, userId: null, devices: data.devices || [] }),
    /** Состояние приходит объектом «номер → состояние». */
    indexState: (data) => (data?.devices && typeof data.devices === 'object' && !Array.isArray(data.devices)
      ? data.devices : {}),
    /** Что послать в запрос состояния. */
    stateBody: (store) => ({ token: store.token }),
  },
  starline: {
    id: 'starline',
    title: 'StarLine',
    path: 'starline',
    state: starline,
    /**
     * Реже, чем у Pandora, и это не осторожность, а арифметика: StarLine
     * разрешает физлицу 1000 запросов в сутки. Опрос раз в 15 секунд съел бы
     * весь лимит за четыре часа, раз в минуту — 1440 запросов, тоже больше
     * дозволенного. Две минуты дают 720 в сутки: остаётся запас на команды
     * и на второе устройство человека.
     */
    pollMs: 120_000,
    /** StarLine перечисляет доступные кнопки блока. */
    capabilitiesOf: (device) => (Array.isArray(device?.controls) ? device.controls : null),
    fromLogin: (data) => ({ token: data.token, userId: data.userId || null, devices: data.devices || [] }),
    /** Состояние приходит списком машин — раскладываем в тот же вид «номер → состояние». */
    indexState: (data) => {
      const out = {};
      for (const d of Array.isArray(data?.devices) ? data.devices : []) {
        if (d && d.id !== undefined && d.id !== null) out[String(d.id)] = d;
      }
      return out;
    },
    stateBody: (store) => ({ token: store.token, userId: store.userId }),
  },
});

export function providerOf(id) {
  return Object.hasOwn(PROVIDERS, String(id)) ? PROVIDERS[String(id)] : null;
}

/** Имя машины для списка: у обеих систем оно называется по-разному. */
export function deviceLabel(device) {
  return device?.name || device?.model || (device?.id !== undefined ? String(device.id) : '');
}

/**
 * Что показать на кнопках этой машины.
 * Возвращает имена команд в порядке, заданном самой системой.
 */
export function commandsFor(providerId, device) {
  const p = providerOf(providerId);
  if (!p) return [];
  return p.state.availableCommands(p.capabilitiesOf(device));
}

/** Нужно ли этой команде второе нажатие. */
export function needsConfirm(providerId, name) {
  const p = providerOf(providerId);
  return Boolean(p && p.state.NEEDS_CONFIRM.has(name));
}

export function summarizeFor(providerId, raw, nowMs) {
  const p = providerOf(providerId);
  return p ? p.state.summarize(raw, nowMs) : null;
}

/**
 * Старая запись о подключении — до того, как систем стало две.
 * Тогда в настройках лежало только подключение к Pandora; выбрасывать его
 * и заставлять человека входить заново незачем.
 */
export function migrateStore(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (stored.provider && providerOf(stored.provider)) return stored;
  if (stored.token) return { provider: 'pandora', userId: null, ...stored };
  return null;
}
