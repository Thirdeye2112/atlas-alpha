<#
.SYNOPSIS
    Register a daily Windows Scheduled Task to auto-update Oscar Carboni transcripts.
    Run ONCE as Administrator to set it up.

.USAGE
    Right-click PowerShell → "Run as Administrator"
    cd C:\Atlas\atlas-alpha
    .\scripts\setup_transcript_scheduler.ps1

.PARAMETERS
    -AtlasRoot      Root folder (default C:\Atlas\atlas-alpha)
    -OutputFile     Where the transcript .txt lives
    -RunTime        Time to run daily (default 7:00 PM)
    -TaskName       Scheduled task name
#>
param(
    [string]$AtlasRoot   = "C:\Atlas\atlas-alpha",
    [string]$OutputFile  = "$env:USERPROFILE\OneDrive\Desktop\chartwhisperer_transcripts.txt",
    [string]$RunTime     = "19:00",
    [string]$TaskName    = "AtlasTranscriptScraper",
    [string]$PythonExe   = "C:\Python314\python.exe"
)

# Auto-detect python if default path missing
if (-not (Test-Path $PythonExe)) {
    $found = Get-Command python -ErrorAction SilentlyContinue
    if ($found) { $PythonExe = $found.Source }
    else {
        Write-Error "Python not found. Set -PythonExe to your python.exe path."
        exit 1
    }
}

$LogDir  = "$AtlasRoot\logs"
$LogFile = "$LogDir\transcript_scraper.log"
$Script1 = "$AtlasRoot\scripts\scrape_transcripts.py"
$Script2 = "$AtlasRoot\scripts\scrape_chartwhisperer.py"
$Desktop = "$env:USERPROFILE\OneDrive\Desktop"
$OscarOut = "$Desktop\oscar_carboni_all_transcripts.txt"
$CWOut    = $OutputFile

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# Wrapper batch file — runs both scrapers, timestamps the log
$batchPath = "$AtlasRoot\run_transcript_scraper.bat"
@"
@echo off
echo. >> "$LogFile"
echo ===== %DATE% %TIME% ===== >> "$LogFile"

echo Running scrape_transcripts.py ... >> "$LogFile"
"$PythonExe" "$Script1" --output "$OscarOut" >> "$LogFile" 2>&1
if errorlevel 1 echo [ERROR] scrape_transcripts.py failed >> "$LogFile"

echo Running scrape_chartwhisperer.py ... >> "$LogFile"
"$PythonExe" "$Script2" --output "$CWOut" >> "$LogFile" 2>&1
if errorlevel 1 echo [ERROR] scrape_chartwhisperer.py failed >> "$LogFile"

echo Done. >> "$LogFile"
"@ | Set-Content $batchPath -Encoding ASCII

Write-Host "Batch wrapper → $batchPath"

# Scheduled Task — runs daily at $RunTime
$trigger  = New-ScheduledTaskTrigger -Daily -At $RunTime

$action   = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$batchPath`""

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit  (New-TimeSpan -Hours 2) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -WakeToRun:$false

$principal = New-ScheduledTaskPrincipal `
    -UserId    "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel  Highest

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Trigger    $trigger `
    -Action     $action `
    -Settings   $settings `
    -Principal  $principal `
    -Description "Atlas — daily Oscar Carboni transcript update (skips if nothing new)" |
    Out-Null

Write-Host ""
Write-Host "Scheduled Task registered: '$TaskName'"
Write-Host "  Runs daily at : $RunTime"
Write-Host "  Oscar output  : $OscarOut"
Write-Host "  CW output     : $CWOut"
Write-Host "  Log           : $LogFile"
Write-Host ""
Write-Host "Test it now (runs both scrapers immediately):"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Or run manually:"
Write-Host "  python scripts\scrape_transcripts.py --output `"$OscarOut`""
Write-Host "  python scripts\scrape_chartwhisperer.py --output `"$CWOut`""
