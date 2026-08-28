/**
 * Внутренняя панель: кто завёл учётную запись и когда пользовался.
 *
 * Открывается сочетанием Q+W+E и паролем. В общий бандл не входит — её
 * подгружают динамическим import() в момент нажатия, поэтому обычный
 * посетитель этот файл никогда не скачивает.
 *
 * ТЕКСТ ЗДЕСЬ НАРОЧНО НЕ ЧЕРЕЗ СЛОВАРЬ. Это инструмент для одного
 * человека — владельца, — а не экран приложения: переводить его на
 * девять языков значит засорять словарь строками, которых никто, кроме
 * него, не увидит. Файл поэтому внесён в исключения теста на зашитый
 * текст, и это единственная причина исключения.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ — автомобилей и поездок. Они зашифрованы
 * ключом устройства, сервер его не имеет, а идентификаторы записей ещё и
 * «ослеплены»: сервер не знает даже, поездка это или заправка. Показать
 * марку машины отсюда нельзя не потому, что не написали код, а потому
 * что таких данных на сервере нет. Подробности — в server/adminUsers.js.
 */
import { openModal, closeModal, escapeHtml } from './ui.js';

/** Байты в человеческий вид: панель смотрят глазами, а не парсером. */
function size(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit',
                                     hour: '2-digit', minute: '2-digit' });
}

function day(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error('http_' + res.status);
  return res.json();
}

/** Вход. Пароль уходит на сервер, сессия возвращается в httpOnly-куке. */
export function openAdminLogin() {
  if (document.querySelector('.admin-panel')) return;
  openModal(`
    <div class="admin-panel">
      <h3>Панель</h3>
      <input type="password" id="admin-pass" inputmode="numeric" autocomplete="off" placeholder="Пароль">
      <p class="admin-err" id="admin-err" hidden></p>
      <button class="btn primary" id="admin-go">Войти</button>
    </div>`, {
    onMount(overlay) {
      const pass = overlay.querySelector('#admin-pass');
      const err = overlay.querySelector('#admin-err');
      const go = overlay.querySelector('#admin-go');
      pass.focus();

      async function submit() {
        go.disabled = true;
        err.hidden = true;
        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ password: pass.value }),
          });
          if (res.status === 429) throw new Error('Слишком много попыток, подождите');
          if (!res.ok) throw new Error('Неверный пароль');
          closeModal();
          await openAdminUsers();
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
          pass.select();
        } finally {
          go.disabled = false;
        }
      }

      go.addEventListener('click', submit);
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    },
  });
}

/** Таблица: строка на человека, щелчок по строке открывает карточку. */
export async function openAdminUsers() {
  let data;
  try {
    data = await api('/api/admin/users');
  } catch (e) {
    if (e.message === 'unauthorized') return openAdminLogin();
    throw e;
  }

  const rows = data.users.map(u => `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.login)}${u.pro ? ' <b class="admin-pro">Про</b>' : ''}</td>
      <td>${day(u.created_at)}</td>
      <td class="${u.active ? 'admin-live' : ''}">${when(u.last_sync)}</td>
      <td>${u.records || 0}</td>
      <td>${size(u.bytes)}</td>
      <td>${u.devices || 0}</td>
      <td>${u.paid_rub ? u.paid_rub + ' ₽' : '—'}</td>
      <td>${u.traffic_source ? escapeHtml(u.traffic_source) : '—'}</td>
    </tr>`).join('');

  const active = data.users.filter(u => u.active).length;

  openModal(`
    <div class="admin-panel wide">
      <h3>Пользователи · ${data.users.length}<span class="admin-sub">активных за 30 дней: ${active}</span></h3>
      <div class="admin-scroll">
        <table class="admin-table">
          <thead><tr>
            <th>Учётная запись</th><th>Регистрация</th><th>Последняя синхронизация</th>
            <th>Записей</th><th>Объём</th><th>Устройств</th><th>Оплачено</th><th>Плакат</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8">Пока никого</td></tr>'}</tbody>
        </table>
      </div>
      <p class="admin-note">Автомобилей и маршрутов здесь нет: они зашифрованы на устройстве,
      у сервера нет ключа. «Последняя синхронизация» — это когда человек последний раз
      пользовался приложением с включённой синхронизацией.</p>
    </div>`, {
    onMount(overlay) {
      // Ширину окна задаём классом, а не селектором :has(): его нет в
      // Safari до 15.4, а целевой телефон — iPhone SE на iOS 15.
      overlay.querySelector('.modal-sheet')?.classList.add('admin-wide');
      overlay.querySelectorAll('tbody tr[data-id]').forEach(tr => {
        tr.addEventListener('click', () => openAdminUser(tr.dataset.id));
      });
    },
  });
}

