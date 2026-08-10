[CmdletBinding()]
param(
    [string]$OutputPath = 'C:\docker-projects\semena-agent\static\downloads\SemenaAgentSetup.exe'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')
$clientRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$supportRoot = Get-ChildItem -LiteralPath $clientRoot -Directory |
    Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'agent-config.json')) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'Install-SemenaAgent.ps1'))
    } |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $supportRoot) {
    throw "Support directory was not found."
}
$desktopSetup = Join-Path $repoRoot 'packages\desktop\dist\Semena-Agent-Setup-x64.exe'
$staging = Join-Path $env:TEMP ('semena-agent-onefile-' + [Guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $staging 'SemenaAgentSetup.7z'
$configPath = Join-Path $staging 'sfx-config.txt'

if (-not (Test-Path -LiteralPath $desktopSetup)) {
    throw "Application installer was not found: $desktopSetup"
}

New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
    $embeddedScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Install-SemenaAgentEmbedded.ps1') -Raw -Encoding UTF8
    [IO.File]::WriteAllText(
        (Join-Path $staging 'Install-SemenaAgentEmbedded.ps1'),
        $embeddedScript,
        [Text.UTF8Encoding]::new($true)
    )
    Copy-Item -LiteralPath (Join-Path $supportRoot 'agent-config.json') -Destination (Join-Path $staging 'agent-config.json') -Force
    Copy-Item -LiteralPath (Join-Path $supportRoot 'AGENTS.md') -Destination (Join-Path $staging 'AGENTS.md') -Force
    Copy-Item -LiteralPath (Join-Path $supportRoot 'semena-agent-ca.crt') -Destination (Join-Path $staging 'semena-agent-ca.crt') -Force
    Copy-Item -LiteralPath $desktopSetup -Destination (Join-Path $staging 'Semena-Agent-Setup-x64.exe') -Force

    $outputDir = Split-Path -Parent $OutputPath
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

    $sevenZip = 'C:\Program Files\7-Zip\7z.exe'
    $sfxModule = 'C:\Program Files\7-Zip\7z.sfx'
    if (-not (Test-Path -LiteralPath $sevenZip)) {
        throw "7-Zip was not found: $sevenZip"
    }
    if (-not (Test-Path -LiteralPath $sfxModule)) {
        throw "7-Zip SFX module was not found: $sfxModule"
    }

    $sfxConfig = @"
;!@Install@!UTF-8!
Title="Семена - Агент"
BeginPrompt="Установить приложение Семена - Агент?"
RunProgram="powershell.exe -NoProfile -ExecutionPolicy Bypass -File Install-SemenaAgentEmbedded.ps1"
;!@InstallEnd@!
"@
    [IO.File]::WriteAllText($configPath, $sfxConfig, [Text.UTF8Encoding]::new($false))

    Push-Location $staging
    try {
        & $sevenZip a -t7z -mx=7 $archivePath `
            'Install-SemenaAgentEmbedded.ps1' `
            'agent-config.json' `
            'AGENTS.md' `
            'semena-agent-ca.crt' `
            'Semena-Agent-Setup-x64.exe' | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "7-Zip archive creation failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $outputStream = [IO.File]::Create($OutputPath)
    try {
        foreach ($part in @($sfxModule, $configPath, $archivePath)) {
            $partBytes = [IO.File]::ReadAllBytes($part)
            $outputStream.Write($partBytes, 0, $partBytes.Length)
        }
    }
    finally {
        $outputStream.Dispose()
    }

    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "SFX did not create output file: $OutputPath"
    }
    Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
