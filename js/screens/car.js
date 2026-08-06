import { DB } from '../db.js';
import {
  AppState, getPrimaryVehicle, currentOdometerKm,
  ensureServicePlan, currentAvgKmPerDay, getSevereConditions, setSevereConditions, recalcIntervals,
  rebaseUntouchedItems,
} from '../state.js';
import { componentStatus, fleetHealth, STATUS } from '../maintenance.js';
import { Fmt, uuid, todayKey, addDays } from '../format.js';
import { t } from '../i18n.js';
import { el, applyI18nTree, openModal, closeModal, toast, EXPENSE_ICON, icon } from '../ui.js';
import { VEHICLE_MAKES, searchMakes, searchModels, getMake, makeDisplayName } from '../vehicleCatalog.js';
import { bodyTypeFor } from '../carArt.js';
import { getLang } from '../i18n.js';

let containerRef = null;

export function render(container) {
  containerRef = container;
  container.innerHTML = `<h1 class="page-title" data-i18n="car.title"></h1><div id="car-body"></div>`;
  applyI18nTree(container);
  refresh();
}

export async function refresh() {
  if (!containerRef) return;
  const body = containerRef.querySelector('#car-body');
  const vehicle = await getPrimaryVehicle();

  if (!vehicle) {
    body.innerHTML = `
      <div class="card" style="text-align:center;padding:28px 16px;">
        <div style="margin-bottom:8px;color:var(--text-secondary);">${icon('car',{size:40})}</div>
        <div class="muted" style="margin-bottom:14px;" data-i18n="car.no_vehicle"></div>
        <button class="btn primary" id="car-choose" data-i18n="car.choose_vehicle"></button>
      </div>`;
    applyI18nTree(body);
    body.querySelector('#car-choose').addEventListener('click', openVehiclePicker);
    return;
  }

  const odometer = await currentOdometerKm(vehicle);
  const [refuels, expenses, maintenance, avgKmPerDay, severe] = await Promise.all([
    DB.getAllByIndex('refuels', 'vehicleId', vehicle.id),
    DB.getAllByIndex('expenses', 'vehicleId', vehicle.id),
    // Регламент строится под класс машины при первом заходе и дальше живёт своей жизнью.
    ensureServicePlan(vehicle, odometer),
    currentAvgKmPerDay(),
    getSevereConditions(),
  ]);
  // Контекст расчёта: пробег, «сегодня» и реальный среднесуточный пробег,
  // из которого получается прогноз дат обслуживания.
  const maintCtx = { odometerKm: odometer, now: Date.now(), avgKmPerDay };

  const measured = computeMeasuredConsumption(refuels);
  const consumptionToUse = measured.value != null ? measured.value : vehicle.consumptionL100;

  const { todayKm, weekKm, monthKm } = await consumptionPeriods(vehicle);
  const period = (km) => {
    const liters = km * consumptionToUse / 100;
    return `${Fmt.distanceKm(km*1000, AppState.units)} · ${Fmt.liters(liters)} · ${Fmt.money(liters*vehicle.fuelPriceRub, AppState.currency)}`;
  };

  const templates = await DB.getAll('expenseTemplates');
  templates.sort((a, b) => b.useCount - a.useCount || a.sortOrder - b.sortOrder);

  const records = [...refuels.map(r => ({ ...r, kind: 'refuel' })), ...expenses.map(e => ({ ...e, kind: 'expense' }))]
    .sort((a, b) => b.date - a.date)
    .slice(0, 20);

  const health = fleetHealth(maintenance, maintCtx);

  body.innerHTML = `
    <div class="card garage-card">
      <div class="garage-name">${escapeHtml(vehicle.displayName || 'Авто')}</div>
      ${healthBlock(health)}
      <div class="big-number">${odometer.toFixed(0)} <span style="font-size:16px;font-weight:600;color:var(--text-secondary);">${t('unit.km')}</span></div>
      <div class="muted" data-i18n="car.odometer_caption"></div>
      <div class="row" style="justify-content:center;gap:8px;margin-top:10px;">
        <button class="btn sm" id="car-adjust" data-i18n="car.adjust_odometer"></button>
        <button class="btn sm" id="car-change" data-i18n="car.change_vehicle"></button>
      </div>
      <div class="muted" style="margin-top:8px;">${t('car.range', { km: Math.round(vehicle.rangeKm || (vehicle.tankLiters/consumptionToUse*100)) })}</div>
    </div>

    <div class="section-title" data-i18n="car.section_consumption"></div>
    <div class="card">
      <div class="row between" style="padding:6px 0;"><span class="muted" data-i18n="car.period_today"></span><b>${period(todayKm)}</b></div>
      <div class="row between" style="padding:6px 0;"><span class="muted" data-i18n="car.period_week"></span><b>${period(weekKm)}</b></div>
      <div class="row between" style="padding:6px 0;"><span class="muted" data-i18n="car.period_month"></span><b>${period(monthKm)}</b></div>
      <div class="row between" style="padding:6px 0;border-top:1px solid var(--separator);margin-top:4px;padding-top:10px;">
        <span class="muted">${measured.value != null ? t('measured.actual') : t('measured.passport')}</span>
        <b>${consumptionToUse.toFixed(1)} ${vehicle.fuelType === 'electric' ? t('unit.kwh') : t('unit.liters')}/100${t('unit.km')}</b>
      </div>
      ${measured.value == null ? `<div class="muted" style="font-size:12px;">${t('measured.need_more', { n: Math.max(0, 2 - measured.fullTankCount) })}</div>` : ''}
    </div>

    <div class="section-title" data-i18n="quick.section"></div>
    <div class="pad" style="padding-top:0;padding-bottom:0;">
      <div class="quick-grid" id="quick-grid"></div>
    </div>
    <div class="muted" style="margin:8px 16px 0;font-size:12px;" data-i18n="quick.footer"></div>

    <div class="section-title" data-i18n="car.section_maintenance"></div>
    <div class="card" id="maint-list"></div>
    <label class="row between" style="padding:10px 14px;gap:10px;">
      <span>
        <span data-i18n="maint.severe"></span>
        <span class="muted" style="display:block;font-size:12px;" data-i18n="maint.severe_hint"></span>
      </span>
      <input type="checkbox" id="maint-severe"${severe ? ' checked' : ''}>
    </label>
    <div style="text-align:center;margin:0 0 4px;"><button class="btn sm" id="maint-add">+ <span data-i18n="maint.name"></span></button></div>

    <div class="section-title" data-i18n="records.title"></div>
    <div class="card" style="padding:0 14px;" id="records-list"></div>
    <div style="text-align:center;margin:12px 0 20px;">
      <button class="btn sm" id="add-refuel">${icon('plus',{size:14})} ${EXPENSE_ICON.fuel} <span data-i18n="refuel.section"></span></button>
      <button class="btn sm" id="add-expense">${icon('plus',{size:14})} ${EXPENSE_ICON.other} <span data-i18n="expense.section"></span></button>
    </div>
  `;
  applyI18nTree(body);

  body.querySelector('#car-adjust').addEventListener('click', () => openOdometerAdjust(vehicle));
  body.querySelector('#car-change').addEventListener('click', openVehiclePicker);
  body.querySelector('#maint-add').addEventListener('click', () => openMaintenanceEdit(null, odometer, vehicle));
  body.querySelector('#maint-severe').addEventListener('change', async (e) => {
    // Меняем режим эксплуатации — пересчитываем интервалы, но не историю замен.
    await setSevereConditions(e.target.checked);
    await recalcIntervals(vehicle, e.target.checked);
    refresh();
  });
  body.querySelector('#add-refuel').addEventListener('click', () => openRefuelForm(vehicle, odometer));
  body.querySelector('#add-expense').addEventListener('click', () => openExpenseForm(vehicle, odometer));

  renderQuickGrid(body.querySelector('#quick-grid'), templates, vehicle, odometer);
  renderMaintenance(body.querySelector('#maint-list'), maintenance, maintCtx, vehicle);
  renderRecords(body.querySelector('#records-list'), records);
}

