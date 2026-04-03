# Creates a private GitHub repo and pushes `main`, OR pushes if `origin` already exists.
# Prerequisite (one-time): install GitHub CLI, then run: gh auth login
param(
  [string]$RepoName = "speak_echo",
  [string]$Description = "SpeakEcho MVP: curated video English practice"
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "Install GitHub CLI from https://cli.github.com/ then run: gh auth login"
  exit 1
}

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run this in the same terminal first:"
  Write-Host "  gh auth login"
  Write-Host "Then run this script again."
  exit 1
}

$hasOrigin = $false
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $hasOrigin = $true }

if ($hasOrigin) {
  Write-Host "Remote origin already set; pushing branch main..."
  git push -u origin main
  exit $LASTEXITCODE
}

Write-Host "Creating private repo '$RepoName' and pushing..."
gh repo create $RepoName --private --source=. --remote=origin --push --description $Description
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "If the repo already exists on GitHub, add the remote and push manually, e.g.:"
  Write-Host "  git remote add origin https://github.com/<YOUR_USER>/$RepoName.git"
  Write-Host "  git push -u origin main"
  exit $LASTEXITCODE
}

Write-Host "Done. Repo: $(gh repo view --json url -q .url 2>$null)"
