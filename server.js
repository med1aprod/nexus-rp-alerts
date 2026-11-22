'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const STALE_AFTER_SECONDS = Math.max(30, Number(process.env.STALE_AFTER_SECONDS || 120));
const VALID_CATEGORIES = new Set(['drone', 'rocket']);
const VALID_STATUSES = new Set(['green', 'red']);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

let databaseReady = false;
let initializing = false;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  next();
});

async function initializeDatabase() {
  if (!pool || initializing || databaseReady) return;
  initializing = true;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS current_status (
        category   VARCHAR(20) PRIMARY KEY CHECK (category IN ('drone', 'rocket')),
        status     VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source     VARCHAR(80)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS status_history (
        id              BIGSERIAL PRIMARY KEY,
        category        VARCHAR(20) NOT NULL,
        previous_status VARCHAR(20),
        new_status      VARCHAR(20) NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source          VARCHAR(80),
        event_type      VARCHAR(40) NOT NULL DEFAULT 'status_change'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_state (
        id                  SMALLINT PRIMARY KEY CHECK (id = 1),
        last_heartbeat_at   TIMESTAMPTZ,
        last_roblox_seen_at TIMESTAMPTZ
      )
    `);
    await pool.query(`INSERT INTO system_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    for (const cat of ['drone', 'rocket']) {
      await pool.query(
        `INSERT INTO current_status (category, status, updated_at, source)
         VALUES ($1, 'green', NOW() - INTERVAL '1 year', 'system')
         ON CONFLICT (category) DO NOTHING`,
        [cat]
      );
    }
    databaseReady = true;
    console.log('[db] ready');
  } catch (error) {
    databaseReady = false;
    console.error('[db] init failed:', error.message);
  } finally {
    initializing = false;
  }
}

function isAuthorized(req) {
  const expected = process.env.STATUS_API_KEY;
  if (!expected || expected.length < 8) return false;
  const authorization = req.get('authorization') || '';
  const supplied =
    req.get('x-api-key') ||
    (authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function displayOf(row, serverConnected) {
  if (!row) {
    return {
      category: null,
      status: null,
      displayStatus: 'stale',
      updatedAt: null,
      source: null,
      ageSeconds: null,
      isStale: true,
      message: 'Информация пока отсутствует'
    };
  }
  const updatedAt = new Date(row.updated_at);
  const ageSeconds = Math.floor((Date.now() - updatedAt.getTime()) / 1000);
  // Пока Roblox-сервер на связи — всегда green/red.
  // Stale только если сервера нет дольше STALE_AFTER_SECONDS.
  const isStale = !serverConnected;
  return {
    category: row.category,
    status: row.status,
    displayStatus: isStale ? 'stale' : row.status,
    updatedAt: updatedAt.toISOString(),
    source: row.source || null,
    ageSeconds,
    isStale,
    message: isStale ? 'Вероятно, статус устарел и не имеет значения.' : null
  };
}

app.get('/api/health', async (_req, res) => {
  let lastSeen = null;
  if (pool && databaseReady) {
    try {
      const r = await pool.query('SELECT last_roblox_seen_at FROM system_state WHERE id = 1');
      lastSeen = r.rows[0] && r.rows[0].last_roblox_seen_at;
    } catch (_) {}
  }
  res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    service: 'sever-operativ',
    database: databaseReady ? 'connected' : 'unavailable',
    staleAfterSeconds: STALE_AFTER_SECONDS,
    lastRobloxSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null
  });
});

app.get('/api/status', async (_req, res) => {
  if (!pool || !databaseReady) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
  try {
    const [currentRes, historyRes, stateRes] = await Promise.all([
      pool.query('SELECT category, status, updated_at, source FROM current_status'),
      pool.query(
        `SELECT id, category, previous_status, new_status, updated_at, source, event_type
         FROM status_history ORDER BY updated_at DESC, id DESC LIMIT 50`
      ),
      pool.query('SELECT last_roblox_seen_at, last_heartbeat_at FROM system_state WHERE id = 1')
    ]);
    const state = stateRes.rows[0] || {};
    const lastSeen = state.last_roblox_seen_at;
    const isConnected = Boolean(
      lastSeen && Date.now() - new Date(lastSeen).getTime() < STALE_AFTER_SECONDS * 1000
    );
    const byCat = {};
    for (const row of currentRes.rows) byCat[row.category] = displayOf(row, isConnected);
    for (const cat of ['drone', 'rocket']) {
      if (!byCat[cat]) {
        byCat[cat] = displayOf(null, isConnected);
        byCat[cat].category = cat;
      }
    }

    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      staleAfterSeconds: STALE_AFTER_SECONDS,
      connection: {
        lastRobloxSeenAt: lastSeen ? new Date(lastSeen).toISOString() : null,
        lastHeartbeatAt: state.last_heartbeat_at
          ? new Date(state.last_heartbeat_at).toISOString()
          : null,
        isConnected: Boolean(isConnected)
      },
      categories: { drone: byCat.drone, rocket: byCat.rocket },
      history: historyRes.rows.map((r) => ({
        id: r.id,
        category: r.category,
        previousStatus: r.previous_status,
        newStatus: r.new_status,
        updatedAt: new Date(r.updated_at).toISOString(),
        source: r.source,
        eventType: r.event_type
      }))
    });
  } catch (error) {
    console.error('[api/status]', error.message);
    res.status(503).json({ ok: false, error: 'status_temporarily_unavailable' });
  }
});

