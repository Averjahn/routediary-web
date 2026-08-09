/**
 * Генератор QR-кода. Байтовый режим, уровень коррекции M, версии 1–10.
 *
 * Зачем свой, а не библиотека: приложение работает офлайн и не тянет ничего
 * с CDN — внешний хост видел бы IP пользователя при каждом открытии экрана.
 * Готовые библиотеки пришлось бы класть в репозиторий целиком ради одной
 * функции, а здесь нужен ровно байтовый режим и ровно один уровень коррекции.
 *
 * Корректность проверяется не на глаз: тест сверяет матрицу с эталонным
 * генератором и отдельно декодирует результат сканером OpenCV —
 * см. tools/test/qr.test.js.
 *
 * Уровень M выбран сознательно: восстанавливает ~15% повреждений. Для кода
 * на экране телефона этого с запасом, а модулей заметно меньше, чем у H,
 * то есть код крупнее и читается быстрее.
 */

// Слов коррекции НА БЛОК для уровня M.
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];

// Структура блоков для M: [блоков в группе 1, слов данных, блоков в группе 2, слов данных].
const BLOCKS = [
  [1, 16, 0, 0], [1, 28, 0, 0], [1, 44, 0, 0], [2, 32, 0, 0], [2, 43, 0, 0],
  [4, 27, 0, 0], [4, 31, 0, 0], [2, 38, 2, 39], [3, 36, 2, 37], [4, 43, 1, 44],
];

// Центры выравнивающих узоров. Версия 1 их не имеет.
const ALIGNMENT = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

// Готовые 15-битные строки информации о формате для уровня M и масок 0–7.
// Считать их на лету незачем: значений всего восемь и они зафиксированы стандартом.
const FORMAT_M = [
  '101010000010010', '101000100100101', '101111001111100', '101101101001011',
  '100010111111001', '100000011001110', '100111110010111', '100101010100000',
];

// 18-битная информация о версии; нужна начиная с версии 7.
const VERSION_BITS = {
  7: '000111110010010100', 8: '001000010110111100',
  9: '001001101010011001', 10: '001010010011010100',
};

// --- Арифметика поля Галуа GF(256) для кодов Рида — Соломона ---

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;   // порождающий полином поля
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/** Порождающий полином для заданного числа слов коррекции. */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    // Умножение на (x + α^i). Коэффициенты хранятся старшей степенью вперёд —
    // в том же порядке, в каком их ждёт деление в ecCodewords.
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                      // вклад множителя x
      next[j + 1] ^= mul(poly[j], EXP[i]);     // вклад множителя α^i
    }
    poly = next;
  }
  return poly;
}

/** Слова коррекции для блока данных. */
function ecCodewords(data, ecCount) {
  const gen = generatorPoly(ecCount);
  const rest = new Uint8Array(data.length + ecCount);
  rest.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = rest[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      rest[i + j] ^= mul(gen[j], factor);
    }
  }
  return Array.from(rest.slice(data.length));
}

// --- Сборка потока данных ---

/** Минимальная версия, вмещающая данные. */
function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    const [b1, d1, b2, d2] = BLOCKS[v - 1];
    const dataCapacity = b1 * d1 + b2 * d2;
    // 4 бита режима + счётчик символов + сами данные + завершитель.
    const countBits = v <= 9 ? 8 : 16;
    const needBits = 4 + countBits + byteLength * 8;
    if (needBits <= dataCapacity * 8) return v;
  }
  // Сообщение техническое, а не для пользователя: ссылки приложения
  // в версии 1–10 укладываются с запасом, сюда можно попасть только по ошибке кода.
  throw new Error('QR: data too long for versions 1-10');
}

function buildDataCodewords(bytes, version) {
  const [b1, d1, b2, d2] = BLOCKS[version - 1];
  const dataCount = b1 * d1 + b2 * d2;
  const countBits = version <= 9 ? 8 : 16;

  let bits = '';
  bits += '0100';                                        // режим: байты
  bits += bytes.length.toString(2).padStart(countBits, '0');
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');

  // Завершитель — до четырёх нулей, но не больше, чем осталось места.
  bits += '0'.repeat(Math.min(4, dataCount * 8 - bits.length));
  // Выравнивание до целого числа байт.
  if (bits.length % 8) bits += '0'.repeat(8 - (bits.length % 8));

  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8), 2));
  // Добивка чередующимися байтами, предписанными стандартом.
  const PAD = [0xEC, 0x11];
  while (words.length < dataCount) words.push(PAD[(words.length - bits.length / 8) % 2]);

  return words;
}

/**
 * Раскладка по блокам и чередование.
 * Слова данных и коррекции идут не подряд, а «столбиками» по блокам —
 * так повреждение куска кода бьёт по всем блокам понемногу.
 */
function interleave(dataWords, version) {
  const [b1, d1, b2, d2] = BLOCKS[version - 1];
  const ecCount = EC_PER_BLOCK[version - 1];

  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) { blocks.push(dataWords.slice(offset, offset + d1)); offset += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(dataWords.slice(offset, offset + d2)); offset += d2; }

  const ecBlocks = blocks.map(b => ecCodewords(b, ecCount));

  const out = [];
  const maxData = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecCount; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// --- Построение матрицы ---

function emptyMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = inside && (ring || core) ? 1 : 0;
    }
  }
}

