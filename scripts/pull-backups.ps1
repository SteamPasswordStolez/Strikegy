# Copies the game server's account backups (scripts/backup-accounts.mjs on the
# laptop, 7 days there) to this PC, so they don't live on one disk only
# (owner, 2026-10-24). Run daily by the Windows scheduled task
# "Strikegy backup pull" (docs/server-setup.md 8); keeps 30 days here.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pull-backups.ps1
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:USERPROFILE 'Documents\strikegy-backups'
New-Item -ItemType Directory -Force $dest | Out-Null
$log = Join-Path $dest 'pull.log'
& scp.exe -o BatchMode=yes -o ConnectTimeout=15 -q 'steampasswordstolen@172.30.1.89:strikegy/.strikegy-backups/*' $dest
$ok = $LASTEXITCODE -eq 0
Get-ChildItem $dest -Filter 'accounts-*.db.gz' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format s), $(if ($ok) { 'ok' } else { "scp failed ($LASTEXITCODE)" }))
