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
$sedPath = Join-Path $staging 'SemenaAgentSetup.sed'

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

    $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=1
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$OutputPath
FriendlyName=Semena Agent Setup
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File Install-SemenaAgentEmbedded.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
FILE0=Install-SemenaAgentEmbedded.ps1
FILE1=agent-config.json
FILE2=AGENTS.md
FILE3=semena-agent-ca.crt
FILE4=Semena-Agent-Setup-x64.exe
[SourceFiles]
SourceFiles0=$staging\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
%FILE3%=
%FILE4%=
"@
    [IO.File]::WriteAllText($sedPath, $sed, [Text.ASCIIEncoding]::new())
    $iexpress = Start-Process -FilePath 'iexpress.exe' -ArgumentList @('/N', $sedPath) -Wait -PassThru
    if ($iexpress.ExitCode -ne 0) {
        throw "IExpress failed with exit code $($iexpress.ExitCode)"
    }
    if (-not (Test-Path -LiteralPath $OutputPath)) {
        throw "IExpress did not create output file: $OutputPath"
    }
    Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath
}
finally {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
