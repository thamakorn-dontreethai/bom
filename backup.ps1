$env:PGPASSWORD = "0988435348"
$pg_dump   = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
$backupDir = "D:\bom\backups"
$date      = Get-Date -Format "yyyy-MM-dd_HHmm"
$file      = "$backupDir\tg_steering_wheel_$date.sql"

& $pg_dump -h localhost -p 5432 -U postgres -F p tg_steering_wheel | Out-File -FilePath $file -Encoding UTF8

if ($LASTEXITCODE -eq 0) {
    Write-Output "[$(Get-Date)] Backup OK: $file"
} else {
    Write-Output "[$(Get-Date)] Backup FAILED"
    exit 1
}

# Keep only last 14 backups
Get-ChildItem $backupDir -Filter "*.sql" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 14 |
    Remove-Item -Force

Write-Output "[$(Get-Date)] Done. Total backups: $((Get-ChildItem $backupDir -Filter '*.sql').Count)"
