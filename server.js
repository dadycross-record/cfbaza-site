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
  if (!existing.has('_admin_hash')) {
    let pwd = process.env.ADMIN_PASSWORD;
    if (!pwd) {
      pwd = crypto.randomBytes(8).toString('base64url');
      console.log(`\n*** Пароль администратора не задан. Сгенерирован: ${pwd}\n*** Логин: admin. Смените пароль в админке.\n`);
    }
    await db.run('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO NOTHING', ['_admin_hash', H.hashPassword(pwd)]);
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
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const to = String(toAddr || '').split(/[,;\s]+/).filter((a) => a.includes('@'));
  if (!user || !pass || !to.length) return;
  sendMail({ host, port: process.env.SMTP_PORT || 465, user, pass, to, subject, text })
    .catch((err) => console.error('Email error:', err.message));
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
    if (this.sessionDirty) {
      this.session._exp = Date.now() + 14 * 24 * 3600 * 1000;
      h['Set-Cookie'] = `cfb=${encodeURIComponent(codec.encode(this.session))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 24 * 3600}${isHttps(this.req) ? '; Secure' : ''}`;
    }
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
    s, root: rootUrl(ctx.req),
    facts: await getItems('fact'), steps: await getItems('step'), whys: await getItems('why'),
    photos: await getItems('photo'), schedule: buildSchedule(slots), usedTypes: new Set(slots.map((x) => x.type)),
    coaches: await getItems('coach'), plans: await getItems('plan'), extras: await getItems('extra'),
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
  let m;
  if ((m = /^\/admin\/settings\/(\d+)$/.exec(p))) return adminSettings(ctx, Number(m[1]), form);
  if ((m = /^\/admin\/c\/([a-z]+)$/.exec(p))) return adminList(ctx, m[1], form);
  if ((m = /^\/admin\/c\/([a-z]+)\/new$/.exec(p))) return adminEdit(ctx, m[1], null, form);
  if ((m = /^\/admin\/c\/([a-z]+)\/(\d+)$/.exec(p))) return adminEdit(ctx, m[1], Number(m[2]), form);
  return notFound(ctx);
}

async function handle(req, res) {
  const ctx = new Ctx(req, res);
  const p = ctx.path;
  try {
    if (p.startsWith('/static/')) return await serveStatic(ctx);
    if (p.startsWith('/uploads/')) return await serveUpload(ctx);
    if (p === '/' && req.method === 'GET') return await pageIndex(ctx);
    if (p === '/lead' && req.method === 'POST') return await postLead(ctx);
    if (p === '/privacy') return ctx.html(V.privacy(await getSettings()));
    if (p === '/healthz') return ctx.text('ok');
    if (p === '/robots.txt') return ctx.text(`User-agent: *\nDisallow: /admin\nSitemap: ${rootUrl(req)}sitemap.xml\n`);
    if (p === '/sitemap.xml') {
      const r = rootUrl(req);
      return ctx.text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${r}</loc></url><url><loc>${r}privacy</loc></url></urlset>`, 200, 'application/xml');
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

async function main() {
  await init();
  const port = Number(process.env.PORT || 3000);
  http.createServer(handle).listen(port, '0.0.0.0', () => console.log(`CF BAZA: http://localhost:${port}  (база: ${db.kind})`));
}

if (require.main === module) {
  main().catch((err) => { console.error('Не удалось запустить сайт:', err); process.exit(1); });
}

module.exports = { handle, init, db };
