# KISMET key ceremony — run this yourself; keys never leave your machine.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-keys.ps1
#
# Generates six ed25519 keypairs (admin/oracle + four syndicates + patron),
# prints each account's public key and cspr.live link for faucet funding,
# and prints the gh commands that upload them to GitHub Actions secrets.

$ErrorActionPreference = "Stop"
$names = @(
  @{ file = "main";     secret = "CASPER_KEY_MAIN";     role = "admin + oracle reporter (deploys everything)" },
  @{ file = "sage";     secret = "CASPER_KEY_SAGE";     role = "Sage Mutual" },
  @{ file = "cavalier"; secret = "CASPER_KEY_CAVALIER"; role = "Cavalier Syndicate" },
  @{ file = "meridian"; secret = "CASPER_KEY_MERIDIAN"; role = "Meridian Re" },
  @{ file = "atlas";    secret = "CASPER_KEY_ATLAS";    role = "Atlas Parametric" },
  @{ file = "patron";   secret = "CASPER_KEY_PATRON";   role = "the patron (house demo buyer)" }
)

New-Item -ItemType Directory -Force keys | Out-Null

Write-Host ""
Write-Host "KISMET key ceremony" -ForegroundColor Cyan
Write-Host "==================="

foreach ($k in $names) {
  $pem = "keys/$($k.file).pem"
  if (-not (Test-Path $pem)) {
    openssl genpkey -algorithm ed25519 -out $pem | Out-Null
  }
  # Casper public key = 0x01 prefix + raw 32-byte ed25519 public key.
  # DER goes to a file: PowerShell pipelines mangle binary stdout.
  $der = "$pem.der"
  openssl pkey -in $pem -pubout -outform DER -out $der | Out-Null
  $bytes = [IO.File]::ReadAllBytes($der)
  Remove-Item $der -Force
  $raw = $bytes[($bytes.Length - 32)..($bytes.Length - 1)]
  $hex = "01" + (($raw | ForEach-Object { $_.ToString("x2") }) -join "")
  Write-Host ""
  Write-Host "$($k.file).pem  ($($k.role))" -ForegroundColor Yellow
  Write-Host "  public key : $hex"
  Write-Host "  fund here  : https://testnet.cspr.live/tools/faucet  (paste the public key)"
  Write-Host "  explorer   : https://testnet.cspr.live/account/$hex"
}

Write-Host ""
Write-Host "Upload to GitHub Actions secrets:" -ForegroundColor Cyan
foreach ($k in $names) {
  Write-Host "  gh secret set $($k.secret) -R lingjieheti-ops/kismet-bazaar < keys/$($k.file).pem"
}
Write-Host ""
Write-Host "Funding guide: main >= 1500 CSPR (contract deploys), sage 400, cavalier 250,"
Write-Host "meridian 400, atlas 300, patron 250. Faucet dispenses per-account; re-request"
Write-Host "or ask in the Casper hackathon Discord/Telegram if a deploy runs dry."
Write-Host ""
Write-Host "keys/ is gitignored. The PEMs exist only here and in GitHub secrets."