function escapeHtml(s) {
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Периоды пробега ---
async function consumptionPeriods(vehicle) {
  const trips = await DB.getAll('trips');
  const carTrips = trips.filter(t => t.mode === 'car');
  const today = todayKey();
  const weekAgo = addDays(today, -7);
  const monthAgo = addDays(today, -30);
  let todayKm = 0, weekKm = 0, monthKm = 0;
  for (const t of carTrips) {
    const km = t.distanceMeters / 1000;
    if (t.dayKey === today) todayKm += km;
    if (t.dayKey >= weekAgo) weekKm += km;
    if (t.dayKey >= monthAgo) monthKm += km;
  }
  return { todayKm, weekKm, monthKm };
}

// --- Фактический расход между заправками "до полного бака" ---
function computeMeasuredConsumption(refuels) {
  const full = refuels.filter(r => r.isFullTank).sort((a, b) => a.odometerKm - b.odometerKm);
  if (full.length < 2) return { value: null, fullTankCount: full.length };
  let totalLiters = 0, totalKm = 0;
  for (let i = 1; i < full.length; i++) {
    const km = full[i].odometerKm - full[i-1].odometerKm;
    if (km <= 0) continue;
    totalLiters += full[i].liters;
    totalKm += km;
  }
  if (totalKm <= 0) return { value: null, fullTankCount: full.length };
  return { value: totalLiters / totalKm * 100, fullTankCount: full.length };
}

// --- Quick actions ---
function renderQuickGrid(gridEl, templates, vehicle, odometer) {
  gridEl.innerHTML = templates.map(tpl => `
    <button class="quick-tile" data-tpl="${tpl.id}">
      <span class="qi">${tpl.isRefuel ? EXPENSE_ICON.fuel : (EXPENSE_ICON[tpl.categoryKey] || EXPENSE_ICON.other)}</span>
      <span class="qt">${t(tpl.title) !== tpl.title ? t(tpl.title) : tpl.title}</span>
      <span class="qa">${tpl.isRefuel ? Fmt.liters(tpl.liters) : Fmt.money(tpl.amount, AppState.currency)}</span>
    </button>
  `).join('') + `<button class="quick-tile add" id="quick-new"><span class="qi">${icon('plus',{size:20})}</span><span class="qt" data-i18n="template.new_title"></span></button>`;
  applyI18nTree(gridEl);

  gridEl.querySelectorAll('[data-tpl]').forEach(btn => {
    let holdTimer = null;
    btn.addEventListener('click', () => applyTemplate(btn.dataset.tpl, vehicle, odometer));
    btn.addEventListener('touchstart', () => { holdTimer = setTimeout(() => openTemplateEdit(btn.dataset.tpl), 550); });
    btn.addEventListener('touchend', () => clearTimeout(holdTimer));
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openTemplateEdit(btn.dataset.tpl); });
  });
  gridEl.querySelector('#quick-new').addEventListener('click', () => openTemplateEdit(null));
}

