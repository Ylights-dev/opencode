[CmdletBinding()]
param(
    [string]$ApiKey,

    [string]$Workspace = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Semena AI')
)

$ErrorActionPreference = 'Stop'
$version = '1.18.15'
$downloadUrl = "https://github.com/anomalyco/opencode/releases/download/v$version/opencode-windows-x64.zip"
$expectedHash = 'A80785874978CCBB93B7BFE4345F5AED41696F5AE76C109CD6DBBB934DBE795D'
$installRoot = Join-Path $env:LOCALAPPDATA 'Semena OpenCode'
$binRoot = Join-Path $installRoot 'bin'
$configRoot = Join-Path $env:USERPROFILE '.config\opencode'
$archive = Join-Path $env:TEMP "opencode-$version.zip"

if (-not $ApiKey) {
    $secureApiKey = Read-Host 'Enter your Semena OpenCode access key' -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
    try {
        $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
}
if ($ApiKey -notmatch '^sk-[A-Za-z0-9_-]{16,}$') {
    throw 'The Semena OpenCode access key has an invalid format'
}

New-Item -ItemType Directory -Force -Path $installRoot, $binRoot, $configRoot, $Workspace | Out-Null

Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    throw "OpenCode archive checksum mismatch: expected $expectedHash, got $actualHash"
}

Expand-Archive -LiteralPath $archive -DestinationPath $binRoot -Force
$binary = Get-ChildItem -LiteralPath $binRoot -Recurse -Filter 'opencode.exe' | Select-Object -First 1
if (-not $binary) {
    throw 'opencode.exe was not found in the verified archive'
}
if ($binary.DirectoryName -ne $binRoot) {
    Copy-Item -LiteralPath $binary.FullName -Destination (Join-Path $binRoot 'opencode.exe') -Force
}

[Environment]::SetEnvironmentVariable('SEMENA_OPENCODE_API_KEY', $ApiKey, 'User')

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -LiteralPath (Join-Path $sourceRoot 'opencode.json') -Destination (Join-Path $configRoot 'opencode.json') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'AGENTS.md') -Destination (Join-Path $Workspace 'AGENTS.md') -Force

$certificatePath = Join-Path $sourceRoot 'semena-opencode-ca.crt'
if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw 'Corporate CA certificate is missing from the installer directory'
}
$installedCertificatePath = Join-Path $installRoot 'semena-opencode-ca.crt'
Copy-Item -LiteralPath $certificatePath -Destination $installedCertificatePath -Force
Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null

$launcherPath = Join-Path $installRoot 'Start-SemenaOpenCode.ps1'
$launcher = @"
`$ErrorActionPreference = 'Stop'
`$workspace = '$($Workspace.Replace("'", "''"))'
Set-Location -LiteralPath `$workspace
`$env:SEMENA_OPENCODE_API_KEY = [Environment]::GetEnvironmentVariable('SEMENA_OPENCODE_API_KEY', 'User')
`$env:NODE_EXTRA_CA_CERTS = '$($installedCertificatePath.Replace("'", "''"))'
`$env:SSL_CERT_FILE = '$($installedCertificatePath.Replace("'", "''"))'
& '$((Join-Path $binRoot 'opencode.exe').Replace("'", "''"))' web --hostname 127.0.0.1 --port 4096
"@
[System.IO.File]::WriteAllText($launcherPath, $launcher, [System.Text.UTF8Encoding]::new($true))

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Semena OpenCode.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $Workspace
$shortcut.Description = 'Semena OpenCode local corporate AI'
$shortcut.Save()

Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
Write-Host "OpenCode $version installed. Workspace: $Workspace"
Write-Host "Start it with the 'Semena OpenCode' desktop shortcut."
