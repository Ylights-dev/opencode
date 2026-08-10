[CmdletBinding()]
param(
    [string]$ApiKey,

    [string]$Workspace = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Semena AI')
)

$ErrorActionPreference = 'Stop'
$version = '1.18.15'
$downloadUrls = @(
    "http://10.1.50.101:3010/downloads/opencode-windows-x64-$version.zip",
    "https://github.com/anomalyco/opencode/releases/download/v$version/opencode-windows-x64.zip"
)
$expectedHash = 'A80785874978CCBB93B7BFE4345F5AED41696F5AE76C109CD6DBBB934DBE795D'
$installRoot = Join-Path $env:LOCALAPPDATA 'Semena OpenCode'
$binRoot = Join-Path $installRoot 'bin'
$configHome = Join-Path $installRoot 'config'
$configRoot = Join-Path $configHome 'opencode'
$dataHome = Join-Path $installRoot 'data'
$cacheHome = Join-Path $installRoot 'cache'
$archive = Join-Path $env:TEMP "opencode-$version.zip"
$enrollUrl = 'https://10.1.50.101:8443/enroll'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$certificatePath = Join-Path $sourceRoot 'semena-opencode-ca.crt'

if (-not (Test-Path -LiteralPath $certificatePath)) {
    throw 'Corporate CA certificate is missing from the installer directory'
}
Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $ApiKey) {
    $email = (Read-Host 'Enter your Open WebUI email').Trim().ToLowerInvariant()
    if ($email -notmatch '^[^@\s]+@[^@\s]+$') {
        throw 'The Open WebUI email has an invalid format'
    }
    $securePassword = Read-Host 'Enter your Open WebUI password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $requestBody = @{ email = $email; password = $plainPassword } | ConvertTo-Json -Compress
        try {
            $enrollment = Invoke-RestMethod -Method Post -Uri $enrollUrl -ContentType 'application/json' -Body $requestBody
            $ApiKey = $enrollment.key
        }
        catch {
            throw 'Open WebUI sign-in failed. Check your email and password, then run the installer again.'
        }
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $plainPassword = $null
        $requestBody = $null
    }
}
if ($ApiKey -notmatch '^sk-[A-Za-z0-9_-]{16,}$') {
    throw 'The Semena OpenCode access key has an invalid format'
}

New-Item -ItemType Directory -Force -Path $installRoot, $binRoot, $configRoot, $dataHome, $cacheHome, $Workspace | Out-Null

$downloaded = $false
foreach ($downloadUrl in $downloadUrls) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archive
        $downloaded = $true
        break
    }
    catch {
        Write-Warning "Download failed from $downloadUrl"
    }
}
if (-not $downloaded) {
    throw 'Could not download the verified OpenCode archive'
}
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

Copy-Item -LiteralPath (Join-Path $sourceRoot 'opencode.json') -Destination (Join-Path $configRoot 'opencode.json') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'AGENTS.md') -Destination (Join-Path $Workspace 'AGENTS.md') -Force

$installedCertificatePath = Join-Path $installRoot 'semena-opencode-ca.crt'
Copy-Item -LiteralPath $certificatePath -Destination $installedCertificatePath -Force

$launcherPath = Join-Path $installRoot 'Start-SemenaOpenCode.ps1'
$launcher = @"
`$ErrorActionPreference = 'Stop'
`$workspace = '$($Workspace.Replace("'", "''"))'
Set-Location -LiteralPath `$workspace
`$env:SEMENA_OPENCODE_API_KEY = [Environment]::GetEnvironmentVariable('SEMENA_OPENCODE_API_KEY', 'User')
`$env:NODE_EXTRA_CA_CERTS = '$($installedCertificatePath.Replace("'", "''"))'
`$env:SSL_CERT_FILE = '$($installedCertificatePath.Replace("'", "''"))'
`$env:XDG_CONFIG_HOME = '$($configHome.Replace("'", "''"))'
`$env:XDG_DATA_HOME = '$($dataHome.Replace("'", "''"))'
`$env:XDG_CACHE_HOME = '$($cacheHome.Replace("'", "''"))'
& '$((Join-Path $binRoot 'opencode.exe').Replace("'", "''"))' web --hostname 127.0.0.1 --port 4097
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
