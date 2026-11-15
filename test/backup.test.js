'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../lib/backup');

function emptyDump() {
  return {
    app: 'cfbaza-site',
    version: 1,
    created: '2026-11-16T00:00:00.000Z',
    tables: Object.fromEntries(backup.TABLES.map(table => [table, []])),
  };
}

test('restore preview can run inside a caller-owned transaction without committing it', async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: [], rowCount: 0 }; } };
  await backup.restore(client, emptyDump(), { manageTransaction: false });
  assert.equal(calls.some(sql => sql === 'BEGIN'), false);
  assert.equal(calls.some(sql => sql === 'COMMIT'), false);
  assert.equal(calls.some(sql => sql.startsWith('TRUNCATE ')), true);
  assert.equal(calls.some(sql => sql === 'INSERT INTO settings(key,value) VALUES ($1,$2)'), true);
});

test('normal restore owns and commits its transaction', async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: [], rowCount: 0 }; } };
  await backup.restore(client, emptyDump());
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls[calls.length - 1], 'COMMIT');
});

test('restore rejects a snapshot for a different application before SQL is issued', async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: [], rowCount: 0 }; } };
  const dump = emptyDump();
  dump.app = 'record-site';
  await assert.rejects(backup.restore(client, dump));
  assert.equal(calls.length, 0);
});
