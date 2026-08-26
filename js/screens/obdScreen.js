import { openModal, closeModal, toast, escapeHtml } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { AppState } from '../state.js';
import { describeCode, decodeDtcResponse, worstUrgency, URGENCY, FIX, isValidCode } from '../obd.js';
import { bluetoothAvailable, unavailableReason, readTroubleCodes } from '../obdLink.js';

/**
 * «Что машина знает о себе».
 *
 * Два входа в одно и то же: прочитать коды из машины через адаптер и ввести
 * код руками. Второй — основной, а не запасной: адаптер есть не у всех, а в
 * Safari на iPhone его не подключить вовсе. Код можно взять из чужого
 * сканера, из приложения сервиса или просто увидеть у мастера — и получить
 * ту же расшифровку.
 *
 * Отдельная кнопка «текст для сервиса» — самая полезная часть для того, кто
 * чинить сам не собирается. Она не диагностирует, а переводит: собирает
 * машину, пробег, коды и их значения в текст, который можно отдать механику,
 * чтобы разговор начался не с «что-то стучит».
 */

const text = (pair) => (pair ? (pair[getLang()] || pair.ru || pair.en || '') : '');

const URGENCY_STYLE = {
  [URGENCY.STOP]: { cls: 'over', key: 'obd.urgency_stop' },
  [URGENCY.SOON]: { cls: 'near', key: 'obd.urgency_soon' },
  [URGENCY.WATCH]: { cls: '', key: 'obd.urgency_watch' },
};

function codeCard(d) {
  const style = URGENCY_STYLE[d.urgency] || URGENCY_STYLE[URGENCY.WATCH];
  const causes = d.causes
    ? `<div class="muted" style="font-size:13px;padding-top:8px;">${t('obd.where_to_look')}</div>
       <ol style="margin:4px 0 0;padding-left:20px;font-size:14px;">
         ${d.causes.map(c => `<li>${escapeHtml(text(c))}</li>`).join('')}
       </ol>`
    : '';

  // Незнакомый код — не ошибка и не пустота: структуру номера читает
  // стандарт, и это уже кое-что. Врать про остальное мы не станем.
  const body = d.known
    ? `<div style="font-size:14px;padding-top:6px;">${escapeHtml(text(d.means))}</div>${causes}`
    : `<div style="font-size:14px;padding-top:6px;">
         ${escapeHtml(t(d.generic ? 'obd.unknown_generic' : 'obd.unknown_maker'))}
       </div>
       <div class="muted" style="font-size:13px;padding-top:6px;">
         ${escapeHtml(text(d.systemName))}${d.group ? ' · ' + escapeHtml(text(d.group)) : ''}
       </div>`;

  const note = d.note
    ? `<div class="muted" style="font-size:13px;padding-top:8px;border-top:1px solid var(--separator);margin-top:8px;">
         ${escapeHtml(text(d.note))}</div>`
    : '';

  return `
    <div class="card" style="margin-top:12px;">
      <div class="row" style="justify-content:space-between;align-items:baseline;gap:8px;">
        <b style="font-size:17px;">${escapeHtml(d.code)}</b>
        <span class="chip ${style.cls}" style="font-size:12px;">${t(style.key)}</span>
      </div>
      ${d.known ? `<div style="font-weight:600;padding-top:4px;">${escapeHtml(text(d.title))}</div>` : ''}
      ${body}
      ${note}
      <div class="muted" style="font-size:13px;padding-top:8px;">
        ${t(d.fix === FIX.SELF ? 'obd.fix_self' : 'obd.fix_service')}
      </div>
    </div>`;
}

/** Текст для механика: не диагноз, а перевод с языка кодов на человеческий. */
export function serviceBrief(codes, { vehicle, odometerKm } = {}) {
  const lines = [];
  if (vehicle) {
    const name = [vehicle.displayName, vehicle.trimName].filter(Boolean).join(' ');
    lines.push(`${t('obd.brief_car')}: ${name}`);
  }
  if (Number.isFinite(odometerKm)) {
    lines.push(`${t('obd.brief_odometer')}: ${Math.round(odometerKm)} ${t('unit.km')}`);
  }
  lines.push('');
  lines.push(`${t('obd.brief_codes')}:`);
  for (const code of codes) {
    const d = describeCode(code);
    if (!d) continue;
    lines.push(d.known
      ? `— ${d.code}: ${text(d.title)}`
      : `— ${d.code}: ${text(d.systemName)}${d.group ? ', ' + text(d.group) : ''}`);
  }
  lines.push('');
  lines.push(t('obd.brief_footer'));
  return lines.join('\n');
}

