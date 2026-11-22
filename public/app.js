'use strict';

(function () {
  const INTERVAL = 5000;
  const $ = (id) => document.getElementById(id);
  const CAT_LABEL = { drone: 'Беспилотная', rocket: 'Ракетная' };

  function pad(n) { return String(n).padStart(2, '0'); }

  function clockTick() {
    const el = $('clock');
    if (!el) return;
    const d = new Date();
    el.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).format(d);
  }

  function ageText(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return s + ' с';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' мин';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 48) return h + ' ч' + (rm ? ' ' + rm + ' мин' : '');
    return Math.floor(h / 24) + ' дн';
  }

  function setConn(state, label) {
    const pill = $('connPill');
    const text = $('connLabel');
    if (pill) pill.dataset.state = state;
    if (text) text.textContent = label;
  }

  function paintCard(prefix, cat) {
    const card = $('card-' + prefix);
    if (!card || !cat) return;

    const display = cat.displayStatus || 'stale';
    card.dataset.state = display;

    const codeEl = $(prefix + '-code');
    const labelEl = $(prefix + '-label');
    const badgeEl = $(prefix + '-badge');
    const updatedEl = $(prefix + '-updated');
    const ageEl = $(prefix + '-age');

    if (display === 'green') {
      if (codeEl) codeEl.textContent = 'ЗЕЛЁНЫЙ';
      if (labelEl) labelEl.textContent = 'Штатный режим · угроз нет';
      if (badgeEl) badgeEl.textContent = 'СПОКОЙНО';
    } else if (display === 'red') {
      if (codeEl) codeEl.textContent = 'КРАСНЫЙ';
      if (labelEl) labelEl.textContent = 'Объявлена тревога';
      if (badgeEl) badgeEl.textContent = 'ТРЕВОГА';
    } else {
      if (codeEl) codeEl.textContent = 'НЕТ СВЯЗИ';
      if (labelEl) labelEl.textContent = 'Вероятно, статус устарел и не имеет значения';
      if (badgeEl) badgeEl.textContent = 'OFFLINE';
    }

    if (updatedEl) {
      const t = fmtTime(cat.updatedAt);
      const d = fmtDate(cat.updatedAt);
      updatedEl.textContent = cat.updatedAt ? (t + (d ? ' · ' + d : '')) : '—';
    }
    if (ageEl) ageEl.textContent = ageText(cat.ageSeconds);
  }

  function paintHistory(items) {
    const list = Array.isArray(items) ? items.slice(0, 50) : [];
    const counter = $('historyCounter');
    const empty = $('timelineEmpty');
    const ul = $('timelineList');
    if (counter) counter.textContent = String(list.length);
    if (!ul) return;

    if (!list.length) {
      if (empty) empty.hidden = false;
      ul.hidden = true;
      ul.innerHTML = '';
      return;
    }
    if (empty) empty.hidden = true;
    ul.hidden = false;

    ul.innerHTML = list.map((item, idx) => {
      const status = item.newStatus || item.status || 'green';
      const isGreen = status === 'green';
      const catKey = item.category === 'rocket' ? 'rocket' : item.category === 'drone' ? 'drone' : '';
      const catName = CAT_LABEL[catKey] || 'Статус';
      const time = fmtTime(item.updatedAt || item.changed_at);
      const date = fmtDate(item.updatedAt || item.changed_at);
      const title = isGreen ? (catName + ' — отбой') : (catName + ' — тревога');
      const tone = isGreen ? 'green' : 'red';

      return (
        '<li class="tl-item tl-' + tone + '" style="--i:' + idx + '">' +
          '<div class="tl-rail"><span class="tl-dot"></span></div>' +
          '<div class="tl-card">' +
            '<div class="tl-head">' +
              '<span class="tl-tag">' + (isGreen ? 'ОТБОЙ' : 'ТРЕВОГА') + '</span>' +
              '<span class="tl-cat">' + catName + '</span>' +
            '</div>' +
            '<p class="tl-title">' + title + '</p>' +
            '<div class="tl-foot">' +
              '<time>' + time + '</time>' +
              (date ? '<span class="tl-date">' + date + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</li>'
      );
    }).join('');
  }

  async function load() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setConn('fail', 'НЕТ СВЯЗИ');
        return;
      }

      const connected = data.connection && data.connection.isConnected;
      setConn(connected ? 'ok' : 'warn', connected ? 'СЕРВЕР НА СВЯЗИ' : 'НЕТ HEARTBEAT');

      const cats = data.categories || {};
      paintCard('drone', cats.drone || { displayStatus: 'stale', ageSeconds: null });
      paintCard('rocket', cats.rocket || { displayStatus: 'stale', ageSeconds: null });
      paintHistory(data.history);
    } catch (e) {
      setConn('fail', 'ОШИБКА СЕТИ');
      console.warn(e);
    }
  }

  document.querySelectorAll('.nav-link').forEach((a) => {
    a.addEventListener('click', () => {
      document.querySelectorAll('.nav-link').forEach((x) => x.classList.remove('is-active'));
      a.classList.add('is-active');
    });
  });

  clockTick();
  setInterval(clockTick, 1000);
  load();
  setInterval(load, INTERVAL);
})();
