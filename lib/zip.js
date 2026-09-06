'use strict';
/* ============================================================================
   خواندن و ساختن فایل ZIP — فقط با zlib داخلی Node
   ---------------------------------------------------------------------------
   فایل xlsx یک بسته ZIP از چند سند XML است. برای اینکه سامانه هیچ پکیج
   خارجی نخواهد (شرط اصلی معماری)، لایه ZIP را خودمان می‌نویسیم.
   فقط دو روش ذخیره پشتیبانی می‌شود: 0 (بدون فشرده‌سازی) و 8 (deflate) —
   همان دو تایی که Excel و openpyxl و همه ابزارهای رایج تولید می‌کنند.
   ========================================================================== */
const zlib = require('zlib');

/* جدول CRC-32، یک بار ساخته می‌شود */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf){
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

/**
 * محتوای یک بسته ZIP را به نگاشت «نام → Buffer» تبدیل می‌کند.
 * از فهرست مرکزی خوانده می‌شود، نه از سرآیندهای محلی، چون فهرست مرکزی
 * مرجع رسمی است و اندازه‌ها در سرآیند محلی ممکن است صفر باشند.
 */
function read(buf){
  /* پایان فهرست مرکزی از انتها پیدا می‌شود؛ ۲۲ بایت ثابت + حداکثر ۶۵۵۳۵ توضیح */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--){
    if (buf.readUInt32LE(i) === SIG_EOCD){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('فایل ZIP معتبر نیست: انتهای فهرست مرکزی پیدا نشد.');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let i = 0; i < count; i++){
    if (buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new Error('فایل ZIP خراب است: سرآیند فهرست مرکزی نامعتبر.');
    const method   = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen  = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen   = buf.readUInt16LE(p + 32);
    const offset   = buf.readUInt32LE(p + 42);
    const name     = buf.toString('utf8', p + 46, p + 46 + nameLen);

    /* اندازه سرآیند محلی متغیر است، پس باید همان‌جا خوانده شود */
    if (buf.readUInt32LE(offset) !== SIG_LOCAL)
      throw new Error('فایل ZIP خراب است: سرآیند محلی نامعتبر.');
    const lNameLen  = buf.readUInt16LE(offset + 26);
    const lExtraLen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);

    if (!name.endsWith('/'))
      out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));

    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

/**
 * فهرستی از { name, data } را به یک بسته ZIP تبدیل می‌کند.
 * زمان همه ورودی‌ها ثابت گذاشته می‌شود تا خروجی برای داده یکسان،
 * بایت‌به‌بایت یکسان باشد — که آزمون را قطعی می‌کند.
 */
function write(entries){
  const DOS_TIME = 0, DOS_DATE = 0x21;   // ۱۹۸۰-۰۱-۰۱
  const locals = [], centrals = [];
  let offset = 0;

  for (const { name, data } of entries){
    const nameBuf = Buffer.from(name, 'utf8');
    const body    = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const packed  = zlib.deflateRawSync(body, { level: 9 });
    const crc     = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);            // نسخه لازم برای باز کردن
    local.writeUInt16LE(0x0800, 6);        // پرچم: نام فایل UTF-8 است
    local.writeUInt16LE(8, 8);             // روش: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);          // نسخه سازنده
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const cd     = Buffer.concat(centrals);
  const eocd   = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

module.exports = { read, write, crc32 };
