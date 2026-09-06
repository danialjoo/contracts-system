'use strict';
/* ============================================================================
   منطق دامنه قرارداد — فیلدها، نگاشت اکسل، محاسبه‌ها، اعتبارسنجی
   ---------------------------------------------------------------------------
   پوشش کامل ۲۴ ستون فایل اکسل موجود شرکت، به‌اضافه «بخش» که مرز دسترسی است.
   ========================================================================== */
const jalali = require('./jalali');

const KIND_FA = { contract: 'قرارداد', mou: 'تفاهم‌نامه' };
const STATUS_FA = { live: 'جاری', soon: 'رو به انقضا', over: 'منقضی', unknown: 'نامشخص' };
const EXPIRING_DAYS = 90;

/* فیلدهای متنی قرارداد و برچسب فارسی‌شان — همان ترتیب فرم و ممیزی */
const TEXT_FIELDS = [
  'number', 'party', 'subject', 'unit', 'duration',
  'guarantees', 'people', 'site', 'capacity', 'storage', 'addendum', 'scanLink', 'notes'
];
const DATE_FIELDS = ['numberedOn', 'start', 'end'];
const AUDIT_FIELDS = ['section', 'kind', ...TEXT_FIELDS, ...DATE_FIELDS, 'amount'];

/* ---------- نگاشت سرستون اکسل → فیلد --------------------------------------
   ترتیب مهم است و از «خاص» به «عام» چیده شده: «عوامل طرف قرارداد» زیررشته
   «طرف قرارداد» را دارد، پس باید زودتر بررسی شود. */
const HEADER_MAP = [
  ['people',    ['عوامل']],
  ['storage',   ['محل نگهداری']],
  ['scanLink',  ['لینک اسکن']],
  ['numberedOn',['تاریخ شماره گذاری']],
  ['start',     ['تاریخ شروع']],
  ['end',       ['تاریخ پایان']],
  ['kind',      ['تفاهم نامه/قرارداد', 'نوع سند', 'نوع']],
  ['number',    ['شماره قرارداد', 'شماره تفاهم']],
  ['party',     ['طرف قرارداد']],
  ['site',      ['ساختگاه', 'محل اجرا', 'مکان']],
  ['unit',      ['واحد مربوطه', 'واحد']],
  ['duration',  ['مدت قرارداد', 'مدت تفاهم', 'مدت']],
  ['amount',    ['مبلغ']],
  ['subject',   ['موضوع']],
  ['guarantees',['تضامین', 'تضمین']],
  ['capacity',  ['ظرفیت']],
  ['addendum',  ['الحاقیه']],
  ['notes',     ['سایر موارد', 'توضیحات']],
  ['section',   ['بخش']]
];
/* ستون‌های محاسباتی که نباید درون‌ریزی شوند */
const SKIP_HEADERS = ['فرمول پایان', 'روزهای باقیمانده', 'روزهای باقی مانده',
                      'مدت زمان سپری شده', 'وضعیت', 'column1', 'پیوست'];

/* همه فاصله‌ها و نیم‌فاصله‌ها حذف می‌شوند تا شکست خط وسط سرستون‌ها مهم نباشد */
const norm = s => String(s == null ? '' : s).replace(/[\s‌\r\n]+/g, '').toLowerCase();

function fieldForHeader(header){
  const h = norm(header);
  if (!h) return null;
  for (const skip of SKIP_HEADERS) if (h.includes(norm(skip))) return null;
  for (const [field, keys] of HEADER_MAP)
    for (const k of keys) if (h.includes(norm(k))) return field;
  return null;
}

