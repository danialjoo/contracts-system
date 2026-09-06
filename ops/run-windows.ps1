<#
.SYNOPSIS
    اجرای سامانه مدیریت قراردادها روی ویندوز، بدون Docker.

.DESCRIPTION
    برای سیستم‌هایی که مجازی‌سازی BIOS خاموش یا قفل است و Docker Desktop
    بالا نمی‌آید. پیش‌نیاز: Python 3.11 به بالا و PostgreSQL روی همین سیستم.

    اسکریپت محیط مجازی می‌سازد، وابستگی‌ها را نصب می‌کند، پایگاه داده را
    در صورت نبود ایجاد می‌کند، مهاجرت‌ها را اعمال و سامانه را اجرا می‌کند.

.EXAMPLE
    .\ops\run-windows.ps1 -DbPassword 'رمز-postgres'
#>
[CmdletBinding()]
param(
    [string] $DbHost     = 'localhost',
    [int]    $DbPort     = 5432,
    [string] $DbName     = 'contracts',
    [string] $DbUser     = 'postgres',
    [string] $DbPassword,
    [int]    $Port       = 8000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venv = Join-Path $backend '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

function Step($text) { Write-Host "`n>> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nخطا: $text" -ForegroundColor Red; exit 1 }

# --------------------------------------------------------------- پایتون
Step 'بررسی پایتون'
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { Fail 'پایتون پیدا نشد. از python.org نصب کنید و گزینه "Add python.exe to PATH" را تیک بزنید.' }

$version = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$version -lt [version]'3.11') { Fail "پایتون $version نصب است؛ سامانه به 3.11 یا بالاتر نیاز دارد." }
Write-Host "   پایتون $version"

# --------------------------------------------------- رمز پایگاه داده
if (-not $DbPassword) {
    $secure = Read-Host -Prompt 'رمز عبور کاربر postgres' -AsSecureString
    $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if (-not $DbPassword) { Fail 'رمز پایگاه داده وارد نشد.' }

# ------------------------------------------------------------ محیط مجازی
if (-not (Test-Path $py)) {
    Step 'ساخت محیط مجازی'
    & python -m venv $venv
}
Step 'نصب وابستگی‌ها (بار اول چند دقیقه طول می‌کشد)'
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r (Join-Path $backend 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Fail 'نصب وابستگی‌ها ناموفق بود. اتصال اینترنت یا میرور PyPI را بررسی کنید.' }

# ------------------------------------------------- اتصال و ساخت پایگاه داده
Step 'بررسی پایگاه داده'
$env:PGPASSWORD = $DbPassword
$check = @"
import sys, psycopg
try:
    conn = psycopg.connect(host='$DbHost', port=$DbPort, user='$DbUser',
                           password='''$DbPassword''', dbname='postgres', autocommit=True)
except Exception as exc:
    print('CONNECT_FAILED:' + str(exc)); sys.exit(2)
with conn.cursor() as cur:
    cur.execute('SELECT 1 FROM pg_database WHERE datname = %s', ('$DbName',))
    if cur.fetchone() is None:
        cur.execute('CREATE DATABASE "$DbName"')
        print('CREATED')
    else:
        print('EXISTS')
"@
$result = & $py -c $check
if ($LASTEXITCODE -ne 0) {
    Write-Host $result -ForegroundColor Red
    Fail 'اتصال به PostgreSQL برقرار نشد. مطمئن شوید نصب و سرویسش در حال اجراست و رمز درست است.'
}
Write-Host "   پایگاه داده $DbName : $result"

# ------------------------------------------------------ متغیرهای محیطی
$envFile = Join-Path $root '.env.windows'
if (-not (Test-Path $envFile)) {
    Step 'ساخت کلید رمزنگاری و رمز مدیر'
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)

    $bytes = New-Object byte[] 12
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $adminPassword = [Convert]::ToBase64String($bytes)

    @"
APP_SECRET_KEY=$secret
APP_ADMIN_USERNAME=admin
APP_ADMIN_PASSWORD=$adminPassword
"@ | Set-Content -Path $envFile -Encoding UTF8
    Write-Host "   در $envFile ذخیره شد. این فایل را جای امنی نگه دارید." -ForegroundColor Yellow
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_]+)=(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] }
}

$env:APP_DATABASE_URL = "postgresql+psycopg://${DbUser}:${DbPassword}@${DbHost}:${DbPort}/${DbName}"
$env:APP_UPLOAD_DIR   = Join-Path $root 'data\uploads'
New-Item -ItemType Directory -Force -Path $env:APP_UPLOAD_DIR | Out-Null

# ------------------------------------------------------------ مهاجرت و اجرا
Push-Location $backend
try {
    Step 'اعمال مهاجرت‌های پایگاه داده'
    & $py -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { Fail 'اعمال مهاجرت ناموفق بود.' }

    Step 'ایجاد داده اولیه'
    & $py -m app.seed

    Write-Host "`n────────────────────────────────────────────────" -ForegroundColor Green
    Write-Host "  سامانه در حال اجراست:  http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "  نام کاربری: $env:APP_ADMIN_USERNAME" -ForegroundColor Green
    Write-Host "  رمز اولیه در فایل .env.windows است." -ForegroundColor Green
    Write-Host "  برای توقف: Ctrl+C" -ForegroundColor Green
    Write-Host "────────────────────────────────────────────────`n" -ForegroundColor Green

    & $py -m uvicorn app.main:app --host 127.0.0.1 --port $Port
}
finally { Pop-Location }
