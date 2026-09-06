'use strict';
/* ============================================================================
   خواندن و ساختن فایل xlsx — فقط با zip.js و بدون هیچ پکیج
   ---------------------------------------------------------------------------
   xlsx یک بسته ZIP از چند سند XML است. برای خواندن، دو سند لازم است:
     xl/worksheets/sheet1.xml  — سلول‌ها با ارجاع به رشته‌های مشترک
     xl/sharedStrings.xml      — متن‌ها (سلول‌های متنی مقدارشان شماره است)
   برای نوشتن، حداقلِ اسنادی که Excel و LibreOffice می‌پذیرند تولید می‌شود.
   ========================================================================== */
const zip = require('./zip');

/* ---------- کمکی XML ------------------------------------------------------- */
function xmlEscape(s){
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
}
function xmlUnescape(s){
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');           // آخر، تا &amp;lt; درست شود
}

/* ستون A1 → شماره ستون صفر-مبنا */
function colOf(ref){
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function colName(i){
  let s = '';
  i += 1;
  while (i > 0){ const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - r - 1) / 26; }
  return s;
}

/* ---------- خواندن -------------------------------------------------------- */
/** برمی‌گرداند: آرایه‌ای از سطرها، هر سطر آرایه‌ای از رشته‌ها (سلول خالی = '') */
function readSheet(buf){
  const files = zip.read(buf);

  const sheetName = [...files.keys()].find(n => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
                 || [...files.keys()].find(n => /^xl\/worksheets\/.*\.xml$/i.test(n));
  if (!sheetName) throw new Error('این فایل یک کاربرگ اکسل معتبر نیست.');
  const sheet = files.get(sheetName).toString('utf8');

  /* رشته‌های مشترک */
  const shared = [];
  const ssFile = [...files.keys()].find(n => /^xl\/sharedStrings\.xml$/i.test(n));
  if (ssFile){
    const ss = files.get(ssFile).toString('utf8');
    /* هر <si> ممکن است چند <t> داشته باشد (متن با قالب‌بندی جزئی) */
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []){
      const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      shared.push(parts.map(t => xmlUnescape(t.replace(/<t[^>]*>/, '').replace(/<\/t>/, ''))).join(''));
    }
  }

  const rows = [];
  for (const rowXml of sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []){
    const cells = [];
    let maxCol = -1;
    for (const c of rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) || []){
      const ref  = (/r="([A-Z]+\d+)"/.exec(c) || [])[1] || '';
      const type = (/t="([^"]+)"/.exec(c) || [])[1] || 'n';
      const col  = ref ? colOf(ref) : maxCol + 1;
      let val = '';
      const vm = /<v[^>]*>([\s\S]*?)<\/v>/.exec(c);
      const im = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(c);
      if (type === 's' && vm)      val = shared[+vm[1]] ?? '';        // ارجاع به رشته مشترک
      else if (type === 'inlineStr' && im) val = xmlUnescape(im[1]);  // رشته درون‌خطی
      else if (vm)                 val = xmlUnescape(vm[1]);          // عدد یا بولی
      cells[col] = val;
      if (col > maxCol) maxCol = col;
    }
    for (let i = 0; i <= maxCol; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/* ---------- نوشتن --------------------------------------------------------- */
/** rows: آرایه‌ای از آرایه‌های مقدار. اعداد به‌صورت عدد، بقیه رشته. */
function writeSheet(rows, { sheetName = 'قراردادها', rtl = true } = {}){
  const strings = [];
  const stringIndex = new Map();
  const intern = s => {
    if (stringIndex.has(s)) return stringIndex.get(s);
    const i = strings.length;
    strings.push(s); stringIndex.set(s, i);
    return i;
  };

  let sheetData = '';
  rows.forEach((row, r) => {
    let cells = '';
    row.forEach((val, c) => {
      if (val === null || val === undefined || val === '') return;
      const ref = colName(c) + (r + 1);
      if (typeof val === 'number' && Number.isFinite(val)){
        cells += `<c r="${ref}"><v>${val}</v></c>`;
      } else {
        cells += `<c r="${ref}" t="s"><v>${intern(String(val))}</v></c>`;
      }
    });
    sheetData += `<row r="${r + 1}">${cells}</row>`;
  });

  const cols = rows.length ? Math.max(...rows.map(r => r.length)) : 1;
  const dim = `A1:${colName(Math.max(cols - 1, 0))}${Math.max(rows.length, 1)}`;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dim}"/>` +
    `<sheetViews><sheetView${rtl ? ' rightToLeft="1"' : ''} tabSelected="1" workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetData>${sheetData}</sheetData></worksheet>`;

  const sst =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${strings.length}" uniqueCount="${strings.length}">` +
    strings.map(s => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('') +
    `</sst>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`;

  return zip.write([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/sharedStrings.xml', data: sst }
  ]);
}

module.exports = { readSheet, writeSheet, colName, colOf };
