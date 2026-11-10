'use strict';
// Offline recovery tool. Never invoked by the web server or at deployment.
const fs = require('fs');
const zlib = require('zlib');
const { validate, restore } = require('../lib/backup');
async function main() {
  if (!process.argv[2] || !process.env.DATABASE_URL || process.env.RESTORE_CONFIRM !== 'cfbaza-site') throw new Error('Укажите файл, DATABASE_URL и RESTORE_CONFIRM=cfbaza-site. Восстановление заменяет данные целевой базы.');
  const dump = validate(JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])).toString('utf8')));
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { await restore(client, dump); } finally { await client.end(); }
  console.log('restored from', dump.created);
}
main().catch(err => { console.error('restore failed:', err.message); process.exitCode = 1; });
