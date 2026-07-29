import { DB } from '../db.js';
import { AppState } from '../state.js';
import { addDays, dayLabel, Fmt, uuid } from '../format.js';
import { t } from '../i18n.js';
import { applyI18nTree, openModal, closeModal, MODE_ICON, CATEGORY_ICON } from '../ui.js';
import { hourlyRecommendations } from '../geo.js';

let containerRef = null;
let plannerDay = null;

export function render(container) {
  containerRef = container;
  plannerDay = AppState.currentDay;
  container.innerHTML = `
    <h1 class="page-title" data-i18n="planner.title"></h1>
    <div class="day-selector">
      <button id="pl-day-prev">←</button>
      <div class="day-label" id="pl-day-label"></div>
      <button id="pl-day-next">→</button>
    </div>
    <div id="pl-recs"></div>
    <div class="section-title" data-i18n="planner.title"></div>
    <div id="pl-list" class="pad" style="padding-top:0"></div>
    <div style="text-align:center;margin-bottom:20px;"><button class="btn" id="pl-add" data-i18n="planner.add"></button></div>
  `;
  applyI18nTree(container);
  container.querySelector('#pl-day-prev').addEventListener('click', () => changeDay(-1));
  container.querySelector('#pl-day-next').addEventListener('click', () => changeDay(1));
  container.querySelector('#pl-add').addEventListener('click', () => openPlanEdit(null));
  refresh();
}

async function changeDay(delta) {
  plannerDay = addDays(plannerDay, delta);
  await refresh();
}

export async function refresh() {
  if (!containerRef) return;
  containerRef.querySelector('#pl-day-label').textContent = dayLabel(plannerDay);

  const trips = await DB.getAll('trips');
  const carTrips = trips.filter(t => t.mode === 'car');
  const recs = hourlyRecommendations(carTrips);
  const recsEl = containerRef.querySelector('#pl-recs');

  if (carTrips.length < 5) {
    recsEl.innerHTML = `<div class="card muted" data-i18n="planner.rec_not_enough"></div>`;
    applyI18nTree(recsEl);
  } else {
    const d = new Date(plannerDay + 'T00:00:00');
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const bucket = isWeekend ? recs.weekend : recs.weekday;
    const fmtHours = (arr) => arr.map(h => `${String(h.hour).padStart(2,'0')}:00 (${Math.round(h.avgSpeed)} ${t('unit.kmh')})`).join(', ') || '—';
    recsEl.innerHTML = `
      <div class="card">
        <div class="row between"><span class="muted" data-i18n="planner.rec_best"></span></div>
        <b>${fmtHours(bucket.best)}</b>
        <div class="row between" style="margin-top:8px;"><span class="muted" data-i18n="planner.rec_worst"></span></div>
        <b>${fmtHours(bucket.worst)}</b>
      </div>`;
    applyI18nTree(recsEl);
  }

  const listEl = containerRef.querySelector('#pl-list');
  const items = await DB.getAllByIndex('plannedActivities', 'dayKey', plannerDay);
  items.sort((a, b) => a.plannedStart - b.plannedStart);

  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-state" data-i18n="planner.empty"></div>`;
    applyI18nTree(listEl);
    return;
  }

  const dayTrips = await DB.getAllByIndex('trips', 'dayKey', plannerDay);

  listEl.innerHTML = `<div class="card" style="padding:0 14px;">` + items.map(item => {
    const hour = new Date(item.plannedStart).getHours();
    const d = new Date(plannerDay + 'T00:00:00');
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const bucket = isWeekend ? recs.weekend : recs.weekday;
    const isBad = item.isTrip && bucket.worst.some(w => w.hour === hour) && carTrips.length >= 5;

    let matchedTrip = null;
    if (item.isTrip) {
      matchedTrip = dayTrips.find(t2 => Math.abs(t2.startTime - item.plannedStart) <= 60 * 60000);
    }

    return `
      <div class="list-item" data-plan="${item.id}">
        <div class="icon-badge">${CATEGORY_ICON[item.category] || '⚪'}</div>
        <div class="grow">
          <div style="font-weight:600;text-decoration:${item.completed?'line-through':'none'};opacity:${item.completed?0.6:1};">${escapeHtml(item.title)}</div>
          <div class="muted">${Fmt.time(item.plannedStart)} · ${item.plannedDurationMin} мин</div>
          ${matchedTrip ? `<div class="muted">✓ ${Fmt.time(matchedTrip.startTime)}–${Fmt.time(matchedTrip.endTime)}</div>` : ''}
          ${isBad ? `<div style="color:var(--warning);font-size:12px;margin-top:2px;">${t('rec.hint_traffic', { speed: Math.round(bucket.byHour[hour]?.reduce((a,b)=>a+b,0)/ (bucket.byHour[hour]?.length||1) || 0) + ' ' + t('unit.kmh'), hour: (bucket.best[0] ? String(bucket.best[0].hour).padStart(2,'0')+':00' : '—') })}</div>` : ''}
        </div>
        <input type="checkbox" data-toggle="${item.id}" ${item.completed?'checked':''} style="width:20px;height:20px;">
      </div>`;
  }).join('') + '</div>';

  listEl.querySelectorAll('[data-toggle]').forEach(cb => cb.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = items.find(i => i.id === cb.dataset.toggle);
    item.completed = cb.checked;
    await DB.put('plannedActivities', item);
  }));
  listEl.querySelectorAll('.list-item').forEach(node => node.addEventListener('click', (e) => {
    if (e.target.matches('input')) return;
    const item = items.find(i => i.id === node.dataset.plan);
    openPlanEdit(item);
  }));
}

