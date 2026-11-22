'use strict';

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    })
  : null;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

let dbReady = false;

async function initializeDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nexus_status (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      status VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red')),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      changed_by TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS nexus_status_history (
      id BIGSERIAL PRIMARY KEY,
      status VARCHAR(10) NOT NULL CHECK (status IN ('green', 'red')),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      changed_by TEXT,
      note TEXT
    )
  `);
  dbReady = true;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: dbReady ? 'connected' : 'unavailable' });
});

app.get('/api/status', async (_req, res) => {
  if (!pool || !dbReady) {
    return res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
  try {
    const [current, history] = await Promise.all([
      pool.query('SELECT status, changed_at, changed_by FROM nexus_status WHERE id = 1'),
      pool.query('SELECT id, status, changed_at, changed_by, note FROM nexus_status_history ORDER BY changed_at DESC, id DESC LIMIT 50')
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      current: current.rows[0] || null,
      history: history.rows
    });
  } catch (error) {
    console.error('Status read failed:', error.message);
    res.status(500).json({ ok: false, error: 'status_read_failed' });
  }
});

function authorized(req) {
  const expected = process.env.STATUS_API_KEY;
  if (!expected) return false;
  const bearer = req.get('authorization') || '';
  const supplied = req.get('x-api-key') || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');
  if (!supplied || supplied.length !== expected.length) return false;
  const crypto = require('crypto');
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

app.post('/api/status', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!pool || !dbReady) return res.status(503).json({ ok: false, error: 'database_unavailable' });

  const status = req.body && req.body.status;
  if (status !== 'green' && status !== 'red') {
    return res.status(400).json({ ok: false, error: 'status_must_be_green_or_red' });
  }

  const changedBy = typeof req.body.changedBy === 'string' ? req.body.changedBy.trim().slice(0, 80) : null;
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 240) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO nexus_status (id, status, changed_at, changed_by)
       VALUES (1, $1, NOW(), $2)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, changed_at = NOW(), changed_by = EXCLUDED.changed_by`,
      [status, changedBy]
    );
    await client.query(
      'INSERT INTO nexus_status_history (status, changed_at, changed_by, note) VALUES ($1, NOW(), $2, $3)',
      [status, changedBy, note]
    );
    await client.query(
      'DELETE FROM nexus_status_history WHERE id NOT IN (SELECT id FROM nexus_status_history ORDER BY changed_at DESC, id DESC LIMIT 50)'
    );
    await client.query('COMMIT');
    res.json({ ok: true, status });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Status update failed:', error.message);
    res.status(500).json({ ok: false, error: 'status_update_failed' });
  } finally {
    client.release();
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function start() {
  if (pool) {
    try {
      await initializeDatabase();
      console.log('PostgreSQL connected; status tables ready.');
    } catch (error) {
      console.error('PostgreSQL initialization failed:', error.message);
    }
  } else {
    console.warn('DATABASE_URL is not set. API will report database_unavailable.');
  }
  app.listen(PORT, '0.0.0.0', () => console.log('Nexus RP Alerts listening on ' + PORT));
}

start();
