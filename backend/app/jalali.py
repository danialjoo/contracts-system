"""تبدیل تقویم جلالی و میلادی.

بدون وابستگی خارجی نوشته شده تا نصب آفلاین ساده بماند.
الگوریتم همان jalaali استاندارد است (بر پایه شمارش روز جولیَن).
"""
from __future__ import annotations

from datetime import date
from typing import Optional

_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
           1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]

# محدوده‌ای که سال را شمسی می‌دانیم؛ خارج از آن میلادی فرض می‌شود.
JALALI_MIN_YEAR, JALALI_MAX_YEAR = 1200, 1700
GREGORIAN_MIN_YEAR, GREGORIAN_MAX_YEAR = 1800, 2400

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _idiv(a: int, b: int) -> int:
    # تقسیم صحیح با قطع به سمت صفر (مانند trunc در جاوااسکریپت)
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b > 0) else -q


def _imod(a: int, b: int) -> int:
    return a - _idiv(a, b) * b


def _jal_cal(jy: int) -> dict:
    bl = len(_BREAKS)
    gy = jy + 621
    leap_j = -14
    jp = _BREAKS[0]
    if jy < jp or jy >= _BREAKS[bl - 1]:
        raise ValueError(f"سال شمسی خارج از محدوده پشتیبانی: {jy}")
    jump = 0
    for i in range(1, bl):
        jm = _BREAKS[i]
        jump = jm - jp
        if jy < jm:
            break
        leap_j += _idiv(jump, 33) * 8 + _idiv(_imod(jump, 33), 4)
        jp = jm
    n = jy - jp
    leap_j += _idiv(n, 33) * 8 + _idiv(_imod(n, 33) + 3, 4)
    if _imod(jump, 33) == 4 and jump - n == 4:
        leap_j += 1
    leap_g = _idiv(gy, 4) - _idiv((_idiv(gy, 100) + 1) * 3, 4) - 150
    march = 20 + leap_j - leap_g
    if jump - n < 6:
        n = n - jump + _idiv(jump + 4, 33) * 33
    leap = _imod(_imod(n + 1, 33) - 1, 4)
    if leap == -1:
        leap = 4
    return {"leap": leap, "gy": gy, "march": march}


def _g2d(gy: int, gm: int, gd: int) -> int:
    d = (_idiv((gy + _idiv(gm - 8, 6) + 100100) * 1461, 4)
         + _idiv(153 * _imod(gm + 9, 12) + 2, 5) + gd - 34840408)
    d = d - _idiv(_idiv(gy + 100100 + _idiv(gm - 8, 6), 100) * 3, 4) + 752
    return d


def _d2g(jdn: int) -> tuple[int, int, int]:
    j = 4 * jdn + 139361631
    j = j + _idiv(_idiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    i = _idiv(_imod(j, 1461), 4) * 5 + 308
    gd = _idiv(_imod(i, 153), 5) + 1
    gm = _imod(_idiv(i, 153), 12) + 1
    gy = _idiv(j, 1461) - 100100 + _idiv(8 - gm, 6)
    return gy, gm, gd


def _j2d(jy: int, jm: int, jd: int) -> int:
    r = _jal_cal(jy)
    return _g2d(r["gy"], 3, r["march"]) + (jm - 1) * 31 - _idiv(jm, 7) * (jm - 7) + jd - 1


def _d2j(jdn: int) -> tuple[int, int, int]:
    gy = _d2g(jdn)[0]
    jy = gy - 621
    r = _jal_cal(jy)
    jdn1f = _g2d(gy, 3, r["march"])
    k = jdn - jdn1f
    if k >= 0:
        if k <= 185:
            return jy, 1 + _idiv(k, 31), _imod(k, 31) + 1
        k -= 186
    else:
        jy -= 1
        k += 179
        if r["leap"] == 1:
            k += 1
    return jy, 7 + _idiv(k, 30), _imod(k, 30) + 1


_EPOCH_JDN = _g2d(1970, 1, 1)


def gregorian_to_jalali(d: date) -> str:
    """۲۰۲۶-۰۹-۰۶ → «۱۴۰۵/۰۶/۱۵»"""
    jy, jm, jd = _d2j(_g2d(d.year, d.month, d.day))
    return f"{jy:04d}/{jm:02d}/{jd:02d}"


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> date:
    gy, gm, gd = _d2g(_j2d(jy, jm, jd))
    return date(gy, gm, gd)


def normalize_date(raw: str | date | None) -> tuple[Optional[str], Optional[date]]:
    """هر ورودی تاریخی را به جفتِ (متن شمسی، تاریخ میلادی) تبدیل می‌کند.

    خواستهٔ کارفرما: «اگر سال میلادی وارد شد شمسی شود». پس سالِ ۱۸۰۰..۲۴۰۰
    میلادی تلقی و به شمسی برگردانده می‌شود، و ۱۲۰۰..۱۷۰۰ شمسی است.
    ارقام فارسی و عربی و جداکننده‌های / - . همگی پذیرفته می‌شوند.
    مقدار نامعتبر → (None, None) تا لایه بالاتر خطای کاربرپسند بدهد.
    """
    if raw is None:
        return None, None
    if isinstance(raw, date):
        return gregorian_to_jalali(raw), raw

    text = str(raw).translate(_FA_DIGITS).strip()
    if not text:
        return None, None

    parts: list[str] = []
    current = ""
    for ch in text:
        if ch.isdigit():
            current += ch
        elif current:
            parts.append(current)
            current = ""
    if current:
        parts.append(current)
    if len(parts) < 3:
        return None, None

    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None, None
    if not (1 <= m <= 12 and 1 <= d <= 31):
        return None, None

    try:
        if GREGORIAN_MIN_YEAR <= y <= GREGORIAN_MAX_YEAR:
            g = date(y, m, d)
            return gregorian_to_jalali(g), g
        if JALALI_MIN_YEAR <= y <= JALALI_MAX_YEAR:
            g = jalali_to_gregorian(y, m, d)
            return f"{y:04d}/{m:02d}/{d:02d}", g
    except (ValueError, OverflowError):
        return None, None
    return None, None


def today_jalali() -> str:
    return gregorian_to_jalali(date.today())