/** Карточка: устройства, платежи и дни, когда человек что-то синхронизировал. */
export async function openAdminUser(id) {
  const u = await api('/api/admin/users/' + encodeURIComponent(id));

  const sessions = u.sessions.map(s => `
    <tr><td>${escapeHtml(s.device || '—')}</td><td>${when(s.created_at)}</td>
        <td>${s.live ? 'активна' : 'истекла'}</td></tr>`).join('');

  const invoices = u.invoices.map(i => `
    <tr><td>${day(i.created_at)}</td><td>${escapeHtml(i.plan || '—')}</td>
        <td>${escapeHtml(i.method || '—')}</td><td>${i.amount_rub ? i.amount_rub + ' ₽' : '—'}</td>
        <td>${escapeHtml(i.status || '—')}</td></tr>`).join('');

  // Столбики по дням. Высота относительно самого нагруженного дня — так видно форму
  // пользования, а не абсолютные числа, которые тут мало что значат.
  const peak = Math.max(1, ...u.daily.map(d => d.records));
  const bars = u.daily.slice().reverse().map(d => `
    <span class="admin-bar" title="${d.day}: ${d.records}"
          style="height:${Math.max(4, Math.round(d.records / peak * 40))}px"></span>`).join('');

  openModal(`
    <div class="admin-panel wide">
      <h3>${escapeHtml(u.login)}${u.pro ? ' <b class="admin-pro">Про</b>' : ''}</h3>
      <div class="admin-facts">
        <div><b>${u.records || 0}</b><span>записей</span></div>
        <div><b>${size(u.bytes)}</b><span>объём</span></div>
        <div><b>${day(u.created_at)}</b><span>регистрация</span></div>
        <div><b>${when(u.last_sync)}</b><span>последняя синхронизация</span></div>
        <div><b>${u.invited || 0}</b><span>пригласил</span></div>
        <div><b>${u.traffic_source ? escapeHtml(u.traffic_source) : '—'}</b><span>плакат</span></div>
      </div>

      <h4>Дни, когда пользовался</h4>
      <div class="admin-bars">${bars || '<span class="admin-note">нет данных</span>'}</div>
      <p class="admin-note">Считается по времени последнего изменения записи. Это «в этот день
      человек пользовался приложением», а не число поездок: у записи одна отметка времени,
      при повторной правке прежняя затирается.</p>

      <h4>Устройства</h4>
      <div class="admin-scroll short">
        <table class="admin-table">
          <thead><tr><th>Устройство</th><th>Вход</th><th>Сессия</th></tr></thead>
          <tbody>${sessions || '<tr><td colspan="3">Входов не было</td></tr>'}</tbody>
        </table>
      </div>

      <h4>Платежи</h4>
      <div class="admin-scroll short">
        <table class="admin-table">
          <thead><tr><th>Дата</th><th>План</th><th>Способ</th><th>Сумма</th><th>Статус</th></tr></thead>
          <tbody>${invoices || '<tr><td colspan="5">Платежей не было</td></tr>'}</tbody>
        </table>
      </div>

      <button class="btn" id="admin-back">К списку</button>
    </div>`, {
    onMount(overlay) {
      overlay.querySelector('.modal-sheet')?.classList.add('admin-wide');
      overlay.querySelector('#admin-back').addEventListener('click', () => {
        // Закрываем карточку, а список под ней уже открыт: стопка окон
        // держит его целым, повторно тянуть данные с сервера незачем.
        closeModal();
      });
    },
  });
}
