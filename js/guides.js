import { VEHICLE_CLASS } from './maintenance.js';

/**
 * Руководства по самостоятельной замене расходников.
 *
 * Главное ограничение, из которого всё следует: точную процедуру под
 * конкретную модель — порядок операций, моменты затяжки, артикулы — здесь
 * взять неоткуда. Придуманный момент затяжки колеса или суппорта это не
 * «неточность в тексте», это оторвавшееся колесо. Поэтому:
 *
 *   — руководства привязаны к УЗЛУ и КЛАССУ автомобиля, той же
 *     классификации, по которой уже считается регламент;
 *   — числа, зависящие от модели (объём масла, момент затяжки, тип свечей),
 *     не выдумываются, а отправляют к руководству по эксплуатации;
 *   — работы, которые нельзя делать в гараже без оборудования и опыта,
 *     помечены как сервисные, и объяснено почему. Знать, чего НЕ надо
 *     делать самому, не менее полезно, чем знать порядок действий.
 *
 * Тексты хранятся сразу на двух языках рядом: это содержимое, а не подписи
 * интерфейса, и держать его в общем словаре означало бы утопить словарь.
 */

/** Насколько это посильно своими руками. */
export const LEVEL = {
  DIY: 'diy',           // обычная гаражная работа
  ASSISTED: 'assisted', // можно самому, но нужен помощник, подъёмник или опыт
  SERVICE: 'service',   // в сервис: нужно оборудование или цена ошибки слишком высока
};

/** Инструменты. Отдельным списком, чтобы не повторять названия в каждом шаге. */
export const TOOLS = {
  socket_set: { ru: 'Набор головок с трещоткой', en: 'Socket set with ratchet' },
  torque_wrench: { ru: 'Динамометрический ключ', en: 'Torque wrench' },
  oil_filter_wrench: { ru: 'Съёмник масляного фильтра', en: 'Oil filter wrench' },
  drain_pan: { ru: 'Ёмкость для отработки', en: 'Drain pan' },
  funnel: { ru: 'Воронка', en: 'Funnel' },
  jack: { ru: 'Домкрат', en: 'Jack' },
  stands: { ru: 'Подставки под кузов', en: 'Axle stands' },
  chocks: { ru: 'Противооткатные упоры', en: 'Wheel chocks' },
  gloves: { ru: 'Перчатки', en: 'Gloves' },
  rags: { ru: 'Ветошь', en: 'Rags' },
  spark_socket: { ru: 'Свечная головка с резинкой', en: 'Spark plug socket' },
  feeler: { ru: 'Щуп для зазора', en: 'Feeler gauge' },
  screwdrivers: { ru: 'Отвёртки', en: 'Screwdrivers' },
  pliers: { ru: 'Пассатижи', en: 'Pliers' },
  wire_brush: { ru: 'Щётка по металлу', en: 'Wire brush' },
  piston_tool: { ru: 'Струбцина для поршня суппорта', en: 'Caliper piston compressor' },
  brake_cleaner: { ru: 'Очиститель тормозов', en: 'Brake cleaner' },
  copper_grease: { ru: 'Смазка для направляющих', en: 'Caliper slide grease' },
  multimeter: { ru: 'Мультиметр', en: 'Multimeter' },
};

/**
 * Предупреждения, повторяющиеся в разных работах.
 * Собраны в одном месте, чтобы формулировка о безопасности была одинаковой
 * везде: разнобой в таких текстах читается как необязательность.
 */
const WARN = {
  hot: {
    ru: 'Двигатель и выпуск должны остыть. Масло и охлаждающая жидкость на рабочей температуре обжигают мгновенно.',
    en: 'Let the engine and exhaust cool down. Oil and coolant at operating temperature scald instantly.',
  },
  lift: {
    ru: 'Никогда не лезьте под машину, стоящую только на домкрате. Только подставки под кузов, на ровной твёрдой поверхности, с упорами под колёсами.',
    en: 'Never get under a car held up only by a jack. Use axle stands on firm level ground, with the wheels chocked.',
  },
  torque: {
    ru: 'Момент затяжки берите из руководства по вашей машине. «На глаз» — это либо сорванная резьба, либо открутившееся на ходу.',
    en: 'Take torque figures from your own car’s manual. Guessing means either stripped threads or something coming loose on the move.',
  },
  disposal: {
    ru: 'Отработку не выливайте в землю и канализацию: сдайте на пункт приёма, обычно принимают бесплатно.',
    en: 'Do not pour used fluids on the ground or down a drain: take them to a collection point, usually free.',
  },
  battery_order: {
    ru: 'Снимаем сначала минус, ставим последним. Ключ, коснувшийся кузова при снятом плюсе, — это короткое замыкание и ожог.',
    en: 'Disconnect negative first, reconnect it last. A spanner touching the body with the positive still on means a short and a burn.',
  },
};

