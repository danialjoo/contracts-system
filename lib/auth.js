'use strict';
/* ============================================================================
   احراز هویت، نقش‌ها و بخش‌ها — بدون هیچ پکیج خارجی
   ---------------------------------------------------------------------------
   هم‌الگو با بانک داده مشتریان (scrypt + کوکی امضاشده + نقش‌های قابل تعریف)،
   با یک تفاوت مهم:

     نشست اینجا «حالت‌دار» است. توکن فقط شناسه نشست را حمل می‌کند و اعتبارش
     در sessions.json بررسی می‌شود. در بانک داده مشتریان توکن خودبسنده است،
     یعنی وقتی کاربری را غیرفعال می‌کنید تا ۱۲ ساعت با توکن قبلی‌اش کار
     می‌کند. برای قراردادهای محرمانه، قطع دسترسی باید همان لحظه اثر کند.
   ========================================================================== */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const store  = require('./store');

/* ---------- دسترسی‌های قابل تخصیص به نقش‌ها -------------------------------- */
const PERMISSIONS = [
  { key:'view',         label:'مشاهده قراردادها',
    hint:'دیدن فهرست و جزئیات اسناد بخش‌های مجاز' },
  { key:'edit',         label:'ثبت و ویرایش سند',
    hint:'افزودن قرارداد یا تفاهم‌نامه تازه و تغییر اسناد موجود' },
  { key:'delete',       label:'حذف سند',
    hint:'حذف نرم سند؛ رکورد در پایگاه داده می‌ماند و در ممیزی ثبت می‌شود' },
  { key:'upload',       label:'بارگذاری و حذف اسکن',
    hint:'پیوست‌کردن فایل اسکن به اسناد و حذف آن‌ها' },
  { key:'import',       label:'درون‌ریزی از اکسل',
    hint:'ثبت دسته‌ای اسناد از فایل اکسل' },
  { key:'export',       label:'گرفتن خروجی اکسل',
    hint:'دانلود کل اسناد بخش‌های مجاز به‌صورت فایل اکسل — هر بار ثبت می‌شود' },
  { key:'manage_users', label:'مدیریت کاربران و نقش‌ها',
    hint:'ساختن کاربر، تغییر نقش و بخش، و تعریف نقش تازه' },
  { key:'view_audit',   label:'مشاهده ممیزی تغییرات',
    hint:'دیدن تاریخچه کامل تغییرات همه کاربران' }
];
const ALL_PERMS = PERMISSIONS.map(p => p.key);

/* ---------- بخش‌های سامانه — مرز دسترسی، نه برچسب ------------------------- */
const SECTIONS = [
  { key:'technical', label:'فنی' },
  { key:'financial', label:'امور مالی' },
  { key:'hr',        label:'منابع انسانی' }
];
const SECTION_KEYS = SECTIONS.map(s => s.key);
const SECTION_FA = Object.fromEntries(SECTIONS.map(s => [s.key, s.label]));

/* ---------- کلید امضای نشست ----------------------------------------------- */
const SECRET_FILE = path.join(store.DATA_DIR, 'secret');
function secret(){
  if (!fs.existsSync(SECRET_FILE))
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

/* ---------- گذرواژه --------------------------------------------------------
   scrypt با پارامترهای پیشنهادی، نمک اختصاصی برای هر کاربر. */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')){
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64, SCRYPT).toString('hex') };
}
function verifyPassword(pw, salt, hash){
  try {
    const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
    const k = Buffer.from(hash, 'hex');
    return h.length === k.length && crypto.timingSafeEqual(h, k);
  } catch (_) { return false; }
}

/* گذرواژه‌ای که فقط عدد باشد یا کوتاه، در برابر حدس زدن بی‌دفاع است */
const MIN_PASSWORD = 10;
function passwordProblem(pw){
  pw = String(pw || '');
  if (pw.length < MIN_PASSWORD) return `گذرواژه باید دست‌کم ${MIN_PASSWORD} نویسه باشد.`;
  if (/^\d+$/.test(pw))         return 'گذرواژه نباید فقط عدد باشد.';
  if (['password','administrator','1234567890'].includes(pw.toLowerCase()))
    return 'گذرواژه بیش از حد ساده است.';
  return null;
}

/* ---------- نشست حالت‌دار --------------------------------------------------
   کوکی = «شناسه.امضا». امضا جلوی جعل شناسه را می‌گیرد و جدول نشست‌ها
   امکان ابطال فوری را می‌دهد. */
const SESSION_HOURS = 10;

