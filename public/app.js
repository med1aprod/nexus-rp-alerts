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
      '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
    }[char]));
  }

  function connectionState(state) {
    const element = byId('connection');
    if (!element) return;
    element.classList.toggle('ok', state);
    element.classList.toggle('fail', !state);
    const t = byId('connectionText');
    if (t) t.textContent = state ? 'СИСТЕМА НА СВЯЗИ' : 'НЕТ СОЕДИНЕНИЯ';
  }

  function showStatusFromLegacy(current) {
    if (!card) return;
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
    const stamp = dateParts(current.changed_at || current.updatedAt);
    card.dataset.status = green ? 'green' : 'red';
    byId('statusEyebrow').textContent = 'ТЕКУЩИЙ ИГРОВОЙ СТАТУС';
    byId('statusTitle').textContent = green ? 'Код зелёный' : 'Код красный';
    byId('statusDescription').textContent = green
      ? 'Штатный режим игрового сервера. Статус действует до следующего обновления.'
      : 'На сервере действует особый внутриигровой режим. Следите за обновлениями.';
    byId('lastChanged').textContent = stamp.time + ' · ' + stamp.date;
    activeSince = current.changed_at || current.updatedAt;
    byId('activeDuration').textContent = elapsed(activeSince);
  }

  function showStatusFromCategories(categories) {
    if (!card || !categories) return showStatusFromLegacy(null);
    const drone = categories.drone || {};
    const rocket = categories.rocket || {};
    const droneLive = drone.displayStatus === 'red' || drone.displayStatus === 'green';
    const rocketLive = rocket.displayStatus === 'red' || rocket.displayStatus === 'green';

    const anyRed =
      drone.displayStatus === 'red' || rocket.displayStatus === 'red';
    const anyGreen =
      drone.displayStatus === 'green' || rocket.displayStatus === 'green';

    let overall = 'unknown';
    if (anyRed) overall = 'red';
    else if (anyGreen) overall = 'green';
    else if (drone.isStale || rocket.isStale) overall = 'unknown';

    const newest = [drone.updatedAt, rocket.updatedAt]
      .filter(Boolean)
      .sort()
      .reverse()[0] || null;

    const droneLabel =
      drone.displayStatus === 'red' ? 'КРАСНЫЙ'
        : drone.displayStatus === 'green' ? 'ЗЕЛЁНЫЙ'
          : 'нет данных';
    const rocketLabel =
      rocket.displayStatus === 'red' ? 'КРАСНЫЙ'
        : rocket.displayStatus === 'green' ? 'ЗЕЛЁНЫЙ'
          : 'нет данных';

    if (overall === 'unknown' && !droneLive && !rocketLive) {
      return showStatusFromLegacy(null);
    }

    card.dataset.status = overall === 'red' ? 'red' : overall === 'green' ? 'green' : 'unknown';
    byId('statusEyebrow').textContent = 'БЕСПИЛОТНАЯ · РАКЕТНАЯ';
    byId('statusTitle').textContent =
      overall === 'red' ? 'Код красный'
        : overall === 'green' ? 'Код зелёный'
          : 'Ожидание данных';
    byId('statusDescription').textContent =
      'Беспилотная: ' + droneLabel + ' · Ракетная: ' + rocketLabel;
    const stamp = dateParts(newest);
    byId('lastChanged').textContent = newest ? stamp.time + ' · ' + stamp.date : '—';
    activeSince = newest;
    byId('activeDuration').textContent = elapsed(activeSince);
  }

  function showHistory(items) {
    const list = Array.isArray(items) ? items.slice(0, 50) : [];
    const hc = byId('historyCount');
    const hcounter = byId('historyCounter');
    if (hc) hc.textContent = String(list.length).padStart(2, '0') + ' / 50';
    if (hcounter) hcounter.textContent = String(list.length).padStart(2, '0');
    const historyList = byId('historyList');
    if (!historyList) return;
    if (!list.length) {
      historyList.innerHTML = '<div class="empty-state"><span>✳</span><b>Журнал пока пуст</b><p>Когда статус изменится, запись появится здесь.</p></div>';
      return;
    }
    historyList.innerHTML = list.map((item) => {
      const status = item.newStatus || item.status;
      const green = status === 'green';
      const stamp = dateParts(item.updatedAt || item.changed_at);
      const cat =
        item.category === 'drone' ? 'Беспилотная'
          : item.category === 'rocket' ? 'Ракетная'
            : '';
      const title = cat
        ? (green ? cat + ': код зелёный' : cat + ': код красный')
        : (green ? 'Установлен статус «Код зелёный»' : 'Установлен статус «Код красный»');
      const detail = [item.source, item.changed_by, item.note].filter(Boolean).map(escapeHtml).join(' · ') || 'Событие игровой системы';
      return '<article class="history-item ' + (green ? 'green' : 'red') + '"><div class="event-main"><span class="event-badge">' + (green ? 'GREEN' : 'RED') + '</span><div><strong>' + title + '</strong><p>' + detail + '</p></div></div><div class="event-time"><b>' + stamp.time + '</b><span>' + stamp.date + '</span></div></article>';
    }).join('');
  }

  function toast(message) {
    const el = byId('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2800);
  }

  async function load() {
    if (requestInProgress) return;
    requestInProgress = true;
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (byId('lastCheck')) byId('lastCheck').textContent = new Date().toLocaleTimeString('ru-RU');
      if (!response.ok || !data.ok) {
        connectionState(false);
        if (!lastGoodResponse) showStatusFromLegacy(null);
        toast('Нет связи с API статусов');
        return;
      }
      lastGoodResponse = true;
      connectionState(true);
      if (data.categories) {
        showStatusFromCategories(data.categories);
      } else {
        showStatusFromLegacy(data.current);
      }
      showHistory(data.history);
    } catch (error) {
      connectionState(false);
      toast('Ошибка сети');
      console.warn(error);
    } finally {
      requestInProgress = false;
    }
  }

  const menuToggle = byId('menuToggle');
  const navLinks = byId('navLinks');
  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const year = byId('year');
  if (year) year.textContent = String(new Date().getFullYear());

  setInterval(() => {
    if (activeSince && byId('activeDuration')) byId('activeDuration').textContent = elapsed(activeSince);
  }, 30000);

  load();
  setInterval(load, INTERVAL);
})();
