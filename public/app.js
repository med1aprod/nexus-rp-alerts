'use strict';

(() => {
  const POLL_INTERVAL = 5000;
  const $ = (id) => document.getElementById(id);
  const card = $('statusCard');
  let currentSince = null;
  let lastPayload = null;

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
    return {
      date: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date),
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
    };
  }

  function formatDuration(value) {
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

  function setConnection(connected) {
    $('connectionIndicatorWrap').classList.toggle('ok', connected);
    $('connectionIndicatorWrap').classList.toggle('fail', !connected);
    $('connectionText').textContent = connected ? 'СИСТЕМА НА СВЯЗИ' : 'НЕТ СОЕДИНЕНИЯ';
  }

  function renderStatus(current) {
    if (!current) {
      card.dataset.status = 'unknown';
      $('statusCaption').textContent = 'СТАТУС НЕ УСТАНОВЛЕН';
      $('statusTitle').textContent = 'Ожидание данных';
      $('statusDescription').textContent = 'Система ожидает первое обновление статуса от игрового сервера.';
      $('lastChanged').textContent = '—';
      $('duration').textContent = '—';
      currentSince = null;
      return;
    }
    const green = current.status === 'green';
    const stamp = formatDate(current.changed_at);
    card.dataset.status = green ? 'green' : 'red';
    $('statusCaption').textContent = 'ТЕКУЩИЙ ИГРОВОЙ СТАТУС';
    $('statusTitle').textContent = green ? 'Код зелёный' : 'Код красный';
    $('statusDescription').textContent = green
      ? 'Штатный режим игрового сервера. Статус действует до следующего обновления.'
      : 'Активирован специальный внутриигровой режим. Следите за дальнейшими обновлениями.';
    $('lastChanged').textContent = stamp.time + ' · ' + stamp.date;
    currentSince = current.changed_at;
    $('duration').textContent = formatDuration(currentSince);
  }

  function renderHistory(items) {
    $('historyCount').textContent = String(items.length).padStart(2, '0') + ' / 50';
    $('historyCounter').textContent = String(items.length).padStart(2, '0');
    if (!items.length) {
      $('historyList').innerHTML = '<div class="empty-state"><span class="empty-mark">—</span><strong>Событий пока нет</strong><p>Новые изменения появятся здесь автоматически.</p></div>';
      return;
    }
    $('historyList').innerHTML = items.map((item) => {
      const green = item.status === 'green';
      const stamp = formatDate(item.changed_at);
      const title = green ? 'Установлен статус «Код зелёный»' : 'Установлен статус «Код красный»';
      const details = [item.changed_by, item.note].filter(Boolean).map(escapeHtml).join(' · ') || 'Событие игровой системы';
      return '<article class="history-item"><div class="event-main"><span class="event-icon ' + (green ? 'green' : 'red') + '">' + (green ? '✓' : '!') + '</span><div><div class="event-title">' + title + '</div><div class="event-meta">' + details + '</div></div></div><div class="event-time">' + stamp.time + '<small>' + stamp.date + '</small></div></article>';
    }).join('');
  }

  async function refresh() {
    try {
      const response = await fetch('/api/status', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('API ' + response.status);
      const payload = await response.json();
      if (!payload.ok) throw new Error('API unavailable');
      lastPayload = payload;
      renderStatus(payload.current);
      renderHistory(Array.isArray(payload.history) ? payload.history.slice(0, 50) : []);
      setConnection(true);
    } catch (_error) {
      setConnection(false);
      if (!lastPayload) {
        card.dataset.status = 'unknown';
        $('statusCaption').textContent = 'СОЕДИНЕНИЕ С СИСТЕМОЙ';
        $('statusTitle').textContent = 'Нет связи';
        $('statusDescription').textContent = 'Не удалось получить данные. Повторная проверка произойдёт автоматически.';
      }
    }
    $('lastCheck').textContent = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  }

  $('menuBtn').addEventListener('click', () => {
    const open = $('navLinks').classList.toggle('open');
    $('menuBtn').setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => {
    $('navLinks').classList.remove('open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    document.querySelectorAll('.main-nav a').forEach((item) => item.classList.toggle('active', item === link));
  }));

  $('year').textContent = new Date().getFullYear();
  refresh();
  setInterval(refresh, POLL_INTERVAL);
  setInterval(() => {
    if (currentSince) $('duration').textContent = formatDuration(currentSince);
  }, 30000);
})();