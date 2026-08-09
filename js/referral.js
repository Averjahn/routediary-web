import { getSetting, setSetting } from './db.js';

/**
 * Приглашения: свой код, ссылка для друга, запоминание того, кто пригласил.
 *
 * Важное ограничение, которое видно и в интерфейсе: приложение не имеет
 * сервера и принципиально ничего никуда не отправляет. Значит, посчитать
 * переходы по ссылке негде — устройство приглашающего просто не узнает,
 * что кто-то установил приложение. Здесь работает то, что честно работает
 * без сервера: код генерируется и живёт локально, уходит в ссылку и QR,
 * а на устройстве приглашённого запоминается, кто его позвал. Если сервер
 * когда-нибудь появится (он же нужен для синхронизации), связка «кто кого»
 * уже будет собрана и её останется только сверить.
 */

const CODE_KEY = 'referralCode';
const INVITED_BY_KEY = 'invitedBy';
const PARAM = 'ref';

/** Канонический адрес приложения. Ссылка с localhost другу бесполезна. */
export const APP_URL = 'https://averjahn.github.io/routediary-web/';

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

/** Код этого устройства. Создаётся один раз и больше не меняется. */
export async function getReferralCode() {
  const saved = await getSetting(CODE_KEY);
  if (saved) return saved;
  const code = generateCode();
  await setSetting(CODE_KEY, code);
  return code;
}

/** Ссылка-приглашение с кодом этого устройства. */
export async function getShareUrl() {
  return `${APP_URL}?${PARAM}=${await getReferralCode()}`;
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
