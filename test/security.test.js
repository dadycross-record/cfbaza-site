'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const zlib = require('zlib');
const H = require('../lib/http');
const { csvCell, consumeLogin, durableLimit } = require('../lib/security');
const backup = require('../lib/backup');

test('spreadsheet formulas are neutralized and text quotes are preserved', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '\t=1', '  =1']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('A "quoted" name'), '"A ""quoted"" name"');
});
test('malformed cookies and non-ASCII signatures do not throw', () => {
  assert.deepEqual(H.parseCookies({ headers: { cookie: 'cfb=%ZZ' } }), {});
  assert.deepEqual(H.sessionCodec('test').decode('abc.' + 'я'.repeat(43)), {});
});

test('PostgreSQL: concurrent codes, persistent limits, binary backup and rollback', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /_security_test$/);
  process.env.DATABASE_URL = url.toString();
  const { open } = require('../lib/db');
  const db = open();
  const { Client } = require('pg');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const putCode = st => db.run("INSERT INTO settings(key,value) VALUES ('_login_code',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [JSON.stringify(st)]);
  try {
    await db.exec(db.schema);
    await putCode({ code: sha('123456'), link: sha('token'), exp: Date.now() + 60000, tries: 0 });
    const attempts = await Promise.all(Array.from({ length: 30 }, () => consumeLogin(db, { code: '000000', allowed: true })));
    assert.equal(attempts.filter(x => x === 'invalid').length, 10);
    assert.equal(JSON.parse((await db.get("SELECT value FROM settings WHERE key='_login_code'")).value).tries, 10);
    // Invalid magic links cannot lock out the valid owner.
    assert.equal(await consumeLogin(db, { token: 'wrong' }), 'invalid');
    const links = await Promise.all(Array.from({ length: 10 }, () => consumeLogin(db, { token: 'token' })));
    assert.equal(links.filter(x => x === 'ok').length, 1);
    await putCode({ code: sha('123456'), exp: Date.now() + 60000, tries: 0 });
    const codes = await Promise.all(Array.from({ length: 10 }, () => consumeLogin(db, { code: '123456', allowed: true })));
    assert.equal(codes.filter(x => x === 'ok').length, 1);
    const limits = await Promise.all(Array.from({ length: 20 }, () => durableLimit(db, 'test', 8, 60000)));
    assert.equal(limits.filter(x => !x).length, 8);
    const second = open();
    try { assert.equal(await durableLimit(second, 'test', 8, 60000), true); } finally { await second.close(); }
    await db.run('INSERT INTO files(id,mime,data) VALUES ($1,$2,$3)', ['photo', 'image/png', Buffer.from([0, 1, 128, 255])]);
    await db.run('INSERT INTO clients(id,name) VALUES (17,$1)', ['Test client']);
    const dump = JSON.parse(zlib.gunzipSync(await backup.snapshot(db)));
    assert.equal(dump.tables.settings.some(r => r.key === '_login_code'), false);
    await db.run("UPDATE clients SET name='changed'");
    await backup.restore(client, dump);
    assert.equal((await db.get('SELECT name FROM clients')).name, 'Test client');
    assert.deepEqual((await db.get('SELECT data FROM files')).data, Buffer.from([0, 1, 128, 255]));
    assert.equal((await db.run("INSERT INTO clients(name) VALUES ('next') RETURNING id")).rows[0].id, 18);
    const broken = structuredClone(dump); broken.tables.clients[0].missing_column = 'bad';
    await assert.rejects(backup.restore(client, broken));
    assert.equal((await db.get('SELECT count(*)::int AS n FROM clients')).n, 2);
  } finally { await client.end(); await db.close(); }
});
