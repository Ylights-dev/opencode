[CmdletBinding()]
param(
    [string]$ApiKey,
    [string]$Workspace = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Семена - Агент')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$setupUrl = 'http://10.1.50.101:3010/downloads/Semena-Agent-Setup-x64.exe'
$expectedHash = 'C76B69A74D0987ED09F088AD9E9B98ECDC195D8918F223816AD40F9A78F73CDB'
$enrollUrl = 'https://10.1.50.101:8443/enroll'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Семена - Агент'
$configRoot = Join-Path $runtimeRoot 'config\opencode'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$certificateSource = Join-Path $sourceRoot 'semena-agent-ca.crt'
$certificateTarget = Join-Path $runtimeRoot 'semena-agent-ca.crt'
$setupPath = Join-Path $env:TEMP 'Semena-Agent-Setup-x64.exe'

Write-Host 'Установка приложения «Семена - Агент»' -ForegroundColor Green
Write-Host 'Приложение будет автоматически привязано к вашей учётной записи.'

if (-not (Test-Path -LiteralPath $certificateSource)) {
    throw 'В установочном архиве отсутствует корпоративный сертификат.'
}

Import-Certificate -FilePath $certificateSource -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $ApiKey) {
    $email = (Read-Host 'Введите e-mail от корпоративной веб-панели').Trim().ToLowerInvariant()
    if ($email -notmatch '^[^@\s]+@[^@\s]+$') {
        throw 'Введите корректный e-mail.'
    }

    $securePassword = Read-Host 'Введите пароль от корпоративной веб-панели' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $requestBody = @{ email = $email; password = $plainPassword } | ConvertTo-Json -Compress
        try {
            $enrollment = Invoke-RestMethod -Method Post -Uri $enrollUrl -ContentType 'application/json' -Body $requestBody
            $ApiKey = $enrollment.key
        }
        catch {
            throw 'Не удалось войти. Проверьте e-mail и пароль, затем запустите установку снова.'
        }
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $plainPassword = $null
        $requestBody = $null
    }
}

if ($ApiKey -notmatch '^sk-[A-Za-z0-9_-]{16,}$') {
    throw 'Сервер не выдал ключ доступа. Обратитесь к администратору.'
}

New-Item -ItemType Directory -Force -Path $runtimeRoot, $configRoot, $Workspace | Out-Null
[Environment]::SetEnvironmentVariable('SEMENA_AGENT_API_KEY', $ApiKey, 'User')
$env:SEMENA_AGENT_API_KEY = $ApiKey

Copy-Item -LiteralPath (Join-Path $sourceRoot 'agent-config.json') -Destination (Join-Path $configRoot 'opencode.json') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'AGENTS.md') -Destination (Join-Path $Workspace 'AGENTS.md') -Force
Copy-Item -LiteralPath $certificateSource -Destination $certificateTarget -Force

Write-Host 'Скачиваю приложение...' -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing -Uri $setupUrl -OutFile $setupPath
$actualHash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    throw "Контрольная сумма установщика не совпала. Получено: $actualHash"
}

$oldShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Semena OpenCode.lnk'
Remove-Item -LiteralPath $oldShortcut -Force -ErrorAction SilentlyContinue

Write-Host 'Устанавливаю приложение...' -ForegroundColor Cyan
$env:SEMENA_AGENT_SETUP_API_KEY = $ApiKey
$process = Start-Process -FilePath $setupPath -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Установщик завершился с кодом $($process.ExitCode)."
}

Remove-Item -LiteralPath $setupPath -Force -ErrorAction SilentlyContinue
Write-Host 'Готово. «Семена - Агент» установлен и привязан к вашей учётной записи.' -ForegroundColor Green
