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
    const h = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra };
    if (this.path.startsWith('/admin')) { h['X-Frame-Options'] = 'DENY'; h['Cache-Control'] = 'no-store'; }
    const cookies = [...(this.extraCookies || [])];
    if (this.sessionDirty) {
      this.session._exp = Date.now() + 14 * 24 * 3600 * 1000;
      cookies.push(`cfb=${encodeURIComponent(codec.encode(this.session))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 3600}${isHttps(this.req) ? '; Secure' : ''}`);
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
    sent: ctx.url.searchParams.get('sent') === '1', flash: ctx.takeFlash(),
  };
  ctx.html(V.site(data));
}

async function postLead(ctx) {
  const wantsJson = /application\/json/.test(ctx.req.headers.accept || '');
  const { fields } = await H.parseForm(ctx.req);
  const fail = (msg) => {
    if (wantsJson) return ctx.json({ ok: false, error: msg }, 400);
    ctx.flash('error', msg);
    return ctx.redirect('/#contacts');
  };
  if (fields.website) return wantsJson ? ctx.json({ ok: true }) : ctx.redirect('/?sent=1#contacts');
  const name = String(fields.name || '').trim().slice(0, 80);
  const phone = String(fields.phone || '').trim().slice(0, 40);
  const interest = String(fields.interest || '').trim().slice(0, 120);
  if (phone.replace(/\D/g, '').length < 10) return fail('Проверьте номер телефона — нужно не меньше 10 цифр.');
  if (!fields.consent) return fail('Нужно согласие на обработку персональных данных.');
  if (rateLimited('lead:' + clientIp(ctx.req), 5, 600000)) return fail('Слишком много заявок подряд. Позвоните нам, пожалуйста.');
  const created = now();
  await db.run('INSERT INTO leads(created, name, phone, interest, ip) VALUES ($1, $2, $3, $4, $5)', [created, name, phone, interest, clientIp(ctx.req)]);
  const s = await getSettings();
  const body = `Новая заявка с сайта CF BAZA\n\nИмя: ${name || '—'}\nТелефон: ${phone}\nИнтерес: ${interest || '—'}\nВремя: ${created}\n\nВсе заявки: ${rootUrl(ctx.req)}admin/leads`;
  notifyTelegram(body);
  notifyEmail(`Заявка с сайта: ${name || phone}`, body, s.notify_email);
  return wantsJson ? ctx.json({ ok: true }) : ctx.redirect('/?sent=1#contacts');
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
// Админка
// ---------------------------------------------------------------------------
async function adminRender(ctx, title, body) {
  const n = Number((await db.get("SELECT COUNT(*) AS n FROM leads WHERE status='new'")).n);
  ctx.html(V.adminPage({ title, body, path: ctx.path, csrf: ctx.session.csrf, newLeads: n, flash: ctx.takeFlash() }));
}

async function adminLogin(ctx) {
  let error = null;
  if (ctx.req.method === 'POST') {
    const { fields } = await H.parseForm(ctx.req);
    if (fields.csrf !== ctx.session.csrf) error = 'Сессия устарела, попробуйте ещё раз.';
    else if (rateLimited('login:' + clientIp(ctx.req), 8, 900000)) error = 'Слишком много попыток. Подождите 15 минут.';
    else {
      const row = await db.get("SELECT value FROM settings WHERE key='_admin_hash'");
      if (String(fields.login || '').trim().toLowerCase() === 'admin' && row && H.checkPassword(String(fields.password || ''), row.value)) {
        ctx.session = { admin: true, csrf: crypto.randomBytes(16).toString('hex') };
        ctx.sessionDirty = true;
        const next = ctx.url.searchParams.get('next') || '';
        return ctx.redirect(next.startsWith('/admin') ? next : '/admin/leads');
      }
      error = 'Неверный логин или пароль.';
    }
  }
  ctx.html(V.login({ csrf: ctx.session.csrf, error }));
}

async function adminLeads(ctx, form) {
  if (form) {
    const id = Number(form.fields.id);
    const a = form.fields.action;
    if (a === 'done') await db.run("UPDATE leads SET status='done' WHERE id=$1", [id]);
    else if (a === 'new') await db.run("UPDATE leads SET status='new' WHERE id=$1", [id]);
    else if (a === 'delete') await db.run('DELETE FROM leads WHERE id=$1', [id]);
    return ctx.redirect('/admin/leads' + (ctx.url.searchParams.get('show') === 'new' ? '?show=new' : ''));
  }
  const show = ctx.url.searchParams.get('show') || '';
  const rows = await db.all(`SELECT * FROM leads${show === 'new' ? " WHERE status='new'" : ''} ORDER BY id DESC LIMIT 500`);
  return adminRender(ctx, 'Заявки', V.leads({ rows, show, csrf: ctx.session.csrf }));
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
  if (form) {
    const row = await db.get("SELECT value FROM settings WHERE key='_admin_hash'");
    const { old = '', new: nw = '', new2 = '' } = form.fields;
    if (!H.checkPassword(old, row.value)) ctx.flash('error', 'Текущий пароль указан неверно.');
    else if (nw.length < 8) ctx.flash('error', 'Новый пароль — минимум 8 символов.');
    else if (nw !== new2) ctx.flash('error', 'Пароли не совпадают.');
    else { await setSetting('_admin_hash', H.hashPassword(nw)); ctx.flash('ok', 'Пароль изменён.'); }
    return ctx.redirect('/admin/password');
  }
  return adminRender(ctx, 'Пароль', V.passwordPage({ csrf: ctx.session.csrf }));
}

async function handleAdmin(ctx) {
  const p = ctx.path;
  if (p === '/admin/login') return adminLogin(ctx);
  if (!ctx.session.admin) return ctx.redirect('/admin/login?next=' + encodeURIComponent(p));
  let form = null;
  if (ctx.req.method === 'POST') {
    form = await H.parseForm(ctx.req);
    if (!form.fields.csrf || form.fields.csrf !== ctx.session.csrf) {
      return ctx.html('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:40px">Сессия устарела. <a href="javascript:history.back()">Вернитесь</a>, обновите страницу и попробуйте ещё раз.</p>', 400);
    }
  }
  if (p === '/admin' ) return ctx.redirect('/admin/leads');
  if (p === '/admin/logout' && form) { ctx.session = {}; ctx.sessionDirty = true; return ctx.redirect('/admin/login'); }
  if (p === '/admin/leads') return adminLeads(ctx, form);
  if (p === '/admin/leads.csv') return adminLeadsCsv(ctx);
  if (p === '/admin/password') return adminPassword(ctx, form);
  if (p === '/admin/program') return adminProgram(ctx, form);
  if (p === '/admin/athletes') return adminAthletes(ctx, form);
  let m;
  if ((m = /^\/admin\/settings\/(\d+)$/.exec(p))) return adminSettings(ctx, Number(m[1]), form);
  if ((m = /^\/admin\/program\/(\d+)$/.exec(p))) return adminProgramEdit(ctx, Number(m[1]), form);
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
    if (p === '/program' && (req.method === 'GET' || req.method === 'HEAD')) return await pageProgram(ctx);
    if (p === '/program/done' && req.method === 'POST') return await postWodDone(ctx);
    if (p === '/program/rating' && req.method === 'GET') return await pageRating(ctx);
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
      return ctx.text(`User-agent: *\nDisallow: /admin\nDisallow: /lead\nSitemap: ${SITE_URL}sitemap.xml\n`);
    }
    if (p === '/sitemap.xml') {
      const r = SITE_URL;
      const urls = [['', '1.0', 'weekly'], ['program', '0.8', 'daily'], ['privacy', '0.2', 'yearly'], ['consent', '0.2', 'yearly'], ['requisites', '0.2', 'yearly']];
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
  await purgeOldLeads();
  setInterval(purgeOldLeads, 24 * 3600 * 1000).unref();
  const port = Number(process.env.PORT || 3000);
  http.createServer(handle).listen(port, '0.0.0.0', () => console.log(`CF BAZA: http://localhost:${port}  (база: ${db.kind})`));
}

if (require.main === module) {
  main().catch((err) => { console.error('Не удалось запустить сайт:', err); process.exit(1); });
}

module.exports = { handle, init, db };
