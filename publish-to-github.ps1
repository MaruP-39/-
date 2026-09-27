param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryUrl
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git이 설치되어 있지 않습니다. GitHub Desktop 또는 Git for Windows를 설치한 뒤 다시 실행해 주세요.'
}
if (-not (Test-Path '.git')) {
  git init
  git branch -M main
}
$existing = git remote 2>$null
if ($existing -contains 'origin') { git remote set-url origin $RepositoryUrl } else { git remote add origin $RepositoryUrl }
git add index.html .nojekyll DEPLOYMENT.md
git diff --cached --quiet
$hasChanges = $LASTEXITCODE -ne 0
if ($hasChanges) {
  if (-not (git config user.name)) { git config user.name 'Karaoke Subtitle Maker' }
  if (-not (git config user.email)) { git config user.email 'karaoke-pages@users.noreply.github.com' }
  git commit -m 'Publish karaoke subtitle maker'
}
git push -u origin main
Write-Host '업로드했습니다. GitHub 저장소 Settings → Pages에서 main / (root)를 선택하세요.'

