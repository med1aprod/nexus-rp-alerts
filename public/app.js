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

  function showStatus(current) {
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
      const green = item.status === 'green';
      const stamp = dateParts(item.changed_at);
      const title = green ? 'Установлен статус «Код зелёный»' : 'Установлен статус «Код красный»';
      const detail = [item.changed_by, item.note].filter(Boolean).map(escapeHtml).join(' · ') || 'Событие игровой системы';
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
      byId('lastCheck') && (byId('lastCheck').textContent = new Date().toLocaleTimeString('ru-RU'));
      if (!response.ok || !data.ok) {
        connectionState(false);
        if (!lastGoodResponse) showStatus(null);
        toast('Нет связи с API статусов');
        return;
      }
      lastGoodResponse = true;
      connectionState(true);
      showStatus(data.current);
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

  /* TEMP diagnostics — remove later */
  const dbgLogLines = [];
  function dbgLog(msg) {
    const line = new Date().toLocaleTimeString('ru-RU') + '  ' + msg;
    dbgLogLines.unshift(line);
    if (dbgLogLines.length > 40) dbgLogLines.pop();
    const el = byId('dbgLog');
    if (el) el.textContent = dbgLogLines.join('\n');
  }
  function setDbg(id, text, ok) {
    const el = byId(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'fail');
    if (ok === true) el.classList.add('ok');
    if (ok === false) el.classList.add('fail');
  }
  async function runDiagnostics() {
    const fetchEl = byId('dbgFetch');
    if (fetchEl) fetchEl.textContent = new Date().toLocaleTimeString('ru-RU');
    try {
      const hr = await fetch('/api/health', { cache: 'no-store' });
      const hj = await hr.json().catch(() => ({}));
      setDbg('dbgHealth', hr.status + ' · ' + (hj.ok ? 'ok' : 'fail'), Boolean(hj.ok));
      setDbg('dbgDb', hj.database || ('HTTP ' + hr.status), hj.database === 'connected');
      const d = hj.diagnostics || {};
      setDbg('dbgDbUrl', d.hasDatabaseUrl ? 'задан' : 'НЕТ', Boolean(d.hasDatabaseUrl));
      setDbg('dbgKey', d.hasApiKey ? 'задан' : 'НЕТ / короткий', Boolean(d.hasApiKey));
      dbgLog('health ' + hr.status + ' ' + JSON.stringify(hj));
    } catch (e) {
      setDbg('dbgHealth', 'сеть: ' + e.message, false);
      dbgLog('health ERROR ' + e.message);
    }
    try {
      const sr = await fetch('/api/status', { cache: 'no-store' });
      const sj = await sr.json().catch(() => ({}));
      setDbg('dbgStatus', sr.status + ' · ' + (sj.ok ? 'ok' : (sj.error || 'fail')), Boolean(sj.ok));
      if (sj.current) {
        setDbg('dbgCurrent', sj.current.status + ' @ ' + (sj.current.changed_at || '—'), true);
      } else {
        setDbg('dbgCurrent', sj.ok ? 'ещё нет данных' : (sj.error || '—'), sj.ok ? null : false);
      }
      const hist = Array.isArray(sj.history) ? sj.history.length : 0;
      setDbg('dbgHistory', hist + ' записей', sj.ok ? true : false);
      dbgLog('status ' + sr.status + ' ' + JSON.stringify(sj).slice(0, 500));
    } catch (e) {
      setDbg('dbgStatus', 'сеть: ' + e.message, false);
      dbgLog('status ERROR ' + e.message);
    }
  }
  const debugToggle = byId('debugToggle');
  if (debugToggle) {
    debugToggle.addEventListener('click', () => {
      const panel = byId('debugPanel');
      if (!panel) return;
      panel.classList.toggle('is-collapsed');
      debugToggle.textContent = panel.classList.contains('is-collapsed') ? 'развернуть' : 'свернуть';
    });
  }
  runDiagnostics();
  setInterval(runDiagnostics, 5000);
})();
