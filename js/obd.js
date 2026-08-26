/**
 * Коды неисправностей, которые машина хранит о себе сама.
 *
 * Зачем это здесь. Всё остальное в приложении — наблюдения снаружи: пробег,
 * расход, «что-то застучало». Коды неисправностей — единственное место, где
 * машина говорит о себе сама, своими словами. «Пропуски зажигания в первом
 * цилиндре» вместо «троит на холодную» — это разница между догадкой и фактом.
 *
 * Что здесь есть и чего намеренно нет.
 *
 * Структура кода (P0301 → система, тип, группа) — это стандарт ISO 15031-6,
 * он одинаков для всех машин, и разобрать его можно всегда, даже если самого
 * кода нет в нашем списке. Поэтому незнакомый код не превращается в «ошибка
 * неизвестна»: система, подсистема и «заводской или общий» читаются из самого
 * номера.
 *
 * Расшифровок конкретных кодов здесь ограниченный набор — самые частые. Это
 * сознательно: выдумывать описание кода, которого не знаешь, нельзя. Лучше
 * честно показать разобранную структуру и сказать «точного описания у нас
 * нет», чем сочинить правдоподобное.
 *
 * Чего здесь нет совсем: ремонтных процедур под конкретную модель. Код
 * говорит, ЧТО не так, а не как это чинить на вашей машине. Причины ниже —
 * это «где обычно ищут», общее для большинства машин, а не инструкция.
 *
 * Заводские коды (вторая цифра 1) у каждой марки свои и в открытом виде не
 * публикуются. Мы их не выдумываем: показываем структуру и говорим, что
 * расшифровка у дилера.
 */

/** Насколько срочно. Порядок важен: чем дальше, тем хуже. */
export const URGENCY = {
  WATCH: 'watch',       // можно ездить, показать при ближайшем обслуживании
  SOON: 'soon',         // в ближайшие дни: дальше будет дороже
  STOP: 'stop',         // ехать нельзя или очень нежелательно
};

/** Кто чинит. Совпадает по смыслу с уровнями в guides.js. */
export const FIX = {
  SELF: 'self',         // посильно в гараже
  SERVICE: 'service',   // нужно оборудование или цена ошибки высока
};

/** Система, к которой относится код: первая буква. */
const SYSTEMS = {
  P: { ru: 'Двигатель и коробка', en: 'Powertrain' },
  C: { ru: 'Шасси', en: 'Chassis' },
  B: { ru: 'Кузов и салон', en: 'Body' },
  U: { ru: 'Электроника и связь блоков', en: 'Network' },
};

/**
 * Группы внутри P-кодов по третьему знаку. Из того же стандарта: это не наша
 * догадка, а часть самой нумерации.
 */
const P_GROUPS = {
  0: { ru: 'Смесеобразование и выпуск', en: 'Fuel, air and emissions' },
  1: { ru: 'Смесеобразование', en: 'Fuel and air metering' },
  2: { ru: 'Форсунки', en: 'Injector circuit' },
  3: { ru: 'Зажигание и пропуски вспышек', en: 'Ignition or misfire' },
  4: { ru: 'Система снижения выбросов', en: 'Emission controls' },
  5: { ru: 'Холостой ход и скорость', en: 'Idle and speed control' },
  6: { ru: 'Блок управления и его цепи', en: 'Computer and output circuits' },
  7: { ru: 'Коробка передач', en: 'Transmission' },
  8: { ru: 'Коробка передач', en: 'Transmission' },
  9: { ru: 'Коробка передач и её электроника', en: 'Transmission control' },
  A: { ru: 'Гибридный привод', en: 'Hybrid propulsion' },
  B: { ru: 'Гибридный привод', en: 'Hybrid propulsion' },
  C: { ru: 'Гибридный привод', en: 'Hybrid propulsion' },
};

const T = (ru, en) => ({ ru, en });

