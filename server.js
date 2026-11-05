'use strict';
/**
 * CF BAZA — сайт клуба функциональной подготовки с админ-панелью.
 * Запуск: node server.js  (порт из PORT, по умолчанию 3000)
 * База: PostgreSQL из DATABASE_URL, без неё — локальный SQLite-файл в data/.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const C = require('./content.json');
const { open } = require('./lib/db');
const H = require('./lib/http');
const V = require('./lib/views');
const { processImage } = require('./lib/images');
const { sendMail } = require('./lib/mail');
const L = require('./lib/legal');
const W = require('./lib/wod');

const db = open();
const STATIC_DIR = path.join(__dirname, 'static');
const DAY_ORDER = Object.fromEntries(C.DAYS.map((d, i) => [d, i]));
let codec;
let FORM_SECRET = 'dev';

const now = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // время Иркутска (UTC+8)
  return d.toISOString().slice(0, 16).replace('T', ' ');
};
const timeNum = (t) => Number(String(t || '').replace(/\D/g, '')) || 0;

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------
async function init() {
  await db.exec(db.schema);
  // новые колонки (для уже созданных таблиц)
  for (const col of ["result TEXT NOT NULL DEFAULT ''", 'scaled INTEGER NOT NULL DEFAULT 0', 'updated TEXT']) {
    try { await db.exec(`ALTER TABLE wod_done ADD COLUMN ${db.kind === 'pg' ? 'IF NOT EXISTS ' : ''}${col}`); } catch { /* колонка уже есть */ }
  }
  for (const col of ['client_id INTEGER', 'ua TEXT', 'meta TEXT']) {
    try { await db.exec(`ALTER TABLE leads ADD COLUMN ${db.kind === 'pg' ? 'IF NOT EXISTS ' : ''}${col}`); } catch { /* колонка уже есть */ }
  }
  for (const [k, v] of Object.entries(C.SETTINGS_DEFAULTS)) {
    await db.run('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING', [k, v]);
  }
  const existing = new Set((await db.all('SELECT key FROM settings')).map((r) => r.key));
  for (const [kind, rows] of Object.entries(C.SEED)) {
    const flag = `_seeded_${kind}`;
    if (existing.has(flag)) continue;
    const cnt = Number((await db.get('SELECT COUNT(*) AS n FROM items WHERE kind=$1', [kind])).n);
    if (cnt === 0) {
      let i = 0;
      for (const row of rows) {
        i += 1;
        await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', [kind, i * 10, JSON.stringify(row), now()]);
      }
    }
    await db.run('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING', [flag, '1']);
  }
  // Разовая загрузка фото тренеров (только если у тренера ещё нет фото — загруженные в админке не трогаем)
  const photoFlag = await db.get("SELECT value FROM settings WHERE key='_coach_photos_v1'");
  if (!photoFlag) {
    const map = [['Федоров', 'evgeny.jpg'], ['Красникова', 'galina.jpg'], ['Харьковенко', 'sasha.jpg']];
    for (const row of await db.all("SELECT * FROM items WHERE kind='coach'")) {
      const item = JSON.parse(row.data || '{}');
      const hit = map.find(([n]) => String(item.name || '').includes(n));
      if (!hit || item.photo) continue;
      try {
        const data = await fs.promises.readFile(path.join(STATIC_DIR, 'img', 'coaches', hit[1]));
        const id = crypto.randomBytes(16).toString('hex') + '.jpg';
        await db.run('INSERT INTO files(id, mime, data, created) VALUES ($1, $2, $3, $4)', [id, 'image/jpeg', data, now()]);
        item.photo = id;
        await db.run('UPDATE items SET data=$1, updated=$2 WHERE id=$3', [JSON.stringify(item), now(), row.id]);
      } catch (err) { console.error('coach photo:', err.message); }
    }
    await setSetting('_coach_photos_v1', '1');
  }
  // Разовое обновление регалий тренеров (подзаголовок и пункты берутся из content.json по фамилии)
  if (!(await db.get("SELECT value FROM settings WHERE key='_coach_text_v3'"))) {
    for (const row of await db.all("SELECT * FROM items WHERE kind='coach'")) {
      const item = JSON.parse(row.data || '{}');
      const src = C.SEED.coach.find((x) => ['Федоров', 'Харьковенко'].some((n) => x.name.includes(n) && String(item.name || '').includes(n)));
      if (!src) continue;
      item.subtitle = src.subtitle; item.bullets = src.bullets;
      await db.run('UPDATE items SET data=$1, updated=$2 WHERE id=$3', [JSON.stringify(item), now(), row.id]);
    }
    await setSetting('_coach_text_v3', '1');
  }
  // Разовое добавление 7-го фото турниров (командное фото с медалями)
  if (!(await db.get("SELECT value FROM settings WHERE key='_evphoto7_v1'"))) {
    const all = await db.all("SELECT * FROM items WHERE kind='evphoto' ORDER BY sort, id");
    if (all.length && !all.some((r) => String(r.data).includes('events/7-thumb'))) {
      const sort = all.length >= 3 ? Number(all[2].sort) + 5 : 1000;
      await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', ['evphoto', sort, JSON.stringify(C.SEED.evphoto[3]), now()]);
    }
    await setSetting('_evphoto7_v1', '1');
  }
  // Разовая правка текста «Турниров»: «программируют комплексы», без названий турниров
  if (!(await db.get("SELECT value FROM settings WHERE key='_events_text_v2'"))) {
    const t = await db.get("SELECT value FROM settings WHERE key='events_text'");
    if (t && t.value) await setSetting('events_text', t.value.replace('пишут программу', 'программируют комплексы'));
    await setSetting('events_tags', '');
    await setSetting('_events_text_v2', '1');
  }
  // Разовая замена фото турниров: убрать командное фото с медалями, добавить площадку и забег
  if (!(await db.get("SELECT value FROM settings WHERE key='_evphoto89_v1'"))) {
    const all = await db.all("SELECT * FROM items WHERE kind='evphoto' ORDER BY sort, id");
    for (const r of all) if (String(r.data).includes('events/7-thumb')) await db.run('DELETE FROM items WHERE id=$1', [r.id]);
    if (all.length && !all.some((r) => String(r.data).includes('events/8-thumb'))) {
      const first = Number(all[0].sort), last = Number(all[all.length - 1].sort);
      await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', ['evphoto', first + 5, JSON.stringify(C.SEED.evphoto[1]), now()]);
      await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', ['evphoto', last + 10, JSON.stringify(C.SEED.evphoto[C.SEED.evphoto.length - 1]), now()]);
    }
    await setSetting('_evphoto89_v1', '1');
  }
  // Разовая правка «Турниров»: опыт с 2018 года
  if (!(await db.get("SELECT value FROM settings WHERE key='_events_2018_v1'"))) {
    const t = await db.get("SELECT value FROM settings WHERE key='events_text'");
    if (!t || String(t.value).startsWith('CF BAZA — партнёр крупнейших')) await setSetting('events_text', C.SETTINGS_DEFAULTS.events_text);
    const ey = await db.get("SELECT value FROM settings WHERE key='events_eyebrow'");
    if (!ey || ey.value === 'Турниры и соревнования') await setSetting('events_eyebrow', C.SETTINGS_DEFAULTS.events_eyebrow);
    await setSetting('_events_2018_v1', '1');
  }
  // Разовое добавление фото зала в раздел про оборудование
  if (!(await db.get("SELECT value FROM settings WHERE key='_gym_photos_v1'"))) {
    const n = Number((await db.get("SELECT COUNT(*) AS n FROM items WHERE kind='photo'")).n);
    if (n === 0) {
      let i = 0;
      for (const row of C.SEED.photo) { i += 1; await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', ['photo', i * 10, JSON.stringify(row), now()]); }
    }
    await setSetting('_gym_photos_v1', '1');
  }
  // Разовое добавление: тренер Валентина Федорова и детский абонемент
  if (!(await db.get("SELECT value FROM settings WHERE key='_valentina_kids_v1'"))) {
    for (const [kind, name] of [['coach', 'Валентина Федорова'], ['plan', 'Детский']]) {
      const rows = await db.all('SELECT * FROM items WHERE kind=$1 ORDER BY sort, id', [kind]);
      if (rows.some((r) => JSON.parse(r.data || '{}').name === name)) continue;
      const row = C.SEED[kind].find((x) => x.name === name);
      const sort = rows.length ? Number(rows[rows.length - 1].sort) + 10 : 10;
      await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', [kind, sort, JSON.stringify(row), now()]);
    }
    await setSetting('_valentina_kids_v1', '1');
  }
  // Разовая правка детского абонемента: «под руководством тренера»
  if (!(await db.get("SELECT value FROM settings WHERE key='_kids_text_v2'"))) {
    for (const r of await db.all("SELECT * FROM items WHERE kind='plan'")) {
      const it = JSON.parse(r.data || '{}');
      if (it.name === 'Детский' && String(it.features || '').includes('в детской группе с тренером')) {
        it.features = it.features.replace('в детской группе с тренером', 'в детской группе под руководством тренера');
        await db.run('UPDATE items SET data=$1, updated=$2 WHERE id=$3', [JSON.stringify(it), now(), r.id]);
      }
    }
    await setSetting('_kids_text_v2', '1');
  }
  // Разовая правка формулировок по всему сайту: «под руководством тренера»
  if (!(await db.get("SELECT value FROM settings WHERE key='_rukovodstvo_v1'"))) {
    const R = [["групповые тренировки с тренерами-атлетами", "групповые тренировки под руководством тренеров-атлетов"], ["Групповые тренировки с тренером", "Групповые тренировки под руководством тренера"], ["первая тренировка с тренером", "первая тренировка под руководством тренера"], ["работаете под наблюдением тренера", "работаете под руководством тренера"]];
    const fix = (t) => R.reduce((acc, [a, b]) => acc.split(a).join(b), String(t));
    for (const r of await db.all('SELECT key, value FROM settings')) {
      const v = fix(r.value); if (v !== r.value) await setSetting(r.key, v);
    }
    for (const r of await db.all('SELECT id, data FROM items')) {
      const v = fix(r.data); if (v !== r.data) await db.run('UPDATE items SET data=$1, updated=$2 WHERE id=$3', [v, now(), r.id]);
    }
    await setSetting('_rukovodstvo_v1', '1');
  }
  // Разовое подключение счётчика Яндекс.Метрики (если номер ещё не указан в админке)
  if (!(await db.get("SELECT value FROM settings WHERE key='_metrika_v1'"))) {
    const cur = await db.get("SELECT value FROM settings WHERE key='metrika_id'");
    if (!cur || !String(cur.value || '').trim()) await setSetting('metrika_id', '113979373');
    await setSetting('_metrika_v1', '1');
  }
  // Разовая загрузка архива тренировок из группы BAZATEAM в «Программу тренировок»
  if (!(await db.get("SELECT value FROM settings WHERE key='_wods_seed_v1'"))) {
    const n = Number((await db.get('SELECT COUNT(*) AS n FROM wods')).n);
    if (n === 0) {
      try {
        const rows = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'seed', 'wods.json'), 'utf8'));
        for (const [track, wdate, author, body] of rows) {
          await db.run('INSERT INTO wods(track, wdate, body, image, author, active, created) VALUES ($1, $2, $3, $4, $5, 1, $6)', [track, wdate, body, '', author, now()]);
        }
        console.log(`Программа тренировок: загружено ${rows.length} тренировок из архива.`);
      } catch (err) { console.error('wods seed:', err.message); }
    }
    await setSetting('_wods_seed_v1', '1');
  }
  // Пароль админки берётся из ADMIN_PASSWORD. Если переменную поменяли — пароль в базе обновится при запуске.
  // Пароль, сменённый в самой админке, сохраняется, пока ADMIN_PASSWORD не изменится.
  const envPwd = process.env.ADMIN_PASSWORD;
  if (envPwd) {
    const fp = crypto.createHash('sha256').update('cfbaza:' + envPwd).digest('hex');
    const stored = await db.get("SELECT value FROM settings WHERE key='_admin_env_fp'");
    if (!stored || stored.value !== fp || !existing.has('_admin_hash')) {
      await setSetting('_admin_hash', H.hashPassword(envPwd));
      await setSetting('_admin_env_fp', fp);
      console.log('Пароль администратора установлен из ADMIN_PASSWORD.');
    }
  } else if (!existing.has('_admin_hash')) {
    console.log('ВНИМАНИЕ: не задан ADMIN_PASSWORD — вход в админку недоступен, пока переменная не появится.');
  }
  let secret = process.env.SECRET_KEY;
  if (!secret) {
    await db.run('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING', ['_secret', crypto.randomBytes(32).toString('hex')]);
    secret = (await db.get("SELECT value FROM settings WHERE key='_secret'")).value;
  }
  codec = H.sessionCodec(secret);
  FORM_SECRET = secret;
}