async function applyTemplate(tplId, vehicle, odometer) {
  const templates = await DB.getAll('expenseTemplates');
  const tpl = templates.find(x => x.id === tplId);
  if (!tpl) return;
  const now = Date.now();
  let createdId, storeName;
  if (tpl.isRefuel) {
    const liters = tpl.liters;
    const price = tpl.pricePerLiter || vehicle.fuelPriceRub;
    const record = {
      id: uuid(), vehicleId: vehicle.id, date: now, liters, pricePerLiter: price,
      totalCost: liters * price, odometerKm: odometer, isFullTank: true,
      fuelType: vehicle.fuelType, stationName: '', note: '', templateId: tpl.id,
    };
    await DB.put('refuels', record);
    createdId = record.id; storeName = 'refuels';
  } else {
    const record = {
      id: uuid(), vehicleId: vehicle.id, date: now, category: tpl.categoryKey,
      amount: tpl.amount, odometerKm: odometer, note: '', templateId: tpl.id,
    };
    await DB.put('expenses', record);
    createdId = record.id; storeName = 'expenses';
  }
  tpl.useCount = (tpl.useCount || 0) + 1;
  await DB.put('expenseTemplates', tpl);

  toast(t('quick.added') + ': ' + (t(tpl.title) !== tpl.title ? t(tpl.title) : tpl.title), {
    actionLabel: t('quick.undo'),
    onAction: async () => { await DB.delete(storeName, createdId); refresh(); },
  });
  refresh();
}

