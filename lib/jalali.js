'use strict';
/* ============================================================================
   تقویم جلالی — بدون هیچ پکیج خارجی
   ---------------------------------------------------------------------------
   الگوریتم استاندارد jalaali بر پایه شمارش روز جولیَن.
   خواسته کارفرما: اگر کاربر تاریخ میلادی وارد کند، خودکار شمسی شود.
   ========================================================================== */

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
                1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

/* سالِ ۱۲۰۰..۱۷۰۰ شمسی است و ۱۸۰۰..۲۴۰۰ میلادی. بین این دو بازه فاصله هست،
   پس هیچ تاریخی به دو شکل تفسیر نمی‌شود. */
const JALALI_MIN = 1200, JALALI_MAX = 1700;
const GREG_MIN   = 1800, GREG_MAX   = 2400;

const idiv = (a, b) => Math.trunc(a / b);
const imod = (a, b) => a - Math.trunc(a / b) * b;

function jalCal(jy){
  const bl = BREAKS.length;
  let gy = jy + 621, leapJ = -14, jp = BREAKS[0], jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new RangeError('سال شمسی خارج از محدوده: ' + jy);
  for (let i = 1; i < bl; i++){
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += idiv(jump, 33) * 8 + idiv(imod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += idiv(n, 33) * 8 + idiv(imod(n, 33) + 3, 4);
  if (imod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = idiv(gy, 4) - idiv((idiv(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + idiv(jump + 4, 33) * 33;
  let leap = imod(imod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd){
  let d = idiv((gy + idiv(gm - 8, 6) + 100100) * 1461, 4)
        + idiv(153 * imod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - idiv(idiv(gy + 100100 + idiv(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn){
  let j = 4 * jdn + 139361631;
  j = j + idiv(idiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i  = idiv(imod(j, 1461), 4) * 5 + 308;
  const gd = idiv(imod(i, 153), 5) + 1;
  const gm = imod(idiv(i, 153), 12) + 1;
  const gy = idiv(j, 1461) - 100100 + idiv(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd){
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - idiv(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn){
  const gy0 = d2g(jdn).gy;
  let jy = gy0 - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy0, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0){
    if (k <= 185) return { jy, jm: 1 + idiv(k, 31), jd: imod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + idiv(k, 30), jd: imod(k, 30) + 1 };
}

const pad = n => String(n).padStart(2, '0');

/* روز مطلق برای یک تاریخ میلادی؛ مبنای همه محاسبات بازه */
function dayNumberOfDate(d){ return g2d(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function todayNumber(){ return dayNumberOfDate(new Date()); }

function fromDayNumber(n){
  const j = d2j(n);
  return `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`;
}

function gregorianToJalali(d){ return fromDayNumber(dayNumberOfDate(d)); }

const FA_DIGITS = { '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
                    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9' };
const latinDigits = s => String(s).replace(/[۰-۹٠-٩]/g, c => FA_DIGITS[c]);

/**
 * هر ورودی تاریخی را به { jalali, day } تبدیل می‌کند.
 *   jalali — متن شمسی «۱۴۰۵/۰۶/۱۵» برای نمایش
 *   day    — شماره روز مطلق، برای مقایسه و محاسبه بازه
 * ورودی نامعتبر → null، تا لایه بالاتر خطای کاربرپسند بدهد.
 */
function normalize(raw){
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !isNaN(raw))
    return { jalali: gregorianToJalali(raw), day: dayNumberOfDate(raw) };

  const parts = latinDigits(raw).match(/\d+/g);
  if (!parts || parts.length < 3) return null;
  const y = +parts[0], m = +parts[1], d = +parts[2];
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;

  try {
    if (y >= GREG_MIN && y <= GREG_MAX){
      /* الزام کارفرما: ورودی میلادی خودکار شمسی می‌شود */
      const day = g2d(y, m, d);
      const back = d2g(day);
      if (back.gy !== y || back.gm !== m || back.gd !== d) return null;  // مثلاً ۳۱ فروردینِ میلادی
      return { jalali: fromDayNumber(day), day };
    }
    if (y >= JALALI_MIN && y <= JALALI_MAX){
      const day = j2d(y, m, d);
      const back = d2j(day);
      if (back.jy !== y || back.jm !== m || back.jd !== d) return null;  // مثلاً ۳۱ مهر
      return { jalali: `${y}/${pad(m)}/${pad(d)}`, day };
    }
  } catch (_) { return null; }
  return null;
}

module.exports = { normalize, todayNumber, fromDayNumber, gregorianToJalali, latinDigits };