/**
 * Расшифровки частых кодов.
 *
 * `causes` — не диагноз и не порядок действий, а перечень того, где обычно
 * ищут причину, от частого к редкому. Порядок осмысленный: начинать со
 * свечей дешевле, чем с катушки, и куда дешевле, чем с форсунки.
 */
const CODES = {
  // --- Пропуски вспышек ---
  P0300: {
    title: T('Пропуски вспышек в разных цилиндрах', 'Random misfire detected'),
    means: T('Смесь в цилиндрах воспламеняется не каждый раз, причём не в одном конкретном, а в разных.',
             'The mixture is not igniting reliably, and not in one specific cylinder.'),
    causes: [T('Свечи зажигания', 'Spark plugs'), T('Подсос воздуха', 'Vacuum leak'),
             T('Низкое давление топлива', 'Low fuel pressure'), T('Катушки зажигания', 'Ignition coils')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
    // Несгоревшее топливо уходит в выпуск и плавит катализатор — это
    // главная причина, по которой с пропусками не ездят месяцами.
    note: T('С пропусками нельзя ездить долго: несгоревшее топливо уходит в катализатор и разрушает его, а это самая дорогая деталь в выпуске.',
            'Do not drive with misfires for long: unburnt fuel destroys the catalytic converter.'),
  },
  P0301: { cylinder: 1 }, P0302: { cylinder: 2 }, P0303: { cylinder: 3 },
  P0304: { cylinder: 4 }, P0305: { cylinder: 5 }, P0306: { cylinder: 6 },

  // --- Смесь ---
  P0171: {
    title: T('Слишком бедная смесь', 'System too lean (bank 1)'),
    means: T('В смеси не хватает топлива или слишком много воздуха: блок управления добавляет топливо до предела и всё равно не выходит на норму.',
             'Too much air or too little fuel; the ECU is compensating at its limit.'),
    causes: [T('Подсос воздуха во впуске', 'Vacuum leak'), T('Датчик массового расхода воздуха', 'Mass air flow sensor'),
             T('Слабый топливный насос или забитый фильтр', 'Weak fuel pump or clogged filter')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
  },
  P0172: {
    title: T('Слишком богатая смесь', 'System too rich (bank 1)'),
    means: T('Топлива в смеси больше нужного: блок управления убавляет подачу до предела и всё равно не выходит на норму.',
             'Too much fuel; the ECU is trimming at its limit.'),
    causes: [T('Грязный воздушный фильтр', 'Dirty air filter'), T('Датчик кислорода', 'Oxygen sensor'),
             T('Переливающая форсунка', 'Leaking injector')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
  },

  // --- Кислородные датчики и катализатор ---
  P0133: {
    title: T('Медленный отклик датчика кислорода', 'O2 sensor slow response'),
    means: T('Датчик перед катализатором реагирует на изменение смеси медленнее, чем положено. Обычно он просто состарился.',
             'The upstream oxygen sensor reacts too slowly; usually simple ageing.'),
    causes: [T('Изношенный датчик кислорода', 'Worn oxygen sensor'), T('Подсос в выпуске до датчика', 'Exhaust leak before the sensor')],
    urgency: URGENCY.WATCH, fix: FIX.SELF,
  },
  P0420: {
    title: T('Низкая эффективность катализатора', 'Catalyst efficiency below threshold'),
    means: T('Катализатор перестал справляться. Сам по себе он выходит из строя редко — чаще его убивает то, что было до этого: пропуски вспышек или богатая смесь.',
             'The catalytic converter is underperforming, often as a consequence of earlier misfires or a rich mixture.'),
    causes: [T('Изношенный катализатор', 'Worn catalytic converter'), T('Датчик кислорода после катализатора', 'Downstream oxygen sensor'),
             T('Неустранённая причина: пропуски или богатая смесь', 'An unfixed root cause: misfires or rich running')],
    urgency: URGENCY.WATCH, fix: FIX.SERVICE,
    note: T('Меняя катализатор, не устранив причину, вы поменяете его дважды.',
            'Replacing the converter without fixing the root cause means replacing it twice.'),
  },

  // --- Прочее частое ---
  P0128: {
    title: T('Двигатель не выходит на рабочую температуру', 'Coolant thermostat below regulating temperature'),
    means: T('Мотор греется слишком долго или не догревается вовсе. Почти всегда виноват термостат, застрявший открытым.',
             'The engine warms up too slowly — usually a thermostat stuck open.'),
    causes: [T('Термостат', 'Thermostat'), T('Датчик температуры охлаждающей жидкости', 'Coolant temperature sensor')],
    urgency: URGENCY.WATCH, fix: FIX.SELF,
    note: T('Холодный мотор больше изнашивается и ест больше топлива, но ехать можно.',
            'A cold engine wears faster and uses more fuel, but it is drivable.'),
  },
  P0442: {
    title: T('Небольшая утечка в системе улавливания паров топлива', 'Small evaporative leak'),
    means: T('Система, которая ловит пары бензина из бака, где-то подтравливает. На езду не влияет.',
             'The fuel vapour system has a small leak. It does not affect driving.'),
    causes: [T('Неплотно закрытая или изношенная крышка бака', 'Loose or worn fuel cap'),
             T('Трубки и клапан системы улавливания паров', 'EVAP hoses and valve')],
    urgency: URGENCY.WATCH, fix: FIX.SELF,
    note: T('Начните с крышки бака: это самая частая и самая дешёвая причина.',
            'Start with the fuel cap — the most common and cheapest cause.'),
  },
  P0011: {
    title: T('Фазы газораспределения не соответствуют заданным', 'Camshaft position timing over-advanced'),
    means: T('Механизм изменения фаз стоит не там, где его просит блок управления. Часто это следствие грязного или давно не менянного масла.',
             'The variable valve timing is not where the ECU commands; often caused by old or dirty oil.'),
    causes: [T('Уровень и состояние масла', 'Oil level and condition'), T('Клапан управления фазами', 'VVT solenoid'),
             T('Забитые каналы или сетка фильтра', 'Clogged oil passages')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
  },
  P0341: {
    title: T('Датчик положения распредвала врёт', 'Camshaft position sensor range/performance'),
    means: T('Показания датчика распредвала не сходятся с коленвалом. Мотор может плохо заводиться или глохнуть.',
             'Camshaft and crankshaft signals disagree; hard starting or stalling is likely.'),
    causes: [T('Датчик положения распредвала', 'Camshaft position sensor'), T('Проводка и разъём датчика', 'Sensor wiring'),
             T('Растянутая цепь или ремень ГРМ', 'Stretched timing chain or belt')],
    urgency: URGENCY.SOON, fix: FIX.SERVICE,
  },
  P0500: {
    title: T('Нет сигнала скорости', 'Vehicle speed sensor malfunction'),
    means: T('Блок управления не видит скорость. Может не работать спидометр, круиз-контроль и переключения автомата.',
             'The ECU sees no speed signal; speedometer, cruise control and shifting may misbehave.'),
    causes: [T('Датчик скорости', 'Speed sensor'), T('Проводка датчика', 'Sensor wiring'),
             T('Датчик ABS соответствующего колеса', 'The corresponding ABS wheel sensor')],
    urgency: URGENCY.SOON, fix: FIX.SERVICE,
  },
  P0217: {
    title: T('Перегрев двигателя', 'Engine over temperature condition'),
    means: T('Двигатель перегрелся. Это не «лампочка на потом».',
             'The engine has overheated. This is not a warning to postpone.'),
    causes: [T('Уровень охлаждающей жидкости', 'Coolant level'), T('Вентилятор радиатора', 'Radiator fan'),
             T('Термостат', 'Thermostat'), T('Помпа', 'Water pump')],
    urgency: URGENCY.STOP, fix: FIX.SERVICE,
    note: T('Перегретый мотор ведёт головку блока и убивает прокладку. Это ремонт другого порядка цен, чем всё, что его вызвало.',
            'An overheated engine warps the head and destroys the gasket — a far costlier repair than any of its causes.'),
  },
  P0562: {
    title: T('Низкое напряжение бортовой сети', 'System voltage low'),
    means: T('Напряжение ниже нормы. Обычно это генератор или его ремень, реже — умирающий аккумулятор.',
             'System voltage is below normal — usually the alternator or its belt.'),
    causes: [T('Ремень генератора', 'Alternator belt'), T('Генератор', 'Alternator'), T('Аккумулятор', 'Battery'),
             T('Окисленные клеммы', 'Corroded terminals')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
    note: T('Машина может встать там, где остановится: заряда хватит ненадолго.',
            'The car may stop where it stands — the charge will not last.'),
  },
  U0100: {
    title: T('Потеряна связь с блоком управления двигателем', 'Lost communication with ECM/PCM'),
    means: T('Блоки перестали слышать друг друга по внутренней шине. Часто это следствие плохого контакта или севшего аккумулятора.',
             'Control units lost contact over the bus; often a poor connection or a flat battery.'),
    causes: [T('Разъёмы и проводка шины', 'Bus connectors and wiring'), T('Аккумулятор и его клеммы', 'Battery and terminals'),
             T('Сам блок управления', 'The control unit itself')],
    urgency: URGENCY.STOP, fix: FIX.SERVICE,
  },
  C0035: {
    title: T('Датчик скорости левого переднего колеса', 'Left front wheel speed sensor'),
    means: T('ABS не видит одно колесо. Обычная тормозная система работает, а ABS и системы стабилизации отключаются.',
             'ABS cannot read one wheel; normal braking works but ABS and stability control switch off.'),
    causes: [T('Датчик ABS', 'ABS sensor'), T('Загрязнённое или повреждённое кольцо датчика', 'Damaged tone ring'),
             T('Проводка у поворотного кулака', 'Wiring at the knuckle')],
    urgency: URGENCY.SOON, fix: FIX.SERVICE,
    note: T('Тормоза работают, но без ABS: на скользком колёса заблокируются.',
            'Brakes work, but without ABS the wheels will lock on a slippery surface.'),
  },
};

/** Пропуски в конкретном цилиндре: описание общее, меняется только номер. */
function cylinderMisfire(n) {
  return {
    title: T(`Пропуски вспышек в ${n}-м цилиндре`, `Cylinder ${n} misfire detected`),
    means: T(`Смесь в ${n}-м цилиндре воспламеняется не каждый раз. Один конкретный цилиндр — это хорошая новость: искать придётся в трёх деталях, а не во всём моторе.`,
             `Cylinder ${n} is not firing reliably. A single named cylinder narrows the search to a few parts.`),
    causes: [T('Свеча этого цилиндра', 'Spark plug in that cylinder'),
             T('Катушка или провод этого цилиндра', 'Coil or lead for that cylinder'),
             T('Форсунка этого цилиндра', 'Injector for that cylinder'),
             T('Компрессия в этом цилиндре', 'Compression in that cylinder')],
    urgency: URGENCY.SOON, fix: FIX.SELF,
    note: T('Проверить дёшево: поменять свечу и катушку местами с соседним цилиндром и стереть код. Если код переехал на соседний цилиндр — виновата переставленная деталь.',
            'A cheap check: swap the plug and coil with a neighbouring cylinder and clear the code. If the code moves, the swapped part is at fault.'),
  };
}

/** Правильно ли устроен сам номер кода. */
export function isValidCode(code) {
  return /^[PCBU][0-3][0-9A-C][0-9A-F]{2}$/.test(String(code || '').trim().toUpperCase());
}

/**
 * Разбор кода без словаря — по самому его номеру.
 * Работает всегда: структура задана стандартом, а не нашим списком.
 */
export function parseCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!isValidCode(c)) return null;
  const system = c[0];
  // Вторая цифра: 0 — общий для всех машин, 1 — заводской. 2 и 3 зависят
  // от системы, и утверждать про них что-то определённое мы не станем.
  const generic = c[1] === '0';
  const group = system === 'P' ? (P_GROUPS[c[2]] || null) : null;
  return { code: c, system, systemName: SYSTEMS[system], generic, group };
}

/**
 * Полная расшифровка кода.
 *
 * @returns {object|null} null — номер вообще не похож на код.
 *   known=false означает «структуру разобрали, точного описания нет» —
 *   это честный ответ, а не ошибка.
 */
export function describeCode(code) {
  const parsed = parseCode(code);
  if (!parsed) return null;

  let entry = CODES[parsed.code];
  if (entry && entry.cylinder) entry = cylinderMisfire(entry.cylinder);

  if (!entry) {
    return {
      ...parsed,
      known: false,
      // Заводской код без описания — это не «мы не смогли», это «его
      // публикует только производитель». Так и говорим.
      urgency: URGENCY.SOON,
      fix: FIX.SERVICE,
    };
  }
  return { ...parsed, known: true, ...entry };
}

/**
 * Коды из ответа адаптера на команду 03.
 *
 * Формат стандартный: два байта на код. Старшие два бита первого байта —
 * система, следующие два — первая цифра, дальше три шестнадцатеричных знака.
 * Пара 00 00 — это пустое место в ответе, а не код P0000.
 *
 * @param {string} raw ответ адаптера, пробелы и переводы строк не мешают
 * @returns {string[]} коды без повторов, в порядке появления
 */
export function decodeDtcResponse(raw) {
  const text = String(raw || '').toUpperCase();
  // Служебные строки адаптера («NO DATA», «CAN ERROR») отсеиваются сами:
  // маркера ответа 43 в них нет. Отдельной проверки на них тут БЫЛО, и
  // она делала хуже — адаптер часто печатает «SEARCHING...» и следом
  // настоящие коды в той же выдаче, и такой ответ отбрасывался целиком.
  // Нашлось мутационной проверкой: удаление той проверки не сломало ни
  // одного теста, то есть она ничего не защищала, а данные теряла.
  const hex = text.replace(/[^0-9A-F]/g, '');
  // Ответ начинается с 43 — это подтверждение команды 03. Всё до него —
  // эхо команды и служебный мусор, в котором кодов нет.
  const start = hex.indexOf('43');
  if (start < 0) return [];
  let body = hex.slice(start + 2);

  // У многобайтовых ответов идёт счётчик кодов. Отличить его от самого кода
  // надёжно нельзя, поэтому полагаемся на выравнивание по два байта и
  // отбрасываем неполный хвост.
  const codes = [];
  const seen = new Set();
  for (let i = 0; i + 4 <= body.length; i += 4) {
    const b1 = parseInt(body.slice(i, i + 2), 16);
    const b2 = parseInt(body.slice(i + 2, i + 4), 16);
    if (!Number.isFinite(b1) || !Number.isFinite(b2)) continue;
    if (b1 === 0 && b2 === 0) continue;            // пустое место, не код

    const letter = ['P', 'C', 'B', 'U'][(b1 >> 6) & 0b11];
    const first = (b1 >> 4) & 0b11;
    const rest = ((b1 & 0x0F).toString(16) + b2.toString(16).padStart(2, '0')).toUpperCase();
    const code = `${letter}${first}${rest}`;
    if (!seen.has(code)) { seen.add(code); codes.push(code); }
  }
  return codes;
}

/** Самое срочное из списка. Нужно, чтобы одной строкой сказать главное. */
export function worstUrgency(codes) {
  const order = [URGENCY.WATCH, URGENCY.SOON, URGENCY.STOP];
  let worst = null;
  for (const c of codes) {
    const d = describeCode(c);
    if (!d) continue;
    if (worst == null || order.indexOf(d.urgency) > order.indexOf(worst)) worst = d.urgency;
  }
  return worst;
}

export { CODES as _CODES, SYSTEMS as _SYSTEMS };
