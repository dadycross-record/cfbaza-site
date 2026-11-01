'use strict';
/**
 * Программа тренировок: разбор текста тренировки в единый формат,
 * деление вставленного текста по дням и чтение таблиц Excel (.xlsx) и CSV.
 */

const DATE_RE = /^\s*(?:[а-яё]{2,11}[,.]?\s+)?(\d{1,2})[.,/](\d{1,2})(?:[.,/](\d{2,4}))?\.?\s*(?:г\.?)?\s*/i;

// Строки-заголовки блоков: «Сила 25'», «Амрап 15'», «Часть А», «Разминка:» и т. п.
const HEAD_RE = /^(часть\s*[a-zа-я0-9](?![a-zа-яё])|разминк|заминк|сила(?![а-яё])|strength|ам?рап|amrap|[еэe]мом|emom|e\d+m(om)?\b|на время|for time|afap|афап|tabata|табата|скилл|skill|техник|гимнастик|кардио|metcon|меткон|wod(?![a-z])|команд|в пар|\d+\s*(раунд|rounds?|сет)|лимит|time cap|cash[- ]?(in|out)|бонус|accessor|аксессуар|финишер|finisher|интервал|chipper|чиппер|ladder|лесенк)/i;
const REST_RE = /^(отдых|rest)(?![a-zа-яё])/i;

function pad(n) { return String(n).padStart(2, '0'); }

/** Дата из начала строки → 'YYYY-MM-DD' (год берём из подсказки, если его нет). */
function parseDate(line, fallbackYear) {
  const m = DATE_RE.exec(line || '');
  if (!m) return null;
  const d = Number(m[1]); const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : Number(fallbackYear);
  if (y < 100) y += 2000;
  if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y < 2100)) return null;
  const rest = line.slice(m[0].length).trim();
  if (!m[3] && rest) return null; // «10.12 калорий» — это не дата
  return { iso: `${y}-${pad(mo)}-${pad(d)}`, rest };
}

/** Делит текст на тренировки по строкам, которые начинаются с даты. */
function splitByDates(text, defaultDate) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const year = (defaultDate || '').slice(0, 4) || String(new Date().getFullYear());
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const pd = line.length <= 40 ? parseDate(line, year) : null;
    if (pd) {
      if (cur && cur.lines.join('').trim()) out.push(cur);
      cur = { date: pd.iso, lines: pd.rest ? [pd.rest] : [] };
    } else {
      if (!cur) cur = { date: defaultDate, lines: [] };
      cur.lines.push(line);
    }
  }
  if (cur && cur.lines.join('').trim()) out.push(cur);
  return out.map((w) => ({ date: w.date || defaultDate, body: tidy(w.lines.join('\n')) }));
}

