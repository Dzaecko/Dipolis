param([switch]$Resume)
$ErrorActionPreference = 'Stop'
$endpoint = Read-Host 'Vollstaendige Chat-Completions-URL (endet mit /chat/completions)'
$model = Read-Host 'Modellname'
$run = Read-Host 'Laufnummer (z.B. 1; fuer Wiederholungen neue Nummer)'
if ($run -notmatch '^[1-9][0-9]*$') { throw 'Ungueltige Laufnummer' }
$secret = Read-Host 'Azure-Schluessel (verdeckt eingeben)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
$previousEndpoint = $env:CITY_MODEL_ENDPOINT
$previousModel = $env:CITY_MODEL_NAME
$previousKey = $env:CITY_MODEL_KEY
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $env:CITY_MODEL_ENDPOINT = $endpoint
    $env:CITY_MODEL_NAME = $model
    $env:CITY_MODEL_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $resumeArgs = @()
    if ($Resume) { $resumeArgs += '--resume' }
    & corepack pnpm --filter micropolis run city-model --adapter openai --assignment N --run $run --live @resumeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Stadtlauf fehlgeschlagen. Siehe Terminalausgabe.' }
} finally {
    $env:CITY_MODEL_ENDPOINT = $previousEndpoint
    $env:CITY_MODEL_NAME = $previousModel
    $env:CITY_MODEL_KEY = $previousKey
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
    Pop-Location
}