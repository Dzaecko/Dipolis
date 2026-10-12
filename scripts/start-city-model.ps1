param(
    [ValidateSet('N', 'R')][string]$Assignment = 'N',
    [ValidatePattern('^[1-9][0-9]*$')][string]$Run,
    [ValidateSet('on', 'off')][string]$Handbook = 'off',
    [ValidateSet('on', 'off')][string]$Review = 'off',
    [ValidateSet('haight', 'natural')][string]$StartMap,
    [ValidateSet('classic', 'koexistenz', 'v2-unruhe', 'v3-pods', 'v4-fraktion')][string]$Profile,
    [ValidatePattern('^(0|[1-9][0-9]*)$')][string]$Seed,
    [string]$Years = '30',
    [switch]$Resume,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$parsedYears = [decimal]0
if ($Years -notmatch '^[1-9][0-9]*$' -or ![decimal]::TryParse($Years, [ref]$parsedYears) -or $parsedYears -gt 9007199254740991) {
    throw 'Die Jahreszahl muss eine positive sichere ganze Zahl (1 bis 9007199254740991) sein.'
}
$root = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $root '.env.city-model'
if (!(Test-Path $configPath)) { throw 'Bitte .env.city-model.example nach .env.city-model kopieren und ausfuellen.' }
$allowed = @('CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME', 'CITY_MODEL_KEY', 'CITY_MODEL_ASSIGNMENT',
    'CITY_MODEL_RUN', 'CITY_MODEL_TIMEOUT_MS', 'CITY_MODEL_MAX_RETRIES', 'CITY_MODEL_MAX_TOKENS', 'CITY_MODEL_REASONING_EFFORT', 'CITY_MODEL_API',
    'CITY_MODEL_AUTH', 'CITY_MODEL_TOKEN_SCOPE', 'CITY_MODEL_START_MAP', 'CITY_MODEL_SEED', 'CITY_MODEL_PROFILE',
    'CITY_MODEL_MODEL', 'CITY_JUDGE_ENDPOINT', 'CITY_JUDGE_NAME', 'CITY_JUDGE_MODEL', 'CITY_JUDGE_KEY',
    'CITY_JUDGE_API', 'CITY_JUDGE_AUTH', 'CITY_JUDGE_TOKEN_SCOPE', 'CITY_JUDGE_TIMEOUT_MS',
    'CITY_JUDGE_MAX_RETRIES', 'CITY_JUDGE_MAX_TOKENS', 'CITY_JUDGE_REASONING_EFFORT')
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
$auth = $config['CITY_MODEL_AUTH']
if ([string]::IsNullOrWhiteSpace($auth)) { $auth = 'api-key' }
if ($auth -notin @('api-key', 'azure-cli')) { throw 'CITY_MODEL_AUTH muss api-key oder azure-cli sein.' }
$scope = $config['CITY_MODEL_TOKEN_SCOPE']
if ($scope -and $scope -notin @('https://ai.azure.com/.default', 'https://cognitiveservices.azure.com/.default')) {
    throw 'CITY_MODEL_TOKEN_SCOPE muss https://ai.azure.com/.default oder https://cognitiveservices.azure.com/.default sein.'
}
$required = @('CITY_MODEL_ENDPOINT', 'CITY_MODEL_NAME')
if ($config['CITY_MODEL_MODEL']) {
    if ($config['CITY_MODEL_NAME'] -and $config['CITY_MODEL_NAME'] -ne $config['CITY_MODEL_MODEL']) {
        throw 'CITY_MODEL_NAME und CITY_MODEL_MODEL muessen uebereinstimmen.'
    }
    $config['CITY_MODEL_NAME'] = $config['CITY_MODEL_MODEL']
}
if ($auth -eq 'api-key') { $required += 'CITY_MODEL_KEY' }
foreach ($name in $required) {
    if ([string]::IsNullOrWhiteSpace($config[$name])) { throw "Bitte $name in .env.city-model ausfuellen." }
}
$endpoint = $config['CITY_MODEL_ENDPOINT'].TrimEnd('/')
if ($endpoint -match '/openai/v1$') { $endpoint += '/chat/completions' }
$config['CITY_MODEL_ENDPOINT'] = $endpoint
if ($config['CITY_MODEL_PROFILE'] -and $config['CITY_MODEL_PROFILE'] -notin @('classic', 'koexistenz', 'v2-unruhe', 'v3-pods', 'v4-fraktion')) {
    throw 'CITY_MODEL_PROFILE muss classic, koexistenz, v2-unruhe, v3-pods oder v4-fraktion sein.'
}
if (!$PSBoundParameters.ContainsKey('Assignment') -and $config['CITY_MODEL_ASSIGNMENT']) {
    $Assignment = $config['CITY_MODEL_ASSIGNMENT']
}
if ($Assignment -notin @('N', 'R')) { throw 'CITY_MODEL_ASSIGNMENT muss N oder R sein.' }
if (!$PSBoundParameters.ContainsKey('Run')) {
    $Run = if ($config['CITY_MODEL_RUN']) { $config['CITY_MODEL_RUN'] } else { '1' }
}
if (!$Run) { $Run = '1' }
if ($Run -notmatch '^[1-9][0-9]*$') { throw 'Die Laufnummer muss eine positive ganze Zahl sein.' }
if (!$Resume) {
    if (!$PSBoundParameters.ContainsKey('Profile')) {
        $Profile = if ($config['CITY_MODEL_PROFILE']) { $config['CITY_MODEL_PROFILE'] } else { 'koexistenz' }
    }
    if (!$Profile) { $Profile = 'koexistenz' }
    if (!$PSBoundParameters.ContainsKey('StartMap')) {
        $StartMap = if ($config['CITY_MODEL_START_MAP']) { $config['CITY_MODEL_START_MAP'] } else { 'haight' }
    }
    if (!$StartMap) { $StartMap = 'haight' }
    if ($StartMap -notin @('haight', 'natural')) { throw 'CITY_MODEL_START_MAP muss haight oder natural sein.' }
    if (!$PSBoundParameters.ContainsKey('Seed')) {
        $Seed = if ($config['CITY_MODEL_SEED']) { $config['CITY_MODEL_SEED'] } else { '42' }
    }
    if (!$Seed) { $Seed = '42' }
}
if ($Profile -and $Profile -notin @('classic', 'koexistenz', 'v2-unruhe', 'v3-pods', 'v4-fraktion')) {
    throw 'CITY_MODEL_PROFILE muss classic, koexistenz, v2-unruhe, v3-pods oder v4-fraktion sein.'
}
if ($Seed -and ($Seed -notmatch '^(0|[1-9][0-9]*)$' -or [long]$Seed -gt 2147483647)) {
    throw 'CITY_MODEL_SEED muss eine ganze Zahl von 0 bis 2147483647 sein.'
}
# Protocol paths and resume compatibility belong to the runner's shared helper.
# Never infer the next run number by scanning filenames here.
$previous = @{}
$previousPath = $env:Path
Push-Location $root
try {
    # VS Code may still carry the PATH from before Node.js was installed.
    $env:Path = (@($previousPath, [Environment]::GetEnvironmentVariable('Path', 'User'),
        [Environment]::GetEnvironmentVariable('Path', 'Machine')) | Where-Object { $_ }) -join ';'
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    $corepack = Get-Command corepack.cmd -CommandType Application -ErrorAction SilentlyContinue
    if (!$node -or !$corepack) {
        throw 'Node.js 22+ mit Corepack fehlt. Node.js installieren und VS Code neu starten.'
    }
    if ($ValidateOnly) { Write-Output 'Konfiguration gueltig; keine Modellanfrage gestartet.'; return }
    foreach ($name in $allowed) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $config[$name], 'Process')
    }
    Write-Host "Stadtlauf $Assignment / $Run / Handbuch $Handbook wird gestartet. Modellkosten koennen entstehen."
    $runArgs = @()
    if (!$Resume -or $PSBoundParameters.ContainsKey('Years')) { $runArgs += @('--years', $Years) }
    if ($Profile) { $runArgs += @('--profile', $Profile) }
    if ($Resume) {
        $runArgs += '--resume'
        if ($PSBoundParameters.ContainsKey('StartMap')) { $runArgs += @('--start-map', $StartMap) }
        if ($PSBoundParameters.ContainsKey('Seed')) { $runArgs += @('--seed', $Seed) }
    } else {
        $runArgs += @('--start-map', $StartMap, '--seed', $Seed)
    }
    & $corepack.Source pnpm --filter dipolis run city-model --adapter openai --assignment $Assignment --run $Run --handbook $Handbook --review $Review --live @runArgs
    if ($LASTEXITCODE -ne 0) { throw 'Stadtlauf fehlgeschlagen. Siehe Terminalausgabe.' }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $env:Path = $previousPath
    $config.Clear()
    Pop-Location
}