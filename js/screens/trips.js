import { DB } from '../db.js';
import { getVehicles, AppState } from '../state.js';
import { addDays, dayLabel, Fmt } from '../format.js';
import { t } from '../i18n.js';
import { el, applyI18nTree, openModal, closeModal, MODE_ICON, CATEGORY_ICON } from '../ui.js';
import { calcCalories, calcFuel } from '../geo.js';
import { getPrimaryVehicle } from '../state.js';

let containerRef = null;

export function render(container) {
  containerRef = container;
  container.innerHTML = `
    <h1 class="page-title" data-i18n="trips.title"></h1>
    <div class="day-selector">
      <button id="trips-day-prev">←</button>
      <div class="day-label" id="trips-day-label"></div>
      <button id="trips-day-next">→</button>
    </div>
    <div id="trips-list" class="pad" style="padding-top:0"></div>
  `;
  applyI18nTree(container);
  container.querySelector('#trips-day-prev').addEventListener('click', () => changeDay(-1));
  container.querySelector('#trips-day-next').addEventListener('click', () => changeDay(1));
  window.addEventListener('open-trip-card', (e) => openTripCardById(e.detail));
  refresh();
}

async function changeDay(delta) {
  AppState.currentDay = addDays(AppState.currentDay, delta);
  await refresh();
}

