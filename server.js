'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

let databaseReady = false;
let initializing = false;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12kb', strict: true }));
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
      CREATE TABLE IF NOT EXISTS nexus_status (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        status VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red')),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        changed_by VARCHAR(80)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nexus_status_history (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red')),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        changed_by VARCHAR(80),
        note VARCHAR(240)
      )
    `);
    databaseReady = true;
    console.log('Database ready; status tables are available.');
  } catch (error) {
    databaseReady = false;
    console.error('Database initialization failed:', error.message);
  } finally {
    initializing = false;
  }
}

function isAuthorized(req) {
  const expected = process.env.STATUS_API_KEY;
  if (!expected) return false;
  const authorization = req.get('authorization') || '';
  const supplied = req.get('x-api-key') || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.get('/api/health', (_req, res) => {
  res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    service: 'sever-operativ',
    database: databaseReady ? 'connected' : 'unavailable'
  });
});

app.get('/api/status', async (_req, res) => {
  if (!pool || !databaseReady) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
  try {
    const [current, history] = await Promise.all([
      pool.query('SELECT status, changed_at, changed_by FROM nexus_status WHERE id = 1'),
      pool.query('SELECT id, status, changed_at, changed_by, note FROM nexus_status_history ORDER BY changed_at DESC, id DESC LIMIT 50')
    ]);
    res.json({ ok: true, current: current.rows[0] || null, history: history.rows });
  } catch (error) {
    console.error('Could not read status:', error.message);
    res.status(503).json({ ok: false, error: 'status_temporarily_unavailable' });
  }
});

app.post('/api/status', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!pool || !databaseReady) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }

  const status = req.body && req.body.status;
  if (status !== 'green' && status !== 'red') {
    return res.status(400).json({ ok: false, error: 'status_must_be_green_or_red' });
  }

  const changedBy = typeof req.body.changedBy === 'string' ? req.body.changedBy.trim().slice(0, 80) : 'Север Оператив';
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 240) : null;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO nexus_status (id, status, changed_at, changed_by)
       VALUES (1, $1, NOW(), $2)
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status, changed_at = NOW(), changed_by = EXCLUDED.changed_by`,
      [status, changedBy || 'Север Оператив']
    );
    await client.query(
      'INSERT INTO nexus_status_history (status, changed_at, changed_by, note) VALUES ($1, NOW(), $2, $3)',
      [status, changedBy || 'Север Оператив', note || null]
    );
    await client.query(
      'DELETE FROM nexus_status_history WHERE id NOT IN (SELECT id FROM nexus_status_history ORDER BY changed_at DESC, id DESC LIMIT 50)'
    );
    await client.query('COMMIT');
    res.json({ ok: true, status });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
    }
    console.error('Could not update status:', error.message);
    res.status(500).json({ ok: false, error: 'status_update_failed' });
  } finally {
    if (client) client.release();
  }
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '5m' : 0,
  index: 'index.html'
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'not_found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  res.status(500).json({ ok: false, error: 'internal_error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Север Оператив is listening on port ' + PORT);
  if (!pool) {
    console.warn('DATABASE_URL is not configured; status API will remain unavailable.');
    return;
  }
  initializeDatabase();
  const retry = setInterval(initializeDatabase, 15000);
  if (typeof retry.unref === 'function') retry.unref();
});

process.on('SIGTERM', async () => {
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
});