param(
    [ValidateSet('N', 'R')][string]$Assignment = 'N',
    [ValidatePattern('^[1-9][0-9]*$')][string]$Run,
    [ValidateSet('on', 'off')][string]$Handbook = 'off',
    [switch]$Resume,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $root '.env.city-model'
if (!(Test-Path $configPath)) { throw 'Bitte .env.city-model.example nach .env.city-model kopieren und ausfuellen.' }
$allowed = @('CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY', 'CITY_MODEL_ASSIGNMENT',
    'CITY_MODEL_RUN', 'CITY_MODEL_TIMEOUT_MS', 'CITY_MODEL_MAX_RETRIES', 'CITY_MODEL_MAX_TOKENS')
$config = @{}
foreach ($line in [IO.File]::ReadAllLines($configPath)) {
    $text = $line.Trim()
    if (!$text -or $text.StartsWith('#')) { continue }
    if ($text -notmatch '^([A-Z_]+)\s*=(.*)$') { throw 'Ungueltige Konfigurationszeile: NAME=WERT erwartet.' }
    $name = $Matches[1]; $value = $Matches[2].Trim()
    if ($allowed -notcontains $name -or $config.ContainsKey($name)) { throw "Unbekannte oder doppelte Einstellung: $name" }
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
    $config[$name] = $value
}
foreach ($name in @('CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY')) {
    if ([string]::IsNullOrWhiteSpace($config[$name])) { throw "Bitte $name in .env.city-model ausfuellen." }
}
$endpoint = $config['CITY_MODEL_ENDPOINT'].TrimEnd('/')
if ($endpoint -match '/openai/v1$') { $endpoint += '/chat/completions' }
$config['CITY_MODEL_ENDPOINT'] = $endpoint
if (!$PSBoundParameters.ContainsKey('Assignment') -and $config['CITY_MODEL_ASSIGNMENT']) {
    $Assignment = $config['CITY_MODEL_ASSIGNMENT']
}
if ($Assignment -notin @('N', 'R')) { throw 'CITY_MODEL_ASSIGNMENT muss N oder R sein.' }
if (!$PSBoundParameters.ContainsKey('Run')) { $Run = $config['CITY_MODEL_RUN'] }
if (!$Run) { $Run = '1' }
if ($Run -notmatch '^[1-9][0-9]*$') { throw 'Die Laufnummer muss eine positive ganze Zahl sein.' }
# Protocol paths and resume compatibility belong to the runner's shared helper.
# Never infer the next run number by scanning filenames here.
if ($ValidateOnly) { Write-Output 'Konfiguration gueltig; keine Modellanfrage gestartet.'; return }
$previous = @{}
Push-Location $root
try {
    foreach ($name in $allowed) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $config[$name], 'Process')
    }
    Write-Host "Stadtlauf $Assignment / $Run / Handbuch $Handbook wird gestartet. Modellkosten koennen entstehen."
    $resumeArgs = @()
    if ($Resume) { $resumeArgs += '--resume' }
    & corepack pnpm --filter micropolis run city-model --adapter openai --assignment $Assignment --run $Run --handbook $Handbook --live @resumeArgs
    if ($LASTEXITCODE -ne 0) { throw 'Stadtlauf fehlgeschlagen. Siehe Terminalausgabe.' }
} finally {
    foreach ($name in $allowed) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $config.Clear()
    Pop-Location
}