/** Всё, что зависит от модели, а не от класса. */
const CHECK_MANUAL = {
  ru: 'Точное значение — в руководстве по эксплуатации вашей машины или на наклейке под капотом.',
  en: 'The exact figure is in your car’s handbook or on the under-bonnet label.',
};

const step = (ru, en, extra = {}) => ({ ru, en, ...extra });

/**
 * Руководства по узлам.
 *
 * `byClass` дописывает или заменяет шаги для конкретного класса машин —
 * там, где разница существенна, а не косметическая.
 */
export const GUIDES = {
  engine_oil: {
    level: LEVEL.DIY,
    minutes: 45,
    difficulty: 2,
    diagram: 'oil',
    tools: ['socket_set', 'oil_filter_wrench', 'drain_pan', 'funnel', 'jack', 'stands', 'chocks', 'gloves', 'rags'],
    parts: {
      ru: ['Масло нужного класса и объёма', 'Масляный фильтр', 'Прокладка сливной пробки'],
      en: ['Oil of the right grade and volume', 'Oil filter', 'Drain plug washer'],
    },
    warnings: [WARN.hot, WARN.lift, WARN.disposal],
    steps: [
      step('Прогрейте двигатель 5–10 минут и заглушите. Тёплое масло сливается полнее, горячее — обжигает.',
           'Warm the engine for 5–10 minutes and switch off. Warm oil drains more completely; hot oil scalds.'),
      step('Поставьте машину ровно, на упоры и подставки. Откройте капот и снимите крышку маслозаливной горловины — так масло сольётся быстрее.',
           'Park level, chock the wheels and use axle stands. Open the bonnet and remove the oil filler cap so the oil drains faster.'),
      step('Подставьте ёмкость под сливную пробку поддона и открутите пробку. Дайте стечь 10–15 минут, пока не пойдёт по каплям.',
           'Put the pan under the sump drain plug and remove the plug. Let it drain 10–15 minutes, until it only drips.',
           { warn: { ru: 'Пробка выпадет вместе с потоком масла — держите её или ловите в ёмкости.', en: 'The plug drops out with the flow — hold on to it or fish it out of the pan.' } }),
      step('Снимите масляный фильтр съёмником. Он тоже полон масла — переверните аккуратно.',
           'Remove the oil filter with the wrench. It is full of oil too — turn it over carefully.'),
      step('Смажьте резиновое кольцо нового фильтра свежим маслом и наживите от руки. Затягивать фильтр ключом не нужно: рукой до касания и ещё три четверти оборота.',
           'Smear fresh oil on the new filter’s rubber seal and fit it by hand. No wrench needed: hand-tight to contact, then about three quarters of a turn.'),
      step('Поставьте новую прокладку на сливную пробку и затяните её. Старую прокладку не используйте повторно — она обмялась и потечёт.',
           'Fit a new washer on the drain plug and tighten. Do not reuse the old washer — it has already crushed and will weep.',
           { manual: true }),
      step('Залейте масло через воронку, немного не доливая до нормы. Дайте стечь пару минут и проверьте щупом — доводите до отметки между MIN и MAX.',
           'Add oil through the funnel, stopping a little short. Wait a couple of minutes and check the dipstick — bring it between MIN and MAX.',
           { manual: true }),
      step('Заведите на минуту. Лампа давления масла должна погаснуть за пару секунд. Заглушите, подождите пять минут, проверьте уровень и осмотрите пробку и фильтр на подтёки.',
           'Start the engine for a minute. The oil pressure light must go out within a couple of seconds. Switch off, wait five minutes, recheck the level and look for leaks at the plug and filter.',
           { warn: { ru: 'Лампа не гаснет — глушите немедленно. Это не «схватится», это сухие вкладыши.', en: 'If the light stays on, switch off at once. It will not “settle” — the bearings are running dry.' } }),
      step('Отметьте замену в приложении, чтобы регламент считал от нового пробега.',
           'Record the change in the app so the schedule counts from the new mileage.'),
    ],
    byClass: {
      [VEHICLE_CLASS.SOVIET_CARB]: {
        note: {
          ru: 'На старых карбюраторных двигателях фильтр часто прикипает: не бейте по нему, а обхватите цепным съёмником ближе к основанию.',
          en: 'On older carburettor engines the filter often seizes: do not hit it, grip it with a chain wrench closer to the base.',
        },
      },
      [VEHICLE_CLASS.DIESEL]: {
        note: {
          ru: 'Дизельное масло чернеет за считаные сотни километров — это норма и не повод менять его чаще положенного.',
          en: 'Diesel oil turns black within a few hundred kilometres — that is normal and not a reason to change it early.',
        },
      },
      [VEHICLE_CLASS.HYBRID]: {
        note: {
          ru: 'У гибрида двигатель может завестись сам в любой момент. Перед работой переведите машину в режим обслуживания или снимите клемму 12 В.',
          en: 'On a hybrid the engine can start on its own at any moment. Put the car in service mode or disconnect the 12 V terminal first.',
        },
      },
    },
  },

  cabin_filter: {
    level: LEVEL.DIY,
    minutes: 15,
    difficulty: 1,
    diagram: 'cabin',
    tools: ['screwdrivers', 'gloves'],
    parts: { ru: ['Салонный фильтр'], en: ['Cabin filter'] },
    steps: [
      step('Найдите фильтр. Чаще всего он за бардачком, реже — под лобовым стеклом со стороны пассажира или под приборной панелью.',
           'Find the filter. Usually behind the glovebox, sometimes under the windscreen scuttle on the passenger side or under the dashboard.',
           { manual: true }),
      step('Освободите доступ: у большинства машин бардачок откидывается вниз, если сжать его боковины или снять ограничитель.',
           'Get access: on most cars the glovebox drops down once you squeeze its sides or release the stop.'),
      step('Запомните направление потока: на торце фильтра нарисована стрелка. Поставленный наоборот фильтр работает хуже и шумит.',
           'Note the airflow direction: there is an arrow on the filter edge. Fitted backwards it works worse and whistles.'),
      step('Выньте старый фильтр, стараясь не высыпать мусор в короб. Пропылесосьте или протрите посадочное место.',
           'Pull the old filter out without tipping debris into the housing. Vacuum or wipe the seat.'),
      step('Поставьте новый по стрелке, закройте крышку и верните бардачок. Включите вентилятор на максимум и убедитесь, что поток вырос.',
           'Fit the new one following the arrow, close the cover and refit the glovebox. Run the blower at full and check the airflow has improved.'),
    ],
  },

  air_filter: {
    level: LEVEL.DIY,
    minutes: 15,
    difficulty: 1,
    diagram: 'air',
    tools: ['screwdrivers', 'socket_set', 'rags'],
    parts: { ru: ['Воздушный фильтр'], en: ['Air filter'] },
    steps: [
      step('Найдите корпус воздушного фильтра — крупная пластиковая коробка, от которой к двигателю идёт толстый гофрированный патрубок.',
           'Find the air box — a large plastic case with a thick corrugated pipe running to the engine.'),
      step('Откиньте защёлки или открутите винты крышки. Придерживайте крышку: под ней бывает натянутый патрубок.',
           'Undo the clips or screws on the lid. Support the lid: the intake hose is often under tension.'),
      step('Выньте фильтр, запомнив, какой стороной он стоял. Протрите короб изнутри влажной ветошью, не продувая пыль внутрь впуска.',
           'Take the filter out, noting which way round it sat. Wipe the box inside with a damp rag; do not blow dust further into the intake.',
           { warn: { ru: 'Не запускайте двигатель со снятым фильтром: во впуск затянет пыль и мусор.', en: 'Do not run the engine with the filter removed: dust and debris get pulled into the intake.' } }),
      step('Поставьте новый фильтр так, чтобы уплотнитель лёг по всему периметру без волн, и закройте крышку. Все защёлки должны сойтись без усилия.',
           'Fit the new filter so the seal sits flat all round, then close the lid. Every clip should meet without forcing.'),
    ],
  },

  spark_plugs: {
    level: LEVEL.DIY,
    minutes: 60,
    difficulty: 3,
    diagram: 'plug',
    tools: ['spark_socket', 'socket_set', 'torque_wrench', 'feeler', 'gloves', 'rags'],
    parts: { ru: ['Свечи зажигания нужного типа', 'При необходимости — смазка для резьбы'], en: ['Spark plugs of the correct type', 'Anti-seize if required'] },
    warnings: [WARN.hot, WARN.torque],
    steps: [
      step('Двигатель должен быть холодным. На горячей головке свеча выкручивается вместе с резьбой — особенно на алюминиевой.',
           'The engine must be cold. On a hot head the plug can bring the threads with it — especially an aluminium head.'),
      step('Снимите декоративную крышку, катушки или высоковольтные провода. Провода помечайте по цилиндрам, иначе порядок работы собьётся.',
           'Remove the engine cover, coils or HT leads. Label the leads by cylinder or you will get the firing order wrong.'),
      step('Продуйте или выметите грязь из свечных колодцев. Всё, что там лежит, при выкручивании упадёт в цилиндр.',
           'Blow or brush the dirt out of the plug wells. Anything left there falls into the cylinder as the plug comes out.'),
      step('Выкручивайте свечи по одной. Идёт туго — заверните обратно на четверть оборота, капните проникающей смазкой и повторите.',
           'Undo the plugs one at a time. If one is tight, turn it back a quarter turn, add penetrating oil and try again.'),
      step('Посмотрите на старые свечи: ровный светло-коричневый налёт — норма; чёрная сажа, масло или оплавленный электрод говорят о неисправности, которую заменой свечей не лечат.',
           'Read the old plugs: an even light-brown deposit is normal; black soot, oil or a melted electrode point to a fault that new plugs will not fix.'),
      step('Проверьте зазор новых свечей щупом, если тип свечей это допускает. Многие современные свечи регулировке не подлежат.',
           'Check the gap on the new plugs with a feeler gauge if the type allows it. Many modern plugs are not adjustable.',
           { manual: true }),
      step('Заворачивайте от руки до упора, затем затягивайте ключом строго по моменту. Перетянутая свеча срывает резьбу в головке — это ремонт другого порядка.',
           'Thread them in by hand all the way, then tighten to the specified torque. An overtightened plug strips the head thread — a repair of a different order entirely.',
           { manual: true }),
      step('Верните катушки и провода на свои цилиндры, заведите и послушайте: троение или ошибка пропусков зажигания означает, что что-то стоит не на месте.',
           'Refit the coils and leads to their own cylinders, start up and listen: a misfire means something is in the wrong place.'),
    ],
    byClass: {
      [VEHICLE_CLASS.SOVIET_CARB]: {
        note: {
          ru: 'На карбюраторных моторах свечи доступны сверху и меняются за полчаса. Заодно осмотрите высоковольтные провода: трещины и пробой видно в темноте.',
          en: 'On carburettor engines the plugs are accessible from above and take half an hour. Check the HT leads while you are there: cracks and arcing show up in the dark.',
        },
      },
      [VEHICLE_CLASS.MODERN_TURBO]: {
        note: {
          ru: 'На турбомоторах свечи часто под впускным коллектором или интеркулером, и работа превращается в разборку пол-отсека. Оцените доступ до покупки свечей.',
          en: 'On turbo engines the plugs often sit under the intake manifold or intercooler, turning the job into half a bay strip-down. Check access before buying plugs.',
        },
      },
    },
  },

  battery: {
    level: LEVEL.DIY,
    minutes: 20,
    difficulty: 1,
    diagram: 'battery',
    tools: ['socket_set', 'wire_brush', 'gloves', 'multimeter'],
    parts: { ru: ['Аккумулятор нужной ёмкости и полярности'], en: ['Battery of the correct capacity and polarity'] },
    warnings: [WARN.battery_order],
    steps: [
      step('Заглушите двигатель и выключите всё потребляющее. Приготовьте коды магнитолы, если она их спрашивает после обесточивания.',
           'Switch the engine off and turn everything off. Have the radio code ready if yours asks for one after a power cut.'),
      step('Снимите клемму «минус», затем «плюс». Отведите провода в стороны, чтобы они не вернулись на клеммы сами.',
           'Disconnect the negative terminal, then the positive. Move the cables aside so they cannot spring back onto the posts.'),
      step('Открутите прижимную планку и выньте аккумулятор. Он тяжёлый и с кислотой внутри — держите ровно, не наклоняя.',
           'Undo the clamp and lift the battery out. It is heavy and full of acid — keep it level.'),
      step('Зачистите клеммы и наконечники щёткой до блеска. Плохой контакт даёт те же симптомы, что и мёртвый аккумулятор.',
           'Clean the posts and clamps to bright metal with the brush. A bad contact gives exactly the same symptoms as a dead battery.'),
      step('Поставьте новый, закрепите планкой, подключите «плюс», затем «минус». Затягивайте до отсутствия качания, не пережимая свинец.',
           'Fit the new one, secure the clamp, connect positive then negative. Tighten until there is no movement, without crushing the soft lead.'),
      step('Заведите и замерьте напряжение на клеммах мультиметром: около 14 вольт на работающем двигателе означает, что генератор заряжает.',
           'Start up and measure the terminal voltage: about 14 volts with the engine running means the alternator is charging.'),
    ],
    byClass: {
      [VEHICLE_CLASS.HYBRID]: {
        note: {
          ru: 'Речь только о батарее 12 В. Высоковольтную батарею гибрида самостоятельно не трогают: там сотни вольт постоянного тока и оранжевые кабели, которые нельзя вскрывать без обучения.',
          en: 'This is about the 12 V battery only. Never touch the hybrid’s high-voltage pack yourself: hundreds of volts DC behind orange cables that must not be opened without training.',
        },
      },
      [VEHICLE_CLASS.ELECTRIC]: {
        note: {
          ru: 'У электромобиля тоже есть батарея 12 В, и меняется она так же. Тяговую батарею обслуживают только в сервисе.',
          en: 'An EV also has a 12 V battery, replaced the same way. The traction pack is service-only.',
        },
      },
    },
  },

  brake_pads_front: {
    level: LEVEL.ASSISTED,
    minutes: 90,
    difficulty: 4,
    diagram: 'brake',
    tools: ['socket_set', 'torque_wrench', 'jack', 'stands', 'chocks', 'piston_tool', 'brake_cleaner', 'copper_grease', 'wire_brush', 'gloves'],
    parts: { ru: ['Комплект колодок на ось', 'Смазка для направляющих', 'При износе — тормозные диски'], en: ['Pad set for the axle', 'Slide pin grease', 'Discs too, if worn'] },
    warnings: [
      WARN.lift, WARN.torque,
      {
        ru: 'Тормоза — единственный узел, ошибка в котором проявляется тогда, когда исправить её уже нельзя. Если что-то не сходится или не уверены — соберите как было и поезжайте в сервис.',
        en: 'Brakes are the one system where a mistake shows up at the moment it can no longer be fixed. If anything does not add up, put it back together and go to a workshop.',
      },
    ],
    steps: [
      step('Колодки меняют ТОЛЬКО парой на ось. Разные колодки слева и справа уводят машину при торможении.',
           'Pads are replaced in axle pairs only. Different pads left and right pull the car under braking.'),
      step('Ослабьте болты колеса на стоящей машине, поднимите домкратом, поставьте подставки и снимите колесо.',
           'Slacken the wheel bolts with the car on the ground, jack it up, fit axle stands and take the wheel off.'),
      step('Откройте бачок тормозной жидкости и отберите часть шприцем: при вдавливании поршня уровень поднимется и может перелиться.',
           'Open the brake fluid reservoir and draw some out with a syringe: pushing the piston back raises the level and it can overflow.'),
      step('Открутите направляющие суппорта и снимите скобу. Не вешайте суппорт на шланг — подвяжите его к пружине.',
           'Undo the caliper slide bolts and lift the caliper off. Never hang it by the hose — tie it up to the spring.',
           { warn: { ru: 'Тормозной шланг, нагруженный весом суппорта, рвётся изнутри незаметно.', en: 'A hose loaded with the caliper’s weight tears internally without showing it.' } }),
      step('Выньте старые колодки, запомнив расположение антискрипных пластин и пружинок. Осмотрите диск: борозды, синева и выработка по краю означают, что менять надо и его.',
           'Take the old pads out, noting where the anti-rattle shims and springs sit. Inspect the disc: grooves, blueing and a lip at the edge mean it needs replacing too.'),
      step('Очистите посадочные места щёткой и очистителем. Направляющие пальцы вытащите, протрите и смажьте специальной смазкой — закисшая направляющая изнашивает колодки клином.',
           'Clean the seats with the brush and brake cleaner. Pull the slide pins, wipe them and grease with the proper compound — a seized pin wears the pads at an angle.'),
      step('Вдавите поршень струбциной ровно, следя за уровнем в бачке. На многих задних суппортах поршень не вдавливается, а вкручивается — не давите силой.',
           'Press the piston back squarely with the compressor, watching the reservoir. Many rear calipers need the piston wound in, not pressed — do not force it.'),
      step('Поставьте новые колодки с пластинами на места, соберите суппорт и затяните направляющие по моменту.',
           'Fit the new pads with their shims, reassemble the caliper and torque the slide bolts.',
           { manual: true }),
      step('Поставьте колесо, затяните болты крест-накрест по моменту на опущенной машине. Долейте жидкость до метки.',
           'Refit the wheel and torque the bolts crosswise with the car on the ground. Top the fluid up to the mark.',
           { manual: true }),
      step('ДО поездки прокачайте педаль 5–10 раз до твёрдости: первым нажатием поршни подводят колодки к диску. Первые сотни метров тормозите плавно — колодкам нужна приработка.',
           'BEFORE driving, pump the pedal 5–10 times until firm: the first press brings the pads to the disc. Brake gently for the first few hundred metres while the pads bed in.',
           { warn: { ru: 'Если тронуться без прокачки, первое нажатие педали уйдёт в пол.', en: 'Drive off without pumping and the first press of the pedal goes to the floor.' } }),
    ],
  },

};

