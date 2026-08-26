/**
 * Связь с адаптером OBD-II по Bluetooth.
 *
 * Что здесь важно знать заранее, иначе ожидания не сойдутся с жизнью.
 *
 * 1. В Safari на iPhone Web Bluetooth НЕ СУЩЕСТВУЕТ. Не «работает плохо», а
 *    отсутствует как явление. Поэтому в вебе чтение из машины возможно на
 *    Android, а на iPhone — только из нативного приложения. Ручной ввод кода
 *    работает везде, и поэтому он основной способ, а не запасной.
 *
 * 2. Браузер умеет только BLE. Дешёвые адаптеры на «классическом» Bluetooth
 *    (а их большинство) браузеру недоступны в принципе. Нужен именно BLE.
 *
 * 3. Мы только ЧИТАЕМ. Никаких команд, меняющих поведение машины, и никакого
 *    стирания кодов: стереть код — значит убрать симптом, не тронув причину,
 *    и заодно обнулить готовность систем самодиагностики. Человек имеет право
 *    это сделать, но не случайным нажатием в дневнике поездок.
 */

/** Стандартный профиль последовательного порта у большинства BLE-адаптеров. */
const SERVICE_UUIDS = [
  0xfff0,                                     // самый частый у ELM327-клонов
  '0000ffe0-0000-1000-8000-00805f9b34fb',     // второй по частоте
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',     // Nordic UART, попадается
];

export function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

/**
 * Почему подключение недоступно — словами, а не пустой кнопкой.
 * @returns {string|null} ключ перевода или null, если всё в порядке
 */
export function unavailableReason() {
  if (bluetoothAvailable()) return null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  // iOS определяем по движку: там любой браузер — это Safari внутри, и
  // Web Bluetooth не появится ни в Chrome, ни в Firefox на iPhone.
  if (/iPhone|iPad|iPod/.test(ua)) return 'obd.no_bluetooth_ios';
  return 'obd.no_bluetooth';
}

/**
 * Подключиться к адаптеру и прочитать коды.
 *
 * Диалог выбора устройства показывает сам браузер — мы не видим, какие
 * устройства рядом, пока человек сам не выберет своё. Вызывать только из
 * обработчика касания: без жеста браузер запрос отклонит.
 *
 * @param {function(string):void} [onProgress] шаги для показа человеку
 * @returns {Promise<string>} сырой ответ адаптера на команду 03
 */
export async function readTroubleCodes(onProgress = () => {}) {
  if (!bluetoothAvailable()) throw new Error('no_bluetooth');

  onProgress('obd.step_choose');
  const device = await navigator.bluetooth.requestDevice({
    filters: SERVICE_UUIDS.map(uuid => ({ services: [uuid] })),
    optionalServices: SERVICE_UUIDS,
  });

  onProgress('obd.step_connect');
  const server = await device.gatt.connect();

  // Какой именно профиль у адаптера, заранее неизвестно: у клонов он разный.
  // Перебираем известные, а не полагаемся на один.
  let characteristic = null;
  for (const uuid of SERVICE_UUIDS) {
    try {
      const service = await server.getPrimaryService(uuid);
      const list = await service.getCharacteristics();
      // Нужна та, в которую можно писать и которая умеет уведомлять.
      characteristic = list.find(c => (c.properties.write || c.properties.writeWithoutResponse)
        && c.properties.notify) || null;
      if (characteristic) break;
    } catch { /* этого профиля у адаптера нет — пробуем следующий */ }
  }
  if (!characteristic) {
    try { device.gatt.disconnect(); } catch { /* уже отключён */ }
    throw new Error('no_serial_profile');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', (e) => {
    buffer += decoder.decode(e.target.value);
  });

  const send = async (cmd) => {
    buffer = '';
    const data = new TextEncoder().encode(cmd + '\r');
    if (characteristic.properties.write) await characteristic.writeValue(data);
    else await characteristic.writeValueWithoutResponse(data);
    // Адаптер отвечает не мгновенно и заканчивает ответ приглашением «>».
    // Ждём именно его, а не фиксированную паузу: на разных адаптерах
    // задержка разная, и жёсткое ожидание либо режет ответ, либо тормозит.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (buffer.includes('>')) return buffer;
      await new Promise(r => setTimeout(r, 60));
    }
    return buffer;
  };

  try {
    onProgress('obd.step_handshake');
    await send('ATZ');    // сброс адаптера
    await send('ATE0');   // без эха команд: иначе ответ читать труднее
    await send('ATSP0');  // протокол определяется сам: их у машин несколько

    onProgress('obd.step_read');
    return await send('03');   // 03 — «отдай сохранённые коды»
  } finally {
    // Отключаемся всегда: оставленное соединение держит адаптер занятым,
    // и следующая попытка — своя же или из другого приложения — не пройдёт.
    try { device.gatt.disconnect(); } catch { /* уже отключён */ }
  }
}
