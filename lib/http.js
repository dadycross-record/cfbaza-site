'use strict';
/** Мелкие помощники для HTTP: тело запроса, multipart, cookie-сессия, ответы. */
const crypto = require('crypto');

const MAX_BODY = 15 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Файл слишком большой (максимум 15 МБ).'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buf, boundary) {
  const fields = {};
  const files = {};
  const delim = Buffer.from('--' + boundary);
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    pos += delim.length;
    if (buf.slice(pos, pos + 2).toString() === '--') break;
    pos += 2; // \r\n
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd === -1) break;
    const head = buf.slice(pos, headEnd).toString('utf8');
    const next = buf.indexOf(delim, headEnd + 4);
    if (next === -1) break;
    const body = buf.slice(headEnd + 4, next - 2); // без \r\n перед разделителем
    const name = (/name="([^"]*)"/i.exec(head) || [])[1];
    const filename = (/filename="([^"]*)"/i.exec(head) || [])[1];
    const ctype = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1];
    if (name !== undefined) {
      if (filename !== undefined) {
        if (filename && body.length) files[name] = { filename, type: ctype || '', data: body };
      } else {
        fields[name] = body.toString('utf8');
      }
    }
    pos = next;
  }
  return { fields, files };
}

async function parseForm(req) {
  const type = req.headers['content-type'] || '';
  const buf = await readBody(req);
  if (type.startsWith('multipart/form-data')) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    if (!m) return { fields: {}, files: {} };
    return parseMultipart(buf, m[1] || m[2]);
  }
  const fields = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) fields[k] = v;
  return { fields, files: {} };
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Подписанная cookie-сессия (HMAC-SHA256), как в Flask. */
function sessionCodec(secret) {
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  return {
    decode(raw) {
      if (!raw) return {};
      const [body, sig] = raw.split('.');
      if (!body || !sig) return {};
      const good = sign(body);
      if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return {};
      try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (data._exp && data._exp < Date.now()) return {};
        return data;
      } catch { return {}; }
    },
    encode(data) {
      const body = Buffer.from(JSON.stringify(data)).toString('base64url');
      return body + '.' + sign(body);
    },
  };
}

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(pwd, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(pwd, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { parseForm, parseCookies, sessionCodec, hashPassword, checkPassword };