/**
 * Работы, которые не стоит делать в гараже. Для каждой — причина: без неё
 * совет «идите в сервис» выглядит отпиской, а человек всё равно полезет.
 */
export const SERVICE_ONLY = {
  timing_belt: {
    ru: 'Ошибка в метках ГРМ на моторе с натягом означает встречу клапанов с поршнями и капитальный ремонт. Нужны фиксаторы валов и опыт.',
    en: 'Getting the timing marks wrong on an interference engine means the valves meet the pistons and the engine needs rebuilding. Needs cam locking tools and experience.',
  },
  brake_fluid: {
    ru: 'Замена требует прокачки контуров в правильном порядке, а на машинах с ABS — прокачки блока сканером. Воздух в системе — это отказ тормозов.',
    en: 'Requires bleeding the circuits in the right order, and on ABS cars cycling the pump with a scan tool. Air in the system means brake failure.',
  },
  coolant: {
    ru: 'Систему нужно удалить воздух из системы, иначе образуется пробка, и двигатель перегреется при исправном термостате и полном расширительном бачке.',
    en: 'The system has to be purged of air, otherwise an airlock forms and the engine overheats with a healthy thermostat and a full expansion tank.',
  },
  shock_absorbers: {
    ru: 'Для стоек нужны стяжки пружин. Сорвавшаяся пружина в сжатом состоянии — травма, а не неудобство.',
    en: 'Struts need spring compressors. A compressed spring that lets go causes an injury, not an inconvenience.',
  },
  caliper_service: {
    ru: 'Переборка суппорта — работа с гидравликой тормозов и последующей прокачкой. Ошибка проявится при экстренном торможении.',
    en: 'Overhauling a caliper means opening the brake hydraulics and bleeding afterwards. A mistake shows up during an emergency stop.',
  },
  transmission_oil: {
    ru: 'Порядок и объём отличаются даже у соседних комплектаций, у многих АКПП нужен контроль температуры при заливке. Ошибка стоит дороже коробки.',
    en: 'The procedure and volume differ even between trim levels, and many automatics need the fluid level set at a specific temperature. A mistake costs more than the gearbox.',
  },
  transfer_case_oil: {
    ru: 'Требует подъёмника и точного объёма — недолив раздатки убивает её без предупреждающих признаков.',
    en: 'Needs a lift and an exact volume — an underfilled transfer case dies without warning signs.',
  },
  diff_oil: {
    ru: 'Нужен подъёмник и правильный тип масла с присадками. Гипоидная передача не прощает неподходящего масла.',
    en: 'Needs a lift and the correct additive package. A hypoid final drive does not tolerate the wrong oil.',
  },
  reducer_oil: {
    ru: 'Редуктор электромобиля обслуживают в сервисе: доступ обычно требует снятия защиты и работы рядом с высоковольтными компонентами.',
    en: 'An EV reduction gear is serviced professionally: access usually means removing shielding and working near high-voltage components.',
  },
  power_steering_fluid: {
    ru: 'Требует прокачки системы без завоздушивания насоса. Работа насоса «на сухую» выводит его из строя за минуты.',
    en: 'Requires bleeding without letting air into the pump. Running the pump dry destroys it within minutes.',
  },
  fuel_filter: {
    ru: 'В магистрали остаётся давление, а на многих машинах фильтр стоит в баке. Бензин под давлением рядом с горячим выпуском — не гаражная работа.',
    en: 'The line stays pressurised and on many cars the filter sits inside the tank. Pressurised fuel next to a hot exhaust is not a driveway job.',
  },
  glow_plugs: {
    ru: 'Свечи накала прикипают и обламываются в головке. Извлечение обломка — работа со специнструментом, иногда со снятием головки.',
    en: 'Glow plugs seize and snap off in the head. Extracting the broken part needs special tools, sometimes removing the head.',
  },
  tires: {
    ru: 'Нужен шиномонтажный станок и балансировка. Несбалансированное колесо разбивает подвеску и рулевое.',
    en: 'Needs a tyre machine and balancing. An unbalanced wheel destroys suspension and steering.',
  },
  wheel_alignment: {
    ru: 'Регулировка делается на стенде по фактическим углам. «По рулю» выставить схождение нельзя.',
    en: 'Alignment is set on a rig against measured angles. You cannot set toe by eyeballing the steering wheel.',
  },
  carbon_cleaning: {
    ru: 'Требует специального оборудования, а на прямом впрыске — снятия впускного коллектора и механической очистки клапанов.',
    en: 'Needs dedicated equipment, and on direct injection engines the intake manifold has to come off for mechanical cleaning.',
  },
  dpf: {
    ru: 'Сажевый фильтр обслуживают на стенде промывкой или заменой; принудительная регенерация запускается сканером.',
    en: 'A DPF is cleaned on a bench or replaced; forced regeneration is started with a scan tool.',
  },
  accessory_belt: {
    ru: 'На части моторов ремень навесного натягивается автоматическим натяжителем и меняется просто, на других — со снятием опоры двигателя. Оцените доступ: если натяжитель не виден, это сервисная работа.',
    en: 'On some engines the accessory belt has an automatic tensioner and is simple; on others the engine mount has to come out. Judge the access: if you cannot see the tensioner, it is a workshop job.',
  },
  brake_pads_rear: {
    ru: 'Задние суппорты часто совмещены с ручным тормозом: поршень вкручивается, а на электромеханическом стояночном тормозе его нужно отводить сканером. Без этого колодки не встанут.',
    en: 'Rear calipers are often combined with the parking brake: the piston winds in, and an electric parking brake must be retracted with a scan tool. Without that the pads will not fit.',
  },
};

/**
 * Руководство для узла с учётом класса машины.
 * Возвращает null, если узел неизвестен.
 */
export function guideFor(componentId, vehicleClass) {
  const guide = GUIDES[componentId];
  if (guide) {
    const extra = guide.byClass?.[vehicleClass];
    return { componentId, ...guide, classNote: extra?.note || null };
  }
  const reason = SERVICE_ONLY[componentId];
  if (reason) {
    return { componentId, level: LEVEL.SERVICE, reason, tools: [], steps: [], warnings: [] };
  }
  return null;
}

/** Есть ли вообще что показать по этому узлу. */
export function hasGuide(componentId) {
  return !!(GUIDES[componentId] || SERVICE_ONLY[componentId]);
}

/** Название инструмента на нужном языке. */
export function toolName(id, lang) {
  return TOOLS[id]?.[lang] || TOOLS[id]?.ru || id;
}

/** Текст на нужном языке из пары {ru, en}. */
export function text(pair, lang) {
  if (!pair) return '';
  return pair[lang] || pair.ru || '';
}

export { CHECK_MANUAL };