function sign(id){
  const mac = crypto.createHmac('sha256', secret()).update(id).digest('base64url');
  return `${id}.${mac}`;
}
function unsign(token){
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const id = token.slice(0, i), mac = token.slice(i + 1);
  const good = crypto.createHmac('sha256', secret()).update(id).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

const sessions = () => store.read('sessions', {});

async function openSession(userId, ip, agent){
  const id   = crypto.randomBytes(24).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const now  = Date.now();
  await store.update('sessions', {}, s => {
    /* نشست‌های منقضی همین‌جا جارو می‌شوند تا فایل بی‌مرز رشد نکند */
    for (const [k, v] of Object.entries(s)) if (v.exp < now) delete s[k];
    s[id] = { userId, csrf, at: now, exp: now + SESSION_HOURS * 3600_000,
              ip: String(ip).slice(0, 64), agent: String(agent).slice(0, 300) };
  });
  return { token: sign(id), csrf };
}

function readSession(token){
  const id = unsign(token);
  if (!id) return null;
  const s = sessions()[id];
  if (!s || s.exp < Date.now()) return null;
  return Object.assign({ id }, s);
}

const closeSession    = id     => store.update('sessions', {}, s => { delete s[id]; });
/* غیرفعال کردن کاربر باید فوری اثر کند، نه پس از انقضای توکن */
const closeUserSessions = userId => store.update('sessions', {}, s => {
  for (const [k, v] of Object.entries(s)) if (v.userId === userId) delete s[k];
});

/* ---------- کاربران و نقش‌ها ----------------------------------------------- */
const users = () => store.read('users', []);
const roles = () => store.read('roles', []);
const userById  = id   => users().find(u => u.id === id) || null;
const roleById  = id   => roles().find(r => r.id === id) || null;
const findUser  = name => users().find(u => u.username === String(name || '').trim().toLowerCase()) || null;

function permsOf(user){
  if (!user) return [];
  const r = roleById(user.roleId);
  return r ? (r.perms || []) : [];
}
const can = (user, perm) => permsOf(user).includes(perm);

/* بخش‌های مجاز کاربر. مدیرِ دارای دسترسی مدیریت کاربران به همه بخش‌ها می‌رسد. */
function sectionsOf(user){
  if (!user) return [];
  if (can(user, 'manage_users')) return SECTION_KEYS.slice();
  return (user.sections || []).filter(s => SECTION_KEYS.includes(s));
}
const inSection = (user, section) => sectionsOf(user).includes(section);

/* آنچه از کاربر به مرورگر می‌رود — هرگز نمک و درهم گذرواژه */
function publicUser(user){
  if (!user) return null;
  const r = roleById(user.roleId);
  return {
    id: user.id, username: user.username, name: user.name || '',
    roleId: user.roleId, roleName: r ? r.name : '—',
    perms: permsOf(user), sections: sectionsOf(user),
    mustChange: !!user.mustChange, active: user.active !== false
  };
}

/* ---------- محدودکردن تلاش ناموفق ورود ------------------------------------ */
const fails = new Map();
const FAIL_MAX = 5000;
function throttled(key){
  const f = fails.get(key);
  return (f && f.until > Date.now()) ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function noteFail(key){
  const f = fails.get(key) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5){ f.until = Date.now() + 60_000 * Math.min(10, f.n - 4); f.n = 4; }
  fails.set(key, f);
  if (fails.size > FAIL_MAX){
    const now = Date.now();
    for (const [k, v] of fails) if (v.until < now) fails.delete(k);
  }
}
const clearFail = key => fails.delete(key);

/* ---------- داده اولیه ------------------------------------------------------ */
async function seed(){
  if (roles().length === 0){
    await store.update('roles', [], r => {
      r.push({ id:'admin',  name:'مدیر سامانه', perms: ALL_PERMS.slice() });
      r.push({ id:'expert', name:'کارشناس قراردادها',
               perms:['view','edit','delete','upload','import','export'] });
      r.push({ id:'viewer', name:'مشاهده‌گر', perms:['view'] });
    });
  }
  if (users().length === 0){
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const { salt, hash } = hashPassword(pw);
    await store.update('users', [], u => {
      u.push({ id: 1, username:'admin', name:'مدیر سامانه', salt, hash,
               roleId:'admin', sections: SECTION_KEYS.slice(),
               active: true, mustChange: true, createdAt: new Date().toISOString() });
    });
    return pw;      // فقط همین یک بار برگردانده می‌شود تا در کنسول چاپ شود
  }
  return null;
}

module.exports = {
  PERMISSIONS, ALL_PERMS, SECTIONS, SECTION_KEYS, SECTION_FA, SESSION_HOURS, MIN_PASSWORD,
  hashPassword, verifyPassword, passwordProblem,
  openSession, readSession, closeSession, closeUserSessions,
  users, roles, findUser, userById, roleById,
  permsOf, can, sectionsOf, inSection, publicUser,
  throttled, noteFail, clearFail, seed
};
