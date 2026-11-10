param([string]$Destination = "$env:USERPROFILE\Documents\SiteBackups")
$ErrorActionPreference = 'Stop'
$started = Get-Date
Write-Host 'Sign in and download one backup from each site. No passwords are needed by this script.'
Start-Process 'https://recordirk.ru/#admin'
Start-Process 'https://www.cf-baza.ru/admin/backups'
[void](Read-Host 'After both downloads finish, press Enter')
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$files = @()
foreach ($entry in @(@('record-backup-*.json.gz', 'record-site'), @('cfbaza-backup-*.json.gz', 'cfbaza-site'))) {
    $file = Get-ChildItem -LiteralPath $downloads -File | Where-Object { $_.Name -like $entry[0] -and $_.LastWriteTime -ge $started.AddMinutes(-5) } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $file) { throw "A fresh backup is missing: $($entry[1]). Check your browser download folder." }
    $stream = [IO.File]::OpenRead($file.FullName)
    $gzip = New-Object IO.Compression.GZipStream($stream, [IO.Compression.CompressionMode]::Decompress)
    $reader = New-Object IO.StreamReader($gzip, [Text.Encoding]::UTF8)
    try { $dump = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose(); $gzip.Dispose(); $stream.Dispose() }
    if ($dump.app -ne $entry[1] -or $dump.version -ne 1 -or -not $dump.tables) { throw "Unexpected backup format: $($file.Name)" }
    $files += $file
}
$folder = Join-Path $Destination (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss')
[void](New-Item -ItemType Directory -Path $folder -Force)
foreach ($file in $files) {
    $target = Join-Path $folder $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination $target
    if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { throw "Copy verification failed: $($file.Name)" }
}
Write-Host "Both backups copied and SHA256 verified: $folder"
Write-Host 'Keep this folder private. The .gz files contain personal data and are not encrypted.'
Start-Process explorer.exe -ArgumentList $folder
