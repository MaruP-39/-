<#
  영상에 ASS 자막 입히기 (Windows)

  사용법
    - 같은 폴더의 「자막입히기.bat」에 영상(또는 음악)과 .ass 파일을 함께 끌어다 놓으세요.
    - 음악 파일만 있으면 검은 화면 위에 자막을 입힙니다. 그림 파일(jpg/png)을 같이 놓으면 그 그림을 배경으로 씁니다.
    - 결과는 영상과 같은 폴더에 「원래이름_자막.mp4」로 저장됩니다.

  필요한 것: ffmpeg (없으면 설치할지 물어봅니다)
#>
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Paths,
  # 그래픽카드 인코더를 쓰지 않고 CPU(libx264)로만 인코딩
  [switch]$Cpu
)

$ErrorActionPreference = 'Stop'
$videoExt = @('.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.wmv', '.flv', '.ts')
$audioExt = @('.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma')
$imageExt = @('.jpg', '.jpeg', '.png', '.bmp', '.webp')

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Fail([string]$text) {
  Say ''
  Say "오류: $text" 'Red'
  exit 1
}
function Quote([string]$text) { '"' + $text + '"' }

# ---------- 1. ffmpeg 찾기 ----------
function Find-Tool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $local = Join-Path $PSScriptRoot "$name.exe"
  if (Test-Path $local) { return $local }
  return $null
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$ffmpeg = Find-Tool 'ffmpeg'
$ffprobe = Find-Tool 'ffprobe'
if (-not $ffmpeg -or -not $ffprobe) {
  Say 'ffmpeg가 설치되어 있지 않습니다.' 'Yellow'
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail 'https://www.gyan.dev/ffmpeg/builds/ 에서 ffmpeg를 받아 ffmpeg.exe와 ffprobe.exe를 이 스크립트 옆에 두거나 PATH에 추가해 주세요.'
  }
  $answer = Read-Host '지금 winget으로 ffmpeg를 설치할까요? (Y/N)'
  if ($answer -notmatch '^[Yy]') { Fail 'ffmpeg가 있어야 영상에 자막을 입힐 수 있습니다.' }
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
  Refresh-Path
  $ffmpeg = Find-Tool 'ffmpeg'
  $ffprobe = Find-Tool 'ffprobe'
  if (-not $ffmpeg -or -not $ffprobe) { Fail '설치는 끝났지만 ffmpeg를 찾지 못했습니다. 창을 닫고 다시 실행해 주세요.' }
}

# ---------- 2. 입력 파일 정리 ----------
Add-Type -AssemblyName System.Windows.Forms
function Pick-File([string]$title, [string]$filter) {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = $title
  $dialog.Filter = $filter
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
  return $null
}

$media = $null; $ass = $null; $image = $null
foreach ($path in @($Paths | Where-Object { $_ })) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq '.ass') { $ass = $path }
  elseif ($videoExt -contains $ext -or $audioExt -contains $ext) { $media = $path }
  elseif ($imageExt -contains $ext) { $image = $path }
}
if (-not $media) {
  $media = Pick-File '자막을 입힐 영상 또는 음악 선택' '영상·음악|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.m4v;*.wmv;*.mp3;*.m4a;*.wav;*.flac;*.ogg;*.opus|모든 파일|*.*'
  if (-not $media) { Fail '영상 또는 음악 파일을 선택하지 않았습니다.' }
}
if (-not $ass) {
  $sameName = [IO.Path]::ChangeExtension($media, '.ass')
  if (Test-Path -LiteralPath $sameName) { $ass = $sameName }
  else {
    $ass = Pick-File '입힐 ASS 자막 선택' 'ASS 자막|*.ass'
    if (-not $ass) { Fail 'ASS 자막 파일을 선택하지 않았습니다.' }
  }
}

# ---------- 3. 파일 정보 ----------
function Probe([string[]]$arguments) {
  $output = & $ffprobe -v error @arguments 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return (($output | Out-String).Trim())
}
$durationText = Probe @('-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', $media)
$duration = 0.0
[void][double]::TryParse($durationText, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$duration)
# 앨범 표지(attached_pic)는 영상으로 치지 않습니다.
$videoStreams = Probe @('-select_streams', 'v', '-show_entries', 'stream=index:stream_disposition=attached_pic', '-of', 'csv=p=0', $media)
$hasVideo = $false
foreach ($line in ($videoStreams -split "`r?`n")) { if ($line -match '^\d+,0$') { $hasVideo = $true } }
$audioCodec = Probe @('-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', $media)