app.post('/api/roblox/heartbeat', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!pool || !databaseReady) return res.status(503).json({ ok: false, error: 'database_unavailable' });
  try {
    await pool.query(
      `UPDATE system_state SET last_heartbeat_at = NOW(), last_roblox_seen_at = NOW() WHERE id = 1`
    );
    res.json({ ok: true, receivedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[heartbeat]', error.message);
    res.status(500).json({ ok: false, error: 'heartbeat_failed' });
  }
});

app.post('/api/roblox/status', async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!pool || !databaseReady) return res.status(503).json({ ok: false, error: 'database_unavailable' });

  const body = req.body || {};
  const category = typeof body.category === 'string' ? body.category.trim().toLowerCase() : '';
  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
  const source =
    typeof body.source === 'string' ? body.source.trim().slice(0, 80) : 'roblox';

  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ ok: false, error: 'unknown_category', allowed: [...VALID_CATEGORIES] });
  }
  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ ok: false, error: 'unknown_status', allowed: [...VALID_STATUSES] });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const prev = await client.query(
      'SELECT status FROM current_status WHERE category = $1 FOR UPDATE',
      [category]
    );
    const previousStatus = prev.rows[0] ? prev.rows[0].status : null;

    await client.query(
      `INSERT INTO current_status (category, status, updated_at, source)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (category) DO UPDATE
       SET status = EXCLUDED.status, updated_at = NOW(), source = EXCLUDED.source`,
      [category, status, source]
    );
    await client.query(
      `UPDATE system_state SET last_roblox_seen_at = NOW() WHERE id = 1`
    );

    if (previousStatus !== status) {
      await client.query(
        `INSERT INTO status_history (category, previous_status, new_status, updated_at, source, event_type)
         VALUES ($1, $2, $3, NOW(), $4, 'status_change')`,
        [category, previousStatus, status, source]
      );
      await client.query(`
        DELETE FROM status_history
        WHERE id NOT IN (
          SELECT id FROM status_history ORDER BY updated_at DESC, id DESC LIMIT 50
        )
      `);
    }
    await client.query('COMMIT');
    res.json({
      ok: true,
      category,
      status,
      previousStatus,
      changed: previousStatus !== status,
      receivedAt: new Date().toISOString()
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('[status]', error.message);
    res.status(500).json({ ok: false, error: 'status_update_failed' });
  } finally {
    if (client) client.release();
  }
});

app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0,
    index: 'index.html'
  })
);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next(err);
  });
});

app.use((error, _req, res, _next) => {
  console.error('[error]', error.message);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Север Оператив listening on :' + PORT);
  if (!pool) console.warn('DATABASE_URL missing');
  if (!process.env.STATUS_API_KEY) console.warn('STATUS_API_KEY missing');
  initializeDatabase();
  const retry = setInterval(initializeDatabase, 15000);
  if (typeof retry.unref === 'function') retry.unref();
});

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});
