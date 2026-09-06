'use strict';
/* ============================================================================
   سامانه مدیریت قراردادها و تفاهم‌نامه‌ها — سرور، بدون هیچ پکیج خارجی
   شرکت توسعه انرژی‌های تجدیدپذیر خلیج فارس
   ---------------------------------------------------------------------------
   هم‌الگو با «بانک داده مشتریان»: node:http خالص، ذخیره JSON، اجرا با start.bat،
   هیچ npm install. سه بخش فنی/مالی/منابع انسانی به‌عنوان مرز دسترسی.
   ========================================================================== */
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const urlmod = require('url');

const store     = require('./lib/store');
const auth      = require('./lib/auth');
const audit     = require('./lib/audit');
const contracts = require('./lib/contracts');
const jalali    = require('./lib/jalali');
const xlsx      = require('./lib/xlsx');

const PORT       = Number(process.env.PORT || 8080);
const HOST       = process.env.HOST || '0.0.0.0';
const PUBLIC     = path.join(__dirname, 'public');
const MAX_UPLOAD = 20 * 1024 * 1024;
const DATA_FILES = ['contracts', 'users', 'roles', 'sessions'];

/* ---------- پاسخ‌ها -------------------------------------------------------- */
const SECURITY = {
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'SAMEORIGIN',
  'Referrer-Policy':'same-origin', 'X-Robots-Tag':'noindex, nofollow'
};
function json(res, code, body, extra){
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(code, Object.assign({ 'Content-Type':'application/json; charset=utf-8',
    'Content-Length': buf.length, 'Cache-Control':'no-store' }, SECURITY, extra || {}));
  res.end(buf);
}
const ok   = (res, body, extra) => json(res, 200, body || { ok:true }, extra);
const fail = (res, code, msg)   => json(res, code, { error: msg });

/* ---------- فایل ایستا ----------------------------------------------------- */
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2',
  '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json; charset=utf-8' };
function serveStatic(res, rel){
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC, clean === '/' ? 'index.html' : clean);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return fail(res, 404, 'یافت نشد.');
  const body = fs.readFileSync(file);
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length }, SECURITY));
  res.end(body);
}

