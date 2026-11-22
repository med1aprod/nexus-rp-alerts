'use strict';

(function () {
  const POLL_INTERVAL = 5000;
  const $ = (id) => document.getElementById(id);
  const card = $('statusCard');
  let currentSince = null;
  let lastPayload = null;
  let toastTimer = null;

  function dateParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
    return {
      date: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date),
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
    };
  }

  function duration(value) {
    if (!value) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days) return days + ' дн. ' + hours + ' ч.';
    if (hours) return hours + ' ч. ' + minutes + ' мин.';
    return minutes + ' мин.';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function showConnection(connected) {
    const indicator = $('connectionIndicator').parentElement;
    indicator.classList.toggle('ok', connected);
    indicator.classList.toggle('fail', !connected);
    $('connectionText').textContent = connected ? 'СИСТЕМА НА СВЯЗИ' : 'НЕТ СОЕДИНЕНИЯ';
    $('updatedLabel').textContent = connected ? 'ДАННЫЕ АКТУАЛЬНЫ' : 'ОЖИДАНИЕ СОЕДИНЕНИЯ';
  }

  function renderStatus(current) {
    if (!current) {
      card.dataset.status = 'unknown';
      $('statusCaption').textContent = 'СТАТУС ЕЩЁ НЕ ЗАДАН';
      $('statusTitle').textContent = 'Нет данных';
      $('statusDescription').textContent = 'Ожидаем первое обновление статуса от игровой системы.';
      $('lastChanged').textContent = '—';
      $('duration').textContent = '—';
      return;
    }
    const isGreen = current.status === 'green';
    card.dataset.status = isGreen ? 'green' : 'red';
    $('statusCaption').textContent = 'ТЕКУЩИЙ ИГРОВОЙ СТАТУС';
    $('statusTitle').textContent = isGreen ? 'Код зелёный' : 'Код красный';
    $('statusDescription').textContent = isGreen
      ? 'Игровой сервер работает в штатном режиме.'
      : 'На игровом сервере активирован специальный внутриигровой режим.';
    $('lastChanged').textContent = dateParts(current.changed_at).time + ' · ' + dateParts(current.changed_at).date;
    currentSince = current.changed_at;
    $('duration').textContent = duration(currentSince);
  }

  function renderHistory(items) {
    $('historyCount').textContent = items.length + ' / 50';
    $('historyCounter').textContent = String(items.length).padStart(2, '0');
    if (!items.length) {
      $('historyList').innerHTML = '<div class="empty-state"><span class="empty-icon">◷</span><strong>История пока пуста</strong><p>Когда статус изменится в игре, событие появится здесь.</p></div>';
      return;
    }
    $('historyList').innerHTML = items.map((item) => {
      const green = item.status === 'green';
      const parts = dateParts(item.changed_at);
      const title = green ? 'Активирован «Код зелёный»' : 'Активирован «Код красный»';
      const detail = [item.changed_by, item.note].filter(Boolean).map(escapeHtml).join(' · ') || 'Системное событие Nexus RP';
      return '<article class="history-item"><div class="event-main"><span class="event-icon ' + (green ? 'green' : 'red') + '">' + (green ? '✓' : '!' ) + '</span><div><div class="event-title">' + title + '</div><div class="event-meta">' + detail + '</div></div></div><div class="event-time">' + parts.time + '<small>' + parts.date + '</small></div></article>';
    }).join('');
  }

  async function refresh() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store', headers: { 'Accept': 'application/json' } });
      if (!response.ok) throw new Error('API ' + response.status);
      const payload = await response.json();
      if (!payload.ok) throw new Error('API unavailable');
      lastPayload = payload;
      renderStatus(payload.current);
      renderHistory(Array.isArray(payload.history) ? payload.history.slice(0, 50) : []);
      showConnection(true);
      $('lastCheck').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
    } catch (_error) {
      showConnection(false);
      if (!lastPayload) {
        card.dataset.status = 'unknown';
        $('statusCaption').textContent = 'СОЕДИНЕНИЕ С API';
        $('statusTitle').textContent = 'Система недоступна';
        $('statusDescription').textContent = 'Не удалось получить данные. Повторная проверка будет выполнена автоматически.';
      }
      $('lastCheck').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
    }
  }

  $('menuBtn').addEventListener('click', () => {
    const open = $('navLinks')?.classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', String(Boolean(open)));
  });
  document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
    document.querySelector('.nav-links').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
  }));

  $('year').textContent = new Date().getFullYear();
  refresh();
  setInterval(refresh, POLL_INTERVAL);
  setInterval(() => { if (currentSince) $('duration').textContent = duration(currentSince); }, 30000);
})();
