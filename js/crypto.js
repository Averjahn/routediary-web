/**
 * Криптография синхронизации. Всё считается на устройстве.
 *
 * Замысел: сервер получает только шифротекст и слепые идентификаторы. Он не
 * может прочитать ни поездку, ни расход, не может отличить одно от другого
 * и не знает, сколько у человека машин.
 *
 * Из пароля выводится один корень, а из него — три независимые производные:
 *   authHash — уходит на сервер вместо пароля (сервер хеширует её ещё раз);
 *   kek      — распечатывает мастер-ключ, устройство не покидает;
 *   —
 * и уже из мастер-ключа:
 *   encKey   — шифрует содержимое записей;
 *   macKey   — превращает «хранилище:id» в слепой идентификатор.
 *
 * Мастер-ключ случайный и запечатывается ключом из пароля. Поэтому смена
 * пароля — это перезапечатывание одной короткой строки, а не перешифровка
 * всего архива. Обратная сторона: пароль знает только человек, и забытый
 * пароль означает потерянные данные. Восстановления нет и быть не может —
 * иначе ключ был бы у сервера.
 */

const PBKDF2_ITERATIONS = 600_000;   // рекомендация OWASP для PBKDF2-SHA256
const GCM_NONCE_BYTES = 12;

const utf8 = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Случайная соль KDF для нового аккаунта. */
export function newKdfSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Растяжение пароля и расщепление на независимые производные.
 *
 * Дорогая часть (PBKDF2) выполняется один раз, дальше дешёвый HKDF: считать
 * PBKDF2 дважды с разными солями значило бы удвоить и без того секундную
 * задержку входа без выигрыша в стойкости.
 */
export async function deriveFromPassword(password, kdfSaltHex) {
  const material = await crypto.subtle.importKey(
    'raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);

  const root = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: utf8.encode(kdfSaltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material, 256);

  const rootKey = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const expand = (info, length) => crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) },
    rootKey, length);

  const authBits = await expand('avtopuls:auth', 256);
  const kekBits = await expand('avtopuls:kek', 256);

  const kek = await crypto.subtle.importKey(
    'raw', kekBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  return { authHash: toHex(new Uint8Array(authBits)), kek };
}

/** Новый мастер-ключ. Случайный и ни от чего не зависящий: пароль меняется, он — нет. */
export function newMasterKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function wrapMasterKey(kek, masterKey) {
  const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, masterKey);
  return toBase64(new Uint8Array([...nonce, ...new Uint8Array(sealed)]));
}

/**
 * Распечатывание мастер-ключа. Неверный пароль здесь и обнаруживается:
 * AES-GCM проверяет целостность, и подделка не расшифруется.
 */
export async function unwrapMasterKey(kek, wrappedB64) {
  const raw = fromBase64(wrappedB64);
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, GCM_NONCE_BYTES) }, kek, raw.slice(GCM_NONCE_BYTES));
  return new Uint8Array(opened);
}

/** Рабочие ключи из мастер-ключа: один шифрует, другой слепит идентификаторы. */
export async function deriveWorkKeys(masterKey) {
  const rootKey = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
  const derive = (info, algorithm, usages) => crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8.encode(info) },
    rootKey, algorithm, false, usages);

  return {
    encKey: await derive('avtopuls:enc', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    macKey: await derive('avtopuls:mac', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
  };
}

/**
 * Слепой идентификатор записи.
 *
 * Сервер должен уметь отличать одну запись от другой, чтобы обновлять её на
 * месте, но не должен понимать, что это. HMAC на мастер-ключе даёт стабильный
 * идентификатор, по которому нельзя ни восстановить исходный id, ни понять,
 * поездка это или расход, ни сопоставить записи разных аккаунтов.
 */
export async function blindKeyId(macKey, store, id) {
  const mac = await crypto.subtle.sign('HMAC', macKey, utf8.encode(`${store}:${id}`));
  return toHex(new Uint8Array(mac));
}

export async function encryptJson(encKey, value) {
  const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, encKey, utf8.encode(JSON.stringify(value)));
  return toBase64(new Uint8Array([...nonce, ...new Uint8Array(sealed)]));
}

export async function decryptJson(encKey, payloadB64) {
  const raw = fromBase64(payloadB64);
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, GCM_NONCE_BYTES) }, encKey, raw.slice(GCM_NONCE_BYTES));
  return JSON.parse(new TextDecoder().decode(opened));
}
