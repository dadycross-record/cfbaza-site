'use strict';
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

// Compare-and-swap counts attempts and consumes credentials across all processes.
async function consumeLogin(db, { code, token, allowed }) {
  for (let retry = 0; retry < 20; retry++) {
    const row = await db.get("SELECT value FROM settings WHERE key='_login_code'");
    const st = row ? JSON.parse(row.value || '{}') : {};
    if (!st.exp || Date.now() >= st.exp || (!st.code && !st.link)) return 'expired';
    if (!token && (st.tries || 0) >= 10) return 'limited';
    const good = token ? st.link === sha(token) : allowed && /^\d{6}$/.test(code || '') && st.code === sha(code);
    if (token && !good) return 'invalid';
    const next = good ? '{}' : JSON.stringify({ ...st, tries: (st.tries || 0) + 1 });
    const result = await db.run("UPDATE settings SET value=$1 WHERE key='_login_code' AND value=$2 RETURNING key", [next, row.value]);
    if (result.changes === 1) return good ? 'ok' : 'invalid';
  }
  return 'limited';
}
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
async function durableLimit(db, key, max, windowMs) {
  key = '_security_rate_' + key;
  await db.run('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING', [key, '[]']);
  for (let retry = 0; retry < 20; retry++) {
    const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
    const now = Date.now();
    const hits = JSON.parse(row.value).filter(t => now - t < windowMs);
    if (hits.length >= max) return true;
    hits.push(now);
    const r = await db.run('UPDATE settings SET value=$1 WHERE key=$2 AND value=$3 RETURNING key', [JSON.stringify(hits), key, row.value]);
    if (r.changes === 1) return false;
  }
  return true;
}
module.exports = { consumeLogin, csvCell, durableLimit };
