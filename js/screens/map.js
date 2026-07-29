import { DB } from '../db.js';
import { AppState } from '../state.js';
import { addDays, dayLabel, Fmt, uuid, dayKeyOf } from '../format.js';
import { t } from '../i18n.js';
import { el, applyI18nTree, openModal, closeModal, MODE_ICON, CATEGORY_ICON } from '../ui.js';
import { startRecording, stopRecording, isRecording, onLivePoint, addManualTrip, recomputeSegmentation } from '../tracking.js';
import { THEMES } from '../theme.js';
import { calcFuel, calcCalories } from '../geo.js';
import { getPrimaryVehicle } from '../state.js';

let leafletMap = null;
let liveLine = null;
let livePoints = [];
let tripLayers = [];
let refreshTimer = null;

export function render(container) {
  container.innerHTML = `
    <div id="map-view">
      <div id="leaflet-map"></div>
      <div class="map-top-bar">
        <div class="day-selector">
          <button id="map-day-prev">←</button>
          <div class="day-label" id="map-day-label"></div>
          <button id="map-day-next">→</button>
        </div>
      </div>
      <div class="map-bottom-sheet">
        <div class="gps-hint" id="map-bg-warning" data-i18n="map.bg_warning"></div>
        <div class="day-summary-row" id="map-summary"></div>
        <button class="record-btn" id="map-record-btn"></button>
        <div style="text-align:center;margin-top:10px;">
          <button class="btn sm" id="map-manual-btn" data-i18n="map.manual_add"></button>
        </div>
      </div>
    </div>
  `;
  applyI18nTree(container);

  container.querySelector('#map-day-prev').addEventListener('click', () => changeDay(-1));
  container.querySelector('#map-day-next').addEventListener('click', () => changeDay(1));
  container.querySelector('#map-manual-btn').addEventListener('click', openManualTripForm);

  initLeaflet(container);
  refreshDayLabel();
  refreshRecordButton();
  loadDayTrips();

  onLivePoint((point, err) => {
    if (err) return;
    if (point && AppState.recording) {
      livePoints.push(point);
      updateLiveLine();
    }
  });
}

function initLeaflet(container) {
  const mapEl = container.querySelector('#leaflet-map');
  leafletMap = L.map(mapEl, { zoomControl: false, attributionControl: true }).setView([55.751244, 37.618423], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(leafletMap);
  L.control.zoom({ position: 'bottomright' }).addTo(leafletMap);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => leafletMap && leafletMap.invalidateSize(), 150);
  });

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => leafletMap.setView([pos.coords.latitude, pos.coords.longitude], 14),
      () => {},
      { timeout: 5000 }
    );
  }
}

async function changeDay(delta) {
  AppState.currentDay = addDays(AppState.currentDay, delta);
  refreshDayLabel();
  await loadDayTrips();
}

function refreshDayLabel() {
  const labelEl = document.getElementById('map-day-label');
  if (labelEl) labelEl.textContent = dayLabel(AppState.currentDay);
}

function refreshRecordButton() {
  const btn = document.getElementById('map-record-btn');
  if (!btn) return;
  btn.classList.toggle('recording', AppState.recording);
  btn.innerHTML = AppState.recording
    ? `⏹ <span>${t('map.stop_recording')}</span>`
    : `▶ <span>${t('map.start_recording')}</span>`;
  btn.onclick = onRecordClick;
}

async function onRecordClick() {
  if (AppState.recording) {
    await stopRecording();
    refreshRecordButton();
    await loadDayTrips();
    return;
  }
  try {
    await startRecording();
    livePoints = [];
    refreshRecordButton();
  } catch (e) {
    alert(t('map.permission_denied'));
  }
}

function updateLiveLine() {
  if (!leafletMap) return;
  const latlngs = livePoints.map(p => [p.lat, p.lon]);
  if (!liveLine) {
    liveLine = L.polyline(latlngs, { color: THEMES[AppState.theme].car, weight: 4 }).addTo(leafletMap);
  } else {
    liveLine.setLatLngs(latlngs);
  }
  if (latlngs.length > 0) leafletMap.panTo(latlngs[latlngs.length - 1]);
}

async function loadDayTrips() {
  tripLayers.forEach(l => leafletMap.removeLayer(l));
  tripLayers = [];

  const trips = await DB.getAllByIndex('trips', 'dayKey', AppState.currentDay);
  trips.sort((a, b) => a.startTime - b.startTime);

  const bounds = [];
  for (const trip of trips) {
    const points = await DB.getAllByIndex('trackPoints', 'tripId', trip.id);
    points.sort((a, b) => a.timestamp - b.timestamp);
    if (points.length < 2) continue;
    const latlngs = points.map(p => [p.lat, p.lon]);
    const color = THEMES[AppState.theme][trip.mode] || THEMES[AppState.theme].car;
    const line = L.polyline(latlngs, { color, weight: 4 }).addTo(leafletMap);
    line.on('click', () => openTripCard(trip));
    tripLayers.push(line);
    bounds.push(...latlngs);

    const startMarker = L.circleMarker(latlngs[0], { radius: 5, color, fillColor: color, fillOpacity: 1 }).addTo(leafletMap);
    const endMarker = L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(leafletMap);
    tripLayers.push(startMarker, endMarker);
  }
  if (bounds.length > 0) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
  }

  await renderSummary(trips);
}