async function getSettings() {
  const s = { ...C.SETTINGS_DEFAULTS };
  for (const r of await db.all('SELECT key, value FROM settings')) s[r.key] = r.value;
  if (!/^#[0-9a-fA-F]{6}$/.test(s.accent || '')) s.accent = '#FECC00';
  return s;
}
const setSetting = (k, v) => db.run('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, v]);

function rowToItem(r) {
  let d = {};
  try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
  return { ...d, id: Number(r.id), sort: Number(r.sort), active: Number(r.active) };
}
async function getItems(kind, activeOnly = true) {
  const rows = await db.all(`SELECT * FROM items WHERE kind=$1${activeOnly ? ' AND active=1' : ''} ORDER BY sort, id`, [kind]);
  return rows.map(rowToItem);
}
async function getItem(id, kind) {
  const r = await db.get('SELECT * FROM items WHERE id=$1 AND kind=$2', [id, kind]);
  return r ? rowToItem(r) : null;
}

async function saveUpload(file, maxSide) {
  if (!file || !file.data || !file.data.length) return null;
  const img = await processImage(file.data, maxSide);
  const id = crypto.randomBytes(16).toString('hex') + (img.mime === 'image/png' ? '.png' : '.jpg');
  await db.run('INSERT INTO files(id, mime, data, created) VALUES ($1, $2, $3, $4)', [id, img.mime, img.data, now()]);
  return id;
}
async function deleteUpload(id) {
  if (id && /^[0-9a-f]{32}\.(jpg|png)$/.test(id)) await db.run('DELETE FROM files WHERE id=$1', [id]);
}

function buildSchedule(slots) {
  return C.DAYS.map((name) => ({
    name,
    slots: slots.filter((x) => x.day === name).sort((a, b) => timeNum(a.time) - timeNum(b.time)).map((x) => ({
      ...x, time_short: /^0\d:\d\d$/.test(x.time || '') ? x.time.slice(1) : (x.time || ''),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Уведомления
// ---------------------------------------------------------------------------
function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch((err) => console.error('Telegram error:', err.message));
}

function notifyEmail(subject, text, toAddr) {
  const host = process.env.SMTP_HOST || 'smtp.yandex.ru';
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, ''); // пароль приложения часто копируют с пробелами
  const to = String(toAddr || '').split(/[,;\s]+/).filter((a) => a.includes('@'));
  if (!user || !pass || !to.length) return;
  sendMail({ host, port: process.env.SMTP_PORT || 465, user, pass, to, subject, text })
    .then(() => console.log(`Письмо о заявке отправлено: ${user} → ${to.join(', ')}`))
    .catch((err) => console.error(`Email error (${user}, пароль ${pass.length} симв.):`, err.message));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const rate = new Map();
function rateLimited(key, limit, windowMs) {
  const t = Date.now();
  const hits = (rate.get(key) || []).filter((x) => t - x < windowMs);
  hits.push(t);
  rate.set(key, hits);
  if (rate.size > 5000) rate.clear();
  return hits.length > limit;
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || '');
}
// Политика безопасности контента: страница может грузить код и данные только с нашего сайта и Яндекс.Метрики.
// frame-ancestors разрешает показывать сайт внутри Метрики (Вебвизор), но не на чужих сайтах.
const YM = 'https://mc.yandex.ru https://mc.yandex.com';
const CSP_SITE = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${YM} https://yastatic.net`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${YM}`,
  "font-src 'self' data:",
  `connect-src 'self' ${YM} wss://mc.yandex.ru wss://mc.yandex.com https://mc.webvisor.org https://mc.webvisor.com`,
  // yandex.ru — карта в «Контактах» (map-widget) и служебный фрейм Метрики
  `frame-src blob: ${YM} https://mc.webvisor.org https://mc.webvisor.com https://yandex.ru https://*.yandex.ru https://yandex.com https://*.yandex.com https://*.yandex.net`,
  `child-src blob: ${YM} https://yandex.ru https://*.yandex.ru`,
  "frame-ancestors 'self' https://metrika.yandex.ru https://metrica.yandex.com https://webvisor.com https://*.webvisor.com",
  "form-action 'self'", "base-uri 'self'", "object-src 'none'",
].join('; ');
// В админке — распознавание скриншотов (tesseract.js с jsdelivr), встроить админку никуда нельзя
const CSP_ADMIN = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
  "frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'", "object-src 'none'",
].join('; ');

const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
// Основной адрес сайта: для canonical, sitemap и документов. Остальные адреса (временный pipecore, www) поисковикам не показываем.
const SITE_URL = (process.env.SITE_URL || 'https://www.cf-baza.ru/').replace(/\/?$/, '/');
const SITE_HOST = new URL(SITE_URL).host;
const reqHost = (req) => String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
const rootUrl = (req) => `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || 'cf-baza.ru'}/`;

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };

class Ctx {
  constructor(req, res) {
    this.req = req;
    this.res = res;
    this.url = new URL(req.url, 'http://local');
    this.path = this.url.pathname.replace(/\/+$/, '') || '/';
    this.cookies = H.parseCookies(req);
    this.session = codec.decode(this.cookies.cfb);
    this.sessionDirty = false;
    if (!this.session.csrf) { this.session.csrf = crypto.randomBytes(16).toString('hex'); this.sessionDirty = true; }
  }
  flash(cat, msg) { (this.session.flash = this.session.flash || []).push([cat, msg]); this.sessionDirty = true; }
  takeFlash() { const f = this.session.flash || []; if (f.length) { delete this.session.flash; this.sessionDirty = true; } return f; }
  headers(extra = {}) {
    const h = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', ...extra };
    const https = isHttps(this.req);
    if (https) h['Strict-Transport-Security'] = 'max-age=31536000';
    const isAdmin = this.path.startsWith('/admin');
    if (/text\/html/.test(h['Content-Type'] || '')) h['Content-Security-Policy'] = (isAdmin ? CSP_ADMIN : CSP_SITE) + (https ? '; upgrade-insecure-requests' : '');
    if (isAdmin) { h['X-Frame-Options'] = 'DENY'; h['Cache-Control'] = 'no-store'; }
    const cookies = [...(this.extraCookies || [])];
    if (this.sessionDirty) {
      const ttl = this.session.admin ? Math.max(60000, (this.session.adminSince || 0) + 7 * 24 * 3600 * 1000 - Date.now()) : 14 * 24 * 3600 * 1000;
      this.session._exp = Date.now() + ttl;
      cookies.push(`cfb=${encodeURIComponent(codec.encode(this.session))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(ttl / 1000)}${isHttps(this.req) ? '; Secure' : ''}`);
    }
    if (cookies.length) h['Set-Cookie'] = cookies;
    return h;
  }
  html(body, status = 200) { this.res.writeHead(status, this.headers({ 'Content-Type': 'text/html; charset=utf-8' })); this.res.end(body); }
  json(obj, status = 200) { this.res.writeHead(status, this.headers({ 'Content-Type': 'application/json; charset=utf-8' })); this.res.end(JSON.stringify(obj)); }
  redirect(loc) { this.res.writeHead(302, this.headers({ Location: loc })); this.res.end(); }
  text(body, status = 200, type = 'text/plain; charset=utf-8', extra = {}) { this.res.writeHead(status, this.headers({ 'Content-Type': type, ...extra })); this.res.end(body); }
}

const notFound = (ctx) => ctx.html('<!doctype html><meta charset="utf-8"><title>Не найдено</title><p style="font-family:sans-serif;padding:40px">Страница не найдена. <a href="/">На главную</a></p>', 404);

async function serveStatic(ctx) {
  const rel = decodeURIComponent(ctx.path.slice('/static/'.length));
  const file = path.normalize(path.join(STATIC_DIR, rel));
  if (!file.startsWith(STATIC_DIR + path.sep)) return notFound(ctx);
  try {
    const data = await fs.promises.readFile(file);
    ctx.res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
    ctx.res.end(data);
  } catch { notFound(ctx); }
}

// Шрифты из пакетов @fontsource: /vendor/fonts/<пакет>/<файл>
const FONT_PKGS = new Set(['oswald', 'open-sans', 'jetbrains-mono', 'caveat']);
async function serveFont(ctx) {
  const m = /^\/vendor\/fonts\/([a-z-]+)\/((?:files\/)?[a-z0-9-]+\.(css|woff2|woff))$/.exec(ctx.path);
  if (!m || !FONT_PKGS.has(m[1])) return notFound(ctx);
  const file = path.join(__dirname, 'node_modules', '@fontsource', m[1], m[2]);
  try {
    const data = await fs.promises.readFile(file);
    const type = m[3] === 'css' ? 'text/css; charset=utf-8' : (m[3] === 'woff2' ? 'font/woff2' : 'font/woff');
    ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' });
    ctx.res.end(data);
  } catch { notFound(ctx); }
}

async function serveUpload(ctx) {
  const id = ctx.path.slice('/uploads/'.length);
  if (!/^[0-9a-f]{32}\.(jpg|png)$/.test(id)) return notFound(ctx);
  const r = await db.get('SELECT mime, data FROM files WHERE id=$1', [id]);
  if (!r) return notFound(ctx);
  ctx.res.writeHead(200, { 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  ctx.res.end(Buffer.from(r.data));
}

// ---------------------------------------------------------------------------
// Публичные страницы
// ---------------------------------------------------------------------------
async function pageIndex(ctx) {
  const s = await getSettings();
  const slots = await getItems('slot');
  const data = {
    s, root: SITE_URL,
    facts: await getItems('fact'), steps: await getItems('step'), whys: await getItems('why'),
    photos: await getItems('photo'), schedule: buildSchedule(slots), usedTypes: new Set(slots.map((x) => x.type)),
    coaches: await getItems('coach'), evpillars: await getItems('evpillar'), evphotos: await getItems('evphoto'), plans: await getItems('plan'), extras: await getItems('extra'),
    reviews: await getItems('review'), faqs: await getItems('faq'),
    sent: ctx.url.searchParams.get('sent') === '1', flash: ctx.takeFlash(), formToken: formToken(),
  };
  ctx.html(V.site(data));
}

// ---------------------------------------------------------------------------
// Защита формы заявки от ботов (без капчи):
//  1) подписанная метка времени в форме — бот, который шлёт запросы мимо страницы, её не имеет;
//  2) слишком быстрое заполнение (меньше 3 секунд) — человек так не успевает;
//  3) скрипт на странице отмечает, что форму заполняли руками (нажатия/касания), и что работает JavaScript;
//  4) скрытое поле-ловушка, подозрительный браузер, ссылки в имени.
// Подозрительные заявки не теряются: они сохраняются со статусом «спам», без уведомлений — их видно в админке.
// ---------------------------------------------------------------------------
const formSig = (ts) => crypto.createHmac('sha256', FORM_SECRET).update('lead:' + ts).digest('hex').slice(0, 20);
function formToken() { const ts = Date.now().toString(36); return `${ts}.${formSig(ts)}`; }
const BOT_UA = /bot|crawl|spider|curl|wget|python|httpclient|okhttp|java\/|go-http|axios|node-fetch|headless|phantom|selenium|puppeteer|playwright|scrapy|libwww/i;

function leadSignals(fields, ua) {
  const hard = []; const soft = [];
  const [ts, sig] = String(fields.ft || '').split('.');
  let age = null;
  if (!ts || !sig || formSig(ts) !== sig) hard.push('отправлено мимо страницы сайта (нет метки формы)');
  else {
    age = (Date.now() - parseInt(ts, 36)) / 1000;
    if (age < 3) hard.push(`форма заполнена за ${age.toFixed(1)} с`);
  }
  if (!ua) hard.push('браузер не указан');
  else if (BOT_UA.test(ua)) hard.push('программа, а не браузер');
  if (/https?:|www\.|\.(ru|com|net|org|xyz|top|online)\b|@|<|\[url/i.test(String(fields.name || ''))) hard.push('ссылка или адрес в имени');
  if (fields.js !== (String(fields.ft || '').split('.')[1] || '').slice(0, 6).split('').reverse().join('')) soft.push('без JavaScript');
  if (!(Number(fields.hx) > 0)) soft.push('без нажатий на клавиатуру или экран');
  const spam = hard.length > 0 || soft.length >= 2;
  return { spam, reasons: [...hard, ...soft], age: age === null ? null : Math.round(age), hx: Number(fields.hx) || 0 };
}

const validRuPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return (d.length === 11 && /^[78]9/.test(d)) || (d.length === 10 && /^9/.test(d)) || (d.length === 11 && /^[78][3-8]/.test(d)); };

async function postLead(ctx) {
  const wantsJson = /application\/json/.test(ctx.req.headers.accept || '');
  const { fields } = await H.parseForm(ctx.req);
  const fail = (msg) => {
    if (wantsJson) return ctx.json({ ok: false, error: msg }, 400);
    ctx.flash('error', msg);
    return ctx.redirect('/#contacts');
  };
  const okResp = () => (wantsJson ? ctx.json({ ok: true }) : ctx.redirect('/?sent=1#contacts'));
  if (fields.website) return okResp(); // ловушка: поле видят только боты
  const name = String(fields.name || '').trim().slice(0, 80);
  const phone = String(fields.phone || '').trim().slice(0, 40);
  const interest = String(fields.interest || '').trim().slice(0, 120);
  if (!validRuPhone(phone)) return fail('Проверьте номер телефона: нужен российский номер, например +7 914 123-45-67.');
  if (!fields.consent) return fail('Нужно согласие на обработку персональных данных.');
  if (rateLimited('lead:' + clientIp(ctx.req), 5, 600000)) return fail('Слишком много заявок подряд. Позвоните нам, пожалуйста.');
  const ua = String(ctx.req.headers['user-agent'] || '').slice(0, 300);
  const sigs = leadSignals(fields, ua);
  const created = now();
  // тот же номер за последние 30 минут — повтор, второй раз не уведомляем
  const key = phoneKey(phone);
  const recent = await db.all("SELECT phone FROM leads WHERE created >= $1 AND status <> 'spam'", [new Date(Date.now() + 8 * 3600 * 1000 - 30 * 60000).toISOString().slice(0, 16).replace('T', ' ')]);
  const dup = recent.some((r) => phoneKey(r.phone) === key);
  const status = sigs.spam ? 'spam' : 'new';
  const ins = await db.run('INSERT INTO leads(created, name, phone, interest, ip, status, ua, meta) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [created, name, phone, interest, clientIp(ctx.req), status, ua, JSON.stringify({ reasons: sigs.reasons, age: sigs.age, hx: sigs.hx, dup })]);
  if (sigs.spam) { console.log('Заявка помечена как спам:', sigs.reasons.join('; ')); return okResp(); }
  try { await crmFromLead({ id: ins.rows[0] && ins.rows[0].id, created, name, phone, interest, status: 'new' }); } catch (err) { console.error('crm:', err.message); }
  if (!dup) {
    const s = await getSettings();
    const warn = sigs.reasons.length ? `\nПроверьте: ${sigs.reasons.join(', ')}` : '';
    const body = `Новая заявка с сайта CF BAZA\n\nИмя: ${name || '—'}\nТелефон: ${phone}\nИнтерес: ${interest || '—'}\nВремя: ${created}${warn}\n\nВсе заявки: ${rootUrl(ctx.req)}admin/leads`;
    notifyTelegram(body);
    notifyEmail(`Заявка с сайта: ${name || phone}`, body, s.notify_email);
  }
  return okResp();
}

// ---------------------------------------------------------------------------
// Программа тренировок
// ---------------------------------------------------------------------------
const TRACKS = C.TRACKS.map(([slug, name, about]) => ({ slug, name, about }));
const TRACK_SLUGS = new Set(TRACKS.map((t) => t.slug));
const today = () => now().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function trackOf(name) {
  const v = String(name || '').trim().toLowerCase();
  if (!v) return null;
  const t = TRACKS.find((x) => x.slug === v || x.name.toLowerCase() === v || x.name.toLowerCase().startsWith(v) || v.startsWith(x.name.toLowerCase().slice(0, 4)));
  if (t) return t.slug;
  if (/дет|kid|подрост/.test(v)) return 'kids';
  if (/атлет|band|сборн/.test(v)) return 'athletes';
  if (/гонк|hyrox|race/.test(v)) return 'race';
  if (/record|команд|team/.test(v)) return 'teams';
  if (/груп|class|общ/.test(v)) return 'group';
  return null;
}

function deviceId(ctx) {
  let id = ctx.cookies.cfd;
  if (!/^[0-9a-f]{32}$/.test(id || '')) {
    id = crypto.randomBytes(16).toString('hex');
    (ctx.extraCookies = ctx.extraCookies || []).push(`cfd=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${2 * 365 * 24 * 3600}${isHttps(ctx.req) ? '; Secure' : ''}`);
    ctx.cookies.cfd = id;
  }
  return id;
}

// Кто отмечает: атлет с профилем ('a<id>') или браузер без профиля (случайный id в cookie)
async function currentAthlete(ctx) {
  const id = Number(ctx.session.ath || 0);
  if (!id) return null;
  const a = await db.get('SELECT id, name FROM athletes WHERE id=$1', [id]);
  if (!a) { delete ctx.session.ath; ctx.sessionDirty = true; }
  return a || null;
}
const whoOf = (ctx, ath) => (ath ? 'a' + ath.id : deviceId(ctx));

async function athleteNames(keys) {
  const ids = [...new Set(keys.filter((k) => /^a\d+$/.test(k)).map((k) => Number(k.slice(1))))];
  const map = {};
  if (!ids.length) return map;
  const ph = ids.map((_, i) => `$${i + 1}`).join(',');
  for (const r of await db.all(`SELECT id, name FROM athletes WHERE public=1 AND id IN (${ph})`, ids)) map['a' + r.id] = r.name;
  return map;
}

async function pageProgram(ctx) {
  const s = await getSettings();
  const track = TRACK_SLUGS.has(ctx.url.searchParams.get('t')) ? ctx.url.searchParams.get('t') : TRACKS[0].slug;
  const ahead = Math.max(0, Math.min(14, Number(s.program_days_ahead) || 0));
  const maxDate = addDays(today(), ahead);
  const before = /^\d{4}-\d{2}-\d{2}$/.test(ctx.url.searchParams.get('before') || '') ? ctx.url.searchParams.get('before') : null;
  const lim = before && before <= maxDate ? before : null;
  const days = await db.all(`SELECT DISTINCT wdate FROM wods WHERE active=1 AND track=$1 AND wdate <= $2${lim ? ' AND wdate < $3' : ''} ORDER BY wdate DESC LIMIT 14`, lim ? [track, maxDate, lim] : [track, maxDate]);
  let wods = [];
  if (days.length) {
    wods = await db.all('SELECT * FROM wods WHERE active=1 AND track=$1 AND wdate >= $2 AND wdate <= $3 ORDER BY wdate DESC, id ASC', [track, days[days.length - 1].wdate, days[0].wdate]);
  }
  const ath = await currentAthlete(ctx);
  const who = whoOf(ctx, ath);
  const ids = wods.map((w) => w.id);
  const counts = {}; const mine = {}; const results = {};
  if (ids.length) {
    const ph = ids.map((_, i) => `$${i + 1}`).join(',');
    for (const r of await db.all(`SELECT wod_id, COUNT(*) AS n FROM wod_done WHERE wod_id IN (${ph}) GROUP BY wod_id`, ids)) counts[r.wod_id] = Number(r.n);
    for (const r of await db.all(`SELECT wod_id, result, scaled FROM wod_done WHERE device=$${ids.length + 1} AND wod_id IN (${ph})`, [...ids, who])) mine[r.wod_id] = { result: r.result || '', scaled: Number(r.scaled) || 0 };
    const res = await db.all(`SELECT wod_id, device, result, scaled FROM wod_done WHERE wod_id IN (${ph}) AND device LIKE 'a%' AND result <> '' ORDER BY updated DESC`, ids);
    const names = await athleteNames(res.map((r) => r.device));
    for (const r of res) if (names[r.device]) (results[r.wod_id] = results[r.wod_id] || []).push({ name: names[r.device], result: r.result, scaled: Number(r.scaled) || 0, me: r.device === who });
  }
  const totals = {};
  for (const r of await db.all('SELECT track, COUNT(*) AS n FROM wods WHERE active=1 AND wdate <= $1 GROUP BY track', [maxDate])) totals[r.track] = Number(r.n);
  const myTotal = Number((await db.get('SELECT COUNT(*) AS n FROM wod_done WHERE device=$1', [who])).n);
  const more = days.length === 14 ? days[days.length - 1].wdate : null;
  ctx.html(V.programPage({
    s, root: SITE_URL, tracks: TRACKS, track, totals, myTotal, more, today: today(), athlete: ath, csrf: ctx.session.csrf,
    wods: wods.map((w) => ({ ...w, blocks: W.toBlocks(w.body), done: counts[w.id] || 0, mine: mine[w.id] || null, results: results[w.id] || [] })),
  }));
}

async function readJson(ctx) {
  try { return JSON.parse((await H.readBody(ctx.req)).toString('utf8') || '{}'); } catch { return null; }
}

async function postWodDone(ctx) {
  if (rateLimited('done:' + clientIp(ctx.req), 300, 3600000)) return ctx.json({ ok: false, error: 'Слишком много отметок, попробуйте позже.' }, 429);
  const body = await readJson(ctx);
  if (!body || body.csrf !== ctx.session.csrf) return ctx.json({ ok: false, error: 'Обновите страницу и попробуйте ещё раз.' }, 400);
  const id = Number(body.id);
  const w = await db.get('SELECT id FROM wods WHERE id=$1 AND active=1', [id]);
  if (!w) return ctx.json({ ok: false }, 404);
  const ath = await currentAthlete(ctx);
  const who = whoOf(ctx, ath);
  const result = String(body.result || '').trim().slice(0, 80);
  const scaled = body.scaled ? 1 : 0;
  if (body.on) {
    await db.run('INSERT INTO wod_done(wod_id, device, created, result, scaled, updated) VALUES ($1, $2, $3, $4, $5, $3) ON CONFLICT (wod_id, device) DO UPDATE SET result=$4, scaled=$5, updated=$3', [id, who, now(), result, scaled]);
  } else {
    await db.run('DELETE FROM wod_done WHERE wod_id=$1 AND device=$2', [id, who]);
  }
  const n = Number((await db.get('SELECT COUNT(*) AS n FROM wod_done WHERE wod_id=$1', [id])).n);
  const total = Number((await db.get('SELECT COUNT(*) AS n FROM wod_done WHERE device=$1', [who])).n);
  return ctx.json({ ok: true, count: n, on: !!body.on, total, result, scaled, name: ath ? ath.name : '' });
}

// Профиль атлета: имя + PIN-код из 4 цифр. Отметки из браузера переносятся в профиль.
const nameKey = (n) => String(n || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
async function mergeDeviceInto(ctx, aid) {
  const dev = deviceId(ctx);
  const key = 'a' + aid;
  const rows = await db.all('SELECT wod_id, result, scaled, created FROM wod_done WHERE device=$1', [dev]);
  for (const r of rows) {
    await db.run('INSERT INTO wod_done(wod_id, device, created, result, scaled, updated) VALUES ($1, $2, $3, $4, $5, $3) ON CONFLICT (wod_id, device) DO NOTHING', [r.wod_id, key, r.created || now(), r.result || '', Number(r.scaled) || 0]);
  }
  await db.run('DELETE FROM wod_done WHERE device=$1', [dev]);
}

async function postAthlete(ctx, action) {
  const body = await readJson(ctx);
  if (!body || body.csrf !== ctx.session.csrf) return ctx.json({ ok: false, error: 'Обновите страницу и попробуйте ещё раз.' }, 400);
  if (action === 'logout') { delete ctx.session.ath; ctx.sessionDirty = true; return ctx.json({ ok: true }); }
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const pin = String(body.pin || '').trim();
  if (name.length < 2) return ctx.json({ ok: false, error: 'Укажите имя и фамилию — так вас узнают в рейтинге.' }, 400);
  if (!/^\d{4}$/.test(pin)) return ctx.json({ ok: false, error: 'PIN — ровно 4 цифры.' }, 400);
  if (rateLimited('ath:' + clientIp(ctx.req), 20, 900000)) return ctx.json({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' }, 429);
  const key = nameKey(name);
  const ex = await db.get('SELECT * FROM athletes WHERE name_key=$1', [key]);
  let aid;
  if (action === 'register') {
    if (!body.consent) return ctx.json({ ok: false, error: 'Нужно согласие на обработку персональных данных.' }, 400);
    if (ex) return ctx.json({ ok: false, error: 'Такое имя уже занято. Войдите или добавьте фамилию/инициал.' }, 409);
    const r = await db.run('INSERT INTO athletes(name, name_key, pin, public, created) VALUES ($1, $2, $3, $4, $5) RETURNING id', [name, key, H.hashPassword(pin), body.public ? 1 : 0, now()]);
    aid = Number(r.rows[0].id);
  } else {
    if (!ex || !H.checkPassword(pin, ex.pin)) return ctx.json({ ok: false, error: 'Неверное имя или PIN.' }, 401);
    aid = Number(ex.id);
  }
  await mergeDeviceInto(ctx, aid);
  ctx.session.ath = aid; ctx.sessionDirty = true;
  return ctx.json({ ok: true });
}

// Личная страница атлета: история, серия недель, настройки профиля
const weekKey = (iso) => { const d = new Date(iso + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - wd * 86400000).toISOString().slice(0, 10); };
async function pageMe(ctx) {
  const s = await getSettings();
  const ath = await currentAthlete(ctx);
  const who = whoOf(ctx, ath);
  const rows = await db.all('SELECT d.wod_id, d.result, d.scaled, d.created, w.wdate, w.track, w.body FROM wod_done d JOIN wods w ON w.id=d.wod_id WHERE d.device=$1 ORDER BY w.wdate DESC, d.created DESC LIMIT 400', [who]);
  const tname = Object.fromEntries(TRACKS.map((t) => [t.slug, t.name]));
  const month = today().slice(0, 7);
  const weeks = new Set(rows.map((r) => weekKey(String(r.created || r.wdate).slice(0, 10))));
  let streak = 0;
  for (let wk = weekKey(today()); weeks.has(wk); wk = addDays(wk, -7)) streak += 1;
  if (!streak && weeks.has(addDays(weekKey(today()), -7))) { for (let wk = addDays(weekKey(today()), -7); weeks.has(wk); wk = addDays(wk, -7)) streak += 1; }
  const full = ath ? await db.get('SELECT id, name, public FROM athletes WHERE id=$1', [ath.id]) : null;
  ctx.html(V.mePage({
    s, athlete: full, csrf: ctx.session.csrf,
    stats: { total: rows.length, month: rows.filter((r) => String(r.created || '').startsWith(month)).length, results: rows.filter((r) => r.result).length, streak },
    rows: rows.map((r) => ({ ...r, track: tname[r.track] || r.track, summary: W.summary(r.body) })),
  }));
}

async function postProfile(ctx) {
  const body = await readJson(ctx);
  if (!body || body.csrf !== ctx.session.csrf) return ctx.json({ ok: false, error: 'Обновите страницу и попробуйте ещё раз.' }, 400);
  const ath = await currentAthlete(ctx);
  if (!ath) return ctx.json({ ok: false, error: 'Сначала войдите в профиль.' }, 401);
  if (typeof body.public === 'boolean') await db.run('UPDATE athletes SET public=$1 WHERE id=$2', [body.public ? 1 : 0, ath.id]);
  if (body.pin !== undefined && body.pin !== '') {
    const row = await db.get('SELECT pin FROM athletes WHERE id=$1', [ath.id]);
    if (!H.checkPassword(String(body.old_pin || ''), row.pin)) return ctx.json({ ok: false, error: 'Текущий PIN указан неверно.' }, 400);
    if (!/^\d{4}$/.test(String(body.pin))) return ctx.json({ ok: false, error: 'Новый PIN — ровно 4 цифры.' }, 400);
    await db.run('UPDATE athletes SET pin=$1 WHERE id=$2', [H.hashPassword(String(body.pin)), ath.id]);
  }
  if (body.delete === true) {
    await db.run('DELETE FROM wod_done WHERE device=$1', ['a' + ath.id]);
    await db.run('DELETE FROM athletes WHERE id=$1', [ath.id]);
    delete ctx.session.ath; ctx.sessionDirty = true;
  }
  return ctx.json({ ok: true });
}

async function pageRating(ctx) {
  const s = await getSettings();
  const m = /^\d{4}-\d{2}$/.test(ctx.url.searchParams.get('m') || '') ? ctx.url.searchParams.get('m') : today().slice(0, 7);
  const rows = await db.all("SELECT device, COUNT(*) AS n, SUM(CASE WHEN result <> '' THEN 1 ELSE 0 END) AS r FROM wod_done WHERE device LIKE 'a%' AND created LIKE $1 GROUP BY device ORDER BY n DESC LIMIT 100", [m + '%']);
  const names = await athleteNames(rows.map((r) => r.device));
  const ath = await currentAthlete(ctx);
  const list = rows.filter((r) => names[r.device]).map((r) => ({ name: names[r.device], n: Number(r.n), r: Number(r.r), me: ath && r.device === 'a' + ath.id }));
  const prev = addDays(m + '-01', -1).slice(0, 7);
  const next = addDays(m + '-28', 5).slice(0, 7);
  ctx.html(V.ratingPage({ s, month: m, list, prev, next: next <= today().slice(0, 7) ? next : null, athlete: ath, csrf: ctx.session.csrf }));
}

async function adminAthletes(ctx, form) {
  if (form) {
    const id = Number(form.fields.id);
    if (form.fields.action === 'pin' && id) {
      const pin = String(crypto.randomInt(1000, 10000));
      await db.run('UPDATE athletes SET pin=$1 WHERE id=$2', [H.hashPassword(pin), id]);
      const a = await db.get('SELECT name FROM athletes WHERE id=$1', [id]);
      ctx.flash('ok', `Новый PIN для «${a ? a.name : ''}»: ${pin}. Передайте его атлету — он сможет сменить PIN в «Моих тренировках».`);
    }
    if (form.fields.action === 'delete' && id) {
      await db.run('DELETE FROM wod_done WHERE device=$1', ['a' + id]);
      await db.run('DELETE FROM athletes WHERE id=$1', [id]);
      ctx.flash('ok', 'Профиль атлета удалён вместе с отметками.');
    }
    return ctx.redirect('/admin/athletes');
  }
  const rows = await db.all('SELECT * FROM athletes ORDER BY id DESC LIMIT 500');
  const counts = {};
  for (const r of await db.all("SELECT device, COUNT(*) AS n FROM wod_done WHERE device LIKE 'a%' GROUP BY device")) counts[r.device] = Number(r.n);
  return adminRender(ctx, 'Атлеты', V.adminAthletes({ rows: rows.map((r) => ({ ...r, n: counts['a' + r.id] || 0 })), csrf: ctx.session.csrf }));
}

async function adminProgram(ctx, form) {
  if (form) {
    const a = form.fields.action;
    if (a === 'delete') {
      const w = await db.get('SELECT * FROM wods WHERE id=$1', [Number(form.fields.id)]);
      if (w) { if (w.image) await deleteUpload(w.image); await db.run('DELETE FROM wods WHERE id=$1', [w.id]); await db.run('DELETE FROM wod_done WHERE wod_id=$1', [w.id]); ctx.flash('ok', 'Тренировка удалена.'); }
      return ctx.redirect('/admin/program' + (ctx.url.search || ''));
    }
    if (a === 'toggle') {
      await db.run('UPDATE wods SET active=1-active WHERE id=$1', [Number(form.fields.id)]);
      return ctx.redirect('/admin/program' + (ctx.url.search || ''));
    }
    // Добавление: текст, таблица и/или скриншот
    const track = TRACK_SLUGS.has(form.fields.track) ? form.fields.track : TRACKS[0].slug;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(form.fields.wdate || '') ? form.fields.wdate : today();
    const author = String(form.fields.author || '').trim().slice(0, 80);
    let list = [];
    try {
      if (form.files.table) {
        const rows = await W.readTable(form.files.table);
        list = list.concat(W.rowsToWods(rows, { defaultDate: date, defaultTrack: track, trackOf }));
      }
      const text = String(form.fields.body || '');
      if (text.trim()) list = list.concat((form.fields.split ? W.splitByDates(text, date) : [{ date, body: W.tidy(text) }]).map((w) => ({ ...w, track })));
      let image = '';
      if (form.files.image && form.fields.keep_image) image = await saveUpload(form.files.image, 1600);
      if (image) {
        if (list.length === 1) list[0].image = image;
        else list.push({ date, track, body: '', image });
      }
    } catch (err) { ctx.flash('error', err.message); return ctx.redirect('/admin/program'); }
    if (!list.length) { ctx.flash('error', 'Нечего добавлять: вставьте текст, таблицу или скриншот.'); return ctx.redirect('/admin/program'); }
    for (const w of list) {
      await db.run('INSERT INTO wods(track, wdate, body, image, author, active, created) VALUES ($1, $2, $3, $4, $5, 1, $6)', [w.track || track, w.date || date, w.body || '', w.image || '', author, now()]);
    }
    const dates = [...new Set(list.map((w) => w.date))].sort();
    ctx.flash('ok', list.length === 1 ? `Тренировка на ${dates[0].split('-').reverse().join('.')} добавлена.` : `Добавлено тренировок: ${list.length} (${dates[0].split('-').reverse().join('.')} — ${dates[dates.length - 1].split('-').reverse().join('.')}).`);
    return ctx.redirect('/admin/program');
  }
  const track = TRACK_SLUGS.has(ctx.url.searchParams.get('t')) ? ctx.url.searchParams.get('t') : '';
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const page = Math.max(0, Number(ctx.url.searchParams.get('p')) || 0);
  const where = []; const params = [];
  if (track) { params.push(track); where.push(`track=$${params.length}`); }
  if (q) { params.push('%' + q.toLowerCase() + '%'); where.push(`LOWER(body) LIKE $${params.length}`); }
  const rows = await db.all(`SELECT * FROM wods${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY wdate DESC, id DESC LIMIT 51 OFFSET ${page * 50}`, params);
  const counts = {};
  if (rows.length) {
    const ph = rows.map((_, i) => `$${i + 1}`).join(',');
    for (const r of await db.all(`SELECT wod_id, COUNT(*) AS n FROM wod_done WHERE wod_id IN (${ph}) GROUP BY wod_id`, rows.map((r) => r.id))) counts[r.wod_id] = Number(r.n);
  }
  const totals = {};
  for (const r of await db.all('SELECT track, COUNT(*) AS n FROM wods GROUP BY track')) totals[r.track] = Number(r.n);
  return adminRender(ctx, 'Программа тренировок', V.adminProgram({
    tracks: TRACKS, track, q, page, today: today(), totals, csrf: ctx.session.csrf,
    rows: rows.slice(0, 50).map((w) => ({ ...w, summary: W.summary(w.body), done: counts[w.id] || 0 })), hasMore: rows.length > 50,
  }));
}

async function adminProgramEdit(ctx, id, form) {
  const w = await db.get('SELECT * FROM wods WHERE id=$1', [id]);
  if (!w) return notFound(ctx);
  if (form) {
    const track = TRACK_SLUGS.has(form.fields.track) ? form.fields.track : w.track;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(form.fields.wdate || '') ? form.fields.wdate : w.wdate;
    let image = w.image;
    try {
      if (form.fields.image__remove) { await deleteUpload(image); image = ''; }
      const nid = await saveUpload(form.files.image, 1600);
      if (nid) { await deleteUpload(image); image = nid; }
    } catch (err) { ctx.flash('error', err.message); return ctx.redirect(ctx.path); }
    await db.run('UPDATE wods SET track=$1, wdate=$2, body=$3, image=$4, author=$5, active=$6 WHERE id=$7',
      [track, date, W.tidy(form.fields.body || ''), image, String(form.fields.author || '').trim().slice(0, 80), form.fields.active ? 1 : 0, id]);
    ctx.flash('ok', 'Сохранено.');
    return ctx.redirect('/admin/program');
  }
  return adminRender(ctx, 'Тренировка', V.adminProgramEdit({ w: { ...w, blocks: W.toBlocks(w.body) }, tracks: TRACKS, csrf: ctx.session.csrf }));
}


// ---------------------------------------------------------------------------
// CRM: клиентская база копится сама — каждая заявка с сайта попадает в карточку клиента (по номеру телефона)
// ---------------------------------------------------------------------------
const CRM_STATUS = C.CRM_STATUS;
const CRM_SOURCE = C.CRM_SOURCE;
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const crmLog = (clientId, kind, text, at) => db.run('INSERT INTO crm_log(client_id, created, kind, text) VALUES ($1, $2, $3, $4)', [clientId, at || now(), kind, text]);

async function crmFromLead(l) {
  const key = phoneKey(l.phone);
  if (key.length < 10) return null;
  let c = await db.get('SELECT * FROM clients WHERE phone_key=$1 ORDER BY id LIMIT 1', [key]);
  const what = `Заявка с сайта${l.interest ? ': ' + l.interest : ''}`;
  if (!c) {
    const r = await db.run("INSERT INTO clients(name, phone, phone_key, status, source, created, updated) VALUES ($1, $2, $3, $4, 'site', $5, $5) RETURNING id",
      [l.name || '', l.phone, key, l.status === 'done' ? 'contact' : 'new', l.created]);
    c = { id: r.rows[0].id };
  } else {
    await db.run("UPDATE clients SET updated=$1, name=CASE WHEN name='' THEN $2 ELSE name END, status=CASE WHEN status='lost' THEN 'new' ELSE status END WHERE id=$3", [l.created, l.name || '', c.id]);
  }
  await crmLog(c.id, 'lead', what, l.created);
  if (l.id) await db.run('UPDATE leads SET client_id=$1 WHERE id=$2', [c.id, l.id]);
  return c.id;
}

async function crmBackfill() {
  if (await db.get("SELECT value FROM settings WHERE key='_crm_v1'")) return;
  for (const l of await db.all('SELECT * FROM leads WHERE client_id IS NULL ORDER BY id')) await crmFromLead(l);
  await setSetting('_crm_v1', '1');
}

const dayStr = (offsetDays = 0) => new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);

async function adminDash(ctx) {
  const today = dayStr(0);
  const cnt = async (sql, params = []) => Number((await db.get(sql, params)).n);
  const leads = {
    today: await cnt('SELECT COUNT(*) AS n FROM leads WHERE created >= $1', [today]),
    week: await cnt('SELECT COUNT(*) AS n FROM leads WHERE created >= $1', [dayStr(-6)]),
    month: await cnt('SELECT COUNT(*) AS n FROM leads WHERE created >= $1', [dayStr(-29)]),
    all: await cnt('SELECT COUNT(*) AS n FROM leads'),
    fresh: await cnt("SELECT COUNT(*) AS n FROM leads WHERE status='new'"),
  };
  const byDay = {};
  for (const r of await db.all('SELECT substr(created, 1, 10) AS d, COUNT(*) AS n FROM leads WHERE created >= $1 GROUP BY substr(created, 1, 10)', [dayStr(-29)])) byDay[r.d] = Number(r.n);
  const days = Array.from({ length: 30 }, (_, i) => { const d = dayStr(i - 29); return { d, n: byDay[d] || 0 }; });
  const funnel = {};
  for (const r of await db.all('SELECT status, COUNT(*) AS n FROM clients GROUP BY status')) funnel[r.status] = Number(r.n);
  const interests = (await db.all("SELECT interest, COUNT(*) AS n FROM leads WHERE created >= $1 GROUP BY interest ORDER BY COUNT(*) DESC LIMIT 6", [dayStr(-89)]))
    .map((r) => ({ name: r.interest || 'не указано', n: Number(r.n) }));
  const clients = {
    all: await cnt('SELECT COUNT(*) AS n FROM clients'),
    month: await cnt('SELECT COUNT(*) AS n FROM clients WHERE created >= $1', [dayStr(-29)]),
    members: funnel.member || 0,
    becameMembers: await cnt("SELECT COUNT(DISTINCT client_id) AS n FROM crm_log WHERE kind='status' AND text LIKE $1 AND created >= $2", ['%→ ' + CRM_STATUS.member, dayStr(-29)]),
  };
  const due = await db.all("SELECT * FROM clients WHERE next_date <> '' AND next_date <= $1 AND status NOT IN ('member', 'lost') ORDER BY next_date LIMIT 20", [today]);
  const prog = {
    athletes: await cnt('SELECT COUNT(*) AS n FROM athletes'),
    marks: await cnt('SELECT COUNT(*) AS n FROM wod_done WHERE created >= $1', [dayStr(-6)]),
  };
  const s = await getSettings();
  return adminRender(ctx, 'Обзор', V.adminDash({ leads, days, funnel, interests, clients, due, prog, metrika: String(s.metrika_id || '').trim(), status: CRM_STATUS }));
}

async function adminCrm(ctx, form) {
  if (form && form.fields.action === 'add') {
    const f = form.fields;
    const name = String(f.name || '').trim().slice(0, 80);
    const phone = String(f.phone || '').trim().slice(0, 40);
    if (!name && !phone) { ctx.flash('error', 'Укажите имя или телефон.'); return ctx.redirect('/admin/crm'); }
    const key = phoneKey(phone);
    if (key.length === 10) {
      const ex = await db.get('SELECT id FROM clients WHERE phone_key=$1', [key]);
      if (ex) { ctx.flash('error', 'Клиент с этим номером уже есть — открыли его карточку.'); return ctx.redirect('/admin/crm/' + ex.id); }
    }
    const status = CRM_STATUS[f.status] ? f.status : 'new';
    const source = CRM_SOURCE[f.source] ? f.source : 'call';
    const t = now();
    const r = await db.run('INSERT INTO clients(name, phone, phone_key, status, source, note, created, updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id',
      [name, phone, key, status, source, String(f.note || '').trim().slice(0, 2000), t]);
    await crmLog(r.rows[0].id, 'note', `Добавлен вручную (${CRM_SOURCE[source]})`, t);
    ctx.flash('ok', 'Клиент добавлен.');
    return ctx.redirect('/admin/crm/' + r.rows[0].id);
  }
  const st = ctx.url.searchParams.get('st') || '';
  const q = String(ctx.url.searchParams.get('q') || '').trim();
  const where = []; const params = [];
  if (CRM_STATUS[st]) { params.push(st); where.push(`status=$${params.length}`); }
  if (st === 'due') { params.push(dayStr(0)); where.push(`next_date <> '' AND next_date <= $${params.length} AND status NOT IN ('member', 'lost')`); }
  if (q) {
    const qk = q.replace(/\D/g, '');
    params.push('%' + q.toLowerCase() + '%');
    let w = `LOWER(name) LIKE $${params.length}`;
    if (qk.length >= 3) { params.push('%' + qk + '%'); w += ` OR phone_key LIKE $${params.length}`; }
    where.push('(' + w + ')');
  }
  const rows = await db.all(`SELECT * FROM clients${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated DESC, id DESC LIMIT 500`, params);
  const counts = {};
  for (const r of await db.all('SELECT status, COUNT(*) AS n FROM clients GROUP BY status')) counts[r.status] = Number(r.n);
  counts.due = Number((await db.get("SELECT COUNT(*) AS n FROM clients WHERE next_date <> '' AND next_date <= $1 AND status NOT IN ('member', 'lost')", [dayStr(0)])).n);
  return adminRender(ctx, 'Клиенты', V.adminCrm({ rows, st, q, counts, status: CRM_STATUS, source: CRM_SOURCE, today: dayStr(0), csrf: ctx.session.csrf }));
}

async function adminCrmCard(ctx, id, form) {
  const c = await db.get('SELECT * FROM clients WHERE id=$1', [id]);
  if (!c) return notFound(ctx);
  if (form) {
    const f = form.fields; const t = now();
    if (f.action === 'delete') {
      await db.run('DELETE FROM crm_log WHERE client_id=$1', [id]);
      await db.run('UPDATE leads SET client_id=NULL WHERE client_id=$1', [id]);
      await db.run('DELETE FROM clients WHERE id=$1', [id]);
      ctx.flash('ok', 'Клиент удалён.');
      return ctx.redirect('/admin/crm');
    }
    if (f.action === 'log') {
      const text = String(f.text || '').trim().slice(0, 2000);
      const kind = ['call', 'visit', 'note', 'pay'].includes(f.kind) ? f.kind : 'note';
      if (text) { await crmLog(id, kind, text, t); await db.run('UPDATE clients SET updated=$1 WHERE id=$2', [t, id]); }
      if (f.next_date !== undefined) await db.run('UPDATE clients SET next_date=$1 WHERE id=$2', [/^\d{4}-\d{2}-\d{2}$/.test(f.next_date) ? f.next_date : '', id]);
      return ctx.redirect('/admin/crm/' + id);
    }
    if (f.action === 'status' && CRM_STATUS[f.status] && f.status !== c.status) {
      await db.run('UPDATE clients SET status=$1, updated=$2 WHERE id=$3', [f.status, t, id]);
      await crmLog(id, 'status', `${CRM_STATUS[c.status] || c.status} → ${CRM_STATUS[f.status]}`, t);
      return ctx.redirect('/admin/crm/' + id);
    }
    if (f.action === 'save') {
      const phone = String(f.phone || '').trim().slice(0, 40);
      const status = CRM_STATUS[f.status] ? f.status : c.status;
      await db.run('UPDATE clients SET name=$1, phone=$2, phone_key=$3, status=$4, source=$5, note=$6, next_date=$7, updated=$8 WHERE id=$9', [
        String(f.name || '').trim().slice(0, 80), phone, phoneKey(phone), status, CRM_SOURCE[f.source] ? f.source : c.source,
        String(f.note || '').trim().slice(0, 4000), /^\d{4}-\d{2}-\d{2}$/.test(f.next_date || '') ? f.next_date : '', t, id]);
      if (status !== c.status) await crmLog(id, 'status', `${CRM_STATUS[c.status] || c.status} → ${CRM_STATUS[status]}`, t);
      ctx.flash('ok', 'Сохранено.');
      return ctx.redirect('/admin/crm/' + id);
    }
    return ctx.redirect('/admin/crm/' + id);
  }
  const log = await db.all('SELECT * FROM crm_log WHERE client_id=$1 ORDER BY created DESC, id DESC', [id]);
  const leadsOf = await db.all('SELECT * FROM leads WHERE client_id=$1 ORDER BY id DESC', [id]);
  return adminRender(ctx, c.name || c.phone || 'Клиент', V.adminCrmCard({ c, log, leads: leadsOf, status: CRM_STATUS, source: CRM_SOURCE, today: dayStr(0), csrf: ctx.session.csrf }));
}

async function adminCrmCsv(ctx) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = await db.all('SELECT * FROM clients ORDER BY id DESC');
  const out = ['Имя;Телефон;Этап;Источник;Следующий контакт;Заметка;Создан;Обновлён',
    ...rows.map((r) => [r.name, r.phone, CRM_STATUS[r.status] || r.status, CRM_SOURCE[r.source] || r.source, r.next_date, r.note, r.created, r.updated].map(q).join(';'))].join('\r\n');
  ctx.text('﻿' + out, 200, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename=cfbaza-clients.csv' });
}

// Личный кабинет: администратора ведём в админку, остальным — заглушка «в разработке»
async function pageCabinet(ctx) {
  if (await isAdmin(ctx)) return ctx.redirect('/admin');
  ctx.res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return ctx.html(V.cabinetPage({ s: await getSettings() }));
}

// ---------------------------------------------------------------------------
// Админка
// ---------------------------------------------------------------------------
async function adminRender(ctx, title, body) {
  const n = Number((await db.get("SELECT COUNT(*) AS n FROM leads WHERE status='new'")).n);
  ctx.html(V.adminPage({ title, body, path: ctx.path, csrf: ctx.session.csrf, newLeads: n, flash: ctx.takeFlash() }));
}

// Вход в админку: по коду на почту (основной способ) или по паролю (если задан ADMIN_PASSWORD)
const ADMIN_EMAILS = String(process.env.ADMIN_EMAIL || 'dadyfedor@yandex.ru').toLowerCase().split(/[,;\s]+/).filter(Boolean);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const smtpReady = () => Boolean(String(process.env.SMTP_USER || '').trim() && String(process.env.SMTP_PASSWORD || '').trim());

// Сессия администратора живёт 7 дней; «Выйти на всех устройствах» меняет _admin_ver — все старые входы перестают действовать
const ADMIN_TTL = 7 * 24 * 3600 * 1000;
const adminVer = async () => { const r = await db.get("SELECT value FROM settings WHERE key='_admin_ver'"); return r ? r.value : '0'; };
async function isAdmin(ctx) {
  const s = ctx.session;
  if (!s.admin) return false;
  if (!s.adminSince || Date.now() - s.adminSince > ADMIN_TTL || s.adminVer !== await adminVer()) {
    ctx.session = { csrf: crypto.randomBytes(16).toString('hex') }; ctx.sessionDirty = true;
    return false;
  }
  return true;
}

async function adminSignIn(ctx) {
  ctx.session = { admin: true, adminSince: Date.now(), adminVer: await adminVer(), csrf: crypto.randomBytes(16).toString('hex') };
  ctx.sessionDirty = true;
  const next = ctx.url.searchParams.get('next') || '';
  return ctx.redirect(next.startsWith('/admin') ? next : '/admin');
}

async function adminLogin(ctx) {
  let error = null; let info = null;
  let step = ctx.session.pendingEmail ? 'code' : 'email';
  if (ctx.req.method === 'GET' && ctx.url.searchParams.get('t')) {
    // вход по ссылке из письма
    const row = await db.get("SELECT value FROM settings WHERE key='_login_code'");
    const st = row ? JSON.parse(row.value || '{}') : {};
    if (st.link && st.link === sha(ctx.url.searchParams.get('t')) && Date.now() < st.exp) {
      await setSetting('_login_code', '{}');
      return await adminSignIn(ctx);
    }
    error = 'Ссылка устарела или уже использована. Запросите новый код.';
    step = 'email';
  } else if (ctx.req.method === 'POST') {
    const { fields } = await H.parseForm(ctx.req);
    const a = fields.action || 'password';
    if (fields.csrf !== ctx.session.csrf) error = 'Сессия устарела, попробуйте ещё раз.';
    else if (a === 'reset') { delete ctx.session.pendingEmail; ctx.sessionDirty = true; step = 'email'; }
    else if (a === 'send') {
      const email = String(fields.email || '').trim().toLowerCase();
      if (rateLimited('mailcode:' + clientIp(ctx.req), 5, 900000)) error = 'Слишком много запросов. Подождите 15 минут.';
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = 'Проверьте адрес почты.';
      else if (!smtpReady()) error = 'Отправка писем на сервере ещё не настроена (нужны SMTP_USER и SMTP_PASSWORD в Pipecore).';
      else {
        if (ADMIN_EMAILS.includes(email)) {
          const code = String(crypto.randomInt(100000, 1000000));
          const token = crypto.randomBytes(24).toString('hex');
          await setSetting('_login_code', JSON.stringify({ code: sha(code), link: sha(token), exp: Date.now() + 15 * 60000, tries: 0 }));
          const link = `${rootUrl(ctx.req)}admin/login?t=${token}`;
          const text = `Код для входа в админку CF BAZA: ${code}\n\nИли просто нажмите на ссылку:\n${link}\n\nКод и ссылка действуют 15 минут. Если вы не запрашивали вход — ничего не делайте, без кода войти нельзя.`;
          try {
            await sendMail({ host: process.env.SMTP_HOST || 'smtp.yandex.ru', port: process.env.SMTP_PORT || 465, user: String(process.env.SMTP_USER).trim(), pass: String(process.env.SMTP_PASSWORD).replace(/\s+/g, ''), to: [email], subject: `Код входа CF BAZA: ${code}`, text });
          } catch (err) {
            console.error('login mail error:', err.message);
            error = 'Не удалось отправить письмо. Проверьте настройки почты сайта (SMTP) и попробуйте ещё раз.';
          }
        }
        if (!error) { ctx.session.pendingEmail = email; ctx.sessionDirty = true; step = 'code'; info = `Если ${email} — адрес администратора, на него пришло письмо с кодом. Проверьте и папку «Спам».`; }
      }
    } else if (a === 'code') {
      const row = await db.get("SELECT value FROM settings WHERE key='_login_code'");
      const st = row ? JSON.parse(row.value || '{}') : {};
      const code = String(fields.code || '').replace(/\D/g, '');
      if (!st.code || Date.now() > st.exp) { error = 'Код устарел. Запросите новый.'; }
      else if (st.tries >= 5) { error = 'Слишком много неверных попыток. Запросите новый код.'; }
      else if (sha(code) === st.code && ADMIN_EMAILS.includes(ctx.session.pendingEmail)) {
        await setSetting('_login_code', '{}');
        return await adminSignIn(ctx);
      } else {
        st.tries = (st.tries || 0) + 1;
        await setSetting('_login_code', JSON.stringify(st));
        error = 'Неверный код.';
      }
      step = 'code';
    } else if (a === 'password') {
      step = 'password';
      if (rateLimited('login:' + clientIp(ctx.req), 8, 900000)) error = 'Слишком много попыток. Подождите 15 минут.';
      else {
        const row = await db.get("SELECT value FROM settings WHERE key='_admin_hash'");
        if (row && H.checkPassword(String(fields.password || ''), row.value)) return await adminSignIn(ctx);
        error = 'Неверный пароль.';
      }
    }
  }
  if (ctx.url.searchParams.get('by') === 'password') step = 'password';
  ctx.html(V.login({ csrf: ctx.session.csrf, error, info, step, email: ctx.session.pendingEmail || '', next: ctx.url.searchParams.get('next') || '' }));
}

async function adminLeads(ctx, form) {
  if (form) {
    const id = Number(form.fields.id);
    const a = form.fields.action;
    if (a === 'done') await db.run("UPDATE leads SET status='done' WHERE id=$1", [id]);
    else if (a === 'new') await db.run("UPDATE leads SET status='new' WHERE id=$1", [id]);
    else if (a === 'delete') await db.run('DELETE FROM leads WHERE id=$1', [id]);
    else if (a === 'spam') await db.run("UPDATE leads SET status='spam' WHERE id=$1", [id]);
    else if (a === 'notspam') {
      const l = await db.get('SELECT * FROM leads WHERE id=$1', [id]);
      if (l) { await db.run("UPDATE leads SET status='new' WHERE id=$1", [id]); if (!l.client_id) await crmFromLead({ ...l, status: 'new' }); }
    } else if (a === 'purge_spam') await db.run("DELETE FROM leads WHERE status='spam'");
    const sh = ctx.url.searchParams.get('show');
    return ctx.redirect('/admin/leads' + (sh ? '?show=' + encodeURIComponent(sh) : ''));
  }
  const show = ctx.url.searchParams.get('show') || '';
  const where = show === 'new' ? " WHERE status='new'" : show === 'spam' ? " WHERE status='spam'" : " WHERE status <> 'spam'";
  const rows = await db.all(`SELECT * FROM leads${where} ORDER BY id DESC LIMIT 500`);
  const spamCount = Number((await db.get("SELECT COUNT(*) AS n FROM leads WHERE status='spam'")).n);
  return adminRender(ctx, 'Заявки', V.leads({ rows, show, spamCount, csrf: ctx.session.csrf }));
}

async function adminLeadsCsv(ctx) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = await db.all('SELECT * FROM leads ORDER BY id DESC');
  const out = ['Дата;Имя;Телефон;Интерес;Статус', ...rows.map((r) => [r.created, r.name, r.phone, r.interest, r.status === 'done' ? 'обработана' : 'новая'].map(q).join(';'))].join('\r\n');
  ctx.text('\ufeff' + out, 200, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename=cfbaza-leads.csv' });
}

async function adminSettings(ctx, group, form) {
  const g = C.SETTINGS_GROUPS[group];
  if (!g) return notFound(ctx);
  const [title, fields] = g;
  const s = await getSettings();
  if (form) {
    try {
      for (const [key, , ftype] of fields) {
        if (ftype === 'image') {
          if (form.fields[`${key}__remove`]) { await deleteUpload(s[key]); await setSetting(key, ''); }
          const id = await saveUpload(form.files[key], 2200);
          if (id) { await deleteUpload(s[key]); await setSetting(key, id); }
        } else if (ftype === 'color') {
          const v = String(form.fields[key] || '').trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) await setSetting(key, v.toUpperCase());
        } else {
          await setSetting(key, String(form.fields[key] ?? '').trim());
        }
      }
      ctx.flash('ok', 'Сохранено.');
    } catch (err) { ctx.flash('error', err.message); }
    return ctx.redirect(`/admin/settings/${group}`);
  }
  return adminRender(ctx, title, V.settingsPage({ title, fields, s, csrf: ctx.session.csrf }));
}

async function adminList(ctx, kind, form) {
  const meta = C.COLLECTIONS[kind];
  if (!meta) return notFound(ctx);
  if (form) {
    const id = Number(form.fields.id);
    const a = form.fields.action;
    const items = await getItems(kind, false);
    const ids = items.map((x) => x.id);
    if (ids.includes(id)) {
      if (a === 'up' || a === 'down') {
        const i = ids.indexOf(id);
        const j = a === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
        for (let n = 0; n < ids.length; n += 1) await db.run('UPDATE items SET sort=$1 WHERE id=$2', [(n + 1) * 10, ids[n]]);
      } else if (a === 'toggle') {
        await db.run('UPDATE items SET active=1-active WHERE id=$1', [id]);
      } else if (a === 'delete') {
        const it = items.find((x) => x.id === id);
        for (const [key, , ftype] of meta.fields) if (ftype === 'image') await deleteUpload(it[key]);
        await db.run('DELETE FROM items WHERE id=$1', [id]);
        ctx.flash('ok', 'Удалено.');
      }
    }
    return ctx.redirect(`/admin/c/${kind}`);
  }
  let items = await getItems(kind, false);
  if (kind === 'slot') items = items.sort((x, y) => ((DAY_ORDER[x.day] ?? 9) - (DAY_ORDER[y.day] ?? 9)) || timeNum(x.time) - timeNum(y.time));
  return adminRender(ctx, meta.title, V.listPage({ kind, meta, items, csrf: ctx.session.csrf }));
}

async function adminEdit(ctx, kind, itemId, form) {
  const meta = C.COLLECTIONS[kind];
  if (!meta) return notFound(ctx);
  let item = {};
  if (itemId) {
    item = await getItem(itemId, kind);
    if (!item) return notFound(ctx);
  }
  if (form) {
    const data = { ...item };
    delete data.id; delete data.sort; delete data.active;
    try {
      for (const [key, , ftype] of meta.fields) {
        if (ftype === 'image') {
          if (form.fields[`${key}__remove`]) { await deleteUpload(data[key]); data[key] = ''; }
          const id = await saveUpload(form.files[key], 1600);
          if (id) { await deleteUpload(data[key]); data[key] = id; }
        } else if (ftype === 'bool') {
          data[key] = form.fields[key] ? '1' : '';
        } else {
          data[key] = String(form.fields[key] ?? '').trim();
        }
      }
    } catch (err) {
      ctx.flash('error', err.message);
      return ctx.redirect(ctx.path);
    }
    if (itemId) {
      await db.run('UPDATE items SET data=$1, updated=$2 WHERE id=$3', [JSON.stringify(data), now(), itemId]);
    } else {
      const mx = Number((await db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM items WHERE kind=$1', [kind])).m);
      await db.run('INSERT INTO items(kind, sort, data, updated) VALUES ($1, $2, $3, $4)', [kind, mx + 10, JSON.stringify(data), now()]);
    }
    ctx.flash('ok', 'Сохранено.');
    return ctx.redirect(form.fields.and_new ? `/admin/c/${kind}/new` : `/admin/c/${kind}`);
  }
  return adminRender(ctx, meta.title, V.formPage({ kind, meta, item, csrf: ctx.session.csrf }));
}

async function adminPassword(ctx, form) {
  const row = await db.get("SELECT value FROM settings WHERE key='_admin_hash'");
  if (form && form.fields.action === 'logout_all') {
    await setSetting('_admin_ver', crypto.randomBytes(8).toString('hex'));
    ctx.session = { csrf: crypto.randomBytes(16).toString('hex') }; ctx.sessionDirty = true;
    return ctx.redirect('/admin/login');
  }
  if (form) {
    const { old = '', new: nw = '', new2 = '' } = form.fields;
    if (!row || !H.checkPassword(old, row.value)) ctx.flash('error', 'Текущий пароль указан неверно.');
    else if (nw.length < 8) ctx.flash('error', 'Новый пароль — минимум 8 символов.');
    else if (nw !== new2) ctx.flash('error', 'Пароли не совпадают.');
    else { await setSetting('_admin_hash', H.hashPassword(nw)); ctx.flash('ok', 'Пароль изменён.'); }
    return ctx.redirect('/admin/password');
  }
  const left = Math.max(0, Math.ceil((ctx.session.adminSince + ADMIN_TTL - Date.now()) / 86400000));
  return adminRender(ctx, 'Безопасность', V.passwordPage({ csrf: ctx.session.csrf, hasPassword: Boolean(row), emails: ADMIN_EMAILS, left }));
}

async function handleAdmin(ctx) {
  const p = ctx.path;
  if (p === '/admin/login') return adminLogin(ctx);
  if (!(await isAdmin(ctx))) return ctx.redirect('/admin/login?next=' + encodeURIComponent(p));
  let form = null;
  if (ctx.req.method === 'POST') {
    form = await H.parseForm(ctx.req);
    if (!form.fields.csrf || form.fields.csrf !== ctx.session.csrf) {
      return ctx.html('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Сессия устарела. <a href="javascript:history.back()">Вернитесь</a>, обновите страницу и попробуйте ещё раз.</p>', 400);
    }
  }
  if (p === '/admin' || p === '/admin/') return adminDash(ctx);
  if (p === '/admin/crm') return adminCrm(ctx, form);
  if (p === '/admin/crm.csv') return adminCrmCsv(ctx);
  if (p === '/admin/logout' && form) { ctx.session = {}; ctx.sessionDirty = true; return ctx.redirect('/admin/login'); }
  if (p === '/admin/leads') return adminLeads(ctx, form);
  if (p === '/admin/leads.csv') return adminLeadsCsv(ctx);
  if (p === '/admin/password') return adminPassword(ctx, form);
  if (p === '/admin/program') return adminProgram(ctx, form);
  if (p === '/admin/athletes') return adminAthletes(ctx, form);
  let m;
  if ((m = /^\/admin\/settings\/(\d+)$/.exec(p))) return adminSettings(ctx, Number(m[1]), form);
  if ((m = /^\/admin\/program\/(\d+)$/.exec(p))) return adminProgramEdit(ctx, Number(m[1]), form);
  if ((m = /^\/admin\/crm\/(\d+)$/.exec(p))) return adminCrmCard(ctx, Number(m[1]), form);
  if ((m = /^\/admin\/c\/([a-z]+)$/.exec(p))) return adminList(ctx, m[1], form);
  if ((m = /^\/admin\/c\/([a-z]+)\/new$/.exec(p))) return adminEdit(ctx, m[1], null, form);
  if ((m = /^\/admin\/c\/([a-z]+)\/(\d+)$/.exec(p))) return adminEdit(ctx, m[1], Number(m[2]), form);
  return notFound(ctx);
}

async function handle(req, res) {
  const ctx = new Ctx(req, res);
  const p = ctx.path;
  let m0;
  const host = reqHost(req);
  const isMainHost = host === SITE_HOST || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  try {
    // Второй вариант адреса (с www или без) → основной, чтобы у поисковиков было одно «зеркало»
    const altHost = SITE_HOST.startsWith('www.') ? SITE_HOST.slice(4) : 'www.' + SITE_HOST;
    if (host === altHost && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(301, { Location: SITE_URL.replace(/\/$/, '') + req.url });
      return res.end();
    }
    // Временный адрес и прочие хосты работают, но не индексируются — чтобы в поиске был только cf-baza.ru
    if (!isMainHost) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (p.startsWith('/static/')) return await serveStatic(ctx);
    if (p.startsWith('/uploads/')) return await serveUpload(ctx);
    if (p === '/' && (req.method === 'GET' || req.method === 'HEAD')) return await pageIndex(ctx);
    if (p === '/lead' && req.method === 'POST') return await postLead(ctx);
    if ((p === '/cabinet' || p === '/cabinet/') && (req.method === 'GET' || req.method === 'HEAD')) return await pageCabinet(ctx);
    if (p === '/program' || p.startsWith('/program/')) {
      const st = await getSettings();
      if (!st.program_public) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    if (p === '/program' && (req.method === 'GET' || req.method === 'HEAD')) return await pageProgram(ctx);
    if (p === '/program/done' && req.method === 'POST') return await postWodDone(ctx);
    if (p === '/program/rating' && req.method === 'GET') return await pageRating(ctx);
    if (p === '/program/me' && req.method === 'GET') return await pageMe(ctx);
    if (p === '/program/profile' && req.method === 'POST') return await postProfile(ctx);
    if ((p === '/program/login' || p === '/program/register' || p === '/program/logout') && req.method === 'POST') return await postAthlete(ctx, p.split('/').pop());
    if (p === '/privacy' || p === '/consent' || p === '/consent-public' || p === '/requisites') {
      const s = await getSettings();
      s._root = SITE_URL;
      if (p === '/privacy') return ctx.html(V.legalDoc(s, L.policy(s)));
      if (p === '/consent') return ctx.html(V.legalDoc(s, L.consent(s)));
      if (p === '/consent-public') return ctx.html(V.legalDoc(s, L.publicConsent(s)));
      return ctx.html(V.requisitesPage(s, L.requisites(s)));
    }
    if (p.startsWith('/vendor/fonts/')) return await serveFont(ctx);
    // Файл подтверждения прав для Яндекс.Вебмастера (код — в настройках или в списке ниже)
    if ((m0 = /^\/yandex_([0-9a-f]{8,32})\.html$/.exec(p))) {
      const st = await getSettings();
      const codes = new Set(['e30b90ef8fa39d09', String(st.yandex_verification || '').trim()]);
      if (!codes.has(m0[1])) return notFound(ctx);
      return ctx.html(`<html>\n    <head>\n        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n    </head>\n    <body>Verification: ${m0[1]}</body>\n</html>\n`);
    }
    if (p === '/healthz') return ctx.text('ok');
    if (p === '/robots.txt') {
      if (!isMainHost) return ctx.text('User-agent: *\nDisallow: /\n');
      return ctx.text(`User-agent: *\nDisallow: /admin\nDisallow: /lead\nDisallow: /cabinet\nSitemap: ${SITE_URL}sitemap.xml\n`);
    }
    if (p === '/sitemap.xml') {
      const r = SITE_URL;
      const st = await getSettings();
      const urls = [['', '1.0', 'weekly'], ...(st.program_public ? [['program', '0.8', 'daily']] : []), ['privacy', '0.2', 'yearly'], ['consent', '0.2', 'yearly'], ['requisites', '0.2', 'yearly']];
      return ctx.text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(([u, pr, f]) => `<url><loc>${r}${u}</loc><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('')}</urlset>`, 200, 'application/xml');
    }
    if (p === '/favicon.ico') return ctx.redirect('/static/img/favicon-32.png');
    if (p === '/admin' || p.startsWith('/admin/')) return await handleAdmin(ctx);
    return notFound(ctx);
  } catch (err) {
    if (err.status === 413) return ctx.html(`<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">${V.e(err.message)} <a href="javascript:history.back()">Назад</a></p>`, 413);
    console.error(err);
    if (!res.headersSent) ctx.html('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Что-то пошло не так. Попробуйте ещё раз.</p>', 500);
  }
}

// Заявки хранятся не дольше года (так написано в политике и согласии) — старые удаляются автоматически.
async function purgeOldLeads() {
  try {
    const cutoff = new Date(Date.now() + 8 * 3600 * 1000 - 365 * 24 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const r = await db.run('DELETE FROM leads WHERE created < $1', [cutoff]);
    if (r.changes) console.log(`Удалено старых заявок (старше года): ${r.changes}`);
  } catch (err) { console.error('purge error:', err.message); }
}

async function main() {
  await init();
  await crmBackfill();
  await purgeOldLeads();
  setInterval(purgeOldLeads, 24 * 3600 * 1000).unref();
  const port = Number(process.env.PORT || 3000);
  http.createServer(handle).listen(port, '0.0.0.0', () => console.log(`CF BAZA: http://localhost:${port}  (база: ${db.kind})`));
}

if (require.main === module) {
  main().catch((err) => { console.error('Не удалось запустить сайт:', err); process.exit(1); });
}

module.exports = { handle, init, db };