function placeFunctionPatterns(m, version) {
  const size = m.length;
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);

  // Выравнивающие узоры ставятся ДО синхрополос: проверка «клетка занята»
  // должна отсеивать только три угла с поисковыми узорами. Если полосы уже
  // легли, она глушит и узоры с центром на строке/столбце 6 — а от лишнего
  // или недостающего узора вся раскладка данных дальше уезжает.
  const centers = ALIGNMENT[version - 1];
  for (const r of centers) {
    for (const c of centers) {
      if (m[r][c] !== null) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          m[r + dr][c + dc] = (edge === 1) ? 0 : 1;
        }
      }
    }
  }

  // Синхрополосы. Там, где они проходят сквозь выравнивающий узор, значения
  // совпадают с его собственными — центры всегда чётные, — так что перезапись
  // ничего не портит.
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    m[6][i] = bit;
    m[i][6] = bit;
  }

  m[size - 8][8] = 1;   // всегда тёмный модуль

  // Резервируем места под информацию о формате.
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = 0;
    if (m[i][8] === null) m[i][8] = 0;
  }
  for (let i = size - 8; i < size; i++) {
    if (m[8][i] === null) m[8][i] = 0;
    if (m[i][8] === null) m[i][8] = 0;
  }

  // Информация о версии — с седьмой версии, два блока 3×6.
  if (version >= 7) {
    const bits = VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const bit = Number(bits[17 - i]);
      const r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = bit;
      m[r][size - 11 + c] = bit;
    }
  }
}

/** Карта занятых служебными узорами модулей — туда данные не пишутся. */
function reservedMask(version) {
  const size = version * 4 + 17;
  const m = emptyMatrix(size);
  placeFunctionPatterns(m, version);
  return m.map(row => row.map(v => v !== null));
}

function placeData(m, codewords, reserved) {
  const size = m.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const nextBit = () => {
    if (bitIndex >= totalBits) return 0;   // остаточные модули заполняются нулями
    const bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
    bitIndex++;
    return bit;
  };

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;              // шестой столбец занят синхрополосой
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        m[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Штраф за маску по правилам стандарта: чем ровнее распределены модули,
 * тем надёжнее считывание. Выбираем маску с наименьшим штрафом.
 */
function penalty(m) {
  const size = m.length;
  let score = 0;

  // Правило 1: цепочки одинаковых модулей длиной от пяти.
  for (let i = 0; i < size; i++) {
    for (const line of [m[i], m.map(row => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (line[j] === line[j - 1]) {
          run++;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Правило 2: одноцветные квадраты 2×2.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Правило 3: последовательность, похожая на поисковый узор.
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (line, start, pattern) => pattern.every((p, k) => line[start + k] === p);
  for (let i = 0; i < size; i++) {
    for (const line of [m[i], m.map(row => row[i])]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(line, j, P1) || matches(line, j, P2)) score += 40;
      }
    }
  }

  // Правило 4: перекос доли тёмных модулей от половины.
  let dark = 0;
  for (const row of m) for (const v of row) dark += v;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

function applyFormat(m, maskIndex) {
  const size = m.length;
  const bits = FORMAT_M[maskIndex];
  for (let i = 0; i < 15; i++) {
    // Строки таблицы записаны в том же порядке, в каком биты ложатся в матрицу,
    // — от позиции (8,0) и дальше по кругу, без разворота.
    const bit = Number(bits[i]);
    // Первая копия — вокруг левого верхнего поискового узора.
    if (i < 6) m[8][i] = bit;
    else if (i === 6) m[8][7] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[7][8] = bit;
    else m[14 - i][8] = bit;

    // Вторая копия — продублирована у двух других узоров.
    // Семь битов идут вверх по столбцу, остальные восемь — вправо по строке:
    // модуль (size-8, 8) в неё не входит, он всегда тёмный.
    if (i < 7) m[size - 1 - i][8] = bit;
    else m[8][size - 15 + i] = bit;
  }
}

/**
 * Матрица QR-кода для строки.
 * @returns {number[][]} размер×размер, 1 — тёмный модуль.
 */
export function qrMatrix(text, { mask = null } = {}) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = pickVersion(bytes.length);
  const codewords = interleave(buildDataCodewords(bytes, version), version);

  const reserved = reservedMask(version);
  const size = version * 4 + 17;

  // mask задаётся только тестами, чтобы отделить ошибку раскладки
  // от ошибки выбора маски; в приложении маска всегда выбирается по штрафу.
  const candidates = mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask];

  let best = null;
  for (const maskIndex of candidates) {
    const m = emptyMatrix(size);
    placeFunctionPatterns(m, version);
    placeData(m, codewords, reserved);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && MASKS[maskIndex](r, c)) m[r][c] ^= 1;
      }
    }
    applyFormat(m, maskIndex);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, m };
  }
  return best.m;
}

/**
 * QR-код как SVG. Модули склеиваются в горизонтальные полосы —
 * так элементов в разметке в разы меньше, чем при квадрате на модуль.
 */
export function qrSvg(text, { size = 220, margin = 4, dark = '#000', light = '#fff' } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const total = n + margin * 2;

  const rects = [];
  for (let r = 0; r < n; r++) {
    let run = 0;
    for (let c = 0; c <= n; c++) {
      if (c < n && m[r][c]) { run++; continue; }
      if (run) {
        rects.push(`<rect x="${margin + c - run}" y="${margin + r}" width="${run}" height="1"/>`);
        run = 0;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
    + `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<g fill="${dark}">${rects.join('')}</g></svg>`;
}