function tidy(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Текст тренировки → блоки { title, rows: [{ text, rest }] } для единого оформления. */
function toBlocks(body) {
  const blocks = [];
  let cur = null;
  const push = () => { if (cur && (cur.title || cur.rows.length)) blocks.push(cur); };
  for (const raw of tidy(body).split('\n')) {
    const line = raw.trim().replace(/^[-–—•·*]\s*/, '');
    if (!line) { if (cur && cur.rows.length) { push(); cur = null; } continue; }
    const isHead = line.length <= 48 && (HEAD_RE.test(line) || /:\s*$/.test(line)) && !/^\d+\s*(м|m|кал|cal|повт)/i.test(line);
    if (isHead) { push(); cur = { title: line.replace(/:\s*$/, ''), rows: [] }; continue; }
    if (!cur) cur = { title: '', rows: [] };
    cur.rows.push({ text: line, rest: REST_RE.test(line) });
  }
  push();
  return blocks;
}

/** Краткая подпись: первый заголовок блока или первая строка. */
function summary(body) {
  const b = toBlocks(body);
  const heads = b.map((x) => x.title).filter(Boolean);
  if (heads.length) return heads.slice(0, 3).join(' · ');
  return (tidy(body).split('\n')[0] || '').slice(0, 80);
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) и CSV
// ---------------------------------------------------------------------------
function xmlText(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Первый лист .xlsx → массив строк (массивов ячеек). Даты Excel превращаются в 'YYYY-MM-DD'. */
async function readXlsx(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const xml = await ss.async('string');
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(xmlText((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join('')));
    }
  }
  // стили с форматом даты
  const dateStyles = new Set();
  const st = zip.file('xl/styles.xml');
  if (st) {
    const xml = await st.async('string');
    const custom = {};
    for (const m of xml.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = m[2];
    const xfs = (/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml) || [])[1] || '';
    let i = 0;
    for (const m of xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)) {
      const id = Number(m[1]);
      const code = custom[m[1]] || '';
      if ((id >= 14 && id <= 22) || (/[dy]/i.test(code) && !/\[h\]|h:mm/i.test(code))) dateStyles.add(i);
      i += 1;
    }
  }
  const sheetName = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) return [];
  const xml = await zip.file(sheetName).async('string');
  const rows = [];
  for (const r of xml.match(/<row[\s\S]*?<\/row>/g) || []) {
    const row = [];
    for (const c of r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (/ r="([A-Z]+\d+)"/.exec(c) || [])[1];
      const t = (/ t="(\w+)"/.exec(c) || [])[1];
      const s = Number((/ s="(\d+)"/.exec(c) || [])[1] || -1);
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] || '';
      else if (t === 'inlineStr') val = xmlText((c.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join(''));
      else if (v !== undefined) {
        val = xmlText(v);
        if (dateStyles.has(s) && /^\d+(\.\d+)?$/.test(val)) {
          const d = new Date(Math.round((Number(val) - 25569) * 86400000));
          val = d.toISOString().slice(0, 10);
        }
      }
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? '' : String(x))));
  }
  return rows;
}

function readCsv(buf) {
  let text = buf.toString('utf8').replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Строки таблицы → тренировки. Понимает шапку «Дата | Направление | Тренировка» в любом порядке;
 * без шапки: 1-я колонка — дата, остальные — текст. Строки без даты дописываются к предыдущей тренировке.
 */
function rowsToWods(rows, { defaultDate, defaultTrack, trackOf }) {
  const clean = rows.filter((r) => r.some((c) => String(c).trim()));
  if (!clean.length) return [];
  const head = clean[0].map((c) => String(c).trim().toLowerCase());
  let iDate = head.findIndex((h) => /^(дата|date|день)/.test(h));
  let iTrack = head.findIndex((h) => /(направлен|программ|группа|track|тип)/.test(h));
  let iText = head.findIndex((h) => /(трениров|комплекс|задани|wod|текст|описан)/.test(h));
  let body = clean;
  if (iDate >= 0 || iText >= 0) body = clean.slice(1);
  else { iDate = 0; iTrack = -1; iText = -1; }
  const out = [];
  const year = (defaultDate || '').slice(0, 4);
  for (const r of body) {
    const rawDate = iDate >= 0 ? String(r[iDate] || '').trim() : '';
    let date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : (parseDate(rawDate, year) || {}).iso;
    const textCells = iText >= 0 ? [r[iText]] : r.filter((_, i) => i !== iDate && i !== iTrack);
    const text = tidy(textCells.filter((c) => String(c || '').trim()).join('\n'));
    const track = iTrack >= 0 ? trackOf(String(r[iTrack] || '')) : null;
    if (!date && out.length && !rawDate) { // продолжение предыдущей тренировки
      if (text) out[out.length - 1].body = tidy(out[out.length - 1].body + '\n' + text);
      continue;
    }
    if (!text) continue;
    out.push({ date: date || defaultDate, track: track || defaultTrack, body: text });
  }
  return out;
}

async function readTable(file) {
  const name = String(file.filename || '').toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(file.data);
  if (name.endsWith('.csv') || name.endsWith('.txt')) return readCsv(file.data);
  throw new Error('Таблица должна быть в формате .xlsx или .csv. Файл .xls (старый Excel) сохраните как .xlsx.');
}

module.exports = { splitByDates, toBlocks, summary, tidy, parseDate, readTable, rowsToWods };
