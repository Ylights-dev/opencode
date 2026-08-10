[CmdletBinding()]
param(
    [string]$ApiKey,

    [string]$Workspace = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Semena AI')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Ru([string]$Base64) {
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Base64))
}

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
    throw (Ru '0J3QtSDQvdCw0LnQtNC10L0g0LrQvtGA0L/QvtGA0LDRgtC40LLQvdGL0Lkg0YHQtdGA0YLQuNGE0LjQutCw0YIg0LIg0L/QsNC/0LrQtSDRg9GB0YLQsNC90L7QstGJ0LjQutCw')
}
Import-Certificate -FilePath $certificatePath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $ApiKey) {
    $email = (Read-Host (Ru '0JLQstC10LTQuNGC0LUgZS1tYWlsINC+0YIgT3BlbiBXZWJVSQ==')).Trim().ToLowerInvariant()
    if ($email -notmatch '^[^@\s]+@[^@\s]+$') {
        throw (Ru '0J3QtdCy0LXRgNC90YvQuSDRhNC+0YDQvNCw0YIgZS1tYWlsIE9wZW4gV2ViVUk=')
    }
    $securePassword = Read-Host (Ru '0JLQstC10LTQuNGC0LUg0L/QsNGA0L7Qu9GMINC+0YIgT3BlbiBXZWJVSQ==') -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        $requestBody = @{ email = $email; password = $plainPassword } | ConvertTo-Json -Compress
        try {
            $enrollment = Invoke-RestMethod -Method Post -Uri $enrollUrl -ContentType 'application/json' -Body $requestBody
            $ApiKey = $enrollment.key
        }
        catch {
            throw (Ru '0J3QtSDRg9C00LDQu9C+0YHRjCDQstC+0LnRgtC4INCyIE9wZW4gV2ViVUkuINCf0YDQvtCy0LXRgNGM0YLQtSBlLW1haWwg0Lgg0L/QsNGA0L7Qu9GMLCDQt9Cw0YLQtdC8INC30LDQv9GD0YHRgtC40YLQtSDRg9GB0YLQsNC90L7QstC60YMg0YHQvdC+0LLQsC4=')
        }
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $plainPassword = $null
        $requestBody = $null
    }
}
if ($ApiKey -notmatch '^sk-[A-Za-z0-9_-]{16,}$') {
    throw (Ru '0J3QtSDRg9C00LDQu9C+0YHRjCDQv9C+0LvRg9GH0LjRgtGMINC60LvRjtGHINC00L7RgdGC0YPQv9CwIFNlbWVuYSBPcGVuQ29kZQ==')
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
        Write-Warning ((Ru '0J3QtSDRg9C00LDQu9C+0YHRjCDRgdC60LDRh9Cw0YLRjCDRgSDQsNC00YDQtdGB0LA6IA==') + $downloadUrl)
    }
}
if (-not $downloaded) {
    throw (Ru '0J3QtSDRg9C00LDQu9C+0YHRjCDRgdC60LDRh9Cw0YLRjCDQv9GA0L7QstC10YDQtdC90L3Ri9C5INCw0YDRhdC40LIgT3BlbkNvZGU=')
}
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    throw "OpenCode archive checksum mismatch: expected $expectedHash, got $actualHash"
}

Expand-Archive -LiteralPath $archive -DestinationPath $binRoot -Force
$binary = Get-ChildItem -LiteralPath $binRoot -Recurse -Filter 'opencode.exe' | Select-Object -First 1
if (-not $binary) {
    throw (Ru '0JIg0YHQutCw0YfQsNC90L3QvtC8INCw0YDRhdC40LLQtSDQvdC1INC90LDQudC00LXQvSBvcGVuY29kZS5leGU=')
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
Write-Host ("OpenCode $version" + (Ru 'INGD0YHRgtCw0L3QvtCy0LvQtdC9LiDQoNCw0LHQvtGH0LDRjyDQv9Cw0L/QutCwOiA=') + $Workspace)
Write-Host (Ru '0JfQsNC/0YPRgdC60LDQudGC0LUg0LXQs9C+INGP0YDQu9GL0LrQvtC8IMKrU2VtZW5hIE9wZW5Db2Rlwrsg0L3QsCDRgNCw0LHQvtGH0LXQvCDRgdGC0L7Qu9C1Lg==')
