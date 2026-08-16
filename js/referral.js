import { getSetting, setSetting } from './db.js';

/**
 * Приглашения: свой код, ссылка для друга, запоминание того, кто пригласил.
 *
 * Переходы по ссылке не считаются. Сервер синхронизации у приложения теперь
 * есть, но приглашения ему не сообщаются: чтобы вести счёт, устройство
 * приглашённого должно было бы доложить «меня позвал такой-то», а это ровно
 * то отслеживание, которого приложение избегает. Поэтому здесь только то,
 * что работает без единого исходящего запроса: код живёт на устройстве,
 * уходит в ссылку и QR, а у приглашённого запоминается, кто его позвал.
 *
 * Связка «кто кого» тем самым собрана. Если счёт приглашений понадобится,
 * останется добавить её отправку — но это отдельное решение владельца,
 * а не то, что можно включить молча.
 */

const CODE_KEY = 'referralCode';
const INVITED_BY_KEY = 'invitedBy';
const PARAM = 'ref';

// Запасной адрес — основной домен приложения. Нужен, когда приложение
// открыто с localhost или из файла: делиться такой ссылкой бессмысленно.
const FALLBACK_URL = 'https://autocoyc.com/';

/**
 * Адрес, которым делятся.
 *
 * Берётся оттуда, где приложение открыто сейчас: у него два дома — свой
 * сервер и копия на GitHub Pages, — и жёстко зашитый адрес приводил бы
 * к тому, что с одного из них уходит ссылка на другой.
 */
export function appUrl() {
  const isReachable = location.protocol.startsWith('http')
    && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.host);
  if (!isReachable) return FALLBACK_URL;

  // Только каталог приложения: имя файла и параметры в приглашении лишние.
  const path = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${path}`;
}

// Без 0/O/1/I/5/S: код диктуют голосом и переписывают от руки,
// а похожие символы превращают это в лотерею.
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const CODE_LENGTH = 6;

/** Новый код. Случайность берём криптографическую — счётчиков у нас нет. */
function generateCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // Отбрасываем хвост диапазона, иначе первые буквы алфавита выпадали бы чаще.
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    let value = bytes[i];
    while (value >= 256 - (256 % ALPHABET.length)) {
      const retry = new Uint8Array(1);
      crypto.getRandomValues(retry);
      value = retry[0];
    }
    out += ALPHABET[value % ALPHABET.length];
  }
  return out;
}

/**
 * Код приглашения.
 *
 * После входа он принадлежит аккаунту, а не устройству: иначе у человека
 * с телефоном и ноутбуком было бы два разных кода и приглашения делились бы
 * между ними. До входа работает местный код — его можно раздавать сразу,
 * а при регистрации сервер закрепит именно его, если он ещё свободен.
 */
export async function getReferralCode() {
  const fromAccount = await getSetting('syncReferralCode');
  if (fromAccount) return fromAccount;

  const saved = await getSetting(CODE_KEY);
  if (saved) return saved;
  const code = generateCode();
  await setSetting(CODE_KEY, code);
  return code;
}

/** Код, заведённый на этом устройстве до входа. Предлагается серверу при регистрации. */
export async function getLocalCode() {
  return getSetting(CODE_KEY);
}

/** Ссылка-приглашение с кодом этого устройства. */
export async function getShareUrl() {
  return `${appUrl()}?${PARAM}=${await getReferralCode()}`;
}

/** Код пригласившего, если приложение открыли по чужой ссылке. */
export async function getInvitedBy() {
  return (await getSetting(INVITED_BY_KEY)) || null;
}

/**
 * Разбор адреса при запуске: если пришли по приглашению — запоминаем его.
 * Код из адресной строки убираем сразу: он не должен оставаться в истории
 * браузера и уезжать в закладки вместе со ссылкой.
 */
export async function captureIncomingReferral() {
  const url = new URL(location.href);
  const incoming = url.searchParams.get(PARAM);
  if (!incoming) return null;

  url.searchParams.delete(PARAM);
  history.replaceState(null, '', url.pathname + url.search + url.hash);

  const code = incoming.trim().toUpperCase();
  const valid = code.length === CODE_LENGTH && [...code].every(ch => ALPHABET.includes(ch));
  if (!valid) return null;

  // Свой же код по кругу и повторное приглашение поверх прежнего — игнорируем:
  // первым запомнился тот, кто действительно привёл человека в приложение.
  if (code === await getReferralCode()) return null;
  if (await getInvitedBy()) return null;

  await setSetting(INVITED_BY_KEY, code);
  return code;
}
