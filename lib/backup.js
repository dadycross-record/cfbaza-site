'use strict';
const zlib = require('zlib');
const crypto = require('crypto');
const TABLES = ['settings', 'items', 'leads', 'files', 'wods', 'athletes', 'clients', 'crm_log', 'wod_done'];
const SERIAL = ['items', 'leads', 'wods', 'athletes', 'clients', 'crm_log'];

async function snapshot(db) {
  const tables = await db.snapshot(TABLES);
  // A downloaded backup must not preserve pending login credentials.
  tables.settings = tables.settings.filter(r => r.key !== '_login_code');
  return zlib.gzipSync(JSON.stringify({ app: 'cfbaza-site', version: 1, created: new Date().toISOString(), tables }));
}
function validate(dump) {
  if (!dump || dump.app !== 'cfbaza-site' || dump.version !== 1 || !dump.tables) throw new Error('Неизвестный формат копии');
  for (const table of TABLES) {
    if (!Array.isArray(dump.tables[table])) throw new Error(`В копии нет таблицы ${table}`);
    for (const row of dump.tables[table]) {
      if (!row || Array.isArray(row) || typeof row !== 'object' || !Object.keys(row).length || Object.keys(row).some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) throw new Error(`Повреждённая строка в ${table}`);
      if (table === 'files' && (!row.data || row.data.type !== 'Buffer' || !Array.isArray(row.data.data) || row.data.data.some(b => !Number.isInteger(b) || b < 0 || b > 255))) throw new Error('Повреждённый файл в копии');
    }
  }
  return dump;
}
async function restore(client, dump) {
  validate(dump);
  await client.query('BEGIN');
  try {
    await client.query(`TRUNCATE ${[...TABLES].reverse().map(t => `"${t}"`).join(', ')} RESTART IDENTITY`);
    for (const table of TABLES) {
      for (const row of dump.tables[table]) {
        if (table === 'settings' && ['_login_code', '_secret', '_admin_ver'].includes(row.key)) continue;
        const cols = Object.keys(row);
        const values = cols.map(c => table === 'files' && c === 'data' ? Buffer.from(row[c].data) : row[c]);
        await client.query(`INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, values);
      }
      if (SERIAL.includes(table)) await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), greatest(coalesce((SELECT max(id) FROM "${table}"), 0), 1), exists(SELECT 1 FROM "${table}"))`);
    }
    for (const key of ['_secret', '_admin_ver']) await client.query('INSERT INTO settings(key,value) VALUES ($1,$2)', [key, crypto.randomBytes(32).toString('hex')]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
}
module.exports = { TABLES, snapshot, validate, restore };