Say ''
Say "영상·음악 : $media" 'Cyan'
Say "자막      : $ass" 'Cyan'
if (-not $hasVideo) { Say ("배경      : " + $(if ($image) { $image } else { '검은 화면 (1920×1080)' })) 'Cyan' }

# ---------- 4. 작업 폴더와 폰트 ----------
$work = Join-Path ([IO.Path]::GetTempPath()) ('karaoke-burn-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$fontDir = Join-Path $work 'fonts'
New-Item -ItemType Directory -Path $fontDir -Force | Out-Null
# 경로에 한글·따옴표가 있어도 문제없도록 자막은 작업 폴더에 단순한 이름으로 복사합니다.
Copy-Item -LiteralPath $ass -Destination (Join-Path $work 'sub.ass')

# ASS 스타일에 쓰인 폰트만 골라 작업 폴더로 복사합니다. (ffmpeg가 Windows 폰트를 못 찾는 경우 대비)
$families = @()
foreach ($line in [IO.File]::ReadAllLines($ass, [Text.Encoding]::UTF8)) {
  if ($line -match '^Style:\s*[^,]*,\s*@?([^,]+),') { $families += $Matches[1].Trim() }
}
$families = $families | Sort-Object -Unique
$registry = @(
  @{ Key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'; Base = Join-Path $env:WINDIR 'Fonts' },
  @{ Key = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'; Base = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts' }
)
$installed = @()
foreach ($source in $registry) {
  if (-not (Test-Path $source.Key)) { continue }
  $props = Get-ItemProperty -Path $source.Key
  foreach ($prop in $props.PSObject.Properties) {
    if ($prop.Name -like 'PS*') { continue }
    $file = [string]$prop.Value
    if (-not [IO.Path]::IsPathRooted($file)) { $file = Join-Path $source.Base $file }
    $names = ($prop.Name -replace '\s*\((TrueType|OpenType)\)\s*$', '') -split '\s*&\s*'
    $installed += [pscustomobject]@{ Names = $names; File = $file }
  }
}
foreach ($family in $families) {
  $matched = $installed | Where-Object { $n = $_.Names; @($n | Where-Object { $_ -like "$family*" }).Count -gt 0 }
  $copied = 0
  foreach ($font in $matched) {
    if (Test-Path -LiteralPath $font.File) {
      Copy-Item -LiteralPath $font.File -Destination $fontDir -Force -ErrorAction SilentlyContinue
      $copied++
    }
  }
  if ($copied) { Say "폰트      : $family ($copied개 파일)" 'DarkGray' }
  else { Say "폰트      : '$family'을(를) 이 PC에서 찾지 못했습니다. 다른 글꼴로 대체됩니다." 'Yellow' }
}

# ---------- 5. 인코더 고르기 ----------
function Test-Encoder([string]$name) {
  & $ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=320x240:d=0.2' -c:v $name -f null - 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}
$encoders = @(
  @{ Name = 'h264_nvenc'; Label = 'NVIDIA 그래픽카드'; Args = '-c:v h264_nvenc -preset p5 -rc vbr -cq 19 -b:v 0 -profile:v high -pix_fmt yuv420p' },
  @{ Name = 'h264_qsv'; Label = 'Intel 그래픽'; Args = '-c:v h264_qsv -preset slow -global_quality 20 -pix_fmt nv12' },
  @{ Name = 'h264_amf'; Label = 'AMD 그래픽카드'; Args = '-c:v h264_amf -quality quality -rc cqp -qp_i 18 -qp_p 20 -qp_b 22 -pix_fmt yuv420p' }
)
$cpuEncoder = @{ Name = 'libx264'; Label = 'CPU'; Args = '-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p' }
$chosen = $cpuEncoder
if (-not $Cpu) {
  Say '인코더 확인 중…' 'DarkGray'
  foreach ($encoder in $encoders) { if (Test-Encoder $encoder.Name) { $chosen = $encoder; break } }
}

# ---------- 6. 출력 파일 이름 ----------
$folder = Split-Path -Parent $media
$stem = [IO.Path]::GetFileNameWithoutExtension($media)
$output = Join-Path $folder "${stem}_자막.mp4"
$n = 2
while (Test-Path -LiteralPath $output) { $output = Join-Path $folder "${stem}_자막 ($n).mp4"; $n++ }

# ---------- 7. ffmpeg 실행 ----------
function Build-Arguments($encoder) {
  $a = @('-hide_banner', '-y', '-nostats', '-loglevel', 'error', '-progress', 'progress.txt')
  if ($hasVideo) {
    $a += @('-i', (Quote $media))
    $filter = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,ass=sub.ass:fontsdir=fonts'
    $a += @('-vf', (Quote $filter), '-map', '0:v:0', '-map', '0:a:0?')
  } else {
    if ($image) { $a += @('-loop', '1', '-framerate', '30', '-i', (Quote $image)) }
    else { $a += @('-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30') }
    $a += @('-i', (Quote $media))
    $filter = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,ass=sub.ass:fontsdir=fonts'
    $a += @('-vf', (Quote $filter), '-map', '0:v:0', '-map', '1:a:0', '-shortest')
    if ($duration -gt 0) { $a += @('-t', $duration.ToString([Globalization.CultureInfo]::InvariantCulture)) }
  }
  $a += $encoder.Args -split ' '
  if (-not $audioCodec) { $a += '-an' }
  elseif ($audioCodec -eq 'aac') { $a += @('-c:a', 'copy') }
  else { $a += @('-c:a', 'aac', '-b:a', '192k') }
  $a += @('-movflags', '+faststart', (Quote $output))
  return ($a -join ' ')
}

function Format-Time([double]$seconds) {
  $t = [TimeSpan]::FromSeconds([Math]::Max(0, $seconds))
  return '{0}:{1:00}' -f [int][Math]::Floor($t.TotalMinutes), $t.Seconds
}

function Run-Encode($encoder) {
  $progressFile = Join-Path $work 'progress.txt'
  $logFile = Join-Path $work 'ffmpeg-log.txt'
  Remove-Item -LiteralPath $progressFile, $logFile -ErrorAction SilentlyContinue
  Say ''
  Say "인코딩 시작 ($($encoder.Label))" 'Green'
  $process = Start-Process -FilePath $ffmpeg -ArgumentList (Build-Arguments $encoder) -WorkingDirectory $work `
    -NoNewWindow -PassThru -RedirectStandardError $logFile
  $null = $process.Handle  # Windows PowerShell 5.1에서 ExitCode를 읽으려면 필요
  $started = Get-Date
  while (-not $process.HasExited) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path -LiteralPath $progressFile) -or $duration -le 0) { continue }
    try {
      $stream = [IO.File]::Open($progressFile, 'Open', 'Read', 'ReadWrite')
      $reader = New-Object IO.StreamReader($stream)
      $text = $reader.ReadToEnd()
      $reader.Close()
    } catch { continue }
    $hits = [regex]::Matches($text, 'out_time_(?:us|ms)=(\d+)')
    if ($hits.Count -eq 0) { continue }
    $done = [double]$hits[$hits.Count - 1].Groups[1].Value / 1000000
    $percent = [Math]::Min(100, [Math]::Max(0, $done / $duration * 100))
    $elapsed = ((Get-Date) - $started).TotalSeconds
    $remain = if ($done -gt 0) { $elapsed * ($duration - $done) / $done } else { 0 }
    Write-Progress -Activity '영상에 자막 입히는 중' -Status ('{0:0}%  ·  {1} / {2}  ·  남은 시간 약 {3}' -f $percent, (Format-Time $done), (Format-Time $duration), (Format-Time $remain)) -PercentComplete $percent
  }
  Write-Progress -Activity '영상에 자막 입히는 중' -Completed
  $process.WaitForExit()
  return @{ Code = $process.ExitCode; Log = $(if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Raw } else { '' }) }
}

try {
  $result = Run-Encode $chosen
  if ($result.Code -ne 0 -and $chosen.Name -ne 'libx264') {
    Say "$($chosen.Label) 인코딩에 실패해 CPU로 다시 시도합니다." 'Yellow'
    Remove-Item -LiteralPath $output -ErrorAction SilentlyContinue
    $result = Run-Encode $cpuEncoder
  }
  if ($result.Code -ne 0) {
    Remove-Item -LiteralPath $output -ErrorAction SilentlyContinue
    Fail ("ffmpeg가 실패했습니다.`n" + $result.Log)
  }
  Say ''
  Say "완료: $output" 'Green'
  Start-Process explorer.exe -ArgumentList "/select,`"$output`""
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