function escapeHtml(s) {
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function openPlanEdit(item) {
  const isNew = !item;
  const draft = item || { id: uuid(), dayKey: plannerDay, title: '', category: 'none', plannedStart: Date.now(), plannedDurationMin: 30, notes: '', isTrip: false, completed: false, linkedTripId: null };
  const d = new Date(draft.plannedStart);
  const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  const overlay = openModal(`
    <div class="modal-header"><h2 data-i18n="plan.new_title"></h2><button class="modal-close">✕</button></div>
    <label class="field"><span class="field-label" data-i18n="plan.title"></span><input id="pe-title" value="${escapeHtml(draft.title)}"></label>
    <div class="field"><span class="field-label" data-i18n="plan.category"></span>
      <div class="chip-row" id="pe-cat">${['none','work','home','shop','medical','leisure','other'].map(c => `<button class="chip ${c===draft.category?'active':''}" data-cat="${c}">${CATEGORY_ICON[c]} ${t('category.'+c)}</button>`).join('')}</div>
    </div>
    <div class="row" style="gap:10px;">
      <label class="field grow"><span class="field-label" data-i18n="plan.time"></span><input id="pe-time" type="time" value="${timeStr}"></label>
      <label class="field grow"><span class="field-label" data-i18n="plan.duration"></span><input id="pe-dur" type="number" value="${draft.plannedDurationMin}"></label>
    </div>
    <label class="row" style="gap:8px;margin-bottom:14px;"><input type="checkbox" id="pe-trip" style="width:auto;" ${draft.isTrip?'checked':''}><span data-i18n="plan.is_trip"></span></label>
    <label class="field"><span class="field-label" data-i18n="plan.note"></span><textarea id="pe-note">${draft.notes||''}</textarea></label>
    <div class="row" style="gap:10px;">
      <button class="btn block" id="pe-save" data-i18n="common.save"></button>
      ${!isNew ? `<button class="btn danger" id="pe-delete" data-i18n="common.delete"></button>` : ''}
    </div>
  `, {
    onMount: (overlay) => {
      overlay.querySelector('.modal-close').addEventListener('click', closeModal);
      let category = draft.category;
      overlay.querySelector('#pe-cat').addEventListener('click', e => {
        const btn = e.target.closest('.chip'); if (!btn) return;
        overlay.querySelectorAll('#pe-cat .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active'); category = btn.dataset.cat;
      });
      overlay.querySelector('#pe-save').addEventListener('click', async () => {
        const [h, m] = overlay.querySelector('#pe-time').value.split(':').map(Number);
        const base = new Date(plannerDay + 'T00:00:00');
        base.setHours(h, m, 0, 0);
        draft.title = overlay.querySelector('#pe-title').value.trim() || t('common.untitled');
        draft.category = category;
        draft.plannedStart = base.getTime();
        draft.plannedDurationMin = parseInt(overlay.querySelector('#pe-dur').value) || 30;
        draft.isTrip = overlay.querySelector('#pe-trip').checked;
        draft.notes = overlay.querySelector('#pe-note').value.trim();
        draft.dayKey = plannerDay;
        await DB.put('plannedActivities', draft);
        closeModal(); refresh();
      });
      overlay.querySelector('#pe-delete')?.addEventListener('click', async () => {
        await DB.delete('plannedActivities', draft.id);
        closeModal(); refresh();
      });
    }
  });
  applyI18nTree(overlay);
}
