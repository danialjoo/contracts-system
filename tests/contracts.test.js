'use strict';
/* آزمون‌ها با test runner داخلی Node اجرا می‌شوند — هیچ پکیج آزمونی لازم نیست.
   اجرا:  node --test                                                  */
const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-test-'));

const jalali    = require('../lib/jalali');
const zip       = require('../lib/zip');
const xlsx      = require('../lib/xlsx');
const contracts = require('../lib/contracts');
const audit     = require('../lib/audit');
const auth      = require('../lib/auth');

/* ---------------------------------------------------------------- تقویم --- */
test('تاریخ میلادی خودکار به شمسی تبدیل می‌شود', () => {
  assert.equal(jalali.normalize('2026/09/06').jalali, '1405/06/15');
  assert.equal(jalali.normalize('2024-07-05').jalali, '1403/04/15');
});
test('تاریخ شمسی دست‌نخورده می‌ماند', () => {
  assert.equal(jalali.normalize('۱۴۰۵/۰۶/۱۵').jalali, '1405/06/15');
  assert.equal(jalali.normalize('1403.04.15').jalali, '1403/04/15');
});
test('سال کبیسه ۱۳۹۹ سی‌ام اسفند دارد', () => {
  assert.equal(jalali.normalize('1399/12/30').jalali, '1399/12/30');
});
test('تاریخ نامعتبر رد می‌شود', () => {
  for (const bad of ['', 'سلام', '1405/13/01', '1405/07/31', '9999/01/01', null])
    assert.equal(jalali.normalize(bad), null, `باید رد شود: ${bad}`);
});
test('رفت‌وبرگشت تاریخ پایدار است', () => {
  for (const d of ['1400/01/01', '1403/12/29', '1405/06/15', '1410/11/03']){
    const n = jalali.normalize(d);
    assert.equal(jalali.fromDayNumber(n.day), d);
  }
});

/* ------------------------------------------------------------------- ZIP --- */
test('ZIP رفت‌وبرگشت می‌کند', () => {
  const buf = zip.write([{ name:'a.txt', data:'سلام' }, { name:'d/b.json', data:'{"x":1}' }]);
  const back = zip.read(buf);
  assert.equal(back.get('a.txt').toString('utf8'), 'سلام');
  assert.equal(back.get('d/b.json').toString('utf8'), '{"x":1}');
});

/* ------------------------------------------------------------------ xlsx --- */
test('xlsx نوشته و خوانده می‌شود، با ارقام و متن فارسی', () => {
  const rows = [['شماره','مبلغ'], ['۱۴۰۵/ق-۱', 24500000000000], ['۱۴۰۵/ق-۲', 0]];
  const back = xlsx.readSheet(xlsx.writeSheet(rows));
  assert.equal(back[0][0], 'شماره');
  assert.equal(back[1][0], '۱۴۰۵/ق-۱');
  assert.equal(back[1][1], '24500000000000');
});
test('سرستون‌های فایل واقعی شرکت درست نگاشت می‌شوند', () => {
  assert.equal(contracts.fieldForHeader('عوامل طرف قرارداد'), 'people');
  assert.equal(contracts.fieldForHeader('  طرف قرارداد '), 'party');
  assert.equal(contracts.fieldForHeader('شماره قرارداد/\nشماره تفاهم نامه'), 'number');
  assert.equal(contracts.fieldForHeader('تفاهم نامه/\r\nقرارداد'), 'kind');
  assert.equal(contracts.fieldForHeader('مدت قرارداد/\nمدت تفاهم نامه'), 'duration');
  assert.equal(contracts.fieldForHeader('تاریخ شروع قرارداد/ \nتاریخ شروع تفاهم نامه'), 'start');
  assert.equal(contracts.fieldForHeader('ساختگاه/ مکان/ محل اجرا'), 'site');
  assert.equal(contracts.fieldForHeader('محل نگهداری'), 'storage');
});
test('ستون‌های محاسباتی درون‌ریزی نمی‌شوند', () => {
  for (const h of ['فرمول پایان ', 'روزهای باقیمانده از قرارداد/وضعیت',
                   'مدت زمان سپری شده', 'Column1', 'روزهای باقی مانده'])
    assert.equal(contracts.fieldForHeader(h), null, `باید نادیده گرفته شود: ${h}`);
});