/* ---------- مبلغ ----------------------------------------------------------- */
function parseAmount(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const t = jalali.latinDigits(v).replace(/[^\d.]/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/* ---------- محاسبه‌های مشتق (هرگز ذخیره نمی‌شوند) -------------------------- */
function derive(c, todayNum = jalali.todayNumber()){
  const s = c.start && jalali.normalize(c.start);
  const e = c.end   && jalali.normalize(c.end);
  if (!e) return { status:'unknown', daysRemaining:null, daysTotal:null, daysElapsed:null, percent:null };
  const remaining = e.day - todayNum;
  const status = remaining < 0 ? 'over' : (remaining <= EXPIRING_DAYS ? 'soon' : 'live');
  let total = null, elapsed = null, percent = null;
  if (s && e.day > s.day){
    total = e.day - s.day;
    elapsed = Math.min(Math.max(todayNum - s.day, 0), total);
    percent = Math.round(elapsed / total * 100);
  }
  return { status, daysRemaining: remaining, daysTotal: total, daysElapsed: elapsed, percent };
}

/* آنچه به مرورگر می‌رود: قرارداد + فیلدهای محاسبه‌شده + برچسب‌های فارسی */
function toView(c, todayNum){
  const d = derive(c, todayNum);
  return Object.assign({}, c, d, {
    kindFa: KIND_FA[c.kind] || c.kind,
    statusFa: STATUS_FA[d.status]
  });
}

/* ---------- اعتبارسنجی و پاک‌سازی یک قرارداد ورودی ------------------------- */
const SECTION_KEYS = ['technical', 'financial', 'hr'];

function normalizeDatesInto(target, raw){
  /* هر سه تاریخ را نرمال می‌کند؛ خطا و هشدار تبدیل را جمع می‌کند */
  const errors = [], warnings = [];
  for (const f of DATE_FIELDS){
    const input = raw[f];
    if (input === undefined || input === null || String(input).trim() === ''){
      target[f] = ''; continue;
    }
    const got = jalali.normalize(input);
    if (!got){ errors.push(`تاریخ «${input}» قابل خواندن نیست. نمونه درست: ۱۴۰۵/۰۶/۱۵`); target[f] = ''; continue; }
    target[f] = got.jalali;
    if (String(input).trim() !== got.jalali) warnings.push(`تاریخ «${input}» به «${got.jalali}» تبدیل شد.`);
  }
  return { errors, warnings };
}

/**
 * ورودی خام (از فرم یا اکسل) را به یک رکورد تمیز تبدیل می‌کند.
 * خروجی: { value, errors, warnings }
 */
function clean(raw){
  const errors = [], warnings = [];
  const c = {};

  c.section = SECTION_KEYS.includes(raw.section) ? raw.section : null;
  if (!c.section) errors.push('بخش نامعتبر است.');

  let kind = String(raw.kind || '').trim();
  c.kind = kind.includes('تفاهم') || kind === 'mou' ? 'mou' : 'contract';

  for (const f of TEXT_FIELDS) c[f] = String(raw[f] == null ? '' : raw[f]).trim();
  if (!c.number) errors.push('شماره قرارداد الزامی است.');

  /* لینک اسکن: یا http(s)، یا مسیر شبکه ویندوزی، یا خالی */
  if (c.scanLink && !/^(https?:\/\/|\\\\|\/)/.test(c.scanLink))
    errors.push('لینک اسکن باید با http://، https:// یا مسیر شبکه شروع شود.');

  c.amount = parseAmount(raw.amount);

  const dr = normalizeDatesInto(c, raw);
  errors.push(...dr.errors); warnings.push(...dr.warnings);

  if (c.start && c.end){
    const s = jalali.normalize(c.start), e = jalali.normalize(c.end);
    if (s && e && e.day < s.day) errors.push('تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.');
  }
  return { value: c, errors, warnings };
}

/* ---------- خواندن سطرهای اکسل به رکوردهای خام ---------------------------- */
/** خروجی: { records: [{...raw, _row}], errors } — بدون ثبت، فقط تفسیر */
function parseRows(rows){
  const errors = [];
  if (!rows.length) return { records: [], errors: ['فایل خالی است.'] };
  const headers = rows[0];
  const fields = headers.map(fieldForHeader);
  if (!fields.some(Boolean))
    return { records: [], errors: ['سرستون‌های فایل شناسایی نشد. از قالب استاندارد سامانه استفاده کنید.'] };

  const records = [];
  for (let i = 1; i < rows.length; i++){
    const cells = rows[i];
    if (!cells.some(v => String(v).trim() !== '')) continue;   // سطر کاملاً خالی
    const rec = { _row: i + 1 };
    fields.forEach((f, c) => { if (f) rec[f] = cells[c]; });
    const number = String(rec.number || '').trim();
    if (!number){ errors.push(`سطر ${i + 1}: شماره قرارداد خالی است.`); continue; }
    records.push(rec);
  }
  return { records, errors };
}

/* ستون‌های خروجی اکسل — همان ترتیب آشنای فایل شرکت، به‌اضافه بخش */
const EXPORT_COLUMNS = [
  ['row', 'ردیف'], ['section', 'بخش'], ['storage', 'محل نگهداری'],
  ['kind', 'تفاهم نامه/قرارداد'], ['party', 'طرف قرارداد'],
  ['scanLink', 'لینک اسکن اصل قرارداد/ تفاهم نامه'], ['addendum', 'الحاقیه'],
  ['unit', 'واحد مربوطه'], ['number', 'شماره قرارداد/شماره تفاهم نامه'],
  ['numberedOn', 'تاریخ شماره گذاری قرارداد'], ['start', 'تاریخ شروع قرارداد/ تاریخ شروع تفاهم نامه'],
  ['duration', 'مدت قرارداد/مدت تفاهم نامه'], ['end', 'تاریخ پایان قرارداد/ تاریخ پایان تفاهم نامه'],
  ['statusFa', 'وضعیت'], ['daysRemaining', 'روزهای باقیمانده'], ['daysElapsed', 'مدت زمان سپری شده'],
  ['subject', 'موضوع قرارداد'], ['amount', 'مبلغ قرارداد/مبلغ تامین مالی/ ریال'],
  ['guarantees', 'تضامین قرارداد'], ['people', 'عوامل طرف قرارداد'],
  ['site', 'ساختگاه/ مکان/ محل اجرا'], ['capacity', 'ظرفیت'], ['notes', 'سایر موارد']
];
const SECTION_FA = { technical: 'فنی', financial: 'امور مالی', hr: 'منابع انسانی' };

function toExportRows(contracts, todayNum){
  const out = [EXPORT_COLUMNS.map(([, label]) => label)];
  contracts.forEach((c, i) => {
    const v = toView(c, todayNum);
    out.push(EXPORT_COLUMNS.map(([key]) => {
      if (key === 'row') return i + 1;
      if (key === 'section') return SECTION_FA[c.section] || c.section;
      if (key === 'kind') return KIND_FA[c.kind] || c.kind;
      if (key === 'amount') return c.amount || 0;
      if (key === 'daysRemaining' || key === 'daysElapsed') { const n = v[key]; return n == null ? '' : n; }
      return v[key] == null ? '' : v[key];
    }));
  });
  return out;
}

module.exports = {
  KIND_FA, STATUS_FA, SECTION_FA, SECTION_KEYS, EXPIRING_DAYS,
  TEXT_FIELDS, DATE_FIELDS, AUDIT_FIELDS,
  fieldForHeader, parseAmount, derive, toView, clean, parseRows,
  EXPORT_COLUMNS, toExportRows
};
