'use strict';
/* ============================================================================
   لایه ذخیره‌سازی — فایل JSON با نوشتن اتمیک و صف نوشتن تک‌نخی
   ---------------------------------------------------------------------------
   هم‌الگو با بانک داده مشتریان، با یک افزوده: قفل تک‌نمونه.

   چرا فایل و نه پایگاه داده: سرور داخلی است و نباید وابستگی خارجی داشته باشد.
   نصب PostgreSQL روی سرور شرکت یعنی یک تأمین دیگر که در شرایط تحریم گیر می‌کند.

   چهار ضمانتی که این لایه می‌دهد:
     ۱) یک نوشتن ناموفق، نوشتن‌های بعدی را از کار نمی‌اندازد.
     ۲) کش حافظه فقط وقتی عوض می‌شود که داده واقعاً روی دیسک نشسته باشد.
     ۳) تغییر هم‌زمان چند فایل یا کامل انجام می‌شود یا هیچ — با ژورنال.
     ۴) دو نمونهٔ سرور هم‌زمان بالا نمی‌آیند — با قفل انحصاری.
   ========================================================================== */
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const JOURNAL    = path.join(DATA_DIR, 'txn.journal');
const LOCK       = path.join(DATA_DIR, 'server.lock');

for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR])
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const cache = new Map();          // name -> parsed value (همیشه برابر با دیسک)
let chain = Promise.resolve();    // صف نوشتن: همه نوشتن‌ها پشت سر هم اجرا می‌شوند

function file(name){ return path.join(DATA_DIR, name + '.json'); }

/* ---------- قفل تک‌نمونه ---------------------------------------------------
   صف نوشتن فقط درون یک فرایند کار می‌کند. اگر کسی هم‌زمان start.bat را بزند و
   کار زمان‌بندی‌شده هم اجرا شود، دو فرایند روی یک فایل می‌نویسند و داده خراب
   می‌شود. فایل قفل با پرچم 'wx' ساخته می‌شود که اگر از قبل باشد خطا می‌دهد. */