/* ---------- بدنه ----------------------------------------------------------- */
function readBody(req, limit){
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length;
      if (size > limit){ reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req){
  const buf = await readBody(req, 4 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (_) { throw new Error('bad_json'); }
}

/* ---------- نشست، دسترسی، CSRF -------------------------------------------- */
function cookies(req){
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')){
    const i = p.indexOf('='); if (i < 0) continue;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req){
  const sess = auth.readSession(cookies(req).sid);
  if (!sess) return null;
  const user = auth.userById(sess.userId);
  if (!user || user.active === false) return null;
  return { user, session: sess };
}
function clientIp(req){
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : (req.socket.remoteAddress || '')).trim();
}
const agentOf = req => String(req.headers['user-agent'] || '').slice(0, 300);
function csrfOk(req, session){
  const a = Buffer.from(String(req.headers['x-csrf-token'] || '')), b = Buffer.from(session.csrf);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- شناسه و دید ----------------------------------------------------- */
let SEQ = null;
function nextId(){
  if (SEQ === null) SEQ = store.read('contracts', []).reduce((m, c) => Math.max(m, c.id || 0), 0);
  return ++SEQ;
}
const visibleTo = (list, user) => list.filter(c => !c.deleted && auth.inSection(user, c.section));
const findContract = id => store.read('contracts', []).find(c => c.id === id) || null;

/* ============================================================================
   جدول مسیرها
   ========================================================================== */
const ROUTES = [];
const on = (method, re, handler, perm) => ROUTES.push({ method, re, handler, perm });

/* ---- ورود ---- */
on('POST', /^\/api\/auth\/login$/, async (req, res) => {
  const body = await readJson(req);
  const username = String(body.username || '').trim().toLowerCase();
  const key = username + '|' + clientIp(req);
  const wait = auth.throttled(key);
  if (wait) return fail(res, 429, `به دلیل تلاش‌های ناموفق، ${wait} ثانیه دیگر تلاش کنید.`);

  const user = auth.findUser(username);
  const good = user && user.active !== false && auth.verifyPassword(body.password, user.salt, user.hash);
  if (!good){
    auth.noteFail(key);
    audit.record({ actor:null, action:'login_failed', entity:'user',
      summary:`نام کاربری «${username.slice(0,64)}»`, ip: clientIp(req), agent: agentOf(req) });
    return fail(res, 401, 'نام کاربری یا رمز عبور نادرست است.');
  }
  auth.clearFail(key);
  const { token, csrf } = await auth.openSession(user.id, clientIp(req), agentOf(req));
  audit.record({ actor:user, action:'login', entity:'user', entityId:user.id,
    summary:'ورود موفق به سامانه', ip: clientIp(req), agent: agentOf(req) });
  ok(res, auth.publicUser(user),
     { 'Set-Cookie':`sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.SESSION_HOURS*3600}`,
       'X-CSRF-Token': csrf });
}, null);

/* ---- من کیستم ---- */
on('GET', /^\/api\/auth\/me$/, (req, res, ctx) =>
  ok(res, Object.assign(auth.publicUser(ctx.user), { csrf: ctx.session.csrf })), 'any');

/* ---- خروج ---- */
on('POST', /^\/api\/auth\/logout$/, async (req, res, ctx) => {
  await auth.closeSession(ctx.session.id);
  audit.record({ actor:ctx.user, action:'logout', entity:'user', entityId:ctx.user.id,
    summary:'خروج از سامانه', ip: clientIp(req), agent: agentOf(req) });
  ok(res, { ok:true }, { 'Set-Cookie':'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}, 'any');

/* ---- تغییر رمز ---- */
on('POST', /^\/api\/auth\/password$/, async (req, res, ctx) => {
  const body = await readJson(req);
  if (!auth.verifyPassword(body.current, ctx.user.salt, ctx.user.hash))
    return fail(res, 400, 'رمز عبور فعلی نادرست است.');
  const problem = auth.passwordProblem(body.next);
  if (problem) return fail(res, 400, problem);
  if (body.next === body.current) return fail(res, 400, 'رمز جدید باید با رمز فعلی متفاوت باشد.');
  const { salt, hash } = auth.hashPassword(body.next);
  await store.update('users', [], us => {
    const u = us.find(x => x.id === ctx.user.id);
    if (u){ u.salt = salt; u.hash = hash; u.mustChange = false; }
  });
  audit.record({ actor:ctx.user, action:'password_changed', entity:'user', entityId:ctx.user.id,
    summary:'کاربر رمز عبور خود را تغییر داد', ip: clientIp(req), agent: agentOf(req) });
  ok(res, { ok:true });
}, 'any');

/* ---- فهرست قراردادها ---- */
on('GET', /^\/api\/contracts$/, (req, res, ctx) => {
  const q = ctx.query;
  const today = jalali.todayNumber();
  let list = visibleTo(store.read('contracts', []), ctx.user);
  if (q.section){
    if (!auth.inSection(ctx.user, q.section)) return ok(res, { items:[], total:0 });
    list = list.filter(c => c.section === q.section);
  }
  if (q.kind) list = list.filter(c => c.kind === q.kind);
  if (q.unit) list = list.filter(c => c.unit === q.unit);
  if (q.q){
    const needle = String(q.q).trim().toLowerCase();
    list = list.filter(c => [c.number, c.party, c.subject, c.site, c.notes, c.capacity, c.guarantees]
      .some(v => String(v || '').toLowerCase().includes(needle)));
  }
  let items = list.map(c => contracts.toView(c, today));
  if (q.status) items = items.filter(i => i.status === q.status);
  const order = { end:'daysRemaining', amount:'amount', party:'party', number:'number' }[q.sort] || 'daysRemaining';
  items.sort((a, b) => {
    if (order === 'amount' || order === 'daysRemaining'){
      const x = a[order] == null ? Infinity : a[order], y = b[order] == null ? Infinity : b[order];
      return x - y;
    }
    return String(a[order] || '').localeCompare(String(b[order] || ''), 'fa');
  });
  ok(res, { items, total: items.length });
}, 'view');

/* ---- یک قرارداد ---- */
on('GET', /^\/api\/contracts\/(\d+)$/, (req, res, ctx) => {
  const c = findContract(+ctx.params[0]);
  if (!c || c.deleted || !auth.inSection(ctx.user, c.section)) return fail(res, 404, 'قرارداد یافت نشد.');
  ok(res, contracts.toView(c, jalali.todayNumber()));
}, 'view');

/* ---- ثبت قرارداد ---- */
on('POST', /^\/api\/contracts$/, async (req, res, ctx) => {
  const raw = await readJson(req);
  const { value, errors } = contracts.clean(raw);
  if (errors.length) return fail(res, 422, errors[0]);
  if (!auth.inSection(ctx.user, value.section)) return fail(res, 404, 'قرارداد یافت نشد.');

  const existing = store.read('contracts', []).find(c => !c.deleted && c.number === value.number);
  if (existing) return fail(res, 409, `شماره «${value.number}» قبلاً ثبت شده است.`);

  const id = nextId();
  const now = new Date().toISOString();
  const record = Object.assign({ id }, value,
    { version:1, createdAt:now, createdBy:ctx.user.id, updatedAt:now, updatedBy:ctx.user.id, deleted:false });

  await store.update('contracts', [], cs => { cs.push(record); });
  audit.record({ actor:ctx.user, action:'contract_created', entity:'contract', entityId:id,
    summary:`${value.number} — ${String(value.subject).slice(0,120)}`,
    changes: audit.diff({}, value, contracts.AUDIT_FIELDS), ip: clientIp(req), agent: agentOf(req) });
  ok(res, contracts.toView(record, jalali.todayNumber()));
}, 'edit');

/* ---- ویرایش قرارداد (با قفل خوش‌بینانه) ---- */
on('PUT', /^\/api\/contracts\/(\d+)$/, async (req, res, ctx) => {
  const id = +ctx.params[0];
  const before = findContract(id);
  if (!before || before.deleted || !auth.inSection(ctx.user, before.section)) return fail(res, 404, 'قرارداد یافت نشد.');
  const raw = await readJson(req);
  const { value, errors } = contracts.clean(raw);
  if (errors.length) return fail(res, 422, errors[0]);
  if (!auth.inSection(ctx.user, value.section)) return fail(res, 404, 'قرارداد یافت نشد.');
  if (Number(raw.version) !== before.version)
    return fail(res, 409, 'این قرارداد توسط کاربر دیگری تغییر کرده است. صفحه را تازه کنید.');

  const dup = store.read('contracts', []).find(c => !c.deleted && c.number === value.number && c.id !== id);
  if (dup) return fail(res, 409, `شماره «${value.number}» قبلاً ثبت شده است.`);

  const changes = audit.diff(before, value, contracts.AUDIT_FIELDS);
  if (!changes.length) return ok(res, contracts.toView(before, jalali.todayNumber()));

  await store.update('contracts', [], cs => {
    const c = cs.find(x => x.id === id);
    Object.assign(c, value, { version: before.version + 1, updatedAt:new Date().toISOString(), updatedBy: ctx.user.id });
  });
  audit.record({ actor:ctx.user, action:'contract_updated', entity:'contract', entityId:id,
    summary:`${value.number} — ${changes.length} فیلد تغییر کرد`, changes, ip: clientIp(req), agent: agentOf(req) });
  ok(res, contracts.toView(findContract(id), jalali.todayNumber()));
}, 'edit');

/* ---- حذف نرم ---- */
on('DELETE', /^\/api\/contracts\/(\d+)$/, async (req, res, ctx) => {
  const id = +ctx.params[0];
  const c = findContract(id);
  if (!c || c.deleted || !auth.inSection(ctx.user, c.section)) return fail(res, 404, 'قرارداد یافت نشد.');
  await store.update('contracts', [], cs => {
    const x = cs.find(y => y.id === id);
    x.deleted = true; x.deletedAt = new Date().toISOString(); x.deletedBy = ctx.user.id;
  });
  audit.record({ actor:ctx.user, action:'contract_deleted', entity:'contract', entityId:id,
    summary:`${c.number} — ${String(c.subject).slice(0,120)}`, ip: clientIp(req), agent: agentOf(req) });
  ok(res, { ok:true });
}, 'delete');

/* ---- بارگذاری اسکن — بررسی امضای بایتی، نه پسوند ---- */
const SIGNATURES = [
  [Buffer.from('%PDF-'),                         'application/pdf', '.pdf'],
  [Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), 'image/png', '.png'],
  [Buffer.from([0xFF,0xD8,0xFF]),                'image/jpeg', '.jpg']
];
function sniff(head){
  for (const [magic, type, ext] of SIGNATURES)
    if (head.length >= magic.length && head.subarray(0, magic.length).equals(magic)) return { type, ext };
  return null;
}
/* فایل inline با CSP سخت سرو می‌شود تا حتی اگر روزی نوعی خطرناک رد شد، اجرا نشود */
const INLINE_HEADERS = Object.assign({}, SECURITY, {
  'Content-Security-Policy':"sandbox; default-src 'none'; object-src 'none'; base-uri 'none'",
  'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer'
});

on('POST', /^\/api\/contracts\/(\d+)\/attachments$/, async (req, res, ctx) => {
  const id = +ctx.params[0];
  const c = findContract(id);
  if (!c || c.deleted || !auth.inSection(ctx.user, c.section)) return fail(res, 404, 'قرارداد یافت نشد.');

  const fname = decodeURIComponent(req.headers['x-file-name'] || 'scan');
  let payload;
  try { payload = await readBody(req, MAX_UPLOAD + 1); }
  catch (e) { return fail(res, 413, `حجم فایل نباید از ${MAX_UPLOAD/1048576} مگابایت بیشتر باشد.`); }
  if (!payload.length) return fail(res, 400, 'فایل خالی است.');
  const kind = sniff(payload.subarray(0, 16));
  if (!kind) return fail(res, 415, 'فقط فایل PDF، JPG و PNG پذیرفته می‌شود.');

  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  const stored = `${digest.slice(0,32)}-${crypto.randomBytes(6).toString('hex')}${kind.ext}`;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, stored), payload);

  const att = { id: crypto.randomBytes(8).toString('hex'), name: String(fname).slice(0,300),
    type: kind.type, size: payload.length, sha256: digest, stored,
    at: new Date().toISOString(), by: ctx.user.id };
  await store.update('contracts', [], cs => {
    const x = cs.find(y => y.id === id);
    (x.attachments = x.attachments || []).push(att);
  });
  audit.record({ actor:ctx.user, action:'attachment_added', entity:'contract', entityId:id,
    summary:`${c.number} — پیوست «${att.name}» (${payload.length} بایت)`, ip: clientIp(req), agent: agentOf(req) });
  ok(res, att);
}, 'upload');

function findAttachment(user, cid, aid){
  const c = findContract(cid);
  if (!c || c.deleted || !auth.inSection(user, c.section)) return null;
  const att = (c.attachments || []).find(a => a.id === aid);
  return att ? { c, att } : null;
}

on('GET', /^\/api\/contracts\/(\d+)\/attachments\/([a-f0-9]+)\/(inline|download)$/, (req, res, ctx) => {
  const found = findAttachment(ctx.user, +ctx.params[0], ctx.params[1]);
  if (!found) return fail(res, 404, 'پیوست یافت نشد.');
  const file = path.join(store.UPLOAD_DIR, found.att.stored);
  if (!fs.existsSync(file)) return fail(res, 410, 'فایل روی سرور یافت نشد.');
  const body = fs.readFileSync(file);
  const inline = ctx.params[2] === 'inline';
  if (inline)
    audit.record({ actor:ctx.user, action:'attachment_viewed', entity:'contract', entityId:+ctx.params[0],
      summary:`مشاهده پیوست «${found.att.name}»`, ip: clientIp(req), agent: agentOf(req) });
  const disp = inline ? 'inline'
    : `attachment; filename*=UTF-8''${encodeURIComponent(found.att.name)}`;
  res.writeHead(200, Object.assign({ 'Content-Type': found.att.type, 'Content-Length': body.length,
    'Content-Disposition': disp }, INLINE_HEADERS));
  res.end(body);
}, 'view');

on('DELETE', /^\/api\/contracts\/(\d+)\/attachments\/([a-f0-9]+)$/, async (req, res, ctx) => {
  const found = findAttachment(ctx.user, +ctx.params[0], ctx.params[1]);
  if (!found) return fail(res, 404, 'پیوست یافت نشد.');
  await store.update('contracts', [], cs => {
    const x = cs.find(y => y.id === +ctx.params[0]);
    x.attachments = (x.attachments || []).filter(a => a.id !== ctx.params[1]);
  });
  try { fs.unlinkSync(path.join(store.UPLOAD_DIR, found.att.stored)); } catch (_) {}
  audit.record({ actor:ctx.user, action:'attachment_deleted', entity:'contract', entityId:+ctx.params[0],
    summary:`حذف پیوست «${found.att.name}»`, ip: clientIp(req), agent: agentOf(req) });
  ok(res, { ok:true });
}, 'upload');

/* ---- خروجی اکسل ---- */
on('GET', /^\/api\/export$/, (req, res, ctx) => {
  let list = visibleTo(store.read('contracts', []), ctx.user);
  if (ctx.query.section){
    if (!auth.inSection(ctx.user, ctx.query.section)) return fail(res, 404, 'یافت نشد.');
    list = list.filter(c => c.section === ctx.query.section);
  }
  list.sort((a,b) => String(a.section).localeCompare(String(b.section)));
  const rows = contracts.toExportRows(list, jalali.todayNumber());
  const buf = xlsx.writeSheet(rows);
  audit.record({ actor:ctx.user, action:'excel_exported', entity:'contract',
    summary:`خروجی اکسل از ${list.length} قرارداد`, ip: clientIp(req), agent: agentOf(req) });
  const stamp = new Date().toISOString().slice(0,10);
  res.writeHead(200, Object.assign({
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': buf.length,
    'Content-Disposition':`attachment; filename="contracts-${stamp}.xlsx"` }, SECURITY));
  res.end(buf);
}, 'export');

/* ---- قالب خالی ---- */
on('GET', /^\/api\/template$/, (req, res, ctx) => {
  const buf = xlsx.writeSheet(contracts.toExportRows([], jalali.todayNumber()));
  res.writeHead(200, Object.assign({
    'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Length': buf.length,
    'Content-Disposition':'attachment; filename="contracts-template.xlsx"' }, SECURITY));
  res.end(buf);
}, 'view');

/* ---- درون‌ریزی اکسل: آزمایشی یا نهایی ---- */
on('POST', /^\/api\/import$/, async (req, res, ctx) => {
  const section = ctx.query.section;
  const dryRun = ctx.query.commit !== '1';
  if (!auth.inSection(ctx.user, section)) return fail(res, 403, 'به این بخش دسترسی ندارید.');

  let payload;
  try { payload = await readBody(req, MAX_UPLOAD + 1); }
  catch (e) { return fail(res, 413, 'فایل بیش از حد بزرگ است.'); }
  if (payload.subarray(0,2).toString() !== 'PK') return fail(res, 415, 'فقط فایل xlsx پذیرفته می‌شود.');

  let parsed;
  try { parsed = contracts.parseRows(xlsx.readSheet(payload)); }
  catch (e) { return fail(res, 422, 'فایل اکسل خوانده نشد. از سالم بودن فایل مطمئن شوید.'); }

  const errors = parsed.errors.slice();
  const existing = new Set(store.read('contracts', []).filter(c => !c.deleted).map(c => c.number));
  const seen = new Set();
  const ready = [];
  for (const rec of parsed.records){
    const secText = String(rec.section || '').trim();
    const sec = { 'فنی':'technical', 'امور مالی':'financial', 'منابع انسانی':'hr' }[secText] || section;
    const { value, errors: e } = contracts.clean(Object.assign({}, rec, { section: sec }));
    if (e.length){ errors.push(`سطر ${rec._row}: ${e[0]}`); continue; }
    if (!auth.inSection(ctx.user, value.section)){ errors.push(`سطر ${rec._row}: به بخش این سند دسترسی ندارید.`); continue; }
    if (existing.has(value.number)){ errors.push(`سطر ${rec._row}: شماره «${value.number}» از قبل هست.`); continue; }
    if (seen.has(value.number)){ errors.push(`سطر ${rec._row}: شماره «${value.number}» در فایل تکراری است.`); continue; }
    seen.add(value.number); ready.push(value);
  }

  const report = { dryRun, total: parsed.records.length, ready: ready.length,
    skipped: parsed.records.length - ready.length, errors: errors.slice(0, 200), imported: 0 };
  if (dryRun || !ready.length) return ok(res, report);

  const now = new Date().toISOString();
  await store.update('contracts', [], cs => {
    for (const v of ready)
      cs.push(Object.assign({ id: nextId() }, v,
        { version:1, createdAt:now, createdBy:ctx.user.id, updatedAt:now, updatedBy:ctx.user.id, deleted:false }));
  });
  audit.record({ actor:ctx.user, action:'excel_imported', entity:'contract',
    summary:`درون‌ریزی — ${ready.length} سند ثبت شد، ${report.skipped} سطر رد شد`, ip: clientIp(req), agent: agentOf(req) });
  report.imported = ready.length;
  ok(res, report);
}, 'import');

/* ---- کاربران و نقش‌ها ---- */
on('GET', /^\/api\/users$/, (req, res) =>
  ok(res, { users: auth.users().map(u => auth.publicUser(u)),
            roles: auth.roles(), permissions: auth.PERMISSIONS, sections: auth.SECTIONS }), 'manage_users');

on('POST', /^\/api\/users$/, async (req, res, ctx) => {
  const body = await readJson(req);
  const username = String(body.username || '').trim().toLowerCase();
  if (username.length < 3) return fail(res, 400, 'نام کاربری باید دست‌کم ۳ نویسه باشد.');
  if (auth.findUser(username)) return fail(res, 409, 'این نام کاربری قبلاً ثبت شده است.');
  const problem = auth.passwordProblem(body.password);
  if (problem) return fail(res, 400, problem);
  if (!auth.roleById(body.roleId)) return fail(res, 400, 'نقش نامعتبر است.');

  const { salt, hash } = auth.hashPassword(body.password);
  const id = auth.users().reduce((m, u) => Math.max(m, u.id), 0) + 1;
  const sections = (body.sections || []).filter(s => auth.SECTION_KEYS.includes(s));
  await store.update('users', [], us => {
    us.push({ id, username, name:String(body.name||'').trim(), salt, hash,
      roleId: body.roleId, sections, active:true, mustChange:true, createdAt:new Date().toISOString() });
  });
  audit.record({ actor:ctx.user, action:'user_created', entity:'user', entityId:id,
    summary:`کاربر «${username}» با نقش ${body.roleId}`, ip: clientIp(req), agent: agentOf(req) });
  ok(res, auth.publicUser(auth.userById(id)));
}, 'manage_users');

on('PATCH', /^\/api\/users\/(\d+)$/, async (req, res, ctx) => {
  const id = +ctx.params[0];
  const target = auth.userById(id);
  if (!target) return fail(res, 404, 'کاربر یافت نشد.');
  const body = await readJson(req);
  const before = { name:target.name, roleId:target.roleId, active:target.active !== false,
    sections:(target.sections||[]).join('، ') };

  if (id === ctx.user.id && body.active === false) return fail(res, 400, 'نمی‌توانید حساب خود را غیرفعال کنید.');
  if (body.roleId && !auth.roleById(body.roleId)) return fail(res, 400, 'نقش نامعتبر است.');

  await store.update('users', [], us => {
    const u = us.find(x => x.id === id);
    if (body.name !== undefined) u.name = String(body.name).trim();
    if (body.roleId) u.roleId = body.roleId;
    if (body.active !== undefined) u.active = !!body.active;
    if (body.sections) u.sections = body.sections.filter(s => auth.SECTION_KEYS.includes(s));
    if (body.password){ const h = auth.hashPassword(body.password); u.salt = h.salt; u.hash = h.hash; u.mustChange = true; }
  });
  if (body.active === false) await auth.closeUserSessions(id);   // ابطال فوری نشست‌ها
  const after = { name:body.name, roleId:body.roleId,
    active: body.active === undefined ? before.active : !!body.active,
    sections: body.sections ? body.sections.join('، ') : before.sections };
  const changes = audit.diff(before, after, ['name','roleId','active','sections']);
  if (body.password) changes.push({ field:'password', old:'***', new:'***' });
  audit.record({ actor:ctx.user, action:'user_updated', entity:'user', entityId:id,
    summary:`ویرایش کاربر «${target.username}»`, changes: changes.length ? changes : null,
    ip: clientIp(req), agent: agentOf(req) });
  ok(res, auth.publicUser(auth.userById(id)));
}, 'manage_users');

/* ---- ممیزی ---- */
on('GET', /^\/api\/audit$/, (req, res, ctx) => {
  const q = ctx.query;
  const page = audit.query({ user:q.user||'', action:q.action||'', entityId:q.entityId||'',
    limit: Math.min(+q.limit || 200, 500), offset:+q.offset || 0 });
  ok(res, page);
}, 'view_audit');

on('GET', /^\/api\/audit\/verify$/, (req, res) =>
  ok(res, audit.verifyChain()), 'view_audit');

/* ============================================================================
   توزیع درخواست
   ========================================================================== */
async function handle(req, res){
  const parsed = urlmod.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);
  const query = parsed.query;

  if (!pathname.startsWith('/api/')){
    if (pathname === '/' || pathname === '/login') return serveStatic(res, '/index.html');
    return serveStatic(res, pathname);
  }

  const ctx = { query, pathname };
  const isLogin = pathname === '/api/auth/login';
  if (!isLogin){
    const cur = currentUser(req);
    if (!cur) return fail(res, 401, 'برای ادامه وارد سامانه شوید.');
    ctx.user = cur.user; ctx.session = cur.session;
    if (!['GET','HEAD'].includes(req.method) && !csrfOk(req, ctx.session))
      return fail(res, 403, 'توکن امنیتی نامعتبر است. صفحه را تازه کنید.');
  }

  for (const r of ROUTES){
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    ctx.params = m.slice(1);
    if (r.perm && r.perm !== 'any' && !auth.can(ctx.user, r.perm)){
      audit.record({ actor:ctx.user, action:'access_denied',
        summary:`مسیر ${pathname} نیازمند دسترسی «${r.perm}»`, ip: clientIp(req), agent: agentOf(req) });
      return fail(res, 403, 'برای این عملیات دسترسی ندارید.');
    }
    try { return await r.handler(req, res, ctx); }
    catch (e){
      if (e.message === 'bad_json') return fail(res, 400, 'داده ارسالی معتبر نیست.');
      if (e.message === 'too_large') return fail(res, 413, 'حجم داده بیش از حد است.');
      console.error('[server]', pathname, e);
      return fail(res, 500, 'خطای داخلی سرور.');
    }
  }
  fail(res, 404, 'مسیر یافت نشد.');
}

/* ============================================================================
   راه‌اندازی
   ========================================================================== */
async function main(){
  store.acquireLock();
  store.recoverJournal();
  const pw = await auth.seed();
  store.dailyBackup(DATA_FILES);

  const banner = [
    '', '  ' + '─'.repeat(56),
    '  سامانه مدیریت قراردادها — شرکت توسعه انرژی‌های تجدیدپذیر خلیج فارس',
    '  ' + '─'.repeat(56),
    `  روی همین سرور  →  http://localhost:${PORT}`
  ];
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets))
    for (const ni of nets[name] || [])
      if (ni.family === 'IPv4' && !ni.internal)
        banner.push(`  از شبکه شرکت  →  http://${ni.address}:${PORT}`);
  if (pw){
    banner.push('  ' + '─'.repeat(56));
    banner.push('  کاربر مدیر ساخته شد → نام کاربری: admin');
    banner.push(`  رمز عبور اولیه: ${pw}`);
    banner.push('  در اولین ورود حتماً تغییرش دهید.');
  }
  banner.push('  ' + '─'.repeat(56), '  برای توقف: Ctrl+C', '');

  http.createServer(handle).listen(PORT, HOST, () => console.log(banner.join('\n')));
}

if (require.main === module) main().catch(e => { console.error('راه‌اندازی ناموفق:', e.message); process.exit(1); });
module.exports = { handle };