function render(root, codes, ctx) {
  const box = root.querySelector('#obd-result');
  if (!codes.length) {
    box.innerHTML = `<div class="muted" style="padding-top:12px;font-size:14px;">${t('obd.nothing')}</div>`;
    return;
  }
  const worst = worstUrgency(codes);
  const head = worst
    ? `<div class="muted" style="font-size:13px;padding-top:10px;">${t(URGENCY_STYLE[worst].key + '_summary')}</div>`
    : '';
  box.innerHTML = head
    + codes.map(c => describeCode(c)).filter(Boolean).map(codeCard).join('')
    + `<button class="btn block" id="obd-copy" style="margin-top:14px;">${t('obd.copy_for_service')}</button>`;

  box.querySelector('#obd-copy').addEventListener('click', async () => {
    const brief = serviceBrief(codes, ctx);
    try {
      await navigator.clipboard.writeText(brief);
      toast(t('obd.copied'));
    } catch {
      // Буфер обмена может быть недоступен — тогда показываем текст,
      // чтобы человек скопировал его сам, а не остался ни с чем.
      openModal(`
        <div class="modal-header"><h2>${t('obd.copy_for_service')}</h2>
          <button class="modal-close">✕</button></div>
        <textarea readonly style="width:100%;height:220px;font-size:13px;">${escapeHtml(brief)}</textarea>`,
        { onMount: (m) => m.querySelector('.modal-close').addEventListener('click', closeModal) });
    }
  });
}

export function openObd({ vehicle, odometerKm } = {}) {
  const ctx = { vehicle, odometerKm };
  const reason = unavailableReason();

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="obd.title"></h2><button class="modal-close">✕</button></div>
    <div class="muted" style="font-size:13px;" data-i18n="obd.intro"></div>

    ${bluetoothAvailable() ? `
      <button class="btn primary block" id="obd-connect" style="margin-top:12px;" data-i18n="obd.connect"></button>
      <div class="muted" style="font-size:12px;padding-top:6px;" data-i18n="obd.connect_hint"></div>
    ` : `
      <div class="muted" style="font-size:13px;padding-top:12px;">${t(reason)}</div>
    `}

    <div class="settings-row" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--separator);">
      <span data-i18n="obd.manual"></span>
    </div>
    <div class="row" style="gap:8px;">
      <input id="obd-code" placeholder="P0301" maxlength="5"
             style="text-transform:uppercase;flex:1;" autocomplete="off" spellcheck="false">
      <button class="btn" id="obd-add" data-i18n="obd.decode"></button>
    </div>
    <div class="muted" style="font-size:12px;padding-top:6px;" data-i18n="obd.manual_hint"></div>

    <div id="obd-result"></div>
    <div class="muted" style="font-size:12px;padding-top:14px;" data-i18n="obd.disclaimer"></div>
  `);

  let codes = [];

  overlay.querySelector('.modal-close').addEventListener('click', closeModal);

  const input = overlay.querySelector('#obd-code');
  const add = () => {
    const value = input.value.trim().toUpperCase();
    if (!isValidCode(value)) { toast(t('obd.bad_code')); return; }
    if (!codes.includes(value)) codes.push(value);
    input.value = '';
    render(overlay, codes, ctx);
  };
  overlay.querySelector('#obd-add').addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  overlay.querySelector('#obd-connect')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const raw = await readTroubleCodes((key) => { btn.textContent = t(key); });
      const found = decodeDtcResponse(raw);
      // Пустой ответ — это хорошая новость, а не сбой: сохранённых кодов
      // нет. Так и говорим, вместо «не удалось прочитать».
      codes = [...new Set([...codes, ...found])];
      render(overlay, codes, ctx);
      if (!found.length) toast(t('obd.none_stored'));
    } catch (err) {
      // Отказ в диалоге выбора устройства — это не ошибка, а решение
      // человека: молчим, а не пугаем сообщением о сбое.
      if (err && err.name !== 'NotFoundError') toast(t('obd.connect_failed'));
    } finally {
      btn.disabled = false;
      btn.textContent = t('obd.connect');
    }
  });

  return overlay;
}