function openTemplateEdit(tplId) {
  const isNew = !tplId;
  (async () => {
    let tpl = isNew ? { id: uuid(), title: '', categoryKey: 'other', amount: 0, liters: 0, pricePerLiter: 0, isRefuel: false, sortOrder: 99, useCount: 0 } : (await DB.getAll('expenseTemplates')).find(x => x.id === tplId);
    const overlay = openModal(`
      <div class="modal-header"><h2 data-i18n="template.new_title"></h2><button class="modal-close">✕</button></div>
      <label class="field"><span class="field-label" data-i18n="template.title"></span><input id="tp-title" value="${escapeHtml(t(tpl.title) !== tpl.title ? t(tpl.title) : tpl.title)}"></label>
      <label class="row" style="gap:8px;margin-bottom:14px;"><input type="checkbox" id="tp-refuel" style="width:auto;" ${tpl.isRefuel?'checked':''}><span data-i18n="template.is_refuel"></span></label>
      <div id="tp-refuel-fields" style="${tpl.isRefuel?'':'display:none'}">
        <label class="field"><span class="field-label" data-i18n="refuel.liters"></span><input id="tp-liters" type="number" step="0.1" value="${tpl.liters||40}"></label>
        <label class="field"><span class="field-label" data-i18n="refuel.price_per_liter"></span><input id="tp-price" type="number" step="0.1" value="${tpl.pricePerLiter||0}"></label>
      </div>
      <div id="tp-expense-fields" style="${tpl.isRefuel?'display:none':''}">
        <div class="field"><span class="field-label" data-i18n="template.category"></span>
          <div class="chip-row" id="tp-cat">${['wash','service','repairs','tires','insurance','tax','parking','fine','other'].map(c => `<button class="chip ${c===tpl.categoryKey?'active':''}" data-cat="${c}">${EXPENSE_ICON[c]} ${t('expense.'+c)}</button>`).join('')}</div>
        </div>
        <label class="field"><span class="field-label" data-i18n="expense.amount"></span><input id="tp-amount" type="number" step="1" value="${tpl.amount||0}"></label>
      </div>
      <div class="row" style="gap:10px;margin-top:6px;">
        <button class="btn block" id="tp-save" data-i18n="common.save"></button>
        ${!isNew ? `<button class="btn danger" id="tp-delete" data-i18n="common.delete"></button>` : ''}
      </div>
    `, {
      onMount: (overlay) => {
        overlay.querySelector('.modal-close').addEventListener('click', closeModal);
        let category = tpl.categoryKey;
        overlay.querySelector('#tp-refuel').addEventListener('change', (e) => {
          overlay.querySelector('#tp-refuel-fields').style.display = e.target.checked ? '' : 'none';
          overlay.querySelector('#tp-expense-fields').style.display = e.target.checked ? 'none' : '';
        });
        overlay.querySelector('#tp-cat')?.addEventListener('click', e => {
          const btn = e.target.closest('.chip'); if (!btn) return;
          overlay.querySelectorAll('#tp-cat .chip').forEach(c => c.classList.remove('active'));
          btn.classList.add('active'); category = btn.dataset.cat;
        });
        overlay.querySelector('#tp-save').addEventListener('click', async () => {
          tpl.title = overlay.querySelector('#tp-title').value.trim() || 'expense.other';
          tpl.isRefuel = overlay.querySelector('#tp-refuel').checked;
          tpl.liters = parseFloat(overlay.querySelector('#tp-liters').value) || 0;
          tpl.pricePerLiter = parseFloat(overlay.querySelector('#tp-price').value) || 0;
          tpl.amount = parseFloat(overlay.querySelector('#tp-amount').value) || 0;
          tpl.categoryKey = category;
          await DB.put('expenseTemplates', tpl);
          closeModal(); refresh();
        });
        overlay.querySelector('#tp-delete')?.addEventListener('click', async () => {
          await DB.delete('expenseTemplates', tpl.id);
          closeModal(); refresh();
        });
      }
    });
    applyI18nTree(overlay);
  })();
}

// --- Maintenance ---

const STATUS_COLOR = {
  [STATUS.OK]: 'var(--success)',
  [STATUS.SOON]: 'var(--warning)',
  [STATUS.DUE]: 'var(--warning)',
  [STATUS.OVERDUE]: 'var(--danger)',
};

/** Короткая строка «сколько осталось» — по тому измерению, что кончится раньше. */
function remainingLabel(item, st) {
  if (st.status === STATUS.OVERDUE) {
    return st.limitedBy === 'time' && st.daysLeft != null
      ? t('car.overdue_days', { days: Math.round(-st.daysLeft) })
      : t('car.overdue', { km: Math.round(-(st.kmLeft || 0)) });
  }
  return st.limitedBy === 'time'
    ? t('car.remaining_days', { days: Math.max(0, st.daysLeft) })
    : t('car.remaining', { km: Math.round(Math.max(0, st.kmLeft || 0)) });
}

function renderMaintenance(listEl, items, ctx, vehicle) {
  // Самое срочное — наверх: список нужен, чтобы понять, что делать сейчас,
  // а не чтобы любоваться порядком, в котором пункты когда-то завели.
  const rows = items
    .map(item => ({ item, st: componentStatus(item, ctx) }))
    .sort((a, b) => a.st.fraction - b.st.fraction);

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="empty-state" data-i18n="car.no_items"></div>`;
    applyI18nTree(listEl);
    return;
  }

  listEl.innerHTML = rows.map(({ item, st }) => {
    const pct = st.fraction * 100;
    const color = STATUS_COLOR[st.status];
    const title = t(item.title) !== item.title ? t(item.title) : item.title;
    // «Ориентировочно» для всего, что не подтверждено официальным регламентом:
    // выдавать медианную оценку из спорных источников за точный срок нельзя.
    const approx = item.confidence && item.confidence !== 'high' ? `${t('maint.approx')} ` : '';
    // Прогноз показываем, только пока ресурс ещё есть. У просроченного узла
    // дата «примерно до …» в будущем противоречит надписи «просрочено»:
    // по одному измерению срок вышел, а по второму формально ещё нет.
    const due = st.dueDate && st.status !== STATUS.OVERDUE
      ? `<span class="muted" style="font-size:12px;">${approx}${t('car.due_about', { date: Fmt.dateFromTs(st.dueDate) })}</span>`
      : '';
    const confirm = item.needsConfirm
      ? `<span class="muted" style="font-size:12px;display:block;" data-i18n="maint.confirm_hint"></span>`
      : '';
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--separator);" data-item="${item.id}">
        <div class="row between"><b>${escapeHtml(title)}</b><span class="muted" style="font-size:12px;">${remainingLabel(item, st)}</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${color};"></div></div>
        ${due}${confirm}
        <div class="row" style="margin-top:8px;gap:8px;">
          <button class="btn sm" data-replace="${item.id}" data-i18n="car.replaced_now"></button>
          <button class="btn sm" data-edit="${item.id}" data-i18n="common.edit"></button>
        </div>
      </div>`;
  }).join('');
  const odometer = ctx.odometerKm;
  applyI18nTree(listEl);
  listEl.querySelectorAll('[data-replace]').forEach(btn => btn.addEventListener('click', async () => {
    const item = items.find(i => i.id === btn.dataset.replace);
    item.lastServiceOdometerKm = odometer;
    // Дату тоже сбрасываем: у половины узлов интервал временной, и без этого
    // тормозная жидкость осталась бы просроченной сразу после замены.
    item.lastServiceDate = Date.now();
    // С этого момента здесь настоящая история обслуживания — корректировка
    // одометра больше не имеет права её двигать.
    item.serviced = true;
    await DB.put('maintenanceItems', item);
    refresh();
  }));
  listEl.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
    const item = items.find(i => i.id === btn.dataset.edit);
    openMaintenanceEdit(item, odometer, vehicle);
  }));
}

