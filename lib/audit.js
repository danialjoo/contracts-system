'use strict';
/* ============================================================================
   ثبت تغییرات کاربران — زنجیره درهم‌سازی
   ---------------------------------------------------------------------------
   در بانک داده مشتریان، audit.jsonl یک فایل متنی ساده است؛ هرکس به سرور
   دسترسی داشته باشد می‌تواند سطری را پاک کند و ردی نماند.

   اینجا هر سطر، درهم‌سازی سطر پیش از خود را با خود حمل می‌کند:

       hash(n) = SHA256( hash(n-1) + محتوای سطر n )

   حذف یا تغییر هر سطر، زنجیره را از همان‌جا به بعد می‌شکند و
   `verifyChain()` دقیقاً می‌گوید از کدام سطر خراب شده است.

   این جلوی دستکاری را نمی‌گیرد — هیچ فایلی روی سرورِ در اختیارِ مهاجم امن
   نیست — اما دستکاری را از «نامرئی» به «قابل اثبات» تبدیل می‌کند. برای
   ممیزی، تشخیص‌پذیری همان چیزی است که ارزش دارد.
   ========================================================================== */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const store  = require('./store');

const FILE   = path.join(store.DATA_DIR, 'audit.jsonl');
const GENESIS = '0'.repeat(64);

/* نام فارسی فیلدها، برای نمایش در صفحه ممیزی */
const FIELD_FA = {
  section: 'بخش', kind: 'نوع سند', number: 'شماره قرارداد', party: 'طرف قرارداد',
  subject: 'موضوع', unit: 'واحد مربوطه', numberedOn: 'تاریخ شماره‌گذاری',
  start: 'تاریخ شروع', end: 'تاریخ پایان', duration: 'مدت', amount: 'مبلغ',
  guarantees: 'تضامین', people: 'عوامل طرف قرارداد', site: 'ساختگاه/محل اجرا',
  capacity: 'ظرفیت', storage: 'محل نگهداری اصل', addendum: 'الحاقیه',
  scanLink: 'لینک اسکن', notes: 'سایر موارد',
  role: 'نقش', active: 'فعال', sections: 'بخش‌های مجاز', name: 'نام و نام خانوادگی'
};

const ACTION_FA = {
  login: 'ورود', login_failed: 'ورود ناموفق', logout: 'خروج',
  password_changed: 'تغییر رمز عبور',
  contract_created: 'ثبت قرارداد', contract_updated: 'ویرایش قرارداد',
  contract_deleted: 'حذف قرارداد', contract_restored: 'بازیابی قرارداد',
  attachment_added: 'افزودن پیوست', attachment_deleted: 'حذف پیوست',
  attachment_viewed: 'مشاهده پیوست',
  excel_imported: 'درون‌ریزی اکسل', excel_exported: 'خروجی اکسل',
  user_created: 'ایجاد کاربر', user_updated: 'ویرایش کاربر',
  access_denied: 'تلاش برای دسترسی غیرمجاز'
};

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

/* آخرین درهم‌سازی، تا برای هر نوشتن کل فایل خوانده نشود */
let lastHash = null;

function tail(){
  if (lastHash !== null) return lastHash;
  lastHash = GENESIS;
  if (fs.existsSync(FILE)){
    const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    if (lines.length){
      try { lastHash = JSON.parse(lines[lines.length - 1]).h || GENESIS; } catch (_) {}
    }
  }
  return lastHash;
}

/* هر مقدار به متن قابل مقایسه تبدیل می‌شود؛ null یعنی «نبود» */
function norm(v){
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  if (Array.isArray(v)) return v.length ? v.join('، ') : null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** فقط فیلدهایی که واقعاً عوض شده‌اند برگردانده می‌شوند */
function diff(before, after, fields){
  const out = [];
  for (const f of fields){
    if (!(f in after)) continue;
    const o = norm(before[f]), n = norm(after[f]);
    if (o !== n) out.push({ field: f, old: o, new: n });
  }
  return out;
}

/**
 * یک یا چند رکورد ممیزی می‌نویسد. نوشتن هم‌زمان با تغییر داده انجام می‌شود
 * (فراخوان مسئول است پیش از پاسخ دادن، این را صدا بزند).
 */
function record({ actor, action, entity = '', entityId = null, summary = '',
                  changes = null, ip = '', agent = '' }){
  const base = {
    at: new Date().toISOString(),
    user: actor ? actor.username : '',
    userId: actor ? actor.id : null,
    action, entity,
    entityId: entityId === null ? null : String(entityId),
    summary, ip: String(ip).slice(0, 64), agent: String(agent).slice(0, 300)
  };
  const rows = (changes && changes.length)
    ? changes.map(c => Object.assign({}, base, { field: c.field, old: c.old, new: c.new }))
    : [base];

  let text = '';
  for (const row of rows){
    const body = JSON.stringify(row);
    const h = sha256(tail() + body);
    lastHash = h;
    text += JSON.stringify(Object.assign({ h }, row)) + '\n';
  }
  /* appendFileSync با پرچم 'a' اتمیک است برای نوشتن‌های کوچک‌تر از PIPE_BUF،
     و چون سرور تک‌نمونه است (قفل store) رقابتی هم در کار نیست. */
  fs.appendFileSync(FILE, text, 'utf8');
}

/** خواندن با فیلتر. جدیدترین اول. */
function query({ user = '', action = '', entityId = '', since = '', until = '',
                 limit = 200, offset = 0 } = {}){
  if (!fs.existsSync(FILE)) return { items: [], total: 0 };
  const rows = [];
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')){
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch (_) { continue; }
    if (user && r.user !== user) continue;
    if (action && r.action !== action) continue;
    if (entityId && r.entityId !== String(entityId)) continue;
    if (since && r.at < since) continue;
    if (until && r.at > until) continue;
    rows.push(r);
  }
  rows.reverse();
  return {
    total: rows.length,
    items: rows.slice(offset, offset + limit).map(r => Object.assign({}, r, {
      actionFa: ACTION_FA[r.action] || r.action,
      fieldFa: r.field ? (FIELD_FA[r.field] || r.field) : null
    }))
  };
}

/**
 * درستی زنجیره را از ابتدا بررسی می‌کند.
 * خروجی: { ok, lines, brokenAt } — brokenAt شماره اولین سطر خراب است.
 */
function verifyChain(){
  if (!fs.existsSync(FILE)) return { ok: true, lines: 0, brokenAt: null };
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++){
    let row; try { row = JSON.parse(lines[i]); } catch (_) { return { ok:false, lines:lines.length, brokenAt:i+1 }; }
    const { h } = row;
    const body = JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'h')));
    if (h !== sha256(prev + body)) return { ok: false, lines: lines.length, brokenAt: i + 1 };
    prev = h;
  }
  return { ok: true, lines: lines.length, brokenAt: null };
}

module.exports = { record, query, diff, verifyChain, FIELD_FA, ACTION_FA, FILE };
