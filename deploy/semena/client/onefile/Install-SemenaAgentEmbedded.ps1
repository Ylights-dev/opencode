[CmdletBinding()]
param(
    [string]$ApiKey,
    [string]$Workspace = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Семена - Агент')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$host.UI.RawUI.WindowTitle = 'Установка Семена - Агент'

$expectedHash = '__SEMENA_DESKTOP_SETUP_SHA256__'
$enrollUrl = 'https://10.1.50.101:8443/enroll'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'Семена - Агент'
$configRoot = Join-Path $runtimeRoot 'config\opencode'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$certificateSource = Join-Path $sourceRoot 'semena-agent-ca.crt'
$certificateTarget = Join-Path $runtimeRoot 'semena-agent-ca.crt'
$setupPath = Join-Path $sourceRoot 'Semena-Agent-Setup-x64.exe'
$pythonInstaller = Join-Path $sourceRoot 'python-3.13.13-amd64.exe'
$pythonWheelRoot = Join-Path $sourceRoot 'python-wheels'

Write-Host 'Установка приложения «Семена - Агент»' -ForegroundColor Green
Write-Host 'Приложение будет автоматически привязано к вашей учётной записи.'

if (-not (Test-Path -LiteralPath $certificateSource)) {
    throw 'Во встроенном установщике отсутствует корпоративный сертификат.'
}
if (-not (Test-Path -LiteralPath $setupPath)) {
    throw 'Во встроенном установщике отсутствует приложение Семена - Агент.'
}

function Get-AgentPyLauncher {
    $command = Get-Command py -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $launcher = Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'
    if (Test-Path -LiteralPath $launcher) {
        return $launcher
    }

    return $null
}

function Test-AgentPython {
    $launcher = Get-AgentPyLauncher
    if (-not $launcher) {
        return $false
    }

    & $launcher -3 -c "import openpyxl; print(openpyxl.__version__)" *> $null
    return $LASTEXITCODE -eq 0
}

function Add-AgentPythonPath {
    $paths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\Scripts'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher')
    )
    $existing = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $existing) {
        $existing = ''
    }

    $parts = $existing -split ';' | Where-Object { $_ }
    $lower = @{}
    foreach ($part in $parts) {
        $lower[$part.ToLowerInvariant()] = $true
    }

    $changed = $false
    foreach ($path in $paths) {
        if (-not $lower.ContainsKey($path.ToLowerInvariant())) {
            $parts = @($path) + $parts
            $changed = $true
        }
    }

    if ($changed) {
        [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
    }
    $env:Path = (($paths + ($env:Path -split ';')) | Where-Object { $_ } | Select-Object -Unique) -join ';'
}

function Install-AgentPython {
    Add-AgentPythonPath
    if (Test-AgentPython) {
        return
    }

    if (-not (Test-Path -LiteralPath $pythonInstaller)) {
        throw 'Во встроенном установщике отсутствует Python.'
    }

    Write-Host 'Устанавливаю Python для локальных скриптов агента...' -ForegroundColor Cyan
    $pythonArgs = @(
        '/quiet',
        'InstallAllUsers=0',
        'PrependPath=0',
        'Include_launcher=1',
        'InstallLauncherAllUsers=0',
        'Include_pip=1',
        'Include_test=0',
        'Shortcuts=0',
        'AssociateFiles=0'
    )
    $pythonProcess = Start-Process -FilePath $pythonInstaller -ArgumentList $pythonArgs -Wait -PassThru
    if ($pythonProcess.ExitCode -ne 0) {
        throw "Установщик Python завершился с кодом $($pythonProcess.ExitCode)."
    }

    Add-AgentPythonPath
    $launcher = Get-AgentPyLauncher
    if (-not $launcher) {
        throw 'Python был установлен, но запускатель py.exe не найден.'
    }
    if (-not (Test-Path -LiteralPath $pythonWheelRoot)) {
        throw 'Во встроенном установщике отсутствуют Python-пакеты.'
    }

    & $launcher -3 -m pip install --no-index --find-links $pythonWheelRoot openpyxl xlrd
    if ($LASTEXITCODE -ne 0) {
        throw 'Не удалось установить Python-пакеты openpyxl и xlrd.'
    }

    if (-not (Test-AgentPython)) {
        throw 'Python и openpyxl не прошли проверку после установки.'
    }
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
Copy-Item -LiteralPath (Join-Path $sourceRoot 'semena_registry_check.py') -Destination (Join-Path $Workspace 'semena_registry_check.py') -Force
Copy-Item -LiteralPath $certificateSource -Destination $certificateTarget -Force
Install-AgentPython

$actualHash = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    throw "Контрольная сумма встроенного приложения не совпала. Получено: $actualHash"
}

$oldShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Semena OpenCode.lnk'
Remove-Item -LiteralPath $oldShortcut -Force -ErrorAction SilentlyContinue

Write-Host 'Устанавливаю приложение...' -ForegroundColor Cyan
$process = Start-Process -FilePath $setupPath -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Установщик завершился с кодом $($process.ExitCode)."
}

Write-Host 'Готово. «Семена - Агент» установлен и привязан к вашей учётной записи.' -ForegroundColor Green