function openMaintenanceEdit(item, odometer, vehicle) {
  const isNew = !item;
  const draft = item || {
    id: uuid(), vehicleId: vehicle ? vehicle.id : null, title: '',
    intervalKm: 10000, intervalMonths: 12,
    lastServiceOdometerKm: odometer, lastServiceDate: Date.now(),
    note: '', sortOrder: 99,
  };
  const titleShown = draft.title && (t(draft.title) !== draft.title ? t(draft.title) : draft.title);
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="maint.name"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="maint.name"></span><input id="mi-title" value="${escapeHtml(titleShown || '')}"></label>
    <label class="field"><span class="field-label" data-i18n="maint.interval_km"></span><input id="mi-interval" type="number" value="${draft.intervalKm || ''}"></label>
    <label class="field"><span class="field-label" data-i18n="maint.interval_months"></span><input id="mi-months" type="number" value="${draft.intervalMonths || ''}"></label>
    <label class="field"><span class="field-label" data-i18n="maint.last_service_km"></span><input id="mi-last" type="number" value="${draft.lastServiceOdometerKm}"></label>
    <div class="row" style="gap:10px;">
      <button class="btn block" id="mi-save" data-i18n="common.save"></button>
      ${!isNew ? `<button class="btn danger" id="mi-delete" data-i18n="common.delete"></button>` : ''}
    </div>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      overlay.querySelector('#mi-save').addEventListener('click', async () => {
        draft.title = overlay.querySelector('#mi-title').value.trim();
        // Пустое поле — это «интервала по этому измерению нет», а не ноль:
        // у аккумулятора нет пробега, у колодок нет срока годности.
        const num = (sel) => {
          const raw = overlay.querySelector(sel).value.trim();
          if (raw === '') return null;
          const v = parseFloat(raw);
          return Number.isFinite(v) && v > 0 ? v : null;
        };
        draft.intervalKm = num('#mi-interval');
        draft.intervalMonths = num('#mi-months');
        draft.lastServiceOdometerKm = parseFloat(overlay.querySelector('#mi-last').value) || 0;
        // Пункт, заведённый руками, дальше не переписывается пересчётом интервалов
        // и не сдвигается корректировкой одометра.
        draft.needsConfirm = false;
        draft.serviced = true;
        await DB.put('maintenanceItems', draft);
        closeModal(); refresh();
      });
      overlay.querySelector('#mi-delete')?.addEventListener('click', async () => {
        await DB.delete('maintenanceItems', draft.id);
        closeModal(); refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

// --- Records list ---
function renderRecords(listEl, records) {
  if (records.length === 0) {
    listEl.innerHTML = `<div class="empty-state" data-i18n="records.empty"></div>`;
    applyI18nTree(listEl);
    return;
  }
  listEl.innerHTML = records.map(r => {
    if (r.kind === 'refuel') {
      return `<div class="list-item"><div class="icon-badge">${EXPENSE_ICON.fuel}</div><div class="grow"><div style="font-weight:600;">${Fmt.liters(r.liters)}${r.isFullTank ? ' · ' + t('refuel.full_tank') : ''}</div><div class="muted">${new Date(r.date).toLocaleDateString()}</div></div><b>${Fmt.money(r.totalCost, AppState.currency)}</b></div>`;
    }
    return `<div class="list-item"><div class="icon-badge">${EXPENSE_ICON[r.category]||EXPENSE_ICON.other}</div><div class="grow"><div style="font-weight:600;">${t('expense.'+r.category)}</div><div class="muted">${new Date(r.date).toLocaleDateString()}</div></div><b>${Fmt.money(r.amount, AppState.currency)}</b></div>`;
  }).join('');
}

// --- Odometer adjust ---
function openOdometerAdjust(vehicle) {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="car.adjust_odometer"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="car.adjust_odometer"></span><input id="od-value" type="number" value="${vehicle.odometerBaseKm}"></label>
    <button class="btn primary block" id="od-save" data-i18n="common.save"></button>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      overlay.querySelector('#od-save').addEventListener('click', async () => {
        const before = await currentOdometerKm(vehicle);
        vehicle.odometerBaseKm = parseFloat(overlay.querySelector('#od-value').value) || 0;
        vehicle.odometerBaseDate = Date.now();
        await DB.put('vehicles', vehicle);
        // Регламент строится в момент выбора машины, когда пробег ещё нулевой.
        // Когда владелец вводит реальные 96 000, нетронутые пункты едут следом,
        // иначе весь список сразу оказался бы просрочен на весь пробег машины.
        const after = await currentOdometerKm(vehicle);
        await rebaseUntouchedItems(vehicle, after, before);
        closeModal(); refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

// --- Refuel / Expense forms ---
function openRefuelForm(vehicle, odometer) {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="refuel.new_title"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="refuel.liters"></span><input id="rf-liters" type="number" step="0.1" value="40"></label>
    <label class="field"><span class="field-label" data-i18n="refuel.price_per_liter"></span><input id="rf-price" type="number" step="0.1" value="${vehicle.fuelPriceRub}"></label>
    <label class="field"><span class="field-label" data-i18n="record.odometer"></span><input id="rf-odo" type="number" value="${Math.round(odometer)}"></label>
    <label class="row" style="gap:8px;margin-bottom:14px;"><input type="checkbox" id="rf-full" style="width:auto;" checked><span data-i18n="refuel.full_tank"></span></label>
    <button class="btn primary block" id="rf-save" data-i18n="common.save"></button>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      overlay.querySelector('#rf-save').addEventListener('click', async () => {
        const liters = parseFloat(overlay.querySelector('#rf-liters').value) || 0;
        const price = parseFloat(overlay.querySelector('#rf-price').value) || 0;
        const record = {
          id: uuid(), vehicleId: vehicle.id, date: Date.now(), liters, pricePerLiter: price,
          totalCost: liters * price, odometerKm: parseFloat(overlay.querySelector('#rf-odo').value) || odometer,
          isFullTank: overlay.querySelector('#rf-full').checked, fuelType: vehicle.fuelType, stationName: '', note: '',
        };
        await DB.put('refuels', record);
        vehicle.fuelPriceRub = price;
        await DB.put('vehicles', vehicle);
        closeModal(); refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

function openExpenseForm(vehicle, odometer) {
  let category = 'wash';
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="expense.new_title"></h2><button class="modal-close">✕</button></div>
    <div class="field"><span class="field-label" data-i18n="expense.category"></span>
      <div class="chip-row" id="ex-cat">${['wash','service','repairs','tires','insurance','tax','parking','fine','other'].map((c,i) => `<button class="chip ${i===0?'active':''}" data-cat="${c}">${EXPENSE_ICON[c]} ${t('expense.'+c)}</button>`).join('')}</div>
    </div>
    <label class="field"><span class="field-label" data-i18n="expense.amount"></span><input id="ex-amount" type="number" step="1" value="500"></label>
    <button class="btn primary block" id="ex-save" data-i18n="common.save"></button>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      overlay.querySelector('#ex-cat').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#ex-cat .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); category = btn.dataset.cat;
      });
      overlay.querySelector('#ex-save').addEventListener('click', async () => {
        const record = {
          id: uuid(), vehicleId: vehicle.id, date: Date.now(), category,
          amount: parseFloat(overlay.querySelector('#ex-amount').value) || 0, odometerKm: odometer, note: '',
        };
        await DB.put('expenses', record);
        closeModal(); refresh();
      });
    }
  });
  applyI18nTree(overlay);
}

// --- Vehicle picker ---
function openVehiclePicker() {
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="vehicle.title"></h2><button class="modal-close">✕</button></div>
    <div class="search-box"><input id="veh-search" data-i18n-ph="common.search"></div>
    <div id="veh-list"></div>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      const listEl = overlay.querySelector('#veh-list');
      const searchEl = overlay.querySelector('#veh-search');

      function renderMakes(query) {
        const makes = searchMakes(query);
        listEl.innerHTML = makes.map(m => `<div class="list-item" data-make="${m.id}"><div class="grow">${escapeHtml(makeDisplayName(m, getLang()))}</div><span class="muted">${m.models.length}</span></div>`).join('')
          + `<div class="list-item" data-other="1"><div class="grow" data-i18n="vehicle.other"></div></div>`;
        applyI18nTree(listEl);
        listEl.querySelectorAll('[data-make]').forEach(node => node.addEventListener('click', () => renderModels(node.dataset.make)));
        listEl.querySelector('[data-other]').addEventListener('click', () => openCustomVehicleForm());
      }

      function renderModels(makeId) {
        const make = getMake(makeId);
        listEl.innerHTML = `<div class="list-item" data-back="1"><div class="grow">← ${escapeHtml(makeDisplayName(make, getLang()))}</div></div>` +
          make.models.map(mo => `<div class="list-item" data-model="${mo.id}"><div class="grow">${escapeHtml(mo.name)}</div><span class="muted">${mo.trims.length}</span></div>`).join('');
        listEl.querySelector('[data-back]').addEventListener('click', () => renderMakes(''));
        listEl.querySelectorAll('[data-model]').forEach(node => node.addEventListener('click', () => renderTrims(make, node.dataset.model)));
      }

      function renderTrims(make, modelId) {
        const model = make.models.find(m => m.id === modelId);
        // Модели из внешнего справочника идут без комплектаций: марок и моделей
        // там 400 и 4900, а характеристик двигателя нет. Показывать пустой
        // список — тупик, поэтому сразу открываем ручной ввод с уже
        // подставленными маркой и моделью: человек допишет только мотор.
        if (model.trims.length === 0) {
          openCustomVehicleForm({ make, model });
          return;
        }
        listEl.innerHTML = `<div class="list-item" data-back="1"><div class="grow">← ${escapeHtml(model.name)}</div></div>` +
          model.trims.map(tr => `<div class="list-item" data-trim="${tr.id}"><div class="grow"><div>${escapeHtml(tr.name)}</div><div class="muted">${tr.powerHp} л.с. · бак ${tr.tankLiters} · ${tr.consumptionCombinedL100} /100 · ${tr.years}</div></div></div>`).join('');
        listEl.querySelector('[data-back]').addEventListener('click', () => renderModels(make.id));
        listEl.querySelectorAll('[data-trim]').forEach(node => node.addEventListener('click', () => {
          const trim = model.trims.find(t2 => t2.id === node.dataset.trim);
          saveVehicleFromTrim(make, model, trim);
        }));
      }

      searchEl.addEventListener('input', () => renderMakes(searchEl.value));
      renderMakes('');
    }
  });
  applyI18nTree(overlay);
}

/**
 * «Здоровье» автомобиля 0..100 — средний остаток ресурса по расходникам.
 * Падает по мере пробега и восстанавливается, когда пользователь отмечает
 * замену. Нет расходников — считаем, что ухаживать пока не за чем (100).
 */
function computeHealth(items, odometer) {
  if (!items || items.length === 0) return 100;
  const sum = items.reduce((acc, item) => {
    const interval = item.intervalKm > 0 ? item.intervalKm : 10000;
    const remaining = interval - (odometer - item.lastServiceOdometerKm);
    return acc + Math.max(0, Math.min(1, remaining / interval));
  }, 0);
  return Math.round((sum / items.length) * 100);
}

function healthBlock(health) {
  const key = health >= 70 ? 'car.health_good' : health >= 35 ? 'car.health_soon' : 'car.health_bad';
  const color = health >= 70 ? 'var(--success)' : health >= 35 ? 'var(--warning)' : 'var(--danger)';
  return `
    <div class="health-row">
      <span class="muted" data-i18n="car.health"></span>
      <b style="color:${color}">${health}%</b>
    </div>
    <div class="progress-track"><div class="progress-fill" style="width:${health}%;background:${color}"></div></div>
    <div class="muted" style="font-size:12px;margin-top:4px;" data-i18n="${key}"></div>`;
}

async function saveVehicleFromTrim(make, model, trim) {
  const vehicle = {
    id: uuid(), makeId: make.id, modelId: model.id, trimId: trim.id, customName: '',
    displayName: `${makeDisplayName(make, getLang())} ${model.name}`,
    // trimName и years нужны движку регламента: по ним определяются тип КПП,
    // привод, наддув и карбюратор/инжектор. Без них класс машины не вычислить.
    trimName: trim.name, years: trim.years,
    engineVolumeL: trim.engineVolumeL, fuelType: trim.fuelType, powerHp: trim.powerHp,
    tankLiters: trim.tankLiters, consumptionL100: trim.consumptionCombinedL100, curbWeightKg: trim.curbWeightKg,
    odometerBaseKm: 0, odometerBaseDate: Date.now(), isPrimary: true, fuelPriceRub: 60,
    bodyType: bodyTypeFor(model.id, model.name), colorId: 'blue',
  };
  vehicle.rangeKm = vehicle.consumptionL100 > 0 ? vehicle.tankLiters / vehicle.consumptionL100 * 100 : 0;
  await DB.put('vehicles', vehicle);
  closeModal(); closeModal();
  refresh();
}

const FUEL_OPTIONS = ['petrol', 'diesel', 'hybrid', 'electric', 'gas'];
const TX_OPTIONS = ['mt', 'at', 'cvt', 'amt', 'dsg'];

/**
 * Ручной ввод автомобиля.
 *
 * preset — марка и модель из справочника, если человек выбрал модель,
 * у которой нет готовых комплектаций. Тогда остаётся дописать только мотор,
 * а марка попадает в vehicle.makeId, и движок регламента понимает,
 * что перед ним, например, отечественная машина.
 *
 * Топливо и коробку спрашиваем обязательно: от них напрямую зависит состав
 * работ. У электромобиля не должно быть свечей, у вариатора интервал масла
 * свой. Раньше здесь молча подставлялся бензин.
 */
function openCustomVehicleForm(preset = null) {
  const presetName = preset
    ? `${makeDisplayName(preset.make, getLang())} ${preset.model.name}`
    : '';
  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="vehicle.other"></h2><button class="modal-close">✕</button></div>
    <div class="muted" style="margin-bottom:12px;" data-i18n="${preset ? 'vehicle.preset_footer' : 'vehicle.other_footer'}"></div>
    <label class="field"><span class="field-label" data-i18n="vehicle.custom_name"></span><input id="cv-name" placeholder="Toyota Camry" value="${escapeHtml(presetName)}"></label>
    <label class="field"><span class="field-label" data-i18n="vehicle.fuel_type"></span>
      <select id="cv-fuel">${FUEL_OPTIONS.map(f => `<option value="${f}">${t('fuel.' + f)}</option>`).join('')}</select>
    </label>
    <label class="field"><span class="field-label" data-i18n="vehicle.transmission"></span>
      <select id="cv-tx"><option value="">${t('vehicle.tx_unknown')}</option>${TX_OPTIONS.map(x => `<option value="${x}">${t('vehicle.tx.' + x)}</option>`).join('')}</select>
    </label>
    <label class="field"><span class="field-label" data-i18n="vehicle.engine"></span><input id="cv-engine" type="number" step="0.1" value="1.6"></label>
    <label class="field"><span class="field-label" data-i18n="vehicle.power"></span><input id="cv-power" type="number" value="110"></label>
    <label class="field"><span class="field-label" data-i18n="vehicle.tank"></span><input id="cv-tank" type="number" value="50"></label>
    <label class="field"><span class="field-label" data-i18n="vehicle.consumption"></span><input id="cv-cons" type="number" step="0.1" value="8"></label>
    <label class="field"><span class="field-label" data-i18n="vehicle.weight"></span><input id="cv-weight" type="number" value="1300"></label>
    <button class="btn primary block" id="cv-save" data-i18n="common.save"></button>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      overlay.querySelector('#cv-save').addEventListener('click', async () => {
        const name = overlay.querySelector('#cv-name').value.trim() || presetName || 'Мой автомобиль';
        const tx = overlay.querySelector('#cv-tx').value;
        const vehicle = {
          id: uuid(),
          makeId: preset ? preset.make.id : '',
          modelId: preset ? preset.model.id : '',
          trimId: null,
          // Движок регламента читает тип коробки из названия комплектации —
          // подставляем выбранное, чтобы вариатор не считался автоматом.
          trimName: tx ? tx.toUpperCase() : '',
          years: '',
          customName: name, displayName: name,
          engineVolumeL: parseFloat(overlay.querySelector('#cv-engine').value) || 0,
          fuelType: overlay.querySelector('#cv-fuel').value || 'petrol',
          powerHp: parseInt(overlay.querySelector('#cv-power').value) || 0,
          tankLiters: parseFloat(overlay.querySelector('#cv-tank').value) || 50,
          consumptionL100: parseFloat(overlay.querySelector('#cv-cons').value) || 8,
          curbWeightKg: parseFloat(overlay.querySelector('#cv-weight').value) || 1300,
          odometerBaseKm: 0, odometerBaseDate: Date.now(), isPrimary: true, fuelPriceRub: 60,
        };
        vehicle.rangeKm = vehicle.consumptionL100 > 0
          ? vehicle.tankLiters / vehicle.consumptionL100 * 100 : 0;
        vehicle.bodyType = bodyTypeFor(vehicle.modelId, vehicle.displayName);
        vehicle.colorId = 'blue';
        await DB.put('vehicles', vehicle);
        closeModal();
        if (preset) closeModal();
        refresh();
      });
    }
  });
  applyI18nTree(overlay);
}
