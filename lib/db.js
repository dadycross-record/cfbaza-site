'use strict';
/**
 * Хранилище данных.
 *  - На сервере (есть DATABASE_URL) — PostgreSQL: тексты, разделы, заявки и фото.
 *  - Локально (нет DATABASE_URL) — встроенный в Node SQLite-файл data/cfbaza.sqlite3.
 * SQL пишем в стиле PostgreSQL с параметрами $1, $2…; для SQLite они переводятся в ?1, ?2…
 */
const path = require('path');
const fs = require('fs');

function makePg(url) {
  const { Pool } = require('pg');
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  return {
    kind: 'pg',
    async all(sql, params = []) { return (await pool.query(sql, params)).rows; },
    async get(sql, params = []) { return (await pool.query(sql, params)).rows[0]; },
    async run(sql, params = []) { const r = await pool.query(sql, params); return { changes: r.rowCount, rows: r.rows }; },
    async exec(sql) { await pool.query(sql); },
    schema: `
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL DEFAULT '{}', updated TEXT);
      CREATE INDEX IF NOT EXISTS items_kind ON items(kind, sort);
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY, created TEXT NOT NULL, name TEXT, phone TEXT, interest TEXT,
        comment TEXT, status TEXT NOT NULL DEFAULT 'new', ip TEXT);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL, created TEXT);
    `,
  };
}

function makeSqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  const conv = (sql) => sql.replace(/\$(\d+)/g, '?$1');
  const norm = (row) => {
    if (!row) return row;
    for (const k of Object.keys(row)) if (row[k] instanceof Uint8Array) row[k] = Buffer.from(row[k]);
    return row;
  };
  return {
    kind: 'sqlite',
    async all(sql, params = []) { return db.prepare(conv(sql)).all(...params).map(norm); },
    async get(sql, params = []) { return norm(db.prepare(conv(sql)).get(...params)); },
    async run(sql, params = []) {
      const st = db.prepare(conv(sql));
      if (/returning/i.test(sql)) { const rows = st.all(...params); return { changes: rows.length, rows }; }
      const r = st.run(...params); return { changes: Number(r.changes), rows: [] };
    },
    async exec(sql) { db.exec(sql); },
    schema: `
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL DEFAULT '{}', updated TEXT);
      CREATE INDEX IF NOT EXISTS items_kind ON items(kind, sort);
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, name TEXT, phone TEXT, interest TEXT,
        comment TEXT, status TEXT NOT NULL DEFAULT 'new', ip TEXT);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created TEXT);
    `,
  };
}

function open() {
  const url = process.env.DATABASE_URL;
  if (url) return makePg(url);
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  return makeSqlite(path.join(dir, 'cfbaza.sqlite3'));
}

module.exports = { open };
