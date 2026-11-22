'use strict';

(function () {
  const INTERVAL = 5000;
  const byId = (id) => document.getElementById(id);
  const card = byId('statusCard');
  let lastGoodResponse = false;
  let activeSince = null;
  let requestInProgress = false;

  function dateParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: '—', time: '—' };
    return {
      date: new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date),
      time: new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
    };
  }

  function elapsed(value) {
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

  function connectionState(state) {
    const element = byId('connection');
    element.classList.toggle('ok', state);
    element.classList.toggle('fail', !state);
    byId('connectionText').textContent = state ? 'СИСТЕМА НА СВЯЗИ' : 'НЕТ СОЕДИНЕНИЯ';
  }

  function showStatus(current) {
    if (!current) {
      card.dataset.status = 'unknown';
      byId('statusEyebrow').textContent = 'СТАТУС ЕЩЁ НЕ УСТАНОВЛЕН';
      byId('statusTitle').textContent = 'Ожидание данных';
      byId('statusDescription').textContent = 'Система ожидает первое обновление статуса игрового сервера.';
      byId('lastChanged').textContent = '—';
      byId('activeDuration').textContent = '—';
      activeSince = null;
      return;
    }
    const green = current.status === 'green';
    const stamp = dateParts(current.changed_at);
    card.dataset.status = green ? 'green' : 'red';
    byId('statusEyebrow').textContent = 'ТЕКУЩИЙ ИГРОВОЙ СТАТУС';
    byId('statusTitle').textContent = green ? 'Код зелёный' : 'Код красный';
    byId('statusDescription').textContent = green
      ? 'Штатный режим игрового сервера. Статус действует до следующего обновления.'
      : 'На сервере действует особый внутриигровой режим. Следите за обновлениями.';
    byId('lastChanged').textContent = stamp.time + ' · ' + stamp.date;
    activeSince = current.changed_at;
    byId('activeDuration').textContent = elapsed(activeSince);
  }

  function showHistory(items) {
    const list = Array.isArray(items) ? items.slice(0, 50) : [];
    byId('historyCount').textContent = String(list.length).padStart(2, '0') + ' / 50';
    byId('historyCounter').textContent = String(list.length).padStart(2, '0');
    if (!list.length) {
      byId('historyList').innerHTML = '<div class="empty-state"><span>✳</span><b>Журнал пока пуст</b><p>Когда статус изменится, запись появится здесь.</p></div>';
      return;
    }
    byId('historyList').innerHTML = list.map((item) => {
      const green = item.status === 'green';
      const stamp = dateParts(item.changed_at);
      const title = green ? 'Установлен статус «Код зелёный»' : 'Установлен статус «Код красный»';
      const detail = [item.changed_by, item.note].filter(Boolean).map(escapeHtml).join(' · ') || 'Событие игровой системы';
      return '<article class="history-item"><div class="event-main"><span class="event-icon ' + (green ? 'green' : 'red') + '">' + (green ? '✓' : '!') + '</span><div><div class="event-title">' + title + '</div><div class="event-meta">' + detail + '</div></div></div><div class="event-time">' + stamp.time + '<small>' + stamp.date + '</small></div></article>';
    }).join('');
  }

  async function refresh() {
    if (requestInProgress) return;
    requestInProgress = true;
    try {
      const response = await fetch('/api/status', {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Status API returned ' + response.status);
      const data = await response.json();
      if (!data || data.ok !== true) throw new Error('Invalid status response');
      showStatus(data.current || null);
      showHistory(data.history || []);
      lastGoodResponse = true;
      connectionState(true);
    } catch (_error) {
      connectionState(false);
      if (!lastGoodResponse) {
        card.dataset.status = 'unknown';
        byId('statusEyebrow').textContent = 'ПРОВЕРКА СОЕДИНЕНИЯ';
        byId('statusTitle').textContent = 'Данные недоступны';
        byId('statusDescription').textContent = 'Повторная попытка подключения будет выполнена автоматически.';
      }
    } finally {
      byId('lastCheck').textContent = new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(new Date());
      requestInProgress = false;
    }
  }

  byId('menuToggle').addEventListener('click', function () {
    const open = byId('navLinks').classList.toggle('open');
    this.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('.nav-links a').forEach((link) => {
    link.addEventListener('click', () => {
      byId('navLinks').classList.remove('open');
      byId('menuToggle').setAttribute('aria-expanded', 'false');
      document.querySelectorAll('.nav-links a').forEach((item) => item.classList.toggle('active', item === link));
    });
  });

  byId('year').textContent = new Date().getFullYear();
  refresh();
  window.setInterval(refresh, INTERVAL);
  window.setInterval(() => {
    if (activeSince) byId('activeDuration').textContent = elapsed(activeSince);
  }, 30000);
})();