async function renderSummary(trips) {
  const vehicle = await getPrimaryVehicle();
  let walkKm = 0, kcal = 0, carKm = 0, liters = 0, cost = 0;
  for (const trip of trips) {
    if (trip.mode === 'walk' || trip.mode === 'run' || trip.mode === 'bike') {
      walkKm += trip.distanceMeters / 1000;
      kcal += calcCalories(trip.mode, trip.avgMovingSpeedKmh, trip.movingTimeSec, AppState.weightKg);
    } else if (trip.mode === 'car') {
      carKm += trip.distanceMeters / 1000;
      const consumption = vehicle ? vehicle.consumptionL100 : 8;
      const price = vehicle ? vehicle.fuelPriceRub : 55;
      const f = calcFuel(trip.distanceMeters, consumption, price);
      liters += f.liters;
      cost += f.cost;
    }
  }
  const summaryEl = document.getElementById('map-summary');
  if (!summaryEl) return;
  summaryEl.innerHTML = `
    <div class="day-summary-chip">🚶 <b>${Fmt.distanceKm(walkKm * 1000, AppState.units)}</b> ${Fmt.kcal(kcal)}</div>
    <div class="day-summary-chip">🚗 <b>${Fmt.distanceKm(carKm * 1000, AppState.units)}</b> ${Fmt.liters(liters)} · ${Fmt.money(cost, AppState.currency)}</div>
  `;
}

function openTripCard(trip) {
  window.dispatchEvent(new CustomEvent('open-trip-card', { detail: trip.id }));
}

function openManualTripForm() {
  const now = new Date();
  const startDefault = new Date(now.getTime() - 20 * 60000);
  const toInputTime = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="manual.title"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="manual.label"></span><input id="mt-label" data-i18n-ph="trip.label_placeholder"></label>
    <div class="row" style="gap:10px;">
      <label class="field grow"><span class="field-label" data-i18n="manual.start"></span><input id="mt-start" type="time" value="${toInputTime(startDefault)}"></label>
      <label class="field grow"><span class="field-label" data-i18n="manual.end"></span><input id="mt-end" type="time" value="${toInputTime(now)}"></label>
    </div>
    <label class="field"><span class="field-label" data-i18n="manual.distance"></span><input id="mt-distance" type="number" min="0" step="0.1" value="5"></label>
    <div class="field"><span class="field-label" data-i18n="manual.mode"></span>
      <div class="chip-row" id="mt-mode">
        <button class="chip active" data-mode="walk">🚶 ${t('mode.walk')}</button>
        <button class="chip" data-mode="run">🏃 ${t('mode.run')}</button>
        <button class="chip" data-mode="bike">🚴 ${t('mode.bike')}</button>
        <button class="chip" data-mode="car">🚗 ${t('mode.car')}</button>
      </div>
    </div>
    <div class="field"><span class="field-label" data-i18n="manual.category"></span>
      <div class="chip-row" id="mt-category">
        ${['none','work','home','shop','medical','leisure','other'].map((c,i) => `<button class="chip ${i===0?'active':''}" data-cat="${c}">${CATEGORY_ICON[c]} ${t('category.'+c)}</button>`).join('')}
      </div>
    </div>
    <button class="btn primary block" id="mt-save" data-i18n="common.save"></button>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      let mode = 'walk', category = 'none';
      overlay.querySelector('#mt-mode').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#mt-mode .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); mode = btn.dataset.mode;
      });
      overlay.querySelector('#mt-category').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#mt-category .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); category = btn.dataset.cat;
      });
      overlay.querySelector('#mt-save').addEventListener('click', async () => {
        const dayKey = AppState.currentDay;
        const [sh, sm] = overlay.querySelector('#mt-start').value.split(':').map(Number);
        const [eh, em] = overlay.querySelector('#mt-end').value.split(':').map(Number);
        const base = new Date(dayKey + 'T00:00:00');
        const start = new Date(base); start.setHours(sh, sm, 0, 0);
        const end = new Date(base); end.setHours(eh, em, 0, 0);
        if (end <= start) end.setDate(end.getDate() + 1);
        const distanceKm = parseFloat(overlay.querySelector('#mt-distance').value) || 0;
        const label = overlay.querySelector('#mt-label').value.trim();
        await addManualTrip({
          dayKey, startTime: start.getTime(), endTime: end.getTime(),
          distanceKm, mode, category, label,
        });
        closeModal();
        loadDayTrips();
      });
    }
  });
  applyI18nTree(overlay);
}

export function refresh() {
  refreshDayLabel();
  refreshRecordButton();
  loadDayTrips();
}
