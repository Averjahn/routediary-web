import { DB } from '../db.js';
import { AppState, getPrimaryVehicle } from '../state.js';
import { addDays, dayKeyOf, Fmt, todayKey } from '../format.js';
import { t, getLang } from '../i18n.js';
import { applyI18nTree, icon, MODE_ICON, EXPENSE_ICON } from '../ui.js';
import { calcCalories, calcFuel } from '../geo.js';
import { THEMES } from '../theme.js';

let containerRef = null;
let period = 'week';

export function render(container) {
  containerRef = container;
  container.innerHTML = `
    <h1 class="page-title" data-i18n="stats.title"></h1>
    <div class="pad" style="padding-top:0;padding-bottom:0;">
      <div class="chip-row">
        <button class="chip ${period==='week'?'active':''}" data-period="week" data-i18n="stats.period_week"></button>
        <button class="chip ${period==='month'?'active':''}" data-period="month" data-i18n="stats.period_month"></button>
      </div>
    </div>
    <div id="stats-body"></div>
  `;
  applyI18nTree(container);
  container.querySelectorAll('[data-period]').forEach(btn => btn.addEventListener('click', () => {
    period = btn.dataset.period;
    container.querySelectorAll('[data-period]').forEach(b => b.classList.toggle('active', b === btn));
    refresh();
  }));
  refresh();
}

export async function refresh() {
  if (!containerRef) return;
  const body = containerRef.querySelector('#stats-body');
  const days = period === 'week' ? 7 : 30;
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) dayKeys.push(addDays(todayKey(), -i));

  const trips = await DB.getAll('trips');
  const vehicle = await getPrimaryVehicle();
  const [refuels, expenses] = vehicle
    ? await Promise.all([DB.getAllByIndex('refuels', 'vehicleId', vehicle.id), DB.getAllByIndex('expenses', 'vehicleId', vehicle.id)])
    : [[], []];

  const byDay = dayKeys.map(dk => {
    const dayTrips = trips.filter(tr => tr.dayKey === dk);
    let walkKm = 0, carKm = 0, kcal = 0, fuelCost = 0;
    for (const tr of dayTrips) {
      if (tr.mode === 'car') {
        carKm += tr.distanceMeters / 1000;
        const f = calcFuel(tr.distanceMeters, vehicle ? vehicle.consumptionL100 : 8, vehicle ? vehicle.fuelPriceRub : 55);
        fuelCost += f.cost;
      } else {
        walkKm += tr.distanceMeters / 1000;
        kcal += calcCalories(tr.mode, tr.avgMovingSpeedKmh, tr.movingTimeSec, AppState.weightKg);
      }
    }
    return { dayKey: dk, walkKm, carKm, kcal, fuelCost };
  });

  const totals = byDay.reduce((acc, d) => ({
    walkKm: acc.walkKm + d.walkKm, carKm: acc.carKm + d.carKm, kcal: acc.kcal + d.kcal, fuelCost: acc.fuelCost + d.fuelCost,
  }), { walkKm: 0, carKm: 0, kcal: 0, fuelCost: 0 });

  const hasData = totals.walkKm > 0 || totals.carKm > 0;

  body.innerHTML = `
    <div class="section-title" data-i18n="stats.totals"></div>
    <div class="card">
      <div class="day-summary-row">
        <div class="day-summary-chip">${MODE_ICON.walk} <span data-i18n="stats.total_foot"></span><b>${Fmt.distanceKm(totals.walkKm*1000, AppState.units)}</b></div>
        <div class="day-summary-chip">${MODE_ICON.car} <span data-i18n="stats.total_car"></span><b>${Fmt.distanceKm(totals.carKm*1000, AppState.units)}</b></div>
      </div>
      <div class="day-summary-row">
        <div class="day-summary-chip">${icon('flame',{size:16})} <span data-i18n="stats.total_kcal"></span><b>${Fmt.kcal(totals.kcal)}</b></div>
        <div class="day-summary-chip">${EXPENSE_ICON.fuel} <span data-i18n="stats.total_fuel"></span><b>${Fmt.money(totals.fuelCost, AppState.currency)}</b></div>
      </div>
    </div>

    ${hasData ? `
    <div class="section-title" data-i18n="chart.foot_km"></div>
    <div class="card"><canvas class="chart" id="chart-walk" height="120"></canvas></div>
    <div class="section-title" data-i18n="chart.car_km"></div>
    <div class="card"><canvas class="chart" id="chart-car" height="120"></canvas></div>
    <div class="section-title" data-i18n="stats.expenses_title"></div>
    <div class="card"><canvas class="chart" id="chart-pie" height="180"></canvas></div>
    <div class="section-title" data-i18n="stats.cumulative_title"></div>
    <div class="card"><canvas class="chart" id="chart-cum" height="120"></canvas></div>
    ` : `<div class="empty-state" data-i18n="stats.no_data"></div>`}
  `;
  applyI18nTree(body);

  if (!hasData) return;

  drawBarChart(body.querySelector('#chart-walk'), byDay.map(d => d.walkKm), THEMES[AppState.theme].walk, dayKeys);
  drawBarChart(body.querySelector('#chart-car'), byDay.map(d => d.carKm), THEMES[AppState.theme].car, dayKeys);
  drawPieChart(body.querySelector('#chart-pie'), expenses, refuels, totals.fuelCost);
  drawCumulative(body.querySelector('#chart-cum'), byDay);
}

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement.clientWidth - 28;
  const height = parseInt(canvas.getAttribute('height'), 10) || 120;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width, height };
}

