'use strict';
/** Обработка загруженных фото: проверка, поворот по EXIF, уменьшение. */
let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const BAD = 'Файл не похож на изображение. Загрузите JPG, PNG или WEBP.';

async function processImage(data, maxSide = 1600) {
  if (sharp) {
    let img;
    let meta;
    try {
      img = sharp(data, { failOn: 'error' }).rotate();
      meta = await sharp(data).metadata();
    } catch { throw new Error(BAD); }
    if (!meta || !meta.width) throw new Error(BAD);
    img = img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
    try {
      if (meta.hasAlpha) return { mime: 'image/png', data: await img.png({ compressionLevel: 9 }).toBuffer() };
      return { mime: 'image/jpeg', data: await img.jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer() };
    } catch { throw new Error(BAD); }
  }
  const mime = sniff(data);
  if (!mime) throw new Error(BAD);
  if (data.length > 5 * 1024 * 1024) throw new Error('Фото больше 5 МБ — уменьшите его перед загрузкой.');
  return { mime, data };
}

module.exports = { processImage, hasSharp: () => !!sharp };