/* -------------------------------------------------------------- قرارداد --- */
test('مبلغ با ارقام فارسی و جداکننده خوانده می‌شود', () => {
  assert.equal(contracts.parseAmount('۲۴٬۵۰۰٬۰۰۰٬۰۰۰٬۰۰۰'), 24500000000000);
  assert.equal(contracts.parseAmount('24,500,000'), 24500000);
  assert.equal(contracts.parseAmount(''), 0);
});
test('وضعیت محاسبه می‌شود و ذخیره نمی‌شود', () => {
  const today = jalali.normalize('1405/06/15').day;
  const over = contracts.derive({ start:'1401/01/01', end:'1402/01/01' }, today);
  assert.equal(over.status, 'over');
  assert.equal(over.percent, 100);
  const live = contracts.derive({ start:'1405/01/01', end:'1408/01/01' }, today);
  assert.equal(live.status, 'live');
  const soon = contracts.derive({ start:'1404/01/01', end:'1405/08/01' }, today);
  assert.equal(soon.status, 'soon');
});
test('تاریخ پایان پیش از شروع رد می‌شود', () => {
  const { errors } = contracts.clean({ section:'technical', number:'X',
    start:'۱۴۰۵/۰۶/۱۵', end:'۱۴۰۴/۰۶/۱۵' });
  assert.ok(errors.some(e => e.includes('پیش از تاریخ شروع')));
});
test('تاریخ خالی مجاز است و وضعیت نامشخص می‌دهد', () => {
  const { value, errors } = contracts.clean({ section:'technical', number:'X', start:'', end:'' });
  assert.equal(errors.length, 0);
  assert.equal(contracts.derive(value).status, 'unknown');
});
test('مسیر شبکه ویندوزی به‌عنوان لینک اسکن پذیرفته می‌شود', () => {
  const { errors } = contracts.clean({ section:'technical', number:'X',
    scanLink:'\\\\fileserver\\contracts\\1405\\scan.pdf' });
  assert.equal(errors.length, 0);
});

/* ---------------------------------------------------------------- ممیزی --- */
test('diff فقط فیلدهای تغییریافته را برمی‌گرداند', () => {
  const d = audit.diff({ party:'الف', amount:100 }, { party:'ب', amount:100 }, ['party','amount']);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { field:'party', old:'الف', new:'ب' });
});
test('زنجیره ممیزی دستکاری را کشف می‌کند', () => {
  const actor = { id:1, username:'admin' };
  audit.record({ actor, action:'login', summary:'ورود' });
  audit.record({ actor, action:'contract_created', entityId:7, summary:'ثبت',
    changes:[{ field:'amount', old:null, new:'100' }] });
  audit.record({ actor, action:'contract_deleted', entityId:7, summary:'حذف' });
  assert.equal(audit.verifyChain().ok, true);

  const lines = fs.readFileSync(audit.FILE, 'utf8').split('\n').filter(Boolean);
  lines.splice(1, 1);                                   // یک سطر را مثل مهاجم پاک می‌کنیم
  fs.writeFileSync(audit.FILE, lines.join('\n') + '\n');
  const after = audit.verifyChain();
  assert.equal(after.ok, false);
  assert.equal(after.brokenAt, 2);
});

/* ------------------------------------------------------------ گذرواژه ----- */
test('گذرواژه ضعیف رد می‌شود', () => {
  assert.ok(auth.passwordProblem('123'));
  assert.ok(auth.passwordProblem('12345678901'));       // فقط عدد
  assert.equal(auth.passwordProblem('Str0ng-Pass-Word'), null);
});
test('هش گذرواژه با نمک اختصاصی و بررسی زمان‌ثابت', () => {
  const { salt, hash } = auth.hashPassword('Str0ng-Pass-Word');
  assert.ok(auth.verifyPassword('Str0ng-Pass-Word', salt, hash));
  assert.equal(auth.verifyPassword('wrong', salt, hash), false);
  const other = auth.hashPassword('Str0ng-Pass-Word');
  assert.notEqual(other.hash, hash, 'نمک اختصاصی باید هش را متفاوت کند');
});