function acquireLock(){
  try {
    const fd = fs.openSync(LOCK, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    fs.closeSync(fd);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    /* قفل هست؛ ببینیم صاحبش هنوز زنده است یا از یک سقوط جا مانده */
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (_) {}
    if (owner && owner.pid && isAlive(owner.pid))
      throw new Error(
        `یک نمونه دیگر از سامانه با شناسه فرایند ${owner.pid} در حال اجراست.\n` +
        `دو نمونه هم‌زمان داده را خراب می‌کنند. اول آن را ببندید.`);
    fs.unlinkSync(LOCK);           // قفل یتیم از اجرای قبلی که درست بسته نشده
    return acquireLock();
  }
  const release = () => { try { fs.unlinkSync(LOCK); } catch (_) {} };
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(sig, () => { release(); process.exit(0); });
}

function isAlive(pid){
  try { process.kill(pid, 0); return true; }       // سیگنال ۰ فقط وجود را چک می‌کند
  catch (e) { return e.code === 'EPERM'; }         // مال کاربر دیگر است، ولی زنده
}

/* کپی مستقل، تا mutator هرگز به شیء داخل کش دست نزند */
const clone = v => (v === undefined || v === null) ? v
  : (typeof structuredClone === 'function' ? structuredClone(v)
                                           : JSON.parse(JSON.stringify(v)));

/* هرچه در کش می‌نشیند منجمد می‌شود. اگر جایی از کد سهواً روی نتیجهٔ read()
   دست ببرد، به‌جای خرابیِ خاموشِ کش، همان‌جا خطا می‌دهد و پیدا می‌شود. */
function deepFreeze(v){
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

function read(name, fallback){
  if (cache.has(name)) return cache.get(name);
  let v = fallback;
  try {
    if (fs.existsSync(file(name)))
      v = JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch (e) {
    /* فایل خراب: نسخه سالم قبلی را نگه می‌داریم و کنار می‌گذاریم تا بررسی شود */
    console.error(`[store] فایل ${name}.json خوانده نشد:`, e.message);
    const bad = path.join(BACKUP_DIR, `${name}.corrupt.${Date.now()}.json`);
    try { fs.copyFileSync(file(name), bad); } catch (_) {}
    v = fallback;
  }
  cache.set(name, deepFreeze(v));
  return v;
}

/* ---------- نوشتن اتمیک ----------------------------------------------------
   ابتدا در فایل موقت با fsync، سپس rename. rename روی هر دو سیستم‌فایل ویندوز
   و لینوکس اتمیک است، پس فایل نهایی هرگز نیمه‌نوشته دیده نمی‌شود. */
function writeTmp(target, text){
  const tmp = target + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return tmp;
}

function writeSync(name, value){
  const target = file(name);
  fs.renameSync(writeTmp(target, JSON.stringify(value, null, 1)), target);
  cache.set(name, deepFreeze(value));   // فقط پس از نشستن روی دیسک
}

/* mutator روی یک کپی کار می‌کند؛ اگر نوشتن شکست بخورد، کش دست‌نخورده می‌ماند */
function update(name, fallback, mutator){
  const run = chain.then(() => {
    const cur  = clone(read(name, fallback));
    const out  = mutator(cur);
    const next = out === undefined ? cur : out;
    writeSync(name, next);
    return next;
  });
  /* زنجیره هرگز rejected نمی‌ماند، وگرنه یک خطای گذرا همه نوشتن‌های بعدی را
     تا ری‌استارت سرور از کار می‌انداخت. خطا فقط به فراخوان می‌رود. */
  chain = run.then(() => {}, () => {});
  return run;
}

/* ---------- تغییر هماهنگ چند فایل ------------------------------------------
   مثال: ثبت قرارداد هم باید در contracts بنشیند هم رکورد ممیزی‌اش نوشته شود.
   اگر بین این دو برق برود، تغییری بدون ردپا می‌ماند — دقیقاً چیزی که ممیزی
   باید جلویش را بگیرد. با ژورنال، بوت بعدی کار نیمه‌تمام را تمام می‌کند. */
function updateMany(specs){
  const run = chain.then(() => {
    const staged = specs.map(s => {
      const cur = clone(read(s.name, s.fallback));
      const out = s.mutator(cur);
      return { name: s.name, value: out === undefined ? cur : out };
    });
    for (const s of staged) writeTmp(file(s.name), JSON.stringify(s.value, null, 1));
    fs.renameSync(writeTmp(JOURNAL, JSON.stringify({
      at: new Date().toISOString(), names: staged.map(s => s.name) })), JOURNAL);
    for (const s of staged) fs.renameSync(file(s.name) + '.tmp', file(s.name));
    for (const s of staged) cache.set(s.name, deepFreeze(s.value));
    try { fs.unlinkSync(JOURNAL); } catch (_) {}
    return staged.map(s => s.value);
  });
  chain = run.then(() => {}, () => {});
  return run;
}

/* اگر ژورنال نیمه‌تمام مانده باشد، همان اول کار تمامش می‌کنیم */
function recoverJournal(){
  if (!fs.existsSync(JOURNAL)) return;
  let names = [];
  try { names = JSON.parse(fs.readFileSync(JOURNAL, 'utf8')).names || []; } catch (_) {}
  for (const n of names) {
    const tmp = file(n) + '.tmp';
    if (fs.existsSync(tmp)) {
      fs.renameSync(tmp, file(n));
      console.error(`[store] ${n}.json از ژورنال بازیابی شد.`);
    }
  }
  try { fs.unlinkSync(JOURNAL); } catch (_) {}
}

/* پشتیبان روزانه: یک بار در روز، کل پوشه داده در backups/<تاریخ> کپی می‌شود */
function dailyBackup(names){
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(BACKUP_DIR, day);
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names)
    if (fs.existsSync(file(n))) fs.copyFileSync(file(n), path.join(dir, n + '.json'));
  const audit = path.join(DATA_DIR, 'audit.jsonl');
  if (fs.existsSync(audit)) fs.copyFileSync(audit, path.join(dir, 'audit.jsonl'));
}

module.exports = {
  DATA_DIR, UPLOAD_DIR, BACKUP_DIR,
  read, update, updateMany, writeSync, clone,
  acquireLock, recoverJournal, dailyBackup, file
};