export async function refresh() {
  if (!containerRef) return;
  const labelEl = containerRef.querySelector('#trips-day-label');
  if (labelEl) labelEl.textContent = dayLabel(AppState.currentDay);

  const listEl = containerRef.querySelector('#trips-list');
  if (!listEl) return;

  const trips = await DB.getAllByIndex('trips', 'dayKey', AppState.currentDay);
  trips.sort((a, b) => a.startTime - b.startTime);

  if (trips.length === 0) {
    listEl.innerHTML = `<div class="empty-state" data-i18n="trips.empty"></div>`;
    applyI18nTree(listEl);
    return;
  }

  const vehicle = await getPrimaryVehicle();
  const rows = [];
  for (const trip of trips) {
    let rightInfo = '';
    if (trip.mode === 'car') {
      rightInfo = `<span class="badge c${trip.congestionScore || 1}">${t('congestion.badge.' + (trip.congestionScore || 1))}</span>`;
    } else {
      const kcal = calcCalories(trip.mode, trip.avgMovingSpeedKmh, trip.movingTimeSec, AppState.weightKg);
      rightInfo = `<span class="muted">${Fmt.kcal(kcal)}</span>`;
    }
    rows.push(`
      <div class="list-item" data-trip="${trip.id}">
        <div class="icon-badge">${MODE_ICON[trip.mode]}</div>
        <div class="grow">
          <div style="font-weight:600;">${trip.label ? escapeHtml(trip.label) : t('common.untitled')}</div>
          <div class="muted">${Fmt.time(trip.startTime)}–${Fmt.time(trip.endTime)} · ${Fmt.distanceKm(trip.distanceMeters, AppState.units)}</div>
        </div>
        ${rightInfo}
      </div>
    `);
  }
  listEl.innerHTML = `<div class="card" style="padding:0 14px;">${rows.join('')}</div>`;
  listEl.querySelectorAll('.list-item').forEach(node => {
    node.addEventListener('click', () => openTripCardById(node.dataset.trip));
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function openTripCardById(id) {
  const trip = await DB.get('trips', id);
  if (!trip) return;
  const vehicle = await getPrimaryVehicle();

  let metricsHtml = '';
  if (trip.mode === 'car') {
    const consumption = vehicle ? vehicle.consumptionL100 : 8;
    const price = vehicle ? vehicle.fuelPriceRub : 55;
    const f = calcFuel(trip.distanceMeters, consumption, price);
    const stoppedPct = trip.endTime > trip.startTime
      ? Math.round((1 - trip.movingTimeSec / ((trip.endTime - trip.startTime) / 1000)) * 100)
      : 0;
    metricsHtml = `
      <div class="row between"><span class="muted" data-i18n="metric.fuel"></span><b>${Fmt.liters(f.liters)}</b></div>
      <div class="row between"><span class="muted" data-i18n="metric.cost"></span><b>${Fmt.money(f.cost, AppState.currency)}</b></div>
      <div class="row between"><span class="muted" data-i18n="trip.section_congestion"></span><span class="badge c${trip.congestionScore||1}">${t('congestion.title.'+(trip.congestionScore||1))}</span></div>
      <div class="muted" style="margin-top:4px;">${t('congestion.speed_stopped', { speed: Fmt.speed(trip.avgMovingSpeedKmh, AppState.units), pct: Math.max(0, stoppedPct) })}</div>
    `;
  } else {
    const kcal = calcCalories(trip.mode, trip.avgMovingSpeedKmh, trip.movingTimeSec, AppState.weightKg);
    metricsHtml = `<div class="row between"><span class="muted" data-i18n="metric.calories"></span><b>${Fmt.kcal(kcal)}</b></div>`;
  }

  // Выбор машины показываем только там, где он осмысленный: поездка на авто
  // и в гараже есть из чего выбирать. Пешая прогулка к машине не относится,
  // а при единственной машине ряд был бы кнопкой без альтернативы.
  const vehicles = await getVehicles();
  const vehicleFieldHtml = (trip.mode === 'car' && vehicles.length > 1) ? `
    <div class="field"><span class="field-label" data-i18n="trip.vehicle"></span>
      <div class="chip-row" id="tc-vehicle">
        ${vehicles.map(v => `<button class="chip ${v.id === trip.vehicleId ? 'active' : ''}" data-veh="${v.id}">${(v.displayName || 'Авто').replace(/[<>&"]/g, '')}</button>`).join('')}
      </div>
    </div>` : '';

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="trip.title"></h2><button class="modal-close">✕</button></div>
    <div id="trip-mini-map" style="height:160px;border-radius:12px;overflow:hidden;margin-bottom:12px;background:var(--surface-alt);"></div>
    <label class="field"><span class="field-label" data-i18n="trip.label_placeholder"></span><input id="tc-label" value="${trip.label ? trip.label.replace(/"/g,'&quot;') : ''}"></label>
    <div class="field"><span class="field-label" data-i18n="trip.mode"></span>
      <div class="chip-row" id="tc-mode">
        ${['walk','run','bike','car'].map(m => `<button class="chip ${m===trip.mode?'active':''}" data-mode="${m}">${MODE_ICON[m]} ${t('mode.'+m)}</button>`).join('')}
      </div>
    </div>
    ${vehicleFieldHtml}
    <div class="field"><span class="field-label" data-i18n="trip.category"></span>
      <div class="chip-row" id="tc-category">
        ${['none','work','home','shop','medical','leisure','other'].map(c => `<button class="chip ${c===trip.category?'active':''}" data-cat="${c}">${CATEGORY_ICON[c]} ${t('category.'+c)}</button>`).join('')}
      </div>
    </div>
    <div class="card" style="margin:12px 0;padding:12px;">
      <div class="row between"><span class="muted" data-i18n="metric.distance"></span><b>${Fmt.distanceKm(trip.distanceMeters, AppState.units)}</b></div>
      <div class="row between"><span class="muted" data-i18n="metric.duration"></span><b>${Fmt.duration((trip.endTime-trip.startTime)/1000)}</b></div>
      <div class="row between"><span class="muted" data-i18n="metric.moving"></span><b>${Fmt.duration(trip.movingTimeSec)}</b></div>
      <div class="row between"><span class="muted" data-i18n="metric.avg_speed"></span><b>${Fmt.speed(trip.avgMovingSpeedKmh, AppState.units)}</b></div>
      <div class="row between"><span class="muted" data-i18n="metric.max_speed"></span><b>${Fmt.speed(trip.maxSpeedKmh, AppState.units)}</b></div>
      ${metricsHtml}
    </div>
    <label class="field"><span class="field-label" data-i18n="trip.notes"></span><textarea id="tc-notes">${trip.notes || ''}</textarea></label>
    <div class="row" style="gap:10px;">
      <button class="btn block" id="tc-save" data-i18n="common.save"></button>
      <button class="btn danger" id="tc-delete" data-i18n="common.delete"></button>
    </div>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      let mode = trip.mode, category = trip.category;
      overlay.querySelector('#tc-mode').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#tc-mode .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); mode = btn.dataset.mode;
      });
      let vehicleId = trip.vehicleId;
      overlay.querySelector('#tc-vehicle')?.addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#tc-vehicle .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); vehicleId = btn.dataset.veh;
      });
      overlay.querySelector('#tc-category').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#tc-category .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); category = btn.dataset.cat;
      });
      overlay.querySelector('#tc-save').addEventListener('click', async () => {
        trip.label = overlay.querySelector('#tc-label').value.trim();
        trip.notes = overlay.querySelector('#tc-notes').value.trim();
        trip.mode = mode; trip.isModeManual = mode !== trip.mode;
        // Смена машины меняет пробег сразу у двух: у прежней он уменьшится.
        trip.vehicleId = mode === 'car' ? vehicleId : null;
        trip.category = category;
        await DB.put('trips', trip);
        closeModal();
        refresh();
      });
      overlay.querySelector('#tc-delete').addEventListener('click', async () => {
        await DB.delete('trips', trip.id);
        closeModal();
        refresh();
      });

      setTimeout(async () => {
        const points = await DB.getAllByIndex('trackPoints', 'tripId', trip.id);
        if (points.length < 2) { overlay.querySelector('#trip-mini-map').textContent = '—'; return; }
        points.sort((a,b) => a.timestamp - b.timestamp);
        const mini = L.map(overlay.querySelector('#trip-mini-map'), { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mini);
        const latlngs = points.map(p => [p.lat, p.lon]);
        const line = L.polyline(latlngs, { color: '#0A66D6', weight: 4 }).addTo(mini);
        mini.fitBounds(line.getBounds(), { padding: [10, 10] });
      }, 50);
    }
  });
  applyI18nTree(overlay);
}
