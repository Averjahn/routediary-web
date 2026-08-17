/**
 * Аккаунт в один клик — без почты, пароля и подтверждений.
 *
 * Как это устроено и почему это не ослабляет шифрование.
 *
 * В нашей схеме пароль никогда не был «секретом, который знает сервер»: он
 * лишь источник энтропии, из которого на устройстве выводится ключ шифрования
 * (kek) и отдельный хеш для входа (authHash). Сервер видит только authHash и
 * зашифрованный мастер-ключ. Значит пароль можно не просить у человека, а
 * сгенерировать — случайные 120 бит стойче любого придуманного пароля, и всё
 * остальное продолжает работать без единого изменения на сервере.
 *
 * Этот случайный секрет и есть «код восстановления». Он хранится на
 * устройстве, поэтому здесь вход не потребуется больше никогда; ввести его
 * руками нужно ровно в одном случае — когда человек заходит со второго
 * устройства или после очистки браузера.
 *
 * Логин выводится из самого кода, а не придумывается: иначе для входа на
 * втором устройстве пришлось бы помнить две вещи вместо одной.
 *
 * Чего это стоит честно: код потерян — доступ потерян. Восстановить его
 * нам нечем, и это прямое следствие того, что сервер не может читать данные.
 * Поэтому код показывается сразу после создания и лежит в настройках.
 */

import { getSetting, setSetting } from './db.js';

// Без 0/O/1/I/5/S и прочих пар, которые путают при переписывании от руки.
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
const GROUPS = 6;
const GROUP_LEN = 4;

const SECRET_KEY = 'quickAccountSecret';

/** Случайный код: 24 знака из 30-буквенного алфавита — около 117 бит. */
export function generateSecret() {
  const total = GROUPS * GROUP_LEN;
  const bytes = crypto.getRandomValues(new Uint8Array(total));
  let out = '';
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % GROUP_LEN === 0) out += '-';
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Пробелы, дефисы и регистр при вводе от руки значения не имеют. */
export function normalizeSecret(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Читаемая форма: группы по четыре знака. */
export function formatSecret(code) {
  const raw = normalizeSecret(code);
  return raw.match(new RegExp(`.{1,${GROUP_LEN}}`, 'g'))?.join('-') || raw;
}

export function isValidSecret(code) {
  const raw = normalizeSecret(code);
  if (raw.length !== GROUPS * GROUP_LEN) return false;
  return [...raw].every(ch => ALPHABET.includes(ch));
}

/**
 * Логин, выводимый из кода.
 *
 * Своя область имён («avtopuls:login:») — чтобы этот хеш нельзя было
 * сопоставить с тем, что выводится из того же кода для входа и шифрования.
 */
export async function loginFor(code) {
  const raw = normalizeSecret(code);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('avtopuls:login:' + raw));
  const hex = [...new Uint8Array(digest)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
  // Домен .invalid зарезервирован стандартом и не существует: адрес заведомо
  // ничей, и его нельзя перепутать с настоящей почтой человека.
  return `id-${hex}@code.invalid`;
}

/** Код этого устройства, если аккаунт заводился в один клик. */
export function savedSecret() {
  return getSetting(SECRET_KEY);
}

export function rememberSecret(code) {
  return setSetting(SECRET_KEY, normalizeSecret(code));
}

export function forgetSecret() {
  return setSetting(SECRET_KEY, null);
}

/**
 * Тихое создание аккаунта при старте приложения.
 *
 * Пользователь не жмёт ничего: устройство само становится аккаунтом, чтобы
 * к моменту покупки уже было, к чему её привязать. Без сети просто молчим —
 * попытка повторится при следующем запуске; приложение офлайновое, и
 * отсутствие аккаунта ничего в нём не ломает.
 *
 * Ошибки глотаются намеренно: фоновое удобство не имеет права показывать
 * человеку ошибки того, о чём он не просил.
 */
export async function ensureAccount() {
  try {
    if (await getSetting('syncToken')) return false;   // уже есть
    const { Sync, deviceLabel } = await import('./syncClient.js');
    const { getLocalCode, getInvitedBy } = await import('./referral.js');
    const code = generateSecret();
    await Sync.register(await loginFor(code), normalizeSecret(code), deviceLabel(),
      { referralCode: await getLocalCode(), invitedBy: await getInvitedBy() });
    await rememberSecret(code);
    return true;
  } catch {
    return false;
  }
}