function drawBarChart(canvas, values, color, dayKeys) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const max = Math.max(...values, 0.001);
  const padBottom = 16, padTop = 6;
  const barAreaH = height - padBottom - padTop;
  const gap = 3;
  const barW = (width - gap * (values.length - 1)) / values.length;
  ctx.fillStyle = color;
  values.forEach((v, i) => {
    const h = (v / max) * barAreaH;
    const x = i * (barW + gap);
    const y = padTop + (barAreaH - h);
    ctx.beginPath();
    const r = Math.min(4, barW / 2);
    roundRect(ctx, x, y, barW, Math.max(h, 1), r);
    ctx.fill();
  });
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  const stepLabels = values.length > 10 ? Math.ceil(values.length / 7) : 1;
  dayKeys.forEach((dk, i) => {
    if (i % stepLabels !== 0) return;
    const label = dk.slice(5).replace('-', '.');
    const x = i * (barW + gap) + barW / 2;
    ctx.fillText(label, x, height - 3);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPieChart(canvas, expenses, refuels, fuelCostEstimated) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const fuelSum = refuels.reduce((s, r) => s + r.totalCost, 0) || fuelCostEstimated;
  const byCat = {};
  for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const slices = [{ key: 'fuel', value: fuelSum, color: THEMES[AppState.theme].car }];
  for (const [cat, val] of Object.entries(byCat)) {
    const colorMap = { wash: THEMES[AppState.theme].bike, service: THEMES[AppState.theme].warning, repairs: THEMES[AppState.theme].run, other: THEMES[AppState.theme].textSecondary };
    slices.push({ key: cat, value: val, color: colorMap[cat] || THEMES[AppState.theme].textSecondary });
  }
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total <= 0) {
    ctx.fillStyle = '#999'; ctx.font = '13px Inter'; ctx.textAlign = 'center';
    ctx.fillText(t('chart.expenses_empty') || '—', width / 2, height / 2);
    return;
  }
  const cx = width / 2 - 40, cy = height / 2, r = Math.min(height, width) / 2 - 10;
  let start = -Math.PI / 2;
  slices.forEach(sl => {
    if (sl.value <= 0) return;
    const angle = (sl.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = sl.color;
    ctx.fill();
    start += angle;
  });
  // legend
  let legendY = 14;
  ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'left';
  slices.filter(sl => sl.value > 0).forEach(sl => {
    ctx.fillStyle = sl.color;
    ctx.fillRect(width - 78, legendY - 8, 9, 9);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary') || '#000';
    const label = t('expense.' + sl.key);
    ctx.fillText(label, width - 64, legendY);
    legendY += 15;
  });
}

function drawCumulative(canvas, byDay) {
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  let cum = 0;
  const values = byDay.map(d => (cum += d.walkKm + d.carKm));
  const max = Math.max(...values, 0.001);
  const padBottom = 16, padTop = 8;
  const h = height - padBottom - padTop;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = padTop + h - (v / max) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = THEMES[AppState.theme].accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#888';
  ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(cum)} ${t('unit.km')}`, width - 4, 12);
}

