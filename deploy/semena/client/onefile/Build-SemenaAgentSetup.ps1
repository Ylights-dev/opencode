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
$nsiPath = Join-Path $staging 'SemenaAgentSetup.nsi'

if (-not (Test-Path -LiteralPath $desktopSetup)) {
    throw "Application installer was not found: $desktopSetup"
}

New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
    $desktopHash = (Get-FileHash -LiteralPath $desktopSetup -Algorithm SHA256).Hash
    $embeddedScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Install-SemenaAgentEmbedded.ps1') -Raw -Encoding UTF8
    $embeddedScript = $embeddedScript.Replace('__SEMENA_DESKTOP_SETUP_SHA256__', $desktopHash)
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

    $makensis = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis-3.0.4.1\nsis-3.0.4.1-1mx3n\Bin\makensis.exe'
    if (-not (Test-Path -LiteralPath $makensis)) {
        throw "makensis.exe was not found: $makensis"
    }

    $iconPath = Resolve-Path (Join-Path $PSScriptRoot '..\branding\Semena-Agent.ico')
    $nsi = @"
Unicode true
Name "Semena Agent Setup"
OutFile "$OutputPath"
Icon "$iconPath"
RequestExecutionLevel user
SilentInstall normal
ShowInstDetails show
AutoCloseWindow true

Section "Install"
  InitPluginsDir
  SetOutPath "`$PLUGINSDIR"
  File /oname=Install-SemenaAgentEmbedded.ps1 "$staging\Install-SemenaAgentEmbedded.ps1"
  File /oname=agent-config.json "$staging\agent-config.json"
  File /oname=AGENTS.md "$staging\AGENTS.md"
  File /oname=semena-agent-ca.crt "$staging\semena-agent-ca.crt"
  File /oname=Semena-Agent-Setup-x64.exe "$staging\Semena-Agent-Setup-x64.exe"

  ReadEnvStr `$0 "SEMENA_AGENT_SETUP_API_KEY"
  StrCmp `$0 "" 0 with_key
  ExecWait '"`$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "`$PLUGINSDIR\Install-SemenaAgentEmbedded.ps1"' `$1
  Goto done

  with_key:
  ExecWait '"`$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "`$PLUGINSDIR\Install-SemenaAgentEmbedded.ps1" -ApiKey "`$0"' `$1

  done:
  IntCmp `$1 0 ok fail fail
  fail:
    DetailPrint "Installer failed with exit code `$1"
    SetErrorLevel `$1
    Abort "Semena Agent setup failed. See the PowerShell window for details."
  ok:
SectionEnd
"@
    [IO.File]::WriteAllText($nsiPath, $nsi, [Text.UTF8Encoding]::new($true))
    & $makensis /V2 $nsiPath | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "NSIS failed with exit code $LASTEXITCODE"
    }

    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "NSIS did not create output file: $OutputPath"
    }
    Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
