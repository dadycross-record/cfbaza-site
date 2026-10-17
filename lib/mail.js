'use strict';
/**
 * Отправка писем через SMTP без сторонних библиотек.
 * Порт 465 — сразу TLS (Яндекс, Mail.ru), порт 587 — STARTTLS.
 */
const net = require('net');
const tls = require('tls');

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }
function encHeader(s) { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }

function smtpSession(socket) {
  let buf = '';
  let waiter = null;
  const lines = [];
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) !== -1) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
    flush();
  };
  function flush() {
    // ответ закончен, когда в строке после кода стоит пробел ("250 OK"), а не дефис ("250-...")
    const end = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end !== -1 && waiter) {
      const resp = lines.splice(0, end + 1);
      const w = waiter; waiter = null;
      w.resolve({ code: Number(resp[resp.length - 1].slice(0, 3)), text: resp.join('\n') });
    }
  }
  socket.on('data', onData);
  return {
    read(expect) {
      return new Promise((resolve, reject) => {
        waiter = {
          resolve: (r) => (expect && !expect.includes(r.code) ? reject(new Error('SMTP: ' + r.text)) : resolve(r)),
        };
        socket.once('error', reject);
        flush();
      });
    },
    async cmd(line, expect) { socket.write(line + '\r\n'); return this.read(expect); },
    detach() { socket.removeListener('data', onData); },
  };
}

function connect(opts) {
  return new Promise((resolve, reject) => {
    const s = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host, rejectUnauthorized: opts.rejectUnauthorized !== false }, () => resolve(s))
      : net.connect({ host: opts.host, port: opts.port }, () => resolve(s));
    s.setTimeout(20000, () => s.destroy(new Error('SMTP timeout')));
    s.once('error', reject);
  });
}

/**
 * sendMail({host, port, user, pass, from, to: [..], subject, text})
 */
async function sendMail(o) {
  const port = Number(o.port || 465);
  const implicitTls = o.secure !== undefined ? !!o.secure : port === 465;
  let socket = await connect({ host: o.host, port, secure: implicitTls, rejectUnauthorized: o.rejectUnauthorized });
  let s = smtpSession(socket);
  await s.read([220]);
  await s.cmd('EHLO cf-baza.ru', [250]);
  if (!implicitTls) {
    await s.cmd('STARTTLS', [220]);
    s.detach();
    socket = await new Promise((resolve, reject) => {
      const t = tls.connect({ socket, servername: o.host, rejectUnauthorized: o.rejectUnauthorized !== false }, () => resolve(t));
      t.once('error', reject);
    });
    s = smtpSession(socket);
    await s.cmd('EHLO cf-baza.ru', [250]);
  }
  await s.cmd('AUTH LOGIN', [334]);
  await s.cmd(b64(o.user), [334]);
  await s.cmd(b64(o.pass), [235]);
  await s.cmd(`MAIL FROM:<${o.user}>`, [250]);
  for (const r of o.to) await s.cmd(`RCPT TO:<${r}>`, [250, 251]);
  await s.cmd('DATA', [354]);
  const body = b64(o.text).replace(/.{1,76}/g, '$&\r\n');
  const msg = [
    `From: ${encHeader(o.fromName || 'Сайт CF BAZA')} <${o.user}>`,
    `To: ${o.to.join(', ')}`,
    `Subject: ${encHeader(o.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@cf-baza.ru>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
  socket.write(msg + '\r\n.\r\n');
  await s.read([250]);
  try { await s.cmd('QUIT'); } catch { /* сервер мог закрыть сразу */ }
  socket.end();
}

module.exports = { sendMail };
