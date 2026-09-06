from datetime import date

import pytest

from app.jalali import gregorian_to_jalali, jalali_to_gregorian, normalize_date


def test_known_conversions():
    assert gregorian_to_jalali(date(2026, 9, 6)) == "1405/06/15"
    assert gregorian_to_jalali(date(2026, 3, 21)) == "1405/01/01"
    assert jalali_to_gregorian(1405, 1, 1) == date(2026, 3, 21)
    assert jalali_to_gregorian(1403, 4, 15) == date(2024, 7, 5)


@pytest.mark.parametrize("jy,jm,jd", [
    (1399, 12, 30), (1400, 1, 1), (1403, 12, 29), (1405, 6, 15), (1410, 11, 3),
])
def test_round_trip(jy, jm, jd):
    g = jalali_to_gregorian(jy, jm, jd)
    assert gregorian_to_jalali(g) == f"{jy:04d}/{jm:02d}/{jd:02d}"


def test_leap_year_1399_has_esfand_30():
    # ۱۳۹۹ کبیسه است؛ ۳۰ اسفند وجود دارد و به ۲۰۲۱-۰۳-۲۰ می‌خورد.
    assert jalali_to_gregorian(1399, 12, 30) == date(2021, 3, 20)


def test_gregorian_input_is_converted_to_jalali():
    """الزام کارفرما: اگر سال میلادی وارد شد شمسی شود."""
    assert normalize_date("2026/09/06") == ("1405/06/15", date(2026, 9, 6))
    assert normalize_date("2024-07-05")[0] == "1403/04/15"


def test_jalali_input_stays_jalali():
    assert normalize_date("۱۴۰۵/۰۶/۱۵") == ("1405/06/15", date(2026, 9, 6))
    assert normalize_date("1403-04-15")[0] == "1403/04/15"


def test_separators_and_digit_forms():
    for text in ("1405/06/15", "1405-06-15", "1405.06.15", "۱۴۰۵ / ۰۶ / ۱۵"):
        assert normalize_date(text)[0] == "1405/06/15"


def test_date_object_is_accepted():
    assert normalize_date(date(2026, 9, 6))[0] == "1405/06/15"


def test_invalid_values_return_none():
    for bad in ("", None, "سلام", "1405/13/01", "1405/06", "9999/01/01"):
        assert normalize_date(bad) == (None, None)
